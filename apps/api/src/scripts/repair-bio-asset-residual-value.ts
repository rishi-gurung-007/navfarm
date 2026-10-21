/**
 * Clears the carrying value BIO_ASSET batches kept after their head had gone, before batch-transfer.service and
 * BatchService.recordAnimalExit moved it out themselves.
 *
 * Two things left it behind:
 *
 * 1. A sow sold, culled or slaughtered from her animal record (PATCH /animal/:id/dispose) took her head out of
 *    the batch's bio-asset state but not her value, and her exit row in bio_asset_ledger named no batch. Her
 *    book value (that row's cost) comes off the state of the batch she left — never below nil — and the row is
 *    given that batch, so its roll-forward shows her going.
 * 2. A transfer moved animals at their own book values, so a batch emptied by transfer kept what it had
 *    capitalised while it held them (feed, overheads), and a head-count transfer drafted before late costs kept
 *    those. What is left once (1) is done on a batch with no head goes to the destination of its last posted
 *    transfer out, as the posting now does: a nil-quantity TRANSFER_OUT / TRANSFER_IN pair under that transfer's
 *    number, the transfer's value and lines raised to match. A destination that was itself emptied passes it on
 *    in a later pass. A batch emptied some other way (no transfer out) is listed and left alone.
 *
 * The sales and culls in (1) also never journaled. That is listed, not posted: those journals are the
 * accountant's call.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 * DEV_TENANT_DATABASE picks the tenant database (default nf_devco).
 */
import { randomUUID } from 'crypto';
import mysql, { Connection, RowDataPacket } from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const money = (n: number) => n.toFixed(4);

/** Old-code animal exits: an exit row with no batch, and the batch her CULL/DISPOSAL movement says she left. */
async function unrelievedExits(db: Connection) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT l.entry_id, l.animal_id, l.document_no AS animal_code, -l.cost_amount AS value, l.posting_date,
            a.disposal_type, a.disposal_value, b.batch_id, b.batch_no
       FROM bio_asset_ledger l
       JOIN animal_register a ON a.animal_id = l.animal_id
       JOIN animal_movement_log m ON m.animal_id = l.animal_id AND m.movement_type IN ('CULL', 'DISPOSAL')
       JOIN batch_header b ON b.batch_id = m.from_batch_id AND b.costing_method = 'BIO_ASSET'
      WHERE l.entry_type = 'TRANSFORMATION' AND l.animal_id IS NOT NULL AND l.batch_id IS NULL
      ORDER BY b.batch_no, l.posting_date`,
  );
  return rows;
}

/** BIO_ASSET batches with no head that still carry value, with their last posted transfer out. */
async function emptiedWithValue(db: Connection) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT b.batch_id, b.batch_no, b.tracking_mode, s.nca_book_value AS residual,
            (SELECT t.transfer_id FROM batch_transfer t
              WHERE t.from_batch_id = b.batch_id AND t.status = 'POSTED' AND t.deleted_at IS NULL
              ORDER BY t.transfer_date DESC, t.posted_at DESC LIMIT 1) AS last_transfer_id
       FROM batch_header b
       JOIN batch_bio_asset_state s ON s.batch_id = b.batch_id
      WHERE b.costing_method = 'BIO_ASSET' AND b.deleted_at IS NULL AND s.nca_book_value > 0.005
        AND NOT EXISTS (SELECT 1 FROM animal_register a WHERE a.current_batch_id = b.batch_id AND a.is_active = 1)
        -- An animal-wise batch's head is its live animals; a batch-wise batch's is its state.
        AND (b.tracking_mode = 'ANIMAL_WISE' OR s.current_quantity <= 0)
      ORDER BY b.batch_no`,
  );
  return rows;
}

