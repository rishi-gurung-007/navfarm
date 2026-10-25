/**
 * MULTIPLIER's feed silos, with the capacity each one holds.
 *
 * DO NOT EDIT BY HAND. Regenerated from the location template plus the sizing
 * rule below.
 *
 * The location template names all 28 silos in its SILO/STORE columns but gives
 * a capacity for only 17 of them, and writes some of those in tonnes inside a
 * column headed KG — MGH1 reads 5800 while MGH10 reads 5.8 for the same kind
 * of house. The tonne figures are multiplied up; the client's own numbers are
 * otherwise kept exactly.
 *
 * The remaining eleven are sized at ten days of cover: the head the silo feeds,
 * times a daily intake for the class of pig in those houses, times ten. That
 * rule is not invented for the purpose — it is read back off Triple C's own
 * two figures and agrees with both. A grower house holds 229 head at 2.5
 * kg/head/day, which is 5,725 kg against their stated 5,800; a weaner house
 * holds 229 at 1.1 kg/head/day (their own Wean 1 rate), which is 2,519 against
 * their stated 2,700. Intakes for the classes they priced nothing for are the
 * published ranges: lactating sow 5-9 kg (7 used), dry sow 2.3-3.5 (3.0),
 * grower 2.0-3.0 (2.5).
 *
 * `derived: true` marks a capacity Triple C did not supply, so their figures
 * can be dropped in later without hunting for which is which.
 *
 * Reorder days are 2 throughout, which is what the template states on the 21
 * rows that carry one.
 */

export interface MultiplierSiloRow {
  code: string;
  capacityKg: number;
  /** Head of pigs in the locations fed from this silo, used for the sizing. */
  headFed: number;
  /** True when the capacity is ours, not Triple C's. */
  derived: boolean;
}

