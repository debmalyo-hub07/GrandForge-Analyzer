// Standalone headless repro: play Legal's Mate, dump engine/arrow state after mate.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5174';
const BOARD = '[data-boardid="grandforge-board"]';

const moves = [
  ['e2', 'e4'], ['e7', 'e5'],
  ['g1', 'f3'], ['b8', 'c6'],
  ['b1', 'c3'], ['d7', 'd6'],
  ['f1', 'c4'], ['c8', 'g4'],
  ['h2', 'h3'], ['g4', 'h5'],
  ['f3', 'e5'], ['h5', 'd1'],
  ['c4', 'f7'], ['e8', 'e7'],
  ['c3', 'd5'], // Nd5#  -> checkmate (knight from c3, not e5)
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push('PAGEERROR: ' + e.message));

await page.goto(BASE);
await page.waitForSelector(BOARD, { state: 'visible', timeout: 20000 });
await page.waitForFunction(() => (window).__grandforgeTestHooks === true, { timeout: 15000 });
// wait for manager ready
await page.waitForFunction(() => !!(window).__engineStore.getState().manager, { timeout: 20000 });

console.log('--- Board ready, playing Legal Mate ---');

for (const [from, to] of moves) {
  await page.evaluate(({ f, t }) => {
    (window).__gameStore.getState().makeMove({ from: f, to: t });
  }, { f: from, t: to });
  await sleep(450);
}

// let engine settle / autoanalysis react
await sleep(3000);

const snap = await page.evaluate(() => {
  const g = (window).__gameStore.getState();
  const e = (window).__engineStore.getState();
  const u = (window).__uiStore.getState();
  const r = (window).__reviewStore.getState();
  // replicate isTerminalFen
  let isTerminal = null;
  try {
    // chess.js is bundled; use a fresh instance via dynamic import is hard here.
    // Instead infer from FEN: rely on engine store flag if present.
    isTerminal = 'see currentFen';
  } catch {}
  return {
    currentFen: g.currentFen,
    isRunning: e.isRunning,
    analyzedFen: e.analyzedFen,
    bestMoveUci: e.bestMoveUci,
    lineCount: e.lines.length,
    firstMoves: e.lines.map((l) => l.uciMoves && l.uciMoves[0]).filter(Boolean),
    currentDepth: e.currentDepth,
    engineEnabled: e.isEnabled,
    computerAnalysis: u.computerAnalysis,
    bestMoveArrow: u.bestMoveArrow,
    isReviewMode: r.isReviewMode,
    reviewPhase: r.progress.phase,
  };
});

// Count rendered arrow SVG elements on the board (react-chessboard draws <svg> arrows)
const renderedArrows = await page.evaluate((boardSel) => {
  const board = document.querySelector(boardSel);
  if (!board) return -1;
  // react-chessboard arrows: <svg> with <marker> defs + <line>/<path>. Count lines.
  const svgs = board.querySelectorAll('svg');
  let lines = 0;
  svgs.forEach((s) => { lines += s.querySelectorAll('line, path[marker-end], marker').length; });
  return { svgCount: svgs.length, arrowParts: lines };
}, BOARD);

console.log('STATE:', JSON.stringify(snap, null, 2));
console.log('RENDERED ARROWS:', JSON.stringify(renderedArrows));
console.log('PAGE ERRORS:', pageErrors.length, JSON.stringify(pageErrors.slice(0, 10), null, 2));

await browser.close();
