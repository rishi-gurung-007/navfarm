import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import { isNull, sql } from 'drizzle-orm';
import * as master from '../core/database/master-schema';
import * as tenant from '../core/database/schema';
import { SYSTEM_UOM_SEED, SYSTEM_SPECIES_SEED, SYSTEM_KPI_METRIC_SEED } from '../core/database/system-master-data-seed';

/**
 * One-time backfill: seeds the system-generated UOM/Species/KPI Metric
 * reference data (see system-master-data-seed.ts) into every EXISTING
 * tenant database. New tenants get this automatically at signup
 * (tenant.service.ts); this script only needs to run once against
 * databases created before that seeding was added. Safe to re-run —
 * skips any tenant that already has tenant-wide (company_id IS NULL)
 * Species or KPI Metric rows.
 *
 * UOM is handled differently: unlike Species/KPI Metric, most tenants
 * already carry tenant-wide UOM rows from earlier seed runs, so an
 * all-or-nothing check would skip a tenant forever the moment it had any
 * — silently missing new codes SYSTEM_UOM_SEED later grows (RATIO/SCORE/
 * CELSIUS/PCT, added for the KPI Metric master's Default UOM dropdown).
 * Inserts only the codes a tenant doesn't already have, by code, not by
 * an all-or-nothing row count.
 */

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'nf_master';

async function run() {
  const masterPool = mysql.createPool({ host, port, user, password, database: masterDatabase, ssl });
  const masterDb = drizzle(masterPool, { schema: master, mode: 'default' });

  try {
    const tenants = await masterDb.select().from(master.tenantMaster);
    console.log(`Found ${tenants.length} tenant(s) in ${masterDatabase}.`);

    for (const t of tenants) {
      const tenantPool = mysql.createPool({
        host: t.db_host || host,
        port: t.db_port || port,
        user: t.db_user || user,
        password: t.db_password || password,
        database: t.db_name,
        ssl,
      });
      const tenantDb = drizzle(tenantPool, { schema: tenant, mode: 'default' });

      try {
        const existingUomCodes = new Set(
          (await tenantDb
            .select({ code: tenant.uomMaster.uom_code })
            .from(tenant.uomMaster)
            .where(isNull(tenant.uomMaster.company_id))).map((r) => r.code),
        );
        const missingUom = SYSTEM_UOM_SEED.filter((u) => !existingUomCodes.has(u.uom_code));
        if (missingUom.length) {
          await tenantDb.insert(tenant.uomMaster).values(
            missingUom.map((u) => ({ ...u, tenant_id: t.tenant_id })),
          );
          console.log(`  [${t.tenant_code}] seeded ${missingUom.length} missing UOM(s): ${missingUom.map((u) => u.uom_code).join(', ')}.`);
        } else {
          console.log(`  [${t.tenant_code}] UOM already carries every SYSTEM_UOM_SEED code, skipped.`);
        }

        const [existingSpecies] = await tenantDb
          .select({ count: sql<number>`count(*)` })
          .from(tenant.speciesMaster)
          .where(isNull(tenant.speciesMaster.company_id));
        if (Number(existingSpecies.count) === 0) {
          await tenantDb.insert(tenant.speciesMaster).values(
            SYSTEM_SPECIES_SEED.map((s) => ({ ...s, tenant_id: t.tenant_id }))
          );
          console.log(`  [${t.tenant_code}] seeded ${SYSTEM_SPECIES_SEED.length} Species.`);
        } else {
          console.log(`  [${t.tenant_code}] Species already seeded (${existingSpecies.count} tenant-wide rows), skipped.`);
        }

        const [existingKpiMetric] = await tenantDb
          .select({ count: sql<number>`count(*)` })
          .from(tenant.kpiMetricMaster)
          .where(isNull(tenant.kpiMetricMaster.company_id));
        if (Number(existingKpiMetric.count) === 0) {
          await tenantDb.insert(tenant.kpiMetricMaster).values(
            SYSTEM_KPI_METRIC_SEED.map((m) => ({ ...m, tenant_id: t.tenant_id }))
          );
          console.log(`  [${t.tenant_code}] seeded ${SYSTEM_KPI_METRIC_SEED.length} KPI Metrics.`);
        } else {
          console.log(`  [${t.tenant_code}] KPI Metrics already seeded (${existingKpiMetric.count} tenant-wide rows), skipped.`);
        }
      } catch (err) {
        console.error(`  [${t.tenant_code}] FAILED:`, err instanceof Error ? err.message : err);
      } finally {
        await tenantPool.end();
      }
    }

    console.log('Done.');
  } finally {
    await masterPool.end();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
