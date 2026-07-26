import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';
import { AnalyzerLayout } from '../components/layout/AnalyzerLayout';
import { SidePanel } from '../components/layout/SidePanel';
import { ResizableBoardWrapper } from '../components/board/ResizableBoardWrapper';
import { BoardControls } from '../components/board/BoardControls';
import { PlayerTag } from '../components/board/PlayerTag';
import { BoardToolsPanel } from '../components/board/BoardToolsPanel';
import { ThemePickerRow } from '../components/board/ThemePickerRow';
import { EvaluationBar } from '../components/evaluation/EvaluationBar';
import { EvalBarHorizontal } from '../components/evaluation/EvalBarHorizontal';
import { EngineLines } from '../components/engine/EngineLines';
import { EngineControls } from '../components/engine/EngineControls';
import { EngineVersionSelector } from '../components/engine/EngineVersionSelector';
import { OpeningBadge } from '../components/navigation/OpeningBadge';
import { MoveList } from '../components/navigation/MoveList';
import { NavigationControls } from '../components/navigation/NavigationControls';
import { ReviewTab } from '../components/review/ReviewTab';
import { ImportTab } from '../components/import/ImportTab';
import { useStockfish } from '../hooks/useStockfish';
import { useOpeningDetect } from '../hooks/useOpeningDetect';
import { useReviewPlayback } from '../hooks/useReviewPlayback';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { games as gamesApi } from '../services/apiClient';
import type { IndexedGame } from '../services/GameEngineAdapter';

// ────────────────────────────────────────────────────────────────────────────
// AnalyzerPage
// ────────────────────────────────────────────────────────────────────────────

export function AnalyzerPage() {
  const { id } = useParams<{ id?: string }>();
  const { isReady } = useStockfish({ defaultEngine: 'sf18-lite' });

  // Drive opening detection and review playback side-effects while the page is mounted.
  useOpeningDetect();
  useReviewPlayback();

  const loadIndexedGame = useGameStore((s) => s.loadIndexedGame);
  const gameMetadata = useGameStore((s) => s.gameMetadata);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const moveTree = useGameStore((s) => s.moveTree);
  const orientation = useUIStore((s) => s.orientation);
  const boardToolsOpen = useUIStore((s) => s.boardToolsOpen);
  const setBoardToolsOpen = useUIStore((s) => s.setBoardToolsOpen);
  const boardSize = useUIStore((s) => s.boardSize);
  const evaluationGauge = useUIStore((s) => s.evaluationGauge);
  const computerAnalysis = useUIStore((s) => s.computerAnalysis);

  // Whose turn it is — root node is 'w' to move; otherwise alternate based on plyNumber.
  const sideToMove: 'white' | 'black' = (() => {
    const node = currentNodeId ? moveTree.nodes[currentNodeId] : null;
    if (!node) return 'white';
    return node.plyNumber % 2 === 0 ? 'white' : 'black';
  })();

  const { data, isError, error } = useQuery<{ game: IndexedGame }>({
    queryKey: ['game', id],
    queryFn: () => gamesApi.get(id as string),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (data?.game) {
      try {
        loadIndexedGame(data.game);
      } catch (err) {
        console.error('GrandForge AnalyzerPage: failed to load indexed game', err);
        toast.error('Game is not engine-indexed yet');
      }
    }
  }, [data, loadIndexedGame]);

  useEffect(() => {
    if (isError) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to load game';
      toast.error(message);
    }
  }, [isError, error]);

  // Player names (with sane fallbacks).
  const whiteName = gameMetadata?.white;
  const whiteRating = gameMetadata?.whiteElo;
  const blackName = gameMetadata?.black;
  const blackRating = gameMetadata?.blackElo;

  // Render top tag = opponent of bottom orientation.
  const topSide: 'white' | 'black' = orientation === 'white' ? 'black' : 'white';
  const bottomSide: 'white' | 'black' = orientation === 'white' ? 'white' : 'black';

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
      <Header />

      {!isReady && (
        <div className="w-full bg-[var(--bg-surface)] border-b border-[var(--border)] py-1.5 text-center text-xs text-[var(--text-secondary)]">
          Loading Stockfish engine…
        </div>
      )}

      <main className="flex-1">
        <AnalyzerLayout
          evalBar={
            evaluationGauge && computerAnalysis ? (
              <EvaluationBar height={Math.max(320, boardSize)} />
            ) : (
              <div className="w-8" style={{ height: Math.max(320, boardSize) }} />
            )
          }
          board={
            <div className="board-column relative flex flex-col gap-2">
              <div className="md:hidden">
                <EvalBarHorizontal />
              </div>
              <div className="player-tag-row">
                <PlayerTag
                  side={topSide}
                  name={topSide === 'white' ? whiteName : blackName}
                  rating={topSide === 'white' ? whiteRating : blackRating}
                  isToMove={sideToMove === topSide}
                />
              </div>

              <ResizableBoardWrapper />

              <div className="player-tag-row">
                <PlayerTag
                  side={bottomSide}
                  name={bottomSide === 'white' ? whiteName : blackName}
                  rating={bottomSide === 'white' ? whiteRating : blackRating}
                  isToMove={sideToMove === bottomSide}
                />
              </div>

              <div className="relative">
                <BoardControls />
                {boardToolsOpen && (
                  <div className="absolute left-0 right-0 top-full mt-2 z-30">
                    <BoardToolsPanel onClose={() => setBoardToolsOpen(false)} />
                  </div>
                )}
              </div>

              <NavigationControls />

              <ThemePickerRow />
            </div>
          }
          sidePanel={
            <SidePanel
              analysis={
                <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
                  <EngineVersionSelector />
                  <EngineControls />
                  <EngineLines />
                </div>
              }
              moves={
                <div className="flex flex-col gap-2 p-3 h-full">
                  <OpeningBadge />
                  <div className="flex-1 overflow-y-auto">
                    <MoveList />
                  </div>
                </div>
              }
              review={<ReviewTab />}
              importPanel={<ImportTab />}
            />
          }
        />
      </main>

      <Footer />
    </div>
  );
}

export default AnalyzerPage;
