import {
  alertsFrom, breedingFigures, farmAlerts, farmRow, farmWindows, kgSoldPerSowYear, meanTarget, ragStatus, stageExit, stageFigures, stageSegments,
} from './gm-dashboard.metrics';
import type { OpsMetrics } from '../reports/monthly-ops.metrics';

const target = (average: number | null, lower: number | null = null, upper: number | null = null) => ({ average, lower, upper });

// Rishi, 2 Nov: green at or better than target; amber within tolerance, else within 10 %; red beyond.
describe('ragStatus', () => {
  it('uses 10 % when the target has no tolerance', () => {
    expect(ragStatus(92, target(90), false)).toBe('GREEN');
    expect(ragStatus(81, target(90), false)).toBe('AMBER');
    expect(ragStatus(80, target(90), false)).toBe('RED');
  });

  it('turns the band round when lower is better', () => {
    expect(ragStatus(2.3, target(2.4), true)).toBe('GREEN');
    expect(ragStatus(2.6, target(2.4), true)).toBe('AMBER');
    expect(ragStatus(2.7, target(2.4), true)).toBe('RED');
  });

  it("uses the KPI's own tolerance band on the bad side when it has one", () => {
    expect(ragStatus(85, target(90, 85, 95), false)).toBe('AMBER');
    expect(ragStatus(84, target(90, 85, 95), false)).toBe('RED');
    expect(ragStatus(8.5, target(8, 7, 8.4), true)).toBe('RED');
  });

  it('gives no status without a value or a target', () => {
    expect(ragStatus(null, target(90), false)).toBeNull();
    expect(ragStatus(90, null, false)).toBeNull();
  });
});

describe('meanTarget', () => {
  it('averages the targets present and ignores missing ones', () => {
    expect(meanTarget([target(10), null, target(12, 11)])).toEqual({ average: 11, lower: 11, upper: null });
    expect(meanTarget([null, undefined])).toBeNull();
  });
});

const ops = (over: Partial<OpsMetrics>): OpsMetrics => ({
  empty_days: 0, empty_sows: 0, sows_culled: 0, total_born: 0, born_alive: 0, litters_farrowed: 0,
  sows_served_one_gestation_earlier: 0, services_farrowed: 0, farrowing_rate_pct: null, avg_wean_weight_kg: null,
  total_litter_mass_kg: null, litters_weaned: 0, weaned_piglets: 0, weaned_start_lot: 0, litters_weighed: 0, weighed_head: 0,
  cdm_kg: 0, kg_sold: 0, average_sows: null, kg_sold_per_sow_year: null, sows_due: 0, standovers: 0, standovers_pct: null,
  mortality_total: 0, mortality_by_category: [], sows_on_last_day: 0, parity_distribution: [], ...over,
});

describe('breedingFigures', () => {
  it("sums the farm's breeds before dividing", () => {
    const f = breedingFigures([
      ops({ services_farrowed: 9, sows_served_one_gestation_earlier: 10, total_born: 34, born_alive: 32, litters_farrowed: 2,
        weaned_piglets: 26, weaned_start_lot: 30, litters_weaned: 2, total_litter_mass_kg: 195, weighed_head: 26, litters_weighed: 2 }),
      ops({ services_farrowed: 9, sows_served_one_gestation_earlier: 10, total_born: 16, born_alive: 13, litters_farrowed: 1,
        weaned_piglets: 14, weaned_start_lot: 15, litters_weaned: 1, total_litter_mass_kg: 105, weighed_head: 14, litters_weighed: 1 }),
    ]);
    expect(f).toEqual({
      farrowing_rate_pct: 90, total_born_per_litter: 16.67, born_alive_per_litter: 15,
      pre_wean_mortality_pct: 11.11, weaned_per_sow: 13.33, avg_wean_weight_kg: 7.5, litter_mass_kg: 100,
    });
  });

  it('is null where nothing happened', () => {
    expect(breedingFigures([ops({})]).farrowing_rate_pct).toBeNull();
    expect(breedingFigures([]).total_born_per_litter).toBeNull();
  });
});

describe('kgSoldPerSowYear', () => {
  it('is kg sold ÷ average sows × 365 ÷ days', () => {
    expect(kgSoldPerSowYear([ops({ kg_sold: 7300, average_sows: 100 }), ops({ kg_sold: 0, average_sows: 0 })], 28)).toBe(951.61);
    expect(kgSoldPerSowYear([ops({ kg_sold: 100 })], 28)).toBeNull();
  });
});

