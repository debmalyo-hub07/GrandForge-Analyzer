import { motion } from 'framer-motion';
import { useUIStore } from '../../store/uiStore';
import { BOARD_THEMES, PIECE_SETS } from '../../types/themes';

export function ThemePickerRow() {
  const { boardTheme, setBoardTheme, pieceSet, setPieceSet } = useUIStore();

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="theme-picker-row flex flex-wrap items-center justify-between gap-3 py-2"
    >
      <div className="theme-swatches flex items-center gap-1.5">
        {BOARD_THEMES.map((theme) => {
          const isActive = boardTheme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              className={`theme-swatch relative w-7 h-7 rounded-md overflow-hidden border transition-all ${
                isActive
                  ? 'border-[var(--gold)] ring-1 ring-[var(--gold)] scale-105'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]'
              }`}
              title={theme.label}
              aria-label={`Board theme: ${theme.label}`}
              aria-pressed={isActive}
              onClick={() => setBoardTheme(theme.id)}
            >
              <div className="flex flex-col h-full w-full">
                <div
                  className="swatch-half flex-1"
                  style={{ background: theme.previewColors[0] }}
                />
                <div
                  className="swatch-half flex-1"
                  style={{ background: theme.previewColors[1] }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <div className="piece-set-swatches flex items-center gap-1.5">
        {PIECE_SETS.map((ps) => {
          const isActive = pieceSet === ps.id;
          return (
            <button
              key={ps.id}
              type="button"
              className={`piece-swatch w-8 h-8 rounded-md flex items-center justify-center border transition-all bg-[var(--bg-elevated)] ${
                isActive
                  ? 'border-[var(--gold)] ring-1 ring-[var(--gold)] scale-105'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]'
              }`}
              title={ps.label}
              aria-label={`Piece set: ${ps.label}`}
              aria-pressed={isActive}
              onClick={() => setPieceSet(ps.id)}
            >
              <img
                src={`${ps.path}${ps.previewPiece}`}
                alt={ps.label}
                width={24}
                height={24}
              />
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

export default ThemePickerRow;
