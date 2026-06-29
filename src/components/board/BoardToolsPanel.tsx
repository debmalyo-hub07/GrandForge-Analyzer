import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeftRight, Pencil, Scissors, Clipboard, X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useGameStore } from '../../store/gameStore';
import Slider from '../ui/Slider';
import { BoardEditor } from './BoardEditor';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="tools-toggle flex items-center justify-between gap-3 py-1.5 cursor-pointer select-none">
      <span className="text-sm text-[var(--text-primary)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-[var(--gold)]' : 'bg-[var(--bg-elevated)]'
        } border border-[var(--border)]`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

export interface BoardToolsPanelProps {
  onClose: () => void;
}

export function BoardToolsPanel({ onClose }: BoardToolsPanelProps) {
  const flipBoard = useUIStore((s) => s.flipBoard);
  const showCoordinates = useUIStore((s) => s.showCoordinates);
  const setShowCoordinates = useUIStore((s) => s.setShowCoordinates);
  const disclosureButtons = useUIStore((s) => s.disclosureButtons);
  const setDisclosureButtons = useUIStore((s) => s.setDisclosureButtons);
  const moveAnnotations = useUIStore((s) => s.moveAnnotations);
  const setMoveAnnotations = useUIStore((s) => s.setMoveAnnotations);
  const variationOpacity = useUIStore((s) => s.variationOpacity);
  const setVariationOpacity = useUIStore((s) => s.setVariationOpacity);
  const computerAnalysis = useUIStore((s) => s.computerAnalysis);
  const setComputerAnalysis = useUIStore((s) => s.setComputerAnalysis);
  const bestMoveArrow = useUIStore((s) => s.bestMoveArrow);
  const setBestMoveArrow = useUIStore((s) => s.setBestMoveArrow);
  const evaluationGauge = useUIStore((s) => s.evaluationGauge);
  const setEvaluationGauge = useUIStore((s) => s.setEvaluationGauge);
  const undefendedPieces = useUIStore((s) => s.undefendedPieces);
  const setUndefendedPieces = useUIStore((s) => s.setUndefendedPieces);
  const pinnedPieces = useUIStore((s) => s.pinnedPieces);
  const setPinnedPieces = useUIStore((s) => s.setPinnedPieces);
  const checkableKing = useUIStore((s) => s.checkableKing);
  const setCheckableKing = useUIStore((s) => s.setCheckableKing);

  const currentFen = useGameStore((s) => s.currentFen);
  const loadFEN = useGameStore((s) => s.loadFEN);

  const [editorOpen, setEditorOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const handleContinueFromHere = () => {
    loadFEN(currentFen);
    onClose();
  };

  const handlePasteFen = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim() && loadFEN(text.trim())) {
        onClose();
      }
    } catch { /* clipboard not available */ }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      const el = (e.target as HTMLElement | null)?.closest?.('[aria-label="Board tools"]');
      if (el) return;
      onClose();
    };
    const id = window.setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  return (
    <>
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="board-tools-panel w-full max-w-md p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] shadow-xl flex flex-col gap-3 max-h-[70vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-semibold">
            Board Tools
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="tools-grid grid grid-cols-2 gap-2">
          <button
            type="button"
            className="tool-btn flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)]"
            onClick={() => {
              flipBoard();
              onClose();
            }}
          >
            <ArrowLeftRight size={14} className="tool-icon" />
            <span>Flip board</span>
          </button>
          <button
            type="button"
            className="tool-btn flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)]"
            onClick={() => setEditorOpen(true)}
          >
            <Pencil size={14} className="tool-icon" />
            <span>Board editor</span>
          </button>
          <button
            type="button"
            className="tool-btn flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)]"
            onClick={handleContinueFromHere}
          >
            <Scissors size={14} className="tool-icon" />
            <span>Continue from here</span>
          </button>
          <button
            type="button"
            className="tool-btn flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)]"
            onClick={handlePasteFen}
          >
            <Clipboard size={14} className="tool-icon" />
            <span>Paste FEN</span>
          </button>
        </div>

        <div className="tools-divider text-[10px] uppercase tracking-widest text-[var(--text-muted)] border-t border-[var(--border)] pt-2">
          Display
        </div>

        <div className="tools-toggles flex flex-col gap-1">
          <Toggle
            label="Inline notation"
            checked={showCoordinates}
            onChange={setShowCoordinates}
          />
          <Toggle
            label="Disclosure buttons"
            checked={disclosureButtons}
            onChange={setDisclosureButtons}
          />
          <Toggle
            label="Move annotations"
            checked={moveAnnotations}
            onChange={setMoveAnnotations}
          />
          <div className="variation-opacity-row flex flex-col gap-1 pt-1">
            <span className="tools-label text-xs text-[var(--text-secondary)] uppercase tracking-wide">
              Variation opacity
            </span>
            <Slider
              min={0}
              max={100}
              value={variationOpacity}
              onChange={setVariationOpacity}
              showValue
              formatValue={(v) => `${v}%`}
            />
          </div>
        </div>

        <div className="tools-divider text-[10px] uppercase tracking-widest text-[var(--text-muted)] border-t border-[var(--border)] pt-2">
          Computer Analysis
        </div>

        <div className="tools-toggles flex flex-col gap-1">
          <Toggle
            label="Computer Analysis"
            checked={computerAnalysis}
            onChange={setComputerAnalysis}
          />
          <Toggle
            label="Best Move Arrow"
            checked={bestMoveArrow}
            onChange={setBestMoveArrow}
          />
          <Toggle
            label="Evaluation Gauge"
            checked={evaluationGauge}
            onChange={setEvaluationGauge}
          />
        </div>

        <div className="tools-divider text-[10px] uppercase tracking-widest text-[var(--text-muted)] border-t border-[var(--border)] pt-2">
          Visual Motifs
        </div>

        <div className="tools-toggles flex flex-col gap-1">
          <Toggle
            label="Undefended Pieces"
            checked={undefendedPieces}
            onChange={setUndefendedPieces}
          />
          <Toggle
            label="Pinned Pieces"
            checked={pinnedPieces}
            onChange={setPinnedPieces}
          />
          <Toggle
            label="Checkable King"
            checked={checkableKing}
            onChange={setCheckableKing}
          />
        </div>
      </motion.div>

      {editorOpen && (
        <BoardEditor
          initialFen={currentFen}
          onClose={() => setEditorOpen(false)}
          onConfirm={(fen) => {
            loadFEN(fen);
            setEditorOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

export default BoardToolsPanel;
