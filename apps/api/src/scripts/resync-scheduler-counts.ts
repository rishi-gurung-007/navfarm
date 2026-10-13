/**
 * One-off repair: recount the schedulers of every active animal-wise batch from the register (audit B1/B2).
 *
 * Since Phase 2 a scheduler's count is recomputed whenever a death, transfer, exit or stage move happens in its batch,
 * and each stage the batch's animals hold gets an open scheduler. A batch in which nothing has happened since still
 * carries the count written before that fix — e.g. BATCH-000001 in nf_devco said 4 at Farrowing and Lactation where the
 * register holds 2 and 2. This recounts them all once, through the same service call the events use.
 *
 * Usage (read-only by default, as every db-* script):
 *   pnpm nx run api:db-resync-scheduler-counts                       # plan: lists every scheduler that is off
 *   pnpm nx run api:db-resync-scheduler-counts -- --verify           # recounts in one transaction, rolls back
 *   pnpm nx run api:db-resync-scheduler-counts -- --apply            # commits
 *   … -- --apply --tenant=devco                                      # one tenant (default: every tenant)
 */
import { and, eq, inArray } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import * as masterSchema from '../core/database/master-schema';
import { MASTER_CONNECTION } from '../core/database/database.module';
import { withTenantTransaction } from '../common/tenant-transaction';
import { bootApp } from './demo/harness';
import { ConnectionManagerService } from '../core/database/connection-manager.service';
import { SchedulerHeaderService } from '../modules/production/scheduler-header/scheduler-header.service';

class RollBack extends Error {}

async function main() {
  // `pnpm nx run … -- --apply` can hand the script a bare `--` as well.
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  const tenantArg = args.find((a) => a.startsWith('--tenant='))?.slice('--tenant='.length);
  if (args.some((a) => a !== '--apply' && a !== '--verify' && !a.startsWith('--tenant=')) || (apply && verify)) {
    throw new Error('Use no flags (plan only), --verify, or --apply; optionally --tenant=CODE.');
  }
  const log = (line: string) => console.log(`[resync-scheduler-counts] ${line}`);
  const app = await bootApp();
  try {
    const masterDb = app.get<MySql2Database<typeof masterSchema>>(MASTER_CONNECTION);
    const tenants = (await masterDb.select().from(masterSchema.tenantMaster)).filter(
      (t) => t.is_active && (!tenantArg || t.tenant_code === tenantArg),
    );
    for (const tenant of tenants) {
      // Each tenant on its own connection, in its own CLS context — as TenantMiddleware sets one per request. (The demo
      // harness caches one tenant's database, so it cannot be used across tenants.)
      const cls = app.get(ClsService);
      const tenantDb = await app.get(ConnectionManagerService).getTenantConnection(tenant);
      await cls.run(async () => {
        cls.set('tenantId', tenant.tenant_id);
        cls.set('tenantDb', tenantDb);
        const db = () => cls.get<MySql2Database<typeof schema>>('tenantDb');
        const batches = await db()
          .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no })
          .from(schema.batchHeader)
          .where(and(eq(schema.batchHeader.tracking_mode, 'ANIMAL_WISE'), eq(schema.batchHeader.status, 'ACTIVE')));
        const off = await offCounts(db(), batches.map((b) => b.batch_id));
        log(`${tenant.tenant_code}: ${batches.length} active animal-wise batch(es); ${off.length} scheduler count(s) off`);
        for (const o of off) log(`  ${o.batch_no} ${o.stage_code}: says ${o.count}, register holds ${o.live}`);
        if (!apply && !verify) return;
        const schedulers = app.get(SchedulerHeaderService);
        try {
          await withTenantTransaction(cls, async () => {
            for (const b of batches) await schedulers.syncAnimalWiseCounts(b.batch_id);
            const after = await offCounts(db(), batches.map((b) => b.batch_id));
            log(`${tenant.tenant_code}: after recount, ${after.length} off`);
            if (verify) throw new RollBack();
          });
        } catch (err) {
          if (!(err instanceof RollBack)) throw err;
          log(`${tenant.tenant_code}: VERIFY — rolled back.`);
          return;
        }
        log(`${tenant.tenant_code}: APPLIED.`);
      });
    }
    if (!apply && !verify) log('Plan only — nothing written. Run with --verify, then --apply.');
  } finally {
    await app.close();
  }
}

async function offCounts(db: MySql2Database<typeof schema>, batchIds: string[]) {
  if (!batchIds.length) return [];
  const headers = await db
    .select({
      batch_id: schema.schedulerHeader.batch_id,
      batch_no: schema.batchHeader.batch_no,
      stage_code: schema.stageMaster.stage_code,
      count: schema.schedulerHeader.animal_count,
    })
    .from(schema.schedulerHeader)
    .innerJoin(schema.stageMaster, eq(schema.stageMaster.stage_id, schema.schedulerHeader.stage_id))
    .innerJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.schedulerHeader.batch_id))
    .where(and(inArray(schema.schedulerHeader.batch_id, batchIds), inArray(schema.schedulerHeader.scheduler_status, ['ACTIVE', 'DRAFT'])));
  const animals = await db
    .select({ batch_id: schema.animalRegister.current_batch_id, stage_code: schema.stageMaster.stage_code })
    .from(schema.animalRegister)
    .innerJoin(schema.stageMaster, eq(schema.stageMaster.stage_id, schema.animalRegister.current_stage_id))
    .where(and(inArray(schema.animalRegister.current_batch_id, batchIds), eq(schema.animalRegister.is_active, true)));
  const live = new Map<string, number>();
  for (const a of animals) live.set(`${a.batch_id}|${a.stage_code}`, (live.get(`${a.batch_id}|${a.stage_code}`) ?? 0) + 1);
  return headers
    .map((h) => ({ ...h, count: Number(h.count), live: live.get(`${h.batch_id}|${h.stage_code}`) ?? 0 }))
    .filter((h) => h.count !== h.live);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[resync-scheduler-counts] FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
