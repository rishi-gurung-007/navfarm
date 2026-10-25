/**
 * MULTIPLIER's production standards, from the three lifecycle sheets of
 * `Multiplier Breed master_REVIEWED BY MANAGEMENT-DRAFT-FOR-SUBMISSION.xlsx`.
 *
 * DO NOT EDIT BY HAND. Regenerated from the workbook.
 *
 * 134 sheet rows become 44 standards: the workbook repeats each standard once
 * per house (MFH-01..05, MDS-01..09, MWH-01..06), and a standard here is per
 * breed and stage with the farm as its scope, not per building.
 *
 * Stage names are the client's prose, mapped to the stage codes this tenant
 * carries (Rishi, 2026-10-24): gilt rearing -> REARING, "gilt to Service line"
 * -> FLUSH, the service lines -> INSEMINATION, gestation/farrowing to their own
 * stages, "Multiplier gilt processing" and the weaning rows -> LACTATION (the
 * BBP chain treats weaning as the sow's nursing, not a piglet stage), and the
 * Weaner / Double stock / Grower sheet to the three stages added for it.
 *
 * Eleven bands are written as events rather than ages — "from service week" to
 * "15 weeks pregnant", "Thursday day of weaning" to "Wednesday the following
 * week". They are stored as the durations those describe, agreed on 2026-10-24
 * and corroborated by the breed's own 116-day gestation and 28-day lactation.
 *
 * Where a figure is written as "28 (range 27 to 29)" or "0.539(alert - below
 * 0.459)", the leading number is the standard and the rest is the client's
 * commentary, so the leading number is what is stored. Cells that begin with
 * words carry no number and are left empty rather than guessed.
 */

export interface MultiplierLifecycleRow {
  /** Which of the three sheets it came from. */
  sheet: string;
  /** The client's own stage wording, kept for traceability. */
  stageName: string;
  /** stage_master.stage_code */
  stage: string;
  calcUnit: 'WEEK';
  periodFrom: number;
  periodTo: number;
  /** The feed as the sheet names it; resolved to an item where one matches. */
  feedItemName?: string;
  feedQtyKg?: number;
  stdBodyWeightKg?: number;
  stdAdg?: number;
  stdFcr?: number;
  stdMortalityPct?: number;
}

