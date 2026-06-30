import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Square } from 'chess.js';
import { useEngineStore } from './engineStore';

export type Arrow = [string, string, string?];

interface UIState {
  theme: 'dark' | 'light';
  boardTheme: string;
  pieceSet: string;
  orientation: 'white' | 'black';
  showCoordinates: boolean;
  showLegalMoves: boolean;
  customArrows: Arrow[];
  highlightedSquares: Set<Square>;
  activeTab: 'analysis' | 'moves' | 'review' | 'import';
  boardSize: number;

  boardToolsOpen: boolean;
  inlineNotation: boolean;
  disclosureButtons: boolean;
  moveAnnotations: boolean;
  variationOpacity: number;

  // Computer Analysis
  computerAnalysis: boolean;
  bestMoveArrow: boolean;
  pieceManeuverArrows: boolean;
  evaluationGauge: boolean;

  // Visual Motifs
  undefendedPieces: boolean;
  pinnedPieces: boolean;
  checkableKing: boolean;

  flipBoard: () => void;
  toggleTheme: () => void;
  setShowCoordinates: (v: boolean) => void;
  setBoardTheme: (theme: string) => void;
  setPieceSet: (set: string) => void;
  addArrow: (arrow: Arrow) => void;
  clearArrows: () => void;
  setCustomArrows: (arrows: Arrow[]) => void;
  toggleHighlight: (square: Square) => void;
  clearHighlights: () => void;
  setActiveTab: (tab: 'analysis' | 'moves' | 'review' | 'import') => void;
  updateBoardSize: (size: number) => void;
  setBoardToolsOpen: (open: boolean) => void;
  setInlineNotation: (v: boolean) => void;
  setDisclosureButtons: (v: boolean) => void;
  setMoveAnnotations: (v: boolean) => void;
  setVariationOpacity: (v: number) => void;
  setComputerAnalysis: (v: boolean) => void;
  setBestMoveArrow: (v: boolean) => void;
  setPieceManeuverArrows: (v: boolean) => void;
  setEvaluationGauge: (v: boolean) => void;
  setUndefendedPieces: (v: boolean) => void;
  setPinnedPieces: (v: boolean) => void;
  setCheckableKing: (v: boolean) => void;
}

interface PersistedUIState {
  theme: 'dark' | 'light';
  boardTheme: string;
  pieceSet: string;
  orientation: 'white' | 'black';
  showCoordinates: boolean;
  showLegalMoves: boolean;
  activeTab: 'analysis' | 'moves' | 'review' | 'import';
  inlineNotation: boolean;
  disclosureButtons: boolean;
  moveAnnotations: boolean;
  variationOpacity: number;
  computerAnalysis: boolean;
  bestMoveArrow: boolean;
  pieceManeuverArrows: boolean;
  evaluationGauge: boolean;
  undefendedPieces: boolean;
  pinnedPieces: boolean;
  checkableKing: boolean;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      boardTheme: 'brown',
      pieceSet: 'cburnett',
      orientation: 'white',
      showCoordinates: true,
      showLegalMoves: true,
      customArrows: [],
      highlightedSquares: new Set<Square>(),
      activeTab: 'analysis',
      boardSize: 560,

      boardToolsOpen: false,
      inlineNotation: false,
      disclosureButtons: true,
      moveAnnotations: true,
      variationOpacity: 50,

      computerAnalysis: true,
      bestMoveArrow: true,
      pieceManeuverArrows: false,
      evaluationGauge: true,

      undefendedPieces: false,
      pinnedPieces: false,
      checkableKing: false,

      flipBoard: () =>
        set({ orientation: get().orientation === 'white' ? 'black' : 'white' }),
      toggleTheme: () =>
        set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setBoardTheme: (theme) => set({ boardTheme: theme }),
      setPieceSet: (s) => set({ pieceSet: s }),
      addArrow: (arrow) => set({ customArrows: [...get().customArrows, arrow] }),
      clearArrows: () => set({ customArrows: [] }),
      setCustomArrows: (arrows) => set({ customArrows: arrows }),
      toggleHighlight: (square) => {
        const next = new Set(get().highlightedSquares);
        if (next.has(square)) next.delete(square);
        else next.add(square);
        set({ highlightedSquares: next });
      },
      clearHighlights: () => set({ highlightedSquares: new Set<Square>() }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setShowCoordinates: (v) => set({ showCoordinates: v }),
      updateBoardSize: (size) => set({ boardSize: size }),
      setBoardToolsOpen: (open) => set({ boardToolsOpen: open }),
      setInlineNotation: (v) => set({ inlineNotation: v }),
      setDisclosureButtons: (v) => set({ disclosureButtons: v }),
      setMoveAnnotations: (v) => set({ moveAnnotations: v }),
      setVariationOpacity: (v) =>
        set({ variationOpacity: Math.max(0, Math.min(100, v)) }),
      setComputerAnalysis: (v) => {
        if (get().computerAnalysis === v) return;
        set({ computerAnalysis: v });
        useEngineStore.getState().setEnabled(v);
      },
      setBestMoveArrow: (v) => set({ bestMoveArrow: v }),
      setPieceManeuverArrows: (v) => set({ pieceManeuverArrows: v }),
      setEvaluationGauge: (v) => set({ evaluationGauge: v }),
      setUndefendedPieces: (v) => set({ undefendedPieces: v }),
      setPinnedPieces: (v) => set({ pinnedPieces: v }),
      setCheckableKing: (v) => set({ checkableKing: v }),
    }),
    {
      name: 'grandforge-ui',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedUIState => ({
        theme: state.theme,
        boardTheme: state.boardTheme,
        pieceSet: state.pieceSet,
        orientation: state.orientation,
        showCoordinates: state.showCoordinates,
        showLegalMoves: state.showLegalMoves,
        activeTab: state.activeTab,
        inlineNotation: state.inlineNotation,
        disclosureButtons: state.disclosureButtons,
        moveAnnotations: state.moveAnnotations,
        variationOpacity: state.variationOpacity,
        computerAnalysis: state.computerAnalysis,
        bestMoveArrow: state.bestMoveArrow,
        pieceManeuverArrows: state.pieceManeuverArrows,
        evaluationGauge: state.evaluationGauge,
        undefendedPieces: state.undefendedPieces,
        pinnedPieces: state.pinnedPieces,
        checkableKing: state.checkableKing,
      }),
      migrate: (persisted: any, version: number): PersistedUIState => {
        if (version < 2) {
          return {
            ...persisted,
            computerAnalysis: true,
            bestMoveArrow: true,
            pieceManeuverArrows: false,
            evaluationGauge: true,
            undefendedPieces: false,
            pinnedPieces: false,
            checkableKing: false,
          };
        }
        return persisted;
      },
    }
  )
);
