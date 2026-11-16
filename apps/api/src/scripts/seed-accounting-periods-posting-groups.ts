/**
 * Seeds two masters the 13 Nov 2026 merge added, for every active company of the dev tenant:
 *  - Accounting Period Master (migration 0252): 12 months, Apr 2026 - Mar 2027, April marked New Fiscal Year (fiscal year 2026-27).
 *  - Posting Groups (migration 0250), from accounts the company's chart already has. An account is written `project|starter`: the 6-digit code of the
 *    NAVFarm_Dummy_COA chart (`pnpm seed:project`), else the 4-digit starter-chart code. A group needing an account the chart lacks is skipped and said so
 *    (an `optional` one, meant only for the project chart, is skipped quietly).
 *      BIOLOGICAL, one per imported item (GGP/GP/P x F/M): acquisition, accumulated amortisation, amortisation expense, mortality loss
 *      BIOLOGICAL, one per local item (GP/P x F/M): acquisition, fair value gain and loss, mortality loss
 *      BIOLOGICAL, generic pre-mature / mature herd, and INVENTORY groups for feed, raw material, veterinary, medicine, weaners, finisher, finished goods
 *    DEV PLACEHOLDERS (ours, not the client's): the pairing of accounts to groups is ours; Finance replaces it in the Posting Group master. No group is
 *    given a cost-of-sales account the chart does not name for it.
 * A group whose account is missing from a company's chart is skipped and said so. Safe to repeat (a code or a starting date that exists is left alone).
 *
 *   pnpm nx run api:db-seed-accounting-periods-posting-groups               # print the plan
 *   pnpm nx run api:db-seed-accounting-periods-posting-groups -- --apply
 *   env: TENANT_DB_NAME (nf_devco), DATABASE_*
 */
import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';

const DB = process.env.TENANT_DB_NAME || 'nf_devco';
const APPLY = process.argv.slice(2).includes('--apply');

export const FISCAL_START = { year: 2026, month: 4 } as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Twelve consecutive months from the fiscal start; the first is the New Fiscal Year row. */
export function twelveMonths(startYear: number, startMonth: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const m0 = startMonth - 1 + i;
    const year = startYear + Math.floor(m0 / 12);
    const month = (m0 % 12) + 1;
    return { starting_date: `${year}-${String(month).padStart(2, '0')}-01`, name: `${MONTHS[month - 1]} ${year}`, new_fiscal_year: i === 0 };
  });
}

type Slot = 'asset_gl_id' | 'accum_amort_gl_id' | 'amort_expense_gl_id' | 'fv_gain_gl_id' | 'fv_loss_gl_id' | 'writeoff_gl_id' | 'inventory_gl_id' | 'cogs_gl_id';
export interface Group { code: string; name: string; kind: 'BIOLOGICAL' | 'INVENTORY'; accounts: Partial<Record<Slot, string>>; optional?: boolean }

const MORTALITY = '610400|5010';
const imported = (code: string, name: string, asset: string, accum: string, amort: string): Group => ({
  code, name: `${name} (imported, amortised)`, kind: 'BIOLOGICAL', optional: true,
  accounts: { asset_gl_id: asset, accum_amort_gl_id: accum, amort_expense_gl_id: amort, writeoff_gl_id: MORTALITY },
});
const local = (code: string, name: string, asset: string, gain: string, loss: string): Group => ({
  code, name: `${name} (local, fair value)`, kind: 'BIOLOGICAL', optional: true,
  accounts: { asset_gl_id: asset, fv_gain_gl_id: gain, fv_loss_gl_id: loss, writeoff_gl_id: MORTALITY },
});
const stock = (code: string, name: string, inventory: string, cogs?: string): Group => ({
  code, name, kind: 'INVENTORY', accounts: { inventory_gl_id: inventory, ...(cogs ? { cogs_gl_id: cogs } : {}) },
});

export const POSTING_GROUPS: Group[] = [
  imported('BIO-GGP-IMP-F', 'GGP-Imp-F', '150100', '150110', '520100'),
  imported('BIO-GGP-IMP-M', 'GGP-Imp-M', '150200', '150210', '520200'),
  imported('BIO-GP-IMP-F', 'GP-Imp-F', '150300', '150310', '520300'),
  imported('BIO-GP-IMP-M', 'GP-Imp-M', '150400', '150410', '520400'),
  imported('BIO-P-IMP-F', 'P-Imp-F', '150500', '150510', '520500'),
  imported('BIO-P-IMP-M', 'P-Imp-M', '150600', '150610', '520600'),
  local('BIO-GP-LOC-F', 'GP-Loc-F', '151100', '721100', '821100'),
  local('BIO-GP-LOC-M', 'GP-Loc-M', '151200', '721200', '821200'),
  local('BIO-P-LOC-F', 'P-Loc-F', '151300', '721300', '821300'),
  local('BIO-P-LOC-M', 'P-Loc-M', '151400', '721400', '821400'),
  { code: 'BIO-PREMATURE', name: 'Biological assets - pre-mature', kind: 'BIOLOGICAL', accounts: { asset_gl_id: '152100|1050', amort_expense_gl_id: '520900|5100', fv_gain_gl_id: '720900|4020', writeoff_gl_id: MORTALITY } },
  { code: 'BIO-MATURE', name: 'Biological assets - mature', kind: 'BIOLOGICAL', accounts: { asset_gl_id: '152200|1060', amort_expense_gl_id: '520900|5100', fv_gain_gl_id: '720900|4020', writeoff_gl_id: MORTALITY } },
  stock('INV-FEED', 'Inventory - feed', '170100|1010'),
  stock('INV-FEED-RAW', 'Inventory - feed raw material', '170110|1010'),
  stock('INV-VET', 'Inventory - veterinary', '170200|1010'),
  stock('INV-MED', 'Inventory - medicine', '170300|1010'),
  stock('INV-WEANERS', 'Inventory - weaners', '170400|1055'),
  stock('INV-FINISHER', 'Inventory - finisher', '170500', '510100'),
  stock('INV-FG', 'Inventory - finished goods', '171100|1030'),
];

