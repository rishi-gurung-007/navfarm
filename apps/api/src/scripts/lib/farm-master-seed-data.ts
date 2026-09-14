/**
 * Resources and breeds as Triple C submitted them, for MULTIPLIER and PORTA
 * FARM only. Extracted from the Resource Master and Breed Master templates in
 * `MASTER TEMPLATES - TRIPLE C SUBMISSIONS/`.
 *
 * Partial, for the same reason the locations are: 28 of 44 resource rows and 2
 * of 4 breed rows are missing a value the template marks mandatory. Every one
 * is listed in `docs/triple-c-location-code-queries.md`. Nothing is guessed.
 *
 * Two breed columns are deliberately absent. Farrowing Rate % and Boar Doses
 * Per Week have template examples of 85.00 and 4.00; both farms wrote 0.9/0.93
 * and 36/74. A 0.9% farrowing rate is impossible and 90% is ordinary, so those
 * cells hold fractions in a percent column — a unit to confirm, not a value to
 * store, and storing it would make every report quoting it wrong.
 *
 * DO NOT EDIT BY HAND. Regenerate from the templates.
 */
export interface FarmResourceSeedRow {
  farm: 'MULTIPLIER' | 'PORTA';
  code: string;
  name: string;
  type: 'MANPOWER' | 'EQUIPMENT' | 'VEHICLE' | 'UTILITY' | 'OTHER';
  /** "Number" on the template — how many of this item the farm holds. */
  quantity?: number;
  costElement?: string;
  /** The client writes a BC account number here, not a UUID. */
  glCostAccount?: string;
  costCentre?: string;
  department?: string;
  designation?: string;
  assetCode?: string;
  capacity?: number;
  capacityUom?: string;
  /** Converted from the Excel day-serial the template stores. */
  nextServiceDate?: string;
  licenseExpiry?: string;
}

export interface FarmBreedSeedRow {
  farm: 'MULTIPLIER' | 'PORTA';
  code: string;
  name: string;
  gestationDays?: number;
  lactationDays?: number;
  /** The cell reads "46 months"; the number is unambiguous. */
  productiveLifeMonths?: number;
  productiveLifeCycles?: number;
  avgLitterSizeBorn?: number;
  avgLitterSizeWeaned?: number;
  avgWeaningWeightKg?: number;
  boarProductiveLifeMonths?: number;
  /** Reads "accounts" in both templates — who decides it, not a number. */
  residualValuePct?: number;
}

export const FARM_RESOURCE_SEED: FarmResourceSeedRow[] = [
  { farm: "PORTA", code: "PWP-01", name: "Water pump", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", capacity: 2.0, capacityUom: "HP", nextServiceDate: "2026-09-30" },
  { farm: "PORTA", code: "PWP-02", name: "Water pump", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", capacity: 2.0, capacityUom: "HP", nextServiceDate: "2026-09-30" },
  { farm: "PORTA", code: "PWP-03", name: "Water pump", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", capacity: 2.0, capacityUom: "HP", nextServiceDate: "2026-09-30" },
  { farm: "PORTA", code: "PWP-04", name: "Water pump", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", capacity: 2.0, capacityUom: "HP", nextServiceDate: "2026-09-30" },
  { farm: "PORTA", code: "PWP-05", name: "Water pump", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", capacity: 2.0, capacityUom: "HP", nextServiceDate: "2026-09-30" },
  { farm: "PORTA", code: "PBH - 01", name: "Borehole Pumps", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000006100", capacity: 5.0, capacityUom: "HP", nextServiceDate: "2026-11-30" },
  { farm: "PORTA", code: "PBH - 02", name: "Borehole Pumps", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000006101", capacity: 2.0, capacityUom: "HP", nextServiceDate: "2026-10-30" },
  { farm: "PORTA", code: "PBH - 03", name: "Borehole Pumps", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000006102", capacity: 1.0, capacityUom: "HP", nextServiceDate: "2026-10-30" },
  { farm: "PORTA", code: "PBH - 04", name: "Borehole Pumps", type: "EQUIPMENT", quantity: 1, costElement: "Electricity", glCostAccount: "4755", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000006103", capacity: 1.0, capacityUom: "HP", nextServiceDate: "2026-10-30" },
  { farm: "PORTA", code: "PGEN - 01", name: "Generator", type: "EQUIPMENT", quantity: 1, costElement: "Diesel", glCostAccount: "4795", department: "Farm Operations", assetCode: "FA-PE000006237", capacity: 165.0, capacityUom: "KVA", licenseExpiry: "2026-12-31" },
  { farm: "PORTA", code: "PWH - 01", name: "Heaters", type: "EQUIPMENT", quantity: 1, costElement: "Diesel", glCostAccount: "5205", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000008887", capacity: 80.0, capacityUom: "KW", nextServiceDate: "2027-01-03" },
  { farm: "PORTA", code: "PWH - 02", name: "Heaters", type: "EQUIPMENT", quantity: 1, costElement: "Diesel", glCostAccount: "5205", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000008888", capacity: 80.0, capacityUom: "KW", nextServiceDate: "2027-01-03" },
  { farm: "PORTA", code: "PWH - 03", name: "Heaters", type: "EQUIPMENT", quantity: 1, costElement: "Diesel", glCostAccount: "5205", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000008889", capacity: 80.0, capacityUom: "KW", nextServiceDate: "2027-01-03" },
  { farm: "PORTA", code: "PWH - 04", name: "Heaters", type: "EQUIPMENT", quantity: 1, costElement: "Diesel", glCostAccount: "5205", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000008890", capacity: 80.0, capacityUom: "KW", nextServiceDate: "2027-01-03" },
  { farm: "PORTA", code: "PWH - 05", name: "Heaters", type: "EQUIPMENT", quantity: 1, costElement: "Diesel", glCostAccount: "5205", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000008891", capacity: 80.0, capacityUom: "KW", nextServiceDate: "2027-01-03" },
  { farm: "PORTA", code: "PWH - 06", name: "Heaters", type: "EQUIPMENT", quantity: 1, costElement: "Diesel", glCostAccount: "5205", costCentre: "280", department: "Farm Operations", assetCode: "FA-PE000008892", capacity: 80.0, capacityUom: "KW", nextServiceDate: "2027-01-03" },
];

export const FARM_BREED_SEED: FarmBreedSeedRow[] = [
  { farm: "MULTIPLIER", code: "Z-Line-Sow", name: "Z-Line-Sow", gestationDays: 116, lactationDays: 28, productiveLifeMonths: 46, productiveLifeCycles: 10, avgLitterSizeBorn: 15.0, avgLitterSizeWeaned: 13.8, avgWeaningWeightKg: 7.5, boarProductiveLifeMonths: 29 },
  { farm: "PORTA", code: "TN-70-Sow", name: "TN-70-Sow", gestationDays: 116, lactationDays: 28, productiveLifeMonths: 42, productiveLifeCycles: 8, avgLitterSizeBorn: 16.3306, avgLitterSizeWeaned: 15.3508, avgWeaningWeightKg: 8.0, boarProductiveLifeMonths: 29 },
];
