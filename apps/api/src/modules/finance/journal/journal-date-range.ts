/** What is wrong with a posting-date range on the journal list, as a sentence, or null when it is fine. Both ends are inclusive and either may be absent. */
export function postingDateRangeIssue(from?: string | null, to?: string | null): string | null {
  const real = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
  if (from && !real(from)) return 'The "from" posting date is not a real date.';
  if (to && !real(to)) return 'The "to" posting date is not a real date.';
  if (from && to && from > to) return 'The "from" posting date cannot be after the "to" posting date.';
  return null;
}
