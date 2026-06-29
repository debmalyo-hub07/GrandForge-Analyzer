// Direct browser-to-Chess.com / Lichess API client (CORS-open).
import { Chess } from 'chess.js';

export interface RawImportedGame {
  pgn: string;
  source: 'chesscom' | 'lichess';
  sourceGameId: string;
  sourceUrl?: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;
  timeControl?: string;
  endTime?: number;
  timeClass?: string;
  rated?: boolean;
}

export interface ImportedGameClientSide extends RawImportedGame {
  fenPositions: string[];
  moveUciList: string[];
  moveSanList: string[];
  plyCount: number;
  engineReady: true;
  metadata: {
    white: string;
    black: string;
    whiteElo?: number;
    blackElo?: number;
    result: string;
    timeControl?: string;
    source: 'chesscom' | 'lichess';
    sourceGameId: string;
    sourceUrl?: string;
    importedAt: Date;
  };
  _id?: string;
}

export interface PlayerProfileClientSide {
  username: string;
  platform: 'chesscom' | 'lichess';
  rating?: number;
  title?: string;
  country?: string;
  avatarUrl?: string;
  totalGames?: number;
  url?: string;
}

const CHESSCOM_BASE = 'https://api.chess.com/pub';

export async function fetchChessComGames(
  username: string,
  opts: { type?: string; count: number }
): Promise<{ games: ImportedGameClientSide[]; profile: PlayerProfileClientSide }> {
  if (!username.trim()) throw new Error('Username required');
  const u = encodeURIComponent(username.trim().toLowerCase());

  const profileRes = await fetch(`${CHESSCOM_BASE}/player/${u}`);
  if (profileRes.status === 404) throw new Error(`Chess.com user "${username}" not found`);
  if (!profileRes.ok) throw new Error(`Chess.com profile fetch failed: ${profileRes.status}`);
  const profile: any = await profileRes.json();

  let rating: number | undefined;
  try {
    const statsRes = await fetch(`${CHESSCOM_BASE}/player/${u}/stats`);
    if (statsRes.ok) {
      const stats: any = await statsRes.json();
      rating = stats.chess_rapid?.last?.rating ?? stats.chess_blitz?.last?.rating ?? stats.chess_bullet?.last?.rating;
    }
  } catch {}

  const archivesRes = await fetch(`${CHESSCOM_BASE}/player/${u}/games/archives`);
  if (!archivesRes.ok) throw new Error('Chess.com archives fetch failed');
  const archivesJson: { archives: string[] } = await archivesRes.json();
  const recent = (archivesJson.archives ?? []).slice(-4).reverse();

  const collected: any[] = [];
  for (const archiveUrl of recent) {
    if (collected.length >= opts.count * 3) break;
    try {
      const r = await fetch(archiveUrl);
      if (!r.ok) continue;
      const m: any = await r.json();
      collected.push(...((m.games ?? []) as any[]).reverse());
    } catch {}
  }

  const wantType = (opts.type ?? '').toLowerCase();
  const filtered = collected.filter((g: any) => {
    if (!wantType || wantType === 'all') return true;
    if (wantType === 'classical') return g.time_class === 'rapid' && parseTimeControlSeconds(g.time_control) >= 1800;
    return g.time_class === wantType;
  }).slice(0, opts.count);

  const games = filtered.map((g: any) => buildIndexedGame({
    pgn: g.pgn,
    source: 'chesscom',
    sourceGameId: g.uuid ?? g.url.split('/').pop() ?? `${g.end_time}`,
    sourceUrl: g.url,
    white: g.white.username,
    black: g.black.username,
    whiteElo: g.white.rating,
    blackElo: g.black.rating,
    result: chessComResultToPgn(g.white.result, g.black.result),
    timeControl: g.time_control,
    timeClass: g.time_class,
    endTime: g.end_time,
    rated: g.rated,
  }));

  return {
    games: games.filter((g): g is ImportedGameClientSide => g !== null),
    profile: {
      username: profile.username,
      platform: 'chesscom',
      rating,
      title: profile.title,
      country: profile.country,
      avatarUrl: profile.avatar,
      url: profile.url,
    },
  };
}

