/**
 * Pure planning for seed-test-company.ts: replace one company's data (inside a
 * tenant database) with a clean, realistic test dataset.
 *
 *   - command line + refusals (the same shape as seed-test-masters.lib.ts);
 *   - the wipe: which tables, in what foreign-key order, and how a table that has
 *     no company_id of its own is reached through its parents;
 *   - the structure: four TEST FARMs (4/5/6/5 sheds, 4-6 pens a shed, silos
 *     following the four approved topologies, a store each) and the sixteen
 *     batches / 160 registered animals that stand in them;
 *   - the 14-day history: window dates, deterministic deaths, weights, feed fill.
 *
 * No database access here. Nothing in this file is client data: every name is
 * labelled TEST and every number is ours.
 */
import type { FarmSeed, FourFarmFeedFixture } from './demo/four-farm-feed-fixture';

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------
export interface TestCompanyArgs {
  tenant: string;
  company: string;
  sourceTenant: string;
  sourceCompany: string;
  days: number;
  mode: 'plan' | 'verify' | 'apply';
}

const VALUE_FLAGS: Record<string, 'tenant' | 'company' | 'sourceTenant' | 'sourceCompany'> = {
  '--tenant': 'tenant',
  '--company': 'company',
  '--source-tenant': 'sourceTenant',
  '--source-company': 'sourceCompany',
};

