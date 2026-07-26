// src/services/apiClient.ts
import axios, { AxiosInstance } from 'axios';
import {
  getActiveApiBase,
  getApiBases,
  initApiBaseProbe,
  isFailoverEligible,
  markPrimaryFailed,
} from './apiBase';

const TOKEN_KEY = 'grandforge_token';

export const apiClient: AxiosInstance = axios.create({
  baseURL: getActiveApiBase(),
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  // Re-read per request: failover may have moved the active base.
  config.baseURL = getActiveApiBase();
  const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// Sticky failover: a request that failed at the transport/gateway level is
// replayed ONCE against the same-origin fallback; subsequent requests go
// straight there (see apiBase.ts for the recovery re-probe).
apiClient.interceptors.response.use(undefined, (error) => {
  const { fallback } = getApiBases();
  const config = error?.config as (typeof error)['config'] & { _gfRetried?: boolean };
  // Guard on where THIS request went (config.baseURL, stamped at dispatch),
  // not on the global sticky state: of N concurrent requests that all failed
  // against the primary, every one must replay on the fallback — the first
  // flips the sticky state, and the rest would otherwise be rejected outright.
  if (
    fallback &&
    config &&
    !config._gfRetried &&
    config.baseURL !== fallback &&
    isFailoverEligible(error)
  ) {
    markPrimaryFailed();
    config._gfRetried = true;
    config.baseURL = getActiveApiBase();
    return apiClient.request(config);
  }
  return Promise.reject(error);
});

initApiBaseProbe();

export function setAuthToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────────────────────
export const auth = {
  register: (body: { email: string; username: string; password: string }) =>
    apiClient.post('/auth/register', body).then(r => r.data),

  login: (body: { email: string; password: string }) =>
    apiClient.post('/auth/login', body).then(r => r.data),

  me: () =>
    apiClient.get('/auth/me').then(r => r.data),

  updatePreferences: (preferences: Record<string, unknown>) =>
    apiClient.put('/auth/preferences', preferences).then(r => r.data),
};

// ────────────────────────────────────────────────────────────────────────────
// Sessions
// ────────────────────────────────────────────────────────────────────────────
export const sessions = {
  list: (params?: { page?: number; limit?: number; sort?: string }) =>
    apiClient.get('/sessions', { params }).then(r => r.data),

  create: (body: { pgn: string; title?: string; metadata?: Record<string, unknown> }) =>
    apiClient.post('/sessions/create', body).then(r => r.data),

  get: (id: string) =>
    apiClient.get(`/sessions/${id}`).then(r => r.data),

  update: (id: string, body: Record<string, unknown>) =>
    apiClient.put(`/sessions/${id}`, body).then(r => r.data),

  delete: (id: string) =>
    apiClient.delete(`/sessions/${id}`).then(r => r.data),
};

// ────────────────────────────────────────────────────────────────────────────
// Games
// ────────────────────────────────────────────────────────────────────────────
export const games = {
  upload: (body: { pgn: string }) =>
    apiClient.post('/games/upload', body).then(r => r.data),

  list: (params?: { page?: number; limit?: number; source?: string }) =>
    apiClient.get('/games', { params }).then(r => r.data),

  get: (id: string) =>
    apiClient.get(`/games/${id}`).then(r => r.data),

  delete: (id: string) =>
    apiClient.delete(`/games/${id}`).then(r => r.data),
};

// ────────────────────────────────────────────────────────────────────────────
// Import (external sources)
// ────────────────────────────────────────────────────────────────────────────
export const importApi = {
  chesscom: (params: { username: string; type?: string; count?: number }) =>
    apiClient.get('/import/chesscom', { params }).then(r => r.data),

  lichess: (params: { username: string; perfType?: string; count?: number }) =>
    apiClient.get('/import/lichess', { params }).then(r => r.data),
};
export { importApi as import };

// ────────────────────────────────────────────────────────────────────────────
// Review
// ────────────────────────────────────────────────────────────────────────────
export const review = {
  save: (body: { gameId?: string; sessionId?: string; reviewResult: unknown }) =>
    apiClient.post('/review/save', body).then(r => r.data),

  get: (gameId: string) =>
    apiClient.get(`/review/${gameId}`).then(r => r.data),
};

// ────────────────────────────────────────────────────────────────────────────
// Openings
// ────────────────────────────────────────────────────────────────────────────
export const openings = {
  lookup: (params: { moves: string }) =>
    apiClient.get('/openings/lookup', { params }).then(r => r.data),

  search: (params: { q: string }) =>
    apiClient.get('/openings/search', { params }).then(r => r.data),
};

// ────────────────────────────────────────────────────────────────────────────
// Positions
// ────────────────────────────────────────────────────────────────────────────
export const positions = {
  eval: (params: { fen: string; engine?: string }) =>
    apiClient.get('/positions/eval', { params }).then(r => r.data),

  cache: (body: {
    fen: string;
    engineVersion: string;
    depth: number;
    evaluation: unknown;
    lines: unknown;
  }) =>
    apiClient.post('/positions/cache', body).then(r => r.data),
};

// ────────────────────────────────────────────────────────────────────────────
// Master games
// ────────────────────────────────────────────────────────────────────────────
export const master = {
  list: (params?: { ecoCode?: string; player?: string; featured?: boolean; limit?: number }) =>
    apiClient.get('/master/games', { params }).then(r => r.data),

  get: (id: string) =>
    apiClient.get(`/master/games/${id}`).then(r => r.data),
};

// ────────────────────────────────────────────────────────────────────────────
// Review Jobs
// ────────────────────────────────────────────────────────────────────────────
export interface ReviewJobUpsert {
  clientJobId: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  depth: number;
  engineVersion: string;
  gameId?: string;
  progress?: { currentPly: number; totalPlies: number; percent: number };
  errorMessage?: string;
  resultRef?: { kind: 'game' | 'session'; id: string };
}

export const reviewJobs = {
  upsert: (body: ReviewJobUpsert) =>
    apiClient.post('/review/job', body).then(r => r.data),

  get: (clientJobId: string) =>
    apiClient.get('/review/job', { params: { clientJobId } }).then(r => r.data),
};

export default apiClient;
