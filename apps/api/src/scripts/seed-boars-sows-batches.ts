/**
 * Seed script: registers 2 boars and 2 sows, groups them into two ANIMAL_WISE batches (2 animals each),
 * adds daily data entry for the animals in each batch, collects boar semen through Data Entry output into inventory,
 * and performs artificial insemination (AI mating) of the sows from the collected semen lots.
 *
 * What it builds (two days back and yesterday, leaving today open for you to enter by hand):
 *   - two output items you collect from the boar batch: a single-boar AI dose and a pooled (multi-boar) AI dose;
 *   - 2 boars (Teaser Boar line, BOAR_AI, Boar House pens) in a Boar Stud batch;
 *   - 2 sows (Z-Line-Sow line, INSEMINATION, Dry Sow House pens) in a Sow Herd batch;
 *   - day 1: Boar 1 collects 25 doses on his own  -> lot A;
 *   - day 2: Boar 1 and Boar 2 collect 40 doses POOLED into one lot -> lot B (the data-entry "pool" selection);
 *   - AI: Sow 1 is served from lot A (one known sire), Sow 2 from lot B (pooled, no single sire recorded).
 *
 * Usage:
 *   pnpm nx run api:db-seed-boars-sows-batches                         # plan: resolves everything, writes nothing
 *   pnpm nx run api:db-seed-boars-sows-batches -- --verify             # builds in transaction and rolls back
 *   pnpm nx run api:db-seed-boars-sows-batches -- --apply              # commits to database
 *   pnpm nx run api:db-seed-boars-sows-batches -- --apply --date=YYYY-MM-DD
 */
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
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
import { BatchDailyDataService } from '../modules/production/batch-daily-data/batch-daily-data.service';
import { ItemService } from '../modules/master-data/item/item.service';

const TENANT_CODE = 'devco';
const COMPANY_CODE = 'TRIPLEC';
const ACTOR_EMAIL = 'company.admin@triplec.local';
const FARM_CODE = 'MUL100';
// A boar is housed in the Boar House and a sow awaiting service in the Dry Sow House. (Earlier this put the boars in the
// Dry Sow House and the sows in the Farrowing House, so a boar's card read as a sow's.)
const SOW_SHED = 'MUL100/SHED-002'; // MUL100 Dry Sow House
const BOAR_SHED = 'MUL100/SHED-006'; // MUL100 Boar House
const BOAR_BREED_NAME = 'Teaser Boar'; // the herd's active boar line (it carries the BOAR_AI stage)
const PIGGERY_LOB_ID = '60000000-6000-6000-6000-000000000007';

const ITEM_NAMES = {
  sow: 'Mature Parity Breeding Sow',
  boar: 'Mature Herd Sire Boar',
  semen: 'BOAR semen',
} as const;

// The output items collected from the boar batch, created if missing (same group as 'BOAR semen').
// Test fixtures of ours, not the client's: the names, and the 5-day shelf life given below so a lot carries an expiry.
// The standard cost is copied from the 'BOAR semen' item, not invented.
const OUTPUT_ITEMS = {
  single: { name: 'AI Semen Dose - Fresh (single boar)' },
  pooled: { name: 'AI Semen Dose - Pooled (multi-boar)' },
} as const;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

class RollBack extends Error {}

function parseArgs(): { apply: boolean; verify: boolean; date?: string } {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const verify = argv.includes('--verify');
  const dateArg = argv.find((a) => a.startsWith('--date='));
  const date = dateArg ? dateArg.slice('--date='.length) : undefined;
  return { apply, verify, date };
}

