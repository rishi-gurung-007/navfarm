/**
 * What a planned semen collection must satisfy (plan 2026-11-02-ai-station-semen-collection, Phase 4). Pure, so the rules can be
 * tested without a database. Every figure comes from the line's setup (breeding_line_setup): its weekdays, the boars it taps a
 * day, the reference it asks for and where its semen may go. Nothing here is a constant of the client's.
 */

export const WEEKDAY_NAMES: Record<string, string> = {
  MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday',
};
const BY_UTC_DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_MS = 86_400_000;

const utc = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`);

/** MON..SUN for a calendar date (yyyy-mm-dd). */
export const weekdayOf = (date: string): string => BY_UTC_DAY[utc(date).getUTCDay()];

/** The ISO 8601 week of a date and the year that week belongs to (a week can belong to the year before or after the date's). */
export function isoWeekOf(date: string): { week: number; year: number } {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { week: Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7), year: d.getUTCFullYear() };
}

/** The first date on or after `from` that falls on one of the weekdays; null when there are none. */
export function nextCollectionDate(weekdays: string[] | null | undefined, from: string): string | null {
  if (!weekdays?.length) return null;
  for (let i = 0; i < 7; i++) {
    const d = new Date(utc(from).getTime() + i * DAY_MS).toISOString().slice(0, 10);
    if (weekdays.includes(weekdayOf(d))) return d;
  }
  return null;
}

export interface PlanSetup {
  collection_mode: string;
  collection_weekdays: string[] | null;
  boars_per_collection_day: number | null;
  reference_required: boolean;
  reference_label: string | null;
  destination_rule: string;
  destination_farm_ids: string[] | null;
}

export interface PlanInput {
  date: string;
  today: string;
  boarIds: string[];
  /** Boars of this line already planned for this date in other plans that are not cancelled. */
  alreadyPlanned: number;
  reference?: string | null;
  destinationFarmId?: string | null;
}

export interface PlanResult {
  errors: string[];
  warnings: string[];
}

/**
 * The line's rules applied to a plan. With no setup for the line and none for the company nothing is checked beyond the plan being
 * sensible (it has boars, and its day is not already past): no rule is made up.
 */
export function planResult(setup: PlanSetup | null, input: PlanInput, lineName: string): PlanResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.boarIds.length) errors.push('Choose at least one boar.');
  if (new Set(input.boarIds).size !== input.boarIds.length) errors.push('A boar is chosen twice.');
  if (input.date < input.today) errors.push('The collection date cannot be in the past.');
  if (!setup) return { errors, warnings };

  const weekday = weekdayOf(input.date);
  if (setup.collection_mode === 'SCHEDULED' && setup.collection_weekdays?.length && !setup.collection_weekdays.includes(weekday)) {
    const days = setup.collection_weekdays.map((d) => WEEKDAY_NAMES[d] ?? d).join(' and ');
    errors.push(`${lineName} is tapped on ${days}; ${input.date} is a ${WEEKDAY_NAMES[weekday]}.`);
  }

  const limit = setup.boars_per_collection_day;
  if (limit != null) {
    const total = input.alreadyPlanned + input.boarIds.length;
    if (total > limit) {
      const boarsA = `${lineName} taps at most ${limit} boar${limit === 1 ? '' : 's'} a day`;
      errors.push(
        input.alreadyPlanned
          ? `${boarsA}; ${input.alreadyPlanned} ${input.alreadyPlanned === 1 ? 'is' : 'are'} already planned for ${input.date}, so ${input.boarIds.length} more would make ${total}.`
          : `${boarsA}; ${input.boarIds.length} ${input.boarIds.length === 1 ? 'was' : 'were'} chosen.`,
      );
    } else if (total < limit) {
      warnings.push(`${lineName} taps ${limit} boar${limit === 1 ? '' : 's'} a day; ${total} ${total === 1 ? 'is' : 'are'} planned for ${input.date} so far.`);
    }
  }

  if (setup.reference_required && !input.reference?.trim()) {
    errors.push(`A ${setup.reference_label?.trim() || 'reference'} is required for ${lineName}.`);
  }

  const farms = setup.destination_farm_ids ?? [];
  if (setup.destination_rule !== 'ANY') {
    if (!input.destinationFarmId) errors.push(`Choose the destination farm for ${lineName}.`);
    else if (!farms.includes(input.destinationFarmId)) errors.push(`${lineName}'s semen may only go to its destination farm${farms.length === 1 ? '' : 's'}.`);
  }
  return { errors, warnings };
}
