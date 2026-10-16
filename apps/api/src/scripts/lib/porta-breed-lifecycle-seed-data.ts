/**
 * Lifecycle data copied from nf_portatestnavfarm and matched to the supplied
 * Porta Breed Master workbook. Source UUIDs are deliberately not retained:
 * the target seed resolves every relationship by the source code.
 */
export const PORTA_LIFECYCLE_BREED_CODE = 'TN-70-Sow';

export const PORTA_LIFECYCLE_STAGES = [
  { code: 'GILT REARING', name: 'Gilt Rearing', category: 'PRODUCTIVE', sequence: 1, typicalDays: 168, minDays: 210, trigger: 'MANUAL', form: 'STANDARD' },
  { code: 'GESTATION', name: 'Gestation', category: 'PRODUCTIVE', sequence: 2, typicalDays: 112, minDays: 0, trigger: 'MANUAL', form: 'STANDARD' },
  { code: 'FARROWING', name: 'Farrowing', category: 'PRODUCTIVE', sequence: 4, typicalDays: null, minDays: 0, trigger: 'MANUAL', form: 'STANDARD' },
  { code: 'WEANING', name: 'Weaning', category: 'PRODUCTIVE', sequence: 5, typicalDays: null, minDays: 0, trigger: 'MANUAL', form: 'STANDARD' },
  { code: 'WEANER', name: 'Weaner', category: 'PRODUCTIVE', sequence: 6, typicalDays: null, minDays: 0, trigger: 'MANUAL', form: 'STANDARD' },
  { code: 'GROWER', name: 'Grower', category: 'OUTPUT', sequence: 7, typicalDays: null, minDays: 0, trigger: 'MANUAL', form: 'STANDARD' },
] as const;

export const PORTA_LIFECYCLE_ITEMS: readonly {
  code: string;
  name: string;
  feedForm: 'BAGGED' | 'BULK' | null;
  itemType?: string;
  uomPrimary?: string;
}[] = [
  { code: 'FEED000012', name: 'Gilt 2', feedForm: null },
  { code: 'ITEM-004', name: 'W1 - Gilt rear 1', feedForm: null },
  { code: 'ITM-0002', name: 'Creep2', feedForm: null },
  { code: 'FEED000022', name: 'Super Flush', feedForm: null },
  { code: 'ITM-0011', name: 'Wean 1', feedForm: 'BAGGED' },
  { code: 'FEED000057', name: 'Dry Gilt', feedForm: null },
  { code: 'FEED000014', name: 'Gilt 4', feedForm: null },
  { code: 'FEED000082', name: 'Transition Amoxy', feedForm: 'BAGGED' },
  { code: 'FEED000086', name: 'Lactate Gilt Amoxy', feedForm: 'BAGGED' },
  { code: 'FEED000018', name: 'Grower 3', feedForm: 'BULK' },
  { code: 'FEED000015', name: 'Gilt 5', feedForm: null },
  { code: 'FEED000017', name: 'Grower 2', feedForm: 'BULK' },
  { code: 'ITM-0005', name: 'Creep 3', feedForm: null, itemType: 'FEED' },
  { code: 'FEED000013', name: 'Gilt 3', feedForm: null },
  { code: 'FEED000019', name: 'Finisher', feedForm: 'BULK' },
  { code: 'FEED-SF', name: 'Super Flush', feedForm: null, itemType: 'FEED', uomPrimary: 'KG' },
  { code: 'DS-001', name: 'Dry Sow Feed', feedForm: null, itemType: 'FEED', uomPrimary: 'KG' },
  { code: 'DG-001', name: 'Dry Gilt Feed', feedForm: null, itemType: 'FEED', uomPrimary: 'KG' },
] as const;

type PortaLifecycleRow = {
  stage: string;
  category: 'GILT' | 'PIGLET';
  from: number;
  to: number;
  farmCode?: string;
  feed?: string;
  qty?: string;
  form?: 'BAGGED' | 'BULK';
  fcr?: string;
  /** Explicit null preserves a blank lifecycle code entered by the user. */
  code?: string | null;
  sourceNote?: string;
  kpiThresholds?: readonly Record<string, string | number>[];
};

