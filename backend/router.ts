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

import authLogin from './routes/auth/login';
import authMe from './routes/auth/me';
import authPreferences from './routes/auth/preferences';
import authRegister from './routes/auth/register';
import engineIndexMigrate from './routes/engine-index/migrate';
import engineIndexStatus from './routes/engine-index/status';
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

// Order matters: more specific literal paths must precede the `[^/]+` param
// patterns that would otherwise swallow them (e.g. /games/upload before /games/:id).
const routes: Array<[RegExp, any]> = [
  [/^\/api\/auth\/login\/?$/, authLogin],
  [/^\/api\/auth\/me\/?$/, authMe],
  [/^\/api\/auth\/preferences\/?$/, authPreferences],
  [/^\/api\/auth\/register\/?$/, authRegister],
  [/^\/api\/engine-index\/migrate\/?$/, engineIndexMigrate],
  [/^\/api\/engine-index\/status\/?$/, engineIndexStatus],
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

export default app;
