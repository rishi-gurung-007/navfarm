/**
 * Chapter `05-breeding` — Phase 3 Task 7, extended to carry the outputs. Five sows of the Grasmere
 * registered batch and its boar go through `BreedingService` (Ruling 1):
 *
 *   - DEMO-SOW-01, DEMO-SOW-02: full cycle — mating (natural, the batch boar) → pregnancy check
 *     CONFIRMED → farrowing (linked `breeding_id`) → weaning. The litter is held as a piglet lot — a
 *     bio-asset batch with a lot number from the ITEM_LOT series — and weaning moves the weaned head on:
 *     SOW-01's go to the farm's weaner batch (a head-count transfer), SOW-02's lot moves on to the WEANER
 *     stage. The sow goes to Dry Sow at weaning and her parity is set.
 *   - DEMO-SOW-03, DEMO-SOW-04: mated and pregnancy-confirmed only; farrowing is still ahead. SOW-04 is
 *     served by AI from the boar's first semen lot, which issues the doses from stock.
 *   - DEMO-SOW-05: mated, check came back FAILED.
 *   - DEMO-BOAR-01: two semen collections, each a lot of the BOAR semen item posted as doses to the farm
 *     store with its QR pack.
 *
 * Timeline: the herd is bought HERD_BOUGHT_DAYS_BEFORE_WINDOW days before the batch window opens
 * (register-breeding-stock.ts), so a sow cannot farrow before she was bought. The two completed sows came
 * in served (mated before the purchase), farrowed after it, and were weaned 21 days later — the last one
 * yesterday. Nothing here is dated in the future.
 *
 * Resume semantics: the mating is located by (sow, mating_date) — unique in the demo; each later step is
 * skipped once its own row/field exists; a semen collection by (boar, collection_date).
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=05-breeding
 */
import { and, eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BreedingService } from '../../../modules/piggery/breeding/breeding.service';
import { MatingType, PregCheckMethod, ConceptionResult } from '../../../modules/piggery/breeding/dto/breeding.dto';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { createItemLookup } from '../batch-helpers';

const GESTATION_DAYS = 116; // Z-Line-Sow, breed_master.gestation_days
const LACTATION_DAYS = 21;

interface SowPlan {
  rfid_tag: string;
  /** Day offsets back from today — the whole cycle slides with the run date. */
  matingDaysAgo: number;
  outcome: 'COMPLETED' | 'PREGNANT' | 'FAILED';
  piglets_born_live?: number;
  piglets_stillborn?: number;
  avg_birth_weight_kg?: number;
  piglets_weaned?: number;
  avg_weaning_weight_kg?: number;
  /** Where the weaned piglets go: into the farm's weaner batch, or the lot moves on to the WEANER stage. */
  weanTo?: 'BATCH' | 'STAGE';
  /** Served by AI from the first semen lot instead of the boar. */
  viaSemen?: boolean;
}

// Farrowed 22 / 24 days ago, weaned 1 / 3 days ago (21-day lactation).
const FARROWED_AGO = { 'DEMO-SOW-01': 22, 'DEMO-SOW-02': 24 } as const;

const SOW_PLANS: SowPlan[] = [
  { rfid_tag: 'DEMO-SOW-01', matingDaysAgo: FARROWED_AGO['DEMO-SOW-01'] + GESTATION_DAYS, outcome: 'COMPLETED', piglets_born_live: 14, piglets_stillborn: 1, avg_birth_weight_kg: 1.4, piglets_weaned: 13, avg_weaning_weight_kg: 6.8, weanTo: 'BATCH' },
  { rfid_tag: 'DEMO-SOW-02', matingDaysAgo: FARROWED_AGO['DEMO-SOW-02'] + GESTATION_DAYS, outcome: 'COMPLETED', piglets_born_live: 12, piglets_stillborn: 0, avg_birth_weight_kg: 1.35, piglets_weaned: 11, avg_weaning_weight_kg: 6.5, weanTo: 'STAGE' },
  // Confirmed pregnant, farrowing still ahead (mated after the purchase, checked 28 days on).
  { rfid_tag: 'DEMO-SOW-03', matingDaysAgo: 35, outcome: 'PREGNANT' },
  { rfid_tag: 'DEMO-SOW-04', matingDaysAgo: 32, outcome: 'PREGNANT', viaSemen: true },
  // Served, check came back negative.
  { rfid_tag: 'DEMO-SOW-05', matingDaysAgo: 36, outcome: 'FAILED' },
];

/**
 * The lean seed's plans: one sow through the whole cycle (farrowed, litter held as a piglet lot, weaned into the
 * weaner batch), one served by AI from the semen lot and confirmed pregnant, one whose check FAILED (chapter 10
 * then splits her out to service). One litter means one piglet lot, which keeps the batch count at two.
 */
