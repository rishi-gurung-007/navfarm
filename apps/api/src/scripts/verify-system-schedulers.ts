/**
 * Rehearses system schedulers end to end against the real database, then
 * ROLLS BACK — nothing is kept. `pnpm nx run api:verify-system-schedulers`.
 *
 * Inside one transaction, through the application's own services:
 *   1. system schedulers are created for GESTATION (every breed, and one for the
 *      batch's breed) and FARROWING, and a duplicate is refused;
 *   2. a batch created with no answer, or SYSTEM, copies the breed's own
 *      system scheduler (it wins over the every-breed one);
 *   3. a batch created with EMPTY (the user said No) gets an empty scheduler;
 *   4. with every system scheduler switched off, a batch's lines come from the
 *      breed lifecycle exactly as before;
 *   5. a system scheduler made on one of a stage's two ids (tenant template
 *      row / company copy) still matches a batch on the other;
 *   6. a stage transfer copies the destination stage's system scheduler, or
 *      starts it empty when the user said No;
 *   7. an empty scheduler (batch or system) can be filled from a system
 *      scheduler or another batch's scheduler, and only while it is empty.
 * Each step is checked by reading scheduler_header / scheduler_line back.
 */
import { and, eq, ne, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { ConflictException } from '@nestjs/common';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { withTenantTransaction } from '../common/tenant-transaction';
import { BatchService } from '../modules/production/batch/batch.service';
import { SystemSchedulerService } from '../modules/production/scheduler-header/system-scheduler.service';
import { SchedulerHeaderService, ACTIVITIES_LOCKED_MESSAGE } from '../modules/production/scheduler-header/scheduler-header.service';
import * as schema from '../core/database/schema';
import { bootApp, buildDemoContext, inTenant } from './demo/harness';
import { createItemLookup } from './demo/batch-helpers';
import type { DemoContext } from './demo/chapter';

// The seeded Piggery LOB — the same constant batch-helpers.ts creates its batches under.
const PIGGERY_LOB_ID = '60000000-6000-6000-6000-000000000007';
const ROLLBACK = Symbol('verify-system-schedulers:rollback');
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`}`);
}

const today = () => new Date().toISOString().slice(0, 10);

