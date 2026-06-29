// src/components/import/ImportTab.tsx
import { useState } from 'react';
import { Globe, FileText, Hash, Download } from 'lucide-react';
import Tabs, { type TabItem } from '../ui/Tabs';
import { UsernameImport } from './UsernameImport';
import { PGNImport } from './PGNImport';
import { FENImport } from './FENImport';
import { PGNExport } from './PGNExport';

type ImportSubTab = 'online' | 'pgn' | 'fen' | 'export';

const TABS: TabItem[] = [
  { id: 'online', label: 'Online', icon: <Globe size={14} /> },
  { id: 'pgn', label: 'PGN', icon: <FileText size={14} /> },
  { id: 'fen', label: 'FEN', icon: <Hash size={14} /> },
  { id: 'export', label: 'Export', icon: <Download size={14} /> },
];

export function ImportTab() {
  const [active, setActive] = useState<ImportSubTab>('online');

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 shrink-0">
        <Tabs
          tabs={TABS}
          activeId={active}
          onChange={(id) => setActive(id as ImportSubTab)}
          fullWidth
          size="sm"
        />
      </div>

      <div
        className="flex-1 overflow-y-auto p-3"
        role="tabpanel"
        id={`panel-import-${active}`}
        aria-labelledby={`tab-${active}`}
      >
        {active === 'online' && <UsernameImport />}
        {active === 'pgn' && <PGNImport />}
        {active === 'fen' && <FENImport />}
        {active === 'export' && <PGNExport />}
      </div>
    </div>
  );
}

export default ImportTab;