export const MULTIPLIER_SILOS: MultiplierSiloRow[] = [
  { code: "MDS-DG1", capacityKg: 6480, headFed: 216, derived: true },
  { code: "MDS-DG2", capacityKg: 6480, headFed: 216, derived: true },
  { code: "MDS-DS1", capacityKg: 6480, headFed: 216, derived: true },
  { code: "MDS-DS2", capacityKg: 6480, headFed: 216, derived: true },
  { code: "MDST1", capacityKg: 4575, headFed: 183, derived: true },
  { code: "MDST2", capacityKg: 4575, headFed: 183, derived: true },
  { code: "MDST3", capacityKg: 9150, headFed: 366, derived: true },
  { code: "MFH Trans - 1", capacityKg: 5040, headFed: 72, derived: true },
  { code: "MFH Trans - 2", capacityKg: 3360, headFed: 48, derived: true },
  { code: "MFHLZ - 1 & 2", capacityKg: 5040, headFed: 72, derived: true },
  { code: "MFHLZ - 3 & 4", capacityKg: 3360, headFed: 48, derived: true },
  { code: "MGH1", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH10", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH2", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH3", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH4", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH5", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH6", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH7", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH8", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MGH9", capacityKg: 5800, headFed: 229, derived: false },
  { code: "MSL1", capacityKg: 1225, headFed: 49, derived: true },
  { code: "MWH1", capacityKg: 2700, headFed: 229, derived: false },
  { code: "MWH2", capacityKg: 2700, headFed: 229, derived: false },
  { code: "MWH3", capacityKg: 2700, headFed: 240, derived: false },
  { code: "MWH4", capacityKg: 2700, headFed: 240, derived: false },
  { code: "MWH5", capacityKg: 2700, headFed: 229, derived: false },
  { code: "MWH6", capacityKg: 2700, headFed: 229, derived: false },
];

/**
 * Which diet each silo carries, read from the silo's own name: MDS-DS is the
 * dry sow silo, MDS-DG the dry gilt one, MFHLZ the farrowing house lactation
 * zone, MFH Trans the transition silo, MSL the service line, MGH the grower
 * houses, MWH the weaners and MDST the double stock houses. The item codes are
 * Triple C's own, from their Item Master.
 */
export const SILO_DIET: Array<{ prefix: string; itemCode: string; diet: string }> = [
  { prefix: 'MDS-DS', itemCode: 'FEED000010', diet: 'Drysow' },
  { prefix: 'MDS-DG', itemCode: 'FEED000009', diet: 'Dry Gilt' },
  { prefix: 'MFHLZ', itemCode: 'FEED000021', diet: 'Lactating Sow' },
  { prefix: 'MFH Trans', itemCode: 'FEED000023', diet: 'Transition' },
  { prefix: 'MSL', itemCode: 'FEED000022', diet: 'Super Flush' },
  { prefix: 'MWH', itemCode: 'FEED000024', diet: 'Weaner O.T.C' },
  { prefix: 'MDST', itemCode: 'FEED000024', diet: 'Weaner O.T.C' },
  { prefix: 'MGH', itemCode: 'FEED000016', diet: 'Grower 1' },
  { prefix: 'MST', itemCode: 'FEED000092', diet: 'Grower 1 Bagged' },
];

/**
 * The feed mill and its bins. Triple C's location template has neither — it
 * covers the pig houses only — so these are ours.
 *
 * The mill is sized from the farm's own appetite: the 28 silos hold 136 tonnes
 * between them and that is ten days of cover, so the estate eats about 13.6
 * tonnes a day. A 20-tonne daily capacity carries that with headroom, at 2.5
 * tonnes an hour over an eight-hour day, split 14 bulk to 6 bagged — bulk being
 * the larger share because 444 of the template's rows draw from a silo and only
 * 64 from the bagged store.
 *
 * One bin per principal diet, 8 tonnes each.
 */
export const MULTIPLIER_MILL = {
  code: 'MUMILL',
  name: 'MULTIPLIER Feed Mill',
  dailyCapacityTon: 20,
  hourlyCapacityTon: 2.5,
  bulkDailyAllocationTon: 14,
  baggedDailyAllocationTon: 6,
};

export const MULTIPLIER_BINS = [
  { code: 'MUBIN-GR1', name: 'Grower 1 Bin', itemCode: 'FEED000016', capacityTon: 8, feedType: 'BULK', priority: 1 },
  { code: 'MUBIN-WOTC', name: 'Weaner OTC Bin', itemCode: 'FEED000024', capacityTon: 8, feedType: 'BULK', priority: 2 },
  { code: 'MUBIN-DRYSOW', name: 'Dry Sow Bin', itemCode: 'FEED000010', capacityTon: 8, feedType: 'BULK', priority: 3 },
  { code: 'MUBIN-DRYGILT', name: 'Dry Gilt Bin', itemCode: 'FEED000009', capacityTon: 8, feedType: 'BULK', priority: 4 },
  { code: 'MUBIN-LACTSOW', name: 'Lactating Sow Bin', itemCode: 'FEED000021', capacityTon: 8, feedType: 'BULK', priority: 5 },
  { code: 'MUBIN-TRANS', name: 'Transition Bin', itemCode: 'FEED000023', capacityTon: 8, feedType: 'BULK', priority: 6 },
  // A bin's form has to match its feed's. Super Flush is a bulk diet, so its
  // bin is bulk; the bagged bin carries the bagged Creep 3 line.
  { code: 'MUBIN-FLUSH', name: 'Super Flush Bin', itemCode: 'FEED000022', capacityTon: 8, feedType: 'BULK', priority: 7 },
  { code: 'MUBIN-CREEP3', name: 'Creep 3 Bin', itemCode: 'FEED000084', capacityTon: 8, feedType: 'BAGGED', priority: 8 },
];

/** Rishi, 2026-10-24: every silo stands at four fifths full, a fifth left to fill. */
export const SILO_FILL_FRACTION = 0.8;
