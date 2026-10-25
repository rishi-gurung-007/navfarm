/**
 * Play the Triple C showcase farm forward from 1 Jan 2025 to yesterday, one
 * day at a time, through the app's own services — the way a farm would have
 * used it. Run after seed-triplec.ts has provisioned the tenant, its masters
 * and its opening herd.
 *
 * Each day, in order:
 *   1. Breeding and stage events fall due: services (AI), pregnancy checks,
 *      farrowings (each litter becomes a piglet lot, as the app records it),
 *      weanings and the sows' stage moves. Every sow runs her own cycle —
 *      service, 115 days in pig, 26 days nursing, five days to the next
 *      service — so the herd's events spread across the calendar.
 *   2. Weaned litters are gathered into one weaner cohort a breed every four
 *      weeks. A cohort moves Weaner -> Double Stock -> Grower and is sold and
 *      closed at 18 weeks; the four count-only batches seed-triplec.ts opens
 *      with are the pipeline already on the farm on day one.
 *   3. Every active batch enters each scheduler line that is due that day —
 *      feed at its standard, a weekly weight, the day's deaths — and the day is
 *      posted, so Data Entry shows nothing pending and costs reach WIP.
 *
 * Feed comes out of the farm store (no silo-to-shed links are configured), so
 * when a draw finds the store short the feed is received into it that day,
 * as a farm would buy it in.
 *
 * Deterministic: the same tenant and dates give the same history.
 *
 *   TRIPLEC_TENANT_CODE=ccc TRIPLEC_EMAIL_DOMAIN=ccc.com \
 *     node --env-file-if-exists=.env --import tsx src/scripts/seed-triplec-history.ts --apply
 *   SIM_END=2025-02-28 ... limits the run, for trying it on a short window.
 */
import { NestFactory } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { and, eq, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AppModule } from '../app.module';
import { MASTER_CONNECTION } from '../core/database/database.module';
import * as masterSchema from '../core/database/master-schema';
import * as schema from '../core/database/schema';
import { ConnectionManagerService } from '../core/database/connection-manager.service';
import { BatchService } from '../modules/production/batch/batch.service';
import { BatchDailyDataService } from '../modules/production/batch-daily-data/batch-daily-data.service';
import { animalsInBatchOn } from '../modules/production/batch-daily-data/animal-membership';
import { AnimalService } from '../modules/piggery/animal/animal.service';
import { BreedingService } from '../modules/piggery/breeding/breeding.service';
import { SchedulerHeaderService } from '../modules/production/scheduler-header/scheduler-header.service';
import { GoodsReceiptService } from '../modules/inventory/goods-receipt/goods-receipt.service';
import { lotBalances } from '../modules/inventory/inventory-ledger/lot-balance';
import { BatchTransferService } from '../modules/production/batch/batch-transfer.service';
import { PORTA_ANIMALS } from './lib/porta-animal-seed-data';

// No default: this writes a year and more of history, so the tenant is always named (24 Oct: a bare
// run once played the old 'triplec' tenant forward instead of 'ccc'). The showcase runner sets it.
const TENANT_CODE = process.env.TRIPLEC_TENANT_CODE || '';
const EMAIL_DOMAIN = process.env.TRIPLEC_EMAIL_DOMAIN || 'ccc.local';
const START = '2025-01-01';
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
/** SIM_PLAN_DAYS=n plans n days past yesterday and stops before writing anything — a check of the planner. */
const PLAN_DAYS = Number(process.env.SIM_PLAN_DAYS || 0);
const END = PLAN_DAYS
  ? new Date(Date.parse(YESTERDAY) + PLAN_DAYS * 86400000).toISOString().slice(0, 10)
  : process.env.SIM_END && process.env.SIM_END < YESTERDAY ? process.env.SIM_END : YESTERDAY;
const CONCURRENCY = Number(process.env.SIM_CONCURRENCY || 6);
/**
 * `--resume` tops up a tenant already played forward (or imported from an
 * export): it starts at the first day any active batch has left unposted and
 * plans each sow from where she stands in MySQL — in pig, nursing, weaned —
 * rather than from the opening herd.
 */
const RESUME = process.argv.includes('--resume');

const GESTATION = 115;
const NURSING = 26;
const WEAN_TO_SERVICE = 5;
const COHORT_WINDOW = 28;
/**
 * Sows served in the same ISO week on a farm, of one breed, make one service batch — the batch the Farrowing
 * Report reads, and the one a year later is matched to. Each is housed in its farm's service line.
 */
const SERVICE_SHED: Record<string, string> = { MUL100: 'MU1', POR100: 'PSL' };
const SOW_STAGES = ['REARING', 'FLUSH', 'INSEMINATION', 'GESTATION', 'FARROWING', 'LACTATION', 'PRODUCTIVE_SOW'];
/** Days from a cohort's weaning to each move; sold at 18 weeks on the farm. */
const COHORT_MOVES: Array<{ day: number; to: string }> = [{ day: 42, to: 'DOUBLE_STOCK' }, { day: 70, to: 'GROWER' }];
const COHORT_SALE_DAY = 126;
/**
 * The houses a cohort moves through, from the location template: weaner houses
 * for Weaner, double-stock houses for Double Stock, grower houses for Grower
 * (MUGR1-3 hold the gilt batches). A cohort takes the next house in turn, and
 * the move is the batch's shed change, as a user records it — a stage transfer
 * alone leaves the litter in the farrowing house it was born in, where the
 * forecast finds no silo with its feed.
 */
const HOUSES: Record<string, string[]> = {
  WEANER: ['MUWN1', 'MUWN2', 'MUWN3', 'MUWN4', 'MUWN5', 'MUWN6'],
  DOUBLE_STOCK: ['MUDST1P1', 'MUDST2P1', 'MUDST3P1', 'MUDST4P1'],
  GROWER: ['MUGR4', 'MUGR5', 'MUGR6', 'MUGR7', 'MUGR8', 'MUGR9', 'MUGR10'],
};
/** Daily death risk a head, by stage of a batch-wise batch. */
const DAILY_DEATH_RISK: Record<string, number> = { LACTATION: 0.003, WEANER: 0.0004, DOUBLE_STOCK: 0.0004, GROWER: 0.0002 };
const DEAD_WEIGHT_KG: Record<string, number> = { LACTATION: 2, WEANER: 14, DOUBLE_STOCK: 38, GROWER: 75 };
/** Sale price a kilogram live weight, and the weight a finished pig leaves at. */
const SALE_PRICE_PER_KG = 2.1;
const SALE_WEIGHT_KG = 118;

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

