// src/components/review/ReviewMovePanel.tsx
//
// Per-move review panel shown during playback. Displays classification badge
// (animated), explanation, before→after Win% swing, played + best move SAN.
//
// Mounts in the side panel when isReviewMode && result. Drives from
// result.moveReviews[currentReviewPly - 1].
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play } from 'lucide-react';
import { useReviewStore } from '../../store/reviewStore';
import type { MoveClassification, MoveReview } from '../../types/review';
import { cpAndMateToWin } from '../../utils/reviewUtils';
import { readableTextColor } from '../../utils/boardUtils';
import { useReviewAutoPlayback } from '../../hooks/useReviewAutoPlayback';

const BADGE: Record<MoveClassification, { label: string; glyph: string; color: string; tone: string }> = {
  brilliant:  { label: 'Brilliant',  glyph: '!!', color: '#1baca6', tone: 'positive' },
  great:      { label: 'Great',      glyph: '!',  color: '#5c8bb0', tone: 'positive' },
  book:       { label: 'Book',       glyph: '📖', color: '#c8a84b', tone: 'neutral'  },
  best:       { label: 'Best',       glyph: '★',  color: '#96bc4b', tone: 'positive' },
  excellent:  { label: 'Excellent',  glyph: '👍', color: '#96bc4b', tone: 'positive' },
  good:       { label: 'Good',       glyph: '✓',  color: '#82ac49', tone: 'neutral'  },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!', color: '#f0c945', tone: 'caution'  },
  mistake:    { label: 'Mistake',    glyph: '?',  color: '#e68f39', tone: 'warning'  },
  miss:       { label: 'Miss',       glyph: '✗',  color: '#e05a5a', tone: 'warning'  },
  blunder:    { label: 'Blunder',    glyph: '??', color: '#ca3431', tone: 'warning'  },
};

function formatWin(win: number): string {
  return `${Math.round(win * 1000) / 10}%`;
}