const GILT_REARING_KPIS = [
  { uom: 'KGS', metric: 'BODY-WEIGHT', from_day: 4, to_day: 10, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 28, tolerance_pct: 0, tolerance_type: 'LOWER' },
  { uom: 'GMS', metric: 'ADG', from_day: 4, to_day: 10, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 0.526, tolerance_pct: 0, tolerance_type: 'LOWER' },
  { uom: 'KGS', metric: 'BODY-WEIGHT', from_day: 11, to_day: 16, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 68, tolerance_pct: 0, tolerance_type: 'LOWER' },
  { uom: 'GMS', metric: 'ADG', from_day: 11, to_day: 16, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 0.952, tolerance_pct: 0, tolerance_type: 'LOWER' },
  { uom: 'KGS', metric: 'BODY-WEIGHT', from_day: 17, to_day: 25, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 130, tolerance_pct: 0, tolerance_type: 'LOWER' },
  { uom: 'GMS', metric: 'ADG', from_day: 17, to_day: 25, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 0.954, tolerance_pct: 0, tolerance_type: 'LOWER' },
  { uom: 'KGS', metric: 'BODY-WEIGHT', from_day: 26, to_day: 27, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 150, tolerance_pct: 0, tolerance_type: 'LOWER' },
  { uom: 'GMS', metric: 'ADG', from_day: 26, to_day: 27, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 0.952, tolerance_pct: 0, tolerance_type: 'LOWER' },
] as const;
const FARROWING_KPIS = [
  ...(['MUMMIES', 'BORN_ALIVE', 'BORN_DEAD', 'TOTAL GILT_BORN'] as const).map((metric, index) => ({
    uom: 'NO.', metric, from_day: 1, to_day: 2, severity: 'WARNING', kpi_period: 'WEEKLY',
    average_value: [0.4, 15.5, 0.6, 16.5][index], tolerance_pct: 0, tolerance_type: 'LOWER',
  })),
] as const;
const WEANER_KPIS = [
  { uom: 'KGS', metric: 'WEAN_WEIGHT', from_day: 4, to_day: 10, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 29, tolerance_pct: 0, tolerance_type: 'LOWER' },
  { uom: 'GMS', metric: 'ADG', from_day: 4, to_day: 10, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 0.553, tolerance_pct: 0, tolerance_type: 'LOWER' },
] as const;
const PIGLET_GROWER_KPIS = [
  { uom: 'GMS', metric: 'ADG', from_day: 14, to_day: 22, severity: 'CRITICAL', kpi_period: 'WEEKLY', average_value: 1.1, tolerance_pct: 0, tolerance_type: 'LOWER' },
] as const;
const WEANING_KPIS = [
  { uom: 'PCT', metric: 'WEIGHT_LOSS', from_day: 1, to_day: 4, severity: 'WARNING', kpi_period: 'WEEKLY', average_value: 0.94, tolerance_pct: 0, tolerance_type: 'LOWER' },
] as const;

