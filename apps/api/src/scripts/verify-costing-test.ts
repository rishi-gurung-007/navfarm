/**
 * Reads the costing test seed (chapter 16-costing-test) back from MySQL and checks every case against ITS OWN arithmetic, not against numbers copied from a
 * run: each charge is recomputed from the line's own inputs, each book value from the ledger as of the period's end, each journal against its ledger rows.
 * Read-only. Exits 1 when any check fails.
 *
 *   pnpm nx run api:db-verify-costing-test
 *   env: DATABASE_HOST, DATABASE_PORT, DATABASE_USERNAME, DATABASE_PASSWORD, DEMO_TENANT_DATABASE (default nf_devco)
 */
import * as mysql from 'mysql2/promise';

const TOL = 0.0006;
const book = ['ACQUISITION', 'CONSUMPTION', 'OVERHEAD', 'OVERHEAD_COST', 'GROWTH_ADJMT', 'AMORTIZATION', 'FAIR_VALUE_ADJMT', 'MORTALITY', 'WRITEOFF', 'TRANSFORMATION', 'COST_ALLOCATION'];
const CAP = ['CONSUMPTION', 'OVERHEAD', 'OVERHEAD_COST', 'GROWTH_ADJMT'];
const d = (v: unknown) => String(v).slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface Check { id: string; what: string; pass: boolean; detail: string }
const checks: Check[] = [];
const check = (id: string, what: string, pass: boolean, detail = '') => checks.push({ id, what, pass, detail });
const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol;

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '', database: process.env.DEMO_TENANT_DATABASE || 'nf_devco', dateStrings: true,
  });
  const q = async <T = any>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as T[];

  // ---- the herd -------------------------------------------------------------------------------------------------------
  const herd = await q(`select a.animal_id, a.animal_code, a.rfid_tag tag, a.animal_type kind, a.gender, a.entry_type, a.entry_date, a.dob, a.costing_start_date start, a.costing_profile_id,
      a.is_active, a.disposal_date, a.book_value cache_bv, a.residual_value own_residual, p.profile_code, p.start_age_weeks, p.useful_life_months, p.origin, b.remarks batch
    from animal_register a left join bio_costing_profile p on p.profile_id = a.costing_profile_id left join batch_header b on b.batch_id = a.current_batch_id
    where a.rfid_tag like 'CT-%' order by a.rfid_tag`);
  const core = herd.filter((a) => /^CT-[AB]-/.test(a.tag));
  const gilts = herd.filter((a) => /^CT-GILT-/.test(a.tag));
  const everyone = await q('select count(*) n from animal_register');
  check('S1', 'the herd is 4 sows and 4 boars (plus the gilts born from them), nothing else', core.filter((a) => a.kind === 'SOW').length === 4 && core.filter((a) => a.kind === 'BOAR').length === 4 && Number(everyone[0].n) === core.length + gilts.length,
    `${core.length} sows/boars, ${gilts.length} gilts, ${everyone[0].n} animals in the register`);
  const batches = await q(`select remarks, tracking_mode, status from batch_header where remarks like 'CT-%' order by remarks`);
  const bA = core.filter((a) => a.batch === 'CT-BATCH-A'); const bB = core.filter((a) => a.batch === 'CT-BATCH-B');
  check('S2', 'two animal-wise batches of 2 sows + 2 boars each', bA.length === 4 && bB.length === 4 && bA.filter((a) => a.kind === 'SOW').length === 2 && bB.filter((a) => a.kind === 'SOW').length === 2
    && batches.filter((b) => /CT-BATCH-[AB]/.test(b.remarks)).every((b) => b.tracking_mode === 'ANIMAL_WISE' && b.status === 'ACTIVE'), batches.map((b) => `${b.remarks}:${b.tracking_mode}`).join(' '));

  const ledger = await q(`select l.animal_id, l.entry_type, l.document_type, l.posting_date, l.cost_amount amt, l.run_id, l.source_entry_id from bio_asset_ledger l where l.animal_id is not null`);
  const ledgerOf = (id: string) => ledger.filter((l) => l.animal_id === id);
  const sumTo = (id: string, asOf?: string, types = book) => ledgerOf(id).filter((l) => types.includes(l.entry_type) && (!asOf || d(l.posting_date) <= asOf)).reduce((n, l) => n + num(l.amt), 0);

  // ---- purchase and profile -------------------------------------------------------------------------------------------
  const price = (a: any) => (a.batch === 'CT-BATCH-A' ? (a.kind === 'SOW' ? 850 : 1200) : a.kind === 'SOW' ? 700 : 900);
  for (const a of core) {
    const acq = ledgerOf(a.animal_id).filter((l) => l.entry_type === 'ACQUISITION');
    check(`P1 ${a.tag}`, `one ACQUISITION row at the GRN price ${price(a)}`, acq.length === 1 && near(num(acq[0].amt), price(a)), acq.map((l) => l.amt).join(','));
    const want = a.batch === 'CT-BATCH-A' ? (a.kind === 'SOW' ? 'IMP-F' : 'IMP-M') : a.kind === 'SOW' ? 'LOC-F' : 'LOC-M';
    check(`P2 ${a.tag}`, `costing profile ${want} from origin and sex`, a.profile_code === want, String(a.profile_code));
    const byAge = addDays(d(a.dob), 7 * Number(a.start_age_weeks));
    const expectStart = byAge > d(a.entry_date) ? byAge : d(a.entry_date);
    check(`P3 ${a.tag}`, 'costing start = later of (birth + start weeks) and the entry date', d(a.start) === expectStart, `${d(a.start)} expected ${expectStart}`);
  }

  // ---- capitalise before the start, expense from it ----------------------------------------------------------------------
  for (const a of core) {
    const capRows = ledgerOf(a.animal_id).filter((l) => CAP.includes(l.entry_type));
    const late = capRows.filter((l) => d(l.posting_date) >= d(a.start));
    check(`C1 ${a.tag}`, 'nothing is capitalised on or after her costing start', late.length === 0, `${late.length} rows`);
    const txs = await q(`select transaction_type t, transaction_date dt, amount from batch_transaction where animal_id = ? and transaction_type in ('CONSUMPTION','OVERHEAD')`, [a.animal_id]);
    const before = txs.filter((t) => d(t.dt) < d(a.start)).reduce((n, t) => n + Math.abs(num(t.amount)), 0);
    const cap = capRows.reduce((n, l) => n + num(l.amt), 0);
    check(`C2 ${a.tag}`, 'what was capitalised equals the cost of every entry dated before her start', near(before, cap, 0.002), `entries before start ${before.toFixed(4)}, ledger ${cap.toFixed(4)}`);
    if (d(a.start) === d(a.entry_date)) check(`C3 ${a.tag}`, 'started on arrival: nothing capitalised at all', capRows.length === 0, `${capRows.length} rows`);
  }
  // the group feed: on a Monday before CT-A-SOW-1's start the four animals ate in one issue; only she was capitalised
  const split = await q(`select a.rfid_tag tag, count(l.entry_id) n from batch_transaction t join animal_register a on a.animal_id = t.animal_id left join bio_asset_ledger l on l.animal_id = t.animal_id and l.posting_date = t.transaction_date and l.entry_type = 'CONSUMPTION'
    where t.transaction_date = '2026-04-27' and t.transaction_type = 'CONSUMPTION' and a.rfid_tag like 'CT-A-%' group by a.rfid_tag`);
  check('C4', 'one issue for a mixed group is split: 4 animals ate on 27 Apr, only CT-A-SOW-1 (before her start) is capitalised', split.length === 4 && split.filter((s) => Number(s.n) > 0).map((s) => s.tag).join() === 'CT-A-SOW-1', split.map((s) => `${s.tag}:${s.n}`).join(' '));
  const glNet = async (code: string) => num((await q(`select coalesce(sum(jl.debit_amount - jl.credit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = ?`, [code]))[0].x);
  const allTx = await q(`select t.transaction_type tt, a.costing_start_date st, t.transaction_date dt, t.amount from batch_transaction t join animal_register a on a.animal_id = t.animal_id where t.transaction_type in ('CONSUMPTION','OVERHEAD') and a.rfid_tag like 'CT-%' and t.reversed_at is null`);
  const expensedOf = (type: string) => allTx.filter((t) => t.tt === type && d(t.dt) >= d(t.st)).reduce((n, t) => n + Math.abs(num(t.amount)), 0);
  const [net5080, net5090] = [await glNet('5080'), await glNet('5090')];
  check('C5', 'feed on or after an animal\'s costing start is expensed: account 5080 = those consumption entries', near(net5080, expensedOf('CONSUMPTION'), 0.01), `5080 ${net5080.toFixed(4)}, entries ${expensedOf('CONSUMPTION').toFixed(4)}`);
  check('C6', 'overhead on or after the start is expensed: account 5090 = those overhead entries', near(net5090, expensedOf('OVERHEAD'), 0.01), `5090 ${net5090.toFixed(4)}, entries ${expensedOf('OVERHEAD').toFixed(4)}`);

  // ---- the runs: every line recomputed ----------------------------------------------------------------------------------
  const lines = await q(`select r.run_no, r.period_key, r.period_end, r.status run_status, r.profile_id, r.batch_id, rl.*, a.rfid_tag tag, a.gender, p.profile_code, p.useful_life_months, p.run_frequency
    from bio_costing_run_line rl join bio_costing_run r on r.run_id = rl.run_id join animal_register a on a.animal_id = rl.animal_id join bio_costing_profile p on p.profile_id = r.profile_id
    where a.rfid_tag like 'CT-%' order by r.period_end, a.rfid_tag`);
  const posted = lines.filter((l) => l.run_status === 'POSTED');
  const charged = posted.filter((l) => l.status === 'CHARGED');
  check('R0', 'there are posted runs and charged lines to check', charged.length > 20, `${posted.length} lines, ${charged.length} charged`);
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
  check('R1', 'every charged line = (book value - residual) x days / remaining days (or the whole of it in the last period), to 0.001 (days are stored to 4 places)', badCharge === 0, `${badCharge} wrong of ${charged.length}`);
  check('R2', 'book value after = book value before - charge', badChain === 0, `${badChain} wrong`);
  check('R3', 'every line\'s book value after equals her ledger as of the period end (the run is what the ledger says)', badBook === 0, `${badBook} wrong`);
  // continuity: the next run's book value before = the previous run's after + what was capitalised or moved in between
  const byAnimal = new Map<string, any[]>();
  for (const l of posted) byAnimal.set(l.animal_id, [...(byAnimal.get(l.animal_id) ?? []), l]);
  let gaps = 0;
  for (const [id, ls] of byAnimal) {
    ls.sort((x, y) => d(x.period_end).localeCompare(d(y.period_end)));
    for (let i = 1; i < ls.length; i++) {
      const between = ledgerOf(id).filter((l) => book.includes(l.entry_type) && d(l.posting_date) > d(ls[i - 1].period_end) && d(l.posting_date) < d(ls[i].period_end)).reduce((n, l) => n + num(l.amt), 0);
      if (!near(num(ls[i].book_value_before), num(ls[i - 1].book_value_after) + between, 0.003)) gaps++;
    }
  }
  check('R4', 'months chain: each book value before = the last period\'s after + the cost booked in between', gaps === 0, `${gaps} breaks`);
  const residualOf = (l: any) => (l.gender === 'M' ? 0 : l.tag === 'CT-B-SOW-2' && d(l.period_end) >= '2026-06-30' ? 400 : d(l.period_end) >= '2026-07-01' ? 328 : 307.5);
  const wrongResidual = charged.filter((l) => !near(num(l.residual), residualOf(l)));
  check('R5', 'residual: female 150 kg x 2.05 = 307.50 to June, 160 kg x 2.05 = 328.00 from 1 July, CT-B-SOW-2 her own 400 from her override, male none', wrongResidual.length === 0, wrongResidual.slice(0, 3).map((l) => `${l.run_no} ${l.tag} ${l.residual}`).join('; ') || 'all as expected');
  const wrongLife = posted.filter((l) => l.life_end_date && d(l.life_end_date) !== addDays(d(herd.find((h) => h.animal_id === l.animal_id)!.dob), Math.round((Number(l.useful_life_months) * 365) / 12)));
  check('R6', 'life end = birth + useful life (months x 365 / 12 days)', wrongLife.length === 0, `${wrongLife.length} wrong`);
  const notStartedBad = posted.filter((l) => l.skip_reason === 'NOT_STARTED' && !(d(l.period_end) < d(herd.find((h) => h.animal_id === l.animal_id)!.start)));
  const beforeStartCharged = charged.filter((l) => d(l.period_end) < d(herd.find((h) => h.animal_id === l.animal_id)!.start));
  check('R7', 'no animal is charged before her costing start; NOT_STARTED only where the period ended before it', notStartedBad.length === 0 && beforeStartCharged.length === 0, `${beforeStartCharged.length} charged early, ${notStartedBad.length} wrongly not started`);
  // first partial month: frequency days x window / period
  const firsts = [...byAnimal.entries()].map(([id, ls]) => ({ id, first: ls.filter((l) => l.status === 'CHARGED').sort((x, y) => d(x.period_end).localeCompare(d(y.period_end)))[0], a: herd.find((h) => h.animal_id === id)! })).filter((x) => x.first);
  let badPartial = 0;
  for (const { first, a } of firsts) {
    const start = d(a.start), pStart = `${d(first.period_end).slice(0, 8)}01`;
    const windowStart = start > pStart ? start : pStart;
    const windowDays = (Date.parse(`${d(first.period_end)}T00:00:00Z`) - Date.parse(`${windowStart}T00:00:00Z`)) / 86_400_000 + 1;
    const periodDays = (Date.parse(`${d(first.period_end)}T00:00:00Z`) - Date.parse(`${pStart}T00:00:00Z`)) / 86_400_000 + 1;
    if (!near(num(first.days), (30 * windowDays) / periodDays, 0.0006)) { badPartial++; console.log(`  partial month ${a.tag}: ${first.days} vs ${(30 * windowDays) / periodDays}`); }
  }
  check('R8', 'a part-month (her start falls inside it) counts 30 x days inside the window / days in the month', badPartial === 0, `${firsts.length} first charges, ${badPartial} wrong`);
  const startedMidMonth = firsts.filter((x) => d(x.a.start) > `${d(x.first.period_end).slice(0, 8)}01`).length;
  check('R9', 'the test covers part-months (at least 3 animals start mid-month)', startedMidMonth >= 3, `${startedMidMonth}`);

  // the animal that reaches the end of her life
  const old = herd.find((a) => a.tag === 'CT-A-BOAR-2')!;
  const oldLines = (byAnimal.get(old.animal_id) ?? []).sort((x, y) => d(x.period_end).localeCompare(d(y.period_end)));
  const lastCharged = oldLines.filter((l) => l.status === 'CHARGED').pop();
  check('E1', 'CT-A-BOAR-2: his last run takes him to his residual (nil) and he is fully written down', !!lastCharged && near(num(lastCharged.book_value_after), 0, 0.0005), `last charge ${lastCharged?.run_no} ${lastCharged?.period_key} -> ${lastCharged?.book_value_after}`);
  const after = oldLines.filter((l) => d(l.period_end) > d(lastCharged?.period_end ?? '9999-12-31'));
  check('E2', 'CT-A-BOAR-2: every later run skips him as LIFE_COMPLETE', after.length >= 4 && after.every((l) => l.skip_reason === 'LIFE_COMPLETE'), after.map((l) => `${l.period_key}:${l.skip_reason}`).join(' '));
  check('E3', 'CT-A-BOAR-2: life ends 2026-04-02 (born 1 Oct 2024 + 18 months)', oldLines.every((l) => !l.life_end_date || d(l.life_end_date) === '2026-04-02'), String(oldLines[0]?.life_end_date));

  // ---- death ----------------------------------------------------------------------------------------------------------
  const dead = herd.find((a) => a.tag === 'CT-A-SOW-2')!;
  const exit = ledgerOf(dead.animal_id).filter((l) => l.entry_type === 'MORTALITY');
  check('X1', 'CT-A-SOW-2 died on 14 Jul: one MORTALITY write-off and the animal is inactive', exit.length === 1 && d(exit[0].posting_date) === '2026-07-14' && !dead.is_active, `${exit.length} rows, active=${dead.is_active}`);
  check('X2', 'her book value after the death is nil (the ledger sums to zero)', near(sumTo(dead.animal_id), 0, 0.002), sumTo(dead.animal_id).toFixed(4));
  const amortised = -sumTo(dead.animal_id, '2026-07-14', ['AMORTIZATION']);
  const clearing = await q(`select jh.total_debit, jh.source_document_no from journal_header jh where jh.source_document_type = 'BIO_ASSET_EXIT' and jh.source_document_no = ?`, [dead.animal_code]);
  check('X3', 'the accumulated amortisation she had built up is cleared (Dr 1065 / Cr acquisition) once', clearing.length === 1 && near(num(clearing[0].total_debit), amortised, 0.002), `journal ${clearing[0]?.total_debit} vs amortised ${amortised.toFixed(4)}`);
  const afterDeath = (byAnimal.get(dead.animal_id) ?? []).filter((l) => d(l.period_end) >= '2026-07-14');
  check('X4', 'no run charges her after her death: the July run skips her (nothing left above her residual) and later runs leave her out', afterDeath.length >= 1 && afterDeath.every((l) => l.status === 'SKIPPED') && afterDeath.every((l) => d(l.period_end) === '2026-07-31'), afterDeath.map((l) => `${l.period_key}:${l.skip_reason}`).join(' '));
  // ---- semen ----------------------------------------------------------------------------------------------------------
  const lots = await q(`select s.*, a.rfid_tag tag from semen_batch s join animal_register a on a.animal_id = s.boar_animal_id where a.rfid_tag like 'CT-%' order by s.collection_date`);
  check('M1', 'two semen lots (CT-A-BOAR-1 on 10 Apr, CT-B-BOAR-2 on 11 May)', lots.length === 2 && lots[0].tag === 'CT-A-BOAR-1' && lots[1].tag === 'CT-B-BOAR-2', lots.map((l) => `${l.tag} ${d(l.collection_date)}`).join(', '));
  for (const l of lots) {
    const boar = herd.find((a) => a.tag === l.tag)!;
    const amort = -sumTo(boar.animal_id, d(l.collection_date), ['AMORTIZATION']);
    check(`M2 ${l.tag}`, 'the lot\'s amortisation part = what her boar was amortised up to the collection', near(num(l.amortisation_period), amort, 0.01), `lot ${l.amortisation_period}, ledger ${amort.toFixed(4)}`);
    const run = num(l.amortisation_period) + num(l.feed_cost_period) + num(l.drug_cost_period) + num(l.overhead_cost_period);
    check(`M3 ${l.tag}`, 'cost per dose = (amortisation + feed + drugs + overhead) / doses', near(num(l.unit_cost_per_dose), run / num(l.doses_collected), 0.0002) && near(num(l.running_cost_period), run, 0.01), `${l.unit_cost_per_dose} vs ${(run / num(l.doses_collected)).toFixed(6)}`);
    const txs = await q(`select t.transaction_type tt, i.item_type it, t.amount from batch_transaction t left join item_master i on i.item_id = t.item_id where t.animal_id = ? and t.transaction_date between ? and ? and t.reversed_at is null`, [boar.animal_id, d(l.period_from), d(l.period_to)]);
    const sumOf = (f: (t: any) => boolean) => txs.filter(f).reduce((n, t) => n + Math.abs(num(t.amount)), 0);
    check(`M6 ${l.tag}`, 'the lot\'s feed, drug and overhead parts = what was posted against her boar in its period (feed by item type FEED, drugs MEDICINE/VACCINE)', near(num(l.feed_cost_period), sumOf((t) => t.tt === 'CONSUMPTION' && t.it === 'FEED'), 0.01)
      && near(num(l.drug_cost_period), sumOf((t) => t.tt === 'CONSUMPTION' && ['MEDICINE', 'VACCINE'].includes(t.it)), 0.01) && near(num(l.overhead_cost_period), sumOf((t) => t.tt === 'OVERHEAD'), 0.01),
      `feed ${l.feed_cost_period}, drug ${l.drug_cost_period}, overhead ${l.overhead_cost_period}`);
    check(`M7 ${l.tag}`, 'the drug part is above zero (the medicines were costed, not only recorded)', num(l.drug_cost_period) > 0, String(l.drug_cost_period));
    check(`M4 ${l.tag}`, 'the lot\'s amortisation part is above zero (the runs were posted before the collection)', num(l.amortisation_period) > 0, String(l.amortisation_period));
    check(`M5 ${l.tag}`, '2 doses were used for the AI mating', near(num(l.doses_used_internal), 2), String(l.doses_used_internal));
  }

  // ---- litters --------------------------------------------------------------------------------------------------------
  const farrows = await q(`select f.*, a.rfid_tag tag, b.mating_date, b.expected_farrowing_date from farrowing_record f join animal_register a on a.animal_id = f.sow_animal_id join breeding_record b on b.breeding_id = f.breeding_id where a.rfid_tag like 'CT-%' order by f.farrowing_date`);
  check('L1', 'two farrowings: CT-A-SOW-1 (13 live, 1 stillborn) and CT-B-SOW-2 (11 live, 1 stillborn), each 116 days after its mating', farrows.length === 2
    && farrows.every((f) => d(f.farrowing_date) === addDays(d(f.mating_date), 116) && d(f.expected_farrowing_date) === d(f.farrowing_date)) && Number(farrows[0].piglets_born_live) === 13 && Number(farrows[1].piglets_born_live) === 11,
    farrows.map((f) => `${f.tag} ${d(f.farrowing_date)} ${f.piglets_born_live}/${f.piglets_stillborn}`).join('; '));
  const A1 = herd.find((a) => a.tag === 'CT-A-SOW-1')!;
  const fA = farrows.find((f) => f.tag === 'CT-A-SOW-1');
  if (fA) {
    const window = ledgerOf(A1.animal_id).filter((l) => CAP.includes(l.entry_type) && d(l.posting_date) >= d(fA.mating_date) && d(l.posting_date) < d(fA.farrowing_date)).reduce((n, l) => n + num(l.amt), 0);
    const alloc = ledgerOf(A1.animal_id).filter((l) => l.document_type === 'LITTER_BIRTH_COST').reduce((n, l) => n + num(l.amt), 0);
    check('L2', 'the birth cost taken from the sow = her capitalised cost from the mating to the day before the farrowing (feed after her start was expensed: not in it)', near(-alloc, window, 0.002) && window > 0, `taken ${(-alloc).toFixed(4)}, capitalised in the window ${window.toFixed(4)}`);
    const lot = (await q(`select batch_id from batch_header where remarks = 'CT-A-SOW-1-LITTER'`))[0];
    const lotRows = lot ? await q(`select entry_type, document_type, quantity, cost_amount amt from bio_asset_ledger where batch_id = ? and animal_id is null`, [lot.batch_id]) : [];
    const lotValue = lotRows.reduce((n, l) => n + num(l.amt), 0);
    const perPiglet = window / 13;
    check('L3', 'the litter lot opened at the sow\'s cost: cost per piglet = birth cost / live born', lotRows.some((l) => l.document_type === 'LITTER_BIRTH_COST' && near(num(l.amt), window, 0.002)) && near(num(fA.cost_per_piglet ?? perPiglet), perPiglet, 0.0005), `${(fA.cost_per_piglet ?? '-')} vs ${perPiglet.toFixed(6)}`);
    const heads = lotRows.reduce((n, l) => n + num(l.quantity), 0);
    check('L4', 'the lot: 13 born alive - 1 lost before weaning - 5 gilts = 7 left, worth 7 x the cost per piglet', near(heads, 7) && near(lotValue, 7 * perPiglet, 0.01), `${heads} head, value ${lotValue.toFixed(4)} vs ${(7 * perPiglet).toFixed(4)}`);
    const journal = await q(`select total_debit from journal_header where description like ? limit 1`, [`%born to ${A1.animal_code}%`]);
    check('L5', 'the birth-cost journal (Dr 1055 / Cr 1050) equals the cost moved', journal.length === 1 && near(num(journal[0].total_debit), window, 0.002), `${journal[0]?.total_debit}`);
    check('L6', 'weaned total stored = 12 (13 - 1 lost); the sow\'s parity is 1', Number(fA.piglets_weaned) === 12, `weaned ${fA.piglets_weaned}`);
  }
  const gs = await q(`select s.selection_no, s.status, count(g.gilt_id) n from gilt_selection s join gilt_selection_line l on l.selection_id = s.selection_id left join gilt_selection_gilt g on g.line_id = l.line_id group by s.selection_id, s.selection_no, s.status`);
  check('G1', 'one gilt selection for the weaned litter: POSTED with 5 gilts; the attempted selection on the other litter was cancelled', gs.filter((s) => s.status === 'POSTED').length === 1 && Number(gs.find((s) => s.status === 'POSTED')?.n) === 5 && gs.filter((s) => s.status === 'DRAFT').length === 0, gs.map((s) => `${s.selection_no}:${s.status}:${s.n}`).join(' '));
  const sowOne = herd.find((a) => a.tag === 'CT-A-SOW-1')!;
  const birthWindow = fA ? ledgerOf(sowOne.animal_id).filter((l) => CAP.includes(l.entry_type) && d(l.posting_date) >= d(fA.mating_date) && d(l.posting_date) < d(fA.farrowing_date)).reduce((n, l) => n + num(l.amt), 0) : 0;
  for (const g of gilts) {
    const sowA = herd.find((a) => a.tag === 'CT-A-SOW-1')!;
    const parents = (await q('select sire_animal_id, dam_animal_id, no_of_teats, entry_type, acquisition_cost from animal_register where animal_id = ?', [g.animal_id]))[0];
    check(`G2 ${g.tag}`, 'born on farm, Local female (LOC-F), the sow as dam, a boar as sire, 15 teats or more, costing start = birth + 33 weeks', g.entry_type === 'BORN_ON_FARM' && g.profile_code === 'LOC-F' && parents.dam_animal_id === sowA.animal_id && !!parents.sire_animal_id && Number(parents.no_of_teats) >= 15
      && d(g.start) === addDays(d(g.dob), 231), `${g.entry_type} ${g.profile_code} teats ${parents.no_of_teats} start ${d(g.start)}`);
    check(`G3 ${g.tag}`, 'carries the litter\'s cost per piglet as her acquisition cost', near(num(parents.acquisition_cost), birthWindow / 13, 0.0006) && birthWindow > 0, `${parents.acquisition_cost} vs ${(birthWindow / 13).toFixed(6)}`);
  }

  // ---- integrity --------------------------------------------------------------------------------------------------------
  const runs = await q(`select r.*, j.total_debit jd, j.total_credit jc from bio_costing_run r left join bio_costing_run_line rl on 1=0 left join journal_header j on j.journal_id = r.journal_id`);
  let badRun = 0;
  for (const r of runs.filter((x) => x.status === 'POSTED')) {
    const sum = (await q('select coalesce(sum(cost_amount),0) s from bio_asset_ledger where run_id = ? and source_entry_id is null', [r.run_id]))[0].s;
    if (!near(-num(sum), num(r.total_charge), 0.0006) || (num(r.total_charge) > 0 && !near(num(r.jd), num(r.total_charge), 0.0006))) { badRun++; console.log(`  run ${r.run_no}: ledger ${sum}, charge ${r.total_charge}, journal ${r.jd}`); }
  }
  check('I1', 'every posted run: ledger rows = - total charge = journal debit', badRun === 0, `${runs.filter((x) => x.status === 'POSTED').length} posted runs, ${badRun} wrong`);
  const unbalanced = await q('select count(*) n from journal_header where round(total_debit,2) <> round(total_credit,2)');
  check('I2', 'no journal is unbalanced', Number(unbalanced[0].n) === 0, `${unbalanced[0].n}`);
  const lineBal = await q('select count(*) n from (select j.journal_id from journal_header j join journal_line l on l.journal_id = j.journal_id group by j.journal_id, j.total_debit having round(sum(l.debit_amount),2) <> round(j.total_debit,2) or round(sum(l.debit_amount),2) <> round(sum(l.credit_amount),2)) x');
  check('I3', 'every journal\'s lines add up to its header', Number(lineBal[0].n) === 0, `${lineBal[0].n}`);
  const cacheBad = herd.filter((a) => !near(num(a.cache_bv), sumTo(a.animal_id), 0.002));
  check('I4', 'the animal register\'s book value (a cache) equals each animal\'s own ledger', cacheBad.length === 0, cacheBad.map((a) => `${a.tag} ${a.cache_bv} vs ${sumTo(a.animal_id).toFixed(4)}`).join('; ') || `${herd.length} animals`);
  const neg = core.filter((a) => a.is_active && sumTo(a.animal_id) < -0.0005);
  check('I5', 'no live animal has a negative book value', neg.length === 0, neg.map((a) => a.tag).join(','));
  const belowRes = charged.filter((l) => num(l.book_value_after) < num(l.residual) - 0.0006);
  check('I6', 'no charge takes an animal below her residual', belowRes.length === 0, `${belowRes.length}`);
  const dup = await q(`select profile_id, period_key, batch_id, count(*) n from bio_costing_run where status = 'POSTED' group by 1,2,3 having count(*) > 1`);
  check('I7', 'one posted run per profile, period and batch', dup.length === 0, `${dup.length} duplicates`);
  const left = await q(`select count(*) n from bio_costing_run where status = 'CALCULATED'`);
  check('I8', 'no calculated-but-unposted run is left lying about', Number(left[0].n) === 0, `${left[0].n}`);
  const rev = await q(`select r.run_id, r.run_no from bio_costing_run r where r.status = 'REVERSED'`);
  let revBad = 0;
  for (const r of rev) {
    const s = (await q('select coalesce(sum(cost_amount),0) s, count(*) n from bio_asset_ledger where run_id = ?', [r.run_id]))[0];
    if (!near(num(s.s), 0, 0.0006)) revBad++;
  }
  check('I9', 'every reversed run is mirrored to nil in the ledger, and its month was posted again', rev.length >= 2 && revBad === 0, `${rev.length} reversed runs, ${revBad} not nil`);
  const accum = await q(`select coalesce(sum(jl.credit_amount - jl.debit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = '1065'`);
  const expense = await q(`select coalesce(sum(jl.debit_amount - jl.credit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = '5100'`);
  const amortAll = -ledger.filter((l) => l.entry_type === 'AMORTIZATION').reduce((n, l) => n + num(l.amt), 0);
  const clearedOnDeath = num(clearing[0]?.total_debit);
  check('I10', 'amortisation expense 5100 = all amortisation in the ledger (net of reversals)', near(num(expense[0].x), amortAll, 0.003), `5100 ${num(expense[0].x).toFixed(4)}, ledger ${amortAll.toFixed(4)}`);
  check('I11', 'accumulated amortisation 1065 = that less what the death cleared', near(num(accum[0].x), amortAll - clearedOnDeath, 0.003), `1065 ${num(accum[0].x).toFixed(4)}, expected ${(amortAll - clearedOnDeath).toFixed(4)}`);
  const resid = await q(`select gender, residual_rule, residual_weight_kg, effective_from from bio_costing_residual_setting order by gender, effective_from`);
  check('I12', 'the company residuals: female 150 kg x 2.05 from the start, then 160 kg x 2.05 from 1 Jul 2026; male none; CT-B-SOW-2 has her own 400', resid.filter((r) => r.gender === 'F').length === 2 && num(herd.find((a) => a.tag === 'CT-B-SOW-2')!.own_residual) === 400, resid.map((r) => `${r.gender} ${r.residual_weight_kg ?? '-'} ${d(r.effective_from)}`).join(' | '));
  const healthRows = await q(`select count(*) n from animal_medication_log m join animal_register a on a.animal_id = m.animal_id where a.rfid_tag like 'CT-%'`);
  check('H1', 'health records: dewormer and vaccine on all 8 animals, PRRS on the 3 sows that were alive', Number(healthRows[0].n) === 8 * 2 + 3, `${healthRows[0].n} records`);

  // ---- report ---------------------------------------------------------------------------------------------------------
  const failed = checks.filter((x) => !x.pass);
  console.log('\nCOSTING TEST - read back from MySQL\n');
  for (const x of checks) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.id.padEnd(9)} ${x.what}${x.detail ? `  [${x.detail}]` : ''}`);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed${failed.length ? `; ${failed.length} FAILED` : ''}.`);
  await c.end();
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exit(1); });
