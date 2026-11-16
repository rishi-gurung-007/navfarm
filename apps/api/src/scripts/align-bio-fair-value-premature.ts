/**
 * Adds the BIO_FAIR_VALUE_PREMATURE GL mapping to a tenant that already has BIO_FAIR_VALUE mappings (bio-asset
 * costing Phase 1, fix X3). Read-only by default; --verify writes inside a transaction and rolls back; --apply commits.
 * Refuses nothing it did not plan: it only INSERTS, one row per BIO_FAIR_VALUE scope that lacks a pre-mature twin.
 *
 *   pnpm nx run api:db-align-bio-fair-value-premature                  # print the plan
 *   pnpm nx run api:db-align-bio-fair-value-premature -- --verify      # write, read back, roll back
 *   pnpm nx run api:db-align-bio-fair-value-premature -- --apply       # commit
 *   add --database=nf_other to point at another tenant database (default nf_devco)
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { MappingRow, planPrematureFairValue } from './align-bio-fair-value-premature.lib';

async function run() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f === '--verify' || f === '--apply');
  const database = flags.find((f) => f.startsWith('--database='))?.slice('--database='.length) || 'nf_devco';
  const unknown = flags.filter((f) => f !== mode && !f.startsWith('--database='));
  if (unknown.length) throw new Error('Use --verify, --apply, --database=<name>, or no flags.');
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database,
  });
  try {
    await db.beginTransaction();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM gl_mapping_master WHERE transaction_type IN ('BIO_FAIR_VALUE','BIO_TRANSFORMATION','BIO_FAIR_VALUE_PREMATURE')
        AND is_active = 1 AND deleted_at IS NULL FOR UPDATE`);
    const plan = planPrematureFairValue(rows as unknown as MappingRow[]);
    const [codes] = await db.query<RowDataPacket[]>(`SELECT mapping_code FROM gl_mapping_master WHERE mapping_code LIKE 'GLMAP-%'`);
    let next = Math.max(0, ...codes.map((r) => Number(String(r.mapping_code).slice(7)) || 0)) + 1;
    console.log(JSON.stringify({ database, mode: mode || 'READ-ONLY', plan }, null, 2));
    if (mode) {
      for (const m of plan.inserts) {
        await db.execute(
          `INSERT INTO gl_mapping_master (mapping_id, tenant_id, company_id, mapping_code, item_category_id, nob_id, lob_id, stage_id,
             valuation_method, transaction_type, debit_gl_account_id, credit_gl_account_id, is_active, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'ACTIVE')`,
          [randomUUID(), m.tenant_id, m.company_id, `GLMAP-${String(next++).padStart(3, '0')}`, m.item_category_id, m.nob_id, m.lob_id,
            m.stage_id, m.valuation_method, m.transaction_type, m.debit_gl_account_id, m.credit_gl_account_id]);
      }
    }
    if (mode === '--apply') { await db.commit(); console.log('Committed.'); }
    else { await db.rollback(); console.log('Rolled back; no changes committed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
