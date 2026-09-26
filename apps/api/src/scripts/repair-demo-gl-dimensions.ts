/** Handoff §2 F1: repair only the audited demo company's seed-imposed pins.
 * Read-only by default; --verify writes and rolls back; --apply commits.
 * This is an existing-row repair explicitly requested by Rishi, not a seed.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

async function run() {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(f => !['--verify', '--apply'].includes(f))) throw new Error('Use --verify, --apply, or no flags.');
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '',
    database: 'nf_devco',
  });
  try {
    await db.beginTransaction();
    const [rows] = await db.query<RowDataPacket[]>(`SELECT m.*, c.category_name, s.stage_code
      FROM gl_mapping_master m LEFT JOIN item_category_master c ON c.category_id=m.item_category_id
      LEFT JOIN stage_master s ON s.stage_id=m.stage_id
      WHERE m.tenant_id='640b56a1-9d7a-4e82-88fb-f73010adf347'
      AND m.company_id='9e179da9-c177-4c75-b5ba-1267601b5957' FOR UPDATE`);
    if (rows.length !== 29 || new Set(rows.map(r => r.transaction_type)).size !== 29) throw new Error('Mapping set changed since audit; review before repairing.');
    const plan = rows.map(r => {
      if (r.valuation_method != null && r.valuation_method !== 'FIFO') throw new Error(`Unexpected valuation on ${r.mapping_id}`);
      if (r.item_category_id != null && (!['BATCH_CONSUMPTION','CONSUMPTION','BATCH_INPUT'].includes(r.transaction_type) || r.category_name !== 'Finished Swine Feeds & Diets')) throw new Error(`Unexpected category on ${r.mapping_id}`);
      if (r.stage_id != null && (!r.transaction_type.startsWith('BIO_') || r.stage_code !== 'GESTATION')) throw new Error(`Unexpected stage on ${r.mapping_id}`);
      return { mapping_id: r.mapping_id, transaction_type: r.transaction_type,
        before: { valuation_method: r.valuation_method, item_category_id: r.item_category_id, stage_id: r.stage_id },
        after: { valuation_method: null, item_category_id: null, stage_id: null } };
    }).filter(r => Object.values(r.before).some(v => v != null));
    console.log(JSON.stringify({ mode: flags[0] || 'READ-ONLY', plan }, null, 2));
    if (flags.length) for (const row of plan) {
      await db.execute('UPDATE gl_mapping_master SET valuation_method=NULL,item_category_id=NULL,stage_id=NULL WHERE mapping_id=?', [row.mapping_id]);
    }
    if (flags[0] === '--apply') { await db.commit(); console.log('Committed.'); }
    else { await db.rollback(); console.log('Rolled back; no changes committed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
