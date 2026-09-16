/**
 * Chapter `05-breeding` — Phase 3 Task 7. Five sows of the Grasmere
 * registered batch go through `BreedingService` (Ruling 1), dated so the
 * completed cycles finished in the past:
 *
 *   - DEMO-SOW-01, DEMO-SOW-02: full cycle — mating (natural, the batch boar)
 *     → pregnancy check CONFIRMED → farrowing (linked `breeding_id`, explicit
 *     litter counts) → weaning. Timed off the breed's own gestation (116 days
 *     on Z-Line-Sow): mating = farrowing − 116, weaning = farrowing + 28.
 *   - DEMO-SOW-03, DEMO-SOW-04: mated and pregnancy-confirmed only; their
 *     expected farrowing dates are still ahead.
 *   - DEMO-SOW-05: mated, check came back FAILED.
 *
 * Resume semantics: the mating is located by (sow, mating_date) — unique in
 * the demo; each later step is skipped once its own row/field exists.
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=05-breeding
 */
import { and, eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BreedingService } from '../../../modules/piggery/breeding/breeding.service';
import { MatingType, ConceptionResult } from '../../../modules/piggery/breeding/dto/breeding.dto';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

const GESTATION_DAYS = 116; // Z-Line-Sow, breed_master.gestation_days
const LACTATION_DAYS = 28;

interface SowPlan {
  ear_tag: string;
  /** Day offsets back from today — the whole cycle slides with the run date. */
  matingDaysAgo: number;
  outcome: 'COMPLETED' | 'PREGNANT' | 'FAILED';
  piglets_born_live?: number;
  piglets_stillborn?: number;
  avg_birth_weight_kg?: number;
  piglets_weaned?: number;
  avg_weaning_weight_kg?: number;
}

const SOW_PLANS: SowPlan[] = [
  // Farrowed 148 days ago, weaned 120 days ago — a finished cycle.
  { ear_tag: 'DEMO-SOW-01', matingDaysAgo: 148 + GESTATION_DAYS, outcome: 'COMPLETED', piglets_born_live: 14, piglets_stillborn: 1, avg_birth_weight_kg: 1.4, piglets_weaned: 13, avg_weaning_weight_kg: 6.8 },
  { ear_tag: 'DEMO-SOW-02', matingDaysAgo: 146 + GESTATION_DAYS, outcome: 'COMPLETED', piglets_born_live: 12, piglets_stillborn: 0, avg_birth_weight_kg: 1.35, piglets_weaned: 11, avg_weaning_weight_kg: 6.5 },
  // Confirmed pregnant, farrowing still ahead.
  { ear_tag: 'DEMO-SOW-03', matingDaysAgo: 45, outcome: 'PREGNANT' },
  { ear_tag: 'DEMO-SOW-04', matingDaysAgo: 40, outcome: 'PREGNANT' },
  // Served, check came back negative.
  { ear_tag: 'DEMO-SOW-05', matingDaysAgo: 50, outcome: 'FAILED' },
];

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
      .where(eq(schema.animalRegister.ear_tag, 'DEMO-BOAR-01'))
      .limit(1);
    if (!boar) throw new Error('05-breeding: boar DEMO-BOAR-01 not found — run 03-batches-and-animals first.');

    for (const plan of SOW_PLANS) {
      const [sow] = await db
        .select({ animal_id: schema.animalRegister.animal_id, animal_code: schema.animalRegister.animal_code, parity_count: schema.animalRegister.parity_count })
        .from(schema.animalRegister)
        .where(eq(schema.animalRegister.ear_tag, plan.ear_tag))
        .limit(1);
      if (!sow) throw new Error(`05-breeding: sow ${plan.ear_tag} not found.`);

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
            mating_type: MatingType.NATURAL_MATING,
            boar_animal_id: boar.animal_id,
            mating_date: matingDate,
          },
          ctx.tenantId,
          actor,
        );
        record = { breeding_id: created.breeding_id, conception_result: created.conception_result, expected_farrowing_date: created.expected_farrowing_date };
        ctx.log(`${plan.ear_tag}: mated ${matingDate} (natural, DEMO-BOAR-01) — expected farrowing ${created.expected_farrowing_date}`);
      } else {
        ctx.log(`${plan.ear_tag}: mating ${matingDate} already recorded — skipped`);
      }

      // ── Pregnancy check (skip once the result is known).
      {
        if (record.conception_result === ConceptionResult.PENDING || record.conception_result == null) {
          const checkDate = addDays(matingDate, 28);
          const result = plan.outcome === 'FAILED' ? ConceptionResult.FAILED : ConceptionResult.CONFIRMED;
          await breeding.recordPregnancyCheck(
            record.breeding_id,
            { preg_check_date: checkDate, preg_check_method: 'ULTRASOUND', conception_result: result },
            ctx.tenantId,
            actor,
          );
          ctx.log(`${plan.ear_tag}: pregnancy check ${checkDate} — ${result}`);
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
          },
          ctx.tenantId,
          actor,
        );
        farrow = { farrow_id: created.farrow_id, piglets_weaned: 0 };
        ctx.log(`${plan.ear_tag}: farrowed ${farrowingDate} — ${plan.piglets_born_live} live, ${plan.piglets_stillborn ?? 0} stillborn (parity ${sow.parity_count + 1})`);
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
          },
          ctx.tenantId,
          actor,
        );
        ctx.log(`${plan.ear_tag}: weaned ${weaningDate} — ${plan.piglets_weaned} piglets at ${plan.avg_weaning_weight_kg} kg`);
      }
    }
  },
};
