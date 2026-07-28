import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// The `stockfish` npm package ships builds in `bin/` (not `src/` as older docs suggest).
const sfDir = resolve('node_modules/stockfish/bin');
const destDir = resolve('frontend/public/stockfish');
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

// GPL-3.0 §4/§6 compliance: we convey four GPL'd Stockfish builds to every visitor,
// so the full license text and an authors pointer must ship alongside them. The npm
// package carries Copying.txt (the GPLv3 text) but no AUTHORS file, so that one is
// generated here as a pointer to the upstream author lists. SOURCE.txt (the
// corresponding-source provenance per binary) is committed by hand, not generated.
const licenseSrc = resolve('node_modules/stockfish/Copying.txt');
const licenseDst = resolve(destDir, 'Copying.txt');
if (existsSync(licenseSrc)) {
  let needCopy = true;
  try {
    if (existsSync(licenseDst) && statSync(licenseDst).size === statSync(licenseSrc).size) {
      needCopy = false;
    }
  } catch {}
  if (needCopy) copyFileSync(licenseSrc, licenseDst);
} else {
  console.warn(
    `⚠ GrandForge: ${licenseSrc} not found — GPL-3.0 license text will not ship with the engines.`
  );
}

const AUTHORS_TEXT = `Stockfish WASM builds served by GrandForge — authorship
=======================================================

The engine binaries under /stockfish/ are third-party GPL-3.0 works. GrandForge
redistributes them unmodified and claims no authorship over them.

Stockfish (the chess engine)
  Tord Romstad, Marco Costalba, Joona Kiiski, Gary Linscott and the Stockfish
  contributors. Full, current author list:
  https://github.com/official-stockfish/Stockfish/blob/master/AUTHORS

Stockfish.js (the WebAssembly ports shipped here)
  Nathan Rugg (nmrugg) and Chess.com, LLC, based on stockfish.wasm by
  Niklas Fiekas and Hiroshi Ogawa.
  https://github.com/nmrugg/stockfish.js

NNUE evaluation networks
  Trained and maintained by the Stockfish project (nets by Linmiao Xu / linrock
  and contributors).
  https://github.com/official-stockfish/networks

License: GNU General Public License v3 — full text in ./Copying.txt
Corresponding source provenance per shipped file: ./SOURCE.txt
`;

const authorsDst = resolve(destDir, 'AUTHORS.txt');
if (!existsSync(authorsDst) || readFileSync(authorsDst, 'utf8') !== AUTHORS_TEXT) {
  writeFileSync(authorsDst, AUTHORS_TEXT, 'utf8');
}

console.log(
  `✓ GrandForge: Stockfish WASM (${copied} copied, ${skipped} up-to-date, ${missing} missing) → public/stockfish/`
);