export const PORTA_LIFECYCLE_ROWS: readonly PortaLifecycleRow[] = [
  { stage: 'GILT REARING', category: 'GILT', farmCode: 'POR100', from: 10, to: 11, feed: 'ITEM-004', qty: '1.4000', form: 'BAGGED', sourceNote: 'Breed L-cycle stages gilts: PGH 02' },
  { stage: 'GILT REARING', category: 'GILT', farmCode: 'POR100', from: 11, to: 12, feed: 'ITEM-004', qty: '1.5000', form: 'BAGGED', sourceNote: 'Breed L-cycle stages gilts: PGH 02' },
  { stage: 'GILT REARING', category: 'GILT', farmCode: 'POR100', from: 12, to: 13, feed: 'ITEM-004', qty: '1.6000', form: 'BAGGED', sourceNote: 'Breed L-cycle stages gilts: PGH 02' },
  { stage: 'GILT REARING', category: 'GILT', farmCode: 'POR100', from: 24, to: 25, feed: 'FEED000015', qty: '3.0000', form: 'BAGGED', sourceNote: 'Breed L-cycle stages gilts: PGH 04' },
  { stage: 'GILT REARING', category: 'GILT', farmCode: 'POR100', from: 25, to: 26, feed: 'FEED000015', qty: '3.0000', form: 'BAGGED', sourceNote: 'Breed L-cycle stages gilts: PGH 04' },
  { stage: 'GILT REARING', category: 'GILT', farmCode: 'POR100', from: 26, to: 27, feed: 'FEED000015', qty: '3.3000', form: 'BAGGED', sourceNote: 'Breed L-cycle stages gilts: PGH 04' },
  { stage: 'GILT REARING', category: 'GILT', farmCode: 'POR100', from: 27, to: 28, feed: 'FEED000015', qty: '3.5000', form: 'BAGGED', sourceNote: 'Breed L-cycle stages gilts: PGH 04' },
  { stage: 'WEANING', category: 'GILT', farmCode: 'POR100', from: 1, to: 4, feed: 'FEED-SF', qty: '2.0000', form: 'BULK', sourceNote: 'Breed lifecycle stages - reprod: 3rd parity weaning' },
  { stage: 'GESTATION', category: 'GILT', from: 1, to: 6, feed: 'DG-001', qty: '2.5000', form: 'BULK', code: '001' },
  { stage: 'GESTATION', category: 'GILT', from: 7, to: 8, feed: 'DS-001', qty: '4.5000', form: 'BULK', code: null },
  { stage: 'GESTATION', category: 'GILT', from: 9, to: 16, feed: 'DS-001', qty: '2.8000', form: 'BULK', code: null },
  { stage: 'WEANER', category: 'PIGLET', farmCode: 'POR100', from: 4, to: 4, feed: 'ITM-0002', qty: '0.4800', form: 'BULK', fcr: '1.500', sourceNote: 'Breeder L-cycle stages -WeanGro: 4 weeks' },
  { stage: 'WEANER', category: 'PIGLET', farmCode: 'POR100', from: 5, to: 6, feed: 'ITM-0005', qty: '0.9400', form: 'BULK', fcr: '1.500', sourceNote: 'Breeder L-cycle stages -WeanGro: 5 to 6 weeks' },
  { stage: 'WEANER', category: 'PIGLET', farmCode: 'POR100', from: 7, to: 10, feed: 'ITM-0011', qty: '1.1000', form: 'BULK', fcr: '1.500', sourceNote: 'Breeder L-cycle stages -WeanGro: 7 to 10 weeks' },
  { stage: 'GROWER', category: 'PIGLET', farmCode: 'POR100', from: 10, to: 11, feed: 'ITM-0011', qty: '1.6000', form: 'BULK', fcr: '2.400', sourceNote: 'Breeder L-cycle stages -WeanGro: PGH-01' },
  { stage: 'GROWER', category: 'PIGLET', farmCode: 'POR100', from: 10, to: 11, feed: 'ITM-0011', qty: '1.7000', form: 'BULK', fcr: '2.400', sourceNote: 'Breeder L-cycle stages -WeanGro: PGH-01' },
  { stage: 'GROWER', category: 'PIGLET', farmCode: 'POR100', from: 14, to: 15, feed: 'FEED000017', qty: '2.6000', form: 'BULK', fcr: '2.400', sourceNote: 'Breeder L-cycle stages -WeanGro: PGH-01' },
  { stage: 'GROWER', category: 'PIGLET', farmCode: 'POR100', from: 14, to: 15, feed: 'FEED000017', qty: '2.7000', form: 'BULK', fcr: '2.400', sourceNote: 'Breeder L-cycle stages -WeanGro: PGH-01' },
  { stage: 'GROWER', category: 'PIGLET', farmCode: 'POR100', from: 16, to: 18, feed: 'FEED000018', qty: '2.9000', form: 'BULK', fcr: '2.400', sourceNote: 'Breeder L-cycle stages -WeanGro: PGH-01' },
  { stage: 'GROWER', category: 'PIGLET', farmCode: 'POR100', from: 17, to: 18, feed: 'FEED000018', qty: '3.1000', form: 'BULK', fcr: '2.400', sourceNote: 'Breeder L-cycle stages -WeanGro: PGH-01' },
  { stage: 'GROWER', category: 'PIGLET', farmCode: 'POR100', from: 19, to: 22, feed: 'FEED000019', qty: '3.1000', form: 'BULK', fcr: '2.400', sourceNote: 'Breeder L-cycle stages -WeanGro: PGH-01' },
];

export const PORTA_LIFECYCLE_SKIPPED = [
  'Gilt rows with composite feed names — no single supplied item-master mapping.',
  'Gestation and farrowing rows — feed is delegated to schedule tabs and has no numeric rate in the lifecycle row.',
  'Service-line, Double stock, and Colcom rows — not among the proposed stage mappings.',
  'Grower 1 and Wean 1 OTC segments — no unambiguous item-master code in the supplied source data.',
  'House-specific rate variants beyond the PGH-01 canonical farm-level mapping — shed-level overrides were not requested.',
] as const;
