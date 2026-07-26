/**
 * GrandForge — persistent API server entry (Render primary; also local dev).
 * Imports the SAME consolidated Express app the Vercel serverless function
 * (api/[...path].ts) re-exports, so both deployments run one identical
 * routing table (backend/router.ts).
 */
import mongoose from 'mongoose';
import app from './router';

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

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — draining connections`);
  server.close(() => {
    mongoose.disconnect().finally(() => process.exit(0));
  });
  // Hard exit if the drain hangs (Render SIGKILLs at ~30 s anyway).
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
