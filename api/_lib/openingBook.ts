import mongoose from 'mongoose';
import { connectDB } from './db';

/**
 * Loads the set of normalized opening FENs from the `openings` collection.
 *
 * Normalization: FENs are reduced to their first field (the piece-placement portion).
 * This allows the review system to detect book moves by position alone, regardless of
 * castling rights, en passant target, halfmove clock, or fullmove number — which can
 * differ between transposition-equivalent positions.
 *
 * Returns a Set<string> for O(1) lookups during batch review analysis.
 */
export async function loadOpeningFens(): Promise<Set<string>> {
  await connectDB();
  const conn = mongoose.connection;
  const docs = await conn
    .collection('openings')
    .find({}, { projection: { fen: 1, _id: 0 } })
    .toArray();

  const set = new Set<string>();
  for (const doc of docs) {
    const fen = (doc as { fen?: string }).fen;
    if (typeof fen === 'string' && fen.length > 0) {
      const placement = fen.split(' ')[0];
      if (placement) set.add(placement);
    }
  }
  return set;
}
