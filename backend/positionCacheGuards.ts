/**
 * GrandForge — position-cache write guards.
 *
 * `POST /api/positions/cache` accepts writes from **anonymous** visitors, which
 * is the only way the shared eval cache can ever fill up: sign-up is optional by
 * design, so gating writes on an account meant almost nobody wrote and the cache
 * stayed permanently empty.
 *
 * That trade has two failure modes to engineer against, and they are not equally
 * bad:
 *
 * - **Poisoning** is the serious one. A wrong eval is silent, cross-user, and —
 *   before the TTL landed — permanent. Nobody notices a review that quietly
 *   scored a good move as a blunder.
 * - **Storage exhaustion** is the cheap one. Atlas M0 is 512 MB; the 60-day LRU
 *   on `Position.computedAt` plus a tight per-IP budget bound it.
 *
 * Everything in this file is pure (no DB, no Express) so the decisions can be
 * unit-tested directly. The route applies them; it does not make them.
 *
 * Guard numbering follows `docs/superpowers/audits/backend-audit.md` §3.
 */
import { createHmac } from 'crypto';
import { Chess } from 'chess.js';

/** Guard 7 — shallow evals are worthless to a shared cache and are what a spam
 *  script sends. An honest reviewer runs well past this. */
export const MIN_CACHE_DEPTH = 12;

/** Guard 4 — score bounds. Beyond ±100 pawns the number is noise, and Stockfish
 *  never reports a mate distance anywhere near 100. */
export const MAX_ABS_CP = 10_000;
export const MAX_ABS_MATE = 100;

/** Guard 9 — how many *independent* submissions must agree before readers are
 *  served an entry. Two is the whole difference between "poisoning costs one
 *  POST" and "poisoning costs sustained coordinated effort". */
export const TRUST_THRESHOLD = 2;

/** Guard 9 — how close two centipawn evals must be to count as agreement. */
export const AGREE_CP = 30;

/**
 * Above this magnitude two same-signed evals are treated as agreeing regardless
 * of the gap: +12.0 and +18.0 are the same fact ("winning"), and holding them to
 * ±30 cp would leave totally-won positions churning the challenger slot forever.
 */
export const DECISIVE_CP = 1000;

/** Contributors kept per candidate — enough to dedupe self-confirmation, few
 *  enough that the array can't grow into a storage problem. */
export const MAX_CONTRIBUTORS = 8;

/* ── Guard 1: the FEN must be the normalized cache key ──────────────────── */

/**
 * The client keys the cache on a transposition-stable 4-field FEN (placement,
 * side-to-move, castling, en-passant) — see `normalizeFenForCache` on the
 * frontend. A 6-field write would store a row that every reader's query can
 * never match, so it is rejected rather than silently orphaned.
 */
export function isNormalizedCacheFen(fen: string): boolean {
  return fen.trim().split(/\s+/).length === 4;
}

/**
 * chess.js needs a full 6-field FEN to construct. Append placeholder clocks for
 * validation only — the normalized form is what gets stored.
 */
export function toValidatableFen(fen: string): string {
  const trimmed = fen.trim();
  return trimmed.split(/\s+/).length === 4 ? `${trimmed} 0 1` : trimmed;
}

/** Guard 2 — side to move comes from the FEN. A client-supplied `turn` is a
 *  stored lie waiting for the first reader that trusts it. */
export function turnFromFen(fen: string): 'w' | 'b' {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
}

/* ── Guard 4: score bounds ──────────────────────────────────────────────── */

export interface ScoreClaim {
  type: 'cp' | 'mate';
  value: number;
}

/** `null` when the score is acceptable, otherwise the reason to 400 with. */
export function scoreRejection(score: ScoreClaim): string | null {
  if (!Number.isInteger(score.value)) return 'Score must be an integer';
  if (score.type === 'cp') {
    if (Math.abs(score.value) > MAX_ABS_CP) return `Centipawn score out of range (max ±${MAX_ABS_CP})`;
    return null;
  }
  const mag = Math.abs(score.value);
  // Mate 0 is meaningless as a claim — a mated position has no eval to cache,
  // and "mate in 0" is what an empty/zeroed payload looks like.
  if (mag < 1 || mag > MAX_ABS_MATE) return `Mate distance out of range (1..${MAX_ABS_MATE})`;
  return null;
}

/* ── Guards 3 + 5: the payload must be self-consistent ──────────────────── */

export interface LineClaim {
  multipv: number;
  eval: ScoreClaim;
  pv: string[];
}

