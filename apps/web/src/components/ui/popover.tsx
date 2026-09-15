"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

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
 * ## Two positioning modes, and when each is correct
 *
 * **Anchored (the default).** The panel is a child of a `position: relative`
 * wrapper and placed with `position: absolute`. It travels with its trigger
 * without any measure-and-reposition work, and there is no portal to fight the
 * shell's stacking order — the shell's own rules can even reach it by descent
 * (`[data-context-nav-selector] [data-popover-panel]` in `global.css` does
 * exactly that). This is right for a trigger on the page itself, where the
 * only thing between the panel and the viewport is the document.
 *
 * **Floating (`floating`, opt-in).** An absolutely positioned panel is clipped
 * by any ancestor that scrolls, and the Master Data create/edit `Dialog` body
 * is `overflow-y: auto` — a select near the bottom of that form opened into a
 * panel cut off at the dialog's edge, with its options unreachable. In
 * floating mode the panel is portalled to `<body>`, so no ancestor `overflow`
 * can clip it, and positioned with `position: fixed` from the trigger's
 * `getBoundingClientRect()`, recomputed on scroll (capture phase, so inner
 * scrollers count), on resize, and on its own size changes. The cost is real:
 * a portalled panel leaves the anchor subtree, so every containment test in
 * this file has to treat it as part of the anchor anyway (see
 * `surfaceContains`), and descendant CSS aimed at it from a shell region stops
 * matching. Turn it on for a popover that opens inside a scrolling container —
 * a dialog, a drawer, a scrollable table cell — and leave it off elsewhere.
 *
 * The surface itself is styled in `global.css` against the `data-popover-*`
 * attributes, keeping one visual source of truth; floating mode adds only
 * `position`/`z-index` there and leaves the geometry to this file.
 *
 * Dismissal is explicit state, never a timer: Escape, an outside pointer press,
 * or focus leaving the anchor subtree.
 */

export type PopoverAlign = "start" | "end";
export type PopoverSide = "top" | "bottom";

/** Focus placement requested by the interaction that opened the surface. */
export type PopoverIntent = "first" | "last";

/**
 * `useLayoutEffect` is what keeps the first painted frame of a floating panel
 * from appearing at its unpositioned static origin, but React logs for it on
 * the server. The branch is resolved once per environment, never per render,
 * so this is not a conditional hook.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Distance between the trigger's edge and the panel's, matching global.css. */
