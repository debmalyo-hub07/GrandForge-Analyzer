/**
 * Dispatch-table order test.
 *
 * The consolidated router matches request paths against an ordered regex table
 * (backend/router.ts). Literal paths MUST precede the `[^/]+` param patterns
 * that would otherwise swallow them — /api/games/upload before /api/games/:id,
 * /api/review/save before /api/review/:gameId, and so on. That ordering is
 * invisible at the call site and silently breaks a route if someone appends a
 * new entry in the wrong place, so it is asserted here directly: resolve each
 * path the way the dispatcher does and check the handler identity.
 *
 * Pure: no server, no listen, no DB. Importing the table does import all 25
 * route modules, which build their express apps at module scope — none of them
 * connect to Mongo until a request arrives.
 */
import { describe, it, expect } from 'vitest';

import { routes } from './router';
import gamesById from './routes/games/[id]';
import gamesIndex from './routes/games/index';
import gamesUpload from './routes/games/upload';
import masterById from './routes/master/[id]';
import masterGames from './routes/master/games';
import reviewByGameId from './routes/review/[gameId]';
import reviewJob from './routes/review/job';
import reviewSave from './routes/review/save';
import sessionsById from './routes/sessions/[id]';
import sessionsCreate from './routes/sessions/create';
import sessionsIndex from './routes/sessions/index';

/** Exactly what the dispatcher at the end of router.ts does. */
function resolve(path: string): unknown {
  const match = routes.find(([pattern]) => pattern.test(path));
  return match?.[1];
}

describe('router dispatch table', () => {
  it.each([
    ['/api/games/upload', gamesUpload],
    ['/api/review/save', reviewSave],
    ['/api/review/job', reviewJob],
    ['/api/sessions/create', sessionsCreate],
    ['/api/master/games', masterGames],
  ])('%s resolves to its own module, not a param pattern', (path, expected) => {
    expect(resolve(path)).toBe(expected);
  });

  it.each([
    ['/api/games/68a1f0c2e1b4d5a6c7089123', gamesById],
    ['/api/review/68a1f0c2e1b4d5a6c7089123', reviewByGameId],
    ['/api/sessions/68a1f0c2e1b4d5a6c7089123', sessionsById],
    ['/api/master/games/68a1f0c2e1b4d5a6c7089123', masterById],
  ])('%s still reaches the param route', (path, expected) => {
    expect(resolve(path)).toBe(expected);
  });

  it.each([
    ['/api/games', gamesIndex],
    ['/api/games/', gamesIndex],
    ['/api/sessions', sessionsIndex],
  ])('%s reaches the collection route', (path, expected) => {
    expect(resolve(path)).toBe(expected);
  });

  it.each([
    '/api/nope',
    '/api/games/upload/extra',
    '/api/',
    '/api/health', // handled by the outer app.get before the dispatcher
    '/not-api-at-all',
  ])('%s matches nothing (falls through to the JSON 404)', (path) => {
    expect(resolve(path)).toBeUndefined();
  });

  it('every literal entry precedes the param pattern that would shadow it', () => {
    const indexOf = (pattern: string): number =>
      routes.findIndex(([re]) => re.source === pattern);
    const pairs: Array<[string, string]> = [
      ['^\\/api\\/games\\/upload\\/?$', '^\\/api\\/games\\/[^/]+\\/?$'],
      ['^\\/api\\/review\\/save\\/?$', '^\\/api\\/review\\/[^/]+\\/?$'],
      ['^\\/api\\/review\\/job\\/?$', '^\\/api\\/review\\/[^/]+\\/?$'],
      ['^\\/api\\/sessions\\/create\\/?$', '^\\/api\\/sessions\\/[^/]+\\/?$'],
      ['^\\/api\\/master\\/games\\/[^/]+\\/?$', '^\\/api\\/master\\/games\\/?$'],
    ];
    for (const [literal, param] of pairs) {
      const literalAt = indexOf(literal);
      const paramAt = indexOf(param);
      expect(literalAt, `missing entry ${literal}`).toBeGreaterThanOrEqual(0);
      expect(paramAt, `missing entry ${param}`).toBeGreaterThanOrEqual(0);
      expect(literalAt).toBeLessThan(paramAt);
    }
  });

  it('no two entries share a handler and none is unreachable', () => {
    const reached = new Set<unknown>();
    for (const [pattern, handler] of routes) {
      // Every registered pattern must be the FIRST match for some path it
      // accepts; build a representative path from the pattern's literal form.
      const sample = pattern.source
        .replace(/^\^/, '')
        .replace(/\\\/\?\$$/, '')
        .replace(/\\\//g, '/')
        .replace(/\[\^\/\]\+/g, 'x');
      expect(resolve(sample), `unreachable: ${pattern.source}`).toBe(handler);
      reached.add(handler);
    }
    expect(reached.size).toBe(routes.length);
  });
});