/** A repeatable 0..1 draw per key, so a re-run plans the same farm. */
function draw(key: string): number {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}
const between = (key: string, lo: number, hi: number) => lo + Math.floor(draw(key) * (hi - lo + 1));

type Event =
  | { date: string; order: number; kind: 'MATE'; animalId: string; cycle: number }
  | { date: string; order: number; kind: 'PREG'; animalId: string; cycle: number; result: 'CONFIRMED' | 'REPEAT' }
  | { date: string; order: number; kind: 'FARROW'; animalId: string; cycle: number }
  | { date: string; order: number; kind: 'WEAN'; animalId: string; cycle: number }
  | { date: string; order: number; kind: 'MOVE'; animalId: string; stage: string };

const db = () => baseTenantDb;
let cls: ClsService;
let actor: { userId: string; userType: string; tenantId: string; email: string };
let tenantId = '';
let companyId = '';
const stats = { entries: 0, posted: 0, events: 0, receipts: 0, failed: 0 };
const failures = new Map<string, number>();
function fail(where: string, error: unknown) {
  stats.failed += 1;
  const msg = `${where}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 240);
  const key = msg.replace(/\d{4}-\d{2}-\d{2}|[0-9a-f-]{36}|\d+(\.\d+)?/g, '#');
  const n = failures.get(key) ?? 0;
  failures.set(key, n + 1);
  if (n < 3) console.log(`     ! ${msg}`);
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  }));
}

/** One mutex, so two batches short of the same feed do not both buy it in. */
let receiving: Promise<void> = Promise.resolve();

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  cls = app.get(ClsService);
  const masterDb = app.get<MySql2Database<typeof masterSchema>>(MASTER_CONNECTION);
  const [tenant] = await masterDb.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.tenant_code, TENANT_CODE)).limit(1);
  if (!tenant) throw new Error(`Tenant ${TENANT_CODE} is not registered — run seed-triplec.ts first.`);
  tenantId = tenant.tenant_id;
  const tenantDb = await app.get(ConnectionManagerService).getTenantConnection(tenant);
  baseTenantDb = tenantDb as any;
  await cls.run(async () => {
    cls.set('tenantId', tenantId);
    cls.set('tenantDb', tenantDb);
    await simulate(app);
  });
  await app.close().catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}

let baseTenantDb: MySql2Database<typeof schema>;
function isolated<T>(work: () => Promise<T>): Promise<T> {
  return cls.run(async () => {
    cls.set('tenantId', tenantId);
    cls.set('tenantDb', baseTenantDb);
    return work();
  });
}

async function simulate(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>) {
  const batches = app.get(BatchService);
  const entries = app.get(BatchDailyDataService);
  const animals = app.get(AnimalService);
  const breeding = app.get(BreedingService);
  const schedulers = app.get(SchedulerHeaderService);
  const receipts = app.get(GoodsReceiptService);
  const transfers = app.get(BatchTransferService);
  const t = db();

  const [admin] = await t.select().from(schema.userMaster).where(eq(schema.userMaster.email, `company.admin@${EMAIL_DOMAIN}`)).limit(1);
  if (!admin) throw new Error(`company.admin@${EMAIL_DOMAIN} is missing.`);
  companyId = admin.company_id;
  actor = { userId: admin.user_id, userType: 'COMPANY_ADMIN', tenantId, email: admin.email };

  const stageRows = await t.select().from(schema.stageMaster);
  const stageId = new Map(stageRows.map((s) => [s.stage_code, s.stage_id]));
  const stageCode = new Map(stageRows.map((s) => [s.stage_id, s.stage_code]));
  const items = await t.select().from(schema.itemMaster);
  const itemByCode = new Map(items.map((i) => [i.item_code, i]));
  const itemById = new Map(items.map((i) => [i.item_id, i]));
  const breedById = new Map((await t.select().from(schema.breedMaster)).map((b) => [b.breed_id, b.breed_code]));
  const locationRows = await t.select().from(schema.locationMaster);
  const locationByCode = new Map(locationRows.map((l) => [l.location_code, l.location_id]));
  const locationCode = new Map(locationRows.map((l) => [l.location_id, l.location_code]));
  let housed = 0;
  /** The next house of a stage, in turn. */
  const houseFor = (stage: string) => {
    const list = HOUSES[stage];
    if (!list) return null;
    return locationByCode.get(list[housed++ % list.length]) ?? null;
  };
  const pigletItem = itemByCode.get('BIO-SWINE-PIGLET');
  if (!pigletItem) throw new Error('The piglet living-asset item BIO-SWINE-PIGLET is missing.');
  const [store] = await t.select().from(schema.locationMaster).where(eq(schema.locationMaster.location_type, 'STORE')).limit(1);
  if (!store) throw new Error('The farm store is missing.');
  const reasons = (await t.select().from(schema.reasonMaster)).filter((r) => r.category === 'MORTALITY' && !r.deleted_at);
  const reasonFor = (stage: string, key: string) => {
    const fits = reasons.filter((r) => JSON.stringify(r.applicable_stages ?? '').includes(stage));
    const list = fits.length ? fits : reasons;
    return list[Math.floor(draw(key) * list.length)]?.reason_id;
  };

  // ---------------------------------------------------------------- the plan
  let FROM = START;
  if (RESUME) {
    const open = (await t.select().from(schema.batchHeader).where(eq(schema.batchHeader.status, 'ACTIVE')))
      .filter((b) => !b.deleted_at && iso(b.start_date) <= END);
    let first = '9999-12-31';
    for (const b of open) {
      const pending = await batches.getNextPendingDate(b as any);
      if (pending && pending < first) first = pending;
    }
    if (first > END) {
      console.log(`Nothing to top up: every active batch is posted to ${END}.`);
      return;
    }
    FROM = first;
  }
  const herd = await t.select().from(schema.animalRegister);
  const herdBatches = await t.select().from(schema.batchHeader);
  const batchStart = new Map(herdBatches.map((b) => [b.batch_id, iso(b.start_date)]));
  const breedOfBatch = new Map(herdBatches.map((b) => [b.batch_id, b.breed_id]));
  const events: Event[] = [];
  // State the events need between days.
  const matingOf = new Map<string, string>(); // `${animal}:${cycle}` -> breeding_id
  const farrowOf = new Map<string, { farrowId: string; lotId: string | null }>();
  const ORDER = { WEAN: 0, MOVE: 1, MATE: 2, PREG: 3, FARROW: 4 } as const;
  // What a sow's body weight is read from: her last service, her last litter, and how many litters she has had.
  const lastService = new Map<string, string>();
  const lastFarrow = new Map<string, string>();
  const litters = new Map<string, number>();
  for (const m of await t.select().from(schema.breedingRecord)) {
    const d = iso(m.mating_date);
    if (d > (lastService.get(m.sow_animal_id) ?? '')) lastService.set(m.sow_animal_id, d);
  }
  for (const f of await t.select().from(schema.farrowingRecord)) {
    const d = iso(f.farrowing_date);
    if (d > (lastFarrow.get(f.sow_animal_id) ?? '')) lastFarrow.set(f.sow_animal_id, d);
    litters.set(f.sow_animal_id, (litters.get(f.sow_animal_id) ?? 0) + 1);
  }
  for (const a of herd) if (!litters.has(a.animal_id) && Number(a.parity_count) > 0) litters.set(a.animal_id, Number(a.parity_count));
  const porta = new Map(PORTA_ANIMALS.map((a) => [a.code, a]));
  const push = (e: Omit<Event, 'order'> & { kind: Event['kind'] }, floor: string) => {
    if (e.date >= floor && e.date <= END) events.push({ ...(e as any), order: ORDER[e.kind] });
  };

  /** A sow's cycles from a first service on day `service`, each queued only when on or after `floor`. */
  function cycles(animalId: string, code: string, firstService: string, floor: string, startIn: string, firstConfirmed = false) {
    let service = firstService;
    let cycle = 0;
    let current = startIn;
    const move = (date: string, stage: string) => {
      if (stage !== current && date >= floor) push({ date, kind: 'MOVE', animalId, stage } as any, floor);
      if (date >= floor || stage === current) current = stage;
    };
    while (service <= END) {
      move(addDays(service, -1), 'INSEMINATION');
      // A service before the history began was the seller's; it is recorded so the litter has a mating.
      events.push({ date: service, kind: 'MATE', animalId, cycle, order: ORDER.MATE } as Event);
      const repeat = !(firstConfirmed && cycle === 0) && draw(`${code}:${cycle}:repeat`) < 0.08 && service >= floor;
      const check = addDays(service, 28);
      if (check <= END) events.push({ date: check, kind: 'PREG', animalId, cycle, result: repeat ? 'REPEAT' : 'CONFIRMED', order: ORDER.PREG } as Event);
      move(addDays(service, 1), 'GESTATION');
      if (repeat) {
        move(addDays(check, 1), 'INSEMINATION');
        service = addDays(check, 2);
        cycle += 1;
        continue;
      }
      const farrow = addDays(service, GESTATION);
      move(addDays(farrow, -6), 'FARROWING');
      push({ date: farrow, kind: 'FARROW', animalId, cycle } as any, floor);
      const lactation = farrow;
      if (lactation <= END && lactation >= floor) events.push({ date: lactation, kind: 'MOVE', animalId, stage: 'LACTATION', order: 5 } as Event);
      current = lactation >= floor ? 'LACTATION' : current;
      const wean = addDays(farrow, NURSING);
      push({ date: wean, kind: 'WEAN', animalId, cycle } as any, floor);
      move(wean, 'PRODUCTIVE_SOW');
      service = addDays(wean, WEAN_TO_SERVICE);
      cycle += 1;
    }
  }

  if (RESUME) {
    const matings = await t.select().from(schema.breedingRecord);
    const farrows = await t.select().from(schema.farrowingRecord);
    const later = (date: string) => (date < FROM ? addDays(FROM, 1) : date);
    for (const a of herd.filter((x) => x.current_batch_id && ['SOW', 'GILT'].includes(x.animal_type) && x.status !== 'DISPOSED')) {
      const code = a.animal_code;
      const stage = stageCode.get(a.current_stage_id ?? '') ?? 'INSEMINATION';
      const [last] = matings
        .filter((m) => m.sow_animal_id === a.animal_id)
        .sort((x, y) => iso(y.mating_date).localeCompare(iso(x.mating_date)));
      if (!last) {
        // Never served: a rearing gilt flushes at 26 weeks and is served a fortnight later.
        if (stage === 'REARING') {
          const dob = iso(a.dob) || addDays(FROM, -140);
          const flush = later(addDays(dob, 182));
          if (flush <= END) events.push({ date: flush, kind: 'MOVE', animalId: a.animal_id, stage: 'FLUSH', order: ORDER.MOVE } as Event);
          cycles(a.animal_id, code, addDays(flush, 15), FROM, 'FLUSH');
        } else {
          cycles(a.animal_id, code, addDays(FROM, between(`${code}:r`, 1, 10)), FROM, stage);
        }
        continue;
      }
      const served = iso(last.mating_date);
      const litter = farrows.find((f) => f.breeding_id === last.breeding_id);
      if (last.conception_result === 'REPEAT' || last.conception_result === 'FAILED') {
        cycles(a.animal_id, code, later(addDays(iso(last.preg_check_date) || addDays(served, 28), 2)), FROM, stage);
        continue;
      }
      matingOf.set(`${a.animal_id}:0`, last.breeding_id);
      if (!litter) {
        cycles(a.animal_id, code, served, FROM, stage, last.conception_result === 'CONFIRMED');
        continue;
      }
      if (!(Number(litter.piglets_weaned) > 0)) {
        farrowOf.set(`${a.animal_id}:0`, { farrowId: litter.farrow_id, lotId: litter.piglet_batch_id ?? null });
        cycles(a.animal_id, code, served, FROM, stage, true);
        continue;
      }
      cycles(a.animal_id, code, later(addDays(iso(litter.weaning_date), WEAN_TO_SERVICE)), FROM, stage);
    }
  }
  for (const [n, a] of (RESUME ? [] : herd.filter((x) => x.current_batch_id && ['SOW', 'GILT'].includes(x.animal_type))).entries()) {
    const floor = batchStart.get(a.current_batch_id!) ?? START;
    const stage = stageCode.get(a.current_stage_id ?? '') ?? '';
    const code = a.animal_code;
    const k = n + 1;
    const sheet = porta.get(code);
    if (sheet) {
      // A Porta animal is served on the day her breeding record gives; a gilt is flushed a fortnight before it.
      if (stage === 'REARING') {
        const flush = addDays(sheet.service.matingDate, -14);
        if (flush >= floor && flush <= END) events.push({ date: flush, kind: 'MOVE', animalId: a.animal_id, stage: 'FLUSH', order: ORDER.MOVE } as Event);
      }
      cycles(a.animal_id, code, sheet.service.matingDate, floor, stage === 'REARING' ? 'FLUSH' : stage, true);
      continue;
    }
    switch (stage) {
      case 'REARING': {
        const dob = iso(a.dob) || addDays(floor, -140);
        const flush = addDays(dob, 182);
        if (flush <= END) events.push({ date: flush, kind: 'MOVE', animalId: a.animal_id, stage: 'FLUSH', order: ORDER.MOVE } as Event);
        cycles(a.animal_id, code, addDays(dob, 197), floor, 'FLUSH');
        break;
      }
      case 'FLUSH':
        cycles(a.animal_id, code, addDays(floor, between(`${code}:f`, 2, 15)), floor, 'FLUSH');
        break;
      case 'INSEMINATION':
        cycles(a.animal_id, code, addDays(floor, between(`${code}:i`, 0, 7)), floor, 'INSEMINATION');
        break;
      case 'GESTATION':
        cycles(a.animal_id, code, addDays(floor, -between(`${code}:g`, 12, 100)), floor, 'GESTATION');
        break;
      case 'FARROWING':
        cycles(a.animal_id, code, addDays(floor, -(GESTATION - between(`${code}:p`, 1, 9))), floor, 'FARROWING');
        break;
      case 'LACTATION':
        cycles(a.animal_id, code, addDays(floor, -(GESTATION - (k % 4))), floor, 'LACTATION');
        break;
      default:
        cycles(a.animal_id, code, addDays(floor, between(`${code}:o`, 3, 20)), floor, stage || 'INSEMINATION');
    }
  }
  events.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
  console.log(`Plan: ${events.length} breeding and stage events for ${herd.length} animals, ${FROM} to ${END}${RESUME ? ' (top-up)' : ''}`);
  if (PLAN_DAYS) {
    const byKind = new Map<string, number>();
    for (const e of events.filter((x) => x.date >= FROM)) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    console.log(`  from ${FROM}: ${[...byKind].map(([k, n]) => `${n} ${k}`).join(', ')}; ${matingOf.size} open services and ${farrowOf.size} nursing litters picked up from MySQL`);
    for (const e of events.filter((x) => x.date >= FROM).slice(0, 8)) console.log(`  ${e.date} ${e.kind} ${herd.find((h) => h.animal_id === e.animalId)?.animal_code}${'stage' in e ? ` -> ${e.stage}` : ''}`);
    return;
  }

  // Every sow stage gets its scheduler before anyone moves in, so the move aligns it to the day they arrive.
  for (const b of herdBatches.filter((x) => x.tracking_mode === 'ANIMAL_WISE')) {
    for (const code of SOW_STAGES) {
      const id = stageId.get(code);
      if (!id) continue;
      try {
        await isolated(() => schedulers.createForStage(b.batch_id, id, tenantId, actor));
      } catch (error) {
        fail(`scheduler ${b.batch_no} ${code}`, error);
      }
    }
  }

  // ---------------------------------------------------------------- cohorts
  type Cohort = { batchId: string; breedId: string | null; start: string; key: string };
  const cohorts: Cohort[] = [];
  const cohortOpenFor = new Map<string, Cohort>();
  const pipelineStart: Record<string, number> = { WEANER: 0, DOUBLE_STOCK: -42, GROWER: -70 };
  if (!RESUME) {
    for (const b of herdBatches.filter((x) => x.tracking_mode === 'BATCH_WISE')) {
      const stage = stageCode.get(b.stage_id ?? '') ?? 'WEANER';
      cohorts.push({ batchId: b.batch_id, breedId: b.breed_id, start: addDays(iso(b.start_date), pipelineStart[stage] ?? 0), key: `pipeline:${b.batch_no}` });
    }
  } else {
    // The cohorts still on the farm, each dated from the weaning that opened it.
    const farrows = await t.select().from(schema.farrowingRecord);
    for (const b of herdBatches.filter((x) => x.tracking_mode === 'BATCH_WISE' && x.status === 'ACTIVE')) {
      const stage = stageCode.get(b.stage_id ?? '') ?? '';
      if (!['WEANER', 'DOUBLE_STOCK', 'GROWER'].includes(stage)) continue;
      const opened = farrows.filter((f) => f.piglet_batch_id === b.batch_id && Number(f.piglets_weaned) > 0).map((f) => iso(f.weaning_date)).sort()[0];
      const start = opened || iso(b.start_date);
      const key = `${b.breed_id}:${Math.floor(daysBetween(START, start) / COHORT_WINDOW)}`;
      const cohort = { batchId: b.batch_id, breedId: b.breed_id, start, key };
      cohorts.push(cohort);
      if (daysBetween(start, FROM) < COHORT_WINDOW) cohortOpenFor.set(key, cohort);
    }
  }


  /** The service batch of the week a sow is served in, made (and its sow-stage schedulers with it) the first time. */
  async function serviceBatch(source: typeof schema.batchHeader.$inferSelect, breedId: string | null, day: string) {
    const farm = locationCode.get(source.farm_id ?? '') ?? '';
    const shed = locationByCode.get(SERVICE_SHED[farm] ?? '') ?? source.shed_id;
    const monday = addDays(day, -((new Date(day).getUTCDay() + 6) % 7));
    const breedCode = breedById.get(breedId ?? '') ?? '';
    const remarks = `SERVICE ${farm} ${breedCode} week of ${monday}`;
    const [found] = await t.select().from(schema.batchHeader).where(eq(schema.batchHeader.remarks, remarks)).limit(1);
    if (found && ['DRAFT', 'ACTIVE'].includes(found.status)) return found;
    const made: any = await batches.create({
      company_id: companyId, lob_id: source.lob_id, operational_area_id: source.operational_area_id, costing_method: source.costing_method,
      breed_id: breedId, stage_id: stageId.get('INSEMINATION'), shed_id: shed, start_date: day, uom: 'HEAD', remarks,
      tracking_mode: 'ANIMAL_WISE', animal_ids: [],
    } as any, tenantId, actor);
    const id = made?.batch_id ?? made?.data?.batch_id;
    for (const code of SOW_STAGES) {
      const sid = stageId.get(code);
      if (!sid) continue;
      try {
        await schedulers.createForStage(id, sid, tenantId, actor);
      } catch (error) {
        fail(`scheduler service batch ${code}`, error);
      }
    }
    const [row] = await t.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, id)).limit(1);
    stats.events += 1;
    return row;
  }

  /** A sow served this week moves into the week's service batch; a batch left with no animals is closed. */
  async function toServiceBatch(animal: typeof schema.animalRegister.$inferSelect, day: string) {
    const [source] = await t.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, animal.current_batch_id!)).limit(1);
    if (!source || source.status !== 'ACTIVE' || iso(source.start_date) > day) return animal.current_batch_id!;
    const target = await serviceBatch(source, animal.breed_id, day);
    if (!target || target.batch_id === source.batch_id) return animal.current_batch_id!;
    await transfers.create({
      company_id: companyId, to_batch_id: target.batch_id, transfer_date: day, transfer_type: 'PARTIAL',
      animal_ids: [animal.animal_id], to_stage_id: stageId.get('INSEMINATION'), reason: 'Served this week',
    } as any, tenantId, source.batch_id, actor);
    if (target.status === 'DRAFT') await batches.activate(target.batch_id, tenantId, actor);
    const [left] = await t.select({ n: sql<number>`COUNT(*)` }).from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.current_batch_id, source.batch_id), sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED','DISPOSED')`));
    if (Number(left?.n ?? 0) === 0) emptied.set(source.batch_id, day);
    return target.batch_id;
  }
  const emptied = new Map<string, string>();

  async function runEvent(e: Event) {
    const where = `${e.kind} ${e.date}`;
    try {
      const [animal] = await t.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, e.animalId)).limit(1);
      if (!animal || !animal.current_batch_id || animal.status === 'DISPOSED') return;
      switch (e.kind) {
        case 'MOVE': {
          const to = stageId.get(e.stage);
          if (!to || animal.current_stage_id === to) return;
          await animals.transitionStage(e.animalId, { to_stage_id: to, transition_date: e.date, reason: 'Production cycle' } as any, tenantId, actor);
          break;
        }
        case 'MATE': {
          // A service before the history began (the seller's) stays where it is.
          const batchId = e.date >= START ? await toServiceBatch(animal, e.date) : animal.current_batch_id;
          const made: any = await breeding.recordMating({
            sow_animal_id: e.animalId, batch_id: batchId, mating_type: 'AI' as any,
            mating_date: e.date, expected_farrowing_date: addDays(e.date, GESTATION),
          } as any, tenantId, actor);
          const id = made?.breeding_id ?? made?.data?.breeding_id;
          if (id) matingOf.set(`${e.animalId}:${e.cycle}`, id);
          lastService.set(e.animalId, e.date);
          break;
        }
        case 'PREG': {
          const id = matingOf.get(`${e.animalId}:${e.cycle}`);
          if (!id) return;
          await breeding.recordPregnancyCheck(id, {
            preg_check_date: e.date, preg_check_method: 'ULTRASOUND' as any,
            pregnancy_confirmed: e.result === 'CONFIRMED', conception_result: e.result as any,
          } as any, tenantId, actor);
          break;
        }
        case 'FARROW': {
          const key = `${animal.animal_code}:${e.cycle}`;
          const recorded = e.cycle === 0 ? porta.get(animal.animal_code)?.service.bornLive : undefined;
          const total = between(`${key}:tb`, 13, 18);
          const still = draw(`${key}:sb`) < 0.45 ? 1 : 0;
          const mummified = draw(`${key}:mm`) < 0.25 ? 1 : 0;
          // A litter the breeding record gives keeps its born-live figure.
          const live = recorded ?? total - still - mummified;
          const avg = 1.15 + Math.round(draw(`${key}:bw`) * 25) / 100;
          const made: any = await breeding.recordFarrowing({
            sow_animal_id: e.animalId, breeding_id: matingOf.get(`${e.animalId}:${e.cycle}`), batch_id: animal.current_batch_id,
            farrowing_date: e.date, piglets_born_live: live, piglets_stillborn: still, piglets_mummified: mummified,
            avg_birth_weight_kg: avg, total_litter_weight_kg: Math.round(live * avg * 100) / 100, farrowing_status: 'NORMAL' as any,
            piglet_item_id: pigletItem!.item_id, piglet_stage_id: stageId.get('LACTATION'),
          } as any, tenantId, actor);
          farrowOf.set(`${e.animalId}:${e.cycle}`, { farrowId: made.farrow_id, lotId: made.piglet_batch_id ?? null });
          lastFarrow.set(e.animalId, e.date);
          litters.set(e.animalId, (litters.get(e.animalId) ?? 0) + 1);
          break;
        }
        case 'WEAN': {
          const f = farrowOf.get(`${e.animalId}:${e.cycle}`);
          if (!f) return;
          const [lot] = f.lotId ? await t.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, f.lotId)).limit(1) : [];
          const head = lot ? Math.floor(Number(lot.closing_quantity ?? lot.opening_quantity ?? 0)) : 0;
          if (head < 1) return;
          const window = Math.floor(daysBetween(START, e.date) / COHORT_WINDOW);
          const cohortKey = `${animal.breed_id}:${window}`;
          const open = cohortOpenFor.get(cohortKey);
          const weight = 6.8 + Math.round(draw(`${animal.animal_code}:${e.cycle}:ww`) * 140) / 100;
          await breeding.recordWeaning(f.farrowId, {
            // A pig or two lost before weaning; the app records the difference as pre-wean mortality.
            weaning_date: e.date, piglets_weaned: Math.max(1, head - between(`${animal.animal_code}:${e.cycle}:pw`, 0, 2)), avg_weaning_weight_kg: weight,
            // A litter joining a cohort moves into it; the first litter of a cohort is moved on to Weaner below,
            // into a weaner house, since the weaning's own move would leave it in the farrowing pen.
            ...(open ? { move_to_batch_id: open.batchId } : {}),
          } as any, tenantId, actor);
          if (open) {
            await batches.close(f.lotId!, { actual_end_date: e.date } as any, tenantId, actor);
          } else {
            const house = houseFor('WEANER');
            await batches.transferStage(f.lotId!, { to_stage_code: 'WEANER', transfer_date: e.date, ...(house ? { to_location_id: house } : {}) } as any, tenantId, actor);
            if (house) await batches.changeShed(f.lotId!, house, tenantId, actor);
            const cohort = { batchId: f.lotId!, breedId: animal.breed_id, start: e.date, key: cohortKey };
            cohorts.push(cohort);
            cohortOpenFor.set(cohortKey, cohort);
          }
          break;
        }
      }
      stats.events += 1;
    } catch (error) {
      fail(where, error);
    }
  }

  async function cohortMoves(day: string) {
    for (const c of cohorts) {
      const age = daysBetween(c.start, day);
      const [b] = await t.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, c.batchId)).limit(1);
      if (!b || b.status !== 'ACTIVE') continue;
      if (cohortOpenFor.get(c.key) === c && daysBetween(c.start, day) >= COHORT_WINDOW) cohortOpenFor.delete(c.key);
      try {
        for (const m of COHORT_MOVES) {
          if (age === m.day && stageCode.get(b.stage_id ?? '') !== m.to) {
            // The house is the move's destination, so the new stage's scheduler — where data entry and the
            // feed forecast place the batch — starts there; the shed change keeps the batch record in step.
            const house = houseFor(m.to);
            await batches.transferStage(c.batchId, { to_stage_code: m.to, transfer_date: day, ...(house ? { to_location_id: house } : {}) } as any, tenantId, actor);
            if (house) await batches.changeShed(c.batchId, house, tenantId, actor);
            stats.events += 1;
          }
        }
        if (age >= COHORT_SALE_DAY) {
          const head = Math.floor(Number(b.closing_quantity ?? b.opening_quantity ?? 0));
          if (head > 0) {
            await batches.disposeBioAsset(c.batchId, {
              disposal_type: 'SOLD', quantity: head, posting_date: day,
              sale_proceeds: Math.round(head * SALE_WEIGHT_KG * SALE_PRICE_PER_KG * 100) / 100,
            } as any, tenantId, actor);
          }
          await batches.close(c.batchId, { actual_end_date: day } as any, tenantId, actor);
          stats.events += 1;
        }
      } catch (error) {
        fail(`cohort ${b.batch_no} ${day}`, error);
      }
    }
  }

  // ---------------------------------------------------------------- data entry
  const customDays = new Map<string, Set<number>>();
  for (const d of await t.select().from(schema.schedulerLineCustomDays)) {
    if (!customDays.has(d.line_id)) customDays.set(d.line_id, new Set());
    if (d.is_active !== false) customDays.get(d.line_id)!.add(d.day_number);
  }
  /** Mirrors BatchService.loadScheduleLinesForHeader: the lines of a header due on a date. */
  async function dueLines(header: typeof schema.schedulerHeader.$inferSelect, day: string) {
    const lines = await t.select().from(schema.schedulerLine)
      .where(and(eq(schema.schedulerLine.scheduler_id, header.scheduler_id), eq(schema.schedulerLine.is_active, true)));
    const dayOfStage = daysBetween(iso(header.effective_from), day) + 1;
    if (dayOfStage < 1) return [];
    const date = new Date(day);
    const isoWeekday = ((date.getUTCDay() + 6) % 7) + 1;
    return lines.filter((l) => {
      if (dayOfStage < l.start_day) return false;
      if (l.end_day != null && dayOfStage > l.end_day) return false;
      switch (l.occurrence) {
        case 'WEEKLY': return l.day_of_week === isoWeekday;
        case 'MONTHLY': return (l.day_of_week != null ? Number(l.day_of_week) : new Date(iso(header.effective_from)).getUTCDate()) === date.getUTCDate();
        case 'ONCE': return dayOfStage === l.start_day;
        case 'CUSTOM': return customDays.get(l.line_id)?.has(dayOfStage) ?? false;
        default: return true;
      }
    });
  }

  /** Buys feed into the warehouse the draw is taken from — the shed's silo when it has one, else the store. */
  async function buyIn(itemId: string, day: string, needed: number, warehouseId: string = store!.location_id) {
    const run = receiving.then(async () => {
      const item = itemById.get(itemId);
      // A silo is filled a few days ahead, the store a month.
      const qty = warehouseId === store!.location_id ? Math.max(20000, Math.ceil(needed * 40)) : Math.max(2000, Math.ceil(needed * 10));
      const made: any = await receipts.create({
        company_id: companyId, warehouse_id: warehouseId, posting_date: day,
        remarks: 'Triple C showcase — feed bought in',
        lines: [{ item_id: itemId, quantity: qty, uom: item?.uom_primary || 'KG', rate: Number(item?.standard_cost) || 0.38, lot_no: `LOT-${day}-${item?.item_code}` }],
      } as any, tenantId, actor);
      await receipts.post(made.receipt_id ?? made.data?.receipt_id, tenantId, actor);
      stats.receipts += 1;
    });
    receiving = run.catch(() => undefined);
    await run;
  }

  const warehouseOf = new Map<string, string>();
  /** The lots a draw is taken from, oldest first: the warehouse data entry itself would draw from. */
  async function lotsFor(b: { batch_id: string; location_id: string | null; shed_id: string | null; farm_id: string | null }, line: typeof schema.schedulerLine.$inferSelect, day: string, qty: number) {
    const item = itemById.get(line.item_id!);
    if (!item?.is_lot_tracked) return { lotNo: undefined as string | undefined, held: Infinity, warehouseId: undefined as string | undefined };
    const key = `${b.batch_id}:${line.item_id}`;
    let warehouseId = warehouseOf.get(key);
    if (!warehouseId) {
      warehouseId = await entries.resolveConsumptionWarehouse(b.location_id || b.shed_id, line.item_id!, line.activity_name, b.farm_id, companyId, tenantId, day);
      warehouseOf.set(key, warehouseId);
    }
    const rows = (await lotBalances(t as any, { tenantId, companyId, itemId: line.item_id!, warehouseId } as any))
      .filter((r: any) => r.quantity > 0.0001)
      .sort((a: any, z: any) => String(a.receipt_date ?? '').localeCompare(String(z.receipt_date ?? '')));
    const chosen: string[] = [];
    let held = 0;
    for (const r of rows as any[]) {
      if (held >= qty) break;
      chosen.push(r.lot_no);
      held += Number(r.quantity);
    }
    return { lotNo: chosen.length ? chosen.join(',') : undefined, held, warehouseId };
  }

  async function enter(b: typeof schema.batchHeader.$inferSelect, day: string, line: typeof schema.schedulerLine.$inferSelect, body: Record<string, unknown>, where: string) {
    const dto: Record<string, unknown> = { line_id: line.line_id, entry_date: day, ...body };
    try {
      if (line.line_type === 'CONSUMPTION' && line.item_id && Number(body.entered_value) > 0) {
        const qty = Number(body.entered_value);
        let lots = await lotsFor(b, line, day, qty);
        if (lots.held < qty) {
          await buyIn(line.item_id, day, qty, lots.warehouseId);
          lots = await lotsFor(b, line, day, qty);
        }
        if (lots.lotNo) dto.lot_no = lots.lotNo;
      }
      await entries.postEntry(b.batch_id, dto as any, tenantId, actor);
      stats.entries += 1;
    } catch (error) {
      // Batches run side by side, so another one may have drawn the same silo
      // between reading its balance and posting: buy in there and try again.
      const msg = error instanceof Error ? error.message : String(error);
      if (line.line_type === 'CONSUMPTION' && line.item_id && /insufficient|short/i.test(msg)) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const qty = Number(body.entered_value) || 1;
            const lots = await lotsFor(b, line, day, qty);
            await buyIn(line.item_id, day, qty * 3, lots.warehouseId);
            const again = await lotsFor(b, line, day, qty);
            if (again.lotNo) dto.lot_no = again.lotNo;
            await entries.postEntry(b.batch_id, dto as any, tenantId, actor);
            stats.entries += 1;
            return;
          } catch (retry) {
            if (attempt === 2) fail(where, retry);
          }
        }
        return;
      }
      fail(where, error);
    }
  }

  /** The value a due line takes for `head` animals on a day. Null leaves it unentered. */
  function valueFor(line: typeof schema.schedulerLine.$inferSelect, head: number, key: string, stage: string): Record<string, unknown> | null {
    const wobble = 0.96 + draw(key) * 0.08;
    if (line.line_type === 'CONSUMPTION') {
      const std = Number(line.standard_qty ?? 0);
      if (!(std > 0)) return line.is_mandatory ? { entered_value: 0 } : null;
      const qty = line.qty_basis === 'TOTAL_BATCH' ? std : std * head;
      return { entered_value: Math.round(qty * wobble * 100) / 100 };
    }
    if (line.line_type === 'DESCRIPTIVE') {
      if (line.kpi_metric === 'MORTALITY_COUNT') return { entered_value: 0 };
      const std = Number(line.std_value ?? 0);
      if (std > 0) return { entered_value: Math.round(std * wobble * 1000) / 1000 };
      return line.is_mandatory ? { entered_value: 0 } : null;
    }
    if (!line.is_mandatory) return null;
    return { entered_value: Number(line.standard_qty ?? 0) };
  }

  async function batchWiseDay(b: typeof schema.batchHeader.$inferSelect, day: string) {
    const head = Math.floor(Number(b.closing_quantity ?? b.opening_quantity ?? 0));
    if (head < 1) return;
    let [header] = await t.select().from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, b.batch_id), eq(schema.schedulerHeader.stage_id, b.stage_id!))).limit(1);
    if (!header) {
      try {
        await schedulers.generateForBatchCurrentStage(b.batch_id, tenantId, actor);
      } catch (error) {
        fail(`scheduler ${b.batch_no}`, error);
      }
      [header] = await t.select().from(schema.schedulerHeader)
        .where(and(eq(schema.schedulerHeader.batch_id, b.batch_id), eq(schema.schedulerHeader.stage_id, b.stage_id!))).limit(1);
    }
    const stage = stageCode.get(b.stage_id ?? '') ?? '';
    if (header) {
      for (const line of await dueLines(header, day)) {
        const key = `${b.batch_id}:${line.line_id}:${day}`;
        if (line.kpi_metric === 'MORTALITY_COUNT' && line.line_type === 'DESCRIPTIVE') {
          const risk = DAILY_DEATH_RISK[stage] ?? 0.0003;
          let deaths = 0;
          for (let i = 0; i < Math.min(head, 400); i += 1) if (draw(`${key}:d${i}`) < risk) deaths += 1;
          deaths = Math.min(deaths, head - 1);
          const body: Record<string, unknown> = { entered_value: deaths };
          if (deaths > 0) {
            body.mortality_animals = Array.from({ length: deaths }, (_, i) => ({
              dead_weight_kg: DEAD_WEIGHT_KG[stage] ?? 20, reason_id: reasonFor(stage, `${key}:r${i}`),
            }));
          }
          await enter(b, day, line, body, `${b.batch_no} ${line.activity_name} ${day}`);
          continue;
        }
        const body = valueFor(line, head, key, stage);
        if (body) await enter(b, day, line, body, `${b.batch_no} ${line.activity_name} ${day}`);
      }
    }
    try {
      await batches.postBatchDay(b.batch_id, day, tenantId, actor);
      stats.posted += 1;
    } catch (error) {
      fail(`post ${b.batch_no} ${day}`, error);
    }
  }

  /**
   * A sow's own weight in gestation and lactation — the lifecycle's lactation weight is the piglets'.
   * A gilt is served at ~165 kg and gains 0.7 kg a day to ~245 kg at farrowing, then loses about 10% over
   * her lactation; an older sow gains 0.5 kg a day from ~205 kg and loses about 6.5%.
   */
  function sowWeight(animalId: string, stage: string, day: string): number | null {
    const gilt = (litters.get(animalId) ?? 0) === 0 || (stage === 'LACTATION' && (litters.get(animalId) ?? 0) === 1);
    const wobble = 0.99 + draw(`${animalId}:${day}:bw`) * 0.02;
    if (stage === 'GESTATION') {
      const since = Math.min(GESTATION, Math.max(0, daysBetween(lastService.get(animalId) ?? day, day)));
      return Math.round((gilt ? 165 + 0.7 * since : 205 + 0.5 * since) * wobble * 10) / 10;
    }
    if (stage === 'LACTATION') {
      const since = Math.min(NURSING, Math.max(0, daysBetween(lastFarrow.get(animalId) ?? day, day)));
      const atFarrow = gilt ? 165 + 0.7 * GESTATION : 205 + 0.5 * GESTATION;
      return Math.round(atFarrow * (1 - (gilt ? 0.0038 : 0.0025) * since) * wobble * 10) / 10;
    }
    return null;
  }

  async function animalWiseDay(b: typeof schema.batchHeader.$inferSelect, day: string) {
    const members = await animalsInBatchOn(t, b.batch_id, day);
    if (!members.length) return;
    const byStage = new Map<string, string[]>();
    for (const m of members) {
      if (!m.stage_id) continue;
      byStage.set(m.stage_id, [...(byStage.get(m.stage_id) ?? []), m.animal_id]);
    }
    const headers = await t.select().from(schema.schedulerHeader).where(eq(schema.schedulerHeader.batch_id, b.batch_id));
    for (const [sid, ids] of byStage) {
      const code = stageCode.get(sid);
      const header = headers.find((h) => h.stage_id === sid) ?? headers.find((h) => stageCode.get(h.stage_id) === code);
      if (!header) continue;
      for (const line of await dueLines(header, day)) {
        for (const animalId of ids) {
          const weight = line.kpi_metric === 'BODY_WEIGHT' ? sowWeight(animalId, code ?? '', day) : null;
          const body = weight != null ? { entered_value: weight } : valueFor(line, 1, `${animalId}:${line.line_id}:${day}`, code ?? '');
          if (body) await enter(b, day, line, { ...body, animal_id: animalId }, `${b.batch_no} ${code} ${line.activity_name} ${day}`);
        }
      }
      try {
        await batches.postStageDay(b.batch_id, header.stage_id, day, tenantId, actor);
        stats.posted += 1;
      } catch (error) {
        fail(`post ${b.batch_no} ${code} ${day}`, error);
      }
    }
  }

  // ---------------------------------------------------------------- the days
  const t0 = Date.now();
  let cursor = 0;
  for (let day = FROM; day <= END; day = addDays(day, 1)) {
    while (cursor < events.length && events[cursor].date < day) cursor += 1; // past-dated (seller's) services are run on day one
    const todays: Event[] = [];
    if (!RESUME && day === START) for (const e of events) if (e.date < START) todays.push(e);
    while (cursor < events.length && events[cursor].date === day) todays.push(events[cursor++]);
    for (const e of todays) await isolated(() => runEvent(e));
    await isolated(() => cohortMoves(day));

    const live = (await t.select().from(schema.batchHeader).where(eq(schema.batchHeader.status, 'ACTIVE')))
      .filter((b) => !b.deleted_at && iso(b.start_date) <= day);
    // Each batch runs in a context of its own: a service that opens a transaction keeps it in the
    // context, and two batches sharing one would write inside each other's transaction.
    await pool(live, CONCURRENCY, (b) => isolated(async () => {
      const runDay = (d: string) => (b.tracking_mode === 'ANIMAL_WISE' ? animalWiseDay(b, d) : batchWiseDay(b, d));
      // A day left unposted (a refusal) would block every later one, so it is finished first.
      for (let guard = 0; guard < 5; guard += 1) {
        let pending: string;
        try {
          pending = await batches.getNextPendingDate(b as any);
        } catch {
          break;
        }
        if (!pending || pending >= day || pending < iso(b.start_date)) break;
        await runDay(pending);
      }
      await runDay(day);
    }));

    // A batch every sow has left is closed on the day she left, once that day is behind it.
    for (const [batchId, left] of [...emptied]) {
      if (left >= day) continue;
      emptied.delete(batchId);
      await isolated(async () => {
        try {
          await batches.close(batchId, { actual_end_date: left } as any, tenantId, actor);
          stats.events += 1;
        } catch (error) {
          fail('close emptied service batch', error);
        }
      });
    }

    if (day.endsWith('-01') || day.endsWith('-15') || day === END) {
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`  ${day}  ${live.length} batches · ${stats.entries} entries · ${stats.posted} days posted · ${stats.events} events · ${stats.receipts} feed receipts · ${stats.failed} failed · ${mins} min`);
    }
  }
  console.log('');
  console.log(`Done: ${stats.entries} entries, ${stats.posted} posted days, ${stats.events} events, ${stats.receipts} feed receipts, ${stats.failed} failures`);
  if (failures.size) {
    console.log('Failures by kind:');
    for (const [k, n] of [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(6)}  ${k}`);
  }
}

if (process.argv.includes('--apply') && !TENANT_CODE) {
  console.error('Name the tenant: TRIPLEC_TENANT_CODE=<code> (the showcase is ccc).');
  process.exitCode = 1;
} else if (process.argv.includes('--apply')) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error instanceof Error ? error.stack : error}`);
    process.exitCode = 1;
  });
} else {
  console.log(`Plan only: plays ${TENANT_CODE} forward from ${START} to ${END} — add --apply to run it.`);
}
