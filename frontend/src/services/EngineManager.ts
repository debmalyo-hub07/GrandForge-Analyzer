// src/services/EngineManager.ts

export type EngineVersion = 'sf18-lite' | 'sf18-lite-mt' | 'sf17-lite' | 'sf16-lite';

export interface EngineConfigEntry {
  id: EngineVersion;
  label: string;
  file: string;
  sizeMB: number;
  description: string;
  /** True when the worker binary is a multi-threaded build (no `-single`
   *  suffix). Only these honor `setoption name Threads value N > 1`; single
   *  builds ignore Threads. Cross-origin isolation (COOP/COEP) must be active
   *  for the SharedArrayBuffer the MT build needs, or it falls back to 1. */
  multiThreaded?: boolean;
}

export const ENGINE_CONFIGS: Record<EngineVersion, EngineConfigEntry> = {
  'sf18-lite':    { id: 'sf18-lite',    label: 'Stockfish 18 (Lite)',         file: 'stockfish-18-lite-single.js',   sizeMB: 7,   description: 'Recommended — fast loading, superhuman strength' },
  // Multi-threaded lite build. stockfish-18-lite.js + .wasm are copied into
  // public/stockfish/ by scripts/copyStockfish.mjs. Honors Threads only under
  // cross-origin isolation (COOP/COEP), else the worker falls back to 1 thread.
  'sf18-lite-mt': { id: 'sf18-lite-mt', label: 'Stockfish 18 (Lite, Multi-threaded)', file: 'stockfish-18-lite.js',   sizeMB: 7,   description: 'Lite build using multiple CPU threads', multiThreaded: true },
  'sf17-lite':    { id: 'sf17-lite',    label: 'Stockfish 17.1 (Lite)',       file: 'stockfish-17.1-lite-single.js', sizeMB: 7,   description: 'Previous generation for comparison' },
  'sf16-lite':    { id: 'sf16-lite',    label: 'Stockfish 16',                file: 'stockfish-16-lite-single.js',   sizeMB: 1,   description: 'Classic NNUE engine for comparison' },
};

/** Whether the given engine version is a multi-threaded build. Used to decide
 *  if a Threads value > 1 is meaningful for the loaded engine. */
export function isMultiThreaded(version: EngineVersion | null): boolean {
  return version !== null && ENGINE_CONFIGS[version]?.multiThreaded === true;
}

export interface AnalyzeRequest {
  // Either a fen OR uciMoves (from startpos)
  fen?: string;
  uciMoves?: string[];
  depth: number;
  multiPV: 1 | 2 | 3 | 4 | 5;
  /** Skip `ucinewgame` to retain transposition hash across searches in same session. */
  skipNewGame?: boolean;
  /** When set (>0), search by time (`go movetime N`) instead of `go depth`. */
  moveTimeMs?: number | null;
  /** Lichess-style continuous analysis: emit `go infinite` and deepen until the
   *  caller sends `stop` (position change, toggle off, or Stop button). Takes
   *  precedence over depth; ignored when moveTimeMs is set. Live `analyze()` only
   *  — `evaluate()` (review) never sets this, it needs a bestmove to resolve. */
  infinite?: boolean;
}

/**
 * Tunable UCI engine options applied at load and live-settable between searches.
 * Threads/Hash require the engine to be idle; engineStore stops the current
 * search before pushing changes, then restarts analysis.
 */
export interface EngineOptions {
  hash: number;        // MB
  threads: number;
  skillLevel: number;  // 0..20, 20 = full strength
  useNNUE: boolean;
  /** When true, cap engine strength to a target Elo via UCI_LimitStrength +
   *  UCI_Elo. Off by default — when off, behavior is byte-identical to the
   *  pre-feature engine (only Skill Level governs strength). */
  limitStrength: boolean;
  /** Target Elo applied only while limitStrength is true. Stockfish accepts
   *  ~1320..3190; clamped on emit. */
  uciElo: number;
}

