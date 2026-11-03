/**
 * AI Station breeding-line rules (plan 2026-11-02-ai-station-semen-collection, Phase 1). Pure: no database, so the same
 * answers can be tested without one. Every figure here comes from a breeding_line_setup row; nothing is a constant.
 */

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
/** The weekdays as a picker lists them, in the week's order. */
export const WEEKDAY_OPTIONS = [
  { weekday_code: 'MON', weekday_name: 'Monday' },
  { weekday_code: 'TUE', weekday_name: 'Tuesday' },
  { weekday_code: 'WED', weekday_name: 'Wednesday' },
  { weekday_code: 'THU', weekday_name: 'Thursday' },
  { weekday_code: 'FRI', weekday_name: 'Friday' },
  { weekday_code: 'SAT', weekday_name: 'Saturday' },
  { weekday_code: 'SUN', weekday_name: 'Sunday' },
] as const;
export const COLLECTION_MODES = ['SCHEDULED', 'ON_REQUEST'] as const;
export const DESTINATION_RULES = ['ANY', 'LIST', 'ONE'] as const;
export const RESTRICTIONS = ['NONE', 'WARN', 'BLOCK'] as const;
export const ENFORCEMENTS = ['WARN', 'BLOCK'] as const;
export const WEEK_BASES = ['ISO'] as const;
export const TIE_BREAKS = ['GENETIC_RANK', 'SHARED'] as const;

/** The columns of the boar selection table, in their default order, with the label each carries until a line renames it. */
export const SELECTION_COLUMNS = [
  { key: 'collector', label: 'Collector' },
  { key: 'boar', label: 'Boar' },
  { key: 'dob', label: 'DoB' },
  { key: 'age', label: 'Age (days)' },
  { key: 'tsi', label: 'TSI' },
  { key: 'genetic_level', label: 'Genetic level' },
  { key: 'genetic_rank', label: 'Genetic rank' },
  { key: 'last_volume_ml', label: 'Last raw semen (ml)' },
  { key: 'last_doses', label: 'Last doses' },
  { key: 'dose_rank', label: 'Dose rank' },
  { key: 'last_morphology', label: 'Last morphology (%)' },
  { key: 'morphology_rank', label: 'Morphology rank' },
  { key: 'overall_grading', label: 'Overall grading' },
  { key: 'overall_rank', label: 'Overall rank' },
  { key: 'planned_day', label: 'Planned day' },
  { key: 'bcs_score', label: 'Condition score' },
  { key: 'bcs_status', label: 'Condition check' },
] as const;
export const SELECTION_COLUMN_KEYS = SELECTION_COLUMNS.map((c) => c.key) as string[];

/** The tokens a lot label may use (see `renderLotLabel`). It is rendered when the lot is posted; it is validated here so a typo is refused when saved. */
export const LABEL_TOKENS = ['LINE', 'BOAR_TAG', 'BOAR_CODE', 'WEEK', 'YEAR', 'DATE', 'SEQ'] as const;

export interface LineSetupValues {
  collection_mode: string;
  collection_weekdays?: string[] | null;
  boars_per_collection_day?: number | null;
  pooling_allowed: boolean;
  min_boars_per_lot?: number | null;
  max_boars_per_lot?: number | null;
  colorant_name?: string | null;
  colorant_item_id?: string | null;
  colorant_qty_per_lot?: number | null;
  label_template?: string | null;
  destination_rule: string;
  destination_farm_ids?: string[] | null;
  restrict_to_destination: string;
  reference_required?: boolean;
  reference_label?: string | null;
  min_rest_days?: number | null;
  min_motility_pct?: number | null;
  grading_genetic_weight?: number | null;
  grading_dose_weight?: number | null;
  grading_morphology_weight?: number | null;
  rank_tie_break?: string;
  selection_columns?: { key: string; label: string; visible: boolean }[] | null;
  bcs_frequency_days?: number | null;
  bcs_grace_days?: number | null;
  bcs_reminder_days?: number | null;
}

