import type { Square } from 'chess.js';
import { BookOpen, Loader2 } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { useExplorer } from '../../hooks/useExplorer';
import {
  formatGameCount,
  formatPlayer,
  formatShare,
  scorePercent,
  sortMoves,
  sortTopGames,
  wdlPercents,
} from '../../utils/explorerFormat';
import type { ExplorerMove, ExplorerNode, ExplorerOpening, ExplorerTopGame } from '../../types/explorer';

/**
 * The Explore tab: what the corpus says about the position on the board.
 *
 * Reads our own aggregate (`GET /api/explorer/lookup`) — no third-party service
 * is contacted here, and nothing in this UI names or links to one.
 *
 * `active` gates the fetch: the panel only asks when the user is looking at it.
 */
export function ExplorePanel({ active = true }: { active?: boolean }) {
  const { data, isLoading, isError, isBeyondBook } = useExplorer(active);
  const makeMove = useGameStore((s) => s.makeMove);

  const playUci = (uci: string) => {
    if (uci.length < 4) return;
    makeMove({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
  };

  return (
    <div className="explore-panel flex flex-col gap-3">
      <TheorySection opening={data?.opening ?? null} />

      {isError ? (
        <EmptyState
          title="Couldn't reach the database"
          detail="The position statistics are unavailable right now. Analysis and review are unaffected."
        />
      ) : isBeyondBook ? (
        <EmptyState
          title="Past the opening"
          detail="The database covers opening theory. Step back toward the start to see statistics again."
        />
      ) : isLoading && !data ? (
        <LoadingState />
      ) : data?.node ? (
        <>
          <PositionSummary node={data.node} />
          <MoveTable moves={data.node.moves} onPlay={playUci} />
          <TopGames games={data.node.topGames} />
        </>
      ) : (
        <EmptyState
          title="No games from this position"
          detail="Nobody in the database has reached it. That usually means the line left known theory a move or two ago."
        />
      )}
    </div>
  );
}

/* ── Theory ─────────────────────────────────────────────────────────────── */

function TheorySection({ opening }: { opening: ExplorerOpening | null }) {
  if (!opening) return null;

  return (
    <section className="explore-theory rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 rounded bg-[var(--gold-glow)] px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-[var(--text-accent)]">
          {opening.ecoCode}
        </span>
        <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)]">
          {opening.name}
        </h3>
      </div>
      {/* Prose is our own, written per opening; most rows don't have it yet. */}
      {opening.description && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          {opening.description}
        </p>
      )}
    </section>
  );
}

/* ── Position summary ───────────────────────────────────────────────────── */

function PositionSummary({ node }: { node: ExplorerNode }) {
  const score = scorePercent(node.white, node.draws, node.black);

  return (
    <section className="explore-summary flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">
            {formatGameCount(node.total)}
          </span>{' '}
          {node.total === 1 ? 'game' : 'games'}
        </span>
        <span className="flex items-center gap-3 text-[var(--text-muted)]">
          {node.avgElo !== null && <span>avg {node.avgElo}</span>}
          {score !== null && (
            <span title="White's score: a draw counts a half point">
              White scores <span className="text-[var(--text-secondary)]">{score}%</span>
            </span>
          )}
        </span>
      </div>
      <WdlBar white={node.white} draws={node.draws} black={node.black} height="h-4" showLabels />
    </section>
  );
}

/* ── Move table ─────────────────────────────────────────────────────────── */

function MoveTable({ moves, onPlay }: { moves: ExplorerMove[]; onPlay: (uci: string) => void }) {
  if (moves.length === 0) return null;

  return (
    <section className="explore-moves flex flex-col">
      <div className="flex items-center gap-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        <span className="w-12">Move</span>
        <span className="w-16 text-right">Games</span>
        <span className="flex-1 pl-2">Result</span>
      </div>

      {sortMoves(moves).map((move) => (
        <button
          key={move.uci}
          type="button"
          onClick={() => onPlay(move.uci)}
          title={`Play ${move.san} — ${move.total.toLocaleString()} games`}
          className="explore-move group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
        >
          <span className="w-12 shrink-0 font-mono text-sm font-semibold text-[var(--text-primary)]">
            {move.san}
          </span>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-[var(--text-secondary)]">
            {formatGameCount(move.total)}
            <span className="ml-1 text-[var(--text-muted)]">{formatShare(move.share)}</span>
          </span>
          <span className="flex-1 pl-2">
            <WdlBar white={move.white} draws={move.draws} black={move.black} height="h-3" />
          </span>
        </button>
      ))}
    </section>
  );
}

/* ── W/D/L bar ──────────────────────────────────────────────────────────── */

function WdlBar({
  white,
  draws,
  black,
  height,
  showLabels = false,
}: {
  white: number;
  draws: number;
  black: number;
  height: string;
  showLabels?: boolean;
}) {
  const pct = wdlPercents(white, draws, black);
  const total = white + draws + black;
  if (total <= 0) return null;

  // The colours are the eval-bar's, so "white's share" reads the same way it
  // does everywhere else in the app.
  const segments = [
    { key: 'white', width: pct.white, bg: 'var(--eval-white)', fg: '#1c1c20', label: `${pct.white}%` },
    { key: 'draws', width: pct.draws, bg: 'var(--bg-active)', fg: 'var(--text-secondary)', label: `${pct.draws}%` },
    { key: 'black', width: pct.black, bg: 'var(--eval-black)', fg: '#ede8dc', label: `${pct.black}%` },
  ];

  return (
    <div
      className={`explore-wdl flex ${height} w-full overflow-hidden rounded-sm border border-[var(--border)]`}
      role="img"
      aria-label={`White wins ${pct.white}%, draws ${pct.draws}%, black wins ${pct.black}%`}
    >
      {segments.map((s) =>
        s.width > 0 ? (
          <div
            key={s.key}
            className="flex items-center justify-center overflow-hidden text-[9px] font-semibold leading-none"
            style={{ width: `${s.width}%`, background: s.bg, color: s.fg }}
          >
            {/* Only label a segment wide enough to hold the text without clipping. */}
            {showLabels && s.width >= 12 ? s.label : null}
          </div>
        ) : null
      )}
    </div>
  );
}

/* ── Representative games ───────────────────────────────────────────────── */

function TopGames({ games }: { games: ExplorerTopGame[] }) {
  if (games.length === 0) return null;

  return (
    <section className="explore-topgames flex flex-col gap-1 border-t border-[var(--border)] pt-2">
      <h4 className="px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Notable games
      </h4>
      {sortTopGames(games).map((game, i) => (
        <div
          key={`${game.white}-${game.black}-${game.year}-${i}`}
          className="flex items-baseline justify-between gap-2 px-2 py-1 text-xs"
        >
          <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
            {formatPlayer(game.white, game.whiteElo)}
            <span className="mx-1 text-[var(--text-muted)]">vs</span>
            {formatPlayer(game.black, game.blackElo)}
          </span>
          <span className="shrink-0 font-mono text-[var(--text-muted)]">
            {game.result}
            {game.year > 0 && <span className="ml-1.5">{game.year}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}

/* ── States ─────────────────────────────────────────────────────────────── */

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--text-muted)]">
      <Loader2 size={14} className="animate-spin" />
      Looking up the position…
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <BookOpen size={20} className="text-[var(--text-muted)]" />
      <p className="text-xs font-semibold text-[var(--text-secondary)]">{title}</p>
      <p className="max-w-[36ch] text-xs leading-relaxed text-[var(--text-muted)]">{detail}</p>
    </div>
  );
}

export default ExplorePanel;
