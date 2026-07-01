// src/services/GameReviewService.ts
//
// Post-game review pipeline. For each ply N:
//
//   1. Look up the position at ply N in this order:
//        a) MongoDB position cache (cross-user federated)
//        b) Syzygy tablebase   — exact game-theoretic value for ≤ 7 pieces
//        c) Stockfish WASM     — local browser worker at requested depth
//   2. Convert (cp, mate) → Win% via the Expected Points sigmoid (with mate
//      bypass to 1.0 / 0.0 for forced wins).
//   3. Classify the played move using ΔWin = winBefore − winAfter and the
//      chess.com-compatible thresholds + Brilliant/Great/Miss overrides.
//   4. Persist newly-computed evaluations back to the position cache so the
//      next review of the same position is free.
//
// Cross-ply reuse: the eval AFTER move N is the eval BEFORE move N+1. We
// search each position ONCE and cache by ply index → ~2× speedup over the
// naïve "search before and after each move" pattern.

import { Chess } from 'chess.js';
import { EngineManager, type SearchInfoLine } from './EngineManager';
import type { IndexedGame } from './GameEngineAdapter';
import type { MoveReview, GameReviewResult, MoveClassification } from '../types/review';
import {
  accuracyToGameRating,
  classifyMove,
  cpAndMateToWin,
  computePhaseBoundaries,
  engineScoreToCentipawns,
  isTruePieceSacrifice,
  gameRatingConfidence,
  phaseSummary,
  playerAccuracy,
  MATE_SCORE_CP,
} from '../utils/reviewUtils';
import { lookupTablebase, tablebaseToScore, pieceCount } from './tablebase';
import { fetchCachedEval, pushCachedEval } from './positionCache';

export interface ReviewProgress {
  currentPly: number;
  totalPlies: number;
  percent: number;
  phase: 'analyzing' | 'complete' | 'idle';
}

interface PlySearch {
  /** Score from MOVING-player's perspective (positive = mover winning). */
  cp: number | null;
  mate: number | null;
  pv: string[];
  /** Win% (0..1) from MOVING-player's perspective. */
  win: number;
  /** Top-2 win%s for singular-choice detection. */
  topMoveWin: number;
  secondMoveWin: number | null;
  bestMoveUci: string;
  source: 'cache' | 'tablebase' | 'engine';
  /** Tablebase per-move map (uci → category+dtm), only set when source='tablebase'. */
  tbMoves?: Map<string, { category: string; dtm: number | null }>;
  /** Best-move tablebase info (for slow-win delta comparison). */
  tbBest?: { category: string; dtm: number | null };
  /**
   * REV-4: the engine returned no usable data even after a retry, on a
   * non-terminal position. We do NOT fake a 0-cp draw (that masks failures as
   * "Good"/"Best" moves). Instead the ply is flagged unscored so it is excluded
   * from accuracy / CPL / complexity / counts. `win`/`cp`/`mate` carry neutral
   * placeholders purely so display code doesn't NaN out.
   */
  unscored?: boolean;
}

function startingColorFromFen(fen: string): 'w' | 'b' {
  const stm = fen.split(' ')[1];
  return stm === 'b' ? 'b' : 'w';
}

function moverFromFen(fen: string): 'w' | 'b' {
  return startingColorFromFen(fen);
}

function ratingFromMetadata(game: IndexedGame, color: 'w' | 'b'): number | null {
  const key = color === 'w' ? 'whiteElo' : 'blackElo';
  const value = game.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isCheckmateFen(fen: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.isCheckmate();
  } catch {
    return false;
  }
}

function isTerminalDrawFen(fen: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.isStalemate() || chess.isInsufficientMaterial() || chess.isDraw();
  } catch {
    return false;
  }
}

function terminalCheck(fen: string): { isCheckmate: boolean; isDraw: boolean } {
  try {
    const chess = new Chess(fen);
    return { isCheckmate: chess.isCheckmate(), isDraw: chess.isStalemate() || chess.isInsufficientMaterial() || chess.isDraw() };
  } catch {
    return { isCheckmate: false, isDraw: false };
  }
}

