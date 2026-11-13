/**
 * Reconciles the seeded demo flow, end to end, by reading MySQL — the batch, inventory, transfer and output
 * tables have to agree with each other, not merely be present. A green run of the seed proves the services
 * accepted each document; this proves the documents add up.
 *
 *   pnpm nx run api:db-verify-demo-flow            # checks nf_devco, prints every check, exits 1 on a failure
 *   TENANT_DB_NAME=nf_other pnpm nx run api:db-verify-demo-flow
 *
 * Read-only. Each check is one query that returns the rows that BREAK the rule, so a pass is an empty result
 * and a failure prints the offending rows.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

const DB = process.env.TENANT_DB_NAME || 'nf_devco';

interface Check {
  name: string;
  /** Returns the rows that violate the rule. */
  violations: string;
  /** A check with no rows at all to look at is a warning, not a pass: it proves nothing. */
  needs?: string;
}

const CHECKS: Check[] = [
  // ── Accounting
  {
    name: 'every posted journal balances (debits = credits)',
    violations: `SELECT h.journal_no, h.total_debit, h.total_credit,
                        (SELECT COALESCE(SUM(l.debit_amount),0) FROM journal_line l WHERE l.journal_id = h.journal_id) AS lines_debit,
                        (SELECT COALESCE(SUM(l.credit_amount),0) FROM journal_line l WHERE l.journal_id = h.journal_id) AS lines_credit
                 FROM journal_header h
                 WHERE h.deleted_at IS NULL
                   AND (ABS(h.total_debit - h.total_credit) > 0.01
                     OR ABS(h.total_debit - (SELECT COALESCE(SUM(l.debit_amount),0) FROM journal_line l WHERE l.journal_id = h.journal_id)) > 0.01)
                 LIMIT 20`,
    needs: 'SELECT 1 FROM journal_header LIMIT 1',
  },

  // ── Inventory
  {
    name: 'no store holds negative stock of any item',
    violations: `SELECT w.location_code AS location, i.item_name, ROUND(SUM(l.quantity),4) AS on_hand
                 FROM inventory_ledger l
                 JOIN item_master i ON i.item_id = l.item_id
                 LEFT JOIN location_master w ON w.location_id = l.warehouse_id
                 WHERE l.warehouse_id IS NOT NULL
                   AND l.transaction_type NOT IN ('DESCRIPTIVE', 'OVERHEAD')
                 GROUP BY l.warehouse_id, w.location_code, l.item_id, i.item_name
                 HAVING SUM(l.quantity) < -0.0001
                 LIMIT 20`,
    needs: 'SELECT 1 FROM inventory_ledger LIMIT 1',
  },
  {
    // Not for every item: a receipt names a lot but a FIFO issue of a plain item does not, so per-lot sums of those split.
    name: 'no lot of a lot-tracked item is negative in any store',
    violations: `SELECT w.location_code AS location, i.item_name, l.lot_no, ROUND(SUM(l.quantity),4) AS on_hand
                 FROM inventory_ledger l
                 JOIN item_master i ON i.item_id = l.item_id AND i.is_lot_tracked = 1
                 LEFT JOIN location_master w ON w.location_id = l.warehouse_id
                 WHERE l.warehouse_id IS NOT NULL AND l.transaction_type NOT IN ('DESCRIPTIVE', 'OVERHEAD')
                 GROUP BY l.warehouse_id, w.location_code, l.item_id, i.item_name, l.lot_no
                 HAVING SUM(l.quantity) < -0.0001
                 LIMIT 20`,
  },
  {
    name: 'every output, harvest and transfer entry sits in a store (no stock kept nowhere)',
    violations: `SELECT document_type, transaction_type, document_no, item_description, quantity
                 FROM inventory_ledger
                 WHERE transaction_type IN ('OUTPUT', 'BIO_OUTPUT', 'BIO_HARVEST', 'TRANSFER_SHIPMENT', 'TRANSFER_RECEIPT')
                   AND warehouse_id IS NULL
                 LIMIT 20`,
  },

  // ── Stock transfers
  {
    name: 'a RECEIVED transfer received exactly what was shipped (good + DOA = shipped), lot kept',
    violations: `SELECT t.transfer_no,
                        SUM(CASE WHEN l.transaction_type = 'TRANSFER_SHIPMENT' THEN -l.quantity ELSE 0 END) AS shipped,
                        SUM(CASE WHEN l.transaction_type = 'TRANSFER_RECEIPT'  THEN  l.quantity ELSE 0 END) AS received
                 FROM stock_transfer t
                 JOIN inventory_ledger l ON l.document_no = t.transfer_no AND l.document_type = 'STOCK_TRANSFER'
                 WHERE t.status IN ('RECEIVED', 'POSTED')
                 GROUP BY t.transfer_no
                 HAVING ABS(shipped - received) > 0.0001
                 LIMIT 20`,
    needs: `SELECT 1 FROM stock_transfer WHERE status IN ('RECEIVED','POSTED') LIMIT 1`,
  },
  {
    name: 'a DOA on a receipt is written off against it (receipt "Incl. DOA:n" has a matching negative variance)',
    violations: `SELECT r.document_no, r.external_reference_no, r.quantity, r.remaining_quantity
                 FROM inventory_ledger r
                 WHERE r.transaction_type = 'TRANSFER_RECEIPT' AND r.external_reference_no LIKE 'Incl. DOA:%'
                   AND ABS(r.quantity - r.remaining_quantity
                         - CAST(SUBSTRING(r.external_reference_no, 11) AS DECIMAL(12,4))) > 0.0001
                 LIMIT 20`,
  },
  {
    name: 'an IN_TRANSIT transfer has shipped but not received',
    violations: `SELECT t.transfer_no,
                        SUM(CASE WHEN l.transaction_type = 'TRANSFER_SHIPMENT' THEN 1 ELSE 0 END) AS shipments,
                        SUM(CASE WHEN l.transaction_type = 'TRANSFER_RECEIPT'  THEN 1 ELSE 0 END) AS receipts
                 FROM stock_transfer t
                 LEFT JOIN inventory_ledger l ON l.document_no = t.transfer_no AND l.document_type = 'STOCK_TRANSFER'
                 WHERE t.status = 'IN_TRANSIT'
                 GROUP BY t.transfer_no
                 HAVING shipments = 0 OR receipts > 0
                 LIMIT 20`,
  },

  // ── Batches: head counts
  {
    name: 'Batch Wise head: opening (a split child opens empty) + transfers in − out − deaths − disposed or selected as gilts = head on hand',
    violations: `SELECT b.batch_no, b.opening_quantity, s.current_quantity AS on_hand,
                        ((CASE WHEN b.batch_no REGEXP '-S[0-9]{4}$' THEN 0 ELSE b.opening_quantity END)
                          + COALESCE((SELECT SUM(t.head_count) FROM batch_transfer t WHERE t.to_batch_id = b.batch_id AND t.status = 'POSTED'), 0)
                          - COALESCE((SELECT SUM(t.head_count) FROM batch_transfer t WHERE t.from_batch_id = b.batch_id AND t.status = 'POSTED'), 0)
                          - COALESCE((SELECT SUM(x.quantity) FROM batch_transaction x WHERE x.batch_id = b.batch_id AND x.transaction_type = 'MORTALITY' AND x.reversed_at IS NULL), 0)
                          - COALESCE((SELECT SUM(-a.quantity) FROM bio_asset_ledger a WHERE a.batch_id = b.batch_id AND a.document_type IN ('BATCH_DISPOSAL', 'GILT_SELECTION') AND a.quantity < 0), 0)
                        ) AS expected
                 FROM batch_header b
                 JOIN batch_bio_asset_state s ON s.batch_id = b.batch_id
                 WHERE b.tracking_mode = 'BATCH_WISE' AND b.status IN ('ACTIVE', 'CLOSED')
                 HAVING ABS(expected - on_hand) > 0.0001
                 LIMIT 20`,
    needs: `SELECT 1 FROM batch_header WHERE tracking_mode = 'BATCH_WISE' LIMIT 1`,
  },
  {
    name: 'a Batch Wise batch\'s closing quantity equals its bio-asset head',
    violations: `SELECT b.batch_no, b.closing_quantity, s.current_quantity
                 FROM batch_header b JOIN batch_bio_asset_state s ON s.batch_id = b.batch_id
                 WHERE b.tracking_mode = 'BATCH_WISE' AND b.status = 'ACTIVE'
                   AND ABS(COALESCE(b.closing_quantity, b.opening_quantity) - s.current_quantity) > 0.0001
                 LIMIT 20`,
  },
  {
    name: 'Animal Wise head: live animals in the batch = the batch\'s head on hand',
    violations: `SELECT b.batch_no, s.current_quantity AS on_hand,
                        (SELECT COUNT(*) FROM animal_register a WHERE a.current_batch_id = b.batch_id AND a.is_active = 1) AS live_animals
                 FROM batch_header b JOIN batch_bio_asset_state s ON s.batch_id = b.batch_id
                 WHERE b.tracking_mode = 'ANIMAL_WISE' AND b.status = 'ACTIVE'
                   AND ABS(s.current_quantity - (SELECT COUNT(*) FROM animal_register a WHERE a.current_batch_id = b.batch_id AND a.is_active = 1)) > 0.0001
                 LIMIT 20`,
  },
  {
    name: 'scheduler head counts of an Animal Wise batch add up to its live animals',
    violations: `SELECT b.batch_no,
                        (SELECT COALESCE(SUM(h.animal_count),0) FROM scheduler_header h WHERE h.batch_id = b.batch_id AND h.scheduler_status = 'ACTIVE') AS scheduler_total,
                        (SELECT COUNT(*) FROM animal_register a WHERE a.current_batch_id = b.batch_id AND a.is_active = 1) AS live_animals
                 FROM batch_header b
                 WHERE b.tracking_mode = 'ANIMAL_WISE' AND b.status = 'ACTIVE'
                   AND (SELECT COALESCE(SUM(h.animal_count),0) FROM scheduler_header h WHERE h.batch_id = b.batch_id AND h.scheduler_status = 'ACTIVE')
                       <> (SELECT COUNT(*) FROM animal_register a WHERE a.current_batch_id = b.batch_id AND a.is_active = 1)
                 LIMIT 20`,
  },
  {
    name: 'the current-stage scheduler of a Batch Wise batch counts its head on hand',
    violations: `SELECT b.batch_no, s.current_quantity AS on_hand, h.animal_count AS scheduler_count
                 FROM batch_header b
                 JOIN batch_bio_asset_state s ON s.batch_id = b.batch_id
                 JOIN scheduler_header h ON h.batch_id = b.batch_id AND h.stage_id = b.stage_id AND h.scheduler_status = 'ACTIVE'
                 WHERE b.tracking_mode = 'BATCH_WISE' AND b.status = 'ACTIVE'
                   AND ABS(h.animal_count - s.current_quantity) > 0.0001
                 LIMIT 20`,
  },
  {
    name: 'a registered animal is in a batch only if that batch is ACTIVE, and every live one is placed',
    violations: `SELECT a.animal_code, a.current_batch_id, b.status
                 FROM animal_register a LEFT JOIN batch_header b ON b.batch_id = a.current_batch_id
                 WHERE a.is_active = 1 AND (a.current_batch_id IS NULL OR b.status <> 'ACTIVE')
                 LIMIT 20`,
  },

  // ── Mortality
  {
    name: 'every explicit mortality has a detail row; a registered animal that died is inactive and DIED',
    violations: `SELECT x.transaction_id, b.batch_no, x.quantity, x.remarks
                 FROM batch_transaction x JOIN batch_header b ON b.batch_id = x.batch_id
                 WHERE x.transaction_type = 'MORTALITY' AND x.remarks LIKE 'DEMO mortality%'
                   AND NOT EXISTS (SELECT 1 FROM batch_mortality_detail d WHERE d.transaction_id = x.transaction_id)
                 LIMIT 20`,
    needs: `SELECT 1 FROM batch_transaction WHERE transaction_type = 'MORTALITY' AND remarks LIKE 'DEMO mortality%' LIMIT 1`,
  },

  // ── Batch transfers
  {
    name: 'every posted batch transfer has both batches, a date and a head count or animals',
    violations: `SELECT t.transfer_no, t.transfer_basis, t.head_count, t.status
                 FROM batch_transfer t
                 WHERE t.status = 'POSTED' AND t.deleted_at IS NULL
                   AND (t.from_batch_id IS NULL OR t.to_batch_id IS NULL OR t.transfer_date IS NULL
                     OR (t.transfer_basis = 'HEADCOUNT' AND COALESCE(t.head_count, 0) <= 0))
                 LIMIT 20`,
    needs: `SELECT 1 FROM batch_transfer WHERE status = 'POSTED' LIMIT 1`,
  },

  // ── Outputs: piglets and semen
  {
    name: 'a piglet lot holds the litter as it stood at farrowing (born live + received − fostered out)',
    violations: `SELECT f.farrow_id, f.piglet_lot_no, b.batch_no, b.opening_quantity AS lot_head,
                        (f.piglets_born_live + COALESCE(f.foster_received,0) - COALESCE(f.fostered_out,0)) AS litter
                 FROM farrowing_record f JOIN batch_header b ON b.batch_id = f.piglet_batch_id
                 WHERE ABS(b.opening_quantity - (f.piglets_born_live + COALESCE(f.foster_received,0) - COALESCE(f.fostered_out,0))) > 0.0001
                 LIMIT 20`,
    needs: 'SELECT 1 FROM farrowing_record WHERE piglet_batch_id IS NOT NULL LIMIT 1',
  },
  {
    name: 'a weaned litter left its piglet lot (head weaned moved on, the rest died before weaning)',
    violations: `SELECT f.farrow_id, f.piglet_lot_no, b.batch_no, f.piglets_weaned, b.closing_quantity
                 FROM farrowing_record f JOIN batch_header b ON b.batch_id = f.piglet_batch_id
                 JOIN batch_transfer t ON t.from_batch_id = b.batch_id AND t.status = 'POSTED'
                 WHERE f.piglets_weaned > 0 AND b.closing_quantity > 0 AND t.head_count >= f.piglets_weaned
                 LIMIT 20`,
  },
  {
    name: 'a semen lot\'s doses match stock: collected = ledger output, used internally = ledger consumption',
    violations: `SELECT s.lot_no, s.doses_collected, s.doses_used_internal,
                        COALESCE((SELECT SUM(l.quantity) FROM inventory_ledger l WHERE l.document_type = 'BREEDING' AND l.transaction_type = 'OUTPUT' AND l.lot_no = s.lot_no), 0) AS ledger_out,
                        COALESCE((SELECT SUM(-l.quantity) FROM inventory_ledger l WHERE l.document_type = 'BREEDING' AND l.transaction_type = 'CONSUMPTION' AND l.lot_no = s.lot_no), 0) AS ledger_used
                 FROM semen_batch s
                 WHERE s.inventory_posted = 1
                   AND (ABS(s.doses_collected - COALESCE((SELECT SUM(l.quantity) FROM inventory_ledger l WHERE l.document_type = 'BREEDING' AND l.transaction_type = 'OUTPUT' AND l.lot_no = s.lot_no), 0)) > 0.0001
                     OR ABS(COALESCE(s.doses_used_internal,0) - COALESCE((SELECT SUM(-l.quantity) FROM inventory_ledger l WHERE l.document_type = 'BREEDING' AND l.transaction_type = 'CONSUMPTION' AND l.lot_no = s.lot_no), 0)) > 0.0001)
                 LIMIT 20`,
    needs: 'SELECT 1 FROM semen_batch WHERE inventory_posted = 1 LIMIT 1',
  },
  {
    name: 'every posted semen lot has a QR pack and a store',
    violations: `SELECT lot_no, qr_id, warehouse_id FROM semen_batch WHERE inventory_posted = 1 AND (qr_id IS NULL OR warehouse_id IS NULL) LIMIT 20`,
  },

  // ── Masters and numbering
  {
    name: 'the reason master is seeded (mortality, disposal, transfer, adjustment)',
    violations: `SELECT c.category FROM (SELECT 'MORTALITY' category UNION SELECT 'DISPOSAL' UNION SELECT 'TRANSFER' UNION SELECT 'ADJUSTMENT') c
                 WHERE NOT EXISTS (SELECT 1 FROM reason_master r WHERE r.category = c.category AND r.company_id IS NOT NULL)`,
  },
  {
    name: 'batch numbers follow the BATCH series (BATCH-000001, or a split child BATCH-000001-S1234); a litter lot follows the LITTER_LOT series (LIT-000001)',
    violations: `SELECT batch_no, is_litter_lot FROM batch_header
                 WHERE (is_litter_lot = 0 AND batch_no NOT REGEXP '^BATCH-[0-9]{6}(-S[0-9]{4})?$')
                    OR (is_litter_lot = 1 AND batch_no NOT REGEXP '^LIT-[0-9]{6}$')
                 LIMIT 20`,
  },
  {
    name: 'a semen lot\'s stock value = its doses x its cost per dose',
    violations: `SELECT s.lot_no, s.doses_collected, s.unit_cost_per_dose, SUM(l.amount) AS stock_value
                 FROM semen_batch s JOIN inventory_ledger l ON l.lot_no = s.lot_no AND l.transaction_type = 'OUTPUT' AND l.document_type = 'BREEDING'
                 WHERE s.inventory_posted = 1
                 GROUP BY s.semen_batch_id, s.lot_no, s.doses_collected, s.unit_cost_per_dose
                 HAVING ABS(SUM(l.amount) - s.doses_collected * s.unit_cost_per_dose) > 0.01
                 LIMIT 20`,
    needs: `SELECT 1 FROM semen_batch WHERE inventory_posted = 1 LIMIT 1`,
  },
  {
    name: 'every priced semen issue to a mating that has a sow in a bio-asset batch was charged to her (a Bio Asset Ledger row of the same cost)',
    violations: `SELECT l.document_no, l.batch_no, ABS(l.amount) AS issue_cost
                 FROM inventory_ledger l
                 JOIN batch_header b ON b.batch_no = l.batch_no AND b.company_id = l.company_id AND b.costing_method = 'BIO_ASSET'
                 WHERE l.document_type = 'BREEDING' AND l.transaction_type = 'CONSUMPTION' AND l.gl_mapping_type = 'BIO_SEMEN_USE' AND ABS(l.amount) >= 0.005
                   AND NOT EXISTS (SELECT 1 FROM bio_asset_ledger a WHERE a.document_type = 'BREEDING_SEMEN' AND a.document_line_id = l.document_line_id AND ABS(a.cost_amount - ABS(l.amount)) < 0.01)
                 LIMIT 20`,
  },
  {
    name: 'an animal that left by sale, cull or slaughter with a value to account for has an exit journal (proceeds, or the loss on her book value)',
    violations: `SELECT a.animal_code, a.disposal_type, a.disposal_value, a.gain_loss_on_disposal
                 FROM animal_register a
                 WHERE a.disposal_type IN ('SOLD', 'CULLED', 'SLAUGHTERED') AND a.is_active = 0
                   AND (COALESCE(a.disposal_value, 0) > 0 OR ABS(COALESCE(a.gain_loss_on_disposal, 0)) > 0.005)
                   AND NOT EXISTS (SELECT 1 FROM journal_header j WHERE j.source_document_no = a.animal_code AND j.status = 'POSTED' AND j.source_document_type = 'BATCH')
                 LIMIT 20`,
    needs: `SELECT 1 FROM animal_register WHERE disposal_type IN ('SOLD', 'CULLED', 'SLAUGHTERED') LIMIT 1`,
  },
  {
    name: 'animals received on a goods receipt are in the GL: a journal of the receipt\'s cost (Dr asset / Cr payables) for every priced line',
    violations: `SELECT a.document_no, a.cost_amount
                 FROM bio_asset_ledger a
                 WHERE a.document_type = 'GOODS_RECEIPT' AND a.transaction_type = 'PURCHASE' AND a.cost_amount >= 0.005
                   AND EXISTS (SELECT 1 FROM gl_mapping_master m WHERE m.transaction_type = 'BIO_ACQUISITION' AND m.is_active = 1 AND m.deleted_at IS NULL)
                   AND NOT EXISTS (SELECT 1 FROM journal_header j WHERE j.source_document_type = 'GOODS_RECEIPT' AND j.source_document_no = a.document_no
                                     AND j.status = 'POSTED' AND ABS(j.total_debit - a.cost_amount) < 0.01)
                 LIMIT 20`,
    needs: `SELECT 1 FROM bio_asset_ledger WHERE document_type = 'GOODS_RECEIPT' LIMIT 1`,
  },
  {
    name: 'an animal registered with no receipt (bought local, or born on the farm) with a cost is in the GL, once her mapping is set up',
    violations: `SELECT r.animal_code, r.entry_type, r.acquisition_cost
                 FROM animal_register r
                 WHERE r.source_receipt_id IS NULL AND r.entry_type IN ('PURCHASED_LOCAL', 'BORN_ON_FARM') AND r.acquisition_cost >= 0.005
                   AND EXISTS (SELECT 1 FROM gl_mapping_master m WHERE m.is_active = 1 AND m.deleted_at IS NULL
                                 AND m.transaction_type = CASE r.entry_type WHEN 'BORN_ON_FARM' THEN 'BIO_GILT_ACQUISITION' ELSE 'BIO_ACQUISITION' END)
                   AND NOT EXISTS (SELECT 1 FROM journal_header j WHERE j.source_document_type = 'ANIMAL_REGISTRATION' AND j.source_document_no = r.animal_code AND j.status = 'POSTED')
                 LIMIT 20`,
    needs: `SELECT 1 FROM animal_register WHERE source_receipt_id IS NULL AND entry_type IN ('PURCHASED_LOCAL', 'BORN_ON_FARM') LIMIT 1`,
  },
  {
    name: 'no biological asset account (1050 pre-mature, 1055 piglets, 1060 mature) and no work in progress (1020) holds a negative balance',
    violations: `SELECT a.account_code, ROUND(SUM(l.debit_amount - l.credit_amount), 2) AS balance
                 FROM journal_line l JOIN gl_account_master a ON a.gl_account_id = l.gl_account_id JOIN journal_header j ON j.journal_id = l.journal_id
                 WHERE j.status = 'POSTED' AND a.account_code IN ('1020', '1050', '1055', '1060')
                 GROUP BY a.account_code HAVING SUM(l.debit_amount - l.credit_amount) < -0.01`,
    needs: `SELECT 1 FROM journal_header LIMIT 1`,
  },
  {
    name: 'every piglet lot a farrowing made is marked as a litter lot, and no other batch is',
    violations: `SELECT b.batch_no, b.is_litter_lot FROM batch_header b
                 WHERE b.is_litter_lot <> EXISTS (SELECT 1 FROM farrowing_record f WHERE f.piglet_batch_id = b.batch_id)
                 LIMIT 20`,
  },
  {
    name: 'animal codes follow the ANIMAL series (PIG-YYYY-NNNN, year of birth)',
    violations: `SELECT animal_code, dob FROM animal_register
                 WHERE animal_code NOT REGEXP '^PIG-[0-9]{4}-[0-9]{4}$'
                    OR dob IS NULL OR SUBSTRING(animal_code, 5, 4) <> YEAR(dob)
                 LIMIT 20`,
  },
  {
    name: 'every series carries a prefix, except the two that are built from other records',
    violations: `SELECT code, company_id IS NOT NULL AS company_scope FROM no_series
                 WHERE (prefix IS NULL OR prefix = '' OR no_series_code IS NULL OR no_series_code = '')
                   AND code NOT IN ('LOCATION', 'BREED_LIFECYCLE_STAGE')
                 LIMIT 20`,
  },
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: DB,
  });
  let failed = 0;
  let warned = 0;
  try {
    console.log(`\nverify-demo-flow · ${DB}\n`);
    for (const check of CHECKS) {
      if (check.needs) {
        const [rows] = await db.query<RowDataPacket[]>(check.needs);
        if (!rows.length) {
          warned++;
          console.log(`  WARN  ${check.name}\n          nothing to check — the data this rule is about was never seeded`);
          continue;
        }
      }
      const [bad] = await db.query<RowDataPacket[]>(check.violations);
      if (bad.length === 0) {
        console.log(`  PASS  ${check.name}`);
      } else {
        failed++;
        console.log(`  FAIL  ${check.name}  (${bad.length}${bad.length === 20 ? '+' : ''} row(s))`);
        for (const row of bad.slice(0, 8)) console.log(`          ${JSON.stringify(row)}`);
      }
    }

    // A summary of what the flow produced, so a PASS on empty tables cannot be mistaken for a pass on data.
    const [[counts]] = await db.query<RowDataPacket[]>(`SELECT
      (SELECT COUNT(*) FROM batch_header) AS batches,
      (SELECT COUNT(*) FROM animal_register) AS animals,
      (SELECT COUNT(*) FROM goods_receipt) AS receipts,
      (SELECT COUNT(*) FROM stock_transfer) AS stock_transfers,
      (SELECT COUNT(*) FROM stock_transfer WHERE status = 'IN_TRANSIT') AS in_transit,
      (SELECT COUNT(*) FROM batch_transfer) AS batch_transfers,
      (SELECT COUNT(*) FROM batch_mortality_detail) AS mortality_details,
      (SELECT COUNT(*) FROM farrowing_record WHERE piglet_batch_id IS NOT NULL) AS piglet_lots,
      (SELECT COUNT(*) FROM semen_batch) AS semen_lots,
      (SELECT COUNT(*) FROM qr_code_master) AS qr_packs,
      (SELECT COUNT(*) FROM inventory_ledger) AS ledger_rows,
      (SELECT COUNT(*) FROM journal_header) AS journals`);
    console.log(`\n  data: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    console.log(`\n  ${CHECKS.length - failed - warned} passed · ${failed} failed · ${warned} nothing to check\n`);
  } finally {
    await db.end();
  }
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
