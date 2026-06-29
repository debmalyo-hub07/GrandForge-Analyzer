export interface BoardTheme {
  id: string;
  label: string;
  lightSquare: string;
  darkSquare: string;
  previewColors: [string, string]; // [light, dark] for swatch
}

export const BOARD_THEMES: BoardTheme[] = [
  { id: 'brown',  label: 'Classic',  lightSquare: '#f0d9b5', darkSquare: '#b58863', previewColors: ['#f0d9b5','#b58863'] },
  { id: 'green',  label: 'Green',    lightSquare: '#ffffdd', darkSquare: '#86a666', previewColors: ['#ffffdd','#86a666'] },
  { id: 'blue',   label: 'Blue',     lightSquare: '#dee3e6', darkSquare: '#8ca2ad', previewColors: ['#dee3e6','#8ca2ad'] },
  { id: 'ice',    label: 'Ice',      lightSquare: '#e6f0f5', darkSquare: '#7ba5c4', previewColors: ['#e6f0f5','#7ba5c4'] },
  { id: 'marble', label: 'Marble',   lightSquare: '#e8d5b0', darkSquare: '#a07840', previewColors: ['#e8d5b0','#a07840'] },
  { id: 'walnut', label: 'Walnut',   lightSquare: '#d8b48e', darkSquare: '#7d4e2d', previewColors: ['#d8b48e','#7d4e2d'] },
  { id: 'neon',   label: 'Neon',     lightSquare: '#1a1a2e', darkSquare: '#16213e', previewColors: ['#1a1a2e','#00d4ff'] },
];

export interface PieceSet {
  id: string;
  label: string;
  path: string;        // public/pieces/{id}/
  previewPiece: string; // filename of preview image
}

export const PIECE_SETS: PieceSet[] = [
  { id: 'cburnett', label: 'CBurnett', path: '/pieces/cburnett/', previewPiece: 'wN.svg' },
  { id: 'neo',      label: 'Neo',      path: '/pieces/neo/',      previewPiece: 'wN.svg' },
  { id: 'classic',  label: 'Classic',  path: '/pieces/classic/',  previewPiece: 'wN.svg' },
  { id: 'alpha',    label: 'Alpha',    path: '/pieces/alpha/',    previewPiece: 'wN.svg' },
  { id: 'cardinal', label: 'Cardinal', path: '/pieces/cardinal/', previewPiece: 'wN.svg' },
  { id: 'merida',   label: 'Merida',   path: '/pieces/merida/',   previewPiece: 'wN.svg' },
];
