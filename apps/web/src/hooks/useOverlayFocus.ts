"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Focus management for a modal overlay: entry, trap, and restoration.
 *
 * Dialog and FullPageOverlay each carried their own byte-identical copy of this
 * logic, with FullPageOverlay's comments pointing at Dialog's as the original.
 * Drawer would have been the third. One implementation now serves all three —
 * the trap is subtle enough (see below) that three copies drifting apart is a
 * real risk, not a stylistic complaint.
 *
 * Escape is deliberately *not* handled here. Dialog and Drawer close on it,
 * FullPageOverlay closes on it, but Popover also stops its own Escape from
 * reaching an enclosing overlay — the routing of that key is a per-overlay
 * decision, so each caller keeps it.
 */

/**
 * Elements that can hold focus. Filtered to rendered boxes by the caller: the
 * selector matches nodes that cannot actually take focus — a `display: none`
 * file input behind an upload label is the one in this codebase — and since the
 * trap drives every Tab itself, a `.focus()` that silently does nothing would
 * strand Tab on the entry before it rather than the browser skipping past it.
 */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

/**
 * Moves focus into `panelRef` while `active`, keeps Tab inside it, and returns
 * focus to whatever held it when the overlay opened.
 *
 * The trap drives every Tab itself rather than only correcting the two
 * boundaries. Boundary-only wrapping assumes the browser's own tab order keeps
 * focus inside the panel in between, and that assumption does not hold: focus
 * sits on the panel (not in its content) right after opening, and WebKit omits
 * buttons from sequential navigation entirely, so an overlay whose controls are
 * all buttons leaks focus on the first Tab.
 *
 * Restoration is synchronous cleanup, never a timer. If the trigger is gone
 * from the document by then — a row action whose row was just deleted — focus
 * is left alone rather than thrown to the top of the page.
 */
/** Open overlays, outermost first: only the innermost one traps Tab (a dialog stacked on a dialog). */
const trapStack: object[] = [];

export function useOverlayFocus(
  panelRef: RefObject<HTMLElement | null>,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const id = {};
    trapStack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !panelRef.current) return;
      if (trapStack[trapStack.length - 1] !== id) return;
      const focusable = focusableWithin(panelRef.current);
      event.preventDefault();
      if (!focusable.length) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      const next =
        index === -1
          ? event.shiftKey
            ? focusable.length - 1
            : 0
          : (index + step + focusable.length) % focusable.length;
      focusable[next].focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const index = trapStack.lastIndexOf(id);
      if (index !== -1) trapStack.splice(index, 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [panelRef, active]);
}

/**
 * Escape, routed to the innermost open overlay only.
 *
 * Dialog, Drawer and FullPageOverlay all listen on `window`, so a single
 * Escape used to reach every one of them at once: dismissing a confirmation
 * raised from inside a drawer tore down the drawer underneath it too, losing
 * the form the user was part-way through. `stopPropagation` cannot fix that —
 * these are separate listeners on the same target, not a bubbling chain.
 *
 * So the overlays keep a stack, and only the one on top acts. Popover is not
 * part of it and does not need to be: it listens on `document`, one phase
 * earlier, and stops the event before any of these see it.
 */
const escapeStack: object[] = [];

export function useTopmostEscape(active: boolean, onEscape: () => void): void {
  // A stable per-instance identity. `useRef` rather than `useId`, because two
  // overlays must never compare equal even if React reuses an id string.
  const idRef = useRef<object>({});
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const id = idRef.current;
    escapeStack.push(id);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (escapeStack[escapeStack.length - 1] !== id) return;
      handlerRef.current();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const index = escapeStack.lastIndexOf(id);
      if (index !== -1) escapeStack.splice(index, 1);
    };
  }, [active]);
}

/** Test-only view of the Escape stack depth. */
export function __getEscapeStackDepth(): number {
  return escapeStack.length;
}
