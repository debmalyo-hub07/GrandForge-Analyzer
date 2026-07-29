import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';

let cached: mongoose.Connection | null = null;
let connecting: Promise<mongoose.Connection> | null = null;
let envLoaded = false;

/**
 * Parse the repo-root `.env` into `process.env` for local runs (no dotenv
 * dependency by design).
 *
 * The guard keys on `envLoaded` ALONE. It used to also early-return when
 * `process.env.MONGODB_URI` was already set, which meant that exporting just
 * that one variable in the shell made `.env` never parse at all — `JWT_SECRET`,
 * `ADMIN_KEY`, `LICHESS_API_TOKEN` and `CHESS_COM_USER_AGENT` silently vanished
 * and every authed request failed with "JWT_SECRET must be set and at least 32
 * characters" for no visible reason. Real environment values still win: the
 * per-key `process.env[key] !== undefined` check below never overwrites them,
 * so platform-provided config (Render/Vercel) is unaffected.
 */
export function loadLocalEnv(): void {
  if (envLoaded) return;
  envLoaded = true;

  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

export function hasMongoUri(): boolean {
  loadLocalEnv();
  return typeof process.env.MONGODB_URI === 'string' && process.env.MONGODB_URI.trim().length > 0;
}

export async function connectDB(): Promise<mongoose.Connection> {
  // Fast path: a live connection already exists.
  if (cached && cached.readyState === 1) return cached;

  // A connect() is already in flight — await the SAME promise instead of
  // starting a second mongoose.connect(). Two handlers fire concurrently at
  // game load (openings/lookup + the review opening-book load); without this
  // shared promise the second caller queries a socket still in readyState 2
  // (connecting) and, because bufferCommands is false, mongoose throws
  // "Cannot call openings.find() before initial connection is complete".
  if (connecting) return connecting;

  loadLocalEnv();
  if (!hasMongoUri()) {
    throw new Error('MONGODB_URI is not configured');
  }

  // Vercel sets VERCEL=1. Serverless invocations are short-lived and many, so
  // each keeps a tiny pool with fast-failing sockets; the persistent server
  // (Render / local dev) carries all traffic through one process, so it gets a
  // real pool and a socket timeout that survives long cursor walks.
  const serverless = !!process.env.VERCEL;

  connecting = mongoose
    .connect(process.env.MONGODB_URI!, {
      dbName: 'chess-analyzer',
      bufferCommands: false,
      // Atlas M0 allows 500 connections *total*. A serverless invocation
      // handles one request at a time, so a pool of 5 buys nothing but holds 5
      // slots — and Vercel can have dozens of concurrent lambdas warm during a
      // review, which is how the tier gets exhausted and every client starts
      // seeing connection timeouts. 2 covers the one live query plus overlap
      // during a socket replacement.
      maxPoolSize: serverless ? 2 : 20,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: serverless ? 10000 : 45000,
      // Reap idle sockets instead of parking them for the container's lifetime.
      // Without this a frozen-but-not-yet-reclaimed lambda keeps its Atlas
      // slots the whole time; the persistent server gets a longer window since
      // it genuinely reuses the pool.
      maxIdleTimeMS: serverless ? 15_000 : 60_000,
    })
    .then((conn) => {
      cached = conn.connection;
      return cached;
    })
    .catch((err) => {
      // Reset so a later request can retry instead of being stuck awaiting a
      // permanently-rejected promise.
      connecting = null;
      throw err;
    });

  try {
    return await connecting;
  } finally {
    // Clear the in-flight marker once settled; `cached` now holds the result.
    connecting = null;
  }
}
