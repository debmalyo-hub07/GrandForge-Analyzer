export type EngineVersion = 'sf18-lite' | 'sf17-lite' | 'sf16-lite';

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
