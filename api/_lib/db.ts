import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';

let cached: mongoose.Connection | null = null;
let connecting: Promise<mongoose.Connection> | null = null;
let envLoaded = false;

function loadLocalEnv(): void {
  if (envLoaded || process.env.MONGODB_URI) return;
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

  connecting = mongoose
    .connect(process.env.MONGODB_URI!, {
      dbName: 'chess-analyzer',
      bufferCommands: false,
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
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
