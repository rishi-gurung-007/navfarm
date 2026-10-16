/**
 * Seeds a human-readable PORTA feed-planning fixture around the records entered
 * on the device. This is test data for the local/server demo path, not a claim
 * that the workbook supplied real mill, silo, BIN, capacity, or stock values.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 * Farm-silo stock feeds the forecast; mill-bin stock feeds requisition shipment tests.
 */
import { randomUUID } from 'node:crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
const VERIFY_ROLLBACK = Symbol('seed-porta-feed-planning-data:verify-rollback');

const FEED_ITEMS = [
  { code: 'DG-001', silo: 'PDSD-02', previousSilo: 'POR100/PDS2/SILO-DG001', bin: 'PORTA-FEED-MILL/BIN-DG001', name: 'Dry Gilt Feed', siloCapacityKg: 5800, stockKg: 5000, binStockKg: 30000 },
  { code: 'DS-001', silo: 'POR100/PDS2/SILO-DS001', previousSilo: null, bin: 'PORTA-FEED-MILL/BIN-DS001', name: 'Dry Sow Feed', siloCapacityKg: 30000, stockKg: 30000, binStockKg: 30000 },
  { code: 'FEED-SF', silo: 'PFHLG-12', previousSilo: 'POR100/PFH1/SILO-SF001', bin: 'PORTA-FEED-MILL/BIN-SF001', name: 'Super Flush', siloCapacityKg: 5800, stockKg: 5000, binStockKg: 30000 },
] as const;

const SILO_TO_SHED = [
  ['PDSD-02', 'PDS2'],
  ['POR100/PDS2/SILO-DS001', 'PDS2'],
  ['PFHLG-12', 'PFH1'],
] as const;

