/**
 * Demo data (audit L2): which stages are for sows and which for boars, and the demo boars out of Gestation.
 *
 * The "Applies To" setting on a stage (stage_master.applicable_gender) is enforced on every create, stage move and
 * transfer, but nothing sets it — which stages are sow-only or boar-only is the client's to configure (decisions.md).
 * For the DEMO tenant only, this sets the obvious ones so the rule can be seen working, and moves the demo boars that
 * the old seed stood in Gestation to Boar AI through the ordinary stage move. Labelled ours; Rishi's answer replaces it.
 *
 *   female: GILT_GROWER, FLUSH, INSEMINATION, GESTATION, FARROWING, LACTATION, DRY_SOW, PRODUCTIVE_SOW
 *   male:   BOAR_AI
 *   left open (either): everything else — quarantine, the growing stages, WEANING (whose subject is unclear), exits.
 *
 * Usage (read-only by default, as every db-* script):
 *   pnpm nx run api:db-align-demo-stage-sex                 # plan
 *   pnpm nx run api:db-align-demo-stage-sex -- --verify     # applies in one transaction, rolls back
 *   pnpm nx run api:db-align-demo-stage-sex -- --apply      # commits
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import * as masterSchema from '../core/database/master-schema';
import { MASTER_CONNECTION } from '../core/database/database.module';
import { withTenantTransaction } from '../common/tenant-transaction';
import { bootApp, inTenant } from './demo/harness';
import type { DemoContext } from './demo/chapter';
import { AnimalService } from '../modules/piggery/animal/animal.service';
import { AnimalMovementLogService } from '../modules/piggery/animal-movement-log/animal-movement-log.service';

const TENANT_CODE = 'devco';
const FEMALE_STAGES = ['GILT_GROWER', 'FLUSH', 'INSEMINATION', 'GESTATION', 'FARROWING', 'LACTATION', 'DRY_SOW', 'PRODUCTIVE_SOW'];
const MALE_STAGES = ['BOAR_AI'];
const BOAR_STAGE = 'BOAR_AI';

class RollBack extends Error {}

async function main() {
  // `pnpm nx run … -- --apply` can hand the script a bare `--` as well.
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  if (args.some((a) => a !== '--apply' && a !== '--verify') || (apply && verify)) {
    throw new Error('Use no flags (plan only), --verify, or --apply.');
  }
  const log = (line: string) => console.log(`[align-demo-stage-sex] ${line}`);
  const app = await bootApp();
  try {
    const masterDb = app.get<MySql2Database<typeof masterSchema>>(MASTER_CONNECTION);
    const [tenant] = await masterDb.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.tenant_code, TENANT_CODE)).limit(1);
    if (!tenant) throw new Error(`Tenant '${TENANT_CODE}' not found.`);
    const ctx = { app, tenantId: tenant.tenant_id, log } as unknown as DemoContext;

    await inTenant(ctx, async () => {
      const cls = app.get(ClsService);
      const db = () => cls.get<MySql2Database<typeof schema>>('tenantDb');
      log(`Mode: ${apply ? 'APPLY' : verify ? 'VERIFY (rolled back)' : 'PLAN (read-only)'} · tenant ${TENANT_CODE}`);

      const stages = await db()
        .select({ stage_id: schema.stageMaster.stage_id, stage_code: schema.stageMaster.stage_code, company_id: schema.stageMaster.company_id, applicable_gender: schema.stageMaster.applicable_gender })
        .from(schema.stageMaster)
        .where(and(inArray(schema.stageMaster.stage_code, [...FEMALE_STAGES, ...MALE_STAGES]), isNull(schema.stageMaster.deleted_at)));
      const wanted = (code: string) => (MALE_STAGES.includes(code) ? 'M' : 'F');
      const toSet = stages.filter((s) => s.applicable_gender !== wanted(s.stage_code));
      log(`Stages to set: ${toSet.length} of ${stages.length} rows (tenant template and company copies)`);
      for (const s of toSet) log(`  ${s.stage_code.padEnd(15)} ${s.company_id ? 'company' : 'template'}  ${s.applicable_gender ?? 'either'} → ${wanted(s.stage_code)}`);

      // Live males standing at a female-only stage.
      const misplaced = (
        await db()
          .select({
            animal_id: schema.animalRegister.animal_id,
            animal_code: schema.animalRegister.animal_code,
            company_id: schema.animalRegister.company_id,
            current_batch_id: schema.animalRegister.current_batch_id,
            current_stage_id: schema.animalRegister.current_stage_id,
            stage_code: schema.stageMaster.stage_code,
          })
          .from(schema.animalRegister)
          .innerJoin(schema.stageMaster, eq(schema.stageMaster.stage_id, schema.animalRegister.current_stage_id))
          .where(and(eq(schema.animalRegister.gender, 'M'), eq(schema.animalRegister.is_active, true)))
      ).filter((a) => FEMALE_STAGES.includes(a.stage_code));
      log(`Boars at a sow stage: ${misplaced.length}`);
      for (const a of misplaced) log(`  ${a.animal_code.padEnd(14)} ${a.stage_code} → ${BOAR_STAGE}${a.current_batch_id ? ' (stage move in his batch)' : ' (in no batch: register stage set, movement logged)'}`);
      if (!apply && !verify) {
        log('Plan only — nothing written. Run with --verify, then --apply.');
        return;
      }

      const animals = app.get(AnimalService);
      const movementLog = app.get(AnimalMovementLogService);
      const today = new Date().toISOString().slice(0, 10);
      try {
        await withTenantTransaction(cls, async () => {
          for (const s of toSet) {
            await db().update(schema.stageMaster).set({ applicable_gender: wanted(s.stage_code) }).where(eq(schema.stageMaster.stage_id, s.stage_id));
          }
          for (const a of misplaced) {
            const [boarStage] = await db()
              .select({ stage_id: schema.stageMaster.stage_id })
              .from(schema.stageMaster)
              .where(and(eq(schema.stageMaster.stage_code, BOAR_STAGE), eq(schema.stageMaster.company_id, a.company_id), isNull(schema.stageMaster.deleted_at)))
              .limit(1);
            if (!boarStage) throw new Error(`No ${BOAR_STAGE} stage for ${a.animal_code}'s company.`);
            if (a.current_batch_id) {
              await animals.transitionStage(
                a.animal_id,
                { to_stage_id: boarStage.stage_id, transition_date: today, reason: 'Demo data: boars stand at Boar AI (L2)' } as any,
                tenant.tenant_id,
              );
            } else {
              await db().update(schema.animalRegister).set({ current_stage_id: boarStage.stage_id }).where(eq(schema.animalRegister.animal_id, a.animal_id));
              await movementLog.record({
                tenantId: tenant.tenant_id,
                companyId: a.company_id,
                animalId: a.animal_id,
                movementType: 'STAGE_CHANGE',
                eventDate: today,
                fromStageId: a.current_stage_id,
                toStageId: boarStage.stage_id,
                reason: 'Demo data: boars stand at Boar AI (L2)',
              });
            }
          }
          if (verify) throw new RollBack();
        });
      } catch (err) {
        if (!(err instanceof RollBack)) throw err;
        log('VERIFY: all of the above ran and was rolled back — nothing was written.');
        return;
      }
      log('APPLIED.');
    });
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[align-demo-stage-sex] FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
