/**
 * The nine-farm demo master set (docs/decisions.md, "Nine-farm demo data and
 * the 15 September master corrections").
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * MASTERS ONLY. Nothing here posts an operational row — no batch, no animal,
 * no inventory, no scheduler instance. The operational chapters
 * (src/scripts/demo/chapters/*) post those through the application's own
 * services, and this script's whole job is to leave a database they can run
 * against: nine farms with a location tree, the three missing stages, a breed
 * per farm with a full lifecycle, and a data-entry login per farm.
 *
 * What it seeds, per the decision of 15 Sep:
 *   1. The nine farms that submitted templates, under their real names,
 *      addresses and codes. MUL100 and POR100 already exist and are reused
 *      by id — never re-inserted, never renamed.
 *   2. Farm → Shed → Pen, a Silo on every shed and one feed/medicine store on
 *      every farm. Sheds are by role: farrow-to-finish farms get the full
 *      seven, MULTIPLIER breeds and sends gilts, AI Station holds boars only,
 *      Lionshead Extension holds weaners and growers only.
 *   3. stage_master gains WEANER, GROWER and FINISHER — the three the
 *      commercial grow-out needs and the only piggery stages missing.
 *   4. A breed per farm (breed_master.location_id is the farm — migration
 *      0094 made breed_code unique per farm so the same line can exist on
 *      each), carrying that farm's own submitted benchmarks.
 *   5. breed_lifecycle_stages with the client's periods converted to days and
 *      the client's own wording kept in the stage note, a real feed item per
 *      stage, vaccination and medication protocols (both now carrying
 *      withdrawal days) and KPI threshold rows.
 *   6. One STANDARD_USER data-entry login and one farm manager per farm,
 *      bound to that farm.
 *
 * Idempotent throughout. Locations key on location_code, breeds on
 * (farm, breed_code), lifecycle rows on (breed_id, stage_id), stages on
 * (scope, lob, stage_code) and users on email — so a second run updates in
 * place. Anything that conflicts is switched OFF, never deleted: rows across
 * a dozen tables point at these masters and forcing a delete would strand
 * them, exactly as seed-farm-locations.ts found.
 *
 *   pnpm nx run api:db-seed-nine-farm-demo             # print the plan only
 *   pnpm nx run api:db-seed-nine-farm-demo -- --verify # apply inside a rolled-back tx
 *   pnpm nx run api:db-seed-nine-farm-demo -- --apply  # commit
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  formatSeriesCode,
  formatSeriesStem,
  nextSequenceInStem,
} from '../modules/system/number-series/code-format.util';

/* ------------------------------------------------------------------------- */
/* The nine farms                                                            */
/* ------------------------------------------------------------------------- */

type FarmRole = 'FARROW_TO_FINISH' | 'MULTIPLIER' | 'AI_STATION' | 'WEANER_GROWER';

interface FarmSeed {
  code: string;
  /** Name as the farm's own template writes it. Ignored for MUL100/POR100, which keep the name they already carry. */
  name: string;
  /** Address as the farm's own template writes it. Only a top-level Farm stores one (Rishi, 2026-09-15). */
  address: string;
  role: FarmRole;
  /** Short handle used in demo user display names. */
  shortName: string;
}

// Names, addresses and codes are the farms' own, from the nine submitted
// template folders. GRA100 / LIO100 / RIC100 are the codes Rishi assigned
// where the template left the code blank (decision of 15 Sep); the other six
// are the client's own.
const FARMS: FarmSeed[] = [
  { code: 'MUL100', name: 'MULTIPLIER GRASMERE FARM NORTON', address: 'Grasmere Farm, Norton', role: 'MULTIPLIER', shortName: 'Multiplier' },
  { code: 'POR100', name: 'PORTA FARM', address: 'Kintyre Estate, Norton', role: 'FARROW_TO_FINISH', shortName: 'Porta' },
  { code: 'AI100', name: 'AI STATION', address: 'Grasmere Farm, Norton', role: 'AI_STATION', shortName: 'AI Station' },
  { code: 'GRA100', name: 'GRASMERE FARM', address: 'P Bag 903, Bulawayo Road, Norton', role: 'FARROW_TO_FINISH', shortName: 'Grasmere' },
  { code: 'LEA100', name: 'LEARIG FARM', address: 'Learig Farm, Arcturus', role: 'FARROW_TO_FINISH', shortName: 'Learig' },
  { code: 'LIO100', name: 'LIONSHEAD FARM', address: '61 Juru', role: 'FARROW_TO_FINISH', shortName: 'Lionshead' },
  { code: 'LEX100', name: 'LIONSHEAD EXTENSION', address: 'Lionshead Farm, 61 Juru', role: 'WEANER_GROWER', shortName: 'Lionshead Extension' },
  { code: 'RIC100', name: 'RICHLANDS FARM', address: 'Douglyn, Shamva', role: 'FARROW_TO_FINISH', shortName: 'Richlands' },
  { code: 'VIL100', name: 'VILLA FRANCA FARM', address: 'Glendale', role: 'FARROW_TO_FINISH', shortName: 'Villa Franca' },
];

/* ------------------------------------------------------------------------- */
/* Sheds, pens and silos                                                      */
/* ------------------------------------------------------------------------- */

type ShedRole = 'GILT' | 'DRY_SOW' | 'FARROWING' | 'WEANER' | 'GROWER' | 'FINISHER' | 'BOAR' | 'GILT_REARING';

interface ShedSpec {
  label: string;
  /** 4–8, per the decision. */
  pens: number;
  /** Head per pen. Ours, not the client's — the submitted capacity columns are per-row and mostly blank. */
  penCapacity: number;
  siloCapacityKg: number;
}

const SHED_SPEC: Record<ShedRole, ShedSpec> = {
  GILT: { label: 'Gilt House', pens: 6, penCapacity: 30, siloCapacityKg: 12000 },
  DRY_SOW: { label: 'Dry Sow House', pens: 8, penCapacity: 30, siloCapacityKg: 20000 },
  FARROWING: { label: 'Farrowing House', pens: 8, penCapacity: 12, siloCapacityKg: 12000 },
  WEANER: { label: 'Weaner House', pens: 6, penCapacity: 40, siloCapacityKg: 15000 },
  GROWER: { label: 'Grower House', pens: 6, penCapacity: 40, siloCapacityKg: 20000 },
  FINISHER: { label: 'Finisher House', pens: 6, penCapacity: 35, siloCapacityKg: 20000 },
  BOAR: { label: 'Boar House', pens: 4, penCapacity: 8, siloCapacityKg: 6000 },
  GILT_REARING: { label: 'Gilt Rearing House', pens: 6, penCapacity: 30, siloCapacityKg: 12000 },
};

// The roles each farm's sheds cover. MULTIPLIER rears gilts and sends them on,
// so it has a Gilt Rearing house and no grow-out; AI Station is two boar
// houses and nothing else; Lionshead Extension is the weaner/grower satellite.
const SHEDS_BY_ROLE: Record<FarmRole, ShedRole[]> = {
  FARROW_TO_FINISH: ['GILT', 'DRY_SOW', 'FARROWING', 'WEANER', 'GROWER', 'FINISHER', 'BOAR'],
  MULTIPLIER: ['GILT', 'DRY_SOW', 'FARROWING', 'WEANER', 'GILT_REARING', 'BOAR'],
  AI_STATION: ['BOAR', 'BOAR'],
  WEANER_GROWER: ['WEANER', 'GROWER'],
};

/**
 * The store every farm needs for feed and medicine. Named exactly as
 * demo/chapters/01-stores-and-items.ts names it, so that chapter's
 * "already exists" check finds this row and skips rather than creating a
 * second store beside it. STORE's allowed_parent_types is ["FARM"], so it
 * hangs off the farm, not a shed.
 */
const STORE_NAME = 'Demo Medicine Store';
const STORE_CAPACITY = 1000;
const STORE_CAPACITY_UOM = 'PCS';

/** Silos are re-ordered a week ahead across the group. Ours, labelled as such. */
const SILO_REORDER_DAYS = 7;

/* ------------------------------------------------------------------------- */
/* The three missing stages                                                   */
/* ------------------------------------------------------------------------- */

