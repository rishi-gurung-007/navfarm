/**
 * Rehearses every costing path end to end and ROLLS BACK — nothing it posts is kept.
 *
 *   pnpm nx run api:verify-costing-scenarios
 *
 * Inside one transaction, through the application's own services (the same calls the data-entry screen makes):
 *   1. receives the four costing test items (chapter 09-costing-scenarios; a no-op when already seeded);
 *   2. creates an ANIMAL_WISE batch from registered animals on MUL100 and a BATCH_WISE batch on POR100,
 *      adds a consumption line per item to a scheduler, saves drafts and posts the day;
 *   3. reads the inventory ledger back and checks, for FIFO and Average × not tracked / lot tracked:
 *        - the cost of each activity entry and which receipt entries it was costed from;
 *        - the lots the stock physically left (near expiry first) and the lot balances after;
 *        - one ledger entry per activity, with every animal's share;
 *        - the stock value on the Stock Balance screen;
 *        - the receipt's own view: the cost entries that consumed it and the lots issued from it.
 * Exits non-zero if any check fails. The tenant is left exactly as found.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { withTenantTransaction } from '../common/tenant-transaction';
import { BatchService } from '../modules/production/batch/batch.service';
import { SchedulerHeaderService } from '../modules/production/scheduler-header/scheduler-header.service';
import { BatchDailyDataService } from '../modules/production/batch-daily-data/batch-daily-data.service';
import { InventoryLedgerService } from '../modules/inventory/inventory-ledger/inventory-ledger.service';
import * as schema from '../core/database/schema';
import { bootApp, buildDemoContext, inTenant } from './demo/harness';
import { createBatchEnsurer, createItemLookup } from './demo/batch-helpers';
import { batchBreedOf } from './demo/farms';
import { costingScenariosChapter, COSTING_RECEIPTS } from './demo/chapters/09-costing-scenarios';
import { COSTING_TEST_ITEMS } from './lib/seed-item-catalog';
import type { DemoContext } from './demo/chapter';

const ROLLBACK = Symbol('verify-costing-scenarios:rollback');
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const r4 = (n: number) => Number(n.toFixed(4));

let failures = 0;
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};

/** What each item should cost for `kg` kilos issued, after `already` kilos have gone, by its method. */
function expectedCost(method: 'FIFO' | 'AVG', kg: number, already: number): number {
  const layers = COSTING_RECEIPTS.map((r) => ({ qty: 500, rate: r.rate }));
  if (method === 'AVG') {
    const qty = layers.reduce((n, l) => n + l.qty, 0);
    const value = layers.reduce((n, l) => n + l.qty * l.rate, 0);
    return r4(kg * (value / qty)); // issues never move a moving average
  }
  let skip = already;
  let left = kg;
  let cost = 0;
  for (const l of layers) {
    const free = Math.max(0, l.qty - skip);
    skip = Math.max(0, skip - l.qty);
    const take = Math.min(free, left);
    cost += take * l.rate;
    left -= take;
  }
  return r4(cost);
}