describe('stageSegments', () => {
  const batch = {
    batch_id: 'b', start_date: '2026-07-20', end_date: null, current_stage_code: 'GROWER',
    moves: [
      { from: 'DOUBLE_STOCK', to: 'GROWER', date: '2026-10-24' },
      { from: 'LACTATION', to: 'WEANER', date: '2026-08-15' },
      { from: 'WEANER', to: 'DOUBLE_STOCK', date: '2026-09-26' },
    ],
  };

  it('reads the spells from the stage log', () => {
    expect(stageSegments(batch, 'WEANER')).toEqual([{ start: '2026-08-15', exit: '2026-09-26' }]);
    expect(stageSegments(batch, 'GROWER')).toEqual([{ start: '2026-10-24', exit: null }]);
    expect(stageSegments(batch, 'LACTATION')).toEqual([{ start: '2026-07-20', exit: '2026-08-15' }]);
  });

  it('gives a batch with no log one spell in its stage, ending when it closed', () => {
    expect(stageSegments({ ...batch, moves: [], end_date: '2025-06-01' }, 'GROWER')).toEqual([{ start: '2026-07-20', exit: '2025-06-01' }]);
  });
});

describe('stageExit and stageFigures', () => {
  const none = { weight: null, fcr: null, mortality: null };
  const spell = stageExit({
    segment: { start: '2026-08-15', exit: '2026-09-26' },
    opening: 13,
    deaths: [{ date: '2026-08-01', quantity: 1 }, { date: '2026-08-20', quantity: 2 }, { date: '2026-09-26', quantity: 5 }],
    moves: [{ date: '2026-08-15', heads: 88 }, { date: '2026-09-01', heads: 10 }, { date: '2026-09-10', heads: -4 }],
    feed: [{ date: '2026-08-14', quantity: 50 }, { date: '2026-08-15', quantity: 100 }, { date: '2026-09-25', quantity: 900 }, { date: '2026-09-26', quantity: 70 }],
    weights: [{ date: '2026-08-10', quantity: 7.6 }, { date: '2026-09-20', quantity: 27 }, { date: '2026-09-26', quantity: 28 }, { date: '2026-09-28', quantity: 46 }],
    entryWeight: 7.5,
    targets: none,
  });

  it('counts heads, deaths, feed and weight inside the spell only', () => {
    // in: 13 − 1 death before + 88 moved in on the day = 100, plus 10 moved in later; out: 110 − 2 dead − 4 moved out.
    expect(spell).toMatchObject({ heads_in: 110, heads_out: 104, deaths: 2, feed_kg: 1000, entry_weight_kg: 7.5, exit_weight_kg: 28 });
  });

  it('weighs exit weight and gain by heads out, FCE as feed over live weight gained, mortality over heads in', () => {
    const other = { ...spell, heads_in: 50, heads_out: 50, deaths: 0, feed_kg: 2000, entry_weight_kg: 8, exit_weight_kg: 30 };
    const f = stageFigures([spell, other]);
    expect(f.exits).toBe(2);
    expect(f.exit_weight_kg).toBe(Number(((104 * 28 + 50 * 30) / 154).toFixed(2)));
    expect(f.gain_kg).toBe(Number(((104 * 20.5 + 50 * 22) / 154).toFixed(2)));
    expect(f.fce).toBe(Number((3000 / (104 * 28 - 110 * 7.5 + 50 * 30 - 50 * 8)).toFixed(2)));
    expect(f.mortality_pct).toBe(Number(((2 / 160) * 100).toFixed(2)));
  });

  it('has no figures without spells', () => {
    expect(stageFigures([])).toEqual({ exits: 0, exit_weight_kg: null, gain_kg: null, fce: null, mortality_pct: null });
  });
});

