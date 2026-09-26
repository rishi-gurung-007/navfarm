import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import * as master from '../core/database/master-schema';
import * as tenant from '../core/database/schema';

/**
 * Syncs the platform-wide NOB/LOB taxonomy (master DB) into every tenant
 * database, inserting only rows the tenant doesn't already have. New tenants
 * get a full copy at signup (tenant.service.ts); this script exists because
 * that copy is a point-in-time snapshot — if a SYSTEM_ADMIN adds a new NOB or
 * LOB afterwards (via /setup/wizard/nobs|lobs), existing tenants never see it
 * without this. Safe and cheap to re-run on a schedule or after any NOB/LOB
 * change, since it only inserts what's missing (matched by primary key).
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
    const masterNobs = await masterDb.select().from(master.nobMaster);
    const masterLobs = await masterDb.select().from(master.lobMaster);
    console.log(`Found ${tenants.length} tenant(s); master has ${masterNobs.length} NOB(s), ${masterLobs.length} LOB(s).`);

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
        const existingNobs = await tenantDb.select({ nob_id: tenant.nobMaster.nob_id }).from(tenant.nobMaster);
        const existingNobIds = new Set(existingNobs.map((n) => n.nob_id));
        const missingNobs = masterNobs.filter((n) => !existingNobIds.has(n.nob_id));
        if (missingNobs.length > 0) {
          await tenantDb.insert(tenant.nobMaster).values(missingNobs);
        }

        const existingLobs = await tenantDb.select({ lob_id: tenant.lobMaster.lob_id }).from(tenant.lobMaster);
        const existingLobIds = new Set(existingLobs.map((l) => l.lob_id));
        const missingLobs = masterLobs.filter((l) => !existingLobIds.has(l.lob_id));
        if (missingLobs.length > 0) {
          await tenantDb.insert(tenant.lobMaster).values(missingLobs);
        }

        if (missingNobs.length === 0 && missingLobs.length === 0) {
          console.log(`  [${t.tenant_code}] already in sync.`);
        } else {
          console.log(`  [${t.tenant_code}] synced ${missingNobs.length} NOB(s), ${missingLobs.length} LOB(s).`);
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
