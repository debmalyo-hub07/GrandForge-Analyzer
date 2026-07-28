// Keep in sync with `ENGINE_CONFIGS` / `EngineVersion` in
// `frontend/src/services/EngineManager.ts` and `ENGINE_VERSION_VALUES` in
// `backend/zodSchemas.ts`. `sf18-lite-mt` (the multi-threaded build) was
// missing here, which is the same drift that made MT users a permanent
// position-cache miss (data-audit §2c).
export type EngineVersion = 'sf18-lite' | 'sf18-lite-mt' | 'sf17-lite' | 'sf16-lite';

export interface EngineConfig {
  id: EngineVersion;
  label: string;
  file: string;
  sizeMB: number;
  description: string;
}

export interface UCIInfo {
  depth?: number;
  seldepth?: number;
  multipv?: number;
  score?: {
    type: 'cp' | 'mate';
    value: number;
    lowerbound?: boolean;
    upperbound?: boolean;
  };
  pv?: string[];
  nps?: number;
  nodes?: number;
  hashfull?: number;
  tbhits?: number;
  time?: number;
}

export interface EngineLine {
  multipv: number;
  eval: string;
  evalCp: number | null;
  mate: number | null;
  sanMoves: string[];
  uciMoves: string[];
  moveColor: 'white' | 'black' | 'equal';
}