export function defaultThreads(): number {
  if (typeof navigator === 'undefined') return 1;
  return Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 1) - 1));
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  hash: 128,
  threads: defaultThreads(),
  skillLevel: 20,
  useNNUE: true,
  limitStrength: false,
  uciElo: 1500,
};

// Stockfish UCI_Elo accepts roughly 1320..3190. Clamp before emitting.
const UCI_ELO_MIN = 1320;
const UCI_ELO_MAX = 3190;

/** Win/Draw/Loss probabilities from `info ... wdl W D L` (per-mille ints,
 *  mover-relative, summing ~1000). Present only when UCI_ShowWDL is on and the
 *  engine emits the token. Display-only — never feeds accuracy math. */
export interface WDL {
  win: number;
  draw: number;
  loss: number;
}

export interface SearchInfoLine {
  multipv: number;
  cp: number | null;
  mate: number | null;
  depth: number;
  pv: string[];
  nps?: number;
  hashfull?: number;
  wdl?: WDL;
}

export interface SearchResult {
  bestMoveUci: string;
  cp: number | null;
  mate: number | null;
  pv: string[];
  depth: number;
  /** All MultiPV lines collected for this search keyed by multipv index (1..N). */
  lines: Map<number, SearchInfoLine>;
}

export type InfoListener = (info: SearchInfoLine) => void;

export type EngineEvent =
  | { type: 'info'; line: SearchInfoLine }
  | { type: 'bestmove'; bestMoveUci: string }
  | { type: 'error'; message: string }
  | { type: 'ready' };

export type EngineListener = (event: EngineEvent) => void;

// Watchdog grace = max gap between `info` lines before we assume the worker
// wedged and send `stop`. movetime searches finish on their own clock so a
// tight 15s gap is fine; fixed-depth searches at depth 24+ can legitimately go
// 30-60s between depth transitions on slower hardware, so they get 90s — long
// enough never to reap a healthy deep think, short enough to still catch a hang.
const MOVETIME_GRACE_MS = 15000;
const DEPTH_GRACE_MS = 90000;
// Infinite (`go infinite`) never returns a bestmove on its own — the search
// only ends when WE send `stop`. While deepening, Stockfish emits `info` lines
// continuously, so the info-gap watchdog still catches a genuinely wedged
// worker; the grace just has to be long enough never to reap a search that has
// plateaued at high depth (or solved a position) but is intentionally kept
// alive. 5 min is well past any real inter-info gap yet still bounds a hang.
const INFINITE_GRACE_MS = 300000;

export function infoGapGraceMs(req: { moveTimeMs?: number | null; infinite?: boolean }): number {
  if (req.moveTimeMs && req.moveTimeMs > 0) return MOVETIME_GRACE_MS;
  if (req.infinite) return INFINITE_GRACE_MS;
  return DEPTH_GRACE_MS;
}

/**
 * Serialized UCI engine wrapper.
 *
 * Key invariants:
 * - Only ONE `go` command is ever in flight. New requests queue.
 * - `analyze()` is a live-analysis request that supersedes any queued request.
 * - `evaluate()` returns a Promise that resolves with the final SearchResult.
 * - When a new request arrives mid-search, we send `stop` and queue it.
 *   The current search's `bestmove` is treated as the search terminator;
 *   only then do we start the queued one.
 */
export class EngineManager {
  private worker: Worker | null = null;
  private isReady = false;
  private isSearching = false;
  private currentVersion: EngineVersion | null = null;

  // Queue holds at most the LATEST request (live analyses supersede each other).
  private queued: { req: AnalyzeRequest; resolve?: (r: SearchResult) => void; reject?: (e: Error) => void } | null = null;
  // Currently running request — needed to resolve its Promise on bestmove.
  private current: { req: AnalyzeRequest; resolve?: (r: SearchResult) => void; reject?: (e: Error) => void; latestLines: Map<number, SearchInfoLine>; aborted?: boolean } | null = null;

  // Subscribers for streaming info updates (one per UI tick / per multipv).
  private infoListeners: Set<InfoListener> = new Set();
  // Full event subscribers (info, bestmove, error, ready)
  private eventListeners: Set<EngineListener> = new Set();

