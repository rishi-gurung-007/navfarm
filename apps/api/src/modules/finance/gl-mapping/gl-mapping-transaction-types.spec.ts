import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STARTER_GL_MAPPINGS } from '../../system/setup-wizard/seed/starter-master-data.seed-data';
import { ENTRY_TYPES_BY_TRANSACTION_TYPE, INVENTORY_ENTRY_TYPES, INVENTORY_TRANSACTION_TYPES } from '../../inventory/inventory-ledger/inventory-ledger.types';

/**
 * A G/L Mapping is set up by Inventory Ledger transaction type and entry type (INVENTORY_TRANSACTION_TYPES, INVENTORY_ENTRY_TYPES): the GL Mapping screen offers
 * exactly those, and the API refuses a new mapping for anything else. There is no master of transaction types.
 *
 * Separately, postings that name their own type (batch mortality and overhead, the BIO_* lifecycle, the variances) look a mapping up by that name, and a missing one
 * fails the document at posting with "No GL mapping is set up for ...". Those mappings come from the setup seed, so every type the services post under must have
 * a starter mapping: the `OUTPUT` of a non-bio batch's output line was exactly that gap.
 */
const POSTED_TRANSACTION_TYPES = [
  'PURCHASE',
  'CONSUMPTION',
  'OUTPUT',
  'TRANSFER_SHIPMENT',
  'TRANSFER_RECEIPT',
  'VARIANCE_POSITIVE',
  'VARIANCE_NEGATIVE',
  'MORTALITY',
  'OVERHEAD',
  'BATCH_IMPAIRMENT',
  'PRICE_VARIANCE',
  'USAGE_VARIANCE',
  'OUTPUT_VARIANCE',
  'OVERHEAD_VARIANCE',
  'BIO_ACQUISITION',
  'BIO_CONSUMPTION_PREMATURE',
  'BIO_CONSUMPTION_MATURE',
  'BIO_OUTPUT',
  'BIO_MORTALITY_PREMATURE',
  'BIO_MORTALITY_MATURE',
  'BIO_OVERHEAD_PREMATURE',
  'BIO_OVERHEAD_MATURE',
  'BIO_TRANSFORMATION',
  'BIO_AMORTIZATION',
  'BIO_FAIR_VALUE',
  'BIO_FAIR_VALUE_PREMATURE',
  'BIO_HARVEST',
  'BIO_DISPOSAL_SOLD',
  'BIO_SALE_PROCEEDS',
  'BIO_FA_CONVERSION',
  'BIO_SEMEN_USE',
  'BIO_SEMEN_EXPENSE',
  'BIO_SEMEN_PRODUCTION',
];

/**
 * BIO_LITTER_BIRTH and BIO_GILT_ACQUISITION are posted too, but deliberately NOT seeded: the litter's cost at birth moves value out of the pre-mature account (1050,
 * where the sow's WIP sits) into Piglets Inventory (1055), which is not in the starter chart; farrowing and registration post no journal without a mapping.
 */
const OPT_IN_TYPES = ['BIO_LITTER_BIRTH', 'BIO_GILT_ACQUISITION'];

const read = (relative: string) => readFileSync(join(__dirname, relative), 'utf8');
const configs = () => read('../../../../../web/src/modules/master-data/configs.ts');
const glMappingConfig = () => {
  const source = configs();
  return source.slice(source.indexOf('const glMapping: MasterDataConfig'), source.indexOf('const costCenter: MasterDataConfig'));
};
/** The option values a `{ key: '<field>' ... options: [...] }` form field of the GL Mapping config lists (the field, not a column of the same key). */
const optionValues = (field: string) => {
  const config = glMappingConfig();
  const start = config.indexOf(`key: '${field}',\n      label:`);
  const open = config.indexOf('options: [', start);
  const close = config.indexOf('\n      ],', open);
  return [...config.slice(open, close).matchAll(/value: '([A-Z_]+)'/g)].map((m) => m[1]);
};

describe('GL mapping transaction types', () => {
  it('offers the Inventory Ledger transaction types on the screen, and nothing else', () => {
    expect(optionValues('transaction_type').sort()).toEqual([...INVENTORY_TRANSACTION_TYPES].sort());
  });

  it('offers the Inventory Ledger entry types on the screen, and nothing else', () => {
    expect(optionValues('entry_type').sort()).toEqual([...INVENTORY_ENTRY_TYPES].sort());
  });

  it('has an entry-type list for every transaction type the screen offers', () => {
    expect(INVENTORY_TRANSACTION_TYPES.filter((t) => !ENTRY_TYPES_BY_TRANSACTION_TYPE[t]?.length)).toEqual([]);
  });

  it('has no master of transaction types: the screen reads a fixed list, not an endpoint', () => {
    expect(configs()).not.toContain('gl-transaction-type');
    expect(glMappingConfig()).not.toMatch(/key: 'transaction_type'[\s\S]{0,200}select-entity/);
  });

  it('has a starter mapping for every type the services post under', () => {
    const seeded = new Set(STARTER_GL_MAPPINGS.map((m) => m.transaction_type));
    expect(POSTED_TRANSACTION_TYPES.filter((t) => !seeded.has(t))).toEqual([]);
  });

  it('leaves the opt-in types without a starter mapping (account 1055 is not in the starter chart)', () => {
    const seeded = new Set(STARTER_GL_MAPPINGS.map((m) => m.transaction_type));
    expect(OPT_IN_TYPES.filter((t) => seeded.has(t))).toEqual([]);
  });
});
