// src/services/GameEngineAdapter.ts
import { EngineManager } from './EngineManager';
import type { GameReviewResult } from '../types/review';

export interface IndexedGame {
  _id: string;
  pgn: string;
  fenPositions: string[];
  moveUciList: string[];
  moveSanList: string[];
  plyCount: number;
  engineReady: boolean;
  reviewResult?: GameReviewResult;
  /**
   * MoveNode ids of the exact line this indexed game was built from, root first
   * (length === plyCount + 1). Lets a review pin itself to the line it analyzed.
   * Empty for games not sourced from the local move tree (e.g. server fetch).
   */
  reviewedNodeIds: string[];
  metadata: Record<string, unknown>;
}

export class GameEngineAdapter {
  private engine: EngineManager;
  private currentGame: IndexedGame | null = null;
  private currentPly = 0;

  constructor(engine: EngineManager) { this.engine = engine; }

  loadGame(game: IndexedGame): void {
    if (!game.engineReady) throw new Error(`GrandForge: game ${game._id} not engine-indexed`);
    this.currentGame = game;
    this.currentPly = 0;
  }

  analyzeCurrentPosition(depth: number, multiPV: 1 | 2 | 3 | 4 | 5): void {
    if (!this.currentGame) throw new Error('No game loaded');
    this.engine.analyze({
      uciMoves: this.currentGame.moveUciList.slice(0, this.currentPly),
      depth,
      multiPV,
    });
  }

  goToPlyAndAnalyze(ply: number, depth: number, multiPV: 1 | 2 | 3 | 4 | 5): void {
    if (!this.currentGame) throw new Error('No game loaded');
    if (ply < 0 || ply > this.currentGame.plyCount) throw new RangeError(`Ply ${ply} out of range`);
    this.currentPly = ply;
    this.analyzeCurrentPosition(depth, multiPV);
  }

  getFenAtPly(ply: number): string {
    if (!this.currentGame) throw new Error('No game loaded');
    return this.currentGame.fenPositions[ply];
  }

  stepForward(): string | null {
    if (!this.currentGame || this.currentPly >= this.currentGame.plyCount) return null;
    return this.getFenAtPly(++this.currentPly);
  }

  stepBack(): string | null {
    if (!this.currentGame || this.currentPly === 0) return null;
    return this.getFenAtPly(--this.currentPly);
  }

  getCurrentPly(): number { return this.currentPly; }
  getCurrentFen(): string | null { return this.currentGame ? this.getFenAtPly(this.currentPly) : null; }
  getLoadedGame(): IndexedGame | null { return this.currentGame; }
}
