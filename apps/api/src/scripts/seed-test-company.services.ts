/**
 * The service half of seed-test-company.ts. Everything operational is created through the application's own
 * services inside the CLS context TenantMiddleware builds for a request (tenantId + tenantDb), exactly as the demo
 * chapters do (demo/harness.ts, demo/chapters/03 and 04) - never a hand-written code, never a raw operational insert.
 *
 * The one write that is not a service call is stated where it happens (assigning the registered animals of batch B):
 * AnimalService refuses to place an animal in a count-only batch, and the app has no other way to give a batch-wise
 * batch registered animals.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { INestApplicationContext } from '@nestjs/common';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import { BatchService } from '../modules/production/batch/batch.service';
import { BatchDailyDataService } from '../modules/production/batch-daily-data/batch-daily-data.service';
import { AnimalService } from '../modules/piggery/animal/animal.service';
import { GoodsReceiptService } from '../modules/inventory/goods-receipt/goods-receipt.service';
import { StockTransferService } from '../modules/inventory/stock-transfer/stock-transfer.service';
import { ReasonService } from '../modules/master-data/reason/reason.service';
import { CostCenterService } from '../modules/finance/cost-center/cost-center.service';
import { seedLocation, type SeededLocation } from './lib/seed-location';
import { assertFourFarmFixture } from './demo/four-farm-feed-fixture';
import { createItemLookup, rateOf } from './demo/batch-helpers';
import {
  FEED_ITEM_NAME, ITEM_SOW, ITEM_WEANED, MORTALITY_REASON_NAMES, SILO_TOPOLOGY, batchesForFarm, bodyWeightKg, dateOffset,
  deadWeightKg, deathsOn, feedFactor, feedReceiptKg, genderFor, historyDates, placeBatchesInSheds, spreadOverStages,
  type BatchKind, type BatchSpec, type FeedHandle, type TestCompanyPlan,
} from './seed-test-company.lib';

type Db = MySql2Database<typeof schema>;

export interface Actor { userId: string; userType: string; tenantId: string; email: string }
export interface ServiceRun {
  app: INestApplicationContext;
  tenantId: string;
  companyId: string;
  nobId: string | null;
  lobId: string | null;
  actor: Actor;
  today: string;
  days: number;
  log: (line: string) => void;
}

export interface FarmInfo {
  no: number;
  name: string;
  farmId: string;
  code: string;
  storeId: string;
  costCenterId: string;
  sheds: Array<{ no: number; id: string; code: string; penIds: string[] }>;
  silos: Array<{ n: number; id: string; code: string; feed: FeedHandle; capacityKg: number }>;
}

export interface BatchInfo { spec: BatchSpec; batchId: string; batchNo: string; stageId: string; stageCode: string; shedNo: number }

const dbOf = (run: ServiceRun): Db => {
  const db = run.app.get(ClsService).get<Db>('tenantDb');
  if (!db) throw new Error('tenantDb is not set - run through runInTenant.');
  return db;
};
const asUser = (a: Actor) => ({ ...a }) as any;

/** Run `work` in a CLS context with tenantDb/tenantId set the way TenantMiddleware sets them for a request. */
export async function runInTenant<T>(app: INestApplicationContext, tenantDb: Db, tenantId: string, work: () => Promise<T>): Promise<T> {
  const cls = app.get(ClsService);
  return cls.run(async () => {
    cls.set('tenantId', tenantId);
    cls.set('tenantDb', tenantDb);
    return work();
  });
}

