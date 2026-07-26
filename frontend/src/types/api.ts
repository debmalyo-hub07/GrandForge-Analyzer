export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PlayerProfile {
  username: string;
  platform: 'chesscom' | 'lichess';
  rating?: {
    bullet?: number;
    blitz?: number;
    rapid?: number;
    classical?: number;
  };
  country?: string;
  title?: string;
  avatarUrl?: string;
  url?: string;
}

export interface ImportResponse<TGame = unknown> {
  games: TGame[];
  playerProfile: PlayerProfile;
  totalFetched: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AuthUser {
  _id: string;
  email: string;
  username: string;
  createdAt: string;
  preferences: Record<string, unknown>;
  stats?: Record<string, unknown>;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}
