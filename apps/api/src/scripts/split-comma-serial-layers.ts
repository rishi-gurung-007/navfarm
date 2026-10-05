/**
 * Split inventory ledger layers whose serial_no names several serials
 * ("SN00001,SN00002") into one layer per serial (P1 follow-up item 6; the
 * rule is in split-comma-serial-layers.lib.ts).
 *
 * Generic: every ledger row whose serial_no contains a comma is examined.
 * Only an unconsumed POSITIVE layer is split: remaining = quantity, and no
 * inventory_application row draws on it. Every other row is left as it is
 * and reported with its reason. The original row keeps its ledger_id and the
 * first serial. Each further serial gets a new row that copies every column
 * of the original except ledger_id, serial_no, quantity, remaining_quantity,
 * amount and alternate_quantity. The value is split exactly, so the
 * warehouse's value and quantity are unchanged.
 *
 * Default is read-only (prints the plan); --verify applies and rolls back;
 * --apply commits. Local databases only. Idempotent: once split, a layer no
 * longer carries a comma. The database is DEV_TENANT_DATABASE (default
 * nf_devco).
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { planSerialLayerSplits, type LedgerLayerRow } from './split-comma-serial-layers.lib';

const OVERRIDDEN = ['ledger_id', 'serial_no', 'quantity', 'remaining_quantity', 'amount', 'alternate_quantity'];

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing non-local host '${host}' — this script may only touch local databases.`);
  }
  const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
  const db = await mysql.createConnection({
    host, port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
  });
  try {
    await db.beginTransaction();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ledger_id, document_no, entry_type, quantity, remaining_quantity, amount, alternate_quantity, serial_no,
              item_code, warehouse_id
         FROM inventory_ledger WHERE serial_no LIKE '%,%' ORDER BY created_at FOR UPDATE`,
    );
    const ids = rows.map((r) => r.ledger_id as string);
    const [applied] = ids.length
      ? await db.query<RowDataPacket[]>('SELECT DISTINCT inbound_ledger_id FROM inventory_application WHERE inbound_ledger_id IN (?)', [ids])
      : [[] as RowDataPacket[]];
    const plan = planSerialLayerSplits(rows as unknown as LedgerLayerRow[], new Set(applied.map((a) => a.inbound_ledger_id as string)));

    // What the picker and the warehouse balance see, before.
    const touched = [...new Set(plan.split.map((s) => rows.find((r) => r.ledger_id === s.ledger_id)!).map((r) => `${r.item_code}|${r.warehouse_id}`))];
    const balance = async () => Promise.all(touched.map(async (key) => {
      const [item_code, warehouse_id] = key.split('|');
      const [[b]] = await db.query<RowDataPacket[]>(
        `SELECT ? item_code, (SELECT location_code FROM location_master WHERE location_id = ?) warehouse,
                SUM(quantity) quantity, SUM(amount) amount, SUM(CASE WHEN entry_type = 'POSITIVE' THEN remaining_quantity ELSE 0 END) remaining
           FROM inventory_ledger WHERE item_code = ? AND warehouse_id = ?`,
        [item_code, warehouse_id, item_code, warehouse_id],
      );
      return b;
    }));
    const before = await balance();

    let updated = 0;
    let inserted = 0;
    if (verify || apply) {
      const [cols] = await db.query<RowDataPacket[]>(
        `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = 'inventory_ledger' ORDER BY ordinal_position`,
        [database],
      );
      const copied = cols.map((c) => c.c as string).filter((c) => !OVERRIDDEN.includes(c));
      const list = [...OVERRIDDEN, ...copied].map((c) => `\`${c}\``).join(', ');
      const select = ['?', '?', '?', '?', '?', '?', ...copied.map((c) => `\`${c}\``)].join(', ');
      for (const s of plan.split) {
        const [res] = await db.query<mysql.ResultSetHeader>(
          `UPDATE inventory_ledger SET serial_no = ?, quantity = ?, remaining_quantity = ?, amount = ?, alternate_quantity = ?
            WHERE ledger_id = ? AND serial_no = ? AND remaining_quantity = quantity`,
          [s.keep.serial_no, s.keep.quantity, s.keep.remaining_quantity, s.keep.amount, s.keep.alternate_quantity, s.ledger_id, s.serial_no],
        );
        if (res.affectedRows !== 1) throw new Error(`Layer ${s.ledger_id} changed under the run; nothing committed.`);
        updated++;
        for (const a of s.add) {
          await db.query(
            `INSERT INTO inventory_ledger (${list}) SELECT ${select} FROM inventory_ledger WHERE ledger_id = ?`,
            [randomUUID(), a.serial_no, a.quantity, a.remaining_quantity, a.amount, a.alternate_quantity, s.ledger_id],
          );
          inserted++;
        }
      }
    }
    const after = await balance();
    const [[left]] = await db.query<RowDataPacket[]>(
      `SELECT SUM(entry_type = 'POSITIVE') positive_comma_layers, SUM(entry_type <> 'POSITIVE') history_comma_rows
         FROM inventory_ledger WHERE serial_no LIKE '%,%'`,
    );
    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      rowsWithComma: rows.length,
      split: plan.split.map((s) => ({ ledger_id: s.ledger_id, document_no: s.document_no, from: s.serial_no, into: [s.keep, ...s.add].map((p) => `${p.serial_no} x1 @ ${p.amount}`) })),
      skippedConsumedOrMalformed: plan.skipped,
      historyRowsLeftAsIs: plan.historyRows,
      layersUpdated: updated,
      layersInserted: inserted,
      warehouseBefore: before,
      warehouseAfter: after,
      commaRowsAfter: left,
    }, null, 2));
    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message); process.exit(1); });
}
