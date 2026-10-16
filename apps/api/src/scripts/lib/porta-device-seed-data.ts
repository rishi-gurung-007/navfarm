/**
 * Device-entered PORTA data captured from nf_devco on 2026-10-16.
 *
 * These rows are deliberately kept separate from the workbook-backed masters:
 * they are operational demo data entered through the application, not client
 * template rows. Relationships are resolved by business codes in the seeder.
 */

export const PORTA_DEVICE_ITEMS = [
  { code: 'LA_01', name: 'LVS_SOW', type: 'LIVING_ASSET', uom: 'HEAD', category: 'SOW' },
  { code: 'LA-02', name: 'LVS_GILT', type: 'LIVING_ASSET', uom: 'HEAD', category: 'GILT' },
  { code: 'FEED-SF', name: 'Super Flush', type: 'FEED', uom: 'KG', category: null },
  { code: 'MED-001', name: 'Alamycin LA', type: 'MEDICINE', uom: 'DOSE', category: null },
  { code: 'VAC-001', name: 'Porcillis', type: 'VACCINE', uom: 'ML', category: null },
  { code: 'DGDW-001', name: 'Dry Gilt Dry Sow', type: 'FEED', uom: 'KG', category: null },
] as const;

export const PORTA_DEVICE_CATEGORIES = [
  { code: 'GILT', name: 'Gilt', itemType: 'LIVING_ASSET' },
  { code: 'SOW', name: 'Sow', itemType: 'LIVING_ASSET' },
] as const;

export const PORTA_DEVICE_KPI = {
  code: 'WEIGHT_LOSS', name: 'Maternal Weight Loss', uom: 'KG',
} as const;

export const PORTA_DEVICE_RECEIPTS = [
  { no: 'GR-000001', date: '2024-02-07', item: 'LA_01', quantity: '1.0000', rate: '392.800000' },
  { no: 'GR-000002', date: '2026-02-01', item: 'LA-02', quantity: '1.0000', rate: '300.000000' },
  { no: 'GR-000003', date: '2025-12-05', item: 'LA-02', quantity: '1.0000', rate: '300.000000' },
  { no: 'GR-000004', date: '2025-10-15', item: 'LA-02', quantity: '1.0000', rate: '300.000000' },
  { no: 'GR-000005', date: '2024-02-07', item: 'LA_01', quantity: '1.0000', rate: '300.000000' },
] as const;

