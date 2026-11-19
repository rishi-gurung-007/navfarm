'use client';

import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Popover } from '@/components/ui/popover';
import { RangeCalendar } from '@/components/ui/date-input';
import { formatDate } from '@/utils/date-short';

export interface PeriodRangeOption {
  period_id: string;
  /** The row's full text in the list, e.g. "2026-10 · 27 Sept 2026 – 24 Oct 2026 (2026-27)". */
  label: string;
  /** The trigger's short text once chosen, e.g. "2026-10 (2026-27)". */
  selectedLabel: string;
}

export interface PeriodRangeSelectProps {
  ariaLabel: string;
  /** Every Reporting Period, already in the order to list them. */
  options: PeriodRangeOption[];
  mode: 'reporting' | 'custom';
  onModeChange: (mode: 'reporting' | 'custom') => void;
  periodId: string;
  onPeriodChange: (periodId: string) => void;
  /** The custom range, "" for either end while nothing (or only a start) is chosen. */
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  /** The last day a custom range may reach — today. */
  maxDate: string;
  reportingLabel: string;
  customLabel: string;
  selectPeriodPlaceholder: string;
  chooseRangePlaceholder: string;
  searchPlaceholder: string;
  noMatchesLabel: string;
  disabled?: boolean;
}

/**
 * The GM Dashboard's one Period control (19 Nov): a single dropdown whose
 * panel opens on a Reporting-Period/Custom-Range toggle, with either the
 * period list or a range calendar underneath it — never two separate fields.
 */
export function PeriodRangeSelect({
  ariaLabel,
  options,
  mode,
  onModeChange,
  periodId,
  onPeriodChange,
  from,
  to,
  onRangeChange,
  maxDate,
  reportingLabel,
  customLabel,
  selectPeriodPlaceholder,
  chooseRangePlaceholder,
  searchPlaceholder,
  noMatchesLabel,
  disabled,
}: PeriodRangeSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.period_id === periodId) ?? null;
  const hasSelection = mode === 'reporting' ? Boolean(selected) : Boolean(from && to);
  const triggerText =
    mode === 'reporting'
      ? (selected?.selectedLabel ?? selectPeriodPlaceholder)
      : from && to
        ? `${formatDate(from)} – ${formatDate(to)}`
        : from
          ? `${formatDate(from)} – …`
          : chooseRangePlaceholder;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const pillClass = (active: boolean) =>
    `rounded-(--radius-pill) px-2.5 py-1 text-[11px] font-semibold transition-all ${
      active
        ? 'bg-(--accent) text-white'
        : 'text-(--text-secondary) hover:bg-(--surface-raised)'
    }`;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setQuery('');
      }}
      align="start"
      haspopup="dialog"
      panelRole="dialog"
      label={ariaLabel}
      className="w-full"
      panelClassName="nf-combobox-panel"
      floating
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          aria-label={ariaLabel}
          disabled={disabled}
          className="nf-input nf-select w-full min-w-0 truncate text-left disabled:cursor-not-allowed disabled:opacity-70"
          style={{
            backgroundColor: 'var(--input-bg)',
            color: hasSelection ? 'var(--input-text)' : 'var(--text-muted)',
            borderColor: 'var(--input-border)',
          }}
        >
          {triggerText}
        </button>
      )}
    >
      <div
        className="flex min-h-0 flex-col gap-1.5 p-1"
        style={{ width: mode === 'custom' ? '17.5rem' : '20rem' }}
      >
        <div
          className="mb-0.5 flex w-fit items-center gap-1 rounded-(--radius-pill) border border-(--border) p-0.5"
          role="tablist"
          aria-label={ariaLabel}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'reporting'}
            onClick={() => onModeChange('reporting')}
            className={pillClass(mode === 'reporting')}
          >
            {reportingLabel}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'custom'}
            onClick={() => onModeChange('custom')}
            className={pillClass(mode === 'custom')}
          >
            {customLabel}
          </button>
        </div>

        {mode === 'reporting' ? (
          <>
            <div className="relative shrink-0">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                role="combobox"
                aria-expanded
                aria-label={ariaLabel}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="nf-input-sm w-full"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--input-text)',
                  borderColor: 'var(--input-border)',
                  paddingLeft: '1.75rem',
                }}
              />
            </div>
            <div
              role="listbox"
              aria-label={ariaLabel}
              className="flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-0.5"
              style={{ maxHeight: '240px' }}
            >
              {filtered.length === 0 ? (
                <div
                  className="px-2.5 py-3 text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {noMatchesLabel}
                </div>
              ) : (
                filtered.map((o) => {
                  const isSelected = o.period_id === periodId;
                  return (
                    <button
                      key={o.period_id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onPeriodChange(o.period_id);
                        setOpen(false);
                      }}
                      className="flex min-h-[34px] w-full shrink-0 items-center justify-between rounded-(--radius-sm) px-2.5 py-1.5 text-left text-sm transition-colors cursor-pointer hover:bg-(--surface-secondary)"
                      style={{
                        color: 'var(--text-primary)',
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      <span className="truncate">{o.label}</span>
                      {isSelected && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <RangeCalendar
            from={from}
            to={to}
            max={maxDate}
            onChange={(next) => {
              onRangeChange(next.from, next.to);
              if (next.from && next.to) setOpen(false);
            }}
          />
        )}
      </div>
    </Popover>
  );
}
