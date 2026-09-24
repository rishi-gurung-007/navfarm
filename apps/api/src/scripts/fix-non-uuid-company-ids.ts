import * as mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

/**
 * Some dev-seed scripts gave companies hand-picked, readable placeholder ids
 * like `00000000-0000-0000-0000-000000000001` instead of a real
 * crypto.randomUUID(). class-validator's @IsUUID() (used on companyId query
 * params across ~30 DTOs) only accepts the literal all-zero "nil" UUID as a
 * special case — a value like `...0001` fails validation outright, so any
 * endpoint filtering by that company's id 400s with "companyId must be a
 * UUID". This silently breaks that company's dashboards, batch lists, etc.
 * (found via Apex Swine Genetics — whose seed id is the nil UUID and so
 * happened to work — vs. Highland Commercial Porkers, whose `...0001` id
 * did not).
 *
 * Real companies created through the app (CompanyService.create(),
 * SetupWizardService.saveStep1Profile()) always get a proper
 * crypto.randomUUID(), so this can't happen outside hand-authored seed data.
 * Safe and cheap to re-run — only touches company_master rows whose id
 * doesn't match a real UUID (the nil UUID is left alone since it validates
 * fine), and cascades the replacement across every table in that tenant DB
 * with a company_id column, inside a single transaction per table set.
 */

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const masterDatabase = process.env.DATABASE_NAME || 'nf_master';

// Same "all" acceptance rule as validator.js's isUUID(str, "all"): a proper
// v1-8 UUID with the correct variant nibble, or the two special-cased
// all-zero / all-f UUIDs.
const VALID_UUID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

async function fixTenantDb(dbName: string, connOpts: mysql.PoolOptions) {
  const pool = mysql.createPool({ ...connOpts, database: dbName });
  try {
    const [companies] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT company_id, company_name FROM company_master`,
    );
    const badCompanies = companies.filter((c) => !VALID_UUID.test(c.company_id));
    if (badCompanies.length === 0) {
      console.log(`  [${dbName}] all company ids valid, nothing to do.`);
      return;
    }

    const [tableRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'company_id'`,
      [dbName],
    );
    const tables = tableRows.map((r) => r.TABLE_NAME as string);

    for (const company of badCompanies) {
      const oldId = company.company_id as string;
      const newId = randomUUID();
      const conn = await pool.getConnection();
      try {
        await conn.query('SET FOREIGN_KEY_CHECKS=0');
        await conn.beginTransaction();
        for (const table of tables) {
          if (table === 'company_master') continue;
          await conn.query(`UPDATE \`${table}\` SET company_id = ? WHERE company_id = ?`, [newId, oldId]);
        }
        await conn.query(`UPDATE company_master SET company_id = ? WHERE company_id = ?`, [newId, oldId]);
        await conn.commit();
        console.log(`  [${dbName}] "${company.company_name}": ${oldId} -> ${newId} (${tables.length} tables checked)`);
      } catch (err) {
        await conn.rollback();
        console.error(`  [${dbName}] FAILED for "${company.company_name}":`, err instanceof Error ? err.message : err);
      } finally {
        await conn.query('SET FOREIGN_KEY_CHECKS=1');
        conn.release();
      }
    }
  } finally {
    await pool.end();
  }
}

async function run() {
  const masterPool = mysql.createPool({ host, port, user, password, database: masterDatabase });
  try {
    const [tenants] = await masterPool.query<mysql.RowDataPacket[]>(
      `SELECT tenant_code, db_name, db_host, db_port, db_user, db_password FROM tenant_master`,
    );
    console.log(`Checking ${tenants.length} tenant database(s) for non-UUID company ids...`);
    for (const t of tenants) {
      await fixTenantDb(t.db_name, {
        host: t.db_host || host,
        port: t.db_port || port,
        user: t.db_user || user,
        password: t.db_password || password,
      });
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
