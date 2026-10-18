import { commonTargets, computeFarrowingMetrics, FarrowingRow, minusOneYear, targetsFromLifecycle, weekStart } from './farrowing-report.metrics';

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
    expect(t.farrowing_rate).toEqual({ lower: 85, upper: null });
    expect(t.total_born).toEqual({ lower: 13, upper: null });
    expect(t.mummified).toBeNull();
    expect(commonTargets([t, t]).farrowing_rate).toEqual({ lower: 85, upper: null });
    expect(commonTargets([t, targetsFromLifecycle([], 'FARM')]).farrowing_rate).toBeNull();
  });
});
