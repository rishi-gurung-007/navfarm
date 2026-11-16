/**
 * Posting Groups as pure rules (plan 2026-11-13-posting-group-setup). A group holds the accounts of a class of items; an item picks one.
 * BIOLOGICAL groups hold the animal accounts, INVENTORY groups the stock and cost-of-sales accounts. No database here.
 */
export const GROUP_KINDS = ['BIOLOGICAL', 'INVENTORY'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const BIO_ACCOUNT_FIELDS = ['asset_gl_id', 'accum_amort_gl_id', 'amort_expense_gl_id', 'fv_gain_gl_id', 'fv_loss_gl_id', 'writeoff_gl_id'] as const;
export const INVENTORY_ACCOUNT_FIELDS = ['inventory_gl_id', 'cogs_gl_id'] as const;
export const ACCOUNT_FIELDS = [...BIO_ACCOUNT_FIELDS, ...INVENTORY_ACCOUNT_FIELDS] as const;
export type AccountField = (typeof ACCOUNT_FIELDS)[number];
export type GroupAccounts = Partial<Record<AccountField, string | null>>;

export const ACCOUNT_LABELS: Record<AccountField, string> = {
  asset_gl_id: 'Acquisition cost account', accum_amort_gl_id: 'Accumulated amortization account', amort_expense_gl_id: 'Amortization expense account',
  fv_gain_gl_id: 'Fair value gain account', fv_loss_gl_id: 'Fair value loss account', writeoff_gl_id: 'Mortality / impairment loss account',
  inventory_gl_id: 'Inventory account', cogs_gl_id: 'COGS account',
};

/** The item column each group account is copied to (the posting paths read the item's columns). */
export const ITEM_COLUMN: Record<AccountField, string> = {
  asset_gl_id: 'bio_acquisition_gl_id', accum_amort_gl_id: 'bio_accum_amort_gl_id', amort_expense_gl_id: 'bio_amort_expense_gl_id',
  fv_gain_gl_id: 'bio_fv_gain_loss_gl_id', fv_loss_gl_id: 'bio_fv_loss_gl_id', writeoff_gl_id: 'bio_writeoff_gl_id',
  inventory_gl_id: 'inventory_gl_account', cogs_gl_id: 'cogs_gl_account',
};

const has = (v: unknown) => v !== null && v !== undefined && v !== '';

export const fieldsOfKind = (kind: string): readonly AccountField[] => (kind === 'BIOLOGICAL' ? BIO_ACCOUNT_FIELDS : INVENTORY_ACCOUNT_FIELDS);

/** The accounts a group of this kind carries, with every other account cleared (a kind never carries the other kind's accounts). */
export function accountsOfKind(kind: string, accounts: GroupAccounts): Record<AccountField, string | null> {
  const out = {} as Record<AccountField, string | null>;
  for (const f of ACCOUNT_FIELDS) out[f] = fieldsOfKind(kind).includes(f) && has(accounts[f]) ? (accounts[f] as string) : null;
  return out;
}

/** What is wrong with a group as saved. */
export function validateGroup(kind: string, code: string, name: string, accounts: GroupAccounts): string[] {
  const e: string[] = [];
  if (!(GROUP_KINDS as readonly string[]).includes(kind)) return ['Kind must be BIOLOGICAL or INVENTORY.'];
  if (!code?.trim()) e.push('Enter a group code.');
  if (!name?.trim()) e.push('Enter a group name.');
  for (const f of ACCOUNT_FIELDS) if (has(accounts[f]) && !fieldsOfKind(kind).includes(f)) e.push(`${ACCOUNT_LABELS[f]} does not belong on a ${kind} group.`);
  if (kind === 'BIOLOGICAL' && !has(accounts.asset_gl_id)) e.push('A biological group needs the acquisition cost account.');
  if (kind === 'INVENTORY' && !has(accounts.inventory_gl_id)) e.push('An inventory group needs the inventory account.');
  return e;
}

/** Accounts each costing method needs on the group (the engine's own list: acquisition, the method's accounts, and the mortality loss). */
const METHOD_NEEDS: Record<string, AccountField[]> = {
  AMORTIZATION: ['asset_gl_id', 'accum_amort_gl_id', 'amort_expense_gl_id', 'writeoff_gl_id'],
  FAIR_VALUE: ['asset_gl_id', 'fv_gain_gl_id', 'writeoff_gl_id'],
};

/** The accounts a group lacks for the costing method; empty when it has them all or there is no method. */
export function missingForMethod(method: string | null | undefined, accounts: GroupAccounts): AccountField[] {
  return (method ? METHOD_NEEDS[method] ?? [] : []).filter((f) => !has(accounts[f]));
}

/** Why a group cannot serve an item, or null when it can. */
export function groupFitsItem(
  group: { kind: string; group_code: string } & GroupAccounts,
  item: { is_biological_asset?: boolean | null; bio_costing_method?: string | null; item_code?: string },
): string | null {
  const biological = !!item.is_biological_asset;
  if (biological && group.kind !== 'BIOLOGICAL') return `${group.group_code} is an inventory group; a biological item needs a biological group.`;
  if (!biological && group.kind !== 'INVENTORY') return `${group.group_code} is a biological group; a stock item needs an inventory group.`;
  const missing = biological ? missingForMethod(item.bio_costing_method, group) : [];
  if (missing.length) return `${group.group_code} has no ${missing.map((f) => ACCOUNT_LABELS[f].toLowerCase()).join(', ')}, which ${item.bio_costing_method} costing needs.`;
  return null;
}

/** The item columns that take the group's accounts. */
export function itemColumnsFromGroup(group: { kind: string } & GroupAccounts): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of fieldsOfKind(group.kind)) out[ITEM_COLUMN[f]] = has(group[f]) ? (group[f] as string) : null;
  return out;
}

/** The accounts an item was sent that differ from its group's (an item with a group takes its accounts from the group). */
export function accountsContradictingGroup(group: { kind: string } & GroupAccounts, sent: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const wanted = itemColumnsFromGroup(group);
  for (const [col, value] of Object.entries(wanted)) {
    const given = sent[col];
    if (given === undefined) continue;
    if ((has(given) ? given : null) !== value) bad.push(col);
  }
  return bad;
}

/** Group accounts that changed, as labels, for the lock message. */
export function changedAccounts(before: GroupAccounts, after: GroupAccounts): AccountField[] {
  return ACCOUNT_FIELDS.filter((f) => after[f] !== undefined && (has(after[f]) ? after[f] : null) !== (has(before[f]) ? before[f] : null));
}
