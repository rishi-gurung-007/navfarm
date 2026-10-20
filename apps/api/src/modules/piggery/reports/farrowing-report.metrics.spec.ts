import { commonTargets, computeFarrowingMetrics, FarrowingRow, isEmptyPeriod, minusOneYear, SowWeightRow, targetsFromLifecycle, WeanedRow, weekStart } from './farrowing-report.metrics';

const litter = (over: Partial<FarrowingRow>): FarrowingRow => ({
  batch_id: 'B1',
  farrow_id: 'F',
  piglet_batch_id: null,
  piglets_born_total: 0,
  piglets_born_live: 0,
  piglets_stillborn: 0,
  piglets_mummified: 0,
  foster_received: 0,
  fostered_out: 0,
  weaning_date: null,
  piglets_weaned: 0,
  avg_weaning_weight_kg: null,
  ...over,
});

describe('farrowing report metrics', () => {
  it('computes the batch columns from services, litters and piglet deaths', () => {
    const services = [
      { batch_id: 'B1', parity_number: 1 },
      { batch_id: 'B1', parity_number: 2 },
      { batch_id: 'B1', parity_number: 2 },
      { batch_id: 'B1', parity_number: 4 },
    ];
    const farrowings = [
      litter({ farrow_id: 'F1', piglet_batch_id: 'L1', piglets_born_total: 14, piglets_born_live: 12, piglets_stillborn: 1, piglets_mummified: 1, weaning_date: '2026-03-20', piglets_weaned: 11, avg_weaning_weight_kg: 7 }),
      litter({ farrow_id: 'F2', piglet_batch_id: 'L2', piglets_born_total: 12, piglets_born_live: 12, foster_received: 1, fostered_out: 1 }),
      litter({ farrow_id: 'F3', piglet_batch_id: 'L3', piglets_born_total: 10, piglets_born_live: 8, piglets_stillborn: 2, weaning_date: '2026-03-25', piglets_weaned: 8, avg_weaning_weight_kg: 6 }),
    ];
    const mortality = [
      { piglet_batch_id: 'L1', transaction_date: '2026-03-01', quantity: 1 },
      { piglet_batch_id: 'L1', transaction_date: '2026-03-25', quantity: 1 }, // after its weaning: not pre-wean
      { piglet_batch_id: 'L2', transaction_date: '2026-03-30', quantity: 2 },
      { piglet_batch_id: 'OTHER', transaction_date: '2026-03-30', quantity: 5 },
    ];
    const m = computeFarrowingMetrics(services, farrowings, mortality, '2026-03-31');
    expect(m.sows_served).toBe(4);
    expect(m.sows_farrowed).toBe(3);
    expect(m.farrowing_rate_pct).toBe(75);
    expect(m.total_born_per_sow).toBe(12);
    expect(m.born_alive_per_sow).toBeCloseTo(10.67);
    expect(m.born_dead).toBe(3);
    expect(m.mummified).toBe(1);
    // Week of Tue 31 Mar 2026 starts Mon 30 Mar: L1's death on the 25th is outside it, L2's two are in.
    expect(m.active_week_mortality).toBe(2);
    // 1 (L1 before weaning) + 2 (L2 still nursing) over 12 + 12 + 8 starting head.
    expect(m.pre_wean_mortality_pct).toBeCloseTo(9.38, 1);
    expect(m.litter_mass_total_kg).toBe(125);
    expect(m.litter_mass_avg_kg).toBe(62.5);
    expect(m.avg_weaning_weight_kg).toBeCloseTo(6.58);
    expect(m.gilts_served).toBe(1);
    expect(m.second_parity_served).toBe(2);
  });

  it('leaves ratios empty rather than dividing by zero', () => {
    const m = computeFarrowingMetrics([], [], [], '2026-03-31');
    expect(m.farrowing_rate_pct).toBeNull();
    expect(m.total_born_per_sow).toBeNull();
    expect(m.litter_mass_total_kg).toBeNull();
  });

  it('dates', () => {
    expect(weekStart('2026-03-29')).toBe('2026-03-23'); // a Sunday belongs to the week before
    expect(weekStart('2026-03-30')).toBe('2026-03-30');
    expect(minusOneYear('2026-03-31')).toBe('2025-03-31');
    expect(minusOneYear('2028-02-29')).toBe('2027-02-28');
  });

  it('reads targets from lifecycle KPI rows, a farm row first, and "not available" otherwise', () => {
    const t = targetsFromLifecycle(
      [
        { farm_id: null, kpi_thresholds: [{ metric: 'FARROWING_RATE', lower_limit: 80, upper_limit: 95 }, { metric: 'TOTAL_BORN', lower_limit: 13 }] },
        { farm_id: 'FARM', kpi_thresholds: JSON.stringify([{ metric: 'FARROWING_RATE', lower_limit: 85, upper_limit: null }]) },
      ],
      'FARM',
    );
    expect(t.farrowing_rate).toEqual({ average: null, lower: 85, upper: null });
    expect(t.total_born).toEqual({ average: null, lower: 13, upper: null });
    expect(t.mummified).toBeNull();
    expect(commonTargets([t, t]).farrowing_rate).toEqual({ average: null, lower: 85, upper: null });
    expect(commonTargets([t, targetsFromLifecycle([], 'FARM')]).farrowing_rate).toBeNull();
  });
});

