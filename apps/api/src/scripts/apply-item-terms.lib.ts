/**
 * The plan for putting the sheet's costing figures (fixed-asset-items.lib.ts) on the biological items that have been created. Pure: the script reads the
 * items and the chart of accounts and this decides. It creates nothing and invents nothing: an item not created yet is reported as missing; an
 * account the chart does not hold under the sheet's name is reported, and left unset; a term the sheet does not give (the Costing From date) is taken only from
 * what the caller names.
 */
import { missingBioGl, validateItemBioCosting } from '../modules/master-data/item/item-bio-costing.rules';
import { FIXED_ASSET_ITEMS, ACCOUNTS_NOT_IN_THE_SHEET, type FixedAssetItem } from './fixed-asset-items.lib';

export interface FoundItem { item_id: string; item_code: string; company_id: string | null; is_biological_asset: boolean | number; bio_costing_method: string | null }
export interface FoundAccount { gl_account_id: string; account_name: string; company_id: string | null }

export type SheetItemStatus = 'READY' | 'MISSING' | 'NOT_BIOLOGICAL' | 'ALREADY_HAS_TERMS' | 'NOT_COSTED_YET';

export interface SheetItemTerms {
  is_biological_asset: true;
  bio_costing_method: string; bio_gender: string | null; bio_start_age_weeks: number; bio_start_age_days: number; bio_useful_life_months: number | null;
  bio_residual_rule: string; bio_residual_fixed_amount: null; bio_residual_weight_kg: number | null; bio_residual_price_per_kg: number | null;
  bio_run_frequency: string; bio_day_basis: string; bio_effective_from: string | null; bio_auto_post: boolean;
  bio_acquisition_gl_id: string | null; bio_accum_amort_gl_id: string | null; bio_amort_expense_gl_id: string | null; bio_fv_gain_loss_gl_id: string | null; bio_writeoff_gl_id: string | null;
}
export interface SheetItemRate { farm_id: null; age_week_from: number; effective_from: string; expected_weight_kg: number; price_per_kg: number; cdm_based: boolean; costs_to_sell_pct: null }

export interface SheetPlanEntry {
  item_code: string;
  status: SheetItemStatus;
  item_id?: string;
  terms?: SheetItemTerms;
  rate?: SheetItemRate;
  /** Sheet account names found in the chart (and used), and those not found (left unset: Finance creates them). */
  accounts_set: string[];
  accounts_not_in_chart: string[];
  /** What a run of this item still cannot post without. */
  missing_for_run: string[];
  notes: string[];
}

const key = (s: string) => s.trim().toLowerCase();

function termsFor(c: FixedAssetItem, accountId: (name: string | null) => string | null, costingFrom: string | null): SheetItemTerms {
  const amortised = c.costing_method === 'AMORTIZATION';
  return {
    is_biological_asset: true,
    bio_costing_method: c.costing_method as string,
    bio_gender: c.gender,
    bio_start_age_weeks: c.start_weeks as number,
    bio_start_age_days: 0,
    bio_useful_life_months: c.life_months,
    bio_residual_rule: c.residual.rule,
    bio_residual_fixed_amount: null,
    bio_residual_weight_kg: c.residual.rule === 'WEIGHT_X_PRICE' ? c.residual.weight_kg : null,
    bio_residual_price_per_kg: c.residual.rule === 'WEIGHT_X_PRICE' ? c.residual.price_per_kg : null,
    bio_run_frequency: 'MONTHLY',
    bio_day_basis: 'FREQUENCY_DAYS',
    bio_effective_from: costingFrom,
    bio_auto_post: false,
    bio_acquisition_gl_id: accountId(c.accounts.acquisition),
    bio_accum_amort_gl_id: amortised ? accountId(c.accounts.accumulated) : null,
    bio_amort_expense_gl_id: amortised ? accountId(c.accounts.result) : null,
    bio_fv_gain_loss_gl_id: amortised ? null : accountId(c.accounts.result),
    bio_writeoff_gl_id: null,
  };
}

export function planSheetTerms(input: { items: FoundItem[]; accounts: FoundAccount[]; costingFrom?: string | null }): SheetPlanEntry[] {
  const costingFrom = input.costingFrom ?? null;
  return FIXED_ASSET_ITEMS.map((c): SheetPlanEntry => {
    const item = input.items.find((i) => key(i.item_code) === key(c.item_code));
    const base = { item_code: c.item_code, accounts_set: [] as string[], accounts_not_in_chart: [] as string[], missing_for_run: [] as string[], notes: [...c.open] };
    if (!item) return { ...base, status: 'MISSING', notes: [`Create the item ${c.item_code} first (a biological item; ${c.tracking === 'INDIVIDUAL' ? 'tracked by serial, one per animal' : 'tracked by lot'}).`, ...base.notes] };
    if (!item.is_biological_asset) return { ...base, item_id: item.item_id, status: 'NOT_BIOLOGICAL', notes: [`${c.item_code} exists but is not marked as a biological asset; tick Biological Asset on it.`, ...base.notes] };
    if (!c.runnable) return { ...base, item_id: item.item_id, status: 'NOT_COSTED_YET', notes: [...base.notes] };
    if (item.bio_costing_method) return { ...base, item_id: item.item_id, status: 'ALREADY_HAS_TERMS', notes: [`already ${item.bio_costing_method}; nothing is overwritten`, ...base.notes] };

    const chart = input.accounts.filter((a) => !item.company_id || !a.company_id || a.company_id === item.company_id);
    const accounts_set: string[] = [];
    const accounts_not_in_chart: string[] = [];
    const accountId = (name: string | null) => {
      if (!name) return null;
      const found = chart.find((a) => key(a.account_name) === key(name));
      (found ? accounts_set : accounts_not_in_chart).push(name);
      return found?.gl_account_id ?? null;
    };
    const terms = termsFor(c, accountId, costingFrom);
    const problems = validateItemBioCosting(terms);
    const notes = [...base.notes];
    if (problems.length) notes.unshift(`The sheet's terms do not pass the item's own checks: ${problems.join(' ')}`);
    if (!costingFrom) notes.push('No Costing From date given: the item is saved without one, so the scheduler will not run it (a run can still be made by hand). Name it with --costing-from=YYYY-MM-DD.');
    notes.push(`Frequency MONTHLY and frequency days: the FIXED ASSET tab gives none; the formula tab's local rows say monthly (30 days).`);
    let rate: SheetItemRate | undefined;
    if (c.fair_value) {
      if (costingFrom) rate = { farm_id: null, age_week_from: 0, effective_from: costingFrom, expected_weight_kg: c.fair_value.expected_weight_kg, price_per_kg: c.fair_value.price_per_kg, cdm_based: c.fair_value.cdm_based, costs_to_sell_pct: null };
      else notes.push('The fair-value rate (150 kg x 2.05, CDM based: No) is added only with a date: name --costing-from.');
    }
    return {
      ...base, item_id: item.item_id, status: problems.length ? 'NOT_COSTED_YET' : 'READY', terms: problems.length ? undefined : terms, rate,
      accounts_set, accounts_not_in_chart, missing_for_run: missingBioGl(terms), notes,
    };
  });
}

/** Said once for the report: the sheet names no impairment account for any item, so no item can post until Finance sets one. */
export const FINANCE_STILL_OWES = ACCOUNTS_NOT_IN_THE_SHEET;
