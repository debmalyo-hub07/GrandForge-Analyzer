import { describe, expect, it } from 'vitest';
import { buildAllowedOrigins } from './corsOrigins';

describe('buildAllowedOrigins', () => {
  it('always includes the local dev and preview origins', () => {
    expect(buildAllowedOrigins({})).toEqual([
      'http://localhost:5173',
      'http://localhost:4173',
    ]);
  });

  it('puts FRONTEND_URL first when set', () => {
    expect(buildAllowedOrigins({ FRONTEND_URL: 'https://grand-forge-analyzer.vercel.app' })).toEqual([
      'https://grand-forge-analyzer.vercel.app',
      'http://localhost:5173',
      'http://localhost:4173',
    ]);
  });

  it('parses CORS_EXTRA_ORIGINS as a CSV, trimming and dropping empties', () => {
    const origins = buildAllowedOrigins({
      CORS_EXTRA_ORIGINS: ' https://a.example , ,https://b.example,',
    });
    expect(origins).toEqual([
      'https://a.example',
      'https://b.example',
      'http://localhost:5173',
      'http://localhost:4173',
    ]);
  });

  it('strips trailing slashes so browser Origin headers match exactly', () => {
    const origins = buildAllowedOrigins({ FRONTEND_URL: 'https://site.example/' });
    expect(origins[0]).toBe('https://site.example');
  });

  it('dedupes overlapping sources', () => {
    const origins = buildAllowedOrigins({
      FRONTEND_URL: 'https://site.example',
      CORS_EXTRA_ORIGINS: 'https://site.example/,http://localhost:5173',
    });
    expect(origins).toEqual([
      'https://site.example',
      'http://localhost:5173',
      'http://localhost:4173',
    ]);
  });
});
