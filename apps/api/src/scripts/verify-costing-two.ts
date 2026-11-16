/**
 * Reads the two-animal costing seed (chapter 18-costing-two-animals) back from MySQL and checks it against ITS OWN arithmetic, not numbers copied from a run:
 * each charge is recomputed from the line's own inputs, each book value from the ledger as of the period's end, each journal against its ledger rows, and the
 * two animals' start dates, capitalised cost and expensed cost from the entries themselves. Read-only. Exits 1 when any check fails.
 *
 *   pnpm nx run api:db-verify-costing-two
 *   env: DATABASE_HOST, DATABASE_PORT, DATABASE_USERNAME, DATABASE_PASSWORD, DEMO_TENANT_DATABASE (default nf_devco)
 */
import * as mysql from 'mysql2/promise';
import { BOOK_VALUE_EVENTS } from '../modules/inventory/bio-asset-ledger/animal-book-value.service';
import { bioEventOf } from '../modules/inventory/bio-asset-ledger/bio-asset-ledger.types';

const TOL = 0.0006;
const book: string[] = [...BOOK_VALUE_EVENTS];
const CAP = ['CONSUMPTION', 'OVERHEAD_COST'];
const d = (v: unknown) => String(v).slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol;

interface Check { id: string; what: string; pass: boolean; detail: string }
const checks: Check[] = [];
const check = (id: string, what: string, pass: boolean, detail = '') => checks.push({ id, what, pass, detail });

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '', database: process.env.DEMO_TENANT_DATABASE || 'nf_devco', dateStrings: true,
  });
  const q = async <T = any>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as T[];

  // ---- the herd: exactly two animals -----------------------------------------------------------------------------------
  const herd = await q(`select a.animal_id, a.animal_code, a.rfid_tag tag, a.animal_type kind, a.gender, a.entry_date, a.dob, a.costing_start_date start, a.is_active, a.book_value cache_bv,
      i.item_code, i.bio_costing_method item_method, i.bio_start_age_weeks start_age_weeks, i.bio_useful_life_months life_months, i.bio_residual_rule, i.bio_residual_weight_kg, i.bio_residual_price_per_kg, b.remarks batch
    from animal_register a join item_master i on i.item_id = a.item_id left join batch_header b on b.batch_id = a.current_batch_id order by a.rfid_tag`);
  const sow = herd.find((a) => a.tag === 'TWO-SOW');
  const boar = herd.find((a) => a.tag === 'TWO-BOAR');
  check('S1', 'the register holds exactly two animals: TWO-SOW and TWO-BOAR, in one batch TWO-BATCH', herd.length === 2 && !!sow && !!boar && sow.batch === 'TWO-BATCH' && boar.batch === 'TWO-BATCH', `${herd.length} animals: ${herd.map((a) => a.tag).join(', ')}`);
  if (!sow || !boar) { report(); await c.end(); process.exit(1); }

  const ledger = (await q(`select l.animal_id, l.entry_type, l.transaction_type, l.document_type, l.posting_date, l.cost_amount amt, l.run_id from bio_asset_ledger l where l.animal_id is not null`))
    .map((l) => ({ ...l, event: bioEventOf(l) }));
  const ledgerOf = (id: string) => ledger.filter((l) => l.animal_id === id);
  const sumTo = (id: string, asOf?: string, types = book) => ledgerOf(id).filter((l) => types.includes(l.event) && (!asOf || d(l.posting_date) <= asOf)).reduce((n, l) => n + num(l.amt), 0);

  // ---- purchase and costing start --------------------------------------------------------------------------------------
  for (const [a, price] of [[sow, 850], [boar, 1200]] as const) {
    const acq = ledgerOf(a.animal_id).filter((l) => l.event === 'ACQUISITION');
    check(`P1 ${a.tag}`, `one ACQUISITION row at the GRN price ${price}`, acq.length === 1 && near(num(acq[0].amt), price), acq.map((l) => l.amt).join(','));
    check(`P2 ${a.tag}`, 'her item carries amortisation terms, so the costing start was dated at registration', a.item_method === 'AMORTIZATION' && !!a.start, `${a.item_code} ${a.item_method} start ${a.start}`);
    const byAge = addDays(d(a.dob), 7 * Number(a.start_age_weeks));
    const expected = byAge > d(a.entry_date) ? byAge : d(a.entry_date);
    check(`P3 ${a.tag}`, 'costing start = later of (birth + start weeks) and the entry date', d(a.start) === expected, `${d(a.start)} expected ${expected}`);
  }
  check('P4', 'the sow starts later than she arrived (25 May, by age); the boar starts on arrival (6 Apr)', d(sow.start) === '2026-05-25' && d(boar.start) === '2026-04-06', `${d(sow.start)} / ${d(boar.start)}`);

  // ---- capitalise before the start, expense from it ----------------------------------------------------------------------
  for (const a of [sow, boar]) {
    const capRows = ledgerOf(a.animal_id).filter((l) => CAP.includes(l.event));
    check(`C1 ${a.tag}`, 'nothing is capitalised on or after her costing start', capRows.every((l) => d(l.posting_date) < d(a.start)), `${capRows.length} capitalised rows`);
    const txs = await q(`select transaction_type t, transaction_date dt, amount from batch_transaction where animal_id = ? and transaction_type in ('CONSUMPTION','OVERHEAD') and reversed_at is null`, [a.animal_id]);
    const before = txs.filter((t) => d(t.dt) < d(a.start)).reduce((n, t) => n + Math.abs(num(t.amount)), 0);
    check(`C2 ${a.tag}`, 'what was capitalised equals the cost of every entry dated before her start', near(before, capRows.reduce((n, l) => n + num(l.amt), 0), 0.002), `before start ${before.toFixed(4)}`);
  }
  const sowCap = ledgerOf(sow.animal_id).filter((l) => CAP.includes(l.event));
  check('C3', 'the sow: 7 Monday feeds (6 Apr - 18 May) and 2 overheads (15 Apr, 15 May) were capitalised; the boar: nothing', sowCap.filter((l) => l.event === 'CONSUMPTION').length === 7 && sowCap.filter((l) => l.event === 'OVERHEAD_COST').length === 2
    && ledgerOf(boar.animal_id).filter((l) => CAP.includes(l.event)).length === 0, `${sowCap.length} sow rows`);
  const mix = await q(`select a.rfid_tag tag, count(l.entry_id) n from batch_transaction t join animal_register a on a.animal_id = t.animal_id left join bio_asset_ledger l on l.animal_id = t.animal_id and l.posting_date = t.transaction_date and l.entry_type = 'CONSUMPTION'
    where t.transaction_date = '2026-05-25' and t.transaction_type = 'CONSUMPTION' group by a.rfid_tag`);
  check('C4', 'the group feed of 25 May (her start day) is split: both animals ate, neither is capitalised', mix.length === 2 && mix.every((m) => Number(m.n) === 0), mix.map((m) => `${m.tag}:${m.n}`).join(' '));
  const glNet = async (code: string) => num((await q(`select coalesce(sum(jl.debit_amount - jl.credit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = ?`, [code]))[0].x);
  const allTx = await q(`select t.transaction_type tt, a.costing_start_date st, t.transaction_date dt, t.amount from batch_transaction t join animal_register a on a.animal_id = t.animal_id where t.transaction_type in ('CONSUMPTION','OVERHEAD') and t.reversed_at is null`);
  const expensedOf = (type: string) => allTx.filter((t) => t.tt === type && d(t.dt) >= d(t.st)).reduce((n, t) => n + Math.abs(num(t.amount)), 0);
  check('C5', 'feed on or after an animal\'s costing start is expensed: account 5080 = those consumption entries', near(await glNet('5080'), expensedOf('CONSUMPTION'), 0.01), `5080 ${(await glNet('5080')).toFixed(4)}, entries ${expensedOf('CONSUMPTION').toFixed(4)}`);
  check('C6', 'overhead on or after the start is expensed: account 5090 = those overhead entries', near(await glNet('5090'), expensedOf('OVERHEAD'), 0.01), `5090 ${(await glNet('5090')).toFixed(4)}, entries ${expensedOf('OVERHEAD').toFixed(4)}`);

  // ---- the runs: every line recomputed ----------------------------------------------------------------------------------
  const lines = await q(`select r.run_no, r.period_key, r.period_end, r.status run_status, r.item_id, r.batch_id, rl.*, a.rfid_tag tag, a.gender
    from bio_costing_run_line rl join bio_costing_run r on r.run_id = rl.run_id join animal_register a on a.animal_id = rl.animal_id order by r.period_end, a.rfid_tag`);
  const posted = lines.filter((l) => l.run_status === 'POSTED');
  const charged = posted.filter((l) => l.status === 'CHARGED');
  const runs = await q(`select * from bio_costing_run order by period_end, run_no`);
  check('R0', '12 posted runs (April to September, one per item) and 11 charged lines (the sow\'s April line is skipped: she has not started)',
    runs.filter((r) => r.status === 'POSTED').length === 12 && charged.length === 11 && posted.filter((l) => l.status === 'SKIPPED').length === 1, `${runs.filter((r) => r.status === 'POSTED').length} posted runs, ${charged.length} charged, ${posted.filter((l) => l.status === 'SKIPPED').length} skipped`);
  let badCharge = 0, badChain = 0, badBook = 0;
  for (const l of charged) {
    const bvb = num(l.book_value_before), res = num(l.residual), days = num(l.days), rem = Number(l.remaining_days), charge = num(l.charge);
    const reachesEnd = near(num(l.book_value_after), res, 0.0002) && near(charge, bvb - res, 0.0002);
    const formula = reachesEnd ? bvb - res : ((bvb - res) * days) / rem;
    if (!near(charge, Math.min(Math.max(0, formula), bvb - res), 0.001)) { badCharge++; console.log(`  charge mismatch ${l.run_no} ${l.tag}: ${charge} vs ${formula}`); }
    if (!near(num(l.book_value_after), bvb - charge, 0.0002)) badChain++;
    const asOf = sumTo(l.animal_id, d(l.period_end));
    if (!near(asOf, num(l.book_value_after), 0.002)) { badBook++; console.log(`  book value mismatch ${l.run_no} ${l.tag}: ledger as of ${d(l.period_end)} = ${asOf.toFixed(4)}, line ${l.book_value_after}`); }
  }
  check('R1', 'every charged line = (book value - residual) x days / remaining days, to 0.001', badCharge === 0, `${badCharge} wrong of ${charged.length}`);
  check('R2', 'book value after = book value before - charge', badChain === 0, `${badChain} wrong`);
  check('R3', 'every line\'s book value after equals her ledger as of the period end', badBook === 0, `${badBook} wrong`);
  const byAnimal = new Map<string, any[]>();
  for (const l of posted) byAnimal.set(l.animal_id, [...(byAnimal.get(l.animal_id) ?? []), l]);
  let gaps = 0;
  for (const [id, ls] of byAnimal) {
    ls.sort((x, y) => d(x.period_end).localeCompare(d(y.period_end)));
    for (let i = 1; i < ls.length; i++) {
      const between = ledgerOf(id).filter((l) => book.includes(l.event) && d(l.posting_date) > d(ls[i - 1].period_end) && d(l.posting_date) < d(ls[i].period_end)).reduce((n, l) => n + num(l.amt), 0);
      const previous = ls[i - 1].status === 'CHARGED' ? num(ls[i - 1].book_value_after) : num(ls[i - 1].book_value_before);
      if (!near(num(ls[i].book_value_before), previous + between, 0.003)) gaps++;
    }
  }
  check('R4', 'months chain: each book value before = the last period\'s after + the cost booked in between', gaps === 0, `${gaps} breaks`);
  const wrongResidual = charged.filter((l) => !near(num(l.residual), l.gender === 'M' ? 0 : 307.5));
  check('R5', 'residual: the sow 150 kg x 2.05 = 307.50 (her item\'s), the boar none', wrongResidual.length === 0, wrongResidual.map((l) => `${l.run_no} ${l.tag} ${l.residual}`).join('; ') || 'as expected');
  const early = charged.filter((l) => d(l.period_end) < d(herd.find((h) => h.animal_id === l.animal_id)!.start));
  const aprSow = posted.find((l) => l.tag === 'TWO-SOW' && l.period_key === '2026-04');
  check('R6', 'nobody is charged before her start: the sow\'s April line is skipped NOT_STARTED', early.length === 0 && aprSow?.status === 'SKIPPED' && aprSow?.skip_reason === 'NOT_STARTED', `${early.length} charged early; sow April ${aprSow?.status}/${aprSow?.skip_reason}`);
  // part-months: 30 x days inside the window / days in the month
  let badPartial = 0;
  for (const a of [sow, boar]) {
    const first = charged.filter((l) => l.animal_id === a.animal_id).sort((x, y) => d(x.period_end).localeCompare(d(y.period_end)))[0];
    if (!first) { badPartial++; continue; }
    const pStart = `${d(first.period_end).slice(0, 8)}01`;
    const windowStart = d(a.start) > pStart ? d(a.start) : pStart;
    const span = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (!near(num(first.days), (30 * span(windowStart, d(first.period_end))) / span(pStart, d(first.period_end)), 0.0006)) badPartial++;
  }
  check('R7', 'each animal\'s first charge is a part-month: 30 x days inside the month after her start / days in the month (boar 25 of 30, sow 7 of 31 = 6.7742)', badPartial === 0, `${badPartial} wrong`);
  const boarApr = posted.find((l) => l.tag === 'TWO-BOAR' && l.period_key === '2026-04');
  check('R8', 'the boar\'s April: 25 days of 30 (6 to 30 April), a charge above zero', !!boarApr && near(num(boarApr.days), 25, 0.001) && num(boarApr.charge) > 0, `${boarApr?.days} days, charge ${boarApr?.charge}`);

  // ---- integrity --------------------------------------------------------------------------------------------------------
  let badRun = 0;
  for (const r of runs.filter((x) => x.status === 'POSTED')) {
    const ledgerSum = num((await q('select coalesce(sum(cost_amount),0) s from bio_asset_ledger where run_id = ? and source_entry_id is null', [r.run_id]))[0].s);
    const journal = r.journal_id ? (await q('select total_debit, total_credit from journal_header where journal_id = ?', [r.journal_id]))[0] : null;
    if (!near(-ledgerSum, num(r.total_charge), TOL) || (num(r.total_charge) > 0 && !(journal && near(num(journal.total_debit), num(r.total_charge), TOL) && near(num(journal.total_credit), num(r.total_charge), TOL)))) { badRun++; console.log(`  run ${r.run_no}: ledger ${ledgerSum}, charge ${r.total_charge}, journal ${journal?.total_debit}`); }
  }
  check('I1', 'every posted run: ledger rows = - total charge = journal debit = journal credit', badRun === 0, `${badRun} wrong`);
  const unbalanced = await q('select count(*) n from journal_header where round(total_debit,2) <> round(total_credit,2)');
  check('I2', 'no journal is unbalanced', Number(unbalanced[0].n) === 0, `${unbalanced[0].n}`);
  const cacheBad = herd.filter((a) => !near(num(a.cache_bv), sumTo(a.animal_id), 0.002));
  check('I3', 'the animal register\'s book value (a cache) equals each animal\'s own ledger', cacheBad.length === 0, cacheBad.map((a) => `${a.tag} ${a.cache_bv} vs ${sumTo(a.animal_id).toFixed(4)}`).join('; ') || 'both animals');
  const belowRes = charged.filter((l) => num(l.book_value_after) < num(l.residual) - TOL);
  check('I4', 'no charge takes an animal below her residual', belowRes.length === 0, `${belowRes.length}`);
  const dup = await q(`select item_id, period_key, batch_id, count(*) n from bio_costing_run where status = 'POSTED' group by 1,2,3 having count(*) > 1`);
  check('I5', 'one posted run per item, period and batch', dup.length === 0, `${dup.length} duplicates`);
  const left = await q(`select count(*) n from bio_costing_run where status <> 'POSTED'`);
  check('I6', 'no calculated or reversed run is left lying about', Number(left[0].n) === 0, `${left[0].n}`);
  const amortAll = -ledger.filter((l) => l.event === 'AMORTIZATION').reduce((n, l) => n + num(l.amt), 0);
  const expense = num((await q(`select coalesce(sum(jl.debit_amount - jl.credit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = '5100'`))[0].x);
  const accum = num((await q(`select coalesce(sum(jl.credit_amount - jl.debit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = '1065'`))[0].x);
  check('I7', 'amortisation expense 5100 = accumulated amortisation 1065 = all amortisation in the ledger', near(expense, amortAll, 0.003) && near(accum, amortAll, 0.003) && amortAll > 0, `5100 ${expense.toFixed(4)}, 1065 ${accum.toFixed(4)}, ledger ${amortAll.toFixed(4)}`);

  report();
  await c.end();
  if (checks.some((x) => !x.pass)) process.exit(1);
}

function report() {
  const failed = checks.filter((x) => !x.pass);
  console.log('\nCOSTING (TWO ANIMALS) - read back from MySQL\n');
  for (const x of checks) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.id.padEnd(9)} ${x.what}${x.detail ? `  [${x.detail}]` : ''}`);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed${failed.length ? `; ${failed.length} FAILED` : ''}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exit(1); });
