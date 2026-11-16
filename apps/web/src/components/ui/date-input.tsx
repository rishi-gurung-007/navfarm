'use client';

import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from '@/components/ui/popover';
import { useLanguage } from '@/hooks/useLanguage';
import {
  isCompleteTyped,
  isoToTyped,
  maskTyped,
  monthGrid,
  parseTyped,
  shiftMonth,
  STORED,
  todayStored,
  withinRange,
} from '@/utils/date-input';
import { formatDate } from '@/utils/date-short';

/** What a change hands the form: the stored "YYYY-MM-DD" (or "" when cleared), as the browser's date input did. */
export interface DateChange {
  target: { value: string; name?: string };
  currentTarget: { value: string; name?: string };
}

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'size'> {
  /** The stored date, "YYYY-MM-DD", or "". */
  value?: string | null;
  onChange?: (event: DateChange) => void;
  /** Stored dates: the first and last day that may be chosen. */
  min?: string;
  max?: string;
}

/** The classes that place the field in its layout; the rest style the text box. */
const LAYOUT = /^(w-|min-w-|max-w-|flex-|grow|shrink|basis-|col-span|row-span|self-|m[trblxy]?-|order-)/;

const change = (value: string, name?: string): DateChange => ({ target: { value, name }, currentTarget: { value, name } });

/**
 * The app's date field. It shows and takes "DD/MM/YY" — the one date style of every screen — where the browser's own date input
 * follows the browser's language, and offers a calendar. It stands in for `<input type="date">`: the same value
 * ("YYYY-MM-DD"), `min`, `max`, `required`, `disabled`, `className` and `onChange(e)` with `e.target.value`.
 *
 * Typing puts the slashes in as it goes; a whole date is taken on Enter or when the field is left (at once for DD/MM/YYYY), and
 * what is not a real date, or is outside min / max, goes back to the last good value.
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, min, max, className, style, disabled, readOnly, required, id, name, onBlur, onKeyDown, onFocus, ...rest },
  ref,
) {
  const stored = value && STORED.test(value) ? value : '';
  const [text, setText] = React.useState(isoToTyped(stored));
  const [editing, setEditing] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);

  // A value changed from outside clears a refusal shown for what was typed before.
  React.useEffect(() => {
    setInvalid(false);
  }, [stored]);
  // The text is what is being typed while the field has focus, and the value's own text otherwise — read at once, not a render later.
  const shown = editing ? text : isoToTyped(stored);

  const commit = (candidate: string) => {
    const parsed = parseTyped(candidate);
    if (parsed === null || (parsed !== '' && !withinRange(parsed, min, max))) {
      setText(isoToTyped(stored));
      setInvalid(candidate.trim() !== '');
      return;
    }
    setInvalid(false);
    setText(isoToTyped(parsed));
    if (parsed !== stored) onChange?.(change(parsed, name));
  };

  const classes = (className ?? '').split(/\s+/).filter(Boolean);
  const wrapper = classes.filter((c) => LAYOUT.test(c)).join(' ');
  const box = classes.filter((c) => !LAYOUT.test(c)).join(' ');

  return (
    <Popover
      className={`relative ${wrapper || 'w-full'}`}
      floating
      align="start"
      haspopup="dialog"
      panelRole="dialog"
      label="Choose a date"
      open={open && !disabled && !readOnly}
      onOpenChange={setOpen}
      trigger={(triggerProps) => (
        <div className="relative w-full">
          <input
            {...rest}
            ref={ref}
            id={id}
            name={name}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={rest.placeholder ?? 'DD/MM/YY'}
            maxLength={10}
            min={min}
            max={max}
            disabled={disabled}
            readOnly={readOnly}
            required={required}
            aria-invalid={invalid || undefined}
            className={`${box} w-full pr-9`}
            style={invalid ? { ...style, borderColor: 'var(--danger)' } : style}
            value={shown}
            onFocus={(e) => {
              setText(isoToTyped(stored));
              setEditing(true);
              onFocus?.(e);
            }}
            onChange={(e) => {
              // A pasted (or programmatically set) stored date "YYYY-MM-DD" is taken as it is.
              if (STORED.test(e.target.value)) {
                commit(isoToTyped(e.target.value));
                return;
              }
              const masked = maskTyped(e.target.value);
              setText(masked);
              setInvalid(false);
              if (masked.length === 10 && isCompleteTyped(masked)) commit(masked);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editing) {
                commit(text);
              }
              onKeyDown?.(e);
            }}
            onBlur={(e) => {
              setEditing(false);
              commit(text);
              onBlur?.(e);
            }}
          />
          <button
            {...triggerProps}
            disabled={disabled || readOnly}
            aria-label="Open the calendar"
            tabIndex={-1}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-40 cursor-pointer"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </div>
      )}
    >
      <Calendar
        value={stored}
        min={min}
        max={max}
        clearable={!required && !!stored}
        onPick={(iso) => {
          setOpen(false);
          setInvalid(false);
          setText(isoToTyped(iso));
          if (iso !== stored) onChange?.(change(iso, name));
        }}
      />
    </Popover>
  );
});

function Calendar({
  value,
  min,
  max,
  clearable,
  onPick,
}: {
  value: string;
  min?: string;
  max?: string;
  clearable: boolean;
  onPick: (iso: string) => void;
}) {
  const { language } = useLanguage();
  const today = todayStored();
  const start = value || today;
  const [view, setView] = React.useState({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 });
  const month = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(new Date(view.year, view.month, 1));
  // Monday first: 2024-01-01 was a Monday.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(language, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)),
  );
  const weeks = monthGrid(view.year, view.month);
  const step = (delta: number) => setView((v) => shiftMonth(v.year, v.month, delta));

  return (
    <div className="p-3 w-[17.5rem] select-none" data-testid="date-calendar">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="rounded p-1 hover:bg-[var(--surface-raised)] cursor-pointer">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold capitalize" style={{ color: 'var(--text-primary)' }} aria-live="polite">
          {month}
        </span>
        <button type="button" onClick={() => step(1)} aria-label="Next month" className="rounded p-1 hover:bg-[var(--surface-raised)] cursor-pointer">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
        {weekdays.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {weeks.flat().map((iso, i) => {
          if (!iso) return <span key={i} />;
          const ok = withinRange(iso, min, max);
          const selected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              disabled={!ok}
              aria-label={formatDate(iso)}
              aria-pressed={selected}
              onClick={() => onPick(iso)}
              className="h-8 rounded text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 hover:bg-[var(--surface-raised)]"
              style={
                selected
                  ? { backgroundColor: 'var(--accent)', color: '#fff', fontWeight: 700 }
                  : iso === today
                    ? { border: '1px solid var(--accent)', color: 'var(--accent)' }
                    : { color: 'var(--text-primary)' }
              }
            >
              {Number(iso.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2 text-xs">
        <button
          type="button"
          disabled={!withinRange(today, min, max)}
          onClick={() => onPick(today)}
          className="font-semibold disabled:opacity-40 cursor-pointer"
          style={{ color: 'var(--accent)' }}
        >
          Today
        </button>
        {clearable && (
          <button type="button" onClick={() => onPick('')} className="cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
