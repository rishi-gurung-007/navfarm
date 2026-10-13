/**
 * Chapter `12-mortality` — deaths recorded the way the Mortality panel records them, through
 * `BatchService.recordMortality` (the one mortality write path: the batch's head, the bio-asset value written
 * off, the scheduler's stage counts and, for a registered animal, her own record and movement log).
 *
 *   - Animal Wise: one gilt of the Grasmere registered batch (respiratory disease), with the cause, post-mortem
 *     notes and disposal method in `batch_mortality_detail`.
 *   - Batch Wise: two head from the first head-count batch on POR100 and RIC100 (respiratory disease), the same detail.
 *
 * Chapter 04 already posted two single deaths on the Grasmere head-count batch through the data-entry
 * mortality line; those carry no detail row, these do, so both routes are in the data.
 *
 * Resume semantics: a death is located by its remarks token in `batch_transaction`; a gilt is the first live
 * gilt of the batch, so a re-run (the first one is dead) picks the next only if the token is missing.
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=12-mortality
 */
import { and, asc, eq, like, notLike } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BatchService } from '../../../modules/production/batch/batch.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

const GILT_REMARKS = 'DEMO mortality — gilt, respiratory disease';
const HEADCOUNT_HEAD = 2;
/** Farms tried for a head-count death, in order; the first two that have a head-count batch get one. */
const HEADCOUNT_FARM_CANDIDATES = ['POR100', 'RIC100', 'MUL100'];
const HEADCOUNT_FARMS_WANTED = 2;

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export const mortalityChapter: DemoChapter = {
  name: '12-mortality',

  async run(ctx: DemoContext): Promise<void> {
    const batches = ctx.app.get(BatchService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('12-mortality: tenantDb is not set — run through the harness.');

    const reasonId = async (code: string): Promise<string> => {
      const [row] = await db
        .select({ reason_id: schema.reasonMaster.reason_id })
        .from(schema.reasonMaster)
        .where(and(eq(schema.reasonMaster.reason_code, code), eq(schema.reasonMaster.company_id, ctx.companyId), eq(schema.reasonMaster.category, 'MORTALITY')))
        .limit(1);
      if (!row) throw new Error(`12-mortality: mortality reason ${code} is not seeded — the documented-reasons step did not run.`);
      return row.reason_id;
    };
    const alreadyRecorded = async (batchId: string, remarks: string) => {
      const [row] = await db
        .select({ transaction_id: schema.batchTransaction.transaction_id })
        .from(schema.batchTransaction)
        .where(and(eq(schema.batchTransaction.batch_id, batchId), eq(schema.batchTransaction.transaction_type, 'MORTALITY'), eq(schema.batchTransaction.remarks, remarks)))
        .limit(1);
      return !!row;
    };

    // ── Animal Wise: a gilt of the registered batch.
    const [registered] = await db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, 'DEMO-BATCH-REG-GRASMERE'))
      .limit(1);
    if (!registered) throw new Error('12-mortality: DEMO-BATCH-REG-GRASMERE not found — run 03-batches-and-animals first.');
    if (await alreadyRecorded(registered.batch_id, GILT_REMARKS)) {
      ctx.log(`MUL100 ${registered.batch_no}: the gilt's death is already recorded — skipped`);
    } else {
      const [gilt] = await db
        .select({ animal_id: schema.animalRegister.animal_id, animal_code: schema.animalRegister.animal_code })
        .from(schema.animalRegister)
        .where(and(
          eq(schema.animalRegister.current_batch_id, registered.batch_id),
          eq(schema.animalRegister.animal_type, 'GILT'),
          eq(schema.animalRegister.is_active, true),
        ))
        .orderBy(asc(schema.animalRegister.animal_code))
        .limit(1);
      if (!gilt) throw new Error('12-mortality: no live gilt in the registered batch to record a death against.');
      await batches.recordMortality(
        registered.batch_id,
        {
          transaction_date: dateDaysAgo(2),
          animal_ids: [gilt.animal_id],
          remarks: GILT_REMARKS,
          mortality_detail: {
            cause_of_death: 'Respiratory disease (pneumonia)',
            post_mortem_notes: 'Lung consolidation on necropsy (DEMO).',
            disposal_method: 'Incineration (biosecure)',
            reason_id: await reasonId('MRT-001'),
          },
        } as any,
        ctx.tenantId,
        ctx.actor,
      );
      ctx.log(`MUL100 ${registered.batch_no}: ${gilt.animal_code} died (respiratory disease) — recorded with cause, post-mortem and disposal`);
    }

    // ── Batch Wise: a head count off the first head-count batch of two farms (one, in the lean seed).
    let done = 0;
    for (const code of HEADCOUNT_FARM_CANDIDATES) {
      if (done >= HEADCOUNT_FARMS_WANTED) break;
      const farm = ctx.demoFarms.find((f) => f.code === code);
      if (!farm) continue;
      const [batch] = await db
        .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no })
        .from(schema.batchHeader)
        .where(and(
          eq(schema.batchHeader.farm_id, farm.farmId),
          like(schema.batchHeader.remarks, 'DEMO-%-CO-%'),
          notLike(schema.batchHeader.remarks, '%-RUNTS'),
          eq(schema.batchHeader.tracking_mode, 'BATCH_WISE'),
          eq(schema.batchHeader.status, 'ACTIVE'),
        ))
        .orderBy(asc(schema.batchHeader.batch_no))
        .limit(1);
      if (!batch) {
        ctx.log(`${code} no head-count batch — no head-count mortality to record`);
        continue;
      }
      done++;
      const remarks = `DEMO mortality — ${HEADCOUNT_HEAD} head, respiratory disease`;
      if (await alreadyRecorded(batch.batch_id, remarks)) {
        ctx.log(`${code} ${batch.batch_no}: the head-count mortality is already recorded — skipped`);
        continue;
      }
      await batches.recordMortality(
        batch.batch_id,
        {
          transaction_date: dateDaysAgo(2),
          quantity: HEADCOUNT_HEAD,
          remarks,
          mortality_detail: {
            cause_of_death: 'Respiratory disease (pneumonia)',
            post_mortem_notes: 'Lung consolidation on necropsy (DEMO).',
            disposal_method: 'Burial (deep pit)',
            reason_id: await reasonId('MRT-001'),
          },
        } as any,
        ctx.tenantId,
        ctx.actor,
      );
      ctx.log(`${code} ${batch.batch_no}: ${HEADCOUNT_HEAD} head died (respiratory disease) — recorded with detail`);
    }
  },
};
