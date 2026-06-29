// src/store/engineStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Chess } from 'chess.js';
import {
  EngineManager,
  ENGINE_CONFIGS,
  type EngineVersion,
  type SearchInfoLine,
  type EngineOptions,
  type WDL,
  DEFAULT_ENGINE_OPTIONS,
} from '../services/EngineManager';
import { useReviewStore } from './reviewStore';
import { GameEngineAdapter, type IndexedGame } from '../services/GameEngineAdapter';
import { formatEval } from '../utils/parseUCI';

export interface EngineLine {
  multipv: number;
  eval: string;
  rawCp: number | null;
  mate: number | null;
  uciMoves: string[];
  sanMoves: string[];
  moveColor: 'white' | 'black' | 'equal';
  bestMove: string;
  /** Win/Draw/Loss per-mille from the engine (UCI_ShowWDL). Display-only;
   *  undefined on engines/lines that don't emit it. */
  wdl?: WDL;
}

interface EngineState {
  isRunning: boolean;
  isLoading: boolean;
  isEnabled: boolean;
  engineVersion: EngineVersion;
  depth: number;
  multiPV: 1 | 2 | 3 | 4 | 5;
  /** Tunable engine options (Hash/Threads/Skill/NNUE). Persisted. */
  engineSettings: EngineOptions;
  /** Legacy live-search preference. Live analysis now always runs infinite. */
  moveTimeMs: number | null;
  /** Always true for live analysis; retained for older persisted snapshots/tests. */
  infiniteMode: boolean;
  evalFormatted: string;
  rawCp: number | null;
  lines: EngineLine[];
  currentDepth: number;
  nps: number;
  hashfull: number;
  manager: EngineManager | null;
  adapter: GameEngineAdapter | null;
  bestMoveUci: string | null;
  currentFen: string;
  analyzedFen: string | null;

  initEngine: (version?: EngineVersion) => Promise<EngineManager>;
  switchEngine: (version: EngineVersion) => Promise<void>;
  startAnalysis: (fen: string) => void;
  startIndexedAnalysis: (game: IndexedGame, ply: number) => void;
  stopAnalysis: () => void;
  resetAnalysisState: () => void;
  setDepth: (d: number) => void;
  setMultiPV: (n: 1 | 2 | 3 | 4 | 5) => void;
  setEnabled: (on: boolean) => void;
  setEngineSettings: (partial: Partial<EngineOptions>) => void;
  setMoveTime: (ms: number | null) => void;
  setInfiniteMode: (on: boolean) => void;
}

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function isTerminalFen(fen: string): boolean {
  try {
    return new Chess(fen).isGameOver();
  } catch {
    return false;
  }
}

// Eval-bar stability gate. Depth 1-3 PVs are notoriously unstable — a depth-1
// score can read -3.00 on a position that settles to +0.40 by depth 8. The
// engine LINES panel still updates from every depth, but the displayed
// evaluation (eval bar + headline rawCp) only refreshes once the search reaches
// this depth for the CURRENT position. Until then the previous valid eval is
// held, so the bar never collapses to a placeholder or a depth-1 spike after a
// move. Capped at the target depth so low-depth settings still show a result.
const MIN_RENDER_DEPTH = 4;

// Memoized UCI-to-SAN conversion keyed by fen + moves signature.
// Bounded LRU — a long analysis/review session generates up to ~90 distinct
// keys per position (depth × multiPV), so an uncapped Map would leak into the
// thousands. On overflow we evict the oldest insertion (Map preserves order).
const SAN_CACHE_MAX = 2000;
const sanCache = new Map<string, string[]>();

function sanCacheSet(key: string, value: string[]): void {
  if (sanCache.size >= SAN_CACHE_MAX) {
    const oldest = sanCache.keys().next().value;
    if (oldest !== undefined) sanCache.delete(oldest);
  }
  sanCache.set(key, value);
}

