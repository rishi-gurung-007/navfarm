import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import * as master from '../core/database/master-schema';
import * as tenant from '../core/database/schema';

/**
 * Syncs the platform-wide Timezone/Country/State reference data (master DB)
 * into every tenant database, inserting only rows the tenant doesn't already
 * have. Same shape as sync-nob-lob.ts — new tenants get a full copy at
 * signup (tenant.service.ts), but tenants that already existed when this
 * reference data was introduced (or when new rows are added later) need this
 * to catch up. Safe and cheap to re-run, only inserts what's missing.
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
    const masterTimezones = await masterDb.select().from(master.timezoneMaster);
    const masterCountries = await masterDb.select().from(master.countryMaster);
    const masterStates = await masterDb.select().from(master.stateProvince);
    console.log(
      `Found ${tenants.length} tenant(s); master has ${masterTimezones.length} timezone(s), ${masterCountries.length} countries, ${masterStates.length} states.`,
    );

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
        const existingTz = await tenantDb.select({ tz_id: tenant.timezoneMaster.tz_id }).from(tenant.timezoneMaster);
        const existingTzIds = new Set(existingTz.map((r) => r.tz_id));
        const missingTz = masterTimezones.filter((r) => !existingTzIds.has(r.tz_id));
        if (missingTz.length > 0) await tenantDb.insert(tenant.timezoneMaster).values(missingTz);

        const existingCountries = await tenantDb.select({ country_id: tenant.countryMaster.country_id }).from(tenant.countryMaster);
        const existingCountryIds = new Set(existingCountries.map((r) => r.country_id));
        const missingCountries = masterCountries.filter((r) => !existingCountryIds.has(r.country_id));
        if (missingCountries.length > 0) await tenantDb.insert(tenant.countryMaster).values(missingCountries);

        const existingStates = await tenantDb.select({ state_id: tenant.stateProvince.state_id }).from(tenant.stateProvince);
        const existingStateIds = new Set(existingStates.map((r) => r.state_id));
        const missingStates = masterStates.filter((r) => !existingStateIds.has(r.state_id));
        if (missingStates.length > 0) await tenantDb.insert(tenant.stateProvince).values(missingStates);

        console.log(
          `  [${t.tenant_code}] synced ${missingTz.length} timezone(s), ${missingCountries.length} countr${missingCountries.length === 1 ? 'y' : 'ies'}, ${missingStates.length} state(s).`,
        );
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
