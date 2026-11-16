/**
 * Reads the fair value costing seed (chapter 19-costing-fair-value) back from MySQL and checks it against ITS OWN arithmetic, not numbers copied from a run: each
 * adjustment is recomputed from the rate in force at the period's end (expected weight x price per kg, less costs to sell) and the animal's own ledger, each
 * journal against its ledger rows and the gain / loss account, and the reversed July run against the rows that undo it. Read-only. Exits 1 when any check fails.
 * (The refusal of a calculation with no rate is proved by the chapter itself, which stops with an error if the calculation is NOT refused.)
 *
 *   pnpm nx run api:db-verify-costing-fv
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
const r4 = (n: number) => Math.round(n * 10000) / 10000;

interface Check { id: string; what: string; pass: boolean; detail: string }
const checks: Check[] = [];
const check = (id: string, what: string, pass: boolean, detail = '') => checks.push({ id, what, pass, detail });

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '', database: process.env.DEMO_TENANT_DATABASE || 'nf_devco', dateStrings: true,
  });
  const q = async <T = any>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as T[];

  // ---- the item, the herd, the rates -------------------------------------------------------------------------------------
  const herd = await q(`select a.animal_id, a.animal_code, a.rfid_tag tag, a.entry_date, a.dob, a.costing_start_date start, a.book_value cache_bv, a.item_id,
      i.item_code, i.bio_costing_method method, i.bio_start_age_weeks start_weeks, i.bio_residual_rule residual_rule, i.bio_acquisition_gl_id acq_gl, i.bio_fv_gain_loss_gl_id fv_gl, i.bio_writeoff_gl_id wo_gl
    from animal_register a join item_master i on i.item_id = a.item_id where a.rfid_tag like 'FV-GILT-%' order by a.rfid_tag`);
  const A = herd.find((h) => h.tag === 'FV-GILT-A');
  const B = herd.find((h) => h.tag === 'FV-GILT-B');
  check('F1', 'two gilts, FV-GILT-A and FV-GILT-B, of one item costed by FAIR_VALUE with no residual and its fair value gain/loss account set',
    herd.length === 2 && !!A && !!B && A.item_id === B.item_id && A.method === 'FAIR_VALUE' && A.residual_rule === 'NONE' && !!A.fv_gl && !!A.acq_gl, `${herd.length} animals, ${A?.item_code} ${A?.method}`);
  if (!A || !B) { report(); await c.end(); process.exit(1); }
  check('F2', 'costing started on arrival (the item starts at week 0): both start on 2026-04-06', herd.every((h) => d(h.start) === '2026-04-06'), herd.map((h) => `${h.tag} ${d(h.start)}`).join(', '));

  const rates = await q(`select * from item_fair_value_rate where item_id = ? order by effective_from`, [A.item_id]);
  const rateOk = rates.length === 2
    && d(rates[0].effective_from) === '2026-04-01' && near(num(rates[0].expected_weight_kg), 120) && near(num(rates[0].price_per_kg), 2.05) && !Number(rates[0].cdm_based) && rates[0].costs_to_sell_pct == null
    && d(rates[1].effective_from) === '2026-07-01' && near(num(rates[1].expected_weight_kg), 150) && near(num(rates[1].price_per_kg), 3.6) && !!Number(rates[1].cdm_based) && near(num(rates[1].costs_to_sell_pct), 5);
  check('F3', 'two dated rates: 1 Apr 120 kg x 2.05 (not CDM), 1 Jul 150 kg x 3.60 with 5% costs to sell (CDM-based), the CDM flag stored as given', rateOk, rates.map((r) => `${d(r.effective_from)} ${r.expected_weight_kg}x${r.price_per_kg} cdm=${r.cdm_based} cts=${r.costs_to_sell_pct}`).join(' | '));
  const fairAt = (periodEnd: string) => {
    const r = [...rates].filter((x) => d(x.effective_from) <= periodEnd).sort((x, y) => d(y.effective_from).localeCompare(d(x.effective_from)))[0];
    return r ? r4(num(r.expected_weight_kg) * num(r.price_per_kg) * (1 - num(r.costs_to_sell_pct) / 100)) : null;
  };
  check('F4', 'fair value in force: 246.00 before July, 513.00 from July (150 x 3.60 less 5%)', fairAt('2026-06-30') === 246 && fairAt('2026-07-31') === 513, `${fairAt('2026-06-30')} / ${fairAt('2026-07-31')}`);

  const ledger = (await q(`select l.entry_id, l.animal_id, l.entry_type, l.transaction_type, l.document_type, l.posting_date, l.cost_amount amt, l.run_id, l.source_entry_id from bio_asset_ledger l where l.animal_id is not null`))
    .map((l) => ({ ...l, event: bioEventOf(l) }));
  const ledgerOf = (id: string) => ledger.filter((l) => l.animal_id === id);
  const bookTo = (id: string, asOf: string, exceptRun?: string) => ledgerOf(id).filter((l) => book.includes(l.event) && d(l.posting_date) <= asOf && l.run_id !== exceptRun).reduce((n, l) => n + num(l.amt), 0);
  for (const [a, price] of [[A, 500], [B, 380]] as const) {
    const acq = ledgerOf(a.animal_id).filter((l) => l.event === 'ACQUISITION');
    check(`P1 ${a.tag}`, `one ACQUISITION row at the GRN price ${price}`, acq.length === 1 && near(num(acq[0].amt), price), acq.map((l) => l.amt).join(','));
  }

  // ---- the runs ----------------------------------------------------------------------------------------------------------
  const runs = await q(`select * from bio_costing_run where item_id = ? order by period_end, run_no`, [A.item_id]);
  const lines = await q(`select r.run_no, r.period_key, r.period_end, r.status run_status, r.run_id, rl.*, a.rfid_tag tag from bio_costing_run_line rl join bio_costing_run r on r.run_id = rl.run_id
    join animal_register a on a.animal_id = rl.animal_id where r.item_id = ? order by r.period_end, a.rfid_tag`, [A.item_id]);
  const live = lines.filter((l) => l.run_status === 'POSTED');
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const postedKeys = runs.filter((r) => r.status === 'POSTED').map((r) => r.period_key);
  check('R0', 'six posted runs, April to September, one per period', months.every((m) => postedKeys.filter((k) => k === m).length === 1) && postedKeys.length === 6, postedKeys.join(','));

  let badAdj = 0, badBook = 0, badFair = 0;
  for (const l of live) {
    const bvb = bookTo(l.animal_id, d(l.period_end), l.run_id);
    const fair = fairAt(d(l.period_end))!;
    if (!near(num(l.book_value_before), bvb, 0.002)) { badBook++; console.log(`  book value before ${l.run_no} ${l.tag}: line ${l.book_value_before}, ledger ${bvb.toFixed(4)}`); }
    if (l.status === 'CHARGED') {
      if (!near(num(l.charge), fair - bvb, 0.002)) { badAdj++; console.log(`  adjustment ${l.run_no} ${l.tag}: ${l.charge} vs ${(fair - bvb).toFixed(4)}`); }
      if (!near(num(l.book_value_after), fair, 0.0002)) badFair++;
    } else if (!(l.skip_reason === 'NO_CHANGE' && near(fair, bvb, 0.002))) { badAdj++; console.log(`  skipped ${l.run_no} ${l.tag}: ${l.skip_reason}, fair ${fair}, book ${bvb.toFixed(4)}`); }
  }
  check('R1', 'every charged line = fair value (weight x price, less costs to sell) - the animal\'s book value before; every skipped line is NO_CHANGE with fair value = book value', badAdj === 0, `${badAdj} wrong of ${live.length}`);
  check('R2', 'every line\'s book value before equals her own ledger as of the period end (without that run)', badBook === 0, `${badBook} wrong`);
  check('R3', 'every charged line leaves her book value exactly at fair value', badFair === 0, `${badFair} wrong`);
  const shape = (month: string, tag: string) => live.find((l) => l.period_key === month && l.tag === tag);
  const expectAdj = (month: string, a: string, b: string, x: number, y: number) => near(num(shape(month, a)?.charge), x, 0.002) && near(num(shape(month, b)?.charge), y, 0.002) && shape(month, a)?.status === 'CHARGED' && shape(month, b)?.status === 'CHARGED';
  check('R4', 'April is a LOSS on both (246 - 500 = -254 and 246 - 380 = -134)', expectAdj('2026-04', 'FV-GILT-A', 'FV-GILT-B', -254, -134), `${shape('2026-04', 'FV-GILT-A')?.charge} / ${shape('2026-04', 'FV-GILT-B')?.charge}`);
  check('R5', 'July is a GAIN on both (513 - 246 = +267)', expectAdj('2026-07', 'FV-GILT-A', 'FV-GILT-B', 267, 267), `${shape('2026-07', 'FV-GILT-A')?.charge} / ${shape('2026-07', 'FV-GILT-B')?.charge}`);
  const quiet = ['2026-05', '2026-06', '2026-08', '2026-09'].flatMap((m) => ['FV-GILT-A', 'FV-GILT-B'].map((t) => shape(m, t)));
  check('R6', 'May, June, August and September change nothing: all eight lines skipped as NO_CHANGE', quiet.length === 8 && quiet.every((l) => l?.status === 'SKIPPED' && l.skip_reason === 'NO_CHANGE'), quiet.map((l) => l?.skip_reason).join(','));

  // ---- journals and ledger -------------------------------------------------------------------------------------------------
  let badRun = 0;
  for (const r of runs.filter((x) => x.status === 'POSTED')) {
    const ledgerSum = num((await q('select coalesce(sum(cost_amount),0) s from bio_asset_ledger where run_id = ? and source_entry_id is null', [r.run_id]))[0].s);
    const ls = live.filter((l) => l.run_id === r.run_id && l.status === 'CHARGED');
    const gain = ls.filter((l) => num(l.charge) > 0).reduce((n, l) => n + num(l.charge), 0);
    const loss = ls.filter((l) => num(l.charge) < 0).reduce((n, l) => n - num(l.charge), 0);
    let ok = near(ledgerSum, num(r.total_charge), TOL);
    if (ls.length) {
      const jl = await q(`select g.account_code code, coalesce(sum(jl.debit_amount),0) dr, coalesce(sum(jl.credit_amount),0) cr from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where jl.journal_id = ? group by g.account_code`, [r.journal_id]);
      const at = (code: string) => jl.find((x) => x.code === code) ?? { dr: 0, cr: 0 };
      // a gain: Dr acquisition 1060 / Cr gain-loss 4020; a loss: Dr 4020 / Cr 1060
      ok = ok && near(num(at('1060').dr), gain) && near(num(at('1060').cr), loss) && near(num(at('4020').cr), gain) && near(num(at('4020').dr), loss);
    } else ok = ok && !r.journal_id;
    if (!ok) { badRun++; console.log(`  run ${r.run_no} ${r.period_key}: ledger ${ledgerSum}, charge ${r.total_charge}, gain ${gain}, loss ${loss}`); }
  }
  check('J1', 'every posted run: ledger rows = total charge; the journal debits 1060 / credits 4020 by the gains and the reverse by the losses; a run with no change has no journal', badRun === 0, `${badRun} wrong`);
  const unbalanced = await q('select count(*) n from journal_header where round(total_debit,2) <> round(total_credit,2)');
  check('J2', 'no journal is unbalanced', Number(unbalanced[0].n) === 0, `${unbalanced[0].n}`);
  const fvLedger = ledger.filter((l) => l.event === 'FAIR_VALUE' || (l.run_id && !l.source_entry_id)).filter((l) => l.run_id);
  const net4020 = num((await q(`select coalesce(sum(jl.credit_amount - jl.debit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = '4020'`))[0].x);
  const ledgerNet = ledger.filter((l) => l.run_id).reduce((n, l) => n + num(l.amt), 0);
  check('J3', 'net fair value gain/loss account 4020 (credit) = all fair value adjustments in the ledger, reversals included (+267 x 2 - 254 - 134 = 146)', near(net4020, ledgerNet, 0.003) && near(ledgerNet, 146, 0.003), `4020 ${net4020.toFixed(4)}, ledger ${ledgerNet.toFixed(4)} (${fvLedger.length} rows)`);

  // ---- the reversed July run --------------------------------------------------------------------------------------------------
  const reversed = runs.filter((r) => r.status === 'REVERSED');
  const julyReversed = reversed.filter((r) => r.period_key === '2026-07');
  check('V1', 'one July run was REVERSED, with its reason, and a new July run is POSTED in its place', julyReversed.length === 1 && !!julyReversed[0].reverse_reason && postedKeys.includes('2026-07'), `${reversed.map((r) => `${r.run_no} ${r.period_key}`).join(', ')}`);
  if (julyReversed[0]) {
    const own = ledger.filter((l) => l.run_id === julyReversed[0].run_id);
    const originals = own.filter((l) => !l.source_entry_id);
    const undone = originals.every((o) => own.some((u) => u.source_entry_id === o.entry_id && near(num(u.amt), -num(o.amt))));
    check('V2', 'the reversed run\'s ledger rows are each undone by an exactly opposite row, so it nets to nothing', originals.length === 2 && undone && near(own.reduce((n, l) => n + num(l.amt), 0), 0), `${originals.length} rows, net ${own.reduce((n, l) => n + num(l.amt), 0)}`);
    const jnet = await q(`select coalesce(sum(jl.debit_amount - jl.credit_amount),0) x from journal_line jl join journal_header jh on jh.journal_id = jl.journal_id join gl_account_master g on g.gl_account_id = jl.gl_account_id
      where g.account_code in ('1060','4020') and jh.source_document_no = ?`, [julyReversed[0].run_no]);
    check('V3', 'the reversed run\'s journals (the run and its reversal) net to nothing on 1060 and 4020', near(num(jnet[0].x), 0, TOL), `${jnet[0].x}`);
  }

  // ---- the end state -----------------------------------------------------------------------------------------------------------
  for (const a of [A, B]) {
    check(`E1 ${a.tag}`, 'her book value is 513.00 (fair value): ledger and the register\'s cache agree', near(bookTo(a.animal_id, '2026-09-30'), 513, 0.002) && near(num(a.cache_bv), 513, 0.002), `ledger ${bookTo(a.animal_id, '2026-09-30').toFixed(4)}, cache ${a.cache_bv}`);
  }
  const left = await q(`select count(*) n from bio_costing_run where status = 'CALCULATED' or status = 'FAILED'`);
  check('E2', 'no calculated or failed run is left lying about', Number(left[0].n) === 0, `${left[0].n}`);
  const others = await q(`select count(*) n from bio_costing_run where item_id <> ?`, [A.item_id]);
  check('E3', 'no other item was costed (this seed costs fair value only)', Number(others[0].n) === 0, `${others[0].n}`);

  report();
  await c.end();
  if (checks.some((x) => !x.pass)) process.exit(1);
}

function report() {
  const failed = checks.filter((x) => !x.pass);
  console.log('\nCOSTING (FAIR VALUE) - read back from MySQL\n');
  for (const x of checks) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.id.padEnd(9)} ${x.what}${x.detail ? `  [${x.detail}]` : ''}`);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed${failed.length ? `; ${failed.length} FAILED` : ''}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exit(1); });
