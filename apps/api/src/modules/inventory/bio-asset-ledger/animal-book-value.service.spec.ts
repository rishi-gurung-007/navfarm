import { summariseAnimalValue } from './animal-book-value.service';

describe('summariseAnimalValue', () => {
  it('book value = acquisition + capitalised - amortisation +/- fair value', () => {
    const v = summariseAnimalValue([
      { entry_type: 'ACQUISITION', total: '300' },
      { entry_type: 'CONSUMPTION', total: '97.5' },
      { entry_type: 'AMORTIZATION', total: '-40' },
      { entry_type: 'FAIR_VALUE_ADJMT', total: '12.25' },
    ]);
    expect(v).toMatchObject({ acquisition: 300, capitalised: 97.5, amortised: 40, fairValue: 12.25, exits: 0, bookValue: 369.75, hasRows: true });
  });

  it('a death leaves her at nil when the write-off is her whole derived value', () => {
    const v = summariseAnimalValue([
      { entry_type: 'ACQUISITION', total: '300' },
      { entry_type: 'CONSUMPTION', total: '97.5' },
      { entry_type: 'MORTALITY', total: '-397.5' },
    ]);
    expect(v.bookValue).toBe(0);
    expect(v.exits).toBe(-397.5);
  });

  it('the lactation cost she hands to her litter at weaning comes off her value', () => {
    const v = summariseAnimalValue([
      { entry_type: 'ACQUISITION', total: '850' },
      { entry_type: 'CONSUMPTION', total: '60' },
      { entry_type: 'COST_ALLOCATION', total: '-60' },
    ]);
    expect(v).toMatchObject({ capitalised: 60, exits: -60, bookValue: 850 });
  });

  it('ignores a transfer, which moves her between batches without changing her worth, and a GRN purchase row', () => {
    const v = summariseAnimalValue([
      { entry_type: 'ACQUISITION', total: '350' },
      { entry_type: 'TRANSFER_OUT', total: '-350' },
      { entry_type: 'TRANSFER_IN', total: '350' },
      { entry_type: 'PURCHASE', total: '9999' },
    ]);
    expect(v.bookValue).toBe(350);
  });

  it('reports hasRows false for an animal the ledger has never seen, so a caller does not treat unknown as nil', () => {
    expect(summariseAnimalValue([]).hasRows).toBe(false);
    expect(summariseAnimalValue([{ entry_type: 'PURCHASE', total: '5' }]).hasRows).toBe(false);
  });

  it('rounds to four decimals so float dust does not leave 1e-13 of a dead animal', () => {
    const v = summariseAnimalValue([
      { entry_type: 'ACQUISITION', total: '0.1' }, { entry_type: 'CONSUMPTION', total: '0.2' }, { entry_type: 'MORTALITY', total: '-0.3' },
    ]);
    expect(v.bookValue).toBe(0);
  });
});
