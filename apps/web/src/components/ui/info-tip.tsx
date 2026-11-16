'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * An info icon that explains the screen or field beside it: on hover, focus or click, a small card with a title and the explanation.
 * For text that would otherwise sit as a permanent caption under a heading. Closes on Escape or a press outside.
 */
export function InfoTip({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (triggerRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`About ${title}`}
        aria-expanded={open}
        className="group inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[var(--text-muted)] transition-all hover:bg-[var(--surface-raised)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <Info className="h-4 w-4 transition-transform group-hover:scale-110" />
      </button>
      {open && (
        <div
          ref={cardRef}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-3rem)] rounded-xl border p-3.5 text-xs leading-relaxed shadow-2xl sm:w-80"
          style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          <div className="mb-1.5 flex items-center gap-2 font-semibold">
            <Info className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            <span className="truncate">About {title}</span>
          </div>
          <p style={{ color: 'var(--text-secondary)' }}>{children}</p>
        </div>
      )}
    </div>
  );
}
