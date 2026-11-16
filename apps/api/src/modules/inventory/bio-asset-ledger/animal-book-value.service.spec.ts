import { summariseAnimalValue } from './animal-book-value.service';

describe('summariseAnimalValue', () => {
  it('book value = acquisition + capitalised - amortisation +/- fair value', () => {
    const v = summariseAnimalValue([
      { event: 'ACQUISITION', total: '300' },
      { event: 'CONSUMPTION', total: '97.5' },
      { event: 'AMORTIZATION', total: '-40' },
      { event: 'FAIR_VALUE_ADJMT', total: '12.25' },
    ]);
    expect(v).toMatchObject({ acquisition: 300, capitalised: 97.5, amortised: 40, fairValue: 12.25, exits: 0, bookValue: 369.75, hasRows: true });
  });

  it('a death leaves her at nil when the write-off is her whole derived value', () => {
    const v = summariseAnimalValue([
      { event: 'ACQUISITION', total: '300' },
      { event: 'CONSUMPTION', total: '97.5' },
      { event: 'MORTALITY', total: '-397.5' },
    ]);
    expect(v.bookValue).toBe(0);
    expect(v.exits).toBe(-397.5);
  });

  it('the lactation cost she hands to her litter at weaning comes off her value', () => {
    const v = summariseAnimalValue([
      { event: 'ACQUISITION', total: '850' },
      { event: 'CONSUMPTION', total: '60' },
      { event: 'COST_ALLOCATION', total: '-60' },
    ]);
    expect(v).toMatchObject({ capitalised: 60, exits: -60, bookValue: 850 });
  });

  it('ignores a transfer, which moves her between batches without changing her worth, and a GRN purchase row', () => {
    const v = summariseAnimalValue([
      { event: 'ACQUISITION', total: '350' },
      { event: 'TRANSFER_OUT', total: '-350' },
      { event: 'TRANSFER_IN', total: '350' },
      { event: 'PURCHASE', total: '9999' },
    ]);
    expect(v.bookValue).toBe(350);
  });

  it('reports hasRows false for an animal the ledger has never seen, so a caller does not treat unknown as nil', () => {
    expect(summariseAnimalValue([]).hasRows).toBe(false);
    expect(summariseAnimalValue([{ event: 'PURCHASE', total: '5' }]).hasRows).toBe(false);
  });

  it('rounds to four decimals so float dust does not leave 1e-13 of a dead animal', () => {
    const v = summariseAnimalValue([
      { event: 'ACQUISITION', total: '0.1' }, { event: 'CONSUMPTION', total: '0.2' }, { event: 'MORTALITY', total: '-0.3' },
    ]);
    expect(v.bookValue).toBe(0);
  });
});
