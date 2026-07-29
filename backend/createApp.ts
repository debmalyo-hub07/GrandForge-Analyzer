import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { buildAllowedOrigins } from './corsOrigins';

// Resolved once per process. On Vercel each invocation is a fresh process; on
// the persistent server this is the boot-time environment — both correct.
const allowedOrigins = buildAllowedOrigins(process.env);

/**
 * Per-IP request budgets per 15-minute window, keyed by endpoint cost.
 *
 * These are **per route module** (one `createApp()` per file, ~25 independent
 * buckets), not process-wide. That is deliberate and load-bearing: one game
 * review legitimately fires ~120 `positions/eval` reads plus ~120
 * `positions/cache` writes, so a single shared bucket would 429 the review
 * partway through and take unrelated endpoints down with it.
 *
 * The old flat 150 was still too small for the two review-path buckets — a
 * 60-move game exhausts `positions/eval` in one review and the second review in
 * a session dies at ply ~30 with a silent cache miss storm. Sizing:
 *
 *   review   — driven by ply count. 900 ≈ 7 full-length game reviews per
 *              window, which is more than a human reviews by hand.
 *   browse   — driven by board navigation (a lookup per position visited).
 *   default  — ordinary CRUD; the historical budget, unchanged.
 *   strict   — password/credential and upstream-fetch endpoints, where the
 *              limit is an abuse control rather than a capacity one. Login and
 *              register are the brute-force surface; the import routes each
 *              spend a chess.com/lichess API call we do not want to be blamed
 *              for; migrate is an admin sweep.
 *
 * A shared cross-instance store (Upstash) is the Phase 6 item — until then
 * these are per-process, so the Render primary and a Vercel fallback invocation
 * count separately.
 */
export const RATE_LIMIT_TIERS = {
  review: 900,
  browse: 400,
  default: 150,
  strict: 20,
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

export function createApp(tier: RateLimitTier = 'default') {
  const app = express();
  // Behind one proxy hop (Vercel's edge, or Render's load balancer): trust the
  // first hop so req.ip is the real client IP (correct rate-limit keying +
  // logging) instead of the proxy address, and so express-rate-limit doesn't
  // flag an unexpected X-Forwarded-For header.
  //
  // If a platform ever fronts us with two hops, every request keys to the same
  // intermediate IP and one user can exhaust a whole bucket for everybody.
  // `GET /api/health/deep` reports the observed hop count so this can be
  // checked against the real deploy instead of assumed (see docs/deploy-render.md).
  app.set('trust proxy', 1);
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: RATE_LIMIT_TIERS[tier],
      // JSON, not express-rate-limit's default text/plain body — every other
      // error path on this API answers with `{ error }` and the client's axios
      // interceptors parse that shape.
      handler: (_req, res) => {
        res.status(429).json({ error: 'Too many requests — please slow down.' });
      },
    })
  );
  return app;
}
