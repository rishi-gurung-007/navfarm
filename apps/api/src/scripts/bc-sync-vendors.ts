/**
 * Business Central vendors → NAVFarm suppliers, from the command line.
 *
 *   pnpm nx run api:db-bc-sync-vendors              read-only: fetch BC, print the plan
 *   pnpm nx run api:db-bc-sync-vendors --verify     apply inside a transaction, count rows in MySQL, ROLL BACK
 *   pnpm nx run api:db-bc-sync-vendors --apply      apply and commit (+ write-back to BC when enabled), logged in integration_sync_log
 *
 * Uses the same mapper/planner/engine as the API (POST /integration/business-central/vendors/sync), so what this
 * prints is what the API does. Settings come from apps/api/.env (BC_*). BC_VENDOR_SYNC_SCOPE=ALL can be set for one
 * run to rehearse the mapping on every vendor — use it with --verify, never --apply, unless Finance wants all of them.
 */
import mysql from 'mysql2/promise';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import * as masterSchema from '../core/database/master-schema';
import { readBusinessCentralConfig } from '../modules/integration/business-central/business-central.config';
import { BcTokenService } from '../modules/integration/business-central/bc-token.service';
import { BcODataClient } from '../modules/integration/business-central/bc-odata.client';
import {
  applyVendorPlan,
  fetchBcVendors,
  finishSyncLog,
  loadExistingSuppliers,
  planVendorSync,
  startSyncLog,
  writeBackToBc,
} from '../modules/integration/business-central/vendor-sync/bc-vendor-sync.engine';
import { summariseResult } from '../modules/integration/business-central/vendor-sync/bc-vendor-sync.service';

const ROLLBACK = new Error('verify: rolled back');

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const config = readBusinessCentralConfig();
  if (!config.navfarmTenantCode || !config.navfarmCompanyCode) {
    throw new Error('Set BC_NAVFARM_TENANT_CODE and BC_NAVFARM_COMPANY_CODE in apps/api/.env.');
  }

  const connection = {
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true' ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } : undefined,
  };
  const masterConn = await mysql.createConnection({ ...connection, database: process.env.DATABASE_NAME || 'nf_master' });
  const master = drizzle(masterConn, { schema: masterSchema, mode: 'default' });
  const [tenant] = await master.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.tenant_code, config.navfarmTenantCode)).limit(1);
  await masterConn.end();
  if (!tenant) throw new Error(`Tenant ${config.navfarmTenantCode} not found in nf_master.`);

  const tenantConn = await mysql.createConnection({ ...connection, database: tenant.db_name });
  const db = drizzle(tenantConn, { schema, mode: 'default' });
  try {
    const [company] = await db
      .select({ id: schema.companyMaster.company_id, name: schema.companyMaster.company_name })
      .from(schema.companyMaster)
      .where(and(eq(schema.companyMaster.company_code, config.navfarmCompanyCode), isNull(schema.companyMaster.deleted_at)))
      .limit(1);
    if (!company) throw new Error(`Company ${config.navfarmCompanyCode} not found in ${tenant.db_name}.`);

    const tokens = new BcTokenService(config, fetch);
    const client = new BcODataClient(config, fetch, tokens);
    console.log(`BC ${config.environment} / "${config.companyName}" → NAVFarm ${tenant.db_name} / ${company.name}; scope ${config.vendor.scope}`);

    const vendors = await fetchBcVendors(client, config);
    const plan = planVendorSync(vendors, await loadExistingSuppliers(db, tenant.tenant_id, company.id), config.vendor);
    const summary = summariseResult({ logId: null, status: 'PREVIEW', scope: config.vendor.scope, plan, writtenBack: 0, writeBackErrors: [], error: null });
    console.log(`Fetched ${plan.fetched}. Plan: ${JSON.stringify(plan.counts)}`);
    if (plan.blockedReason) console.log(`BLOCKED: ${plan.blockedReason}`);
    for (const a of summary.actions.slice(0, 15)) console.log('  ', JSON.stringify(a));
    if (summary.actions.length > 15) console.log(`   … ${summary.actions.length - 15} more`);
    if (!apply && !verify) return console.log('\nRead-only. Nothing written. Use --verify to rehearse or --apply to commit.');
    if (plan.blockedReason) throw new Error('Refusing to apply a blocked plan.');

    const ctx = { tenantId: tenant.tenant_id, companyId: company.id, userId: null, trigger: 'SCRIPT' as const };
    if (verify) {
      await db
        .transaction(async (tx) => {
          await applyVendorPlan(tx as any, plan, ctx);
          const [row] = await tx
            .select({
              total: sql<number>`count(*)`,
              bc: sql<number>`sum(source_system = 'BC')`,
              active: sql<number>`sum(source_system = 'BC' and is_active = 1)`,
            })
            .from(schema.supplierMaster)
            .where(and(eq(schema.supplierMaster.tenant_id, tenant.tenant_id), eq(schema.supplierMaster.company_id, company.id)));
          console.log(`\nInside the transaction: ${row.total} suppliers, ${row.bc} from BC, ${row.active} of them active.`);
          const sample = await tx
            .select({
              code: schema.supplierMaster.supplier_code,
              name: schema.supplierMaster.supplier_name,
              terms: schema.supplierMaster.payment_terms,
              currency: schema.supplierMaster.currency_code,
              vpg: schema.supplierMaster.vendor_posting_group,
              active: schema.supplierMaster.is_active,
            })
            .from(schema.supplierMaster)
            .where(and(eq(schema.supplierMaster.tenant_id, tenant.tenant_id), eq(schema.supplierMaster.source_system, 'BC')))
            .limit(5);
          console.table(sample);
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        });
      return console.log('Rolled back. Nothing written to NAVFarm or BC.');
    }

    const logId = await startSyncLog(db, ctx);
    await db.transaction(async (tx) => applyVendorPlan(tx as any, plan, ctx));
    let writtenBack = 0;
    let writeBackErrors: Array<{ vendorNo: string; error: string }> = [];
    if (config.vendor.writeBack) ({ written: writtenBack, errors: writeBackErrors } = await writeBackToBc(db, client, config, plan, vendors, ctx));
    const status = plan.counts.failed || writeBackErrors.length ? 'PARTIAL' : 'SUCCESS';
    await finishSyncLog(db, logId, { status, scope: config.vendor.scope, plan, writtenBack, writeBackErrors, error: null });
    console.log(`Committed. integration_sync_log ${logId}: ${status}; written back to BC: ${writtenBack}.`);
  } finally {
    await tenantConn.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
