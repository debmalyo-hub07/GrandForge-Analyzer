// src/components/import/PGNImport.tsx
import { useState, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useMutation } from '@tanstack/react-query';
import { games as gamesApi } from '../../services/apiClient';
import { useGameStore } from '../../store/gameStore';
import type { IndexedGame } from '../../services/GameEngineAdapter';

export function PGNImport() {
  const [pgn, setPgn] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadIndexedGame = useGameStore((s) => s.loadIndexedGame);
  const loadPGN = useGameStore((s) => s.loadPGN);

  const uploadMutation = useMutation({
    mutationFn: (rawPgn: string) => gamesApi.upload({ pgn: rawPgn }),
    onSuccess: (data: { game?: IndexedGame } | IndexedGame) => {
      const game = (data as { game?: IndexedGame }).game ?? (data as IndexedGame);
      if (game && game.fenPositions && game.moveUciList) {
        loadIndexedGame(game);
        toast.success('PGN loaded');
      } else if (!loadPGN(pgn)) {
        toast.error('Invalid PGN');
      } else {
        toast.success('PGN loaded (offline)');
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to upload PGN';
      try {
        if (!loadPGN(pgn)) {
          toast.error('Invalid PGN');
        } else {
          toast.success('PGN loaded locally');
        }
      } catch {
        toast.error(message);
      }
    },
  });

  const handleLoad = () => {
    if (!pgn.trim()) {
      toast.error('Paste a PGN first');
      return;
    }
    uploadMutation.mutate(pgn.trim());
  };

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.pgn') && file.type !== 'application/x-chess-pgn') {
        toast.error('Please drop a .pgn file');
        return;
      }
      try {
        const text = await file.text();
        setPgn(text);
      } catch {
        toast.error('Failed to read file');
      }
    },
    [],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="pgn-import">
      <header className="import-section-header">
        <h3 className="import-section-title">Paste or upload PGN</h3>
        <p className="import-section-hint">
          Drop a <code>.pgn</code> file or paste game notation below.
        </p>
      </header>

      <div
        className={`pgn-import-dropzone ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <span>Drop .pgn file here, or click to browse</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pgn,application/x-chess-pgn"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <textarea
        className="pgn-import-textarea"
        value={pgn}
        onChange={(e) => setPgn(e.target.value)}
        placeholder="Or paste raw PGN here…"
        rows={10}
        spellCheck={false}
      />

      <button
        type="button"
        className="pgn-import-submit"
        onClick={handleLoad}
        disabled={uploadMutation.isPending || !pgn.trim()}
      >
        {uploadMutation.isPending ? 'Loading…' : 'Load PGN'}
      </button>
    </div>
  );
}
