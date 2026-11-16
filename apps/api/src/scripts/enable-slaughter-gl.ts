/**
 * Switches on the slaughter Transfer Order's postings (BBP-1 S.10.1, built 13 Nov 2026): adds, for each company that has the accounts and lacks the mapping,
 *   BIO_SLAUGHTER_DISPATCH  Dr 170900 Inventory in Transit / Cr 170400 Weaners Inventory (the lot's own account replaces the credit where it has one)
 *   BIO_SLAUGHTER_DOA       Dr 610400 Mortality / Impairment Loss / Cr 170900 Inventory in Transit
 *   BIO_SLAUGHTER_SALE      Dr 120100 Trade Receivables / Cr 410100 Pig Sales Revenue
 *   BIO_SLAUGHTER_COGS      Dr 510100 Cost of Goods Sold - Finisher / Cr 170900 Inventory in Transit
 * The accounts are the ones the project chart already has; Finance may name others with --<type>=<debit>:<credit>. These mappings can't be created on the GL
 * Mapping screen (it offers Inventory Ledger types only). A Transfer Order refuses to dispatch until all four exist. Read-only by default; --verify writes inside
 * a transaction and rolls back; --apply commits. It only INSERTS.
 *
 *   pnpm nx run api:db-enable-slaughter-gl                  # print the plan
 *   pnpm nx run api:db-enable-slaughter-gl -- --verify
 *   pnpm nx run api:db-enable-slaughter-gl -- --apply
 *   --database=nf_other  another tenant database (default nf_devco)
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const DEFAULTS: Record<string, [string, string]> = {
  BIO_SLAUGHTER_DISPATCH: ['170900', '170400'],
  BIO_SLAUGHTER_DOA: ['610400', '170900'],
  BIO_SLAUGHTER_SALE: ['120100', '410100'],
  BIO_SLAUGHTER_COGS: ['510100', '170900'],
};

async function run() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f === '--verify' || f === '--apply');
  const database = flags.find((f) => f.startsWith('--database='))?.slice('--database='.length) || 'nf_devco';
  const pairs = { ...DEFAULTS };
  for (const f of flags) {
    const m = /^--(BIO_SLAUGHTER_[A-Z]+)=(\w+):(\w+)$/.exec(f);
    if (m && pairs[m[1]]) pairs[m[1]] = [m[2], m[3]];
  }
  const unknown = flags.filter((f) => f !== mode && !f.startsWith('--database=') && !/^--BIO_SLAUGHTER_[A-Z]+=\w+:\w+$/.test(f));
  if (unknown.length) throw new Error('Use --verify, --apply, --database=<name>, --BIO_SLAUGHTER_<X>=<debit>:<credit>, or no flags.');
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database,
  });
  try {
    await db.beginTransaction();
    const [companies] = await db.query<RowDataPacket[]>(`SELECT company_id, tenant_id, company_code FROM company_master WHERE deleted_at IS NULL`);
    const [codes] = await db.query<RowDataPacket[]>(`SELECT mapping_code FROM gl_mapping_master WHERE mapping_code LIKE 'GLMAP-%' FOR UPDATE`);
    let next = Math.max(0, ...codes.map((r) => Number(String(r.mapping_code).slice(7)) || 0)) + 1;
    const plan: Array<Record<string, unknown>> = [];
    for (const c of companies) {
      const accountOf = async (code: string) => {
        const [rows] = await db.query<RowDataPacket[]>(
          `SELECT gl_account_id, account_name, nob_id, lob_id FROM gl_account_master WHERE tenant_id = ? AND account_code = ? AND (company_id = ? OR company_id IS NULL)
            ORDER BY company_id IS NULL LIMIT 1`, [c.tenant_id, code, c.company_id]);
        return rows[0];
      };
      for (const [type, [drCode, crCode]] of Object.entries(pairs)) {
        const [have] = await db.query<RowDataPacket[]>(`SELECT mapping_id FROM gl_mapping_master WHERE company_id = ? AND transaction_type = ? AND deleted_at IS NULL`, [c.company_id, type]);
        if (have.length) { plan.push({ company: c.company_code, type, action: 'exists, left alone' }); continue; }
        const dr = await accountOf(drCode);
        const cr = await accountOf(crCode);
        if (!dr || !cr) { plan.push({ company: c.company_code, type, action: `skipped: no account ${!dr ? drCode : crCode}` }); continue; }
        const code = `GLMAP-${String(next++).padStart(3, '0')}`;
        plan.push({ company: c.company_code, type, action: 'insert', mapping_code: code, debit: `${drCode} ${dr.account_name}`, credit: `${crCode} ${cr.account_name}` });
        if (mode) {
          await db.execute(
            `INSERT INTO gl_mapping_master (mapping_id, tenant_id, company_id, mapping_code, nob_id, lob_id, transaction_type, debit_gl_account_id, credit_gl_account_id, is_active, status)
             VALUES (?,?,?,?,NULL,NULL,?,?,?,1,'ACTIVE')`,
            [randomUUID(), c.tenant_id, c.company_id, code, type, dr.gl_account_id, cr.gl_account_id]);
        }
      }
    }
    if (mode) {
      const [back] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM gl_mapping_master WHERE transaction_type LIKE 'BIO_SLAUGHTER_%' AND deleted_at IS NULL`);
      console.log(`Read back: ${back[0].n} BIO_SLAUGHTER_* mapping(s).`);
    }
    console.log(JSON.stringify({ database, mode: mode || 'READ-ONLY', plan }, null, 2));
    if (mode === '--apply') { await db.commit(); console.log('Committed.'); }
    else { await db.rollback(); console.log('Rolled back; no changes committed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