const has = (v: unknown) => v !== null && v !== undefined && v !== '';

/** What is wrong with a line setup, as sentences for the form. An empty list means it can be saved. */
export function lineSetupIssues(v: LineSetupValues): string[] {
  const out: string[] = [];

  if (v.collection_mode === 'SCHEDULED' && !(v.collection_weekdays?.length)) {
    out.push('A scheduled line needs at least one collection weekday.');
  }
  if (v.collection_mode === 'ON_REQUEST' && v.collection_weekdays?.length) {
    out.push('A line collected on request has no fixed weekdays; remove them or make the line scheduled.');
  }
  if (v.collection_weekdays && new Set(v.collection_weekdays).size !== v.collection_weekdays.length) {
    out.push('A weekday is listed twice.');
  }
  if (has(v.boars_per_collection_day) && (v.boars_per_collection_day as number) < 1) {
    out.push('Boars per collection day must be at least 1.');
  }

  const min = v.min_boars_per_lot;
  const max = v.max_boars_per_lot;
  if (has(min) && (min as number) < 1) out.push('Minimum boars per lot must be at least 1.');
  if (has(max) && (max as number) < 1) out.push('Maximum boars per lot must be at least 1.');
  if (has(min) && has(max) && (min as number) > (max as number)) {
    out.push('Minimum boars per lot cannot be more than the maximum.');
  }
  if (!v.pooling_allowed && has(max) && (max as number) > 1) {
    out.push('Pooling is off, so a lot has one boar; the maximum cannot be more than 1.');
  }
  if (!v.pooling_allowed && has(min) && (min as number) > 1) {
    out.push('Pooling is off, so a lot has one boar; the minimum cannot be more than 1.');
  }

  if (has(v.colorant_qty_per_lot) && !has(v.colorant_item_id)) {
    out.push('A colorant quantity is issued from stock, so it needs a colorant item.');
  }
  if (has(v.colorant_qty_per_lot) && (v.colorant_qty_per_lot as number) <= 0) {
    out.push('The colorant quantity must be above 0.');
  }
  if (has(v.colorant_item_id) && !has(v.colorant_name)) {
    out.push('Name the colorant (for example its colour) as well as its item.');
  }

  if (has(v.label_template)) {
    const template = String(v.label_template);
    const opened = (template.match(/{/g) ?? []).length;
    const closed = (template.match(/}/g) ?? []).length;
    const tokens = [...template.matchAll(/{([^{}]*)}/g)].map((m) => m[1]);
    const unknown = tokens.filter((t) => !(LABEL_TOKENS as readonly string[]).includes(t));
    if (opened !== closed || tokens.length !== opened) out.push('The label template has an unmatched brace.');
    if (unknown.length) out.push(`The label template uses unknown token(s): ${[...new Set(unknown)].map((t) => `{${t}}`).join(', ')}. Use ${LABEL_TOKENS.map((t) => `{${t}}`).join(' ')}.`);
  }

  const farms = v.destination_farm_ids?.length ?? 0;
  if (v.destination_rule === 'ANY' && farms) out.push('The destination is any farm, so no farm is listed; remove them or change the rule.');
  if (v.destination_rule === 'LIST' && farms < 1) out.push('Choose the farms this line may go to.');
  if (v.destination_rule === 'ONE' && farms !== 1) out.push('Choose exactly one destination farm.');
  if (v.destination_farm_ids && new Set(v.destination_farm_ids).size !== farms) out.push('A destination farm is listed twice.');
  if (v.restrict_to_destination !== 'NONE' && v.destination_rule === 'ANY') {
    out.push('Restricting use to the destination needs a destination farm (a list or one).');
  }
  if (has(v.reference_label) && !v.reference_required) {
    out.push('A reference label is only used when a reference is required.');
  }

  if (has(v.min_rest_days) && (v.min_rest_days as number) < 0) out.push('Rest days cannot be negative.');
  if (has(v.min_motility_pct) && ((v.min_motility_pct as number) < 0 || (v.min_motility_pct as number) > 100)) {
    out.push('Minimum motility is a percentage, 0 to 100.');
  }

  for (const [label, w] of [['genetic', v.grading_genetic_weight], ['dose', v.grading_dose_weight], ['morphology', v.grading_morphology_weight]] as const) {
    if (has(w) && (w as number) < 0) out.push(`The ${label} rank weight cannot be negative.`);
  }
  if (v.rank_tie_break !== undefined && !(TIE_BREAKS as readonly string[]).includes(v.rank_tie_break)) {
    out.push(`Tied boars are ranked ${TIE_BREAKS.join(' or ')}.`);
  }
  if (has(v.bcs_frequency_days) && (v.bcs_frequency_days as number) < 1) out.push('Body condition frequency must be at least 1 day.');
  if (has(v.bcs_grace_days) && (v.bcs_grace_days as number) < 0) out.push('Body condition grace days cannot be negative.');
  if (has(v.bcs_reminder_days) && (v.bcs_reminder_days as number) < 0) out.push('Body condition reminder days cannot be negative.');
  if (!has(v.bcs_frequency_days) && (has(v.bcs_grace_days) || has(v.bcs_reminder_days))) out.push('Grace and reminder days need a body condition frequency.');
  if (v.selection_columns) {
    const keys = v.selection_columns.map((c) => c.key);
    const unknown = keys.filter((k) => !SELECTION_COLUMN_KEYS.includes(k));
    if (unknown.length) out.push(`Unknown selection table column(s): ${[...new Set(unknown)].join(', ')}.`);
    if (new Set(keys).size !== keys.length) out.push('A selection table column is listed twice.');
    if (v.selection_columns.length && !v.selection_columns.some((c) => c.visible)) out.push('The selection table needs at least one visible column.');
  }
  return out;
}

