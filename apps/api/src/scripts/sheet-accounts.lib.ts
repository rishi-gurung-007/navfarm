/**
 * The chart of accounts the Fixed Asset sheet names (TDD V1.3, FIXED ASSET tab) and which of them each biological item posts to. Pure: the seed
 * (02c-project-items) and `db-apply-sheet-accounts` both plan with it, so a fresh seed and an existing tenant end up with the same accounts and codes.
 *
 * The NAMES are the sheet's. The CODES are ours (the sheet gives none): acquisition 1101+, accumulated amortisation 1121+, fair value gain/loss 4101+,
 * amortisation expense 5101+, each the next code free in the chart. An account already in the chart under the sheet's name (any case) is used as it is.
 */
import { FIXED_ASSET_ITEMS, type FixedAssetItem } from './fixed-asset-items.lib';

export type SheetAccountKind = 'acquisition' | 'accumulated' | 'amortisation' | 'fair_value';

export const FIRST_CODE: Record<SheetAccountKind, number> = { acquisition: 1101, accumulated: 1121, fair_value: 4101, amortisation: 5101 };
/** Accumulated amortisation is a contra-asset: an ASSET account that carries a credit balance, as 1065 did. */
export const ACCOUNT_TYPE: Record<SheetAccountKind, 'ASSET' | 'INCOME' | 'EXPENSE'> = { acquisition: 'ASSET', accumulated: 'ASSET', fair_value: 'INCOME', amortisation: 'EXPENSE' };

const key = (s: string) => s.trim().toLowerCase();

/** Every account the sheet names, once, with what kind of account it is. */
export function sheetAccountNames(items: FixedAssetItem[] = FIXED_ASSET_ITEMS): Array<{ name: string; kind: SheetAccountKind }> {
  const out: Array<{ name: string; kind: SheetAccountKind }> = [];
  const add = (name: string | null, kind: SheetAccountKind) => {
    if (name && !out.some((o) => key(o.name) === key(name))) out.push({ name, kind });
  };
  for (const i of items) {
    add(i.accounts.acquisition, 'acquisition');
    add(i.accounts.accumulated, 'accumulated');
    add(i.accounts.result, i.costing_method === 'AMORTIZATION' ? 'amortisation' : 'fair_value');
  }
  return out;
}

export interface ChartRow { gl_account_id: string; account_code: string; account_name: string }
export interface AccountPlanEntry {
  name: string;
  kind: SheetAccountKind;
  account_type: 'ASSET' | 'INCOME' | 'EXPENSE';
  code: string;
  gl_account_id: string | null;
  action: 'EXISTS' | 'CREATE';
}

/** For each account the sheet names: the chart's account of that name, or the code it is to be created under. */
export function planSheetAccounts(chart: ChartRow[], items: FixedAssetItem[] = FIXED_ASSET_ITEMS): AccountPlanEntry[] {
  const used = new Set(chart.map((a) => a.account_code));
  const next = { ...FIRST_CODE };
  return sheetAccountNames(items).map(({ name, kind }) => {
    const found = chart.find((a) => key(a.account_name) === key(name));
    if (found) return { name, kind, account_type: ACCOUNT_TYPE[kind], code: found.account_code, gl_account_id: found.gl_account_id, action: 'EXISTS' as const };
    while (used.has(String(next[kind]))) next[kind] += 1;
    const code = String(next[kind]++);
    used.add(code);
    return { name, kind, account_type: ACCOUNT_TYPE[kind], code, gl_account_id: null, action: 'CREATE' as const };
  });
}

export interface ItemGl {
  bio_acquisition_gl_id: string | null;
  bio_accum_amort_gl_id: string | null;
  bio_amort_expense_gl_id: string | null;
  bio_fv_gain_loss_gl_id: string | null;
}

/**
 * The accounts an item posts to, by the sheet: an amortised item its acquisition, accumulated amortisation and amortisation expense; every other item
 * (fair value, and the batch-tracked PIGLETS and Finisher) its acquisition and fair value gain/loss. The write-off account is not here: the sheet names none.
 */
export function sheetItemGl(item: FixedAssetItem, idOf: (name: string | null) => string | null): ItemGl {
  const amortised = item.costing_method === 'AMORTIZATION';
  return {
    bio_acquisition_gl_id: idOf(item.accounts.acquisition),
    bio_accum_amort_gl_id: amortised ? idOf(item.accounts.accumulated) : null,
    bio_amort_expense_gl_id: amortised ? idOf(item.accounts.result) : null,
    bio_fv_gain_loss_gl_id: amortised ? null : idOf(item.accounts.result),
  };
}

/** What an account holds for one item: its credits less its debits (a credit balance, as accumulated amortisation carries). */
export function creditBalance(lines: Array<{ debit_amount: unknown; credit_amount: unknown }>): number {
  return Math.round(lines.reduce((n, l) => n + Number(l.credit_amount ?? 0) - Number(l.debit_amount ?? 0), 0) * 1e4) / 1e4;
}