export function parseTestCompanyArgs(argv: string[]): TestCompanyArgs {
  const out: Record<string, string> = { sourceTenant: 'devco', sourceCompany: 'TRIPLEC' };
  let apply = false;
  let verify = false;
  let days = 14;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--verify') verify = true;
    else if (a === '--days') {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v < 3 || v > 60) throw new Error('--days needs a whole number from 3 to 60.');
      days = v; i += 1;
    } else if (VALUE_FLAGS[a]) {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value.`);
      out[VALUE_FLAGS[a]] = v; i += 1;
    } else {
      throw new Error(`Unknown argument '${a}'. Use --tenant, --company, optionally --source-tenant, --source-company, --days N, and --verify or --apply.`);
    }
  }
  if (apply && verify) throw new Error('Use --verify or --apply, not both.');
  if (!out.tenant) throw new Error('--tenant is required (tenant code or database name).');
  if (!out.company) throw new Error('--company is required (company code or id). This script replaces that company\'s data.');
  return {
    tenant: out.tenant, company: out.company, sourceTenant: out.sourceTenant, sourceCompany: out.sourceCompany,
    days, mode: apply ? 'apply' : verify ? 'verify' : 'plan',
  };
}

/** Masters are copied FROM the source, so the target may never be the source. */
export function assertTargetIsNotSource(src: { db: string; companyId: string }, tgt: { db: string; companyId: string }): void {
  if (src.db === tgt.db && src.companyId === tgt.companyId) {
    throw new Error('Target company is the source company. Masters are copied FROM the source; refusing to wipe it.');
  }
}

// ---------------------------------------------------------------------------
// The wipe
// ---------------------------------------------------------------------------
/** Tables that are never touched even though they carry company_id: the company itself, its people and its access. */
export const KEEP_TABLES: ReadonlySet<string> = new Set([
  'company_master', 'company_address', 'company_contacts', 'company_currency_config', 'company_fiscal',
  'company_language_config', 'company_modules', 'setup_wizard_log',
  'user_master', 'user_company_assignments', 'user_operational_area_assignment', 'user_role_assignment',
  'role_master', 'role_permissions',
  'operational_area_master', 'operational_area_settings',
  'audit_log',
  '__drizzle_migrations',
]);

export interface FkEdge { table: string; column: string; refTable: string; refColumn: string; nullable: boolean }

export interface DeletePlan {
  /** Tables in delete order: a child always comes before the table it references. */
  order: string[];
  /** Foreign-key columns set to NULL (for the target company's rows) before deleting, to break cycles and self-references. */
  nullify: Array<{ table: string; column: string }>;
}

/**
 * Child tables first. A table can be deleted once no remaining table references it. A cycle (or a table that
 * references itself) is broken by nulling one nullable foreign key on it; a cycle with no nullable key is an error.
 */
export function planDeleteOrder(tables: string[], edges: FkEdge[]): DeletePlan {
  const set = new Set(tables);
  const nullify: DeletePlan['nullify'] = [];
  let live = edges.filter((e) => set.has(e.table) && set.has(e.refTable));
  for (const e of live.filter((x) => x.table === x.refTable)) {
    if (!e.nullable) throw new Error(`Table ${e.table} references itself through NOT NULL column ${e.column}; cannot order the delete.`);
    nullify.push({ table: e.table, column: e.column });
  }
  live = live.filter((e) => e.table !== e.refTable);
  const remaining = new Set(tables);
  const order: string[] = [];
  while (remaining.size) {
    const referencedBy = new Map<string, number>();
    for (const e of live) if (remaining.has(e.table) && remaining.has(e.refTable)) referencedBy.set(e.refTable, (referencedBy.get(e.refTable) || 0) + 1);
    const ready = [...remaining].filter((t) => !referencedBy.get(t)).sort();
    if (ready.length) {
      for (const t of ready) { order.push(t); remaining.delete(t); }
      continue;
    }
    // Every remaining table is referenced by another remaining one: a cycle. Break it at a nullable key.
    const breakable = live
      .filter((e) => remaining.has(e.table) && remaining.has(e.refTable) && e.nullable)
      .sort((a, b) => (a.table + a.column).localeCompare(b.table + b.column));
    if (!breakable.length) throw new Error(`Foreign-key cycle with no nullable column among: ${[...remaining].sort().join(', ')}.`);
    const cut = breakable[0];
    nullify.push({ table: cut.table, column: cut.column });
    live = live.filter((e) => e !== cut);
  }
  return { order, nullify };
}

/** A table kept as is that has a foreign key into a table being emptied: its rows for the target must be unlinked. */
export function planKeptReferences(deleteSet: ReadonlySet<string>, keepSet: ReadonlySet<string>, edges: FkEdge[]): FkEdge[] {
  return edges.filter((e) => deleteSet.has(e.refTable) && !deleteSet.has(e.table) && keepSet.has(e.table));
}

export interface ChildPath { table: string; chain: FkEdge[] }

/**
 * A table with no company_id of its own is reached through its parents: [edge to parent, edge parent -> grandparent, ...]
 * ending at a company-scoped table that is being emptied. One path per distinct parent edge, shortest first.
 */
export function planChildPaths(companyDeleteTables: ReadonlySet<string>, allTables: string[], edges: FkEdge[]): ChildPath[] {
  const reached = new Map<string, FkEdge[][]>();
  for (const t of companyDeleteTables) reached.set(t, [[]]);
  const paths: ChildPath[] = [];
  for (let depth = 0; depth < 6; depth += 1) {
    let progressed = false;
    for (const t of [...allTables].sort()) {
      if (companyDeleteTables.has(t) || reached.has(t)) continue;
      const mine: FkEdge[][] = [];
      for (const e of edges.filter((x) => x.table === t && x.refTable !== t)) {
        const parent = reached.get(e.refTable);
        if (!parent) continue;
        mine.push([e, ...parent[0]]);
      }
      if (mine.length) {
        reached.set(t, mine);
        for (const chain of mine) paths.push({ table: t, chain });
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return paths;
}

const q = (name: string) => `\`${name.replace(/`/g, '')}\``;

/** DELETE t0 FROM t JOIN parent ... WHERE root.company_id = ?  (one statement per path). */
export function buildChildDeleteSql(path: ChildPath): string {
  const joins = path.chain.map((e, i) => `JOIN ${q(e.refTable)} t${i + 1} ON t${i}.${q(e.column)} = t${i + 1}.${q(e.refColumn)}`);
  return `DELETE t0 FROM ${q(path.table)} t0 ${joins.join(' ')} WHERE t${path.chain.length}.company_id = ?`;
}