export class GameReviewService {
  private engine: EngineManager;
  private onProgress: (p: ReviewProgress) => void;
  private isRunning = false;
  private cancelled = false;

  constructor(engine: EngineManager, onProgress: (p: ReviewProgress) => void) {
    this.engine = engine;
    this.onProgress = onProgress;
  }

  cancel(): void {
    this.cancelled = true;
    try { this.engine.abort(); } catch { /* ignore cancellation races */ }
  }

  isRunningReview(): boolean {
    return this.isRunning;
  }

  async reviewGame(
    game: IndexedGame,
    depth = 18,
    openingBookFens: Set<string> = new Set(),
  ): Promise<GameReviewResult> {
    if (this.isRunning) throw new Error('Review already in progress');
    this.isRunning = true;
    this.cancelled = false;

    try { this.engine.abort(); } catch { /* best-effort drain */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 60));

    // One `ucinewgame` for the whole review session so the transposition hash
    // survives across plies. Per-ply searches set skipNewGame: true.
    await this.engine.beginSession();

    const moveReviews: MoveReview[] = [];
    const { moveUciList, moveSanList, fenPositions, plyCount } = game;
    const startingColor = startingColorFromFen(fenPositions[0] ?? '');
    const engineVersion = (this.engine.getVersion() ?? 'sf18-lite') as
      'sf18-lite' | 'sf17-lite' | 'sf16-lite';

    this.onProgress({ currentPly: 0, totalPlies: plyCount, percent: 0, phase: 'analyzing' });

    // Search cache keyed by ply index. searchAtPly[i] = analysis at fenPositions[i].
    const searchAtPly: PlySearch[] = [];

