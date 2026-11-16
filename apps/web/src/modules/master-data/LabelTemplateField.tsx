'use client';

import { useRef } from 'react';
import { Plus, X } from 'lucide-react';
import {
  LABEL_PARTS,
  LABEL_PRESETS,
  insertAt,
  labelTemplateIssues,
  normaliseLabelTemplate,
  previewLabel,
} from './utils/label-template';

export interface LabelTemplateFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
  ariaLabel?: string;
  ariaRequired?: boolean;
}

const chip =
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50';
const chipStyle: React.CSSProperties = { borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' };

/**
 * The lot label template, built rather than typed: pick a ready format, or add the parts with buttons (each goes in where the
 * cursor is), and type any plain text between them. A token typed in lower case is put right; anything the API would refuse is
 * said under the box before saving, and the box shows what a single-boar and a pooled sachet will read.
 */
export function LabelTemplateField({ id, value, onChange, disabled, placeholder, inputClassName, inputStyle, ariaLabel, ariaRequired }: LabelTemplateFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const text = value ?? '';
  const issues = labelTemplateIssues(text);
  const today = new Date();
  const single = previewLabel(text, { line: 'LINE', boarTags: ['BLXA9988'], boarCodes: ['PIG-0020'], date: today, seq: 1 });
  const pooled = /{BOAR_(TAG|CODE)}/.test(text)
    ? previewLabel(text, { line: 'LINE', boarTags: ['BLXA9988', 'LA0499'], boarCodes: ['PIG-0020', 'PIG-0018'], date: today, seq: 2 })
    : null;

  const set = (next: string, cursor?: number) => {
    onChange(normaliseLabelTemplate(next).slice(0, 100));
    if (cursor != null) {
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.setSelectionRange(cursor, cursor);
      });
    }
  };

  const add = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const next = insertAt(text, `{${token}}`, start, end);
    set(next.text, next.cursor);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Start from:</span>
        {LABEL_PRESETS.map((p) => (
          <button
            key={p.template}
            type="button"
            disabled={disabled}
            onClick={() => set(p.template, p.template.length)}
            className={chip}
            style={{ ...chipStyle, ...(text === p.template ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <input
          ref={ref}
          id={id}
          aria-label={ariaLabel}
          aria-required={ariaRequired}
          aria-invalid={issues.length > 0}
          aria-describedby={`${id}-preview`}
          value={text}
          maxLength={100}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
          className={`${inputClassName ?? ''} font-mono pr-9`}
          style={{ ...inputStyle, ...(issues.length ? { borderColor: 'var(--danger)' } : {}) }}
        />
        {text && !disabled && (
          <button
            type="button"
            aria-label="Clear the label template"
            onClick={() => set('', 0)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[var(--surface-raised)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Add:</span>
        {LABEL_PARTS.map((p) => (
          <button key={p.token} type="button" disabled={disabled} onClick={() => add(p.token)} title={p.hint} className={chip} style={chipStyle}>
            <Plus className="h-3 w-3" />
            {p.label}
          </button>
        ))}
      </div>

      <div id={`${id}-preview`} className="space-y-1 text-xs">
        {issues.length > 0 ? (
          issues.map((m) => (
            <p key={m} style={{ color: 'var(--danger)' }}>{m}</p>
          ))
        ) : single ? (
          <>
            <p style={{ color: 'var(--text-secondary)' }}>
              A sachet will read <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{single}</span>
              {pooled && (
                <>
                  ; a pooled lot <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{pooled}</span>
                </>
              )}
              <span style={{ color: 'var(--text-muted)' }}> (example boars, this week)</span>
            </p>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Blank: the lots of this line carry no label. Pick a format above, or add parts.</p>
        )}
      </div>
    </div>
  );
}
