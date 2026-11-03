import type * as schema from '../../../core/database/schema';
import type { CostingTerms } from './bio-costing.rules';

/**
 * What a costing run is made for: a biological Item and the terms on its Bio Asset Costing tab (TDD Item Card). The run, the scheduler and the exit clearing
 * read a subject, and this is the one place that turns the item's `bio_*` columns into the terms the engine takes.
 */
type ItemRow = typeof schema.itemMaster.$inferSelect;

/** The GL accounts of a subject, under the column names REQUIRED_GL speaks. */
export interface SubjectGl {
  acquisition_gl_id: string | null;
  accum_amort_gl_id: string | null;
  amort_expense_gl_id: string | null;
  fv_gain_loss_gl_id: string | null;
  writeoff_gl_id: string | null;
}

export interface CostingSubject {
  /** The item's id and code. */
  id: string;
  code: string;
  tenant_id: string;
  company_id: string;
  costing_method: string;
  run_frequency: string;
  day_basis: string;
  auto_post: boolean;
  /** The date costing should start; the scheduler never catches up before it. An item may have none, and is then not scheduled. */
  effective_from: string | null;
  /** Why a run cannot be made for it, or null. */
  not_runnable: string | null;
  terms: CostingTerms;
  gl: SubjectGl;
}

/** An item has costing terms once it is a biological asset with a costing method. Only then does it cost its animals. */
export function itemHasCostingTerms(item: { is_biological_asset?: boolean | null; bio_costing_method?: string | null }): boolean {
  return !!item.is_biological_asset && !!item.bio_costing_method;
}

/** The start age an item sets: whole weeks plus the extra days (TDD: start period week and days). */
export function itemStartAge(item: { bio_start_age_weeks?: number | null; bio_start_age_days?: number | null }): { weeks: number; days: number } {
  return { weeks: item.bio_start_age_weeks ?? 0, days: item.bio_start_age_days ?? 0 };
}

export function subjectFromItem(item: ItemRow): CostingSubject {
  const { weeks } = itemStartAge(item);
  const terms: CostingTerms = {
    item_id: item.item_id,
    gender: item.bio_gender,
    costing_method: item.bio_costing_method ?? '',
    start_age_weeks: weeks,
    useful_life_months: item.bio_useful_life_months,
    residual_rule: item.bio_residual_rule ?? 'NONE',
    residual_fixed_amount: item.bio_residual_fixed_amount,
    residual_weight_kg: item.bio_residual_weight_kg,
    residual_price_per_kg: item.bio_residual_price_per_kg,
    // The item's own rule is the residual of its animals: a boar item simply has none.
    residual_applies_gender: null,
    run_frequency: item.bio_run_frequency ?? 'MONTHLY',
    day_basis: item.bio_day_basis ?? 'FREQUENCY_DAYS',
    tracking: 'INDIVIDUAL',
  };
  let notRunnable: string | null = null;
  if (!item.company_id) notRunnable = `Item ${item.item_code} is not a company's own item, and costing runs are made per company.`;
  else if (!itemHasCostingTerms(item)) notRunnable = `Item ${item.item_code} has no costing method; set the FA/Bio Asset Costing Method on its Bio Asset Costing tab.`;
  else if (!item.is_active || item.is_blocked || item.deleted_at) notRunnable = `Item ${item.item_code} is not active, so it cannot be run.`;
  return {
    id: item.item_id,
    code: item.item_code,
    tenant_id: item.tenant_id,
    company_id: item.company_id ?? '',
    costing_method: item.bio_costing_method ?? '',
    run_frequency: terms.run_frequency as string,
    day_basis: terms.day_basis as string,
    auto_post: !!item.bio_auto_post,
    effective_from: item.bio_effective_from ? String(item.bio_effective_from).slice(0, 10) : null,
    not_runnable: notRunnable,
    terms,
    gl: {
      acquisition_gl_id: item.bio_acquisition_gl_id,
      accum_amort_gl_id: item.bio_accum_amort_gl_id,
      amort_expense_gl_id: item.bio_amort_expense_gl_id,
      fv_gain_loss_gl_id: item.bio_fv_gain_loss_gl_id,
      writeoff_gl_id: item.bio_writeoff_gl_id,
    },
  };
}
