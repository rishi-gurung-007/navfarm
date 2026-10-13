/**
 * Repair: DOA write-offs posted before a Transfer receipt wrote its DOA off against its own receipt.
 *
 * Receiving a transfer with DOA used to post a good receipt, a DOA-only "twin" receipt (DOA_IN_TRANSIT), and
 * a Variance_Negative write-off priced by plain FIFO — so the write-off consumed the OLDEST receipt at the
 * location (at that receipt's cost) while the twin receipt kept its full remaining quantity. New receipts
 * no longer do this (the write-off is drawn from the receipt it belongs to); this script fixes the ones
 * already posted. For each such write-off it:
 *
 *   1. gives the consumed quantity back to the receipt(s) it wrongly drew from (remaining_quantity),
 *   2. re-points the write-off's application at the transfer's own DOA twin receipt and takes that
 *      receipt's remaining quantity down to zero,
 *   3. re-prices the write-off at the twin receipt's cost (inventory_ledger rate/amount and the
 *      application's cost), and
 *   4. posts one correcting system journal for the cost difference, with the same accounts as the
 *      write-off's original journal. The original journal is left as posted.
 *
 * Nothing is deleted from the ledger. Idempotent: a write-off already drawn from its own receipt is skipped.
 *
 * Read-only by default; --verify applies inside a transaction and rolls back; --apply commits.
 *
 *   pnpm nx run api:db-repair-transfer-doa-write-offs            # print the plan
 *   pnpm nx run api:db-repair-transfer-doa-write-offs -- --verify
 *   pnpm nx run api:db-repair-transfer-doa-write-offs -- --apply
 *
 * TENANT_DB_NAME picks the tenant database (default nf_devco).
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
const EPS = 0.0001;
const roundMoney = (n: number) => Number(n.toFixed(4));

/** The first row of a query, or undefined. */
async function one(conn: mysql.Connection, sql: string, params: unknown[] = []): Promise<RowDataPacket | undefined> {
  const [rows] = await conn.query<RowDataPacket[]>(sql, params as any[]);
  return rows[0];
}

type Plan =
  | { kind: 'ok'; writeOff: RowDataPacket; reason: string }
  | { kind: 'skip'; writeOff: RowDataPacket; reason: string }
  | {
      kind: 'repair';
      writeOff: RowDataPacket;
      twin: RowDataPacket;
      apps: RowDataPacket[];
      qty: number;
      oldCost: number;
      newCost: number;
    };

async function main() {
  const flags = process.argv.slice(2);
  const mode = flags.includes('--apply') ? '--apply' : flags.includes('--verify') ? '--verify' : 'READ_ONLY';

  console.log('================================================================');
  console.log(`Repair transfer DOA write-offs: [${mode}] on ${DB}`);
  console.log('================================================================');

  const conn = await mysql.createConnection({ host, port, user, password, database: DB, ssl });
  try {
    const [writeOffs] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM inventory_ledger
       WHERE document_type = 'STOCK_ADJUSTMENT' AND transaction_type = 'VARIANCE_NEGATIVE'
         AND external_reference_no = 'MRT-017' AND document_no LIKE '%-DOA'
       ORDER BY entry_no`,
    );
    console.log(`Found ${writeOffs.length} DOA write-off entr${writeOffs.length === 1 ? 'y' : 'ies'}.`);

    const claimed = new Set<string>();
    const plans: Plan[] = [];
    for (const writeOff of writeOffs) plans.push(await plan(conn, writeOff, claimed));

    for (const p of plans) {
      const head = `Entry #${p.writeOff.entry_no} ${p.writeOff.document_no}`;
      if (p.kind === 'repair') {
        console.log(
          `  REPAIR ${head}: draw ${p.qty} from twin receipt #${p.twin.entry_no} (rate ${p.twin.rate}) instead of ` +
            `${p.apps.map((a) => `#${a.inbound_entry_no}`).join(', ')}; cost ${p.oldCost} -> ${p.newCost}` +
            (Math.abs(p.newCost - p.oldCost) > EPS ? `; correcting journal ${roundMoney(p.newCost - p.oldCost)}` : ''),
        );
      } else {
        console.log(`  ${p.kind.toUpperCase().padEnd(6)} ${head}: ${p.reason}`);
      }
    }

    const repairs = plans.filter((p): p is Extract<Plan, { kind: 'repair' }> => p.kind === 'repair');
    if (mode === 'READ_ONLY' || repairs.length === 0) {
      console.log(repairs.length === 0 ? '\nNothing to repair.' : '\n[READ-ONLY PLAN] Run with --verify or --apply to execute.');
      console.log('================================================================');
      return;
    }

    await conn.beginTransaction();
    try {
      for (const r of repairs) await repair(conn, r);
      // Read back what the repair left, inside the transaction, so --verify shows real state before rolling back.
      for (const r of repairs) await report(conn, r);
      if (mode === '--verify') {
        await conn.rollback();
        console.log('\n[--verify] Rolled back. Database remains untouched.');
      } else {
        await conn.commit();
        console.log(`\n[--apply] COMMITTED ${repairs.length} repair(s).`);
      }
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    console.log('================================================================');
  } finally {
    await conn.end();
  }
}

