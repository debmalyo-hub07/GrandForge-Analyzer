/**
 * GrandForge — persistent API server entry (Render primary; also local dev).
 * Imports the SAME consolidated Express app the Vercel serverless function
 * (api/[...path].ts) re-exports, so both deployments run one identical
 * routing table (backend/router.ts).
 */
import mongoose from 'mongoose';
import app from './router';
import { loadLocalEnv } from './db';

/**
 * Boot-time environment assert — fail loud instead of serving a green
 * /api/health with no working config.
 *
 * MONGODB_URI, JWT_SECRET and ADMIN_KEY are `sync: false` in render.yaml, i.e.
 * hand-entered in the dashboard. Without this check a typo produces a service
 * that health-checks green while every authenticated request 401s (requireAuth
 * swallows the getJwtSecret throw) and every anonymous request proceeds as
 * logged out — indistinguishable from a logged-out user. Combined with the
 * client's failover rules (only 502/503/504 and transport errors fail over) a
 * misconfigured deploy is also un-failoverable, so it has to die at boot.
 *
 * Skipped under NODE_ENV=test so unit tests can import this module.
 */
if (process.env.NODE_ENV !== 'test') {
  loadLocalEnv();
  const problems: string[] = [];
  if (!process.env.MONGODB_URI?.trim()) {
    problems.push('MONGODB_URI is missing or empty');
  }
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    problems.push(
      `JWT_SECRET must be at least 32 characters (got ${jwtSecret.length})`
    );
  }
  if (problems.length > 0) {
    console.error('GrandForge API refusing to start — invalid environment:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('Set these in the Render dashboard (or repo-root .env locally), then redeploy.');
    process.exit(1);
  }
}

// Render injects PORT; API_PORT is the historical local override.
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(
    `GrandForge API listening on :${port} (${process.env.NODE_ENV ?? 'development'})`
  );
});

// Render's proxy holds keep-alive connections; Node's 5 s default causes
// intermittent 502s when the proxy reuses a socket the server just closed.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 121_000;

// Cap total time for one request. Node's default is 300 s, which is what a hung
// upstream import fetch used to hold a connection AND a Mongo pool slot for;
// Vercel's maxDuration: 30 was silently doing this job on the serverless path.
server.requestTimeout = 30_000;

// A single unhandled rejection terminates the process on Node 20+ anyway, but
// with no log line explaining why — and Render then restarts cold (30-60 s).
// Log the reason first so the cause is recoverable from the deploy log.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection — exiting:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — exiting:', err);
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — draining connections`);
  server.close(() => {
    mongoose.disconnect().finally(() => process.exit(0));
  });
  // server.close() waits for every keep-alive socket to go away on its own, and
  // keepAliveTimeout is 120 s — far past the 10 s hard-exit timer below, so
  // without this call the "graceful" path always ended in exit(1). Idle sockets
  // are closed immediately; in-flight requests are still allowed to finish.
  server.closeIdleConnections();
  // Hard exit if the drain hangs (Render SIGKILLs at ~30 s anyway).
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
