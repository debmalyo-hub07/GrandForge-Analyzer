# GrandForge

**Forge Your Game. Master the Board.**

Production-grade chess analysis platform powered by Stockfish 18 WASM, MongoDB Atlas, and Vercel. Multi-engine support (SF16 / SF17 / SF18), full game review with move classification, live analysis on every move, and complete Chess.com / Lichess game import -- all running in your browser.

---

## Features

- **Multi-Engine Stockfish** -- switch between SF16, SF17, SF18 (lite, lite multi-threaded) at any time
- **Live Infinite Analysis** -- engine auto-analyzes every board position with Lichess-style continuous deepening until you stop it, with optional Win/Draw/Loss (WDL) readout on the eval bar
- **Full Game Review** -- Brilliant / Great / Best / Excellent / Good / Inaccuracy / Mistake / Miss / Blunder classification with per-player accuracy, confidence-labeled game ratings, and Opening / Middlegame / Endgame phase accuracy + ACPL
- **Chess.com & Lichess Import** -- fetch any user's games by username, no login required
- **Board Tools** -- Flip Board, Board Editor, Continue from Here, Paste FEN, inline notation & display toggles
- **Premium Board Visuals** -- custom SVG engine arrows (single-shape, chess.com/lichess style with rank-based color hierarchy), DOM-based selection ring / legal-move dots / capture rings with gradient styling
- **7 Board Themes & 6 Piece Sets** -- switch from the board itself
- **PGN / FEN Import & Export** -- paste, drop, or load any position
- **Full Move Tree** with variations, navigation, inline classification glyphs, and **review line identity** (reviews pin to the exact variation analyzed, not the mainline)
- **Visual Motifs** -- undefended pieces, pinned pieces, checkable king highlights
- **Light & Dark Theme** -- toggle from the header

---

## Prerequisites

- **Node.js** >= 18 (tested with 20.x)
- **npm** >= 9
- **MongoDB Atlas** account (free M0 tier works) -- or a local MongoDB instance
- **Git**

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/debmalyo-hub07/GrandForge-Analyzer.git
cd GrandForge-Analyzer
```

### 2. Install dependencies

```bash
npm install
```

### 3. Copy Stockfish WASM binaries

The `predev` hook runs this automatically, but for a fresh clone:

```bash
node scripts/copyStockfish.mjs
```

This copies the SF18 lite WASM builds from `node_modules/stockfish/bin` into `public/stockfish/`. The SF16 and SF17.1 binaries are committed directly under `public/stockfish/`.

### 4. Configure environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
JWT_SECRET=your-random-secret-at-least-32-chars
NODE_ENV=development
```

The MongoDB URI should point to a MongoDB Atlas cluster (free M0 works fine) or a local MongoDB instance.

### 5. Seed the opening database (optional but recommended)

```bash
npx tsx scripts/seedOpenings.ts
npx tsx scripts/seedMasterGames.ts
```

This downloads 3,700+ ECO openings from the Lichess open-source database and seeds your MongoDB `chess-analyzer` database. Without seeding, opening detection won't work but all other features function normally.

### 6. Start the development server

```bash
npm run dev
```

This starts both:
- **API server** at `http://localhost:3000` (Express, backed by MongoDB)
- **Vite dev server** at `http://localhost:5173` (React frontend, proxies `/api` to `:3000`)

Open `http://localhost:5173` in your browser.

> **Note:** The terminal output prefixes lines with `[api]` and `[web]` -- this is normal. The `[api]` prefix shows API server output, `[web]` shows Vite output.

### Frontend-only mode (no API/MongoDB needed)

```bash
npm run web:dev
```

Stockfish engine, board, moves, navigation, and review all work without the API. Only opening detection, game persistence, and server-side import require the API.

---

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API + Vite concurrently (full stack) |
| `npm run web:dev` | Frontend only (Vite, :5173) |
| `npm run api:dev` | API only (Express, :3000) |
| `npm run build` | TypeScript check + Vite production build |
| `npm run typecheck` | `tsc --noEmit` |

---

## Project Structure

```
GrandForge-Analyzer/
  api/                        # Vercel Serverless API
    [...path].ts              # Single serverless function entry point
    _lib/
      router.ts               # Consolidated Express router (25 routes)
      db.ts                   # MongoDB connection (manual .env loading)
      auth.ts                 # JWT auth middleware
      createApp.ts            # Express app factory (CORS, rate limit)
      models/                 # Mongoose models
      routes/                 # Route handlers by domain
  src/                        # React frontend
    components/               # UI components by domain
      board/                  # Chess board, controls, themes, arrow/marker overlays
      engine/                 # Engine controls, lines, stats
      evaluation/             # Eval bar (vertical + horizontal)
      review/                 # Review tab, summary, move panel
      import/                 # PGN/FEN import, platform import
      navigation/             # Move list, navigation controls
      layout/                 # Header, footer, analyzer layout
      ui/                     # Shared primitives (Button, Tabs, etc.)
    hooks/                    # Custom React hooks
    services/                 # Engine manager, review service, API client
    store/                    # Zustand stores
    types/                    # TypeScript type definitions
    styles/                   # CSS (tokens, global, review, board themes)
    utils/                    # Pure utility functions
  public/
    stockfish/                # WASM engine binaries
    pieces/                   # Piece set SVGs
  scripts/                    # Seed scripts, build helpers
```