async function plan(conn: mysql.Connection, writeOff: RowDataPacket, claimed: Set<string>): Promise<Plan> {
  const qty = Math.abs(Number(writeOff.quantity));
  const transferNo = String(writeOff.document_no).slice(0, -'-DOA'.length);

  const [apps] = await conn.query<RowDataPacket[]>(
    `SELECT a.*, l.document_no AS inbound_document_no, l.ledger_id AS inbound_id
     FROM inventory_application a JOIN inventory_ledger l ON l.ledger_id = a.inbound_ledger_id
     WHERE a.outbound_ledger_id = ? ORDER BY a.inbound_entry_no`,
    [writeOff.ledger_id],
  );
  if (apps.length === 0) return { kind: 'skip', writeOff, reason: 'no application recorded for this write-off' };
  const appliedQty = apps.reduce((n, a) => n + Number(a.applied_qty), 0);
  if (Math.abs(appliedQty - qty) > EPS) {
    return { kind: 'skip', writeOff, reason: `applications total ${appliedQty} but the write-off is ${qty} — review by hand` };
  }
  // Already drawn from a receipt of its own transfer: current behaviour, or already repaired.
  if (apps.every((a) => a.inbound_document_no === transferNo)) {
    return { kind: 'ok', writeOff, reason: `already drawn from its own transfer's receipt (#${apps.map((a) => a.inbound_entry_no).join(', ')})` };
  }

  const [twins] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM inventory_ledger
     WHERE document_no = ? AND transaction_type = 'TRANSFER_RECEIPT' AND external_reference_no = 'DOA_IN_TRANSIT'
       AND item_id <=> ? AND warehouse_id <=> ? AND document_line_id <=> ? AND posting_date = ?
     ORDER BY entry_no`,
    [transferNo, writeOff.item_id, writeOff.warehouse_id, writeOff.document_line_id, writeOff.posting_date],
  );
  const twin = twins.find((t) => !claimed.has(t.ledger_id) && Math.abs(Number(t.quantity) - qty) < EPS);
  if (!twin) return { kind: 'skip', writeOff, reason: `no DOA receipt of ${qty} found for transfer ${transferNo}` };
  if (Number(twin.remaining_quantity) + EPS < qty) {
    return { kind: 'skip', writeOff, reason: `receipt #${twin.entry_no} has only ${twin.remaining_quantity} left` };
  }
  claimed.add(twin.ledger_id);

  // Drawing the whole receipt takes the value it has left rather than qty x rate (see layerDrawCost).
  const rate = Number(twin.rate || 0);
  const applied = (await one(
    conn,
    `SELECT COALESCE(SUM(applied_cost_amount), 0) AS applied FROM inventory_application WHERE inbound_ledger_id = ?`,
    [twin.ledger_id],
  ))!;
  const fullyDrawn = qty >= Number(twin.remaining_quantity) - EPS;
  const newCost = fullyDrawn
    ? roundMoney((twin.amount != null ? Number(twin.amount) : roundMoney(Number(twin.quantity) * rate)) - Number(applied.applied))
    : roundMoney(qty * rate);
  const oldCost = roundMoney(apps.reduce((n, a) => n + Number(a.applied_cost_amount), 0));
  return { kind: 'repair', writeOff, twin, apps, qty, oldCost, newCost };
}

