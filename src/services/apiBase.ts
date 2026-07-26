/**
 * API base resolution + sticky failover.
 *
 * Dual-deploy topology: the persistent Render server is the PRIMARY API host
 * (set via VITE_API_BASE_URL in .env.production); the Vercel serverless
 * function behind same-origin `/api` is the FALLBACK. When the primary is
 * unreachable (cold start not yet warmed, outage, DNS), the client fails over
 * stickily to `/api` and re-probes the primary every 5 minutes to switch back.
 *
 * Contract: VITE_API_BASE_URL is the FULL base including the `/api` path
 * (e.g. https://grandforge-api.onrender.com/api). A bare origin gets `/api`
 * appended. Unset / empty / '/api' → same-origin only, no failover machinery
 * (local dev and the Playwright suite take this path).
 */

export interface ApiBases {
  primary: string;
  fallback: string | null;
}

export function resolveApiBases(raw: string | undefined): ApiBases {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/api') return { primary: '/api', fallback: null };

  let primary = trimmed;
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') primary = `${url.origin}/api`;
  } catch {
    // Not an absolute URL (unusual, e.g. another relative path) — use as-is.
  }
  return { primary, fallback: '/api' };
}

/**
 * Failover only on failures that mean "this HOST is unreachable", never on
 * application responses: a 4xx/5xx from the API itself would just repeat on
 * the fallback (same code, same DB) and duplicate non-idempotent work.
 * 502/503/504 come from the platform's proxy when the service is down/cold.
 */
export function isFailoverEligible(
  error: { response?: { status?: number } } | null | undefined
): boolean {
  const status = error?.response?.status;
  if (typeof status !== 'number') return true; // network error / timeout / CORS
  return status === 502 || status === 503 || status === 504;
}

// ── Sticky runtime state ────────────────────────────────────────────────────

const BASES: ApiBases = resolveApiBases(import.meta.env.VITE_API_BASE_URL as string | undefined);

let activeBase = BASES.primary;
let reprobeTimer: ReturnType<typeof setTimeout> | null = null;

export function getApiBases(): ApiBases {
  return BASES;
}

export function getActiveApiBase(): string {
  return activeBase;
}

export function markPrimaryFailed(): void {
  if (!BASES.fallback || activeBase === BASES.fallback) return;
  console.warn(
    `[GrandForge] API primary ${BASES.primary} unreachable — failing over to same-origin ${BASES.fallback}`
  );
  activeBase = BASES.fallback;
  scheduleReprobe();
}

function scheduleReprobe(): void {
  if (reprobeTimer) return;
  reprobeTimer = setTimeout(async () => {
    reprobeTimer = null;
    if (await probe(BASES.primary)) {
      activeBase = BASES.primary;
      console.info('[GrandForge] API primary recovered — switching back');
    } else {
      scheduleReprobe();
    }
  }, 5 * 60 * 1000);
}

async function probe(base: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Boot-time probe: decides primary-vs-fallback within ~4 s instead of letting
 * the first real request eat the cold-start wait, and doubles as the warm-up
 * ping that wakes a sleeping Render instance. No-op when there is no fallback
 * (same-origin deployments, dev, tests).
 */
export function initApiBaseProbe(): void {
  if (typeof window === 'undefined' || !BASES.fallback) return;
  void probe(BASES.primary).then((ok) => {
    if (!ok) markPrimaryFailed();
  });
}
