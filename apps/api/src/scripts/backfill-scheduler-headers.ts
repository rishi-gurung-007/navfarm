/**
 * One-time backfill for batches that reached their current stage before the
 * scheduler_header/scheduler_line feature existed (SchedulerHeaderService.
 * createForStage(), auto-called from BatchService.transferStage() going
 * forward). Creates one scheduler_header per currently-ACTIVE batch's current
 * stage — DRAFT, auto_generated, with a CONSUMPTION/DESCRIPTIVE line pair
 * from breed_lifecycle_stages when that breed+stage combination has one.
 *
 * Idempotent: skips a batch that already has a header for its current stage.
 * Safe to re-run after seeding more batches or more lifecycle-standard rows.
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { and, count, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as mysql from 'mysql2/promise';
import * as schema from '../core/database/schema';

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';
const tenantCode = (process.env.DEV_TENANT_CODE || 'devco').toLowerCase();

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return toDateOnly(d);
}

async function run() {
  const server = await mysql.createConnection({ host, port, user, password, database: masterDatabase });
  const [[tenantRow]] = await server.query<any[]>('SELECT tenant_id, db_name FROM tenant_master WHERE tenant_code = ?', [tenantCode]);
  await server.end();
  if (!tenantRow) throw new Error(`Tenant '${tenantCode}' not found in ${masterDatabase}.`);
  const { tenant_id: tenantId, db_name: dbName } = tenantRow;

  const pool = mysql.createPool({ host, port, user, password, database: dbName });
  const db = drizzle(pool, { schema, mode: 'default' });

  try {
    const batches = await db.select().from(schema.batchHeader).where(eq(schema.batchHeader.status, 'ACTIVE'));
    console.log(`Found ${batches.length} ACTIVE batch(es) in ${dbName}.`);

    for (const batch of batches) {
      if (!batch.stage_id) {
        console.log(`  [${batch.batch_no}] skip — no resolved stage_id.`);
        continue;
      }

      const [existing] = await db.select().from(schema.schedulerHeader)
        .where(and(eq(schema.schedulerHeader.batch_id, batch.batch_id), eq(schema.schedulerHeader.stage_id, batch.stage_id)))
        .limit(1);
      if (existing) {
        console.log(`  [${batch.batch_no}] skip — scheduler_header already exists for its current stage.`);
        continue;
      }

      const [stage] = await db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, batch.stage_id)).limit(1);
      if (!stage) {
        console.log(`  [${batch.batch_no}] skip — stage_id does not resolve to a real Stage Master row.`);
        continue;
      }

      const effectiveFrom = toDateOnly(new Date());
      const effectiveTo = stage.typical_duration_days ? addDays(effectiveFrom, stage.typical_duration_days) : null;
      const locationId = batch.sub_location_id || batch.location_id || batch.shed_id || null;
      const schedulerId = randomUUID();

      const [{ liveCount }] = await db.select({ liveCount: count() }).from(schema.animalRegister)
        .where(and(eq(schema.animalRegister.current_batch_id, batch.batch_id), eq(schema.animalRegister.is_active, true)));
      const animalCount = liveCount > 0 ? String(liveCount) : (batch.closing_quantity ?? batch.opening_quantity);

      await db.insert(schema.schedulerHeader).values({
        scheduler_id: schedulerId,
        tenant_id: tenantId,
        company_id: batch.company_id,
        batch_id: batch.batch_id,
        stage_id: batch.stage_id,
        breed_id: batch.breed_id,
        lob_id: batch.lob_id,
        nob_id: batch.nob_id,
        location_id: locationId,
        scheduler_status: 'DRAFT',
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        animal_count: animalCount,
        auto_generated: true,
      });

      let lineCount = 0;
      if (batch.breed_id) {
        const [lifecycle] = await db.select().from(schema.breedLifecycleStages)
          .where(and(
            eq(schema.breedLifecycleStages.breed_id, batch.breed_id),
            eq(schema.breedLifecycleStages.stage_id, batch.stage_id),
            eq(schema.breedLifecycleStages.is_active, true),
          ))
          .limit(1);

        if (lifecycle) {
          const lines: (typeof schema.schedulerLine.$inferInsert)[] = [];
          let seq = 1;
          const itemIds = [lifecycle.feed_item_id, lifecycle.output_item_id].filter((id): id is string => !!id);
          const itemNames = new Map<string, string>();
          if (itemIds.length) {
            const rows = await db.select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name })
              .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, itemIds));
            rows.forEach((r) => itemNames.set(r.item_id, r.item_name));
          }

          if (lifecycle.feed_item_id && lifecycle.feed_qty_per_head_per_day_kg) {
            lines.push({
              line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'CONSUMPTION',
              activity_name: `${stage.stage_name} Feed`, stage_id: batch.stage_id, occurrence: 'DAILY', start_day: 1, end_day: null,
              is_mandatory: true, source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id,
              nob_id: batch.nob_id, lob_id: batch.lob_id, item_id: lifecycle.feed_item_id,
              item_description: itemNames.get(lifecycle.feed_item_id) ?? null,
              standard_qty: lifecycle.feed_qty_per_head_per_day_kg, qty_basis: 'PER_HEAD',
              allow_qty_edit: true, lot_required: true,
            });
          }
          if (lifecycle.std_mortality_rate_pct) {
            lines.push({
              line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'DESCRIPTIVE',
              activity_name: `${stage.stage_name} Mortality`, stage_id: batch.stage_id, occurrence: 'DAILY', start_day: 1, end_day: null,
              is_mandatory: true, source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id,
              nob_id: batch.nob_id, lob_id: batch.lob_id,
              kpi_metric: 'MORTALITY_COUNT', kpi_uom: 'HEAD', capture_per: 'TOTAL', alert_severity: 'CRITICAL',
              std_value: lifecycle.std_mortality_rate_pct,
            });
          }
          if (lifecycle.output_item_id && lifecycle.std_output_qty) {
            lines.push({
              line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'OUTPUT',
              activity_name: `${stage.stage_name} Output`, stage_id: batch.stage_id, occurrence: 'ONCE', start_day: stage.typical_duration_days || 1, end_day: null,
              source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id, nob_id: batch.nob_id, lob_id: batch.lob_id,
              item_id: lifecycle.output_item_id, item_description: itemNames.get(lifecycle.output_item_id) ?? null,
              standard_qty: lifecycle.std_output_qty, output_basis: 'PER_BATCH',
              creates_inventory: true, output_lot_auto: true,
            });
          } else if (lifecycle.std_body_weight_kg) {
            lines.push({
              line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'DESCRIPTIVE',
              activity_name: `${stage.stage_name} Body Weight Check`, stage_id: batch.stage_id, occurrence: 'WEEKLY', start_day: 7, end_day: null,
              day_of_week: 1, source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id, nob_id: batch.nob_id, lob_id: batch.lob_id,
              kpi_metric: 'BODY_WEIGHT', kpi_uom: 'KG', capture_per: 'AVERAGE', std_value: lifecycle.std_body_weight_kg,
            });
          }
          if (lines.length) {
            await db.insert(schema.schedulerLine).values(lines);
            lineCount = lines.length;
          }
        }
      }

      console.log(`  [${batch.batch_no}] created scheduler_header for stage '${stage.stage_name}' with ${lineCount} line(s).`);
    }

    console.log('\nDone.');
  } finally {
    await pool.end();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