async function repair(conn: mysql.Connection, p: Extract<Plan, { kind: 'repair' }>) {
  const { writeOff, twin, apps, qty, oldCost, newCost } = p;

  // 1. Give back what the write-off wrongly took.
  for (const a of apps) {
    await conn.execute(`UPDATE inventory_ledger SET remaining_quantity = remaining_quantity + ? WHERE ledger_id = ?`, [a.applied_qty, a.inbound_ledger_id]);
  }
  // 2. One application, on the write-off's own receipt. entry_no columns are filled by trigger only on INSERT.
  const [keep, ...extra] = apps;
  for (const a of extra) await conn.execute(`DELETE FROM inventory_application WHERE application_id = ?`, [a.application_id]);
  await conn.execute(
    `UPDATE inventory_application SET inbound_ledger_id = ?, inbound_entry_no = ?, applied_qty = ?, applied_cost_amount = ? WHERE application_id = ?`,
    [twin.ledger_id, twin.entry_no, qty, newCost, keep.application_id],
  );
  await conn.execute(`UPDATE inventory_ledger SET remaining_quantity = remaining_quantity - ? WHERE ledger_id = ?`, [qty, twin.ledger_id]);
  // 3. Re-price the write-off.
  await conn.execute(`UPDATE inventory_ledger SET rate = ?, amount = ? WHERE ledger_id = ?`, [(newCost / qty).toFixed(6), (-newCost).toFixed(4), writeOff.ledger_id]);

  // 4. One correcting journal for the difference.
  const delta = roundMoney(newCost - oldCost);
  if (Math.abs(delta) <= EPS) return;
  const original = await one(
    conn,
    `SELECT * FROM journal_header WHERE source_ledger_id = ? AND source = 'SYSTEM' ORDER BY created_at LIMIT 1`,
    [writeOff.ledger_id],
  );
  if (!original) throw new Error(`Write-off #${writeOff.entry_no} has no system journal to mirror — correct the GL by hand.`);
  const [lines] = await conn.query<RowDataPacket[]>(`SELECT * FROM journal_line WHERE journal_id = ? ORDER BY line_no`, [original.journal_id]);
  const debit = lines.find((l) => Number(l.debit_amount) > 0);
  const credit = lines.find((l) => Number(l.credit_amount) > 0);
  if (!debit || !credit) throw new Error(`Journal ${original.journal_no} has no debit/credit pair to mirror.`);

  const next = (await one(
    conn,
    `SELECT COALESCE(MAX(CAST(SUBSTRING(journal_no, 4) AS UNSIGNED)), 0) AS maxSeq FROM journal_header WHERE tenant_id = ? AND company_id = ? FOR UPDATE`,
    [original.tenant_id, original.company_id],
  ))!;
  const journalNo = `JE-${String(Number(next.maxSeq) + 1).padStart(6, '0')}`;
  const journalId = randomUUID();
  const amount = Math.abs(delta);
  // More cost than first posted: same direction again. Less: the opposite.
  const [dr, cr] = delta > 0 ? [debit, credit] : [credit, debit];
  await conn.execute(
    `INSERT INTO journal_header (journal_id, tenant_id, company_id, journal_no, posting_date, source, source_document_type, source_document_no,
       source_ledger_id, description, status, total_debit, total_credit, posted_at, posted_by, created_by, updated_by)
     VALUES (?, ?, ?, ?, CURDATE(), 'SYSTEM', ?, ?, ?, ?, 'POSTED', ?, ?, NOW(), ?, ?, ?)`,
    [
      journalId, original.tenant_id, original.company_id, journalNo, original.source_document_type, original.source_document_no,
      writeOff.ledger_id,
      `Cost correction — ${writeOff.item_code} (${writeOff.document_no}): DOA drawn from its own receipt at ${(newCost / qty).toFixed(2)}, not ${(oldCost / qty).toFixed(2)} (corrects ${original.journal_no})`,
      amount, amount, original.posted_by, original.created_by, original.created_by,
    ],
  );
  for (const [i, [line, isDebit]] of ([[dr, true], [cr, false]] as const).entries()) {
    await conn.execute(
      `INSERT INTO journal_line (line_id, journal_id, line_no, gl_account_id, cost_center_id, debit_amount, credit_amount, description, nob_id, lob_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [randomUUID(), journalId, i + 1, line.gl_account_id, line.cost_center_id, isDebit ? amount : 0, isDebit ? 0 : amount, line.nob_id, line.lob_id],
    );
  }
  console.log(`  journal ${journalNo} posted for ${delta > 0 ? '+' : '-'}${amount}`);
}

async function report(conn: mysql.Connection, p: Extract<Plan, { kind: 'repair' }>) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT entry_no, transaction_type, quantity, remaining_quantity, rate, amount FROM inventory_ledger WHERE ledger_id IN (?, ?, ?) ORDER BY entry_no`,
    [p.writeOff.ledger_id, p.twin.ledger_id, p.apps[0].inbound_ledger_id],
  );
  console.log(`  after #${p.writeOff.entry_no}:`);
  for (const r of rows) console.log(`    #${r.entry_no} ${r.transaction_type} qty ${r.quantity} remaining ${r.remaining_quantity} rate ${r.rate} amount ${r.amount}`);
  const [apps] = await conn.query<RowDataPacket[]>(
    `SELECT inbound_entry_no, outbound_entry_no, applied_qty, applied_cost_amount FROM inventory_application WHERE outbound_ledger_id = ?`,
    [p.writeOff.ledger_id],
  );
  for (const a of apps) console.log(`    application: #${a.outbound_entry_no} drew ${a.applied_qty} from #${a.inbound_entry_no} for ${a.applied_cost_amount}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during execution:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
