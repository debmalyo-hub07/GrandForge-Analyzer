import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { MoveNodeGlyph } from '../review/ReviewMoveGlyph';

export interface MoveNodeProps {
  plyIndex: number;
  san: string;
  nodeId: string;
  isMainline: boolean;
  isCurrent: boolean;
}

export const MoveNode = React.memo(function MoveNode({
  plyIndex,
  san,
  nodeId,
  isMainline,
  isCurrent,
}: MoveNodeProps) {
  const goToNode = useGameStore((s) => s.goToNode);

  return (
    <button
      type="button"
      onClick={() => goToNode(nodeId)}
      data-ply={plyIndex}
      data-node-id={nodeId}
      className={`move-node inline-flex items-baseline rounded px-1.5 py-0.5 text-sm leading-snug transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${
        isCurrent
          ? 'bg-[var(--gold-glow)] text-[var(--text-accent)] font-semibold'
          : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      } ${isMainline ? '' : 'italic'}`}
    >
      <span className="move-san font-mono">{san}</span>
      <MoveNodeGlyph plyIndex={plyIndex} />
    </button>
  );
});

export default MoveNode;