async function scenario(ctx: DemoContext) {
  const cls = ctx.app.get(ClsService);
  const db = cls.get<MySql2Database<typeof schema>>('tenantDb')!;
  const batches = ctx.app.get(BatchService);
  const systemSchedulers = ctx.app.get(SystemSchedulerService);
  const schedulers = ctx.app.get(SchedulerHeaderService);
  const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, tenantId: ctx.tenantId, email: ctx.actor.email };

  // Whatever breed and stages this database holds: a breed whose lifecycle
  // carries GESTATION feed (so step 4 has lifecycle lines to fall back to),
  // and the move GESTATION -> FARROWING. Stage ids are the ones that breed's
  // lifecycle uses; step 5 then tries the stage's other id.
  const farm = ctx.demoFarms[0];
  if (!farm) throw new Error('No demo farm in this run.');
  const stageIdOf = async (code: string) => {
    const [row] = await db.select({ stage_id: schema.stageMaster.stage_id }).from(schema.stageMaster)
      .innerJoin(schema.breedLifecycleStages, eq(schema.breedLifecycleStages.stage_id, schema.stageMaster.stage_id))
      .where(and(eq(schema.stageMaster.lob_id, PIGGERY_LOB_ID), eq(schema.stageMaster.stage_code, code), isNull(schema.stageMaster.deleted_at), eq(schema.breedLifecycleStages.is_active, true)))
      .limit(1);
    if (!row) throw new Error(`No Piggery stage ${code} with a breed lifecycle row.`);
    return row.stage_id;
  };
  const firstStageId = await stageIdOf('GESTATION');
  const nextStageId = await stageIdOf('FARROWING');
  const [lifecycle] = await db.select({ breed_id: schema.breedLifecycleStages.breed_id }).from(schema.breedLifecycleStages)
    .where(and(eq(schema.breedLifecycleStages.stage_id, firstStageId), eq(schema.breedLifecycleStages.is_active, true)))
    .limit(1);
  if (!lifecycle) throw new Error('No breed carries a GESTATION lifecycle row.');
  const breed = { breedId: lifecycle.breed_id };
  const [feed] = await db.select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name })
    .from(schema.itemMaster)
    .where(and(eq(schema.itemMaster.company_id, ctx.companyId), eq(schema.itemMaster.item_type, 'FEED'), eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at)))
    .limit(1);
  if (!feed) throw new Error('No active FEED item in the company.');
  const piglet = await createItemLookup(db, ctx.companyId)('Weaned Feeder Piglet (7-10kg)');

  const linesOf = async (batchId: string, stageId: string) => {
    const [header] = await db.select().from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.stage_id, stageId)));
    if (!header) return { header: null, lines: [] as Array<typeof schema.schedulerLine.$inferSelect> };
    const lines = await db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.scheduler_id, header.scheduler_id));
    return { header, lines: lines.sort((a, b) => a.line_seq - b.line_seq) };
  };
  const makeBatch = async (ref: string, schedulerSource?: 'SYSTEM' | 'EMPTY', stageId = firstStageId) => {
    const created = await batches.create({
      company_id: ctx.companyId, lob_id: PIGGERY_LOB_ID, tracking_mode: 'BATCH_WISE', costing_method: 'BIO_ASSET',
      breed_id: breed.breedId, stage_id: stageId, auto_generate_scheduler: true, start_date: today(),
      opening_quantity: 20, uom: 'HEAD', remarks: ref,
      input_lines: [{ item_id: piglet.item_id, quantity: 20, uom: 'HEAD' }],
      ...(schedulerSource ? { scheduler_source: schedulerSource } : {}),
    } as any, ctx.tenantId, actor as any);
    await db.update(schema.batchHeader).set({ farm_id: farm.farmId }).where(eq(schema.batchHeader.batch_id, created.batch_id));
    return created.batch_id as string;
  };
  const feedLine = (name: string, qty: number) => ({
    line_type: 'CONSUMPTION', activity_name: name, occurrence: 'DAILY', start_day: 1, end_day: 30,
    item_id: feed.item_id, standard_qty: qty, qty_basis: 'PER_HEAD', is_mandatory: true,
  });

  console.log('\n[1] Creating system schedulers');
  const firstAll = await systemSchedulers.create({
    company_id: ctx.companyId, stage_id: firstStageId, scheduler_name: 'REHEARSAL Gestation — every breed',
    lines: [feedLine('Gestation feed (every breed)', 0.5)],
  }, ctx.tenantId, actor);
  const firstOwn = await systemSchedulers.create({
    company_id: ctx.companyId, stage_id: firstStageId, breed_id: breed.breedId, scheduler_name: 'REHEARSAL Gestation — own breed', data_entry_level: 'PEN',
    lines: [
      feedLine('Gestation feed (own breed)', 0.6),
      { line_type: 'DESCRIPTIVE', activity_name: 'Gestation weigh-in', occurrence: 'WEEKLY', day_of_week: 1, start_day: 7, kpi_metric: 'BODY_WEIGHT', kpi_uom: 'KG', capture_per: 'AVERAGE', std_value: 12 },
    ],
  }, ctx.tenantId, actor);
  await systemSchedulers.addLine(firstOwn.system_scheduler_id, {
    line_type: 'CONSUMPTION', activity_name: 'Gestation dose', occurrence: 'CUSTOM', custom_days: [3, 10], start_day: 1,
    item_id: feed.item_id, standard_qty: 1, qty_basis: 'PER_HEAD',
  } as any, ctx.tenantId, actor);
  const nextSched = await systemSchedulers.create({
    company_id: ctx.companyId, stage_id: nextStageId, scheduler_name: 'REHEARSAL Farrowing', lines: [feedLine('Farrowing feed', 1.2)],
  }, ctx.tenantId, actor);
  check('stage code stored from the stage', [firstAll.stage_code, nextSched.stage_code], ['GESTATION', 'FARROWING']);
  check('own-breed system scheduler holds 3 lines, the custom one on days 3 and 10',
    [(await systemSchedulers.findOne(firstOwn.system_scheduler_id)).lines.length,
      (await systemSchedulers.findOne(firstOwn.system_scheduler_id)).lines.find((l) => l.activity_name === 'Gestation dose')!.custom_days.map((d) => d.day_number).sort()],
    [3, [10, 3].sort()]);
  let refused = '';
  try {
    await systemSchedulers.create({ company_id: ctx.companyId, stage_id: firstStageId, scheduler_name: 'dup' }, ctx.tenantId, actor);
  } catch (err) {
    refused = err instanceof ConflictException ? 'ConflictException' : String(err);
  }
  check('a second every-breed system scheduler for GESTATION is refused', refused, 'ConflictException');
  const match = await systemSchedulers.match({ companyId: ctx.companyId, stageIds: [firstStageId, nextStageId], breedId: breed.breedId });
  check('match: the own-breed one for GESTATION, the every-breed one for FARROWING',
    match.map((m) => [m.stage_id === firstStageId ? 'GESTATION' : 'FARROWING', m.scheduler_name, m.line_count]),
    [['GESTATION', 'REHEARSAL Gestation — own breed', 3], ['FARROWING', 'REHEARSAL Farrowing', 1]]);
  const byCode = await systemSchedulers.match({ companyId: ctx.companyId, lobId: PIGGERY_LOB_ID, stageCodes: ['FARROWING'], breedId: breed.breedId });
  check('match by LOB + stage code (what a transfer sends) finds the same one', byCode.map((m) => [m.stage_code, m.scheduler_name]), [['FARROWING', 'REHEARSAL Farrowing']]);

  console.log('\n[2] Batch created with no answer, and with SYSTEM');
  for (const answer of [undefined, 'SYSTEM'] as const) {
    const batchId = await makeBatch(`REHEARSAL system scheduler ${answer ?? 'unasked'}`, answer);
    const { header, lines } = await linesOf(batchId, firstStageId);
    check(`${answer ?? 'unasked'}: header records the own-breed system scheduler and its data entry level`,
      [header?.system_scheduler_id === firstOwn.system_scheduler_id, header?.data_entry_level], [true, 'PEN']);
    check(`${answer ?? 'unasked'}: its 3 lines are copied, renumbered, marked SYSTEM`,
      lines.map((l) => [l.line_seq, l.activity_name, l.source, l.stage_id === firstStageId]),
      [[1, 'Gestation feed (own breed)', 'SYSTEM', true], [2, 'Gestation weigh-in', 'SYSTEM', true], [3, 'Gestation dose', 'SYSTEM', true]]);
    const dose = lines.find((l) => l.activity_name === 'Gestation dose')!;
    const days = await db.select().from(schema.schedulerLineCustomDays).where(eq(schema.schedulerLineCustomDays.line_id, dose.line_id));
    check(`${answer ?? 'unasked'}: the custom days are copied with the line`, days.map((d) => d.day_number).sort(), [10, 3].sort());
  }

  console.log('\n[3] Batch created with EMPTY (the user said No)');
  {
    const batchId = await makeBatch('REHEARSAL system scheduler EMPTY', 'EMPTY');
    const { header, lines } = await linesOf(batchId, firstStageId);
    check('EMPTY: a header exists, with no lines and no origin', [!!header, lines.length, header?.system_scheduler_id], [true, 0, null]);
  }

  console.log('\n[4] Every system scheduler switched off — the breed lifecycle fills the stage as before');
  {
    for (const s of [firstAll, firstOwn]) await systemSchedulers.update(s.system_scheduler_id, { is_active: false }, ctx.tenantId, actor);
    const batchId = await makeBatch('REHEARSAL system scheduler off');
    const { header, lines } = await linesOf(batchId, firstStageId);
    check('off: no origin recorded', header?.system_scheduler_id, null);
    check('off: lines come from the breed lifecycle (source AUTO), not the system schedulers',
      [lines.length > 0, lines.every((l) => l.source === 'AUTO')], [true, true]);
    for (const s of [firstAll, firstOwn]) await systemSchedulers.update(s.system_scheduler_id, { is_active: true }, ctx.tenantId, actor);
  }

  console.log("\n[5] A system scheduler on one of the stage's two ids matches a batch on the other");
  {
    const [firstStage] = await db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, firstStageId));
    const [twin] = await db.select({ stage_id: schema.stageMaster.stage_id }).from(schema.stageMaster)
      .where(and(eq(schema.stageMaster.lob_id, firstStage.lob_id), eq(schema.stageMaster.stage_code, firstStage.stage_code), ne(schema.stageMaster.stage_id, firstStageId), isNull(schema.stageMaster.deleted_at)));
    if (!twin) {
      console.log('  SKIP no second GESTATION row in this database');
    } else {
      const batchId = await makeBatch('REHEARSAL system scheduler twin stage', undefined, twin.stage_id);
      const { header, lines } = await linesOf(batchId, twin.stage_id);
      check('twin: the batch on the other GESTATION id still copies the own-breed system scheduler',
        [header?.system_scheduler_id === firstOwn.system_scheduler_id, lines.length], [true, 3]);
    }
  }

  console.log('\n[6] Stage transfer GESTATION → FARROWING');
  for (const answer of ['SYSTEM', 'EMPTY'] as const) {
    const batchId = await makeBatch(`REHEARSAL transfer ${answer}`);
    await batches.activate(batchId, ctx.tenantId);
    await batches.transferStage(batchId, { to_stage_code: 'FARROWING', remarks: 'rehearsal', scheduler_source: answer }, ctx.tenantId, actor as any);
    const { header, lines } = await linesOf(batchId, nextStageId);
    check(`transfer ${answer}: FARROWING scheduler ${answer === 'SYSTEM' ? 'copies the Farrowing system scheduler' : 'starts empty'}`,
      [!!header, header?.system_scheduler_id === nextSched.system_scheduler_id, lines.map((l) => l.activity_name)],
      answer === 'SYSTEM' ? [true, true, ['Farrowing feed']] : [true, false, []]);
  }

  console.log('\n[7] A batch scheduler\'s activities are fixed once it exists; a system scheduler is still filled from one');
  {
    // 14 Oct (Rishi): a scheduler's activities are set when it is created — copying in, adding or removing is refused.
    const [emptyBatch] = await db.select({ batch_id: schema.batchHeader.batch_id }).from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, 'REHEARSAL system scheduler EMPTY')).limit(1);
    const { header: emptyHeader } = await linesOf(emptyBatch.batch_id, firstStageId);
    const refusal = async (attempt: () => Promise<unknown>) => {
      try { await attempt(); return 'allowed'; } catch (err) { return err instanceof Error ? err.message : String(err); }
    };
    check('copying activities into an existing batch scheduler is refused',
      await refusal(() => schedulers.copyLinesInto(emptyHeader!.scheduler_id, { source_type: 'SYSTEM', source_id: firstOwn.system_scheduler_id }, ctx.tenantId, actor)),
      ACTIVITIES_LOCKED_MESSAGE);
    check('adding a line to an existing batch scheduler is refused',
      await refusal(() => schedulers.addLine(emptyHeader!.scheduler_id, feedLine('Late feed', 0.4) as any, ctx.tenantId, actor)),
      ACTIVITIES_LOCKED_MESSAGE);

    // An empty system scheduler (a template, still editable) filled from a batch's scheduler.
    const donorBatch = await makeBatch('REHEARSAL copy donor', 'SYSTEM');
    const donor = await linesOf(donorBatch, firstStageId);
    const template = await systemSchedulers.create({ company_id: ctx.companyId, stage_id: nextStageId, breed_id: breed.breedId, scheduler_name: 'REHEARSAL from a batch' }, ctx.tenantId, actor);
    const filled = await systemSchedulers.copyLinesInto(template.system_scheduler_id, { source_type: 'BATCH', source_id: donor.header!.scheduler_id }, ctx.tenantId, actor);
    check('copy into an empty system scheduler from a batch: 3 lines, custom days kept',
      [filled.lines.map((l) => [l.line_seq, l.activity_name]), filled.lines.find((l) => l.activity_name === 'Gestation dose')!.custom_days.map((d) => d.day_number).sort()],
      [[[1, 'Gestation feed (own breed)'], [2, 'Gestation weigh-in'], [3, 'Gestation dose']], [10, 3].sort()]);
    await systemSchedulers.remove(template.system_scheduler_id, ctx.tenantId, actor);
  }

  console.log('\n[8] Deleting a system scheduler leaves the batch copies alone');
  {
    const [copied] = await db.select({ scheduler_id: schema.schedulerHeader.scheduler_id }).from(schema.schedulerHeader)
      .where(eq(schema.schedulerHeader.system_scheduler_id, nextSched.system_scheduler_id)).limit(1);
    await systemSchedulers.remove(nextSched.system_scheduler_id, ctx.tenantId, actor);
    const kept = await db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.scheduler_id, copied.scheduler_id));
    const gone = await db.select().from(schema.systemSchedulerLine).where(eq(schema.systemSchedulerLine.system_scheduler_id, nextSched.system_scheduler_id));
    check('delete: the batch copy keeps its line, the system lines are gone', [kept.length, gone.length], [1, 0]);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} — rolling back, nothing was kept.`);
  throw ROLLBACK;
}

async function main() {
  const app = await bootApp();
  try {
    const ctx = await buildDemoContext(app, () => undefined, 'light');
    await inTenant(ctx, async () => {
      const cls = ctx.app.get(ClsService);
      try {
        await withTenantTransaction(cls, () => scenario(ctx));
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }
    });
  } finally {
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
}

void main().then(
  () => process.exit(failures === 0 ? 0 : 1),
  (err) => { console.error(err instanceof Error ? err.stack ?? err.message : err); process.exit(1); },
);
