import {
  computeMonthlyOps,
  monthDays,
  OpsFarrowing,
  OpsService,
  OpsSow,
} from './monthly-ops.metrics';

const month = { startDate: '2026-09-27', endDate: '2026-10-24' }; // October: 28 days
const litter = (over: Partial<OpsFarrowing>): OpsFarrowing => ({
  sow_animal_id: 's1',
  breeding_id: null,
  farrowing_date: '2026-10-01',
  piglets_born_total: 14,
  piglets_born_live: 13,
  weaning_date: null,
  piglets_weaned: 0,
  avg_weaning_weight_kg: null,
  ...over,
});
const service = (over: Partial<OpsService>): OpsService => ({
  breeding_id: 'b1',
  sow_animal_id: 's1',
  mating_date: '2026-06-01',
  expected_farrowing_date: null,
  conception_result: null,
  ...over,
});
const sow = (over: Partial<OpsSow>): OpsSow => ({
  animal_id: 's1',
  entry_date: '2025-01-01',
  exit_date: null,
  cull_date: null,
  ...over,
});
const run = (over: Partial<Parameters<typeof computeMonthlyOps>[0]>) =>
  computeMonthlyOps({
    month,
    gestationDays: 115,
    farrowings: [],
    services: [],
    sows: [],
    sales: [],
    deaths: [],
    ...over,
  });

