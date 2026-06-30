import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { Analytics } from '@vercel/analytics/react';
import App from './App';

import './styles/global.css';
import './styles/board-themes.css';
import './styles/review.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

// DEV-only test hooks (window.__*Store for Playwright). Gated on MODE, not DEV:
// the local .env sets NODE_ENV=development, which makes Vite bake
// import.meta.env.DEV=true even into `vite build` output — so a DEV-gated import
// would ship to prod. import.meta.env.MODE reflects the actual build mode
// ('production' for `vite build`, 'development' for the dev server) and is NOT
// overridden by NODE_ENV, so this import is reliably dropped from prod builds.
if (import.meta.env.MODE === 'development') {
  void import('./devHooks');
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            },
          }}
        />
        <Analytics />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