function daysFromToday(count: number): string[] {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((arg) => !['--apply', '--verify'].includes(arg)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const write = apply || verify;
  const db = await mysql.createConnection({ host, port, user, password, database });

  try {
    await db.beginTransaction();
    const [[scope]] = await db.query<RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id
         FROM location_master
        WHERE location_code = 'POR100' AND company_id IS NOT NULL
        LIMIT 1`,
    );
    if (!scope) throw new Error('POR100 is missing — run the PORTA master seed first.');

    const [[actor]] = await db.query<RowDataPacket[]>(
      'SELECT user_id FROM user_master WHERE tenant_id = ? AND company_id = ? ORDER BY created_at LIMIT 1',
      [scope.tenant_id, scope.company_id],
    );
    const actorId = actor?.user_id ?? null;
    const [farmRows] = await db.query<RowDataPacket[]>(
      "SELECT location_id FROM location_master WHERE tenant_id = ? AND company_id = ? AND location_code = 'POR100' AND location_type = 'FARM' LIMIT 1",
      [scope.tenant_id, scope.company_id],
    );
    const farmId = farmRows[0]?.location_id as string | undefined;
    if (!farmId) throw new Error('Active POR100 farm is missing.');

    const locations = new Map<string, string>();
    locations.set('POR100', farmId);
    for (const code of ['PDS2', 'PFH1']) {
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT location_id FROM location_master WHERE tenant_id = ? AND company_id = ? AND location_code = ? AND location_type = \'SHED\' AND is_active = 1 LIMIT 1',
        [scope.tenant_id, scope.company_id, code],
      );
      if (!rows[0]) throw new Error(`Active PORTA shed ${code} is missing.`);
      locations.set(code, rows[0].location_id as string);
    }

    const ensureLocation = async (input: {
      code: string; name: string; type: 'MILL' | 'BIN' | 'SILO'; parentId: string | null;
      farmId: string | null; capacity?: number; feedType?: 'BULK' | 'BAGGED';
    }) => {
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT location_id FROM location_master WHERE tenant_id = ? AND company_id = ? AND location_code = ? LIMIT 1',
        [scope.tenant_id, scope.company_id, input.code],
      );
      const id = (rows[0]?.location_id as string | undefined) ?? randomUUID();
      if (write) {
        if (rows[0]) {
          await db.query(
            `UPDATE location_master SET location_name = ?, location_type = ?, parent_location_id = ?, farm_id = ?,
               is_active = 1, status = 'ACTIVE', storage_type = ?, silo_capacity_kg = ?, silo_capacity_uom = ?,
               feed_in_bags = ?, bin_capacity_kg = ?, bin_feed_type = ?, mill_daily_capacity_kg = ?,
               mill_bulk_daily_allocation_kg = ?, mill_bagged_daily_allocation_kg = ?, updated_at = NOW()
             WHERE location_id = ?`,
            [input.name, input.type, input.parentId, input.farmId, input.type,
              input.type === 'SILO' ? input.capacity ?? null : null, input.type === 'SILO' ? 'KG' : null,
              input.type === 'SILO' ? false : null, input.type === 'BIN' ? input.capacity ?? null : null,
              input.feedType ?? null, input.type === 'MILL' ? 90000 : null,
              input.type === 'MILL' ? 90000 : null, input.type === 'MILL' ? 0 : null, id],
          );
        } else {
          await db.query(
            `INSERT INTO location_master
               (location_id, tenant_id, company_id, nob_id, lob_id, farm_id, parent_location_id,
                location_code, location_name, location_level, location_type, storage_type, feed_in_bags,
                silo_capacity_kg, silo_capacity_uom, bin_capacity_kg, bin_feed_type, mill_daily_capacity_kg,
                mill_bulk_daily_allocation_kg, mill_bagged_daily_allocation_kg, is_active, status, created_by, updated_by,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?, NOW(), NOW())`,
            [id, scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, input.farmId, input.parentId,
              input.code, input.name, input.type === 'MILL' ? 1 : 2, input.type, input.type,
              input.type === 'SILO' ? false : null, input.type === 'SILO' ? input.capacity ?? null : null,
              input.type === 'SILO' ? 'KG' : null, input.type === 'BIN' ? input.capacity ?? null : null,
              input.feedType ?? null, input.type === 'MILL' ? 90000 : null, input.type === 'MILL' ? 90000 : null,
              input.type === 'MILL' ? 0 : null, actorId, actorId],
          );
        }
      }
      locations.set(input.code, id);
    };

    const millCode = 'PORTA-FEED-MILL';
    await ensureLocation({ code: millCode, name: 'PORTA Feed Mill (Test Fixture)', type: 'MILL', parentId: null, farmId: null });
    for (const item of FEED_ITEMS) {
      if (write && item.previousSilo) {
        const [oldRows] = await db.query<RowDataPacket[]>(
          'SELECT location_id FROM location_master WHERE tenant_id = ? AND company_id = ? AND location_code = ? LIMIT 1',
          [scope.tenant_id, scope.company_id, item.previousSilo],
        );
        const [newRows] = await db.query<RowDataPacket[]>(
          'SELECT location_id FROM location_master WHERE tenant_id = ? AND company_id = ? AND location_code = ? LIMIT 1',
          [scope.tenant_id, scope.company_id, item.silo],
        );
        if (oldRows[0] && !newRows[0]) {
          await db.query('UPDATE location_master SET location_code = ?, updated_at = NOW() WHERE location_id = ?', [item.silo, oldRows[0].location_id]);
        }
      }
      await ensureLocation({ code: item.silo, name: `${item.name} Silo (Test Fixture)`, type: 'SILO', parentId: farmId, farmId, capacity: item.siloCapacityKg, feedType: 'BULK' });
      await ensureLocation({ code: item.bin, name: `${item.name} Mill BIN (Test Fixture)`, type: 'BIN', parentId: locations.get(millCode)!, farmId: null, capacity: 30000, feedType: 'BULK' });
    }

    for (const [siloCode, shedCode] of SILO_TO_SHED) {
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT link_id FROM silo_shed_link WHERE tenant_id = ? AND company_id = ? AND silo_id = ? AND shed_id = ? LIMIT 1',
        [scope.tenant_id, scope.company_id, locations.get(siloCode), locations.get(shedCode)],
      );
      if (!existing.length && write) {
        await db.query(
          `INSERT INTO silo_shed_link (link_id, tenant_id, company_id, silo_id, shed_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [randomUUID(), scope.tenant_id, scope.company_id, locations.get(siloCode), locations.get(shedCode), actorId],
        );
      }
    }

    const [stages] = await db.query<RowDataPacket[]>(
      "SELECT stage_id, stage_code, company_id FROM stage_master WHERE tenant_id = ? AND (company_id = ? OR company_id IS NULL) AND stage_code IN ('GESTATION', 'LACTATION') AND is_active = 1",
      [scope.tenant_id, scope.company_id],
    );
    const stageIds = new Map<string, string>();
    for (const r of stages) {
      if (r.company_id || !stageIds.has(r.stage_code as string)) {
        stageIds.set(r.stage_code as string, r.stage_id as string);
      }
    }
    for (const code of ['GESTATION', 'LACTATION']) if (!stageIds.has(code)) throw new Error(`Stage ${code} is missing.`);
    if (write) {
      await db.query("UPDATE batch_header SET stage_id = ?, current_stage_code = 'GESTATION', updated_at = NOW() WHERE tenant_id = ? AND company_id = ? AND batch_no = 'BATCH-000001'", [stageIds.get('GESTATION'), scope.tenant_id, scope.company_id]);
      await db.query("UPDATE batch_header SET stage_id = ?, current_stage_code = 'LACTATION', updated_at = NOW() WHERE tenant_id = ? AND company_id = ? AND batch_no = 'BATCH-000002'", [stageIds.get('LACTATION'), scope.tenant_id, scope.company_id]);
    }

    const [items] = await db.query<RowDataPacket[]>(
      `SELECT item_id, item_code, item_name FROM item_master
        WHERE tenant_id = ? AND company_id = ? AND item_code IN ('DG-001', 'DS-001', 'FEED-SF')`,
      [scope.tenant_id, scope.company_id],
    );
    const itemIds = new Map(items.map((row) => [row.item_code as string, { id: row.item_id as string, name: row.item_name as string }]));
    for (const item of FEED_ITEMS) if (!itemIds.has(item.code)) throw new Error(`Feed item ${item.code} is missing.`);
    if (write) {
      for (const item of FEED_ITEMS) {
        await db.query("UPDATE item_master SET item_type = 'FEED', feed_form = 'BULK', uom_primary = 'KG', is_active = 1, status = 'ACTIVE', updated_at = NOW() WHERE tenant_id = ? AND company_id = ? AND item_code = ?", [scope.tenant_id, scope.company_id, item.code]);
      }
    }

    const [slotRows] = await db.query<RowDataPacket[]>(
      'SELECT slot_id FROM production_slot_master WHERE tenant_id = ? AND company_id = ? AND slot_code = \'PORTA-DAY\' LIMIT 1',
      [scope.tenant_id, scope.company_id],
    );
    const slotId = (slotRows[0]?.slot_id as string | undefined) ?? randomUUID();
    if (!slotRows.length && write) {
      await db.query(
        `INSERT INTO production_slot_master
           (slot_id, tenant_id, company_id, slot_code, slot_name, start_time, end_time, is_active, status, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, 'PORTA-DAY', 'PORTA Daily Production', '00:00:00', '23:59:59', 1, 'ACTIVE', ?, ?, NOW(), NOW())`,
        [slotId, scope.tenant_id, scope.company_id, actorId, actorId],
      );
    }

    const dates = daysFromToday(46);
    for (const item of FEED_ITEMS) {
      const binId = locations.get(item.bin)!;
      const itemId = itemIds.get(item.code)!.id;
      for (const date of dates) {
        if (write) {
          await db.query(
            `INSERT INTO bin_diet_assignment
               (assignment_id, tenant_id, company_id, bin_location_id, feed_item_id, production_date, production_slot_id,
                diet_priority, is_active, status, created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 'ACTIVE', ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE feed_item_id = VALUES(feed_item_id), is_active = 1, status = 'ACTIVE', updated_at = NOW()`,
            [randomUUID(), scope.tenant_id, scope.company_id, binId, itemId, date, slotId, actorId, actorId],
          );
        }
      }
      const documentNo = `PORTA-FEED-STOCK-${item.code}`;
      const [stock] = await db.query<RowDataPacket[]>(
        'SELECT ledger_id FROM inventory_ledger WHERE tenant_id = ? AND company_id = ? AND document_no = ? LIMIT 1',
        [scope.tenant_id, scope.company_id, documentNo],
      );
      if (!stock.length && write) {
        await db.query(
          `INSERT INTO inventory_ledger
             (ledger_id, tenant_id, company_id, item_id, item_code, item_description, document_type, document_no,
              posting_date, entry_type, transaction_type, quantity, remaining_quantity, uom, rate, amount,
              location_id, warehouse_id, nob_id, lob_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', ?, '2024-01-01', 'POSITIVE', 'PURCHASE',
                   ?, ?, 'KG', 0, 0, ?, ?, ?, ?, ?, NOW())`,
          [randomUUID(), scope.tenant_id, scope.company_id, itemId, item.code, item.name, documentNo,
            item.stockKg, item.stockKg, locations.get(item.silo), locations.get(item.silo), scope.nob_id, scope.lob_id, actorId],
        );
      } else if (write) {
        await db.query(
          'UPDATE inventory_ledger SET quantity = ?, remaining_quantity = ?, posting_date = ? WHERE tenant_id = ? AND company_id = ? AND document_no = ?',
          [item.stockKg, item.stockKg, '2024-01-01', scope.tenant_id, scope.company_id, documentNo],
        );
      }

      // The forecast consumes farm-silo stock, while requisition shipment consumes
      // mill-bin stock. Keep a separate idempotent bin top-up so a full seed can
      // exercise every requisition item without inventing a second item or silo.
      const binDocumentNo = `PORTA-FEED-BIN-STOCK-${item.code}`;
      const [[binBalance]] = await db.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(CASE WHEN entry_type IN ('POSITIVE', 'TRANSFER') THEN quantity ELSE -quantity END), 0) AS balance
           FROM inventory_ledger
          WHERE tenant_id = ? AND company_id = ? AND warehouse_id = ? AND item_id = ?`,
        [scope.tenant_id, scope.company_id, binId, itemId],
      );
      const binShortfall = Math.max(0, item.binStockKg - Number(binBalance?.balance || 0));
      if (write && binShortfall > 0) {
        const [[existingBinStock]] = await db.query<RowDataPacket[]>(
          'SELECT ledger_id FROM inventory_ledger WHERE tenant_id = ? AND company_id = ? AND document_no = ? LIMIT 1',
          [scope.tenant_id, scope.company_id, binDocumentNo],
        );
        if (existingBinStock) {
          await db.query(
            'UPDATE inventory_ledger SET quantity = quantity + ?, remaining_quantity = remaining_quantity + ?, posting_date = ? WHERE ledger_id = ?',
            [binShortfall, binShortfall, '2024-01-01', existingBinStock.ledger_id],
          );
        } else {
          await db.query(
            `INSERT INTO inventory_ledger
               (ledger_id, tenant_id, company_id, item_id, item_code, item_description, document_type, document_no,
                posting_date, entry_type, transaction_type, quantity, remaining_quantity, uom, rate, amount,
                location_id, warehouse_id, nob_id, lob_id, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', ?, '2024-01-01', 'POSITIVE', 'PURCHASE',
                     ?, ?, 'KG', 0, 0, ?, ?, ?, ?, ?, NOW())`,
            [randomUUID(), scope.tenant_id, scope.company_id, itemId, item.code, item.name, binDocumentNo,
              binShortfall, binShortfall, binId, binId, scope.nob_id, scope.lob_id, actorId],
          );
        }
      }
    }

    if (write) {
      await db.query(
        `INSERT INTO feed_planning_setting
           (setting_id, tenant_id, company_id, farm_id, default_forecast_days, max_forecast_days, production_weekday,
            truck_target_kg, bulk_multiple_kg, bag_size_kg, safety_stock_kg, is_active, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 7, 45, 0, 30000, 3000, 50, 0, 1, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE truck_target_kg = 30000, bulk_multiple_kg = 3000, bag_size_kg = 50, safety_stock_kg = 0,
           max_forecast_days = 45, is_active = 1, updated_at = NOW()`,
        [randomUUID(), scope.tenant_id, scope.company_id, farmId, actorId, actorId],
      );
    }

    console.log(JSON.stringify({
      database, mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      farm: 'POR100', batches: ['BATCH-000001 → PDS2 → GESTATION', 'BATCH-000002 → PFH1 → LACTATION'],
      silos: FEED_ITEMS.map((item) => item.silo), mill: millCode, bins: FEED_ITEMS.map((item) => item.bin),
      feedItems: FEED_ITEMS.map((item) => item.code), stockBySiloKg: Object.fromEntries(FEED_ITEMS.map((item) => [item.code, item.stockKg])), stockByBinKg: Object.fromEntries(FEED_ITEMS.map((item) => [item.code, item.binStockKg])), binAssignmentDays: dates.length,
    }, null, 2));
    if (verify) throw VERIFY_ROLLBACK;
    await db.commit();
    console.log(apply ? 'Committed.' : 'Read-only. No changes attempted.');
  } catch (error) {
    await db.rollback();
    if (error === VERIFY_ROLLBACK) console.log('Verified and rolled back. No changes committed.');
    else throw error;
  } finally {
    await db.end();
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