/**
 * Verify the lines against the actual position. This is the guard that defeats
 * the cheapest poison — without it a writer can claim "the best move here is a
 * blunder" and every future reader of that position believes it.
 *
 * What is checked:
 *   - `multipv` labels are contiguous from 1 (guard 5), so `lines[0]` really is
 *     the principal variation and a reader sorting by `multipv` gets what it
 *     expects.
 *   - `lines[0].eval` equals the top-level `evaluation` — the honest client
 *     derives both from the same search line, so a mismatch is fabrication.
 *   - every move of every PV is legal from the position it is played in. The
 *     whole line is replayed, not just its first move: the tail is what gets
 *     displayed as "best line", so a legal-head/garbage-tail payload would still
 *     show a reader nonsense. Bounded at 5 lines × 64 plies, so this is a few
 *     hundred `chess.js` moves — sub-10 ms even on a 0.1 vCPU instance.
 *   - PV first moves are distinct across lines, which is what MultiPV means.
 *
 * Returns `null` when the payload is consistent, otherwise the rejection reason.
 */
export function linesRejection(
  fen: string,
  evaluation: ScoreClaim,
  lines: LineClaim[]
): string | null {
  if (lines.length === 0) return 'At least one line is required';

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].multipv !== i + 1) return 'multipv labels must be contiguous from 1';
  }

  const top = lines[0];
  if (top.eval.type !== evaluation.type || top.eval.value !== evaluation.value) {
    return 'Top line score must match the position evaluation';
  }

  const validatable = toValidatableFen(fen);
  const firstMoves = new Set<string>();

  for (const line of lines) {
    if (line.pv.length === 0) return 'Each line needs at least one move';
    if (firstMoves.has(line.pv[0])) return 'Lines must start with distinct moves';
    firstMoves.add(line.pv[0]);

    let board: Chess;
    try {
      board = new Chess(validatable);
    } catch {
      return 'Invalid FEN';
    }

    for (const uci of line.pv) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      try {
        // chess.js throws on an illegal move rather than returning null.
        board.move({ from, to, ...(promotion ? { promotion } : {}) });
      } catch {
        return `Illegal move in line ${line.multipv}: ${uci}`;
      }
    }
  }

  return null;
}

/* ── Guard 11: attribute a write without storing PII ────────────────────── */

/**
 * A stable, non-reversible identifier for whoever submitted a write, so a bad
 * batch is findable and purgeable and so one writer cannot confirm their own
 * entry twice.
 *
 * A logged-in user is keyed by id; everyone else by a salted hash of their IP.
 * The salt is `IP_HASH_SALT` when set, falling back to `JWT_SECRET` (already
 * required at boot) so this needs no new environment variable — the hash only
 * has to be unguessable, not independently rotatable. With no secret available
 * at all we return `null`: an unsalted IP hash is reversible by brute force over
 * the whole IPv4 space, which would turn an abuse control into a PII store.
 */
export function contributorKey(userId: string | undefined, ip: string | undefined): string | null {
  if (userId) return `u:${userId}`;
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT || process.env.JWT_SECRET;
  if (!salt) return null;
  const digest = createHmac('sha256', salt).update(ip).digest('base64url');
  return `a:${digest.slice(0, 16)}`;
}

/* ── Guard 9/10: reconcile a write against what is already stored ───────── */

export interface StoredEval {
  cp: number | null;
  mate: number | null;
}

/**
 * Do two evaluations describe the same position assessment?
 *
 * Both are White-relative (the `Position` model's convention). A mate claim and
 * a centipawn claim never agree — a deeper search finding a forced mate is a
 * genuine disagreement, and that is exactly what the challenger slot is for.
 */
export function evalsAgree(a: StoredEval, b: StoredEval): boolean {
  if (a.mate !== null && b.mate !== null) {
    // Same side is mating, and roughly as soon. Distance matters far less than
    // direction: "White mates in 6" and "White mates in 9" are the same fact.
    return Math.sign(a.mate) === Math.sign(b.mate);
  }
  if (a.mate !== null || b.mate !== null) return false;
  if (a.cp === null || b.cp === null) return false;
  if (Math.abs(a.cp - b.cp) <= AGREE_CP) return true;
  // Both decisively winning for the same side: the gap is not a disagreement.
  return (
    Math.sign(a.cp) === Math.sign(b.cp) &&
    Math.abs(a.cp) >= DECISIVE_CP &&
    Math.abs(b.cp) >= DECISIVE_CP
  );
}

export interface Candidate {
  depth: number;
  evaluation: StoredEval;
  confirmations: number;
  contributors: string[];
}

export interface StoredRow {
  /** The entry readers are served, once it clears `TRUST_THRESHOLD`. */
  primary: Candidate;
  /** A disagreeing submission waiting for its own confirmation, if any. */
  challenger: Candidate | null;
}

