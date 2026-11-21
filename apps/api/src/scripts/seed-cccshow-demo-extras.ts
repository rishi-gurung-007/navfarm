/**
 * cccshow-only sales-demo embellishments: silo<->shed links reverse-engineered
 * from the nf_ccc reference tenant, two synthetic Porta grower batches, batch
 * diet-stage date freshening, and invented opening feed stock. None of this
 * is real client data or anything a genuine onboarding would want — it exists
 * purely to make the cccshow showcase tenant look operationally alive.
 *
 * Hardcoded to tenant_code "cccshow" on purpose: this must never run against
 * a real client's tenant. Real client onboarding is seed-new-client-data.ts.
 *
 * Default: read-only plan.
 * --verify: run the writes in a transaction and roll them back.
 * --apply: commit the writes.
 *
 *   pnpm nx run api:db-seed-cccshow-demo-extras
 *   pnpm nx run api:db-seed-cccshow-demo-extras -- --verify
 *   pnpm nx run api:db-seed-cccshow-demo-extras -- --apply
 */
import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';

const MASTER_DB = process.env.DATABASE_NAME || 'nf_master';
const TENANT_CODE = 'cccshow';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
    : undefined;

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (
    process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) ||
    (apply && verify)
  )
    throw new Error('Use no flags (read-only), --verify, or --apply.');

  const master = await mysql.createConnection({ host, port, user, password, database: MASTER_DB, ssl });
  const [[tenant]] = await master.query<mysql.RowDataPacket[]>(
    'SELECT tenant_id, db_name FROM tenant_master WHERE tenant_code = ? LIMIT 1',
    [TENANT_CODE],
  );
  await master.end();
  if (!tenant) throw new Error(`Tenant ${TENANT_CODE} is not registered.`);

  const database = process.env.DEV_TENANT_DATABASE || (tenant.db_name as string);
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });

  try {
    await db.beginTransaction();
    const [[scope]] = await db.query<mysql.RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id FROM location_master WHERE tenant_id = ? LIMIT 1`,
      [tenant.tenant_id],
    );
    if (!scope) throw new Error(`No location_master rows found in ${database} — run seed-new-client-data.ts first.`);

    const write = apply || verify;
    const plan: Record<string, unknown> = {
      database,
      tenantCode: TENANT_CODE,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
    };

    const [allLocations] = await db.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code, location_type, company_id FROM location_master WHERE tenant_id = ?`,
      [scope.tenant_id],
    );
    const locationByCode = new Map(allLocations.map((r) => [r.location_code as string, r]));

    // ---- Silo <-> Shed links -------------------------------------------------
    // Neither workbook encodes a clean, unambiguous silo-to-shed mapping (the
    // "Storage Location"/"Storage Name" columns are inconsistent: e.g. every
    // Porta dry-sow shed lists the same literal silo name, and the Multiplier
    // workbook was never imported as locations at all). Pairs below are taken
    // from the working `nf_ccc` ("Triple C") tenant's own silo_shed_link table,
    // which uses the same standardised silo code set, as the ground truth for
    // which silo feeds which shed. Porta's 11 Nov workbook import also created
    // a second, differently-coded set of shed rows for sheds that already
    // existed under an older code (e.g. PGH1 alongside PGH 01... / PWH1
    // alongside PWH01): both code variants are linked so either one works.
    // Dry-sow/double-stock/farrowing groups with no confident match in the
    // reference tenant (Multiplier dry sow) are left unlinked rather than
    // guessed.
    const siloShedPairs: Array<[string, string]> = [
      // Porta grower: 1:1
      ...Array.from({ length: 10 }, (_, i) => [`PG${i + 1}`, `PGH${i + 1}`] as [string, string]),
      // Porta weaner: one silo feeds all weaner houses (both code variants)
      ...['PWH1', 'PWH2', 'PWH3', 'PWH4', 'PWH5', 'PWH6', 'PWH01', 'PWH02', 'PWH03', 'PWH04', 'PWH05', 'PWH06']
        .map((shed) => ['PW-1', shed] as [string, string]),
      // Porta double stock: one silo feeds all double-stock sheds (both code variants)
      ...['PGDST-1', 'PGDST-2', 'PGDST-3', 'PGDST-4', 'PDST01', 'PDST02', 'PDST03', 'PDST04']
        .map((shed) => ['PDST -1', shed] as [string, string]),
      // Porta service line
      ['PSL FS - 01', 'PSL'],
      // Porta dry sow (both code variants; PD2/PDS-02 have no confident match)
      ['PDGD-01', 'PD1'], ['PDGD-01', 'PDS1'],
      ['PDSD-01', 'PD1'], ['PDSD-01', 'PDS1'],
      ['PDSD-03', 'PD3'], ['PDSD-03', 'PDS3'],
      ['PDSD-04', 'PD4'], ['PDSD-04', 'PDS4'],
      ['PDSD-05', 'PD5'], ['PDSD-05', 'PDS5'],
      ['PDSD-06', 'PD6'], ['PDSD-06', 'PDS6'],
      // Porta farrowing: lactation + transition silo per house pair (both code variants)
      ['PFHLG - 1&2', 'PFH1'], ['PFHLG - 1&2', 'PFH2'], ['PFHLG - 1&2', 'PDFH1'], ['PFHLG - 1&2', 'PDFH2'],
      ['PFHLG - 3 & 4', 'PFH3'], ['PFHLG - 3 & 4', 'PFH4'], ['PFHLG - 3 & 4', 'PDFH3'], ['PFHLG - 3 & 4', 'PDFH4'],
      ['PFHLG - 5', 'PFH5'], ['PFHLG - 5', 'PDFH5'],
      ['PFHTRANS - 1&2', 'PFH1'], ['PFHTRANS - 1&2', 'PFH2'], ['PFHTRANS - 1&2', 'PDFH1'], ['PFHTRANS - 1&2', 'PDFH2'],
      ['PFHTRANS - 3 & 4', 'PFH3'], ['PFHTRANS - 3 & 4', 'PFH4'], ['PFHTRANS - 3 & 4', 'PDFH3'], ['PFHTRANS - 3 & 4', 'PDFH4'],
      ['PFHTRANS - 5', 'PFH5'], ['PFHTRANS - 5', 'PDFH5'],
      // Multiplier grower: 1:1
      ...Array.from({ length: 10 }, (_, i) => [`MGH${i + 1}`, `MUGR${i + 1}`] as [string, string]),
      // Multiplier weaner: 1:1
      ...Array.from({ length: 6 }, (_, i) => [`MWH${i + 1}`, `MUWN${i + 1}`] as [string, string]),
      // Multiplier service line
      ['MSL1', 'MU1'],
      // Multiplier farrowing: two silos feed all three farrowing houses
      ...['MUFHE1', 'MUFHE2', 'MUFHE3'].flatMap((shed) => [
        ['MFH TRANS - 1', shed] as [string, string],
        ['MFHLZ - 1 & 2', shed] as [string, string],
      ]),
      // Multiplier double stock: 1:1, with the 3rd silo also covering the 4th shed (one more shed than silo)
      ['MDST1', 'MUDST1P1'], ['MDST2', 'MUDST2P1'], ['MDST3', 'MUDST3P1'], ['MDST3', 'MUDST4P1'],
    ];

    const [existingLinks] = await db.query<mysql.RowDataPacket[]>(
      `SELECT silo_id, shed_id FROM silo_shed_link WHERE tenant_id = ?`,
      [scope.tenant_id],
    );
    const existingLinkKeys = new Set(existingLinks.map((r) => `${r.silo_id}|${r.shed_id}`));
    let siloShedLinksInserted = 0;
    let siloShedLinksSkippedExisting = 0;
    const siloShedUnresolved: string[] = [];

    for (const [siloCode, shedCode] of siloShedPairs) {
      const silo = locationByCode.get(siloCode);
      const shed = locationByCode.get(shedCode);
      if (!silo || silo.location_type !== 'SILO' || !shed || shed.location_type !== 'SHED') {
        siloShedUnresolved.push(`${siloCode} -> ${shedCode}`);
        continue;
      }
      const key = `${silo.location_id}|${shed.location_id}`;
      if (existingLinkKeys.has(key)) {
        siloShedLinksSkippedExisting++;
        continue;
      }
      existingLinkKeys.add(key);
      if (write) {
        await db.query(
          `INSERT INTO silo_shed_link (link_id, tenant_id, company_id, silo_id, shed_id, created_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [randomUUID(), scope.tenant_id, shed.company_id ?? scope.company_id, silo.location_id, shed.location_id],
        );
      }
      siloShedLinksInserted++;
    }
    plan.siloShedLinks = {
      pairsDefined: siloShedPairs.length,
      inserted: siloShedLinksInserted,
      alreadyLinked: siloShedLinksSkippedExisting,
      unresolved: siloShedUnresolved,
    };

    // ---- Porta commercial grower batches -------------------------------------
    // Porta had no weaner/grower/finisher lot at all (only the breeding-stock
    // placeholder batch), so it could never appear on a Slaughter Transfer
    // Order or in the Feed Forecast. Mirrors the existing Multiplier demo
    // batch BATCH-000012 (COUNT_ONLY/BATCH_WISE — this tenant's grower stock
    // is tracked by head count, not individual animal_register rows).
    // BATCH-000014 was fully dispatched through a Slaughter Transfer Order
    // (20 Nov showcase) — its closing_quantity is correctly 0, so it has
    // nothing left to feed. BATCH-000015 is a second, undispatched batch so
    // Porta's Feed Forecast still has live animals to calculate for.
    const GROWER_STAGE_ID = '1cf0587c-a1e5-48c5-93f3-0aee7927665c';
    const portaGrowerBatches = [
      { batchNo: 'BATCH-000014', shedCode: 'PGH1', headCount: 187 }, // matches the Porta kill sheet's headcount; fully dispatched
      { batchNo: 'BATCH-000015', shedCode: 'PGH2', headCount: 165 }, // kept live, for Feed Forecast demo data
    ];
    const portaGrowerBatchIds: string[] = [];
    plan.portaGrowerBatches = [];
    for (const spec of portaGrowerBatches) {
      const [[existing]] = await db.query<mysql.RowDataPacket[]>(
        'SELECT batch_id FROM batch_header WHERE tenant_id = ? AND batch_no = ? LIMIT 1',
        [scope.tenant_id, spec.batchNo],
      );
      if (existing) {
        portaGrowerBatchIds.push(existing.batch_id as string);
        (plan.portaGrowerBatches as unknown[]).push({ batchNo: spec.batchNo, action: 'already-exists', batchId: existing.batch_id });
        continue;
      }
      const [[template]] = await db.query<mysql.RowDataPacket[]>(
        `SELECT * FROM batch_header WHERE tenant_id = ? AND batch_no = 'BATCH-000012' LIMIT 1`,
        [scope.tenant_id],
      );
      const shed = locationByCode.get(spec.shedCode);
      const growerItemRow = (
        await db.query<mysql.RowDataPacket[]>(
          `SELECT item_id FROM item_master WHERE tenant_id = ? AND item_code = 'BIO-SWINE-GROWER' LIMIT 1`,
          [scope.tenant_id],
        )
      )[0][0];
      if (!template || !shed || shed.location_type !== 'SHED' || !growerItemRow) {
        (plan.portaGrowerBatches as unknown[]).push({
          batchNo: spec.batchNo,
          action: 'skipped',
          reason: !template
            ? 'template batch BATCH-000012 not found'
            : !shed
              ? `shed ${spec.shedCode} not found`
              : 'BIO-SWINE-GROWER item not found',
        });
        continue;
      }
      const newBatchId = randomUUID();
      const portaFarmRow = locationByCode.get('POR100');
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
            newBatchId, scope.tenant_id, portaFarmRow?.company_id ?? scope.company_id, spec.batchNo,
            template.lob_id, template.nob_id, template.costing_method, template.breed_id, shed.location_id,
            shed.location_id, spec.headCount, spec.headCount, template.current_stage_code,
            template.stage_id, template.operational_area_id, template.animal_tracking,
            portaFarmRow?.location_id, template.tracking_mode,
          ],
        );
        await db.query(
          `INSERT INTO batch_bio_asset_state (state_id, batch_id, stage, current_quantity, nca_book_value, updated_at)
           VALUES (?, ?, 'PREMATURE', ?, 0, NOW())`,
          [randomUUID(), newBatchId, spec.headCount],
        );
        await db.query(
          `INSERT INTO batch_input_line (line_id, batch_id, line_no, item_id, quantity, uom, rate)
           VALUES (?, ?, 1, ?, ?, 'HEAD', 0)`,
          [randomUUID(), newBatchId, growerItemRow.item_id, spec.headCount],
        );
      }
      portaGrowerBatchIds.push(newBatchId);
      (plan.portaGrowerBatches as unknown[]).push({ batchNo: spec.batchNo, action: 'insert', batchId: newBatchId });
    }

    // ---- Demo batch lifecycle freshness ---------------------------------------
    // The Feed Forecast engine computes each batch's day-of-stage from its
    // scheduler_header.effective_from (or batch_header.start_date when no
    // scheduler row exists). Hardcoded past dates age out of the breed
    // lifecycle's feed-rate coverage (a few weeks per stage), so the showcase
    // batches go dateless-looking and the Calculation page shows nothing.
    // Re-anchor them relative to "today" every time this script runs, so a
    // reseed on any date still lands inside a covered diet window.
    const todayDate = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(todayDate);
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const daysAhead = (n: number) => daysAgo(-n);
    const WEANER_STAGE_ID = 'ac910233-061c-4ec6-a3fa-acf77f21d7ab';
    const DOUBLE_STOCK_STAGE_ID = '0520d561-05ef-4665-a3fc-677b701d2e53';
    const freshness: Array<{ batchId: string; stageId: string; daysAgoCount: number }> = [
      { batchId: '24363faf-345a-44bd-aa35-8b56b2ce5028', stageId: WEANER_STAGE_ID, daysAgoCount: 19 }, // BATCH-000009
      { batchId: 'c36576c6-ba9d-4ecd-8266-31584a3a5256', stageId: WEANER_STAGE_ID, daysAgoCount: 15 }, // BATCH-000011
      { batchId: '6dc992db-8177-42a9-ae06-1b2f739965a6', stageId: GROWER_STAGE_ID, daysAgoCount: 19 }, // BATCH-000012
      { batchId: 'f3052ec9-4d71-477c-9afb-6dd47bfeb778', stageId: DOUBLE_STOCK_STAGE_ID, daysAgoCount: 5 }, // BATCH-000010
    ];
    for (const batchId of portaGrowerBatchIds) freshness.push({ batchId, stageId: GROWER_STAGE_ID, daysAgoCount: 19 });
    let freshnessUpdated = 0;
    let freshnessCreated = 0;
    for (const f of freshness) {
      const effectiveFrom = daysAgo(f.daysAgoCount);
      const [[scheduler]] = await db.query<mysql.RowDataPacket[]>(
        'SELECT scheduler_id FROM scheduler_header WHERE batch_id = ? AND stage_id = ? LIMIT 1',
        [f.batchId, f.stageId],
      );
      if (scheduler) {
        if (write) {
          await db.query(
            'UPDATE scheduler_header SET effective_from = ?, updated_at = NOW() WHERE scheduler_id = ?',
            [effectiveFrom, scheduler.scheduler_id],
          );
        }
        freshnessUpdated++;
      } else if (portaGrowerBatchIds.includes(f.batchId)) {
        const [[batch]] = await db.query<mysql.RowDataPacket[]>(
          'SELECT batch_id, batch_no, company_id, lob_id, nob_id, breed_id, shed_id, operational_area_id FROM batch_header WHERE batch_id = ?',
          [f.batchId],
        );
        const [[headCount]] = await db.query<mysql.RowDataPacket[]>(
          'SELECT current_quantity FROM batch_bio_asset_state WHERE batch_id = ?',
          [f.batchId],
        );
        if (batch && write) {
          await db.query(
            `INSERT INTO scheduler_header
               (scheduler_id, tenant_id, company_id, batch_id, stage_id, breed_id, lob_id, nob_id, location_id,
                data_entry_level, scheduler_status, effective_from, effective_to, animal_count, auto_generated,
                created_by, created_at, updated_at, scheduler_no)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SHED', 'ACTIVE', ?, ?, ?, 1, NULL, NOW(), NOW(), ?)`,
            [
              randomUUID(), scope.tenant_id, batch.company_id, batch.batch_id, f.stageId, batch.breed_id,
              batch.lob_id, batch.nob_id, batch.shed_id, effectiveFrom, daysAhead(75),
              headCount?.current_quantity ?? 0, `SCH-SHOWCASE-${batch.batch_no}`,
            ],
          );
        }
        freshnessCreated++;
      }
    }
    plan.batchLifecycleFreshness = { batchesUpdated: freshnessUpdated, batchesCreated: freshnessCreated };

    // ---- Demo feed stock -------------------------------------------------------
    // Opening stock the Feed Forecast engine actually reads for the batches
    // above. Only the two (store, item) pairs genuinely needed: the Creep
    // stage has no dedicated silo on this farm, so BATCH-000009/011 draw it
    // from the Multiplier store (MST1); Porta has no silo stocked with the
    // Grower item yet, so BATCH-000015 draws it from the Porta store (PST1).
    // (Grower/Weaner/Double-Stock on Multiplier already resolve to their own
    // linked silos via silo_shed_link, so they need no store-side stock.)
    // One POSITIVE inventory_ledger row per pair, written directly (mirrors
    // what POST /stock-adjustment + /post would write) and skipped if a row
    // with the same synthetic document_no already exists.
    const demoFeedStock: Array<{ storeCode: string; itemCode: string; quantity: number; rate: number; postingDate: string }> = [
      { storeCode: 'MST1', itemCode: 'FEED000007', quantity: 275, rate: 26.5, postingDate: '2026-11-15' }, // Creep 2 Nosilac
      { storeCode: 'PST1', itemCode: 'FEED000001', quantity: 1650, rate: 26.5, postingDate: '2026-11-15' }, // Grower1
    ];
    let feedStockInserted = 0;
    let feedStockSkipped = 0;
    const feedStockUnresolved: string[] = [];
    for (const s of demoFeedStock) {
      const documentNo = `SHOWCASE-STOCK-${s.storeCode}-${s.itemCode}`;
      const store = locationByCode.get(s.storeCode);
      const [[item]] = await db.query<mysql.RowDataPacket[]>(
        'SELECT item_id, item_code, item_name, category_id FROM item_master WHERE tenant_id = ? AND item_code = ? LIMIT 1',
        [scope.tenant_id, s.itemCode],
      );
      if (!store || !item) {
        feedStockUnresolved.push(`${s.storeCode} ${s.itemCode}`);
        continue;
      }
      // Idempotent against any prior stock for this (warehouse, item) — not just this script's own
      // synthetic document_no — since this exact pair was first posted by hand through the Stock
      // Adjustment API before this section existed.
      const [[existingStock]] = await db.query<mysql.RowDataPacket[]>(
        'SELECT ledger_id FROM inventory_ledger WHERE tenant_id = ? AND warehouse_id = ? AND item_id = ? AND quantity > 0 LIMIT 1',
        [scope.tenant_id, store.location_id, item.item_id],
      );
      if (existingStock) {
        feedStockSkipped++;
        continue;
      }
      if (write) {
        await db.query(
          `INSERT INTO inventory_ledger
             (ledger_id, tenant_id, company_id, item_id, item_code, item_description, document_type, document_no,
              posting_date, entry_type, transaction_type, quantity, remaining_quantity, uom, rate, amount,
              lot_no, warehouse_id, nob_id, lob_id, category_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'STOCK_ADJUSTMENT', ?, ?, 'POSITIVE', 'VARIANCE_POSITIVE', ?, ?, 'KG', ?, ?,
                   ?, ?, ?, ?, ?, NULL, NOW())`,
          [
            randomUUID(), scope.tenant_id, store.company_id ?? scope.company_id, item.item_id, item.item_code, item.item_name,
            documentNo, s.postingDate, s.quantity, s.quantity, s.rate, s.quantity * s.rate,
            `LOT-SHOWCASE-${s.storeCode}-${s.itemCode}`, store.location_id, scope.nob_id, scope.lob_id, item.category_id,
          ],
        );
      }
      feedStockInserted++;
    }
    plan.demoFeedStock = { inserted: feedStockInserted, alreadySeeded: feedStockSkipped, unresolved: feedStockUnresolved };

    console.log(JSON.stringify(plan, null, 2));
    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(
        verify
          ? 'Verified and rolled back. No changes committed.'
          : 'Read-only. No changes attempted.',
      );
    }
  } finally {
    await db.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
