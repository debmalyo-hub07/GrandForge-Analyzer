// src/components/review/EvalGraph.tsx
// Evaluation graph for a completed game review (chess.com / lichess style).
// White-relative eval per ply as a filled area over a mid-line; key moments
// (blunders, mistakes, brilliants, misses) get colored dots. Click / drag to
// jump to a ply along the reviewed line.
import { useMemo, useRef, useState } from 'react';
import type { GameReviewResult, MoveReview } from '../../types/review';
import { useGameStore, getNodeIdAtPly } from '../../store/gameStore';

const W = 100; // viewBox width (percentage space)
const H = 34; // viewBox height
const CLAMP_CP = 800; // evals beyond ±8.00 flatten toward the edge
const MATE_CP = 1000;

// Same palette as ReviewSummaryCard / glyphs.
const DOT_COLORS: Partial<Record<MoveReview['classification'], string>> = {
  brilliant: '#1baca6',
  great: '#5c8bb0',
  miss: '#e05a5a',
  mistake: '#e68f39',
  blunder: '#ca3431',
};

/** Mover-relative eval → White-relative centipawns (mate folded to ±MATE_CP). */
function whiteCpAfter(m: MoveReview): number {
  const moverIsWhite = m.plyIndex % 2 === 0;
  const cp = m.mateAfter !== null ? Math.sign(m.mateAfter) * MATE_CP : m.evalAfter;
  return moverIsWhite ? cp : -cp;
}

/** cp → y coordinate. Uses tanh-like squash so ±200cp fills most of the band. */
function cpToY(cp: number): number {
  const clamped = Math.max(-CLAMP_CP, Math.min(CLAMP_CP, cp));
  const norm = Math.tanh(clamped / 350); // -1..1, ±350cp ≈ 75% of half-band
  return H / 2 - norm * (H / 2 - 1.5);
}

export function EvalGraph({ result }: { result: GameReviewResult }) {
  const moveTree = useGameStore((s) => s.moveTree);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverPly, setHoverPly] = useState<number | null>(null);

  const reviews = result.moveReviews;
  const plyCount = reviews.length;

  // x position for the eval point AFTER ply i (ply 0 = start position at x=0).
  const xAt = (plyAfter: number) => (plyCount === 0 ? 0 : (plyAfter / plyCount) * W);

  const { areaPath, linePath, points } = useMemo(() => {
    const pts: Array<{ x: number; y: number; m: MoveReview }> = [];
    let d = `M 0 ${cpToY(20).toFixed(2)}`; // slight white edge at start
    for (const m of reviews) {
      const x = xAt(m.plyIndex + 1);
      const y = cpToY(whiteCpAfter(m));
      d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      pts.push({ x, y, m });
    }
    return {
      linePath: d,
      areaPath: `${d} L ${W} ${H} L 0 ${H} Z`, // white fills BELOW the curve: white better → curve up → big white area
      points: pts,
    };
  }, [reviews, plyCount]);

  // Current ply along the reviewed line (for the cursor). Index in
  // reviewedNodeIds == plies from root; -1 when off the reviewed line.
  const currentPly = useMemo(() => {
    if (!currentNodeId || !result.reviewedNodeIds) return -1;
    return result.reviewedNodeIds.indexOf(currentNodeId);
  }, [currentNodeId, result.reviewedNodeIds]);

  const jumpToPly = (ply: number) => {
    const nodeId = getNodeIdAtPly(moveTree, ply, result.reviewedNodeIds);
    if (nodeId) useGameStore.getState().goToNode(nodeId);
  };

  const plyFromEvent = (e: React.MouseEvent<SVGSVGElement>): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || plyCount === 0) return 0;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(frac * plyCount);
  };

  if (plyCount === 0) return null;

  const hovered = hoverPly !== null && hoverPly > 0 ? reviews[hoverPly - 1] : null;

  return (
    <div className="eval-graph" aria-label="Evaluation graph">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="eval-graph-svg"
        role="slider"
        aria-label="Game evaluation by move — click to jump to a move"
        aria-valuemin={0}
        aria-valuemax={plyCount}
        aria-valuenow={currentPly >= 0 ? currentPly : 0}
        tabIndex={0}
        onClick={(e) => jumpToPly(plyFromEvent(e))}
        onMouseMove={(e) => setHoverPly(plyFromEvent(e))}
        onMouseLeave={() => setHoverPly(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') jumpToPly(Math.min(plyCount, (currentPly < 0 ? 0 : currentPly) + 1));
          if (e.key === 'ArrowLeft') jumpToPly(Math.max(0, (currentPly < 0 ? 0 : currentPly) - 1));
        }}
      >
        {/* black background = black's share; white area fills on top */}
        <rect x={0} y={0} width={W} height={H} className="eval-graph-bg" />
        <path d={areaPath} className="eval-graph-area" />
        <path d={linePath} className="eval-graph-line" vectorEffect="non-scaling-stroke" />
        {/* mid line (equal eval) */}
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="eval-graph-mid" vectorEffect="non-scaling-stroke" />
        {/* key-moment dots */}
        {points.map(({ x, y, m }) => {
          const color = DOT_COLORS[m.classification];
          if (!color) return null;
          return (
            <circle
              key={m.plyIndex}
              cx={x}
              cy={y}
              r={1.4}
              fill={color}
              className="eval-graph-dot"
            />
          );
        })}
        {/* hover cursor */}
        {hoverPly !== null && hoverPly > 0 && (
          <line
            x1={xAt(hoverPly)} y1={0} x2={xAt(hoverPly)} y2={H}
            className="eval-graph-hover" vectorEffect="non-scaling-stroke"
          />
        )}
        {/* current-move cursor */}
        {currentPly > 0 && (
          <line
            x1={xAt(currentPly)} y1={0} x2={xAt(currentPly)} y2={H}
            className="eval-graph-cursor" vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="eval-graph-caption">
        {hovered ? (
          <>
            <span className="eval-graph-caption-move">
              {Math.floor(hovered.plyIndex / 2) + 1}
              {hovered.plyIndex % 2 === 0 ? '. ' : '… '}
              {hovered.san}
            </span>
            <span className="eval-graph-caption-eval">
              {hovered.mateAfter !== null
                ? `M${Math.abs(hovered.mateAfter)}`
                : `${whiteCpAfter(hovered) >= 0 ? '+' : ''}${(whiteCpAfter(hovered) / 100).toFixed(2)}`}
            </span>
          </>
        ) : (
          <span className="eval-graph-caption-hint">Click the graph to jump to a move</span>
        )}
      </div>
    </div>
  );
}
