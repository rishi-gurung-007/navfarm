/**
 * Reads the frequencies seed (chapter 20-costing-frequencies) back from MySQL and checks it against ITS OWN arithmetic: the quarterly, monthly and yearly periods are
 * the calendar ones, each charge is recomputed from the animal's own dates and ledger under the item's day basis (90-day quarters and a 360-day year against actual
 * days), each journal against its ledger rows, and the scheduler's runs against what it owed. Read-only. Exits 1 when any check fails.
 * (That the auto-post item posted on its own while the others waited is asserted by the chapter itself; it stops with an error otherwise. The first pass is the timer's
 * own tick(); the clock firing it at 02:00 is not exercised.)
 *
 *   pnpm nx run api:db-verify-costing-freq
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
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);
const span = (from: string, to: string) => (ms(to) - ms(from)) / 86_400_000; // days from -> to
const addDays = (date: string, n: number) => new Date(ms(date) + n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

interface Check { id: string; what: string; pass: boolean; detail: string }
const checks: Check[] = [];
const check = (id: string, what: string, pass: boolean, detail = '') => checks.push({ id, what, pass, detail });

const PLAN = [
  { tag: 'Q-SOW', run: 'QUARTERLY', basis: 'FREQUENCY_DAYS', freqDays: 90, life: 36, periods: ['2026-Q1', '2026-Q2', '2026-Q3'], bounds: { '2026-Q1': ['2026-01-01', '2026-03-31'], '2026-Q2': ['2026-04-01', '2026-06-30'], '2026-Q3': ['2026-07-01', '2026-09-30'] } as Record<string, string[]> },
  { tag: 'ACT-BOAR', run: 'MONTHLY', basis: 'ACTUAL', freqDays: 30, life: 18, periods: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'], bounds: {} as Record<string, string[]> },
  { tag: 'Y-GILT', run: 'YEARLY', basis: 'FREQUENCY_DAYS', freqDays: 360, life: 36, periods: ['2025'], bounds: { '2025': ['2025-01-01', '2025-12-31'] } as Record<string, string[]> },
];

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '', database: process.env.DEMO_TENANT_DATABASE || 'nf_devco', dateStrings: true,
  });
  const q = async <T = any>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as T[];

  const herd = await q(`select a.animal_id, a.rfid_tag tag, a.entry_date, a.dob, a.costing_start_date start, a.book_value cache_bv, a.item_id, i.bio_costing_method method, i.bio_run_frequency run,
      i.bio_day_basis basis, i.bio_auto_post auto_post, i.bio_useful_life_months life, i.bio_residual_rule residual_rule
    from animal_register a join item_master i on i.item_id = a.item_id where a.rfid_tag in ('Q-SOW','ACT-BOAR','Y-GILT')`);
  const by = (tag: string) => herd.find((h) => h.tag === tag);
  check('F1', 'three animals, each on her own item: Q-SOW quarterly / frequency days / auto-post off, ACT-BOAR monthly / ACTUAL days / auto-post ON, Y-GILT yearly / frequency days / auto-post off, all amortised with no residual',
    herd.length === 3 && PLAN.every((p) => { const h = by(p.tag); return !!h && h.method === 'AMORTIZATION' && h.run === p.run && h.basis === p.basis && Number(h.life) === p.life && h.residual_rule === 'NONE'; })
      && !Number(by('Q-SOW')?.auto_post) && !!Number(by('ACT-BOAR')?.auto_post) && !Number(by('Y-GILT')?.auto_post), herd.map((h) => `${h.tag} ${h.run}/${h.basis}/auto=${h.auto_post}`).join(' | '));
  if (herd.length !== 3) { report(); await c.end(); process.exit(1); }

  const ledger = (await q(`select l.entry_id, l.animal_id, l.entry_type, l.transaction_type, l.document_type, l.posting_date, l.cost_amount amt, l.run_id, l.source_entry_id from bio_asset_ledger l where l.animal_id is not null`))
    .map((l) => ({ ...l, event: bioEventOf(l) }));
  const bookTo = (id: string, asOf: string, exceptRun?: string) => ledger.filter((l) => l.animal_id === id && book.includes(l.event) && d(l.posting_date) <= asOf && l.run_id !== exceptRun).reduce((n, l) => n + num(l.amt), 0);
  const runs = await q(`select * from bio_costing_run order by period_end, run_no`);
  const lines = await q(`select r.run_no, r.run_id, r.period_key, r.period_start, r.period_end, r.status run_status, r.frequency, r.trigger, rl.*, a.rfid_tag tag from bio_costing_run_line rl join bio_costing_run r on r.run_id = rl.run_id join animal_register a on a.animal_id = rl.animal_id order by r.period_end`);

  for (const p of PLAN) {
    const h = by(p.tag)!;
    const mine = runs.filter((r) => r.item_id === h.item_id);
    const posted = mine.filter((r) => r.status === 'POSTED');
    check(`P1 ${p.tag}`, `the scheduler made exactly the finished periods ${p.periods.join(', ')}, each POSTED, as ${p.run} runs, all by the SCHEDULED trigger`,
      posted.length === p.periods.length && p.periods.every((k) => posted.some((r) => r.period_key === k && r.frequency === p.run && r.trigger === 'SCHEDULED')) && mine.length === posted.length, `${mine.map((r) => `${r.period_key}:${r.status}:${r.trigger}`).join(' ')}`);
    const wrongBounds = posted.filter((r) => { const b = p.bounds[r.period_key]; if (b) return d(r.period_start) !== b[0] || d(r.period_end) !== b[1]; const [y, m] = r.period_key.split('-').map(Number); return d(r.period_start) !== `${y}-${String(m).padStart(2, '0')}-01` || d(r.period_end) !== new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); });
    check(`P2 ${p.tag}`, 'every period is the calendar one (quarter, month or year boundaries)', wrongBounds.length === 0, wrongBounds.map((r) => r.period_key).join(','));
    const future = mine.filter((r) => d(r.period_end) > today());
    check(`P3 ${p.tag}`, 'no run is for a period that has not finished', future.length === 0, future.map((r) => r.period_key).join(','));

    const birth = d(h.dob);
    const lifeEnd = addDays(birth, Math.round((p.life * 365) / 12));
    let bad = 0;
    for (const l of lines.filter((x) => x.tag === p.tag && x.run_status === 'POSTED')) {
      if (l.status !== 'CHARGED') { bad++; console.log(`  ${l.run_no} ${p.tag}: ${l.status}/${l.skip_reason}`); continue; }
      const pStart = d(l.period_start), pEnd = d(l.period_end);
      const wStart = d(h.start) > pStart ? d(h.start) : pStart;
      const lastDay = addDays(lifeEnd, -1);
      const wEnd = pEnd < lastDay ? pEnd : lastDay;
      const windowDays = span(wStart, wEnd) + 1, periodDays = span(pStart, pEnd) + 1, remaining = span(wStart, lifeEnd);
      const days = p.basis === 'ACTUAL' ? windowDays : (p.freqDays * windowDays) / periodDays;
      const bvb = bookTo(l.animal_id, pEnd, l.run_id);
      const charge = wEnd === lastDay ? bvb : (bvb * days) / remaining;
      if (!near(num(l.days), days, 0.0006) || !near(num(l.charge), charge, 0.002) || !near(num(l.book_value_before), bvb, 0.002) || !near(num(l.book_value_after), bvb - charge, 0.002)) {
        bad++; console.log(`  ${l.run_no} ${p.tag} ${l.period_key}: days ${l.days} vs ${days.toFixed(4)}, charge ${l.charge} vs ${charge.toFixed(4)}, before ${l.book_value_before} vs ${bvb.toFixed(4)}`);
      }
    }
    check(`C1 ${p.tag}`, `every line recomputed from her dates and ledger under ${p.basis === 'ACTUAL' ? 'ACTUAL days' : `${p.freqDays}-day ${p.run.toLowerCase()} frequency days`}: days, charge, book value before and after`, bad === 0, `${bad} wrong of ${lines.filter((x) => x.tag === p.tag && x.run_status === 'POSTED').length}`);
  }

  // the basis visibly matters
  const lineOf = (tag: string, key: string) => lines.find((l) => l.tag === tag && l.period_key === key && l.run_status === 'POSTED');
  check('B1', 'frequency days: the quarterly sow\'s full quarters count 90 days, not the 91 and 92 on the calendar', near(num(lineOf('Q-SOW', '2026-Q2')?.days), 90) && near(num(lineOf('Q-SOW', '2026-Q3')?.days), 90), `${lineOf('Q-SOW', '2026-Q2')?.days} / ${lineOf('Q-SOW', '2026-Q3')?.days}`);
  check('B2', 'actual days: the boar\'s 31-day months count 31 (May, July, August) and 30-day months 30 (June, September), where frequency days would say 30 each', near(num(lineOf('ACT-BOAR', '2026-05')?.days), 31) && near(num(lineOf('ACT-BOAR', '2026-07')?.days), 31) && near(num(lineOf('ACT-BOAR', '2026-08')?.days), 31) && near(num(lineOf('ACT-BOAR', '2026-06')?.days), 30) && near(num(lineOf('ACT-BOAR', '2026-09')?.days), 30), ['05', '06', '07', '08', '09'].map((m) => lineOf('ACT-BOAR', `2026-${m}`)?.days).join(' '));
  check('B3', 'the yearly gilt\'s one run counts 360 x 304 / 365 days (3 Mar to 31 Dec 2025)', near(num(lineOf('Y-GILT', '2025')?.days), (360 * 304) / 365, 0.001), `${lineOf('Y-GILT', '2025')?.days}`);
  const q1 = lineOf('Q-SOW', '2026-Q1');
  check('B4', 'the quarterly sow\'s first quarter is a part-period: 5 Jan to 31 Mar = 86 of 90 days', near(num(q1?.days), 86), `${q1?.days}`);

  // the notices (Phase 4): what Finance was told, once each
  const code = async (tag: string) => (await q('select i.item_code c, i.company_id co from animal_register a join item_master i on i.item_id = a.item_id where a.rfid_tag = ?', [tag]))[0];
  const [sowI, boarI, giltI] = [await code('Q-SOW'), await code('ACT-BOAR'), await code('Y-GILT')];
  const alerts = await q(`select title, severity, message, company_id, batch_id, is_read from notification_alert_log where alert_type = 'BIO_COSTING_DUE' order by created_at, title`);
  const expectedTitles: Array<[string, string]> = [
    [`Costing run due: ${sowI.c} 2026-Q1 to 2026-Q3`, 'WARNING'], [`Costing run due: ${giltI.c} 2025`, 'WARNING'], [`Costing run due: ${boarI.c} 2026-04 to 2026-06`, 'INFO'],
    [`Costing run waiting to be posted: ${sowI.c} 2026-Q1`, 'WARNING'], [`Costing run waiting to be posted: ${giltI.c} 2025`, 'WARNING'], [`Costing run due: ${boarI.c} 2026-07 to 2026-09`, 'INFO'],
  ];
  check('N1', 'Finance was told exactly six things, each once: before any run the three items were due (the sow Q1-Q3, the gilt 2025, the boar April-June), and after the first pass the sow\'s and gilt\'s runs waited to be posted and the boar\'s July-September was due',
    alerts.length === 6 && new Set(alerts.map((a) => a.title)).size === 6 && expectedTitles.every(([t]) => alerts.some((a) => a.title === t)), `${alerts.length} notices: ${alerts.map((a) => a.title).join(' | ')}`);
  check('N2', 'severity: a person must act = WARNING (due, or waiting to be posted); the auto-post boar is only INFO', expectedTitles.every(([t, sev]) => alerts.find((a) => a.title === t)?.severity === sev), alerts.map((a) => a.severity).join(','));
  check('N3', 'each notice belongs to the item\'s company, to no batch, is unread, and says where to go (Finance > Bio-Asset Costing Runs)',
    alerts.every((a) => a.company_id === sowI.co && a.batch_id === null && !Number(a.is_read) && String(a.message).includes('Bio-Asset Costing Runs')), `${alerts.filter((a) => a.batch_id === null).length} batchless`);

  // integrity
  let badRun = 0;
  for (const r of runs.filter((x) => x.status === 'POSTED')) {
    const ledgerSum = num((await q('select coalesce(sum(cost_amount),0) s from bio_asset_ledger where run_id = ? and source_entry_id is null', [r.run_id]))[0].s);
    const journal = r.journal_id ? (await q('select total_debit, total_credit from journal_header where journal_id = ?', [r.journal_id]))[0] : null;
    if (!near(-ledgerSum, num(r.total_charge), TOL) || !(journal && near(num(journal.total_debit), num(r.total_charge), TOL) && near(num(journal.total_credit), num(r.total_charge), TOL))) { badRun++; console.log(`  run ${r.run_no}: ledger ${ledgerSum}, charge ${r.total_charge}, journal ${journal?.total_debit}`); }
  }
  check('I1', 'every posted run: ledger rows = - total charge = journal debit = journal credit', badRun === 0, `${badRun} wrong`);
  const unbalanced = await q('select count(*) n from journal_header where round(total_debit,2) <> round(total_credit,2)');
  check('I2', 'no journal is unbalanced', Number(unbalanced[0].n) === 0, `${unbalanced[0].n}`);
  const gl = async (code: string, sign: 1 | -1) => num((await q(`select coalesce(sum(jl.debit_amount - jl.credit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = ?`, [code]))[0].x) * sign;
  const amortAll = -ledger.filter((l) => l.event === 'AMORTIZATION').reduce((n, l) => n + num(l.amt), 0);
  check('I3', 'amortisation expense 5100 = accumulated amortisation 1065 = all amortisation in the ledger', near(await gl('5100', 1), amortAll, 0.003) && near(await gl('1065', -1), amortAll, 0.003) && amortAll > 0, `5100 ${(await gl('5100', 1)).toFixed(4)}, 1065 ${(await gl('1065', -1)).toFixed(4)}, ledger ${amortAll.toFixed(4)}`);
  const cacheBad = herd.filter((h) => !near(num(h.cache_bv), bookTo(h.animal_id, '2099-12-31'), 0.002));
  check('I4', 'the register\'s book value (a cache) equals each animal\'s own ledger', cacheBad.length === 0, cacheBad.map((h) => h.tag).join(',') || 'all three');
  const left = await q(`select count(*) n from bio_costing_run where status <> 'POSTED'`);
  check('I5', 'nothing is left calculated, failed or reversed: the scheduler\'s last pass found nothing due', Number(left[0].n) === 0, `${left[0].n}`);
  const dup = await q(`select item_id, period_key, count(*) n from bio_costing_run where status = 'POSTED' group by 1,2 having count(*) > 1`);
  check('I6', 'one posted run per item and period', dup.length === 0, `${dup.length} duplicates`);

  report();
  await c.end();
  if (checks.some((x) => !x.pass)) process.exit(1);
}

function report() {
  const failed = checks.filter((x) => !x.pass);
  console.log('\nCOSTING (FREQUENCIES, DAY BASIS, AUTO-POST, SCHEDULER) - read back from MySQL\n');
  for (const x of checks) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.id.padEnd(11)} ${x.what}${x.detail ? `  [${x.detail}]` : ''}`);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed${failed.length ? `; ${failed.length} FAILED` : ''}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exit(1); });
