import { STARTER_GL_MAPPINGS } from '../../system/setup-wizard/seed/starter-master-data.seed-data';
import { ENTRY_TYPES_BY_TRANSACTION_TYPE, INVENTORY_TRANSACTION_TYPES } from '../../inventory/inventory-ledger/inventory-ledger.types';
import { GL_MAPPING_TYPE_RULES, mappingDimensions } from './gl-mapping-fields';
import { assertDimensionsFit, assertEntryTypeFits } from './gl-mapping.rules';

/** The GL Mapping screen shows, per transaction type, the fields its posting is matched on (gl-mapping-fields.ts); the API refuses the rest. */
describe('GL mapping fields by transaction type', () => {
  it('describes every type the setup seed makes a mapping for, and every Inventory Ledger type, once', () => {
    const types = GL_MAPPING_TYPE_RULES.map((r) => r.type);
    expect(new Set(types).size).toBe(types.length);
    for (const m of STARTER_GL_MAPPINGS) expect(types).toContain(m.transaction_type);
    for (const t of INVENTORY_TRANSACTION_TYPES) expect(types).toContain(t);
  });

  it('lets a mapping be made on the screen only for the Inventory Ledger\'s own types, with the entry types the ledger writes them with', () => {
    for (const r of GL_MAPPING_TYPE_RULES) expect(r.creatable).toBe((INVENTORY_TRANSACTION_TYPES as readonly string[]).includes(r.type));
    for (const t of INVENTORY_TRANSACTION_TYPES) expect(GL_MAPPING_TYPE_RULES.find((r) => r.type === t)!.entryTypes).toEqual(ENTRY_TYPES_BY_TRANSACTION_TYPE[t]);
  });

  it('matches an inventory posting on every field, a batch or animal cost on NOB, LOB and stage only, and an unread type on none', () => {
    expect(mappingDimensions('PURCHASE')).toEqual(['item_category_id', 'nob_id', 'lob_id', 'stage_id', 'valuation_method', 'entry_type']);
    expect(mappingDimensions('BIO_CONSUMPTION_PREMATURE')).toContain('item_category_id');
    expect(mappingDimensions('BIO_MORTALITY_MATURE')).toEqual(['nob_id', 'lob_id', 'stage_id']);
    expect(mappingDimensions('PRICE_VARIANCE')).toEqual(['item_category_id', 'nob_id', 'lob_id', 'stage_id']);
    expect(mappingDimensions('BATCH_INPUT')).toEqual([]);
  });

  it('refuses a field the posting is never matched on, and an entry type the row is not written with', () => {
    expect(() => assertDimensionsFit('BIO_MORTALITY_MATURE', { item_category_id: 'cat' })).toThrow(/matched on Nature of Business, Line of Business, Production Stage only/);
    expect(() => assertDimensionsFit('BIO_MORTALITY_MATURE', { stage_id: 's', nob_id: 'n' })).not.toThrow();
    expect(() => assertDimensionsFit('BATCH_OUTPUT', { nob_id: 'n' })).toThrow(/No posting reads a BATCH_OUTPUT mapping/);
    expect(() => assertDimensionsFit('PURCHASE', { item_category_id: 'c', valuation_method: 'FIFO', entry_type: 'POSITIVE' })).not.toThrow();
    expect(() => assertEntryTypeFits('BIO_CONSUMPTION_MATURE', 'POSITIVE')).toThrow(/written as NEGATIVE/);
    expect(() => assertEntryTypeFits('BIO_CONSUMPTION_MATURE', 'NEGATIVE')).not.toThrow();
  });

  it('says what each account is for, and where the animal\'s own account takes a side', () => {
    for (const r of GL_MAPPING_TYPE_RULES) { expect(r.debit.length).toBeGreaterThan(3); expect(r.credit.length).toBeGreaterThan(3); }
    expect(GL_MAPPING_TYPE_RULES.find((r) => r.type === 'BIO_ACQUISITION')!.replaced).toBe('debit');
    expect(GL_MAPPING_TYPE_RULES.find((r) => r.type === 'BIO_LITTER_BIRTH')!.replaced).toBe('credit');
  });
});
