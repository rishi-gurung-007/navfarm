'use client';

import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
  const tip = useRef<HTMLSpanElement>(null);
  // What the card is placed against: the value's box, or a point at the cursor.
  const [at, setAt] = useState<{
    left: number;
    right: number;
    top: number;
    bottom: number;
    cursor?: boolean;
  } | null>(null);
  const show = () => {
    const box = anchor.current?.getBoundingClientRect();
    if (box)
      setAt({
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      });
  };
  const follow = (e: { clientX: number; clientY: number }) =>
    setAt({
      left: e.clientX,
      right: e.clientX,
      top: e.clientY,
      bottom: e.clientY,
      cursor: true,
    });
  // Measured once drawn, then kept inside the window: above the value if it fits, else below, else on the
  // roomier side; never off the left or right edge (Rishi, 4 Nov: cards were cut off and squeezed at the edges).
  useLayoutEffect(() => {
    const el = tip.current;
    if (!at || !el) return;
    const margin = 8;
    const { innerWidth: vw, innerHeight: vh } = window;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const clamp = (v: number, size: number, max: number) =>
      Math.max(margin, Math.min(v, max - size - margin));
    let left: number;
    let top: number;
    if (at.cursor) {
      left = at.left + 12 + w <= vw - margin ? at.left + 12 : at.left - 12 - w;
      top = at.top + 16 + h <= vh - margin ? at.top + 16 : at.top - 12 - h;
    } else {
      left = (at.left + at.right) / 2 - w / 2;
      const above = at.top - 6 - h;
      const below = at.bottom + 6;
      top =
        above >= margin
          ? above
          : below + h <= vh - margin
            ? below
            : at.top > vh - at.bottom
              ? above
              : below;
    }
    el.style.left = `${clamp(left, w, vw)}px`;
    el.style.top = `${clamp(top, h, vh)}px`;
    el.style.visibility = 'visible';
  }, [at]);
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
            ref={tip}
            className={`pointer-events-none fixed z-[1000] w-max overflow-hidden rounded-md border px-2.5 py-1.5 text-xs leading-snug shadow-lg ${content ? 'max-w-96' : list ? 'max-w-80' : 'max-w-64'}`}
            style={{
              left: 0,
              top: 0,
              visibility: 'hidden',
              maxHeight: 'calc(100vh - 16px)',
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
