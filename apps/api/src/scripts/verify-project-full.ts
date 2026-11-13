/**
 * Reads the whole-project seed (chapters 02c-project-items and 22-project-full) back from MySQL and checks it against ITS OWN arithmetic, never against numbers copied
 * from a run: the herd and its items against the Fixed Asset sheet, each animal's costing start from her birth date, what was capitalised against the entries dated
 * before her start (and nothing after it), every amortisation line recomputed from the engine's rule (30 frequency days of the part of the month inside her window,
 * book value less the residual over the days left, the last period taking the rest), every fair value line from the rate in force, each journal against its ledger rows
 * and the item's accounts, the two parities of every sow (dates, semen, pregnancy checks, parity count), the semen lots, each litter's cost at birth from the
 * sow's own capitalised rows, and the gilts. Prints the FACTS block the explanation is written from. Read-only. Exits 1 when any check fails.
 *
 *   pnpm nx run api:db-verify-project-full
 *   env: DATABASE_HOST, DATABASE_PORT, DATABASE_USERNAME, DATABASE_PASSWORD, DEMO_TENANT_DATABASE (default nf_devco)
 */
import * as mysql from 'mysql2/promise';
import { BOOK_VALUE_EVENTS } from '../modules/inventory/bio-asset-ledger/animal-book-value.service';
import { bioEventOf } from '../modules/inventory/bio-asset-ledger/bio-asset-ledger.types';
import { buildHerd, cyclesOf, dobOf, addDays, GILT_TAGS, PROJECT_COSTING_FROM, PROJECT_EXITS } from './demo/chapters/22-project-full';
import { DUMMY_COA, ITEM_ACCOUNTS } from './project-coa.lib';

const TOL = 0.0006;
const book: string[] = [...BOOK_VALUE_EVENTS];
const d = (v: unknown) => String(v).slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

interface Check { id: string; what: string; pass: boolean; detail: string }
const checks: Check[] = [];
const check = (id: string, what: string, pass: boolean, detail = '') => checks.push({ id, what, pass, detail });

