/**
 * Chapter `10-batch-transfers` — animals changing stage, all through the services (Ruling 1).
 * It runs after the daily entries, so everything is dated in the last days of the window and nothing
 * re-prices a day that was already posted.
 *
 *   - Stage alignment: the sows confirmed pregnant (and not yet farrowed) stand in GESTATION. Registration dealt every sow a stage
 *     round-robin, which put a pregnant sow in LACTATION; the stage change goes through the animal card's own
 *     `transitionStage`, so it is logged in the movement history.
 *
 * Resume semantics: a stage change is skipped when the sow already stands in the stage.
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=10-batch-transfers
 */
import { and, eq, like, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export const batchTransfersChapter: DemoChapter = {
  name: '10-batch-transfers',

  async run(ctx: DemoContext): Promise<void> {
    const animals = ctx.app.get(AnimalService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('10-batch-transfers: tenantDb is not set — run through the harness.');
    const actor = ctx.actor;

    // ── The sows confirmed pregnant (and not yet farrowed) stand in GESTATION.
    const [gestation] = await db
      .select({ stage_id: schema.stageMaster.stage_id })
      .from(schema.stageMaster)
      .where(and(eq(schema.stageMaster.stage_code, 'GESTATION'), eq(schema.stageMaster.company_id, ctx.companyId)))
      .limit(1);
    if (!gestation) throw new Error('10-batch-transfers: no GESTATION stage for the demo company.');
    const pregnant = await db
      .select({ animal_id: schema.animalRegister.animal_id, tag: schema.animalRegister.rfid_tag, stage_id: schema.animalRegister.current_stage_id })
      .from(schema.breedingRecord)
      .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.breedingRecord.sow_animal_id))
      .where(and(eq(schema.breedingRecord.conception_result, 'CONFIRMED'), sql`NOT EXISTS (SELECT 1 FROM farrowing_record f WHERE f.breeding_id = ${schema.breedingRecord.breeding_id})`, like(schema.animalRegister.rfid_tag, 'DEMO-%')));
    if (pregnant.length === 0) ctx.log('no sow is confirmed pregnant — no stage to align');
    for (const sow of pregnant) {
      if (sow.stage_id === gestation.stage_id) {
        ctx.log(`${sow.tag}: already in GESTATION — skipped`);
        continue;
      }
      await animals.transitionStage(
        sow.animal_id,
        { to_stage_id: gestation.stage_id, transition_date: dateDaysAgo(3), reason: 'Pregnancy confirmed' } as any,
        ctx.tenantId,
        actor,
      );
      ctx.log(`${sow.tag}: moved to GESTATION (pregnancy confirmed)`);
    }
  },
};
