import { ReactNode } from 'react';
import { useAutoAnalysis } from '../../hooks/useAutoAnalysis';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';

export interface AnalyzerLayoutProps {
  evalBar: ReactNode;
  board: ReactNode;
  sidePanel: ReactNode;
}

/**
 * Three-column grid: [eval bar | board | side panel].
 * Mounts the global useAutoAnalysis and useKeyboardNav hooks once so any page
 * embedding this layout gets live engine analysis and keyboard navigation.
 */
export function AnalyzerLayout({ evalBar, board, sidePanel }: AnalyzerLayoutProps) {
  useAutoAnalysis();
  useKeyboardNav();

  return (
    <div
      className="analyzer-layout grid items-start gap-4 px-4 sm:px-6 py-4 max-w-[1200px] mx-auto"
    >
      <div className="eval-bar-vertical-wrap eval-bar-slot flex flex-col items-stretch h-full min-h-[400px]">
        {evalBar}
      </div>

      <div className="board-slot flex flex-col gap-2">{board}</div>

      <aside className="side-panel-slot flex flex-col h-full min-h-[400px]">
        {sidePanel}
      </aside>
    </div>
  );
}

export default AnalyzerLayout;