/**
 * WEANER, GROWER and FINISHER, with the durations the decision gives
 * (28–70, 70–140, 140–170 days of age). Transition trigger is AUTO_BY_DAY:
 * Stage Master offers exactly two triggers now (Rishi, 2026-09-15), and a
 * grow-out stage ends on a day, not on an event.
 *
 * Sequenced 12–14 rather than inserted between WEANING (9) and PRODUCTIVE_SOW
 * (10). Renumbering the eleven stages already here would rewrite masters this
 * script has no business rewriting, and sort_order is display order, not a
 * dependency.
 */
const STAGE_ADDITIONS = [
  { code: 'WEANER', name: 'Weaner', category: 'PRODUCTIVE', sequence: 12, durationDays: 42, autoMoveOnDay: 42 },
  { code: 'GROWER', name: 'Grower', category: 'PRODUCTIVE', sequence: 13, durationDays: 70, autoMoveOnDay: 70 },
  { code: 'FINISHER', name: 'Finisher', category: 'PRODUCTIVE', sequence: 14, durationDays: 30, autoMoveOnDay: 30 },
];

/* ------------------------------------------------------------------------- */
/* Breeds                                                                     */
/* ------------------------------------------------------------------------- */

interface BreedBenchmarks {
  gestationDays: number | null;
  lactationDays: number | null;
  /** The templates write this as free text ("42 months"); parsed to the number here. */
  productiveLifeMonths: number | null;
  avgLitterSizeBorn: number | null;
  avgLitterSizeWeaned: number | null;
  avgWeaningWeightKg: number | null;
  boarProductiveLifeMonths: number | null;
}

/** A boar line carries no litter benchmarks; every column its sheet leaves blank stays blank. */
const BOAR_BENCHMARKS: BreedBenchmarks = {
  gestationDays: null, lactationDays: null, productiveLifeMonths: null,
  avgLitterSizeBorn: null, avgLitterSizeWeaned: null, avgWeaningWeightKg: null,
  boarProductiveLifeMonths: 29,
};

/**
 * Each farm's own Breed sheet, as submitted. Farrowing Rate % and Boar Doses
 * Per Week are deliberately NOT carried: the sheets hold them as fractions
 * (0.9–0.95) in a percent column and as a 5x spread (30–159) in a column
 * whose unit nobody has confirmed — the same omission seed-farm-masters.ts
 * made and for the same reason.
 */
const SOW_BENCHMARKS: Record<string, BreedBenchmarks> = {
  MUL100: { gestationDays: 116, lactationDays: 28, productiveLifeMonths: 46, avgLitterSizeBorn: 15, avgLitterSizeWeaned: 13.8, avgWeaningWeightKg: 7.5, boarProductiveLifeMonths: 29 },
  POR100: { gestationDays: 116, lactationDays: 28, productiveLifeMonths: 42, avgLitterSizeBorn: 16.33, avgLitterSizeWeaned: 15.35, avgWeaningWeightKg: 8, boarProductiveLifeMonths: 29 },
  RIC100: { gestationDays: 116, lactationDays: 28, productiveLifeMonths: 42, avgLitterSizeBorn: 15.5, avgLitterSizeWeaned: 14.26, avgWeaningWeightKg: 7.5, boarProductiveLifeMonths: 29 },
  VIL100: { gestationDays: 116, lactationDays: 28, productiveLifeMonths: 42, avgLitterSizeBorn: 15.5, avgLitterSizeWeaned: 14.7, avgWeaningWeightKg: 7.5, boarProductiveLifeMonths: 29 },
  GRA100: { gestationDays: 116, lactationDays: 28, productiveLifeMonths: 42, avgLitterSizeBorn: 15, avgLitterSizeWeaned: 13.9, avgWeaningWeightKg: 7.5, boarProductiveLifeMonths: 29 },
  LIO100: { gestationDays: 116, lactationDays: 28, productiveLifeMonths: 42, avgLitterSizeBorn: 15, avgLitterSizeWeaned: 13.9, avgWeaningWeightKg: 7.5, boarProductiveLifeMonths: 29 },
};

interface BreedSeed {
  farm: string;
  name: string;
  /** SOW drives the reproductive lifecycle; BOAR drives the two-stage AI lifecycle. */
  line: 'SOW' | 'BOAR';
  benchmarks: BreedBenchmarks;
  /** Recorded on the row's description so a reader can see where the numbers came from. */
  provenance: string;
}

const CLIENT_SHEET = (farm: string) => `Benchmarks from ${farm}'s own submitted Breed Master sheet.`;
const NO_SHEET = 'No benchmark columns submitted for this line; every unsupplied column left blank.';

function buildBreedSeeds(): BreedSeed[] {
  const seeds: BreedSeed[] = [];

  // Multiplier's line is Z-Line-Sow; every other commercial farm's is TN-70-Sow.
  seeds.push({ farm: 'MUL100', name: 'Z-Line-Sow', line: 'SOW', benchmarks: SOW_BENCHMARKS.MUL100, provenance: CLIENT_SHEET('MULTIPLIER') });
  for (const farm of ['POR100', 'GRA100', 'LIO100', 'RIC100', 'VIL100']) {
    seeds.push({ farm, name: 'TN-70-Sow', line: 'SOW', benchmarks: SOW_BENCHMARKS[farm], provenance: CLIENT_SHEET(farm) });
  }

  // LEARIG's Breed sheet has the four codes and every benchmark column blank,
  // so its sow line takes Porta's numbers — Rishi's call, and recorded on the
  // row so nobody later reads them as Learig's own measurements.
  seeds.push({
    farm: 'LEA100', name: 'TN-70-Sow', line: 'SOW', benchmarks: SOW_BENCHMARKS.POR100,
    provenance: "LEARIG's Breed sheet left every benchmark column blank; these are PORTA's figures, copied on Rishi's instruction (2026-09-15).",
  });

  // Lionshead Extension holds Lionshead's weaners and growers, and its own
  // sheet's single row is not a breed name at all ("weaner / grower farm").
  // The line it grows out is Lionshead's, so its profile carries Lionshead's
  // numbers and only the two grow-out stages.
  seeds.push({
    farm: 'LEX100', name: 'TN-70-Sow', line: 'SOW', benchmarks: SOW_BENCHMARKS.LIO100,
    provenance: "LIONSHEAD EXTENSION submitted no usable Breed row; these are LIONSHEAD's figures, the herd it grows out.",
  });

  // A teaser boar appears on every farm's Breed Master except LEARIG and the
  // Extension. LEARIG named three boar lines of its own and no teaser.
  for (const farm of ['MUL100', 'POR100', 'GRA100', 'LIO100', 'RIC100', 'VIL100']) {
    seeds.push({ farm, name: 'Teaser Boar', line: 'BOAR', benchmarks: BOAR_BENCHMARKS, provenance: NO_SHEET });
  }
  for (const name of ['L-Line-Boar', 'Z-Line-Boar', 'Tempo-Boar']) {
    seeds.push({ farm: 'LEA100', name, line: 'BOAR', benchmarks: BOAR_BENCHMARKS, provenance: "Breed code from LEARIG's own submitted Breed Master; " + NO_SHEET });
  }
  // AI Station submitted no Breed Master — by design, it is a semen unit. The
  // boar lines it holds are the three the client names anywhere in the
  // submissions, taken from LEARIG's sheet. Nothing is invented.
  for (const name of ['L-Line-Boar', 'Z-Line-Boar', 'Tempo-Boar']) {
    seeds.push({ farm: 'AI100', name, line: 'BOAR', benchmarks: BOAR_BENCHMARKS, provenance: 'AI STATION submitted no Breed Master; line names taken from the only sheet that codes them (LEARIG).' });
  }

  return seeds;
}

/**
 * breed_master.breed_type is NOT NULL and no template supplies it. MEAT is
 * what every piggery breed already in this database carries, including the two
 * Triple C farm breeds, so the new rows match their neighbours rather than
 * introducing a value on a guess. Still arguably wrong for a maternal line —
 * raised in the report, not settled here.
 */
const BREED_TYPE = 'MEAT';

/* ------------------------------------------------------------------------- */
/* Lifecycle stages                                                           */
/* ------------------------------------------------------------------------- */

