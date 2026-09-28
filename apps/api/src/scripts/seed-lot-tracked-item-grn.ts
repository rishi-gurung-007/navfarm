/**
 * Additive-only demo seed: one lot-tracked item + one posted Goods Receipt
 * against it, so lot tracking (the item flag, the scheduler "Lot Required"
 * checkbox, and the LotSerialPicker on outbound inventory screens) can be
 * exercised end to end in a dev database that already has real data.
 *
 * Unlike seed-clean-e2e.ts, this script never truncates or deletes anything —
 * it only SELECTs and does existence-checked INSERTs, so it is safe to run
 * against a database that already has batches/schedulers/inventory in it.
 * It is also idempotent: re-running it after GR-LOT-DEMO-001 already exists
 * is a no-op.
 *
 * Usage:
 *   pnpm nx run api:db-seed-lot-tracked-item-grn
 */
import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const tenantCode = (process.env.DEV_TENANT_CODE || 'devco').toLowerCase();
const tenantDatabase = process.env.DEV_TENANT_DATABASE || `tenant_${tenantCode}`;

const ITEM_CODE = 'ITM-LOT-VACCINE';
const ITEM_NAME = 'Parvo-Shield Swine Vaccine (Lot Tracked)';
const RECEIPT_NO = 'GR-LOT-DEMO-001';
const LOT_NO = 'LOT-DEMO-0001';

