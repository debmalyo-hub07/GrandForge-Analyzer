// src/pages/StaticPage.tsx
// Shared shell for static content pages (/privacy, /learn/*). Renders the app
// Header/Footer around a centered prose column so these routes read as part of
// the product, not a separate site.
//
// It also owns per-route head management. The app ships one static index.html and
// vercel.json rewrites every non-/api path to it, so without this every content
// page inherits the homepage's canonical (`/`), description and og:* tags — a
// canonical pointing at `/` tells crawlers to de-index the page, which defeats
// the whole point of the /learn/* SEO entry points. Head tags are created if
// absent, overwritten if present, and restored on unmount.
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';

// Must match the canonical origin baked into frontend/index.html, sitemap.xml and
// robots.txt. Deliberately not window.location.origin: preview deploys and
// localhost must still declare the production URL as canonical.
const SITE_ORIGIN = 'https://grand-forge-analyzer.vercel.app';

const ROUTE_DESCRIPTIONS: Record<string, string> = {
  '/privacy':
    'How GrandForge handles your data: chess analysis runs entirely in your browser via Stockfish WebAssembly, no account required. What we collect, what we do not, and the third-party services involved.',
  '/learn/chess-accuracy':
    'How chess accuracy is calculated: centipawn evaluations become win percentages, win-percentage loss becomes a per-move accuracy score, and those blend into a game accuracy — the same open-source math Lichess uses.',
  '/learn/move-classifications':
    'What Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss and Blunder mean in a chess game review, and the exact expected-points thresholds GrandForge uses to assign them.',
};

type RestoreHeadTag = () => void;

/**
 * Point a single head tag at `value`, returning an undo function. If the tag
 * already exists (it does for the index.html-provided ones) its previous value is
 * restored; if we created it, it is removed.
 */
function applyHeadTag(
  selector: string,
  createTag: () => HTMLElement,
  attribute: 'content' | 'href',
  value: string,
): RestoreHeadTag {
  const existing = document.head.querySelector<HTMLElement>(selector);
  if (existing) {
    const previous = existing.getAttribute(attribute);
    existing.setAttribute(attribute, value);
    return () => {
      if (previous === null) existing.removeAttribute(attribute);
      else existing.setAttribute(attribute, previous);
    };
  }
  const created = createTag();
  created.setAttribute(attribute, value);
  document.head.appendChild(created);
  return () => created.remove();
}

function metaTag(keyAttribute: 'name' | 'property', key: string): () => HTMLElement {
  return () => {
    const meta = document.createElement('meta');
    meta.setAttribute(keyAttribute, key);
    return meta;
  };
}

function canonicalTag(): HTMLElement {
  const link = document.createElement('link');
  link.setAttribute('rel', 'canonical');
  return link;
}

export function StaticPage({ title, children }: { title: string; children: ReactNode }) {
  const { pathname } = useLocation();

  useEffect(() => {
    const previousTitle = document.title;
    const pageTitle = `${title} — GrandForge`;
    document.title = pageTitle;

    const canonicalUrl = `${SITE_ORIGIN}${pathname}`;
    const description =
      ROUTE_DESCRIPTIONS[pathname] ??
      `${title} — GrandForge, free browser-based chess game review powered by Stockfish.`;

    const restores: RestoreHeadTag[] = [
      applyHeadTag('link[rel="canonical"]', canonicalTag, 'href', canonicalUrl),
      applyHeadTag('meta[name="description"]', metaTag('name', 'description'), 'content', description),
      applyHeadTag('meta[property="og:title"]', metaTag('property', 'og:title'), 'content', pageTitle),
      applyHeadTag(
        'meta[property="og:description"]',
        metaTag('property', 'og:description'),
        'content',
        description,
      ),
      applyHeadTag('meta[property="og:url"]', metaTag('property', 'og:url'), 'content', canonicalUrl),
      applyHeadTag('meta[name="twitter:title"]', metaTag('name', 'twitter:title'), 'content', pageTitle),
      applyHeadTag(
        'meta[name="twitter:description"]',
        metaTag('name', 'twitter:description'),
        'content',
        description,
      ),
    ];

    return () => {
      document.title = previousTitle;
      for (const restore of restores.reverse()) restore();
    };
  }, [title, pathname]);

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
