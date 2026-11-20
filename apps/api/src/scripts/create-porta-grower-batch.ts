/**
 * Creates a Porta Farm commercial grower/finisher batch in nf_cccshow, matching the
 * existing Multiplier demo batch (BATCH-000012) in shape, so Porta has an eligible lot
 * for a Slaughter Transfer Order (BATCH-000012 is COUNT_ONLY/BATCH_WISE, not per-animal
 * registered — grower/finisher stock in this tenant is tracked by head count only).
 *
 *   pnpm nx run api:db-create-porta-grower-batch
 *   pnpm nx run api:db-create-porta-grower-batch -- --verify
 *   pnpm nx run api:db-create-porta-grower-batch -- --apply
 */
import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';

const MASTER_DB = process.env.DATABASE_NAME || 'nf_master';
const TENANT_CODE = process.env.SHOWCASE_TENANT_CODE || 'cccshow';
const HEAD_COUNT = Number(process.env.PORTA_GROWER_HEAD_COUNT || 187);
const BATCH_NO = process.env.PORTA_GROWER_BATCH_NO || 'BATCH-000014';
const SHED_CODE = process.env.PORTA_GROWER_SHED_CODE || 'PGH1';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (apply && verify) throw new Error('Use no flags (read-only), --verify, or --apply.');
  const write = apply || verify;

  const master = await mysql.createConnection({ host, port, user, password, database: MASTER_DB });
  const [[tenant]] = await master.query<mysql.RowDataPacket[]>(
    'SELECT tenant_id, db_name FROM tenant_master WHERE tenant_code = ? LIMIT 1',
    [TENANT_CODE],
  );
  await master.end();
  if (!tenant) throw new Error(`Tenant ${TENANT_CODE} is not registered.`);

  const db = await mysql.createConnection({ host, port, user, password, database: tenant.db_name as string });
  try {
    await db.beginTransaction();

    const [[existing]] = await db.query<mysql.RowDataPacket[]>(
      'SELECT batch_id FROM batch_header WHERE tenant_id = ? AND batch_no = ? LIMIT 1',
      [tenant.tenant_id, BATCH_NO],
    );
    if (existing) {
      console.log(JSON.stringify({ batchNo: BATCH_NO, action: 'already-exists', batchId: existing.batch_id }, null, 2));
      await db.rollback();
      return;
    }

    const [[template]] = await db.query<mysql.RowDataPacket[]>(
      `SELECT * FROM batch_header WHERE tenant_id = ? AND batch_no = 'BATCH-000012' LIMIT 1`,
      [tenant.tenant_id],
    );
    if (!template) throw new Error('Template batch BATCH-000012 (Multiplier grower) was not found.');

    const [[portaFarm]] = await db.query<mysql.RowDataPacket[]>(
      `SELECT location_id, company_id FROM location_master WHERE tenant_id = ? AND location_code = 'POR100' AND location_type = 'FARM' LIMIT 1`,
      [tenant.tenant_id],
    );
    if (!portaFarm) throw new Error('Porta farm (POR100) was not found.');

    const [[shed]] = await db.query<mysql.RowDataPacket[]>(
      `SELECT location_id FROM location_master WHERE tenant_id = ? AND location_code = ? AND location_type = 'SHED' LIMIT 1`,
      [tenant.tenant_id, SHED_CODE],
    );
    if (!shed) throw new Error(`Porta grower shed ${SHED_CODE} was not found.`);

    const [[growerItem]] = await db.query<mysql.RowDataPacket[]>(
      `SELECT item_id FROM item_master WHERE tenant_id = ? AND item_code = 'BIO-SWINE-GROWER' LIMIT 1`,
      [tenant.tenant_id],
    );
    if (!growerItem) throw new Error('BIO-SWINE-GROWER item was not found.');

    const batchId = randomUUID();
    const plan = {
      batchNo: BATCH_NO,
      batchId,
      farmId: portaFarm.location_id,
      shedId: shed.location_id,
      headCount: HEAD_COUNT,
      itemId: growerItem.item_id,
      action: 'insert',
    };
    console.log(JSON.stringify(plan, null, 2));

    if (write) {
      await db.query(
        `INSERT INTO batch_header
           (batch_id, tenant_id, company_id, batch_no, lob_id, nob_id, costing_method, breed_id,
            shed_id, location_id, start_date, expected_end_date, status, opening_quantity, uom,
            closing_quantity, current_stage_code, stage_id, operational_area_id, animal_tracking,
            farm_id, tracking_mode, is_litter_lot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-08-01', '2026-11-15', 'ACTIVE', ?, 'HEAD',
                 ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
        [
          batchId, tenant.tenant_id, portaFarm.company_id, BATCH_NO, template.lob_id, template.nob_id,
          template.costing_method, template.breed_id, shed.location_id, shed.location_id, HEAD_COUNT,
          HEAD_COUNT, template.current_stage_code, template.stage_id, template.operational_area_id,
          template.animal_tracking, portaFarm.location_id, template.tracking_mode,
        ],
      );
      await db.query(
        `INSERT INTO batch_bio_asset_state (state_id, batch_id, stage, current_quantity, nca_book_value, updated_at)
         VALUES (?, ?, 'PREMATURE', ?, 0, NOW())`,
        [randomUUID(), batchId, HEAD_COUNT],
      );
      await db.query(
        `INSERT INTO batch_input_line (line_id, batch_id, line_no, item_id, quantity, uom, rate)
         VALUES (?, ?, 1, ?, ?, 'HEAD', 0)`,
        [randomUUID(), batchId, growerItem.item_id, HEAD_COUNT],
      );
    }

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
