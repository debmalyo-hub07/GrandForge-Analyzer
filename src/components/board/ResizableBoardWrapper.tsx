import { useEffect } from 'react';
import { useBoardSize } from '../../hooks/useBoardSize';
import { useUIStore } from '../../store/uiStore';
import { ChessBoardWrapper } from './ChessBoardWrapper';

export function ResizableBoardWrapper() {
  const { containerRef, boardSize } = useBoardSize<HTMLDivElement>();
  const updateBoardSize = useUIStore((s) => s.updateBoardSize);

  useEffect(() => {
    updateBoardSize(boardSize);
  }, [boardSize, updateBoardSize]);

  return (
    <div
      ref={containerRef}
      className="resizable-board-wrapper relative w-full aspect-square flex items-center justify-center"
    >
      <ChessBoardWrapper boardSize={boardSize} />
    </div>
  );
}

export default ResizableBoardWrapper;
