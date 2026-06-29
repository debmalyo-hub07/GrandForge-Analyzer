import { Component, type ReactNode } from 'react';
import { Routes, Route } from 'react-router-dom';
import AnalyzerPage from './pages/AnalyzerPage';
import NotFoundPage from './pages/NotFoundPage';

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('GrandForge uncaught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', gap: '1rem',
          background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'Inter, sans-serif',
        }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: '#888', maxWidth: '400px', textAlign: 'center' }}>
            An unexpected error occurred. Please reload the page.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
            style={{
              padding: '0.5rem 1.5rem', borderRadius: '0.5rem',
              background: '#c8a96e', color: '#0a0a0a', border: 'none',
              cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/*
          AnalyzerPage owns the board + Stockfish worker subtree. Wrap it in its
          own nested ErrorBoundary so a board/engine render throw is contained to
          the page rather than unmounting the whole app (router + all routes).
          NOTE: the board element itself lives deep inside AnalyzerPage →
          AnalyzerLayout (not owned here), so this boundary cannot be scoped any
          tighter than the page from App.tsx without editing those components.
        */}
        <Route
          path="/"
          element={
            <ErrorBoundary>
              <AnalyzerPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/game/:id"
          element={
            <ErrorBoundary>
              <AnalyzerPage />
            </ErrorBoundary>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
