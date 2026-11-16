/**
 * Pure rules of item-level bio-asset costing: the vocabulary, the start date, the residual and the accounts a run needs. No database here: the services load
 * the rows and these functions decide. The terms themselves live on the biological Item (the TDD Item Card's Bio Asset Costing tab) and are checked by
 * `master-data/item/item-bio-costing.rules.ts`; what is "ours" rather than the sheet's is marked, as in the plan.
 */

export const COSTING_METHODS = ['AMORTIZATION', 'FAIR_VALUE'] as const;
export const RESIDUAL_RULES = ['NONE', 'FIXED', 'WEIGHT_X_PRICE'] as const;
export const RUN_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export const DAY_BASES = ['FREQUENCY_DAYS', 'ACTUAL'] as const;

/** The client's frequency days (formula sheet column F): weekly 7, monthly 30, quarterly 90, yearly 360. */
export const FREQUENCY_DAYS: Record<(typeof RUN_FREQUENCIES)[number], number> = { WEEKLY: 7, MONTHLY: 30, QUARTERLY: 90, YEARLY: 360 };

/** What the engine reads of an item's costing terms (the item's columns, under the names the engine has always used). */
export interface CostingTerms {
  item_id?: string | null;
  gender?: string | null;
  costing_method: string;
  start_age_weeks: number;
  useful_life_months?: number | null;
  residual_rule?: string | null;
  residual_fixed_amount?: number | string | null;
  residual_weight_kg?: number | string | null;
  residual_price_per_kg?: number | string | null;
  residual_applies_gender?: string | null;
  run_frequency?: string | null;
  day_basis?: string | null;
  tracking?: string | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** The GL columns each method needs before a run can post. */
export const REQUIRED_GL: Record<string, Array<{ column: string; label: string }>> = {
  AMORTIZATION: [
    { column: 'acquisition_gl_id', label: 'acquisition cost' }, { column: 'accum_amort_gl_id', label: 'accumulated amortisation' },
    { column: 'amort_expense_gl_id', label: 'amortisation expense' }, { column: 'writeoff_gl_id', label: 'mortality / impairment loss' },
  ],
  FAIR_VALUE: [
    { column: 'acquisition_gl_id', label: 'acquisition cost' }, { column: 'fv_gain_loss_gl_id', label: 'fair value gain / loss' },
    { column: 'writeoff_gl_id', label: 'mortality / impairment loss' },
  ],
};

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The date an animal's costing begins: her birth date plus the item's start age (the formula sheet counts the start from the
 * date of birth), but never before she was on the books (ours, D4: no charge for days before the entry date). Without a birth date
 * her age at entry stands in: she was that many weeks old on her entry date. With neither there is no honest date: null.
 */
export function costingStartDate(
  a: { dob?: string | null; entry_date: string; age_at_entry_weeks?: number | null }, startAgeWeeks: number, extraDays = 0,
): string | null {
  let birth: string | null = a.dob ?? null;
  if (!birth && a.age_at_entry_weeks != null) birth = addDays(a.entry_date, -7 * a.age_at_entry_weeks);
  if (!birth) return null;
  const reached = addDays(birth, 7 * startAgeWeeks + extraDays);
  return reached > a.entry_date ? reached : a.entry_date;
}

/** The residual an animal carries under an item's terms: nothing, the fixed amount, or weight x price per kg (the sheet: 150 kg x 2.05 for a sow, none for a boar). */
export function residualFor(t: CostingTerms, gender: string | null | undefined): number {
  const rule = t.residual_rule ?? 'NONE';
  if (rule === 'NONE') return 0;
  if (t.residual_applies_gender && t.residual_applies_gender !== gender) return 0;
  if (rule === 'FIXED') return Math.round((num(t.residual_fixed_amount) ?? 0) * 1e4) / 1e4;
  return Math.round((num(t.residual_weight_kg) ?? 0) * (num(t.residual_price_per_kg) ?? 0) * 1e4) / 1e4;
}

export type ResidualSource = 'ITEM';

/** The residual an animal is written down to: her item's. It is the item's alone (TDD Item Card, Bio Asset Costing tab); an animal has no residual of her own. */
export function resolveResidual(i: { terms: CostingTerms; gender: string | null | undefined }): { value: number; source: ResidualSource } {
  return { value: residualFor(i.terms, i.gender), source: 'ITEM' };
}
