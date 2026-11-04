'use client';

import { type ReactNode, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Says why a value reads as it does (Rishi, 30 Oct: an N/A must say why). The
 * value gets a dotted underline and a help cursor. On hover or keyboard focus
 * the reason shows in a small box fixed to the viewport, so a scrolling table
 * cannot clip it the way it clips a box placed inside the cell.
 */
export function HoverHint({
  hint,
  children,
  focusable = true,
  plain = false,
  heading,
  list,
  content,
  className,
  followCursor = false,
}: {
  hint: string;
  /** The card sits by the mouse and moves with it, for a large anchor such as a whole summary card. */
  followCursor?: boolean;
  /** Extra classes on the anchor, e.g. `block truncate` for a clipped one-line value. */
  className?: string;
  children: ReactNode;
  /** No dotted underline: for a figure in a dense grid, where every cell has a hover and underlining them all is noise. */
  plain?: boolean;
  /** A bold first line for the card, above `list`. */
  heading?: string;
  /** The card shows these one per line as a list instead of `hint` (which still names the hint for assistive tech). */
  list?: string[];
  /** A laid-out card body (e.g. label and value columns) in place of `list`; `hint` still names it for assistive tech. */
  content?: ReactNode;
  /** false inside a control that is already focusable (a button), so keyboard users meet one stop, not two. */
  focusable?: boolean;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{
    left: number;
    top: number;
    cursor?: boolean;
  } | null>(null);
  const show = () => {
    const box = anchor.current?.getBoundingClientRect();
    if (box) setAt({ left: box.left + box.width / 2, top: box.top });
  };
  const follow = (e: { clientX: number; clientY: number }) =>
    setAt({ left: e.clientX, top: e.clientY, cursor: true });
  // Beside the cursor, on whichever side has room, so the card never runs off the screen.
  const cursorPlace = (left: number, top: number) => {
    const right = left > window.innerWidth / 2;
    const below = top < window.innerHeight / 2;
    return {
      left: right ? left - 12 : left + 12,
      top: below ? top + 16 : top - 12,
      transform: `translate(${right ? '-100%' : '0'}, ${below ? '0' : '-100%'})`,
    };
  };
  const hide = () => setAt(null);
  return (
    <>
      <span
        ref={anchor}
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={at ? id : undefined}
        data-hint={hint}
        onMouseEnter={followCursor ? follow : show}
        onMouseMove={followCursor ? follow : undefined}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`cursor-help outline-none focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-(--accent) ${plain ? '' : 'underline decoration-dotted underline-offset-2'} ${className ?? ''}`}
      >
        {children}
      </span>
      {at &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className={`pointer-events-none fixed z-[1000] ${at.cursor ? '' : '-translate-x-1/2 -translate-y-full'} rounded-md border px-2.5 py-1.5 text-xs leading-snug shadow-lg ${content ? 'max-w-96' : list ? 'max-w-80' : 'max-w-64'}`}
            style={{
              ...(at.cursor
                ? cursorPlace(at.left, at.top)
                : { left: at.left, top: at.top - 6 }),
              backgroundColor: 'var(--surface-raised)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            {content ? (
              <>
                {heading && (
                  <span className="mb-1 block font-semibold">{heading}</span>
                )}
                {content}
              </>
            ) : list ? (
              <>
                {heading && (
                  <span className="mb-1 block font-semibold">{heading}</span>
                )}
                <ul className="list-disc space-y-0.5 pl-4">
                  {list.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </>
            ) : (
              hint
            )}
          </span>,
          document.body,
        )}
    </>
  );
}
