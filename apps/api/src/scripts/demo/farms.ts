/**
 * The nine Triple C farms, resolved by code, as the chapters see them.
 *
 * Before this file the chapters knew two farms by name (`grasmere`,
 * `kintyre`) and every shed, silo and pen they touched was a hard-coded
 * location_code. seed-nine-farm-demo.ts then built nine farms with a regular
 * shape — `<CODE>/SHED-00n` sheds named `<CODE> <Role> House`, one
 * `<CODE>/SHED-00n/SILO-001` per shed, `<CODE>/SHED-00n/PEN-00m` pens, one
 * `<CODE>/STORE-001` store — so the chapters can resolve all nine by code
 * instead of naming two.
 *
 * Only the seeded sheds are considered: MUL100 and POR100 still carry the
 * legacy sheds loaded from Triple C's own location template (MUGR1, PGH2P7,
 * …), which are shaped differently and have no silos. Filtering on the
 * `<CODE>/SHED-` code prefix keeps the demo on the one regular structure
 * rather than guessing which legacy row plays which role.
 *
 * Roles are docs/decisions.md's last section: Multiplier breeds and sends
 * gilts, AI Station holds boars only, Lionshead Extension holds weaners and
 * growers only, the other six are farrow-to-finish. A role decides what a
 * farm may be asked to do; what it can actually *carry* is decided by data —
 * a batch stage is only used when the farm's breed has an active
 * breed_lifecycle_stages row for it, because without one the auto-generated
 * scheduler is born empty and no daily entry can post.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../core/database/schema';

type Db = MySql2Database<typeof schema>;

/** The nine farms of the demo, in the order the chapters walk them. */
export const DEMO_FARM_CODES = ['MUL100', 'POR100', 'RIC100', 'VIL100', 'GRA100', 'LEA100', 'LIO100', 'AI100', 'LEX100'] as const;
export type DemoFarmCode = (typeof DEMO_FARM_CODES)[number];

/** What a farm is for (docs/decisions.md, "Nine-farm demo data"). */
export type FarmRole = 'MULTIPLIER' | 'AI_STATION' | 'GROW_OUT' | 'FARROW_TO_FINISH';

const FARM_ROLES: Record<DemoFarmCode, FarmRole> = {
  MUL100: 'MULTIPLIER',
  AI100: 'AI_STATION',
  LEX100: 'GROW_OUT',
  POR100: 'FARROW_TO_FINISH',
  RIC100: 'FARROW_TO_FINISH',
  VIL100: 'FARROW_TO_FINISH',
  GRA100: 'FARROW_TO_FINISH',
  LEA100: 'FARROW_TO_FINISH',
  LIO100: 'FARROW_TO_FINISH',
};

/**
 * The two farms the chapters used to name. Kept so `ctx.farms.grasmere` /
 * `.kintyre` still resolve for anything outside these chapters that reads
 * them, and so MUL100 and POR100 keep the DEMO tokens their existing rows
 * already carry (see LEGACY_BATCH_REFS).
 */
export const LEGACY_FARM_KEYS: Partial<Record<DemoFarmCode, 'grasmere' | 'kintyre'>> = {
  MUL100: 'grasmere',
  POR100: 'kintyre',
};

/** Shed roles, read off the seeded shed name. */
export type ShedRole = 'GILT' | 'GILT_REARING' | 'DRY_SOW' | 'FARROWING' | 'WEANER' | 'GROWER' | 'FINISHER' | 'BOAR';

/** Longest match first: "Gilt Rearing House" must not read as "Gilt House". */
const SHED_ROLE_PATTERNS: Array<[RegExp, ShedRole]> = [
  [/gilt rearing/i, 'GILT_REARING'],
  [/dry sow/i, 'DRY_SOW'],
  [/farrowing/i, 'FARROWING'],
  [/weaner/i, 'WEANER'],
  [/finisher/i, 'FINISHER'],
  [/grower/i, 'GROWER'],
  [/boar/i, 'BOAR'],
  [/gilt/i, 'GILT'],
];

function shedRoleOf(name: string): ShedRole | null {
  for (const [pattern, role] of SHED_ROLE_PATTERNS) if (pattern.test(name)) return role;
  return null;
}

export interface DemoShed {
  shedId: string;
  code: string;
  name: string;
  role: ShedRole | null;
  /** The shed's feed silo, or null on a shed the seed gave none. */
  siloId: string | null;
  siloCode: string | null;
  penIds: string[];
}