const FLOATING_GAP = 6;
/** Smallest gap kept between a floating panel and the viewport edge. */
const FLOATING_MARGIN = 8;

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
  /**
   * Escapes a scrolling ancestor: portals the panel to `<body>` and positions
   * it with `position: fixed` from the trigger's rect, flipping above the
   * trigger when there is no room below and clamping to the viewport. Opt in
   * only when the trigger sits inside something that scrolls or clips — a
   * Dialog body, a Drawer, a scroll container — because the portal costs the
   * anchor-relative guarantees described in this file's header. Defaults to
   * `false`, which leaves every existing popover exactly as it was.
   */
  floating?: boolean;
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
  floating = false,
}: PopoverProps) {
  const panelId = `nf-popover-${useId()}`;
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [intent, setIntent] = useState<PopoverIntent>("first");
  /**
   * The side actually used. In floating mode it can differ from the requested
   * `side` when the panel would not fit there; it is reported on `data-side`
   * so callers and styles see the truth rather than the request.
   */
  const [placedSide, setPlacedSide] = useState<PopoverSide>(side);

  /**
   * `document` does not exist while rendering on the server, and the first
   * client render has to match that markup. Portalling only from the second
   * render keeps hydration honest; by the time a user can open a popover this
   * is long since true.
   */
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    setPortalReady(true);
  }, []);

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    onOpenChangeRef.current(false);
    if (options?.restoreFocus === false) return;
    // `preventScroll` keeps a close from nudging the scroll position of the
    // region the trigger lives in — the shell must not move when a menu shuts.
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * One popover, two DOM subtrees. Anchored mode's panel is inside the anchor,
   * so `anchor.contains` alone was enough; a floating panel is a child of
   * `<body>` and fails that test, which would make the first click inside it
   * read as an outside press and shut it before the click landed. Both
   * dismissal paths ask this instead — the panel is part of the popover
   * surface wherever it is rendered.
   */
  const surfaceContains = useCallback((node: unknown): boolean => {
    if (!(node instanceof Node)) return false;
    return Boolean(anchorRef.current?.contains(node) || panelRef.current?.contains(node));
  }, []);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Stops the Escape from also reaching an enclosing dialog or drawer:
      // the innermost overlay is the one the user meant to dismiss. This still
      // holds for a portalled panel — the listener is on `document`, one phase
      // ahead of the `window` listeners the modal overlays use.
      event.stopPropagation();
      close();
    }

    function onPointerDown(event: PointerEvent) {
      if (surfaceContains(event.target)) return;
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
      if (!(next instanceof Node) || surfaceContains(next)) return;
      close({ restoreFocus: false });
    }

    /**
     * Focus leaving a floating panel never bubbles through the anchor, so the
     * anchor-mounted listener alone would miss it. The document-level one is
     * gated on the blurring element belonging to this popover's surface, which
     * makes it exactly the anchor listener plus the portalled panel — no
     * unrelated focus movement reaches it.
     */
    function onDocumentFocusOut(event: FocusEvent) {
      if (!surfaceContains(event.target)) return;
      onFocusOut(event);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    if (floating) document.addEventListener("focusout", onDocumentFocusOut, true);
    else anchor?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      if (floating) document.removeEventListener("focusout", onDocumentFocusOut, true);
      else anchor?.removeEventListener("focusout", onFocusOut);
    };
  }, [open, close, floating, surfaceContains]);

  /**
   * Floating placement. Event-driven, never polled: a capture-phase `scroll`
   * listener sees every scroller between the trigger and the document, a
   * `resize` listener covers the viewport, and a `ResizeObserver` on both
   * elements covers the panel growing as its content filters and the trigger
   * reflowing under it. Writes go straight to the node rather than through
   * state so a scroll does not re-render the caller's panel content; only a
   * genuine side flip, which is rare, touches React state.
   */
  useIsomorphicLayoutEffect(() => {
    if (!floating || !open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    // Read before the first write, while the panel still carries only the
    // stylesheet's min-width: a menu's 224px floor must survive being asked to
    // match a narrower trigger.
    const styleMinWidth = Number.parseFloat(
      typeof getComputedStyle === "function" ? getComputedStyle(panel).minWidth : "",
    );
    const baseMinWidth = Number.isFinite(styleMinWidth) ? styleMinWidth : 0;

    let frame = 0;

    function place() {
      frame = 0;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();

      // A full-width field's panel must be at least as wide as the field; the
      // stylesheet floor wins where it is larger, so a menu stays a menu.
      panel.style.minWidth = `${Math.max(a.width, baseMinWidth)}px`;

      const p = panel.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;

      const roomBelow = viewportHeight - a.bottom - FLOATING_GAP;
      const roomAbove = a.top - FLOATING_GAP;
      // Flip only when the requested side genuinely cannot hold the panel and
      // the other side is roomier — never merely because the other side is
      // bigger, which would make the panel jump around during a scroll.
      let nextSide: PopoverSide = side;
      if (side === "bottom" && p.height > roomBelow && roomAbove > roomBelow) nextSide = "top";
      if (side === "top" && p.height > roomAbove && roomBelow > roomAbove) nextSide = "bottom";

      const top =
        nextSide === "bottom" ? a.bottom + FLOATING_GAP : a.top - FLOATING_GAP - p.height;
      const rawLeft = align === "start" ? a.left : a.right - p.width;
      const maxLeft = Math.max(FLOATING_MARGIN, viewportWidth - p.width - FLOATING_MARGIN);
      const left = Math.min(Math.max(rawLeft, FLOATING_MARGIN), maxLeft);

      // `right`/`bottom` are cleared explicitly: `.nf-combobox-panel` pins both
      // inline insets to 0 for the anchored case, and an inline declaration is
      // the only thing that reliably outranks it.
      panel.style.position = "fixed";
      panel.style.top = `${Math.max(FLOATING_MARGIN, top)}px`;
      panel.style.left = `${left}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";

      setPlacedSide((current) => (current === nextSide ? current : nextSide));
    }

    function schedule() {
      if (frame) return;
      // Coalesced to one placement per frame. Not a polling loop: nothing is
      // scheduled unless something moved.
      if (typeof requestAnimationFrame !== "function") {
        place();
        return;
      }
      frame = requestAnimationFrame(place);
    }

    place();

    window.addEventListener("resize", schedule);
    // Capture, so a scroll inside the Dialog body — which never bubbles to
    // window — repositions the panel too.
    window.addEventListener("scroll", schedule, true);
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(panel);
    observer?.observe(anchor);

    return () => {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      observer?.disconnect();
    };
  }, [floating, open, side, align, portalReady]);

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

  const panel = open ? (
    <div
      ref={panelRef}
      id={panelId}
      data-popover-panel
      data-floating={floating ? "true" : undefined}
      data-side={floating ? placedSide : side}
      data-align={align}
      className={panelClassName}
      role={panelRole}
      aria-label={panelRole ? label : undefined}
    >
      <PopoverSurfaceContext.Provider value={{ intent, close }}>
        {children}
      </PopoverSurfaceContext.Provider>
    </div>
  ) : null;

  return (
    <div ref={anchorRef} data-popover-anchor className={className}>
      {trigger(triggerProps)}
      {floating
        ? panel && portalReady && typeof document !== "undefined"
          ? createPortal(panel, document.body)
          : null
        : panel}
    </div>
  );
}
