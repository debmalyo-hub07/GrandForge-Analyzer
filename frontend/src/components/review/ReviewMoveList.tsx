// src/components/review/ReviewMoveList.tsx
// Chess.com-style scrollable annotated move list for a completed review:
// one row per full move (White + Black half-moves) with classification icons.
// Click a half-move to jump to it along the reviewed line; the row of the
// current position auto-scrolls into view.
import { useEffect, useMemo, useRef } from 'react';
import type { GameReviewResult, MoveReview, MoveClassification } from '../../types/review';
import { useGameStore, getNodeIdAtPly } from '../../store/gameStore';
import { readableTextColor } from '../../utils/boardUtils';

const ICONS: Record<MoveClassification, { icon: string; color: string; label: string }> = {
  brilliant:  { icon: '!!', color: '#1baca6', label: 'Brilliant' },
  great:      { icon: '!',  color: '#5c8bb0', label: 'Great' },
  book:       { icon: '📖', color: '#c8a84b', label: 'Book' },
  forced:     { icon: '→',  color: '#a88850', label: 'Forced' },
  best:       { icon: '★', color: '#96bc4b', label: 'Best' },
  excellent:  { icon: '👍', color: '#a3d35f', label: 'Excellent' },
  good:       { icon: '✔', color: '#82ac49', label: 'Good' },
  inaccuracy: { icon: '?!', color: '#f0c945', label: 'Inaccuracy' },
  mistake:    { icon: '?',  color: '#e68f39', label: 'Mistake' },
  miss:       { icon: '✗', color: '#e05a5a', label: 'Miss' },
  blunder:    { icon: '??', color: '#ca3431', label: 'Blunder' },
};

function HalfMove({
  review,
  isCurrent,
  onClick,
}: {
  review: MoveReview | undefined;
  isCurrent: boolean;
  onClick: () => void;
}) {
  if (!review) return <span className="rml-half rml-half--empty" />;
  const cfg = ICONS[review.classification];
  return (
    <button
      type="button"
      className={`rml-half${isCurrent ? ' is-current' : ''}`}
      onClick={onClick}
      aria-label={`${review.san} — ${cfg.label}`}
      aria-current={isCurrent ? 'true' : undefined}
    >
      <span
        className="rml-icon"
        style={{ background: cfg.color, color: readableTextColor(cfg.color) }}
        aria-hidden="true"
      >
        {cfg.icon}
      </span>
      <span className="rml-san">{review.san}</span>
    </button>
  );
}

export function ReviewMoveList({ result }: { result: GameReviewResult }) {
  const moveTree = useGameStore((s) => s.moveTree);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => {
    const out: Array<{ num: number; white?: MoveReview; black?: MoveReview }> = [];
    for (const m of result.moveReviews) {
      const num = Math.floor(m.plyIndex / 2) + 1;
      let row = out[out.length - 1];
      if (!row || row.num !== num) {
        row = { num };
        out.push(row);
      }
      if (m.plyIndex % 2 === 0) row.white = m;
      else row.black = m;
    }
    return out;
  }, [result.moveReviews]);

  const currentPly = useMemo(() => {
    if (!currentNodeId || !result.reviewedNodeIds) return -1;
    return result.reviewedNodeIds.indexOf(currentNodeId);
  }, [currentNodeId, result.reviewedNodeIds]);

  // Keep the active row visible while navigating (board keys, eval graph, playback).
  useEffect(() => {
    const el = listRef.current?.querySelector('.rml-half.is-current');
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentPly]);

  const jump = (plyIndex: number) => {
    const nodeId = getNodeIdAtPly(moveTree, plyIndex + 1, result.reviewedNodeIds);
    if (nodeId) useGameStore.getState().goToNode(nodeId);
  };

  if (rows.length === 0) return null;

  return (
    <div className="rml-root" ref={listRef} aria-label="Reviewed moves">
      {rows.map((row) => (
        <div key={row.num} className="rml-row">
          <span className="rml-num">{row.num}.</span>
          <HalfMove
            review={row.white}
            isCurrent={row.white !== undefined && currentPly === row.white.plyIndex + 1}
            onClick={() => row.white && jump(row.white.plyIndex)}
          />
          <HalfMove
            review={row.black}
            isCurrent={row.black !== undefined && currentPly === row.black.plyIndex + 1}
            onClick={() => row.black && jump(row.black.plyIndex)}
          />
        </div>
      ))}
    </div>
  );
}
