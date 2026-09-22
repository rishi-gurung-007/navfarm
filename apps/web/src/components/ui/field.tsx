'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  tooltip?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Hover/focus/click info affordance anchored next to a field's label —
 * the "read more" for a field's description, so the description itself
 * doesn't have to sit as permanent caption text under every control.
 */
function FieldInfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <span className="relative inline-flex shrink-0 items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="More information"
        aria-expanded={open}
        className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-(--text-muted) transition-colors hover:text-(--accent)"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          ref={popoverRef}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1.5 w-64 max-w-[calc(100vw-2rem)] rounded-lg border p-2.5 text-xs leading-relaxed shadow-lg"
          style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * Label + control + supporting text, in the one arrangement the application
 * uses. Forms across the console previously repeated this markup inline, which
 * is how their label sizes and spacing drifted apart from each other.
 *
 * `tooltip` is a field's description, shown on hover/focus of a small info
 * affordance next to the label. `hint` stays for short-lived state messages
 * (e.g. "set by template") that should always be visible, not hidden behind
 * a hover — the two are not interchangeable.
 */
export function Field({ label, htmlFor, hint, tooltip, error, required, className, children }: FieldProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="nf-text-label flex items-center gap-1 text-(--text-secondary)">
        {label}
        {required && <span className="ml-0.5 text-(--accent)">*</span>}
        {tooltip && <FieldInfoTooltip text={tooltip} />}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-(--danger)">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-(--text-muted)">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The read-only counterpart to `Field`, for users who may see a form but not
 * change it.
 *
 * It exists because the alternative in practice was not "one component" but
 * "two visual languages": company settings hand-typed 45 read-only value spans
 * whose label spacing, text size and mono/non-mono treatment had all drifted
 * apart from each other and from the editable form beside them, so the same
 * page looked like a different product depending on your role.
 *
 * Disabling the real inputs was the other option and is worse to read — our
 * controls dim to 50% opacity when disabled, which is the correct signal for a
 * control you could otherwise use, and the wrong one for a value you are simply
 * being shown.
 *
 * `mono` is for machine-shaped values — codes, ids, timezones — where character
 * alignment aids comparison. Prose does not take it.
 */
export function ReadField({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="nf-text-label text-(--text-secondary)">{label}</span>
      <span
        className={cn(
          'min-w-0 break-words text-sm',
          mono && 'font-mono',
          empty ? 'text-(--text-muted)' : 'font-medium text-(--text-primary)'
        )}
      >
        {empty ? '—' : value}
      </span>
    </div>
  );
}

/**
 * A named run of fields inside one form.
 *
 * Long forms in this application were flat: company Profile put thirteen
 * fields in a single two-column run covering four unrelated subjects —
 * identity, tax registration, contact details and branding — so nothing on
 * screen told you where one topic ended and the next began, and every field
 * looked equally important because every field looked identical.
 *
 * The group heading is deliberately quiet and carries no border or surface of
 * its own. A card per group is what this page had before and is what made it
 * read as a wizard; the point here is rhythm, not more chrome.
 *
 * The grid is 12 columns so a field can be sized to its content — a date, a
 * country code and a legal entity name are not the same width in anything
 * that was designed. Every child states its own span ("sm:col-span-4"). There
 * is deliberately no default applied to `> *`: an arbitrary-variant default
 * and a child's own col-span land at the same CSS specificity, so which won
 * would come down to Tailwind's output order rather than intent.
 */
export function FieldGroup({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-0.5">
        <h3 className="nf-text-label-strong text-(--text-primary)">{title}</h3>
        {description && <p className="text-[12px] text-(--text-muted)">{description}</p>}
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-12">
        {children}
      </div>
    </section>
  );
}
