"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * The application's anchored-overlay primitive.
 *
 * A popover is the *lightweight* end of the overlay taxonomy: profile menu,
 * workspace switcher, column chooser, row actions. It is anchored to its
 * trigger rather than centered, it does not dim the page, and — unlike Dialog,
 * Drawer and the mobile navigation — it deliberately does **not** take the
 * scroll lock. Page interaction stays available behind it, which is the whole
 * reason to reach for a popover instead of a dialog.
 *
 * Positioning is anchor-relative rather than portalled: the panel is a child of
 * a `position: relative` wrapper, so it travels with its trigger without any
 * measure-and-reposition loop, and there is no portal to fight the shell's
 * stacking order. The surface itself is styled in `global.css` against the
 * `data-popover-*` attributes, keeping one visual source of truth.
 *
 * Dismissal is explicit state, never a timer: Escape, an outside pointer press,
 * or focus leaving the anchor subtree.
 */

export type PopoverAlign = "start" | "end";
export type PopoverSide = "top" | "bottom";

/** Focus placement requested by the interaction that opened the surface. */
export type PopoverIntent = "first" | "last";

interface PopoverSurfaceValue {
  intent: PopoverIntent;
  /**
   * Closes the popover. Focus returns to the trigger unless the caller says
   * otherwise — on a Tab-out or an outside press, focus is already going
   * somewhere the user chose, and dragging it back would fight them.
   */
  close: (options?: { restoreFocus?: boolean }) => void;
}

const PopoverSurfaceContext = createContext<PopoverSurfaceValue | null>(null);

/** Surface-side view of the popover. Only valid inside a `<Popover>` panel. */
export function usePopoverSurface(): PopoverSurfaceValue {
  const value = useContext(PopoverSurfaceContext);
  if (!value) throw new Error("usePopoverSurface must be used inside a <Popover>");
  return value;
}

/** Props the popover owns on the caller's trigger element. */
export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  type: "button";
  "aria-haspopup": "menu" | "dialog" | "listbox";
  "aria-expanded": boolean;
  "aria-controls"?: string;
  "data-state": "open" | "closed";
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Renders the trigger. Spread `props` onto a real `<button>`. */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  /** Which edge of the trigger the panel's own edge lines up with. */
  align?: PopoverAlign;
  side?: PopoverSide;
  /** What the trigger announces it opens. Matches the panel's content. */
  haspopup?: "menu" | "dialog" | "listbox";
  /** Applied to the panel when it is not a menu, together with `label`. */
  panelRole?: "dialog";
  label?: string;
  /** Extra classes on the anchor wrapper, for layout only. */
  className?: string;
  /**
   * Extra classes on the panel itself. The default panel sizes itself like a menu (a
   * content-driven width between 224 and 320px) — a surface standing in for a form field
   * instead (a searchable select) needs to match its trigger's actual width, which this hook
   * exists for; see `.nf-combobox-panel` in global.css for that override.
   */
  panelClassName?: string;
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = "end",
  side = "bottom",
  haspopup = "menu",
  panelRole,
  label,
  className,
  panelClassName,
}: PopoverProps) {
  const panelId = `nf-popover-${useId()}`;
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [intent, setIntent] = useState<PopoverIntent>("first");

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    onOpenChangeRef.current(false);
    if (options?.restoreFocus === false) return;
    // `preventScroll` keeps a close from nudging the scroll position of the
    // region the trigger lives in — the shell must not move when a menu shuts.
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Stops the Escape from also reaching an enclosing dialog or drawer:
      // the innermost overlay is the one the user meant to dismiss.
      event.stopPropagation();
      close();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || anchor?.contains(target)) return;
      // Focus is deliberately left alone here. A press is the browser's own
      // focus gesture — its default action runs after this listener and would
      // overwrite anything set now anyway, so the only way to "restore" focus
      // on an outside press is to cancel the press or to chase it on a timer.
      // Both fight the platform; neither is worth it for a lightweight menu.
      close({ restoreFocus: false });
    }

    function onFocusOut(event: FocusEvent) {
      const next = event.relatedTarget;
      // A null relatedTarget means focus left the document entirely (window
      // blur, devtools) — not a Tab-out, and not a reason to close.
      if (!(next instanceof Node) || anchor?.contains(next)) return;
      close({ restoreFocus: false });
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    anchor?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      anchor?.removeEventListener("focusout", onFocusOut);
    };
  }, [open, close]);

  const triggerProps: PopoverTriggerProps = {
    ref: triggerRef,
    type: "button",
    "aria-haspopup": haspopup,
    "aria-expanded": open,
    // Only advertised while the panel exists, so the reference always resolves.
    "aria-controls": open ? panelId : undefined,
    "data-state": open ? "open" : "closed",
    onClick: () => {
      setIntent("first");
      onOpenChange(!open);
    },
    onKeyDown: (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      setIntent(event.key === "ArrowDown" ? "first" : "last");
      if (!open) onOpenChange(true);
    },
  };

  return (
    <div ref={anchorRef} data-popover-anchor className={className}>
      {trigger(triggerProps)}
      {open && (
        <div
          id={panelId}
          data-popover-panel
          data-side={side}
          data-align={align}
          className={panelClassName}
          role={panelRole}
          aria-label={panelRole ? label : undefined}
        >
          <PopoverSurfaceContext.Provider value={{ intent, close }}>
            {children}
          </PopoverSurfaceContext.Provider>
        </div>
      )}
    </div>
  );
}
