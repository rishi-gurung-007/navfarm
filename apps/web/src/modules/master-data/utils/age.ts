export interface AgeBetween {
  /** Whole days from birth to the entry date. */
  totalDays: number;
  /** Whole weeks lived — the same flooring the API stores as age_at_entry_weeks. */
  weeks: number;
  /** Days past the last whole week (0-6). */
  days: number;
}

function utcDay(iso: unknown): number | null {
  const s = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * How old an animal was on a date: whole weeks and the days left over. Null when either
 * date is missing or malformed, or the date is before birth (an age is never negative).
 */
export function ageBetween(dob: unknown, onDate: unknown): AgeBetween | null {
  const from = utcDay(dob);
  const to = utcDay(onDate);
  if (from === null || to === null || to < from) return null;
  const totalDays = Math.round((to - from) / 86_400_000);
  return { totalDays, weeks: Math.floor(totalDays / 7), days: totalDays % 7 };
}

/** "12 weeks 3 days" — singular where it is one. */
export function formatAge(age: AgeBetween): string {
  const w = `${age.weeks} ${age.weeks === 1 ? "week" : "weeks"}`;
  const d = `${age.days} ${age.days === 1 ? "day" : "days"}`;
  return `${w} ${d}`;
}
