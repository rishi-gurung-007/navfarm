'use client';

import type { ComponentType, CSSProperties, ReactNode } from 'react';

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<Tone, { fg: string; bg: string }> = {
  accent: { fg: 'var(--accent)', bg: 'var(--accent-muted)' },
  success: { fg: 'var(--success)', bg: 'var(--success-muted)' },
  warning: { fg: 'var(--warning)', bg: 'var(--warning-muted)' },
  danger: { fg: 'var(--danger)', bg: 'var(--danger-muted)' },
  info: { fg: 'var(--info)', bg: 'var(--surface-secondary)' },
};

type Icon = ComponentType<{ className?: string; style?: CSSProperties }>;

/** The page title for the selected tab: a tinted icon, what the tab is for, and its one primary action. */
export function PageHeader({ icon: Icon, title, subtitle, action }: { icon: Icon; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-11 h-11 rounded-[var(--radius-md)] flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--accent-muted)' }}>
          <Icon className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {subtitle}
          </p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export interface Stat {
  label: string;
  value: ReactNode;
  caption?: string;
  icon: Icon;
  tone?: Tone;
}

/** A row of figures for the selected tab. */
export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
      {stats.map(({ label, value, caption, icon: Icon, tone = 'accent' }) => (
        <div
          key={label}
          className="rounded-[var(--radius-lg)] border p-4 flex items-start justify-between gap-3 transition-colors hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="min-w-0">
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {label}
            </p>
            <p className="text-2xl font-bold mt-1 leading-none truncate" style={{ color: 'var(--text-primary)' }}>
              {value}
            </p>
            {caption && (
              <p className="text-[11px] mt-1.5 truncate" style={{ color: 'var(--text-muted)' }}>
                {caption}
              </p>
            )}
          </div>
          <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: TONE[tone].bg }}>
            <Icon className="w-4 h-4" style={{ color: TONE[tone].fg }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon: Icon;
  count?: number;
}

/** The tabs as one rounded bar, the selected one raised; scrolls sideways on a narrow screen instead of wrapping. */
export function TabBar<K extends string>({ tabs, value, onChange }: { tabs: TabItem<K>[]; value: K; onChange: (key: K) => void }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-1">
      <div role="tablist" className="inline-flex gap-1 p-1 rounded-[var(--radius-lg)] border min-w-full sm:min-w-0" style={{ backgroundColor: 'var(--surface-secondary)', borderColor: 'var(--border)' }}>
        {tabs.map(({ key, label, icon: Icon, count }) => {
          const active = key === value;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(key)}
              className="px-3.5 py-2 rounded-[var(--radius-md)] text-sm font-semibold flex items-center gap-2 whitespace-nowrap transition-all cursor-pointer"
              style={
                active
                  ? { backgroundColor: 'var(--surface)', color: 'var(--accent)', boxShadow: '0 1px 3px rgba(0,0,0,0.18)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              <Icon className="w-4 h-4" />
              {label}
              {count != null && (
                <span
                  className="text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                  style={active ? { backgroundColor: 'var(--accent-muted)', color: 'var(--accent)' } : { backgroundColor: 'var(--surface-raised)', color: 'var(--text-muted)' }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
