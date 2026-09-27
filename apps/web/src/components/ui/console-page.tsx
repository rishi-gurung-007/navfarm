import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one page-level container every route renders into. Before this, each
 * module's *-page-shell.tsx hand-typed its own max-width/padding/vertical-
 * rhythm combination — eight different variants for a page frame that should
 * only ever have one, which is why the same PageHeader read at a subtly
 * different width and bottom margin depending on which module you were in.
 *
 * `size="default"` is the normal content width every full page uses.
 * `size="narrow"` is for restricted/access-denied states, which already
 * agreed on max-w-2xl across most shells before this existed — this just
 * gives that agreement one place to live instead of five copies of it.
 */
export function ConsolePage({
  children,
  size = "default",
  fill = false,
  className,
}: {
  children: ReactNode;
  size?: "default" | "narrow";
  /**
   * Plan S: the page holds its header and filters still and only its table
   * scrolls. Sets data-fill-height, which app/global.css ("FIXED-HEIGHT
   * PAGES") uses to stop <main> scrolling and hand the height to the page.
   */
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      data-fill-height={fill ? "" : undefined}
      className={cn(
        // pb-10, not pb-6: the last row of a long list used to finish flush
        // against the bottom of the scroller, so anything overlaying that
        // edge — a horizontal scrollbar on a wide table, the floating
        // assistant button — covered it with the list already scrolled to
        // its limit and no way to bring it further into view.
        "mx-auto space-y-6 px-4 pb-10 sm:px-6 lg:px-7",
        // A fill page's table scrolls inside its own box, so the page needs no bottom run-out.
        fill && "space-y-3 lg:pb-4",
        size === "narrow" ? "max-w-2xl" : "max-w-7xl",
        className
      )}
    >
      {children}
    </div>
  );
}

export default ConsolePage;
