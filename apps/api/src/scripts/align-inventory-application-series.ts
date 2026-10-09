/**
 * Aligns inventory application IDs and number series in the tenant database.
 *
 * 1. Ensures `ITEM_APPLICATION` number series exists in `no_series` for both tenant
 *    and company scopes:
 *      code: 'ITEM_APPLICATION'
 *      prefix: 'APP'
 *      separator: '-'
 *      seq_length: 5
 *      document_type: 'APPLICATION'
 * 2. Backfills any UUID-formatted `application_id` values in `inventory_application`
 *    to sequential readable IDs: `APP-00001`, `APP-00002`, etc. (ordered chronologically).
 * 3. Updates `current_seq` in `no_series` to match the highest assigned application sequence.
 *
 * Conforms to AGENTS.md rule 4:
 * - Read-only by default (prints plan).
 * - --verify: runs inside a database transaction and rolls back.
 * - --apply: commits the database transaction.
 *
 * Usage:
 *   node --env-file-if-exists=.env --import tsx src/scripts/align-inventory-application-series.ts
 *   node --env-file-if-exists=.env --import tsx src/scripts/align-inventory-application-series.ts --verify
 *   node --env-file-if-exists=.env --import tsx src/scripts/align-inventory-application-series.ts --apply
 */
import { randomUUID } from 'node:crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const DB = process.env.TENANT_DB_NAME || 'nf_devco';

async function main() {
  const flags = process.argv.slice(2);
  const isVerify = flags.includes('--verify');
  const isApply = flags.includes('--apply');
  const mode = isApply ? '--apply' : isVerify ? '--verify' : 'READ_ONLY';

  console.log('================================================================');
  console.log(`Align Inventory Application Series: [${mode}] mode on ${DB}`);
  console.log('================================================================');

  const conn = await mysql.createConnection({ host, port, user, password, database: DB, ssl });

  try {
    // 1. Resolve Company & Tenant
    const [companies] = await conn.query<RowDataPacket[]>(
      'SELECT company_id, tenant_id FROM company_master LIMIT 1',
    );
    if (!companies.length) throw new Error('No company found in tenant database.');
    const { company_id: companyId, tenant_id: tenantId } = companies[0];

    // 2. Query existing applications
    const [apps] = await conn.query<RowDataPacket[]>(
      `SELECT application_id, item_id, inbound_ledger_id, outbound_ledger_id, applied_qty, applied_cost_amount, application_date, created_at
       FROM inventory_application
       ORDER BY application_date ASC, created_at ASC`,
    );

    console.log(`Found ${apps.length} existing inventory_application row(s).`);

    // Determine readable IDs to assign
    const renames: Array<{ oldId: string; newId: string }> = [];
    let maxSeq = 0;

    // Check existing APP-xxxxx sequences if any already formatted
    for (const app of apps) {
      const match = app.application_id.match(/^APP-(\d+)$/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }

    let nextSeq = maxSeq;
    for (const app of apps) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(app.application_id)) {
        nextSeq++;
        const newId = `APP-${String(nextSeq).padStart(5, '0')}`;
        renames.push({ oldId: app.application_id, newId });
      }
    }

    console.log(`Planned renames from UUID to readable series: ${renames.length}`);
    if (renames.length > 0) {
      console.log('Sample planned renames:');
      for (const r of renames.slice(0, 5)) {
        console.log(`  ${r.oldId} -> ${r.newId}`);
      }
      if (renames.length > 5) {
        console.log(`  ... and ${renames.length - 5} more.`);
      }
    }

    const finalSeq = nextSeq;

    // 3. Query existing number series
    const [existingSeries] = await conn.query<RowDataPacket[]>(
      `SELECT id, tenant_id, company_id, code, current_seq FROM no_series WHERE code = 'ITEM_APPLICATION'`,
    );

    console.log(`Found ${existingSeries.length} existing no_series row(s) for 'ITEM_APPLICATION'.`);

    if (mode === 'READ_ONLY') {
      console.log('\n[READ-ONLY PLAN] Run with --verify or --apply to execute.');
      console.log('================================================================');
      return;
    }

    await conn.beginTransaction();

    // Ensure tenant-scope series exists
    const tenantSeries = existingSeries.find((s) => s.company_id === null);
    if (!tenantSeries) {
      console.log(`Inserting tenant-level no_series row for ITEM_APPLICATION...`);
      await conn.execute(
        `INSERT INTO no_series (
          id, tenant_id, company_id, code, description, document_type,
          prefix, \`separator\`, seq_length, current_seq, reset_frequency, manual_nos, blocked, created_at, updated_at
        ) VALUES (?, ?, NULL, 'ITEM_APPLICATION', 'Item Application Series', 'APPLICATION', 'APP', '-', 5, ?, 'NEVER', 1, 0, NOW(), NOW())`,
        [randomUUID(), tenantId, finalSeq],
      );
    } else {
      console.log(`Updating tenant-level no_series row for ITEM_APPLICATION current_seq to ${finalSeq}...`);
      await conn.execute(
        `UPDATE no_series SET current_seq = GREATEST(current_seq, ?), updated_at = NOW() WHERE id = ?`,
        [finalSeq, tenantSeries.id],
      );
    }

    // Ensure company-scope series exists
    const compSeries = existingSeries.find((s) => s.company_id === companyId);
    if (!compSeries) {
      console.log(`Inserting company-level no_series row for ITEM_APPLICATION...`);
      await conn.execute(
        `INSERT INTO no_series (
          id, tenant_id, company_id, code, description, document_type,
          prefix, \`separator\`, seq_length, current_seq, reset_frequency, manual_nos, blocked, created_at, updated_at
        ) VALUES (?, ?, ?, 'ITEM_APPLICATION', 'Item Application Series', 'APPLICATION', 'APP', '-', 5, ?, 'NEVER', 1, 0, NOW(), NOW())`,
        [randomUUID(), tenantId, companyId, finalSeq],
      );
    } else {
      console.log(`Updating company-level no_series row for ITEM_APPLICATION current_seq to ${finalSeq}...`);
      await conn.execute(
        `UPDATE no_series SET current_seq = GREATEST(current_seq, ?), updated_at = NOW() WHERE id = ?`,
        [finalSeq, compSeries.id],
      );
    }

    // Rename legacy UUIDs in inventory_application
    for (const r of renames) {
      await conn.execute(
        `UPDATE inventory_application SET application_id = ? WHERE application_id = ?`,
        [r.newId, r.oldId],
      );
    }

    if (mode === '--verify') {
      await conn.rollback();
      console.log('\n[--verify] Rolled back transaction. Database remains untouched.');
      console.log('================================================================');
      return;
    }

    if (mode === '--apply') {
      await conn.commit();
      console.log('\n[--apply] COMMITTED successfully to database!');
      console.log(`  ✔ Renamed ${renames.length} inventory_application IDs to readable APP-XXXXX format`);
      console.log(`  ✔ Synchronized no_series ITEM_APPLICATION current_seq to ${finalSeq}`);
      console.log('================================================================');
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during execution:', err);
    process.exit(1);
  });
}
