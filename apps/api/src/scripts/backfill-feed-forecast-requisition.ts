/**
 * Preflight and backfill helper for Feed Forecast & Requisition integration.
 *
 * Checks:
 * - company_currency_config for duplicate (company_id, currency_id) pairs
 * - feed_planning_setting for duplicate active scopes
 * - requisition rows with unpopulated state dimensions (approval_status IS NULL)
 * - alert_rule and feed_alert rows referencing legacy HEAD_OF_FARM
 *
 * Modes:
 * - Default: read-only plan preview
 * - --verify: executes inside a transaction, prints verified state, and rolls back
 * - --apply: executes inside a transaction and commits
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

interface RequisitionRow extends RowDataPacket {
  requisition_id: string;
  req_no: string;
  status: string;
  approval_status: string | null;
  document_status: string | null;
  fulfilment_status: string | null;
  integration_status: string | null;
}

interface AlertRuleRow extends RowDataPacket {
  rule_id: string;
  notification_code: string;
  recipient_roles: unknown;
  escalation_role: string | null;
}

interface FeedAlertRow extends RowDataPacket {
  alert_id: string;
  notification_code: string;
  recipient_roles: unknown;
  escalation_role: string | null;
}

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];
const database = tenantArg || process.env.TENANT_DB || 'nf_devco';

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  const nonFlagArgs = process.argv.slice(2).filter((a) => !a.startsWith('--tenant='));
  if (nonFlagArgs.some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only plan), --verify (dry-run transaction), or --apply (commit). Optional: --tenant=<db>');
  }

  const mode = apply ? 'APPLY' : verify ? 'VERIFY' : 'PLAN';
  console.log(`\n=== Feed Forecast & Requisition Backfill Helper [${mode}] ===`);
  console.log(`Database: ${database} on ${host}:${port}\n`);

  const db = await mysql.createConnection({ host, port, user, password, database });

  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-feed-forecast-backfill', 5) acquired");
    if (Number(lock.acquired) !== 1) {
      throw new Error('Another feed forecast backfill process is currently active.');
    }

    // 1. Preflight checks
    console.log('--- 1. Preflight Integrity Checks ---');
    const [currDuplicates] = await db.query<RowDataPacket[]>(
      `SELECT company_id, currency_id, COUNT(*) as cnt
         FROM company_currency_config
        GROUP BY company_id, currency_id
       HAVING cnt > 1`
    );
    if (currDuplicates.length > 0) {
      console.warn(`WARNING: Found ${currDuplicates.length} duplicate (company_id, currency_id) in company_currency_config!`);
    } else {
      console.log('OK: company_currency_config has no duplicate (company_id, currency_id) pairs.');
    }

    // Check feed_planning_setting table if it exists
    const [tables] = await db.query<RowDataPacket[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = 'feed_planning_setting'`,
      [database]
    );
    if (tables.length > 0) {
      const [settingsDuplicates] = await db.query<RowDataPacket[]>(
        `SELECT company_id, active_scope_key, COUNT(*) as cnt
           FROM feed_planning_setting
          WHERE active_scope_key IS NOT NULL
          GROUP BY company_id, active_scope_key
         HAVING cnt > 1`
      );
      if (settingsDuplicates.length > 0) {
        console.warn(`WARNING: Found ${settingsDuplicates.length} duplicate active scope keys in feed_planning_setting!`);
      } else {
        console.log('OK: feed_planning_setting has no colliding active scope keys.');
      }
    }

    // 2. Identify candidate rows
    console.log('\n--- 2. Unpopulated Requisition Dimensions ---');
    const [reqs] = await db.query<RequisitionRow[]>(
      `SELECT requisition_id, req_no, status, approval_status, document_status, fulfilment_status, integration_status
         FROM requisition
        WHERE approval_status IS NULL`
    );
    console.log(`Found ${reqs.length} requisition(s) with NULL approval_status:`);
    for (const r of reqs) {
      const targetApproval = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(r.status) ? r.status : 'OPEN';
      const targetDocument = r.status === 'APPROVED' ? 'APPROVED' : r.status === 'CANCELLED' ? 'CANCELLED' : 'OPEN';
      console.log(`  - [${r.req_no}] status='${r.status}' -> approval='${targetApproval}', doc='${targetDocument}', fulfilment='NOT_APPLICABLE', integration='NOT_APPLICABLE'`);
    }

    console.log('\n--- 3. Legacy HEAD_OF_FARM Alert Configurations ---');
    const [rules] = await db.query<AlertRuleRow[]>(
      `SELECT rule_id, notification_code, recipient_roles, escalation_role
         FROM alert_rule
        WHERE escalation_role = 'HEAD_OF_FARM'
           OR JSON_CONTAINS(recipient_roles, '"HEAD_OF_FARM"')`
    );
    console.log(`Found ${rules.length} alert_rule row(s) referencing HEAD_OF_FARM:`);
    for (const r of rules) {
      console.log(`  - [${r.notification_code}] rule_id=${r.rule_id} roles=${JSON.stringify(r.recipient_roles)} escalation=${r.escalation_role}`);
    }

    const [alerts] = await db.query<FeedAlertRow[]>(
      `SELECT alert_id, notification_code, recipient_roles, escalation_role
         FROM feed_alert
        WHERE escalation_role = 'HEAD_OF_FARM'
           OR JSON_CONTAINS(recipient_roles, '"HEAD_OF_FARM"')`
    );
    console.log(`Found ${alerts.length} feed_alert row(s) referencing HEAD_OF_FARM:`);
    for (const a of alerts) {
      console.log(`  - [${a.notification_code}] alert_id=${a.alert_id} roles=${JSON.stringify(a.recipient_roles)} escalation=${a.escalation_role}`);
    }

    if (!verify && !apply) {
      console.log('\n[PLAN] Read-only plan complete. No changes made.');
      console.log('Run with --verify to test inside a rollback transaction, or --apply to commit.');
      return;
    }

    // 3. Apply updates inside transaction
    console.log(`\n--- 4. Executing Mutations (${mode}) ---`);
    await db.beginTransaction();

    if (reqs.length > 0) {
      const [updateReq] = await db.query(
        `UPDATE requisition
            SET approval_status = CASE
                  WHEN status = 'PENDING_APPROVAL' THEN 'PENDING_APPROVAL'
                  WHEN status = 'APPROVED' THEN 'APPROVED'
                  WHEN status = 'REJECTED' THEN 'REJECTED'
                  ELSE 'OPEN'
                END,
                document_status = CASE
                  WHEN status = 'APPROVED' THEN 'APPROVED'
                  WHEN status = 'CANCELLED' THEN 'CANCELLED'
                  ELSE 'OPEN'
                END,
                fulfilment_status = 'NOT_APPLICABLE',
                integration_status = 'NOT_APPLICABLE'
          WHERE approval_status IS NULL`
      );
      console.log(`Updated requisition rows: ${(updateReq as any).affectedRows}`);
    }

    if (rules.length > 0) {
      const [uRulesEsc] = await db.query(
        `UPDATE alert_rule SET escalation_role = 'OPERATIONAL_ADMIN' WHERE escalation_role = 'HEAD_OF_FARM'`
      );
      const [uRulesRec] = await db.query(
        `UPDATE alert_rule
            SET recipient_roles = CAST(REPLACE(CAST(recipient_roles AS CHAR), '"HEAD_OF_FARM"', '"OPERATIONAL_ADMIN"') AS JSON)
          WHERE JSON_CONTAINS(recipient_roles, '"HEAD_OF_FARM"')`
      );
      console.log(`Updated alert_rule rows: escalation=${(uRulesEsc as any).affectedRows}, recipient=${(uRulesRec as any).affectedRows}`);
    }

    if (alerts.length > 0) {
      const [uAlertsEsc] = await db.query(
        `UPDATE feed_alert SET escalation_role = 'OPERATIONAL_ADMIN' WHERE escalation_role = 'HEAD_OF_FARM'`
      );
      const [uAlertsRec] = await db.query(
        `UPDATE feed_alert
            SET recipient_roles = CAST(REPLACE(CAST(recipient_roles AS CHAR), '"HEAD_OF_FARM"', '"OPERATIONAL_ADMIN"') AS JSON)
          WHERE JSON_CONTAINS(recipient_roles, '"HEAD_OF_FARM"')`
      );
      console.log(`Updated feed_alert rows: escalation=${(uAlertsEsc as any).affectedRows}, recipient=${(uAlertsRec as any).affectedRows}`);
    }

    // Verification check
    const [[remainingReqs]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM requisition WHERE approval_status IS NULL`
    );
    const [[remainingRules]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM alert_rule WHERE escalation_role = 'HEAD_OF_FARM' OR JSON_CONTAINS(recipient_roles, '"HEAD_OF_FARM"')`
    );
    const [[remainingAlerts]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM feed_alert WHERE escalation_role = 'HEAD_OF_FARM' OR JSON_CONTAINS(recipient_roles, '"HEAD_OF_FARM"')`
    );
    console.log(`Verification inside transaction:`);
    console.log(`  - Requisitions with approval_status NULL: ${remainingReqs.cnt} (expected 0)`);
    console.log(`  - Alert rules with HEAD_OF_FARM: ${remainingRules.cnt} (expected 0)`);
    console.log(`  - Feed alerts with HEAD_OF_FARM: ${remainingAlerts.cnt} (expected 0)`);

    if (verify) {
      await db.rollback();
      console.log('\n[VERIFY] Rolled back successfully. Database was not modified.');
    } else {
      await db.commit();
      console.log('\n[APPLY] Committed successfully. Database updated.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-feed-forecast-backfill')");
    await db.end();
  }
}

void run().catch((err) => {
  console.error('\nERROR:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