export const MULTIPLIER_LIFECYCLE: MultiplierLifecycleRow[] = [
  { sheet: "Breed", stageName: "Multiplier gilt processing", stage: "LACTATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 4, feedItemName: "Creep 1", feedQtyKg: 500.0, stdBodyWeightKg: 7.5, stdAdg: 0.22, stdMortalityPct: 0.08 },
  { sheet: "Breed", stageName: "gilt rearing 4 - 10 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 4, periodTo: 10, feedItemName: "4wks(8 days) - Creep2, 6wks (14 days) - creep 3, 8 to 10wks (17 days) - Wean 1", stdBodyWeightKg: 28.0, stdAdg: 0.526, stdFcr: 1.5 },
  { sheet: "Breed", stageName: "gilt rearing 10 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 10, periodTo: 11, feedItemName: "W1", feedQtyKg: 1.4, stdBodyWeightKg: 33.0, stdAdg: 0.7143, stdFcr: 1.4 },
  { sheet: "Breed", stageName: "gilt rearing 11 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 11, periodTo: 12, feedItemName: "W1 - Gilt rear 1", feedQtyKg: 1.5, stdBodyWeightKg: 37.0, stdAdg: 0.5714, stdFcr: 1.75 },
  { sheet: "Breed", stageName: "gilt rearing 12 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 12, periodTo: 13, feedItemName: "W1 - Gilt rear 1", feedQtyKg: 1.6, stdBodyWeightKg: 43.0, stdAdg: 0.8571, stdFcr: 1.6 },
  { sheet: "Breed", stageName: "gilt rearing 13 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 13, periodTo: 14, feedItemName: "W1 - Gilt rear 1 - Gilt rear 2", feedQtyKg: 1.7, stdBodyWeightKg: 48.0, stdAdg: 0.7143, stdFcr: 1.7 },
  { sheet: "Breed", stageName: "gilt rearing 14 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 14, periodTo: 15, feedItemName: "W1 - Gilt rear 1 - Gilt rear 2", feedQtyKg: 1.8, stdBodyWeightKg: 54.0, stdAdg: 0.8571, stdFcr: 2.1 },
  { sheet: "Breed", stageName: "gilt rearing 15 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 15, periodTo: 16, feedItemName: "W1 - Gilt rear 1 - Gilt rear 2", feedQtyKg: 1.9, stdBodyWeightKg: 59.0, stdAdg: 0.7143, stdFcr: 1.9 },
  { sheet: "Breed", stageName: "gilt rearing 16 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 16, periodTo: 17, feedItemName: "Gilt rear 1 - Gilt rear 2 - Gilt rear 3", feedQtyKg: 2.0, stdBodyWeightKg: 65.0, stdAdg: 0.8571, stdFcr: 2.0 },
  { sheet: "Breed", stageName: "gilt rearing 17 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 17, periodTo: 18, feedItemName: "Gilt rear 1 - Gilt rear 2", feedQtyKg: 2.2, stdBodyWeightKg: 72.0, stdAdg: 0.873, stdFcr: 2.2 },
  { sheet: "Breed", stageName: "gilt rearing 18 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 18, periodTo: 19, feedItemName: "Gilt rear 1 - Gilt rear 2", feedQtyKg: 2.3, stdBodyWeightKg: 78.0, stdAdg: 0.873, stdFcr: 2.6833 },
  { sheet: "Breed", stageName: "gilt rearing 19 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 19, periodTo: 20, feedItemName: "Gilt rear 1 - Gilt rear 2", feedQtyKg: 2.4, stdBodyWeightKg: 84.0, stdAdg: 0.873, stdFcr: 2.8 },
  { sheet: "Breed", stageName: "gilt rearing 20 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 20, periodTo: 21, feedItemName: "Gilt rear 2 - Gilt rear 3", feedQtyKg: 2.5, stdBodyWeightKg: 90.0, stdAdg: 0.873, stdFcr: 2.9167 },
  { sheet: "Breed", stageName: "gilt rearing 21 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 21, periodTo: 22, feedItemName: "Gilt rear 2 - Gilt rear 3", feedQtyKg: 2.6, stdBodyWeightKg: 96.0, stdAdg: 0.873, stdFcr: 3.0333 },
  { sheet: "Breed", stageName: "gilt rearing 22 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 22, periodTo: 23, feedItemName: "Gilt rear 2 - Gilt rear 3", feedQtyKg: 2.7, stdBodyWeightKg: 102.0, stdAdg: 0.873, stdFcr: 3.15 },
  { sheet: "Breed", stageName: "gilt rearing 23 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 23, periodTo: 24, feedItemName: "Gilt rear 3 - Gilt rear 4", feedQtyKg: 2.8, stdBodyWeightKg: 108.0, stdAdg: 0.873, stdFcr: 3.2667 },
  { sheet: "Breed", stageName: "gilt rearing 24 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 24, periodTo: 25, feedItemName: "Gilt rear 3 - Gilt rear 4", feedQtyKg: 2.9, stdBodyWeightKg: 114.0, stdAdg: 0.873, stdFcr: 3.3833 },
  { sheet: "Breed", stageName: "gilt rearing 25 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 25, periodTo: 25, feedItemName: "Gilt rear 3 - Gilt rear 4", feedQtyKg: 2.9, stdBodyWeightKg: 120.0, stdAdg: 0.873, stdFcr: 3.3833 },
  { sheet: "Breed", stageName: "gilt rearing 25 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 25, periodTo: 25, feedItemName: "Gilt rear 5", feedQtyKg: 3.0, stdBodyWeightKg: 120.0, stdAdg: 0.8571, stdFcr: 3.3833 },
  { sheet: "Breed", stageName: "gilt rearing 26 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 25, periodTo: 26, feedItemName: "Gilt rear 5", feedQtyKg: 3.0, stdBodyWeightKg: 126.0, stdAdg: 0.8571, stdFcr: 3.5 },
  { sheet: "Breed", stageName: "gilt rearing 27 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 26, periodTo: 27, feedItemName: "Gilt rear 5", feedQtyKg: 3.3, stdBodyWeightKg: 131.0, stdAdg: 0.7143, stdFcr: 4.62 },
  { sheet: "Breed", stageName: "gilt rearing 28 weeks", stage: "REARING", calcUnit: "WEEK", periodFrom: 27, periodTo: 28, feedItemName: "Gilt rear 5", feedQtyKg: 3.5, stdBodyWeightKg: 136.0, stdAdg: 0.7143, stdFcr: 4.9 },
  { sheet: "Breed", stageName: "gilt rearing gilt to Service line (28 weeks)", stage: "FLUSH", calcUnit: "WEEK", periodFrom: 28, periodTo: 29, feedItemName: "Gilt rear 5", feedQtyKg: 2.5, stdBodyWeightKg: 136.0, stdAdg: 0.7143, stdFcr: 3.5 },
  { sheet: "Breed", stageName: "gilt rearing gilt to Service line (29 weeks)", stage: "FLUSH", calcUnit: "WEEK", periodFrom: 29, periodTo: 30, feedItemName: "Gilt rear 5", feedQtyKg: 2.5, stdBodyWeightKg: 141.0, stdAdg: 0.7143, stdFcr: 3.5 },
  { sheet: "Breed", stageName: "gilt rearing gilt to Service line (30 weeks)", stage: "FLUSH", calcUnit: "WEEK", periodFrom: 30, periodTo: 31, feedItemName: "Gilt rear 5", feedQtyKg: 2.5, stdBodyWeightKg: 146.0, stdAdg: 0.7143, stdFcr: 3.5 },
  { sheet: "Breed", stageName: "gilt rearing gilt to Service line (31 weeks)", stage: "FLUSH", calcUnit: "WEEK", periodFrom: 31, periodTo: 32, feedItemName: "Gilt rear 5", feedQtyKg: 2.5, stdBodyWeightKg: 150.0, stdAdg: 0.5714, stdFcr: 4.375 },
  { sheet: "Breed", stageName: "gilt rearing gilt to Service line(32 weeks)", stage: "FLUSH", calcUnit: "WEEK", periodFrom: 32, periodTo: 33, feedItemName: "Gilt rear 5", feedQtyKg: 2.5, stdBodyWeightKg: 155.0, stdAdg: 0.7143, stdFcr: 3.5 },
  { sheet: "Breed", stageName: "gilt rearing gilt to Service line (33 weeks)", stage: "FLUSH", calcUnit: "WEEK", periodFrom: 33, periodTo: 34, feedItemName: "Gilt rear 5", feedQtyKg: 2.5, stdBodyWeightKg: 159.0, stdAdg: 0.5714, stdFcr: 4.375 },
  { sheet: "Breed", stageName: "gilt rearing gilt to Service line (34 weeks)", stage: "FLUSH", calcUnit: "WEEK", periodFrom: 34, periodTo: 35, feedItemName: "Gilt rear 5", feedQtyKg: 2.5, stdBodyWeightKg: 163.0, stdAdg: 0.5714, stdFcr: 4.375 },
  { sheet: "Breed", stageName: "Gilt service line", stage: "INSEMINATION", calcUnit: "WEEK", periodFrom: 30, periodTo: 35, feedItemName: "Super Flush", feedQtyKg: 5.0, stdAdg: 0.893 },
  { sheet: "Breed", stageName: "Gilt in gestation", stage: "GESTATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 15, feedItemName: "Dry Gilt", stdBodyWeightKg: 236.0 },
  { sheet: "Breed", stageName: "Gilts farrowing", stage: "FARROWING", calcUnit: "WEEK", periodFrom: 0, periodTo: 4, feedItemName: "Trans feed and Lactate z line" },
  { sheet: "Breed", stageName: "gilt weaning", stage: "LACTATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 1, feedItemName: "SUPER FLUSH" },
  { sheet: "Breed", stageName: "2nd parity service line", stage: "INSEMINATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 1, feedItemName: "SUPER FLUSH" },
  { sheet: "Breed", stageName: "2nd parity gestation", stage: "GESTATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 15, feedItemName: "dry gilt", stdBodyWeightKg: 254.0, stdAdg: 65.0 },
  { sheet: "Breed", stageName: "2nd parity farrowing", stage: "FARROWING", calcUnit: "WEEK", periodFrom: 0, periodTo: 4, feedItemName: "Trans feed and Lactate z line", stdBodyWeightKg: 210.0 },
  { sheet: "Breed", stageName: "2nd parity weaning", stage: "LACTATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 1, feedItemName: "Super Flush" },
  { sheet: "Breed", stageName: "3rd parity plus service line", stage: "INSEMINATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 1, feedItemName: "Super Flush" },
  { sheet: "Breed", stageName: "3rd parity plus gestation", stage: "GESTATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 15, feedItemName: "Dry Sow" },
  { sheet: "Breed", stageName: "3rd parity farrowing", stage: "FARROWING", calcUnit: "WEEK", periodFrom: 0, periodTo: 1, feedItemName: "Trans feed and Lactate Gilt" },
  { sheet: "Breed", stageName: "3rd parity weaning", stage: "LACTATION", calcUnit: "WEEK", periodFrom: 0, periodTo: 4, feedItemName: "Super Flush" },
  { sheet: "Breeder", stageName: "Weaner", stage: "WEANER", calcUnit: "WEEK", periodFrom: 4, periodTo: 10, feedItemName: "4wks(8 days) - Creep2, 5 to 6wks (14 days) - creep 3, 7 to 10wks (17 days) - Wean 1", stdBodyWeightKg: 28.0, stdAdg: 0.539, stdFcr: 1.5, stdMortalityPct: 1.2 },
  { sheet: "Breeder", stageName: "Double stock", stage: "DOUBLE_STOCK", calcUnit: "WEEK", periodFrom: 10, periodTo: 14, feedItemName: "2 weeks at Wean 1 OTC, 2 weeks Grower 1", stdBodyWeightKg: 48.0, stdAdg: 0.7, stdFcr: 2.0, stdMortalityPct: 1.5385 },
  { sheet: "Breeder", stageName: "Grower", stage: "GROWER", calcUnit: "WEEK", periodFrom: 14, periodTo: 22, feedItemName: "10weeks (14days) - Wean 1 (OTC), 12weeks (14days) - Grower 1, 14weeks (14 days) - Grower 2, 16weeks (10days) - Grower 3, 17weeks (28days) - Finisher", stdBodyWeightKg: 118.0, stdAdg: 1.1, stdFcr: 2.4, stdMortalityPct: 0.02 },
];
