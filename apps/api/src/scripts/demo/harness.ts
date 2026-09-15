/**
 * The service harness for the demo chapters. Boots the real Nest application
 * context and runs chapter work inside the same CLS context TenantMiddleware
 * builds for an HTTP request — `tenantDb` (Drizzle for the tenant) and
 * `tenantId` — so every service the chapters call resolves its database the
 * way it does behind the API. `farmScope` is deliberately never set: the
 * farm-scope module defines an unset scope as an unrestricted internal caller.
 *
 * Ruling 1 of the phase plan lives here: nothing in this file inserts an
 * operational row. Masters and identity stay raw (the seed chain owns them);
 * everything a posting is created through the services the chapters call.
 */
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { eq, inArray } from 'drizzle-orm';
import { AppModule } from '../../app.module';
import { MASTER_CONNECTION } from '../../core/database/database.module';
import * as masterSchema from '../../core/database/master-schema';
import { ConnectionManagerService } from '../../core/database/connection-manager.service';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../core/database/schema';
import type { DemoContext } from './chapter';

type MasterDb = MySql2Database<typeof masterSchema>;

/** The dev tenant the demo rebuild targets — resolved by code, as the middleware resolves it. */
const DEMO_TENANT_CODE = 'devco';
/** The one company (seed-dev-tenant.ts: "One tenant, one company, one operational area"). */
const DEMO_COMPANY_CODE = 'TRIPLEC';
/** The COMPANY_ADMIN the chapters post as; batch transfers refuse a caller without an admin userType. */
const DEMO_ACTOR_EMAIL = 'company.admin@triplec.local';

export async function bootApp(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
}

/**
 * Resolve the demo tenant from navfarm_master exactly as TenantMiddleware
 * does (by tenant_code) and build the chapter context: company id, the
 * company-admin actor, and the two Triple C farms by their real location
 * codes. Throws — never guesses — on anything missing, because a chapter that
 * silently skipped a fact is worse than a rebuild that stopped.
 */
export async function buildDemoContext(app: INestApplicationContext, log: (line: string) => void): Promise<DemoContext> {
  const masterDb = app.get<MasterDb>(MASTER_CONNECTION);
  const [tenant] = await masterDb
    .select()
    .from(masterSchema.tenantMaster)
    .where(eq(masterSchema.tenantMaster.tenant_code, DEMO_TENANT_CODE))
    .limit(1);
  if (!tenant) throw new Error(`Demo tenant '${DEMO_TENANT_CODE}' not found in navfarm_master — run the master stages of the rebuild first.`);
  if (!tenant.is_active) throw new Error(`Demo tenant '${DEMO_TENANT_CODE}' is inactive.`);

  const tenantDb = await app.get(ConnectionManagerService).getTenantConnection(tenant);

  const [company] = await tenantDb
    .select({ company_id: schema.companyMaster.company_id, company_name: schema.companyMaster.company_name })
    .from(schema.companyMaster)
    .where(eq(schema.companyMaster.company_code, DEMO_COMPANY_CODE))
    .limit(1);
  if (!company) throw new Error(`Demo company '${DEMO_COMPANY_CODE}' not found — run the master stages of the rebuild first.`);

  const [actor] = await tenantDb
    .select({ user_id: schema.userMaster.user_id, email: schema.userMaster.email, user_type: schema.userMaster.user_type })
    .from(schema.userMaster)
    .where(eq(schema.userMaster.email, DEMO_ACTOR_EMAIL))
    .limit(1);
  if (!actor) throw new Error(`Demo actor '${DEMO_ACTOR_EMAIL}' not found — the master stages must seed the company admin before the chapters run.`);

  const farmRows = await tenantDb
    .select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code })
    .from(schema.locationMaster)
    .where(inArray(schema.locationMaster.location_code, ['MUL100', 'POR100']));
  const byCode = new Map(farmRows.map((f) => [f.location_code, f.location_id]));
  const grasmere = byCode.get('MUL100');
  const kintyre = byCode.get('POR100');
  if (!grasmere || !kintyre) {
    throw new Error(
      `Triple C farms MUL100/POR100 not found (found: ${[...byCode.keys()].join(', ') || 'none'}) — run seed-farm-locations.ts before the chapters.`,
    );
  }

  log(`Tenant ${tenant.tenant_code} (${tenant.tenant_id}) · company ${company.company_name} · actor ${actor.email}`);
  log(`Farms: Grasmere MUL100 ${grasmere} · Kintyre POR100 ${kintyre}`);

  return {
    app,
    tenantId: tenant.tenant_id,
    companyId: company.company_id,
    actor: {
      userId: actor.user_id,
      userType: 'COMPANY_ADMIN',
      tenantId: tenant.tenant_id,
      email: actor.email,
    },
    farms: { grasmere, kintyre },
    log,
  };
}

/**
 * Run `work` inside a CLS context with `tenantDb`/`tenantId` set exactly as
 * TenantMiddleware sets them for an HTTP request. `farmScope` is never set —
 * an unset scope is what the farm-scope module treats as an unrestricted
 * internal caller, which is what a rebuild script is.
 */
export async function inTenant<T>(ctx: DemoContext, work: () => Promise<T>): Promise<T> {
  const cls = ctx.app.get(ClsService);
  const tenantDb = await resolveTenantDb(ctx);
  return cls.run(async () => {
    cls.set('tenantId', ctx.tenantId);
    cls.set('tenantDb', tenantDb);
    return work();
  });
}

let cachedTenantDb: MySql2Database<typeof schema> | undefined;

async function resolveTenantDb(ctx: DemoContext): Promise<MySql2Database<typeof schema>> {
  if (cachedTenantDb) return cachedTenantDb;
  const masterDb = ctx.app.get<MasterDb>(MASTER_CONNECTION);
  const [tenant] = await masterDb
    .select()
    .from(masterSchema.tenantMaster)
    .where(eq(masterSchema.tenantMaster.tenant_id, ctx.tenantId))
    .limit(1);
  if (!tenant) throw new Error(`Tenant ${ctx.tenantId} vanished between context build and harness run.`);
  cachedTenantDb = await ctx.app.get(ConnectionManagerService).getTenantConnection(tenant);
  return cachedTenantDb;
}
