import type { MoveClassification } from './review';

export interface MoveNode {
  id: string;
  san: string;
  uci: string;
  fen: string;
  comment?: string;
  annotation?: '!' | '!!' | '?' | '??' | '!?' | '?!';
  engineEval?: string;
  reviewClassification?: MoveClassification;
  parentId: string | null;
  children: string[];
  isMainline: boolean;
  depth: number;
  plyNumber: number;
  moveNumber: number;
  color: 'w' | 'b';
}

export interface MoveTree {
  nodes: Record<string, MoveNode>;
  rootId: string;
  mainline?: string[];
}
