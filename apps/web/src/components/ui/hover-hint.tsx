'use client';

import { type ReactNode, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Says why a value reads as it does (Rishi, 30 Oct: an N/A must say why). The
 * value gets a dotted underline and a help cursor. On hover or keyboard focus
 * the reason shows in a small box fixed to the viewport, so a scrolling table
 * cannot clip it the way it clips a box placed inside the cell.
 */
export function HoverHint({ hint, children, focusable = true }: {
  hint: string;
  children: ReactNode;
  /** false inside a control that is already focusable (a button), so keyboard users meet one stop, not two. */
  focusable?: boolean;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    const box = anchor.current?.getBoundingClientRect();
    if (box) setAt({ left: box.left + box.width / 2, top: box.top });
  };
  const hide = () => setAt(null);
  return (
    <>
      <span
        ref={anchor}
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={at ? id : undefined}
        data-hint={hint}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="cursor-help underline decoration-dotted underline-offset-2 outline-none focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-(--accent)"
      >
        {children}
      </span>
      {at && typeof document !== 'undefined' && createPortal(
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-[1000] max-w-64 -translate-x-1/2 -translate-y-full rounded-md border px-2.5 py-1.5 text-xs leading-snug shadow-lg"
          style={{
            left: at.left,
            top: at.top - 6,
            backgroundColor: 'var(--surface-raised)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
          }}
        >
          {hint}
        </span>,
        document.body,
      )}
    </>
  );
}
