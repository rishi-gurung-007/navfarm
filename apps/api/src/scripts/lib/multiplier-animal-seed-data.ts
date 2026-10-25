/**
 * The five sows of
 * `Multipler Animal Register Master Template FINAL_REVIEWED BY MANAGEMENT-DRAFT-FOR-SUBMISSION.xlsx`.
 *
 * Dates in the template are Excel serials and are written out here. The
 * template's entry types are the client's wording — "Imported" is the app's
 * PURCHASED_IMPORTED, which requires the goods receipt its acquisition cost is
 * read from.
 *
 * 0945MP is the exception Rishi ruled on (2026-10-24): its row says PURCHASED
 * but its Source Batch reads "BORN AT GRASMERE", its cost is zero, and its DOB
 * and entry date are the same day. It is a home-bred sow, so its receipt is
 * posted at a rate of zero rather than given an averaged purchase price it
 * never cost — averaging would put ~2,875 of value it never had into the
 * Assets Ledger. Re-point it to BORN_ON_FARM once a 2024 farrowing batch
 * exists to be its source.
 *
 * Every one is a lactating sow standing in FARROWING, which is what the
 * register's Current Stage column says. The Current Location column is blank
 * on all five, so they are placed in the first farrowing house.
 */
export interface MultiplierAnimalRow {
  /** Row in the submitted template. */
  sourceRow: number;
  /** The farm's own ear tag, kept as the animal code — the ANIMAL series allows manual numbers. */
  code: string;
  breedCode: string;
  dob: string;
  entryDate: string;
  /** From the template's Acquisition Cost column; becomes the receipt's rate. */
  acquisitionCost: number;
  sireTag?: string;
  damTag?: string;
  parity?: number;
  teats?: number;
}

export const MULTIPLIER_ANIMALS: MultiplierAnimalRow[] = [
  {
    sourceRow: 5,
    code: 'NB0456',
    breedCode: 'Z-LINE-SOW',
    dob: '2024-05-30',
    entryDate: '2025-06-12',
    acquisitionCost: 2688.46,
    sireTag: 'TNCJ3567',
    damTag: 'SDPY0974',
    parity: 5,
    teats: 16,
  },
  {
    sourceRow: 6,
    code: 'CU4778',
    breedCode: 'Z-LINE-SOW',
    dob: '2025-04-08',
    entryDate: '2025-09-15',
    acquisitionCost: 3094.4,
    sireTag: 'BLXA2389',
    damTag: 'TNCL9653',
    parity: 2,
    teats: 16,
  },
  {
    sourceRow: 7,
    code: 'CV1964',
    breedCode: 'Z-LINE-SOW',
    dob: '2025-05-31',
    entryDate: '2025-09-15',
    acquisitionCost: 3094.4,
    sireTag: 'BLXA3034',
    damTag: 'TNCM6386',
    parity: 2,
    teats: 16,
  },
  {
    sourceRow: 9,
    code: 'PZ65451',
    breedCode: 'Z-LINE-SOW',
    dob: '2023-08-10',
    entryDate: '2025-09-15',
    acquisitionCost: 2624.36,
    sireTag: 'TNCF9107',
    damTag: 'SPDX5036',
    parity: 6,
    teats: 16,
  },
  {
    sourceRow: 8,
    code: '0945MP',
    breedCode: 'TN-70-SOW',
    dob: '2024-10-31',
    entryDate: '2024-10-31',
    acquisitionCost: 0,
    parity: 3,
    teats: 16,
  },
];

/**
 * The ten further batches Rishi asked for: six carrying ten registered animals
 * each, four counted by head only, both breeds represented in both kinds.
 *
 * The head counts are the houses' own capacities from the location template —
 * 229 for a weaner or grower house, 183 for a double stock house — rather than
 * numbers picked for the look of them.
 */
export interface PlannedBatch {
  key: string;
  breedCode: string;
  stage: string;
  /** ANIMAL_WISE batches register this many animals; COUNT_ONLY batches carry this head count. */
  head: number;
  animalWise: boolean;
  /** Which living-asset item the animals or the head count are. */
  itemCode: string;
  animalType: string;
  gender: 'F' | 'M';
  /** Ear tag prefix for the animals a registered batch creates. */
  tagPrefix?: string;
}

export const PLANNED_BATCHES: PlannedBatch[] = [
  {
    key: 'ZL-REARING',
    breedCode: 'Z-LINE-SOW',
    stage: 'REARING',
    head: 10,
    animalWise: true,
    itemCode: 'BIO-SWINE-GILT',
    animalType: 'GILT',
    gender: 'F',
    tagPrefix: 'ZLG1',
  },
  {
    key: 'ZL-FLUSH',
    breedCode: 'Z-LINE-SOW',
    stage: 'FLUSH',
    head: 10,
    animalWise: true,
    itemCode: 'BIO-SWINE-GILT',
    animalType: 'GILT',
    gender: 'F',
    tagPrefix: 'ZLG2',
  },
  {
    key: 'ZL-INSEMINATION',
    breedCode: 'Z-LINE-SOW',
    stage: 'INSEMINATION',
    head: 10,
    animalWise: true,
    itemCode: 'BIO-SWINE-GILT',
    animalType: 'GILT',
    gender: 'F',
    tagPrefix: 'ZLG3',
  },
  {
    key: 'TN-GESTATION',
    breedCode: 'TN-70-SOW',
    stage: 'GESTATION',
    head: 10,
    animalWise: true,
    itemCode: 'BIO-SWINE-SOW',
    animalType: 'SOW',
    gender: 'F',
    tagPrefix: 'TNS1',
  },
  {
    key: 'TN-FARROWING',
    breedCode: 'TN-70-SOW',
    stage: 'FARROWING',
    head: 10,
    animalWise: true,
    itemCode: 'BIO-SWINE-SOW',
    animalType: 'SOW',
    gender: 'F',
    tagPrefix: 'TNS2',
  },
  {
    key: 'TN-LACTATION',
    breedCode: 'TN-70-SOW',
    stage: 'LACTATION',
    head: 10,
    animalWise: true,
    itemCode: 'BIO-SWINE-SOW',
    animalType: 'SOW',
    gender: 'F',
    tagPrefix: 'TNS3',
  },
  {
    key: 'ZL-WEANER',
    breedCode: 'Z-LINE-SOW',
    stage: 'WEANER',
    head: 229,
    animalWise: false,
    itemCode: 'BIO-SWINE-PIGLET',
    animalType: 'PIGLET',
    gender: 'F',
  },
  {
    key: 'ZL-DOUBLE-STOCK',
    breedCode: 'Z-LINE-SOW',
    stage: 'DOUBLE_STOCK',
    head: 183,
    animalWise: false,
    itemCode: 'BIO-SWINE-GROWER',
    animalType: 'COMMERCIAL_PIG',
    gender: 'F',
  },
  {
    key: 'TN-WEANER',
    breedCode: 'TN-70-SOW',
    stage: 'WEANER',
    head: 229,
    animalWise: false,
    itemCode: 'BIO-SWINE-PIGLET',
    animalType: 'PIGLET',
    gender: 'F',
  },
  {
    key: 'TN-GROWER',
    breedCode: 'TN-70-SOW',
    stage: 'GROWER',
    head: 229,
    animalWise: false,
    itemCode: 'BIO-SWINE-GROWER',
    animalType: 'COMMERCIAL_PIG',
    gender: 'F',
  },
];
