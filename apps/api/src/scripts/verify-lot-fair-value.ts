/**
 * Rehearses the monthly fair value of the weaner and grower lots (BBP-2 S.NO.6) on the demo company's data and ROLLS BACK: nothing it posts is kept.
 *
 *   pnpm nx run api:verify-lot-fair-value
 *
 * Inside one transaction, through LotFairValueService (what the Finance run calls): it gives the PIGLETS item two TEST Fair Value Rates (a price, then a lower one from
 * October; they exist only inside this rehearsal, the client's own figures are entered in Master Data), previews September, posts September, posts it again, then posts
 * October, and reads the lots, the bio-asset ledger and the journals back. It checks that:
 *   - the preview changes nothing;
 *   - every revalued lot ends at head x expected weight x price per kg, its carrying value and its ledger row agreeing;
 *   - a gain is Dr the lot's account / Cr the fair value account, a loss the reverse, and every journal balances;
 *   - asking for the same month again revalues nothing;
 *   - the lot's account moves by exactly what the lots' carrying values moved by.
 * Exits non-zero if any check fails. The tenant is left exactly as found.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { withTenantTransaction } from '../common/tenant-transaction';
import * as schema from '../core/database/schema';
import { LotFairValueService } from '../modules/production/batch/lot-fair-value.service';
import { GlPostingService } from '../modules/finance/journal/gl-posting.service';
import { bootApp, buildDemoContext, inTenant } from './demo/harness';
import type { DemoContext } from './demo/chapter';

const ROLLBACK = Symbol('verify-lot-fair-value:rollback');
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};

async function scenario(ctx: DemoContext) {
  const cls = ctx.app.get(ClsService);
  const db = cls.get<MySql2Database<typeof schema>>('tenantDb')!;
  const service = ctx.app.get(LotFairValueService);
  const gl = ctx.app.get(GlPostingService);
  const tenantId = ctx.tenantId;

  // The demo's litter lots are made of the Suckling Live Piglet item, which carries no costing terms yet; a company puts the fair value terms on the item its lots are made of.
  // Inside this rehearsal only, that item is given fair value terms (from 17 weeks of age) and two TEST rates.
  const [item] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.item_code, 'ICAT-008-ITM-0001'))).limit(1);
  if (!item) throw new Error('The Suckling Live Piglet item (ICAT-008-ITM-0001) is not on this company.');
  await db.update(schema.itemMaster).set({ bio_costing_method: 'FAIR_VALUE', bio_start_age_weeks: 17, bio_start_age_days: 0 } as any).where(eq(schema.itemMaster.item_id, item.item_id));
  console.log(`${item.item_code} given FAIR_VALUE terms from 17 weeks of age, and TEST rates only inside this rehearsal: 30 kg x 2.00 from 1 Jan 2026, then 30 kg x 1.50 from 1 Oct 2026.`);
  await db.insert(schema.itemFairValueRate).values([
    { rate_id: randomUUID(), item_id: item.item_id, farm_id: null, age_week_from: 0, effective_from: '2026-01-01', expected_weight_kg: '30', price_per_kg: '2' },
    { rate_id: randomUUID(), item_id: item.item_id, farm_id: null, age_week_from: 0, effective_from: '2026-10-01', expected_weight_kg: '30', price_per_kg: '1.5' },
  ] as any);

  const counts = async () => ({
    ledger: Number((await db.select({ n: sql<string>`COUNT(*)` }).from(schema.bioAssetLedger).where(eq(schema.bioAssetLedger.document_type, 'BATCH_FAIR_VALUE')))[0].n),
    journals: Number((await db.select({ n: sql<string>`COUNT(*)` }).from(schema.journalHeader).where(like(schema.journalHeader.description, 'Fair value adjustment%')))[0].n),
  });
  const ncaOf = async (ids: string[]) => {
    const rows = await db.select({ id: schema.batchBioAssetState.batch_id, v: schema.batchBioAssetState.nca_book_value }).from(schema.batchBioAssetState).where(inArray(schema.batchBioAssetState.batch_id, ids));
    return new Map(rows.map((r) => [r.id, Number(r.v)]));
  };
  const lotAccount = (await gl.mappedAccount(tenantId, ctx.companyId, 'BIO_LITTER_BIRTH', 'debit'))!;
  const fvAccount = (await gl.mappedAccount(tenantId, ctx.companyId, 'BIO_FAIR_VALUE_PREMATURE', 'credit'))!;
  const accountNet = async (nos: string[]) => {
    const heads = await db.select().from(schema.journalHeader).where(and(inArray(schema.journalHeader.source_document_no, nos), like(schema.journalHeader.description, 'Fair value adjustment%')));
    let lotNet = 0, fvNet = 0, balanced = true;
    for (const h of heads) {
      const lines = await db.select().from(schema.journalLine).where(eq(schema.journalLine.journal_id, h.journal_id));
      let d = 0, c = 0;
      for (const l of lines) {
        d += Number(l.debit_amount); c += Number(l.credit_amount);
        if (l.gl_account_id === lotAccount) lotNet += Number(l.debit_amount) - Number(l.credit_amount);
        if (l.gl_account_id === fvAccount) fvNet += Number(l.debit_amount) - Number(l.credit_amount);
      }
      if (Math.abs(d - c) > 0.0001) balanced = false;
    }
    return { journals: heads.length, lotNet: r4(lotNet), fvNet: r4(fvNet), balanced };
  };

  console.log('\nPreview September (changes nothing)');
  const before = await counts();
  const pre = await service.preview({ period_key: '2026-09' }, tenantId);
  const adjust = pre.lines.filter((l) => l.status === 'ADJUST');
  const skips = pre.lines.filter((l) => l.status === 'SKIPPED').reduce((m: Record<string, number>, l) => ({ ...m, [l.skip_reason!]: (m[l.skip_reason!] ?? 0) + 1 }), {});
  console.log(`  ${pre.lines.length} lots considered, ${adjust.length} to revalue; skips: ${JSON.stringify(skips)}`);
  if (!adjust.length) throw new Error('No lot is eligible for September: nothing to rehearse on.');
  check('the preview wrote no ledger row and no journal', await counts(), before);
  check('every lot to revalue is priced at head x 30 kg x 2.00', adjust.every((l) => l.fair_value === r4(l.head * 60)), true);
  const ids = adjust.map((l) => l.batch_id);
  const nos = adjust.map((l) => l.batch_no);
  const ncaBefore = await ncaOf(ids);

  console.log('\nPost September');
  const sep = await service.post({ period_key: '2026-09' }, tenantId);
  check('every lot that was to be revalued was posted, none failed', [sep.lines.filter((l) => l.posted).length, sep.lines.filter((l) => l.message).length], [adjust.length, 0]);
  const ncaSep = await ncaOf(ids);
  check('each lot now stands at head x 60', ids.every((id, i) => r4(ncaSep.get(id)!) === r4(adjust[i].head * 60)), true);
  const c1 = await counts();
  check('one ledger row and one journal per lot', [c1.ledger - before.ledger, c1.journals - before.journals], [adjust.length, adjust.length]);
  const j1 = await accountNet(nos);
  const rise = r4(ids.reduce((n, id) => n + (ncaSep.get(id)! - ncaBefore.get(id)!), 0));
  check('Dr the lot account by the total gain, Cr the fair value account by the same, all balanced', [j1.lotNet, j1.fvNet, j1.balanced], [rise, -rise, true]);

  console.log('\nPost September again');
  const again = await service.post({ period_key: '2026-09' }, tenantId);
  check('revalues nothing: every lot is skipped as already run', [again.lines.filter((l) => l.posted).length, again.lines.filter((l) => l.skip_reason === 'ALREADY_RUN').length], [0, adjust.length]);
  check('and writes nothing', (await counts()).ledger, c1.ledger);

  console.log('\nPost October at the lower price (a loss)');
  const oct = await service.post({ period_key: '2026-10' }, tenantId);
  const octAdjust = oct.lines.filter((l) => l.status === 'ADJUST');
  check('every lot is revalued down to head x 45', [octAdjust.length, octAdjust.every((l) => l.fair_value === r4(l.head * 45) && l.adjustment < 0 && l.posted)], [adjust.length, true]);
  const ncaOct = await ncaOf(ids);
  check('each lot now stands at head x 45', ids.every((id, i) => r4(ncaOct.get(id)!) === r4(adjust[i].head * 45)), true);
  const j2 = await accountNet(nos);
  const net = r4(ids.reduce((n, id) => n + (ncaOct.get(id)! - ncaBefore.get(id)!), 0));
  check("the lot account's net movement over both months equals the lots' carrying value movement, and the fair value account the opposite", [j2.lotNet, j2.fvNet, j2.balanced], [net, -net, true]);

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