export interface DemoBreed {
  breedId: string;
  code: string;
  name: string;
  gestationDays: number | null;
  /** stage_code -> stage_id, for every stage this breed has an active lifecycle row for. */
  lifecycleStages: Map<string, string>;
}

export interface FarmVolume {
  /** Registered breeding stock created one by one through AnimalService. */
  sows: number;
  boars: number;
  gilts: number;
  /** Count-only batches, on top of the one registered batch. */
  countOnlyBatches: number;
  /** Multiplies the per-stage base opening quantity of a count-only batch. */
  herdScale: number;
  /** Days of posted daily entries, ending yesterday. Also the batch start offset. */
  days: number;
  /** Sows put through 05-breeding on this farm. */
  breedingSows: number;
}

export interface DemoFarm {
  /** 'grasmere' / 'kintyre' where those names already existed, else the lower-cased code. */
  key: string;
  code: DemoFarmCode;
  name: string;
  farmId: string;
  role: FarmRole;
  sheds: DemoShed[];
  /** The farm's store — `<CODE>/STORE-001`, "Demo Medicine Store". */
  storeId: string | null;
  /** The farm's sow line, absent on the AI station. */
  sowBreed: DemoBreed | null;
  /** A boar line where the farm has one (the AI station has only these). */
  boarBreed: DemoBreed | null;
  volume: FarmVolume;
}

/** Sheds of a role, in code order. */
export function shedsWithRole(farm: DemoFarm, ...roles: ShedRole[]): DemoShed[] {
  return farm.sheds.filter((s) => s.role && roles.includes(s.role));
}

/** Every pen of the first shed carrying one of these roles, falling back through the list. */
export function pensForRole(farm: DemoFarm, ...roles: ShedRole[]): string[] {
  for (const role of roles) {
    const pens = shedsWithRole(farm, role).flatMap((s) => s.penIds);
    if (pens.length) return pens;
  }
  return farm.sheds.flatMap((s) => s.penIds);
}

/** The farm's feed silos, in code order. Every seeded farm has at least two. */
export function silosOf(farm: DemoFarm): Array<{ id: string; code: string }> {
  return farm.sheds
    .filter((s): s is DemoShed & { siloId: string; siloCode: string } => !!s.siloId && !!s.siloCode)
    .map((s) => ({ id: s.siloId, code: s.siloCode }));
}

/** The breed a batch on this farm runs under: the sow line, or the boar line on the AI station. */
export function batchBreedOf(farm: DemoFarm): DemoBreed | null {
  return farm.sowBreed ?? farm.boarBreed;
}

/** May this farm mate, farrow and wean? The AI station and the grow-out site may not. */
export function farmCanBreed(farm: DemoFarm): boolean {
  if (farm.role === 'AI_STATION' || farm.role === 'GROW_OUT') return false;
  const breed = farm.sowBreed;
  return !!breed && !!breed.gestationDays && breed.lifecycleStages.has('FARROWING');
}

