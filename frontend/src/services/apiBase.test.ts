import { describe, expect, it } from 'vitest';
import { isFailoverEligible, resolveApiBases } from './apiBase';

describe('resolveApiBases', () => {
  it('defaults to same-origin with no fallback when unset', () => {
    expect(resolveApiBases(undefined)).toEqual({ primary: '/api', fallback: null });
    expect(resolveApiBases('')).toEqual({ primary: '/api', fallback: null });
    expect(resolveApiBases('   ')).toEqual({ primary: '/api', fallback: null });
  });

  it('treats an explicit /api as same-origin (no failover machinery)', () => {
    expect(resolveApiBases('/api')).toEqual({ primary: '/api', fallback: null });
  });

  it('uses a remote base as primary with same-origin fallback', () => {
    expect(resolveApiBases('https://grandforge-api.onrender.com/api')).toEqual({
      primary: 'https://grandforge-api.onrender.com/api',
      fallback: '/api',
    });
  });

  it('appends /api when the URL has no path', () => {
    expect(resolveApiBases('https://grandforge-api.onrender.com')).toEqual({
      primary: 'https://grandforge-api.onrender.com/api',
      fallback: '/api',
    });
  });

  it('strips trailing slashes', () => {
    expect(resolveApiBases('https://grandforge-api.onrender.com/api/')).toEqual({
      primary: 'https://grandforge-api.onrender.com/api',
      fallback: '/api',
    });
  });
});

describe('isFailoverEligible', () => {
  it('is true for network-level failures (no response)', () => {
    expect(isFailoverEligible({})).toBe(true);
    expect(isFailoverEligible(null)).toBe(true);
    expect(isFailoverEligible(undefined)).toBe(true);
  });

  it('is true for gateway errors from a cold or dead host', () => {
    expect(isFailoverEligible({ response: { status: 502 } })).toBe(true);
    expect(isFailoverEligible({ response: { status: 503 } })).toBe(true);
    expect(isFailoverEligible({ response: { status: 504 } })).toBe(true);
  });

  it('is false for application-level responses — the API answered', () => {
    for (const status of [400, 401, 403, 404, 429, 500]) {
      expect(isFailoverEligible({ response: { status } })).toBe(false);
    }
  });

  // backend-audit F14: a deploy that boots without MONGODB_URI answers /health
  // with a 500 while the proxy stays green. Without this branch the client
  // sticks to a primary where every request fails.
  it('is true for a 5xx on /health — the host is up but the deploy is broken', () => {
    expect(
      isFailoverEligible({ response: { status: 500 }, config: { url: 'https://x/api/health' } })
    ).toBe(true);
    expect(isFailoverEligible({ response: { status: 500 }, config: { url: '/health' } })).toBe(true);
    expect(isFailoverEligible({ response: { status: 503 }, config: { url: '/health' } })).toBe(true);
    expect(
      isFailoverEligible({ response: { status: 500 }, config: { url: '/health?probe=1' } })
    ).toBe(true);
  });

  it('keeps a plain 500 on a non-health URL non-eligible', () => {
    expect(
      isFailoverEligible({ response: { status: 500 }, config: { url: '/games/upload' } })
    ).toBe(false);
    // Not a health endpoint despite the substring.
    expect(
      isFailoverEligible({ response: { status: 500 }, config: { url: '/positions/healthcheck' } })
    ).toBe(false);
  });

  it('keeps 4xx on /health non-eligible — the deploy answered, it is not a host outage', () => {
    expect(isFailoverEligible({ response: { status: 404 }, config: { url: '/health' } })).toBe(
      false
    );
    expect(isFailoverEligible({ response: { status: 429 }, config: { url: '/health' } })).toBe(
      false
    );
  });
});
