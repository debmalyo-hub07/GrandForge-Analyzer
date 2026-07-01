// src/components/review/ReviewTab.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { motion, MotionConfig } from 'framer-motion';
import { Sparkles, Play, RotateCcw, X, Download } from 'lucide-react';
import { useReviewStore } from '../../store/reviewStore';
import { useEngineStore } from '../../store/engineStore';
import { useGameStore, getMainlinePath, buildIndexedGameFromTree } from '../../store/gameStore';
import { GameReviewService } from '../../services/GameReviewService';
import { review as reviewApi, reviewJobs } from '../../services/apiClient';
import { ReviewProgressBar } from './ReviewProgressBar';
import { ReviewSummaryCard } from './ReviewSummaryCard';
import { ReviewMovePanel } from './ReviewMovePanel';
import { useOpeningBookFens } from './useOpeningBookFens';
import { formatAnnotatedPgn } from '../../utils/pgnUtils';
import Button from '../ui/Button';

const DEPTH_OPTIONS: ReadonlyArray<{ value: number; label: string; description: string }> = [
  { value: 18, label: 'Balanced', description: '~2 min · default' },
  { value: 22, label: 'Deep',     description: '~5 min · chess.com-grade' },
  { value: 26, label: 'Master',   description: '~12 min · tournament' },
];

