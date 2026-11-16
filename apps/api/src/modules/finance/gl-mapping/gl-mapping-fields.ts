/**
 * What each G/L Mapping transaction type is matched on, and what its two accounts are for: the one table the GL Mapping screen (a copy in
 * apps/web/src/modules/master-data/gl-mapping-fields.ts, held equal by apps/web/specs/gl-mapping-fields.spec.ts) and the API's checks read. Pure data.
 *
 * Read from the posting code (gl-posting.service.ts), not chosen:
 *   INVENTORY  posted from an Inventory Ledger row (postInventoryLedgerEntry): the row gives the item's category, NOB, LOB, stage, the item's valuation method
 *              and the row's entry type, so a mapping can be narrowed by any of them.
 *   BATCH      posted as a batch or animal cost (postBatchCostEntry): only NOB, LOB and the batch's stage are passed, so a mapping narrowed by category,
 *              valuation or entry type could never be chosen.
 *   UNUSED     in the starter chart, but no posting asks for it.
 * `replaced` says where the code puts the animal's own account (her item's Bio Asset Costing tab) in place of the mapping's, so the mapping's account on
 * that side is only the fallback for a herd with no registered animals.
 */

export type MappingPath = 'INVENTORY' | 'BATCH' | 'UNUSED';
export type MappingDimension = 'item_category_id' | 'nob_id' | 'lob_id' | 'stage_id' | 'valuation_method' | 'entry_type';

export interface MappingTypeRule {
  type: string;
  path: MappingPath;
  /** The entry types an Inventory Ledger row of this type is written with; empty where the posting has no ledger row. */
  entryTypes: readonly string[];
  /** What the debit and the credit account are for. */
  debit: string;
  credit: string;
  /** The side the code fills with the animal's (or litter's) own account where the posting names one; the mapping's account is then only the fallback. */
  replaced?: 'debit' | 'credit';
  /** A new mapping may be made for this type on the screen (the Inventory Ledger's own types); the rest come from the setup seed and are edited only. */
  creatable: boolean;
}

const INVENTORY_DIMENSIONS: readonly MappingDimension[] = ['item_category_id', 'nob_id', 'lob_id', 'stage_id', 'valuation_method', 'entry_type'];
const BATCH_DIMENSIONS: readonly MappingDimension[] = ['nob_id', 'lob_id', 'stage_id'];

const inv = (type: string, entryTypes: string[], debit: string, credit: string, extra: Partial<MappingTypeRule> = {}): MappingTypeRule =>
  ({ type, path: 'INVENTORY', entryTypes, debit, credit, creatable: false, ...extra });
const batch = (type: string, debit: string, credit: string, extra: Partial<MappingTypeRule> = {}): MappingTypeRule =>
  ({ type, path: 'BATCH', entryTypes: [], debit, credit, creatable: false, ...extra });
const ANIMAL = 'the animal\'s own account (her item\'s Bio Asset Costing tab) when the posting names her';

