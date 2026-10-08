/**
 * Comprehensive Inventory Ledger Seed for Triple C (Zimbabwe Piggery).
 * 
 * Demonstrates the full lifecycle of inventory ledger & application entries:
 * 1. Multi-layer Goods Receipts (PURCHASE / POSITIVE) with lot/serial tracking and remaining_quantity.
 * 2. Overhead and Descriptive ledger entries (freight / handling charges without physical quantity).
 * 3. Exact FIFO Consumptions (CONSUMPTION / NEGATIVE) for Batches, decrementing layer remaining_quantity
 *    and recording exact inventory_application rows (linking application_id, inbound_ledger_id,
 *    outbound_ledger_id, applied_qty, applied_cost_amount, unit_cost).
 * 4. Multi-layer FIFO splitting when consumption spans across two purchase layers.
 * 5. Internal Stock Transfers (TRANSFER_SHIPMENT negative + TRANSFER_RECEIPT positive).
 * 6. Stock Count Variance / Adjustment (VARIANCE_NEGATIVE).
 *
 * Conforms to AGENTS.md rule 4:
 * - Read-only by default (prints plan).
 * - --verify: runs inside a database transaction and rolls back.
 * - --apply: commits the database transaction.
 *
 * Usage:
 *   node --env-file-if-exists=.env --import tsx src/scripts/seed-inventory-ledger-comprehensive.ts
 *   node --env-file-if-exists=.env --import tsx src/scripts/seed-inventory-ledger-comprehensive.ts --verify
 *   node --env-file-if-exists=.env --import tsx src/scripts/seed-inventory-ledger-comprehensive.ts --apply
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

const DB = process.env.TENANT_DB_NAME || 'nf_devco';

interface SeedLedgerRow {
  ledger_id: string;
  tenant_id: string;
  company_id: string;
  item_id: string | null;
  item_code: string;
  item_description: string;
  document_type: string;
  document_no: string;
  posting_date: string;
  external_reference_no?: string | null;
  entry_type: 'POSITIVE' | 'NEGATIVE' | 'TRANSFER' | 'OVERHEAD' | 'DESCRIPTIVE';
  transaction_type: 'PURCHASE' | 'CONSUMPTION' | 'TRANSFER_SHIPMENT' | 'TRANSFER_RECEIPT' | 'VARIANCE_NEGATIVE';
  quantity: number;
  remaining_quantity?: number | null;
  uom: string;
  rate?: number | null;
  amount?: number | null;
  lot_no?: string | null;
  serial_no?: string | null;
  expiry_date?: string | null;
  batch_no?: string | null;
  warehouse_id?: string | null;
  location_id?: string | null;
  nob_id?: string | null;
  lob_id?: string | null;
  category_id?: string | null;
}

interface SeedApplicationRow {
  application_id: string;
  tenant_id: string;
  company_id: string;
  item_id: string;
  inbound_ledger_id: string;
  outbound_ledger_id: string;
  applied_qty: number;
  applied_cost_amount: number;
  application_date: string;
}

export async function main() {
  const mode = process.argv[2] || 'READ_ONLY';
  if (!['READ_ONLY', '--verify', '--apply'].includes(mode)) {
    throw new Error('Use no flags (read-only plan), --verify (rolled back), or --apply (commit).');
  }

  console.log('================================================================');
  console.log('📦 TRIPLE C COMPREHENSIVE INVENTORY LEDGER SEED');
  console.log('================================================================');
  console.log(`Database: ${DB}`);
  console.log(`Mode:     ${mode}`);

  const conn = await mysql.createConnection({ host, port, user, password, database: DB, ssl });

  try {
    // 1. Resolve Company & Tenant
    const [companies] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT company_id, tenant_id FROM company_master LIMIT 1',
    );
    if (!companies.length) throw new Error('No company found in tenant database.');
    const { company_id: companyId, tenant_id: tenantId } = companies[0];

    // 2. Resolve Locations (Silos and Stores)
    const [locations] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code, location_name, location_type FROM location_master
       WHERE location_code IN ('GRA100/SILO-002', 'GRA100/STORE-001', 'MUL100/STORE-001')`,
    );
    const locMap = new Map<string, string>();
    for (const l of locations) {
      locMap.set(l.location_code, l.location_id);
    }

    const graSilo = locMap.get('GRA100/SILO-002') || locations[0]?.location_id;
    const graStore = locMap.get('GRA100/STORE-001') || locations[0]?.location_id;
    const mulStore = locMap.get('MUL100/STORE-001') || locations[0]?.location_id;

    // 3. Resolve Items
    const [items] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT item_id, item_code, item_name, uom_primary, category_id, nob_id, lob_id
       FROM item_master
       WHERE item_code IN (
         'ICAT-004-ITM-0002', /* Dry Sow Gestation Mash */
         'ICAT-006-ITM-0001', /* Parvo-Shield L5 Swine Vaccine */
         'ICAT-005-ITM-0001', /* Iron Dextran Injection */
         'ICAT-004-ITM-0001', /* Creep Feed Pre-Starter */
         'ITM-SER-TAG'        /* RFID Ear Tags */
       )`,
    );
    const itemMap = new Map<string, mysql.RowDataPacket>();
    for (const itm of items) {
      itemMap.set(itm.item_code, itm);
    }

    const itmSowFeed = itemMap.get('ICAT-004-ITM-0002');
    const itmVaccine = itemMap.get('ICAT-006-ITM-0001');
    const itmIron = itemMap.get('ICAT-005-ITM-0001');
    const itmCreepFeed = itemMap.get('ICAT-004-ITM-0001');
    const itmTags = itemMap.get('ITM-SER-TAG');

    if (!itmSowFeed) {
      throw new Error("Required demo item 'ICAT-004-ITM-0002' not found. Run base seeds first.");
    }

    // 4. Check if demo documents already exist
    const [existingDocs] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT DISTINCT document_no FROM inventory_ledger WHERE document_no LIKE 'GRN-2026-F%'`,
    );
    if (existingDocs.length > 0) {
      console.log(`\nDemo documents (GRN-2026-F*) already present in ${DB}. Nothing to seed.`);
      console.log('================================================================');
      return;
    }

    const ledgerRows: SeedLedgerRow[] = [];
    const applicationRows: SeedApplicationRow[] = [];
    let appSeq = 0;
    const nextAppId = () => {
      appSeq++;
      return `APP-${String(appSeq).padStart(5, '0')}`;
    };

    // ========================================================================
    // ITEM 1: DRY SOW GESTATION MASH (ICAT-004-ITM-0002) - FIFO multi-layer feed
    // ========================================================================
    const sowLayer1Id = randomUUID();
    const sowLayer2Id = randomUUID();
    const sowLayer3Id = randomUUID();
    const sowTransferInId = randomUUID();

    // Purchase Layer 1: 10,000 KG @ $28.00 at GRA100/SILO-002
    // Consumption 1 consumes 6,000 KG; Consumption 2 consumes 4,000 KG -> Remaining: 0 KG!
    ledgerRows.push({
      ledger_id: sowLayer1Id,
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      item_code: itmSowFeed.item_code,
      item_description: itmSowFeed.item_name,
      document_type: 'GOODS_RECEIPT',
      document_no: 'GRN-2026-F001',
      posting_date: '2026-08-01',
      external_reference_no: 'SUP-INV-8812',
      entry_type: 'POSITIVE',
      transaction_type: 'PURCHASE',
      quantity: 10000,
      remaining_quantity: 0, // Fully consumed via FIFO
      uom: itmSowFeed.uom_primary || 'KG',
      rate: 28.0,
      amount: 280000,
      warehouse_id: graSilo,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });

    // Descriptive Overhead for Layer 1 (Freight & Delivery)
    ledgerRows.push({
      ledger_id: randomUUID(),
      tenant_id: tenantId,
      company_id: companyId,
      item_id: null,
      item_code: 'OVERHEAD-FREIGHT',
      item_description: 'Bulk Grain Haulage & Freight (Harare to Grasmere)',
      document_type: 'GOODS_RECEIPT',
      document_no: 'GRN-2026-F001',
      posting_date: '2026-08-01',
      external_reference_no: 'FREIGHT-INV-104',
      entry_type: 'OVERHEAD',
      transaction_type: 'PURCHASE',
      quantity: 0,
      remaining_quantity: null,
      uom: 'EACH',
      rate: 350.0,
      amount: 350.0,
      warehouse_id: graSilo,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });

    // Purchase Layer 2: 15,000 KG @ $29.50 at GRA100/SILO-002
    // Consumption 2 consumes 3,000 KG; Transfer consumes 2,000 KG; Adj consumes 50 KG -> Remaining: 9,950 KG!
    ledgerRows.push({
      ledger_id: sowLayer2Id,
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      item_code: itmSowFeed.item_code,
      item_description: itmSowFeed.item_name,
      document_type: 'GOODS_RECEIPT',
      document_no: 'GRN-2026-F002',
      posting_date: '2026-08-15',
      external_reference_no: 'SUP-INV-8950',
      entry_type: 'POSITIVE',
      transaction_type: 'PURCHASE',
      quantity: 15000,
      remaining_quantity: 9950,
      uom: itmSowFeed.uom_primary || 'KG',
      rate: 29.5,
      amount: 442500,
      warehouse_id: graSilo,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });

    // Purchase Layer 3: 20,000 KG @ $30.00 at GRA100/SILO-002 (Untouched layer)
    ledgerRows.push({
      ledger_id: sowLayer3Id,
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      item_code: itmSowFeed.item_code,
      item_description: itmSowFeed.item_name,
      document_type: 'GOODS_RECEIPT',
      document_no: 'GRN-2026-F003',
      posting_date: '2026-09-01',
      external_reference_no: 'SUP-INV-9120',
      entry_type: 'POSITIVE',
      transaction_type: 'PURCHASE',
      quantity: 20000,
      remaining_quantity: 20000,
      uom: itmSowFeed.uom_primary || 'KG',
      rate: 30.0,
      amount: 600000,
      warehouse_id: graSilo,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });

    // Outbound 1: Batch Feeding (6,000 KG from Layer 1 @ $28.00)
    const sowOut1Id = randomUUID();
    ledgerRows.push({
      ledger_id: sowOut1Id,
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      item_code: itmSowFeed.item_code,
      item_description: itmSowFeed.item_name,
      document_type: 'DAILY_ENTRY',
      document_no: 'FEED-LOG-2026-001',
      posting_date: '2026-08-10',
      entry_type: 'NEGATIVE',
      transaction_type: 'CONSUMPTION',
      quantity: -6000,
      remaining_quantity: null,
      uom: itmSowFeed.uom_primary || 'KG',
      rate: 28.0,
      amount: -168000,
      batch_no: 'BATCH-000001',
      warehouse_id: graSilo,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });
    applicationRows.push({
      application_id: nextAppId(),
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      inbound_ledger_id: sowLayer1Id,
      outbound_ledger_id: sowOut1Id,
      applied_qty: 6000,
      applied_cost_amount: 168000,
      application_date: '2026-08-10',
    });

    // Outbound 2: Batch Feeding spanning 2 layers!
    // Total 7,000 KG: 4,000 KG from Layer 1 (@ $28.00) + 3,000 KG from Layer 2 (@ $29.50)
    const sowOut2Id = randomUUID();
    const blendedRate2 = (4000 * 28.0 + 3000 * 29.5) / 7000; // ~28.642857
    ledgerRows.push({
      ledger_id: sowOut2Id,
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      item_code: itmSowFeed.item_code,
      item_description: itmSowFeed.item_name,
      document_type: 'DAILY_ENTRY',
      document_no: 'FEED-LOG-2026-002',
      posting_date: '2026-08-20',
      entry_type: 'NEGATIVE',
      transaction_type: 'CONSUMPTION',
      quantity: -7000,
      remaining_quantity: null,
      uom: itmSowFeed.uom_primary || 'KG',
      rate: blendedRate2,
      amount: -(4000 * 28.0 + 3000 * 29.5),
      batch_no: 'BATCH-000001',
      warehouse_id: graSilo,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });
    // App 2a: 4,000 KG from Layer 1
    applicationRows.push({
      application_id: nextAppId(),
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      inbound_ledger_id: sowLayer1Id,
      outbound_ledger_id: sowOut2Id,
      applied_qty: 4000,
      applied_cost_amount: 112000,
      application_date: '2026-08-20',
    });
    // App 2b: 3,000 KG from Layer 2
    applicationRows.push({
      application_id: nextAppId(),
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      inbound_ledger_id: sowLayer2Id,
      outbound_ledger_id: sowOut2Id,
      applied_qty: 3000,
      applied_cost_amount: 88500,
      application_date: '2026-08-20',
    });

    // Outbound 3: Stock Transfer from GRA100 Silo to MUL100 Store (2,000 KG from Layer 2)
    const sowTransferOutId = randomUUID();
    ledgerRows.push({
      ledger_id: sowTransferOutId,
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      item_code: itmSowFeed.item_code,
      item_description: itmSowFeed.item_name,
      document_type: 'TRANSFER',
      document_no: 'TRF-2026-0001',
      posting_date: '2026-08-25',
      entry_type: 'NEGATIVE',
      transaction_type: 'TRANSFER_SHIPMENT',
      quantity: -2000,
      remaining_quantity: null,
      uom: itmSowFeed.uom_primary || 'KG',
      rate: 29.5,
      amount: -59000,
      warehouse_id: graSilo,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });
    applicationRows.push({
      application_id: nextAppId(),
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      inbound_ledger_id: sowLayer2Id,
      outbound_ledger_id: sowTransferOutId,
      applied_qty: 2000,
      applied_cost_amount: 59000,
      application_date: '2026-08-25',
    });

    // Inbound Transfer Receipt at MUL100/STORE-001 (creates a new layer at destination warehouse)
    ledgerRows.push({
      ledger_id: sowTransferInId,
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      item_code: itmSowFeed.item_code,
      item_description: itmSowFeed.item_name,
      document_type: 'TRANSFER',
      document_no: 'TRF-2026-0001',
      posting_date: '2026-08-25',
      entry_type: 'POSITIVE',
      transaction_type: 'TRANSFER_RECEIPT',
      quantity: 2000,
      remaining_quantity: 2000,
      uom: itmSowFeed.uom_primary || 'KG',
      rate: 29.5,
      amount: 59000,
      warehouse_id: mulStore,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });

    // Outbound 4: Physical Count Adjustment (-50 KG spillage from Layer 2 @ $29.50)
    const sowAdjId = randomUUID();
    ledgerRows.push({
      ledger_id: sowAdjId,
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      item_code: itmSowFeed.item_code,
      item_description: itmSowFeed.item_name,
      document_type: 'ADJUSTMENT',
      document_no: 'ADJ-2026-001',
      posting_date: '2026-09-05',
      entry_type: 'NEGATIVE',
      transaction_type: 'VARIANCE_NEGATIVE',
      quantity: -50,
      remaining_quantity: null,
      uom: itmSowFeed.uom_primary || 'KG',
      rate: 29.5,
      amount: -1475,
      warehouse_id: graSilo,
      nob_id: itmSowFeed.nob_id,
      lob_id: itmSowFeed.lob_id,
      category_id: itmSowFeed.category_id,
    });
    applicationRows.push({
      application_id: nextAppId(),
      tenant_id: tenantId,
      company_id: companyId,
      item_id: itmSowFeed.item_id,
      inbound_ledger_id: sowLayer2Id,
      outbound_ledger_id: sowAdjId,
      applied_qty: 50,
      applied_cost_amount: 1475,
      application_date: '2026-09-05',
    });

    // ========================================================================
    // ITEM 2: PARVO-SHIELD VACCINE (ICAT-006-ITM-0001) - Lot/Expiry Tracked
    // ========================================================================
    if (itmVaccine) {
      const vacLayer1Id = randomUUID();
      const vacLayer2Id = randomUUID();

      // Inbound Layer 1: 200 Doses @ $85.00
      // Outbound 1 consumes 150; Outbound 2 consumes 50 -> Remaining: 0 Doses!
      ledgerRows.push({
        ledger_id: vacLayer1Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmVaccine.item_id,
        item_code: itmVaccine.item_code,
        item_description: itmVaccine.item_name,
        document_type: 'GOODS_RECEIPT',
        document_no: 'GRN-2026-V001',
        posting_date: '2026-07-10',
        external_reference_no: 'VET-INV-3011',
        entry_type: 'POSITIVE',
        transaction_type: 'PURCHASE',
        quantity: 200,
        remaining_quantity: 0,
        uom: itmVaccine.uom_primary || 'DOSE',
        rate: 85.0,
        amount: 17000,
        lot_no: 'LOT-PS-2026A',
        expiry_date: '2027-06-30',
        warehouse_id: graStore,
        nob_id: itmVaccine.nob_id,
        lob_id: itmVaccine.lob_id,
        category_id: itmVaccine.category_id,
      });

      // Inbound Layer 2: 300 Doses @ $90.00
      // Outbound 2 consumes 50 -> Remaining: 250 Doses!
      ledgerRows.push({
        ledger_id: vacLayer2Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmVaccine.item_id,
        item_code: itmVaccine.item_code,
        item_description: itmVaccine.item_name,
        document_type: 'GOODS_RECEIPT',
        document_no: 'GRN-2026-V002',
        posting_date: '2026-08-15',
        external_reference_no: 'VET-INV-3140',
        entry_type: 'POSITIVE',
        transaction_type: 'PURCHASE',
        quantity: 300,
        remaining_quantity: 250,
        uom: itmVaccine.uom_primary || 'DOSE',
        rate: 90.0,
        amount: 27000,
        lot_no: 'LOT-PS-2026B',
        expiry_date: '2027-08-31',
        warehouse_id: graStore,
        nob_id: itmVaccine.nob_id,
        lob_id: itmVaccine.lob_id,
        category_id: itmVaccine.category_id,
      });

      // Outbound 1: 150 Doses sow vaccination from Layer 1
      const vacOut1Id = randomUUID();
      ledgerRows.push({
        ledger_id: vacOut1Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmVaccine.item_id,
        item_code: itmVaccine.item_code,
        item_description: itmVaccine.item_name,
        document_type: 'DAILY_ENTRY',
        document_no: 'MED-VACC-2026-001',
        posting_date: '2026-08-01',
        entry_type: 'NEGATIVE',
        transaction_type: 'CONSUMPTION',
        quantity: -150,
        remaining_quantity: null,
        uom: itmVaccine.uom_primary || 'DOSE',
        rate: 85.0,
        amount: -12750,
        lot_no: 'LOT-PS-2026A',
        batch_no: 'BATCH-000001',
        warehouse_id: graStore,
        nob_id: itmVaccine.nob_id,
        lob_id: itmVaccine.lob_id,
        category_id: itmVaccine.category_id,
      });
      applicationRows.push({
        application_id: nextAppId(),
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmVaccine.item_id,
        inbound_ledger_id: vacLayer1Id,
        outbound_ledger_id: vacOut1Id,
        applied_qty: 150,
        applied_cost_amount: 12750,
        application_date: '2026-08-01',
      });

      // Outbound 2: 100 Doses gilt vaccination spanning Layer 1 (50 Doses) and Layer 2 (50 Doses)
      const vacOut2Id = randomUUID();
      const blendedVacRate = (50 * 85.0 + 50 * 90.0) / 100; // 87.5
      ledgerRows.push({
        ledger_id: vacOut2Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmVaccine.item_id,
        item_code: itmVaccine.item_code,
        item_description: itmVaccine.item_name,
        document_type: 'DAILY_ENTRY',
        document_no: 'MED-VACC-2026-002',
        posting_date: '2026-08-25',
        entry_type: 'NEGATIVE',
        transaction_type: 'CONSUMPTION',
        quantity: -100,
        remaining_quantity: null,
        uom: itmVaccine.uom_primary || 'DOSE',
        rate: blendedVacRate,
        amount: -8750,
        lot_no: 'LOT-PS-2026A',
        batch_no: 'BATCH-000002',
        warehouse_id: graStore,
        nob_id: itmVaccine.nob_id,
        lob_id: itmVaccine.lob_id,
        category_id: itmVaccine.category_id,
      });
      applicationRows.push({
        application_id: nextAppId(),
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmVaccine.item_id,
        inbound_ledger_id: vacLayer1Id,
        outbound_ledger_id: vacOut2Id,
        applied_qty: 50,
        applied_cost_amount: 4250,
        application_date: '2026-08-25',
      });
      applicationRows.push({
        application_id: nextAppId(),
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmVaccine.item_id,
        inbound_ledger_id: vacLayer2Id,
        outbound_ledger_id: vacOut2Id,
        applied_qty: 50,
        applied_cost_amount: 4500,
        application_date: '2026-08-25',
      });
    }

    // ========================================================================
    // ITEM 3: IRON DEXTRAN 100ML INJECTION (ICAT-005-ITM-0001) - VIALS
    // ========================================================================
    if (itmIron) {
      const ironLayer1Id = randomUUID();
      const ironLayer2Id = randomUUID();

      // Layer 1: 100 VIALS @ $180.00
      ledgerRows.push({
        ledger_id: ironLayer1Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmIron.item_id,
        item_code: itmIron.item_code,
        item_description: itmIron.item_name,
        document_type: 'GOODS_RECEIPT',
        document_no: 'GRN-2026-M001',
        posting_date: '2026-08-05',
        external_reference_no: 'VET-IRON-101',
        entry_type: 'POSITIVE',
        transaction_type: 'PURCHASE',
        quantity: 100,
        remaining_quantity: 40,
        uom: itmIron.uom_primary || 'VIAL',
        rate: 180.0,
        amount: 18000,
        lot_no: 'LOT-FE-2026-01',
        expiry_date: '2028-02-28',
        warehouse_id: mulStore,
        nob_id: itmIron.nob_id,
        lob_id: itmIron.lob_id,
        category_id: itmIron.category_id,
      });

      // Layer 2: 150 VIALS @ $185.00
      ledgerRows.push({
        ledger_id: ironLayer2Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmIron.item_id,
        item_code: itmIron.item_code,
        item_description: itmIron.item_name,
        document_type: 'GOODS_RECEIPT',
        document_no: 'GRN-2026-M002',
        posting_date: '2026-09-01',
        external_reference_no: 'VET-IRON-109',
        entry_type: 'POSITIVE',
        transaction_type: 'PURCHASE',
        quantity: 150,
        remaining_quantity: 150,
        uom: itmIron.uom_primary || 'VIAL',
        rate: 185.0,
        amount: 27750,
        lot_no: 'LOT-FE-2026-02',
        expiry_date: '2028-06-30',
        warehouse_id: mulStore,
        nob_id: itmIron.nob_id,
        lob_id: itmIron.lob_id,
        category_id: itmIron.category_id,
      });

      // Outbound: Piglet Iron Injection (60 VIALS from Layer 1)
      const ironOutId = randomUUID();
      ledgerRows.push({
        ledger_id: ironOutId,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmIron.item_id,
        item_code: itmIron.item_code,
        item_description: itmIron.item_name,
        document_type: 'DAILY_ENTRY',
        document_no: 'PIGLET-IRON-2026-01',
        posting_date: '2026-08-20',
        entry_type: 'NEGATIVE',
        transaction_type: 'CONSUMPTION',
        quantity: -60,
        remaining_quantity: null,
        uom: itmIron.uom_primary || 'VIAL',
        rate: 180.0,
        amount: -10800,
        lot_no: 'LOT-FE-2026-01',
        batch_no: 'BATCH-000003',
        warehouse_id: mulStore,
        nob_id: itmIron.nob_id,
        lob_id: itmIron.lob_id,
        category_id: itmIron.category_id,
      });
      applicationRows.push({
        application_id: nextAppId(),
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmIron.item_id,
        inbound_ledger_id: ironLayer1Id,
        outbound_ledger_id: ironOutId,
        applied_qty: 60,
        applied_cost_amount: 10800,
        application_date: '2026-08-20',
      });
    }

    // ========================================================================
    // ITEM 4: CREEP FEED PRE-STARTER (ICAT-004-ITM-0001) - KG
    // ========================================================================
    if (itmCreepFeed) {
      const creepLayer1Id = randomUUID();
      const creepLayer2Id = randomUUID();

      // Layer 1: 5,000 KG @ $55.00
      ledgerRows.push({
        ledger_id: creepLayer1Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmCreepFeed.item_id,
        item_code: itmCreepFeed.item_code,
        item_description: itmCreepFeed.item_name,
        document_type: 'GOODS_RECEIPT',
        document_no: 'GRN-2026-C001',
        posting_date: '2026-08-10',
        external_reference_no: 'FEED-INV-501',
        entry_type: 'POSITIVE',
        transaction_type: 'PURCHASE',
        quantity: 5000,
        remaining_quantity: 1500,
        uom: itmCreepFeed.uom_primary || 'KG',
        rate: 55.0,
        amount: 275000,
        warehouse_id: graStore,
        nob_id: itmCreepFeed.nob_id,
        lob_id: itmCreepFeed.lob_id,
        category_id: itmCreepFeed.category_id,
      });

      // Layer 2: 8,000 KG @ $57.50
      ledgerRows.push({
        ledger_id: creepLayer2Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmCreepFeed.item_id,
        item_code: itmCreepFeed.item_code,
        item_description: itmCreepFeed.item_name,
        document_type: 'GOODS_RECEIPT',
        document_no: 'GRN-2026-C002',
        posting_date: '2026-09-05',
        external_reference_no: 'FEED-INV-589',
        entry_type: 'POSITIVE',
        transaction_type: 'PURCHASE',
        quantity: 8000,
        remaining_quantity: 8000,
        uom: itmCreepFeed.uom_primary || 'KG',
        rate: 57.5,
        amount: 460000,
        warehouse_id: graStore,
        nob_id: itmCreepFeed.nob_id,
        lob_id: itmCreepFeed.lob_id,
        category_id: itmCreepFeed.category_id,
      });

      // Outbound: Weaner Batch Feeding (3,500 KG from Layer 1)
      const creepOutId = randomUUID();
      ledgerRows.push({
        ledger_id: creepOutId,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmCreepFeed.item_id,
        item_code: itmCreepFeed.item_code,
        item_description: itmCreepFeed.item_name,
        document_type: 'DAILY_ENTRY',
        document_no: 'CREEP-FEED-2026-01',
        posting_date: '2026-08-28',
        entry_type: 'NEGATIVE',
        transaction_type: 'CONSUMPTION',
        quantity: -3500,
        remaining_quantity: null,
        uom: itmCreepFeed.uom_primary || 'KG',
        rate: 55.0,
        amount: -192500,
        batch_no: 'BATCH-000003',
        warehouse_id: graStore,
        nob_id: itmCreepFeed.nob_id,
        lob_id: itmCreepFeed.lob_id,
        category_id: itmCreepFeed.category_id,
      });
      applicationRows.push({
        application_id: nextAppId(),
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmCreepFeed.item_id,
        inbound_ledger_id: creepLayer1Id,
        outbound_ledger_id: creepOutId,
        applied_qty: 3500,
        applied_cost_amount: 192500,
        application_date: '2026-08-28',
      });
    }

    // ========================================================================
    // ITEM 5: RFID SWINE EAR TAGS (ITM-SER-TAG) - Serial Tracked Aggregated GRN
    // ========================================================================
    if (itmTags) {
      const tagLayer1Id = randomUUID();
      // Single aggregated GRN entry for 100 Ear Tags
      ledgerRows.push({
        ledger_id: tagLayer1Id,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmTags.item_id,
        item_code: itmTags.item_code,
        item_description: itmTags.item_name,
        document_type: 'GOODS_RECEIPT',
        document_no: 'GRN-2026-TAG-001',
        posting_date: '2026-08-01',
        external_reference_no: 'TAG-PO-7721',
        entry_type: 'POSITIVE',
        transaction_type: 'PURCHASE',
        quantity: 100,
        remaining_quantity: 95,
        uom: itmTags.uom_primary || 'TAG',
        rate: 12.5,
        amount: 1250,
        serial_no: 'SN-TAG-0001...SN-TAG-0100',
        warehouse_id: graStore,
        nob_id: itmTags.nob_id,
        lob_id: itmTags.lob_id,
        category_id: itmTags.category_id,
      });

      // Outbound tagging of 5 animals in BATCH-000002
      const tagOutId = randomUUID();
      ledgerRows.push({
        ledger_id: tagOutId,
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmTags.item_id,
        item_code: itmTags.item_code,
        item_description: itmTags.item_name,
        document_type: 'DAILY_ENTRY',
        document_no: 'TAG-ISSUE-2026-01',
        posting_date: '2026-08-15',
        entry_type: 'NEGATIVE',
        transaction_type: 'CONSUMPTION',
        quantity: -5,
        remaining_quantity: null,
        uom: itmTags.uom_primary || 'TAG',
        rate: 12.5,
        amount: -62.5,
        serial_no: 'SN-TAG-0001,SN-TAG-0002,SN-TAG-0003,SN-TAG-0004,SN-TAG-0005',
        batch_no: 'BATCH-000002',
        warehouse_id: graStore,
        nob_id: itmTags.nob_id,
        lob_id: itmTags.lob_id,
        category_id: itmTags.category_id,
      });
      applicationRows.push({
        application_id: nextAppId(),
        tenant_id: tenantId,
        company_id: companyId,
        item_id: itmTags.item_id,
        inbound_ledger_id: tagLayer1Id,
        outbound_ledger_id: tagOutId,
        applied_qty: 5,
        applied_cost_amount: 62.5,
        application_date: '2026-08-15',
      });
    }

    console.log(`\nPlanned Inventory Ledger Rows:     ${ledgerRows.length}`);
    console.log(`Planned Inventory Application Rows: ${applicationRows.length}`);

    // Print breakdown
    console.log('\n--- BREAKDOWN BY TRANSACTION TYPE ---');
    const txBreakdown = ledgerRows.reduce((acc, r) => {
      acc[r.transaction_type] = (acc[r.transaction_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    for (const [tx, count] of Object.entries(txBreakdown)) {
      console.log(`  * ${tx.padEnd(20)}: ${count} rows`);
    }

    console.log('\n--- BREAKDOWN BY ITEM ---');
    const itemBreakdown = ledgerRows.reduce((acc, r) => {
      acc[r.item_code] = (acc[r.item_code] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    for (const [code, count] of Object.entries(itemBreakdown)) {
      console.log(`  * ${code.padEnd(20)}: ${count} ledger entries`);
    }

    if (mode === 'READ_ONLY') {
      console.log('\n[READ-ONLY PLAN] Run with --verify or --apply to execute.');
      console.log('================================================================');
      return;
    }

    // Execute within transaction
    await conn.beginTransaction();

    // 1. Insert Inventory Ledger Rows
    const ledgerSql = `
      INSERT INTO inventory_ledger (
        ledger_id, tenant_id, company_id, item_id, item_code, item_description,
        document_type, document_no, posting_date, external_reference_no,
        entry_type, transaction_type, quantity, remaining_quantity, uom,
        rate, amount, lot_no, serial_no, expiry_date, batch_no,
        warehouse_id, nob_id, lob_id, category_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    for (const r of ledgerRows) {
      await conn.execute(ledgerSql, [
        r.ledger_id,
        r.tenant_id,
        r.company_id,
        r.item_id,
        r.item_code,
        r.item_description,
        r.document_type,
        r.document_no,
        r.posting_date,
        r.external_reference_no ?? null,
        r.entry_type,
        r.transaction_type,
        r.quantity,
        r.remaining_quantity ?? null,
        r.uom,
        r.rate ?? null,
        r.amount ?? null,
        r.lot_no ?? null,
        r.serial_no ?? null,
        r.expiry_date ?? null,
        r.batch_no ?? null,
        r.warehouse_id ?? null,
        r.nob_id ?? null,
        r.lob_id ?? null,
        r.category_id ?? null,
      ]);
    }

    // 2. Insert Inventory Application Rows
    const appSql = `
      INSERT INTO inventory_application (
        application_id, tenant_id, company_id, item_id,
        inbound_ledger_id, outbound_ledger_id, applied_qty, applied_cost_amount,
        application_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    for (const a of applicationRows) {
      await conn.execute(appSql, [
        a.application_id,
        a.tenant_id,
        a.company_id,
        a.item_id,
        a.inbound_ledger_id,
        a.outbound_ledger_id,
        a.applied_qty,
        a.applied_cost_amount,
        a.application_date,
      ]);
    }

    // Ensure no_series current_seq matches
    if (appSeq > 0) {
      await conn.execute(
        `UPDATE no_series SET current_seq = GREATEST(current_seq, ?), updated_at = NOW() WHERE code = 'ITEM_APPLICATION'`,
        [appSeq],
      );
    }

    if (mode === '--verify') {
      await conn.rollback();
      console.log('\n[--verify] Rolled back transaction. Database remains untouched.');
      console.log('================================================================');
      return;
    }

    if (mode === '--apply') {
      await conn.commit();
      console.log('\n[--apply] COMMITTED successfully to database!');
      console.log(`  ✔ Inserted ${ledgerRows.length} inventory ledger rows`);
      console.log(`  ✔ Inserted ${applicationRows.length} inventory application rows`);
      console.log('================================================================');
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during seed execution:', err);
    process.exit(1);
  });
}
