import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';
import Button from '../components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          <div
            className="text-6xl text-[var(--gold)] mb-4 select-none"
            aria-hidden
            style={{ fontFamily: 'var(--font-display)' }}
          >
            ♟
          </div>
          <div
            className="font-display text-6xl font-semibold text-[var(--text-primary)] mb-2 leading-none"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            404
          </div>
          <h1 className="font-display text-xl text-[var(--text-secondary)] mb-2">
            Position not on the board
          </h1>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            The page you were looking for doesn't exist or has been moved.
          </p>
          <Link to="/">
            <Button variant="primary" size="md" leftIcon={<Home size={14} />}>
              Back to analyzer
            </Button>
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default NotFoundPage;