    const evalAtPly = async (plyIdx: number): Promise<PlySearch> => {
      if (searchAtPly[plyIdx]) return searchAtPly[plyIdx];

      const fen = fenPositions[plyIdx];
      const mover = moverFromFen(fen);

      // ── Step 1: Syzygy tablebase for ≤ 7-man endgames ────────────────────
      if (pieceCount(fen) <= 7) {
        const tb = await lookupTablebase(fen);
        if (tb) {
          const score = tablebaseToScore(tb);
          const win = cpAndMateToWin(score.cp, score.mate);
          // Best move from tablebase: lowest dtz/dtm winning move (when winning),
          // or any drawing move (when drawing). Lichess returns moves sorted.
          const best = tb.moves[0];
          const second = tb.moves[1];
          const bestWin = best ? cpAndMateToWin(tbMoveScore(best.category, best.dtm).cp, tbMoveScore(best.category, best.dtm).mate) : win;
          const secondWin = second
            ? cpAndMateToWin(tbMoveScore(second.category, second.dtm).cp, tbMoveScore(second.category, second.dtm).mate)
            : null;
          const tbMoves = new Map<string, { category: string; dtm: number | null }>();
          for (const m of tb.moves) {
            tbMoves.set(m.uci, { category: m.category, dtm: m.dtm });
          }
          const entry: PlySearch = {
            cp: score.cp,
            mate: score.mate,
            pv: best ? [best.uci] : [],
            win,
            topMoveWin: bestWin,
            secondMoveWin: secondWin,
            bestMoveUci: best?.uci ?? '',
            source: 'tablebase',
            tbMoves,
            tbBest: best ? { category: best.category, dtm: best.dtm } : undefined,
          };
          searchAtPly[plyIdx] = entry;
          return entry;
        }
      }

      // ── Step 2: MongoDB position cache ───────────────────────────────────
      const cached = await fetchCachedEval(fen, engineVersion, depth);
      if (cached && cached.depth >= depth) {
        const cp = cached.evaluation?.cp ?? null;
        const mate = cached.evaluation?.mate ?? null;
        // Cached eval is stored White-relative on the API contract — flip if
        // moving player is black so the in-memory series stays mover-relative.
        const moverCp = mover === 'w' ? cp : (cp !== null ? -cp : null);
        const moverMate = mover === 'w' ? mate : (mate !== null ? -mate : null);
        const win = cpAndMateToWin(moverCp, moverMate);

        const cachedLines = (cached.lines ?? []).slice().sort((a, b) => (a.multipv ?? 99) - (b.multipv ?? 99));
        const topLine = cachedLines[0];
        const secondLine = cachedLines[1];
        const topWin = topLine ? cachedLineToMoverWin(topLine, mover) : win;
        const secondWin = secondLine ? cachedLineToMoverWin(secondLine, mover) : null;
        const bestUci = topLine?.uciMoves?.[0] ?? topLine?.pv?.[0] ?? '';

        const entry: PlySearch = {
          cp: moverCp,
          mate: moverMate,
          pv: topLine?.uciMoves ?? topLine?.pv ?? [],
          win,
          topMoveWin: topWin,
          secondMoveWin: secondWin,
          bestMoveUci: bestUci,
          source: 'cache',
        };
        searchAtPly[plyIdx] = entry;
        return entry;
      }

      // ── Step 3: Stockfish (browser WASM worker) ──────────────────────────
      const moves = moveUciList.slice(0, plyIdx);
      const result = await this.engine.evaluate({
        uciMoves: moves,
        depth,
        multiPV: 2,
        skipNewGame: true,
      });

      const top = result.lines.get(1);
      const second = result.lines.get(2);

      // Validate engine produced usable data. If both cp and mate are null,
      // the engine likely returned no info lines, possibly due to a timeout
      // or terminal position. Retry once with a fresh search.
      let engineCp = top?.cp ?? null;
      let engineMate = top?.mate ?? null;
      // REV-4: did BOTH attempts fail to produce any usable score on a
      // non-terminal position? If so we must NOT fabricate a 0-cp draw.
      let engineFailedUnscored = false;
      if (engineCp === null && engineMate === null && !isCheckmateFen(fen) && !isTerminalDrawFen(fen)) {
        const retry = await this.engine.evaluate({
          uciMoves: moves,
          depth: Math.max(12, depth - 4),
          multiPV: 2,
          skipNewGame: false,
        });
        const retryTop = retry.lines.get(1);
        engineCp = retryTop?.cp ?? null;
        engineMate = retryTop?.mate ?? null;
        if (engineCp === null && engineMate === null) {
          // Both the original search AND the retry produced nothing. Previously
          // this set engineCp = 0, which made the position look like a dead
          // draw and let the played move score as a "Good"/"Best" move. Flag
          // the ply unscored instead so accuracy/CPL/complexity/counts skip it.
          engineFailedUnscored = true;
        }
      }

      // Use retry data if original engine call returned no usable data.
      const hasOriginalData = top !== undefined && (top.cp !== null || top.mate !== null);
      // Whether we ended up with ANY usable score (original or retry).
      const hasUsableScore = engineCp !== null || engineMate !== null;

      // Neutral placeholder Win% for display only when the ply is unscored.
      const topWin = hasUsableScore ? cpAndMateToWin(engineCp, engineMate) : 0.5;
      let secondWin: number | null = null;
      let effectivePv: string[] = [];
      let effectiveBestMove = '';

      if (hasOriginalData) {
        secondWin = second ? cpAndMateToWin(second.cp, second.mate) : null;
        effectivePv = top.pv ?? result.pv ?? [];
        effectiveBestMove = top.pv?.[0] ?? result.bestMoveUci ?? '';
      } else {
        // Original returned no valid data (retry may or may not have).
        effectivePv = [];
        effectiveBestMove = '';
      }

      const entry: PlySearch = {
        cp: engineFailedUnscored ? null : engineCp,
        mate: engineFailedUnscored ? null : engineMate,
        pv: effectivePv,
        win: topWin,
        topMoveWin: topWin,
        secondMoveWin: secondWin,
        bestMoveUci: effectiveBestMove,
        source: 'engine',
        unscored: engineFailedUnscored || undefined,
      };
      searchAtPly[plyIdx] = entry;

      // Push back to position cache for future review runs. Only push valid results.
      if (hasOriginalData) {
        void pushFromSearchResult(fen, engineVersion, depth, mover, top, second);
      }
      return entry;
    };

    // REV-4: ply indices whose eval (before or non-terminal after) the engine
    // could not produce. These are excluded from every aggregate (accuracy,
    // CPL, complexity, counts, phase accuracy) so a silent engine failure can
    // never be scored as a drawn/"Good" move.
    const unscoredPlies = new Set<number>();

