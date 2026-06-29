import { Chess, type Square, type Color, type PieceSymbol } from 'chess.js';

export interface MotifSquares {
  undefended: Square[];
  pinned: Square[];
  checkableKing: Square | null;
}

const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const ALL_SQUARES: Square[] = ((): Square[] => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;
  const out: Square[] = [];
  for (const r of ranks) for (const f of files) out.push((f + r) as Square);
  return out;
})();

/** Find squares attacked-but-not-defended for the side-to-move (player's pieces in danger). */
function findUndefended(chess: Chess): Square[] {
  const turn = chess.turn();
  const opponent: Color = turn === 'w' ? 'b' : 'w';
  const out: Square[] = [];
  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq);
    if (!piece || piece.color !== turn) continue;
    if (piece.type === 'k') continue;
    const attackers = chess.attackers(sq, opponent);
    if (attackers.length === 0) continue;
    const defenders = chess.attackers(sq, turn).filter((s) => s !== sq);
    if (defenders.length === 0) {
      out.push(sq);
      continue;
    }
    const minAttacker = Math.min(
      ...attackers.map((s) => {
        const p = chess.get(s);
        return p ? PIECE_VALUE[p.type] : 99;
      })
    );
    if (minAttacker < PIECE_VALUE[piece.type]) {
      out.push(sq);
    }
  }
  return out;
}

/** Find absolute pins on the side-to-move's pieces (cannot move because doing so exposes own king). */
function findPinned(chess: Chess): Square[] {
  const turn = chess.turn();
  const out: Square[] = [];
  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq);
    if (!piece || piece.color !== turn) continue;
    if (piece.type === 'k') continue;
    const moves = chess.moves({ square: sq, verbose: true });
    if (moves.length === 0) {
      const fen = chess.fen();
      const tmp = new Chess(fen);
      tmp.remove(sq);
      const opponent: Color = turn === 'w' ? 'b' : 'w';
      const kingSq = ALL_SQUARES.find((s) => {
        const p = tmp.get(s);
        return p && p.type === 'k' && p.color === turn;
      });
      if (kingSq && tmp.attackers(kingSq, opponent).length > 0) {
        out.push(sq);
      }
    }
  }
  return out;
}

/** If the side-to-move's king is attacked or in check, return king square. */
function findCheckableKing(chess: Chess): Square | null {
  const turn = chess.turn();
  const kingSq = ALL_SQUARES.find((s) => {
    const p = chess.get(s);
    return p && p.type === 'k' && p.color === turn;
  });
  if (!kingSq) return null;
  if (chess.inCheck()) return kingSq;
  const opponent: Color = turn === 'w' ? 'b' : 'w';
  const attackers = chess.attackers(kingSq, opponent);
  return attackers.length > 0 ? kingSq : null;
}

export function computeMotifs(fen: string): MotifSquares {
  try {
    const chess = new Chess(fen);
    return {
      undefended: findUndefended(chess),
      pinned: findPinned(chess),
      checkableKing: findCheckableKing(chess),
    };
  } catch {
    return { undefended: [], pinned: [], checkableKing: null };
  }
}