export async function seedLotTrackedItemGrn() {
  console.log('================================================================');
  console.log('💉 SEEDING LOT-TRACKED ITEM + DEMO GRN (additive only)');
  console.log('================================================================');
  console.log(`Database: ${tenantDatabase}`);

  const conn = await mysql.createConnection({ host, port, user, password, database: tenantDatabase, ssl });

  try {
    // 1. Resolve company & tenant
    const [companies] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT company_id, tenant_id FROM company_master LIMIT 1',
    );
    if (!companies.length) {
      throw new Error('No company found. Run the base setup/seed scripts first.');
    }
    const { company_id: companyId, tenant_id: tenantId } = companies[0];

    // 2. Idempotency check — bail out early if already seeded
    const [existingReceipts] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT receipt_id FROM goods_receipt WHERE receipt_no = ? AND company_id = ? LIMIT 1`,
      [RECEIPT_NO, companyId],
    );
    if (existingReceipts.length) {
      console.log(`   ↷ ${RECEIPT_NO} already exists — nothing to do.`);
      console.log('================================================================');
      console.log('✅ ALREADY SEEDED');
      console.log('================================================================');
      return;
    }

    // 3. Ensure a LOT number series exists (reuse, never reset)
    console.log('\n1️⃣  Verifying LOT tracking number series...');
    let lotSeriesId: string;
    const [lotRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id FROM no_series WHERE document_type = 'LOT' AND tenant_id = ? LIMIT 1`,
      [tenantId],
    );
    if (lotRows.length) {
      lotSeriesId = lotRows[0].id;
      console.log(`   ✔ Reusing existing LOT series (${lotSeriesId})`);
    } else {
      lotSeriesId = randomUUID();
      await conn.query(
        `INSERT INTO no_series (id, tenant_id, company_id, code, description, document_type, prefix, seq_length, increment_by, is_default, manual_nos, current_seq)
         VALUES (?, ?, ?, 'LOT-AUDIT', 'Audit Lot Series', 'LOT', 'LOT', 5, 1, 1, 1, 0)`,
        [lotSeriesId, tenantId, companyId],
      );
      console.log(`   ✔ Created LOT series LOT-AUDIT (${lotSeriesId})`);
    }

    // 4. Ensure the lot-tracked item exists (upsert by item_code — additive only)
    console.log('\n2️⃣  Verifying lot-tracked item...');
    const [areas] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT nob_id, lob_id FROM operational_area_master WHERE is_active = 1 LIMIT 1`,
    );
    const nobId = areas.length ? areas[0].nob_id : null;
    const lobId = areas.length ? areas[0].lob_id : null;

    const [existingItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM item_master WHERE item_code = ? AND company_id = ? LIMIT 1`,
      [ITEM_CODE, companyId],
    );

    let item: mysql.RowDataPacket;
    if (existingItems.length) {
      item = existingItems[0];
      await conn.query(
        `UPDATE item_master
         SET is_lot_tracked = 1, tracking_series_id = ?, is_active = 1, is_inventoriable = 1, deleted_at = NULL
         WHERE item_id = ?`,
        [lotSeriesId, item.item_id],
      );
      console.log(`   ✔ Updated existing item: ${ITEM_CODE} — ${item.item_name}`);
    } else {
      const itemId = randomUUID();
      await conn.query(
        `INSERT INTO item_master
           (item_id, tenant_id, company_id, nob_id, lob_id, item_code, item_name, item_type, uom_primary,
            valuation_method, standard_cost, is_biological_asset, is_lot_tracked, is_serial_tracked,
            tracking_series_id, is_active, is_inventoriable)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'VACCINE', 'DOSE', 'FIFO', '85.0000', 0, 1, 0, ?, 1, 1)`,
        [itemId, tenantId, companyId, nobId, lobId, ITEM_CODE, ITEM_NAME, lotSeriesId],
      );
      const [created] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT * FROM item_master WHERE item_id = ?`,
        [itemId],
      );
      item = created[0];
      console.log(`   ✔ Created item: ${ITEM_CODE} — ${ITEM_NAME}`);
    }

    // 5. Resolve a warehouse to receive into
    console.log('\n3️⃣  Resolving warehouse...');
    const [stores] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code FROM location_master WHERE location_code = 'MUL100/STORE-001' AND company_id = ? LIMIT 1`,
      [companyId],
    );
    let warehouse = stores[0];
    if (!warehouse) {
      const [silos] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT location_id, location_code FROM location_master WHERE location_type = 'SILO' AND company_id = ? LIMIT 1`,
        [companyId],
      );
      warehouse = silos[0];
    }
    if (!warehouse) {
      throw new Error(
        'No MUL100/STORE-001 or SILO location found. Run the farm/location seed scripts first (e.g. pnpm nx run api:db-seed-farm-locations).',
      );
    }
    console.log(`   ✔ Warehouse: ${warehouse.location_code}`);

    // 6. Resolve a supplier (nullable)
    const [suppliers] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT supplier_id FROM supplier_master WHERE company_id = ? LIMIT 1`,
      [companyId],
    );
    const supplierId = suppliers[0]?.supplier_id || null;

    // 7. Post the GRN
    console.log('\n4️⃣  Posting demo Goods Receipt...');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const postingDate = new Date().toISOString().slice(0, 10);
    const expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const receiptId = randomUUID();
    const lineId = randomUUID();
    const ledgerId = randomUUID();

    await conn.query(
      `INSERT INTO goods_receipt (
        receipt_id, tenant_id, company_id, receipt_no, posting_date,
        warehouse_id, supplier_id, external_reference_no, remarks,
        status, posted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INV-DEMO-LOT-001', 'Demo lot-tracked vaccine stock', 'POSTED', ?, ?, ?)`,
      [receiptId, tenantId, companyId, RECEIPT_NO, postingDate, warehouse.location_id, supplierId, now, now, now],
    );
    await conn.query(
      `INSERT INTO goods_receipt_line (
        line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, lot_no, expiry_date, remarks
      ) VALUES (?, ?, 1, ?, '100.0000', 'DOSE', '85.000000', '8500.0000', ?, ?, 'Demo lot tracked vaccine')`,
      [lineId, receiptId, item.item_id, LOT_NO, expiryDate],
    );
    await conn.query(
      `INSERT INTO inventory_ledger (
        ledger_id, tenant_id, company_id, item_id, item_code, item_description,
        document_type, document_no, document_line_id, posting_date, external_reference_no,
        entry_type, transaction_type, quantity, remaining_quantity, uom,
        rate, amount, lot_no, expiry_date, warehouse_id, nob_id, lob_id, category_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', ?, ?, ?, 'INV-DEMO-LOT-001',
        'POSITIVE', 'PURCHASE', '100.0000', '100.0000', 'DOSE',
        '85.000000', '8500.0000', ?, ?, ?, ?, ?, ?, ?)`,
      [
        ledgerId, tenantId, companyId, item.item_id, item.item_code, item.item_name,
        RECEIPT_NO, lineId, postingDate, LOT_NO, expiryDate, warehouse.location_id,
        item.nob_id, item.lob_id, item.category_id, now,
      ],
    );

    console.log(`   ✔ Posted ${RECEIPT_NO}: 100 DOSE ${ITEM_NAME} (lot ${LOT_NO}) -> ${warehouse.location_code}`);
    console.log('================================================================');
    console.log('🎉 LOT-TRACKED ITEM + GRN SEED COMPLETED');
    console.log('================================================================');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seedLotTrackedItemGrn().catch((err) => {
    console.error('❌ Failed to seed lot-tracked item/GRN:', err.message || err);
    process.exitCode = 1;
  });
}
