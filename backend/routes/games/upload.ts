import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { optionalAuth, type AuthRequest } from '../../auth';
import { indexGame } from '../../indexGame';
import Game from '../../models/Game';
import User from '../../models/User';

const uploadSchema = z.object({
  pgn: z.string().min(1).max(500_000),
});

function pgnHeader(pgn: string, tag: string): string | undefined {
  const re = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`, 'i');
  const m = pgn.match(re);
  return m ? m[1] : undefined;
}

const app = createApp();

app.post('/api/games/upload', optionalAuth, async (req: AuthRequest, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.flatten() });
  }
  const { pgn } = parsed.data;

  let index;
  try {
    index = indexGame(pgn);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message || 'Invalid PGN' });
  }

  if (!index.engineReady) {
    return res.status(400).json({ error: 'Game indexing failed — engineReady is false' });
  }

  try {
    await connectDB();

    const whiteElo = pgnHeader(pgn, 'WhiteElo');
    const blackElo = pgnHeader(pgn, 'BlackElo');

    const metadata = {
      white: pgnHeader(pgn, 'White') ?? '',
      black: pgnHeader(pgn, 'Black') ?? '',
      whiteElo: whiteElo ? parseInt(whiteElo, 10) || undefined : undefined,
      blackElo: blackElo ? parseInt(blackElo, 10) || undefined : undefined,
      event: pgnHeader(pgn, 'Event'),
      site: pgnHeader(pgn, 'Site'),
      date: pgnHeader(pgn, 'Date'),
      result: pgnHeader(pgn, 'Result') ?? '*',
      timeControl: pgnHeader(pgn, 'TimeControl'),
      opening: pgnHeader(pgn, 'Opening'),
      ecoCode: pgnHeader(pgn, 'ECO'),
      variant: pgnHeader(pgn, 'Variant'),
      source: 'pgn_upload' as const,
      importedAt: new Date(),
    };

    const game = await Game.create({
      userId: req.userId,
      pgn,
      fenPositions: index.fenPositions,
      moveUciList: index.moveUciList,
      moveSanList: index.moveSanList,
      plyCount: index.plyCount,
      engineReady: index.engineReady,
      phase: index.phase,
      metadata,
    });

    if (req.userId) {
      await User.updateOne({ _id: req.userId }, { $inc: { 'stats.totalGamesImported': 1 } });
    }

    return res.status(201).json({ game: game.toObject() });
  } catch (err) {
    console.error('GrandForge upload game error:', err);
    return res.status(500).json({ error: 'Failed to upload game' });
  }
});

export default app;
