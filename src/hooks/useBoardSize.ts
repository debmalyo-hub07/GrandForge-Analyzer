import { useEffect, useRef, useState, type RefObject } from 'react';

const MIN_BOARD_SIZE = 320;
const MAX_BOARD_SIZE = 620;
const PADDING = 32;

export function useBoardSize<T extends HTMLElement = HTMLDivElement>(): {
  containerRef: RefObject<T>;
  boardSize: number;
} {
  const containerRef = useRef<T>(null);
  const [boardSize, setBoardSize] = useState<number>(480);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = (width: number, height: number) => {
      const available = Math.min(width, height) - PADDING;
      const clamped = Math.max(MIN_BOARD_SIZE, Math.min(MAX_BOARD_SIZE, available));
      setBoardSize(Math.floor(clamped));
    };

    compute(el.clientWidth, el.clientHeight || el.clientWidth);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        compute(width, height || width);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { containerRef, boardSize };
}