  // Watchdog state — detects engine hangs during long searches.
  private lastInfoTime = 0;
  private watchdog: number | null = null;
  // Failsafe analysis timeout — prevents infinite loading.
  private analysisTimer: number | null = null;
  // Current search's info-gap grace (ms). Set per-search in startSearch().
  private currentGraceMs: number = DEPTH_GRACE_MS;
  // loadEngine timeout ID — cleared on re-entry to prevent orphaned rejects.
  private loadTimeout: number | null = null;

  // FIFO correlation for `isready` → `readyok`. Stockfish answers isready in
  // send order, so the Nth readyok pairs with the Nth isready. EVERY isready
  // that reaches handleMessage enqueues a marker here (the load-barrier isready
  // is consumed earlier in onmessage and intentionally NOT queued). beginSession
  // tags its own marker so a concurrent setOptions/startSearch readyok can never
  // resolve it early. Markers may carry a one-shot resolve()/reject().
  private readyokQueue: Array<{ tag: 'barrier' | 'session'; resolve?: () => void }> = [];

  // Tunable UCI options. Applied at uciok and live via setOptions().
  private options: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS };

  onInfo(cb: InfoListener): () => void {
    this.infoListeners.add(cb);
    return () => { this.infoListeners.delete(cb); };
  }

  /** Build the ordered list of `setoption` UCI commands for the current
   *  options. Shared by the uciok handler (initial apply) and setOptions()
   *  (live apply) so the two never drift. UCI_Elo is emitted ONLY when
   *  limitStrength is on — with it off the engine is byte-identical to the
   *  pre-feature behavior (Skill Level governs strength). */
  private buildOptionCommands(): string[] {
    const o = this.options;
    const cmds = [
      `setoption name Hash value ${o.hash}`,
      `setoption name Threads value ${o.threads}`,
      `setoption name Skill Level value ${o.skillLevel}`,
      `setoption name Use NNUE value ${o.useNNUE}`,
      `setoption name UCI_LimitStrength value ${o.limitStrength}`,
    ];
    if (o.limitStrength) {
      const elo = Math.max(UCI_ELO_MIN, Math.min(UCI_ELO_MAX, Math.round(o.uciElo)));
      cmds.push(`setoption name UCI_Elo value ${elo}`);
    }
    return cmds;
  }

  /** Set tunable engine options live. Threads/Hash only take effect when the
   *  engine is idle, so the caller (engineStore) stops before and restarts
   *  after. Returns the resolved option set. */
  setOptions(partial: Partial<EngineOptions>): EngineOptions {
    this.options = { ...this.options, ...partial };
    if (this.worker && this.isReady) {
      for (const cmd of this.buildOptionCommands()) this.send(cmd);
      this.sendIsReady({ tag: 'barrier' });
    }
    return { ...this.options };
  }

  getOptions(): EngineOptions {
    return { ...this.options };
  }

  subscribe(listener: EngineListener): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  unsubscribe(listener: EngineListener): void {
    this.eventListeners.delete(listener);
  }

  loadEngine(version: EngineVersion): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.worker) {
        this.current?.reject?.(new Error('Engine reloaded'));
        this.queued?.reject?.(new Error('Engine reloaded'));
        try { this.worker.terminate(); } catch {}
        this.worker = null;
        this.isReady = false;
        this.isSearching = false;
        this.current = null;
        this.queued = null;
        // Resolve + drop any pending isready barriers / beginSession markers so
        // their awaiters don't hang, and the FIFO can't desync into the next
        // engine's searches (a stale 'session' marker would otherwise be shifted
        // by the new engine's first readyok, corrupting per-ply review evals).
        for (const m of this.readyokQueue) m.resolve?.();
        this.readyokQueue = [];
      }
      this.clearTimers();
      if (this.loadTimeout !== null) {
        window.clearTimeout(this.loadTimeout);
        this.loadTimeout = null;
      }
      this.currentVersion = version;
      try {
        this.worker = new Worker(`/stockfish/${ENGINE_CONFIGS[version].file}`);
      } catch (err) {
        reject(err as Error);
        return;
      }

      const settled = { done: false };
      this.loadTimeout = window.setTimeout(() => {
        if (!settled.done) {
          settled.done = true;
          this.loadTimeout = null;
          reject(new Error('Engine uciok timeout (60s)'));
        }
      }, 60000);

      this.worker.onmessage = (e: MessageEvent<string>) => {
        const data = typeof e.data === 'string' ? e.data : String(e.data);
        if (!this.isReady && data === 'uciok') {
          this.isReady = true;
          // Apply the current tunable options (defaults unless setOptions ran
          // before load). UCI_AnalyseMode stays on for analysis-quality search;
          // UCI_ShowWDL adds a `wdl W D L` triple to score-bearing info lines
          // (display-only). isReady is now true so we can use send().
          for (const cmd of this.buildOptionCommands()) this.send(cmd);
          this.send('setoption name UCI_AnalyseMode value true');
          this.send('setoption name UCI_ShowWDL value true');
          this.send('isready');
          return;
        }
        if (!settled.done && data === 'readyok') {
          settled.done = true;
          if (this.loadTimeout !== null) {
            window.clearTimeout(this.loadTimeout);
            this.loadTimeout = null;
          }
          // Start watchdog now that engine is alive.
          this.lastInfoTime = Date.now();
          this.startWatchdog();
          this.publishEvent({ type: 'ready' });
          resolve();
          return;
        }
        this.handleMessage(data);
      };

      this.worker.onerror = (e) => {
        console.error('[EngineManager] worker error:', e);
        if (!settled.done) {
          // Error BEFORE load resolved — the loadEngine() promise owns the
          // failure; reject it and stop here.
          settled.done = true;
          if (this.loadTimeout !== null) {
            window.clearTimeout(this.loadTimeout);
            this.loadTimeout = null;
          }
          reject(new Error('Worker failed to load'));
          return;
        }
        // Error AFTER load — the worker crashed mid-session. Without this,
        // any in-flight evaluate()/queued promise would hang forever and wedge
        // GameReviewService's `await evaluate()`. Reject everything, surface an
        // error event, and attempt to reload the current engine version so the
        // app self-heals.
        this.handlePostLoadError(e);
      };

      this.worker.postMessage('uci');
    });
  }

  /**
   * Worker crashed AFTER it finished loading. Fail every outstanding promise
   * (so awaiting callers reject instead of hanging), tear down timers/search
   * state, publish an error event, and kick off a recover() reload of the
   * current version. Idempotent-safe: clears current/queued as it goes.
   */
  private handlePostLoadError(e: unknown): void {
    const message =
      e instanceof ErrorEvent && e.message
        ? `Worker crashed: ${e.message}`
        : 'Worker crashed';
    const err = new Error(message);

    // Reject the in-flight evaluate() and any queued request so awaiters wake.
    const cur = this.current;
    const q = this.queued;
    this.current = null;
    this.queued = null;
    this.isSearching = false;
    this.clearAnalysisTimer();
    try { cur?.reject?.(err); } catch (le) { console.error('[EngineManager] reject(current) failed', le); }
    try { q?.reject?.(err); } catch (le) { console.error('[EngineManager] reject(queued) failed', le); }

    // The worker is dead; tear it down so send() no-ops until recover() reloads.
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
    this.isReady = false;
    if (this.watchdog !== null) {
      window.clearInterval(this.watchdog);
      this.watchdog = null;
    }

    this.publishEvent({ type: 'error', message });

    // Self-heal: reload the same engine version. Failures here are reported via
    // a second error event rather than thrown (no caller to catch them).
    this.recover();
  }

  /**
   * Reload the current engine version after a crash. Returns the loadEngine()
   * promise so callers (or tests) can await it; on failure publishes an error
   * event so the UI can reflect the dead engine.
   */
  recover(): Promise<void> {
    const version = this.currentVersion;
    if (!version) {
      const err = new Error('Cannot recover: no engine version set');
      this.publishEvent({ type: 'error', message: err.message });
      return Promise.reject(err);
    }
    return this.loadEngine(version).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.publishEvent({ type: 'error', message: `Engine recovery failed: ${message}` });
      throw err;
    });
  }

  private startWatchdog(): void {
    if (this.watchdog !== null) return;
    this.watchdog = window.setInterval(() => {
      if (this.isSearching && Date.now() - this.lastInfoTime > this.currentGraceMs) {
        console.warn(`[EngineManager] watchdog: no info for ${this.currentGraceMs}ms, sending stop`);
        this.send('stop');
      }
    }, 3000);
  }

  private clearTimers(): void {
    if (this.watchdog !== null) {
      window.clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.clearAnalysisTimer();
  }

  private send(cmd: string): void {
    if (!this.worker || !this.isReady) return;
    this.worker.postMessage(cmd);
  }

  /** Send an `isready` barrier and record a FIFO marker so the matching
   *  `readyok` can be correlated back to its sender. If the worker isn't ready
   *  the command is dropped AND the marker is not enqueued, so a `session`
   *  waiter's resolve must be invoked by the caller's own timeout path. */
  private sendIsReady(entry: { tag: 'barrier' | 'session'; resolve?: () => void }): void {
    if (!this.worker || !this.isReady) return;
    this.readyokQueue.push(entry);
    this.worker.postMessage('isready');
  }

  private publishEvent(event: EngineEvent): void {
    for (const l of this.eventListeners) {
      try { l(event); } catch (e) { console.error('[EngineManager] event listener error', e); }
    }
    if (event.type === 'info') {
      for (const cb of this.infoListeners) {
        try { cb(event.line); } catch (e) { console.error('[EngineManager] info listener error', e); }
      }
    }
  }

  private handleMessage(data: string): void {
    if (data === 'readyok') {
      // FIFO-correlate this readyok to the oldest outstanding isready. Only a
      // marker tagged 'session' resolves beginSession(); barrier markers (from
      // setOptions/startSearch) are consumed silently. The generic ready event
      // is still published for any other subscribers.
      const marker = this.readyokQueue.shift();
      if (marker?.tag === 'session') {
        try { marker.resolve?.(); } catch (e) { console.error('[EngineManager] session ready resolve failed', e); }
      }
      this.publishEvent({ type: 'ready' });
      return;
    }
    if (data.startsWith('info ')) {
      this.lastInfoTime = Date.now();
      this.resetAnalysisTimer();
      const parsed = parseInfoLine(data);
      if (parsed && this.current && !this.current.aborted) {
        this.current.latestLines.set(parsed.multipv, parsed);
        this.publishEvent({ type: 'info', line: parsed });
      }
      // Orphan info lines from a superseded search are silently dropped.
      return;
    }
    if (data.startsWith('bestmove')) {
      const parts = data.split(/\s+/);
      const best = parts[1] ?? '';
      const cur = this.current;
      const wasAborted = cur?.aborted ?? false;

      this.current = null;
      this.isSearching = false;
      this.clearAnalysisTimer();

      if (!wasAborted) {
        const top = cur?.latestLines.get(1);
        const linesCopy = new Map<number, SearchInfoLine>(cur?.latestLines ?? []);
        const result: SearchResult = {
          bestMoveUci: best === '(none)' ? '' : best,
          cp: top?.cp ?? null,
          mate: top?.mate ?? null,
          pv: top?.pv ?? [],
          depth: top?.depth ?? 0,
          lines: linesCopy,
        };
        cur?.resolve?.(result);
        this.publishEvent({ type: 'bestmove', bestMoveUci: best === '(none)' ? '' : best });
      } else if (cur?.reject) {
        // Reject the abandoned evaluate() promise so it doesn't leak
        cur.reject(new Error('Aborted'));
      }

      // Now check queue
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        this.startSearch(q.req, q.resolve, q.reject);
      }
      return;
    }
    if (data.startsWith('error')) {
      // A UCI `error` line aborts the current search: the engine will NOT emit a
      // bestmove for it, so without terminating here the evaluate() promise and
      // the queue would stall. Treat it like an aborted bestmove — reject the
      // in-flight promise, clear search state, and start any queued request.
      const cur = this.current;
      this.current = null;
      this.isSearching = false;
      this.clearAnalysisTimer();
      this.publishEvent({ type: 'error', message: data });
      try { cur?.reject?.(new Error(data)); } catch (le) { console.error('[EngineManager] reject on error line failed', le); }
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        this.startSearch(q.req, q.resolve, q.reject);
      }
    }
  }

  private resetAnalysisTimer(): void {
    if (this.analysisTimer !== null) {
      window.clearTimeout(this.analysisTimer);
    }
    this.analysisTimer = window.setTimeout(() => {
      if (this.isSearching) {
        console.warn('[EngineManager] analysis timeout reached, sending stop');
        this.send('stop');
      }
    }, this.currentGraceMs);
  }

  private clearAnalysisTimer(): void {
    if (this.analysisTimer !== null) {
      window.clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
  }

  private startSearch(req: AnalyzeRequest, resolve?: (r: SearchResult) => void, reject?: (e: Error) => void): void {
    this.current = { req, resolve, reject, latestLines: new Map() };
    this.isSearching = true;
    this.currentGraceMs = infoGapGraceMs(req);
    this.lastInfoTime = Date.now();
    this.clearAnalysisTimer();
    this.resetAnalysisTimer();
    // Lichess-pattern UCI sequence:
    //   ucinewgame  → flush hash (skipped when caller manages its own session)
    //   setoption MultiPV  → BEFORE position so engine sees count for this search
    //   position    → actual position
    //   isready     → barrier guaranteeing options applied before search starts
    //   go depth N
    if (!req.skipNewGame) this.send('ucinewgame');
    this.send(`setoption name MultiPV value ${req.multiPV}`);
    if (req.uciMoves !== undefined) {
      const movePart = req.uciMoves.length > 0 ? ` moves ${req.uciMoves.join(' ')}` : '';
      this.send(`position startpos${movePart}`);
    } else if (req.fen) {
      this.send(`position fen ${req.fen}`);
    } else {
      this.send('position startpos');
    }
    this.sendIsReady({ tag: 'barrier' });
    // Search mode precedence: movetime (>0) → infinite → fixed depth.
    // `go infinite` runs until stop() (live analysis only; never review).
    if (req.moveTimeMs && req.moveTimeMs > 0) {
      this.send(`go movetime ${Math.round(req.moveTimeMs)}`);
    } else if (req.infinite) {
      this.send('go infinite');
    } else {
      this.send(`go depth ${req.depth}`);
    }
  }

  /** Live analysis. Supersedes any prior pending request. Fire-and-forget. */
  analyze(req: AnalyzeRequest): void {
    if (!this.isReady) return;
    if (this.isSearching) {
      // Abort the current request's promise (if any), enqueue new.
      if (this.current) {
        this.current.aborted = true;
        // Don't resolve/reject — caller of evaluate() should not see this case
        // unless we explicitly reject. For analyze() callers there's no promise.
        // But we MUST still wait for the bestmove from the engine.
      }
      // Drop any previously-queued request — this new one supersedes it.
      if (this.queued?.reject) this.queued.reject(new Error('Superseded'));
      this.queued = { req };
      this.send('stop');
      return;
    }
    this.startSearch(req);
  }

  /** One-shot evaluate. Returns Promise<SearchResult>. */
  evaluate(req: AnalyzeRequest): Promise<SearchResult> {
    return new Promise<SearchResult>((resolve, reject) => {
      if (!this.isReady) {
        reject(new Error('Engine not ready'));
        return;
      }
      if (this.isSearching) {
        if (this.current) this.current.aborted = true;
        if (this.queued?.reject) this.queued.reject(new Error('Superseded'));
        this.queued = { req, resolve, reject };
        this.send('stop');
        return;
      }
      this.startSearch(req, resolve, reject);
    });
  }

  /** Stop any current search WITHOUT queueing a new one. */
  stop(): void {
    if (!this.isReady) return;
    if (this.isSearching) {
      if (this.current) this.current.aborted = true;
      if (this.queued?.reject) this.queued.reject(new Error('Aborted'));
      this.queued = null;
      this.send('stop');
    }
  }

  /** Abort any in-flight evaluate() Promise WITHOUT waiting. */
  abort(): void {
    if (this.current) {
      this.current.aborted = true;
      this.current.reject?.(new Error('Aborted'));
      this.current.resolve = undefined;
      this.current.reject = undefined;
    }
    if (this.queued) {
      this.queued.reject?.(new Error('Aborted'));
      this.queued = null;
    }
    this.send('stop');
    this.clearAnalysisTimer();
  }

  terminate(): void {
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
    this.isReady = false;
    this.isSearching = false;
    this.current = null;
    this.queued = null;
    this.clearTimers();
  }

  getVersion(): EngineVersion | null { return this.currentVersion; }
  getIsReady(): boolean { return this.isReady; }
  getIsSearching(): boolean { return this.isSearching; }

  /** Begin a new analysis session (e.g., review). Sends one `ucinewgame` to
   * flush hash; subsequent `evaluate({ skipNewGame: true })` retain hash.
   * Returns a Promise that resolves when the engine confirms readyok. */
  beginSession(): Promise<void> {
    if (!this.isReady) return Promise.reject(new Error('Engine not ready'));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const marker = { tag: 'session' as const, resolve: () => {} };
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        // Drop our marker from the FIFO so a later readyok doesn't resolve a
        // dead waiter and desync the queue.
        const i = this.readyokQueue.indexOf(marker);
        if (i >= 0) this.readyokQueue.splice(i, 1);
        reject(new Error('beginSession readyok timeout (5s)'));
      }, 5000);
      marker.resolve = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };
      this.send('ucinewgame');
      // The 'session'-tagged marker is enqueued in FIFO order: it only resolves
      // on the readyok for THIS isready, never on a concurrent setOptions or
      // search barrier that happens to reply first.
      this.sendIsReady(marker);
    });
  }
}

