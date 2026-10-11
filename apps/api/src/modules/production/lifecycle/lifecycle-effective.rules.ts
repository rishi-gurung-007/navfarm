import { stageDayRange } from './feed-row-days';

/** The part of a breed_lifecycle_stages row the effective-date overlap rule reads. */
export interface LifecycleWindow {
  lifecycleId?: string;
  calcUnit: string;
  periodFrom: number;
  periodTo: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/**
 * Master Setup r30/r38: two rows for the same breed and stage (the caller scopes that) clash only when BOTH their
 * stage-day ranges and their effective date ranges overlap. A row with no dates is effective for ever, so an undated
 * row clashes with any row over the same days; a dated row beside it is a conflict, not an override.
 */
export function lifecycleWindowsOverlap(a: LifecycleWindow, b: LifecycleWindow): boolean {
  const ra = stageDayRange(a.calcUnit, a.periodFrom, a.periodTo);
  const rb = stageDayRange(b.calcUnit, b.periodFrom, b.periodTo);
  if (ra.fromDay > rb.toDay || rb.fromDay > ra.toDay) return false;
  const aFrom = a.effectiveFrom || '0000-01-01';
  const aTo = a.effectiveTo || '9999-12-31';
  const bFrom = b.effectiveFrom || '0000-01-01';
  const bTo = b.effectiveTo || '9999-12-31';
  return aFrom <= bTo && bFrom <= aTo;
}

/** The first existing row the candidate clashes with, or undefined. The candidate's own id is skipped. */
export function findEffectiveOverlap(candidate: LifecycleWindow, existing: LifecycleWindow[]): LifecycleWindow | undefined {
  return existing.find((e) => e.lifecycleId !== candidate.lifecycleId && lifecycleWindowsOverlap(candidate, e));
}
