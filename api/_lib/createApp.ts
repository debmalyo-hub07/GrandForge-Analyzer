import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { buildAllowedOrigins } from './corsOrigins';

// Resolved once per process. On Vercel each invocation is a fresh process; on
// the persistent server this is the boot-time environment — both correct.
const allowedOrigins = buildAllowedOrigins(process.env);

export function createApp() {
  const app = express();
  // Behind one proxy hop (Vercel's edge, or Render's load balancer): trust the
  // first hop so req.ip is the real client IP (correct rate-limit keying +
  // logging) instead of the proxy address, and so express-rate-limit doesn't
  // flag an unexpected X-Forwarded-For header.
  app.set('trust proxy', 1);
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '5mb' }));
  // Deliberately per-createApp() (i.e. per route module, ~25 buckets of
  // 150/15min per IP), NOT a process-wide singleton: one authenticated game
  // review legitimately fires ~160 positions/eval+cache requests, which would
  // blow through a single global 150 bucket and 429 unrelated endpoints.
  // A shared cross-instance store (Upstash) is the Phase 6 hardening item.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 150,
    })
  );
  return app;
}