/**
 * The real company feed/vaccine/medicine items each lifecycle stage draws, by
 * the shared catalog's item NAME (scripts/lib/seed-item-catalog.ts) — never by
 * literal code. The ITEM series composes <type>-<category>-<sub>-ITM-<seq>
 * from the category tree, so a hand-written code here went stale the moment
 * the catalog step composed its own; the name is the one property code
 * generation cannot move. Resolved to item_id at seed time below.
 */
const FEED = {
  CREEP: 'Creep Feed Pre-Starter (22% CP)',
  GESTATION: 'Dry Sow Gestation Mash (14% CP)',
  GROWER: 'Weaner Grower Mash (18% CP)',
  LACTATION: 'High-Density Lactation Diet (17.5% CP)',
  FINISHER: 'Finisher High-Gain Porker Feed (15.5% CP)',
} as const;

const VACCINE = {
  PARVO: 'Parvo-Shield L5 Swine Vaccine (50 Doses)',
  PRRS: 'Ingelvac PRRS MLV Swine Vaccine (50 Doses)',
} as const;

const MEDICINE = {
  PENICILLIN: 'Penicillin G Procaine 300K IU 100ml',
  TYLOSIN: 'Tylosin Tartrate 100g Soluble Powder',
  IVERMECTIN: 'Ivermectin 1% Swine Dewormer 100ml',
  OXYTOCIN: 'Oxytocin 10 IU/ml 50ml Injection',
  IRON: 'Iron Dextran 100mg/ml 100ml Injection',
} as const;

interface VaccinationRow {
  vaccine: string;
  trigger_type: 'AGE_WEEKS' | 'WEEKS_PREGNANT' | 'PER_CYCLE';
  trigger_value: number;
  dose_ml: number;
  route: 'IM' | 'SC' | 'IN' | 'ORAL';
  withdrawal_days: number;
}

interface MedicationRow {
  problem: string;
  symptom: string;
  medicine: string;
  dose: string;
  repeat: string;
  withdrawal_days: number;
}

