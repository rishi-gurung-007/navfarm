/**
 * Export a seeded showcase tenant as one gzipped SQL file, so it can be put on
 * another machine in minutes instead of being played forward again.
 *
 * The file holds the tenant's whole database (every table's CREATE and rows,
 * including its __drizzle_migrations, so the importer can check the schema
 * matches) and the tenant's rows in the master registry that logins need:
 * tenant_master, tenant_subscription and user_auth_index.
 *
 * Plain Node (mysql2 + zlib), so it runs on Windows as it does here.
 *
 *   TRIPLEC_TENANT_CODE=ccc node --env-file-if-exists=.env --import tsx src/scripts/seed-triplec-export.ts [--out <file>]
 */
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import * as mysql from 'mysql2/promise';

const TENANT_CODE = process.env.TRIPLEC_TENANT_CODE || 'triplec';
const MASTER_DB = process.env.DATABASE_NAME || 'nf_master';
/** Separates statements in the file; the importer splits on it, never on semicolons inside data. */
export const STATEMENT_END = '\n-- @@end\n';
const ROWS_PER_INSERT = 500;

function connect(database?: string) {
  return mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
        : undefined,
  });
}

/** A value as SQL: binaries as hex, JSON columns (read back as objects) as their text. */
function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value))
    return value.length ? `X'${value.toString('hex')}'` : "''";
  if (typeof value === 'object') return mysql.escape(JSON.stringify(value));
  return mysql.escape(value as any);
}

async function dumpRows(
  db: mysql.Connection,
  table: string,
  where: string,
  args: unknown[],
  write: (s: string) => Promise<void> | void,
) {
  // Paged, so a large table (the audit log, the ledgers) never sits in memory whole.
  const PAGE = 5000;
  let total = 0;
  // A generated column (feed_planning_setting.active_scope_key) is computed by MySQL and refused on insert.
  const [generated] = await db.query<any[]>(
    `SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND (extra LIKE '%VIRTUAL GENERATED%' OR extra LIKE '%STORED GENERATED%')`,
    [table],
  );
  const skip = new Set(generated.map((g) => g.c));
  for (let offset = 0; ; offset += PAGE) {
    const [rows] = await db.query<any[]>(
      `SELECT * FROM \`${table}\` WHERE ${where} LIMIT ${PAGE} OFFSET ${offset}`,
      args,
    );
    if (!rows.length) break;
    const keys = Object.keys(rows[0]).filter((c) => !skip.has(c));
    const columns = keys.map((c) => `\`${c}\``).join(', ');
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const chunk = rows.slice(i, i + ROWS_PER_INSERT);
      const values = chunk
        .map((r) => `(${keys.map((k) => literal(r[k])).join(', ')})`)
        .join(',\n');
      await write(
        `INSERT INTO \`${table}\` (${columns}) VALUES\n${values}${STATEMENT_END}`,
      );
    }
    total += rows.length;
    if (rows.length < PAGE) break;
  }
  return total;
}

async function main() {
  const master = await connect(MASTER_DB);
  const [[tenant]] = await master.query<any[]>(
    'SELECT * FROM tenant_master WHERE tenant_code = ?',
    [TENANT_CODE],
  );
  if (!tenant)
    throw new Error(`Tenant ${TENANT_CODE} is not registered in ${MASTER_DB}.`);
  const tenantDb = await connect(tenant.db_name);
  const [[lastPosted]] = await tenantDb.query<any[]>(
    'SELECT MAX(entry_date) d FROM batch_data_entry_lock',
  );
  const stamp = new Date().toISOString().slice(0, 10);
  const outIndex = process.argv.indexOf('--out');
  const out =
    outIndex > 0
      ? process.argv[outIndex + 1]
      : `${TENANT_CODE}-showcase-${stamp}.sql.gz`;

  const gzip = zlib.createGzip({ level: 6 });
  const file = fs.createWriteStream(out);
  gzip.pipe(file);
  // Waits for the gzip stream to drain, so memory stays flat however big the tenant is.
  const write = (s: string) =>
    gzip.write(s)
      ? undefined
      : new Promise<void>((resolve) => gzip.once('drain', () => resolve()));

  const meta = {
    tenant_code: TENANT_CODE,
    tenant_id: tenant.tenant_id,
    db_name: tenant.db_name,
    exported_on: stamp,
    last_posted_day: lastPosted?.d ?? null,
  };
  await write(`-- @@meta ${JSON.stringify(meta)}\n`);
  await write(`SET FOREIGN_KEY_CHECKS = 0${STATEMENT_END}`);

  // The tenant database, table by table.
  const [tables] = await tenantDb.query<any[]>(
    `SELECT table_name t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
    [tenant.db_name],
  );
  let rowCount = 0;
  for (const { t } of tables) {
    const [[create]] = await tenantDb.query<any[]>(
      `SHOW CREATE TABLE \`${t}\``,
    );
    await write(`-- @@table ${t}\n${create['Create Table']}${STATEMENT_END}`);
    rowCount += await dumpRows(tenantDb, t, '1=1', [], write);
  }

  // The triggers after the rows: inventory_ledger.entry_no is numbered by one (0139), and an
  // import without it posts every new stock entry as 0, so the second one is refused as a duplicate.
  // The DEFINER is left out so the importing login owns them.
  const [triggers] = await tenantDb.query<any[]>(
    `SELECT trigger_name n FROM information_schema.triggers WHERE trigger_schema = ? ORDER BY trigger_name`,
    [tenant.db_name],
  );
  for (const { n } of triggers) {
    const [[trigger]] = await tenantDb.query<any[]>(
      `SHOW CREATE TRIGGER \`${n}\``,
    );
    const ddl = String(trigger['SQL Original Statement']).replace(
      /^CREATE\s+DEFINER=\S+\s+TRIGGER/i,
      'CREATE TRIGGER',
    );
    await write(`-- @@trigger ${n}\n${ddl}${STATEMENT_END}`);
  }

  // The master registry rows a login goes through.
  await write(`-- @@master\n`);
  await dumpRows(
    master,
    'tenant_master',
    'tenant_id = ?',
    [tenant.tenant_id],
    write,
  );
  await dumpRows(
    master,
    'tenant_subscription',
    'tenant_id = ?',
    [tenant.tenant_id],
    write,
  );
  const logins = await dumpRows(
    master,
    'user_auth_index',
    'tenant_id = ?',
    [tenant.tenant_id],
    write,
  );

  gzip.end();
  await new Promise<void>((resolve, reject) =>
    file.on('finish', () => resolve()).on('error', reject),
  );
  await tenantDb.end();
  await master.end();
  const size = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log(
    `Exported ${TENANT_CODE} (${tenant.db_name}): ${tables.length} tables, ${rowCount} rows, ${logins} logins -> ${out} (${size} MB)`,
  );
  console.log(
    `Last posted day ${meta.last_posted_day}. Import with seed-triplec-import.ts, then top up with seed-triplec-history.ts --resume.`,
  );
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(
        `FAILED: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    },
  );
}
