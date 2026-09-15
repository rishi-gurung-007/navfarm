/**
 * Chapter `identity` — the first demo chapter (Phase 3 Task 2). Creates the
 * two farm workers the demo's later chapters will post daily entries as,
 * through `UserService.create` and `OperationalAreaService.addStaff` — not
 * raw inserts — with the company admin as the requesting actor.
 *
 * Names and emails are demo facts (plan Task 2 Step 3): Zimbabwe-appropriate,
 * `@triplec.local`, password dev-only. `DEMO` appears in each user's
 * free-text field per the phase's global constraints.
 */
import { and, eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { UserService } from '../../../modules/core/user/user.service';
import { OperationalAreaService } from '../../../modules/core/operational-area/operational-area.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

/** The one operational area the demo uses (seed-dev-tenant.ts: 'PIGGERY-01' Piggery). */
const AREA_CODE = 'PIGGERY-01';

interface WorkerSpec {
  full_name: string;
  email: string;
  farm: 'grasmere' | 'kintyre';
  farm_code: string;
}

const WORKERS: WorkerSpec[] = [
  { full_name: 'Tendai Moyo', email: 'worker.grasmere@triplec.local', farm: 'grasmere', farm_code: 'MUL100' },
  { full_name: 'Rudo Chikwanha', email: 'worker.kintyre@triplec.local', farm: 'kintyre', farm_code: 'POR100' },
];

export const identityChapter: DemoChapter = {
  name: 'identity',

  async run(ctx: DemoContext) {
    const users = ctx.app.get(UserService);
    const areas = ctx.app.get(OperationalAreaService);
    const cls = ctx.app.get(ClsService);
    const tenantDb = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('identity chapter: tenantDb is not set — run through the harness.');

    // The Piggery area the workers are assigned to. The harness must have
    // been entered through inTenant() for this select to resolve.
    const [area] = await tenantDb
      .select({ area_id: schema.operationalAreaMaster.area_id, area_name: schema.operationalAreaMaster.area_name })
      .from(schema.operationalAreaMaster)
      .where(and(eq(schema.operationalAreaMaster.area_code, AREA_CODE), eq(schema.operationalAreaMaster.company_id, ctx.companyId)))
      .limit(1);
    if (!area) throw new Error(`Operational area '${AREA_CODE}' not found for company ${ctx.companyId} — the master stages must seed it first.`);

    const requester = ctx.actor;

    for (const w of WORKERS) {
      const farmId = ctx.farms[w.farm];
      const [existing] = await tenantDb
        .select({ user_id: schema.userMaster.user_id })
        .from(schema.userMaster)
        .where(eq(schema.userMaster.email, w.email))
        .limit(1);

      if (existing) {
        // Rerun-safe within --force-on-existing development runs: do not
        // double-create; verify the assignment is in place and move on.
        const [assignment] = await tenantDb
          .select({ assignment_id: schema.userOperationalAreaAssignment.assignment_id })
          .from(schema.userOperationalAreaAssignment)
          .where(and(eq(schema.userOperationalAreaAssignment.user_id, existing.user_id), eq(schema.userOperationalAreaAssignment.area_id, area.area_id)))
          .limit(1);
        if (!assignment) {
          await areas.addStaff(area.area_id, { user_id: existing.user_id, is_primary: true });
          ctx.log(`  ${w.email}: already existed, Piggery assignment added`);
        } else {
          ctx.log(`  ${w.email}: already exists with Piggery assignment — skipped`);
        }
        continue;
      }

      const created = await users.create(
        {
          company_id: ctx.companyId,
          tenant_id: ctx.tenantId,
          full_name: w.full_name,
          email: w.email,
          password: '12345678' /* dev only — demo workers, plan Task 2 Step 3 */,
          user_type: 'STANDARD_USER',
          farm_id: farmId,
          department: 'DEMO — Triple C farm operations',
          designation: 'Farm Worker',
        },
        requester,
      );
      ctx.log(`  created ${created.email} (${created.user_id}) on farm ${w.farm_code}`);

      await areas.addStaff(area.area_id, { user_id: created.user_id, is_primary: true });
      ctx.log(`  assigned ${w.email} to Piggery (${area.area_id})`);
    }
  },
};
