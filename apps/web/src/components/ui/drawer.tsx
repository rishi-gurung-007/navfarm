"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLanguage } from "../../hooks/useLanguage";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useOverlayFocus, useTopmostEscape } from "../../hooks/useOverlayFocus";

/**
 * The focused-task surface: one step above Dialog, one below a full page.
 *
 * The taxonomy this completes (apple.design.md §25, plan Phase 5):
 *
 *   Popover  — lightweight contextual choice, page stays live
 *   Dialog   — confirmation or a decision of roughly 0–2 fields
 *   Drawer   — record detail, create/edit of more than two fields
 *   Page     — multi-step work with its own navigation and state
 *
 * A Drawer is not a wider Dialog. A dialog interrupts to ask one question; a
 * drawer opens a work surface beside the page that produced it, which is why it
 * is anchored to an edge rather than centred, keeps the context visible behind
 * the scrim, and gives its actions a footer that survives a long form.
 *
 * Presentation is responsive, semantics are not: one `role="dialog"` element at
 * every width. On desktop it is a right-hand panel at one of two deliberate
 * widths; below the desktop breakpoint the same element becomes a bottom sheet
 * capped at 92dvh. There is no second mobile component to keep in sync.
 *
 * Everything shared with the rest of the overlay family is shared in fact, not
 * by imitation: page scroll goes through the reference-counted `useScrollLock`,
 * and focus entry/trap/restoration through `useOverlayFocus`. The surface is
 * styled in `global.css` against the `data-drawer-*` attributes, like Popover
 * and PageHeader, so the visual system stays in one place.
 */

/** Standard (480px) for ordinary record work; large (720px) for dense forms. */
export type DrawerSize = "md" | "lg";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** The drawer's accessible name, and its visible heading. */
  title: ReactNode;
  /** Optional supporting line. Becomes the accessible description. */
  description?: string;
  children: ReactNode;
  /**
   * Actions. Pinned below the body so they survive a long form, which is the
   * main reason to prefer a drawer over a dialog for this kind of task. Leave
   * it out when the actions belong to a `<form>` in the body — moving a submit
   * button out of its form would change how the form submits.
   */
  footer?: ReactNode;
  size?: DrawerSize;
}

/**
 * True inside an open drawer. The taxonomy forbids drawer stacks: a second
 * drawer over the first buries the work the user is doing under a surface that
 * looks identical to it, and there is no way back but Escape.
 */
const DrawerDepthContext = createContext(false);

/** Whether the calling component is rendering inside an open Drawer. */
export function useInsideDrawer(): boolean {
  return useContext(DrawerDepthContext);
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: DrawerProps) {
  const { t } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const nested = useInsideDrawer();
  const drawerId = useId();
  const titleId = `${drawerId}-title`;
  const descriptionId = `${drawerId}-description`;
  closeRef.current = onClose;

  // A nested drawer takes neither the scroll lock nor focus, so the hooks below
  // are told it is closed rather than being skipped — hooks cannot be
  // conditional, and the guard has to hold before any of them run.
  const active = open && !nested;

  useScrollLock(active);
  useOverlayFocus(panelRef, active);
  // Only when this is the innermost overlay, so a confirmation raised from
  // inside the drawer does not take the drawer down with it.
  useTopmostEscape(active, () => closeRef.current());

  useEffect(() => {
    if (!open || !nested) return;
    // Loud rather than silent: this is a design error at the call site, and the
    // component cannot resolve it by guessing which drawer the user wanted.
    console.error(
      "Drawer: a Drawer cannot open inside another Drawer. Use a Dialog for a " +
        "confirmation, a Popover for a small choice, or a page for work that " +
        "needs this much room.",
    );
  }, [open, nested]);

  if (!open || nested || typeof document === "undefined") return null;

  return createPortal(
    <div data-drawer-root role="presentation">
      <button
        type="button"
        aria-label={t("closeDialog")}
        onClick={onClose}
        data-drawer-scrim
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-drawer-panel
        data-size={size}
      >
        <DrawerDepthContext.Provider value>
          <header data-drawer-header>
            {/* The grabber reads as "this came from the bottom edge" on a
                sheet. It is decorative and desktop hides it entirely. */}
            <span data-drawer-grabber aria-hidden="true" />
            <div data-drawer-heading>
              <h2 id={titleId} data-drawer-title>
                {title}
              </h2>
              {description && (
                <p id={descriptionId} data-drawer-description>
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              data-drawer-close
              className="nf-press"
            >
              <X size={18} />
            </button>
          </header>

          <div data-drawer-body>{children}</div>

          {footer && <footer data-drawer-footer>{footer}</footer>}
        </DrawerDepthContext.Provider>
      </div>
    </div>,
    document.body,
  );
}
