import { useMemo, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGameStore, getMainlinePath, getPathToNode } from '../../store/gameStore';
import { buildShareUrl } from '../../utils/shareLink';

type CopyKind = 'url' | 'pgn' | 'fen';

/**
 * Share the current analysis as a link, or copy the raw PGN / FEN.
 *
 * The link encodes the position in the URL rather than saving a record, so it
 * works for anonymous visitors, needs no database row, and cannot break when a
 * game is pruned. Encoding rules (including the long-game FEN fallback) live in
 * utils/shareLink.ts.
 */
export function ShareLink() {
  const moveTree = useGameStore((s) => s.moveTree);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const currentFen = useGameStore((s) => s.currentFen);
  const [copied, setCopied] = useState<CopyKind | null>(null);

  // Share the line the user is actually looking at. getPathToNode walks the
  // current line (variations included); the mainline is the fallback when there
  // is no cursor yet.
  const { sanMoves, ply } = useMemo(() => {
    const path = currentNodeId
      ? getPathToNode(moveTree, currentNodeId)
      : getMainlinePath(moveTree);
    const moves = path
      .map((id) => moveTree.nodes[id])
      .filter((n) => n && n.parentId !== null)
      .map((n) => n.san);
    return { sanMoves: moves, ply: moves.length };
  }, [moveTree, currentNodeId]);

  const shareUrl = useMemo(() => {
    const base =
      typeof window === 'undefined'
        ? 'https://grandforge.app/'
        : `${window.location.origin}${window.location.pathname}`;
    return buildShareUrl(base, { sanMoves, ply, fen: currentFen });
  }, [sanMoves, ply, currentFen]);

  const copy = async (kind: CopyKind, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success(`${label} copied`);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1600);
    } catch {
      // Clipboard is unavailable on insecure origins and in some embedded
      // webviews. The input below is selectable, so say that rather than failing
      // silently.
      toast.error('Clipboard blocked — select the link and copy manually');
    }
  };

  const pgnText = sanMoves.length > 0 ? sanMoves.join(' ') : '';

  return (
    <div className="share-link flex flex-col gap-3">
      <header className="import-section-header">
        <h3 className="import-section-title">Share this analysis</h3>
        <p className="import-section-hint">
          The link carries the position itself, so anyone can open it — no account needed.
        </p>
      </header>

      <label htmlFor="gf-share-url" className="fen-import-label">
        Link
      </label>
      <div className="flex items-center gap-2">
        <input
          id="gf-share-url"
          type="text"
          className="fen-import-input flex-1"
          value={shareUrl}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          onClick={() => void copy('url', shareUrl, 'Link')}
          aria-label="Copy share link"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        >
          {copied === 'url' ? <Check size={13} /> : <Link2 size={13} />}
          {copied === 'url' ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={pgnText.length === 0}
          onClick={() => void copy('pgn', pgnText, 'PGN')}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied === 'pgn' ? <Check size={13} /> : <Copy size={13} />}
          Copy moves
        </button>
        <button
          type="button"
          onClick={() => void copy('fen', currentFen, 'FEN')}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        >
          {copied === 'fen' ? <Check size={13} /> : <Copy size={13} />}
          Copy FEN
        </button>
      </div>
    </div>
  );
}

export default ShareLink;