export const PORTA_DEVICE_ANIMALS = [
  {
    code: 'DLNA8228', type: 'SOW', breed: 'TN70', dob: '2023-10-10', entryType: 'PURCHASED_IMPORTED', entryDate: '2024-02-07',
    item: 'LA_01', receipt: 'GR-000001', stage: 'PRODUCTIVE_SOW', location: 'PDS2', batch: 'BATCH-000001',
    cost: '392.8000', productiveStart: '2024-09-03', cullDate: '2029-09-02', teats: 14, tsi: '102.00', grading: '12', ageWeeks: 17, damSerial: 'NB6471',
  },
  {
    code: 'P26302', type: 'GILT', breed: 'L-Line', dob: '2026-01-04', entryType: 'PURCHASED_LOCAL', entryDate: '2026-02-01',
    item: 'LA-02', receipt: 'GR-000002', stage: 'GESTATION', location: 'PDS2', batch: 'BATCH-000001',
    cost: '300.0000', productiveStart: '2026-11-29', cullDate: '2031-11-28', teats: 16, tsi: '106.00', grading: '14', ageWeeks: 4, damSerial: 'CU3647',
  },
  {
    code: 'P25003', type: 'GILT', breed: 'Z-Line', dob: '2025-11-07', entryType: 'PURCHASED_LOCAL', entryDate: '2025-12-05',
    item: 'LA-02', receipt: 'GR-000003', stage: 'GILT_REARING', location: 'PDS2', batch: 'BATCH-000001',
    cost: '300.0000', productiveStart: '2026-10-02', cullDate: '2031-10-01', teats: 17, tsi: '112.00', grading: '14', ageWeeks: 4, damSerial: 'CU3649',
  },
  {
    code: 'P2975', type: 'GILT', breed: 'Tempo', dob: '2025-09-17', entryType: 'PURCHASED_LOCAL', entryDate: '2025-10-15',
    item: 'LA-02', receipt: 'GR-000004', stage: 'LACTATION', location: 'PFH1', batch: 'BATCH-000002',
    cost: '300.0000', productiveStart: '2026-08-12', cullDate: '2031-08-11', teats: 15, tsi: '102.00', grading: '14', ageWeeks: 4,
  },
  {
    code: 'NB0552', type: 'SOW', breed: 'TN70', dob: '2023-10-10', entryType: 'PURCHASED_IMPORTED', entryDate: '2024-02-07',
    item: 'LA_01', receipt: 'GR-000005', stage: 'INSEMINATION', location: 'PDS2', batch: 'BATCH-000001',
    cost: '300.0000', productiveStart: '2024-09-03', cullDate: '2032-09-01', teats: 14, tsi: '102.00', grading: '12', ageWeeks: 17, damSerial: 'NB6471',
  },
  {
    code: 'Q-TN70-01', type: 'GILT', breed: 'TN70', dob: '2026-03-01', entryType: 'PURCHASED_LOCAL', entryDate: '2026-04-01',
    item: 'LA-02', receipt: 'GR-000002', stage: 'QUARANTINE', location: 'PDS2', batch: 'BATCH-000001',
    cost: '300.0000', productiveStart: '2026-12-01', cullDate: '2031-12-01', teats: 14, tsi: '100.00', grading: '12', ageWeeks: 4,
  },
  {
    code: 'F-TEMP-01', type: 'SOW', breed: 'Tempo', dob: '2024-05-01', entryType: 'PURCHASED_LOCAL', entryDate: '2024-06-01',
    item: 'LA_01', receipt: 'GR-000001', stage: 'FARROWING', location: 'PFH1', batch: 'BATCH-000002',
    cost: '350.0000', productiveStart: '2025-01-01', cullDate: '2030-01-01', teats: 16, tsi: '105.00', grading: '14', ageWeeks: 4,
  },
  {
    code: 'FL-ZLIN-01', type: 'SOW', breed: 'Z-Line', dob: '2024-06-01', entryType: 'PURCHASED_LOCAL', entryDate: '2024-07-01',
    item: 'LA_01', receipt: 'GR-000005', stage: 'FLUSH', location: 'PDS2', batch: 'BATCH-000001',
    cost: '320.0000', productiveStart: '2025-02-01', cullDate: '2030-02-01', teats: 14, tsi: '104.00', grading: '12', ageWeeks: 4,
  },
] as const;

export const PORTA_DEVICE_BATCHES = [
  { no: 'BATCH-000001', costing: 'BIO_ASSET', shed: 'PDS2', start: '2026-03-01', expectedEnd: '2032-03-01', quantity: '6.0000', breed: 'TN70' },
  { no: 'BATCH-000002', costing: 'BIO_ASSET', shed: 'PFH1', start: '2024-03-01', expectedEnd: '2030-03-01', quantity: '2.0000', breed: 'Tempo' },
] as const;

export const PORTA_DEVICE_SCHEDULERS = [
  { no: 'SCH-000001', batch: 'BATCH-000001', stage: 'PRODUCTIVE_SOW', shed: 'PDS2', from: '2026-03-01', to: null, count: '1.0000', breed: 'TN70' },
  { no: 'SCH-000002', batch: 'BATCH-000001', stage: 'GESTATION', shed: 'PDS2', from: '2026-03-01', to: null, count: '1.0000', breed: 'L-Line' },
  { no: 'SCH-000003', batch: 'BATCH-000002', stage: 'LACTATION', shed: 'PFH1', from: '2024-03-01', to: null, count: '1.0000', breed: 'Tempo' },
  { no: 'SCH-000004', batch: 'BATCH-000001', stage: 'GILT_REARING', shed: 'PDS2', from: '2026-03-01', to: null, count: '1.0000', breed: 'Z-Line' },
  { no: 'SCH-000005', batch: 'BATCH-000002', stage: 'FARROWING', shed: 'PFH1', from: '2024-03-01', to: null, count: '1.0000', breed: 'Tempo' },
  { no: 'SCH-000006', batch: 'BATCH-000001', stage: 'QUARANTINE', shed: 'PDS2', from: '2026-03-01', to: null, count: '1.0000', breed: 'TN70' },
  { no: 'SCH-000007', batch: 'BATCH-000001', stage: 'INSEMINATION', shed: 'PDS2', from: '2026-03-01', to: null, count: '1.0000', breed: 'TN70' },
  { no: 'SCH-000008', batch: 'BATCH-000001', stage: 'FLUSH', shed: 'PDS2', from: '2026-03-01', to: null, count: '1.0000', breed: 'Z-Line' },
] as const;