function convertUciToSan(fen: string, uciMoves: string[]): string[] {
  const key = fen + '|' + uciMoves.join(',');
  if (sanCache.has(key)) {
    // Refresh recency: re-insert so it moves to the newest position.
    const cached = sanCache.get(key)!;
    sanCache.delete(key);
    sanCache.set(key, cached);
    return cached;
  }

  try {
    const chess = new Chess(fen);
    const out: string[] = [];
    for (const u of uciMoves) {
      if (u.length < 4) break;
      const from = u.slice(0, 2);
      const to = u.slice(2, 4);
      const promotion = u.length > 4 ? u[4] : undefined;
      try {
        const m = chess.move({ from: from as any, to: to as any, promotion: promotion as any });
        if (!m) break;
        out.push(m.san);
      } catch {
        break;
      }
    }
    sanCacheSet(key, out);
    return out;
  } catch {
    return [];
  }
}

// Guards initEngine() against a resolution-order race: React StrictMode's dev
// double-mount (and Vite HMR / rapid engine switches) can run two initEngine()
// calls concurrently, and whichever loadEngine() RESOLVES last would otherwise
// win the store — even if it's the older call, which then terminates its own
// worker, leaving a DEAD manager in the store (no analysis until the next move).
// Each call takes a generation; only the latest may publish its manager.
let engineInitGeneration = 0;