/** May this farm hold individually registered breeding stock? The grow-out site may not. */
export function farmCanRegisterAnimals(farm: DemoFarm): boolean {
  return farm.role !== 'GROW_OUT' && !!batchBreedOf(farm);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Volume
 */

export type VolumeProfileName = 'full' | 'standard' | 'light';
export const VOLUME_PROFILES: VolumeProfileName[] = ['full', 'standard', 'light'];

/** Rishi's numbers for a full farm: ~40 sows, 3 boars, 15 gilts, 3–4 batches, ~30 days. */
const FULL: FarmVolume = { sows: 40, boars: 3, gilts: 15, countOnlyBatches: 3, herdScale: 1, days: 30, breedingSows: 5 };
const LIGHT: FarmVolume = { sows: 12, boars: 2, gilts: 6, countOnlyBatches: 2, herdScale: 0.5, days: 14, breedingSows: 3 };
const MINIMAL: FarmVolume = { sows: 6, boars: 1, gilts: 3, countOnlyBatches: 1, herdScale: 0.35, days: 7, breedingSows: 2 };

/**
 * Rishi asked for the full volume on every farm but said "enough or less if it
 * takes a lot of time". Nine farms at the full numbers is ~2,400 posted daily
 * entries, each one a FIFO draw plus a GL posting, so the default profile runs
 * three farrow-to-finish farms at the full numbers and the rest lighter. Pass
 * `--volume=full` for Rishi's numbers everywhere, `--volume=light` for the
 * quickest pass that still proves every write path.
 */
const FULL_TIER_CODES: DemoFarmCode[] = ['POR100', 'RIC100', 'VIL100'];

export function volumeFor(code: DemoFarmCode, role: FarmRole, profile: VolumeProfileName): FarmVolume {
  const base = profile === 'light' ? MINIMAL : profile === 'full' ? FULL : FULL_TIER_CODES.includes(code) ? FULL : LIGHT;

  // The two specialist farms carry no sow herd at all: the AI station is boars
  // only, and the grow-out site holds bought-in weaners and growers as count
  // only. Their days follow the profile so the History rail lines up.
  if (role === 'AI_STATION') {
    return { ...base, sows: 0, gilts: 0, boars: Math.max(base.boars * 2, 6), countOnlyBatches: 1, breedingSows: 0 };
  }
  if (role === 'GROW_OUT') {
    return { ...base, sows: 0, gilts: 0, boars: 0, countOnlyBatches: 2, breedingSows: 0 };
  }
  return base;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Resolution
 */

interface BreedRow {
  breed_id: string;
  breed_code: string;
  breed_name: string;
  gestation_days: number | null;
}

/**
 * Reads the nine farms and everything hanging off them in a handful of
 * queries, and refuses — never guesses — on a farm the seed has not built.
 */
export async function resolveDemoFarms(db: Db, companyId: string, profile: VolumeProfileName): Promise<DemoFarm[]> {
  const farmRows = await db
    .select({
      location_id: schema.locationMaster.location_id,
      location_code: schema.locationMaster.location_code,
      location_name: schema.locationMaster.location_name,
    })
    .from(schema.locationMaster)
    .where(and(
      inArray(schema.locationMaster.location_code, [...DEMO_FARM_CODES]),
      eq(schema.locationMaster.location_type, 'FARM'),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
    ));
  const farmByCode = new Map(farmRows.map((f) => [f.location_code as DemoFarmCode, f]));
  const missing = DEMO_FARM_CODES.filter((c) => !farmByCode.has(c));
  if (missing.length) {
    throw new Error(`Demo farms ${missing.join(', ')} not found or inactive — run seed-nine-farm-demo.ts --apply before the chapters.`);
  }
  const farmIds = farmRows.map((f) => f.location_id);

  // Sheds, silos and pens of the seeded structure only (the `<CODE>/SHED-`
  // prefix); MUL100 and POR100's legacy template sheds are deliberately left
  // out — see the file header.
  const descendants = await db
    .select({
      location_id: schema.locationMaster.location_id,
      location_code: schema.locationMaster.location_code,
      location_name: schema.locationMaster.location_name,
      location_type: schema.locationMaster.location_type,
      parent_location_id: schema.locationMaster.parent_location_id,
      farm_id: schema.locationMaster.farm_id,
    })
    .from(schema.locationMaster)
    .where(and(
      inArray(schema.locationMaster.farm_id, farmIds),
      inArray(schema.locationMaster.location_type, ['SHED', 'SILO', 'PEN', 'STORE']),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
    ));

  // Breeds and their lifecycle stages. Breed profiles are company-wide, not
  // per farm (Farm was removed from Breed Master), so every farm below draws
  // from the same company breed set rather than a farm-filtered one.
  const breedRows: BreedRow[] = await db
    .select({
      breed_id: schema.breedMaster.breed_id,
      breed_code: schema.breedMaster.breed_code,
      breed_name: schema.breedMaster.breed_name,
      gestation_days: schema.breedMaster.gestation_days,
    })
    .from(schema.breedMaster)
    .where(and(
      eq(schema.breedMaster.company_id, companyId),
      eq(schema.breedMaster.is_active, true),
      isNull(schema.breedMaster.deleted_at),
    ));

  const lifecycleRows = breedRows.length
    ? await db
        .select({ breed_id: schema.breedLifecycleStages.breed_id, stage_id: schema.stageMaster.stage_id, stage_code: schema.stageMaster.stage_code })
        .from(schema.breedLifecycleStages)
        .innerJoin(schema.stageMaster, eq(schema.stageMaster.stage_id, schema.breedLifecycleStages.stage_id))
        .where(and(
          inArray(schema.breedLifecycleStages.breed_id, breedRows.map((b) => b.breed_id)),
          eq(schema.breedLifecycleStages.is_active, true),
          eq(schema.stageMaster.company_id, companyId),
          eq(schema.stageMaster.is_active, true),
          isNull(schema.stageMaster.deleted_at),
        ))
    : [];
  const stagesByBreed = new Map<string, Map<string, string>>();
  for (const row of lifecycleRows) {
    const map = stagesByBreed.get(row.breed_id) ?? new Map<string, string>();
    map.set(row.stage_code, row.stage_id);
    stagesByBreed.set(row.breed_id, map);
  }

  const toBreed = (row: BreedRow): DemoBreed => ({
    breedId: row.breed_id,
    code: row.breed_code,
    name: row.breed_name,
    gestationDays: row.gestation_days == null ? null : Number(row.gestation_days),
    lifecycleStages: stagesByBreed.get(row.breed_id) ?? new Map(),
  });

  return DEMO_FARM_CODES.map((code) => {
    const farm = farmByCode.get(code)!;
    const own = descendants.filter((d) => d.farm_id === farm.location_id);
    const shedPrefix = `${code}/SHED-`;

    const silosByParent = new Map(own.filter((d) => d.location_type === 'SILO').map((d) => [d.parent_location_id ?? '', d]));
    const pensByParent = new Map<string, string[]>();
    for (const pen of own.filter((d) => d.location_type === 'PEN')) {
      const list = pensByParent.get(pen.parent_location_id ?? '') ?? [];
      list.push(pen.location_id);
      pensByParent.set(pen.parent_location_id ?? '', list);
    }

    const sheds: DemoShed[] = own
      .filter((d) => d.location_type === 'SHED' && d.location_code.startsWith(shedPrefix))
      .sort((a, b) => a.location_code.localeCompare(b.location_code))
      .map((shed) => {
        const silo = silosByParent.get(shed.location_id);
        return {
          shedId: shed.location_id,
          code: shed.location_code,
          name: shed.location_name,
          role: shedRoleOf(shed.location_name),
          siloId: silo?.location_id ?? null,
          siloCode: silo?.location_code ?? null,
          penIds: (pensByParent.get(shed.location_id) ?? []).sort(),
        };
      });
    if (sheds.length === 0) {
      throw new Error(`Demo farm ${code} has no '${shedPrefix}…' sheds — run seed-nine-farm-demo.ts --apply before the chapters.`);
    }

    const store = own.find((d) => d.location_type === 'STORE' && d.location_code.startsWith(`${code}/STORE-`));

    const farmBreeds = breedRows.map(toBreed);
    // The sow line is the one with a gestation period; boar lines have none.
    // A teaser boar is not a sire the demo mates with, so it is never chosen
    // as the farm's boar line when a real one is present.
    const sowBreed = farmBreeds.find((b) => b.gestationDays != null) ?? null;
    const boarBreed =
      farmBreeds.find((b) => b.gestationDays == null && !/teaser/i.test(b.code)) ??
      farmBreeds.find((b) => b.gestationDays == null) ??
      null;

    const role = FARM_ROLES[code];
    return {
      key: LEGACY_FARM_KEYS[code] ?? code.toLowerCase(),
      code,
      name: farm.location_name,
      farmId: farm.location_id,
      role,
      sheds,
      storeId: store?.location_id ?? null,
      sowBreed,
      boarBreed,
      volume: volumeFor(code, role, profile),
    };
  });
}

/**
 * The DEMO tokens MUL100 and POR100's existing batches already carry. The
 * generalised chapters key everything by farm code, but re-keying these three
 * would have re-posted batches that are already in the tenant, so the two
 * farms that ran under the old two-farm chapters keep their old tokens and
 * stay idempotent.
 */
const LEGACY_BATCH_REFS: Record<string, string> = {
  'MUL100|REG': 'DEMO-BATCH-REG-GRASMERE',
  'MUL100|CO-GESTATION': 'DEMO-BATCH-CO-GRASMERE',
  'POR100|CO-GESTATION': 'DEMO-BATCH-CO-KINTYRE',
};

/** The remarks token a demo batch is found by — the chapters' only handle on it. */
export function batchRef(code: DemoFarmCode, suffix: string): string {
  return LEGACY_BATCH_REFS[`${code}|${suffix}`] ?? `DEMO-${code}-${suffix}`;
}

/**
 * Ear tags. MUL100 keeps the unprefixed scheme its nine existing animals were
 * registered under (`DEMO-SOW-01`, `DEMO-BOAR-01`), so a re-run adopts them
 * instead of registering a second herd beside them; every other farm carries
 * its code.
 */
export function earTag(code: DemoFarmCode, type: 'SOW' | 'BOAR' | 'GILT', index: number): string {
  const n = String(index).padStart(2, '0');
  return code === 'MUL100' ? `DEMO-${type}-${n}` : `DEMO-${code}-${type}-${n}`;
}

/** Fixed-width farm tag for the chapter logs. */
export function tagOf(farm: DemoFarm): string {
  return `  ${farm.code.padEnd(6)}:`;
}
