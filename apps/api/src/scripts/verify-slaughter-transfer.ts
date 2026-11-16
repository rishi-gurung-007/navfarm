/**
 * Rehearses the slaughter Transfer Order (BBP-1 S.10.1: Transfer Order -> Slaughter -> Invoice) on the demo company's data and ROLLS BACK: nothing it posts is kept.
 *
 *   pnpm nx run api:verify-slaughter-transfer
 *
 * Inside one transaction, through SlaughterTransferService (what the API calls): it switches on the four BIO_SLAUGHTER_* mappings with the chart's own accounts,
 * takes two lots of one farm, and runs a Transfer Order from draft to closed. It checks that:
 *   - a draft is refused for more head than a lot holds, for a lot of another farm, for a culled breeding line, and while a medicine withdrawal is active;
 *   - the draft numbers its lines and prints the slap mark [FarmCode]-[BatchNo];
 *   - dispatch takes the head and their carrying value out of each lot into Inventory in Transit (Dr 170900 / Cr the lot's account);
 *   - the POD writes the DOA off from In Transit (Dr 610400), and raises the DOA alert above 5%;
 *   - the kill sheet invoices delivered x average carcass weight x price per kg (Dr 120100 / Cr 410100, on the farm's cost centre) and moves the delivered
 *     value to cost of sales (Dr 510100), leaving In Transit at nil for the Transfer Order;
 *   - every journal balances, and a step out of order is refused.
 * Exits non-zero if any check fails. The tenant is left exactly as found.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { withTenantTransaction } from '../common/tenant-transaction';
import * as schema from '../core/database/schema';
import { SlaughterTransferService } from '../modules/production/slaughter/slaughter-transfer.service';
import { bootApp, buildDemoContext, inTenant } from './demo/harness';
import type { DemoContext } from './demo/chapter';

const ROLLBACK = Symbol('verify-slaughter-transfer:rollback');
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const TO_DATE = process.env.TO_DATE || '2026-11-10';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};
const refuses = async (label: string, fn: () => Promise<unknown>, pattern: RegExp) => {
  try { await fn(); check(label, 'accepted', `refused ${pattern}`); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, pattern.test(m) ? 'refused' : m, 'refused'); }
};

async function scenario(ctx: DemoContext) {
  const cls = ctx.app.get(ClsService);
  const db = cls.get<MySql2Database<typeof schema>>('tenantDb')!;
  const service = ctx.app.get(SlaughterTransferService);
  const tenantId = ctx.tenantId;

  const account = async (code: string) => {
    const [a] = await db.select().from(schema.glAccountMaster).where(and(eq(schema.glAccountMaster.tenant_id, tenantId), eq(schema.glAccountMaster.account_code, code))).limit(1);
    if (!a) throw new Error(`The chart has no account ${code}.`);
    return a.gl_account_id;
  };
  const acc = { transit: await account('170900'), weaners: await account('170400'), loss: await account('610400'), receivables: await account('120100'), revenue: await account('410100'), cogs: await account('510100') };
  const pairs: Array<[string, string, string]> = [
    ['BIO_SLAUGHTER_DISPATCH', acc.transit, acc.weaners], ['BIO_SLAUGHTER_DOA', acc.loss, acc.transit],
    ['BIO_SLAUGHTER_SALE', acc.receivables, acc.revenue], ['BIO_SLAUGHTER_COGS', acc.cogs, acc.transit],
  ];
  for (const [type, dr, cr] of pairs) {
    await db.insert(schema.glMappingMaster).values({ mapping_id: randomUUID(), tenant_id: tenantId, company_id: ctx.companyId, transaction_type: type, debit_gl_account_id: dr, credit_gl_account_id: cr } as any);
  }
  console.log('BIO_SLAUGHTER_* mapped inside this rehearsal only: dispatch 170900/170400, DOA 610400/170900, sale 120100/410100, COGS 510100/170900.');

  // Two litter lots of one farm, each with head and value, and a third for the withdrawal check.
  const lots = await db
    .select({ b: schema.batchHeader, s: schema.batchBioAssetState })
    .from(schema.batchHeader)
    .innerJoin(schema.batchBioAssetState, eq(schema.batchBioAssetState.batch_id, schema.batchHeader.batch_id))
    .where(and(eq(schema.batchHeader.tenant_id, tenantId), eq(schema.batchHeader.status, 'ACTIVE'), eq(schema.batchHeader.is_litter_lot, true),
      sql`${schema.batchBioAssetState.current_quantity} >= 6`, sql`${schema.batchBioAssetState.nca_book_value} > 0`))
    .orderBy(schema.batchHeader.batch_no);
  const farmId = lots[0]?.b.farm_id;
  const sameFarm = lots.filter((l) => l.b.farm_id === farmId);
  if (sameFarm.length < 3) throw new Error('Three litter lots with head and value on one farm are needed.');
  const [a, b, c] = sameFarm;
  const [other] = await db.select().from(schema.batchHeader).where(and(eq(schema.batchHeader.tenant_id, tenantId), eq(schema.batchHeader.is_litter_lot, true), sql`${schema.batchHeader.farm_id} <> ${farmId}`)).limit(1);
  const [farm] = await db.select().from(schema.locationMaster).where(eq(schema.locationMaster.location_id, farmId!)).limit(1);
  console.log(`Farm ${farm.location_code}: ${a.b.batch_no} (${a.s.current_quantity} head, ${a.s.nca_book_value}) and ${b.b.batch_no} (${b.s.current_quantity} head, ${b.s.nca_book_value}).`);

  const base = { to_date: TO_DATE, farm_id: farmId!, ho_approval_ref: 'HO-TEST-1', destination: 'Abattoir (test)' };
  console.log('\nRefusals');
  await refuses('more head than a lot holds', () => service.create({ ...base, lines: [{ batch_id: a.b.batch_id, head_count: Number(a.s.current_quantity) + 1 }] } as any, tenantId), /holds/);
  if (other) await refuses('a lot of another farm', () => service.create({ ...base, lines: [{ batch_id: other.batch_id, head_count: 1 }] } as any, tenantId), /another farm/);
  await refuses('a culled breeding line', () => service.create({ ...base, lines: [{ batch_id: a.b.batch_id, head_count: 1, category: 'CULLED_BREEDING_ASSET' }] } as any, tenantId), /culled breeding/);
  // A medicine with 21 withdrawal days given to the third lot five days before: inside this rehearsal only.
  const [med] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.item_type, 'MEDICINE'))).limit(1);
  if (med) {
    await db.update(schema.itemMaster).set({ withdrawal_days: 21 }).where(eq(schema.itemMaster.item_id, med.item_id));
    const fiveDaysBefore = new Date(Date.parse(`${TO_DATE}T00:00:00Z`) - 5 * 86_400_000).toISOString().slice(0, 10);
    await db.insert(schema.batchTransaction).values({ transaction_id: randomUUID(), batch_id: c.b.batch_id, transaction_date: fiveDaysBefore, transaction_type: 'CONSUMPTION', item_id: med.item_id, quantity: '1', uom: 'ML', amount: '0', remarks: 'verify-slaughter-transfer' } as any);
    await refuses(`a lot still inside ${med.item_name}'s withdrawal`, () => service.create({ ...base, lines: [{ batch_id: c.b.batch_id, head_count: 1 }] } as any, tenantId), /withdrawal is still active/);
  }

  console.log('\nDraft');
  const draft: any = await service.create({ ...base, vehicle_no: 'TEST-123', lines: [{ batch_id: a.b.batch_id, head_count: 5, avg_live_weight_kg: 105 }, { batch_id: b.b.batch_id, head_count: 3, avg_live_weight_kg: 98 }] } as any, tenantId);
  check('a DRAFT with lines 10000 and 20000 and their slap marks', [draft.status, draft.lines.map((l: any) => [l.line_no, l.slap_mark])], ['DRAFT', [[10000, `${farm.location_code}-${a.b.batch_no}`], [20000, `${farm.location_code}-${b.b.batch_no}`]]]);
  await refuses('a POD before dispatch', () => service.pod(draft.to_id, { pod_date: TO_DATE, lines: [] } as any, tenantId), /is DRAFT/);

  const state = async (id: string) => { const [s] = await db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, id)); return { head: Number(s.current_quantity), nca: Number(s.nca_book_value) }; };
  const net = async (accountId: string) => r4(Number((await db
    .select({ n: sql<string>`COALESCE(SUM(${schema.journalLine.debit_amount} - ${schema.journalLine.credit_amount}), 0)` })
    .from(schema.journalLine).innerJoin(schema.journalHeader, eq(schema.journalHeader.journal_id, schema.journalLine.journal_id))
    .where(and(eq(schema.journalHeader.source_document_no, draft.to_no), eq(schema.journalLine.gl_account_id, accountId))))[0].n));
  const before = { a: await state(a.b.batch_id), b: await state(b.b.batch_id) };
  const perHead = (s: { head: number; nca: number }) => r4(s.nca / s.head);

  console.log('\nDispatch');
  const conf: any = await service.confirm(draft.to_id, tenantId);
  const afterA = await state(a.b.batch_id), afterB = await state(b.b.batch_id);
  const valA = r4(perHead(before.a) * 5), valB = r4(perHead(before.b) * 3);
  check('each lot lost the head and its value at the lot\'s cost per head', [before.a.head - afterA.head, r4(before.a.nca - afterA.nca), before.b.head - afterB.head, r4(before.b.nca - afterB.nca)], [5, valA, 3, valB]);
  check('the lines carry that value and the order is CONFIRMED', [conf.status, conf.lines.map((l: any) => r4(Number(l.carrying_value)))], ['CONFIRMED', [valA, valB]]);
  check('Dr Inventory in Transit / Cr Weaners Inventory for the whole', [await net(acc.transit), await net(acc.weaners)], [r4(valA + valB), -r4(valA + valB)]);
  const [dispatchRows] = await db.select({ n: sql<string>`COUNT(*)` }).from(schema.bioAssetLedger).where(and(eq(schema.bioAssetLedger.document_type, 'SLAUGHTER_DISPATCH'), eq(schema.bioAssetLedger.document_no, draft.to_no)));
  check('one SLAUGHTER_DISPATCH row per line in the bio-asset ledger', Number(dispatchRows.n), 2);
  await refuses('a second dispatch', () => service.confirm(draft.to_id, tenantId), /is CONFIRMED/);

  console.log('\nPOD: one dead on arrival on the first line');
  await refuses('a POD that leaves a line out', () => service.pod(draft.to_id, { pod_date: TO_DATE, lines: [{ line_id: conf.lines[0].line_id, doa_head: 1 }] } as any, tenantId), /no DOA count/);
  const pod: any = await service.pod(draft.to_id, { pod_date: TO_DATE, received_by: 'test', lines: [{ line_id: conf.lines[0].line_id, doa_head: 1 }, { line_id: conf.lines[1].line_id, doa_head: 0 }] } as any, tenantId);
  const doaValue = r4(valA / 5);
  check('received 4 and 3, the DOA written off, the alert raised (1 of 8 is above 5%)', [pod.status, pod.lines.map((l: any) => [l.received_head, l.doa_head]), await net(acc.loss), pod.doa_alert], ['RECEIVED', [[4, 1], [3, 0]], doaValue, true]);

  console.log('\nKill sheet');
  const ks: any = await service.killSheet(draft.to_id, { kill_sheet_ref: 'KS-TEST-1', kill_sheet_date: TO_DATE, invoice_no: 'INV-TEST-1', lines: [
    { line_id: conf.lines[0].line_id, avg_carcass_weight_kg: 80, price_per_kg: 3 }, { line_id: conf.lines[1].line_id, avg_carcass_weight_kg: 82, price_per_kg: 3 },
  ] } as any, tenantId);
  check('invoice = 4 x 80 x 3 + 3 x 82 x 3 = 1698', [ks.status, r4(Number(ks.invoice_amount)), ks.lines.map((l: any) => r4(Number(l.line_amount)))], ['RECONCILED', 1698, [960, 738]]);
  check('Dr Trade Receivables / Cr Pig Sales Revenue 1698', [await net(acc.receivables), await net(acc.revenue)], [1698, -1698]);
  check('the delivered value to cost of sales, leaving In Transit at nil', [await net(acc.cogs), await net(acc.transit)], [r4(valA + valB - doaValue), 0]);
  const [{ cc }] = await db.select({ cc: sql<string>`COUNT(DISTINCT ${schema.journalLine.cost_center_id})` }).from(schema.journalLine).innerJoin(schema.journalHeader, eq(schema.journalHeader.journal_id, schema.journalLine.journal_id))
    .where(and(eq(schema.journalHeader.source_document_no, draft.to_no), eq(schema.journalLine.gl_account_id, acc.revenue)));
  check(`revenue carries a cost centre (the farm's: ${farm.cost_center_id ? 'set' : 'the farm has none'})`, Number(cc), farm.cost_center_id ? 1 : 0);
  const heads = await db.select().from(schema.journalHeader).where(eq(schema.journalHeader.source_document_no, draft.to_no));
  const lines = await db.select().from(schema.journalLine).where(inArray(schema.journalLine.journal_id, heads.map((h) => h.journal_id)));
  check('every journal balances', heads.every((h) => Math.abs(lines.filter((l) => l.journal_id === h.journal_id).reduce((n, l) => n + Number(l.debit_amount) - Number(l.credit_amount), 0)) < 0.0001), true);

  console.log('\nClose');
  const closed: any = await service.close(draft.to_id, tenantId);
  check('the order is CLOSED', closed.status, 'CLOSED');
  await refuses('a cancel after close', () => service.cancel(draft.to_id, tenantId), /is CLOSED/);

  throw ROLLBACK;
}

async function main() {
  const app = await bootApp();
  let ctx: DemoContext | undefined;
  try {
    ctx = await buildDemoContext(app, () => undefined, 'light');
    await inTenant(ctx, async () => {
      const cls = ctx!.app.get(ClsService);
      try {
        await withTenantTransaction(cls, () => scenario(ctx!));
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }
    });
  } finally {
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
}

main().then(
  () => { console.log(failures === 0 ? '\nALL CHECKS PASSED (rolled back)' : `\n${failures} CHECK(S) FAILED (rolled back)`); process.exit(failures === 0 ? 0 : 1); },
  (err) => { console.error(err instanceof Error ? err.stack ?? err.message : err); process.exit(1); },
);