function report() {
  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(8)} ${c.what}${c.detail && !c.pass ? `\n          ${c.detail}` : ''}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? `; ${failed.length} FAILED: ${failed.map((c) => c.id).join(', ')}` : ''}`);
  return failed.length;
}

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '', database: process.env.DEMO_TENANT_DATABASE || 'nf_devco', dateStrings: true,
  });
  const q = async <T = any>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as T[];
  const herd = buildHerd();

  // ---- the herd and its items --------------------------------------------------------------------------------------------
  const animals = await q(`select a.animal_id, a.animal_code, a.rfid_tag tag, a.animal_type, a.gender, a.dob, a.entry_date, a.entry_type, a.costing_start_date start, a.parity_count, a.book_value cache_bv,
      a.current_batch_id, i.item_id, i.item_code, i.bio_costing_method method, i.bio_start_age_weeks start_weeks, i.bio_useful_life_months life, i.bio_residual_rule rrule,
      i.bio_residual_weight_kg rw, i.bio_residual_price_per_kg rp, i.bio_acquisition_gl_id acq_gl, i.bio_accum_amort_gl_id accum_gl, i.bio_amort_expense_gl_id amort_gl, i.bio_fv_gain_loss_gl_id fv_gl
    from animal_register a join item_master i on i.item_id = a.item_id where a.rfid_tag like 'PF-SOW-%' or a.rfid_tag like 'PF-BOAR-%' order by a.rfid_tag`);
  const by = new Map(animals.map((a) => [a.tag as string, a]));
  check('H1', '20 animals: 14 sows (7 imported amortised, 7 local fair value) and 6 boars (3 imported, 3 local), each of the sheet\'s items as planned',
    animals.length === 20 && animals.filter((a) => a.animal_type === 'SOW').length === 14 && animals.filter((a) => a.animal_type === 'BOAR').length === 6
    && herd.every((h) => by.get(h.tag)?.item_code?.toLowerCase() === h.item.toLowerCase() && by.get(h.tag)?.method === (h.origin === 'IMPORTED' ? 'AMORTIZATION' : 'FAIR_VALUE')),
    `${animals.length} animals`);
  check('H2', 'item terms are the sheet\'s: females start week 33, life 36 months, residual 150 kg x 2.05 on imported only; males week 26, 18 months, none',
    animals.every((a) => (a.gender === 'F' ? a.start_weeks === 33 && a.life === 36 : a.start_weeks === 26 && a.life === 18)
      && (a.method === 'AMORTIZATION' && a.gender === 'F' ? a.rrule === 'WEIGHT_X_PRICE' && near(num(a.rw), 150) && near(num(a.rp), 2.05) : a.rrule === 'NONE')),
    animals.map((a) => `${a.tag}:${a.item_code}`).join(' '));
  check('H3', 'every item has its acquisition account, and the amortised ones the expense and accumulated accounts, the fair value ones the gain/loss account',
    animals.every((a) => !!a.acq_gl && (a.method === 'AMORTIZATION' ? !!a.amort_gl && !!a.accum_gl : !!a.fv_gl)), '');

  // ---- the chart of accounts (NAVFarm_Dummy_COA.xlsx; project-coa.lib.ts) -------------------------------------------------------------------
  const chart = await q(`select account_code code, account_name name from gl_account_master where deleted_at is null`);
  const notInChart = DUMMY_COA.filter((a) => !chart.some((x) => x.code === a.code && x.name === a.name)).map((a) => a.code);
  check('K1', 'the chart holds the 32 accounts of NAVFarm_Dummy_COA.xlsx under their own codes and names', notInChart.length === 0, notInChart.length ? notInChart.join(' ') : `${DUMMY_COA.length} of ${DUMMY_COA.length}`);
  const codeOf = (col: string) => `(select account_code from gl_account_master g where g.gl_account_id = i.${col})`;
  const itemGl = await q(`select i.item_code, ${codeOf('bio_acquisition_gl_id')} acquisition, ${codeOf('bio_accum_amort_gl_id')} accumulated, ${codeOf('bio_amort_expense_gl_id')} amortisation,
     ${codeOf('bio_fv_gain_loss_gl_id')} fv_gain, ${codeOf('bio_fv_loss_gl_id')} fv_loss, ${codeOf('bio_writeoff_gl_id')} writeoff from item_master i where i.deleted_at is null`);
  const wrongItems = Object.entries(ITEM_ACCOUNTS).filter(([code, acc]) => {
    const row = itemGl.find((r) => String(r.item_code).toLowerCase() === code.toLowerCase());
    return !row || (['acquisition', 'accumulated', 'amortisation', 'fv_gain', 'fv_loss', 'writeoff'] as const).some((k) => (row[k] ?? undefined) !== (acc[k] ?? undefined));
  }).map(([code]) => code);
  check('K2', 'every item posts to its own accounts of that chart (acquisition, accumulated amortisation and expense; fair value gain and loss; write-off)', wrongItems.length === 0, wrongItems.join(' '));
  const fourDigit = await q(`select g.account_code code, count(*) n from journal_line l join gl_account_master g on g.gl_account_id = l.gl_account_id where length(g.account_code) < 6 group by g.account_code`);
  check('K3', 'no journal line is posted to an account outside the 6-digit chart (the starter chart was renumbered into it)', fourDigit.length === 0, fourDigit.map((x) => `${x.code}:${x.n}`).join(' '));
  // The GL holds what the ledger holds: each item's acquisition less its accumulated amortisation = its animals' book values; Weaners Inventory = the cost
  // the litters still hold (born in, less gilts taken out and piglets that died).
  const recon = await q(`select i.item_code,
      (select coalesce(sum(jl.debit_amount - jl.credit_amount), 0) from journal_line jl where jl.gl_account_id = i.bio_acquisition_gl_id)
        - (select coalesce(sum(jl.credit_amount - jl.debit_amount), 0) from journal_line jl where jl.gl_account_id = i.bio_accum_amort_gl_id) gl,
      (select coalesce(sum(l.cost_amount), 0) from bio_asset_ledger l join animal_register a on a.animal_id = l.animal_id where a.item_id = i.item_id) ledger
    from item_master i where i.bio_costing_method is not null and exists (select 1 from animal_register a where a.item_id = i.item_id)`);
  const offItems = recon.filter((r) => !near(num(r.gl), num(r.ledger), 0.01));
  check('K4', 'each item\'s GL (acquisition less accumulated amortisation) = its animals\' book values in the ledger: overhead, feed, semen, litter cost, amortisation, fair value and exits all on her own accounts',
    offItems.length === 0, offItems.length ? offItems.map((r) => `${r.item_code} GL ${r2(num(r.gl))} vs ledger ${r2(num(r.ledger))}`).join(', ') : `${recon.length} items`);
  const [weaners] = await q(`select coalesce(sum(jl.debit_amount - jl.credit_amount), 0) gl from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id where g.account_code = '170400'`);
  const [litters] = await q(`select coalesce(sum(l.cost_amount), 0) held from bio_asset_ledger l where l.batch_id in (select piglet_batch_id from farrowing_record where piglet_batch_id is not null)
     and l.animal_id is null and l.document_type <> 'LITTER_BIRTH_COST'`);
  const [born] = await q(`select coalesce(sum(l.cost_amount), 0) x from bio_asset_ledger l where l.document_type = 'LITTER_BIRTH_COST' and l.batch_id in (select piglet_batch_id from farrowing_record where piglet_batch_id is not null)`);
  const held = num(born.x) + num(litters.held);
  check('K5', 'Weaners Inventory (170400) = the cost the litters still hold: what their births brought in, less the gilts taken from them and the piglets that died', near(num(weaners.gl), held, 0.01), `GL ${r2(num(weaners.gl))} vs litters ${r2(held)}`);
  check('H4', 'birth dates from the purchase (females 20 weeks old, boars 22) and costing start = birth + the item\'s start weeks (females 7 Apr 2025, boars 3 Feb 2025)',
    herd.every((h) => { const a = by.get(h.tag); return !!a && d(a.dob) === dobOf(h) && d(a.start) === addDays(dobOf(h), 7 * a.start_weeks); }), '');

  const rates = await q(`select r.*, i.item_code from item_fair_value_rate r join item_master i on i.item_id = r.item_id where i.item_code in ('GP-LOC-F','P-LOC-F','GP-LOC-M','P-LOC-M') order by r.item_id, r.effective_from`);
  check('H5', 'each of the four local items has two dated rates: 150 kg x 2.05 from 1 Jan 2025 (the sheet) and 150 kg x 2.35 from 1 Jan 2026 (ours)',
    ['GP-LOC-F', 'P-LOC-F', 'GP-LOC-M', 'P-LOC-M'].every((code) => { const r = rates.filter((x) => x.item_code === code); return r.length === 2 && d(r[0].effective_from) === PROJECT_COSTING_FROM && near(num(r[0].price_per_kg), 2.05) && near(num(r[1].price_per_kg), 2.35) && d(r[1].effective_from) === '2026-01-01'; }), '');
  const fairAt = (itemId: string, periodEnd: string) => {
    const r = rates.filter((x) => x.item_id === itemId && d(x.effective_from) <= periodEnd).sort((x, y) => d(y.effective_from).localeCompare(d(x.effective_from)))[0];
    return r ? r4(num(r.expected_weight_kg) * num(r.price_per_kg) * (1 - num(r.costs_to_sell_pct) / 100)) : null;
  };

  // ---- the receipt and the ledger --------------------------------------------------------------------------------------------
  const grn = await q(`select r.status, count(l.line_id) n_lines, coalesce(sum(l.quantity),0) qty from goods_receipt r join goods_receipt_line l on l.receipt_id = r.receipt_id where r.external_reference_no = 'PROJECT-FULL-GRN-ANIMALS' group by r.status`);
  check('G1', 'one goods receipt of the 20 animals is POSTED (a line per item, a serial for every head)', grn.length === 1 && grn[0].status === 'POSTED' && num(grn[0].qty) === 20, JSON.stringify(grn));
  const ids = animals.map((a) => a.animal_id);
  const ledger = (await q(`select l.entry_id, l.animal_id, l.batch_id, l.entry_type, l.transaction_type, l.document_type, l.posting_date, l.cost_amount amt, l.run_id, l.source_entry_id, l.lot_no
      from bio_asset_ledger l where l.animal_id in (${ids.map(() => '?').join(',')})`, ids)).map((l) => ({ ...l, event: bioEventOf(l) }));
  const ledgerOf = (id: string) => ledger.filter((l) => l.animal_id === id);
  const bookTo = (id: string, asOf: string, exceptRun?: string) => ledgerOf(id).filter((l) => book.includes(l.event) && d(l.posting_date) <= asOf && l.run_id !== exceptRun).reduce((n, l) => n + num(l.amt), 0);
  check('G2', 'each animal has one ACQUISITION row at the receipt price (imported 850 / 1,200, local 520 / 700)',
    herd.every((h) => { const a = by.get(h.tag)!; const acq = ledgerOf(a.animal_id).filter((l) => l.event === 'ACQUISITION'); return acq.length === 1 && near(num(acq[0].amt), h.price); }), '');

  // ---- capitalised before the start, expensed from it ---------------------------------------------------------------------------
  const tx = await q(`select t.animal_id, t.transaction_date, t.transaction_type, t.amount from batch_transaction t where t.animal_id in (${ids.map(() => '?').join(',')}) and t.transaction_type in ('CONSUMPTION','OVERHEAD')`, ids);
  let capAfter = 0; let capMismatch = 0; let expensedRows = 0;
  for (const a of animals) {
    const cap = ledgerOf(a.animal_id).filter((l) => ['CONSUMPTION', 'OVERHEAD_COST'].includes(l.event) && ['BATCH', 'BATCH_OVERHEAD', 'BREEDING_SEMEN'].includes(l.document_type) && !l.source_entry_id);
    capAfter += cap.filter((l) => d(l.posting_date) >= d(a.start)).length;
    const before = tx.filter((t) => t.animal_id === a.animal_id && d(t.transaction_date) < d(a.start)).reduce((n, t) => n + Math.abs(num(t.amount)), 0);
    if (!near(cap.reduce((n, l) => n + num(l.amt), 0), before, 0.01)) { capMismatch++; console.log(`  ${a.tag}: capitalised ${cap.reduce((n, l) => n + num(l.amt), 0).toFixed(4)} vs entries before her start ${before.toFixed(4)}`); }
    expensedRows += tx.filter((t) => t.animal_id === a.animal_id && d(t.transaction_date) >= d(a.start)).length;
  }
  check('C1', 'no feed, overhead or semen dated on or after an animal\'s costing start is capitalised into her', capAfter === 0, `${capAfter} rows`);
  check('C2', 'what is capitalised into each animal (feed, overhead, semen) equals her entries dated before her start, to the cent (the rest is expensed)', capMismatch === 0 && expensedRows > 0, `${capMismatch} differ, ${expensedRows} expensed entries`);

  // ---- the runs ----------------------------------------------------------------------------------------------------------------
  const lines = await q(`select r.run_no, r.period_key, r.period_start, r.period_end, r.status run_status, r.run_id, r.method, r.total_charge, r.journal_id, r.item_id run_item, rl.*, a.rfid_tag tag
      from bio_costing_run_line rl join bio_costing_run r on r.run_id = rl.run_id join animal_register a on a.animal_id = rl.animal_id where r.status = 'POSTED' order by r.period_end, a.rfid_tag`);
  const mine = lines.filter((l) => by.has(l.tag));
  const postedRuns = await q(`select * from bio_costing_run where status = 'POSTED' order by period_end`);
  const months = new Set(postedRuns.map((r) => r.period_key));
  check('R0', 'a run was posted for each of the 21 months Jan 2025 - Sep 2026 (per batch and item), none failed', [...Array(21)].every((_, i) => { const m = `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; return months.has(m); }) && !(await q(`select 1 from bio_costing_run where status = 'FAILED' limit 1`)).length, [...months].join(','));

  let badAmort = 0; let badBook = 0; let amortLines = 0; let badFv = 0; let fvLines = 0;
  for (const l of mine) {
    const a = by.get(l.tag)!;
    const bvb = bookTo(a.animal_id, d(l.period_end), l.run_id);
    if (!near(num(l.book_value_before), bvb, 0.002)) { badBook++; console.log(`  book before ${l.run_no} ${l.tag}: line ${l.book_value_before}, ledger ${bvb.toFixed(4)}`); }
    if (a.method === 'AMORTIZATION') {
      amortLines++;
      const lifeEnd = addDays(d(a.dob), Math.round((a.life * 365) / 12));
      const periodStart = d(l.period_start); const periodEnd = d(l.period_end);
      const residual = a.rrule === 'WEIGHT_X_PRICE' ? num(a.rw) * num(a.rp) : 0;
      let expectCharge = 0; let expectStatus = 'SKIPPED';
      if (periodEnd >= d(a.start) && periodStart < lifeEnd && bvb - residual > 0.005) {
        const winStart = d(a.start) > periodStart ? d(a.start) : periodStart;
        const lastDay = addDays(lifeEnd, -1); const winEnd = periodEnd < lastDay ? periodEnd : lastDay;
        const frequencyDays = (days(winStart, winEnd) + 1) * 30 / (days(periodStart, periodEnd) + 1);
        const remaining = days(winStart, lifeEnd);
        const raw = winEnd === lastDay ? bvb - residual : ((bvb - residual) * frequencyDays) / remaining;
        expectCharge = r4(Math.min(Math.max(0, raw), bvb - residual)); expectStatus = 'CHARGED';
      }
      if (l.status !== expectStatus || (expectStatus === 'CHARGED' && !near(num(l.charge), expectCharge, 0.002))) { badAmort++; console.log(`  amortisation ${l.run_no} ${l.tag}: ${l.status} ${l.charge}, expected ${expectStatus} ${expectCharge}`); }
    } else {
      fvLines++;
      const fair = fairAt(a.item_id, d(l.period_end));
      const started = d(l.period_end) >= d(a.start);
      const adj = fair === null ? 0 : r4(fair - bvb);
      const expectStatus = started && fair !== null && Math.abs(adj) >= 0.005 ? 'CHARGED' : 'SKIPPED';
      if (l.status !== expectStatus || (expectStatus === 'CHARGED' && !near(num(l.charge), adj, 0.002))) { badFv++; console.log(`  fair value ${l.run_no} ${l.tag}: ${l.status} ${l.charge}, expected ${expectStatus} ${adj}`); }
    }
  }
  check('R1', `every amortisation line (${amortLines}) = the engine's rule recomputed from the animal's dates and her own ledger: frequency days, (book value - residual) / days left, last period takes the rest`, badAmort === 0 && amortLines > 100, `${badAmort} wrong`);
  check('R2', `every fair value line (${fvLines}) = fair value at the period end (rate by date) - book value before; no change is skipped`, badFv === 0 && fvLines > 100, `${badFv} wrong`);
  check('R3', 'every line\'s book value before equals the animal\'s own ledger as of the period end, without that run', badBook === 0, `${badBook} wrong`);
  const starts = mine.filter((l) => l.status === 'CHARGED').reduce((m, l) => m.set(l.tag, m.get(l.tag) ?? d(l.period_end)), new Map<string, string>());
  check('R4', 'no animal is charged before her costing start (the first charge falls in the month of her start)',
    animals.every((a) => { const first = starts.get(a.tag); return !!first && first.slice(0, 7) === d(a.start).slice(0, 7); }), [...starts].map(([t, x]) => `${t}:${x}`).join(' '));

  // ---- journals ----------------------------------------------------------------------------------------------------------------------
  let badRun = 0;
  // A run posted before db-apply-sheet-accounts moved its item's accumulated amortisation off the shared 1065 credited 1065; history keeps that account.
  const shared1065 = (await q(`select gl_account_id g from gl_account_master where account_code = '1065'`))[0]?.g as string | undefined;
  const movedItems = new Set((await q(`select i.item_id from journal_header j join item_master i on lower(i.item_code) = lower(j.source_document_no) where j.source_document_type = 'GL_RECLASS'`)).map((x) => x.item_id as string));
  for (const r of postedRuns) {
    const ledgerSum = num((await q('select coalesce(sum(cost_amount),0) s from bio_asset_ledger where run_id = ? and source_entry_id is null', [r.run_id]))[0].s);
    const ls = lines.filter((l) => l.run_id === r.run_id && l.status === 'CHARGED');
    const item = (await q('select bio_acquisition_gl_id acq, bio_amort_expense_gl_id amort, bio_accum_amort_gl_id accum, bio_fv_gain_loss_gl_id fv, coalesce(bio_fv_loss_gl_id, bio_fv_gain_loss_gl_id) fv_loss from item_master where item_id = ?', [r.item_id]))[0];
    let ok = near(ledgerSum, r.method === 'AMORTIZATION' ? -num(r.total_charge) : num(r.total_charge), TOL);
    if (ls.length && r.journal_id) {
      const jl = await q('select gl_account_id g, coalesce(sum(debit_amount),0) dr, coalesce(sum(credit_amount),0) cr from journal_line where journal_id = ? group by gl_account_id', [r.journal_id]);
      const at = (g: string) => jl.find((x) => x.g === g) ?? { dr: 0, cr: 0 };
      if (r.method === 'AMORTIZATION') {
        const t = ls.reduce((n, l) => n + num(l.charge), 0);
        const credited = num(at(item.accum).cr) + (movedItems.has(r.item_id) && shared1065 && shared1065 !== item.accum ? num(at(shared1065).cr) : 0);
        ok = ok && near(num(at(item.amort).dr), t, 0.002) && near(credited, t, 0.002);
      }
      else {
        const gain = ls.filter((l) => num(l.charge) > 0).reduce((n, l) => n + num(l.charge), 0); const loss = ls.filter((l) => num(l.charge) < 0).reduce((n, l) => n - num(l.charge), 0);
        // a gain is credited to the item's gain account, a loss debited to its loss account (the same one where the item names no loss account)
        ok = ok && near(num(at(item.acq).dr), gain, 0.002) && near(num(at(item.acq).cr), loss, 0.002) && near(num(at(item.fv).cr), gain, 0.002) && near(num(at(item.fv_loss).dr), loss, 0.002);
      }
    } else if (ls.length) ok = false;
    if (!ok) { badRun++; console.log(`  run ${r.run_no} ${r.period_key}: ledger ${ledgerSum}, charge ${r.total_charge}`); }
  }
  check('J1', `every posted run (${postedRuns.length}): ledger rows = total charge; amortisation debits the item's expense / credits its accumulated account; fair value gain debits its asset account / credits its gain account, a loss debits its loss account / credits the asset`, badRun === 0, `${badRun} wrong`);
  const unbalanced = await q('select count(*) n from journal_header where round(total_debit,2) <> round(total_credit,2)');
  check('J2', 'no journal is unbalanced', Number(unbalanced[0].n) === 0, `${unbalanced[0].n}`);
  // Every item's own accumulated amortisation account (V1.3 names one per amortised item), and 1065 where an older chart still holds the shared one.
  const accumulated = num((await q(`select coalesce(sum(jl.credit_amount - jl.debit_amount),0) x from journal_line jl join gl_account_master g on g.gl_account_id = jl.gl_account_id
     where g.account_code = '1065' or g.gl_account_id in (select bio_accum_amort_gl_id from item_master where bio_accum_amort_gl_id is not null)`))[0].x);
  const amortTotal = lines.filter((l) => l.method === 'AMORTIZATION' && l.status === 'CHARGED' && by.has(l.tag)).reduce((n, l) => n + num(l.charge), 0);
  // An animal that has left had her amortisation cleared out of the account at her exit (BIO_ASSET_EXIT: Dr accumulated / Cr acquisition).
  const cleared = num((await q(`select coalesce(sum(jl.debit_amount),0) x from journal_line jl join journal_header jh on jh.journal_id = jl.journal_id
     where jh.source_document_type = 'BIO_ASSET_EXIT' and jl.gl_account_id in (select bio_accum_amort_gl_id from item_master where bio_accum_amort_gl_id is not null)`))[0].x);
  check('J3', 'accumulated amortisation (each item\'s own account, credit) = every amortisation charge posted (' + r2(amortTotal) + '), less what was cleared at an exit (' + r2(cleared) + ')',
    near(accumulated, amortTotal - cleared, 0.01), `${accumulated} vs ${r2(amortTotal - cleared)}`);

  // ---- breeding: two parities for every sow --------------------------------------------------------------------------------------
  const breeding = await q(`select b.*, a.rfid_tag tag from breeding_record b join animal_register a on a.animal_id = b.sow_animal_id where a.rfid_tag like 'PF-SOW-%' order by a.rfid_tag, b.mating_date`);
  const farrows = await q(`select f.*, a.rfid_tag tag from farrowing_record f join animal_register a on a.animal_id = f.sow_animal_id where a.rfid_tag like 'PF-SOW-%' order by a.rfid_tag, f.farrowing_date`);
  let badBreed = 0;
  for (const s of herd.filter((h) => h.kind === 'SOW')) {
    const [c1, c2] = cyclesOf(s.group!);
    const bs = breeding.filter((b) => b.tag === s.tag); const fs = farrows.filter((f) => f.tag === s.tag);
    const ok = bs.length === 2 && fs.length === 2 && by.get(s.tag)!.parity_count === 2
      && [c1, c2].every((cy, i) => d(bs[i].mating_date) === cy.mating && bs[i].mating_type === 'AI' && num(bs[i].semen_dose_qty) === 2 && !!bs[i].semen_lot_id && bs[i].conception_result === 'CONFIRMED'
        && d(fs[i].farrowing_date) === cy.farrowing && d(fs[i].weaning_date) === cy.weaning && fs[i].parity_number === i + 1 && num(fs[i].piglets_born_live) > 0 && num(fs[i].piglets_weaned) > 0 && !!fs[i].piglet_batch_id);
    if (!ok) { badBreed++; console.log(`  ${s.tag}: ${bs.length} matings, ${fs.length} farrowings, parity ${by.get(s.tag)!.parity_count}`); }
  }
  check('B1', 'every one of the 14 sows: two AI matings with semen, pregnancy confirmed, farrowing 116 days after each, weaning 28 days after, the second mating 5 days after the first weaning, parity 2',
    badBreed === 0, `${badBreed} wrong`);
  const lots = await q(`select s.* from semen_batch s join animal_register a on a.animal_id = s.boar_animal_id where a.rfid_tag like 'PF-BOAR-%'`);
  const dates = [...new Set(lots.map((l) => d(l.collection_date)))].sort();
  const expectedDates = ['A', 'B'].flatMap((g) => cyclesOf(g as 'A' | 'B').map((cy) => addDays(cy.mating, -4))).sort();
  check('B2', 'semen: 24 lots, 30 doses each, six boars on each of the four collection dates, four days before each round of matings',
    lots.length === 24 && lots.every((l) => num(l.doses_collected) === 30) && JSON.stringify(dates) === JSON.stringify(expectedDates), `${lots.length} lots on ${dates.join(',')}`);
  const costedLots = lots.filter((l) => num(l.unit_cost_per_dose) > 0);
  check('B3', 'every semen lot carries a cost per dose (the boar\'s own running cost, amortisation included)', costedLots.length === lots.length, `${costedLots.length} of ${lots.length}`);

  // ---- the litters' cost -----------------------------------------------------------------------------------------------------------
  const sowIds = new Map(animals.filter((a) => a.animal_type === 'SOW').map((a) => [a.animal_id, a]));
  const allocation = await q(`select l.batch_id, l.cost_amount amt, l.document_type, l.posting_date from bio_asset_ledger l where l.document_type in ('LITTER_BIRTH_COST','LITTER_COST') and l.cost_amount > 0`);
  let badLitter = 0; let litterWithCost = 0; let litterTotal = 0;
  const facts: Array<Record<string, unknown>> = [];
  for (const f of farrows) {
    const sow = by.get(f.tag)!;
    const from = d((breeding.find((b) => b.breeding_id === f.breeding_id) ?? { mating_date: addDays(d(f.farrowing_date), -116) }).mating_date);
    const to = addDays(d(f.farrowing_date), -1);
    const held = ledgerOf(sow.animal_id).filter((l) => ['CONSUMPTION', 'OVERHEAD_COST'].includes(l.event) && d(l.posting_date) >= from && d(l.posting_date) <= to).reduce((n, l) => n + num(l.amt), 0);
    const moved = allocation.filter((x) => x.batch_id === f.piglet_batch_id && x.document_type === 'LITTER_BIRTH_COST').reduce((n, x) => n + num(x.amt), 0);
    const lactation = allocation.filter((x) => x.batch_id === f.piglet_batch_id && x.document_type === 'LITTER_COST').reduce((n, x) => n + num(x.amt), 0);
    const okPer = moved > 0 ? near(num(f.cost_per_piglet), moved / num(f.piglets_weaned), 0.0001) : !(num(f.cost_per_piglet) > 0);
    if (!near(moved, Math.max(0, held), 0.005) || !okPer || lactation > 0.005) { badLitter++; console.log(`  litter of ${f.tag} ${d(f.farrowing_date)}: moved ${moved}, held ${held.toFixed(4)}, per piglet ${f.cost_per_piglet}`); }
    if (moved > 0) litterWithCost++;
    litterTotal += moved;
    facts.push({ sow: f.tag, item: sow.item_code, parity: f.parity_number, mating: d(from), farrowing: d(f.farrowing_date), start: d(sow.start), live: f.piglets_born_live, capitalised_in_window: r4(held), moved_to_litter: r4(moved), per_piglet: f.cost_per_piglet });
  }
  check('L1', 'each litter\'s cost at birth = the sow\'s own capitalised feed, overhead and semen from her mating to the day before farrowing (nothing else can move: cost after her start was expensed); cost per piglet (rewritten at weaning, so over the piglets weaned) = that cost / weaned; no lactation cost moved',
    badLitter === 0, `${badLitter} wrong`);
  check('L2', 'the pattern is the rule: group A sows (served before their start) carry cost into parity 1 litters, group B (served after it) and every parity 2 litter carry none',
    farrows.every((f) => { const g = herd.find((h) => h.tag === f.tag)!.group; const moved = allocation.filter((x) => x.batch_id === f.piglet_batch_id).reduce((n, x) => n + num(x.amt), 0); return (g === 'A' && f.parity_number === 1) === (moved > 0); }), `${litterWithCost} litters carry cost, ${r2(litterTotal)} in all`);

  // ---- the gilts -------------------------------------------------------------------------------------------------------------------------
  const gilts = await q(`select a.*, i.item_code, i.bio_costing_method method from animal_register a join item_master i on i.item_id = a.item_id where a.rfid_tag like 'PF-GILT-%' order by a.rfid_tag`);
  check('T1', 'four home-bred gilts (born on farm, item GP-LOC-F, fair value) selected from the first litters of PF-SOW-01 and PF-SOW-03, costing start at 33 weeks',
    gilts.length === 4 && gilts.every((g) => g.entry_type === 'BORN_ON_FARM' && g.item_code === 'GP-LOC-F' && g.method === 'FAIR_VALUE' && d(g.costing_start_date) === addDays(d(g.dob), 7 * 33)) && GILT_TAGS.flat().every((t) => gilts.some((g) => g.rfid_tag === t)), `${gilts.length}`);
  const giltJournals = await q(`select count(*) n from journal_header where source_document_type = 'ANIMAL_REGISTRATION'`);
  check('T2', 'each gilt\'s acquisition posted a journal (Dr her item\'s acquisition account / Cr Weaners Inventory)', Number(giltJournals[0].n) === 4, `${giltJournals[0].n}`);
  const giltFv = lines.filter((l) => String(l.tag).startsWith('PF-GILT-') && l.status === 'CHARGED');
  const giltLater = lines.filter((l) => String(l.tag).startsWith('PF-GILT-') && d(l.period_end) > '2026-03-31');
  check('T3', 'the gilts\' one fair value charge is in March 2026 (the month she starts), up to the rate in force then (150 x 2.35 = 352.50, a gain over her cost and feed), and every later month is NO_CHANGE',
    giltFv.length === 4 && giltFv.every((l) => l.period_key === '2026-03' && near(num(l.book_value_after), 352.5, 0.002) && num(l.charge) > 0) && giltLater.length > 0 && giltLater.every((l) => l.status === 'SKIPPED' && l.skip_reason === 'NO_CHANGE'),
    giltFv.map((l) => `${l.tag} ${l.period_key} ${l.charge}`).join(', '));

  // ---- vaccines and medicines: drawn from their own inventory accounts (02a-project-coa) ---------------------------------------------------
  const health = await q(`select c.category_code cat, g.account_code code, round(sum(jl.credit_amount), 4) cr, count(distinct jh.journal_id) n
     from journal_header jh join journal_line jl on jl.journal_id = jh.journal_id and jl.credit_amount > 0 join gl_account_master g on g.gl_account_id = jl.gl_account_id
     join inventory_ledger il on il.ledger_id = jh.source_ledger_id join item_master i on i.item_id = il.item_id join item_category_master c on c.category_id = i.category_id
     where c.category_code in ('ICAT-005', 'ICAT-006') and il.transaction_type = 'CONSUMPTION' group by c.category_code, g.account_code`);
  const healthOk = health.length === 2 && health.some((h) => h.cat === 'ICAT-005' && h.code === '170300' && num(h.cr) > 0) && health.some((h) => h.cat === 'ICAT-006' && h.code === '170200' && num(h.cr) > 0);
  check('I1', 'each vaccine and medicine issued to the herd leaves its own inventory account: medicines Medicine Inventory (170300), vaccines Veterinary Inventory (170200), none Feed Inventory',
    healthOk, health.map((h) => `${h.cat}->${h.code} ${h.cr} (${h.n})`).join(', '));

  // ---- exits (TDD rows 10 and 11) ------------------------------------------------------------------------------------------------------
  const jlines = (where: string, params: unknown[]) => q(`select g.account_code code, coalesce(sum(jl.debit_amount),0) dr, coalesce(sum(jl.credit_amount),0) cr
     from journal_header jh join journal_line jl on jl.journal_id = jh.journal_id join gl_account_master g on g.gl_account_id = jl.gl_account_id where ${where} group by g.account_code`, params);
  const at = (rows: any[], code?: string) => rows.find((r) => r.code === code) ?? { dr: 0, cr: 0 };
  const ledgerOfTag = async (tag: string) => q(`select l.document_type, l.cost_amount amt, l.posting_date from bio_asset_ledger l join animal_register a on a.animal_id = l.animal_id where a.rfid_tag = ?`, [tag]);
  const amortisedOf = (rows: any[]) => -rows.filter((r) => r.document_type === 'BIO_COSTING_RUN').reduce((n, r) => n + num(r.amt), 0);
  const deathBad: string[] = [];
  // Deaths of one day are journalled on one date: the day's Dr 610400 is the sum of their book values.
  const deathDay = new Map<string, { dr: number; nbv: number }>();
  for (const d of PROJECT_EXITS.deaths) {
    const a = by.get(d.tag)!;
    const [reg] = await q(`select status, disposal_type, exit_weight_kg w, disposal_destination dest, book_value_at_death bvd from animal_register where rfid_tag = ?`, [d.tag]);
    const led = await ledgerOfTag(d.tag);
    const death = led.find((r) => r.document_type === 'MORTALITY');
    const nbv = death ? -num(death.amt) : NaN;
    const acc = Object.entries(ITEM_ACCOUNTS).find(([code]) => code.toLowerCase() === String(a.item_code).toLowerCase())?.[1];
    const wo = await jlines(`jh.description like 'Mortality%' and jh.posting_date = ?`, [d.date]);
    const exit = await jlines(`jh.source_document_type = 'BIO_ASSET_EXIT' and jh.source_document_no = ?`, [a.animal_code]);
    const amortised = amortisedOf(led);
    const ok = reg.status === 'DEAD' && near(num(reg.w), d.weight_kg) && reg.dest === d.destination && near(num(reg.bvd), nbv, 0.005)
      && near(led.reduce((n, r) => n + num(r.amt), 0), 0, 0.005) && near(num(at(wo, acc?.acquisition).cr), nbv, 0.01)
      && (amortised > 0.005 ? near(num(at(exit, acc?.accumulated).dr), amortised, 0.01) && near(num(at(exit, acc?.acquisition).cr), amortised, 0.01) : exit.length === 0);
    deathDay.set(d.date, { dr: num(at(wo, '610400').dr), nbv: (deathDay.get(d.date)?.nbv ?? 0) + nbv });
    if (!ok) deathBad.push(`${d.tag} nbv ${nbv} amortised ${r2(amortised)} wo ${JSON.stringify(wo)} exit ${JSON.stringify(exit)} reg ${JSON.stringify(reg)}`);
  }
  for (const [day, v] of deathDay) if (!near(v.dr, v.nbv, 0.01)) deathBad.push(`${day}: Dr 610400 ${v.dr} vs book values ${r2(v.nbv)}`);
  check('X1', 'each death (an amortised P-Imp-F sow, a fair value P-Loc-F sow): DEAD with weight, destination and book value at death; her ledger to nil; Dr 610400 Mortality / Impairment Loss = her book value / Cr her acquisition account; the amortised one also Dr her accumulated amortisation / Cr acquisition for what was amortised',
    deathBad.length === 0, deathBad.join(' | '));
  const cull = PROJECT_EXITS.cull;
  const boar = by.get(cull.tag)!;
  const [conv] = await q(`select c.status, c.nbv_at_conversion nbv, c.market_value mv, c.gain_loss gl, c.requested_by req, c.approved_by appr, a.status animal from fa_inventory_conversion c join animal_register a on a.animal_id = c.animal_id where a.rfid_tag = ?`, [cull.tag]);
  const boarLedger = await ledgerOfTag(cull.tag);
  const boarAmortised = amortisedOf(boarLedger);
  const boarAcc = ITEM_ACCOUNTS['P-Imp-M'];
  const convJ = await jlines(`jh.source_document_no = ? and jh.source_document_type <> 'BIO_ASSET_EXIT'`, [boar.animal_code]);
  const boarExit = await jlines(`jh.source_document_type = 'BIO_ASSET_EXIT' and jh.source_document_no = ?`, [boar.animal_code]);
  const gain = conv ? num(conv.mv) - num(conv.nbv) : NaN;
  const cullOk = !!conv && conv.status === 'POSTED' && conv.animal === 'CONVERTED_INV' && conv.req !== conv.appr && near(num(conv.mv), cull.market_value) && near(num(conv.gl), gain, 0.01)
    && near(num(at(convJ, '171100').dr), cull.market_value, 0.01)
    && near(num(at(convJ, '710500').cr) - num(at(convJ, '710500').dr), gain, 0.01)
    && near(boarLedger.reduce((n, r) => n + num(r.amt), 0), 0, 0.005)
    && (boarAmortised > 0.005 ? near(num(at(boarExit, boarAcc.accumulated).dr), boarAmortised, 0.01) && near(num(at(boarExit, boarAcc.acquisition).cr), boarAmortised, 0.01) : true);
  check('X2', 'the cull (an amortised P-Imp-M boar): out of production, requested, approved by another user, posted; CONVERTED_INV; Dr 171100 Finished Goods at market value / Cr his acquisition; the gain or loss on 710500; his amortisation cleared Dr 150610 / Cr 150600; his ledger to nil',
    cullOk, conv ? `nbv ${conv.nbv} market ${conv.mv} gain ${conv.gl} amortised ${r2(boarAmortised)} conv ${JSON.stringify(convJ)} exit ${JSON.stringify(boarExit)}` : 'no conversion');

  // ---- the facts the explanation is written from -----------------------------------------------------------------------------------------
  console.log('\nFACTS per sow');
  for (const s of herd.filter((h) => h.kind === 'SOW')) {
    const a = by.get(s.tag)!; const L = ledgerOf(a.animal_id);
    const sum = (ev: string[], doc?: string[]) => r2(L.filter((l) => ev.includes(l.event) && (!doc || doc.includes(l.document_type)) && (ev.includes('ACQUISITION') || !l.source_entry_id)).reduce((n, l) => n + num(l.amt), 0));
    console.log(`  ${s.tag} ${a.item_code.padEnd(9)} ${a.method.padEnd(12)} acquisition ${sum(['ACQUISITION'])} + feed/overhead capitalised ${sum(['CONSUMPTION', 'OVERHEAD_COST'], ['BATCH', 'BATCH_OVERHEAD'])} + semen ${sum(['CONSUMPTION', 'OVERHEAD_COST'], ['BREEDING_SEMEN'])}; amortised ${sum(['AMORTIZATION'])}; fair value ${sum(['FAIR_VALUE_ADJMT'])}; litters ${sum(['COST_ALLOCATION'])}; book value now ${r2(bookTo(a.animal_id, '2026-12-31'))}`);
  }
  console.log('\nFACTS per litter');
  for (const f of facts) console.log(`  ${JSON.stringify(f)}`);

  console.log('');
  const failed = report();
  await c.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
