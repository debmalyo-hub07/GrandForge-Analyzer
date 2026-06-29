import { ReactNode, useMemo } from 'react';
import { LineChart, ListOrdered, Sparkles, Upload } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useReviewStore } from '../../store/reviewStore';
import Tabs, { type TabItem } from '../ui/Tabs';

export interface SidePanelProps {
  analysis: ReactNode;
  moves: ReactNode;
  review: ReactNode;
  importPanel: ReactNode;
}

type TabId = 'analysis' | 'moves' | 'review' | 'import';

export function SidePanel({ analysis, moves, review, importPanel }: SidePanelProps) {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const isReviewMode = useReviewStore((s) => s.isReviewMode);

  // Lock to Review tab during playback so engine clutter cannot leak in.
  const effectiveTab: TabId = isReviewMode ? 'review' : activeTab;

  const tabs: TabItem[] = useMemo(
    () => [
      { id: 'analysis', label: 'Analysis', icon: <LineChart size={14} /> },
      { id: 'moves', label: 'Moves', icon: <ListOrdered size={14} /> },
      { id: 'review', label: 'Review', icon: <Sparkles size={14} /> },
      { id: 'import', label: 'Import', icon: <Upload size={14} /> },
    ],
    []
  );

  const panel: Record<TabId, ReactNode> = {
    analysis,
    moves,
    review,
    import: importPanel,
  };

  const handleChange = (id: string) => {
    if (isReviewMode && id !== 'review') return;
    setActiveTab(id as TabId);
  };

  return (
    <div className="side-panel flex flex-col h-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="overflow-x-auto whitespace-nowrap">
        <Tabs
          tabs={tabs}
          activeId={effectiveTab}
          onChange={handleChange}
          fullWidth
          size="md"
        />
      </div>
      <div
        role="tabpanel"
        id={`panel-${effectiveTab}`}
        aria-labelledby={`tab-${effectiveTab}`}
        className="flex-1 overflow-y-auto p-3"
      >
        {panel[effectiveTab]}
      </div>
    </div>
  );
}

export default SidePanel;
