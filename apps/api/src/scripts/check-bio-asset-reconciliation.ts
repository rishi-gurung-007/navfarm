/**
 * Bio-asset reconciliation (bio-asset costing, Phase 2). READ-ONLY: it reports, it never repairs.
 *
 *   1. Cache vs ledger — animal_register.book_value / total_amortised against what the animal's own bio_asset_ledger
 *      rows say (AnimalBookValueService), for every animal.
 *   2. Departed animals — an animal that has died or been sold/culled should be at nil on her own ledger.
 *   3. Batch vs animals — an animal-wise bio-asset batch's carrying value (batch_bio_asset_state.nca_book_value) is the
 *      capitalised cost the batch and the GL hold. It should equal its ledger rows other than ACQUISITION, with the
 *      acquisition of animals that have left added back (their exit row carries it). A count-only batch should equal
 *      the sum of all its rows, the value it moved to or from other batches (transfers) included. (The animals' acquisition cost is not in the batch figure or in the GL: decision D8.) For an animal that has left, her
 *      acquisition, amortisation and fair-value rows are added back, because her exit row is her whole book value net of them.
 *
 *   pnpm nx run api:db-check-bio-asset-reconciliation                  # nf_devco
 *   pnpm nx run api:db-check-bio-asset-reconciliation -- --database=nf_x
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { BOOK_VALUE_EVENTS } from '../modules/inventory/bio-asset-ledger/animal-book-value.service';
import { bioEventSql } from '../modules/inventory/bio-asset-ledger/bio-asset-ledger.types';

const money = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
const TOL = 0.005;

async function run() {
  const flags = process.argv.slice(2);
  const database = flags.find((f) => f.startsWith('--database='))?.slice('--database='.length) || 'nf_devco';
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
  });
  try {
    await db.query('SET SESSION TRANSACTION READ ONLY');
    // The rows that make up a carrying value: the same events the application's own book value counts.
    const bookRows = (alias: string) => bioEventSql(BOOK_VALUE_EVENTS, alias);

    const [animals] = await db.query<RowDataPacket[]>(
      `SELECT a.animal_code, a.status, a.is_active, a.book_value cache_bv, a.total_amortised cache_am,
              COALESCE(SUM(l.cost_amount),0) ledger_bv, COALESCE(-SUM(CASE WHEN ${bioEventSql('AMORTIZATION', 'l')} THEN l.cost_amount END),0) ledger_am,
              COUNT(l.entry_id) n
         FROM animal_register a LEFT JOIN bio_asset_ledger l ON l.animal_id=a.animal_id AND ${bookRows('l')}
        GROUP BY a.animal_id ORDER BY a.animal_code`);
    const cacheDrift = animals.filter((a) => a.n > 0 && (Math.abs(a.cache_bv - a.ledger_bv) > TOL || Math.abs(a.cache_am - a.ledger_am) > TOL));
    const noRows = animals.filter((a) => a.n === 0);
    const departed = animals.filter((a) => (!a.is_active || ['DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED'].includes(a.status)) && a.n > 0 && Math.abs(a.ledger_bv) > TOL);

    const [batches] = await db.query<RowDataPacket[]>(
      `SELECT b.batch_no, b.status, b.animal_tracking, s.nca_book_value nca,
              (SELECT COALESCE(SUM(l.cost_amount),0) FROM bio_asset_ledger l WHERE l.batch_id=b.batch_id AND ${bookRows('l')}) all_rows,
              (SELECT COALESCE(SUM(l.cost_amount),0) FROM bio_asset_ledger l WHERE l.batch_id=b.batch_id AND ${bioEventSql(['TRANSFER_IN', 'TRANSFER_OUT'], 'l')}) transfers,
              (SELECT COALESCE(SUM(l.cost_amount),0) FROM bio_asset_ledger l WHERE l.batch_id=b.batch_id AND ${bookRows('l')} AND NOT ${bioEventSql('ACQUISITION', 'l')}) non_acq,
              (SELECT COALESCE(SUM(q.cost_amount),0) FROM bio_asset_ledger q WHERE ${bioEventSql(['ACQUISITION', 'AMORTIZATION', 'FAIR_VALUE_ADJMT'], 'q')} AND q.animal_id IN
                 (SELECT x.animal_id FROM bio_asset_ledger x WHERE x.batch_id=b.batch_id AND x.animal_id IS NOT NULL AND ${bioEventSql(['MORTALITY', 'TRANSFORMATION'], 'x')})) exited_acq
         FROM batch_header b JOIN batch_bio_asset_state s ON s.batch_id=b.batch_id WHERE b.costing_method='BIO_ASSET' ORDER BY b.batch_no`);
    const batchRows = batches.map((b) => {
      const expected = b.animal_tracking === 'REGISTERED' ? Number(b.non_acq) + Number(b.exited_acq) : Number(b.all_rows) + Number(b.transfers);
      return { batch: b.batch_no, status: b.status, tracking: b.animal_tracking, batch_carrying_value: money(b.nca), ledger_expected: money(expected), difference: money(Number(b.nca) - expected) };
    });

    console.log(JSON.stringify({
      database,
      animals_checked: animals.length,
      animals_with_no_ledger_rows: noRows.map((a) => a.animal_code),
      cache_differs_from_ledger: cacheDrift.map((a) => ({ animal: a.animal_code, cache_book_value: money(a.cache_bv), ledger_book_value: money(a.ledger_bv), cache_amortised: money(a.cache_am), ledger_amortised: money(a.ledger_am) })),
      departed_animals_not_at_nil: departed.map((a) => ({ animal: a.animal_code, status: a.status, ledger_book_value: money(a.ledger_bv) })),
      batches: batchRows,
      batches_that_differ: batchRows.filter((b) => Math.abs(b.difference) > TOL).map((b) => b.batch),
    }, null, 2));
  } finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
