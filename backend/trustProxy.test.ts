import { describe, expect, it } from 'vitest';
import { isPublicIp, trustProxyHops } from './trustProxy';

describe('trustProxyHops', () => {
  it('trusts 3 hops on Render (measured: client, Cloudflare, internal LB)', () => {
    expect(trustProxyHops({ RENDER: 'true' })).toBe(3);
  });

  it('falls back to 1 off Render, including Vercel', () => {
    expect(trustProxyHops({})).toBe(1);
    expect(trustProxyHops({ VERCEL: '1' })).toBe(1);
  });

  it('lets TRUST_PROXY_HOPS override the platform default', () => {
    expect(trustProxyHops({ RENDER: 'true', TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: '0' })).toBe(0);
  });

  it('ignores an unset, empty or malformed override rather than trusting 0 hops', () => {
    // A bad value must not silently collapse to NaN/0 — that would key every
    // request to the socket address behind a proxy.
    expect(trustProxyHops({ RENDER: 'true', TRUST_PROXY_HOPS: '' })).toBe(3);
    expect(trustProxyHops({ RENDER: 'true', TRUST_PROXY_HOPS: 'abc' })).toBe(3);
    expect(trustProxyHops({ RENDER: 'true', TRUST_PROXY_HOPS: '-1' })).toBe(3);
    expect(trustProxyHops({ RENDER: 'true', TRUST_PROXY_HOPS: '1.5' })).toBe(3);
  });
});

describe('isPublicIp', () => {
  it('accepts routable addresses', () => {
    // The real values observed in the live X-Forwarded-For chain.
    expect(isPublicIp('43.231.242.190')).toBe(true);
    expect(isPublicIp('172.71.198.11')).toBe(true);
    expect(isPublicIp('172.32.0.1')).toBe(true); // just outside 172.16/12
  });

  it('rejects the private ranges a wrong hop count would surface', () => {
    expect(isPublicIp('10.26.103.129')).toBe(false); // Render internal LB
    expect(isPublicIp('192.168.1.5')).toBe(false);
    expect(isPublicIp('172.16.0.1')).toBe(false);
    expect(isPublicIp('172.31.255.1')).toBe(false);
    expect(isPublicIp('169.254.1.1')).toBe(false); // link-local
    expect(isPublicIp('100.64.0.1')).toBe(false); // CGNAT
  });

  it('rejects loopback in both IPv4 and express IPv4-mapped-IPv6 form', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('::1')).toBe(false);
    expect(isPublicIp('::ffff:127.0.0.1')).toBe(false);
  });

  it('unwraps IPv4-mapped IPv6 before judging', () => {
    expect(isPublicIp('::ffff:43.231.242.190')).toBe(true);
    expect(isPublicIp('::ffff:10.0.0.1')).toBe(false);
  });

  it('rejects IPv6 ULA and link-local, accepts global IPv6', () => {
    expect(isPublicIp('fc00::1')).toBe(false);
    expect(isPublicIp('fe80::1')).toBe(false);
    expect(isPublicIp('2606:4700::1111')).toBe(true);
  });

  it('treats a missing ip as not public', () => {
    expect(isPublicIp(undefined)).toBe(false);
    expect(isPublicIp(null)).toBe(false);
    expect(isPublicIp('')).toBe(false);
  });
});