interface KpiRow {
  metric: string;
  lower_limit: number | null;
  upper_limit: number | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

interface StagePlan {
  stage: string;
  category: 'SOW' | 'GILT' | 'BOAR' | 'PIGLET' | 'COMMERCIAL_PIG';
  /** Converted to days from the client's words; `note` keeps the words. */
  from: number;
  to: number;
  feed: string;
  feedKgPerHeadPerDay: number;
  bodyWeightKg: number | null;
  adgGpd: number | null;
  fcr: number | null;
  mortalityPct: number;
  vaccinations: VaccinationRow[];
  medications: MedicationRow[];
  kpis: KpiRow[];
  note: string;
}

const DEMO_CAVEAT = 'Demo benchmark, not a client-approved standard — confirm before live use.';

/**
 * The reproductive lifecycle, day-converted exactly as the decision of
 * 15 September states it, with the client's own words for each period kept in
 * the note. Three of those phrasings are verbatim from the submitted
 * lifecycle sheets ("from service week" / "15 weeks pregnant", "birth" /
 * "4 weeks", "4 weeks of age" / "10 weeks of age"); the rest are Rishi's
 * wording of the same periods, because no submitted sheet words them.
 */
const SOW_STAGE_PLAN: StagePlan[] = [
  {
    stage: 'QUARANTINE', category: 'GILT', from: 0, to: 28,
    feed: FEED.GESTATION, feedKgPerHeadPerDay: 2.5,
    bodyWeightKg: 110, adgGpd: 450, fcr: 3.2, mortalityPct: 0.5,
    vaccinations: [{ vaccine: VACCINE.PRRS, trigger_type: 'AGE_WEEKS', trigger_value: 26, dose_ml: 2, route: 'IM', withdrawal_days: 21 }],
    medications: [{ problem: 'Mange and internal worms', symptom: 'Scratching, rubbing, poor condition on arrival', medicine: MEDICINE.IVERMECTIN, dose: '1 ml per 33 kg', repeat: 'repeat after 14 days', withdrawal_days: 18 }],
    kpis: [
      { metric: 'MORTALITY_COUNT', lower_limit: null, upper_limit: 1, severity: 'WARNING' },
      { metric: 'BCS_SCORE', lower_limit: 2.5, upper_limit: 3.5, severity: 'INFO' },
    ],
    note: `Client period: "Quarantine 0-28" (days from arrival). ${DEMO_CAVEAT}`,
  },
  {
    stage: 'GILT_GROWER', category: 'GILT', from: 28, to: 210,
    feed: FEED.GROWER, feedKgPerHeadPerDay: 2.2,
    bodyWeightKg: 120, adgGpd: 650, fcr: 2.9, mortalityPct: 1,
    vaccinations: [{ vaccine: VACCINE.PARVO, trigger_type: 'AGE_WEEKS', trigger_value: 24, dose_ml: 2, route: 'IM', withdrawal_days: 21 }],
    medications: [],
    kpis: [
      { metric: 'ADG', lower_limit: 550, upper_limit: 800, severity: 'WARNING' },
      { metric: 'BODY_WEIGHT', lower_limit: 100, upper_limit: 140, severity: 'INFO' },
    ],
    note: `Client period: "Gilt grower to ~210" (days of age). The farm sheets write this phase as "gilt rearing 16 to 25 weeks" and "gilt rearing gilt to Service line (28 weeks to 35 weeks)". ${DEMO_CAVEAT}`,
  },
  {
    stage: 'FLUSH', category: 'GILT', from: 1, to: 14,
    feed: FEED.GESTATION, feedKgPerHeadPerDay: 3.5,
    bodyWeightKg: 135, adgGpd: 700, fcr: 3, mortalityPct: 0.3,
    vaccinations: [],
    medications: [],
    kpis: [{ metric: 'BCS_SCORE', lower_limit: 3, upper_limit: 3.5, severity: 'INFO' }],
    note: `Client period: "Flush 14" (days). ${DEMO_CAVEAT}`,
  },
  {
    stage: 'INSEMINATION', category: 'SOW', from: 1, to: 2,
    feed: FEED.GESTATION, feedKgPerHeadPerDay: 2.5,
    bodyWeightKg: 140, adgGpd: null, fcr: null, mortalityPct: 0.2,
    vaccinations: [],
    medications: [],
    kpis: [{ metric: 'SEMEN_MOTILITY', lower_limit: 70, upper_limit: null, severity: 'CRITICAL' }],
    note: `Client period: "Insemination 2" (days). ${DEMO_CAVEAT}`,
  },
  {
    stage: 'GESTATION', category: 'SOW', from: 1, to: 116,
    feed: FEED.GESTATION, feedKgPerHeadPerDay: 2.5,
    bodyWeightKg: 180, adgGpd: 350, fcr: 3.5, mortalityPct: 1,
    vaccinations: [{ vaccine: VACCINE.PARVO, trigger_type: 'WEEKS_PREGNANT', trigger_value: 10, dose_ml: 2, route: 'IM', withdrawal_days: 21 }],
    medications: [],
    kpis: [
      { metric: 'BODY_WEIGHT', lower_limit: 160, upper_limit: 220, severity: 'INFO' },
      { metric: 'MORTALITY_COUNT', lower_limit: null, upper_limit: 1, severity: 'WARNING' },
    ],
    note: `Client period: "Gestation 116" (days). The farm sheets write the same period as "from service week" to "15 weeks pregnant", Calculation Unit "Service week". ${DEMO_CAVEAT}`,
  },
  {
    stage: 'FARROWING', category: 'SOW', from: 1, to: 3,
    feed: FEED.LACTATION, feedKgPerHeadPerDay: 3,
    bodyWeightKg: 200, adgGpd: null, fcr: null, mortalityPct: 1.5,
    vaccinations: [],
    medications: [{ problem: 'MMA (mastitis, metritis, agalactia)', symptom: 'Fever after farrowing, no milk let-down', medicine: MEDICINE.PENICILLIN, dose: 'per label, by liveweight', repeat: 'once daily for 3 days', withdrawal_days: 14 }],
    kpis: [
      { metric: 'PIGLETS_BORN', lower_limit: 14, upper_limit: null, severity: 'WARNING' },
      { metric: 'LITTER_SIZE', lower_limit: 14, upper_limit: null, severity: 'WARNING' },
    ],
    note: `Client period: "Farrowing+Lactation 28" (days). Farrowing itself held as the first 3 days of that window. ${DEMO_CAVEAT}`,
  },
  {
    stage: 'LACTATION', category: 'SOW', from: 1, to: 28,
    feed: FEED.LACTATION, feedKgPerHeadPerDay: 6,
    bodyWeightKg: 190, adgGpd: null, fcr: null, mortalityPct: 1.5,
    vaccinations: [],
    medications: [{ problem: 'Slow farrowing', symptom: 'Weak contractions, long interval between piglets', medicine: MEDICINE.OXYTOCIN, dose: '1-2 ml', repeat: 'maximum 2 doses', withdrawal_days: 3 }],
    kpis: [
      { metric: 'WEANING_WEIGHT', lower_limit: 7, upper_limit: null, severity: 'WARNING' },
      { metric: 'MORTALITY_COUNT', lower_limit: null, upper_limit: 2, severity: 'CRITICAL' },
    ],
    note: `Client period: "Farrowing+Lactation 28" (days). ${DEMO_CAVEAT}`,
  },
  {
    stage: 'WEANING', category: 'PIGLET', from: 1, to: 1,
    feed: FEED.CREEP, feedKgPerHeadPerDay: 0.25,
    bodyWeightKg: 7.5, adgGpd: 220, fcr: 1.4, mortalityPct: 2,
    vaccinations: [],
    medications: [{ problem: 'Iron deficiency anaemia', symptom: 'Pale piglets, poor thrift', medicine: MEDICINE.IRON, dose: '1 ml', repeat: 'once, at day 3 of age', withdrawal_days: 0 }],
    kpis: [
      { metric: 'WEANING_WEIGHT', lower_limit: 7, upper_limit: 9, severity: 'WARNING' },
      { metric: 'HEAD_COUNT', lower_limit: 1, upper_limit: null, severity: 'INFO' },
    ],
    note: `Weaning event at the end of the 28-day lactation. The farm sheets write the gilt-processing period around it as "birth" to "4 weeks". ${DEMO_CAVEAT}`,
  },
  {
    stage: 'WEANER', category: 'PIGLET', from: 28, to: 70,
    feed: FEED.GROWER, feedKgPerHeadPerDay: 0.8,
    bodyWeightKg: 20, adgGpd: 400, fcr: 1.8, mortalityPct: 2.5,
    vaccinations: [{ vaccine: VACCINE.PRRS, trigger_type: 'AGE_WEEKS', trigger_value: 6, dose_ml: 2, route: 'IM', withdrawal_days: 21 }],
    medications: [],
    kpis: [
      { metric: 'ADG', lower_limit: 350, upper_limit: 500, severity: 'WARNING' },
      { metric: 'FCR', lower_limit: null, upper_limit: 2, severity: 'WARNING' },
      { metric: 'MORTALITY_COUNT', lower_limit: null, upper_limit: 2, severity: 'CRITICAL' },
    ],
    note: `Client period: "Weaner 28-70 of age" (days). The farm sheets write the same period as "4 weeks of age" to "10 weeks of age". ${DEMO_CAVEAT}`,
  },
  {
    stage: 'GROWER', category: 'COMMERCIAL_PIG', from: 70, to: 140,
    feed: FEED.GROWER, feedKgPerHeadPerDay: 2,
    bodyWeightKg: 65, adgGpd: 700, fcr: 2.5, mortalityPct: 1.5,
    vaccinations: [],
    medications: [{ problem: 'Ileitis', symptom: 'Loose dung, uneven growth', medicine: MEDICINE.TYLOSIN, dose: 'per label, in water', repeat: '5 consecutive days', withdrawal_days: 5 }],
    kpis: [
      { metric: 'ADG', lower_limit: 600, upper_limit: 800, severity: 'WARNING' },
      { metric: 'FCR', lower_limit: null, upper_limit: 2.7, severity: 'WARNING' },
    ],
    note: `Client period: "Grower 70-140" (days of age). ${DEMO_CAVEAT}`,
  },
  {
    stage: 'FINISHER', category: 'COMMERCIAL_PIG', from: 140, to: 170,
    feed: FEED.FINISHER, feedKgPerHeadPerDay: 3,
    bodyWeightKg: 105, adgGpd: 850, fcr: 3, mortalityPct: 1,
    vaccinations: [],
    medications: [],
    kpis: [
      { metric: 'BODY_WEIGHT', lower_limit: 95, upper_limit: 115, severity: 'WARNING' },
      { metric: 'FCR', lower_limit: null, upper_limit: 3.2, severity: 'WARNING' },
    ],
    note: `Client period: "Finisher 140-170" (days of age). ${DEMO_CAVEAT}`,
  },
];

/** A boar line runs quarantine, then collection for the rest of its working life. */
const BOAR_STAGE_PLAN: StagePlan[] = [
  {
    ...SOW_STAGE_PLAN[0],
    category: 'BOAR',
    note: `Client period: "Quarantine 0-28" (days from arrival). ${DEMO_CAVEAT}`,
  },
  {
    stage: 'BOAR_AI', category: 'BOAR', from: 29, to: 1095,
    feed: FEED.GESTATION, feedKgPerHeadPerDay: 3,
    bodyWeightKg: 250, adgGpd: 300, fcr: 3.5, mortalityPct: 1,
    vaccinations: [{ vaccine: VACCINE.PARVO, trigger_type: 'AGE_WEEKS', trigger_value: 30, dose_ml: 2, route: 'IM', withdrawal_days: 21 }],
    medications: [{ problem: 'Mange and internal worms', symptom: 'Scratching, poor condition', medicine: MEDICINE.IVERMECTIN, dose: '1 ml per 33 kg', repeat: 'every 6 months', withdrawal_days: 18 }],
    kpis: [
      { metric: 'SEMEN_MOTILITY', lower_limit: 70, upper_limit: null, severity: 'CRITICAL' },
      { metric: 'BCS_SCORE', lower_limit: 3, upper_limit: 3.5, severity: 'INFO' },
    ],
    note: `Working life after quarantine, held in days of age to the boar productive life the sheets give (29 months). ${DEMO_CAVEAT}`,
  },
];

/** Which of the sow stages each farm role actually runs. */
function stagePlanFor(farmRole: FarmRole, line: 'SOW' | 'BOAR'): StagePlan[] {
  if (line === 'BOAR') return BOAR_STAGE_PLAN;
  const codes = (() => {
    switch (farmRole) {
      // Multiplier breeds and sends gilts on; it has no grow-out.
      case 'MULTIPLIER':
        return ['QUARANTINE', 'GILT_GROWER', 'FLUSH', 'INSEMINATION', 'GESTATION', 'FARROWING', 'LACTATION', 'WEANING', 'WEANER'];
      // The Extension holds weaners and growers only.
      case 'WEANER_GROWER':
        return ['WEANER', 'GROWER'];
      case 'AI_STATION':
        return [];
      default:
        return SOW_STAGE_PLAN.map((s) => s.stage);
    }
  })();
  return SOW_STAGE_PLAN.filter((s) => codes.includes(s.stage));
}

/* ------------------------------------------------------------------------- */
/* Demo logins                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Two logins per farm, both STANDARD_USER.
 *
 * A farm manager is NOT an OPERATIONAL_ADMIN here, and that is deliberate: an
 * operational admin sees a line of business across every farm in the company
 * (Rishi, 2026-09-14), and user.service.ts enforces it by writing
 * `farm_id: userType === 'STANDARD_USER' ? dto.farm_id : null` — a farm-bound
 * operational admin is not expressible. The farm manager is therefore a
 * STANDARD_USER on that farm holding the FARM_SUPERVISOR role, and the single
 * company-wide OPERATIONAL_ADMIN seed-dev-tenant.ts creates stays as it is.
 */
const FARM_USERS = [
  { suffix: 'entry', role: 'OPERATOR', title: 'Data Entry' },
  { suffix: 'manager', role: 'FARM_SUPERVISOR', title: 'Farm Manager' },
] as const;

/** Same password every dev/demo login carries (seed-dev-tenant.ts). */
const DEMO_PASSWORD = '12345678';

/* ------------------------------------------------------------------------- */
/* Runner                                                                     */
/* ------------------------------------------------------------------------- */

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const dec = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

interface FarmCounts {
  farm: string;
  farmRow: 'reused' | 'inserted' | 'updated';
  sheds: number;
  pens: number;
  silos: number;
  stores: number;
  breeds: number;
  lifecycleStages: number;
  lifecycleDeactivated: number;
  users: number;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const write = apply || verify;
  const database = process.env.DEV_TENANT_DATABASE || process.env.TENANT_DB_NAME || 'tenant_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });

  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-nine-farm-demo', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another nine-farm demo seed run is active.');
    await db.beginTransaction();