export interface IncomingWrite {
  depth: number;
  evaluation: StoredEval;
  contributor: string | null;
}

export type CacheDecision =
  /** No row yet — store the incoming write as an unconfirmed primary. */
  | { action: 'insert'; confirmations: number }
  /** Agrees with the primary. Confirmation count may rise; the stored data is
   *  replaced only when the incoming search went deeper. */
  | { action: 'confirm-primary'; confirmations: number; replaceData: boolean }
  /** Disagrees with everything on file — the incoming write becomes (or replaces)
   *  the challenger. The primary is untouched. */
  | { action: 'set-challenger'; confirmations: number }
  /** The primary was not yet trusted and this deeper write disagrees with it: the
   *  incoming write becomes the primary and the **old primary is demoted to
   *  challenger**, so the dissent it represented isn't silently lost. */
  | { action: 'supersede-primary'; confirmations: number }
  /** The challenger reached the trust threshold and takes over as primary; the
   *  old primary is dropped. `useIncomingData` says whose numbers to store — the
   *  confirming write's when it searched at least as deep, otherwise the
   *  challenger's own. */
  | { action: 'promote-challenger'; confirmations: number; useIncomingData: boolean }
  /** Nothing worth writing: a shallower duplicate from a known contributor, or a
   *  disagreeing claim weaker than the challenger already on file. */
  | { action: 'ignore'; reason: string };

/** A contributor that already backs a candidate cannot confirm it again. */
function creditFor(candidate: Candidate, contributor: string | null): number {
  if (!contributor) return candidate.confirmations;
  if (candidate.contributors.includes(contributor)) return candidate.confirmations;
  return candidate.confirmations + 1;
}

/**
 * Decide what a write does to the stored row.
 *
 * The rule that matters: **a trusted entry is never deleted by an unconfirmed
 * one.** A deeper search legitimately disagrees sometimes (depth 14 says +0.2,
 * depth 30 says +2.5), so a disagreeing write cannot simply be refused — but
 * letting it overwrite would make erasing the whole cache as cheap as claiming a
 * big `depth`, which is client-supplied and unverifiable. So a disagreeing write
 * goes into the challenger slot and only takes over once it has been
 * independently confirmed in its own right.
 *
 * Agreement is checked before depth throughout: a second opinion that matches is
 * worth more than a lone claim to have searched further.
 */
export function reconcileCacheWrite(stored: StoredRow | null, incoming: IncomingWrite): CacheDecision {
  if (!stored) return { action: 'insert', confirmations: 1 };

  const { primary, challenger } = stored;

  if (evalsAgree(primary.evaluation, incoming.evaluation)) {
    const confirmations = creditFor(primary, incoming.contributor);
    const deeper = incoming.depth > primary.depth;
    if (!deeper && confirmations === primary.confirmations) {
      return { action: 'ignore', reason: 'Already cached at equal or greater depth' };
    }
    // Guard 10: a shallower search never replaces deeper data, but it can still
    // vouch for it.
    return { action: 'confirm-primary', confirmations, replaceData: deeper };
  }

  if (challenger && evalsAgree(challenger.evaluation, incoming.evaluation)) {
    const confirmations = creditFor(challenger, incoming.contributor);
    if (confirmations >= TRUST_THRESHOLD) {
      return {
        action: 'promote-challenger',
        confirmations,
        useIncomingData: incoming.depth >= challenger.depth,
      };
    }
    if (confirmations === challenger.confirmations && incoming.depth <= challenger.depth) {
      return { action: 'ignore', reason: 'Challenger already recorded' };
    }
    return { action: 'set-challenger', confirmations };
  }

  // Disagrees with everything on file. If the primary is not yet trusted, the two
  // are just two unconfirmed opinions and the deeper one has the better claim to
  // the slot — but the loser is kept as the challenger rather than discarded.
  if (primary.confirmations < TRUST_THRESHOLD && incoming.depth > primary.depth) {
    return { action: 'supersede-primary', confirmations: 1 };
  }

  // Only displace a sitting challenger if this claim searched deeper, so the slot
  // trends toward the strongest dissent rather than whichever arrived last.
  if (challenger && incoming.depth <= challenger.depth) {
    return { action: 'ignore', reason: 'A deeper conflicting evaluation is already pending' };
  }
  return { action: 'set-challenger', confirmations: 1 };
}

/** Append a contributor, keeping the list bounded and duplicate-free. */
export function mergeContributors(existing: string[], contributor: string | null): string[] {
  if (!contributor) return existing.slice(0, MAX_CONTRIBUTORS);
  if (existing.includes(contributor)) return existing.slice(0, MAX_CONTRIBUTORS);
  return [...existing, contributor].slice(-MAX_CONTRIBUTORS);
}
