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

export async function seedGrnReceipts() {
  console.log('================================================================');
  console.log('📦 SEEDING GOODS RECEIPTS (GRN) & INVENTORY LEDGER ENTRIES');
  console.log('================================================================');

  const conn = await mysql.createConnection({ host, port, user, password, database: tenantDatabase, ssl });

  try {
    // 1. Resolve company & tenant
    const [companies] = await conn.query<mysql.RowDataPacket[]>('SELECT company_id, tenant_id FROM company_master LIMIT 1');
    if (!companies.length) throw new Error('No company found.');
    const { company_id: companyId, tenant_id: tenantId } = companies[0];

    // 2. Resolve warehouses
    const [silos] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code FROM location_master WHERE location_type = 'SILO' AND company_id = ?`,
      [companyId]
    );
    const [stores] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id FROM location_master WHERE location_code = 'MUL100/STORE-001' AND company_id = ?`,
      [companyId]
    );
    const storeId = stores[0]?.location_id;
    if (!silos.length || !storeId) throw new Error('Required silo or store location not found.');

    // 3. Resolve supplier
    const [suppliers] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT supplier_id FROM supplier_master WHERE company_id = ? LIMIT 1`,
      [companyId]
    );
    const supplierId = suppliers[0]?.supplier_id || null;

    // 4. Resolve items
    const [feedItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM item_master WHERE item_code = 'ICAT-004-ITM-0004' AND company_id = ?`,
      [companyId]
    );
    const [vacItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM item_master WHERE item_code = 'ITM-LOT-VACCINE' AND company_id = ?`,
      [companyId]
    );
    const [tagItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM item_master WHERE item_code = 'ITM-SER-TAG' AND company_id = ?`,
      [companyId]
    );

    const feedItem = feedItems[0];
    const vacItem = vacItems[0];
    const tagItem = tagItems[0];

    if (!feedItem || !vacItem || !tagItem) throw new Error('One or more required test items not found.');

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const postingDate = '2026-09-28';

    // ── GR-000001+: Standard Feed (Silos) ──
    for (let sIdx = 0; sIdx < silos.length; sIdx++) {
      const silo = silos[sIdx];
      const gr1Id = randomUUID();
      const gr1LineId = randomUUID();
      const gr1LedgerId = randomUUID();
      const receiptNo = `GR-FEED-${String(sIdx + 1).padStart(4, '0')}`;
      await conn.query(
        `INSERT INTO goods_receipt (
          receipt_id, tenant_id, company_id, receipt_no, posting_date,
          warehouse_id, supplier_id, external_reference_no, remarks,
          status, posted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INV-2026-FEED', 'Initial Feed Silo Stock', 'POSTED', ?, ?, ?)`,
        [gr1Id, tenantId, companyId, receiptNo, postingDate, silo.location_id, supplierId, now, now, now]
      );
      await conn.query(
        `INSERT INTO goods_receipt_line (
          line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, remarks
        ) VALUES (?, ?, 1, ?, '5000.0000', 'KG', '35.000000', '175000.0000', 'Weaner Grower Mash stock')`,
        [gr1LineId, gr1Id, feedItem.item_id]
      );
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date, external_reference_no,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', ?, ?, ?, 'INV-2026-FEED',
          'POSITIVE', 'PURCHASE', '5000.0000', '5000.0000', 'KG',
          '35.000000', '175000.0000', ?, ?, ?, ?, ?)`,
        [
          gr1LedgerId, tenantId, companyId, feedItem.item_id, feedItem.item_code, feedItem.item_name,
          receiptNo, gr1LineId, postingDate, silo.location_id, feedItem.nob_id, feedItem.lob_id, feedItem.category_id, now
        ]
      );
      console.log(`   ✔ Seeded & Posted ${receiptNo}: 5,000 KG Feed -> ${silo.location_code}`);
    }

    // ── GR-FEED-STORE: Feed Mash Bags in Central Farm Store ──
    const grStoreId = randomUUID();
    const grStoreLineId = randomUUID();
    const grStoreLedgerId = randomUUID();
    await conn.query(
      `INSERT INTO goods_receipt (
        receipt_id, tenant_id, company_id, receipt_no, posting_date,
        warehouse_id, supplier_id, external_reference_no, remarks,
        status, posted_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'GR-FEED-STORE', ?, ?, ?, 'INV-2026-STORE-FEED', 'Farm Store Feed Mash Bags Stock', 'POSTED', ?, ?, ?)`,
      [grStoreId, tenantId, companyId, postingDate, storeId, supplierId, now, now, now]
    );
    await conn.query(
      `INSERT INTO goods_receipt_line (
        line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, remarks
      ) VALUES (?, ?, 1, ?, '5000.0000', 'KG', '35.000000', '175000.0000', 'Weaner Grower Mash in Bags')`,
      [grStoreLineId, grStoreId, feedItem.item_id]
    );
    await conn.query(
      `INSERT INTO inventory_ledger (
        ledger_id, tenant_id, company_id, item_id, item_code, item_description,
        document_type, document_no, document_line_id, posting_date, external_reference_no,
        entry_type, transaction_type, quantity, remaining_quantity, uom,
        rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-FEED-STORE', ?, ?, 'INV-2026-STORE-FEED',
        'POSITIVE', 'PURCHASE', '5000.0000', '5000.0000', 'KG',
        '35.000000', '175000.0000', ?, ?, ?, ?, ?)`,
      [
        grStoreLedgerId, tenantId, companyId, feedItem.item_id, feedItem.item_code, feedItem.item_name,
        grStoreLineId, postingDate, storeId, feedItem.nob_id, feedItem.lob_id, feedItem.category_id, now
      ]
    );
    console.log(`   ✔ Seeded & Posted GR-FEED-STORE: 5,000 KG Feed -> MUL100/STORE-001`);

    // ── GR-000002: Lot-Tracked Vaccine (Store) ──
    const gr2Id = randomUUID();
    const gr2LineId = randomUUID();
    const gr2LedgerId = randomUUID();
    await conn.query(
      `INSERT INTO goods_receipt (
        receipt_id, tenant_id, company_id, receipt_no, posting_date,
        warehouse_id, supplier_id, external_reference_no, remarks,
        status, posted_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'GR-000002', ?, ?, ?, 'INV-2026-MED-02', 'Parvo-Shield Vaccine Stock', 'POSTED', ?, ?, ?)`,
      [gr2Id, tenantId, companyId, postingDate, storeId, supplierId, now, now, now]
    );
    await conn.query(
      `INSERT INTO goods_receipt_line (
        line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, lot_no, expiry_date, remarks
      ) VALUES (?, ?, 1, ?, '100.0000', 'DOSE', '85.000000', '8500.0000', 'LOT-2026-X1', '2027-09-28', 'Lot Tracked Vaccine')`,
      [gr2LineId, gr2Id, vacItem.item_id]
    );
    await conn.query(
      `INSERT INTO inventory_ledger (
        ledger_id, tenant_id, company_id, item_id, item_code, item_description,
        document_type, document_no, document_line_id, posting_date, external_reference_no,
        entry_type, transaction_type, quantity, remaining_quantity, uom,
        rate, amount, lot_no, expiry_date, warehouse_id, nob_id, lob_id, category_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-000002', ?, ?, 'INV-2026-MED-02',
        'POSITIVE', 'PURCHASE', '100.0000', '100.0000', 'DOSE',
        '85.000000', '8500.0000', 'LOT-2026-X1', '2027-09-28', ?, ?, ?, ?, ?)`,
      [
        gr2LedgerId, tenantId, companyId, vacItem.item_id, vacItem.item_code, vacItem.item_name,
        gr2LineId, postingDate, storeId, vacItem.nob_id, vacItem.lob_id, vacItem.category_id, now
      ]
    );
    console.log('   ✔ Seeded & Posted GR-000002: 100 DOSE Vaccine (LOT-2026-X1) -> MUL100/STORE-001');

    // ── GR-000003: Serial-Tracked RFID Tags (Store) ──
    const gr3Id = randomUUID();
    await conn.query(
      `INSERT INTO goods_receipt (
        receipt_id, tenant_id, company_id, receipt_no, posting_date,
        warehouse_id, supplier_id, external_reference_no, remarks,
        status, posted_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'GR-000003', ?, ?, ?, 'INV-2026-TAG-03', 'RFID Ear Tag Stock', 'POSTED', ?, ?, ?)`,
      [gr3Id, tenantId, companyId, postingDate, storeId, supplierId, now, now, now]
    );

    const serials = ['SER-2026-0001', 'SER-2026-0002', 'SER-2026-0003', 'SER-2026-0004', 'SER-2026-0005'];
    for (let i = 0; i < serials.length; i++) {
      const lineId = randomUUID();
      const ledgerId = randomUUID();
      const sn = serials[i];
      await conn.query(
        `INSERT INTO goods_receipt_line (
          line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, serial_no, remarks
        ) VALUES (?, ?, ?, ?, '1.0000', 'PCS', '2.500000', '2.5000', ?, 'Serial tracked tag')`,
        [lineId, gr3Id, i + 1, tagItem.item_id, sn]
      );
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date, external_reference_no,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, serial_no, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-000003', ?, ?, 'INV-2026-TAG-03',
          'POSITIVE', 'PURCHASE', '1.0000', '1.0000', 'PCS',
          '2.500000', '2.5000', ?, ?, ?, ?, ?, ?)`,
        [
          ledgerId, tenantId, companyId, tagItem.item_id, tagItem.item_code, tagItem.item_name,
          lineId, postingDate, sn, storeId, tagItem.nob_id, tagItem.lob_id, tagItem.category_id, now
        ]
      );
    }
    console.log('   ✔ Seeded & Posted GR-000003: 5 PCS RFID Ear Tags (SER-2026-0001..0005) -> MUL100/STORE-001');

    console.log('================================================================');
    console.log('🎉 INVENTORY GOODS RECEIPTS SEED COMPLETED!');
    console.log('================================================================');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seedGrnReceipts().catch((err) => {
    console.error('❌ Failed to seed GRNs:', err.message || err);
    process.exitCode = 1;
  });
}