/** An object without its `undefined` values. */
export function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * The values a new setup will hold, to be validated: the defaults, then what the request sent. A field the request left out must not
 * overwrite its default. In the bundled API a validated DTO carries every declared field as an own property that is `undefined` when
 * the request omitted it (unit tests do not show this), so those keys are dropped first. Before this, a setup that named
 * `destination_rule: 'ANY'` and no restriction was refused: the omitted restriction came through as undefined, not 'NONE'.
 */
export function newSetupValues(dto: Partial<LineSetupValues>): LineSetupValues {
  return { collection_mode: 'SCHEDULED', pooling_allowed: true, destination_rule: 'ANY', restrict_to_destination: 'NONE', ...definedOnly(dto) };
}

/** The values an edited setup will hold: what it held, then only the fields the request sent. */
export function editedSetupValues(before: LineSetupValues, changes: Partial<LineSetupValues>): LineSetupValues {
  return { ...before, ...definedOnly(changes) };
}

export interface EffectiveRules {
  setup_id: string;
  breed_id: string | null;
  pooling_allowed: boolean;
  min_boars_per_lot: number | null;
  max_boars_per_lot: number | null;
  min_rest_days: number | null;
  min_motility_pct: number | null;
  rule_enforcement: string;
  [key: string]: unknown;
}

/**
 * The rule row for a boar's line: the row for that breed, else the company default (the row with no breed), else none. An
 * inactive row is not read: a line whose setup is switched off falls back to the default exactly as one with no setup does.
 */
export function effectiveSetup<T extends { breed_id: string | null; is_active: boolean | number }>(
  setups: T[],
  breedId: string | null | undefined,
): T | null {
  const live = setups.filter((s) => !!s.is_active);
  return (breedId ? live.find((s) => s.breed_id === breedId) : undefined) ?? live.find((s) => !s.breed_id) ?? null;
}

