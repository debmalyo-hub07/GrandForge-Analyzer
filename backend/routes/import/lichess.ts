/**
 * GrandForge — Lichess Game Import
 *
 * POST /api/import/lichess  { username, perfType?, count? }
 *
 * Streams the player's games from Lichess as NDJSON (one JSON object per line),
 * runs every PGN through indexGame() to populate the Engine–Game Bridge index,
 * and upserts every game into the `games` collection.
 *
 * POST, not GET: this endpoint writes to Mongo and does 2 upstream fetches plus
 * up to 50 chess.js PGN replays. As a GET it was cross-site triggerable — CORS
 * only withholds the response from the calling page, it does not stop the
 * handler from running, and a simple GET triggers no preflight.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import { indexGame } from '../../indexGame';
import { importLichessSchema } from '../../zodSchemas';
import Game from '../../models/Game';

const LICHESS_BASE = 'https://lichess.org';

type LichessPerfType =
  | 'ultraBullet'
  | 'bullet'
  | 'blitz'
  | 'rapid'
  | 'classical'
  | 'correspondence';

interface LichessPlayer {
  user?: { name: string; id: string; title?: string };
  rating?: number;
  ratingDiff?: number;
}

interface LichessNdjsonGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  perf: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: 'white' | 'black';
  pgn?: string;
  clock?: { initial: number; increment: number; totalTime: number };
  opening?: { eco: string; name: string; ply: number };
}

interface LichessPlayerProfile {
  id: string;
  username: string;
  title?: string;
  online?: boolean;
  perfs?: Record<string, { games: number; rating: number; prog: number }>;
  profile?: { country?: string; bio?: string };
  createdAt?: number;
  url?: string;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/x-ndjson' };
  const token = process.env.LICHESS_API_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function pickResult(g: LichessNdjsonGame): string {
  if (g.winner === 'white') return '1-0';
  if (g.winner === 'black') return '0-1';
  return '1/2-1/2';
}

/**
 * Every upstream call is bounded. Without this, undici's ~300 s default meant a
 * slow Lichess response held an Express connection AND a Mongo pool slot for
 * five minutes on a 0.1 vCPU / 512 MB instance; Vercel's `maxDuration: 30` used
 * to be the only backstop and it doesn't exist on the persistent server.
 * The NDJSON stream is the reason the signal has to cover the body read too,
 * not just the headers.
 */
const UPSTREAM_TIMEOUT_MS = 8_000;

class UpstreamTimeoutError extends Error {
  constructor() {
    super('Lichess request timed out');
    this.name = 'UpstreamTimeoutError';
  }
}

