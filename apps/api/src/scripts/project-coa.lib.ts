/**
 * The chart of accounts of the project seed (`pnpm seed:project`), from NAVFarm_Dummy_COA.xlsx (4 Nov 2026, sheet "Dummy COA": 32 accounts, GL Code and GL
 * Account Name). Pure data and pure planning; the chapter 02a-project-coa applies it.
 *
 *   source 'COA'  - the account is in the workbook: its code and name are the workbook's, exactly.
 *   source 'OURS' - the workbook has no account for something the postings need (amortisation of the GP and P imported items, fair value of the local items,
 *                   feed and overhead expensed after the costing start, semen, variances, the herds' batch-level accounts). These follow the workbook's own
 *                   numbering and naming (1xxxxx assets, 2 liabilities, 4 revenue, 5 cost of sales, 6 expenses, 7 gains, 8 losses), and are ours until
 *                   Finance gives the real ones.
 *
 * `replaces` names the starter-chart code (setup wizard, 4-digit) the account takes over: the starter row is renumbered and renamed in place, so every GL
 * mapping that points at it follows, and nothing posted before the rename moves.
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE';

export interface CoaAccount {
  code: string;
  name: string;
  type: AccountType;
  source: 'COA' | 'OURS';
  replaces?: string;
}

const coa = (code: string, name: string, type: AccountType, replaces?: string): CoaAccount => ({ code, name, type, source: 'COA', ...(replaces ? { replaces } : {}) });
const ours = (code: string, name: string, type: AccountType, replaces?: string): CoaAccount => ({ code, name, type, source: 'OURS', ...(replaces ? { replaces } : {}) });

/** The workbook's 32 accounts, in its order. */
export const DUMMY_COA: CoaAccount[] = [
  coa('150100', 'GGP-Imp-F Acquisition Cost', 'ASSET'),
  coa('150110', 'Accumulated Amortization - GGP-Imp-F', 'ASSET'),
  coa('520100', 'Amortization Expense - GGP-Imp-F', 'EXPENSE'),
  coa('150200', 'GGP-Imp-M Acquisition Cost', 'ASSET'),
  coa('150210', 'Accumulated Amortization - GGP-Imp-M', 'ASSET'),
  coa('150300', 'GP-Imp-F Acquisition Cost', 'ASSET'),
  coa('150400', 'GP-Imp-M Acquisition Cost', 'ASSET'),
  coa('150500', 'P-Imp-F Acquisition Cost', 'ASSET'),
  coa('150600', 'P-Imp-M Acquisition Cost', 'ASSET'),
  coa('151100', 'GP-Loc-F Acquisition Cost', 'ASSET'),
  coa('151200', 'GP-Loc-M Acquisition Cost', 'ASSET'),
  coa('151300', 'P-Loc-F Acquisition Cost', 'ASSET'),
  coa('151400', 'P-Loc-M Acquisition Cost', 'ASSET'),
  coa('160100', 'WIP GP-IMP F Account', 'ASSET'),
  coa('160200', 'WIP GP Local Account', 'ASSET'),
  coa('160300', 'WIP P Local Account', 'ASSET'),
  coa('160400', 'WIP Weaners', 'ASSET'),
  coa('170100', 'Feed Inventory', 'ASSET', '1010'),
  coa('170200', 'Veterinary Inventory', 'ASSET'),
  coa('170300', 'Medicine Inventory', 'ASSET'),
  coa('170400', 'Weaners Inventory', 'ASSET', '1055'),
  coa('170500', 'Finisher Inventory', 'ASSET'),
  coa('720100', 'FV Gain - Weaners', 'INCOME'),
  coa('820100', 'FV Loss - Weaners', 'EXPENSE'),
  coa('171000', 'Finisher Closing Stock', 'ASSET'),
  coa('610400', 'Mortality / Impairment Loss', 'EXPENSE', '5010'),
  coa('710500', 'Gain on Disposal of Animals', 'INCOME', '4010'),
  coa('410100', 'Pig Sales Revenue', 'INCOME'),
  coa('510100', 'Cost of Goods Sold - Finisher', 'EXPENSE'),
  coa('120100', 'Trade Receivables', 'ASSET', '1200'),
  coa('210100', 'Trade Payables', 'LIABILITY', '2010'),
  coa('100100', 'Cash & Bank', 'ASSET'),
];

