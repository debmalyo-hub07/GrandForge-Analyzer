import type { Config } from 'tailwindcss';

const config: Config = {
  // Paths are relative to the repo root (where this config lives), NOT to Vite's
  // `root` of frontend/. The dda9c75 frontend//backend/ split moved index.html and
  // src/ under frontend/; leaving the old root-relative globs made Tailwind scan
  // nothing and emit zero utilities into the production CSS.
  content: ['./frontend/index.html', './frontend/src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          void: 'var(--bg-void)',
          base: 'var(--bg-base)',
          surface: 'var(--bg-surface)',
          elevated: 'var(--bg-elevated)',
          hover: 'var(--bg-hover)',
          active: 'var(--bg-active)',
        },
        gold: {
          DEFAULT: 'var(--gold)',
          dim: 'var(--gold-dim)',
          glow: 'var(--gold-glow)',
        },
        // Move quality colors (match Chess.com + Lichess system)
        brilliant: 'var(--brilliant)',
        great: 'var(--great)',
        best: 'var(--best)',
        excellent: 'var(--excellent)',
        good: 'var(--good)',
        book: 'var(--book)',
        inaccuracy: 'var(--inaccuracy)',
        mistake: 'var(--mistake)',
        miss: 'var(--miss)',
        blunder: 'var(--blunder)',
        eval: {
          white: 'var(--eval-white)',
          black: 'var(--eval-black)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          accent: 'var(--text-accent)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'Georgia', 'serif'],
        ui: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
