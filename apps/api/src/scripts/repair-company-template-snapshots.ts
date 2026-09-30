/**
 * Repairs companies created through the old setup-wizard placeholder path,
 * which renamed the placeholder but never took the tenant master-template
 * snapshot. Runs across every tenant registered in nf_master.
 *
 * Safety rules:
 * - read-only by default;
 * - --verify performs the writes in a transaction and rolls back;
 * - --apply commits;
 * - a complete snapshot is taken only when the company owns zero rows in every
 *   template table;
 * - a partially owned company receives only missing Number Series definitions,
 *   matched by their unique code. Existing identities, counters and settings
 *   are never updated, deleted or reset;
 * - partially owned non-Series tables are audit-only because there is no
 *   universal business key with which to merge them safely.
 */
import { and, count, eq, getTableColumns, getTableName, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { RowDataPacket } from 'mysql2/promise';
import * as schema from '../core/database/schema';
import {
  companyTemplateTables,
  copyCompanyMasterTemplates,
  planTemplateCopies,
  writeTemplateCopies,
} from '../modules/core/company/copy-master-templates';
import {
  missingNumberSeriesTemplates,
  planCompanyTemplateRepair,
  TemplateCoverage,
} from './repair-company-template-snapshots.lib';

type Mode = 'READ_ONLY' | 'VERIFY' | 'APPLY';
type TenantRow = RowDataPacket & {
  tenant_id: string;
  tenant_code: string;
  db_host: string | null;
  db_port: number | null;
  db_name: string;
  db_user: string | null;
  db_password: string | null;
};

const VERIFY_ROLLBACK = Symbol('repair-company-template-snapshots:verify-rollback');

function modeFromArgs(args: string[]): Mode {
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  if (args.some((arg) => !['--apply', '--verify'].includes(arg)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  return apply ? 'APPLY' : verify ? 'VERIFY' : 'READ_ONLY';
}

async function coverageForCompany(executor: any, tenantId: string, companyId: string): Promise<TemplateCoverage[]> {
  const coverage: TemplateCoverage[] = [];
  for (const table of companyTemplateTables) {
    const columns = getTableColumns(table) as Record<string, any>;
    const templateConditions = [eq(columns.tenant_id, tenantId), isNull(columns.company_id)];
    if (columns.is_active) templateConditions.push(eq(columns.is_active, true));
    if (columns.deleted_at) templateConditions.push(isNull(columns.deleted_at));
    const [{ n: tenantRows }] = await executor.select({ n: count() }).from(table).where(and(...templateConditions));
    const [{ n: companyRows }] = await executor.select({ n: count() }).from(table).where(and(
      eq(columns.tenant_id, tenantId),
      eq(columns.company_id, companyId),
    ));
    coverage.push({ table: getTableName(table), tenantRows: Number(tenantRows), companyRows: Number(companyRows) });
  }
  return coverage;
}

async function numberSeriesGap(executor: any, tenantId: string, companyId: string) {
  const templates = await executor.select().from(schema.noSeries).where(and(
    eq(schema.noSeries.tenant_id, tenantId),
    isNull(schema.noSeries.company_id),
    eq(schema.noSeries.blocked, false),
    isNull(schema.noSeries.deleted_at),
  ));
  // Include inactive/deleted rows: their identity and counter belong to the
  // company and must not be replaced by a fresh row under the same code.
  const existing = await executor.select().from(schema.noSeries).where(and(
    eq(schema.noSeries.tenant_id, tenantId),
    eq(schema.noSeries.company_id, companyId),
  ));
  return missingNumberSeriesTemplates(templates, existing);
}

async function inspectAndMaybeRepair(executor: any, tenantId: string, company: typeof schema.companyMaster.$inferSelect, mode: Mode) {
  const coverage = await coverageForCompany(executor, tenantId, company.company_id);
  const missingSeries = await numberSeriesGap(executor, tenantId, company.company_id);
  const plan = planCompanyTemplateRepair(company.company_code, coverage, missingSeries.map((row: any) => row.code));
  let inserted = 0;

  if (mode !== 'READ_ONLY') {
    if (plan.action === 'FULL_TEMPLATE_SNAPSHOT') {
      inserted = await copyCompanyMasterTemplates(executor, tenantId, company.company_id);
    } else if (plan.action === 'ADD_NUMBER_SERIES_ONLY' && missingSeries.length > 0) {
      const copies = planTemplateCopies([{ table: schema.noSeries, rows: missingSeries }], company.company_id);
      await writeTemplateCopies(executor, copies);
      inserted = copies.length;
    }
  }

  return {
    company: company.company_code,
    companyId: company.company_id,
    ...plan,
    inserted,
    coverage: coverage.filter((row) => row.tenantRows > 0 || row.companyRows > 0),
    note: plan.partiallyOwnedTables.length > 0
      ? 'Partially owned non-Series tables are audit-only; no generic merge was attempted.'
      : undefined,
  };
}

async function repairTenant(tenant: TenantRow, mode: Mode, defaults: {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl?: { minVersion: 'TLSv1.2'; rejectUnauthorized: true };
}) {
  const pool = mysql.createPool({
    host: tenant.db_host || defaults.host,
    port: tenant.db_port || defaults.port,
    user: tenant.db_user || defaults.user,
    password: tenant.db_password ?? defaults.password,
    database: tenant.db_name,
    ssl: defaults.ssl,
  });
  const lockName = `navfarm-template-repair:${tenant.db_name}`.slice(0, 64);
  try {
    const [[lock]] = await pool.query<RowDataPacket[]>('SELECT GET_LOCK(?, 5) acquired', [lockName]);
    if (Number(lock.acquired) !== 1) throw new Error(`Another template repair is active for ${tenant.db_name}.`);
    const db = drizzle(pool, { schema, mode: 'default' });
    let companyPlans: Array<Record<string, unknown>> = [];
    try {
      await db.transaction(async (tx) => {
        const companies = await tx.select().from(schema.companyMaster);
        companyPlans = [];
        for (const company of companies) {
          companyPlans.push(await inspectAndMaybeRepair(tx, tenant.tenant_id, company, mode));
        }
        if (mode === 'VERIFY') throw VERIFY_ROLLBACK;
      });
    } catch (error) {
      if (error !== VERIFY_ROLLBACK) throw error;
    }
    return { tenant: tenant.tenant_code, database: tenant.db_name, companies: companyPlans };
  } finally {
    await pool.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
    await pool.end();
  }
}

async function run() {
  const mode = modeFromArgs(process.argv.slice(2));
  const defaults = {
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true'
      ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true as const }
      : undefined,
  };
  const masterDatabase = process.env.DATABASE_NAME || 'nf_master';
  const masterPool = mysql.createPool({ ...defaults, database: masterDatabase });
  try {
    const [tenants] = await masterPool.query<TenantRow[]>(
      'SELECT tenant_id, tenant_code, db_host, db_port, db_name, db_user, db_password FROM tenant_master ORDER BY tenant_code',
    );
    const results: Awaited<ReturnType<typeof repairTenant>>[] = [];
    for (const tenant of tenants) results.push(await repairTenant(tenant, mode, defaults));
    console.log(JSON.stringify({ mode, masterDatabase, tenants: results }, null, 2));
    console.log(mode === 'APPLY'
      ? 'Committed additive repairs.'
      : mode === 'VERIFY'
        ? 'Verified writes and rolled back. No changes committed.'
        : 'Read-only audit. No changes attempted.');
  } finally {
    await masterPool.end();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  const cause = (error as any)?.cause;
  if (cause) console.error('Caused by:', cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
