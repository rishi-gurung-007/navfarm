import { stageDayRange } from './feed-row-days';

/** The part of a breed_lifecycle_stages row the overlap rule reads. */
export interface LifecycleWindow {
  lifecycleId?: string;
  calcUnit: string;
  periodFrom: number;
  periodTo: number;
  /** Master Setup r30/r39: the farm a row overrides for. NULL/absent = the company or breed default. */
  farmId?: string | null;
  /** The rest of the scope two rows must share to be the same stage record — see SCOPE below. */
  seasonType?: string | null;
  category?: string | null;
  companyId?: string | null;
}

/**
 * The columns that put two rows in the same stage record, and so in each other's way.
 *
 * This list is the server half of SIBLING_KEY_COLUMNS in lifecycle-feed-lines.ts, which
 * decides what the Feed Consumption form shows as the lines of one stage. The two must
 * agree: a row this rule treats as a clash but that grouping hides is a save the user is
 * refused with no way to see why (13 Oct — a category SOW row blocking a category PIGLET
 * stage over the same days). breed and stage are not here because every caller has
 * already scoped its query to one of each.
 */
const SCOPE = ['farmId', 'seasonType', 'category', 'companyId'] as const;

/** Whether two rows are in the same scope, treating null and absent alike. */
const sameScope = (a: LifecycleWindow, b: LifecycleWindow): boolean =>
  SCOPE.every((k) => (a[k] ?? null) === (b[k] ?? null));

/**
 * Master Setup r35-r38: two rows for the same breed and stage (the caller scopes that) clash when their stage-day
 * ranges overlap. Rows carry stage days only (Rishi, 13 Oct): the calendar comes from the batch's stage entry date.
 */
export function lifecycleWindowsOverlap(a: LifecycleWindow, b: LifecycleWindow): boolean {
  // A farm override may overlap the default (that is its point), and a row written for
  // another season, category or company is a different standard — rows only clash inside
  // one scope.
  if (!sameScope(a, b)) return false;
  const ra = stageDayRange(a.calcUnit, a.periodFrom, a.periodTo);
  const rb = stageDayRange(b.calcUnit, b.periodFrom, b.periodTo);
  return ra.fromDay <= rb.toDay && rb.fromDay <= ra.toDay;
}

/** The first existing row the candidate clashes with, or undefined. The candidate's own id is skipped. */
export function findEffectiveOverlap(candidate: LifecycleWindow, existing: LifecycleWindow[]): LifecycleWindow | undefined {
  return existing.find((e) => e.lifecycleId !== candidate.lifecycleId && lifecycleWindowsOverlap(candidate, e));
}
