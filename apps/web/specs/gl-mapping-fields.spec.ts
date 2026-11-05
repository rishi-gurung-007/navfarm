/**
 * The GL Mapping form shows, per transaction type, only the fields a mapping of that type can be narrowed by, and says what its two accounts are for. The table
 * is the API's (apps/api/src/modules/finance/gl-mapping/gl-mapping-fields.ts, from the posting code); the web keeps a copy, held equal here as text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as web from '../src/modules/master-data/gl-mapping-fields';
import { getConfig } from '../src/modules/master-data/configs';
import { isFieldVisible } from '../src/modules/master-data/MasterDataTable';

const config = getConfig('gl-mapping')!;
const field = (key: string) => config.fields.find((f) => f.key === key)!;
const visible = (key: string, type: string) => isFieldVisible(field(key), { transaction_type: type });

describe('GL Mapping fields by transaction type', () => {
  it('uses the same table as the API', () => {
    // Compared as text, from the first declaration on (only the header comment differs), so the web app takes no dependency on the API project.
    const body = (path: string) => { const t = readFileSync(path, 'utf8'); return t.slice(t.indexOf('export type MappingPath')); };
    expect(body(join(__dirname, '../src/modules/master-data/gl-mapping-fields.ts'))).toBe(body(join(__dirname, '../../api/src/modules/finance/gl-mapping/gl-mapping-fields.ts')));
    expect(web.GL_MAPPING_TYPE_RULES.length).toBe(40);
  });

  it('shows category, valuation and entry type for an inventory posting, and only NOB, LOB and stage for a batch or animal cost', () => {
    for (const k of ['item_category_id', 'valuation_method', 'entry_type', 'nob_id', 'lob_id', 'stage_id']) expect(visible(k, 'PURCHASE')).toBe(true);
    expect(visible('item_category_id', 'BIO_CONSUMPTION_MATURE')).toBe(true);
    for (const k of ['item_category_id', 'valuation_method', 'entry_type']) expect(visible(k, 'BIO_MORTALITY_MATURE')).toBe(false);
    for (const k of ['nob_id', 'lob_id', 'stage_id']) expect(visible(k, 'BIO_MORTALITY_MATURE')).toBe(true);
    for (const k of ['item_category_id', 'nob_id', 'stage_id']) expect(visible(k, 'BATCH_OUTPUT')).toBe(false);
    expect(visible('debit_gl_account_id', 'BATCH_OUTPUT')).toBe(true);
  });

  it('offers only the entry types the chosen type is written with', () => {
    const opts = (type: string) => field('entry_type').filterOptions!(field('entry_type').options!, { transaction_type: type }).map((o) => o.value);
    expect(opts('PURCHASE')).toEqual(['POSITIVE']);
    expect([...opts('TRANSFER_SHIPMENT')].sort()).toEqual(['NEGATIVE', 'TRANSFER']);
    expect(opts('BIO_CONSUMPTION_PREMATURE')).toEqual(['NEGATIVE']);
  });

  it('offers only the Inventory Ledger types for a new mapping, and shows a seeded type as it is', () => {
    const tt = field('transaction_type');
    expect(tt.filterOptions!(tt.options!, {}).map((o) => o.value)).toEqual(tt.options!.map((o) => o.value));
    expect(tt.filterOptions!(tt.options!, { transaction_type: 'BIO_SEMEN_USE' }).at(-1)).toEqual({ value: 'BIO_SEMEN_USE', label: 'BIO_SEMEN_USE (system)' });
    expect(tt.hintFor!({ transaction_type: 'BIO_SEMEN_USE' })).toMatch(/Inventory Ledger row/);
    expect(tt.hintFor!({ transaction_type: 'BIO_MORTALITY_MATURE' })).toMatch(/NOB, LOB and Stage only/);
  });

  it('says what each account is for, and where the animal\'s own account takes its place', () => {
    expect(field('debit_gl_account_id').hintFor!({ transaction_type: 'PURCHASE' })).toMatch(/Inventory of the item's category/);
    expect(field('credit_gl_account_id').hintFor!({ transaction_type: 'PURCHASE' })).toMatch(/Trade Payables/);
    expect(field('debit_gl_account_id').hintFor!({ transaction_type: 'BIO_ACQUISITION' })).toMatch(/Replaced by the animal's own account/);
    expect(field('credit_gl_account_id').hintFor!({ transaction_type: 'BIO_MORTALITY_MATURE' })).toMatch(/fallback/);
  });
});
