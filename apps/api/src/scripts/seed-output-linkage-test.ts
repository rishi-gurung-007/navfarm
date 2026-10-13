/**
 * Test data for the batch / animal / output linkage work (Phases 1–7 of
 * docs/superpowers/plans/2026-10-09-batch-animal-output-linkage.md): a small, fresh set of batches on farm MUL100 that
 * puts every changed flow one step away, so it can be checked in the app. The walk-through that uses it is
 * docs/TESTING-2026-10-09-batch-output-linkage.md.
 *
 * Everything goes through the services, as the demo chapters do (scripts/demo/harness.ts): one goods receipt, each
 * animal by AnimalService.create, the batches by BatchService.create + activate, two open litters and one semen lot by
 * BreedingService. Nothing here is a client fact — the batches, animals and the few scheduler lines it adds are test
 * fixtures, every one named "TEST".
 *
 * What it builds (D = --date, default today; the animals are bought in on D-150, the sows mated (S1 on D-114, S2 and
 * S3 on D-136 — a litter needs its mating) and the two litters farrowed on D-21):
 *   TEST sow herd   ANIMAL_WISE  S1 FARROWING (no litter: farrow her from data entry)
 *                                S2 FARROWING (litter of 11 in a piglet lot: wean her from data entry)
 *                                S3 LACTATION (litter of 10 in a piglet lot: wean her on the Breeding screen)
 *                                S4 GESTATION (record her death)   S5 GESTATION (AI-mate her from the semen lot)
 *                                S6 FLUSH gilt (send her to the gilt pool from a data-entry TRANSFER line)
 *                                S7 GESTATION, out of production since D-20 (cull her; her posted days raise the hold alert)
 *   TEST gilt pool  ANIMAL_WISE  G1 GILT_GROWER — has no FLUSH scheduler until S6 arrives
 *   TEST boar stud  ANIMAL_WISE  B1 BOAR_AI, with one semen lot of 20 doses already collected
 *   TEST weaners A  BATCH_WISE   20 head at WEANER (where weaned piglets go; head-count transfer, mortality)
 *   TEST weaners B  BATCH_WISE   12 head at WEANER (head-count transfer target)
 * and adds, where the generated scheduler has none: an output line on the sows' FARROWING stage, a TRANSFER line on
 * FLUSH, a semen output line on BOAR_AI, and an output line on the weaners' WEANER stage.
 *
 * Usage (read-only by default, as every db-* script):
 *   pnpm nx run api:db-seed-output-linkage-test                         # plan: resolves everything, writes nothing
 *   pnpm nx run api:db-seed-output-linkage-test -- --verify             # builds it all in one transaction, rolls back
 *   pnpm nx run api:db-seed-output-linkage-test -- --apply              # commits
 *   pnpm nx run api:db-seed-output-linkage-test -- --apply --date=2026-10-12   # for the day you will test on
 * It refuses to run twice for the same date. Take a backup first (mysqldump nf_devco) — that is the way back.
 */
import { and, eq, isNull, like } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import * as masterSchema from '../core/database/master-schema';
import { MASTER_CONNECTION } from '../core/database/database.module';
import { withTenantTransaction } from '../common/tenant-transaction';
import { bootApp, inTenant } from './demo/harness';
import type { DemoContext } from './demo/chapter';
import { BatchService } from '../modules/production/batch/batch.service';
import { AnimalService } from '../modules/piggery/animal/animal.service';
import { GoodsReceiptService } from '../modules/inventory/goods-receipt/goods-receipt.service';
import { BreedingService } from '../modules/piggery/breeding/breeding.service';
import { SchedulerHeaderService } from '../modules/production/scheduler-header/scheduler-header.service';

const TENANT_CODE = 'devco';
const COMPANY_CODE = 'TRIPLEC';
const ACTOR_EMAIL = 'company.admin@triplec.local';
const FARM_CODE = 'MUL100';
const SOW_SHED = 'MUL100/SHED-003';
const OTHER_SHED = 'MUL100/SHED-002';
const PIGGERY_LOB_ID = '60000000-6000-6000-6000-000000000007';

const ITEM = {
  sow: 'Mature Parity Breeding Sow',
  gilt: 'Replacement Breeding Gilt',
  boar: 'Mature Herd Sire Boar',
  suckling: 'Suckling Live Piglet (0-4 Wks)',
  weaned: 'Weaned Feeder Piglet (7-10kg)',
  semen: 'BOAR semen',
} as const;

