import { motion } from 'framer-motion';
import { Crown, Clock } from 'lucide-react';

export interface PlayerTagProps {
  side: 'white' | 'black';
  name?: string;
  rating?: number;
  isToMove?: boolean;
}

export function PlayerTag({ side, name, rating, isToMove = false }: PlayerTagProps) {
  const displayName = name?.trim() || (side === 'white' ? 'White' : 'Black');
  const ratingText = rating != null && rating > 0 ? rating.toString() : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`player-tag inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
        side === 'white'
          ? 'bg-[var(--bg-surface)] border-[var(--border-strong)] text-[var(--text-primary)]'
          : 'bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-primary)]'
      } ${isToMove ? 'ring-1 ring-[var(--gold)] shadow-[0_0_0_2px_var(--gold-glow)]' : ''}`}
    >
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-sm ${
          side === 'white'
            ? 'bg-[var(--eval-white)] text-[var(--eval-black)]'
            : 'bg-[var(--eval-black)] text-[var(--eval-white)] border border-[var(--border-strong)]'
        }`}
        aria-hidden
      >
        <Crown size={12} />
      </span>
      <span className="player-name font-medium truncate max-w-[180px]">
        {displayName}
      </span>
      {ratingText && (
        <span className="player-rating font-mono text-xs text-[var(--text-secondary)]">
          ({ratingText})
        </span>
      )}
      {isToMove && (
        <span
          className="ml-1 inline-flex items-center gap-1 text-[var(--gold)] text-xs"
          aria-label="To move"
        >
          <Clock size={12} />
          <span className="uppercase tracking-wide">to move</span>
        </span>
      )}
    </motion.div>
  );
}

export default PlayerTag;