---

## Architecture

### Engine Layer

`EngineManager.ts` is a serialized UCI wrapper around one Stockfish Web Worker. Only one `go` command is ever in flight. Three entry points:

- `analyze(req)` -- fire-and-forget live analysis (new request supersedes previous)
- `evaluate(req)` -- one-shot `Promise<SearchResult>` (used by review pipeline)
- `beginSession()` -- sends `ucinewgame` for transposition hash reuse across a batch

### Review Pipeline

`GameReviewService.ts` analyzes games ply-by-ply. Per position it resolves evals in priority order: (1) MongoDB position cache, (2) Syzygy tablebase (7 pieces or fewer), (3) Stockfish WASM at the requested depth. Cross-ply reuse halves the work.

Review scoring uses Expected Points / Win% loss rather than raw centipawn loss for move classification. Brilliant and Great move detection is rating-aware when imported Elo metadata is available, while normal Best / Excellent / Good / Inaccuracy / Mistake / Blunder thresholds stay stable. Game Rating is a single-game performance estimate with confidence labels: provisional, low, medium, or high depending on rated move count. Reviews carry **line identity** -- a review of a variation pins to the exact move-tree path it analyzed, so playback, glyphs, and arrows follow the reviewed line instead of blindly walking the mainline.

### API

All 25 route handlers are consolidated behind one Vercel Serverless Function (`api/[...path].ts`) via a regex dispatch table in `api/_lib/router.ts`. This stays within Vercel Hobby's 12-function limit.

---

## Deploying to Vercel

### Step 1: Push to GitHub

Make sure your code is pushed to GitHub:

```bash
git remote add origin https://github.com/YOUR_USER/GrandForge-Analyzer.git
git push -u origin main
```

### Step 2: Set up MongoDB Atlas

1. Go to [MongoDB Atlas](https://cloud.mongodb.com) and create a free M0 cluster
2. Under **Database Access**, create a database user with read/write permissions
3. Under **Network Access**, add `0.0.0.0/0` to allow connections from Vercel's dynamic IPs
4. Get your connection string (click **Connect** > **Drivers** > copy the `mongodb+srv://...` string)

### Step 3: Seed the production database

Run from your local machine with the production MongoDB URI:

```bash
# On Windows (PowerShell):
$env:MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority"
npx tsx scripts/seedOpenings.ts
npx tsx scripts/seedMasterGames.ts

# On macOS/Linux:
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority" npx tsx scripts/seedOpenings.ts
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority" npx tsx scripts/seedMasterGames.ts
```

### Step 4: Connect Vercel to GitHub

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New Project**
3. Import your `GrandForge-Analyzer` repository
4. Framework Preset: select **Other** (not Vite -- `vercel.json` handles everything)
5. Override Build Command: leave as default (`npm run build`)
6. Override Output Directory: leave as default (`dist`)

### Step 5: Set environment variables

In the Vercel dashboard, go to **Settings** > **Environment Variables** and add:

| Variable | Value | Scope |
|----------|-------|-------|
| `MONGODB_URI` | Your Atlas `mongodb+srv://...` connection string | Production |
| `JWT_SECRET` | A random string, at least 32 characters | Production |
| `NODE_ENV` | `production` | Production |
| `FRONTEND_URL` | `https://your-project.vercel.app` (your Vercel domain) | Production |

### Step 6: Deploy

Click **Deploy** in the Vercel dashboard, or push to `main`:

```bash
git push origin main
```

Vercel auto-deploys on every push to `main`.

### Step 7: Verify

1. Visit your Vercel URL
2. Check the board loads and Stockfish engine initializes
3. Play moves -- opening names should appear in the Moves tab
4. Try importing a game from Chess.com or Lichess
5. Run a game review

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite 5, TypeScript 5, Tailwind CSS 3, Zustand, react-chessboard, chess.js, Framer Motion, TanStack Query |
| Engine | Stockfish 18/17/16 WASM in a Web Worker |
| Backend | Vercel Serverless, Express 4, Mongoose 8, Zod |
| Database | MongoDB Atlas (`chess-analyzer`) |

---

## Attribution & Licensing

| Component | License | Notice |
|-----------|---------|--------|
| **Stockfish 18** | GPLv3 | Powered by [Stockfish](https://stockfishchess.org). Analysis runs in your browser. |
| stockfish.js | MIT | Niklas Fiekas |
| chess.js | MIT | Jeff Hlywa |
| react-chessboard | MIT | Clarian White |
| **CBurnett piece set** | CC BY-SA 3.0 | Piece set by Colin Burnett |
| **Lichess ECO openings** | AGPL-3.0 | Opening data from [Lichess](https://lichess.org) |

GrandForge is GPLv3 -- compatible with Stockfish redistribution.

---

*GrandForge v4.1*