describe('targets from Average Value and Tolerance', () => {
  it('reads the band the KPIs & Alerts form records, the way the data-entry alerts do', () => {
    const t = targetsFromLifecycle(
      [
        {
          farm_id: null,
          kpi_thresholds: [
            { metric: 'TOTAL_BORN', average_value: 14, tolerance_pct: 10 }, // both sides: 12.6–15.4
            { metric: 'BORN_DEAD', average_value: 1, tolerance_pct: 50, tolerance_type: 'UPPER' }, // at most 1.5
            { metric: 'FARROWING_RATE', average_value: 88, tolerance_pct: 5, tolerance_type: 'LOWER' }, // at least 83.6
            { metric: 'GILT_SERVICE_TARGET', average_value: 4 }, // the average alone
            { metric: 'SECOND_PARITY_SERVICE_TARGET', average_value: 3, tolerance_pct: 0 },
          ],
        },
      ],
      'FARM',
    );
    expect(t.total_born).toEqual({ average: 14, lower: 12.6, upper: 15.4 });
    expect(t.born_dead).toEqual({ average: 1, lower: null, upper: 1.5 });
    expect(t.farrowing_rate).toEqual({ average: 88, lower: 83.6, upper: null });
    expect(t.gilt_service_target).toEqual({ average: 4, lower: null, upper: null });
    expect(t.second_parity_service_target).toEqual({ average: 3, lower: 3, upper: 3 });
  });
});

describe('matchPriorBatch', () => {
  const { matchPriorBatch } = jest.requireActual('./farrowing-report.metrics');
  const last = [
    { batch_id: 'B-2025-W10', first_service: '2025-03-03' },
    { batch_id: 'B-2025-W11', first_service: '2025-03-12' },
    { batch_id: 'B-2025-W20', first_service: '2025-05-12' },
  ];
  it('takes the batch served nearest the same date a year earlier', () => {
    expect(matchPriorBatch('2026-03-04', last)).toBe('B-2025-W10');
    expect(matchPriorBatch('2026-03-10', last)).toBe('B-2025-W11');
  });
  it('finds none outside a week either side, or without a first service', () => {
    expect(matchPriorBatch('2026-04-15', last)).toBeNull();
    expect(matchPriorBatch(null, last)).toBeNull();
  });
});

describe('weaning columns', () => {
  const weaned = (over: Partial<WeanedRow>): WeanedRow => ({
    batch_id: 'B1',
    sow_animal_id: 'S1',
    parity_number: 1,
    farrowing_date: '2026-03-01',
    weaning_date: '2026-03-28',
    piglets_weaned: 0,
    ...over,
  });
  const w = (animal_id: string, stage_code: SowWeightRow['stage_code'], entry_date: string, weight_kg: number): SowWeightRow => ({
    animal_id,
    stage_code,
    entry_date,
    weight_kg,
  });

  it('weans per sow: piglets weaned over the litters weaned in the dates', () => {
    const m = computeFarrowingMetrics([], [], [], '2026-03-31', {
      weaned: [weaned({ piglets_weaned: 11 }), weaned({ sow_animal_id: 'S2', piglets_weaned: 10, parity_number: 3 })],
      weights: [],
    });
    expect(m.sows_weaned).toBe(2);
    expect(m.wean_per_sow).toBe(10.5);
    expect(computeFarrowingMetrics([], [], [], '2026-03-31').wean_per_sow).toBeNull();
  });

  it("gilt body loss: the latest gestation weight before farrowing against the latest lactation weight by weaning", () => {
    const m = computeFarrowingMetrics([], [], [], '2026-03-31', {
      weaned: [
        weaned({ sow_animal_id: 'G1' }),
        weaned({ sow_animal_id: 'G2' }),
        weaned({ sow_animal_id: 'G3' }), // no lactation weight: left out
        weaned({ sow_animal_id: 'S4', parity_number: 2 }), // not a gilt: left out
      ],
      weights: [
        w('G1', 'GESTATION', '2026-01-10', 150),
        w('G1', 'GESTATION', '2026-02-25', 200), // latest before farrowing
        w('G1', 'GESTATION', '2026-03-02', 999), // after farrowing: ignored
        w('G1', 'LACTATION', '2026-03-10', 190),
        w('G1', 'LACTATION', '2026-03-27', 180), // latest by weaning: 10% loss
        w('G1', 'LACTATION', '2026-03-29', 1), // after weaning: ignored
        w('G2', 'GESTATION', '2026-02-20', 160),
        w('G2', 'LACTATION', '2026-03-28', 152), // on the weaning day: 5% loss
        w('G3', 'GESTATION', '2026-02-20', 170),
        w('S4', 'GESTATION', '2026-02-20', 250),
        w('S4', 'LACTATION', '2026-03-20', 200),
      ],
    });
    expect(m.gilt_body_loss_pct).toBe(7.5);
  });

  it('gilt body loss is empty when no gilt has both weights', () => {
    const m = computeFarrowingMetrics([], [], [], '2026-03-31', {
      weaned: [weaned({ sow_animal_id: 'G1' })],
      weights: [w('G1', 'GESTATION', '2026-02-20', 160)],
    });
    expect(m.gilt_body_loss_pct).toBeNull();
  });

  it('a batch that only weaned in the dates still has something recorded', () => {
    const m = computeFarrowingMetrics([], [], [], '2026-03-31', { weaned: [weaned({ piglets_weaned: 9 })], weights: [] });
    expect(isEmptyPeriod(m)).toBe(false);
    expect(isEmptyPeriod(computeFarrowingMetrics([], [], [], '2026-03-31'))).toBe(true);
  });
});
