/**
 * Rehearses "a mature sow's feed and overhead go to her litter" (Finance, 13 Nov 2026) on the demo company's data and ROLLS BACK: nothing it posts is kept.
 *
 *   pnpm nx run api:verify-sow-feed-to-litter
 *
 * Inside one transaction, through the application's own LitterCostService (the calls the farrowing and the weaning make), on the newest litter whose sow is past her
 * costing start (so her feed is expensed): it recomputes from her batch transactions what she was charged in the two windows, runs the birth move and the weaning
 * move, and reads the lot, the bio-asset ledger and the journals back. It checks that:
 *   - the lot rose by exactly what the sow's expensed feed and overhead came to, in each window;
 *   - each reclass journal is Dr the lot's account / Cr the expense account the cost was charged to, and every journal balances;
 *   - the sow's own ledger rows and book value, and so her amortisation, are untouched;
 *   - asking again moves nothing;
 *   - the litter's cost per piglet is everything the lot was given over the piglets.
 * Exits non-zero if any check fails. The tenant is left exactly as found.
 */
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { withTenantTransaction } from '../common/tenant-transaction';
import * as schema from '../core/database/schema';
import { LitterCostService } from '../modules/piggery/litter-cost/litter-cost.service';
import { GlPostingService } from '../modules/finance/journal/gl-posting.service';
import { bootApp, buildDemoContext, inTenant } from './demo/harness';
import type { DemoContext } from './demo/chapter';

const ROLLBACK = Symbol('verify-sow-feed-to-litter:rollback');
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const day = (d: unknown) => String(d).slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};
const near = (label: string, actual: number, expected: number) => check(label, r4(actual), r4(expected));