async function main() {
  const { apply, verify, date: cliDate } = parseArgs();
  const testDate = cliDate || new Date().toISOString().slice(0, 10);
  // Two days of entries, ending yesterday: today stays open for the person testing to enter a day by hand.
  const day1 = addDays(testDate, -2);
  const day2 = addDays(testDate, -1);
  const entryDate = day1;
  const token = `TEST-2BOAR-2SOW ${testDate}`;
  const mode = apply ? 'APPLY' : verify ? 'VERIFY (rolled back)' : 'PLAN (read-only)';

  const app = await bootApp();
  const log = (line: string) => console.log(`[seed-boars-sows-batches] ${line}`);

  try {
    const masterDb = app.get<MySql2Database<typeof masterSchema>>(MASTER_CONNECTION);
    const [tenant] = await masterDb
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_code, TENANT_CODE))
      .limit(1);
    if (!tenant) throw new Error(`Tenant '${TENANT_CODE}' not found in master database.`);

    const ctx = { app, tenantId: tenant.tenant_id, log } as unknown as DemoContext;

    await inTenant(ctx, async () => {
      const cls = app.get(ClsService);
      const db = () => cls.get<MySql2Database<typeof schema>>('tenantDb');
      log(`Mode: ${mode} · tenant ${TENANT_CODE} · test date ${testDate}`);

      const [company] = await db()
        .select()
        .from(schema.companyMaster)
        .where(eq(schema.companyMaster.company_code, COMPANY_CODE))
        .limit(1);
      if (!company) throw new Error(`Company '${COMPANY_CODE}' not found.`);
      const companyId = company.company_id;

      const [actorRow] = await db()
        .select()
        .from(schema.userMaster)
        .where(eq(schema.userMaster.email, ACTOR_EMAIL))
        .limit(1);
      if (!actorRow) throw new Error(`User '${ACTOR_EMAIL}' not found.`);
      const actor = { userId: actorRow.user_id, userType: 'COMPANY_ADMIN', tenantId: tenant.tenant_id, email: actorRow.email };

      const location = async (code: string) => {
        const [row] = await db().select().from(schema.locationMaster).where(eq(schema.locationMaster.location_code, code)).limit(1);
        if (!row) throw new Error(`Location '${code}' not found.`);
        return row;
      };

      const farm = await location(FARM_CODE);
      const sheds = { [SOW_SHED]: await location(SOW_SHED), [BOAR_SHED]: await location(BOAR_SHED) };

      const pensOf = async (shedCode: string) =>
        (await db()
          .select({ location_id: schema.locationMaster.location_id })
          .from(schema.locationMaster)
          .where(and(like(schema.locationMaster.location_code, `${shedCode}/PEN-%`), eq(schema.locationMaster.is_active, true)))
          .orderBy(schema.locationMaster.location_code)).map((p) => p.location_id);

      const pens = { [SOW_SHED]: await pensOf(SOW_SHED), [BOAR_SHED]: await pensOf(BOAR_SHED) };
      for (const [code, list] of Object.entries(pens)) {
        if (!list.length) throw new Error(`Shed '${code}' has no pens.`);
      }

      // Lifecycle breed
      const lifecycleRows = await db().select({ breed_id: schema.breedLifecycleStages.breed_id }).from(schema.breedLifecycleStages);
      const withLifecycle = new Set(lifecycleRows.map((r) => r.breed_id));
      const herd = await db().select({ breed_id: schema.animalRegister.breed_id }).from(schema.animalRegister).where(eq(schema.animalRegister.company_id, companyId));
      const perBreed = new Map<string, number>();
      for (const r of herd) if (r.breed_id && withLifecycle.has(r.breed_id)) perBreed.set(r.breed_id, (perBreed.get(r.breed_id) ?? 0) + 1);
      const breedId = [...perBreed.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!breedId) throw new Error('No registered animal has a breed with lifecycle stages.');
      // The boars are of a boar line, not the sows' line: a boar registered under a sow breed shows sow genetics on his
      // card and on the QR of every lot collected from him.
      const [boarBreed] = await db()
        .select({ breed_id: schema.breedMaster.breed_id })
        .from(schema.breedMaster)
        .where(and(
          eq(schema.breedMaster.breed_name, BOAR_BREED_NAME),
          eq(schema.breedMaster.is_active, true),
          isNull(schema.breedMaster.deleted_at),
        ))
        .limit(1);
      if (!boarBreed) throw new Error(`Boar breed '${BOAR_BREED_NAME}' not found (or not active).`);
      const boarBreedId = boarBreed.breed_id;

      // Stages
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

      const stageIds = {
        BOAR_AI: await stage('BOAR_AI'),
        INSEMINATION: await stage('INSEMINATION'),
      };

      // Items
      const item = async (name: string) => {
        const [row] = await db()
          .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, standard_cost: schema.itemMaster.standard_cost, uom: schema.itemMaster.uom_primary })
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

      const items = {
        sow: await item(ITEM_NAMES.sow),
        boar: await item(ITEM_NAMES.boar),
        semen: await item(ITEM_NAMES.semen),
      };

      // The output items collected from the boar batch: made here when missing, in the same group as 'BOAR semen'.
      const [semenTemplate] = await db()
        .select()
        .from(schema.itemMaster)
        .where(eq(schema.itemMaster.item_id, items.semen.item_id))
        .limit(1);
      const outputItemRow = async (name: string) => {
        const [row] = await db()
          .select({ item_id: schema.itemMaster.item_id })
          .from(schema.itemMaster)
          .where(and(eq(schema.itemMaster.item_name, name), eq(schema.itemMaster.company_id, companyId), isNull(schema.itemMaster.deleted_at)))
          .limit(1);
        return row ?? null;
      };
      const existingOutputItems = {
        single: await outputItemRow(OUTPUT_ITEMS.single.name),
        pooled: await outputItemRow(OUTPUT_ITEMS.pooled.name),
      };

      // Guard: check if test batch for this token already exists
      const [already] = await db()
        .select({ batch_no: schema.batchHeader.batch_no })
        .from(schema.batchHeader)
        .where(like(schema.batchHeader.remarks, `${token}%`))
        .limit(1);
      if (already) {
        throw new Error(`Data for token '${token}' already exists (${already.batch_no}). Use another --date or clear previous run.`);
      }

      log(`Farm ${FARM_CODE}; sheds ${BOAR_SHED} and ${SOW_SHED}; breed ${breedId}`);
      log('Plan:');
      log(`  - Output items for the boar batch (created when missing): '${OUTPUT_ITEMS.single.name}' (${existingOutputItems.single ? 'exists' : 'new'}), '${OUTPUT_ITEMS.pooled.name}' (${existingOutputItems.pooled ? 'exists' : 'new'})`);
      log('  - Goods receipt for 2 boars and 2 sows into MUL100');
      log(`  - Register 2 Boars (${BOAR_BREED_NAME}, BOAR_AI, Boar House pens) and 2 Sows (Z-Line-Sow, INSEMINATION, Dry Sow House pens)`);
      log('  - Create 2 ANIMAL_WISE batches: Boar Stud (2 boars) & Sow Herd (2 sows); activate both, schedulers from the breed lifecycle');
      log(`  - Day ${day1} data entry: Boar 1 collects 25 doses ALONE (output item: single) -> lot A in MUL100/STORE-001 with a QR pack`);
      log(`  - Day ${day2} data entry: Boar 1 + Boar 2 POOLED, 40 doses (output item: pooled) -> lot B naming both boars`);
      log('  - Both sows: feed / mortality entries each day, stage days posted');
      log(`  - AI on ${day2}: Sow 1 from lot A (2 doses, sire = Boar 1), Sow 2 from lot B (2 doses, pooled: no single sire)`);
      log(`  - Today (${testDate}) is left open for your own entries.`);

      if (!apply && !verify) {
        log('Plan only — nothing written. Run with --verify, then --apply.');
        return;
      }

      const batches = app.get(BatchService);
      const animals = app.get(AnimalService);
      const receipts = app.get(GoodsReceiptService);
      const breeding = app.get(BreedingService);
      const schedulers = app.get(SchedulerHeaderService);
      const dailyData = app.get(BatchDailyDataService);
      const tenantId = tenant.tenant_id;

      const summary: string[] = [];

      try {
        await withTenantTransaction(cls, async () => {
          // 0. The output items you collect from the boar batch.
          const [lotSeries] = await db()
            .select({ id: schema.noSeries.id })
            .from(schema.noSeries)
            .where(and(eq(schema.noSeries.company_id, companyId), eq(schema.noSeries.code, 'ITEM_LOT'), isNull(schema.noSeries.deleted_at)))
            .limit(1);
          if (!lotSeries) throw new Error("The company has no ITEM_LOT number series to number the semen lots from.");
          const itemsSvc = app.get(ItemService);
          const createOutputItem = async (name: string, existing: { item_id: string } | null) => {
            if (existing) return existing.item_id;
            const created: any = await itemsSvc.create(
              {
                company_id: companyId,
                item_name: name,
                item_type: semenTemplate.item_type,
                nob_id: semenTemplate.nob_id ?? undefined,
                lob_id: semenTemplate.lob_id ?? undefined,
                category_id: semenTemplate.category_id ?? undefined,
                sub_category: semenTemplate.sub_category ?? undefined,
                uom_primary: semenTemplate.uom_primary,
                valuation_method: semenTemplate.valuation_method ?? 'FIFO',
                standard_cost: semenTemplate.standard_cost == null ? undefined : Number(semenTemplate.standard_cost),
                is_lot_tracked: true,
                // A lot-tracked item needs its tracking series: the company's ITEM_LOT series, the one every posted lot is numbered from.
                tracking_series_id: lotSeries.id,
                // Fresh semen keeps a few days: the lot's expiry is the collection date plus this.
                shelf_life_days: 5,
                is_biological_asset: false,
              } as any,
              tenantId,
              actor,
            );
            return created.item_id as string;
          };
          const outputItemIds = {
            single: await createOutputItem(OUTPUT_ITEMS.single.name, existingOutputItems.single),
            pooled: await createOutputItem(OUTPUT_ITEMS.pooled.name, existingOutputItems.pooled),
          };

          // 1. Goods receipt for the 4 animals
          const receipt = await receipts.create(
            {
              company_id: companyId,
              warehouse_id: farm.location_id,
              posting_date: entryDate,
              external_reference_no: token,
              remarks: `${token} — test breeding stock`,
              lines: [
                {
                  item_id: items.boar.item_id,
                  quantity: 2,
                  uom: 'HEAD',
                  rate: items.boar.standard_cost == null ? undefined : Number(items.boar.standard_cost),
                  lot_no: `TEST-${testDate}-BOAR`,
                },
                {
                  item_id: items.sow.item_id,
                  quantity: 2,
                  uom: 'HEAD',
                  rate: items.sow.standard_cost == null ? undefined : Number(items.sow.standard_cost),
                  lot_no: `TEST-${testDate}-SOW`,
                },
              ],
            } as any,
            tenantId,
            actor,
          );
          await receipts.post(receipt.receipt_id, tenantId, actor);

          // 2. Register 2 Boars and 2 Sows
          const registeredAnimals: Array<{ key: string; kind: 'BOAR' | 'SOW'; animal_id: string; animal_code: string }> = [];

          // Boar 1 & Boar 2
          for (let i = 1; i <= 2; i++) {
            const penId = pens[BOAR_SHED][(i - 1) % pens[BOAR_SHED].length];
            const a: any = await animals.create(
              {
                company_id: companyId,
                animal_type: 'BOAR',
                breed_id: boarBreedId,
                gender: 'M',
                entry_type: 'PURCHASED_LOCAL',
                entry_date: entryDate,
                age_at_entry_weeks: 88,
                source_receipt_id: receipt.receipt_id,
                item_id: items.boar.item_id,
                rfid_tag: `TST-${testDate}-B${i}`,
                current_location_id: penId,
                current_stage_id: stageIds.BOAR_AI,
              } as any,
              tenantId,
              actor,
            );
            registeredAnimals.push({ key: `B${i}`, kind: 'BOAR', animal_id: a.animal_id, animal_code: a.animal_code });
          }

          // Sow 1 & Sow 2
          for (let i = 1; i <= 2; i++) {
            const penId = pens[SOW_SHED][(i - 1) % pens[SOW_SHED].length];
            const a: any = await animals.create(
              {
                company_id: companyId,
                animal_type: 'SOW',
                breed_id: breedId,
                gender: 'F',
                entry_type: 'PURCHASED_LOCAL',
                entry_date: entryDate,
                age_at_entry_weeks: 104,
                source_receipt_id: receipt.receipt_id,
                item_id: items.sow.item_id,
                rfid_tag: `TST-${testDate}-S${i}`,
                current_location_id: penId,
                current_stage_id: stageIds.INSEMINATION,
                no_of_teats: 14,
              } as any,
              tenantId,
              actor,
            );
            registeredAnimals.push({ key: `S${i}`, kind: 'SOW', animal_id: a.animal_id, animal_code: a.animal_code });
          }

          // 3. Create 2 ANIMAL_WISE Batches
          const boarAnimalIds = registeredAnimals.filter((a) => a.kind === 'BOAR').map((a) => a.animal_id);
          const sowAnimalIds = registeredAnimals.filter((a) => a.kind === 'SOW').map((a) => a.animal_id);

          const boarBatchRow: any = await batches.create(
            {
              company_id: companyId,
              lob_id: PIGGERY_LOB_ID,
              tracking_mode: 'ANIMAL_WISE',
              costing_method: 'BIO_ASSET',
              breed_id: boarBreedId,
              shed_id: sheds[BOAR_SHED].location_id,
              start_date: day1,
              uom: 'HEAD',
              remarks: `${token} — Boar Stud (2 boars)`,
              animal_ids: boarAnimalIds,
            } as any,
            tenantId,
            actor,
          );
          await db().update(schema.batchHeader).set({ farm_id: farm.location_id }).where(eq(schema.batchHeader.batch_id, boarBatchRow.batch_id));
          await batches.activate(boarBatchRow.batch_id, tenantId, actor);
          await db().update(schema.schedulerHeader).set({ effective_from: day1 }).where(eq(schema.schedulerHeader.batch_id, boarBatchRow.batch_id));

          const sowBatchRow: any = await batches.create(
            {
              company_id: companyId,
              lob_id: PIGGERY_LOB_ID,
              tracking_mode: 'ANIMAL_WISE',
              costing_method: 'BIO_ASSET',
              breed_id: breedId,
              shed_id: sheds[SOW_SHED].location_id,
              start_date: day1,
              uom: 'HEAD',
              remarks: `${token} — Sow Herd (2 sows)`,
              animal_ids: sowAnimalIds,
            } as any,
            tenantId,
            actor,
          );
          await db().update(schema.batchHeader).set({ farm_id: farm.location_id }).where(eq(schema.batchHeader.batch_id, sowBatchRow.batch_id));
          await batches.activate(sowBatchRow.batch_id, tenantId, actor);
          await db().update(schema.schedulerHeader).set({ effective_from: day1 }).where(eq(schema.schedulerHeader.batch_id, sowBatchRow.batch_id));

          // 4. Ensure Scheduler Lines
          const schedulerOf = async (batchId: string, stageId: string) => {
            const [row] = await db()
              .select({ scheduler_id: schema.schedulerHeader.scheduler_id })
              .from(schema.schedulerHeader)
              .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.stage_id, stageId)))
              .limit(1);
            if (!row) throw new Error(`No scheduler found for batch ${batchId} and stage ${stageId}.`);
            return row.scheduler_id;
          };

          const boarSchedulerId = await schedulerOf(boarBatchRow.batch_id, stageIds.BOAR_AI);
          const sowSchedulerId = await schedulerOf(sowBatchRow.batch_id, stageIds.INSEMINATION);

          // Add Boar Semen Collection OUTPUT line
          const [hasSemenLine] = await db()
            .select({ line_id: schema.schedulerLine.line_id })
            .from(schema.schedulerLine)
            .where(and(
              eq(schema.schedulerLine.scheduler_id, boarSchedulerId),
              eq(schema.schedulerLine.line_type, 'OUTPUT'),
              eq(schema.schedulerLine.is_active, true),
            ))
            .limit(1);

          let semenLineId = hasSemenLine?.line_id;
          if (!semenLineId) {
            await schedulers.addLine(
              boarSchedulerId,
              {
                line_type: 'OUTPUT',
                activity_name: 'Boar Semen Collection',
                item_id: outputItemIds.single,
                output_basis: 'PER_BATCH',
                occurrence: 'DAILY',
                start_day: 1,
                is_mandatory: false,
                standard_qty: 1,
              } as any,
              tenantId,
              actor,
            );
            const [createdLine] = await db()
              .select({ line_id: schema.schedulerLine.line_id })
              .from(schema.schedulerLine)
              .where(and(
                eq(schema.schedulerLine.scheduler_id, boarSchedulerId),
                eq(schema.schedulerLine.line_type, 'OUTPUT'),
                eq(schema.schedulerLine.is_active, true),
              ))
              .limit(1);
            semenLineId = createdLine!.line_id;
          }

          const b1 = registeredAnimals.find((a) => a.key === 'B1')!;
          const b2 = registeredAnimals.find((a) => a.key === 'B2')!;
          const s1 = registeredAnimals.find((a) => a.key === 'S1')!;
          const s2 = registeredAnimals.find((a) => a.key === 'S2')!;

          const linesOf = (schedulerId: string) =>
            db().select().from(schema.schedulerLine).where(and(eq(schema.schedulerLine.scheduler_id, schedulerId), eq(schema.schedulerLine.is_active, true)));
          const boarLines = await linesOf(boarSchedulerId);
          const sowLines = await linesOf(sowSchedulerId);

          // The mandatory lines (feed, mortality check) are saved as drafts for each animal; posting the stage day
          // then posts them together with the semen output.
          const draftMandatory = async (batchId: string, lines: typeof boarLines, animalIds: string[], date: string, feedQty: number) => {
            for (const line of lines) {
              if (!line.is_mandatory) continue;
              const val = line.line_type === 'CONSUMPTION' ? feedQty : 0;
              for (const animalId of animalIds) {
                await dailyData.postEntry(batchId, { line_id: line.line_id, animal_id: animalId, entry_date: date, entered_value: val, draft: true }, tenantId, actor);
              }
            }
          };

          const semenLotOn = async (date: string) => {
            const [lot] = await db()
              .select()
              .from(schema.semenBatch)
              .where(and(eq(schema.semenBatch.boar_animal_id, b1.animal_id), eq(schema.semenBatch.collection_date, date)))
              .limit(1);
            if (!lot) throw new Error(`The semen lot of ${date} was not created upon posting the boar data entry.`);
            return lot;
          };

          // 5a. DAY 1 — Boar 1 collects on his own: one boar, one lot. Output item: the single-boar dose.
          await draftMandatory(boarBatchRow.batch_id, boarLines, [b1.animal_id, b2.animal_id], day1, 2);
          await dailyData.postEntry(
            boarBatchRow.batch_id,
            { line_id: semenLineId!, animal_id: b1.animal_id, entry_date: day1, entered_value: 25, item_id: outputItemIds.single, draft: true, remarks: 'Fresh semen, Boar 1 alone' },
            tenantId,
            actor,
          );
          await batches.postStageDay(boarBatchRow.batch_id, stageIds.BOAR_AI, day1, tenantId, actor);
          const lotA = await semenLotOn(day1);

          // 5b. DAY 2 — Boar 1 and Boar 2 collect together: their semen is mixed into ONE pooled lot. The entry is made
          // against Boar 1 and names Boar 2 in the pool; Boar 2 has no collection of his own that day.
          await draftMandatory(boarBatchRow.batch_id, boarLines, [b1.animal_id, b2.animal_id], day2, 2);
          await dailyData.postEntry(
            boarBatchRow.batch_id,
            {
              line_id: semenLineId!,
              animal_id: b1.animal_id,
              entry_date: day2,
              entered_value: 40,
              item_id: outputItemIds.pooled,
              pool_animal_ids: [b2.animal_id],
              draft: true,
              remarks: 'Pooled semen, Boar 1 + Boar 2',
            },
            tenantId,
            actor,
          );
          await batches.postStageDay(boarBatchRow.batch_id, stageIds.BOAR_AI, day2, tenantId, actor);
          const lotB = await semenLotOn(day2);

          // 6. Sows: feed / mortality entries and the stage day, each day.
          for (const d of [day1, day2]) {
            await draftMandatory(sowBatchRow.batch_id, sowLines, [s1.animal_id, s2.animal_id], d, 2.5);
            await batches.postStageDay(sowBatchRow.batch_id, stageIds.INSEMINATION, d, tenantId, actor);
          }

          // 7. AI insemination on day 2: Sow 1 from lot A (one known sire), Sow 2 from the pooled lot B.
          const serve = (sowAnimalId: string, lotId: string, note: string) =>
            breeding.recordMating(
              {
                company_id: companyId,
                sow_animal_id: sowAnimalId,
                batch_id: sowBatchRow.batch_id,
                mating_type: 'AI',
                mating_date: day2,
                semen_lot_id: lotId,
                semen_dose_qty: 2,
                notes: note,
              } as any,
              tenantId,
              actor,
            ) as Promise<any>;
          const matingA = await serve(s1.animal_id, lotA.semen_batch_id, 'AI from lot A (Boar 1 alone)');
          const matingB = await serve(s2.animal_id, lotB.semen_batch_id, 'AI from pooled lot B (Boar 1 + Boar 2)');

          const packOf = async (qrId: string | null) => {
            if (!qrId) return '—';
            const [qr] = await db().select({ pack_no: schema.qrCodeMaster.pack_no }).from(schema.qrCodeMaster).where(eq(schema.qrCodeMaster.qr_id, qrId)).limit(1);
            return qr?.pack_no ?? '—';
          };
          const lotsNow = await db().select().from(schema.semenBatch).where(inArray(schema.semenBatch.semen_batch_id, [lotA.semen_batch_id, lotB.semen_batch_id]));
          const left = (id: string) => {
            const l = lotsNow.find((x) => x.semen_batch_id === id)!;
            return Number(l.doses_collected) - Number(l.doses_used_internal) - Number(l.doses_sold);
          };

          summary.push(
            '=== RESULTS SUMMARY ===',
            `Output items: '${OUTPUT_ITEMS.single.name}', '${OUTPUT_ITEMS.pooled.name}' (UOM DOSE, lot-tracked, 5-day shelf life)`,
            `Boar Stud Batch: ${boarBatchRow.batch_no} (ANIMAL_WISE, 2 head, ${BOAR_BREED_NAME}, ${BOAR_SHED})`,
            `  - Boar 1: ${b1.animal_code} (Tag: TST-${testDate}-B1)`,
            `  - Boar 2: ${b2.animal_code} (Tag: TST-${testDate}-B2)`,
            `Sow Herd Batch: ${sowBatchRow.batch_no} (ANIMAL_WISE, 2 head, ${SOW_SHED})`,
            `  - Sow 1: ${s1.animal_code} (Tag: TST-${testDate}-S1) at INSEMINATION`,
            `  - Sow 2: ${s2.animal_code} (Tag: TST-${testDate}-S2) at INSEMINATION`,
            `Lot A (${day1}, ${b1.animal_code} alone): ${lotA.lot_no}, 25 doses, QR ${await packOf(lotA.qr_id)}, ${left(lotA.semen_batch_id)} left`,
            `Lot B (${day2}, POOLED ${b1.animal_code} + ${b2.animal_code}): ${lotB.lot_no}, 40 doses, QR ${await packOf(lotB.qr_id)}, ${left(lotB.semen_batch_id)} left`,
            `AI: ${s1.animal_code} from ${lotA.lot_no} (due ${matingA.expected_farrowing_date}); ${s2.animal_code} from pooled ${lotB.lot_no} (due ${matingB.expected_farrowing_date})`,
          );

          if (verify) throw new RollBack();
        });
      } catch (err) {
        if (!(err instanceof RollBack)) throw err;
        for (const line of summary) log(line);
        log('VERIFY PASSED: Everything was successfully simulated and rolled back (nothing committed).');
        log('Run with --apply to commit these records.');
        return;
      }

      for (const line of summary) log(line);
      log(`APPLIED SUCCESSFULLY: Test data committed to nf_devco.`);
    });
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[seed-boars-sows-batches] FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