/** What the postings need that the workbook does not have, in its numbering. */
export const OUR_ACCOUNTS: CoaAccount[] = [
  // the imported items the workbook gives no amortisation accounts for (it gives GGP-Imp-F both, GGP-Imp-M only the accumulated one)
  ours('150310', 'Accumulated Amortization - GP-Imp-F', 'ASSET'),
  ours('150410', 'Accumulated Amortization - GP-Imp-M', 'ASSET'),
  ours('150510', 'Accumulated Amortization - P-Imp-F', 'ASSET'),
  ours('150610', 'Accumulated Amortization - P-Imp-M', 'ASSET'),
  ours('520200', 'Amortization Expense - GGP-Imp-M', 'EXPENSE'),
  ours('520300', 'Amortization Expense - GP-Imp-F', 'EXPENSE'),
  ours('520400', 'Amortization Expense - GP-Imp-M', 'EXPENSE'),
  ours('520500', 'Amortization Expense - P-Imp-F', 'EXPENSE'),
  ours('520600', 'Amortization Expense - P-Imp-M', 'EXPENSE'),
  // fair value of the local items and of Finisher, split gain / loss as the workbook splits Weaners
  ours('721100', 'FV Gain - GP-Loc-F', 'INCOME'),
  ours('721200', 'FV Gain - GP-Loc-M', 'INCOME'),
  ours('721300', 'FV Gain - P-Loc-F', 'INCOME'),
  ours('721400', 'FV Gain - P-Loc-M', 'INCOME'),
  ours('720500', 'FV Gain - Finisher', 'INCOME'),
  ours('821100', 'FV Loss - GP-Loc-F', 'EXPENSE'),
  ours('821200', 'FV Loss - GP-Loc-M', 'EXPENSE'),
  ours('821300', 'FV Loss - P-Loc-F', 'EXPENSE'),
  ours('821400', 'FV Loss - P-Loc-M', 'EXPENSE'),
  ours('820500', 'FV Loss - Finisher', 'EXPENSE'),
  // the starter chart's other accounts, renumbered into the workbook's scheme (names kept)
  ours('170110', 'Feed Raw Material Inventory', 'ASSET', '1011'),
  ours('160500', 'Work in Progress Inventory', 'ASSET', '1020'),
  ours('171100', 'Finished Goods Inventory', 'ASSET', '1030'),
  ours('170900', 'Inventory in Transit', 'ASSET', '1040'),
  ours('152100', 'Biological Assets - Pre-mature (Herd)', 'ASSET', '1050'),
  ours('152200', 'Biological Assets - Mature (Herd)', 'ASSET', '1060'),
  ours('720900', 'Fair Value Gain / Loss - Herd', 'INCOME', '4020'),
  ours('730100', 'Inventory Adjustment Gain', 'INCOME', '4030'),
  ours('740100', 'Boar Cost Recovered (Semen Produced)', 'INCOME', '4040'),
  ours('610100', 'Overhead Expense', 'EXPENSE', '5020'),
  ours('630100', 'Price Variance', 'EXPENSE', '5030'),
  ours('630200', 'Usage Variance', 'EXPENSE', '5040'),
  ours('630300', 'Output Variance', 'EXPENSE', '5050'),
  ours('630400', 'Overhead Variance', 'EXPENSE', '5060'),
  ours('830100', 'Inventory Adjustment Loss', 'EXPENSE', '5070'),
  ours('610200', 'Bio-Asset Consumption Expense (Mature)', 'EXPENSE', '5080'),
  ours('610300', 'Bio-Asset Overhead Expense (Mature)', 'EXPENSE', '5090'),
  ours('520900', 'Amortization Expense - Bio Assets (Herd)', 'EXPENSE', '5100'),
];

export const PROJECT_COA: CoaAccount[] = [...DUMMY_COA, ...OUR_ACCOUNTS];

/** The accounts each biological item posts to, by code. Write-off is the workbook's "Mortality / Impairment Loss" for every animal item. */
export interface ItemAccounts {
  acquisition: string;
  accumulated?: string;
  amortisation?: string;
  fv_gain?: string;
  fv_loss?: string;
  writeoff?: string;
}
const WRITE_OFF = '610400';
export const ITEM_ACCOUNTS: Record<string, ItemAccounts> = {
  'GGP-Imp-F': { acquisition: '150100', accumulated: '150110', amortisation: '520100', writeoff: WRITE_OFF },
  'GGP-Imp-M': { acquisition: '150200', accumulated: '150210', amortisation: '520200', writeoff: WRITE_OFF },
  'GP-Imp-F': { acquisition: '150300', accumulated: '150310', amortisation: '520300', writeoff: WRITE_OFF },
  'GP-Imp-M': { acquisition: '150400', accumulated: '150410', amortisation: '520400', writeoff: WRITE_OFF },
  'P-Imp-F': { acquisition: '150500', accumulated: '150510', amortisation: '520500', writeoff: WRITE_OFF },
  'P-Imp-M': { acquisition: '150600', accumulated: '150610', amortisation: '520600', writeoff: WRITE_OFF },
  'GP-Loc-F': { acquisition: '151100', fv_gain: '721100', fv_loss: '821100', writeoff: WRITE_OFF },
  'GP-Loc-M': { acquisition: '151200', fv_gain: '721200', fv_loss: '821200', writeoff: WRITE_OFF },
  'P-Loc-F': { acquisition: '151300', fv_gain: '721300', fv_loss: '821300', writeoff: WRITE_OFF },
  'P-Loc-M': { acquisition: '151400', fv_gain: '721400', fv_loss: '821400', writeoff: WRITE_OFF },
  // batch-tracked, not run: they carry their accounts for when a head-count rule is given
  PIGLETS: { acquisition: '170400', fv_gain: '720100', fv_loss: '820100' },
  Finisher: { acquisition: '171000', fv_gain: '720500', fv_loss: '820500' },
};

