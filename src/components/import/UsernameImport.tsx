import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { useImportStore, type GameType } from '../../store/importStore';
import { useGameStore } from '../../store/gameStore';
import { PlayerProfileCard } from './PlayerProfileCard';
import { ImportedGameCard } from './ImportedGameCard';

const CHESSCOM_TYPES: { value: GameType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bullet', label: 'Bullet' },
  { value: 'blitz', label: 'Blitz' },
  { value: 'rapid', label: 'Rapid' },
  { value: 'classical', label: 'Classical (long rapid)' },
  { value: 'daily', label: 'Daily' },
  { value: 'chess960', label: 'Chess960' },
];

const LICHESS_TYPES: { value: GameType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ultraBullet', label: 'UltraBullet' },
  { value: 'bullet', label: 'Bullet' },
  { value: 'blitz', label: 'Blitz' },
  { value: 'rapid', label: 'Rapid' },
  { value: 'classical', label: 'Classical' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'chess960', label: 'Chess960' },
  { value: 'antichess', label: 'Antichess' },
  { value: 'atomic', label: 'Atomic' },
  { value: 'horde', label: 'Horde' },
  { value: 'kingOfTheHill', label: 'King of the Hill' },
  { value: 'racingKings', label: 'Racing Kings' },
  { value: 'crazyhouse', label: 'Crazyhouse' },
  { value: 'threeCheck', label: 'Three-Check' },
];

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-secondary)]">{label}</label>
      {children}
    </div>
  );
}

export function UsernameImport() {
  const chesscomUsername = useImportStore((s) => s.chesscomUsername);
  const lichessUsername = useImportStore((s) => s.lichessUsername);
  const setChesscomUsername = useImportStore((s) => s.setChesscomUsername);
  const setLichessUsername = useImportStore((s) => s.setLichessUsername);
  const gameType = useImportStore((s) => s.gameType);
  const count = useImportStore((s) => s.count);
  const platform = useImportStore((s) => s.platform);
  const games = useImportStore((s) => s.games);
  const playerProfile = useImportStore((s) => s.playerProfile);
  const isLoading = useImportStore((s) => s.isLoading);
  const error = useImportStore((s) => s.error);
  const setPlatform = useImportStore((s) => s.setPlatform);
  const setGameType = useImportStore((s) => s.setGameType);
  const setCount = useImportStore((s) => s.setCount);
  const fetchGames = useImportStore((s) => s.fetchGames);
  const loadIndexedGame = useGameStore((s) => s.loadIndexedGame);

  useEffect(() => { if (error) toast.error(error); }, [error]);

  const handleFetch = (p: 'chesscom' | 'lichess') => {
    setPlatform(p);
    // Allow store mutation to propagate before fetching.
    setTimeout(() => { void fetchGames(); }, 0);
  };

  const inputCls = 'w-full px-3 py-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] focus:border-[var(--gold)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-glow)] text-sm';
  const btnCls = 'w-full px-3 py-2 rounded-md bg-[var(--gold)] text-[#1a1814] font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col gap-6 p-4">
      <header>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Import games by username</h3>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Pull recent games from Chess.com or Lichess. No account needed.
        </p>
      </header>

      {/* Chess.com */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-[var(--text-primary)]">Chess.com</span>
          <span className="text-[10px] text-[var(--text-muted)] font-mono">api.chess.com</span>
        </div>
        <FieldRow label="Username">
          <input className={inputCls} value={chesscomUsername} onChange={(e) => setChesscomUsername(e.target.value)} placeholder="magnuscarlsen" spellCheck={false} autoComplete="off" />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Game type">
            <select className={inputCls} value={platform === 'chesscom' ? gameType : 'all'} onChange={(e) => { setPlatform('chesscom'); setGameType(e.target.value as GameType); }}>
              {CHESSCOM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Count (1-200)">
            <input type="number" min={1} max={200} className={inputCls} value={count} onChange={(e) => setCount(parseInt(e.target.value || '20', 10))} />
          </FieldRow>
        </div>
        <button className={btnCls} disabled={isLoading || !chesscomUsername.trim()} onClick={() => handleFetch('chesscom')}>
          {isLoading && platform === 'chesscom' ? 'Fetching…' : 'Fetch Chess.com games'}
        </button>
      </section>

      {/* Lichess */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-[var(--text-primary)]">Lichess</span>
          <span className="text-[10px] text-[var(--text-muted)] font-mono">lichess.org</span>
        </div>
        <FieldRow label="Username">
          <input className={inputCls} value={lichessUsername} onChange={(e) => setLichessUsername(e.target.value)} placeholder="DrNykterstein" spellCheck={false} autoComplete="off" />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Game type">
            <select className={inputCls} value={platform === 'lichess' ? gameType : 'all'} onChange={(e) => { setPlatform('lichess'); setGameType(e.target.value as GameType); }}>
              {LICHESS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Count (1-200)">
            <input type="number" min={1} max={200} className={inputCls} value={count} onChange={(e) => setCount(parseInt(e.target.value || '20', 10))} />
          </FieldRow>
        </div>
        <button className={btnCls} disabled={isLoading || !lichessUsername.trim()} onClick={() => handleFetch('lichess')}>
          {isLoading && platform === 'lichess' ? 'Fetching…' : 'Fetch Lichess games'}
        </button>
      </section>

      {playerProfile && <PlayerProfileCard profile={playerProfile} />}

      {games.length > 0 && (
        <div className="flex flex-col gap-1.5 max-h-[480px] overflow-y-auto pr-1">
          {games.map((g: any, i: number) => (
            <ImportedGameCard
              key={g._id ?? `${i}-${g.pgn.slice(0, 24)}`}
              game={g}
              onClick={() => loadIndexedGame(g)}
            />
          ))}
        </div>
      )}

      {!isLoading && !error && games.length === 0 && (chesscomUsername || lichessUsername) && (
        <p className="text-xs text-[var(--text-muted)] italic text-center">No games to display yet. Click Fetch on a platform above.</p>
      )}
    </div>
  );
}
