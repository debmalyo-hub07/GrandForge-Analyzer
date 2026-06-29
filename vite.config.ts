/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  test: {
    // Pure-logic units run in node; jsdom not needed for the utils under test.
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Exclude the WASM worker glue — those need a browser, covered by Playwright.
    exclude: ['node_modules/**', 'dist/**', 'src/**/*.browser.test.ts'],
  },
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
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
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
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
