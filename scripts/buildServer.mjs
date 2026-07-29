/**
 * Build the API to plain JS for the persistent (Render) deployment.
 *
 *   tsc -p tsconfig.server.json   → dist-server/backend/**.js  (CommonJS)
 *   + dist-server/package.json    → {"type":"commonjs"}
 *
 * The marker file is the load-bearing part: the repo root package.json says
 * `"type": "module"`, which would make Node parse these emitted CommonJS files
 * as ESM and fail on the first `require` with
 * `ReferenceError: require is not defined in ES module scope`. A nested
 * package.json overrides the module type for its whole subtree.
 *
 * Run by `npm run api:build` (and therefore by render.yaml's buildCommand).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'dist-server';
const ENTRY = join(OUT_DIR, 'backend', 'index.js');

console.log('[buildServer] compiling backend → ' + OUT_DIR);
// Invoke tsc's own entry script with the current node binary rather than the
// `npx`/`tsc` shim: on Windows those are .cmd files, and execFileSync refuses to
// spawn them without a shell (EINVAL). This form is shell-free on every OS.
const tscBin = join('node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tscBin)) {
  console.error(`[buildServer] typescript not installed (${tscBin} missing) — run npm ci first`);
  process.exit(1);
}
execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.server.json'], { stdio: 'inherit' });

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
  'utf8'
);

// Fail the build rather than let Render deploy a slug whose startCommand points
// at a file that was never emitted (e.g. after an `include` change).
if (!existsSync(ENTRY)) {
  console.error(`[buildServer] expected entry point missing: ${ENTRY}`);
  process.exit(1);
}

console.log(`[buildServer] ok — start with: node ${ENTRY}`);