    try {
      await evalAtPly(0);

      for (let ply = 0; ply < plyCount; ply++) {
        if (this.cancelled) throw new Error('Cancelled');

        const fenBefore = fenPositions[ply];
        const fenAfter = fenPositions[ply + 1];
        const isBookMove = openingBookFens.has(fenBefore);

        const before = await evalAtPly(ply);
        if (this.cancelled) throw new Error('Cancelled');

        const after = await evalAtPly(ply + 1);
        if (this.cancelled) throw new Error('Cancelled');

        const winBefore = before.win;
        let winAfter: number;
        const tcAfter = fenAfter ? terminalCheck(fenAfter) : { isCheckmate: false, isDraw: false };
        const isCheckmate = tcAfter.isCheckmate;
        const isDraw = tcAfter.isDraw;
        if (isCheckmate) {
          winAfter = 1.0;
        } else if (isDraw) {
          winAfter = 0.5;
        } else {
          winAfter = 1 - after.win;
        }

        // REV-4: this ply is unscored if the "before" position has no engine
        // data, or the non-terminal "after" position has none (a terminal
        // after-position carries an authoritative win/draw, so its unscored
        // flag is irrelevant). Book moves are already excluded from scoring.
        const isPlyUnscored =
          !isBookMove &&
          (before.unscored === true || (!isCheckmate && !isDraw && after.unscored === true));
        if (isPlyUnscored) unscoredPlies.add(ply);

        const normalizedMateBefore = before.mate;
        let normalizedMateAfter: number | null;
        let evalAfterCp: number | null;
        if (isCheckmate) {
          normalizedMateAfter = 1;
          evalAfterCp = null;
        } else if (isDraw) {
          normalizedMateAfter = null;
          evalAfterCp = 0;
        } else {
          normalizedMateAfter = after.mate !== null ? -after.mate : null;
          evalAfterCp = after.cp !== null ? -after.cp : null;
        }
        const evalBefore = engineScoreToCentipawns(before.cp, normalizedMateBefore);
        const evalAfter = engineScoreToCentipawns(evalAfterCp, normalizedMateAfter);
        const cpl = Math.max(0, Math.min(1500, evalBefore - evalAfter));

        const playedUci = moveUciList[ply];
        // On terminal positions, the engine returns bestmove (none) → empty
        // bestMoveUci. Treat the played move as the canonical "best" answer for
        // display + classification so empty-string == empty-string false-positives
        // don't taint isBestMove.
        const rawBestMoveUci = before.bestMoveUci;
        const bestMoveUci = (isCheckmate || isDraw)
          ? (rawBestMoveUci || playedUci)
          : rawBestMoveUci;

        // Singular-choice test: top-1 Win% is > 0.05 higher than top-2 (REV-3).
        // This is the "no other move within ~0.05 ΔWin" criterion for Great.
        // A null second move means we DON'T have a second line to compare
        // against (single-line/forced search, or only one legal move). Treating
        // that as "singular" fired spurious "Great" on forced positions, so
        // require ≥2 evaluated lines: null ⇒ NOT singular.
        const isSingularChoice =
          before.secondMoveWin !== null &&
          before.topMoveWin - before.secondMoveWin > 0.05;

        // True piece-sacrifice detector based on aggregate material change.
        const isMaterialSacrifice =
          !!fenAfter && isTruePieceSacrifice(fenBefore, fenAfter);

        // Exact best-move check — the near_best threshold in classifyMove
        // already handles engine-equivalent tolerance (0.5% ΔWin).
        const isBestMove = bestMoveUci === playedUci;
        const deltaWin = Math.max(0, winBefore - winAfter);
        const playerRating = ratingFromMetadata(game, moverFromFen(fenBefore));

        let classification = classifyMove({
          winBefore,
          winAfter,
          isBookMove,
          isBestMove,
          isSingularChoice,
          isMaterialSacrifice,
          deltaWin,
          mateBefore: normalizedMateBefore,
          mateAfter: normalizedMateAfter,
          playerRating,
        });

        // C6: Tablebase slow-win — when both played and best are 'win' category
        // but the played move is much slower (or worse, drops to draw/loss),
        // upgrade the classification severity. ΔWin alone won't catch this
        // because both are clamped to 1.0.
        if (before.source === 'tablebase' && before.tbMoves && before.tbBest && !isBookMove) {
          const playedTb = before.tbMoves.get(playedUci);
          const bestTb = before.tbBest;
          if (playedTb) {
            const wasWin = bestTb.category === 'win';
            if (wasWin) {
              if (playedTb.category === 'loss') {
                classification = 'blunder';
              } else if (playedTb.category === 'draw' || playedTb.category === 'cursed-win' || playedTb.category === 'blessed-loss') {
                classification = 'miss';
              } else if (
                playedTb.category === 'win' &&
                playedTb.dtm !== null &&
                bestTb.dtm !== null &&
                Math.abs(playedTb.dtm) > Math.abs(bestTb.dtm) + 10
              ) {
                // Same winning category, but ≥10 plies slower → mistake.
                if (classification === 'best' || classification === 'excellent' || classification === 'good') {
                  classification = 'inaccuracy';
                }
                if (Math.abs(playedTb.dtm) > Math.abs(bestTb.dtm) + 25) {
                  classification = 'mistake';
                }
              }
            }
          }
        }

        const bestMoveSan = this.bestMoveToSan(fenBefore, bestMoveUci);
        const reason = buildClassificationReason(
          classification,
          playedUci,
          bestMoveUci,
          winBefore,
          winAfter,
          normalizedMateBefore,
          normalizedMateAfter,
          isMaterialSacrifice,
          before.source,
        );

        moveReviews.push({
          plyIndex: ply,
          san: moveSanList[ply],
          uci: playedUci,
          classification,
          evalBefore,
          evalAfter,
          cpl,
          bestMoveUci,
          bestMoveSan,
          bestMoveEval: evalBefore,
          isBookMove,
          isBrilliant: classification === 'brilliant',
          mateBefore: normalizedMateBefore,
          mateAfter: normalizedMateAfter,
          pvLine: before.pv.slice(0, 5),
          complexity:
            before.secondMoveWin === null
              ? 0
              : Math.max(0, before.topMoveWin - before.secondMoveWin),
          reason,
        });

        this.onProgress({
          currentPly: ply + 1,
          totalPlies: plyCount,
          percent: Math.round(((ply + 1) / plyCount) * 100),
          phase: 'analyzing',
        });
      }
    } catch (err) {
      this.isRunning = false;
      this.onProgress({ currentPly: 0, totalPlies: 0, percent: 0, phase: 'idle' });
      throw err;
    }