describe('R12 Monthly Ops — one farm, one accounting month, one breed', () => {
  it('counts the month as its own days, start and end included', () => {
    expect(monthDays(month)).toBe(28);
  });

  it('totals the piglets of litters farrowed in the month, not of those outside it', () => {
    const m = run({
      farrowings: [
        litter({}),
        litter({ farrowing_date: '2026-10-24' }),
        litter({ farrowing_date: '2026-10-25' }),
      ],
    });
    expect(m).toMatchObject({
      litters_farrowed: 2,
      total_born: 28,
      born_alive: 26,
    });
  });

  it('rates farrowing as the share of services one gestation earlier that farrowed, the same sows', () => {
    // 27 Sep − 115 = 4 Jun; 24 Oct − 115 = 1 Jul: b1 and b2 are in the window, b3 and b4 are not.
    const services = [
      service({ mating_date: '2026-06-04' }),
      service({ breeding_id: 'b2', mating_date: '2026-07-01' }),
      service({ breeding_id: 'b3', mating_date: '2026-07-02' }),
      service({ breeding_id: 'b4', mating_date: '2026-06-03' }),
    ];
    // b1 farrowed; b4's litter falls in the month but its service is outside the window, so it is not counted.
    const m = run({
      services,
      farrowings: [
        litter({ breeding_id: 'b1' }),
        litter({ breeding_id: 'b4', sow_animal_id: 's4' }),
      ],
    });
    expect(m).toMatchObject({
      sows_served_one_gestation_earlier: 2,
      services_farrowed: 1,
      farrowing_rate_pct: 50,
    });
  });

  it('reads weaning weight and litter mass from litters weaned in the month', () => {
    const m = run({
      farrowings: [
        litter({
          weaning_date: '2026-10-10',
          piglets_weaned: 10,
          avg_weaning_weight_kg: 6,
        }),
        litter({
          weaning_date: '2026-10-11',
          piglets_weaned: 10,
          avg_weaning_weight_kg: 8,
        }),
      ],
    });
    expect(m).toMatchObject({
      avg_wean_weight_kg: 7,
      total_litter_mass_kg: 140,
      litters_weaned: 2,
    });
  });

  // Rishi, 2 Nov: Empty Days and Cull are two columns. Empty Days is the total of the days in the month that sows were
  // not productive after farrowing: from weaning (or a failed service's pregnancy check) to the next service.
  it('counts the sows culled in the month on their own', () => {
    const m = run({
      sows: [
        sow({
          animal_id: 's1',
          cull_date: '2026-10-20',
          exit_date: '2026-10-20',
        }),
        sow({
          animal_id: 's2',
          cull_date: '2026-11-01',
          exit_date: '2026-11-01',
        }),
      ],
    });
    expect(m.sows_culled).toBe(1);
  });

  it('totals the empty days from weaning to the next service, inside the month only', () => {
    const m = run({
      sows: [sow({ animal_id: 's1' }), sow({ animal_id: 's2' })],
      farrowings: [
        litter({
          sow_animal_id: 's1',
          farrowing_date: '2026-09-01',
          weaning_date: '2026-10-01',
        }), // served 6 Oct: 5 days
        litter({
          sow_animal_id: 's2',
          farrowing_date: '2026-08-20',
          weaning_date: '2026-09-20',
        }), // served 2 Oct: 27 Sep-1 Oct, 5 days
      ],
      services: [
        service({
          sow_animal_id: 's1',
          breeding_id: 'b1',
          mating_date: '2026-10-06',
        }),
        service({
          sow_animal_id: 's2',
          breeding_id: 'b2',
          mating_date: '2026-10-02',
        }),
      ],
    });
    expect(m).toMatchObject({ empty_days: 10, empty_sows: 2 });
  });

  it('runs on to the month end while she waits, and stops when she is culled', () => {
    const m = run({
      sows: [
        sow({ animal_id: 's1' }),
        sow({
          animal_id: 's2',
          cull_date: '2026-10-15',
          exit_date: '2026-10-15',
        }),
      ],
      farrowings: [
        litter({
          sow_animal_id: 's1',
          farrowing_date: '2026-09-01',
          weaning_date: '2026-10-20',
        }), // 20-24 Oct: 5 days
        litter({
          sow_animal_id: 's2',
          farrowing_date: '2026-09-01',
          weaning_date: '2026-10-10',
        }), // 10-14 Oct: 5 days
      ],
    });
    expect(m).toMatchObject({ empty_days: 10, empty_sows: 2, sows_culled: 1 });
  });

  it("makes a sow empty again from a failed service's pregnancy check until she is served again", () => {
    const m = run({
      sows: [sow({ animal_id: 's1' })],
      farrowings: [
        litter({
          sow_animal_id: 's1',
          farrowing_date: '2026-07-01',
          weaning_date: '2026-08-01',
        }),
      ],
      services: [
        service({
          sow_animal_id: 's1',
          breeding_id: 'b1',
          mating_date: '2026-08-05',
          conception_result: 'REPEAT',
          preg_check_date: '2026-10-03',
        }),
        service({
          sow_animal_id: 's1',
          breeding_id: 'b2',
          mating_date: '2026-10-12',
        }),
      ],
    });
    expect(m).toMatchObject({ empty_days: 9, empty_sows: 1 }); // 3-11 Oct
  });

  it('leaves out a gilt that has not farrowed, and days she is pregnant or lactating', () => {
    const m = run({
      sows: [sow({ animal_id: 'g1' }), sow({ animal_id: 's1' })],
      services: [
        service({
          sow_animal_id: 'g1',
          breeding_id: 'g',
          mating_date: '2026-09-01',
          conception_result: 'REPEAT',
          preg_check_date: '2026-09-29',
        }),
      ],
      farrowings: [
        litter({
          sow_animal_id: 's1',
          farrowing_date: '2026-10-01',
          weaning_date: null,
        }),
      ],
    });
    expect(m).toMatchObject({ empty_days: 0, empty_sows: 0 });
  });

  it('counts CDM as Colcom kg only, and scales kg sold per average sow to a year', () => {
    const sows = [sow({ animal_id: 's1' }), sow({ animal_id: 's2' })];
    const m = run({
      sows,
      sales: [
        { disposal_date: '2026-10-01', exit_weight_kg: 100, is_colcom: true },
        { disposal_date: '2026-10-02', exit_weight_kg: 40, is_colcom: false },
        { disposal_date: '2026-10-30', exit_weight_kg: 999, is_colcom: true },
      ],
    });
    expect(m).toMatchObject({ cdm_kg: 100, kg_sold: 140, average_sows: 2 });
    expect(m.kg_sold_per_sow_year).toBe(
      Number(((140 / 2) * (365 / 28)).toFixed(2)),
    );
  });

  it('counts standovers among sows due in the month, leaving out failed services', () => {
    const services = [
      service({ breeding_id: 'b1', expected_farrowing_date: '2026-10-05' }),
      service({ breeding_id: 'b2', expected_farrowing_date: '2026-10-06' }),
      service({
        breeding_id: 'b3',
        expected_farrowing_date: '2026-10-07',
        conception_result: 'FAILED',
      }),
    ];
    const m = run({ services, farrowings: [litter({ breeding_id: 'b1' })] });
    expect(m).toMatchObject({ sows_due: 2, standovers: 1, standovers_pct: 50 });
  });

  it("groups the month's deaths by category with shares, an unrecorded cause on its own", () => {
    const m = run({
      deaths: [
        { transaction_date: '2026-10-01', quantity: 3, category: 'TRAUMA' },
        { transaction_date: '2026-10-02', quantity: 1, category: null },
        { transaction_date: '2026-11-01', quantity: 9, category: 'TRAUMA' },
      ],
    });
    expect(m.mortality_total).toBe(4);
    expect(m.mortality_by_category).toEqual([
      { category: 'TRAUMA', deaths: 3, share_pct: 75 },
      { category: 'NOT RECORDED', deaths: 1, share_pct: 25 },
    ]);
  });

  it("bands parity on the month's last day by litters farrowed by then, leaving out sows already gone", () => {
    const sows = [
      sow({ animal_id: 'g' }),
      sow({ animal_id: 's1' }),
      sow({ animal_id: 'old' }),
      sow({ animal_id: 'gone', exit_date: '2026-10-01' }),
    ];
    const farrowings = [
      litter({ sow_animal_id: 's1' }),
      litter({ sow_animal_id: 's1', farrowing_date: '2026-10-30' }),
      ...Array.from({ length: 7 }, (_, i) =>
        litter({
          sow_animal_id: 'old',
          farrowing_date: `202${i % 5}-01-0${i + 1}`,
        }),
      ),
    ];
    const m = run({ sows, farrowings });
    expect(m.sows_on_last_day).toBe(3);
    expect(m.parity_distribution.find((p) => p.parity === '0')).toMatchObject({
      sows: 1,
    });
    expect(m.parity_distribution.find((p) => p.parity === '1')).toMatchObject({
      sows: 1,
    });
    expect(m.parity_distribution.find((p) => p.parity === '6+')).toMatchObject({
      sows: 1,
    });
  });
});
