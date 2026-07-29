/**
 * GrandForge — Chess.com Game Import
 *
 * POST /api/import/chesscom  { username, type?, count? }
 *
 * Fetches the last 2 months of games from Chess.com's public archive API,
 * filters by time-control type (bullet/blitz/rapid/classical), runs every
 * PGN through indexGame() to populate the Engine–Game Bridge index, and
 * upserts every game into the `games` collection.
 *
 * POST, not GET: this endpoint writes to Mongo and does 3 upstream fetches plus
 * up to 50 chess.js PGN replays. As a GET it was cross-site triggerable — a
 * third party's `<img src=".../api/import/chesscom?username=x">` ran the whole
 * import from every visitor's IP (CORS only withholds the response; the handler
 * still runs, and a simple GET triggers no preflight).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import { indexGame } from '../../indexGame';
import { importChessComSchema } from '../../zodSchemas';
import Game from '../../models/Game';

const CHESSCOM_BASE = 'https://api.chess.com/pub';

type ChessComTimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
type FilterType = 'bullet' | 'blitz' | 'rapid' | 'classical';

interface ChessComArchiveGame {
  url: string;
  pgn: string;
  time_control: string;
  time_class: ChessComTimeClass;
  rated: boolean;
  uuid: string;
  end_time: number;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

interface ChessComArchiveResponse {
  games: ChessComArchiveGame[];
}

interface ChessComPlayerProfile {
  username: string;
  player_id?: number;
  name?: string;
  country?: string;
  avatar?: string;
  followers?: number;
  joined?: number;
  status?: string;
}

function userAgent(): string {
  return process.env.CHESS_COM_USER_AGENT || 'grandforge/1.0';
}

function lastTwoMonths(): Array<{ year: number; month: number }> {
  const now = new Date();
  const months: Array<{ year: number; month: number }> = [];
  for (let i = 0; i < 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return months;
}

function matchesType(timeClass: ChessComTimeClass, filter: FilterType): boolean {
  // Chess.com uses 'daily' for correspondence; map 'classical' filter to 'daily'
  if (filter === 'classical') return timeClass === 'daily';
  return timeClass === filter;
}

/**
 * Every upstream call is bounded. Without this, undici's ~300 s default meant a
 * slow chess.com response held an Express connection AND a Mongo pool slot for
 * five minutes on a 0.1 vCPU / 512 MB instance; Vercel's `maxDuration: 30` used
 * to be the only backstop and it doesn't exist on the persistent server.
 */
const UPSTREAM_TIMEOUT_MS = 8_000;

class UpstreamTimeoutError extends Error {
  constructor() {
    super('Chess.com request timed out');
    this.name = 'UpstreamTimeoutError';
  }
}

/**
 * The abort signal stays armed until the body is fully read — clearing it right
 * after the headers arrive would leave the (multi-MB) archive download unbounded.
 */
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

const app = createApp('strict');

// Pointer for anything still calling the old GET shape.
app.get('/api/import/chesscom', (_req, res) => {
  res.status(405).json({ error: 'Use POST' });
});

