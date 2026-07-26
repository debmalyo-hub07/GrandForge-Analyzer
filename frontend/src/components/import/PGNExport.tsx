// src/components/import/PGNExport.tsx
import toast from 'react-hot-toast';
import { useGameStore, getMainlinePath } from '../../store/gameStore';

function buildPgnHeaders(meta: Record<string, string | number | undefined>): string {
  const headerKeys: Array<[string, string | number | undefined]> = [
    ['Event', meta.event],
    ['Site', meta.site],
    ['Date', meta.date],
    ['White', meta.white],
    ['Black', meta.black],
    ['Result', meta.result ?? '*'],
    ['WhiteElo', meta.whiteElo],
    ['BlackElo', meta.blackElo],
    ['TimeControl', meta.timeControl],
    ['ECO', meta.ecoCode],
    ['Opening', meta.opening],
    ['Variant', meta.variant],
  ];
  return headerKeys
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `[${k} "${String(v).replace(/"/g, '\\"')}"]`)
    .join('\n');
}

function buildPgnMoves(sanMoves: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < sanMoves.length; i++) {
    if (i % 2 === 0) {
      out.push(`${Math.floor(i / 2) + 1}.`);
    }
    out.push(sanMoves[i]);
  }
  return out.join(' ');
}

export function PGNExport() {
  const moveTree = useGameStore((s) => s.moveTree);
  const gameMetadata = useGameStore((s) => s.gameMetadata);

  const handleDownload = () => {
    const path = getMainlinePath(moveTree);
    const sanMoves = path
      .map((id) => moveTree.nodes[id])
      .filter((n) => n && n.parentId !== null)
      .map((n) => n.san);

    if (sanMoves.length === 0) {
      toast.error('No moves to export');
      return;
    }

    const meta = (gameMetadata ?? {}) as Record<string, string | number | undefined>;
    const result = meta.result ?? '*';
    const headers = buildPgnHeaders(meta);
    const movesBlock = `${buildPgnMoves(sanMoves)} ${result}`.trim();
    const pgn = `${headers}\n\n${movesBlock}\n`;

    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeWhite = (meta.white ?? 'white').toString().replace(/\W+/g, '_');
    const safeBlack = (meta.black ?? 'black').toString().replace(/\W+/g, '_');
    a.download = `grandforge_${safeWhite}_vs_${safeBlack}.pgn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('PGN downloaded');
  };

  return (
    <div className="pgn-export">
      <header className="import-section-header">
        <h3 className="import-section-title">Export current game</h3>
        <p className="import-section-hint">
          Download the current mainline as a <code>.pgn</code> file.
        </p>
      </header>

      <button type="button" className="pgn-export-submit" onClick={handleDownload}>
        Download PGN
      </button>
    </div>
  );
}
