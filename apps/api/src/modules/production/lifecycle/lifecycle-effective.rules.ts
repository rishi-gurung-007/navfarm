import { stageDayRange } from './feed-row-days';

/** The part of a breed_lifecycle_stages row the overlap rule reads. */
export interface LifecycleWindow {
  lifecycleId?: string;
  calcUnit: string;
  periodFrom: number;
  periodTo: number;
  /** Master Setup r30/r39: the farm a row overrides for. NULL/absent = the company or breed default. */
  farmId?: string | null;
}

/**
 * Master Setup r35-r38: two rows for the same breed and stage (the caller scopes that) clash when their stage-day
 * ranges overlap. Rows carry stage days only (Rishi, 13 Oct): the calendar comes from the batch's stage entry date.
 */
export function lifecycleWindowsOverlap(a: LifecycleWindow, b: LifecycleWindow): boolean {
  // A farm override may overlap the default (that is its point); rows only clash within the same farm scope.
  if ((a.farmId ?? null) !== (b.farmId ?? null)) return false;
  const ra = stageDayRange(a.calcUnit, a.periodFrom, a.periodTo);
  const rb = stageDayRange(b.calcUnit, b.periodFrom, b.periodTo);
  return ra.fromDay <= rb.toDay && rb.fromDay <= ra.toDay;
}

/** The first existing row the candidate clashes with, or undefined. The candidate's own id is skipped. */
export function findEffectiveOverlap(candidate: LifecycleWindow, existing: LifecycleWindow[]): LifecycleWindow | undefined {
  return existing.find((e) => e.lifecycleId !== candidate.lifecycleId && lifecycleWindowsOverlap(candidate, e));
}
