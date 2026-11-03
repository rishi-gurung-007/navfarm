import {
  COSTING_METHODS, DAY_BASES, REQUIRED_GL, RESIDUAL_RULES, RUN_FREQUENCIES,
} from '../../finance/bio-costing/bio-costing.rules';

/**
 * The Bio Asset Costing tab of the Item Card (TDD, Item Card customization and row 8), as pure rules. No database here: the item service
 * loads the row and these functions decide. What is ours rather than the TDD's is marked.
 */

/** The item columns that make up the tab, in the order the form shows them. */
export const BIO_COSTING_COLUMNS = [
  'bio_costing_method', 'bio_gender', 'bio_start_age_weeks', 'bio_start_age_days', 'bio_useful_life_months',
  'bio_residual_rule', 'bio_residual_fixed_amount', 'bio_residual_weight_kg', 'bio_residual_price_per_kg',
  'bio_run_frequency', 'bio_day_basis', 'bio_effective_from', 'bio_auto_post',
  'bio_acquisition_gl_id', 'bio_accum_amort_gl_id', 'bio_amort_expense_gl_id', 'bio_fv_gain_loss_gl_id', 'bio_writeoff_gl_id',
] as const;
export type BioCostingColumn = (typeof BIO_COSTING_COLUMNS)[number];

export const BIO_GL_COLUMNS = [
  'bio_acquisition_gl_id', 'bio_accum_amort_gl_id', 'bio_amort_expense_gl_id', 'bio_fv_gain_loss_gl_id', 'bio_writeoff_gl_id',
] as const;

/** Terms that must not change once an animal of the item has been costed (as the profile's did). Auto-post is a scheduling choice and stays editable. */
export const BIO_LOCKED_COLUMNS: readonly BioCostingColumn[] = BIO_COSTING_COLUMNS.filter((c) => c !== 'bio_auto_post');

/** The item's profile column that each GL column of the profile maps to, so the existing "missing account" wording is reused. */
const PROFILE_COLUMN: Record<(typeof BIO_GL_COLUMNS)[number], string> = {
  bio_acquisition_gl_id: 'acquisition_gl_id',
  bio_accum_amort_gl_id: 'accum_amort_gl_id',
  bio_amort_expense_gl_id: 'amort_expense_gl_id',
  bio_fv_gain_loss_gl_id: 'fv_gain_loss_gl_id',
  bio_writeoff_gl_id: 'writeoff_gl_id',
};

export type BioCostingTerms = { is_biological_asset?: boolean | null } & Partial<Record<BioCostingColumn, unknown>>;

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const present = (v: unknown) => v !== null && v !== undefined && v !== '';
const oneOf = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

/** True when any term of the tab has been given a value (auto-post alone, being a switch with a default, does not count). */
export function hasBioCostingTerms(t: BioCostingTerms): boolean {
  return BIO_COSTING_COLUMNS.some((c) => c !== 'bio_auto_post' && present(t[c]));
}

/**
 * The terms as they are stored. A non-biological item carries none (the tab is only for a biological asset; anything sent is dropped, as a
 * withdrawal period is for a feed item). A biological item with a method gets the TDD's defaults for what was left blank. OURS: monthly,
 * the sheet's frequency-days basis, no residual, start days 0.
 */
export function storedBioCosting(t: BioCostingTerms): Record<BioCostingColumn, unknown> {
  const out = {} as Record<BioCostingColumn, unknown>;
  if (!t.is_biological_asset) {
    for (const c of BIO_COSTING_COLUMNS) out[c] = c === 'bio_auto_post' ? false : null;
    return out;
  }
  for (const c of BIO_COSTING_COLUMNS) out[c] = present(t[c]) ? t[c] : c === 'bio_auto_post' ? false : null;
  if (present(out.bio_costing_method)) {
    out.bio_run_frequency ??= 'MONTHLY';
    out.bio_day_basis ??= 'FREQUENCY_DAYS';
    out.bio_residual_rule ??= 'NONE';
    out.bio_start_age_days ??= 0;
  }
  // A residual rule of NONE carries no amounts.
  if (out.bio_residual_rule === 'NONE') {
    out.bio_residual_fixed_amount = null;
    out.bio_residual_weight_kg = null;
    out.bio_residual_price_per_kg = null;
  }
  return out;
}

