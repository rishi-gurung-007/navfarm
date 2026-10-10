import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import * as mysql from 'mysql2/promise';
import * as master from '../core/database/master-schema';
import * as tenant from '../core/database/schema';
import { assertCanonicalLineage, isMissingTableError } from './migration-lineage';
import { assertDatabaseAllowed } from '../core/database/database-allowlist';

/**
 * Applies any pending tenant-schema migrations (src/drizzle/tenant) to every
 * EXISTING, master-registered tenant database. New tenants already get the
 * full migration set at signup (tenant.service.ts); this script is for
 * rolling schema changes out to tenants created before the change shipped.
 * Safe to re-run — drizzle tracks applied migrations per database.
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
  assertDatabaseAllowed(masterDatabase, 'migrate-all-tenants master');
  const masterPool = mysql.createPool({ host, port, user, password, database: masterDatabase, ssl });
  const masterDb = drizzle(masterPool, { schema: master, mode: 'default' });

  try {
    const tenants = await masterDb.select().from(master.tenantMaster);
    console.log(`Found ${tenants.length} tenant(s) in ${masterDatabase}.`);
    const failedTenants: string[] = [];

    for (const t of tenants) {
      // A registry row decides which database this migrates; refuse any the
      // allowlist does not name before DDL can reach it.
      try {
        assertDatabaseAllowed(t.db_name, `migrate-all-tenants tenant ${t.tenant_code}`);
      } catch (err) {
        console.error(`  [${t.tenant_code}] REFUSED:`, err instanceof Error ? err.message : err);
        failedTenants.push(t.tenant_code);
        continue;
      }
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
        // The Mac development tenant has the older Feed Forecast lineage (its
        // journal is beyond the Windows baseline and it already owns feed
        // loading tables).  Never let the canonical Windows migration folder
        // run against that lineage: it would replay overlapping columns.
        let latestId = 0;
        try {
          const [journalRows] = await tenantPool.query<mysql.RowDataPacket[]>(
            'SELECT id FROM __drizzle_migrations ORDER BY id DESC LIMIT 1',
          );
          latestId = Number(journalRows[0]?.id ?? 0);
        } catch (err) {
          // A truly empty database has no journal yet; drizzle creates it. Treat as journal 0.
          if (!isMissingTableError(err)) throw err;
        }
        const [loadingTables] = await tenantPool.query<mysql.RowDataPacket[]>(
          "SHOW TABLES LIKE 'feed_loading_sheet'",
        );
        assertCanonicalLineage(latestId, loadingTables.length > 0);
        await migrate(tenantDb as any, {
          migrationsFolder: resolve(process.cwd(), 'src/drizzle/tenant'),
        });
        console.log(`  [${t.tenant_code}] migrations applied (or already up to date).`);
      } catch (err) {
        console.error(`  [${t.tenant_code}] FAILED:`, err instanceof Error ? err.message : err);
        failedTenants.push(t.tenant_code);
      } finally {
        await tenantPool.end();
      }
    }

    if (failedTenants.length > 0) {
      throw new Error(`Tenant migrations failed for: ${failedTenants.join(', ')}`);
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