export const GL_MAPPING_TYPE_RULES: readonly MappingTypeRule[] = [
  // ---- the Inventory Ledger's own types: made on the screen ----
  inv('PURCHASE', ['POSITIVE'], 'Inventory of the item\'s category (goods received)', 'Trade Payables (goods received, not invoiced)', { creatable: true }),
  inv('CONSUMPTION', ['NEGATIVE'], 'The expense the issued stock is charged to', 'Inventory of the item\'s category', { creatable: true }),
  inv('OUTPUT', ['POSITIVE'], 'Finished goods inventory (what was produced)', 'Work in progress', { creatable: true }),
  inv('TRANSFER_SHIPMENT', ['TRANSFER', 'NEGATIVE'], 'Inventory in transit', 'Inventory of the sending location', { creatable: true }),
  inv('TRANSFER_RECEIPT', ['TRANSFER', 'POSITIVE'], 'Inventory of the receiving location', 'Inventory in transit', { creatable: true }),
  inv('SALES', ['NEGATIVE'], 'Cost of goods sold', 'Inventory of the item\'s category', { creatable: true }),
  inv('VARIANCE_POSITIVE', ['POSITIVE'], 'Inventory of the item\'s category (stock found)', 'Inventory adjustment gain', { creatable: true }),
  inv('VARIANCE_NEGATIVE', ['NEGATIVE'], 'Inventory adjustment loss', 'Inventory of the item\'s category (stock lost)', { creatable: true }),
  inv('OVERHEAD', ['OVERHEAD'], 'Work in progress (the batch carries the overhead)', 'Trade Payables or the accrual the overhead is owed to', { creatable: true }),
  inv('DESCRIPTIVE', ['DESCRIPTIVE'], 'Nothing: an observation moves no value', 'Nothing: an observation moves no value', { creatable: true }),
  // ---- bio postings written as an Inventory Ledger row (its gl_mapping_type) ----
  inv('BIO_CONSUMPTION_PREMATURE', ['NEGATIVE'], 'The herd\'s pre-mature asset (feed capitalised before the costing start)', 'Inventory of the item\'s category', { replaced: 'debit' }),
  inv('BIO_CONSUMPTION_MATURE', ['NEGATIVE'], 'Feed and medicine expense (after the costing start)', 'Inventory of the item\'s category'),
  inv('BIO_SEMEN_USE', ['NEGATIVE'], 'The sow\'s asset (semen capitalised before her costing start)', 'Semen stock (finished goods)', { replaced: 'debit' }),
  inv('BIO_SEMEN_EXPENSE', ['NEGATIVE'], 'Semen expense (after the sow\'s costing start)', 'Semen stock (finished goods)'),
  inv('BIO_SEMEN_PRODUCTION', ['POSITIVE'], 'Semen stock (finished goods)', 'Boar cost recovered (the semen\'s value)'),
  inv('BIO_OUTPUT', ['POSITIVE'], 'Finished goods inventory (what the herd produced)', 'The herd\'s mature asset'),
  inv('BIO_HARVEST', ['POSITIVE'], 'Finished goods inventory (the harvested herd)', 'The herd\'s mature asset'),
  inv('BIO_FA_CONVERSION', ['POSITIVE'], 'Inventory of the culled animal, at market value', 'The herd\'s mature asset', { replaced: 'credit' }),
  // ---- batch and animal costs ----
  batch('BIO_ACQUISITION', 'The herd\'s pre-mature asset (animals bought)', 'Trade Payables', { replaced: 'debit' }),
  batch('BIO_OVERHEAD_PREMATURE', 'The herd\'s pre-mature asset (overhead capitalised before the costing start)', 'Trade Payables or the overhead accrual', { replaced: 'debit' }),
  batch('BIO_OVERHEAD_MATURE', 'Overhead expense (after the costing start)', 'Trade Payables or the overhead accrual'),
  batch('BIO_MORTALITY_PREMATURE', 'Mortality / impairment loss', 'The herd\'s pre-mature asset', { replaced: 'credit' }),
  batch('BIO_MORTALITY_MATURE', 'Mortality / impairment loss', 'The herd\'s mature asset', { replaced: 'credit' }),
  batch('BIO_LITTER_BIRTH', 'Weaners / piglet inventory (the litter\'s cost at birth)', 'The sow\'s asset', { replaced: 'credit' }),
  batch('BIO_GILT_ACQUISITION', 'The gilt\'s asset', 'Weaners / piglet inventory', { replaced: 'debit' }),
  batch('BIO_TRANSFORMATION', 'The herd\'s mature asset', 'The herd\'s pre-mature asset'),
  batch('BIO_AMORTIZATION', 'Amortisation expense (a herd with no registered animals; an animal uses her item\'s own accounts)', 'Accumulated amortisation, or the mature asset'),
  batch('BIO_FAIR_VALUE', 'The herd\'s mature asset (a gain; a loss posts the other way round)', 'Fair value gain / loss (an animal uses her item\'s own accounts)'),
  batch('BIO_FAIR_VALUE_PREMATURE', 'The herd\'s pre-mature asset (a gain; a loss posts the other way round)', 'Fair value gain / loss (an animal uses her item\'s own accounts)'),
  batch('BIO_DISPOSAL_SOLD', 'The herd\'s asset (a gain; a loss posts the other way round)', 'Gain / loss on disposal of animals', { replaced: 'debit' }),
  batch('BIO_SALE_PROCEEDS', 'Trade Receivables (what the buyer owes)', 'The herd\'s asset', { replaced: 'credit' }),
  batch('MORTALITY', 'Mortality / impairment loss', 'Work in progress (a batch that is not a bio asset)'),
  batch('BATCH_IMPAIRMENT', 'Inventory adjustment loss', 'Work in progress'),
  batch('USAGE_VARIANCE', 'Usage variance (unfavourable; favourable posts the other way round)', 'Work in progress'),
  batch('OUTPUT_VARIANCE', 'Output variance (unfavourable; favourable posts the other way round)', 'Work in progress'),
  batch('OVERHEAD_VARIANCE', 'Overhead variance (unfavourable; favourable posts the other way round)', 'Work in progress'),
  // A purchase price variance is posted from the receipt's ledger row (with its category); a batch's close variance as a batch cost.
  { type: 'PRICE_VARIANCE', path: 'BATCH', entryTypes: [], debit: 'Price variance (paid above standard; below posts the other way round)', credit: 'Trade Payables (at the receipt) or work in progress (at a batch close)', creatable: false },
  // ---- in the starter chart, read by no posting ----
  { type: 'BATCH_INPUT', path: 'UNUSED', entryTypes: [], debit: 'Not read by any posting', credit: 'Not read by any posting', creatable: false },
  { type: 'BATCH_CONSUMPTION', path: 'UNUSED', entryTypes: [], debit: 'Not read by any posting', credit: 'Not read by any posting', creatable: false },
  { type: 'BATCH_OUTPUT', path: 'UNUSED', entryTypes: [], debit: 'Not read by any posting', credit: 'Not read by any posting', creatable: false },
];

/** The fields a mapping of `type` can be narrowed by (a type not in the table: every field, so nothing is refused that the code might read). */
export function mappingDimensions(type: string): readonly MappingDimension[] {
  const rule = GL_MAPPING_TYPE_RULES.find((r) => r.type === type.toUpperCase());
  if (!rule) return INVENTORY_DIMENSIONS;
  if (rule.type === 'PRICE_VARIANCE') return ['item_category_id', 'nob_id', 'lob_id', 'stage_id'];
  if (rule.path === 'INVENTORY') return rule.entryTypes.length ? INVENTORY_DIMENSIONS : INVENTORY_DIMENSIONS.filter((d) => d !== 'entry_type');
  if (rule.path === 'BATCH') return BATCH_DIMENSIONS;
  return [];
}

export const ANIMAL_ACCOUNT_NOTE = ANIMAL;