/** What is wrong with the terms, as messages; empty when they hold together or the item is not a biological asset. */
export function validateItemBioCosting(t: BioCostingTerms): string[] {
  if (!t.is_biological_asset) return [];
  const e: string[] = [];
  const method = t.bio_costing_method;
  if (!present(method)) {
    if (hasBioCostingTerms(t)) e.push('Choose the FA/Bio Asset Costing Method (Amortization or Fair Value) for the costing terms given.');
    return e;
  }
  if (!oneOf(COSTING_METHODS, method)) e.push(`FA/Bio Asset Costing Method must be one of ${COSTING_METHODS.join(', ')}.`);
  if (present(t.bio_gender) && !['F', 'M'].includes(String(t.bio_gender))) e.push('Gender must be F or M.');

  const weeks = num(t.bio_start_age_weeks);
  if (weeks === null || !Number.isInteger(weeks) || weeks < 0) e.push('The start period (weeks) must be a whole number, 0 or more.');
  const days = num(t.bio_start_age_days);
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 6)) e.push('The start period days must be a whole number from 0 to 6.');
  if (present(t.bio_run_frequency) && !oneOf(RUN_FREQUENCIES, t.bio_run_frequency)) e.push(`Frequency must be one of ${RUN_FREQUENCIES.join(', ')}.`);
  if (present(t.bio_day_basis) && !oneOf(DAY_BASES, t.bio_day_basis)) e.push(`Day basis must be ${DAY_BASES.join(' or ')}.`);
  if (present(t.bio_effective_from) && !/^\d{4}-\d{2}-\d{2}$/.test(String(t.bio_effective_from).slice(0, 10))) e.push('Costing from must be a date (YYYY-MM-DD).');

  const rule = present(t.bio_residual_rule) ? String(t.bio_residual_rule) : 'NONE';
  if (!oneOf(RESIDUAL_RULES, rule)) e.push(`Residual rule must be one of ${RESIDUAL_RULES.join(', ')}.`);
  const fixed = num(t.bio_residual_fixed_amount), kg = num(t.bio_residual_weight_kg), price = num(t.bio_residual_price_per_kg);
  if (rule === 'FIXED' && !(fixed !== null && fixed >= 0)) e.push('A fixed residual needs an amount of 0 or more.');
  if (rule === 'WEIGHT_X_PRICE' && !(kg !== null && kg > 0 && price !== null && price > 0)) e.push('A weight-times-price residual needs a weight and a price per kg, both above 0.');
  if (rule === 'NONE' && (fixed !== null || kg !== null || price !== null)) e.push('Residual amounts were given but the residual rule is NONE.');

  if (method === 'AMORTIZATION') {
    const life = num(t.bio_useful_life_months);
    if (!(life !== null && Number.isInteger(life) && life > 0)) e.push('Amortisation needs a useful life in whole months, above 0.');
  } else if (method === 'FAIR_VALUE' && rule !== 'NONE') {
    e.push('Fair value has no residual; set the residual rule to NONE.');
  }
  return e;
}

/** The GL accounts a run of this item's method cannot post without, by label; empty when none is missing. Read at calculate / post, not at save. */
export function missingBioGl(t: BioCostingTerms): string[] {
  const method = String(t.bio_costing_method ?? '');
  const byProfileColumn = new Map(BIO_GL_COLUMNS.map((c) => [PROFILE_COLUMN[c], c] as const));
  return (REQUIRED_GL[method] ?? [])
    .filter((g) => !present(t[byProfileColumn.get(g.column) as BioCostingColumn]))
    .map((g) => g.label);
}

const same = (a: unknown, b: unknown): boolean => {
  if (!present(a) && !present(b)) return true;
  const x = Number(a), y = Number(b);
  if (present(a) && present(b) && !Number.isNaN(x) && !Number.isNaN(y) && typeof a !== 'boolean') return x === y;
  return a === b;
};

/** Which locked terms the change would alter. `stored` is the item row; `change` holds only what the caller sent. */
export function changedLockedBioColumns(stored: BioCostingTerms, change: BioCostingTerms): BioCostingColumn[] {
  return BIO_LOCKED_COLUMNS.filter((c) => c in change && !same(stored[c], change[c]));
}
