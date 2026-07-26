// src/pages/StaticPage.tsx
// Shared shell for static content pages (/privacy, /learn/*). Renders the app
// Header/Footer around a centered prose column so these routes read as part of
// the product, not a separate site.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';

export function StaticPage({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} — GrandForge`;
    return () => { document.title = prev; };
  }, [title]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Header />
      <main className="flex-1 px-4 py-10">
        <article className="static-prose mx-auto w-full max-w-2xl">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--gold)] mb-6"
          >
            <ArrowLeft size={14} /> Back to analyzer
          </Link>
          <h1
            className="font-display text-3xl font-semibold mb-6"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h1>
          {children}
        </article>
      </main>
      <Footer />
    </div>
  );
}

export default StaticPage;
