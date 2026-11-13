import { amortisationEndDate, groupConsumption, latestPerDate, summariseWeights } from './animal-activity';

describe('animal card activity arithmetic', () => {
  it('has no weight, and no gain, before anything is recorded', () => {
    expect(summariseWeights([])).toEqual({
      current_weight_kg: null, current_weight_date: null, first_weight_kg: null, first_weight_date: null, adg_g_per_day: null,
    });
  });

  it('shows a single reading as current, with no gain yet', () => {
    expect(summariseWeights([{ date: '2026-10-01', value: 24 }])).toMatchObject({ current_weight_kg: 24, adg_g_per_day: null });
  });

  it('works daily gain in grams from the first to the latest reading', () => {
    const s = summariseWeights([
      { date: '2026-10-08', value: 31 },
      { date: '2026-10-01', value: 24 },
      { date: '2026-10-04', value: 27.5 },
    ]);
    expect(s).toMatchObject({ current_weight_kg: 31, current_weight_date: '2026-10-08', first_weight_kg: 24, adg_g_per_day: 1000 });
  });

  it('keeps the later of two readings on the same date, and so reports no gain over zero days', () => {
    expect(latestPerDate([{ date: '2026-10-01', value: 20 }, { date: '2026-10-01', value: 22 }])).toEqual([{ date: '2026-10-01', value: 22 }]);
    expect(summariseWeights([{ date: '2026-10-01', value: 20 }, { date: '2026-10-01', value: 22 }]).adg_g_per_day).toBeNull();
  });

  it('totals what an animal consumed by item, as a cost not a negative amount', () => {
    const rows = [
      { item_id: 'feed', item_code: 'FD', item_name: 'Sow feed', item_type: 'FEED', uom: 'KG', quantity: 2.5, amount: -5, date: '2026-10-01' },
      { item_id: 'feed', item_code: 'FD', item_name: 'Sow feed', item_type: 'FEED', uom: 'KG', quantity: 2.5, amount: -5.5, date: '2026-10-02' },
      { item_id: 'med', item_code: 'IV', item_name: 'Ivermectin', item_type: 'MEDICINE', uom: 'ML', quantity: 5, amount: -20, date: '2026-10-01' },
    ];
    const g = groupConsumption(rows);
    expect(g.map((x) => [x.item_code, x.quantity, x.cost, x.last_date])).toEqual([
      ['IV', 5, 20, '2026-10-01'],
      ['FD', 5, 10.5, '2026-10-02'],
    ]);
  });
});

describe('animal card amortisation end date', () => {
  const sow = { bio_costing_method: 'AMORTIZATION', bio_useful_life_months: 36 };

  it('ends the day before birth + useful life in 365-day years: born 5 Jan 2026, 36 months, last day 3 Jan 2029', () => {
    expect(amortisationEndDate({ dob: '2026-01-05', entry_date: '2026-01-05' }, sow)).toBe('2029-01-03');
  });

  it('counts from the birth her age at entry implies when she has no birth date', () => {
    // Entered 1 Mar 2026 at 8 weeks: born 4 Jan 2026.
    expect(amortisationEndDate({ dob: null, entry_date: '2026-03-01', age_at_entry_weeks: 8 }, sow)).toBe('2029-01-02');
  });

  it('has no end for an item that does not amortise, has no useful life, or an animal with no age', () => {
    expect(amortisationEndDate({ dob: '2026-01-05', entry_date: '2026-01-05' }, { bio_costing_method: 'FAIR_VALUE', bio_useful_life_months: 36 })).toBeNull();
    expect(amortisationEndDate({ dob: '2026-01-05', entry_date: '2026-01-05' }, { bio_costing_method: 'AMORTIZATION', bio_useful_life_months: null })).toBeNull();
    expect(amortisationEndDate({ dob: null, entry_date: '2026-03-01' }, sow)).toBeNull();
    expect(amortisationEndDate({ dob: '2026-01-05', entry_date: '2026-01-05' }, null)).toBeNull();
  });
});
