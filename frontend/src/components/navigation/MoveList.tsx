import { useEffect, useMemo, useRef } from 'react';
import { useGameStore, getMainlinePath } from '../../store/gameStore';
import { useUIStore } from '../../store/uiStore';
import type { MoveNode as MoveNodeData } from '../../types/moveTree';
import { MoveNode } from './MoveNode';

interface MainlinePair {
  moveNumber: number;
  white: MoveNodeData | null;
  black: MoveNodeData | null;
  whiteVariations: MoveNodeData[][];
  blackVariations: MoveNodeData[][];
}

function buildVariationLine(
  startNodeId: string,
  nodes: Record<string, MoveNodeData>,
): MoveNodeData[] {
  const line: MoveNodeData[] = [];
  let current: MoveNodeData | undefined = nodes[startNodeId];
  while (current) {
    line.push(current);
    if (current.children.length === 0) break;
    const nextId: string = current.children[0];
    current = nodes[nextId];
  }
  return line;
}

function buildPairs(
  mainlineIds: string[],
  nodes: Record<string, MoveNodeData>,
): MainlinePair[] {
  const moves = mainlineIds
    .slice(1)
    .map((id) => nodes[id])
    .filter((n): n is MoveNodeData => Boolean(n));

  const pairsByMoveNumber = new Map<number, MainlinePair>();
  const parentIdsOnMainline = new Set(mainlineIds);

  for (const m of moves) {
    let pair = pairsByMoveNumber.get(m.moveNumber);
    if (!pair) {
      pair = {
        moveNumber: m.moveNumber,
        white: null,
        black: null,
        whiteVariations: [],
        blackVariations: [],
      };
      pairsByMoveNumber.set(m.moveNumber, pair);
    }
    if (m.color === 'w') pair.white = m;
    else pair.black = m;

    const parent = m.parentId ? nodes[m.parentId] : null;
    if (parent && parentIdsOnMainline.has(parent.id)) {
      const siblings = parent.children.slice(1);
      for (const sibId of siblings) {
        const line = buildVariationLine(sibId, nodes);
        if (line.length === 0) continue;
        if (m.color === 'w') pair.whiteVariations.push(line);
        else pair.blackVariations.push(line);
      }
    }
  }

  return Array.from(pairsByMoveNumber.values()).sort(
    (a, b) => a.moveNumber - b.moveNumber,
  );
}

export function MoveList() {
  const moveTree = useGameStore((s) => s.moveTree);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const variationOpacity = useUIStore((s) => s.variationOpacity);
  const disclosureButtons = useUIStore((s) => s.disclosureButtons);

  const listRef = useRef<HTMLDivElement>(null);

  const pairs = useMemo(() => {
    const mainline = getMainlinePath(moveTree);
    return buildPairs(mainline, moveTree.nodes);
  }, [moveTree]);

  // FE-2: scroll the active move row into view on navigation. Keyed on the
  // current node id so it fires for keyboard nav, board moves, and clicks alike.
  // `block: 'nearest'` keeps it from yanking the list when the row is already
  // visible, so it doesn't fight the user's manual scroll.
  useEffect(() => {
    if (!currentNodeId) return;
    const container = listRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(
      `[data-node-id="${currentNodeId}"]`,
    );
    active?.scrollIntoView({ block: 'nearest' });
  }, [currentNodeId]);

  const variationStyle = { opacity: Math.max(0, Math.min(100, variationOpacity)) / 100 };

  if (pairs.length === 0) {
    return (
      <div className="move-list-empty px-4 py-6 text-center text-xs italic text-[var(--text-muted)]">
        No moves played yet — make a move on the board.
      </div>
    );
  }

  return (
    <div ref={listRef} className="move-list overflow-y-auto">
      <table className="mainline w-full border-collapse text-sm">
        <tbody>
          {pairs.map((pair) => (
            <tr
              key={pair.moveNumber}
              className="border-b border-[var(--border)]/50"
            >
              <td className="move-number w-9 px-2 py-1 text-right font-mono text-xs text-[var(--text-muted)] align-top">
                {pair.moveNumber}.
              </td>
              <td className="white-move px-1 py-1 align-top">
                {pair.white && (
                  <MoveNode
                    plyIndex={pair.white.plyNumber - 1}
                    san={pair.white.san}
                    nodeId={pair.white.id}
                    isMainline
                    isCurrent={currentNodeId === pair.white.id}
                  />
                )}
                {disclosureButtons && pair.whiteVariations.length > 0 && (
                  <div
                    className="variations mt-1 flex flex-col gap-0.5 pl-2 border-l-2 border-[var(--border)]"
                    style={variationStyle}
                  >
                    {pair.whiteVariations.map((line, i) => (
                      <VariationLine
                        key={`wv-${pair.moveNumber}-${i}`}
                        line={line}
                        currentNodeId={currentNodeId}
                      />
                    ))}
                  </div>
                )}
              </td>
              <td className="black-move px-1 py-1 align-top">
                {pair.black && (
                  <MoveNode
                    plyIndex={pair.black.plyNumber - 1}
                    san={pair.black.san}
                    nodeId={pair.black.id}
                    isMainline
                    isCurrent={currentNodeId === pair.black.id}
                  />
                )}
                {disclosureButtons && pair.blackVariations.length > 0 && (
                  <div
                    className="variations mt-1 flex flex-col gap-0.5 pl-2 border-l-2 border-[var(--border)]"
                    style={variationStyle}
                  >
                    {pair.blackVariations.map((line, i) => (
                      <VariationLine
                        key={`bv-${pair.moveNumber}-${i}`}
                        line={line}
                        currentNodeId={currentNodeId}
                      />
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VariationLine({
  line,
  currentNodeId,
}: {
  line: MoveNodeData[];
  currentNodeId: string | null;
}) {
  // ST-3: indent by MoveNode.depth (0 = mainline, +1 per nesting level). The
  // surrounding cell already renders the first variation level (border + pl-2),
  // so we add extra indentation only for deeper nesting (depth > 1) and let it
  // scale linearly with depth.
  const depth = line[0]?.depth ?? 1;
  const extraIndentRem = Math.max(0, depth - 1) * 0.75;

  return (
    <div
      className="variation-line italic flex flex-wrap items-baseline gap-x-1 text-[var(--text-secondary)]"
      style={extraIndentRem > 0 ? { paddingLeft: `${extraIndentRem}rem` } : undefined}
    >
      {line.map((node, idx) => {
        const showMoveNumber =
          idx === 0 || node.color === 'w';
        return (
          <span key={node.id} className="inline-flex items-baseline gap-1">
            {showMoveNumber && (
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {node.moveNumber}
                {node.color === 'w' ? '.' : '...'}
              </span>
            )}
            <MoveNode
              plyIndex={node.plyNumber - 1}
              san={node.san}
              nodeId={node.id}
              isMainline={false}
              isCurrent={currentNodeId === node.id}
            />
          </span>
        );
      })}
    </div>
  );
}

export default MoveList;
