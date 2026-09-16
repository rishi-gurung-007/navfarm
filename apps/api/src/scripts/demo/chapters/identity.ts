/**
 * Chapter `identity` — the first demo chapter (Phase 3 Task 2). Makes sure
 * every one of the nine farms has a farm worker assigned to the Piggery
 * operational area, through `UserService.create` and
 * `OperationalAreaService.addStaff` — not raw inserts — with the company
 * admin as the requesting actor.
 *
 * seed-nine-farm-demo.ts already issues a per-farm login pair
 * (`<code>.entry@triplec.local` / `<code>.manager@triplec.local`), so on a
 * seeded tenant this chapter mostly confirms the Piggery assignment is in
 * place. Where a farm has no entry user it creates `worker.<key>@triplec.local`
 * through the service, which is how the two farms the chapters were originally
 * written around (worker.grasmere, worker.kintyre) came to exist.
 *
 * Names are demo facts (plan Task 2 Step 3): Zimbabwe-appropriate,
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
import type { DemoFarm } from '../farms';

/** The one operational area the demo uses (seed-dev-tenant.ts: 'PIGGERY-01' Piggery). */
const AREA_CODE = 'PIGGERY-01';

/** Demo worker names, one per farm key, in the order the farms are walked. */
const WORKER_NAMES: Record<string, string> = {
  grasmere: 'Tendai Moyo',
  kintyre: 'Rudo Chikwanha',
  ric100: 'Farai Ncube',
  vil100: 'Tapiwa Dube',
  gra100: 'Chipo Marufu',
  lea100: 'Blessing Sibanda',
  lio100: 'Nyasha Mutasa',
  ai100: 'Takudzwa Zhou',
  lex100: 'Shamiso Gwena',
};

/**
 * Where a farm's worker is looked for, in order: the per-farm login the
 * nine-farm seed issues, then the chapter's own worker account. The first
 * that exists is the farm's worker; if neither does, the second is created.
 */
function workerEmails(farm: DemoFarm): { seeded: string; own: string } {
  return { seeded: `${farm.code.toLowerCase()}.entry@triplec.local`, own: `worker.${farm.key}@triplec.local` };
}

export const identityChapter: DemoChapter = {
  name: 'identity',

  async run(ctx: DemoContext) {
    const users = ctx.app.get(UserService);
    const areas = ctx.app.get(OperationalAreaService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('identity chapter: tenantDb is not set — run through the harness.');

    // The Piggery area the workers are assigned to. The harness must have
    // been entered through inTenant() for this select to resolve.
    const [area] = await db
      .select({ area_id: schema.operationalAreaMaster.area_id, area_name: schema.operationalAreaMaster.area_name })
      .from(schema.operationalAreaMaster)
      .where(and(eq(schema.operationalAreaMaster.area_code, AREA_CODE), eq(schema.operationalAreaMaster.company_id, ctx.companyId)))
      .limit(1);
    if (!area) throw new Error(`Operational area '${AREA_CODE}' not found for company ${ctx.companyId} — the master stages must seed it first.`);

    const requester = ctx.actor;

    /** Idempotent: an existing user is adopted and only its assignment topped up. */
    async function ensureAssigned(userId: string, email: string, note: string) {
      const [assignment] = await db
        .select({ assignment_id: schema.userOperationalAreaAssignment.assignment_id })
        .from(schema.userOperationalAreaAssignment)
        .where(and(eq(schema.userOperationalAreaAssignment.user_id, userId), eq(schema.userOperationalAreaAssignment.area_id, area.area_id)))
        .limit(1);
      if (assignment) {
        ctx.log(`  ${email}: ${note}, Piggery assignment already in place — skipped`);
        return;
      }
      await areas.addStaff(area.area_id, { user_id: userId, is_primary: true });
      ctx.log(`  ${email}: ${note}, Piggery assignment added`);
    }

    // One read of the company's users; nine farms looking each other up one
    // at a time was nine identical queries.
    const existing = await db
      .select({ user_id: schema.userMaster.user_id, email: schema.userMaster.email })
      .from(schema.userMaster)
      .where(eq(schema.userMaster.company_id, ctx.companyId));
    const byEmail = new Map(existing.map((u) => [u.email, u.user_id]));

    for (const farm of ctx.demoFarms) {
      const emails = workerEmails(farm);
      const found = byEmail.get(emails.seeded) ?? byEmail.get(emails.own);
      if (found) {
        const email = byEmail.has(emails.seeded) ? emails.seeded : emails.own;
        await ensureAssigned(found, email, `${farm.code} worker`);
        continue;
      }

      const created = await users.create(
        {
          company_id: ctx.companyId,
          tenant_id: ctx.tenantId,
          full_name: WORKER_NAMES[farm.key] ?? `${farm.code} Farm Worker`,
          email: emails.own,
          password: '12345678' /* dev only — demo workers, plan Task 2 Step 3 */,
          user_type: 'STANDARD_USER',
          farm_id: farm.farmId,
          department: 'DEMO — Triple C farm operations',
          designation: 'Farm Worker',
        },
        requester,
      );
      byEmail.set(created.email, created.user_id);
      ctx.log(`  created ${created.email} (${created.user_id}) on farm ${farm.code}`);
      await areas.addStaff(area.area_id, { user_id: created.user_id, is_primary: true });
      ctx.log(`  assigned ${created.email} to Piggery (${area.area_id})`);
    }
  },
};
