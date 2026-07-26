// src/components/review/ReviewProgressBar.tsx
import { motion } from 'framer-motion';
import { useReviewStore } from '../../store/reviewStore';

export function ReviewProgressBar() {
  const progress = useReviewStore((s) => s.progress);
  if (progress.phase !== 'analyzing') return null;

  return (
    <div className="review-progress-container">
      <div className="review-progress-label">
        Analyzing position {progress.currentPly} / {progress.totalPlies}…
      </div>
      <div className="review-progress-track">
        <motion.div
          className="review-progress-fill"
          animate={{ width: `${progress.percent}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
    </div>
  );
}
