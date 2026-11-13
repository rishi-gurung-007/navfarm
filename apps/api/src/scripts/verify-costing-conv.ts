/**
 * Reads the FA to inventory conversion seed (chapter 21-costing-conversion) back from MySQL and checks it against ITS OWN arithmetic: each animal's net book value from her
 * own ledger before she left, the gain or loss against the market value Finance approved, the exit row that takes her book value to nil, the accumulated amortisation
 * cleared, the journals (inventory at market value, gain or loss, balanced) and the inventory receipt. Read-only. Exits 1 when any check fails.
 * (The refusals - a direct cull, a request before the out-of-production date, self-approval, posting before approval - are asserted by the chapter itself; it stops with an
 * error when one is not refused.)
 *
 *   pnpm nx run api:db-verify-costing-conv
 *   env: DATABASE_HOST, DATABASE_PORT, DATABASE_USERNAME, DATABASE_PASSWORD, DEMO_TENANT_DATABASE (default nf_devco)
 */
import * as mysql from 'mysql2/promise';
import { BOOK_VALUE_EVENTS } from '../modules/inventory/bio-asset-ledger/animal-book-value.service';
import { bioEventOf } from '../modules/inventory/bio-asset-ledger/bio-asset-ledger.types';

const TOL = 0.0006;
const book: string[] = [...BOOK_VALUE_EVENTS];
const d = (v: unknown) => String(v).slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol;

interface Check { id: string; what: string; pass: boolean; detail: string }
const checks: Check[] = [];
const check = (id: string, what: string, pass: boolean, detail = '') => checks.push({ id, what, pass, detail });