type Kind = 'SOW' | 'GILT' | 'BOAR';
interface TestAnimal {
  key: string;
  kind: Kind;
  stage: string;
  shed: string;
  batch: 'sows' | 'gilts' | 'boars';
  purpose: string;
}

const ANIMALS: TestAnimal[] = [
  { key: 'S1', kind: 'SOW', stage: 'FARROWING', shed: SOW_SHED, batch: 'sows', purpose: 'farrow her from data entry (choose the piglet item)' },
  { key: 'S2', kind: 'SOW', stage: 'FARROWING', shed: SOW_SHED, batch: 'sows', purpose: 'wean her litter from data entry, sending the piglets to TEST weaners A' },
  { key: 'S3', kind: 'SOW', stage: 'LACTATION', shed: SOW_SHED, batch: 'sows', purpose: 'wean her litter on the Breeding screen' },
  { key: 'S4', kind: 'SOW', stage: 'GESTATION', shed: SOW_SHED, batch: 'sows', purpose: 'record her death' },
  { key: 'S5', kind: 'SOW', stage: 'GESTATION', shed: SOW_SHED, batch: 'sows', purpose: 'AI-mate her using the semen lot' },
  { key: 'S6', kind: 'GILT', stage: 'FLUSH', shed: SOW_SHED, batch: 'sows', purpose: 'send her to TEST gilt pool from the data-entry TRANSFER line' },
  { key: 'S7', kind: 'SOW', stage: 'GESTATION', shed: SOW_SHED, batch: 'sows', purpose: 'out of production since D-20: cull her (posting her day raises the 14-day hold alert)' },
  { key: 'G1', kind: 'GILT', stage: 'GILT_GROWER', shed: OTHER_SHED, batch: 'gilts', purpose: 'keeps the gilt pool open (it has no FLUSH scheduler until S6 arrives)' },
  { key: 'B1', kind: 'BOAR', stage: 'BOAR_AI', shed: OTHER_SHED, batch: 'boars', purpose: 'collect semen from data entry (choose the semen item)' },
];

const FACTS: Record<Kind, { gender: 'F' | 'M'; item: string; ageWeeks: number; teats?: number }> = {
  SOW: { gender: 'F', item: ITEM.sow, ageWeeks: 104, teats: 14 },
  GILT: { gender: 'F', item: ITEM.gilt, ageWeeks: 30, teats: 14 },
  BOAR: { gender: 'M', item: ITEM.boar, ageWeeks: 88 },
};