    // Scope is copied from the estate these rows join, not passed in — the
    // same rule seed-farm-locations.ts follows, and for the same reason: a
    // row in the wrong tenant/company/NOB/LOB is invisible to the screens
    // that should show it.
    const [scopeRows] = await db.query<RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id, COUNT(*) n FROM location_master
        WHERE company_id IS NOT NULL GROUP BY tenant_id, company_id, nob_id, lob_id ORDER BY n DESC LIMIT 1`,
    );
    if (!scopeRows.length) throw new Error('No company-scoped locations — run db-seed-farm-locations first.');
    const scope = scopeRows[0] as { tenant_id: string; company_id: string; nob_id: string; lob_id: string };

    // The operational area these users record in. Read, not assumed: a farm
    // user with no area is refused at every data-entry route.
    const [areaRows] = await db.query<RowDataPacket[]>(
      `SELECT area_id FROM operational_area_master
        WHERE company_id = ? AND is_active = 1 ORDER BY (lob_id = ?) DESC LIMIT 1`,
      [scope.company_id, scope.lob_id],
    );
    const areaId = areaRows.length ? (areaRows[0].area_id as string) : null;
    if (!areaId) throw new Error('No active operational area for this company — the farm users would be unable to record anything.');

    const plan: Record<string, unknown> = {
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      scope: { tenant: scope.tenant_id, company: scope.company_id, nob: scope.nob_id, lob: scope.lob_id },
    };
    const counts = new Map<string, FarmCounts>();
    const countsFor = (farm: string) => {
      if (!counts.has(farm)) {
        counts.set(farm, {
          farm, farmRow: 'inserted', sheds: 0, pens: 0, silos: 0, stores: 0,
          breeds: 0, lifecycleStages: 0, lifecycleDeactivated: 0, users: 0,
        });
      }
      return counts.get(farm)!;
    };

    /* ---- Location codes come from the LOCATION series ---------------------- */

    const [seriesRows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM no_series_master WHERE tenant_id = ? AND series_code = ?
         AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL
       ORDER BY company_id IS NULL LIMIT 1`,
      [scope.tenant_id, 'LOCATION', scope.company_id],
    );
    const locationSeries = (seriesRows[0] as any) ?? {
      prefix: null, separator: '/', seq_separator: '-', seq_length: 3, current_seq: 0,
      reset_frequency: 'NEVER', updated_at: new Date(),
      code_segments: ['parent_location_id', 'location_type'], prefix_position: 'END',
    };

    const [breedSeriesRows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM no_series_master WHERE tenant_id = ? AND series_code = ?
         AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL
       ORDER BY company_id IS NULL LIMIT 1`,
      [scope.tenant_id, 'BREED', scope.company_id],
    );
    const breedSeries = (breedSeriesRows[0] as any) ?? {
      prefix: null, separator: '-', seq_separator: null, seq_length: 0, current_seq: 0,
      reset_frequency: 'NEVER', updated_at: new Date(), code_segments: ['breed_name'], prefix_position: 'END',
    };

    const [lifecycleSeriesRows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM no_series_master WHERE tenant_id = ? AND series_code = ?
         AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL
       ORDER BY company_id IS NULL LIMIT 1`,
      [scope.tenant_id, 'BREED_LIFECYCLE_STAGE', scope.company_id],
    );
    const lifecycleSeries = (lifecycleSeriesRows[0] as any) ?? {
      prefix: null, separator: '-', seq_separator: null, seq_length: 3, current_seq: 0,
      reset_frequency: 'NEVER', updated_at: new Date(), code_segments: ['breed_id', 'stage_id'], prefix_position: 'END',
    };

    const [typeRows] = await db.query<RowDataPacket[]>(
      `SELECT type_code, code_prefix, allowed_parent_types FROM location_type_master
        WHERE tenant_id = ? AND is_active = 1 GROUP BY type_code, code_prefix, allowed_parent_types`,
      [scope.tenant_id],
    );
    const typePrefix = new Map(typeRows.map((r) => [r.type_code as string, (r.code_prefix as string) || (r.type_code as string)]));
    const allowedParents = new Map(typeRows.map((r) => [
      r.type_code as string,
      (typeof r.allowed_parent_types === 'string' ? JSON.parse(r.allowed_parent_types) : r.allowed_parent_types) as string[],
    ]));
    for (const [child, parent] of [['SHED', 'FARM'], ['PEN', 'SHED'], ['SILO', 'SHED'], ['STORE', 'FARM']] as const) {
      const allowed = allowedParents.get(child);
      if (!allowed) throw new Error(`location_type_master has no ${child} row — run db-seed-farm-locations first.`);
      if (!allowed.includes(parent)) {
        throw new Error(`location_type_master says ${child} may not hang off ${parent} (allowed: ${allowed.join(', ')}).`);
      }
    }

    // Every code in the company, held in memory so per-stem numbering counts
    // the rows this run inserts as well as the rows already there.
    const [existingCodeRows] = await db.query<RowDataPacket[]>(
      'SELECT location_code FROM location_master WHERE tenant_id = ? AND company_id = ?',
      [scope.tenant_id, scope.company_id],
    );
    const knownCodes = new Set(existingCodeRows.map((r) => r.location_code as string));

    const now = new Date();
    const nextLocationCode = (type: string, parentCode: string | null): string => {
      const segments = { parent_location_id: parentCode, location_type: typePrefix.get(type) ?? type };
      const stem = formatSeriesStem(locationSeries, now, segments);
      const seq = nextSequenceInStem(stem, locationSeries.seq_separator || locationSeries.separator || '-', knownCodes);
      const code = formatSeriesCode(locationSeries, seq, now, segments);
      knownCodes.add(code);
      return code;
    };

    /* ---- 1 & 2. The nine farms and their trees ---------------------------- */

    interface Placed { id: string; code: string }

    const upsertLocation = async (row: {
      code: string; name: string; address: string | null; type: string;
      parent: Placed | null; farmId: string | null; shedId: string | null;
      level: number; capacity: number | null; capacityUom: string | null;
      storageType: string | null; storageName: string | null;
      siloCapacityKg: number | null; siloReorderDays: number | null;
    }): Promise<{ placed: Placed; action: 'inserted' | 'updated' }> => {
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT location_id FROM location_master WHERE tenant_id = ? AND location_code = ?',
        [scope.tenant_id, row.code],
      );
      const values = [
        scope.nob_id, scope.lob_id, row.name, row.address, row.type,
        row.parent?.id ?? null, row.level, dec(row.capacity), row.capacityUom,
        row.storageType, row.storageName, dec(row.siloCapacityKg), row.siloReorderDays,
        row.farmId, row.shedId,
      ];
      if (existing.length) {
        const id = existing[0].location_id as string;
        if (write) {
          await db.query(
            `UPDATE location_master SET nob_id=?, lob_id=?, location_name=?, location_address=?, location_type=?,
               parent_location_id=?, location_level=?, max_capacity=?, capacity_uom=?, storage_type=?, storage_name=?,
               silo_capacity_kg=?, silo_reorder_days=?, farm_id=?, shed_id=?,
               is_active=1, status='ACTIVE', deleted_at=NULL, updated_at=NOW()
             WHERE location_id=?`,
            [...values, id],
          );
        }
        return { placed: { id, code: row.code }, action: 'updated' };
      }
      const id = randomUUID();
      if (write) {
        await db.query(
          `INSERT INTO location_master (location_id, tenant_id, company_id, location_code, nob_id, lob_id,
             location_name, location_address, location_type, parent_location_id, location_level, max_capacity,
             capacity_uom, storage_type, storage_name, silo_capacity_kg, silo_reorder_days, farm_id, shed_id,
             is_active, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', NOW(), NOW())`,
          [id, scope.tenant_id, scope.company_id, row.code, ...values],
        );
      }
      return { placed: { id, code: row.code }, action: 'inserted' };
    };

    const farmPlaced = new Map<string, Placed>();

    for (const farm of FARMS) {
      const c = countsFor(farm.code);
      const [existingFarm] = await db.query<RowDataPacket[]>(
        `SELECT location_id, location_name FROM location_master
          WHERE tenant_id = ? AND location_code = ? AND location_type = 'FARM'`,
        [scope.tenant_id, farm.code],
      );

      let placed: Placed;
      if (existingFarm.length) {
        // MUL100 and POR100 are Triple C's own rows, loaded from their
        // submitted Location Masters. They are reused by id and left exactly
        // as they are — renaming a farm the client named, or re-inserting it
        // under a second id, would break every row that points at it.
        placed = { id: existingFarm[0].location_id as string, code: farm.code };
        c.farmRow = 'reused';
      } else {
        const r = await upsertLocation({
          code: farm.code, name: farm.name, address: farm.address, type: 'FARM',
          parent: null, farmId: null, shedId: null, level: 1,
          capacity: null, capacityUom: null, storageType: null, storageName: null,
          siloCapacityKg: null, siloReorderDays: null,
        });
        // A farm is its own farm_id, which needs the id the insert just made.
        if (write) await db.query('UPDATE location_master SET farm_id = ? WHERE location_id = ?', [r.placed.id, r.placed.id]);
        placed = r.placed;
        c.farmRow = 'inserted';
        knownCodes.add(farm.code);
      }
      farmPlaced.set(farm.code, placed);

      // One feed/medicine store per farm, at farm level (STORE's
      // allowed_parent_types is ["FARM"]). Named exactly as demo chapter 01
      // names it so that chapter finds this row instead of adding a second.
      const storeCode = knownCodes.has(`${farm.code}/STORE-001`)
        ? `${farm.code}/STORE-001`
        : nextLocationCode('STORE', farm.code);
      const store = await upsertLocation({
        code: storeCode, name: STORE_NAME, address: null, type: 'STORE',
        parent: placed, farmId: placed.id, shedId: null, level: 2,
        capacity: STORE_CAPACITY, capacityUom: STORE_CAPACITY_UOM,
        storageType: 'STORE', storageName: `${farm.code} Feed & Medicine Store`,
        siloCapacityKg: null, siloReorderDays: null,
      });
      if (write) await db.query('UPDATE location_master SET warehouse_id = ? WHERE location_id = ?', [store.placed.id, store.placed.id]);
      c.stores++;

      // Sheds by role, each with its pens and its own silo.
      const roles = SHEDS_BY_ROLE[farm.role];
      const seenRole = new Map<ShedRole, number>();
      for (const role of roles) {
        const spec = SHED_SPEC[role];
        const repeat = (seenRole.get(role) ?? 0) + 1;
        seenRole.set(role, repeat);
        // AI Station has two boar houses; everywhere else a role appears once.
        const shedName = roles.filter((r) => r === role).length > 1
          ? `${farm.code} ${spec.label} ${repeat}`
          : `${farm.code} ${spec.label}`;
        const shedCode = nextLocationCode('SHED', farm.code);
        const shed = await upsertLocation({
          code: shedCode, name: shedName, address: null, type: 'SHED',
          parent: placed, farmId: placed.id, shedId: null, level: 2,
          capacity: spec.pens * spec.penCapacity, capacityUom: 'HEAD',
          storageType: null, storageName: null, siloCapacityKg: null, siloReorderDays: null,
        });
        if (write) await db.query('UPDATE location_master SET shed_id = ? WHERE location_id = ?', [shed.placed.id, shed.placed.id]);
        c.sheds++;

        for (let i = 1; i <= spec.pens; i++) {
          const penCode = nextLocationCode('PEN', shedCode);
          await upsertLocation({
            code: penCode, name: `${shedName} Pen ${i}`, address: null, type: 'PEN',
            parent: shed.placed, farmId: placed.id, shedId: shed.placed.id, level: 3,
            capacity: spec.penCapacity, capacityUom: 'HEAD',
            storageType: null, storageName: null, siloCapacityKg: null, siloReorderDays: null,
          });
          c.pens++;
        }

        const siloCode = nextLocationCode('SILO', shedCode);
        const silo = await upsertLocation({
          code: siloCode, name: `${shedName} Feed Silo`, address: null, type: 'SILO',
          parent: shed.placed, farmId: placed.id, shedId: shed.placed.id, level: 3,
          capacity: null, capacityUom: null,
          storageType: 'SILO', storageName: `${shedName} Feed Silo`,
          siloCapacityKg: spec.siloCapacityKg, siloReorderDays: SILO_REORDER_DAYS,
        });
        if (write) await db.query('UPDATE location_master SET warehouse_id = ? WHERE location_id = ?', [silo.placed.id, silo.placed.id]);
        c.silos++;
      }
    }

    /* ---- 3. WEANER, GROWER, FINISHER -------------------------------------- */

    const stageAdded: string[] = [];
    for (const s of STAGE_ADDITIONS) {
      // Held in both scopes, exactly as every existing stage is: a tenant
      // template row and a company copy. A batch's scheduler matches the
      // company-scoped stage, so the company row is the one that must exist;
      // the tenant row is what the master template list shows.
      for (const companyId of [null, scope.company_id]) {
        const [existing] = await db.query<RowDataPacket[]>(
          `SELECT stage_id FROM stage_master
            WHERE tenant_id = ? AND lob_id = ? AND stage_code = ?
              AND ${companyId ? 'company_id = ?' : 'company_id IS NULL'}`,
          companyId ? [scope.tenant_id, scope.lob_id, s.code, companyId] : [scope.tenant_id, scope.lob_id, s.code],
        );
        if (existing.length) {
          if (write) {
            await db.query(
              `UPDATE stage_master SET stage_name=?, stage_category=?, stage_sequence=?, typical_duration_days=?,
                 transition_trigger='AUTO_BY_DAY', auto_move_on_day=?, sort_order=?,
                 is_active=1, deleted_at=NULL, updated_at=NOW()
               WHERE stage_id=?`,
              [s.name, s.category, s.sequence, s.durationDays, s.autoMoveOnDay, s.sequence, existing[0].stage_id],
            );
          }
          continue;
        }
        if (write) {
          await db.query(
            `INSERT INTO stage_master (stage_id, tenant_id, company_id, nob_id, lob_id, stage_code, stage_name,
               stage_category, stage_sequence, typical_duration_days, min_days_before_move, transition_trigger,
               auto_move_on_day, data_entry_form, scheduler_auto_create, show_on_animal_card, sort_order,
               is_system, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'AUTO_BY_DAY', ?, 'STANDARD', 1, 1, ?, 1, 1, NOW(), NOW())`,
            [randomUUID(), scope.tenant_id, companyId, scope.nob_id, scope.lob_id, s.code, s.name,
             s.category, s.sequence, s.durationDays, s.autoMoveOnDay, s.sequence],
          );
        }
        stageAdded.push(`${s.code} (${companyId ? 'COMPANY' : 'TENANT'})`);
      }
    }
    plan.stagesAdded = stageAdded.length ? stageAdded : 'none — WEANER/GROWER/FINISHER already present';

    // Company-scoped stages are what a batch's scheduler matches on.
    const [companyStages] = await db.query<RowDataPacket[]>(
      `SELECT stage_id, stage_code FROM stage_master
        WHERE tenant_id = ? AND company_id = ? AND lob_id = ? AND is_active = 1 AND deleted_at IS NULL`,
      [scope.tenant_id, scope.company_id, scope.lob_id],
    );
    const stageByCode = new Map(companyStages.map((r) => [r.stage_code as string, r.stage_id as string]));
    // In READ-ONLY mode the three new stages were never inserted, so the
    // lifecycle plan below cannot resolve them. Reported rather than thrown:
    // a dry run should still print the shape of the work.
    const unresolvedStages = STAGE_ADDITIONS.map((s) => s.code).filter((c) => !stageByCode.has(c));

    /* ---- 4. Breeds per farm ------------------------------------------------ */

    // A breed's code is the same on every farm — a cross-farm transfer matches
    // the destination profile by breed code (decision of 15 Sep), so a line
    // already coded on one farm keeps that exact code on the others. Only a
    // line that exists nowhere yet gets a code from the BREED series.
    const [existingBreedCodes] = await db.query<RowDataPacket[]>(
      'SELECT breed_code, breed_name FROM breed_master WHERE tenant_id = ?',
      [scope.tenant_id],
    );
    const codeByBreedName = new Map(existingBreedCodes.map((r) => [r.breed_name as string, r.breed_code as string]));
    const breedCodeFor = (name: string) =>
      codeByBreedName.get(name) ?? formatSeriesCode(breedSeries, 1, now, { breed_name: name });

    const breedIdByFarmAndCode = new Map<string, string>();
    const breedSeeds = buildBreedSeeds();
    for (const b of breedSeeds) {
      const farm = farmPlaced.get(b.farm);
      if (!farm) throw new Error(`Farm ${b.farm} was not placed — cannot attach a breed to it.`);
      const code = breedCodeFor(b.name);
      const [existing] = await db.query<RowDataPacket[]>(
        `SELECT breed_id FROM breed_master
          WHERE tenant_id = ? AND company_id = ? AND location_id = ? AND breed_code = ?`,
        [scope.tenant_id, scope.company_id, farm.id, code],
      );
      const vals = [
        b.name, dec(b.benchmarks.gestationDays), dec(b.benchmarks.lactationDays),
        b.benchmarks.productiveLifeMonths, b.benchmarks.avgLitterSizeBorn === null ? null : dec(b.benchmarks.avgLitterSizeBorn),
        b.benchmarks.avgLitterSizeWeaned === null ? null : dec(b.benchmarks.avgLitterSizeWeaned),
        dec(b.benchmarks.avgWeaningWeightKg), b.benchmarks.boarProductiveLifeMonths,
        farm.id, b.provenance,
      ];
      let breedId: string;
      if (existing.length) {
        breedId = existing[0].breed_id as string;
        if (write) {
          await db.query(
            `UPDATE breed_master SET breed_name=?, gestation_days=?, lactation_days=?, productive_life_months=?,
               avg_litter_size_born=?, avg_litter_size_weaned=?, avg_weaning_weight_kg=?,
               boar_productive_life_months=?, location_id=?, description=?,
               is_active=1, status='ACTIVE', deleted_at=NULL, updated_at=NOW()
             WHERE breed_id=?`, [...vals, breedId]);
        }
      } else {
        breedId = randomUUID();
        if (write) {
          await db.query(
            `INSERT INTO breed_master (breed_id, tenant_id, company_id, nob_id, lob_id, breed_code, breed_name,
               gestation_days, lactation_days, productive_life_months, avg_litter_size_born, avg_litter_size_weaned,
               avg_weaning_weight_kg, boar_productive_life_months, location_id, description, breed_type,
               is_active, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', NOW(), NOW())`,
            [breedId, scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, code, ...vals, BREED_TYPE]);
        }
      }
      breedIdByFarmAndCode.set(`${b.farm}|${code}`, breedId);
      codeByBreedName.set(b.name, code);
      countsFor(b.farm).breeds++;
    }

    /* ---- 5. Lifecycle stages per breed ------------------------------------ */

    const [itemRows] = await db.query<RowDataPacket[]>(
      `SELECT item_id, item_name FROM item_master
        WHERE tenant_id = ? AND company_id = ? AND is_active = 1 AND deleted_at IS NULL`,
      [scope.tenant_id, scope.company_id],
    );
    const itemByName = new Map(itemRows.map((r) => [r.item_name as string, r.item_id as string]));
    const missingItems = [...Object.values(FEED), ...Object.values(VACCINE), ...Object.values(MEDICINE)]
      .filter((name) => !itemByName.has(name));
    if (missingItems.length) {
      throw new Error(
        `These item_master rows the lifecycle points at are missing from the company scope: ${missingItems.join(', ')}. ` +
        'Run db-seed-demo-item-catalog first rather than seeding a lifecycle with no feed behind it.',
      );
    }

    const [existingLifecycleCodes] = await db.query<RowDataPacket[]>(
      'SELECT lifecycle_code FROM breed_lifecycle_stages WHERE tenant_id = ? AND lifecycle_code IS NOT NULL',
      [scope.tenant_id],
    );
    const knownLifecycleCodes = new Set(existingLifecycleCodes.map((r) => r.lifecycle_code as string));

    const nextLifecycleCode = (breedCode: string, stageCode: string): string => {
      const segments = { breed_id: breedCode, stage_id: stageCode };
      const stem = formatSeriesStem(lifecycleSeries, now, segments);
      const seq = nextSequenceInStem(stem, lifecycleSeries.seq_separator || lifecycleSeries.separator || '-', knownLifecycleCodes);
      const code = formatSeriesCode(lifecycleSeries, seq, now, segments);
      knownLifecycleCodes.add(code);
      return code;
    };

    for (const b of breedSeeds) {
      const code = breedCodeFor(b.name);
      const breedId = breedIdByFarmAndCode.get(`${b.farm}|${code}`);
      if (!breedId) continue;
      const farmRole = FARMS.find((f) => f.code === b.farm)!.role;
      const stages = stagePlanFor(farmRole, b.line);
      const wantedStageIds = new Set<string>();

      for (const s of stages) {
        const stageId = stageByCode.get(s.stage);
        if (!stageId) continue; // READ-ONLY: WEANER/GROWER/FINISHER not inserted yet.
        wantedStageIds.add(stageId);

        const vaccination = s.vaccinations.length
          ? s.vaccinations.map((v) => ({
              vaccine_item_id: itemByName.get(v.vaccine),
              trigger_type: v.trigger_type,
              trigger_value: v.trigger_value,
              dose_ml: v.dose_ml,
              route: v.route,
              withdrawal_days: v.withdrawal_days,
            }))
          : null;
        const medication = s.medications.length
          ? s.medications.map((m) => ({
              problem: m.problem,
              symptom: m.symptom,
              medicine_item_id: itemByName.get(m.medicine),
              dose: m.dose,
              repeat: m.repeat,
              withdrawal_days: m.withdrawal_days,
            }))
          : null;
        // kpi_lower_limit / kpi_upper_limit / alert_severity are the single-KPI
        // columns the rows table predates. The first threshold row fills them
        // so a reader of the old columns and a reader of the new rows see the
        // same thing.
        const lead = s.kpis[0];

        const [existing] = await db.query<RowDataPacket[]>(
          'SELECT lifecycle_id, lifecycle_code FROM breed_lifecycle_stages WHERE breed_id = ? AND stage_id = ?',
          [breedId, stageId],
        );

        const vals = [
          scope.company_id, scope.nob_id, scope.lob_id, s.category, 'DAY', s.from, s.to,
          itemByName.get(s.feed)!, dec(s.feedKgPerHeadPerDay), '2.00',
          dec(s.bodyWeightKg), dec(s.adgGpd), dec(s.fcr), dec(s.mortalityPct),
          vaccination ? JSON.stringify(vaccination) : null,
          medication ? JSON.stringify(medication) : null,
          JSON.stringify(s.kpis),
          lead ? dec(lead.lower_limit) : null, lead ? dec(lead.upper_limit) : null,
          lead ? lead.severity : null, s.note,
        ];

        if (existing.length) {
          if (write) {
            await db.query(
              `UPDATE breed_lifecycle_stages SET company_id=?, nob_id=?, lob_id=?, category=?, calc_unit=?,
                 period_from=?, period_to=?, feed_item_id=?, feed_qty_per_head_per_day_kg=?, feed_wastage_pct=?,
                 std_body_weight_kg=?, std_adg_gpd=?, std_fcr=?, std_mortality_rate_pct=?,
                 vaccination_protocol=?, medication_protocol=?, kpi_thresholds=?,
                 kpi_lower_limit=?, kpi_upper_limit=?, alert_severity=?, notes=?, is_active=1
               WHERE lifecycle_id=?`,
              [...vals, existing[0].lifecycle_id],
            );
          }
        } else if (write) {
          await db.query(
            `INSERT INTO breed_lifecycle_stages (lifecycle_id, tenant_id, lifecycle_code, breed_id, stage_id,
               company_id, nob_id, lob_id, category, calc_unit, period_from, period_to, feed_item_id,
               feed_qty_per_head_per_day_kg, feed_wastage_pct, std_body_weight_kg, std_adg_gpd, std_fcr,
               std_mortality_rate_pct, vaccination_protocol, medication_protocol, kpi_thresholds,
               kpi_lower_limit, kpi_upper_limit, alert_severity, notes, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
            [randomUUID(), scope.tenant_id, nextLifecycleCode(code, s.stage), breedId, stageId, ...vals],
          );
        } else {
          nextLifecycleCode(code, s.stage);
        }
        countsFor(b.farm).lifecycleStages++;
      }

      // A lifecycle row for a stage this farm's role does not run is switched
      // OFF, never deleted — schedulers and batch-cost rows point at these.
      // The Triple C farm breeds carry nine rows copied wholesale from
      // LANDRACE by seed-triplec-breed-lifecycles.ts; the ones that survive
      // are rewritten above, and the rest land here.
      const [strays] = await db.query<RowDataPacket[]>(
        'SELECT lifecycle_id, stage_id FROM breed_lifecycle_stages WHERE breed_id = ? AND is_active = 1',
        [breedId],
      );
      const toRetire = strays.filter((r) => !wantedStageIds.has(r.stage_id as string));
      if (write && toRetire.length) {
        await db.query(
          `UPDATE breed_lifecycle_stages SET is_active = 0
            WHERE lifecycle_id IN (${toRetire.map(() => '?').join(',')})`,
          toRetire.map((r) => r.lifecycle_id),
        );
      }
      countsFor(b.farm).lifecycleDeactivated += toRetire.length;
    }

    /* ---- 6. One data-entry login and one farm manager per farm ------------- */

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const [roleRows] = await db.query<RowDataPacket[]>(
      'SELECT role_id, role_code FROM role_master WHERE company_id = ?',
      [scope.company_id],
    );
    const roleByCode = new Map(roleRows.map((r) => [r.role_code as string, r.role_id as string]));
    const [assigner] = await db.query<RowDataPacket[]>(
      "SELECT user_id FROM user_master WHERE tenant_id = ? AND user_type = 'TENANT_ADMIN' LIMIT 1",
      [scope.tenant_id],
    );
    const assignedBy = assigner.length ? (assigner[0].user_id as string) : null;

    const logins: string[] = [];
    for (const farm of FARMS) {
      const placed = farmPlaced.get(farm.code)!;
      for (const spec of FARM_USERS) {
        const email = `${farm.code.toLowerCase()}.${spec.suffix}@triplec.local`;
        const fullName = `DEMO ${farm.shortName} ${spec.title}`;
        const [existing] = await db.query<RowDataPacket[]>(
          'SELECT user_id FROM user_master WHERE email = ?', [email]);
        let userId: string;
        if (existing.length) {
          userId = existing[0].user_id as string;
          if (write) {
            await db.query(
              `UPDATE user_master SET full_name=?, password_hash=?, user_type='STANDARD_USER',
                 company_id=?, tenant_id=?, farm_id=?, is_active=1, deleted_at=NULL WHERE user_id=?`,
              [fullName, passwordHash, scope.company_id, scope.tenant_id, placed.id, userId]);
          }
        } else {
          userId = randomUUID();
          if (write) {
            await db.query(
              `INSERT INTO user_master (user_id, company_id, tenant_id, full_name, email, password_hash,
                 user_type, farm_id, is_active, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'STANDARD_USER', ?, 1, NOW())`,
              [userId, scope.company_id, scope.tenant_id, fullName, email, passwordHash, placed.id]);
          }
        }

        const roleId = roleByCode.get(spec.role);
        if (roleId) {
          const [existingRole] = await db.query<RowDataPacket[]>(
            'SELECT assign_id FROM user_role_assignment WHERE user_id = ? AND role_id = ?', [userId, roleId]);
          if (!existingRole.length && write) {
            await db.query(
              'INSERT INTO user_role_assignment (assign_id, user_id, role_id, assigned_by, assigned_at, is_active) VALUES (?, ?, ?, ?, NOW(), 1)',
              [randomUUID(), userId, roleId, assignedBy]);
          }
        }

        // Without an operational area a standard user is refused at every
        // data-entry route (the scope header has nothing to resolve), so the
        // farm's own users are put in the same area the existing farm workers
        // stand in rather than being created unable to record anything.
        const [existingArea] = await db.query<RowDataPacket[]>(
          'SELECT assignment_id FROM user_operational_area_assignment WHERE user_id = ? AND area_id = ?',
          [userId, areaId]);
        if (!existingArea.length && write) {
          await db.query(
            'INSERT INTO user_operational_area_assignment (assignment_id, user_id, area_id, company_id, is_primary, created_at) VALUES (?, ?, ?, ?, 1, NOW())',
            [randomUUID(), userId, areaId, scope.company_id]);
        }

        const [existingCompany] = await db.query<RowDataPacket[]>(
          'SELECT assign_id FROM user_company_assignments WHERE user_id = ? AND company_id = ?',
          [userId, scope.company_id]);
        if (!existingCompany.length && write) {
          await db.query(
            'INSERT INTO user_company_assignments (assign_id, user_id, company_id, is_primary, is_active, assigned_by, assigned_at) VALUES (?, ?, ?, 1, 1, ?, NOW())',
            [randomUUID(), userId, scope.company_id, assignedBy]);
        }

        logins.push(`${email} / ${DEMO_PASSWORD} — STANDARD_USER, ${spec.role}, ${farm.code}`);
        countsFor(farm.code).users++;
      }
    }
    plan.logins = logins;
    if (!roleByCode.get('FARM_SUPERVISOR') || !roleByCode.get('OPERATOR')) {
      plan.roleWarning = 'OPERATOR and/or FARM_SUPERVISOR is missing from role_master — those users were created without a role and will see nothing.';
    }

    /* ---- Plan output ------------------------------------------------------ */

    plan.perFarm = FARMS.map((f) => {
      const c = countsFor(f.code);
      return {
        farm: `${f.code} — ${f.name}`,
        role: f.role,
        farmRow: c.farmRow,
        sheds: c.sheds, pens: c.pens, silos: c.silos, stores: c.stores,
        breeds: c.breeds,
        lifecycleStages: c.lifecycleStages,
        lifecycleRowsDeactivated: c.lifecycleDeactivated,
        users: c.users,
      };
    });
    plan.totals = {
      farms: FARMS.length,
      sheds: [...counts.values()].reduce((n, c) => n + c.sheds, 0),
      pens: [...counts.values()].reduce((n, c) => n + c.pens, 0),
      silos: [...counts.values()].reduce((n, c) => n + c.silos, 0),
      stores: [...counts.values()].reduce((n, c) => n + c.stores, 0),
      breeds: [...counts.values()].reduce((n, c) => n + c.breeds, 0),
      lifecycleStages: [...counts.values()].reduce((n, c) => n + c.lifecycleStages, 0),
      users: [...counts.values()].reduce((n, c) => n + c.users, 0),
    };
    if (unresolvedStages.length) {
      plan.readOnlyNote =
        `WEANER/GROWER/FINISHER do not exist yet, so ${unresolvedStages.join('/')} lifecycle rows are not counted above. ` +
        'Re-run with --verify to see the full plan against the stages this run would create.';
    }
    plan.notCarried =
      'Farrowing Rate % and Boar Doses Per Week — the sheets hold them as fractions in a percent column and as an unconfirmed-unit 30-159 spread, as seed-farm-masters.ts already flagged.';
    plan.syntheticFacts =
      'Pen counts and capacities, silo capacities, feed quantities, growth/FCR/mortality standards, vaccination and medication rows and KPI limits are ours, not the client\'s. Every lifecycle note says so.';

    console.log(JSON.stringify(plan, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-nine-farm-demo')");
    await db.end();
  }
}

run().catch((err) => { console.error(err.message); process.exit(1); });
