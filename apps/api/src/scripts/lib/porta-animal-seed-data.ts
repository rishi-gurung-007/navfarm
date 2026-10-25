/**
 * PORTA's animals and their breeding records, from the two sheets of
 * `PORTA Animal Register Master Template_REVIEWED BY MANAGEMENT-DRAFT-FOR-SUBMISSION.xlsx`
 * (Animal Register, Breeding Record), as the client filled them in.
 *
 * Only these five are seeded for Porta, and only from their recorded service
 * on (Rishi, 24 Oct: "not for the whole 2 years but just for the animals in
 * the Porta animal sheet"). Each is placed in Porta's breeding house before
 * the first service the sheet records, and the farm history then plays each
 * one forward from that service: the pregnancy check the sheet gives, the
 * farrowing on its expected date once that date has passed, weaning 28 days
 * later (the breed's lactation days), and the next service after it.
 *
 * Read from the sheet as follows:
 *   - Entry Type "Imported" is PURCHASED_IMPORTED (it needs the goods receipt
 *     its cost is read from); "Purchased local" is PURCHASED_LOCAL.
 *   - The two parity-5 sows' acquisition cost is their Acquisition Cost column
 *     (392.83); the gilts' column is a formula left blank, so their cost is the
 *     Bio Asset Value the sheet gives them (307.50).
 *   - NB0552's pregnancy check has no result (Conception Result blank,
 *     Pregnancy Confirmed NULL) although her Status reads PREGNANT, so the
 *     check is recorded as confirmed on the date the sheet gives.
 *   - P2975 has farrowed (parity 1, 16 born live, Status LACTATING): her litter
 *     is the farrowing on her expected date, 16 August 2026.
 *   - Teats, TSI and Grading are the sheet's own figures.
 */

export interface PortaAnimalRow {
  /** Row in the Animal Register sheet. */
  sourceRow: number;
  code: string;
  animalType: 'SOW' | 'GILT';
  breedCode: string;
  dob: string;
  entryDate: string;
  entryType: 'PURCHASED_IMPORTED' | 'PURCHASED_LOCAL';
  acquisitionCost: number;
  damTag?: string;
  teats?: number;
  tsi?: number;
  grading?: number;
  /** Parity before the recorded service. */
  parity: number;
  service: {
    /** Row in the Breeding Record sheet. */
    sourceRow: number;
    matingDate: string;
    secondMatingDate?: string;
    expectedFarrowingDate: string;
    pregCheckDate: string;
    semenDoses: number;
    /** Born live, for a litter the sheet records. */
    bornLive?: number;
  };
}

export const PORTA_ANIMALS: PortaAnimalRow[] = [
  {
    sourceRow: 6,
    code: 'DLNA8228',
    animalType: 'SOW',
    breedCode: 'TN-70-SOW',
    dob: '2023-10-10',
    entryDate: '2024-02-07',
    entryType: 'PURCHASED_IMPORTED',
    acquisitionCost: 392.83,
    damTag: 'NB6471',
    teats: 14,
    tsi: 102,
    grading: 12,
    parity: 5,
    service: {
      sourceRow: 7,
      matingDate: '2026-07-16',
      secondMatingDate: '2026-07-17',
      expectedFarrowingDate: '2026-11-09',
      pregCheckDate: '2026-08-13',
      semenDoses: 2,
    },
  },
  {
    sourceRow: 8,
    code: 'P26302',
    animalType: 'GILT',
    breedCode: 'TN-70-SOW',
    dob: '2026-01-04',
    entryDate: '2026-02-01',
    entryType: 'PURCHASED_LOCAL',
    acquisitionCost: 307.5,
    damTag: 'CU3647',
    teats: 16,
    tsi: 106,
    grading: 14,
    parity: 0,
    service: {
      sourceRow: 9,
      matingDate: '2026-08-09',
      expectedFarrowingDate: '2026-12-03',
      pregCheckDate: '2026-09-06',
      semenDoses: 1,
    },
  },
  {
    sourceRow: 10,
    code: 'P25003',
    animalType: 'GILT',
    breedCode: 'TN-70-SOW',
    dob: '2025-11-07',
    entryDate: '2025-12-05',
    entryType: 'PURCHASED_LOCAL',
    acquisitionCost: 307.5,
    damTag: 'CU3649',
    teats: 17,
    tsi: 112,
    grading: 14,
    parity: 0,
    service: {
      sourceRow: 11,
      matingDate: '2026-06-12',
      expectedFarrowingDate: '2026-10-06',
      pregCheckDate: '2026-07-10',
      semenDoses: 1,
    },
  },
  {
    sourceRow: 12,
    code: 'P2975',
    animalType: 'GILT',
    breedCode: 'TN-70-SOW',
    dob: '2025-09-17',
    entryDate: '2025-10-15',
    entryType: 'PURCHASED_LOCAL',
    acquisitionCost: 307.5,
    teats: 15,
    tsi: 102,
    grading: 14,
    parity: 0,
    service: {
      sourceRow: 13,
      matingDate: '2026-04-22',
      secondMatingDate: '2026-04-23',
      expectedFarrowingDate: '2026-08-16',
      pregCheckDate: '2026-05-20',
      semenDoses: 2,
      bornLive: 16,
    },
  },
  {
    sourceRow: 14,
    code: 'NB0552',
    animalType: 'SOW',
    breedCode: 'TN-70-SOW',
    dob: '2023-10-10',
    entryDate: '2024-02-07',
    entryType: 'PURCHASED_IMPORTED',
    acquisitionCost: 392.83,
    damTag: 'NB6471',
    teats: 14,
    tsi: 102,
    grading: 12,
    parity: 5,
    service: {
      sourceRow: 15,
      matingDate: '2026-08-10',
      secondMatingDate: '2026-08-11',
      expectedFarrowingDate: '2026-12-04',
      pregCheckDate: '2026-09-07',
      semenDoses: 2,
    },
  },
];
