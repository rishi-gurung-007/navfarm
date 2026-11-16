/**
 * Switches on weaner and grower lot WIP (BBP-2 S.NO.6, decided 13 Nov 2026): adds the BIO_LOT_WIP GL mapping for each company that has the two accounts and
 * none yet, debit the WIP account (default 160400 WIP Weaners) where a lot's feed and overhead go during the month, credit the inventory account (default
 * 170400 Weaners Inventory) the month-end lot run recognises it into when the lot has no account of its own. The mapping can't be created on the GL Mapping
 * screen (it offers Inventory Ledger types only), hence this script. Read-only by default; --verify writes inside a transaction and rolls back; --apply
 * commits. It only INSERTS; a company that already has the mapping is left alone. A Grower stage can be given its own WIP account later by adding a mapping
 * row with that stage.
 *
 *   pnpm nx run api:db-enable-lot-wip-gl                     # print the plan
 *   pnpm nx run api:db-enable-lot-wip-gl -- --verify         # write, read back, roll back
 *   pnpm nx run api:db-enable-lot-wip-gl -- --apply          # commit
 *   --database=nf_other  another tenant database (default nf_devco)
 *   --wip=160400 --inventory=170400   other account codes
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

async function run() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f === '--verify' || f === '--apply');
  const opt = (name: string, dflt: string) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3) || dflt;
  const database = opt('database', 'nf_devco');
  const wipCode = opt('wip', '160400');
  const invCode = opt('inventory', '170400');
  const unknown = flags.filter((f) => f !== mode && !/^--(database|wip|inventory)=/.test(f));
  if (unknown.length) throw new Error('Use --verify, --apply, --database=<name>, --wip=<code>, --inventory=<code>, or no flags.');
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
      const [have] = await db.query<RowDataPacket[]>(
        `SELECT mapping_id FROM gl_mapping_master WHERE company_id = ? AND transaction_type = 'BIO_LOT_WIP' AND deleted_at IS NULL`, [c.company_id]);
      if (have.length) { plan.push({ company: c.company_code, action: 'exists, left alone' }); continue; }
      const accountOf = async (code: string) => {
        const [rows] = await db.query<RowDataPacket[]>(
          `SELECT gl_account_id, account_name, nob_id, lob_id FROM gl_account_master WHERE tenant_id = ? AND account_code = ? AND (company_id = ? OR company_id IS NULL)
            ORDER BY company_id IS NULL LIMIT 1`, [c.tenant_id, code, c.company_id]);
        return rows[0];
      };
      const wip = await accountOf(wipCode);
      const inv = await accountOf(invCode);
      if (!wip || !inv) { plan.push({ company: c.company_code, action: `skipped: no account ${!wip ? wipCode : invCode}` }); continue; }
      const row = {
        mapping_id: randomUUID(), tenant_id: c.tenant_id, company_id: c.company_id, mapping_code: `GLMAP-${String(next++).padStart(3, '0')}`,
        nob_id: wip.nob_id ?? null, lob_id: wip.lob_id ?? null, transaction_type: 'BIO_LOT_WIP', debit_gl_account_id: wip.gl_account_id, credit_gl_account_id: inv.gl_account_id,
      };
      plan.push({ company: c.company_code, action: 'insert', mapping_code: row.mapping_code, debit: `${wipCode} ${wip.account_name}`, credit: `${invCode} ${inv.account_name}` });
      if (mode) {
        await db.execute(
          `INSERT INTO gl_mapping_master (mapping_id, tenant_id, company_id, mapping_code, nob_id, lob_id, transaction_type, debit_gl_account_id, credit_gl_account_id, is_active, status)
           VALUES (?,?,?,?,?,?,?,?,?,1,'ACTIVE')`,
          [row.mapping_id, row.tenant_id, row.company_id, row.mapping_code, row.nob_id, row.lob_id, row.transaction_type, row.debit_gl_account_id, row.credit_gl_account_id]);
      }
    }
    if (mode) {
      const [back] = await db.query<RowDataPacket[]>(`SELECT company_id, mapping_code FROM gl_mapping_master WHERE transaction_type = 'BIO_LOT_WIP' AND deleted_at IS NULL`);
      console.log(`Read back: ${back.length} BIO_LOT_WIP mapping(s).`);
    }
    console.log(JSON.stringify({ database, mode: mode || 'READ-ONLY', plan }, null, 2));
    if (mode === '--apply') { await db.commit(); console.log('Committed.'); }
    else { await db.rollback(); console.log('Rolled back; no changes committed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
