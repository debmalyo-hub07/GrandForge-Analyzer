/**
 * How many proxies sit in front of this process — express's `trust proxy` hop
 * count. Measured per platform, never assumed: express counts hops from the
 * RIGHT of X-Forwarded-For, and BOTH directions of error fail silently.
 *
 *   too low  → `req.ip` is a proxy address, so every client shares one
 *              rate-limit bucket and one user can exhaust it for everybody.
 *   too high → express clamps to the LEFTMOST entry, which is client-supplied,
 *              so a caller can pick its own rate-limit key just by sending an
 *              X-Forwarded-For header. Strictly worse than too low.
 *
 * Render — measured against a live GET /api/health/deep, chain was
 *   `<client>, <cloudflare edge>, <render internal 10.x LB>` → 3 hops.
 *   The 10.x address also rotates between requests, so trusting 1 hop keyed
 *   rate limits to a moving target.
 *
 * Vercel — NOT measured. The serverless function is currently returning
 *   FUNCTION_INVOCATION_FAILED, so there is no live response to read a chain
 *   from. Left at the historical 1 until it can be measured the same way;
 *   under-trusting is the safer of the two wrong answers.
 *
 * TRUST_PROXY_HOPS overrides both, so a platform changing its edge topology can
 * be corrected from the dashboard without a deploy.
 */
/**
 * Does this look like a routable public address? Used by the deep health check
 * to assert the hop count is right: if `req.ip` is private or loopback, a proxy
 * address is being used as the rate-limit key.
 *
 * Deliberately coarse — an allow-list of "definitely not a real client" ranges,
 * not a validator. A false "public" is fine (the number is still checked by
 * hand); a false "private" would be a misleading alarm.
 */
export function isPublicIp(ip: string | undefined | null): boolean {
  if (!ip) return false;
  // Express reports IPv4-mapped IPv6 as ::ffff:a.b.c.d
  const v4 = ip.replace(/^::ffff:/i, '');
  if (v4 === '::1' || v4 === '127.0.0.1') return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (!m) return !/^(f[cd]|fe80)/i.test(v4); // IPv6: exclude ULA + link-local
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 169 && b === 254) return false; // link-local
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  return true;
}

export function trustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  // process.env.RENDER is set to 'true' by Render on every service.
  if (env.RENDER) return 3;
  return 1;
}
