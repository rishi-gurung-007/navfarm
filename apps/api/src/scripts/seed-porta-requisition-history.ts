/**
 * Seeds reviewable PORTA feed-requisition history for the two device batches.
 *
 * This is a display/workflow fixture: it records monthly requisitions from each
 * batch's configured start date through the database's current date. It does
 * not post additional stock movements; the current mill-bin balances remain
 * the source for live shipment tests.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 */
import { randomUUID } from 'node:crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
const VERIFY_ROLLBACK = Symbol('seed-porta-requisition-history:verify-rollback');

const BATCHES = ['BATCH-000001', 'BATCH-000002'] as const;
const ITEM_TO_SILO: Record<string, string> = {
  'DG-001': 'PDSD-02',
  'FEED-SF': 'PFHLG-12',
  'DS-001': 'POR100/PDS2/SILO-DS001',
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function asUtcDate(value: string | Date): Date {
  const text = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);
  return new Date(`${text}T00:00:00Z`);
}

function addMonths(date: Date, count: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}

function daysInclusive(from: Date, to: Date): number {
  return Math.floor((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86_400_000) + 1;
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
      `SELECT tenant_id, company_id, nob_id, lob_id, location_id AS farm_id
         FROM location_master
        WHERE location_code = 'POR100' AND location_type = 'FARM' AND company_id IS NOT NULL
        LIMIT 1`,
    );
    if (!scope) throw new Error('POR100 farm is missing — run the PORTA master seed first.');

    const [[actor]] = await db.query<RowDataPacket[]>(
      'SELECT user_id, full_name, email FROM user_master WHERE tenant_id = ? AND company_id = ? ORDER BY created_at LIMIT 1',
      [scope.tenant_id, scope.company_id],
    );
    if (!actor) throw new Error('PORTA seed user is missing.');

    const [millRows] = await db.query<RowDataPacket[]>(
      'SELECT location_id FROM location_master WHERE tenant_id = ? AND company_id = ? AND location_code = ? AND location_type = \'MILL\' LIMIT 1',
      [scope.tenant_id, scope.company_id, 'PORTA-FEED-MILL'],
    );
    if (!millRows[0]) throw new Error('PORTA feed mill is missing — run seed-porta-feed-planning-data.ts first.');

    const [[todayRow]] = await db.query<RowDataPacket[]>('SELECT CURRENT_DATE AS today');
    const today = asUtcDate(todayRow.today);
    const created = [] as Array<{ reqNo: string; batchNo: string; itemCode: string; quantityKg: number; periodFrom: string; periodTo: string }>;

    for (const batchNo of BATCHES) {
      const [[batch]] = await db.query<RowDataPacket[]>(
        `SELECT batch_id, batch_no, breed_id, stage_id, shed_id, farm_id, start_date
           FROM batch_header
          WHERE tenant_id = ? AND company_id = ? AND batch_no = ? AND deleted_at IS NULL
          LIMIT 1`,
        [scope.tenant_id, scope.company_id, batchNo],
      );
      if (!batch) throw new Error(`${batchNo} is missing.`);

      const [[scheduler]] = await db.query<RowDataPacket[]>(
        `SELECT animal_count
           FROM scheduler_header
          WHERE tenant_id = ? AND company_id = ? AND batch_id = ? AND effective_from <= ?
          ORDER BY effective_from DESC, created_at DESC
          LIMIT 1`,
        [scope.tenant_id, scope.company_id, batch.batch_id, isoDate(today)],
      );
      const heads = Number(scheduler?.animal_count || 0);
      if (heads <= 0) throw new Error(`${batchNo} has no active scheduler head count.`);

      const [[feed]] = await db.query<RowDataPacket[]>(
        `SELECT bls.lifecycle_id, bls.feed_item_id, bls.feed_qty_per_head_per_day_kg,
                i.item_code, i.item_name
           FROM breed_lifecycle_stages bls
           JOIN item_master i ON i.item_id = bls.feed_item_id
          WHERE bls.tenant_id = ? AND bls.company_id = ? AND bls.breed_id = ? AND bls.stage_id = ?
            AND bls.is_active = 1
          ORDER BY bls.period_from, bls.lifecycle_code
          LIMIT 1`,
        [scope.tenant_id, scope.company_id, batch.breed_id, batch.stage_id],
      );
      if (!feed) throw new Error(`${batchNo} has no active lifecycle feed row.`);
      const siloCode = ITEM_TO_SILO[feed.item_code as string];
      if (!siloCode) throw new Error(`No PORTA silo mapping exists for ${feed.item_code}.`);

      const [[silo]] = await db.query<RowDataPacket[]>(
        'SELECT location_id FROM location_master WHERE tenant_id = ? AND company_id = ? AND location_code = ? AND location_type = \'SILO\' LIMIT 1',
        [scope.tenant_id, scope.company_id, siloCode],
      );
      const [[bin]] = await db.query<RowDataPacket[]>(
        'SELECT location_id FROM location_master WHERE tenant_id = ? AND company_id = ? AND location_code = ? AND location_type = \'BIN\' LIMIT 1',
        [scope.tenant_id, scope.company_id, `PORTA-FEED-MILL/BIN-${feed.item_code === 'FEED-SF' ? 'SF' : feed.item_code.replace('-001', '')}001`],
      );
      if (!silo || !bin) throw new Error(`${batchNo} feed locations are missing for ${feed.item_code}.`);

      const batchStart = asUtcDate(batch.start_date);
      for (let period = new Date(batchStart); period <= today; period = addMonths(period, 1)) {
        const periodEnd = new Date(Math.min(addMonths(period, 1).getTime() - 86_400_000, today.getTime()));
        const quantityKg = Number((heads * Number(feed.feed_qty_per_head_per_day_kg) * daysInclusive(period, periodEnd)).toFixed(4));
        const ym = `${period.getUTCFullYear()}${String(period.getUTCMonth() + 1).padStart(2, '0')}`;
        const reqNo = `REQ-POR100-HIST-${batchNo.slice(-6)}-${ym}`;
        const [existing] = await db.query<RowDataPacket[]>(
          'SELECT requisition_id FROM requisition WHERE tenant_id = ? AND company_id = ? AND req_no = ? LIMIT 1',
          [scope.tenant_id, scope.company_id, reqNo],
        );
        if (existing.length) continue;

        const requisitionId = randomUUID();
        const lineId = randomUUID();
        const lineBatchId = randomUUID();
        const approvalId = randomUUID();
        const reqDate = isoDate(period);
        const requiredDate = isoDate(periodEnd);
        const dailyDemand = Number((heads * Number(feed.feed_qty_per_head_per_day_kg)).toFixed(4));
        const justification = `Historical PORTA test requisition for ${batchNo}, ${feed.item_code}, ${reqDate} to ${requiredDate}`;

        if (write) {
          await db.query(
            `INSERT INTO requisition
              (requisition_id, tenant_id, company_id, farm_id, req_no, doc_type, status, required_date,
               justification, approval_request_id, created_by, updated_by, created_at, updated_at,
               requisition_type, source, purpose, supply_source, priority, production_date, submission_deadline,
               remarks, approved_by, approved_at, requisition_date, requester_user_id, requester_name,
               approval_status, document_status, fulfilment_status, from_location_id, to_location_id,
               direct_transfer, released_by, released_at)
             VALUES (?, ?, ?, ?, ?, 'FEED', 'IN_CONSOLIDATION', ?, ?, NULL, ?, ?, CONCAT(?, ' 12:00:00'), CONCAT(?, ' 12:00:00'),
                     'FEED_FORECAST', 'AUTO_FORECAST', 'INTERNAL_TRANSFER', 'MILL', 'INFO', ?, ?, ?, ?, CONCAT(?, ' 12:00:00'), ?, ?, ?,
                     'APPROVED', 'RECEIVED', 'RECEIVED', ?, ?, 0, ?, CONCAT(?, ' 12:00:00'))`,
            [requisitionId, scope.tenant_id, scope.company_id, batch.farm_id, reqNo, requiredDate, justification,
              actor.user_id, actor.user_id, reqDate, reqDate, reqDate, requiredDate, justification, actor.user_id, periodEnd.toISOString().slice(0, 10), reqDate,
              actor.user_id, actor.full_name, batch.farm_id, silo.location_id, actor.user_id, requiredDate],
          );
          await db.query(
            `INSERT INTO requisition_line
              (line_id, requisition_id, line_seq, item_id, description, quantity, uom, created_at,
               destination_location_id, source_type, feed_type, is_next_diet, lifecycle_ref_id,
               system_balance_kg, daily_requirement_kg, days_remaining, unrounded_need_kg, recommended_qty_kg,
               proposed_delivery_date, needs_silo_changeover, quantity_edited, from_location_id, to_location_id,
               qty_to_ship, qty_shipped, qty_to_receive, qty_received, recommended_delivery_date, exceeds_silo_capacity)
             VALUES (?, ?, 10000, ?, ?, ?, 'KG', CONCAT(?, ' 12:00:00'), ?, 'SILO', 'BULK', 0, ?, 30000, ?, 0, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [lineId, requisitionId, feed.feed_item_id, feed.item_name, quantityKg, reqDate, silo.location_id, feed.lifecycle_id,
              dailyDemand, quantityKg, quantityKg, requiredDate, bin.location_id, silo.location_id, quantityKg, quantityKg, quantityKg, quantityKg, requiredDate],
          );
          await db.query(
            `INSERT INTO requisition_line_batch
              (line_batch_id, line_id, batch_id, shed_id, heads, feed_rate_kg, lifecycle_ref_id, demand_kg, first_demand_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [lineBatchId, lineId, batch.batch_id, batch.shed_id, heads, feed.feed_qty_per_head_per_day_kg, feed.lifecycle_id, quantityKg, reqDate],
          );
          await db.query(
            `INSERT INTO approval_request
              (request_id, tenant_id, company_id, doc_type, doc_no, title, requested_by, requestor_label,
               requestor_role, location_label, urgency, item_or_stage, requested_qty, uom, justification,
               status, submitted_at, decided_at, decided_by, decider_label, created_by, updated_by, created_at,
               updated_at, farm_id, document_id)
             VALUES (?, ?, ?, 'FEED_REQUISITION', ?, ?, ?, ?, 'TENANT ADMIN', 'PORTA100', 'MEDIUM', 'Feed', ?, 'KG', ?,
                     'APPROVED', CONCAT(?, ' 12:00:00'), CONCAT(?, ' 12:00:00'), ?, ?, ?, ?, CONCAT(?, ' 12:00:00'), CONCAT(?, ' 12:00:00'), ?, ?)`,
            [approvalId, scope.tenant_id, scope.company_id, reqNo, `Feed requisition ${reqNo}`, actor.user_id, actor.full_name,
              quantityKg, justification, reqDate, reqDate, actor.user_id, actor.full_name, actor.user_id, actor.user_id, reqDate, reqDate, batch.farm_id, requisitionId],
          );
          await db.query('UPDATE requisition SET approval_request_id = ? WHERE requisition_id = ?', [approvalId, requisitionId]);
        }
        created.push({ reqNo, batchNo, itemCode: feed.item_code, quantityKg, periodFrom: reqDate, periodTo: requiredDate });
      }
    }

    console.log(JSON.stringify({ database, mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY', createdCount: created.length, sample: created.slice(0, 3), last: created.at(-1) }, null, 2));
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