async function fetchText(
  url: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = res.ok ? await res.text() : '';
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new UpstreamTimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const app = createApp();

// Pointer for anything still calling the old GET shape.
app.get('/api/import/lichess', (_req, res) => {
  res.status(405).json({ error: 'Use POST' });
});

app.post('/api/import/lichess', optionalAuth, async (req: AuthRequest, res) => {
  try {
    // Validate the JSON body with the shared Zod schema (length/enum/range).
    // `count` is z.coerce.number(), so the schema accepts a real JSON number
    // as readily as the query string it used to receive.
    const q = importLichessSchema.safeParse(req.body);
    if (!q.success) {
      return res.status(400).json({ error: 'Invalid request', issues: q.error.issues });
    }

    const username = q.data.username.trim();
    // 'all' is an app-level aggregate, not a Lichess perfType — drop it so we
    // don't forward an invalid value to the upstream API.
    const perfType = q.data.perfType && q.data.perfType !== 'all' ? q.data.perfType : undefined;
    const count = Math.max(1, Math.min(50, q.data.count ?? 20));

    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    await connectDB();

    // 1. Fetch profile
    const profileRes = await fetchText(`${LICHESS_BASE}/api/user/${encodeURIComponent(username)}`, {
      Accept: 'application/json',
      ...(process.env.LICHESS_API_TOKEN ? { Authorization: `Bearer ${process.env.LICHESS_API_TOKEN}` } : {}),
    });
    if (!profileRes.ok) {
      const status = profileRes.status === 404 ? 404 : 502;
      return res.status(status).json({ error: status === 404 ? 'Player not found' : 'Lichess API unavailable' });
    }
    const playerProfile: LichessPlayerProfile = JSON.parse(profileRes.text);

    // 2. Stream NDJSON games
    const params = new URLSearchParams();
    params.set('max', String(count));
    params.set('pgnInJson', 'true');
    params.set('opening', 'true');
    params.set('clocks', 'false');
    params.set('evals', 'false');
    if (perfType) params.set('perfType', perfType as LichessPerfType);

    const gamesUrl = `${LICHESS_BASE}/api/games/user/${encodeURIComponent(username)}?${params.toString()}`;
    const gamesRes = await fetchText(gamesUrl, authHeaders());
    if (!gamesRes.ok) {
      return res.status(gamesRes.status).json({ error: `Lichess games stream failed: ${gamesRes.status}` });
    }

    // NDJSON: one JSON object per line.
    const lines = gamesRes.text.split('\n').filter((l) => l.trim().length > 0);

    const indexedGames: unknown[] = [];
    for (const line of lines) {
      let g: LichessNdjsonGame;
      try {
        g = JSON.parse(line);
      } catch {
        continue;
      }
      if (!g.pgn) continue;
      try {
        const index = indexGame(g.pgn);
        if (!index.engineReady) continue;

        const timeControl = g.clock
          ? `${g.clock.initial}+${g.clock.increment}`
          : g.speed || undefined;

        // SEC-1: scope the upsert filter to this user so each user owns their
        // own copy of a shared game (the unique index is now
        // {source, sourceGameId, userId}). userId goes in $setOnInsert (never
        // $set) so a re-import can't reassign ownership, and metadata is merged
        // field-by-field via dot-paths instead of replacing the whole subdoc.
        const doc = await Game.findOneAndUpdate(
          {
            'metadata.source': 'lichess',
            'metadata.sourceGameId': g.id,
            userId: req.userId ?? null,
          },
          {
            $set: {
              pgn: g.pgn,
              fenPositions: index.fenPositions,
              moveUciList: index.moveUciList,
              moveSanList: index.moveSanList,
              plyCount: index.plyCount,
              engineReady: index.engineReady,
              phase: index.phase,
              'metadata.white': g.players.white.user?.name ?? 'Anonymous',
              'metadata.black': g.players.black.user?.name ?? 'Anonymous',
              'metadata.whiteElo': g.players.white.rating,
              'metadata.blackElo': g.players.black.rating,
              'metadata.event': 'Lichess',
              'metadata.site': `${LICHESS_BASE}/${g.id}`,
              'metadata.date': new Date(g.createdAt).toISOString().slice(0, 10),
              'metadata.result': pickResult(g),
              'metadata.timeControl': timeControl,
              'metadata.opening': g.opening?.name,
              'metadata.ecoCode': g.opening?.eco,
              'metadata.variant': g.variant,
              'metadata.source': 'lichess',
              'metadata.sourceGameId': g.id,
              'metadata.sourceUrl': `${LICHESS_BASE}/${g.id}`,
              'metadata.importedAt': new Date(),
            },
            $setOnInsert: req.userId ? { userId: req.userId } : {},
          },
          { upsert: true, new: true, lean: true }
        );
        indexedGames.push(doc);
      } catch {
        // Skip malformed games
      }
    }

    return res.status(200).json({ games: indexedGames, playerProfile });
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      console.error('Lichess import timed out');
      return res.status(504).json({ error: 'Lichess API timed out' });
    }
    console.error('Lichess import error:', err);
    return res.status(500).json({ error: 'Lichess import failed' });
  }
});

// The router dispatches with (req, res, next). Forwarding `next` is what lets a
// malformed JSON body — now reachable, since this route reads one — reach the
// router's JSON error handler instead of express's HTML finalhandler. On Vercel
// there is no next and express falls back to finalhandler, exactly as before.
export default function handler(req: VercelRequest, res: VercelResponse, next?: unknown) {
  return app(req as never, res as never, next as never);
}
