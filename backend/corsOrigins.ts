/**
 * CORS origin allowlist for the API.
 *
 * Same-origin deployments (Vercel serverless behind the frontend domain) never
 * exercise CORS, but the persistent Render server is a cross-origin host: the
 * browser sends `Origin: https://<frontend>` and the `cors` middleware must
 * echo it back. Sources, in order:
 *   1. FRONTEND_URL            — the production frontend origin
 *   2. CORS_EXTRA_ORIGINS      — comma-separated additional origins (previews…)
 *   3. localhost dev + preview — always allowed; harmless in production since
 *      the API is public and auth rides on Bearer tokens, not cookies.
 *
 * Trailing slashes are stripped because browser Origin headers never carry one.
 */
const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

export function buildAllowedOrigins(env: Record<string, string | undefined>): string[] {
  const raw = [
    env.FRONTEND_URL ?? '',
    ...(env.CORS_EXTRA_ORIGINS ?? '').split(','),
    ...LOCAL_ORIGINS,
  ];
  const origins: string[] = [];
  for (const entry of raw) {
    const origin = entry.trim().replace(/\/+$/, '');
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}
