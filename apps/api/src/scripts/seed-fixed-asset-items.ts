/**
 * Creates the twelve biological items (fixed-asset-items.lib.ts: the Fixed Asset sheet) and the GL accounts the sheet names for them, through the running API,
 * so the item card, number series and audit run as they do for a user. DEV PLACEHOLDERS: the sheet gives account names, not codes, and no accumulated-amortisation or
 * impairment account; the codes here (11xx / 41xx / 51xx) are ours, for Finance to replace. It puts no costing terms on an item: run
 * `db-apply-item-terms` after it. Read-only by default; --apply writes; safe to repeat (a code or account name that exists is left alone).
 *
 *   pnpm nx run api:db-seed-fixed-asset-items              # print the plan
 *   pnpm nx run api:db-seed-fixed-asset-items -- --apply
 *   env: API_URL (http://127.0.0.1:2877/api/v1), SEED_EMAIL, SEED_PASSWORD, DATABASE_* (reads the number series and the breeding-asset category)
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { FIXED_ASSET_ITEMS } from './fixed-asset-items.lib';

const API = (process.env.API_URL || 'http://127.0.0.1:2877/api/v1').replace(/\/$/, '');
const EMAIL = process.env.SEED_EMAIL || 'tenant.admin@triplec.local';
const PASSWORD = process.env.SEED_PASSWORD || '12345678';
const DATABASE = process.env.DATABASE_NAME_TENANT || 'nf_devco';
const APPLY = process.argv.slice(2).includes('--apply');

type AccountKind = 'acquisition' | 'amortisation' | 'fair_value';
const KIND: Record<AccountKind, { type: 'ASSET' | 'EXPENSE' | 'INCOME'; first: number }> = {
  acquisition: { type: 'ASSET', first: 1101 }, fair_value: { type: 'INCOME', first: 4101 }, amortisation: { type: 'EXPENSE', first: 5101 },
};
const kindOf = (name: string): AccountKind => (/fair value/i.test(name) ? 'fair_value' : /amortization/i.test(name) ? 'amortisation' : 'acquisition');

async function run() {
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!login.ok) throw new Error(`Login failed (${login.status}). Is the API running at ${API}?`);
  const body: any = await login.json();
  const token: string = body.access_token ?? body.data?.access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const call = async (method: string, path: string, payload?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method, body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-tenant-id': claims.tenantId, 'x-active-company-id': claims.companyId, 'x-workspace-scope': 'COMPANY' },
    });
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json, message: json?.error?.message ?? json?.message ?? text.slice(0, 200) };
  };
  console.log(`${APPLY ? 'APPLY' : 'READ-ONLY'} against ${API} (company ${claims.companyId})`);

  const chart = (await call('GET', '/gl-account?limit=1000')).json.data as any[];
  const byName = new Map<string, any>(chart.map((a) => [String(a.account_name).toLowerCase(), a]));
  const usedCodes = new Set<string>(chart.map((a) => String(a.account_code)));
  const anchor = chart.find((a) => a.account_code === '1050');
  if (!anchor) throw new Error('The chart has no account 1050 to take the business dimensions from.');

  // ---- accounts -------------------------------------------------------------------------------------------------------
  const wanted = [...new Set(FIXED_ASSET_ITEMS.flatMap((i) => [i.accounts.acquisition, i.accounts.result]).filter((x): x is string => !!x))];
  const next: Record<AccountKind, number> = { acquisition: KIND.acquisition.first, fair_value: KIND.fair_value.first, amortisation: KIND.amortisation.first };
  let accountsMade = 0;
  for (const name of wanted) {
    if (byName.has(name.toLowerCase())) { console.log(`GL "${name}": exists, left alone`); continue; }
    const kind = kindOf(name);
    while (usedCodes.has(String(next[kind]))) next[kind] += 1;
    const code = String(next[kind]++);
    usedCodes.add(code);
    if (!APPLY) { console.log(`GL ${code} "${name}" (${KIND[kind].type}): would be created`); continue; }
    const made = await call('POST', '/gl-account', { account_code: code, account_name: name, account_type: KIND[kind].type, nob_id: anchor.nob_id, lob_id: anchor.lob_id });
    if (made.status >= 300) { console.log(`GL "${name}": REFUSED ${made.status} ${made.message}`); continue; }
    accountsMade += 1; console.log(`GL ${code} "${name}": created`);
  }

  // ---- items ----------------------------------------------------------------------------------------------------------
  const db = await mysql.createConnection({ host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database: DATABASE });
  let category: string | null = null; const series = new Map<string, string>(); const present = new Set<string>();
  try {
    const [[cat]] = await db.query<RowDataPacket[][]>(`SELECT category_id FROM item_master WHERE item_code = 'ICAT-007-ITM-0002' AND company_id = ?`, [claims.companyId]) as unknown as [RowDataPacket[]];
    category = (cat as RowDataPacket | undefined)?.category_id ?? null;
    const [rows] = await db.query<RowDataPacket[]>(`SELECT code, id FROM no_series WHERE company_id = ? AND code IN ('ITEM_LOT','ITEM_SERIAL')`, [claims.companyId]);
    for (const r of rows) series.set(r.code, r.id);
    const [codes] = await db.query<RowDataPacket[]>(`SELECT item_code FROM item_master WHERE company_id = ? AND deleted_at IS NULL`, [claims.companyId]);
    for (const r of codes) present.add(r.item_code);
  } finally { await db.end(); }
  if (!category) console.log('Note: no breeding-asset category found on ICAT-007-ITM-0002; items are created without one.');

  let itemsMade = 0;
  for (const item of FIXED_ASSET_ITEMS) {
    if (present.has(item.item_code)) { console.log(`Item ${item.item_code}: exists, left alone`); continue; }
    const serial = item.tracking === 'INDIVIDUAL';
    if (!APPLY) { console.log(`Item ${item.item_code} (${serial ? 'serial' : 'lot'} tracked, ${item.classification}): would be created`); continue; }
    const made = await call('POST', '/item', {
      company_id: claims.companyId, nob_id: anchor.nob_id, lob_id: anchor.lob_id, item_code: item.item_code, item_name: item.item_code, item_type: 'LIVING_ASSET',
      ...(category ? { category_id: category } : {}), uom_primary: 'HEAD', valuation_method: 'BIO_ASSET', is_biological_asset: true,
      is_serial_tracked: serial, is_lot_tracked: !serial, tracking_series_id: series.get(serial ? 'ITEM_SERIAL' : 'ITEM_LOT'),
    });
    if (made.status >= 300) { console.log(`Item ${item.item_code}: REFUSED ${made.status} ${made.message}`); continue; }
    itemsMade += 1; console.log(`Item ${item.item_code}: created`);
  }
  console.log(`${APPLY ? 'Done' : 'Plan only'}: ${accountsMade} account(s), ${itemsMade} item(s) created. Costing terms are put on them by db-apply-item-terms.`);
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