const PLAN = [{ tag: 'CONV-LOSS', price: 900, market: 600 }, { tag: 'CONV-GAIN', price: 400, market: 450 }];

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '', database: process.env.DEMO_TENANT_DATABASE || 'nf_devco', dateStrings: true,
  });
  const q = async <T = any>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as T[];

  const herd = await q(`select animal_id, animal_code, rfid_tag tag, status, is_active, disposal_type, disposal_date, disposal_value, gain_loss_on_disposal gl, out_of_production_date oop, book_value cache_bv
    from animal_register where rfid_tag in ('CONV-LOSS','CONV-GAIN')`);
  const of = (tag: string) => herd.find((h) => h.tag === tag);
  const convs = await q(`select * from fa_inventory_conversion order by created_at`);
  const convOf = (animalId: string) => convs.find((x) => x.animal_id === animalId);
  check('A1', 'two animals, each with exactly one conversion request, both POSTED, none left open', herd.length === 2 && convs.length === 2 && convs.every((x) => x.status === 'POSTED' && x.active_key === null), `${herd.length} animals, ${convs.map((x) => `${x.conversion_no}:${x.status}`).join(' ')}`);
  if (herd.length !== 2 || convs.length !== 2) { report(); await c.end(); process.exit(1); }

  const ledger = (await q(`select l.animal_id, l.entry_type, l.transaction_type, l.document_type, l.posting_date, l.cost_amount amt, l.run_id from bio_asset_ledger l where l.animal_id is not null`))
    .map((l) => ({ ...l, event: bioEventOf(l) }));
  const bookBefore = (id: string, before: string) => ledger.filter((l) => l.animal_id === id && book.includes(l.event) && d(l.posting_date) < before).reduce((n, l) => n + num(l.amt), 0);
  const bookAll = (id: string) => ledger.filter((l) => l.animal_id === id && book.includes(l.event)).reduce((n, l) => n + num(l.amt), 0);

  for (const p of PLAN) {
    const a = of(p.tag)!;
    const cv = convOf(a.animal_id);
    check(`S1 ${p.tag}`, 'she left as CONVERTED_INV: not active, disposal type CONVERTED, converted on 2026-10-05 - after her separate out-of-production date 2026-09-15',
      a.status === 'CONVERTED_INV' && !Number(a.is_active) && a.disposal_type === 'CONVERTED' && d(a.disposal_date) === '2026-10-05' && d(a.oop) === '2026-09-15' && d(cv.out_of_production_date) === '2026-09-15', `${a.status}/${a.disposal_type} ${d(a.disposal_date)} oop ${d(a.oop)}`);
    check(`S2 ${p.tag}`, 'raised by one user and approved by a different one, with the market value Finance entered',
      !!cv.requested_by && !!cv.approved_by && cv.requested_by !== cv.approved_by && near(num(cv.market_value), p.market) && !!cv.approved_at && !!cv.posted_at, `requested ${String(cv.requested_by).slice(0, 8)} approved ${String(cv.approved_by).slice(0, 8)} market ${cv.market_value}`);
    const nbv = bookBefore(a.animal_id, d(cv.conversion_date));
    check(`N1 ${p.tag}`, 'the net book value frozen on the request = her own ledger before she left (cost less what was amortised)', near(num(cv.nbv_at_conversion), nbv, 0.002) && nbv > 0 && nbv < p.price, `request ${cv.nbv_at_conversion}, ledger ${nbv.toFixed(4)} (cost ${p.price})`);
    const gl = p.market - nbv;
    check(`N2 ${p.tag}`, `gain or loss = market value ${p.market} - net book value: ${gl < 0 ? 'a LOSS' : 'a GAIN'}, on the request and on her register`, near(num(cv.gain_loss), gl, 0.002) && near(num(a.gl), gl, 0.002) && near(num(a.disposal_value), p.market), `${num(cv.gain_loss).toFixed(4)} vs ${gl.toFixed(4)}; register ${a.gl}`);
    const exit = ledger.filter((l) => l.animal_id === a.animal_id && d(l.posting_date) === '2026-10-05' && num(l.amt) < 0);
    check(`L1 ${p.tag}`, 'one ledger row on the conversion date takes out exactly her book value, so her book value is nil', exit.length === 1 && near(-num(exit[0].amt), nbv, 0.002) && near(bookAll(a.animal_id), 0, 0.002) && near(num(a.cache_bv), 0, 0.002), `${exit.map((x) => x.amt).join(',')}; ledger ${bookAll(a.animal_id).toFixed(4)}; cache ${a.cache_bv}`);
    const inv = await q(`select item_code, entry_type, transaction_type, document_type, document_no, quantity, amount, lot_no, posting_date, warehouse_id from inventory_ledger where document_type = 'FA_CONVERSION' and lot_no = ?`, [a.animal_code]);
    check(`I1 ${p.tag}`, `received into inventory: one row, culled breeding asset, quantity 1, cost = the market value ${p.market}, lot = her animal code, on the conversion date`,
      inv.length === 1 && inv[0].item_code === 'CULLED-BREEDING-ASSET' && num(inv[0].quantity) === 1 && near(num(inv[0].amount), p.market) && inv[0].document_no === cv.conversion_no && d(inv[0].posting_date) === '2026-10-05' && cv.inventory_ledger_id !== null, `${inv.length} rows ${inv.map((r) => `${r.item_code} ${r.quantity}@${r.amount} lot ${r.lot_no}`).join(';')}`);
  }

  // GL: inventory at market value, gain/loss, accumulated amortisation cleared, every journal balanced
  const net = async (code: string) => num((await q(`select coalesce(sum(jl.debit_amount - jl.credit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = ?`, [code]))[0].x);
  const marketTotal = PLAN.reduce((n, p) => n + p.market, 0);
  const gainLossTotal = PLAN.reduce((n, p) => n + num(convOf(of(p.tag)!.animal_id).gain_loss), 0);
  check('G1', 'inventory account 1030 (Finished Goods) is debited by the two market values: 600 + 450 = 1050', near(await net('1030'), marketTotal, 0.003), `${(await net('1030')).toFixed(4)}`);
  check('G2', 'gain/loss account 4010 nets to the two gains and losses together (credit = gain - loss)', near(-(await net('4010')), gainLossTotal, 0.003), `4010 net credit ${(-(await net('4010'))).toFixed(4)}, gain/loss ${gainLossTotal.toFixed(4)}`);
  check('G3', 'accumulated amortisation 1065 is back to nil: what the runs built up was cleared when the animals left', near(await net('1065'), 0, 0.003), `${(await net('1065')).toFixed(4)}`);
  const exitJournals = await q(`select count(*) n from journal_header where source_document_type = 'BIO_ASSET_EXIT'`);
  check('G4', 'one accumulated-amortisation clearing journal for each animal', Number(exitJournals[0].n) === 2, `${exitJournals[0].n}`);
  const unbalanced = await q('select count(*) n from journal_header where round(total_debit,2) <> round(total_credit,2)');
  check('G5', 'no journal is unbalanced', Number(unbalanced[0].n) === 0, `${unbalanced[0].n}`);

  // the item and the stock
  const items = await q(`select item_code, item_type, is_lot_tracked, is_biological_asset from item_master where item_code = 'CULLED-BREEDING-ASSET'`);
  check('T1', 'one inventory item "Culled Breeding Asset": finished goods, lot-tracked, not itself a biological asset', items.length === 1 && items[0].item_type === 'FINISHED_GOODS' && !!Number(items[0].is_lot_tracked) && !Number(items[0].is_biological_asset), `${items.length} item(s)`);
  const stock = await q(`select sum(quantity) q, sum(amount) a from inventory_ledger where document_type = 'FA_CONVERSION'`);
  check('T2', 'stock received = 2 head at 1050 in total', num(stock[0].q) === 2 && near(num(stock[0].a), marketTotal, 0.003), `${stock[0].q} head, ${stock[0].a}`);
  const noBc = convs.every((x) => x.bc_fa_ledger_entry_no === null && x.bc_item_ledger_entry_no === null);
  check('T3', 'the two Business Central entry numbers are empty: there is no BC link yet', noBc, 'as expected');

  report();
  await c.end();
  if (checks.some((x) => !x.pass)) process.exit(1);
}

function report() {
  const failed = checks.filter((x) => !x.pass);
  console.log('\nCOSTING (FA TO INVENTORY CONVERSION) - read back from MySQL\n');
  for (const x of checks) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.id.padEnd(11)} ${x.what}${x.detail ? `  [${x.detail}]` : ''}`);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed${failed.length ? `; ${failed.length} FAILED` : ''}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exit(1); });