function uciToHuman(uci: string): string {
  if (!uci || uci.length < 4) return '—';
  return `${uci.slice(0, 2)} → ${uci.slice(2, 4)}${uci.length > 4 ? ` =${uci[4].toUpperCase()}` : ''}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    // Respect prefers-reduced-motion — a CSS media query can't stop a JS rAF
    // loop, so snap straight to the target value for users who opt out.
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
    fromRef.current = display;
    startTimeRef.current = performance.now();
    const target = value;
    const from = fromRef.current;
    const dur = 600;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTimeRef.current) / dur);
      // ease-out cubic
      const k = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * k);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format(display)}</>;
}

function EvalSwingBar({ winBefore, winAfter, color }: { winBefore: number; winAfter: number; color: string }) {
  const wb = Math.max(0, Math.min(1, winBefore));
  const wa = Math.max(0, Math.min(1, winAfter));
  return (
    <div
      className="rmp-swing-track"
      role="img"
      aria-label={`Win probability: before ${formatWin(wb)}, after ${formatWin(wa)}`}
    >
      <div aria-hidden="true" className="rmp-swing-fill rmp-swing-fill--before" style={{ width: `${wb * 100}%` }} />
      <motion.div
        aria-hidden="true"
        className="rmp-swing-fill rmp-swing-fill--after"
        initial={false}
        animate={{ width: `${wa * 100}%`, backgroundColor: color }}
        transition={{ duration: 0.6, ease: [0.16, 0.84, 0.44, 1] }}
      />
      <div aria-hidden="true" className="rmp-swing-marker" style={{ left: `${wb * 100}%` }} />
    </div>
  );
}

function ClassificationBadge({ classification }: { classification: MoveClassification }) {
  const cfg = BADGE[classification];
  return (
    <motion.div
      key={classification}
      className={`rmp-badge rmp-badge--${classification} rmp-tone-${cfg.tone}`}
      style={{ backgroundColor: cfg.color, color: readableTextColor(cfg.color) }}
      initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 18 }}
    >
      <span className="rmp-badge-glyph">{cfg.glyph}</span>
      <span className="rmp-badge-label">{cfg.label}</span>
    </motion.div>
  );
}

export function ReviewMovePanel() {
  const result = useReviewStore((s) => s.result);
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  const currentReviewPly = useReviewStore((s) => s.currentReviewPly);
  const setCurrentReviewPly = useReviewStore((s) => s.setCurrentReviewPly);
  const { isPlaying, toggle } = useReviewAutoPlayback();

  const review: MoveReview | null = useMemo(() => {
    if (!result || currentReviewPly <= 0) return null;
    return result.moveReviews[currentReviewPly - 1] ?? null;
  }, [result, currentReviewPly]);

  if (!isReviewMode || !result) return null;

  const total = result.moveReviews.length;

  // Compute Win% before/after for the current move. Both evalBefore and
  // evalAfter are stored MOVER-relative (see types/review.ts), so neither needs
  // perspective inversion — the bar must shrink for mistakes and grow for great
  // moves on the SAME axis. A prior `1 - …` flip made blunders read as gains.
  const winBefore = review ? cpAndMateToWin(review.evalBefore, review.mateBefore) : 0.5;
  const winAfter  = review ? cpAndMateToWin(review.evalAfter, review.mateAfter) : 0.5;
  const cfg = review ? BADGE[review.classification] : null;

  return (
    <div className="review-move-panel">
      <div className="rmp-header">
        <span className="rmp-ply-counter">
          Move {currentReviewPly} / {total}
        </span>
        <div className="rmp-controls" role="toolbar" aria-label="Review playback">
          <button onClick={() => setCurrentReviewPly(0)} disabled={currentReviewPly === 0} aria-label="First move">
            <ChevronsLeft size={14} />
          </button>
          <button onClick={() => setCurrentReviewPly(Math.max(0, currentReviewPly - 1))} disabled={currentReviewPly === 0} aria-label="Previous move">
            <ChevronLeft size={14} />
          </button>
          <button className="rmp-play-btn" onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button onClick={() => setCurrentReviewPly(Math.min(total, currentReviewPly + 1))} disabled={currentReviewPly >= total} aria-label="Next move">
            <ChevronRight size={14} />
          </button>
          <button onClick={() => setCurrentReviewPly(total)} disabled={currentReviewPly >= total} aria-label="Last move">
            <ChevronsRight size={14} />
          </button>
        </div>
      </div>

      {!review && (
        <div className="rmp-empty">
          Press play or step forward to begin the walkthrough.
        </div>
      )}

      <AnimatePresence mode="wait">
        {review && cfg && (
          <motion.div
            key={review.plyIndex}
            className="rmp-body"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <div className="rmp-row rmp-row-top">
              <ClassificationBadge classification={review.classification} />
              <div className="rmp-played">
                <span className="rmp-played-label">Played</span>
                <span className="rmp-played-san">{review.san}</span>
                <span className="rmp-played-uci">{uciToHuman(review.uci)}</span>
              </div>
            </div>

            <div className="rmp-explanation">{review.reason}</div>

            <div className="rmp-swing">
              <div className="rmp-swing-labels">
                <span>
                  Before: <strong><AnimatedNumber value={winBefore} format={formatWin} /></strong>
                </span>
                <span>
                  After: <strong><AnimatedNumber value={winAfter} format={formatWin} /></strong>
                </span>
              </div>
              <EvalSwingBar winBefore={winBefore} winAfter={winAfter} color={cfg.color} />
            </div>

            {review.bestMoveUci && review.bestMoveUci !== review.uci && (
              <div className="rmp-best">
                <span className="rmp-best-label">Engine top move</span>
                <span className="rmp-best-san">{review.bestMoveSan || review.bestMoveUci}</span>
                <span className="rmp-best-uci">{uciToHuman(review.bestMoveUci)}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ReviewMovePanel;