    const moverIsWhite = (i: number) => (startingColor === 'w' ? i % 2 === 0 : i % 2 !== 0);
    const whiteMoves = moveReviews.filter((_, i) => moverIsWhite(i));
    const blackMoves = moveReviews.filter((_, i) => !moverIsWhite(i));

    const { openingEndsAtPly, middlegameEndsAtPly } = computePhaseBoundaries(game.fenPositions);

    const buildPlayerReview = (moves: MoveReview[], color: 'white' | 'black') => {
      // REV-4: drop plies the engine couldn't evaluate from every aggregate.
      // When no ply is unscored (the normal case) `scored` === `moves`, so the
      // output is byte-identical to the pre-REV-4 behavior.
      const scored = moves.filter((m) => !unscoredPlies.has(m.plyIndex));
      const counts = Object.fromEntries(
        ['brilliant', 'great', 'book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder']
          .map((k) => [k, scored.filter((m) => m.classification === k).length]),
      ) as Record<MoveClassification, number>;

      const acc = playerAccuracy(moveReviews, color, startingColor, unscoredPlies);
      const ratedMoves = scored.filter((m) => !m.isBookMove);
      const avgCpl = ratedMoves.length > 0
        ? Math.round(ratedMoves.reduce((sum, m) => sum + Math.min(m.cpl, 1500), 0) / ratedMoves.length)
        : 0;
      const avgComplexity = ratedMoves.length > 0
        ? ratedMoves.reduce((sum, m) => sum + (m.complexity ?? 0), 0) / ratedMoves.length
        : 0;
      const blunderCount = counts.blunder;
      const mistakeCount = counts.mistake;
      const inaccuracyCount = counts.inaccuracy;
      const missCount = counts.miss;

      const openingMoves = scored.filter((m) => m.plyIndex < openingEndsAtPly);
      const middlegameMoves = scored.filter((m) => m.plyIndex >= openingEndsAtPly && m.plyIndex < middlegameEndsAtPly);
      const endgameMoves = scored.filter((m) => m.plyIndex >= middlegameEndsAtPly);

      const openingSummary = phaseSummary(openingMoves);
      const middlegameSummary = phaseSummary(middlegameMoves);
      const endgameSummary = phaseSummary(endgameMoves);

      return {
        color,
        accuracy: acc,
        counts,
        gameRating: accuracyToGameRating(
          acc,
          avgCpl,
          blunderCount,
          mistakeCount,
          ratedMoves.length,
          inaccuracyCount,
          missCount,
          avgComplexity,
        ),
        gameRatingConfidence: gameRatingConfidence(ratedMoves.length),
        phaseReviews: [
          { label: 'Opening' as const, ...openingSummary },
          { label: 'Middlegame' as const, ...middlegameSummary },
          { label: 'Endgame' as const, ...endgameSummary },
        ],
      };
    };

