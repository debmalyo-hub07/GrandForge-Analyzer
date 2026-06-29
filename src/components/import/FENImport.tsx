// src/components/import/FENImport.tsx
import { useState } from 'react';
import { Chess } from 'chess.js';
import toast from 'react-hot-toast';
import { useGameStore } from '../../store/gameStore';

export function FENImport() {
  const [fen, setFen] = useState('');
  const loadFEN = useGameStore((s) => s.loadFEN);

  const handleLoad = () => {
    const trimmed = fen.trim();
    if (!trimmed) {
      toast.error('Enter a FEN string');
      return;
    }
    try {
      // Validate before loading — chess.js throws on invalid FEN.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _chess = new Chess(trimmed);
    } catch {
      toast.error('Invalid FEN');
      return;
    }
    loadFEN(trimmed);
    toast.success('Position loaded');
  };

  return (
    <div className="fen-import">
      <header className="import-section-header">
        <h3 className="import-section-title">Load from FEN</h3>
        <p className="import-section-hint">
          Paste a FEN string to set up any position instantly.
        </p>
      </header>

      <label htmlFor="gf-fen-input" className="fen-import-label">
        FEN
      </label>
      <input
        id="gf-fen-input"
        type="text"
        className="fen-import-input"
        value={fen}
        onChange={(e) => setFen(e.target.value)}
        placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        spellCheck={false}
      />
      <button type="button" className="fen-import-submit" onClick={handleLoad}>
        Load Position
      </button>
    </div>
  );
}