async function sweepToDestination(db: Connection, batch: RowDataPacket) {
  // Read now, not from the list: a batch earlier in the same pass may have just passed value into this one.
  const [[state]] = await db.query<RowDataPacket[]>('SELECT nca_book_value FROM batch_bio_asset_state WHERE batch_id = ?', [batch.batch_id]);
  const residual = Number(state?.nca_book_value) || 0;
  if (residual <= 0.005) return null;
  const [[t]] = await db.query<RowDataPacket[]>(
    `SELECT t.transfer_id, t.transfer_no, t.transfer_date, t.to_batch_id, t.transfer_value, d.batch_no AS to_batch_no
       FROM batch_transfer t JOIN batch_header d ON d.batch_id = t.to_batch_id WHERE t.transfer_id = ?`,
    [batch.last_transfer_id],
  );
  // The transfer's own out leg gives the item, company and dimensions the adjustment posts under.
  const [[leg]] = await db.query<RowDataPacket[]>(
    `SELECT * FROM bio_asset_ledger WHERE document_no = ? AND batch_id = ? AND entry_type = 'TRANSFER_OUT' LIMIT 1`,
    [t.transfer_no, batch.batch_id],
  );
  if (!leg) return null;
  const [[dest]] = await db.query<RowDataPacket[]>(
    `SELECT batch_no, nob_id, lob_id, current_stage_code FROM batch_header WHERE batch_id = ?`,
    [t.to_batch_id],
  );

  await db.query('UPDATE batch_bio_asset_state SET nca_book_value = 0, updated_at = NOW() WHERE batch_id = ?', [batch.batch_id]);
  const [moved] = await db.query<any>(
    'UPDATE batch_bio_asset_state SET nca_book_value = nca_book_value + ?, updated_at = NOW() WHERE batch_id = ?',
    [money(residual), t.to_batch_id],
  );
  if (!moved.affectedRows) {
    await db.query(
      `INSERT INTO batch_bio_asset_state (state_id, batch_id, stage, current_quantity, nca_book_value) VALUES (?, ?, 'PREMATURE', 0, ?)`,
      [randomUUID(), t.to_batch_id, money(residual)],
    );
  }
  const legRow = (over: Record<string, unknown>) => ({
    entry_id: randomUUID(),
    tenant_id: leg.tenant_id,
    company_id: leg.company_id,
    bio_asset_item_id: leg.bio_asset_item_id,
    document_no: t.transfer_no,
    posting_date: t.transfer_date,
    quantity: '0.0000',
    ...over,
  });
  for (const row of [
    legRow({ entry_type: 'TRANSFER_OUT', batch_id: batch.batch_id, batch_no: batch.batch_no, stage: leg.stage, cost_amount: money(-residual), nob_id: leg.nob_id, lob_id: leg.lob_id }),
    legRow({ entry_type: 'TRANSFER_IN', batch_id: t.to_batch_id, batch_no: dest.batch_no, stage: dest.current_stage_code, cost_amount: money(residual), nob_id: dest.nob_id, lob_id: dest.lob_id }),
  ]) {
    await db.query('INSERT INTO bio_asset_ledger SET ?', [row]);
  }

  // The transfer and its lines carry what moved: the residual spread over the lines by their values.
  const [lines] = await db.query<RowDataPacket[]>(
    'SELECT line_id, book_value FROM batch_transfer_line WHERE transfer_id = ? ORDER BY line_no',
    [t.transfer_id],
  );
  const newTotal = Number(t.transfer_value) + residual;
  if (lines.length) {
    const sum = lines.reduce((a, l) => a + Number(l.book_value), 0);
    let given = 0;
    for (const [i, l] of lines.entries()) {
      const v = i === lines.length - 1
        ? newTotal - given
        : Number(((sum > 0 ? Number(l.book_value) / sum : 1 / lines.length) * newTotal).toFixed(4));
      given += v;
      await db.query('UPDATE batch_transfer_line SET book_value = ? WHERE line_id = ?', [money(v), l.line_id]);
    }
  }
  await db.query('UPDATE batch_transfer SET transfer_value = ?, updated_at = NOW() WHERE transfer_id = ?', [money(newTotal), t.transfer_id]);
  return `${batch.batch_no} ${money(residual)} -> ${t.to_batch_no} (${t.transfer_no})`;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl, dateStrings: true });
  try {
    const exits = await unrelievedExits(db);
    const emptied = await emptiedWithValue(db);
    console.log(JSON.stringify({
      database,
      exitsToRelieve: exits.map((e) => `${e.batch_no} ${e.animal_code} ${e.disposal_type} ${money(Number(e.value))}`),
      emptiedCarryingValue: emptied.map((b) => `${b.batch_no} ${money(Number(b.residual))}${b.last_transfer_id ? '' : ' (no transfer out — left alone)'}`),
      // Never journaled. Not posted by this script.
      salesAndCullsWithoutJournal: exits
        .filter((e) => ['SOLD', 'CULLED'].includes(e.disposal_type))
        .map((e) => `${e.animal_code} ${e.disposal_type} ${String(e.posting_date).slice(0, 10)} proceeds ${money(Number(e.disposal_value) || 0)} book ${money(Number(e.value))}`),
    }, null, 2));

    if (!apply && !verify) {
      console.log('Read-only. No changes attempted.');
      return;
    }
    await db.beginTransaction();

    for (const e of exits) {
      await db.query('UPDATE bio_asset_ledger SET batch_id = ?, batch_no = ? WHERE entry_id = ?', [e.batch_id, e.batch_no, e.entry_id]);
      await db.query(
        'UPDATE batch_bio_asset_state SET nca_book_value = GREATEST(0, nca_book_value - ?), updated_at = NOW() WHERE batch_id = ?',
        [money(Number(e.value)), e.batch_id],
      );
    }

    // A destination emptied in its turn passes the value on, so sweep until nothing moves.
    const moves: string[] = [];
    for (let pass = 0; pass < 25; pass++) {
      const todo = (await emptiedWithValue(db)).filter((b) => b.last_transfer_id);
      if (!todo.length) break;
      let movedAny = false;
      for (const b of todo) {
        const moved = await sweepToDestination(db, b);
        if (moved) {
          moves.push(moved);
          movedAny = true;
        }
      }
      if (!movedAny) break;
    }

    const left = await emptiedWithValue(db);
    console.log(JSON.stringify({
      relievedExits: exits.length,
      moves,
      stillCarrying: left.map((b) => `${b.batch_no} ${money(Number(b.residual))}`),
    }, null, 2));
    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log('Verified and rolled back. No changes committed.');
    }
  } finally {
    await db.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
