import { lotFairValueLine, type LotFairValueInput, type LotRate } from './lot-fair-value.rules';
import { periodOfKey } from '../../finance/bio-costing/bio-costing.engine';
import { isCurrentBioLot } from './current-bio-lot';

const rate = (over: Partial<LotRate> = {}): LotRate => ({ farm_id: null, age_week_from: 0, effective_from: '2026-01-01', expected_weight_kg: 30, price_per_kg: 2, costs_to_sell_pct: null, ...over });
const input = (over: Partial<LotFairValueInput> = {}): LotFairValueInput => ({
  item_method: 'FAIR_VALUE', start_age_weeks: 17, start_age_days: 0, start_date: '2026-01-05', farm_id: null, head: 10, carrying_value: 40,
  period: periodOfKey('MONTHLY', '2026-06')!, rates: [rate()], already_run: false, ...over,
});

describe('lotFairValueLine (BBP-2 S.NO.6: cost to week 17, fair value from week 18)', () => {
  it('values the head at expected weight x price per kg and adjusts the carrying value to it', () => {
    const l = lotFairValueLine(input());
    expect(l.status).toBe('ADJUST');
    expect(l.fair_value).toBe(600); // 10 head x 30 kg x 2.00
    expect(l.adjustment).toBe(560); // a gain against 40
    expect(l.fair_value_per_head).toBe(60);
    expect(l.age_weeks).toBe(25); // 5 Jan to 30 Jun 2026
  });

  it('a loss is a negative adjustment', () => {
    const l = lotFairValueLine(input({ carrying_value: 900 }));
    expect(l.adjustment).toBe(-300);
  });

  it('takes costs to sell off the fair value where the rate gives them', () => {
    const l = lotFairValueLine(input({ rates: [rate({ costs_to_sell_pct: 10 })] }));
    expect(l.fair_value).toBe(540); // 600 less 10%
    expect(l.rate?.costs_to_sell_pct).toBe(10);
  });

  it('stays at cost until the item\'s start age: week 17 of age, so week 18 is the first fair value month', () => {
    // born 5 Jan: 17 weeks later is 4 May 2026; April is before it, May is in
    expect(lotFairValueLine(input({ period: periodOfKey('MONTHLY', '2026-04')! })).skip_reason).toBe('NOT_STARTED');
    expect(lotFairValueLine(input({ period: periodOfKey('MONTHLY', '2026-04')! })).starts_on).toBe('2026-05-04');
    expect(lotFairValueLine(input({ period: periodOfKey('MONTHLY', '2026-05')! })).status).toBe('ADJUST');
  });

  it('uses the age band the lot has reached, the farm\'s own rate before every farm\'s, and the latest effective date', () => {
    const rates = [
      rate({ age_week_from: 0, price_per_kg: 1 }),
      rate({ age_week_from: 18, price_per_kg: 2 }),
      rate({ age_week_from: 18, price_per_kg: 3, effective_from: '2026-05-01' }),
      rate({ age_week_from: 18, price_per_kg: 9, effective_from: '2026-07-01' }), // not yet effective in June
      rate({ age_week_from: 18, price_per_kg: 4, farm_id: 'farm-1', effective_from: '2026-01-01' }),
    ];
    expect(lotFairValueLine(input({ rates, farm_id: null })).rate?.price_per_kg).toBe(3);
    expect(lotFairValueLine(input({ rates, farm_id: 'farm-1' })).rate?.price_per_kg).toBe(4);
    expect(lotFairValueLine(input({ rates, period: periodOfKey('MONTHLY', '2026-05')! })).rate?.price_per_kg).toBe(3); // 20 weeks old in May: band 18 reached, the May rate is in force
  });

  it('skips with a reason, never silently valuing at nil: no rate, no head, not a fair value item, already run, no change', () => {
    expect(lotFairValueLine(input({ rates: [] })).skip_reason).toBe('NO_RATE');
    expect(lotFairValueLine(input({ rates: [rate({ age_week_from: 40 })] })).skip_reason).toBe('NO_RATE'); // not old enough for the only band
    expect(lotFairValueLine(input({ head: 0 })).skip_reason).toBe('NO_HEAD');
    expect(lotFairValueLine(input({ item_method: 'AMORTIZATION' })).skip_reason).toBe('NOT_FAIR_VALUE_ITEM');
    expect(lotFairValueLine(input({ item_method: null })).skip_reason).toBe('NOT_FAIR_VALUE_ITEM');
    expect(lotFairValueLine(input({ already_run: true })).skip_reason).toBe('ALREADY_RUN');
    expect(lotFairValueLine(input({ carrying_value: 600 })).skip_reason).toBe('NO_CHANGE');
  });
});

describe('isCurrentBioLot', () => {
  it('is a litter lot, or a head-count batch in the Weaner, Grower or Finisher stage, and never a batch of registered animals', () => {
    expect(isCurrentBioLot({ is_litter_lot: true, tracking_mode: 'BATCH_WISE' })).toBe(true);
    expect(isCurrentBioLot({ current_stage_code: 'grower', tracking_mode: 'BATCH_WISE' })).toBe(true);
    expect(isCurrentBioLot({ current_stage_code: 'FINISHER' })).toBe(true);
    expect(isCurrentBioLot({ current_stage_code: 'GESTATION', tracking_mode: 'BATCH_WISE' })).toBe(false);
    expect(isCurrentBioLot({ is_litter_lot: true, tracking_mode: 'ANIMAL_WISE' })).toBe(false);
  });
});
