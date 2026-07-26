/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  test: {
    // Pure-logic units run in node; jsdom not needed for the utils under test.
    environment: 'node',
    // Vite `root` is frontend/, but tests span frontend + backend — scan from
    // the repo root instead.
    dir: path.resolve(__dirname),
    include: ['frontend/src/**/*.{test,spec}.ts', 'backend/**/*.{test,spec}.ts'],
    // Exclude the WASM worker glue — those need a browser, covered by Playwright.
    exclude: ['node_modules/**', 'dist/**', 'frontend/src/**/*.browser.test.ts'],
  },
  plugins: [react()],
  // frontend/ holds index.html + src + public; backend/ is the Express API.
  root: 'frontend',
  // Env files stay at the REPO root (.env, .env.production): with root moved
  // to frontend/, the default envDir would silently stop loading
  // .env.production — and with it VITE_API_BASE_URL, disabling the
  // Render-primary dual-deploy in every production build.
  envDir: __dirname,
  publicDir: 'public',
  build: {
    // Emit at the repo root (vercel.json outputDirectory: dist).
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-chess': ['chess.js', 'react-chessboard'],
          'vendor-motion': ['framer-motion'],
        },
      },
    },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'frontend/src') } },
  // COOP + COEP keep the page cross-origin isolated (crossOriginIsolated === true)
  // so the multi-threaded engine build can use SharedArrayBuffer. COEP is
  // `credentialless` (not `require-corp`) — same isolation guarantee, but
  // cross-origin no-cors subresources (chess.com / lichess avatars, Google
  // Fonts) load without each CDN needing to send a CORP header. This is the
  // Lichess approach; single-threaded engine builds don't need isolation at all.
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  // `vite preview` serves the production build — mirror the isolation headers so a
  // prod-like local run (and Playwright against the build) is cross-origin isolated.
  preview: {
    port: 4173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    exclude: ['stockfish'],
  },
});
