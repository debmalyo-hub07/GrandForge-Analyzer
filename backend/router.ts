/**
 * GrandForge — consolidated API router.
 *
 * Two deployment entry points import this one app:
 *   1. backend/index.ts — the persistent server (Render primary; local `npm run dev`)
 *   2. api/[...path].ts — the single Vercel Serverless Function (fallback).
 *      Vercel Hobby allows at most 12 functions per deployment, so the ~25
 *      per-route handlers cannot each be their own function; the 1-file adapter
 *      keeps us at one.
 *
 * Each route module registers its own FULL path (e.g. app.get('/api/openings/lookup')),
 * so the dispatcher forwards (req, res, next) untouched and the inner app matches
 * on req.path — identical semantics to the old one-file-per-function layout.
 *
 * Adding a new route: drop the handler under backend/routes/** and register one
 * line in the `routes` table below.
 */
import express from 'express';

import { connectDB } from './db';

import authLogin from './routes/auth/login';
import authMe from './routes/auth/me';
import authPreferences from './routes/auth/preferences';
import authRegister from './routes/auth/register';
import engineIndexMigrate from './routes/engine-index/migrate';
import engineIndexStatus from './routes/engine-index/status';
import explorerLookup from './routes/explorer/lookup';
import gamesById from './routes/games/[id]';
import gamesIndex from './routes/games/index';
import gamesUpload from './routes/games/upload';
import importChesscom from './routes/import/chesscom';
import importLichess from './routes/import/lichess';
import masterById from './routes/master/[id]';
import masterGames from './routes/master/games';
import openingsLookup from './routes/openings/lookup';
import openingsSearch from './routes/openings/search';
import openingsTree from './routes/openings/tree';
import positionsCache from './routes/positions/cache';
import positionsEval from './routes/positions/eval';
import positionsTablebase from './routes/positions/tablebase';
import reviewByGameId from './routes/review/[gameId]';
import reviewJob from './routes/review/job';
import reviewSave from './routes/review/save';
import sessionsById from './routes/sessions/[id]';
import sessionsCreate from './routes/sessions/create';
import sessionsIndex from './routes/sessions/index';

const app = express();

// The outer app serves /api/health and /api/health/deep itself, so it needs the
// same proxy trust as the inner route apps (createApp) — `req.ip` is resolved
// against `req.app`'s settings, and req.app is this app for those two handlers.
app.set('trust proxy', 1);

// Security headers on every response. This router only ever serves JSON, never
// HTML — vercel.json sets an equivalent (richer, document-oriented) set for
// Vercel-served responses, but Render sends whatever the app sends, so these
// have to live in code to cover both deployments.
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Content-Security-Policy', "default-src 'none'");
  next();
});

// Request logger — prints method, path, status, duration to terminal.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const color = status < 400 ? '\x1b[32m' : status < 500 ? '\x1b[33m' : '\x1b[31m';
    console.log(`${color}${req.method}\x1b[0m ${req.path} ${color}${status}\x1b[0m ${ms}ms`);
  });
  next();
});

app.get('/api/health', (_req, res) => {
  // Also the keep-alive pinger + failover-probe target: cheap, no DB touch.
  // This handler lives on the OUTER app, which has no cors() middleware — the
  // browser boot/recovery probe (src/services/apiBase.ts) fetches it
  // cross-origin from the frontend, so it must send ACAO itself. Wildcard is
  // correct: public endpoint, no credentials on the probe fetch.
  res.set('Access-Control-Allow-Origin', '*');
  res.status(200).json({ ok: true, uptime: Math.round(process.uptime()) });
});

/**
 * Deep health check — for monitoring and for verifying a fresh deploy. NOT the
 * Render health-check path and NOT the client failover probe: both use
 * `/api/health`, which must stay DB-free so a transient Atlas blip can't get the
 * whole service restarted or make every client fail over at once.
 *
 * `proxyHops` is the point of the `xForwardedFor` echo: `createApp()` sets
 * `trust proxy` to 1, which is only correct if exactly one proxy prepends to
 * X-Forwarded-For. If a real deploy shows 2+, every request rate-limit-keys to
 * the same intermediate address and one client can exhaust a bucket for
 * everyone — check this once after the first deploy (docs/deploy-render.md).
 */