// ---------------------------------------------------------------------------
// The structure
// ---------------------------------------------------------------------------
export const SHEDS_PER_FARM = [4, 5, 6, 5] as const;
/** The feed each silo holds, by handle; the seed resolves a handle to the copied item by name. */
export type FeedHandle = 'FEED_GESTATION' | 'FEED_LACTATION' | 'FEED_GROWER';
export const FEED_ITEM_NAME: Record<FeedHandle, string> = {
  FEED_GESTATION: 'Dry Sow Gestation Mash (14% CP)',
  FEED_LACTATION: 'High-Density Lactation Diet (17.5% CP)',
  FEED_GROWER: 'Weaner Grower Mash (18% CP)',
};
export const ITEM_SOW = 'Mature Parity Breeding Sow';
export const ITEM_WEANED = 'Weaned Feeder Piglet (7-10kg)';

export const pensInShed = (farmNo: number, shedNo: number): number => 4 + ((farmNo + shedNo) % 3);

interface SiloSpec { n: number; feed: FeedHandle; capacityKg: number; sheds: number[] }
/** silo_shed_link topology per farm: 1:1, one silo shared by several sheds, many-to-many, mixed. */
export const SILO_TOPOLOGY: Record<number, SiloSpec[]> = {
  1: [
    { n: 1, feed: 'FEED_GESTATION', capacityKg: 12000, sheds: [1] },
    { n: 2, feed: 'FEED_GROWER', capacityKg: 12000, sheds: [2] },
    { n: 3, feed: 'FEED_GROWER', capacityKg: 12000, sheds: [3] },
    { n: 4, feed: 'FEED_GROWER', capacityKg: 12000, sheds: [4] },
  ],
  2: [
    { n: 1, feed: 'FEED_GESTATION', capacityKg: 20000, sheds: [1, 2, 3] },
    { n: 2, feed: 'FEED_GROWER', capacityKg: 20000, sheds: [4, 5] },
  ],
  3: [
    { n: 1, feed: 'FEED_GESTATION', capacityKg: 15000, sheds: [1, 2, 3, 4, 5, 6] },
    { n: 2, feed: 'FEED_GROWER', capacityKg: 15000, sheds: [1, 2, 3, 4, 5, 6] },
  ],
  4: [
    { n: 1, feed: 'FEED_GROWER', capacityKg: 12000, sheds: [1] },
    { n: 2, feed: 'FEED_GESTATION', capacityKg: 12000, sheds: [2, 3] },
    { n: 3, feed: 'FEED_GROWER', capacityKg: 12000, sheds: [3, 4] },
  ],
};

export type BatchKind = 'A' | 'B' | 'C' | 'D';
export interface BatchSpec {
  farmNo: number;
  kind: BatchKind;
  tracking: 'ANIMAL_WISE' | 'BATCH_WISE';
  /** Registered animals created for this batch (A: 20 sows, B: 20 weaners, C/D: none). */
  animals: number;
  /** Opening head of a BATCH_WISE batch. */
  openingHead: number;
  /** The feed the batch mainly draws, used to put it in a shed that has a silo for it. */
  mainFeed: FeedHandle;
  remarks: string;
}

export function batchesForFarm(farmNo: number): BatchSpec[] {
  const ref = (k: BatchKind) => `TESTCO-F${farmNo}-${k}`;
  return [
    { farmNo, kind: 'A', tracking: 'ANIMAL_WISE', animals: 20, openingHead: 0, mainFeed: 'FEED_GESTATION', remarks: ref('A') },
    { farmNo, kind: 'B', tracking: 'BATCH_WISE', animals: 20, openingHead: 20, mainFeed: 'FEED_GROWER', remarks: ref('B') },
    { farmNo, kind: 'C', tracking: 'BATCH_WISE', animals: 0, openingHead: 80 + 10 * farmNo, mainFeed: 'FEED_GROWER', remarks: ref('C') },
    { farmNo, kind: 'D', tracking: 'BATCH_WISE', animals: 0, openingHead: 120 - 10 * farmNo, mainFeed: 'FEED_GROWER', remarks: ref('D') },
  ];
}

export interface TestCompanyPlan {
  fixture: FourFarmFeedFixture;
  farmNames: string[];
  batches: BatchSpec[];
}

export const farmName = (farmNo: number) => `TEST FARM ${farmNo}`;

