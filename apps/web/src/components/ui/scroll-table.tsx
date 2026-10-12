import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A table that scrolls inside its own box, both ways, with its header row —
 * and any cell marked data-sticky-col — held in place (Plan S, review C: the
 * feed grid is 14 columns by one row per batch per date, and the whole page
 * used to scroll with it). The CSS lives in app/global.css under
 * "FIXED-HEIGHT PAGES". Sticky cells need border-separate: with collapsed
 * borders the row lines scroll away from a sticky cell, so the lines are
 * drawn on the cells instead.
 */
export function ScrollTable({
  label,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { label?: string; children: React.ReactNode }) {
  return (
    <div
      data-table-scroll
      className={cn("w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]", className)}
      {...rest}
    >
      <table aria-label={label} className="w-max min-w-full border-separate border-spacing-0 text-left text-xs">
        {children}
      </table>
    </div>
  );
}

export default ScrollTable;
