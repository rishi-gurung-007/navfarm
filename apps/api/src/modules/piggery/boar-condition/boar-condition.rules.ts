/**
 * Boar body condition scoring (plan 2026-11-02-ai-station-semen-collection, Phase 6; SOP 21). Pure, so the rules can be tested
 * without a database. The scale (what each score looks like, the action it needs, the feed it sets) and the cadence are the line's
 * setup and master data; nothing here is the client's figure.
 */

export interface ScaleRow {
  breed_id: string | null;
  is_active: boolean | number;
  score: number;
  score_name: string | null;
  indicators: string | null;
  required_action: string | null;
  feed_kg_per_day: number | null;
  health_assessment_required: boolean | number;
  medication_review: boolean | number;
}

/** The scale that governs a boar of this line: the line's own active rows when it has any, else the company default's. By score. */
export function scaleFor<T extends ScaleRow>(rows: T[], breedId: string | null | undefined): T[] {
  const live = rows.filter((r) => !!r.is_active);
  const own = breedId ? live.filter((r) => r.breed_id === breedId) : [];
  return (own.length ? own : live.filter((r) => !r.breed_id)).sort((a, b) => a.score - b.score);
}

export interface ConditionSetup {
  bcs_frequency_days: number | null;
  bcs_grace_days: number | null;
  bcs_reminder_days: number | null;
  bcs_allow_feed_override: boolean | number;
  bcs_override_reason_required: boolean | number;
}

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY).toISOString().slice(0, 10);

/** When the next assessment is due: the last one plus the line's frequency; null when the line sets none. */
export function nextDueDate(assessedOn: string, frequencyDays: number | null | undefined): string | null {
  return frequencyDays && frequencyDays > 0 ? addDays(assessedOn, frequencyDays) : null;
}

export type ConditionStatus = 'NEVER' | 'NOT_SCHEDULED' | 'OK' | 'DUE_SOON' | 'DUE' | 'OVERDUE';

/**
 * Where a boar stands against his schedule: never assessed; assessed but the line sets no schedule; fine; due soon (within the
 * reminder days); due (the day has come); overdue (past the grace days). Read from the last assessment and the line's CURRENT
 * frequency, so a changed frequency applies to every boar.
 */
export function conditionStatus(input: {
  lastAssessedOn: string | null;
  setup: Pick<ConditionSetup, 'bcs_frequency_days' | 'bcs_grace_days' | 'bcs_reminder_days'> | null;
  today: string;
}): { status: ConditionStatus; due: string | null; daysToDue: number | null } {
  if (!input.lastAssessedOn) return { status: 'NEVER', due: null, daysToDue: null };
  const due = nextDueDate(input.lastAssessedOn, input.setup?.bcs_frequency_days);
  if (!due) return { status: 'NOT_SCHEDULED', due: null, daysToDue: null };
  const daysToDue = Math.round((utc(due) - utc(input.today)) / DAY);
  const grace = input.setup?.bcs_grace_days ?? 0;
  const reminder = input.setup?.bcs_reminder_days ?? 0;
  const status: ConditionStatus = daysToDue < -grace ? 'OVERDUE' : daysToDue <= 0 ? 'DUE' : daysToDue <= reminder ? 'DUE_SOON' : 'OK';
  return { status, due, daysToDue };
}

export interface AssessmentInput {
  scale: ScaleRow[];
  score: number;
  setup: ConditionSetup | null;
  assessedOn: string;
  today: string;
  /** The boar's most recent assessment date, null when he has none. */
  latestOn: string | null;
  boarEntryDate: string | null;
  feedOverride?: number | null;
  overrideReason?: string | null;
}

/** What is wrong with an assessment, as sentences. An empty list means it can be recorded. */
export function assessmentIssues(i: AssessmentInput): string[] {
  const out: string[] = [];
  if (!i.scale.length) {
    return ['No body condition scale is set up for this boar\'s line or for the company. Add one under Body Condition Scale.'];
  }
  const row = i.scale.find((r) => r.score === i.score);
  if (!row) {
    out.push(`Score ${i.score} is not on this line's scale (${i.scale.map((r) => r.score).join(', ')}).`);
  }
  if (i.assessedOn > i.today) out.push('The assessment date cannot be in the future.');
  if (i.boarEntryDate && i.assessedOn < i.boarEntryDate.slice(0, 10)) out.push(`The boar entered on ${i.boarEntryDate.slice(0, 10)}; he cannot be assessed before that.`);
  if (i.latestOn && i.assessedOn === i.latestOn.slice(0, 10)) out.push(`The boar was already assessed on ${i.assessedOn}.`);
  else if (i.latestOn && i.assessedOn < i.latestOn.slice(0, 10)) out.push(`His latest assessment is on ${i.latestOn.slice(0, 10)}; a new one cannot be dated before it.`);

  if (i.feedOverride != null && row && i.feedOverride !== row.feed_kg_per_day) {
    if (!i.setup?.bcs_allow_feed_override) out.push("This line sets the feed level from the scale; it cannot be overridden.");
    else {
      if (!(i.feedOverride > 0)) out.push('The feed level must be above 0 kg a day.');
      if (i.setup.bcs_override_reason_required && !i.overrideReason?.trim()) out.push('Give the reason for changing the feed level from the scale\'s.');
    }
  }
  return out;
}

/**
 * The feed level an assessment sets: the override when one was given and differs from the scale's, else the scale's, else (a score
 * that does not change the feed) what it was before.
 */
export function feedSet(i: { scaleFeed: number | null; override?: number | null; previous: number | null }): { feed: number | null; overridden: boolean } {
  if (i.override != null && i.override !== i.scaleFeed) return { feed: i.override, overridden: true };
  return { feed: i.scaleFeed ?? i.previous, overridden: false };
}
