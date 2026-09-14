"use client";

import { useEffect, useState } from "react";

/**
 * Live answer to a media query, for the cases where a breakpoint has to change
 * which component renders rather than how one looks.
 *
 * Most responsive work belongs in CSS, and should stay there. This is for the
 * minority where the two widths are genuinely different components — a filter
 * panel that sits beside the table on a desktop and interrupts as a dialog on a
 * phone is one surface in two shapes, and a `hidden lg:block` pair would mount
 * both, duplicating their ids and their focus traps.
 *
 * Starts false and corrects after mount, because the server has no viewport.
 * That makes the narrow shape the one rendered first, which is the safer way
 * round: a dialog that appears a frame late is better than a desktop panel
 * flashing on a phone.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `lg` — where the console gains room for a side panel. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
