import { MASTER_DATA_CONFIGS } from '@/modules/master-data/configs';
import { isFieldVisible } from '@/modules/master-data/MasterDataTable';

const item = MASTER_DATA_CONFIGS.find((config) => config.key === 'item')!;

describe('Item Master Standard Cost (Rishi, 2 Nov)', () => {
  const field = item.fields.find((f) => f.key === 'standard_cost')!;

  it('is asked for, and required, only when the Valuation Method is Standard', () => {
    expect(isFieldVisible(field, { valuation_method: 'STANDARD' })).toBe(true);
    expect(isFieldVisible(field, { valuation_method: 'AVG' })).toBe(false);
    expect(isFieldVisible(field, { valuation_method: 'FIFO' })).toBe(false);
    expect(isFieldVisible(field, { valuation_method: '' })).toBe(false);
    expect(field.requiredWhen).toEqual({
      anyOf: [{ key: 'valuation_method', equals: 'STANDARD' }],
    });
  });

  it('stays hidden on edit for a non-Standard item even when an old cost is stored', () => {
    expect(field.hideStoredWhenHidden).toBe(true);
  });
});