// ─── UCI parsing helper ──────────────────────────────────────────

function parseInfoLine(message: string): SearchInfoLine | null {
  if (!message.startsWith('info ')) return null;
  const tokens = message.slice(5).split(/\s+/).filter(Boolean);
  let depth = 0;
  let multipv = 1;
  let cp: number | null = null;
  let mate: number | null = null;
  let pv: string[] = [];
  let nps: number | undefined;
  let hashfull: number | undefined;
  let wdl: WDL | undefined;
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    switch (tok) {
      case 'depth': depth = parseInt(tokens[++i], 10); i++; break;
      case 'multipv': multipv = parseInt(tokens[++i], 10); i++; break;
      case 'nps': nps = parseInt(tokens[++i], 10); i++; break;
      case 'hashfull': hashfull = parseInt(tokens[++i], 10); i++; break;
      case 'score': {
        const type = tokens[++i];
        const val = parseInt(tokens[++i], 10);
        if (type === 'cp') cp = val;
        else if (type === 'mate') mate = val;
        // Skip lowerbound/upperbound markers
        if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') i++;
        i++;
        break;
      }
      case 'wdl': {
        // `wdl W D L` — per-mille win/draw/loss (UCI_ShowWDL). Mover-relative.
        const w = parseInt(tokens[++i], 10);
        const d = parseInt(tokens[++i], 10);
        const l = parseInt(tokens[++i], 10);
        if (Number.isFinite(w) && Number.isFinite(d) && Number.isFinite(l)) {
          wdl = { win: w, draw: d, loss: l };
        }
        i++;
        break;
      }
      case 'pv': pv = tokens.slice(i + 1); i = tokens.length; break;
      default: i++;
    }
  }
  return { multipv, cp, mate, depth, pv, nps, hashfull, wdl };
}