/**
 * Inventory by item category (ours: the workbook gives the three accounts but not which goods go to which). Feed stays on Feed Inventory, the starter chart's
 * one inventory account; vaccines go to Veterinary Inventory and medicines to Medicine Inventory, by a category-level GL mapping that changes only the inventory
 * side of each mapping that names Feed Inventory.
 */
export const CATEGORY_INVENTORY: Array<{ category_code: string; category_name: string; account: string }> = [
  { category_code: 'ICAT-006', category_name: 'Swine Vaccines', account: '170200' },
  { category_code: 'ICAT-005', category_name: 'Vet Medicines', account: '170300' },
];

export const FEED_INVENTORY = '170100';
/** The codes the seed looks an account up by, old and new, so a chapter works on a chart before and after 02a-project-coa. */
export const COA_ALIAS: Record<string, string> = Object.fromEntries(PROJECT_COA.filter((a) => a.replaces).map((a) => [a.replaces!, a.code]));
export const codesFor = (oldCode: string): string[] => [oldCode, ...(COA_ALIAS[oldCode] ? [COA_ALIAS[oldCode]] : [])];

export interface ChartRow { gl_account_id: string; account_code: string; account_name: string; account_type: string }
export interface CoaPlanEntry { account: CoaAccount; action: 'RENAME' | 'CREATE' | 'KEEP'; gl_account_id: string | null; from?: { code: string; name: string } }

/**
 * What applying the chart to `chart` does, per account: the row already at the account's code is kept (made to carry the workbook's name); else the starter
 * row it replaces is renumbered and renamed; else the account is created. Throws on a code clash the plan cannot settle (a code held by another account).
 */
export function planProjectCoa(chart: ChartRow[], accounts: CoaAccount[] = PROJECT_COA): CoaPlanEntry[] {
  const byCode = new Map(chart.map((a) => [a.account_code, a]));
  return accounts.map((account) => {
    const atCode = byCode.get(account.code);
    if (atCode) return { account, action: 'KEEP' as const, gl_account_id: atCode.gl_account_id, from: { code: atCode.account_code, name: atCode.account_name } };
    const old = account.replaces ? byCode.get(account.replaces) : undefined;
    if (old) return { account, action: 'RENAME' as const, gl_account_id: old.gl_account_id, from: { code: old.account_code, name: old.account_name } };
    return { account, action: 'CREATE' as const, gl_account_id: null };
  });
}

/** The codes no two accounts may share, and every item's accounts must be in the chart: checked once, so a typo in this file fails the spec, not the seed. */
export function coaProblems(accounts: CoaAccount[] = PROJECT_COA): string[] {
  const problems: string[] = [];
  const codes = new Map<string, number>();
  for (const a of accounts) codes.set(a.code, (codes.get(a.code) ?? 0) + 1);
  for (const [code, n] of codes) if (n > 1) problems.push(`code ${code} is used ${n} times`);
  const replaced = new Map<string, number>();
  for (const a of accounts) if (a.replaces) replaced.set(a.replaces, (replaced.get(a.replaces) ?? 0) + 1);
  for (const [code, n] of replaced) if (n > 1) problems.push(`starter code ${code} is replaced ${n} times`);
  for (const [item, acc] of Object.entries(ITEM_ACCOUNTS)) {
    for (const code of Object.values(acc)) if (code && !codes.has(code)) problems.push(`${item} names ${code}, which is not in the chart`);
  }
  for (const c of CATEGORY_INVENTORY) if (!codes.has(c.account)) problems.push(`${c.category_code} names ${c.account}, which is not in the chart`);
  return problems;
}