async function scenario(ctx: DemoContext) {
  const cls = ctx.app.get(ClsService);
  const db = cls.get<MySql2Database<typeof schema>>('tenantDb')!;
  const litter = ctx.app.get(LitterCostService);
  const gl = ctx.app.get(GlPostingService);
  const tenantId = ctx.tenantId;

  // The newest litter with a lot, whose sow is past her costing start.
  const candidates = await db.select().from(schema.farrowingRecord).where(and(eq(schema.farrowingRecord.tenant_id, tenantId))).orderBy(sql`${schema.farrowingRecord.farrowing_date} DESC`);
  let farrow: (typeof candidates)[number] | undefined;
  let sow: typeof schema.animalRegister.$inferSelect | undefined;
  for (const f of candidates) {
    if (!f.piglet_batch_id) continue;
    const [s] = await db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, f.sow_animal_id)).limit(1);
    if (s?.costing_start_date) { farrow = f; sow = s; break; }
  }
  if (!farrow || !sow) throw new Error('No litter with a piglet lot and a sow past her costing start was found: nothing to rehearse on.');
  const farrowingDate = day(farrow.farrowing_date);
  const [mating] = farrow.breeding_id ? await db.select({ d: schema.breedingRecord.mating_date }).from(schema.breedingRecord).where(eq(schema.breedingRecord.breeding_id, farrow.breeding_id)).limit(1) : [];
  const birthFrom = mating?.d ? day(mating.d) : addDays(farrowingDate, -116);
  const birthTo = addDays(farrowingDate, -1);
  const weanDate = farrow.weaning_date ? day(farrow.weaning_date) : new Date().toISOString().slice(0, 10);
  const start = day(sow.costing_start_date);
  const piglets = Number(farrow.piglets_born_live) || 1;
  console.log(`Litter ${farrow.piglet_lot_no} of ${sow.animal_code} (costing start ${start}); mating ${birthFrom}, farrowing ${farrowingDate}, weaning ${weanDate}, ${piglets} born alive.`);

  // What the sow was charged, from her own batch transactions, worked out here independently of the service.
  const txs = await db.select().from(schema.batchTransaction).where(and(eq(schema.batchTransaction.animal_id, sow.animal_id), isNull(schema.batchTransaction.reversed_at)));
  const owed = (type: string, from: string, to: string) => r4(txs
    .filter((t) => t.transaction_type === type && day(t.transaction_date) >= (start > from ? start : from) && day(t.transaction_date) <= to)
    .reduce((n, t) => n + Math.abs(Number(t.amount)), 0));
  const birthFeed = owed('CONSUMPTION', birthFrom, birthTo), birthOh = owed('OVERHEAD', birthFrom, birthTo);
  const lactFeed = owed('CONSUMPTION', farrowingDate, weanDate), lactOh = owed('OVERHEAD', farrowingDate, weanDate);
  console.log(`  expensed in the birth window: feed ${birthFeed}, overhead ${birthOh}; in the lactation window: feed ${lactFeed}, overhead ${lactOh}`);
  if (!(birthFeed + birthOh + lactFeed + lactOh > 0)) throw new Error('This sow was charged nothing in either window: the data has nothing to prove the move on.');

  const sowLedgerRows = async () => Number((await db.select({ n: sql<string>`COUNT(*)` }).from(schema.bioAssetLedger).where(eq(schema.bioAssetLedger.animal_id, sow!.animal_id)))[0].n);
  const sowBook = async () => Number((await db.select({ v: schema.animalRegister.book_value }).from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, sow!.animal_id)))[0].v);
  const lotNca = async () => Number((await db.select({ v: schema.batchBioAssetState.nca_book_value }).from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, farrow!.piglet_batch_id!)))[0].v);
  const [lot] = await db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, farrow.piglet_batch_id!)).limit(1);
  const lotAccount = await gl.mappedAccount(tenantId, lot.company_id, 'BIO_LITTER_BIRTH', 'debit', { nobId: lot.nob_id, lobId: lot.lob_id });
  const feedExpense = await gl.mappedAccount(tenantId, lot.company_id, 'BIO_CONSUMPTION_MATURE', 'debit', { nobId: lot.nob_id, lobId: lot.lob_id });
  const ohExpense = await gl.mappedAccount(tenantId, lot.company_id, 'BIO_OVERHEAD_MATURE', 'debit', { nobId: lot.nob_id, lobId: lot.lob_id });
  check('the BIO_LITTER_BIRTH mapping and both expense accounts are set up', [!!lotAccount, !!feedExpense, !!ohExpense], [true, true, true]);

  const before = { ledger: await sowLedgerRows(), book: await sowBook(), nca: await lotNca() };
  const alreadyBirth = (await litter.totalAllocated(farrow.piglet_batch_id!, tenantId));

  console.log('\nThe birth move');
  const birth = await litter.allocateAtBirth(farrow, sow, piglets, tenantId);
  near('the expensed part moved at birth is the sow\'s feed + overhead from mating to the day before the farrowing', birth.moved, birthFeed + birthOh);
  console.log('\nThe weaning move');
  const wean = await litter.allocate(farrow, sow, { asOf: weanDate, divisor: piglets }, tenantId);
  near('the expensed part moved at weaning is her feed + overhead from the farrowing to the weaning', wean.moved, lactFeed + lactOh);

  const total = r4(birthFeed + birthOh + lactFeed + lactOh);
  near('the lot rose by exactly the sum of both', (await lotNca()) - before.nca, total);
  check("the sow's own ledger rows and book value (so her amortisation) are untouched", [await sowLedgerRows(), await sowBook()], [before.ledger, before.book]);
  near("the litter's cost per piglet is everything the lot was given over the piglets", Number(wean.perPiglet), (alreadyBirth + total) / piglets);

  const rows = await db.select().from(schema.bioAssetLedger).where(and(eq(schema.bioAssetLedger.batch_id, farrow.piglet_batch_id!), like(schema.bioAssetLedger.document_type, 'LITTER_%EXP_%')));
  const byDoc = (doc: string) => r4(rows.filter((r) => r.document_type === doc).reduce((n, r) => n + Number(r.cost_amount), 0));
  check('one lot row per window and kind, each the amount owed', [byDoc('LITTER_BIRTH_EXP_FEED'), byDoc('LITTER_BIRTH_EXP_OH'), byDoc('LITTER_COST_EXP_FEED'), byDoc('LITTER_COST_EXP_OH')], [birthFeed, birthOh, lactFeed, lactOh]);

  const heads = await db.select().from(schema.journalHeader).where(and(eq(schema.journalHeader.source_document_no, lot.batch_no), like(schema.journalHeader.description, '%to her litter%')));
  const lines = [];
  for (const h of heads) for (const l of await db.select().from(schema.journalLine).where(eq(schema.journalLine.journal_id, h.journal_id))) lines.push(l);
  const debitToLot = r4(lines.filter((l) => l.gl_account_id === lotAccount).reduce((n, l) => n + Number(l.debit_amount), 0));
  const creditFeed = r4(lines.filter((l) => l.gl_account_id === feedExpense).reduce((n, l) => n + Number(l.credit_amount), 0));
  const creditOh = r4(lines.filter((l) => l.gl_account_id === ohExpense).reduce((n, l) => n + Number(l.credit_amount), 0));
  near('Dr the lot\'s account for the whole amount', debitToLot, total);
  near('Cr the consumption expense account for the feed', creditFeed, birthFeed + lactFeed);
  near('Cr the overhead expense account for the overhead', creditOh, birthOh + lactOh);
  check('every journal balances', heads.every((h) => Math.abs(Number(h.total_debit ?? 0) - Number(h.total_credit ?? 0)) < 0.0001) && lines.reduce((n, l) => n + Number(l.debit_amount) - Number(l.credit_amount), 0) < 0.0001, true);

  console.log('\nAsking again');
  const again1 = await litter.allocateAtBirth(farrow, sow, piglets, tenantId);
  const again2 = await litter.allocate(farrow, sow, { asOf: weanDate, divisor: piglets }, tenantId);
  near('moves nothing more at birth', again1.moved, 0);
  near('moves nothing more at weaning', again2.moved, 0);
  near('the lot did not rise again', (await lotNca()) - before.nca, total);

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