export function buildTestCompanyPlan(): TestCompanyPlan {
  const farms: FarmSeed[] = SHEDS_PER_FARM.map((shedCount, i) => {
    const f = i + 1;
    const name = farmName(f);
    const sheds = Array.from({ length: shedCount }, (_, s) => {
      const shedNo = s + 1;
      const pens = Array.from({ length: pensInShed(f, shedNo) }, (_, p) => ({
        key: `F${f}-SHED${shedNo}-P${p + 1}`, name: `${name} Shed ${shedNo} Pen ${p + 1}`, capacity: 25,
      }));
      return { key: `F${f}-SHED${shedNo}`, name: `${name} Shed ${shedNo}`, capacity: pens.length * 25, pens };
    });
    const silos = SILO_TOPOLOGY[f].map((s) => ({
      key: `F${f}-SILO${s.n}`, name: `${name} Silo ${s.n}`, siloCapacityKg: s.capacityKg, siloCapacityUom: 'KG' as const,
      siloReorderDays: 2, feedItemKeys: [s.feed as string],
    }));
    const links: Record<string, string[]> = {};
    for (const s of SILO_TOPOLOGY[f]) links[`F${f}-SILO${s.n}`] = s.sheds.map((n) => `F${f}-SHED${n}`);
    return { key: `FARM${f}`, name, address: null, sheds, silos, links };
  });
  return {
    fixture: {
      provenance: 'Test dataset (seed-test-company.ts). Every name is labelled TEST; nothing here is client data.',
      farms,
    },
    farmNames: farms.map((f) => f.name),
    batches: [1, 2, 3, 4].flatMap(batchesForFarm),
  };
}

export interface PlanCounts {
  farms: number; sheds: number; pens: number; silos: number; stores: number; links: number;
  batches: number; animalWiseBatches: number; batchWiseBatches: number; registeredAnimals: number; countOnlyBatches: number;
}

export function planCounts(plan: TestCompanyPlan): PlanCounts {
  const farms = plan.fixture.farms;
  return {
    farms: farms.length,
    sheds: farms.reduce((n, f) => n + f.sheds.length, 0),
    pens: farms.reduce((n, f) => n + f.sheds.reduce((m, s) => m + s.pens.length, 0), 0),
    silos: farms.reduce((n, f) => n + f.silos.length, 0),
    stores: farms.length,
    links: farms.reduce((n, f) => n + Object.values(f.links).reduce((m, l) => m + l.length, 0), 0),
    batches: plan.batches.length,
    animalWiseBatches: plan.batches.filter((b) => b.tracking === 'ANIMAL_WISE').length,
    batchWiseBatches: plan.batches.filter((b) => b.tracking === 'BATCH_WISE').length,
    countOnlyBatches: plan.batches.filter((b) => b.tracking === 'BATCH_WISE' && b.animals === 0).length,
    registeredAnimals: plan.batches.reduce((n, b) => n + b.animals, 0),
  };
}

/**
 * The shed each batch stands in, per farm: a shed linked to a silo that holds the batch's main feed when one is
 * free, else the first free shed (its feed then comes from the farm store).
 */
export function placeBatchesInSheds(farmNo: number, batches: BatchSpec[]): Map<BatchKind, number> {
  const shedCount = SHEDS_PER_FARM[farmNo - 1];
  const used = new Set<number>();
  const placed = new Map<BatchKind, number>();
  for (const b of batches) {
    const withFeed = SILO_TOPOLOGY[farmNo]
      .filter((s) => s.feed === b.mainFeed)
      .flatMap((s) => s.sheds)
      .filter((n) => !used.has(n))
      .sort((a, c) => a - c);
    const free = Array.from({ length: shedCount }, (_, i) => i + 1).filter((n) => !used.has(n));
    const pick = withFeed[0] ?? free[0];
    if (pick === undefined) throw new Error(`Farm ${farmNo} has no free shed for batch ${b.kind}.`);
    used.add(pick);
    placed.set(b.kind, pick);
  }
  return placed;
}

