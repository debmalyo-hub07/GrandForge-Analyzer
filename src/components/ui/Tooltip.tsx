import {
  ReactNode,
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  placement?: TooltipPlacement;
  delay?: number;
  disabled?: boolean;
  className?: string;
}

interface Position {
  top: number;
  left: number;
}

function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 200,
  disabled = false,
  className = '',
}: TooltipProps) {
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return;

    const t = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gap = 8;
    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = t.top - tipRect.height - gap;
        left = t.left + t.width / 2 - tipRect.width / 2;
        break;
      case 'bottom':
        top = t.bottom + gap;
        left = t.left + t.width / 2 - tipRect.width / 2;
        break;
      case 'left':
        top = t.top + t.height / 2 - tipRect.height / 2;
        left = t.left - tipRect.width - gap;
        break;
      case 'right':
        top = t.top + t.height / 2 - tipRect.height / 2;
        left = t.right + gap;
        break;
    }

    // Clamp to viewport
    left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - tipRect.height - 8, top));
    setPosition({ top, left });
  };

  useLayoutEffect(() => {
    if (isOpen) updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, content, placement]);

  const open = () => {
    if (disabled) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsOpen(true), delay);
  };

  const close = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsOpen(false);
  };

  const handlers = {
    onMouseEnter: open,
    onMouseLeave: close,
    onFocus: () => !disabled && setIsOpen(true),
    onBlur: close,
    'aria-describedby': isOpen ? id : undefined,
  };

  let trigger: ReactNode;
  if (isValidElement(children)) {
    trigger = cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      ref: (node: HTMLElement) => {
        triggerRef.current = node;
        const childRef = (children as unknown as { ref?: React.Ref<HTMLElement> }).ref;
        if (typeof childRef === 'function') childRef(node);
        else if (childRef && typeof childRef === 'object')
          (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
      },
      ...handlers,
    });
  } else {
    trigger = (
      <span ref={triggerRef as React.RefObject<HTMLSpanElement>} {...handlers}>
        {children}
      </span>
    );
  }

  const offsets: Record<TooltipPlacement, { x: number; y: number }> = {
    top: { x: 0, y: 4 },
    bottom: { x: 0, y: -4 },
    left: { x: 4, y: 0 },
    right: { x: -4, y: 0 },
  };

  return (
    <>
      {trigger}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isOpen && content && (
              <motion.div
                ref={tooltipRef}
                id={id}
                role="tooltip"
                initial={{
                  opacity: 0,
                  x: offsets[placement].x,
                  y: offsets[placement].y,
                }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{
                  opacity: 0,
                  x: offsets[placement].x,
                  y: offsets[placement].y,
                }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                style={{
                  position: 'fixed',
                  top: position.top,
                  left: position.left,
                  zIndex: 60,
                  pointerEvents: 'none',
                }}
                className={`px-2.5 py-1.5 max-w-xs text-xs leading-snug font-medium rounded-md bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)] shadow-[0_6px_20px_rgba(0,0,0,0.45)] ${className}`}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

export default Tooltip;
