import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx,html}'],
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