// ---------------------------------------------------------------------------
// The history
// ---------------------------------------------------------------------------
/** YYYY-MM-DD for `today - n` days, computed in UTC like the services' own "today". */
export function dateOffset(today: string, n: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** The window: `days` dates in order, ending yesterday. Today is never in it. */
export function historyDates(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => dateOffset(today, days - i));
}

/** Day number within the window (1-based) for a fraction of it, clamped, so --days other than 14 still has deaths. */
export function dayAt(days: number, fraction: number): number {
  return Math.min(days, Math.max(1, Math.round(days * fraction)));
}

export interface DeathEvent { dayNo: number; deaths: number }
/**
 * Deaths per batch kind, by window day. Count-only batches (C, D) lose 1-2 on two different days; the
 * registered-animal batch B names registered animals on two days; batch A loses exactly one animal on one day.
 */
export function deathSchedule(kind: BatchKind, farmNo: number, days: number): DeathEvent[] {
  const shift = (farmNo % 2) * 0.04;
  switch (kind) {
    case 'A': return [{ dayNo: dayAt(days, 0.57 + shift), deaths: 1 }];
    case 'B': return [{ dayNo: dayAt(days, 0.43 + shift), deaths: 1 }, { dayNo: dayAt(days, 0.86 - shift), deaths: 2 }];
    case 'C': return [{ dayNo: dayAt(days, 0.36 + shift), deaths: 1 }, { dayNo: dayAt(days, 0.79 - shift), deaths: 2 }];
    case 'D': return [{ dayNo: dayAt(days, 0.29 + shift), deaths: 2 }, { dayNo: dayAt(days, 0.71 - shift), deaths: 1 }];
  }
}

export function deathsOn(kind: BatchKind, farmNo: number, days: number, dayNo: number): number {
  return deathSchedule(kind, farmNo, days).filter((e) => e.dayNo === dayNo).reduce((n, e) => n + e.deaths, 0);
}

/** Dead weight (kg) of a death on a window day: sows ~170 kg, piglets/growers a little heavier each day. */
export function deadWeightKg(kind: BatchKind, dayNo: number): number {
  return kind === 'A' ? 165 + dayNo : Math.round((9 + dayNo * 0.6) * 10) / 10;
}

/** Live weight (kg) for a body-weight line: sows steady, young stock growing about 0.45 kg a day. */
export function bodyWeightKg(kind: BatchKind, dayNo: number, animalIndex = 0): number {
  if (kind === 'A') return 150 + (animalIndex % 7) + dayNo * 0.3;
  return Math.round((9 + dayNo * 0.45 + (animalIndex % 3) * 0.2) * 10) / 10;
}

/** Feed varies +-2% day to day so consumption is not flat. */
export const feedFactor = (dayNo: number): number => (dayNo % 2 === 1 ? 1.02 : 0.98);

/** Weekly lines fall on the weekday of the window's first day. */
export function isWeeklyDue(date: string, anchor: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === new Date(`${anchor}T00:00:00Z`).getUTCDay();
}

/** How much of a feed item to receive: the upper-bound demand of the window, times a margin, never under a floor. */
export function feedReceiptKg(demandKg: number, capacityKg: number | null, floorKg = 2000): number {
  const want = Math.max(floorKg, Math.ceil(demandKg * 1.6));
  return capacityKg == null ? want : Math.min(want, Math.floor(capacityKg * 0.8));
}

/** Round-robin split of `total` animals over `stages` (A's sows spread over Gestation / Farrowing / Lactation). */
export function spreadOverStages<T>(total: number, stages: T[]): T[] {
  if (!stages.length) throw new Error('No stages to spread animals over.');
  return Array.from({ length: total }, (_, i) => stages[i % stages.length]);
}

export function genderFor(applicableGender: string | null | undefined, index: number, fallback: 'F' | 'M' | 'ALT'): 'F' | 'M' {
  if (applicableGender === 'F' || applicableGender === 'M') return applicableGender;
  if (fallback === 'ALT') return index % 2 === 0 ? 'F' : 'M';
  return fallback;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------
export const MORTALITY_REASON_NAMES = ['Respiratory disease', 'Crushed by sow', 'Heat stress'] as const;