export function ReviewTab() {
  const result = useReviewStore((s) => s.result);
  const progress = useReviewStore((s) => s.progress);
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  const clearReview = useReviewStore((s) => s.clearReview);
  const enterReviewMode = useReviewStore((s) => s.enterReviewMode);
  const exitReviewMode = useReviewStore((s) => s.exitReviewMode);

  const manager = useEngineStore((s) => s.manager);
  const stopAnalysis = useEngineStore((s) => s.stopAnalysis);

  const moveTree = useGameStore((s) => s.moveTree);
  const goToStart = useGameStore((s) => s.goToStart);

  const getOpeningBookFens = useOpeningBookFens();

  const [selectedDepth, setSelectedDepth] = useState<number>(18);
  const [isStarting, setIsStarting] = useState(false);
  const serviceRef = useRef<GameReviewService | null>(null);

  // Stable client-side job id for progress checkpointing. Persists across
  // tab reloads via localStorage so the server-side ReviewJob row can be
  // resumed if the user comes back mid-review.
  const clientJobId = useMemo(() => {
    if (typeof window === 'undefined') return `job_${Date.now()}`;
    const KEY = 'grandforge_review_job_id';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  }, []);

  // Throttle job-state writes to one every 1500ms so we don't hammer Mongo
  // with progress updates on every ply.
  const lastJobWriteRef = useRef<number>(0);

  useEffect(() => () => { serviceRef.current?.cancel(); }, []);

  const writeJobState = async (
    status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled',
    depth: number,
    progress?: { currentPly: number; totalPlies: number; percent: number },
    errorMessage?: string,
    gameId?: string,
  ) => {
    const engineVersion = useEngineStore.getState().engineVersion ?? 'sf18-lite';
    try {
      await reviewJobs.upsert({
        clientJobId,
        status,
        depth,
        engineVersion,
        gameId,
        progress,
        errorMessage,
      });
    } catch {
      // Best-effort. Job tracking failures must never abort a review.
    }
  };

  const handleRun = async (depth: number) => {
    const game = buildIndexedGameFromTree(moveTree, getMainlinePath(moveTree).at(-1));
    if (!game) {
      toast.error('Play at least one move first');
      return;
    }
    if (!manager) {
      toast.error('Engine not ready');
      return;
    }
    if (game.plyCount === 0) {
      toast.error('Game has no moves to review');
      return;
    }

    setIsStarting(true);
    stopAnalysis();
    void writeJobState('queued', depth, { currentPly: 0, totalPlies: game.plyCount, percent: 0 }, undefined, game._id || undefined);
    try {
      const bookFens = await getOpeningBookFens();
      const svc = new GameReviewService(manager, (p) => {
        useReviewStore.getState().setProgress(p);
        // Throttled job-state write.
        const now = Date.now();
        if (p.phase === 'analyzing' && now - lastJobWriteRef.current > 1500) {
          lastJobWriteRef.current = now;
          void writeJobState('running', depth, {
            currentPly: p.currentPly,
            totalPlies: p.totalPlies,
            percent: p.percent,
          }, undefined, game._id || undefined);
        }
      });
      serviceRef.current = svc;
      const reviewResult = await svc.reviewGame(game, depth, bookFens);
      // Restart engine analysis on the current position after review completes,
      // so the evaluation bar doesn't show a stale/empty draw bar.
      const curFen = useGameStore.getState().currentFen;
      if (curFen) {
        useEngineStore.getState().startAnalysis(curFen);
      }
      useReviewStore.getState().setResult(reviewResult);
      toast.success('Review complete');
      void writeJobState('complete', depth, {
        currentPly: game.plyCount,
        totalPlies: game.plyCount,
        percent: 100,
      }, undefined, game._id || undefined);
      if (game._id) {
        try {
          await reviewApi.save({ gameId: game._id, reviewResult });
        } catch {
          // best-effort
        }
      }
    } catch (err) {
      stopAnalysis();
      const message = err instanceof Error ? err.message : 'Review failed';
      toast.error(message);
      useReviewStore.getState().setProgress({
        currentPly: 0,
        totalPlies: 0,
        percent: 0,
        phase: 'idle',
      });
      const status = message === 'Cancelled' ? 'cancelled' : 'failed';
      void writeJobState(status, depth, undefined, message, game._id || undefined);
    } finally {
      serviceRef.current = null;
      setIsStarting(false);
    }
  };

  const handleCancel = () => {
    serviceRef.current?.cancel();
    stopAnalysis();
    clearReview();
    toast('Review cancelled');
    void writeJobState('cancelled', selectedDepth);
  };

  const handleStartPlayback = () => {
    stopAnalysis();
    enterReviewMode();
    goToStart();
  };

  const handleExportPgn = () => {
    if (!result) return;
    const game = buildIndexedGameFromTree(moveTree, getMainlinePath(moveTree).at(-1));
    if (!game) {
      toast.error('No game to export');
      return;
    }
    const metadata = useGameStore.getState().gameMetadata ?? {};
    const pgn = formatAnnotatedPgn(metadata, game.moveSanList, result);
    try {
      const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grandforge-review-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pgn`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PGN exported');
    } catch (err) {
      console.error('PGN export failed', err);
      toast.error('Export failed');
    }
  };

  // ── State: analyzing ──────────────────────────────────────────────────────
  if (progress.phase === 'analyzing') {
    return (
      <MotionConfig reducedMotion="user">
        <div className="review-tab-root">
          <ReviewProgressBar />
          <div className="review-cancel-row">
            <button type="button" className="review-link-btn" onClick={handleCancel}>
              <X size={12} /> Cancel review
            </button>
          </div>
        </div>
      </MotionConfig>
    );
  }

  // ── State: complete ───────────────────────────────────────────────────────
  if (result) {
    // During active playback, replace summary with the per-move walkthrough
    // panel. Exit Review Playback returns to the summary view.
    if (isReviewMode) {
      return (
        <MotionConfig reducedMotion="user">
          <div className="review-tab-root">
            <ReviewMovePanel />
            <Button
              variant="ghost"
              size="md"
              fullWidth
              leftIcon={<X size={12} />}
              onClick={exitReviewMode}
            >
              Exit Review Playback
            </Button>
          </div>
        </MotionConfig>
      );
    }

    return (
      <MotionConfig reducedMotion="user">
        <div className="review-tab-root">
        <ReviewSummaryCard result={result} onStartReview={handleStartPlayback} />
        <div className="review-actions-row">
          <Button
            variant="primary"
            size="md"
            fullWidth
            leftIcon={<Play size={14} />}
            onClick={handleStartPlayback}
          >
            Start Review Playback
          </Button>
        </div>

        <div className="review-depth-section">
          <div className="review-depth-label">
            Re-run analysis at a different depth
          </div>
          <div className="review-depth-grid">
            {DEPTH_OPTIONS.map((opt) => {
              const active = opt.value === selectedDepth;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`review-depth-chip${active ? ' is-active' : ''}`}
                  onClick={() => setSelectedDepth(opt.value)}
                  disabled={isStarting}
                >
                  <span className="review-depth-chip-value">d{opt.value}</span>
                  <span className="review-depth-chip-label">{opt.label}</span>
                  <span className="review-depth-chip-time">{opt.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          variant="ghost"
          size="md"
          fullWidth
          leftIcon={<RotateCcw size={12} />}
          onClick={() => handleRun(selectedDepth)}
          disabled={isStarting}
        >
          {`Run review at d${selectedDepth}`}
        </Button>

        <Button
          variant="ghost"
          size="md"
          fullWidth
          leftIcon={<Download size={12} />}
          onClick={handleExportPgn}
        >
          Export annotated PGN
        </Button>

        <Button
          variant="ghost"
          size="md"
          fullWidth
          leftIcon={<X size={12} />}
          onClick={clearReview}
        >
          Close Review
        </Button>
      </div>
      </MotionConfig>
    );
  }

  // ── State: idle ───────────────────────────────────────────────────────────
  const derivedGame = buildIndexedGameFromTree(moveTree, getMainlinePath(moveTree).at(-1));
  const gameLoaded = derivedGame !== null && derivedGame.plyCount > 0;
  const mainlinePath = getMainlinePath(moveTree);
  const moveCount = Math.max(0, mainlinePath.length - 1);

  return (
    <MotionConfig reducedMotion="user">
    <motion.div
      className="review-tab-root"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="review-hero-card">
        <div className="review-hero-icon">
          <Sparkles size={22} />
        </div>
        <h3 className="review-hero-title">Game Review</h3>
        <p className="review-hero-subtitle">
          Analyze every move with Stockfish 18 to discover Brilliants, Blunders, and your best
          chances.
        </p>

        <div className="review-depth-section">
          <div className="review-depth-label">Analysis Depth</div>
          <div className="review-depth-grid">
            {DEPTH_OPTIONS.map((opt) => {
              const active = opt.value === selectedDepth;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`review-depth-chip${active ? ' is-active' : ''}`}
                  onClick={() => setSelectedDepth(opt.value)}
                  disabled={isStarting}
                >
                  <span className="review-depth-chip-value">d{opt.value}</span>
                  <span className="review-depth-chip-label">{opt.label}</span>
                  <span className="review-depth-chip-time">{opt.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={isStarting}
          disabled={!gameLoaded || !manager || isStarting}
          leftIcon={!isStarting ? <Sparkles size={16} /> : undefined}
          onClick={() => handleRun(selectedDepth)}
        >
          {isStarting ? 'Starting…' : 'Run Review'}
        </Button>

        {!gameLoaded && moveCount === 0 && (
          <p className="review-hero-hint">Play at least one move to review</p>
        )}
        {!gameLoaded && moveCount > 0 && !manager && (
          <p className="review-hero-hint">Waiting for engine to load…</p>
        )}
        {gameLoaded && manager && (
          <p className="review-hero-meta">
            {derivedGame!.plyCount} plies · {moveCount} moves to
            analyze
          </p>
        )}
      </div>
    </motion.div>
    </MotionConfig>
  );
}
