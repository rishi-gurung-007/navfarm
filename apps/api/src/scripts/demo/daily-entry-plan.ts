/**
 * The pure arithmetic of chapter `04-daily-entries`, kept out of the chapter
 * so it can be tested without booting the application: which scheduler line
 * is due on which stage day, and how much feed a warehouse must be topped up
 * with before the chapter's draws can all post.
 *
 * Why the top-up exists at all (final review, C1): batches now stand in sheds
 * (batch-helpers.ts SHED_ROLES_BY_STAGE), so each feed entry draws from the
 * silo attached to its shed — and applyFifo confines the draw to that one
 * warehouse and refuses a short one. Chapter 02 stocks every silo with a flat
 * 2,000 kg, before any batch exists; a 120-sow gestation batch eats about
 * 300 kg a day, so its dry-sow silo ran out on day seven and the rebuild died
 * with "Insufficient stock". Chapter 04 is the first point at which the
 * batches, their schedulers and their head counts all exist, so it is where
 * the demand can be summed instead of guessed.
 */

/** The slice of a scheduler_line that decides whether it is due. */
export interface DueLine {
  occurrence: string | null;
  start_day: number | null;
  end_day: number | null;
}

/** The demo's top-up rule, as ruled in the final review of Feed Forecast Plan A. */
export const TOP_UP_RULE = {
  /** Never leave a fed warehouse holding less than chapter 02's own receipt. */
  floorKg: 2000,
  /** Headroom over the window's demand — the ±2% day pattern and any rounding fit well inside it. */
  margin: 1.5,
} as const;

function weekdayOf(date: string): number {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Round up to 0.01 kg — a top-up rounded down could leave the last draw a hundredth short. */
function ceil2(n: number): number {
  return Math.ceil(n * 100 - 1e-9) / 100;
}

/**
 * Feed lines are DAILY between start_day and end_day; weekly body-weight
 * lines are due on the weekday of `weeklyAnchor`; CUSTOM lines resolve via
 * scheduler_line_custom_days (none fall inside the demo window). Mirrors
 * day-completeness.ts loosely enough for the demo's line set.
 *
 * end_day matters since the scheduler emits one CONSUMPTION line per feed
 * row, each over its own stretch of the stage (feed-row-days.ts): without the
 * bound a stage that switches diet mid-way posts both diets on every day
 * after the switch, and draws feed from a silo the forecast never shows.
 */
export function isDue(line: DueLine, day: number, date: string, weeklyAnchor: string): boolean {
  const start = line.start_day ?? 1;
  if (day < start) return false;
  if (line.end_day != null && day > line.end_day) return false;
  switch ((line.occurrence || 'DAILY').toUpperCase()) {
    case 'ONCE':
      return day === start;
    case 'WEEKLY':
      return weekdayOf(date) === weekdayOf(weeklyAnchor);
    case 'CUSTOM':
      return false; // no CUSTOM line falls inside the 14-day window
    default:
      return true;
  }
}

/**
 * The up-front top-up for one warehouse and item: enough to bring it to the
 * window's demand × margin, never below the floor, never above the silo's
 * capacity (null for a store, which has none). Zero when it already holds
 * that much — which is also what makes a re-run receive nothing twice.
 */
export function topUpKg(args: { demandKg: number; onHandKg: number; capacityKg: number | null }): number {
  const { demandKg, onHandKg, capacityKg } = args;
  let target = Math.max(TOP_UP_RULE.floorKg, demandKg * TOP_UP_RULE.margin);
  if (capacityKg != null) target = Math.min(target, capacityKg);
  return Math.max(0, ceil2(target - onHandKg));
}

/**
 * A mid-window top-up, only reached when capacity capped the up-front one and
 * the next draw no longer fits: refill toward what is still to be drawn ×
 * margin, capped at the room left in the silo — but always at least enough
 * for this draw, since failing the rebuild is the one outcome the top-up is
 * there to prevent.
 */
export function midwayTopUpKg(args: { drawKg: number; balanceKg: number; remainingDemandKg: number; capacityKg: number | null }): number {
  const { drawKg, balanceKg, remainingDemandKg, capacityKg } = args;
  const room = capacityKg == null ? Number.POSITIVE_INFINITY : capacityKg - balanceKg;
  const wanted = Math.min(room, remainingDemandKg * TOP_UP_RULE.margin - balanceKg);
  return ceil2(Math.max(drawKg - balanceKg, wanted));
}