    const result: GameReviewResult = {
      moveReviews,
      white: buildPlayerReview(whiteMoves, 'white'),
      black: buildPlayerReview(blackMoves, 'black'),
      reviewDepth: depth,
      engineVersion: this.engine.getVersion() ?? 'unknown',
      reviewedAt: new Date().toISOString(),
      openingName: (game.metadata?.opening as string) ?? null,
      ecoCode: (game.metadata?.ecoCode as string) ?? null,
      // Pin the result to the exact line it was computed on, so playback /
      // glyphs / arrows follow the reviewed line instead of the mainline.
      reviewedNodeIds: game.reviewedNodeIds,
      reviewedPathKey: game.reviewedNodeIds.join('/'),
      reviewedLineUciKey: moveUciList.join(' '),
    };

    this.isRunning = false;
    this.onProgress({ currentPly: plyCount, totalPlies: plyCount, percent: 100, phase: 'complete' });
    return result;
  }

  private bestMoveToSan(fen: string, bestMoveUci: string): string {
    if (!bestMoveUci || bestMoveUci.length < 4) return bestMoveUci;
    try {
      const chess = new Chess(fen);
      const promotion = bestMoveUci.length > 4 ? bestMoveUci[4] : undefined;
      const move = chess.move({
        from: bestMoveUci.slice(0, 2) as any,
        to: bestMoveUci.slice(2, 4) as any,
        promotion: promotion as any,
      });
      return move?.san ?? bestMoveUci;
    } catch {
      return bestMoveUci;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function tbMoveScore(category: string, dtm: number | null): { cp: number | null; mate: number | null } {
  const dtmAbs = dtm !== null ? Math.max(1, Math.abs(dtm)) : 50;
  switch (category) {
    case 'win': return { cp: null, mate: dtmAbs };
    case 'loss': return { cp: null, mate: -dtmAbs };
    default: return { cp: 0, mate: null };
  }
}

function cachedLineToMoverWin(line: {
  scoreType?: 'cp' | 'mate';
  scoreValue?: number;
  eval?: { type: 'cp' | 'mate'; value: number };
}, mover: 'w' | 'b'): number {
  const type = line.scoreType ?? line.eval?.type ?? 'cp';
  const value = line.scoreValue ?? line.eval?.value ?? 0;
  const cp = type === 'cp' ? value : null;
  const mate = type === 'mate' ? value : null;
  // Cached lines stored White-relative; flip if mover is black.
  const moverCp = mover === 'w' ? cp : (cp !== null ? -cp : null);
  const moverMate = mover === 'w' ? mate : (mate !== null ? -mate : null);
  return cpAndMateToWin(moverCp, moverMate);
}

async function pushFromSearchResult(
  fen: string,
  engineVersion: 'sf18-lite' | 'sf17-lite' | 'sf16-lite',
  depth: number,
  mover: 'w' | 'b',
  top: SearchInfoLine | undefined,
  second: SearchInfoLine | undefined,
): Promise<void> {
  if (!top || (top.cp === null && top.mate === null)) return;

  // Store evals White-relative per Position model schema convention.
  const toWhiteRelative = (cp: number | null, mate: number | null) => {
    if (mover === 'w') return { cp, mate };
    return { cp: cp !== null ? -cp : null, mate: mate !== null ? -mate : null };
  };

  const topWhite = toWhiteRelative(top.cp, top.mate);
  const evalType: 'cp' | 'mate' = topWhite.mate !== null ? 'mate' : 'cp';
  const evalValue = evalType === 'mate' ? (topWhite.mate as number) : (topWhite.cp ?? 0);

  const lines: Array<{ multipv: number; eval: { type: 'cp' | 'mate'; value: number }; pv: string[] }> = [];
  for (const line of [top, second]) {
    if (!line) continue;
    const w = toWhiteRelative(line.cp, line.mate);
    const t: 'cp' | 'mate' = w.mate !== null ? 'mate' : 'cp';
    const v = t === 'mate' ? (w.mate as number) : (w.cp ?? 0);
    lines.push({ multipv: line.multipv, eval: { type: t, value: v }, pv: line.pv });
  }

  await pushCachedEval({
    fen,
    engineVersion,
    depth,
    turn: mover,
    evaluation: { type: evalType, value: evalValue },
    lines,
  });
}

function buildClassificationReason(
  classification: MoveClassification,
  playedUci: string,
  bestMoveUci: string,
  winBefore: number,
  winAfter: number,
  mateBefore: number | null,
  mateAfter: number | null,
  isMaterialSacrifice: boolean,
  source: 'cache' | 'tablebase' | 'engine',
): string {
  const deltaWin = (winBefore - winAfter) * 100;
  const wb = Math.round(winBefore * 1000) / 10;
  const wa = Math.round(winAfter * 1000) / 10;
  const sourceTag = source === 'tablebase' ? ' (tablebase)' : source === 'cache' ? ' (cached)' : '';

  switch (classification) {
    case 'book':
      return 'Opening theory move';
    case 'brilliant':
      return isMaterialSacrifice
        ? `Brilliant sacrifice — material given up, Win% holds at ${wa}%`
        : `Brilliant — ${wa}% Win${sourceTag}`;
    case 'great':
      return `Only move that rescues the position (${wb}% → ${wa}% Win)`;
    case 'best':
      return bestMoveUci === playedUci
        ? `Engine top move${sourceTag}`
        : `Engine-equivalent (ΔWin ${deltaWin.toFixed(2)}%)${sourceTag}`;
    case 'excellent':
      return `Very close to optimal (ΔWin ${deltaWin.toFixed(1)}%)`;
    case 'good':
      return `Solid move (ΔWin ${deltaWin.toFixed(1)}%)`;
    case 'inaccuracy':
      return `Inaccuracy (ΔWin ${deltaWin.toFixed(1)}%). Best: ${bestMoveUci}`;
    case 'mistake':
      if (mateBefore !== null && mateBefore > 0) return `Missed forced mate in ${Math.abs(mateBefore)}. Best: ${bestMoveUci}`;
      return `Mistake (ΔWin ${deltaWin.toFixed(1)}%). Best: ${bestMoveUci}`;
    case 'miss':
      return `Missed winning advantage (${wb}% → ${wa}% Win). Best: ${bestMoveUci}`;
    case 'blunder':
      if (mateAfter !== null && mateAfter < 0) return `Allowed forced mate in ${Math.abs(mateAfter)}`;
      if (mateBefore !== null && mateBefore > 0) return `Lost forced mate in ${Math.abs(mateBefore)}. Best: ${bestMoveUci}`;
      return `Blunder (ΔWin ${deltaWin.toFixed(1)}%). Best: ${bestMoveUci}`;
    default:
      return `${classification} (ΔWin ${deltaWin.toFixed(1)}%)`;
  }
}