app.post('/api/import/chesscom', optionalAuth, async (req: AuthRequest, res) => {
  try {
    // Validate the JSON body with the shared Zod schema (length/enum/range)
    // before applying route-specific normalization. `count` is z.coerce.number(),
    // so the same schema accepts a real JSON number as well as a query string.
    const q = importChessComSchema.safeParse(req.body);
    if (!q.success) {
      return res.status(400).json({ error: 'Invalid request', issues: q.error.issues });
    }

    const username = q.data.username.trim().toLowerCase();
    const typeFilter = String(q.data.type || 'blitz').toLowerCase() as FilterType;
    const count = Math.max(1, Math.min(50, q.data.count ?? 20));

    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }
    // This route does not support the 'all' aggregate; require a concrete class.
    if (!['bullet', 'blitz', 'rapid', 'classical'].includes(typeFilter)) {
      return res.status(400).json({ error: 'type must be one of bullet, blitz, rapid, classical' });
    }

    await connectDB();

    const headers = { 'User-Agent': userAgent(), Accept: 'application/json' };

    // 1. Fetch player profile
    const profileRes = await fetchText(
      `${CHESSCOM_BASE}/player/${encodeURIComponent(username)}`,
      headers
    );
    if (!profileRes.ok) {
      const status = profileRes.status === 404 ? 404 : 502;
      return res.status(status).json({ error: status === 404 ? 'Player not found' : 'Chess.com API unavailable' });
    }
    const playerProfile: ChessComPlayerProfile = JSON.parse(profileRes.text);

    // 2. Fetch archive months
    const months = lastTwoMonths();
    const allGames: ChessComArchiveGame[] = [];
    for (const { year, month } of months) {
      const mm = String(month).padStart(2, '0');
      const url = `${CHESSCOM_BASE}/player/${encodeURIComponent(username)}/games/${year}/${mm}`;
      try {
        const archiveRes = await fetchText(url, headers);
        if (!archiveRes.ok) continue;
        const data: ChessComArchiveResponse = JSON.parse(archiveRes.text);
        if (data?.games?.length) allGames.push(...data.games);
      } catch {
        // A timed-out or malformed month is skipped, not fatal — same as the
        // pre-existing `!archiveRes.ok` behavior.
        continue;
      }
    }

    // 3. Filter by type and sort newest first
    const filtered = allGames
      .filter((g) => matchesType(g.time_class, typeFilter))
      .sort((a, b) => b.end_time - a.end_time)
      .slice(0, count);

    // 4. Index and upsert each game
    const indexedGames: unknown[] = [];
    for (const g of filtered) {
      if (!g.pgn) continue;
      try {
        const index = indexGame(g.pgn);
        if (!index.engineReady) continue;

        const resultRaw = (g.white.result || '').toLowerCase();
        const result =
          resultRaw === 'win'
            ? '1-0'
            : (g.black.result || '').toLowerCase() === 'win'
            ? '0-1'
            : '1/2-1/2';

        // SEC-1: scope the upsert filter to this user so each user owns their
        // own copy of a shared game (the unique index is now
        // {source, sourceGameId, userId}). userId goes in $setOnInsert (never
        // $set) so a re-import can't reassign ownership, and metadata is merged
        // field-by-field via dot-paths instead of replacing the whole subdoc
        // (which would clobber sibling fields / future additions).
        const doc = await Game.findOneAndUpdate(
          {
            'metadata.source': 'chesscom',
            'metadata.sourceGameId': g.uuid,
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
              'metadata.white': g.white.username,
              'metadata.black': g.black.username,
              'metadata.whiteElo': g.white.rating,
              'metadata.blackElo': g.black.rating,
              'metadata.event': 'Chess.com',
              'metadata.site': g.url,
              'metadata.date': new Date(g.end_time * 1000).toISOString().slice(0, 10),
              'metadata.result': result,
              'metadata.timeControl': g.time_control,
              'metadata.variant': 'standard',
              'metadata.source': 'chesscom',
              'metadata.sourceGameId': g.uuid,
              'metadata.sourceUrl': g.url,
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
      console.error('Chess.com import timed out');
      return res.status(504).json({ error: 'Chess.com API timed out' });
    }
    console.error('Chess.com import error:', err);
    return res.status(500).json({ error: 'Chess.com import failed' });
  }
});

// The router dispatches with (req, res, next). Forwarding `next` is what lets a
// malformed JSON body — now reachable, since this route reads one — reach the
// router's JSON error handler instead of express's HTML finalhandler. On Vercel
// there is no next and express falls back to finalhandler, exactly as before.
export default function handler(req: VercelRequest, res: VercelResponse, next?: unknown) {
  return app(req as never, res as never, next as never);
}
