import { copyFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';

// The `stockfish` npm package ships builds in `bin/` (not `src/` as older docs suggest).
const sfDir = resolve('node_modules/stockfish/bin');
const destDir = resolve('public/stockfish');
if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

if (!existsSync(sfDir)) {
  console.warn(
    `⚠ GrandForge: ${sfDir} not found — run \`npm install\` first. Skipping Stockfish copy.`
  );
  process.exit(0);
}

// Real sf16 (stockfish@16.0.0) and sf17.1 (stockfish@17.1.0) binaries are
// committed directly in public/stockfish/ — this script no longer aliases them.
// Only sf18 files come from node_modules.
const targets = [
  // (destFile, sourceFile)
  ['stockfish-18-lite-single.js',   'stockfish-18-lite-single.js'],
  ['stockfish-18-lite-single.wasm', 'stockfish-18-lite-single.wasm'],
  // Multi-threaded lite build (engine id sf18-lite-mt). Self-contained .js+.wasm
  // pair; honors `setoption Threads` under COOP/COEP cross-origin isolation.
  ['stockfish-18-lite.js',          'stockfish-18-lite.js'],
  ['stockfish-18-lite.wasm',        'stockfish-18-lite.wasm'],
];

let copied = 0;
let missing = 0;
let skipped = 0;

for (const [destName, sourceName] of targets) {
  const src = resolve(sfDir, sourceName);
  const dst = resolve(destDir, destName);
  if (!existsSync(src)) {
    console.warn(`  ⚠ ${sourceName} not found, skipping ${destName}`);
    missing++;
    continue;
  }
  let needCopy = true;
  try {
    if (existsSync(dst) && statSync(dst).size === statSync(src).size) needCopy = false;
  } catch {}
  if (needCopy) {
    copyFileSync(src, dst);
    copied++;
  } else {
    skipped++;
  }
}

const REQUIRED_REAL = [
  'stockfish-16-lite-single.js',   'stockfish-16-lite-single.wasm',
  'nn-5af11540bbfe.nnue',          // sf16 NNUE network (fetched at runtime by the sf16 engine)
  'stockfish-17.1-lite-single.js', 'stockfish-17.1-lite-single.wasm',
];
const missingReal = REQUIRED_REAL.filter((f) => !existsSync(resolve(destDir, f)));
if (missingReal.length > 0) {
  console.warn(
    `⚠ GrandForge: missing real engine binaries in public/stockfish/: ${missingReal.join(', ')}.\n` +
    `  The sf16/sf17 UI options will 404 until these are added.`
  );
}

console.log(
  `✓ GrandForge: Stockfish WASM (${copied} copied, ${skipped} up-to-date, ${missing} missing) → public/stockfish/`
);