// ---------------------------------------------------------------------------
// Mortality reasons
// ---------------------------------------------------------------------------
export async function ensureMortalityReasons(run: ServiceRun): Promise<string[]> {
  const db = dbOf(run);
  const reasons = run.app.get(ReasonService);
  const existing = await db.select().from(schema.reasonMaster).where(and(
    eq(schema.reasonMaster.company_id, run.companyId), eq(schema.reasonMaster.category, 'MORTALITY'),
    eq(schema.reasonMaster.is_active, true), isNull(schema.reasonMaster.deleted_at),
  ));
  const have = new Set(existing.map((r) => r.reason_name.trim().toLowerCase()));
  // The source may carry some of the three already; create only what is missing. If it carries none, all three.
  for (const name of MORTALITY_REASON_NAMES) {
    if (have.has(name.toLowerCase())) continue;
    await reasons.create({ company_id: run.companyId, reason_name: name, category: 'MORTALITY' } as any, run.tenantId, asUser(run.actor));
    run.log(`  mortality reason created through ReasonService: ${name}`);
  }
  const all = await db.select({ id: schema.reasonMaster.reason_id }).from(schema.reasonMaster).where(and(
    eq(schema.reasonMaster.company_id, run.companyId), eq(schema.reasonMaster.category, 'MORTALITY'),
    eq(schema.reasonMaster.is_active, true), isNull(schema.reasonMaster.deleted_at),
  )).orderBy(schema.reasonMaster.reason_code);
  return all.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Structure: farms, sheds, pens, silos, store, cost centres
// ---------------------------------------------------------------------------
export async function seedStructure(run: ServiceRun, plan: TestCompanyPlan): Promise<FarmInfo[]> {
  const db = dbOf(run);
  assertFourFarmFixture(plan.fixture);
  const ctx = { tenantId: run.tenantId, companyId: run.companyId, nobId: run.nobId, lobId: run.lobId };
  const costCentres = run.app.get(CostCenterService);

  // The department every farm sits under: the copied "Farm Operations" DEPARTMENT cost centre, else the first one.
  const departments = await db.select().from(schema.costCenterMaster).where(and(
    eq(schema.costCenterMaster.company_id, run.companyId), eq(schema.costCenterMaster.cost_center_type, 'DEPARTMENT'),
    eq(schema.costCenterMaster.is_active, true), isNull(schema.costCenterMaster.deleted_at),
  ));
  let department = departments.find((d) => /farm operations/i.test(d.cost_center_name)) ?? departments[0];
  if (!department) {
    department = await costCentres.create({ company_id: run.companyId, cost_center_code: 'TEST-DEPT-OPS', cost_center_name: 'TEST Farm Operations', cost_center_type: 'DEPARTMENT' } as any, run.tenantId, asUser(run.actor)) as any;
    run.log('  no DEPARTMENT cost centre was copied - created "TEST Farm Operations"');
  }

  const out: FarmInfo[] = [];
  for (const farm of plan.fixture.farms) {
    const no = Number(farm.key.replace('FARM', ''));
    const place = (key: string, name: string, type: any, parent: SeededLocation | null, extras: Record<string, any> = {}) =>
      seedLocation(db, ctx as any, { key, name, type, parent, ...extras });
    const farmLoc = await place(farm.key, farm.name, 'FARM', null);
    const info: FarmInfo = { no, name: farm.name, farmId: farmLoc.id, code: farmLoc.code, storeId: '', costCenterId: '', sheds: [], silos: [] };
    const byKey = new Map<string, string>();
    for (const shed of farm.sheds) {
      const shedLoc = await place(shed.key, shed.name, 'SHED', farmLoc, { capacity: shed.capacity });
      byKey.set(shed.key, shedLoc.id);
      const penIds: string[] = [];
      for (const pen of shed.pens) penIds.push((await place(pen.key, pen.name, 'PEN', shedLoc, { capacity: pen.capacity })).id);
      info.sheds.push({ no: Number(shed.key.split('SHED')[1]), id: shedLoc.id, code: shedLoc.code, penIds });
    }
    for (const silo of farm.silos) {
      const loc = await place(silo.key, silo.name, 'SILO', farmLoc, {
        storageType: 'SILO', siloCapacityKg: silo.siloCapacityKg, siloCapacityUom: silo.siloCapacityUom, siloReorderDays: silo.siloReorderDays,
      });
      const spec = SILO_TOPOLOGY[no].find((s) => `F${no}-SILO${s.n}` === silo.key)!;
      info.silos.push({ n: spec.n, id: loc.id, code: loc.code, feed: spec.feed, capacityKg: silo.siloCapacityKg });
      for (const shedKey of farm.links[silo.key]) {
        await db.insert(schema.siloShedLink).values({
          link_id: crypto.randomUUID(), tenant_id: run.tenantId, company_id: run.companyId, silo_id: loc.id, shed_id: byKey.get(shedKey)!,
        }).onDuplicateKeyUpdate({ set: { silo_id: loc.id } });
      }
    }
    info.storeId = (await place(`F${no}-STORE`, `${farm.name} Store`, 'STORE', farmLoc, { storageType: 'STORE' })).id;

    const cc: any = await costCentres.create({ company_id: run.companyId, cost_center_code: `TEST-FARM-${no}`, cost_center_name: `${farm.name} Cost Centre`, cost_center_type: 'FARM' } as any, run.tenantId, asUser(run.actor));
    info.costCenterId = cc.cost_center_id;
    await db.update(schema.locationMaster).set({ cost_center_id: cc.cost_center_id, department_id: department.cost_center_id }).where(eq(schema.locationMaster.location_id, farmLoc.id));
    run.log(`  ${farm.name} (${farmLoc.code}): ${info.sheds.length} sheds, ${info.sheds.reduce((n, s) => n + s.penIds.length, 0)} pens, ${info.silos.length} silos, store, cost centre ${cc.cost_center_code}`);
    out.push(info);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batches and animals
// ---------------------------------------------------------------------------
interface Masters {
  breedId: string;
  breedStages: Set<string>;
  stageIds: Map<string, string>;
}

async function loadMasters(run: ServiceRun): Promise<Masters> {
  const db = dbOf(run);
  const breeds = await db.select().from(schema.breedMaster).where(and(
    eq(schema.breedMaster.company_id, run.companyId), eq(schema.breedMaster.is_active, true), isNull(schema.breedMaster.deleted_at)));
  const stages = await db.select().from(schema.stageMaster).where(and(
    eq(schema.stageMaster.company_id, run.companyId), eq(schema.stageMaster.is_active, true), isNull(schema.stageMaster.deleted_at)));
  const stageIds = new Map(stages.map((s) => [s.stage_code, s.stage_id]));
  const codeOf = new Map(stages.map((s) => [s.stage_id, s.stage_code]));
  const lifecycle = await db.select({ breed_id: schema.breedLifecycleStages.breed_id, stage_id: schema.breedLifecycleStages.stage_id })
    .from(schema.breedLifecycleStages).where(and(eq(schema.breedLifecycleStages.company_id, run.companyId), eq(schema.breedLifecycleStages.is_active, true)));
  const stagesOf = (breedId: string) => new Set(lifecycle.filter((l) => l.breed_id === breedId).map((l) => codeOf.get(l.stage_id)!).filter(Boolean));
  const wanted = ['GESTATION', 'FARROWING', 'LACTATION', 'WEANER'];
  const score = (b: (typeof breeds)[number]) => wanted.filter((w) => stagesOf(b.breed_id).has(w)).length * 10 + (b.breed_code === 'Z-Line-Sow' ? 5 : 0);
  const breed = [...breeds].sort((a, b) => score(b) - score(a))[0];
  if (!breed || score(breed) < 40) throw new Error('No active breed in the copied masters has breed lifecycle rows for GESTATION, FARROWING, LACTATION and WEANER.');
  return { breedId: breed.breed_id, breedStages: stagesOf(breed.breed_id), stageIds };
}

export async function seedBatches(run: ServiceRun, farms: FarmInfo[]): Promise<BatchInfo[]> {
  const db = dbOf(run);
  const batches = run.app.get(BatchService);
  const animals = run.app.get(AnimalService);
  const item = createItemLookup(db, run.companyId);
  const m = await loadMasters(run);
  const sow = await item(ITEM_SOW);
  const weaned = await item(ITEM_WEANED);
  const startDate = dateOffset(run.today, run.days);
  const entryDate = dateOffset(startDate, 30);
  const lobId = run.lobId!;
  const stageOf = (code: string) => {
    const id = m.stageIds.get(code);
    if (!id) throw new Error(`Stage ${code} is not in the copied masters.`);
    return id;
  };
  const stageRows = await db.select().from(schema.stageMaster).where(eq(schema.stageMaster.company_id, run.companyId));
  const genderRule = new Map(stageRows.map((s) => [s.stage_id, s.applicable_gender]));
  const out: BatchInfo[] = [];

  const registerAnimal = async (a: { type: 'SOW' | 'PIGLET'; itemRow: { item_id: string; standard_cost: string | null }; gender: 'F' | 'M'; stageId: string; penId: string; ageWeeks: number; teats?: number }) =>
    animals.create({
      // Named outright: the service can only infer the business line from one active operational area.
      company_id: run.companyId, nob_id: run.nobId ?? undefined, lob_id: run.lobId ?? undefined,
      animal_type: a.type, breed_id: m.breedId, gender: a.gender, entry_type: 'PURCHASED_LOCAL',
      entry_date: entryDate, dob: dateOffset(entryDate, a.ageWeeks * 7), item_id: a.itemRow.item_id,
      acquisition_cost: Number(a.itemRow.standard_cost ?? 0), current_location_id: a.penId, current_stage_id: a.stageId,
      ...(a.teats ? { no_of_teats: a.teats } : {}),
    } as any, run.tenantId, asUser(run.actor)) as Promise<{ animal_id: string }>;

  for (const farm of farms) {
    const specs = batchesForFarm(farm.no);
    const placement = placeBatchesInSheds(farm.no, specs);
    for (const spec of specs) {
      const shed = farm.sheds.find((s) => s.no === placement.get(spec.kind))!;
      let stageCode: string;
      let batchId: string;
      if (spec.kind === 'A') {
        const stages = ['GESTATION', 'FARROWING', 'LACTATION'].filter((c) => m.breedStages.has(c));
        stageCode = stages[0];
        const spread = spreadOverStages(spec.animals, stages);
        const ids: string[] = [];
        for (let i = 0; i < spec.animals; i += 1) {
          const code = spread[i];
          const a = await registerAnimal({
            type: 'SOW', itemRow: sow, gender: genderFor(genderRule.get(stageOf(code)), i, 'F'), stageId: stageOf(code),
            penId: shed.penIds[i % shed.penIds.length], ageWeeks: 104 + (i % 12), teats: 14 + (i % 3),
          });
          ids.push(a.animal_id);
        }
        const created: any = await batches.create({
          company_id: run.companyId, lob_id: lobId, tracking_mode: 'ANIMAL_WISE', costing_method: 'BIO_ASSET', breed_id: m.breedId,
          shed_id: shed.id, start_date: startDate, uom: 'HEAD', remarks: spec.remarks, animal_ids: ids,
        } as any, run.tenantId, asUser(run.actor));
        batchId = created.batch_id;
        await batches.activate(batchId, run.tenantId, asUser(run.actor));
        // Every stage's scheduler begins on the batch's start date, as the demo does: these sows were placed in their
        // stages at the start, so the history covers every stage from day one.
        await db.update(schema.schedulerHeader).set({ effective_from: startDate }).where(eq(schema.schedulerHeader.batch_id, batchId));
        out.push({ spec, batchId, batchNo: created.batch_no, stageId: stageOf(stageCode), stageCode, shedNo: shed.no });
      } else {
        const wanted = spec.kind === 'D' ? ['GILT_GROWER', 'GROWER', 'WEANER'] : ['WEANER'];
        stageCode = wanted.find((c) => m.breedStages.has(c)) ?? 'WEANER';
        const created: any = await batches.create({
          company_id: run.companyId, lob_id: lobId, tracking_mode: 'BATCH_WISE', costing_method: 'BIO_ASSET', breed_id: m.breedId,
          stage_id: stageOf(stageCode), shed_id: shed.id, auto_generate_scheduler: true, start_date: startDate,
          opening_quantity: spec.openingHead, uom: 'HEAD', remarks: spec.remarks,
          input_lines: [{ item_id: weaned.item_id, quantity: spec.openingHead, uom: 'HEAD', rate: rateOf(weaned.standard_cost) }],
        } as any, run.tenantId, asUser(run.actor));
        batchId = created.batch_id;
        await batches.activate(batchId, run.tenantId, asUser(run.actor));
        await db.update(schema.schedulerHeader).set({ effective_from: startDate }).where(eq(schema.schedulerHeader.batch_id, batchId));
        if (spec.kind === 'B') {
          // Batch B: a count-only-created batch that also has registered animals standing in its stage. The animals are
          // registered through AnimalService (unassigned, in a pen of the batch's shed); AnimalService refuses to place
          // an animal in a count-only batch, so the assignment is the one direct write of this script.
          for (let i = 0; i < spec.animals; i += 1) {
            const a = await registerAnimal({
              type: 'PIGLET', itemRow: weaned, gender: genderFor(genderRule.get(stageOf(stageCode)), i, 'ALT'), stageId: stageOf(stageCode),
              penId: shed.penIds[i % shed.penIds.length], ageWeeks: 8 + (i % 3),
            });
            await db.update(schema.animalRegister).set({ current_batch_id: batchId }).where(eq(schema.animalRegister.animal_id, a.animal_id));
          }
        }
        out.push({ spec, batchId, batchNo: created.batch_no, stageId: stageOf(stageCode), stageCode, shedNo: shed.no });
      }
      const [{ h }] = await db.select({ h: sql<number>`COUNT(*)` }).from(schema.schedulerHeader).where(eq(schema.schedulerHeader.batch_id, batchId));
      const [{ lines }] = await db.select({ lines: sql<number>`COUNT(${schema.schedulerLine.line_id})` }).from(schema.schedulerHeader)
        .innerJoin(schema.schedulerLine, eq(schema.schedulerLine.scheduler_id, schema.schedulerHeader.scheduler_id)).where(eq(schema.schedulerHeader.batch_id, batchId));
      run.log(`  ${farm.name} batch ${spec.kind} ${out[out.length - 1].batchNo} (${spec.tracking}, ${stageCode}, shed ${shed.code}): ${h} scheduler(s), ${lines} line(s)`);
      if (Number(lines) === 0) throw new Error(`Batch ${out[out.length - 1].batchNo} has schedulers with no lines - Data Entry could not post. Breed lifecycle rows are missing for ${stageCode}.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------
export async function seedStock(run: ServiceRun, farms: FarmInfo[], batches: BatchInfo[]): Promise<Map<string, string>> {
  const db = dbOf(run);
  const receipts = run.app.get(GoodsReceiptService);
  const transfers = run.app.get(StockTransferService);
  const item = createItemLookup(db, run.companyId);
  const handleItem = new Map<FeedHandle, { item_id: string; standard_cost: string | null }>();
  for (const h of Object.keys(FEED_ITEM_NAME) as FeedHandle[]) handleItem.set(h, await item(FEED_ITEM_NAME[h]));
  const postingDate = dateOffset(run.today, run.days + 1);
  const lots = new Map<string, string>(); // `${farmNo}|${itemId}` -> lot
  const costOf = new Map<string, number | undefined>();

  const receive = async (ref: string, warehouseId: string, itemId: string, qty: number, lot: string, why: string) => {
    if (!costOf.has(itemId)) {
      const [r] = await db.select({ c: schema.itemMaster.standard_cost }).from(schema.itemMaster).where(eq(schema.itemMaster.item_id, itemId)).limit(1);
      costOf.set(itemId, rateOf(r?.c));
    }
    const created: any = await receipts.create({
      company_id: run.companyId, warehouse_id: warehouseId, posting_date: postingDate, external_reference_no: ref,
      remarks: `TEST COMPANY opening stock - ${why}`,
      lines: [{ item_id: itemId, quantity: qty, uom: 'KG', rate: costOf.get(itemId), lot_no: lot }],
    } as any, run.tenantId);
    await receipts.post(created.receipt_id, run.tenantId);
  };

  for (const farm of farms) {
    const mine = batches.filter((b) => b.spec.farmNo === farm.no);
    // Upper-bound demand of the window per item: standard x head count x days, over every feed line of the farm's schedulers.
    const rows = await db.select({
      item_id: schema.schedulerLine.item_id, std: schema.schedulerLine.standard_qty, heads: schema.schedulerHeader.animal_count, basis: schema.schedulerLine.qty_basis,
    }).from(schema.schedulerLine)
      .innerJoin(schema.schedulerHeader, eq(schema.schedulerHeader.scheduler_id, schema.schedulerLine.scheduler_id))
      .where(and(inArray(schema.schedulerHeader.batch_id, mine.map((b) => b.batchId)), eq(schema.schedulerLine.line_type, 'CONSUMPTION')));
    const demand = new Map<string, number>();
    for (const r of rows) {
      if (!r.item_id || r.std == null) continue;
      const perDay = r.basis && r.basis !== 'PER_HEAD' ? Number(r.std) : Number(r.std) * Number(r.heads ?? 0);
      demand.set(r.item_id, (demand.get(r.item_id) ?? 0) + perDay * run.days);
    }
    // The three diets the silos hold are always stocked, even if a scheduler does not name one.
    for (const h of handleItem.values()) if (!demand.has(h.item_id)) demand.set(h.item_id, 0);
    const itemIds = [...demand.keys()].sort();
    itemIds.forEach((id, i) => lots.set(`${farm.no}|${id}`, `LOT-F${farm.no}-${i + 1}`));

    // Feed reaches a silo only through a transfer receipt (the app refuses a GRN into a silo), so each farm's store
    // receives what the store keeps plus what its silos will be filled with, then ships and receives it to each silo.
    const siloFill = new Map<string, number>();
    for (const silo of farm.silos) {
      const feedId = handleItem.get(silo.feed)!.item_id;
      siloFill.set(feedId, (siloFill.get(feedId) ?? 0) + Math.floor(silo.capacityKg * 0.6));
    }
    let seq = 0;
    for (const itemId of itemIds) {
      const lot = lots.get(`${farm.no}|${itemId}`)!;
      const qty = feedReceiptKg(demand.get(itemId)!, null, 5000) + (siloFill.get(itemId) ?? 0);
      await receive(`TESTCO-F${farm.no}-STORE-${(seq += 1)}`, farm.storeId, itemId, qty, lot, `${farm.name} store`);
    }
    for (const silo of farm.silos) {
      const feed = handleItem.get(silo.feed)!;
      const lot = lots.get(`${farm.no}|${feed.item_id}`)!;
      const qty = Math.floor(silo.capacityKg * 0.6);
      const token = `TESTCO-F${farm.no}-SILO${silo.n}-FILL`;
      const created: any = await transfers.create({
        company_id: run.companyId, from_warehouse_id: farm.storeId, to_warehouse_id: silo.id, posting_date: postingDate, remarks: token,
        lines: [{ item_id: feed.item_id, quantity: qty, uom: 'KG', lot_no: lot, remarks: 'TEST COMPANY silo fill' }],
      } as any, run.tenantId, asUser(run.actor));
      await transfers.ship(created.transfer_id, { posting_date: postingDate, vehicle_no: 'TEST-TRK-01', driver_name: 'Test driver', waybill_ref: token, remarks: token } as any, run.tenantId, asUser(run.actor));
      const detail: any = await transfers.findOne(created.transfer_id);
      await transfers.receive(created.transfer_id, {
        posting_date: postingDate, remarks: token,
        lines: (detail.lines ?? []).map((l: any) => ({ line_id: l.line_id, received_quantity: qty })),
      } as any, run.tenantId, asUser(run.actor));
    }
    run.log(`  ${farm.name}: store stocked with ${itemIds.length} feed item(s), ${farm.silos.length} silo(s) filled to 60% of capacity`);
  }
  return lots;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export interface BatchResult { batchNo: string; kind: BatchKind; farmNo: number; postedDays: number; stoppedAt?: string; reason?: string }

export async function postHistory(run: ServiceRun, farms: FarmInfo[], batches: BatchInfo[], lots: Map<string, string>, reasonIds: string[]): Promise<BatchResult[]> {
  const db = dbOf(run);
  const entries = run.app.get(BatchDailyDataService);
  const svc = run.app.get(BatchService);
  const dates = historyDates(run.today, run.days);
  const results: BatchResult[] = [];
  const actor = asUser(run.actor);
  let deathCounter = 0;
  const reasonFor = (kind: BatchKind, i: number): { reason_id?: string; reason_text?: string } => {
    const useId = kind === 'A' ? false : kind === 'B' ? true : (deathCounter + i) % 2 === 0;
    return useId && reasonIds.length ? { reason_id: reasonIds[(deathCounter + i) % reasonIds.length] } : { reason_text: kind === 'A' ? 'Found dead in farrowing crate' : 'Found dead in pen' };
  };

  const aliveIn = async (batchId: string, stageId: string) => db.select({ animal_id: schema.animalRegister.animal_id, animal_code: schema.animalRegister.animal_code })
    .from(schema.animalRegister).where(and(
      eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.current_stage_id, stageId), eq(schema.animalRegister.is_active, true),
      sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
    )).orderBy(schema.animalRegister.animal_code);

  for (const b of batches) {
    const farm = farms.find((f) => f.no === b.spec.farmNo)!;
    const res: BatchResult = { batchNo: b.batchNo, kind: b.spec.kind, farmNo: b.spec.farmNo, postedDays: 0 };
    results.push(res);
    const lotOf = (itemId: string) => lots.get(`${farm.no}|${itemId}`);
    const feedValue = (line: any, heads: number, stageHeads: number, dayNo: number) => {
      const expected = Number((svc as any).computeExpectedQty(line, heads, stageHeads));
      return Math.round(expected * feedFactor(dayNo) * 100) / 100;
    };
    dayLoop: for (const [idx, date] of dates.entries()) {
      const dayNo = idx + 1;
      try {
        if (b.spec.tracking === 'BATCH_WISE') {
          const batch = await svc.findOne(b.batchId);
          const pairs: Array<{ header: any; line: any }> = await (svc as any).loadActiveScheduleLines(batch, date);
          const deaths = deathsOn(b.spec.kind, b.spec.farmNo, run.days, dayNo);
          for (const { header, line } of pairs) {
            const base = { line_id: line.line_id, entry_date: date, draft: true } as any;
            if (line.line_type === 'CONSUMPTION' && line.item_id) {
              const value = feedValue(line, Number(header.animal_count), Number(header.animal_count), dayNo);
              if (value > 0) await entries.postEntry(b.batchId, { ...base, entered_value: value, lot_no: lotOf(line.item_id) }, run.tenantId, actor);
            } else if (line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'MORTALITY_COUNT') {
              let mortality: any[] | undefined;
              if (deaths > 0) {
                const alive = b.spec.animals > 0 ? await aliveIn(b.batchId, header.stage_id) : [];
                mortality = Array.from({ length: deaths }, (_, i) => ({
                  ...(b.spec.animals > 0 ? { animal_id: alive[i]?.animal_id } : {}), dead_weight_kg: deadWeightKg(b.spec.kind, dayNo) + i, ...reasonFor(b.spec.kind, i),
                }));
                deathCounter += deaths;
              }
              await entries.postEntry(b.batchId, { ...base, entered_value: deaths, ...(mortality ? { mortality_animals: mortality } : {}) }, run.tenantId, actor);
            } else if (line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'BODY_WEIGHT') {
              await entries.postEntry(b.batchId, { ...base, entered_value: bodyWeightKg(b.spec.kind, dayNo) }, run.tenantId, actor);
            } else if (line.is_mandatory) {
              throw new Error(`mandatory line '${line.activity_name}' (${line.line_type}/${line.kpi_metric ?? '-'}) is not one the seed knows how to fill`);
            }
          }
          await svc.postBatchDay(b.batchId, date, run.tenantId, actor);
        } else {
          // ANIMAL_WISE: one entry per live animal per due line, per stage; each stage is posted on its own.
          const headers = await db.select().from(schema.schedulerHeader).where(eq(schema.schedulerHeader.batch_id, b.batchId)).orderBy(schema.schedulerHeader.stage_id);
          let dying: string | null = null;
          const toPost: string[] = [];
          const dayDeaths = deathsOn('A', b.spec.farmNo, run.days, dayNo);
          for (const header of headers) {
            const alive = await aliveIn(b.batchId, header.stage_id);
            if (!alive.length) continue;
            toPost.push(header.stage_id);
            if (dayDeaths > 0 && header.stage_id === b.stageId && alive.length > 2) dying = alive[2].animal_id;
            const pairs: Array<{ header: any; line: any }> = await (svc as any).loadScheduleLinesForHeader(header, date);
            for (const [ai, animal] of alive.entries()) {
              for (const { line } of pairs) {
                const base = { line_id: line.line_id, entry_date: date, animal_id: animal.animal_id, draft: true } as any;
                if (line.line_type === 'CONSUMPTION' && line.item_id) {
                  const value = feedValue(line, 1, alive.length, dayNo);
                  if (value > 0) await entries.postEntry(b.batchId, { ...base, entered_value: value, lot_no: lotOf(line.item_id) }, run.tenantId, actor);
                } else if (line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'MORTALITY_COUNT') {
                  const dies = animal.animal_id === dying;
                  await entries.postEntry(b.batchId, {
                    ...base, entered_value: dies ? 1 : 0,
                    ...(dies ? { mortality_animals: [{ dead_weight_kg: deadWeightKg('A', dayNo), ...reasonFor('A', 0) }] } : {}),
                  }, run.tenantId, actor);
                } else if (line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'BODY_WEIGHT') {
                  await entries.postEntry(b.batchId, { ...base, entered_value: bodyWeightKg('A', dayNo, ai) }, run.tenantId, actor);
                } else if (line.is_mandatory) {
                  throw new Error(`mandatory line '${line.activity_name}' (${line.line_type}/${line.kpi_metric ?? '-'}) is not one the seed knows how to fill`);
                }
              }
            }
          }
          if (dying) deathCounter += 1;
          for (const stageId of toPost) await svc.postStageDay(b.batchId, stageId, date, run.tenantId, actor);
        }
        res.postedDays += 1;
      } catch (err) {
        res.stoppedAt = date;
        res.reason = (err as Error).message.slice(0, 300);
        run.log(`  ${b.batchNo} ${date}: day not posted - ${res.reason}; stopping this batch`);
        break dayLoop;
      }
    }
    run.log(`  ${farm.name} batch ${b.spec.kind} ${b.batchNo}: ${res.postedDays}/${dates.length} day(s) posted${res.stoppedAt ? ` (stopped ${res.stoppedAt})` : ''}`);
  }
  return results;
}