describe('alertsFrom', () => {
  it('lists red then amber cells, with farm and target', () => {
    const farms = [{ farm_id: 'a', farm_name: 'GRASMERE' }, { farm_id: 'b', farm_name: 'PORTA' }];
    const rows = [
      { key: 'x', label: 'Farrowing Rate', unit: '%', lower_is_better: false, cells: {
        a: { value: 85, target: 90, status: 'AMBER' as const }, b: { value: 95, target: 90, status: 'GREEN' as const } } },
      { key: 'y', label: 'FCE Grower', unit: '', lower_is_better: true, cells: {
        a: { value: null, target: 2.4, status: null }, b: { value: 2.9, target: 2.4, status: 'RED' as const } } },
    ];
    expect(alertsFrom(rows, farms)).toEqual([
      { farm_id: 'b', farm_name: 'PORTA', metric: 'FCE Grower', unit: '', value: 2.9, target: 2.4, status: 'RED' },
      { farm_id: 'a', farm_name: 'GRASMERE', metric: 'Farrowing Rate', unit: '%', value: 85, target: 90, status: 'AMBER' },
    ]);
  });
});

// Rishi, 2 Nov: one farm shows This Week, Weekly Avg (4 wks), This Month, Prev. Month and 3 Months, and a trend.
describe('farmWindows', () => {
  const period = { start_date: '2026-09-27' };
  const previous = [{ start_date: '2026-08-23', end_date: '2026-09-26' }, { start_date: '2026-07-26', end_date: '2026-08-22' }];

  it('ends every column on the period end, with the reporting periods for the months', () => {
    const w = farmWindows('2026-10-24', period, previous);
    expect(w.slice(0, 5)).toEqual([
      { key: 'this_week', startDate: '2026-10-18', endDate: '2026-10-24' },
      { key: 'avg_4w', startDate: '2026-09-27', endDate: '2026-10-24' },
      { key: 'this_month', startDate: '2026-09-27', endDate: '2026-10-24' },
      { key: 'prev_month', startDate: '2026-08-23', endDate: '2026-09-26' },
      { key: 'three_month', startDate: '2026-07-26', endDate: '2026-10-24' },
    ]);
    expect(w.slice(5).map((x) => x.key)).toEqual(['week_0', 'week_1', 'week_2', 'week_3', 'week_4', 'week_5']);
    expect(w[10]).toEqual({ key: 'week_5', startDate: '2026-09-13', endDate: '2026-09-19' });
  });

  it('has no previous month for the first period, and starts 3 months at the earliest it has', () => {
    const w = farmWindows('2026-10-24', period, []);
    expect(w.find((x) => x.key === 'prev_month')).toBeUndefined();
    expect(w.find((x) => x.key === 'three_month')?.startDate).toBe('2026-09-27');
  });
});

describe('farmRow and farmAlerts', () => {
  const values: Record<string, number | null> = {
    this_week: 80, avg_4w: 85, this_month: 86, prev_month: 88, three_month: 87,
    week_0: 80, week_1: 84, week_2: null, week_3: 90, week_4: 91, week_5: 92,
  };
  const has = (k: string) => k !== 'prev_month';
  const row = farmRow({ key: 'fr', label: 'Farrowing Rate', unit: '%', lower: false }, (k) => values[k] ?? null, target(90), has);

  it('shows each column, null where the window does not exist, the trend oldest first, and This Week\'s status', () => {
    expect(row.values).toEqual({ this_week: 80, avg_4w: 85, this_month: 86, prev_month: null, three_month: 87 });
    expect(row.trend).toEqual([92, 91, 90, null, 84, 80]);
    expect(row).toMatchObject({ target: 90, status: 'RED' });
  });

  it('lists red, amber, then on-target rows, skipping those with no value or target', () => {
    const fce = farmRow({ key: 'fce', label: 'FCE Grower', unit: '', lower: true }, (k) => (k === 'this_week' ? 2.5 : null), target(2.4), has);
    const ok = farmRow({ key: 'm', label: 'Grower Mortality', unit: '%', lower: true }, (k) => (k === 'this_week' ? 1.8 : null), target(2), has);
    const none = farmRow({ key: 'g', label: '70 Day Gain', unit: 'kg', lower: false }, () => 21, null, has);
    expect(farmAlerts([ok, none, fce, row])).toEqual([
      { metric: 'Farrowing Rate', unit: '%', value: 80, target: 90, status: 'RED', above: false },
      { metric: 'FCE Grower', unit: '', value: 2.5, target: 2.4, status: 'AMBER', above: true },
      { metric: 'Grower Mortality', unit: '%', value: 1.8, target: 2, status: 'GREEN', above: false },
    ]);
  });
});
