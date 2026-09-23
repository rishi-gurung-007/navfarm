/**
 * Repair: the demo batches' auto-generated schedulers were created before the
 * Triple C farm breeds had breed_lifecycle_stages rows, so they carry zero
 * lines. Two gaps are fixed, both by service paths wherever one exists:
 *
 *   1. Count-Only batches were created without a breed_id, and
 *      generateLinesFromLifecycle() keys lines off breed_lifecycle_stages —
 *      a breed-less batch can never grow scheduler lines. The chapter
 *      (03-batches-and-animals) now passes the farm's breed; this script
 *      backfills breed_id on the already-created live rows (no BatchService
 *      update exists, so this one statement is a planned, logged repair).
 *
 *   2. The demo batches were dated the day chapter 03 first ran, so only one
 *      day of entries is owed — the demo cannot show a backlog or a Missing
 *      day. batch.start_date moves back 14 days (chapter 03 now does this at
 *      creation; this backfills the live rows), and each scheduler's
 *      effective_from follows — only when no batch_daily_data row exists for
 *      the scheduler's lines, so a scheduler already posted over is never
 *      shifted under its own history.
 *
 *   3. Each DEMO batch's EMPTY scheduler is deleted (deleteHeader refuses
 *      when entries exist, so a posted-over scheduler is never touched) and
 *      regenerated through SchedulerHeaderService.generateForBatchCurrentStage
 *      — the same path a user's button takes (Ruling 1).
 *
 *   pnpm nx run api:db-repair-demo-schedulers            # print what it would do
 *   pnpm nx run api:db-repair-demo-schedulers -- --apply  # backfill + regenerate
 */
import { eq, inArray, isNull } from 'drizzle-orm';
import { NestFactory } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppModule } from '../app.module';
import { MASTER_CONNECTION } from '../core/database/database.module';
import { ConnectionManagerService } from '../core/database/connection-manager.service';
import * as masterSchema from '../core/database/master-schema';
import * as schema from '../core/database/schema';
import { SchedulerHeaderService } from '../modules/production/scheduler-header/scheduler-header.service';
import type { MySql2Database } from 'drizzle-orm/mysql2';

const DEMO_TENANT_CODE = 'devco';

async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const masterDb = app.get<MySql2Database<typeof masterSchema>>(MASTER_CONNECTION);
    const [tenant] = await masterDb
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_code, DEMO_TENANT_CODE))
      .limit(1);
    if (!tenant) throw new Error(`Demo tenant '${DEMO_TENANT_CODE}' not found.`);
    const tenantDb = await app.get(ConnectionManagerService).getTenantConnection(tenant);

    const cls = app.get(ClsService);
    const schedulers = app.get(SchedulerHeaderService);

    const demoBatches = await tenantDb
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, remarks: schema.batchHeader.remarks, farm_id: schema.batchHeader.farm_id, breed_id: schema.batchHeader.breed_id, animal_tracking: schema.batchHeader.animal_tracking, start_date: schema.batchHeader.start_date })
      .from(schema.batchHeader);
    const targets = demoBatches.filter((b) => b.remarks?.startsWith('DEMO-BATCH-'));
    if (targets.length === 0) throw new Error('No DEMO-BATCH-* rows found — nothing to repair.');

    await cls.run(async () => {
      cls.set('tenantId', tenant.tenant_id);
      cls.set('tenantDb', tenantDb);
      for (const batch of targets) {
        if (!batch.breed_id && batch.farm_id) {
          // Breed is company-wide now, not farm-specific, so a farm no longer
          // implies a single breed to backfill from — a breed-less batch stays
          // breed-less here; assign one by hand if this batch needs it.
          console.log(`${batch.batch_no}: breed-less (${batch.animal_tracking ?? 'unknown tracking'}) — no farm-implied breed to backfill from`);
        }

        // Backdate the batch so 14 days are owed (see header note).
        const owedStart = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
        if (batch.start_date && batch.start_date > owedStart) {
          console.log(`${batch.batch_no}: start_date ${batch.start_date} -> ${owedStart} (14-day owed history)`);
          if (apply) {
            await tenantDb.update(schema.batchHeader)
              .set({ start_date: owedStart })
              .where(eq(schema.batchHeader.batch_id, batch.batch_id));
            batch.start_date = owedStart;
          }
        }

        const [header] = await tenantDb
          .select({ scheduler_id: schema.schedulerHeader.scheduler_id })
          .from(schema.schedulerHeader)
          .where(eq(schema.schedulerHeader.batch_id, batch.batch_id))
          .limit(1);
        if (!header) {
          console.log(`${batch.batch_no}: no scheduler header — will regenerate`);
          if (apply) await schedulers.generateForBatchCurrentStage(batch.batch_id, tenant.tenant_id);
          continue;
        }
        const lines = await tenantDb
          .select({ line_id: schema.schedulerLine.line_id })
          .from(schema.schedulerLine)
          .where(eq(schema.schedulerLine.scheduler_id, header.scheduler_id));
        if (lines.length > 0) {
          console.log(`${batch.batch_no}: scheduler already has ${lines.length} line(s) — skipped`);
          // Still align the header to the backdated start — only when nothing
          // has been posted against its lines, so history never moves.
          const lineIds = lines.map((l) => l.line_id);
          const [posted] = await tenantDb
            .select({ one: schema.batchDailyData.entry_date })
            .from(schema.batchDailyData)
            .where(inArray(schema.batchDailyData.line_id, lineIds))
            .limit(1);
          const [hdr] = await tenantDb
            .select({ effective_from: schema.schedulerHeader.effective_from })
            .from(schema.schedulerHeader)
            .where(eq(schema.schedulerHeader.scheduler_id, header.scheduler_id))
            .limit(1);
          if (!posted && hdr?.effective_from && hdr.effective_from > owedStart) {
            console.log(`${batch.batch_no}: scheduler effective_from ${hdr.effective_from} -> ${owedStart}`);
            if (apply) {
              await tenantDb.update(schema.schedulerHeader)
                .set({ effective_from: owedStart })
                .where(eq(schema.schedulerHeader.scheduler_id, header.scheduler_id));
            }
          }
          continue;
        }
        console.log(`${batch.batch_no}: empty scheduler ${header.scheduler_id} -> delete + regenerate`);
        if (apply) {
          await schedulers.deleteHeader(header.scheduler_id, tenant.tenant_id);
          await schedulers.generateForBatchCurrentStage(batch.batch_id, tenant.tenant_id);
        }
      }
    });
    if (!apply) console.log('Read-only — pass --apply to regenerate.');
  } finally {
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
