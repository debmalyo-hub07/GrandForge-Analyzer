import { ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_STYLES: Record<NonNullable<TabsProps['size']>, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-10 px-3.5 text-sm gap-2',
  lg: 'h-12 px-4 text-base gap-2',
};

function Tabs({
  tabs,
  activeId,
  onChange,
  fullWidth = false,
  size = 'md',
  className = '',
}: TabsProps) {
  return (
    <div
      role="tablist"
      className={`relative flex items-stretch border-b border-[var(--border)] ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.id)}
            className={`relative inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-inset disabled:opacity-50 disabled:cursor-not-allowed ${
              SIZE_STYLES[size]
            } ${fullWidth ? 'flex-1' : ''} ${
              isActive
                ? 'text-[var(--text-accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.icon && <span className="inline-flex shrink-0">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== null && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                {tab.badge}
              </span>
            )}
            {isActive && (
              <motion.span
                layoutId="grandforge-tab-underline"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[var(--gold-dim)] via-[var(--gold)] to-[var(--gold-dim)]"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
