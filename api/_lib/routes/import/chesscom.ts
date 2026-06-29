/**
 * GrandForge — Chess.com Game Import
 *
 * GET /api/import/chesscom?username=&type=&count=
 *
 * Fetches the last 2 months of games from Chess.com's public archive API,
 * filters by time-control type (bullet/blitz/rapid/classical), runs every
 * PGN through indexGame() to populate the Engine–Game Bridge index, and
 * upserts every game into the `games` collection.
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

const app = createApp();

app.get('/api/import/chesscom', optionalAuth, async (req: AuthRequest, res) => {
  try {
    // Validate the query shape with the shared Zod schema (length/enum/range)
    // before applying route-specific normalization.
    const q = importChessComSchema.safeParse(req.query);
    if (!q.success) {
      return res.status(400).json({ error: 'Invalid query', issues: q.error.issues });
    }

    const username = q.data.username.trim().toLowerCase();
    const typeFilter = String(q.data.type || 'blitz').toLowerCase() as FilterType;
    const count = Math.max(1, Math.min(50, q.data.count ?? 20));

    if (!username) {
      return res.status(400).json({ error: 'username query parameter is required' });
    }
    // This route does not support the 'all' aggregate; require a concrete class.
    if (!['bullet', 'blitz', 'rapid', 'classical'].includes(typeFilter)) {
      return res.status(400).json({ error: 'type must be one of bullet, blitz, rapid, classical' });
    }

    await connectDB();

    const headers = { 'User-Agent': userAgent(), Accept: 'application/json' };

    // 1. Fetch player profile
    const profileRes = await fetch(`${CHESSCOM_BASE}/player/${encodeURIComponent(username)}`, { headers });
    if (!profileRes.ok) {
      const status = profileRes.status === 404 ? 404 : 502;
      return res.status(status).json({ error: status === 404 ? 'Player not found' : 'Chess.com API unavailable' });
    }
    const playerProfile: ChessComPlayerProfile = await profileRes.json();

    // 2. Fetch archive months
    const months = lastTwoMonths();
    const allGames: ChessComArchiveGame[] = [];
    for (const { year, month } of months) {
      const mm = String(month).padStart(2, '0');
      const url = `${CHESSCOM_BASE}/player/${encodeURIComponent(username)}/games/${year}/${mm}`;
      const archiveRes = await fetch(url, { headers });
      if (!archiveRes.ok) continue;
      const data: ChessComArchiveResponse = await archiveRes.json();
      if (data?.games?.length) allGames.push(...data.games);
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
    console.error('Chess.com import error:', err);
    return res.status(500).json({ error: 'Chess.com import failed' });
  }
});

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as never, res as never);
}
