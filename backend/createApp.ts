import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { buildAllowedOrigins } from './corsOrigins';
import { trustProxyHops } from './trustProxy';

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
 *   contribute — anonymous writes to the shared eval cache. Deliberately far
 *              tighter than `review` and on its own bucket, so a write flood can
 *              never 429 the *reads* a review depends on. 300 ≈ 2.5 full-game
 *              reviews' worth of writes per window: an honest reviewer never
 *              notices, a poisoning script is starved (backend-audit §3 guard 12).
 *              Writes are best-effort on the client, so hitting this limit costs a
 *              visitor nothing beyond a cache entry.
 *   default  — ordinary CRUD; the historical budget, unchanged.
 *   strict   — password/credential and upstream-fetch endpoints, where the
 *              limit is an abuse control rather than a capacity one. Login and
 *              register are the brute-force surface; the import routes each
 *              spend a chess.com/lichess API call we do not want to be blamed
 *              for; migrate is an admin sweep.
 *
 * A shared cross-instance store (Upstash) is the Phase 6 item — until then
 * these are per-process, so the Render primary and a Vercel fallback invocation
 * count separately. That matters most for `contribute`: a per-process memory
 * store resets on every cold start, so the effective write budget is looser than
 * the number here suggests until Phase 6 lands.
 */
export const RATE_LIMIT_TIERS = {
  review: 900,
  browse: 400,
  contribute: 300,
  default: 150,
  strict: 20,
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

export function createApp(tier: RateLimitTier = 'default') {
  const app = express();
  // Per-platform, measured — NOT a guess. Render fronts this with 3 hops
  // (client, Cloudflare, internal LB); the old hardcoded 1 resolved req.ip to a
  // rotating 10.x LB address, so every client shared one rate-limit bucket.
  // See trustProxy.ts for why too-high is worse than too-low, and
  // `GET /api/health/deep` to re-measure against any live deploy.
  app.set('trust proxy', trustProxyHops());
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
