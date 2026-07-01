// src/components/review/ReviewSummaryCard.tsx
import { motion, MotionConfig } from 'framer-motion';
import type { GameReviewResult, MoveClassification, RatingConfidence } from '../../types/review';
import { readableTextColor } from '../../utils/boardUtils';

const CLASSIFICATION_CONFIG: Record<
  MoveClassification,
  { label: string; icon: string; color: string }
> = {
  brilliant:  { label: 'Brilliant',  icon: '!!', color: '#1baca6' },
  great:      { label: 'Great',      icon: '!',  color: '#5c8bb0' },
  book:       { label: 'Book',       icon: '📖', color: '#c8a84b' },
  best:       { label: 'Best',       icon: '★', color: '#96bc4b' },
  excellent:  { label: 'Excellent',  icon: '👍', color: '#96bc4b' },
  good:       { label: 'Good',       icon: '✔', color: '#82ac49' },
  inaccuracy: { label: 'Inaccuracy', icon: '?!', color: '#f0c945' },
  mistake:    { label: 'Mistake',    icon: '?',  color: '#e68f39' },
  miss:       { label: 'Miss',       icon: '✗', color: '#e05a5a' },
  blunder:    { label: 'Blunder',    icon: '??', color: '#ca3431' },
};

function AccuracyBadge({ value, label }: { value: number; label: string }) {
  const color = value >= 80 ? '#96bc4b' : value >= 60 ? '#f0c945' : '#ca3431';
  return (
    <div
      className="accuracy-badge"
      style={{ borderColor: color }}
      aria-label={`${label} accuracy ${value.toFixed(1)} percent`}
    >
      <span className="accuracy-value" style={{ color }} aria-hidden="true">
        {value.toFixed(1)}
      </span>
      <span className="accuracy-label" aria-hidden="true">{label}</span>
    </div>
  );
}

function PhaseIcon({
  whiteIcon,
  blackIcon,
  label,
}: {
  whiteIcon: MoveClassification | 'none';
  blackIcon: MoveClassification | 'none';
  label: string;
}) {
  const renderIcon = (icon: MoveClassification | 'none', side: 'white' | 'black') => {
    if (icon === 'none') {
      return (
        <span
          className={`phase-icon-dot phase-icon-${side}`}
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
        >
          {'–'}
        </span>
      );
    }
    const cfg = CLASSIFICATION_CONFIG[icon];
    return (
      <span
        className={`phase-icon-dot phase-icon-${side}`}
        style={{ background: cfg.color, color: readableTextColor(cfg.color) }}
        role="img"
        aria-label={`${side} ${cfg.label}`}
      >
        {cfg.icon}
      </span>
    );
  };

  return (
    <>
      {renderIcon(whiteIcon, 'white')}
      {renderIcon(blackIcon, 'black')}
      <span className="phase-label">{label}</span>
    </>
  );
}

function confidenceLabel(confidence?: RatingConfidence): string {
  switch (confidence) {
    case 'high': return 'High confidence';
    case 'medium': return 'Medium confidence';
    case 'low': return 'Low confidence';
    case 'provisional': return 'Provisional';
    default: return 'Insufficient data';
  }
}

function formatPhaseMeta(moveCount: number, avgCpl: number | null): string {
  if (moveCount === 0) return 'No rated moves';
  return `${moveCount} moves / ${avgCpl ?? 0} ACPL`;
}

export function ReviewSummaryCard({
  result,
  onStartReview,
}: {
  result: GameReviewResult;
  onStartReview: () => void;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="review-summary-card"
    >
      {/* Player accuracy row */}
      <div className="accuracy-row">
        <AccuracyBadge value={result.white.accuracy} label="White" />
        <div className="accuracy-divider">Accuracy</div>
        <AccuracyBadge value={result.black.accuracy} label="Black" />
      </div>

      {/* Move classification table */}
      <table className="classification-table">
        <caption className="sr-only">Move classifications by player (White count, classification, Black count)</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">White</th>
            <th scope="col" className="sr-only">Classification</th>
            <th scope="col" className="sr-only">Black</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(CLASSIFICATION_CONFIG) as MoveClassification[]).map((key) => {
            const cfg = CLASSIFICATION_CONFIG[key];
            const wCount = result.white.counts[key];
            const bCount = result.black.counts[key];
            if (wCount === 0 && bCount === 0) return null;
            return (
              <tr key={key}>
                <td className="count white-count">{wCount > 0 ? wCount : '—'}</td>
                <td className="classification-icon">
                  <span
                    className={`icon-badge icon-badge--${key}`}
                    style={{ background: cfg.color, color: readableTextColor(cfg.color) }}
                    role="img"
                    aria-label={cfg.label}
                  >
                    {cfg.icon}
                  </span>
                  <span className="classification-label">{cfg.label}</span>
                </td>
                <td className="count black-count">{bCount > 0 ? bCount : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Game rating row */}
      <div className="game-rating-row">
        <div className="rating-stack">
          <div className="rating-badge white">{result.white.gameRating ?? '—'}</div>
          <div className="rating-confidence">{confidenceLabel(result.white.gameRatingConfidence)}</div>
        </div>
        <div className="rating-label">Game Rating</div>
        <div className="rating-stack">
          <div className="rating-badge black">{result.black.gameRating ?? '—'}</div>
          <div className="rating-confidence">{confidenceLabel(result.black.gameRatingConfidence)}</div>
        </div>
      </div>

      {/* Phase icons row */}
      <div className="phase-row">
        {result.white.phaseReviews.map((phase, i) => {
          const blackPhase = result.black.phaseReviews[i];
          return (
            <div key={phase.label} className="phase-cell">
              <PhaseIcon
                whiteIcon={phase.icon}
                blackIcon={blackPhase?.icon ?? 'none'}
                label={phase.label}
              />
              <span className="phase-accuracy">
                {phase.accuracy.toFixed(1)} / {blackPhase?.accuracy.toFixed(1) ?? '0.0'}
              </span>
              <span className="phase-meta white-meta">
                W {formatPhaseMeta(phase.moveCount ?? 0, phase.avgCpl ?? null)}
              </span>
              <span className="phase-meta black-meta">
                B {formatPhaseMeta(blackPhase?.moveCount ?? 0, blackPhase?.avgCpl ?? null)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Start Review button */}
      <button
        type="button"
        className="start-review-btn"
        aria-label="Start move-by-move review playback"
        onClick={onStartReview}
      >
        <span aria-hidden="true">{'★'}</span> Start Review
      </button>
    </motion.div>
    </MotionConfig>
  );
}
