import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STARTER_GL_MAPPINGS } from '../../system/setup-wizard/seed/starter-master-data.seed-data';

/**
 * Every transaction type the services post to the GL must have a starter GL mapping, be offered
 * by the GL Mapping API's enum and by the master-data screen's picker — a type missing from any
 * of the three fails at posting ("No GL mapping is set up for ...") or cannot be configured.
 * The `OUTPUT` of a non-bio batch's output line was exactly that gap.
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
  'BIO_SEMEN_USE',
  'BIO_SEMEN_EXPENSE',
  'BIO_SEMEN_PRODUCTION',
];

/**
 * BIO_LITTER_BIRTH is posted too, but it is deliberately NOT seeded: the litter's cost at birth moves value out of the pre-mature account (1050, where the sow's WIP sits) into
 * Piglets Inventory (1055), and later postings on a piglet lot (mortality, consumption) still use 1050; Finance opts in by adding the mapping, and farrowing posts no journal without it.
 */
describe('GL mapping transaction types', () => {
  it('has a starter mapping for every posted type', () => {
    const seeded = new Set(STARTER_GL_MAPPINGS.map((m) => m.transaction_type));
    expect(POSTED_TRANSACTION_TYPES.filter((t) => !seeded.has(t))).toEqual([]);
  });

  it('offers the opt-in litter birth type in the API enum and on the screen without seeding it', () => {
    const seeded = new Set(STARTER_GL_MAPPINGS.map((m) => m.transaction_type));
    expect(seeded.has('BIO_LITTER_BIRTH')).toBe(false);
    expect(
      readFileSync(join(__dirname, 'dto/gl-mapping.dto.ts'), 'utf8'),
    ).toContain("'BIO_LITTER_BIRTH'");
    expect(
      readFileSync(
        join(
          __dirname,
          '../../../../../web/src/modules/master-data/configs.ts',
        ),
        'utf8',
      ),
    ).toMatch(/value: ["']BIO_LITTER_BIRTH["']/);
  });

  it('offers the opt-in gilt acquisition type in the API enum and on the screen without seeding it (account 1055 is not in the starter chart)', () => {
    const seeded = new Set(STARTER_GL_MAPPINGS.map((m) => m.transaction_type));
    expect(seeded.has('BIO_GILT_ACQUISITION')).toBe(false);
    expect(
      readFileSync(join(__dirname, 'dto/gl-mapping.dto.ts'), 'utf8'),
    ).toContain("'BIO_GILT_ACQUISITION'");
    expect(
      readFileSync(
        join(
          __dirname,
          '../../../../../web/src/modules/master-data/configs.ts',
        ),
        'utf8',
      ),
    ).toMatch(/value: ["']BIO_GILT_ACQUISITION["']/);
  });

  it('offers every posted type in the API enum', () => {
    const dto = readFileSync(join(__dirname, 'dto/gl-mapping.dto.ts'), 'utf8');
    expect(
      POSTED_TRANSACTION_TYPES.filter((t) => !dto.includes(`'${t}'`)),
    ).toEqual([]);
  });

  it('offers every posted type on the master-data screen', () => {
    const configs = readFileSync(
      join(__dirname, '../../../../../web/src/modules/master-data/configs.ts'),
      'utf8',
    );
    // Either quote: configs.ts is Prettier-formatted (single quotes since 24 Oct).
    expect(
      POSTED_TRANSACTION_TYPES.filter(
        (t) =>
          !configs.includes(`value: "${t}"`) &&
          !configs.includes(`value: '${t}'`),
      ),
    ).toEqual([]);
  });
});