export interface CollectionRuleInput {
  rules: EffectiveRules | null;
  /** Every boar in the lot, the primary included. */
  boarCount: number;
  /** Days since each boar was last collected before this date; null when he never was. */
  restDays: { boar: string; days: number | null }[];
  /** The lot's motility, when it was entered for the lot as a whole. */
  motilityPct: number | null;
  /** The motility each accepted boar gave, when it was entered per boar (Phase 2); null where it was not measured. */
  boarMotilities?: { boar: string; pct: number | null }[];
}

export interface CollectionRuleResult {
  /** Stop the collection. */
  errors: string[];
  /** Tell the technician, and let the collection go ahead. */
  warnings: string[];
}

/**
 * The line's rules applied to one collection. How many boars a lot may have is always a stop; the rest and motility rules
 * stop or only warn as the line's own enforcement says. No rules at all (no setup for the line and no company default) means
 * nothing is checked, never a default made up here.
 */
export function collectionRuleResult({ rules, boarCount, restDays, motilityPct, boarMotilities = [] }: CollectionRuleInput): CollectionRuleResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!rules) return { errors, warnings };

  if (boarCount > 1 && !rules.pooling_allowed) {
    errors.push('This line is never pooled: collect one boar per lot.');
  }
  if (rules.max_boars_per_lot != null && boarCount > rules.max_boars_per_lot) {
    errors.push(`This line allows at most ${rules.max_boars_per_lot} boar${rules.max_boars_per_lot === 1 ? '' : 's'} in a lot; ${boarCount} were chosen.`);
  }
  if (rules.min_boars_per_lot != null && boarCount < rules.min_boars_per_lot) {
    errors.push(`This line needs at least ${rules.min_boars_per_lot} boars in a lot; ${boarCount} ${boarCount === 1 ? 'was' : 'were'} chosen.`);
  }

  const soft = rules.rule_enforcement === 'BLOCK' ? errors : warnings;
  if (rules.min_rest_days != null) {
    for (const { boar, days } of restDays) {
      if (days != null && days < rules.min_rest_days) {
        soft.push(`${boar} was collected ${days} day${days === 1 ? '' : 's'} ago; this line rests a boar ${rules.min_rest_days} day${rules.min_rest_days === 1 ? '' : 's'} or more.`);
      }
    }
  }
  if (rules.min_motility_pct != null && motilityPct != null && motilityPct < Number(rules.min_motility_pct)) {
    soft.push(`Motility ${motilityPct}% is under the line's minimum of ${Number(rules.min_motility_pct)}%.`);
  }
  if (rules.min_motility_pct != null) {
    for (const { boar, pct } of boarMotilities) {
      if (pct != null && pct < Number(rules.min_motility_pct)) {
        soft.push(`${boar}'s motility ${pct}% is under the line's minimum of ${Number(rules.min_motility_pct)}%.`);
      }
    }
  }
  return { errors, warnings };
}

export interface BandRange {
  level_name: string;
  tsi_from: number | null;
  tsi_to: number | null;
}

/** What is wrong with a genetic-level band on its own, as sentences. */
export function bandIssues(b: BandRange): string[] {
  const out: string[] = [];
  if (b.tsi_from == null && b.tsi_to == null) out.push('A band needs a TSI from, a TSI to, or both: with neither it would hold every boar.');
  if (b.tsi_from != null && b.tsi_to != null && b.tsi_from > b.tsi_to) out.push('TSI from cannot be more than TSI to.');
  return out;
}

/** The bands (of one line) that a candidate band overlaps. Both ends are inclusive and an open end reaches without limit. */
export function overlappingBands<T extends BandRange>(candidate: BandRange, others: T[]): T[] {
  const lo = (r: BandRange) => r.tsi_from ?? -Infinity;
  const hi = (r: BandRange) => r.tsi_to ?? Infinity;
  return others.filter((o) => lo(candidate) <= hi(o) && lo(o) <= hi(candidate));
}