async function scenario(ctx: DemoContext) {
  const cls = ctx.app.get(ClsService);
  const db = cls.get<MySql2Database<typeof schema>>('tenantDb')!;
  const batches = ctx.app.get(BatchService);
  const schedulers = ctx.app.get(SchedulerHeaderService);
  const daily = ctx.app.get(BatchDailyDataService);
  const ledger = ctx.app.get(InventoryLedgerService);
  const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, tenantId: ctx.tenantId, email: ctx.actor.email };

  console.log('\n[1] Receiving the costing test items');
  await costingScenariosChapter.run(ctx);

  const items = await db
    .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, valuation_method: schema.itemMaster.valuation_method, is_lot_tracked: schema.itemMaster.is_lot_tracked })
    .from(schema.itemMaster)
    .where(and(inArray(schema.itemMaster.item_name, COSTING_TEST_ITEMS.map((i) => i.name)), eq(schema.itemMaster.company_id, ctx.companyId), isNull(schema.itemMaster.deleted_at)));
  const byKey = new Map(COSTING_TEST_ITEMS.map((c) => [c.key, items.find((i) => i.item_name === c.name)!]));
  const A = byKey.get('COST-FIFO-PLAIN')!, B = byKey.get('COST-FIFO-LOT')!, C = byKey.get('COST-AVG-PLAIN')!, D = byKey.get('COST-AVG-LOT')!;
  check('items: A FIFO/untracked, B FIFO/lot, C AVG/untracked, D AVG/lot',
    [A, B, C, D].map((i) => [i.valuation_method, !!i.is_lot_tracked]),
    [['FIFO', false], ['FIFO', true], ['AVG', false], ['AVG', true]]);

  const storeOf = async (farmCode: string) => {
    const farm = ctx.demoFarms.find((f) => f.code === farmCode);
    if (!farm) throw new Error(`demo farm ${farmCode} is not in this run — set DEMO_FARMS=MUL100,POR100.`);
    const [store] = await db.select({ id: schema.locationMaster.location_id }).from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.parent_location_id, farm.farmId), eq(schema.locationMaster.location_name, 'Demo Medicine Store')));
    return { farm, storeId: store.id };
  };

  const stockOf = async (storeId: string, itemId: string) => {
    const [row] = await ledger.getStockBalance({ companyId: ctx.companyId, warehouseId: storeId, itemId } as any, ctx.tenantId);
    return { qty: Number(row?.on_hand_qty ?? 0), value: r4(Number(row?.on_hand_value ?? 0)) };
  };
  const lotsOf = async (storeId: string, itemId: string) =>
    Object.fromEntries((await ledger.getAvailableLots({ itemId, warehouseId: storeId } as any, ctx.tenantId)).map((l: any) => [l.lot_no, Number(l.remaining_quantity)]));

  /** The consumption entries of one item, oldest first, with where each was costed from and which lots it left. */
  const issuesOf = async (itemId: string, warehouseId: string) => {
    const rows = await db.select().from(schema.inventoryLedger)
      .where(and(eq(schema.inventoryLedger.item_id, itemId), eq(schema.inventoryLedger.warehouse_id, warehouseId), eq(schema.inventoryLedger.entry_type, 'NEGATIVE')))
      .orderBy(asc(schema.inventoryLedger.entry_no));
    const out: any[] = [];
    for (const row of rows) {
      const d: any = await ledger.findOneWithDetails(row.ledger_id, ctx.tenantId);
      out.push({
        entry_no: row.entry_no,
        cost: r4(-Number(row.amount)),
        qty: -Number(row.quantity),
        from: d.applications.map((a: any) => `#${a.inbound_entry_no}:${Number(a.applied_qty)}=${Number(a.applied_cost_amount)}`),
        lots: d.lots.map((l: any) => `${l.lot_no}:${l.quantity}`),
        animals: d.animals.length,
        animalCostSum: r4(d.animals.reduce((n: number, a: any) => n + Math.abs(Number(a.amount)), 0)),
      });
    }
    return out;
  };

  // Drafts per line (and per animal), then the stage's day is posted — exactly the Data Entry screen.
  const addLines = async (headerId: string, qtyBasis: 'PER_HEAD' | 'TOTAL_BATCH', standardQty: number) => {
    const lineOf = new Map<string, string>();
    for (const [key, item] of byKey) {
      const header = await schedulers.addLine(headerId, {
        line_type: 'CONSUMPTION', activity_name: `Costing ${key}`, item_id: item.item_id,
        standard_qty: standardQty, qty_basis: qtyBasis, occurrence: 'DAILY', start_day: 1, allow_qty_edit: true,
      } as any, ctx.tenantId, actor);
      const added = (header as any).lines.find((l: any) => l.activity_name === `Costing ${key}`);
      lineOf.set(key, added.line_id);
    }
    return lineOf;
  };
  const draft = (batchId: string, lineId: string, date: string, value: number, extra: object = {}) =>
    daily.postEntry(batchId, { line_id: lineId, entry_date: date, entered_value: value, draft: true, ...extra } as any, ctx.tenantId, actor);

  // The stage's own mandatory lines (the lifecycle's feed, mortality ...) must be entered before a day can post,
  // so they are drafted at their standard value, the way a user would just accept them.
  const draftMandatory = async (batchId: string, headerId: string, date: string, animalIds: Array<string | undefined>, ownLineIds: string[]) => {
    const header: any = await schedulers.findOne(headerId);
    for (const line of header.lines.filter((l: any) => l.is_mandatory && l.is_active && !ownLineIds.includes(l.line_id))) {
      const value = line.line_type === 'CONSUMPTION' ? Number(line.standard_qty ?? 1) : Number(line.std_value ?? 0);
      for (const animalId of animalIds) await draft(batchId, line.line_id, date, value, animalId ? { animal_id: animalId } : {});
    }
  };

  // ───────────────────────────── Animal Wise ─────────────────────────────
  console.log('\n[2] ANIMAL WISE batch (MUL100): 3 animals, per-head consumption, two days');
  {
    const { farm, storeId } = await storeOf('MUL100');
    const breed = batchBreedOf(farm)!;
    const animals = await db.select({ animal_id: schema.animalRegister.animal_id, stage: schema.animalRegister.current_stage_id, loc: schema.animalRegister.current_location_id })
      .from(schema.animalRegister)
      .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.animalRegister.current_location_id))
      .where(and(isNull(schema.animalRegister.current_batch_id), eq(schema.locationMaster.farm_id, farm.farmId)));
    const stageId = animals.map((a) => a.stage).filter(Boolean).find((s) => animals.filter((a) => a.stage === s).length >= 2);
    const group = animals.filter((a) => a.stage === stageId);
    if (!stageId || group.length < 2) throw new Error('MUL100 has no two free registered animals in one stage to build a batch from — run pnpm seed first.');
    const heads = group.length;
    const [pen] = await db.select({ parent: schema.locationMaster.parent_location_id }).from(schema.locationMaster).where(eq(schema.locationMaster.location_id, group[0].loc!));
    const created = await batches.create({
      company_id: ctx.companyId, lob_id: '60000000-6000-6000-6000-000000000007', tracking_mode: 'ANIMAL_WISE', costing_method: 'BIO_ASSET',
      breed_id: breed.breedId, shed_id: pen.parent!, start_date: daysAgo(1), uom: 'HEAD', remarks: 'COSTING-REHEARSAL animal wise', animal_ids: group.map((a) => a.animal_id),
    } as any, ctx.tenantId);
    await db.update(schema.batchHeader).set({ farm_id: farm.farmId }).where(eq(schema.batchHeader.batch_id, created.batch_id));
    await batches.activate(created.batch_id, ctx.tenantId);
    const [header] = await db.select().from(schema.schedulerHeader).where(and(eq(schema.schedulerHeader.batch_id, created.batch_id), eq(schema.schedulerHeader.stage_id, stageId)));
    const lineOf = await addLines(header.scheduler_id, 'PER_HEAD', 10);

    // Day 1: 10 kg a head. Day 2: 170 a head — enough to cross from receipt 1 into receipt 2, and from lot to lot.
    const day1 = daysAgo(1), day2 = today();
    const per = { d1: 10, d2: 170 };
    for (const [date, perHead, lotFor] of [
      [day1, per.d1, { 'COST-FIFO-LOT': undefined, 'COST-AVG-LOT': 'LOT-1' }],
      [day2, per.d2, { 'COST-FIFO-LOT': undefined, 'COST-AVG-LOT': 'LOT-3,LOT-2' }],
    ] as const) {
      await draftMandatory(created.batch_id, header.scheduler_id, date, group.map((a) => a.animal_id), [...lineOf.values()]);
      for (const [key, lineId] of lineOf) {
        for (const a of group) {
          await draft(created.batch_id, lineId, date, perHead, { animal_id: a.animal_id, ...((lotFor as any)[key] ? { lot_no: (lotFor as any)[key] } : {}) });
        }
      }
      await batches.postStageDay(created.batch_id, stageId, date, ctx.tenantId, actor as any);
    }

    const kg1 = heads * per.d1, kg2 = heads * per.d2;
    const results: Array<[string, typeof A, 'FIFO' | 'AVG']> = [['A  FIFO  not tracked', A, 'FIFO'], ['B  FIFO  lot tracked', B, 'FIFO'], ['C  AVG   not tracked', C, 'AVG'], ['D  AVG   lot tracked', D, 'AVG']];
    for (const [label, item, method] of results) {
      const issues = await issuesOf(item.item_id, storeId);
      console.log(`\n  ${label} — entries: ${JSON.stringify(issues.map((i) => ({ no: i.entry_no, kg: i.qty, cost: i.cost, from: i.from, lots: i.lots })))}`);
      check(`${label}: one ledger entry per day (activity), not one per animal`, issues.length, 2);
      check(`${label}: day 1 cost for ${kg1} kg`, issues[0]?.cost, expectedCost(method, kg1, 0));
      check(`${label}: day 2 cost for ${kg2} kg (crosses receipts)`, issues[1]?.cost, expectedCost(method, kg2, kg1));
      check(`${label}: every animal has its share, shares add up to the entry`, [issues[0]?.animals, issues[1]?.animals, issues[0]?.animalCostSum, issues[1]?.animalCostSum], [heads, heads, issues[0]?.cost, issues[1]?.cost]);
      const costedFrom = (i: { from: string[] } | undefined) => i?.from.length;
      if (method === 'FIFO') check(`${label}: FIFO takes day 2 from two receipt entries (oldest first)`, costedFrom(issues[1]), 2);
      const stock = await stockOf(storeId, item.item_id);
      const totalIn = 500 * COSTING_RECEIPTS.length;
      const valueIn = COSTING_RECEIPTS.reduce((n, r) => n + 500 * r.rate, 0);
      check(`${label}: stock on hand ${totalIn - kg1 - kg2} kg`, stock.qty, totalIn - kg1 - kg2);
      check(`${label}: stock value = value received − cost issued`, stock.value, r4(valueIn - expectedCost(method, kg1, 0) - expectedCost(method, kg2, kg1)));
    }

    console.log('\n  Lots (near expiry first, price unaffected):');
    const issuesB = await issuesOf(B.item_id, storeId);
    check('B: day 1 left LOT-2 (nearest expiry, newer receipt) though FIFO priced it from receipt 1', issuesB[0]?.lots, [`LOT-2:${kg1}`]);
    check('B: day 2 left LOT-2 then LOT-3 (next nearest expiry) — two lots on one entry', issuesB[1]?.lots, [`LOT-2:${500 - kg1}`, `LOT-3:${kg2 - (500 - kg1)}`]);
    check('B: lot balances after', await lotsOf(storeId, B.item_id), { 'LOT-1': 500, 'LOT-3': 500 - (kg2 - (500 - kg1)) });
    const issuesD = await issuesOf(D.item_id, storeId);
    check('D: user-chosen lots honoured (day 1 LOT-1; day 2 LOT-3+LOT-2, filled nearest expiry first), priced at the average regardless', [issuesD[0]?.lots, issuesD[1]?.lots], [[`LOT-1:${kg1}`], ['LOT-2:500', `LOT-3:${kg2 - 500}`]]);
    check('D: lot balances after', await lotsOf(storeId, D.item_id), { 'LOT-1': 500 - kg1, 'LOT-3': 500 - (kg2 - 500) });

    console.log('\n  Receipt view (what the Inbound entry screen shows):');
    for (const [label, item] of [['A', A], ['B', B]] as const) {
      const [rec] = await db.select().from(schema.inventoryLedger)
        .where(and(eq(schema.inventoryLedger.item_id, item.item_id), eq(schema.inventoryLedger.warehouse_id, storeId), eq(schema.inventoryLedger.entry_type, 'POSITIVE')))
        .orderBy(asc(schema.inventoryLedger.entry_no)).limit(1);
      const d: any = await ledger.findOneWithDetails(rec.ledger_id, ctx.tenantId);
      console.log(`  ${label} receipt #${rec.entry_no}: consumed by ${JSON.stringify(d.applications.map((a: any) => `#${a.outbound_entry_no}:${Number(a.applied_qty)}`))}, lot issues ${JSON.stringify(d.lot_issues.map((x: any) => `#${x.entry_no}:${x.quantity}${x.lot_no ? `(${x.lot_no})` : ''}`))}`);
      check(`${label}: receipt 1 lists both days' entries as its consumers`, d.applications.length, 2);
    }
    const [recB] = await db.select().from(schema.inventoryLedger)
      .where(and(eq(schema.inventoryLedger.item_id, B.item_id), eq(schema.inventoryLedger.warehouse_id, storeId), eq(schema.inventoryLedger.lot_no, 'LOT-2'), eq(schema.inventoryLedger.entry_type, 'POSITIVE')));
    const dB: any = await ledger.findOneWithDetails(recB.ledger_id, ctx.tenantId);
    check('B: the LOT-2 receipt lists the entries that physically issued from LOT-2', dB.lot_issues.map((x: any) => x.quantity), [-kg1, -(500 - kg1)]);
  }

  // ───────────────────────────── Batch Wise ─────────────────────────────
  console.log('\n[3] BATCH WISE batch (POR100): headcount, TOTAL_BATCH consumption, one day');
  {
    const { farm, storeId } = await storeOf('POR100');
    const breed = batchBreedOf(farm)!;
    const stageId = breed.lifecycleStages.get('WEANER');
    if (!stageId) throw new Error('POR100 breed has no WEANER lifecycle stage.');
    const piglet = await createItemLookup(db, ctx.companyId)('Weaned Feeder Piglet (7-10kg)');
    const batchId = await createBatchEnsurer(db, batches, ctx)({
      ref: 'COSTING-REHEARSAL batch wise', farm, stageId, stageCode: 'WEANER', breedId: breed.breedId, startDate: daysAgo(1), openingQuantity: 50,
      inputLines: [{ item_id: piglet.item_id, quantity: 50, uom: 'HEAD', rate: Number(piglet.standard_cost ?? 0) || undefined }],
    });
    const [header] = await db.select().from(schema.schedulerHeader).where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.stage_id, stageId)));
    const lineOf = await addLines(header.scheduler_id, 'TOTAL_BATCH', 100);
    for (const date of [daysAgo(1), today()]) {
      await draftMandatory(batchId, header.scheduler_id, date, [undefined], [...lineOf.values()]);
      for (const [, lineId] of lineOf) await draft(batchId, lineId, date, 100);
      await batches.postBatchDay(batchId, date, ctx.tenantId, actor as any);
    }
    for (const [label, item, method] of [['A FIFO plain', A, 'FIFO'], ['B FIFO lot', B, 'FIFO'], ['C AVG plain', C, 'AVG'], ['D AVG lot', D, 'AVG']] as const) {
      const issues = await issuesOf(item.item_id, storeId);
      console.log(`  ${label}: ${JSON.stringify(issues.map((i) => ({ no: i.entry_no, kg: i.qty, cost: i.cost, from: i.from, lots: i.lots })))}`);
      check(`${label}: one entry a day, 100 kg, cost by method`, issues.map((i) => [i.qty, i.cost]), [[100, expectedCost(method, 100, 0)], [100, expectedCost(method, 100, 100)]]);
    }
    check('B/D batch-wise (no lot named) take the nearest-expiry lot, LOT-2, both days', [(await issuesOf(B.item_id, storeId)).map((i) => i.lots), (await issuesOf(D.item_id, storeId)).map((i) => i.lots)], [[['LOT-2:100'], ['LOT-2:100']], [['LOT-2:100'], ['LOT-2:100']]]);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} — rolling back, nothing was kept.`);
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

void main().then(
  () => process.exit(failures === 0 ? 0 : 1),
  (err) => { console.error(err instanceof Error ? err.stack ?? err.message : err); process.exit(1); },
);
