export type DayState = 'COMPLETE' | 'IN_PROGRESS' | 'MISSING' | 'NOT_STARTED' | 'NOT_DUE';
export type ActivityState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

/** A past day with a required line unposted is Missing (spec §8); drafts do not complete a day. */
export function dayState(d: { date: string; today: string; required: number; posted: number; drafts: number }): DayState {
  if (d.required === 0) return 'NOT_DUE';
  if (d.posted >= d.required) return 'COMPLETE';
  if (d.date < d.today) return 'MISSING';
  return d.posted + d.drafts > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
}

export interface ActivityLine { line_id: string; line_type: string; line_seq: number; is_mandatory: boolean; status: 'DRAFT' | 'POSTED' | null }

/** Parent cards derive their state from their sub-cards; optional sub-cards never hold a parent open (spec §6). */
export function activityStates(lines: ActivityLine[]) {
  const order: string[] = [];
  const groups = new Map<string, ActivityLine[]>();
  for (const line of [...lines].sort((a, b) => a.line_seq - b.line_seq)) {
    if (!groups.has(line.line_type)) { groups.set(line.line_type, []); order.push(line.line_type); }
    groups.get(line.line_type)!.push(line);
  }
  return order.map((line_type) => {
    const group = groups.get(line_type)!;
    const required = group.filter((l) => l.is_mandatory).length;
    const posted = group.filter((l) => l.is_mandatory && l.status === 'POSTED').length;
    const drafts = group.filter((l) => l.status === 'DRAFT').length;
    const anySaved = group.some((l) => l.status !== null);
    const state: ActivityState = posted >= required && (required > 0 || anySaved) ? 'COMPLETE' : anySaved ? 'IN_PROGRESS' : 'NOT_STARTED';
    return { line_type, state, required, posted, drafts, line_ids: group.map((l) => l.line_id) };
  });
}
