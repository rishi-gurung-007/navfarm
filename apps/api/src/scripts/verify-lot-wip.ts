/**
 * Rehearses a weaner lot's WIP (BBP-2 S.NO.6, decided 13 Nov 2026: feed and overhead go to WIP during the month and are recognised as the lot's inventory at
 * month end, before fair value) on the demo company's data and ROLLS BACK: nothing it posts is kept.
 *
 *   pnpm nx run api:verify-lot-wip
 *
 * Inside one transaction, through the application's own services: it sets up the opt-in BIO_LOT_WIP mapping (Dr WIP Weaners 160400 / Cr Weaners Inventory
 * 170400, the accounts the chart already has), feeds a litter lot in October through BatchService.addTransaction, then runs October's lot valuation
 * (LotFairValueService) twice. It checks that:
 *   - the feed is debited to WIP Weaners, not to the lot's inventory account, and still raises the lot's carrying value;
 *   - the preview shows that WIP and posts nothing;
 *   - the run recognises it, Dr the lot's inventory account / Cr WIP Weaners for exactly that amount, leaving the lot's WIP at nil;
 *   - recognition does not change the lot's carrying value;
 *   - a second run recognises nothing.
 * Exits non-zero if any check fails. The tenant is left exactly as found.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { withTenantTransaction } from '../common/tenant-transaction';
import * as schema from '../core/database/schema';
import { BatchService } from '../modules/production/batch/batch.service';
import { LotFairValueService } from '../modules/production/batch/lot-fair-value.service';
import { bootApp, buildDemoContext, inTenant } from './demo/harness';
import type { DemoContext } from './demo/chapter';

const ROLLBACK = Symbol('verify-lot-wip:rollback');
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const LOT = process.env.LOT_NO || 'LIT-000028';
const FEED = process.env.FEED_ITEM || 'ICAT-004-ITM-0008';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};

async function scenario(ctx: DemoContext) {
  const cls = ctx.app.get(ClsService);
  const db = cls.get<MySql2Database<typeof schema>>('tenantDb')!;
  const batches = ctx.app.get(BatchService);
  const lots = ctx.app.get(LotFairValueService);
  const tenantId = ctx.tenantId;

  const account = async (code: string) => {
    const [a] = await db.select().from(schema.glAccountMaster).where(and(eq(schema.glAccountMaster.tenant_id, tenantId), eq(schema.glAccountMaster.account_code, code))).limit(1);
    if (!a) throw new Error(`The chart has no account ${code}.`);
    return a.gl_account_id;
  };
  const wip = await account('160400');
  const inventory = await account('170400');
  await db.insert(schema.glMappingMaster).values({
    mapping_id: randomUUID(), tenant_id: tenantId, company_id: ctx.companyId, transaction_type: 'BIO_LOT_WIP', debit_gl_account_id: wip, credit_gl_account_id: inventory,
  } as any);
  console.log(`BIO_LOT_WIP mapped inside this rehearsal only: Dr 160400 WIP Weaners / Cr 170400 Weaners Inventory.`);

  const [lot] = await db.select().from(schema.batchHeader).where(and(eq(schema.batchHeader.tenant_id, tenantId), eq(schema.batchHeader.batch_no, LOT))).limit(1);
  const [feed] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.item_code, FEED))).limit(1);
  if (!lot || !feed) throw new Error(`${LOT} or ${FEED} is not on this company.`);
  const nca = async () => Number((await db.select({ v: schema.batchBioAssetState.nca_book_value }).from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, lot.batch_id)))[0].v);
  const net = async (accountId: string) => r4(Number((await db
    .select({ n: sql<string>`COALESCE(SUM(${schema.journalLine.debit_amount} - ${schema.journalLine.credit_amount}), 0)` })
    .from(schema.journalLine)
    .innerJoin(schema.journalHeader, eq(schema.journalHeader.journal_id, schema.journalLine.journal_id))
    .where(and(eq(schema.journalHeader.source_document_no, lot.batch_no), eq(schema.journalHeader.status, 'POSTED'), eq(schema.journalLine.gl_account_id, accountId))))[0].n));

  const before = { nca: await nca(), wip: await net(wip), inventory: await net(inventory) };
  console.log(`\nFeed ${LOT} 10 kg of ${feed.item_code} on 15 Oct 2026`);
  await batches.addTransaction(lot.batch_id, { transaction_date: '2026-10-15', transaction_type: 'CONSUMPTION', item_id: feed.item_id, quantity: 10, uom: 'KG', remarks: 'verify-lot-wip' } as any, tenantId);
  const afterFeed = { nca: await nca(), wip: await net(wip), inventory: await net(inventory) };
  const cost = r4(afterFeed.nca - before.nca);
  console.log(`  the feed cost ${cost}`);
  check('the feed raised the lot\'s carrying value', cost > 0, true);
  check('and was debited to WIP Weaners, not to the lot\'s inventory account', [r4(afterFeed.wip - before.wip), r4(afterFeed.inventory - before.inventory)], [cost, 0]);

  console.log('\nPreview October');
  const pre = await lots.preview({ period_key: '2026-10', batch_id: lot.batch_id }, tenantId);
  check('the preview shows the lot\'s WIP and recognises nothing', [pre.lines[0]?.wip_balance, pre.lines[0]?.wip_recognised, await net(wip)], [r4(before.wip + cost), false, afterFeed.wip]);

  console.log('\nRun October');
  const run = await lots.post({ period_key: '2026-10', batch_id: lot.batch_id }, tenantId);
  check('the run recognised the WIP', [run.lines[0]?.wip_recognised, run.lines[0]?.message ?? null], [true, null]);
  const afterRun = { nca: await nca(), wip: await net(wip), inventory: await net(inventory) };
  check('Dr the lot\'s inventory / Cr WIP Weaners for that amount, leaving WIP at nil', [afterRun.wip, r4(afterRun.inventory - afterFeed.inventory)], [0, r4(before.wip + cost)]);
  check('recognition did not change the lot\'s carrying value', afterRun.nca, afterFeed.nca);

  console.log('\nRun October again');
  const again = await lots.post({ period_key: '2026-10', batch_id: lot.batch_id }, tenantId);
  check('recognises nothing more', [again.lines[0]?.wip_balance, again.lines[0]?.wip_recognised, await net(wip)], [0, false, 0]);

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