const LEAN_SOW_PLANS: SowPlan[] = [
  SOW_PLANS[0],
  { rfid_tag: 'DEMO-SOW-02', matingDaysAgo: 32, outcome: 'PREGNANT', viaSemen: true },
  SOW_PLANS[4],
];

/** The boar's collections: days back from today, doses, and the quality printed on the lot's QR. */
const SEMEN_COLLECTIONS = [
  { daysAgo: 34, doses: 40, volume_ml: 250, motility_pct: 85, concentration_m_per_ml: 300 },
  { daysAgo: 6, doses: 30, volume_ml: 230, motility_pct: 82, concentration_m_per_ml: 290 },
] as const;
const LEAN_SEMEN_COLLECTIONS = SEMEN_COLLECTIONS.slice(0, 1);

const ITEM_PIGLET = 'Suckling Live Piglet (0-4 Wks)';
const ITEM_SEMEN = 'BOAR semen';

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export const breedingChapter: DemoChapter = {
  name: '05-breeding',

  async run(ctx: DemoContext): Promise<void> {
    const breeding = ctx.app.get(BreedingService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('05-breeding: tenantDb is not set — run through the harness.');

    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };

    const [demoBatch] = await db
      .select({ batch_id: schema.batchHeader.batch_id })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, 'DEMO-BATCH-REG-GRASMERE'))
      .limit(1);
    if (!demoBatch) throw new Error('05-breeding: DEMO-BATCH-REG-GRASMERE not found — run 03-batches-and-animals first.');

    const [boar] = await db
      .select({ animal_id: schema.animalRegister.animal_id })
      .from(schema.animalRegister)
      .where(eq(schema.animalRegister.rfid_tag, 'DEMO-BOAR-01'))
      .limit(1);
    if (!boar) throw new Error('05-breeding: boar DEMO-BOAR-01 not found — run 03-batches-and-animals first.');

    const item = createItemLookup(db, ctx.companyId);
    const piglet = await item(ITEM_PIGLET);
    const semenItem = await item(ITEM_SEMEN);
    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const lactationStageId = farm?.sowBreed?.lifecycleStages.get('LACTATION');
    if (!lactationStageId) throw new Error('05-breeding: MUL100\'s sow breed has no LACTATION lifecycle row — the litters cannot be held as piglet lots.');
    const [weanerBatch] = await db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, 'DEMO-MUL100-CO-WEANER'))
      .limit(1);
    if (!weanerBatch) throw new Error('05-breeding: the MUL100 weaner batch (DEMO-MUL100-CO-WEANER) is missing — run 03-batches-and-animals first.');

    // ── The boar's semen, each collection a lot of doses in the farm store with its QR pack. Done first: SOW-04
    // is served from the first lot.
    const semenLotIds: string[] = [];
    for (const c of ctx.lean ? LEAN_SEMEN_COLLECTIONS : SEMEN_COLLECTIONS) {
      const collectionDate = dateDaysAgo(c.daysAgo);
      let [lot] = await db
        .select({ semen_batch_id: schema.semenBatch.semen_batch_id })
        .from(schema.semenBatch)
        .where(and(eq(schema.semenBatch.boar_animal_id, boar.animal_id), eq(schema.semenBatch.collection_date, collectionDate)))
        .limit(1);
      if (!lot) {
        const created: any = await breeding.recordSemenCollection(
          {
            company_id: ctx.companyId,
            boar_animal_id: boar.animal_id,
            boar_batch_id: demoBatch.batch_id,
            collection_date: collectionDate,
            doses_collected: c.doses,
            output_item_id: semenItem.item_id,
            volume_ml: c.volume_ml,
            motility_pct: c.motility_pct,
            concentration_m_per_ml: c.concentration_m_per_ml,
          } as any,
          ctx.tenantId,
          actor,
        );
        lot = { semen_batch_id: created.semen_batch_id };
        ctx.log(`DEMO-BOAR-01: semen collected ${collectionDate} — ${c.doses} doses, lot ${created.lot_no ?? '—'}`);
      } else {
        ctx.log(`DEMO-BOAR-01: semen collection ${collectionDate} already recorded — skipped`);
      }
      semenLotIds.push(lot.semen_batch_id);
    }

    for (const plan of ctx.lean ? LEAN_SOW_PLANS : SOW_PLANS) {
      const [sow] = await db
        .select({ animal_id: schema.animalRegister.animal_id, animal_code: schema.animalRegister.animal_code, parity_count: schema.animalRegister.parity_count })
        .from(schema.animalRegister)
        .where(eq(schema.animalRegister.rfid_tag, plan.rfid_tag))
        .limit(1);
      if (!sow) throw new Error(`05-breeding: sow ${plan.rfid_tag} not found.`);

      const matingDate = dateDaysAgo(plan.matingDaysAgo);

      // ── Mating (skip when the demo already mated her on this date).
      let [record] = await db
        .select({ breeding_id: schema.breedingRecord.breeding_id, conception_result: schema.breedingRecord.conception_result, expected_farrowing_date: schema.breedingRecord.expected_farrowing_date })
        .from(schema.breedingRecord)
        .where(and(eq(schema.breedingRecord.sow_animal_id, sow.animal_id), eq(schema.breedingRecord.mating_date, matingDate)))
        .limit(1);
      if (!record) {
        const created = await breeding.recordMating(
          {
            company_id: ctx.companyId,
            sow_animal_id: sow.animal_id,
            batch_id: demoBatch.batch_id,
            ...(plan.viaSemen
              ? { mating_type: MatingType.AI, semen_lot_id: semenLotIds[0], semen_dose_qty: 2 }
              : { mating_type: MatingType.NATURAL_MATING, boar_animal_id: boar.animal_id }),
            mating_date: matingDate,
          } as any,
          ctx.tenantId,
          actor,
        );
        record = { breeding_id: created.breeding_id, conception_result: created.conception_result, expected_farrowing_date: created.expected_farrowing_date };
        ctx.log(`${plan.rfid_tag}: mated ${matingDate} (${plan.viaSemen ? 'AI, semen lot 1' : 'natural, DEMO-BOAR-01'}) — expected farrowing ${created.expected_farrowing_date}`);
      } else {
        ctx.log(`${plan.rfid_tag}: mating ${matingDate} already recorded — skipped`);
      }

      // ── Pregnancy check (skip once the result is known).
      {
        if (record.conception_result === ConceptionResult.PENDING || record.conception_result == null) {
          const checkDate = addDays(matingDate, 28);
          const result = plan.outcome === 'FAILED' ? ConceptionResult.FAILED : ConceptionResult.CONFIRMED;
          await breeding.recordPregnancyCheck(
            record.breeding_id,
            { preg_check_date: checkDate, preg_check_method: PregCheckMethod.ULTRASOUND, conception_result: result },
            ctx.tenantId,
            actor,
          );
          ctx.log(`${plan.rfid_tag}: pregnancy check ${checkDate} — ${result}`);
        }
      }

      if (plan.outcome !== 'COMPLETED') continue;

      // ── Farrowing, linked to the mating (skip when a farrow row exists).
      const farrowingDate = addDays(matingDate, GESTATION_DAYS);
      let [farrow] = await db
        .select({ farrow_id: schema.farrowingRecord.farrow_id, piglets_weaned: schema.farrowingRecord.piglets_weaned })
        .from(schema.farrowingRecord)
        .where(eq(schema.farrowingRecord.breeding_id, record.breeding_id))
        .limit(1);
      if (!farrow) {
        const created = await breeding.recordFarrowing(
          {
            company_id: ctx.companyId,
            sow_animal_id: sow.animal_id,
            breeding_id: record.breeding_id,
            batch_id: demoBatch.batch_id,
            farrowing_date: farrowingDate,
            piglets_born_live: plan.piglets_born_live!,
            piglets_stillborn: plan.piglets_stillborn ?? 0,
            avg_birth_weight_kg: plan.avg_birth_weight_kg,
            // The litter is held as a lot of piglets in a batch of its own, at the sow's lactation stage.
            piglet_item_id: piglet.item_id,
            piglet_stage_id: lactationStageId,
          } as any,
          ctx.tenantId,
          actor,
        );
        farrow = { farrow_id: created.farrow_id, piglets_weaned: 0 };
        if (created.piglet_batch_id) {
          // DEMO-… marks it as demo data, so the daily-entry and cleanup tooling treat it like the other demo batches.
          await db.update(schema.batchHeader)
            .set({ remarks: `${plan.rfid_tag}-LITTER` })
            .where(eq(schema.batchHeader.batch_id, created.piglet_batch_id));
        }
        ctx.log(`${plan.rfid_tag}: farrowed ${farrowingDate} — ${plan.piglets_born_live} live, ${plan.piglets_stillborn ?? 0} stillborn (parity ${sow.parity_count + 1})`);
      }

      // ── Weaning 28 days later (skip when already weaned).
      if (Number(farrow.piglets_weaned) === 0) {
        const weaningDate = addDays(farrowingDate, LACTATION_DAYS);
        await breeding.recordWeaning(
          farrow.farrow_id,
          {
            weaning_date: weaningDate,
            piglets_weaned: plan.piglets_weaned!,
            avg_weaning_weight_kg: plan.avg_weaning_weight_kg,
            ...(plan.weanTo === 'BATCH' ? { move_to_batch_id: weanerBatch.batch_id } : { move_to_stage_code: 'WEANER' }),
          },
          ctx.tenantId,
          actor,
        );
        ctx.log(`${plan.rfid_tag}: weaned ${weaningDate} — ${plan.piglets_weaned} piglets at ${plan.avg_weaning_weight_kg} kg → ${plan.weanTo === 'BATCH' ? `weaner batch ${weanerBatch.batch_no}` : 'their lot moved on to WEANER'}`);
      }
    }
  },
};