export const useEngineStore = create<EngineState>()(
  persist(
    (set, get) => ({
  isRunning: false,
  isLoading: false,
  isEnabled: true,
  engineVersion: 'sf18-lite',
  depth: 18,
  multiPV: 3,
  engineSettings: { ...DEFAULT_ENGINE_OPTIONS },
  moveTimeMs: null,
  infiniteMode: true,
  evalFormatted: '0.00',
  rawCp: 0,
  lines: [],
  currentDepth: 0,
  nps: 0,
  hashfull: 0,
  manager: null,
  adapter: null,
  bestMoveUci: null,
  currentFen: STARTPOS,
  analyzedFen: null,

  initEngine: async (version) => {
    const myGeneration = ++engineInitGeneration;
    const existing = get().manager;
    if (existing) {
      existing.terminate();
      set({ manager: null, adapter: null });
    }
    const requested = version ?? get().engineVersion;
    // Fall back if a stale persisted/profile value names a removed engine (e.g.
    // the dropped 'sf18-full'): ENGINE_CONFIGS[bad].file would throw on load,
    // crashing the whole analysis UI with no recovery but clearing localStorage.
    const target: EngineVersion = ENGINE_CONFIGS[requested] ? requested : 'sf18-lite';
    set({ isLoading: true });
    const manager = new EngineManager();
    // Apply persisted/tunable options BEFORE load so uciok picks them up.
    // Merge over defaults so a pre-v2 persisted engineSettings (missing
    // limitStrength/uciElo) can't emit `UCI_LimitStrength value undefined`.
    manager.setOptions({ ...DEFAULT_ENGINE_OPTIONS, ...get().engineSettings });

    // Subscribe to full engine event stream
    manager.subscribe((event) => {
      if (event.type === 'info') {
        const info = event.line;

        // Always update raw metrics from any info line
        const updates: Partial<EngineState> = {};
        if (info.depth !== undefined) updates.currentDepth = info.depth;
        if (info.nps !== undefined) updates.nps = info.nps;
        if (info.hashfull !== undefined) updates.hashfull = info.hashfull;

        // Only build/update an displayed line if there is a score
        if (info.cp !== null || info.mate !== null) {
          const { currentFen } = get();
          const turn = currentFen.split(' ')[1] === 'b' ? 'b' : 'w';
          const evalStr = formatEval(
            info.cp !== null
              ? { type: 'cp', value: info.cp }
              : info.mate !== null
                ? { type: 'mate', value: info.mate }
                : undefined,
            turn as 'w' | 'b',
          );
          const sanMoves = convertUciToSan(currentFen, info.pv);
          const rawCpForLine = info.cp !== null ? (turn === 'b' ? -info.cp : info.cp) : null;
          const mateForLine = info.mate !== null ? (turn === 'b' ? -info.mate : info.mate) : null;
          const moveColor: 'white' | 'black' | 'equal' = evalStr.startsWith('-')
            ? 'black'
            : evalStr === '0.00'
              ? 'equal'
              : 'white';
          const newLine: EngineLine = {
            multipv: info.multipv,
            eval: evalStr,
            rawCp: rawCpForLine,
            mate: mateForLine,
            uciMoves: info.pv,
            sanMoves,
            moveColor,
            bestMove: info.pv[0] ?? '',
            // WDL is mover-relative (UCI spec). Flip to white-centric — exactly as
            // cp/mate are flipped above — so the eval-bar "(White)" readout shows
            // White's win chance even when it is Black to move.
            wdl: info.wdl
              ? (turn === 'b'
                  ? { win: info.wdl.loss, draw: info.wdl.draw, loss: info.wdl.win }
                  : info.wdl)
              : undefined,
          };

          const lines = get().lines.slice();
          const idx = lines.findIndex((l) => l.multipv === newLine.multipv);
          if (idx >= 0) lines[idx] = newLine;
          else lines.push(newLine);
          lines.sort((a, b) => a.multipv - b.multipv);

          if (newLine.multipv === 1) {
            // Depth-gate the DISPLAYED eval to kill the post-move spike. Lines
            // (the panel) update from every depth above, but the eval bar only
            // moves once the search is deep enough to be trustworthy for this
            // position. Below the gate we hold the previous valid eval. The gate
            // is min(MIN_RENDER_DEPTH, target depth) so low depth settings still
            // produce a visible result.
            const infoDepth = info.depth ?? 0;
            const gate = Math.min(MIN_RENDER_DEPTH, get().depth);
            if (infoDepth >= gate) {
              updates.evalFormatted = evalStr;
              updates.rawCp = rawCpForLine;
              if (info.pv[0] && info.pv[0].length >= 4) {
                updates.bestMoveUci = info.pv[0];
              }
            }
          }
          updates.lines = lines;
        }

        if (Object.keys(updates).length > 0) {
          set(updates);
        }
      } else if (event.type === 'bestmove') {
        set({ isRunning: false, bestMoveUci: event.bestMoveUci || get().bestMoveUci });
      }
    });

    await manager.loadEngine(target);
    if (myGeneration !== engineInitGeneration) {
      // A newer initEngine() superseded this one while it was loading. Discard
      // this (now-orphaned) manager instead of writing it to the store, so the
      // store never holds a terminated worker.
      manager.terminate();
      return manager;
    }
    const adapter = new GameEngineAdapter(manager);
    set({ manager, adapter, engineVersion: target, isLoading: false });
    return manager;
  },

  switchEngine: async (version) => {
    const { isEnabled } = get();
    const currentFen = get().currentFen;
    // Always route through initEngine so the generation guard (engineInitGeneration)
    // serializes rapid switches. Calling manager.loadEngine() directly bypasses the
    // guard and can leave the store pointing at a terminated worker — after which
    // every analyze() silently no-ops (send() early-returns when !isReady).
    set({ lines: [], currentDepth: 0, bestMoveUci: null, isRunning: false });
    await get().initEngine(version);
    if (isEnabled && currentFen) {
      get().startAnalysis(currentFen);
    }
  },

  startAnalysis: (fen) => {
    const { manager, depth, multiPV, isEnabled } = get();
    if (!manager || !isEnabled) return;
    if (isTerminalFen(fen)) {
      get().stopAnalysis();
      return;
    }
    const rs = useReviewStore.getState();
    // Block only while a BATCH review is crunching (phase === 'analyzing').
    // Browsing finished review results must still get live analysis.
    if (rs.progress.phase === 'analyzing') return;
    // NOTE: do NOT blank evalFormatted/rawCp on a position change. Holding the
    // previous valid eval until the new search clears MIN_RENDER_DEPTH is what
    // stops the eval bar collapsing to a placeholder ('' -> NaN -> 50% center)
    // or flashing a depth-1 spike. The depth gate in the info handler owns the
    // first real refresh for the new FEN.
    // Likewise HOLD currentDepth (don't zero it) — zeroing flashed "depth 0" in
    // EngineStats for ~50ms every move. The first info line overwrites it.
    set({
      isRunning: true,
      lines: [],
      bestMoveUci: null,
      currentFen: fen,
      analyzedFen: fen,
    });
    manager.analyze({ fen, depth, multiPV, moveTimeMs: null, infinite: true });
  },

  startIndexedAnalysis: (game, ply) => {
    const { manager, depth, multiPV, isEnabled } = get();
    if (!manager || !isEnabled) return;
    const fen = game.fenPositions[ply] ?? STARTPOS;
    if (isTerminalFen(fen)) {
      get().stopAnalysis();
      return;
    }
    const moves = game.moveUciList.slice(0, ply);
    // Hold previous eval + depth (see startAnalysis). Was '0.00'/depth 0 which
    // snapped the bar to center and flashed "depth 0" on every indexed nav.
    set({
      isRunning: true,
      lines: [],
      bestMoveUci: null,
      currentFen: fen,
      analyzedFen: fen,
    });
    manager.analyze({ uciMoves: moves, depth, multiPV, moveTimeMs: null, infinite: true });
  },

  stopAnalysis: () => {
    const { manager } = get();
    manager?.stop();
    set({
      isRunning: false,
      lines: [],
      bestMoveUci: null,
      currentDepth: 0,
      evalFormatted: '',
      rawCp: null,
      analyzedFen: null,
    });
  },

  resetAnalysisState: () => {
    const { manager } = get();
    try { manager?.stop(); } catch { /* noop */ }
    set({
      isRunning: false,
      lines: [],
      bestMoveUci: null,
      currentDepth: 0,
      evalFormatted: '',
      rawCp: null,
      analyzedFen: null,
    });
  },

  setDepth: (d) => {
    set({ depth: Math.max(1, Math.min(30, d)) });
    const { manager, isEnabled, currentFen } = get();
    // Only suppress while a batch review is crunching. Browsing review results
    // should re-analyze at the new depth like Lichess move navigation.
    if (useReviewStore.getState().progress.phase === 'analyzing') return;
    if (manager && isEnabled && currentFen) {
      get().startAnalysis(currentFen);
    }
  },

  setMultiPV: (n) => {
    if (n === get().multiPV) return;
    set({ multiPV: n });
    const { manager, isEnabled, currentFen } = get();
    if (useReviewStore.getState().progress.phase === 'analyzing') return;
    // startAnalysis already blanks lines for the new search — no separate reset.
    if (manager && isEnabled && currentFen) {
      get().startAnalysis(currentFen);
    }
  },

  setEnabled: (on) => {
    const { manager, currentFen, isEnabled, analyzedFen, lines } = get();
    if (isEnabled === on) return;
    if (!on) {
      manager?.stop();
      set({
        isEnabled: false,
        isRunning: false,
        lines: [],
        bestMoveUci: null,
        currentDepth: 0,
        rawCp: null,
        evalFormatted: '',
        analyzedFen: null,
      });
    } else {
      set({ isEnabled: true });
      // Skip restart if we already have a fresh result for this FEN.
      if (manager && currentFen && (analyzedFen !== currentFen || lines.length === 0)) {
        get().startAnalysis(currentFen);
      }
    }
  },

  setEngineSettings: (partial) => {
    const next = { ...get().engineSettings, ...partial };
    set({ engineSettings: next });
    const { manager, isEnabled, currentFen } = get();
    if (!manager) return;
    // Threads/Hash only apply when idle — stop, push options, then restart so
    // the new options take effect on a fresh search.
    manager.stop();
    manager.setOptions(next);
    if (useReviewStore.getState().progress.phase === 'analyzing') return;
    if (isEnabled && currentFen) {
      get().startAnalysis(currentFen);
    }
  },

  setMoveTime: (ms) => {
    void ms;
    set({ moveTimeMs: null, infiniteMode: true });
  },

  setInfiniteMode: (on) => {
    void on;
    set({ infiniteMode: true, moveTimeMs: null });
    const { manager, isEnabled, currentFen } = get();
    if (useReviewStore.getState().progress.phase === 'analyzing') return;
    if (manager && isEnabled && currentFen) {
      get().startAnalysis(currentFen);
    }
  },
    }),
    {
      name: 'grandforge-engine',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // v1→v2 added limitStrength/uciElo to engineSettings. Old payloads lack
      // them; merge over defaults so buildOptionCommands never emits
      // `UCI_LimitStrength value undefined` on hydrate.
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (fromVersion < 2 && p.engineSettings && typeof p.engineSettings === 'object') {
          p.engineSettings = { ...DEFAULT_ENGINE_OPTIONS, ...(p.engineSettings as object) };
        }
        p.moveTimeMs = null;
        p.infiniteMode = true;
        return p as unknown as EngineState;
      },
      // Persist only serializable tuning prefs. manager/adapter/lines/eval are
      // runtime-only and must never be written to storage.
      partialize: (state) => ({
        engineVersion: state.engineVersion,
        depth: state.depth,
        multiPV: state.multiPV,
        engineSettings: state.engineSettings,
      }),
    }
  )
);
