/**
 * QA seed: for one batch, ensures every stage in its LOB's pipeline has a
 * scheduler_header, and every one of those headers carries at least 10
 * scheduler_line activities — so the ANIMAL_WISE data-entry screen has real
 * activities to post against no matter which stage an animal is (or moves)
 * into, not just the two or three stages a normal create/transition flow
 * happens to have touched so far.
 *
 * A header already holding rows is topped up, not replaced — new lines are
 * appended after the existing max line_seq, and a line whose "identity"
 * (item_id for CONSUMPTION, kpi_metric for DESCRIPTIVE, overhead_category
 * for OVERHEAD, resource_id for RESOURCE) already exists on that header is
 * skipped in favour of the next template entry, so nothing doubles up.
 *
 * Deliberately does not add OUTPUT or TRANSFER lines: OUTPUT would mark
 * `creates_inventory`/valuation semantics this script has no business
 * inventing, and TRANSFER's `auto_triggers_stage` would move the batch/animal
 * the moment someone posted it — neither belongs in throwaway QA data.
 *
 * Default is read-only; --verify applies inside a transaction and rolls
 * back; --apply commits. Same shape as reset-batch-scheduler-for-tracking-mode.ts.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
    : undefined;
const database = process.env.DEV_TENANT_DATABASE || 'tenant_navfarmdev';

const MIN_LINES_PER_SCHEDULER = 10;

// item_id / resource_id values are looked up by code at run time, not
// hardcoded here — this tenant's real item/resource catalog, not invented
// identifiers (see AGENTS.md: never invent client data; this file only picks
// from what the master-data screens already show).
type LineSpec =
  | {
      line_type: 'CONSUMPTION';
      activity_name: string;
      itemCode: string;
      standard_qty: string;
      is_mandatory?: boolean;
    }
  | {
      line_type: 'DESCRIPTIVE';
      activity_name: string;
      kpi_metric: string;
      kpi_uom: string;
      capture_per: string;
      is_mandatory?: boolean;
    }
  | { line_type: 'OVERHEAD'; activity_name: string; overhead_category: string }
  | { line_type: 'RESOURCE'; activity_name: string; resourceCode: string };

// Interleaved so that a brand-new header's first 10 picks already span every
// type, not 8 CONSUMPTION lines before the first DESCRIPTIVE one.
const LINE_TEMPLATE: LineSpec[] = [
  {
    line_type: 'CONSUMPTION',
    activity_name: 'Morning Feed Ration',
    itemCode: 'LVS-PIG-FEED',
    standard_qty: '2.5000',
  },
  {
    line_type: 'DESCRIPTIVE',
    activity_name: 'Body Weight Check',
    kpi_metric: 'BODY_WEIGHT',
    kpi_uom: 'KG',
    capture_per: 'AVERAGE',
  },
  {
    line_type: 'CONSUMPTION',
    activity_name: 'Evening Feed Ration',
    itemCode: 'FEED-GEST-SOW',
    standard_qty: '2.0000',
  },
  {
    line_type: 'DESCRIPTIVE',
    activity_name: 'Mortality Count',
    kpi_metric: 'MORTALITY_COUNT',
    kpi_uom: 'HEAD',
    capture_per: 'TOTAL',
  },
  {
    line_type: 'CONSUMPTION',
    activity_name: 'Vitamin & Mineral Premix',
    itemCode: 'RAW-SWINE-PREMIX',
    standard_qty: '0.0500',
  },
  {
    line_type: 'OVERHEAD',
    activity_name: 'Utilities — Electricity',
    overhead_category: 'UTILITIES',
  },
  {
    line_type: 'CONSUMPTION',
    activity_name: 'Creep Feed Supplement',
    itemCode: 'FEED-CREEP-PRE',
    standard_qty: '0.3000',
  },
  {
    line_type: 'RESOURCE',
    activity_name: 'Farm Labour Hours',
    resourceCode: 'RES-APX-LAB01',
  },
  {
    line_type: 'CONSUMPTION',
    activity_name: 'Lactation Diet Top-Up',
    itemCode: 'FEED-LACT-SOW',
    standard_qty: '1.5000',
  },
  {
    line_type: 'DESCRIPTIVE',
    activity_name: 'Barn Temperature',
    kpi_metric: 'TEMPERATURE',
    kpi_uom: 'CELSIUS',
    capture_per: 'AVERAGE',
  },
  {
    line_type: 'CONSUMPTION',
    activity_name: 'Maize/Corn Supplement',
    itemCode: 'RAW-MAIZE-CORN',
    standard_qty: '0.5000',
  },
  {
    line_type: 'CONSUMPTION',
    activity_name: 'Deworming Dose',
    itemCode: 'MED-IVERMECTIN',
    standard_qty: '1.0000',
  },
  {
    line_type: 'CONSUMPTION',
    activity_name: 'Antibiotic Cover',
    itemCode: 'MED-PENICILLIN',
    standard_qty: '1.0000',
  },
];

function lineKey(
  spec: LineSpec,
  itemIds: Map<string, string>,
  resourceIds: Map<string, string>,
): string {
  if (spec.line_type === 'CONSUMPTION')
    return `CONSUMPTION:${itemIds.get(spec.itemCode)}`;
  if (spec.line_type === 'DESCRIPTIVE') return `DESCRIPTIVE:${spec.kpi_metric}`;
  if (spec.line_type === 'OVERHEAD')
    return `OVERHEAD:${spec.overhead_category}`;
  return `RESOURCE:${resourceIds.get(spec.resourceCode)}`;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  if (
    flags.some((a) => !['--apply', '--verify'].includes(a)) ||
    (apply && verify)
  ) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const batchNoArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const batchNo = batchNoArg || 'BATCH-000010';

  const db = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    ssl,
  });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>(
      "SELECT GET_LOCK('navfarm-seed-batch-schedulers', 5) acquired",
    );
    if (Number(lock.acquired) !== 1)
      throw new Error('Another seed run is active.');

    const [[batch]] = await db.query<RowDataPacket[]>(
      `SELECT batch_id, tenant_id, company_id, breed_id, lob_id, nob_id, start_date, location_id, sub_location_id, shed_id
       FROM batch_header WHERE batch_no = ?`,
      [batchNo],
    );
    if (!batch) throw new Error(`Batch '${batchNo}' not found in ${database}.`);

    const locationId =
      batch.sub_location_id || batch.location_id || batch.shed_id || null;

    const [stages] = await db.query<RowDataPacket[]>(
      `SELECT stage_id, stage_code, stage_sequence FROM stage_master
       WHERE lob_id = ? AND company_id = ? AND is_active = 1 AND deleted_at IS NULL
       ORDER BY stage_sequence`,
      [batch.lob_id, batch.company_id],
    );
    if (!stages.length)
      throw new Error(
        `No active stage_master rows for this batch's LOB/company.`,
      );

    // Resolve every template item/resource code to its real id once, scoped
    // to this tenant and (item/resource-master's own company-or-null-shared)
    // company, so every INSERT below carries a real FK, not a guess.
    const itemCodes = [
      ...new Set(
        LINE_TEMPLATE.filter(
          (l): l is Extract<LineSpec, { line_type: 'CONSUMPTION' }> =>
            l.line_type === 'CONSUMPTION',
        ).map((l) => l.itemCode),
      ),
    ];
    const resourceCodes = [
      ...new Set(
        LINE_TEMPLATE.filter(
          (l): l is Extract<LineSpec, { line_type: 'RESOURCE' }> =>
            l.line_type === 'RESOURCE',
        ).map((l) => l.resourceCode),
      ),
    ];

    const itemIds = new Map<string, string>();
    for (const code of itemCodes) {
      const [[row]] = await db.query<RowDataPacket[]>(
        `SELECT item_id FROM item_master WHERE tenant_id = ? AND item_code = ? AND is_active = 1 LIMIT 1`,
        [batch.tenant_id, code],
      );
      if (!row)
        throw new Error(
          `Template item_code '${code}' not found in item_master for this tenant.`,
        );
      itemIds.set(code, row.item_id);
    }
    const resourceIds = new Map<string, string>();
    for (const code of resourceCodes) {
      const [[row]] = await db.query<RowDataPacket[]>(
        `SELECT resource_id FROM resource_master WHERE tenant_id = ? AND resource_code = ? AND is_active = 1 LIMIT 1`,
        [batch.tenant_id, code],
      );
      if (!row)
        throw new Error(
          `Template resource_code '${code}' not found in resource_master for this tenant.`,
        );
      resourceIds.set(code, row.resource_id);
    }

    type PlannedHeader = {
      stage_id: string;
      stage_code: string;
      scheduler_id: string;
      isNew: boolean;
      existingLineCount: number;
      animal_count: number;
      linesToInsert: Array<LineSpec & { line_seq: number }>;
    };
    const plan: PlannedHeader[] = [];

    for (const stage of stages) {
      let schedulerId: string;
      let isNew = false;
      const [[existingHeader]] = await db.query<RowDataPacket[]>(
        `SELECT scheduler_id FROM scheduler_header WHERE batch_id = ? AND stage_id = ?`,
        [batch.batch_id, stage.stage_id],
      );
      if (existingHeader) {
        schedulerId = existingHeader.scheduler_id;
      } else {
        schedulerId = randomUUID();
        isNew = true;
      }

      const [existingLines] = await db.query<RowDataPacket[]>(
        `SELECT line_seq, line_type, item_id, kpi_metric, overhead_category, resource_id
         FROM scheduler_line WHERE scheduler_id = ?`,
        [schedulerId],
      );
      const existingKeys = new Set(
        existingLines.map((l) => {
          if (l.line_type === 'CONSUMPTION') return `CONSUMPTION:${l.item_id}`;
          if (l.line_type === 'DESCRIPTIVE')
            return `DESCRIPTIVE:${l.kpi_metric}`;
          if (l.line_type === 'OVERHEAD')
            return `OVERHEAD:${l.overhead_category}`;
          if (l.line_type === 'RESOURCE') return `RESOURCE:${l.resource_id}`;
          return `${l.line_type}:${l.line_seq}`;
        }),
      );
      let nextSeq = existingLines.length
        ? Math.max(...existingLines.map((l) => l.line_seq)) + 1
        : 1;

      const need = Math.max(0, MIN_LINES_PER_SCHEDULER - existingLines.length);
      const linesToInsert: Array<LineSpec & { line_seq: number }> = [];
      for (const spec of LINE_TEMPLATE) {
        if (linesToInsert.length >= need) break;
        const key = lineKey(spec, itemIds, resourceIds);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        linesToInsert.push({ ...spec, line_seq: nextSeq++ });
      }
      if (linesToInsert.length < need) {
        throw new Error(
          `Template exhausted for stage ${stage.stage_code} — needed ${need} new lines, only found ${linesToInsert.length} non-duplicate template entries. Widen LINE_TEMPLATE.`,
        );
      }

      const [[{ liveCount }]] = (await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) liveCount FROM animal_register
         WHERE current_batch_id = ? AND current_stage_id = ? AND is_active = 1`,
        [batch.batch_id, stage.stage_id],
      )) as any;

      plan.push({
        stage_id: stage.stage_id,
        stage_code: stage.stage_code,
        scheduler_id: schedulerId,
        isNew,
        existingLineCount: existingLines.length,
        animal_count: liveCount,
        linesToInsert,
      });
    }

    console.log(
      JSON.stringify(
        {
          database,
          batchNo,
          batchId: batch.batch_id,
          mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
          stagesPlanned: plan.length,
          newHeaders: plan.filter((p) => p.isNew).length,
          toppedUpHeaders: plan.filter(
            (p) => !p.isNew && p.linesToInsert.length > 0,
          ).length,
          alreadySatisfied: plan.filter(
            (p) => p.existingLineCount >= MIN_LINES_PER_SCHEDULER,
          ).length,
          plan: plan.map((p) => ({
            stage: p.stage_code,
            scheduler_id: p.scheduler_id,
            newHeader: p.isNew,
            existingLines: p.existingLineCount,
            linesToAdd: p.linesToInsert.map(
              (l) => `${l.line_seq}:${l.line_type}:${l.activity_name}`,
            ),
            finalLineCount: p.existingLineCount + p.linesToInsert.length,
          })),
        },
        null,
        2,
      ),
    );

    if (apply || verify) {
      await db.beginTransaction();
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      for (const p of plan) {
        if (p.isNew) {
          await db.query(
            `INSERT INTO scheduler_header
               (scheduler_id, tenant_id, company_id, batch_id, stage_id, breed_id, lob_id, nob_id, location_id,
                data_entry_level, scheduler_status, effective_from, animal_count, auto_generated, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SHED', 'ACTIVE', ?, ?, 1, ?, ?)`,
            [
              p.scheduler_id,
              batch.tenant_id,
              batch.company_id,
              batch.batch_id,
              p.stage_id,
              batch.breed_id,
              batch.lob_id,
              batch.nob_id,
              locationId,
              batch.start_date,
              p.animal_count,
              now,
              now,
            ],
          );
        }
        for (const line of p.linesToInsert) {
          const base = {
            line_id: randomUUID(),
            scheduler_id: p.scheduler_id,
            line_seq: line.line_seq,
            line_type: line.line_type,
            activity_name: line.activity_name,
            stage_id: p.stage_id,
            occurrence: 'DAILY',
            start_day: 1,
            is_mandatory: 'is_mandatory' in line && line.is_mandatory ? 1 : 0,
            source: 'MANUAL',
            nob_id: batch.nob_id,
            lob_id: batch.lob_id,
          };
          if (line.line_type === 'CONSUMPTION') {
            await db.query(
              `INSERT INTO scheduler_line
                 (line_id, scheduler_id, line_seq, line_type, activity_name, stage_id, occurrence, start_day, is_mandatory, source, nob_id, lob_id,
                  item_id, standard_qty, qty_basis, allow_qty_edit, lot_required, creates_inventory)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PER_HEAD', 1, 0, 0)`,
              [
                base.line_id,
                base.scheduler_id,
                base.line_seq,
                base.line_type,
                base.activity_name,
                base.stage_id,
                base.occurrence,
                base.start_day,
                base.is_mandatory,
                base.source,
                base.nob_id,
                base.lob_id,
                itemIds.get(line.itemCode),
                line.standard_qty,
              ],
            );
          } else if (line.line_type === 'DESCRIPTIVE') {
            await db.query(
              `INSERT INTO scheduler_line
                 (line_id, scheduler_id, line_seq, line_type, activity_name, stage_id, occurrence, start_day, is_mandatory, source, nob_id, lob_id,
                  kpi_metric, kpi_uom, capture_per)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                base.line_id,
                base.scheduler_id,
                base.line_seq,
                base.line_type,
                base.activity_name,
                base.stage_id,
                base.occurrence,
                base.start_day,
                base.is_mandatory,
                base.source,
                base.nob_id,
                base.lob_id,
                line.kpi_metric,
                line.kpi_uom,
                line.capture_per,
              ],
            );
          } else if (line.line_type === 'OVERHEAD') {
            await db.query(
              `INSERT INTO scheduler_line
                 (line_id, scheduler_id, line_seq, line_type, activity_name, stage_id, occurrence, start_day, is_mandatory, source, nob_id, lob_id,
                  overhead_category)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                base.line_id,
                base.scheduler_id,
                base.line_seq,
                base.line_type,
                base.activity_name,
                base.stage_id,
                base.occurrence,
                base.start_day,
                base.is_mandatory,
                base.source,
                base.nob_id,
                base.lob_id,
                line.overhead_category,
              ],
            );
          } else {
            await db.query(
              `INSERT INTO scheduler_line
                 (line_id, scheduler_id, line_seq, line_type, activity_name, stage_id, occurrence, start_day, is_mandatory, source, nob_id, lob_id,
                  resource_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                base.line_id,
                base.scheduler_id,
                base.line_seq,
                base.line_type,
                base.activity_name,
                base.stage_id,
                base.occurrence,
                base.start_day,
                base.is_mandatory,
                base.source,
                base.nob_id,
                base.lob_id,
                resourceIds.get(line.resourceCode),
              ],
            );
          }
        }
      }
      if (apply) {
        await db.commit();
        console.log('Committed.');
      } else {
        await db.rollback();
        console.log('Verified and rolled back. No changes committed.');
      }
    } else {
      console.log(
        'Read-only. No changes attempted. Re-run with --verify, then --apply.',
      );
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-seed-batch-schedulers')");
    await db.end();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
