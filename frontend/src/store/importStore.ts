import { create } from 'zustand';
import type { IndexedGame } from '../services/GameEngineAdapter';
import {
  fetchChessComGames,
  fetchLichessGames,
  type ImportedGameClientSide,
  type PlayerProfileClientSide,
} from '../services/chessApiClient';

export type ImportPlatform = 'chesscom' | 'lichess';
export type GameType =
  | 'all'
  | 'ultraBullet'
  | 'bullet'
  | 'blitz'
  | 'rapid'
  | 'classical'
  | 'correspondence'
  | 'daily'
  | 'chess960'
  | 'antichess'
  | 'atomic'
  | 'horde'
  | 'kingOfTheHill'
  | 'racingKings'
  | 'crazyhouse'
  | 'threeCheck';

export interface PlayerProfile {
  username: string;
  platform: ImportPlatform;
  rating?: number;
  title?: string;
  country?: string;
  avatarUrl?: string;
  totalGames?: number;
  url?: string;
}

interface ImportState {
  games: IndexedGame[];
  playerProfile: PlayerProfile | null;
  isLoading: boolean;
  error: string | null;
  platform: ImportPlatform;
  chesscomUsername: string;
  lichessUsername: string;
  gameType: GameType;
  count: number;

  setPlatform: (p: ImportPlatform) => void;
  setChesscomUsername: (u: string) => void;
  setLichessUsername: (u: string) => void;
  setGameType: (g: GameType) => void;
  setCount: (n: number) => void;
  fetchGames: () => Promise<void>;
  clearResults: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  games: [],
  playerProfile: null,
  isLoading: false,
  error: null,
  platform: 'chesscom',
  chesscomUsername: '',
  lichessUsername: '',
  gameType: 'all',
  count: 20,

  setPlatform: (p) => set({ platform: p }),
  setChesscomUsername: (u) => set({ chesscomUsername: u }),
  setLichessUsername: (u) => set({ lichessUsername: u }),
  setGameType: (g) => set({ gameType: g }),
  setCount: (n) => set({ count: Math.max(1, Math.min(200, Number.isFinite(n) ? n : 20)) }),

  fetchGames: async () => {
    const { platform, gameType, count } = get();
    const username = (platform === 'chesscom' ? get().chesscomUsername : get().lichessUsername).trim();
    if (!username) {
      set({ error: 'Username required' });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      let result: { games: ImportedGameClientSide[]; profile: PlayerProfileClientSide };
      if (platform === 'chesscom') {
        result = await fetchChessComGames(username, {
          type: gameType === 'all' ? undefined : gameType,
          count,
        });
      } else {
        result = await fetchLichessGames(username, {
          perfType: gameType === 'all' ? undefined : gameType,
          count,
        });
      }
      set({
        games: result.games as unknown as IndexedGame[],
        playerProfile: result.profile,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch games';
      set({ isLoading: false, error: message, games: [], playerProfile: null });
    }
  },

  clearResults: () =>
    set({ games: [], playerProfile: null, error: null, isLoading: false }),
}));
