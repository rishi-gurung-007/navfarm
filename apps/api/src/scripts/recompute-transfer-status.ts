/**
 * Recompute stock_transfer.status from the transfer's shipment and receipt
 * events (Part E Task 4b).
 *
 * Before Task 4b only postDirectTransfer ever set POSTED; a transfer moved
 * through POST /stock-transfer/:id/shipment and /receipt stayed DRAFT even
 * after its stock had left the source (on nf_devco: TR-000010, TR-000014).
 * The service now writes the status with each event. This script corrects
 * the rows written before that, with the same rule the service uses
 * (transfer-execution.rules.ts transferStatusFor):
 *   no line shipped                               -> DRAFT
 *   every line shipped AND received in full       -> POSTED
 *   any receipt, something ordered not received   -> PARTIALLY_RECEIVED
 *   shipped, nothing received                     -> IN_TRANSIT
 *
 * Only open rows are considered (DRAFT, IN_TRANSIT, PARTIALLY_RECEIVED, not
 * deleted). POSTED and CANCELLED rows are never touched. A row moved to
 * POSTED is stamped with its last receipt's created_at / created_by — the
 * moment it actually completed — not with the time this script ran, and in
 * UTC like the service's own stamp. Every changed row's updated_at is also
 * written in UTC (toMysqlTimestamp, fix round 1 M3) rather than SQL NOW(),
 * which would write the session's own time zone.
 *
 * Refuses a non-local DATABASE_HOST (fix round 1, Important 3) — the same
 * guard align-feed-tdd.ts:58 has, shared from lib/host-guard.ts. This script
 * rewrites document statuses, so pointing it at the wrong database is exactly
 * the accident the guard exists to prevent.
 *
 * Modes (AGENTS.md §4):
 * - Default: read-only plan
 * - --verify: applies inside a transaction, reads the result back, rolls back
 * - --apply: applies inside a transaction and commits
 * Optional: --tenant=<db> (default nf_devco).
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { OPEN_TRANSFER_STATUSES, transferStatusFor } from '../modules/inventory/stock-transfer/transfer-execution.rules';
import { assertLocalHost } from './lib/host-guard';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];
const database = tenantArg || process.env.TENANT_DB || 'nf_devco';

// M3 (fix round 1): the same UTC stamp stock-transfer.service.ts's
// toMysqlTimestamp writes, not SQL NOW() — NOW() writes the session's local
// time zone, which created_at/posted_at comparisons elsewhere in this script
// (see the epoch conversion in plan() below) already have to correct for.
const toMysqlTimestamp = (date: Date = new Date()): string => date.toISOString().slice(0, 19).replace('T', ' ');

interface Change {
  transfer_id: string;
  transfer_no: string;
  from: string;
  to: string;
  posted_at: string | null;
  posted_by: string | null;
  coverage: string;
}

async function plan(db: mysql.Connection): Promise<Change[]> {
  const [transfers] = await db.query<RowDataPacket[]>(
    `SELECT transfer_id, transfer_no, status FROM stock_transfer
      WHERE deleted_at IS NULL AND status IN (?) ORDER BY transfer_no`,
    [[...OPEN_TRANSFER_STATUSES]],
  );
  const changes: Change[] = [];
  for (const t of transfers) {
    const [lines] = await db.query<RowDataPacket[]>(
      `SELECT l.line_id, l.line_no, l.quantity AS ordered,
              COALESCE((SELECT SUM(sl.quantity) FROM transfer_shipment_line sl
                          JOIN transfer_shipment s ON s.shipment_id = sl.shipment_id
                         WHERE sl.line_id = l.line_id AND s.transfer_id = l.transfer_id AND s.deleted_at IS NULL), 0) AS shipped,
              COALESCE((SELECT SUM(rl.quantity) FROM transfer_receipt_line rl
                          JOIN transfer_receipt r ON r.receipt_id = rl.receipt_id
                         WHERE rl.line_id = l.line_id AND r.transfer_id = l.transfer_id AND r.deleted_at IS NULL), 0) AS received
         FROM stock_transfer_line l WHERE l.transfer_id = ? ORDER BY l.line_no`,
      [t.transfer_id],
    );
    const coverage = lines.map((l) => ({ ordered: Number(l.ordered), shipped: Number(l.shipped), received: Number(l.received) }));
    const target = transferStatusFor(coverage);
    if (target === t.status) continue;
    let postedAt: string | null = null;
    let postedBy: string | null = null;
    if (target === 'POSTED') {
      const [[last]] = await db.query<RowDataPacket[]>(
        `SELECT UNIX_TIMESTAMP(created_at) AS epoch, created_by FROM transfer_receipt
          WHERE transfer_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, receipt_no DESC LIMIT 1`,
        [t.transfer_id],
      );
      // The service stamps posted_at as UTC (toISOString), while created_at
      // reads back in the session time zone; go through the epoch so the
      // stamp matches what the service would have written at that moment.
      postedAt = last?.epoch != null ? new Date(Number(last.epoch) * 1000).toISOString().slice(0, 19).replace('T', ' ') : null;
      postedBy = last?.created_by ?? null;
    }
    changes.push({
      transfer_id: t.transfer_id,
      transfer_no: t.transfer_no,
      from: t.status,
      to: target,
      posted_at: postedAt,
      posted_by: postedBy,
      coverage: lines.map((l, i) => `line ${l.line_no}: ordered ${coverage[i].ordered}, shipped ${coverage[i].shipped}, received ${coverage[i].received}`).join('; '),
    });
  }
  return changes;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  const extra = process.argv.slice(2).filter((a) => !a.startsWith('--tenant=') && !['--apply', '--verify'].includes(a));
  if (extra.length || (apply && verify)) {
    throw new Error('Use no flags (read-only plan), --verify (rolled-back transaction), or --apply (commit). Optional: --tenant=<db>');
  }
  // Important 3 (fix round 1): this script rewrites document statuses, so
  // pointing it at the wrong database is exactly the accident this refuses —
  // the same guard align-feed-tdd.ts:58 already has.
  assertLocalHost(host, process.env.RECOMPUTE_TRANSFER_STATUS_ALLOW_REMOTE);
  const mode = apply ? 'APPLY' : verify ? 'VERIFY' : 'PLAN';
  console.log(`\n=== Recompute stock transfer status from events [${mode}] ===`);
  console.log(`Database: ${database} on ${host}:${port}\n`);

  const db = await mysql.createConnection({ host, port, user, password, database });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-recompute-transfer-status', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another recompute-transfer-status run is active.');

    const [before] = await db.query<RowDataPacket[]>('SELECT status, COUNT(*) n FROM stock_transfer GROUP BY status ORDER BY status');
    console.log('Status counts before:', before.map((r) => `${r.status}=${r.n}`).join(', '));

    const changes = await plan(db);
    console.log(`\n${changes.length} transfer(s) whose status disagrees with their events:`);
    for (const c of changes) {
      console.log(`  - ${c.transfer_no}: ${c.from} -> ${c.to}${c.to === 'POSTED' ? ` (posted_at ${c.posted_at}, posted_by ${c.posted_by})` : ''} [${c.coverage}]`);
    }

    if (!apply && !verify) {
      console.log('\n[PLAN] Read-only. No changes made. Run --verify (rolled back) or --apply (commit).');
      return;
    }

    await db.beginTransaction();
    const updatedAt = toMysqlTimestamp();
    let updated = 0;
    for (const c of changes) {
      const [res] = await db.query(
        c.to === 'POSTED'
          ? `UPDATE stock_transfer SET status = ?, posted_at = ?, posted_by = ?, updated_at = ? WHERE transfer_id = ? AND status = ?`
          : `UPDATE stock_transfer SET status = ?, updated_at = ? WHERE transfer_id = ? AND status = ?`,
        c.to === 'POSTED' ? [c.to, c.posted_at, c.posted_by, updatedAt, c.transfer_id, c.from] : [c.to, updatedAt, c.transfer_id, c.from],
      );
      updated += (res as any).affectedRows;
    }
    console.log(`\nUpdated rows: ${updated} of ${changes.length}`);

    const remaining = await plan(db);
    const [after] = await db.query<RowDataPacket[]>('SELECT status, COUNT(*) n FROM stock_transfer GROUP BY status ORDER BY status');
    console.log('Status counts after:', after.map((r) => `${r.status}=${r.n}`).join(', '));
    if (changes.length) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT transfer_no, status, DATE_FORMAT(posted_at, '%Y-%m-%d %H:%i:%s') posted_at, posted_by FROM stock_transfer WHERE transfer_id IN (?) ORDER BY transfer_no`,
        [changes.map((c) => c.transfer_id)],
      );
      for (const r of rows) console.log(`  read back ${r.transfer_no}: status=${r.status} posted_at=${r.posted_at} posted_by=${r.posted_by}`);
    }
    console.log(`Still disagreeing after the update: ${remaining.length}`);
    if (remaining.length || updated !== changes.length) {
      await db.rollback();
      throw new Error('Read-back did not match the plan; rolled back.');
    }

    if (verify) {
      await db.rollback();
      console.log('\n[VERIFY] Rolled back. Nothing committed.');
    } else {
      await db.commit();
      console.log('\n[APPLY] Committed.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-recompute-transfer-status')").catch(() => undefined);
    await db.end();
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