/** The first of `a|b` the chart has, or undefined. */
export const resolveAccount = (spec: string, idOf: Map<string, string>): string | undefined => spec.split('|').map((c) => idOf.get(c)).find(Boolean);

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database: DB,
  });
  console.log(`${APPLY ? 'APPLY' : 'READ-ONLY'} on ${DB}`);
  try {
    const [tables] = await conn.query<any[]>('SELECT table_name t FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?, ?)', [DB, 'accounting_period', 'gl_posting_group']);
    const missingTables = ['accounting_period', 'gl_posting_group'].filter((t) => !tables.some((r) => r.t === t));
    if (missingTables.length) throw new Error(`${DB} has no ${missingTables.join(' or ')} yet (migrations 0250 / 0252 not applied). Run: pnpm nx run api:db-migrate-all-tenants, then this again.`);
    const [companies] = await conn.query<any[]>('SELECT company_id, tenant_id, company_code FROM company_master WHERE is_active = 1 AND deleted_at IS NULL');
    if (!companies.length) throw new Error(`No active company in ${DB}.`);
    await conn.beginTransaction();
    let periods = 0, groups = 0;
    for (const c of companies) {
      const [have] = await conn.query<any[]>('SELECT DATE_FORMAT(starting_date, "%Y-%m-%d") d FROM accounting_period WHERE tenant_id = ? AND company_id = ? AND deleted_at IS NULL', [c.tenant_id, c.company_id]);
      const haveDates = new Set(have.map((r) => r.d));
      for (const p of twelveMonths(FISCAL_START.year, FISCAL_START.month)) {
        if (haveDates.has(p.starting_date)) continue;
        console.log(`${c.company_code}: period ${p.name}${p.new_fiscal_year ? ' (new fiscal year)' : ''}: ${APPLY ? 'creating' : 'would be created'}`);
        periods++;
        if (APPLY) await conn.query('INSERT INTO accounting_period (accounting_period_id, tenant_id, company_id, starting_date, name, new_fiscal_year) VALUES (?,?,?,?,?,?)', [randomUUID(), c.tenant_id, c.company_id, p.starting_date, p.name, p.new_fiscal_year]);
      }
      const [chart] = await conn.query<any[]>('SELECT gl_account_id, account_code FROM gl_account_master WHERE company_id = ? AND deleted_at IS NULL AND is_active = 1', [c.company_id]);
      const idOf = new Map<string, string>(chart.map((a) => [String(a.account_code), a.gl_account_id]));
      const [existing] = await conn.query<any[]>('SELECT group_code, kind, asset_gl_id, inventory_gl_id FROM gl_posting_group WHERE tenant_id = ? AND company_id = ? AND deleted_at IS NULL', [c.tenant_id, c.company_id]);
      const haveCodes = new Set(existing.map((r) => r.group_code));
      // A group the migration's data step (0250) built from an item's own accounts already holds that asset / inventory account: do not add a twin.
      const takenAccounts = new Set(existing.map((r) => (r.kind === 'BIOLOGICAL' ? r.asset_gl_id : r.inventory_gl_id)).filter(Boolean));
      for (const g of POSTING_GROUPS) {
        if (haveCodes.has(g.code)) { console.log(`${c.company_code}: group ${g.code}: exists, left alone`); continue; }
        const primary = resolveAccount(g.kind === 'BIOLOGICAL' ? g.accounts.asset_gl_id! : g.accounts.inventory_gl_id!, idOf);
        if (primary && takenAccounts.has(primary)) { console.log(`${c.company_code}: group ${g.code}: its ${g.kind === 'BIOLOGICAL' ? 'asset' : 'inventory'} account is already in a posting group, left alone`); continue; }
        const missing = Object.values(g.accounts).filter((spec) => !resolveAccount(spec!, idOf));
        if (missing.length) { if (!g.optional) console.log(`${c.company_code}: group ${g.code}: SKIPPED, chart lacks ${missing.join(', ')}`); continue; }
        console.log(`${c.company_code}: group ${g.code}: ${APPLY ? 'creating' : 'would be created'}`);
        groups++;
        if (!APPLY) continue;
        const cols = Object.keys(g.accounts) as Slot[];
        await conn.query(
          `INSERT INTO gl_posting_group (posting_group_id, tenant_id, company_id, group_code, group_name, kind${cols.map((k) => `, ${k}`).join('')}) VALUES (?,?,?,?,?,?${cols.map(() => ',?').join('')})`,
          [randomUUID(), c.tenant_id, c.company_id, g.code, g.name, g.kind, ...cols.map((k) => resolveAccount(g.accounts[k]!, idOf))],
        );
      }
    }
    if (APPLY) await conn.commit(); else await conn.rollback();
    console.log(`${APPLY ? 'Done' : 'Plan only'}: ${periods} periods, ${groups} posting groups.${APPLY ? '' : ' Run with --apply to write.'}`);
  } catch (e) { await conn.rollback(); throw e; } finally { await conn.end(); }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