function parseTimeControlSeconds(tc?: string): number {
  if (!tc) return 0;
  const base = parseInt(tc.split('+')[0], 10);
  return Number.isFinite(base) ? base : 0;
}

function chessComResultToPgn(w: string, b: string): string {
  if (w === 'win') return '1-0';
  if (b === 'win') return '0-1';
  return '1/2-1/2';
}

const LICHESS_BASE = 'https://lichess.org';

export async function fetchLichessGames(
  username: string,
  opts: { perfType?: string; count: number }
): Promise<{ games: ImportedGameClientSide[]; profile: PlayerProfileClientSide }> {
  if (!username.trim()) throw new Error('Username required');
  const u = encodeURIComponent(username.trim());

  const userRes = await fetch(`${LICHESS_BASE}/api/user/${u}`);
  if (userRes.status === 404) throw new Error(`Lichess user "${username}" not found`);
  if (!userRes.ok) throw new Error(`Lichess profile fetch failed: ${userRes.status}`);
  const user: any = await userRes.json();

  const params = new URLSearchParams();
  params.set('max', String(opts.count));
  params.set('pgnInJson', 'true');
  params.set('clocks', 'false');
  params.set('evals', 'false');
  if (opts.perfType && opts.perfType !== 'all') params.set('perfType', opts.perfType);

  const gamesRes = await fetch(`${LICHESS_BASE}/api/games/user/${u}?${params}`, {
    headers: { Accept: 'application/x-ndjson' },
  });
  if (!gamesRes.ok) throw new Error(`Lichess games fetch failed: ${gamesRes.status}`);
  const text = await gamesRes.text();
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const raw = lines.map((l) => JSON.parse(l) as any);

  const games = raw.map((g: any) => {
    const wName = g.players.white.user?.name ?? 'White';
    const bName = g.players.black.user?.name ?? 'Black';
    const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
    const tcStr = g.clock ? `${g.clock.initial}+${g.clock.increment}` : undefined;
    return buildIndexedGame({
      pgn: g.pgn ?? '',
      source: 'lichess',
      sourceGameId: g.id,
      sourceUrl: `${LICHESS_BASE}/${g.id}`,
      white: wName,
      black: bName,
      whiteElo: g.players.white.rating,
      blackElo: g.players.black.rating,
      result,
      timeControl: tcStr,
      timeClass: g.speed,
      endTime: Math.floor(g.createdAt / 1000),
      rated: g.rated,
    });
  });

  const rating = user.perfs?.classical?.rating ?? user.perfs?.rapid?.rating ?? user.perfs?.blitz?.rating ?? user.perfs?.bullet?.rating;

  return {
    games: games.filter((g): g is ImportedGameClientSide => g !== null),
    profile: {
      username: user.username,
      platform: 'lichess',
      rating,
      title: user.title,
      country: user.profile?.country,
      totalGames: user.count?.all,
      url: `${LICHESS_BASE}/@/${user.username}`,
    },
  };
}

function buildIndexedGame(raw: RawImportedGame): ImportedGameClientSide | null {
  if (!raw.pgn || raw.pgn.length < 20) return null;
  try {
    const chess = new Chess();
    chess.loadPgn(raw.pgn);
    const history = chess.history({ verbose: true });
    const replay = new Chess();
    const fenPositions: string[] = [replay.fen()];
    const moveUciList: string[] = [];
    const moveSanList: string[] = [];
    for (const m of history) {
      replay.move(m.san);
      fenPositions.push(replay.fen());
      moveUciList.push(`${m.from}${m.to}${(m as any).promotion ?? ''}`);
      moveSanList.push(m.san);
    }
    return {
      ...raw,
      fenPositions,
      moveUciList,
      moveSanList,
      plyCount: moveUciList.length,
      engineReady: true,
      metadata: {
        white: raw.white,
        black: raw.black,
        whiteElo: raw.whiteElo,
        blackElo: raw.blackElo,
        result: raw.result,
        timeControl: raw.timeControl,
        source: raw.source,
        sourceGameId: raw.sourceGameId,
        sourceUrl: raw.sourceUrl,
        importedAt: new Date(),
      },
      _id: `client-${raw.source}-${raw.sourceGameId}`,
    };
  } catch {
    return null;
  }
}