class RollBack extends Error {}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  // `pnpm nx run … -- --apply` can hand the script a bare `--` as well.
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  const dateArg = args.find((a) => a.startsWith('--date='))?.slice('--date='.length);
  if (args.some((a) => a !== '--apply' && a !== '--verify' && !a.startsWith('--date=')) || (apply && verify)) {
    throw new Error('Use no flags (plan only), --verify, or --apply; optionally --date=YYYY-MM-DD.');
  }
  const today = new Date().toISOString().slice(0, 10);
  const testDate = dateArg ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testDate)) throw new Error(`--date must be YYYY-MM-DD, not '${testDate}'.`);
  if (testDate > today) throw new Error(`--date ${testDate} is in the future: data cannot be posted for it yet.`);
  const entryDate = addDays(testDate, -150);
  const farrowDate = addDays(testDate, -21);
  const matedS1 = addDays(testDate, -114);
  const matedLitters = addDays(farrowDate, -115);
  const outOfProduction = addDays(testDate, -20);
  const token = `TEST-OUTPUT ${testDate}`;
  const mode = apply ? 'APPLY' : verify ? 'VERIFY (rolled back)' : 'PLAN (read-only)';

  const app = await bootApp();
  const log = (line: string) => console.log(`[seed-output-linkage-test] ${line}`);
  try {
    const masterDb = app.get<MySql2Database<typeof masterSchema>>(MASTER_CONNECTION);
    const [tenant] = await masterDb
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_code, TENANT_CODE))
      .limit(1);
    if (!tenant) throw new Error(`Tenant '${TENANT_CODE}' not found in the master database.`);
    const ctx = { app, tenantId: tenant.tenant_id, log } as unknown as DemoContext;

    await inTenant(ctx, async () => {
      const cls = app.get(ClsService);
      const db = () => cls.get<MySql2Database<typeof schema>>('tenantDb');
      log(`Mode: ${mode} · tenant ${TENANT_CODE} · test date ${testDate} (animals bought ${entryDate}, litters farrowed ${farrowDate})`);

      // ── Masters, by code or name — never guessed. A missing one stops the run.
      const [company] = await db().select().from(schema.companyMaster).where(eq(schema.companyMaster.company_code, COMPANY_CODE)).limit(1);
      if (!company) throw new Error(`Company '${COMPANY_CODE}' not found.`);
      const companyId = company.company_id;
      const [actorRow] = await db().select().from(schema.userMaster).where(eq(schema.userMaster.email, ACTOR_EMAIL)).limit(1);
      if (!actorRow) throw new Error(`User '${ACTOR_EMAIL}' not found.`);
      const actor = { userId: actorRow.user_id, userType: 'COMPANY_ADMIN', tenantId: tenant.tenant_id, email: actorRow.email };

      const location = async (code: string) => {
        const [row] = await db().select().from(schema.locationMaster).where(eq(schema.locationMaster.location_code, code)).limit(1);
        if (!row) throw new Error(`Location '${code}' not found.`);
        return row;
      };
      const farm = await location(FARM_CODE);
      const sheds = { [SOW_SHED]: await location(SOW_SHED), [OTHER_SHED]: await location(OTHER_SHED) };
      const pensOf = async (shedCode: string) =>
        (await db()
          .select({ location_id: schema.locationMaster.location_id })
          .from(schema.locationMaster)
          .where(and(like(schema.locationMaster.location_code, `${shedCode}/PEN-%`), eq(schema.locationMaster.is_active, true)))
          .orderBy(schema.locationMaster.location_code)).map((p) => p.location_id);
      const pens = { [SOW_SHED]: await pensOf(SOW_SHED), [OTHER_SHED]: await pensOf(OTHER_SHED) };
      for (const [code, list] of Object.entries(pens)) if (!list.length) throw new Error(`Shed '${code}' has no pens.`);

      // The breed the company's herd is registered under (most animals) among those with a lifecycle, so the test
      // batches get the same generated scheduler lines as the demo herd.
      const lifecycleRows = await db().select({ breed_id: schema.breedLifecycleStages.breed_id }).from(schema.breedLifecycleStages);
      const withLifecycle = new Set(lifecycleRows.map((r) => r.breed_id));
      const herd = await db()
        .select({ breed_id: schema.animalRegister.breed_id })
        .from(schema.animalRegister)
        .where(eq(schema.animalRegister.company_id, companyId));
      const perBreed = new Map<string, number>();
      for (const r of herd) if (r.breed_id && withLifecycle.has(r.breed_id)) perBreed.set(r.breed_id, (perBreed.get(r.breed_id) ?? 0) + 1);
      const breedId = [...perBreed.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!breedId) throw new Error('No registered animal has a breed with lifecycle stages — the schedulers would be born empty.');

      const stage = async (code: string) => {
        const [row] = await db()
          .select({ stage_id: schema.stageMaster.stage_id })
          .from(schema.stageMaster)
          .where(and(
            eq(schema.stageMaster.stage_code, code),
            eq(schema.stageMaster.company_id, companyId),
            eq(schema.stageMaster.lob_id, PIGGERY_LOB_ID),
            eq(schema.stageMaster.is_active, true),
            isNull(schema.stageMaster.deleted_at),
          ))
          .limit(1);
        if (!row) throw new Error(`Stage '${code}' not found for the company.`);
        return row.stage_id;
      };
      const stageIds = new Map<string, string>();
      for (const code of ['FARROWING', 'LACTATION', 'GESTATION', 'FLUSH', 'GILT_GROWER', 'BOAR_AI', 'WEANER', 'DRY_SOW']) {
        stageIds.set(code, await stage(code));
      }

      const item = async (name: string) => {
        const [row] = await db()
          .select({ item_id: schema.itemMaster.item_id, standard_cost: schema.itemMaster.standard_cost, uom: schema.itemMaster.uom_primary })
          .from(schema.itemMaster)
          .where(and(
            eq(schema.itemMaster.item_name, name),
            eq(schema.itemMaster.company_id, companyId),
            eq(schema.itemMaster.is_active, true),
            isNull(schema.itemMaster.deleted_at),
          ))
          .limit(1);
        if (!row) throw new Error(`Item '${name}' not found for the company.`);
        return row;
      };
      const items = Object.fromEntries(
        await Promise.all(Object.entries(ITEM).map(async ([k, name]) => [k, await item(name)] as const)),
      ) as Record<keyof typeof ITEM, Awaited<ReturnType<typeof item>>>;

      const [already] = await db()
        .select({ batch_no: schema.batchHeader.batch_no })
        .from(schema.batchHeader)
        .where(like(schema.batchHeader.remarks, `${token}%`))
        .limit(1);
      if (already) {
        throw new Error(`Test data for ${testDate} already exists (${already.batch_no}). Restore your backup, or use another --date.`);
      }

      log(`Farm ${FARM_CODE}; sheds ${SOW_SHED} (${pens[SOW_SHED].length} pens), ${OTHER_SHED} (${pens[OTHER_SHED].length} pens); breed ${breedId}`);
      log('Will create:');
      log(`  goods receipt ${token} (${ANIMALS.length} head) into ${FARM_CODE}, posted ${entryDate}`);
      for (const a of ANIMALS) log(`  ${a.key.padEnd(3)} ${a.kind.padEnd(5)} at ${a.stage.padEnd(12)} → ${a.purpose}`);
      log('  batches: TEST sow herd, TEST gilt pool, TEST boar stud (animal-wise); TEST weaners A (20), TEST weaners B (12) (batch-wise, WEANER)');
      log(`  matings (AI): S1 on ${matedS1}; S2 and S3 on ${matedLitters}`);
      log(`  litters: S2 (11 live, 1 stillborn) and S3 (10 live) farrowed ${farrowDate}, each held as a piglet lot`);
      log(`  S7 out of production since ${outOfProduction}`);
      log(`  semen: one collection from B1 on ${testDate}, 20 doses of '${ITEM.semen}'`);
      if (!apply && !verify) {
        log('Plan only — nothing written. Run with --verify, then --apply.');
        return;
      }

      const batches = app.get(BatchService);
      const animals = app.get(AnimalService);
      const receipts = app.get(GoodsReceiptService);
      const breeding = app.get(BreedingService);
      const schedulers = app.get(SchedulerHeaderService);
      const tenantId = tenant.tenant_id;

      const summary: string[] = [];
      try {
        await withTenantTransaction(cls, async () => {
          // ── The purchase the animals' cost is read from, one line per kind.
          const counts = new Map<Kind, number>();
          for (const a of ANIMALS) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
          const itemOf = (kind: Kind) => items[kind === 'SOW' ? 'sow' : kind === 'GILT' ? 'gilt' : 'boar'];
          const receipt = await receipts.create(
            {
              company_id: companyId,
              warehouse_id: farm.location_id,
              posting_date: entryDate,
              external_reference_no: token,
              remarks: `${token} — test breeding stock (batch/output linkage walk-through)`,
              lines: [...counts.entries()].map(([kind, quantity]) => ({
                item_id: itemOf(kind).item_id,
                quantity,
                uom: 'HEAD',
                rate: itemOf(kind).standard_cost == null ? undefined : Number(itemOf(kind).standard_cost),
                lot_no: `TEST-${testDate}-${kind}`,
              })),
            } as any,
            tenantId,
            actor,
          );
          await receipts.post(receipt.receipt_id, tenantId, actor);

          // ── The animals, one by one, each standing in a pen of its shed at its own stage.
          const created = new Map<string, { animal_id: string; animal_code: string }>();
          const penCursor = new Map<string, number>();
          for (const a of ANIMALS) {
            const facts = FACTS[a.kind];
            const pick = penCursor.get(a.shed) ?? 0;
            penCursor.set(a.shed, pick + 1);
            const row: any = await animals.create(
              {
                company_id: companyId,
                animal_type: a.kind,
                breed_id: breedId,
                gender: facts.gender,
                entry_type: 'PURCHASED_LOCAL',
                entry_date: entryDate,
                age_at_entry_weeks: facts.ageWeeks,
                source_receipt_id: receipt.receipt_id,
                item_id: itemOf(a.kind).item_id,
                rfid_tag: `TST-${testDate}-${a.key}`,
                current_location_id: pens[a.shed][pick % pens[a.shed].length],
                current_stage_id: stageIds.get(a.stage)!,
                no_of_teats: facts.teats,
              } as any,
              tenantId,
              actor,
            );
            created.set(a.key, { animal_id: row.animal_id, animal_code: row.animal_code });
          }

          // ── The batches. A batch's stages each get a scheduler at activation; they begin on the test date.
          const animalWise = async (name: string, group: TestAnimal['batch'], shedCode: string) => {
            const b: any = await batches.create(
              {
                company_id: companyId,
                lob_id: PIGGERY_LOB_ID,
                tracking_mode: 'ANIMAL_WISE',
                costing_method: 'BIO_ASSET',
                breed_id: breedId,
                shed_id: sheds[shedCode].location_id,
                start_date: testDate,
                uom: 'HEAD',
                remarks: `${token} — ${name}`,
                animal_ids: ANIMALS.filter((a) => a.batch === group).map((a) => created.get(a.key)!.animal_id),
              } as any,
              tenantId,
              actor,
            );
            await db().update(schema.batchHeader).set({ farm_id: farm.location_id }).where(eq(schema.batchHeader.batch_id, b.batch_id));
            await batches.activate(b.batch_id, tenantId, actor);
            await db().update(schema.schedulerHeader).set({ effective_from: testDate }).where(eq(schema.schedulerHeader.batch_id, b.batch_id));
            return { batch_id: b.batch_id as string, batch_no: b.batch_no as string };
          };
          const batchWise = async (name: string, quantity: number) => {
            const b: any = await batches.create(
              {
                company_id: companyId,
                lob_id: PIGGERY_LOB_ID,
                tracking_mode: 'BATCH_WISE',
                costing_method: 'BIO_ASSET',
                breed_id: breedId,
                stage_id: stageIds.get('WEANER')!,
                shed_id: sheds[SOW_SHED].location_id,
                auto_generate_scheduler: true,
                start_date: testDate,
                opening_quantity: quantity,
                uom: 'HEAD',
                remarks: `${token} — ${name}`,
                input_lines: [{
                  item_id: items.weaned.item_id,
                  quantity,
                  uom: 'HEAD',
                  rate: items.weaned.standard_cost == null ? undefined : Number(items.weaned.standard_cost),
                }],
              } as any,
              tenantId,
              actor,
            );
            await db().update(schema.batchHeader).set({ farm_id: farm.location_id }).where(eq(schema.batchHeader.batch_id, b.batch_id));
            await batches.activate(b.batch_id, tenantId, actor);
            return { batch_id: b.batch_id as string, batch_no: b.batch_no as string };
          };
          const sowHerd = await animalWise('sow herd', 'sows', SOW_SHED);
          const giltPool = await animalWise('gilt pool', 'gilts', OTHER_SHED);
          const boarStud = await animalWise('boar stud', 'boars', OTHER_SHED);
          const weanersA = await batchWise('weaners A', 20);
          const weanersB = await batchWise('weaners B', 12);

          // ── The few lines the walk-through needs, only where the generated scheduler has none of the kind.
          const schedulerOf = async (batchId: string, stageCode: string) => {
            const [row] = await db()
              .select({ scheduler_id: schema.schedulerHeader.scheduler_id })
              .from(schema.schedulerHeader)
              .innerJoin(schema.stageMaster, eq(schema.schedulerHeader.stage_id, schema.stageMaster.stage_id))
              .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.stageMaster.stage_code, stageCode)))
              .limit(1);
            if (!row) throw new Error(`No ${stageCode} scheduler on batch ${batchId}.`);
            return row.scheduler_id;
          };
          const ensureLine = async (batchId: string, stageCode: string, lineType: 'OUTPUT' | 'TRANSFER', line: Record<string, unknown>) => {
            const schedulerId = await schedulerOf(batchId, stageCode);
            const [has] = await db()
              .select({ line_id: schema.schedulerLine.line_id })
              .from(schema.schedulerLine)
              .where(and(eq(schema.schedulerLine.scheduler_id, schedulerId), eq(schema.schedulerLine.line_type, lineType), eq(schema.schedulerLine.is_active, true)))
              .limit(1);
            if (has) return 'kept the generated line';
            await schedulers.addLine(
              schedulerId,
              { line_type: lineType, occurrence: 'DAILY', start_day: 1, is_mandatory: false, standard_qty: 1, ...line } as any,
              tenantId,
              actor,
            );
            return `added '${line.activity_name}'`;
          };
          summary.push(`  sow herd FARROWING output:  ${await ensureLine(sowHerd.batch_id, 'FARROWING', 'OUTPUT', { activity_name: 'TEST — Piglet output', item_id: items.suckling.item_id, output_basis: 'PER_SOW' })}`);
          summary.push(`  sow herd FLUSH transfer:    ${await ensureLine(sowHerd.batch_id, 'FLUSH', 'TRANSFER', { activity_name: 'TEST — Move to gilt pool', item_id: items.gilt.item_id })}`);
          summary.push(`  boar stud BOAR_AI output:   ${await ensureLine(boarStud.batch_id, 'BOAR_AI', 'OUTPUT', { activity_name: 'TEST — Semen collection', item_id: items.semen.item_id, output_basis: 'PER_SOW' })}`);
          summary.push(`  weaners A WEANER output:    ${await ensureLine(weanersA.batch_id, 'WEANER', 'OUTPUT', { activity_name: 'TEST — Weaner output', item_id: items.weaned.item_id, output_basis: 'PER_BATCH' })}`);

          // ── Each litter comes from a mating (G9): S1's is due on the test date; S2's and S3's farrowed 21 days ago.
          const mate = async (key: string, date: string) =>
            breeding.recordMating(
              { company_id: companyId, sow_animal_id: created.get(key)!.animal_id, batch_id: sowHerd.batch_id, mating_type: 'AI', mating_date: date } as any,
              tenantId,
              actor,
            );
          await mate('S1', matedS1);
          await mate('S2', matedLitters);
          await mate('S3', matedLitters);
          // S7 is held out of production, for the cull (BBP-1).
          await animals.markOutOfProduction(created.get('S7')!.animal_id, { out_of_production_date: outOfProduction } as any, tenantId, actor);

          // ── Two litters still being nursed, each a piglet lot, and one semen lot to mate from.
          const litter = async (key: string, stageCode: string, live: number, stillborn: number) => {
            const result: any = await breeding.recordFarrowing(
              {
                company_id: companyId,
                sow_animal_id: created.get(key)!.animal_id,
                batch_id: sowHerd.batch_id,
                farrowing_date: farrowDate,
                piglets_born_live: live,
                piglets_stillborn: stillborn,
                piglet_item_id: items.suckling.item_id,
                piglet_stage_id: stageIds.get(stageCode)!,
              } as any,
              tenantId,
              actor,
            );
            return `${result.piglet_batch_no ?? '—'} lot ${result.piglet_lot_no ?? '—'}`;
          };
          const s2Lot = await litter('S2', 'FARROWING', 11, 1);
          const s3Lot = await litter('S3', 'LACTATION', 10, 0);
          const semen: any = await breeding.recordSemenCollection(
            {
              company_id: companyId,
              boar_animal_id: created.get('B1')!.animal_id,
              boar_batch_id: boarStud.batch_id,
              collection_date: testDate,
              doses_collected: 20,
              output_item_id: items.semen.item_id,
              // Test values, to see quality on the lot, its QR and the card (G8).
              volume_ml: 250,
              motility_pct: 85,
              concentration_m_per_ml: 300,
            } as any,
            tenantId,
            actor,
          );

          summary.unshift(
            `Batches: sow herd ${sowHerd.batch_no} · gilt pool ${giltPool.batch_no} · boar stud ${boarStud.batch_no} · weaners A ${weanersA.batch_no} · weaners B ${weanersB.batch_no}`,
            'Animals:',
            ...ANIMALS.map((a) => `  ${a.key.padEnd(3)} ${created.get(a.key)!.animal_code.padEnd(14)} ${a.stage.padEnd(12)} ${a.purpose}`),
            `Litters: S2 → ${s2Lot}; S3 → ${s3Lot}`,
            `Semen lot for mating: ${semen.lot_no ?? '—'} (20 doses)`,
            'Scheduler lines:',
          );
          if (verify) throw new RollBack();
        });
      } catch (err) {
        if (!(err instanceof RollBack)) throw err;
        for (const line of summary) log(line);
        log('VERIFY: everything above was built and then rolled back — nothing was written. Run with --apply to keep it.');
        return;
      }
      for (const line of summary) log(line);
      log(`APPLIED. Test on ${testDate}: pick that date in Data Entry. Walk-through: docs/TESTING-2026-10-09-batch-output-linkage.md`);
    });
  } finally {
    await app.close();
  }
}

// The app context leaves handles open (pools, timers); exit once the work is done, as demo-chapters.ts does.
main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[seed-output-linkage-test] FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