app.get('/api/health/deep', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');

  const xff = req.headers['x-forwarded-for'];
  const xffValue = Array.isArray(xff) ? xff.join(', ') : (xff ?? '');
  const proxyHops = xffValue ? xffValue.split(',').filter((s) => s.trim()).length : 0;

  const started = Date.now();
  let db: { ok: boolean; latencyMs: number | null; error?: string };
  try {
    const conn = await connectDB();
    // A real round trip. `readyState === 1` only proves a socket was opened at
    // some point; it stays 1 across an Atlas failover that rejects commands.
    await conn.db!.admin().ping();
    db = { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    db = {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }

  res.status(db.ok ? 200 : 503).json({
    ok: db.ok,
    uptime: Math.round(process.uptime()),
    // 'render' / 'vercel' / 'local' — which of the two deploy targets answered.
    runtime: process.env.RENDER ? 'render' : process.env.VERCEL ? 'vercel' : 'local',
    db,
    proxy: { hops: proxyHops, trustProxy: 1, clientIp: req.ip ?? null },
  });
});

// Order matters: more specific literal paths must precede the `[^/]+` param
// patterns that would otherwise swallow them (e.g. /games/upload before /games/:id).
// Exported for backend/router.test.ts, which asserts that ordering directly.
export const routes: Array<[RegExp, any]> = [
  [/^\/api\/auth\/login\/?$/, authLogin],
  [/^\/api\/auth\/me\/?$/, authMe],
  [/^\/api\/auth\/preferences\/?$/, authPreferences],
  [/^\/api\/auth\/register\/?$/, authRegister],
  [/^\/api\/engine-index\/migrate\/?$/, engineIndexMigrate],
  [/^\/api\/engine-index\/status\/?$/, engineIndexStatus],
  [/^\/api\/explorer\/lookup\/?$/, explorerLookup],
  [/^\/api\/games\/upload\/?$/, gamesUpload],
  [/^\/api\/games\/[^/]+\/?$/, gamesById],
  [/^\/api\/games\/?$/, gamesIndex],
  [/^\/api\/import\/chesscom\/?$/, importChesscom],
  [/^\/api\/import\/lichess\/?$/, importLichess],
  [/^\/api\/master\/games\/[^/]+\/?$/, masterById],
  [/^\/api\/master\/games\/?$/, masterGames],
  [/^\/api\/openings\/lookup\/?$/, openingsLookup],
  [/^\/api\/openings\/search\/?$/, openingsSearch],
  [/^\/api\/openings\/tree\/?$/, openingsTree],
  [/^\/api\/positions\/cache\/?$/, positionsCache],
  [/^\/api\/positions\/eval\/?$/, positionsEval],
  [/^\/api\/positions\/tablebase\/?$/, positionsTablebase],
  [/^\/api\/review\/save\/?$/, reviewSave],
  [/^\/api\/review\/job\/?$/, reviewJob],
  [/^\/api\/review\/[^/]+\/?$/, reviewByGameId],
  [/^\/api\/sessions\/create\/?$/, sessionsCreate],
  [/^\/api\/sessions\/[^/]+\/?$/, sessionsById],
  [/^\/api\/sessions\/?$/, sessionsIndex],
];

app.use((req, res, next) => {
  const match = routes.find(([pattern]) => pattern.test(req.path));
  if (!match) return next();
  return match[1](req, res, next);
});

// Terminal 404. Without this, an unmatched path (/api/nope,
// /api/games/upload/extra) fell through to express's finalhandler and answered a
// JSON API with an HTML "Cannot GET …" page.
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Terminal error handler. Express's default one appends err.stack whenever
// NODE_ENV !== 'production', so stack-trace suppression used to depend on an env
// var being set correctly on two different platforms. This makes it structural.
// The four-argument signature is what marks it as an error handler to express —
// `next` must stay in the list even though it is unused.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`API error on ${req.method} ${req.path}:`, err);
  if (res.headersSent) return;
  // express.json() rejects a malformed body with a SyntaxError carrying
  // type 'entity.parse.failed' — a client fault, not a server one.
  const isBodyParseError =
    err instanceof SyntaxError || err?.type === 'entity.parse.failed';
  if (isBodyParseError) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

export default app;
