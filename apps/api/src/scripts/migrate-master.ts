import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import * as mysql from 'mysql2/promise';
import * as master from '../core/database/master-schema';

/**
 * Applies pending master-schema migrations (src/drizzle/master) to the master
 * database. Safe to re-run — drizzle tracks applied migrations per database.
 *
 * This exists because `drizzle-kit migrate` refuses to start when the password
 * is empty ("Please provide required params for MySQL driver: [x] password"),
 * and a password-less local root is this project's documented dev setup — see
 * AGENTS.md §5. The tenant side never hit it because migrate-all-tenants.ts
 * already drives the migrator through mysql2, which accepts an empty password.
 * Same migrator, same journal table, same files; only the connection differs.
 */

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';

async function run() {
  const pool = mysql.createPool({ host, port, user, password, database: masterDatabase, ssl });
  const db = drizzle(pool, { schema: master, mode: 'default' });

  try {
    await migrate(db as any, {
      migrationsFolder: resolve(process.cwd(), 'src/drizzle/master'),
    });
    console.log(`[${masterDatabase}] master migrations applied (or already up to date).`);
  } finally {
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
