import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import PiggeryGmDashboard from '../src/components/console/piggery/piggery-gm-dashboard';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: () => 'co-1' }));
jest.mock('../src/hooks/useCompanyCurrency', () => ({
  useCompanyCurrency: () => ({ currency: { iso_code: 'USD' }, ready: true }),
}));
jest.mock('../src/hooks/useLanguage', () => {
  // A key with its values after it, so a spec can see what a string was built from.
  const t = (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${Object.values(vars).join(' ')}` : key;
  return { useLanguage: () => ({ t }) };
});
// The chart is drawn by recharts, which draws nothing in jsdom: the spec reads the points the screen hands it.
const chartProps: Array<{ title: string; points: any[] }> = [];
jest.mock('../src/components/console/piggery/gm-dashboard-widgets', () => {
  const actual = jest.requireActual(
    '../src/components/console/piggery/gm-dashboard-widgets',
  );
  const R = jest.requireActual('react');
  return {
    ...actual,
    ProgressChart: (props: any) => {
      chartProps.push({ title: props.title, points: props.points });
      return R.createElement(actual.ProgressChart, props);
    },
  };
});

const get = api.get as jest.Mock;
const periods = [
  {
    period_id: 'p10',
    period_code: '2026-10',
    business_year: '2026-27',
    start_date: '2026-09-27',
    end_date: '2026-10-24',
  },
  {
    period_id: 'p11',
    period_code: '2026-11',
    business_year: '2026-27',
    start_date: '2026-10-25',
    end_date: '2026-11-21',
  },
];
const farms = [
  { farm_id: 'g', farm_code: 'MUL100', farm_name: 'GRASMERE' },
  { farm_id: 'p', farm_code: 'POR100', farm_name: 'PORTA' },
];
const response = (periodId: string, farmId?: string) => ({
  data: {
    period: {
      ...periods.find((p) => p.period_id === periodId)!,
      ytd_from: '2026-06-28',
      to: '2026-10-24',
    },
    periods,
    farms: farmId ? farms.filter((f) => f.farm_id === farmId) : farms,
    kg_sold_per_sow_year: {
      month: { g: 2900, p: 3100, all: 3000 },
      ytd: { g: 2800, p: 3000, all: 2950 },
    },
    breeding: [
      {
        key: 'farrowing_rate_pct',
        label: 'Farrowing Rate',
        unit: '%',
        lower_is_better: false,
        cells: {
          g: { value: 57.14, target: 90, status: 'RED' },
          p: { value: null, target: 92, status: null },
        },
      },
    ],
    weaner_grower: [
      {
        key: 'gain_70_day',
        label: '70 Day Gain',
        unit: 'kg',
        lower_is_better: false,
        cells: {
          g: { value: 21.9, target: null, status: null },
          p: { value: null, target: null, status: null },
        },
      },
    ],
    alerts: [
      {
        farm_id: 'g',
        farm_name: 'GRASMERE',
        metric: 'Farrowing Rate',
        unit: '%',
        value: 57.14,
        target: 90,
        status: 'RED',
      },
    ],
    farm_view: farmId
      ? {
          farm: farms.find((f) => f.farm_id === farmId),
          sows: 65,
          kg_sold_per_sow_year_ytd: 2950,
          breeding: [
            {
              key: 'farrowing_rate_pct',
              label: 'Farrowing Rate',
              unit: '%',
              lower_is_better: false,
              target: 90,
              status: 'GREEN',
              values: {
                this_week: 100,
                avg_4w: 57.14,
                this_month: 57.14,
                prev_month: 100,
                three_month: 91.84,
              },
              trend: [100, 100, 100, 50, 0, 100],
            },
          ],
          weaner_grower: [
            {
              key: 'fce_grower',
              label: 'FCE Grower',
              unit: '',
              lower_is_better: true,
              target: 2.4,
              status: 'RED',
              values: {
                this_week: 3.65,
                avg_4w: 5.19,
                this_month: 5.19,
                prev_month: 2.15,
                three_month: 3.7,
              },
              trend: [4.2, null, null, 3.43, null, 3.65],
            },
          ],
          alerts: [
            {
              metric: 'FCE Grower',
              unit: '',
              value: 3.65,
              target: 2.4,
              status: 'RED',
              above: true,
            },
            {
              metric: 'Farrowing Rate',
              unit: '%',
              value: 100,
              target: 90,
              status: 'GREEN',
              above: true,
            },
          ],
        }
      : null,
  },
});

beforeEach(() => {
  chartProps.length = 0;
  get.mockReset().mockImplementation(async (url: string) => {
    const q = new URLSearchParams(url.split('?')[1]);
    return response(q.get('periodId') ?? 'p10', q.get('farmId') ?? undefined);
  });
});

// Rishi, 2 Nov: the GM Dashboard opens on the period holding today, from the Reporting Period master.
describe('GM Dashboard', () => {
  it('opens on the period the API chose and shows the month and YTD dates', async () => {
    render(<PiggeryGmDashboard />);
    expect(
      await screen.findByRole('region', { name: 'gmdBreedingMatrix' }),
    ).toBeTruthy();
    expect(get.mock.calls[0][0]).not.toContain('periodId');
    expect(
      screen.getByRole('button', { name: 'gmdPeriod' }).textContent,
    ).toContain('2026-10 (2026-27)');
    expect(screen.getByTestId('gmd-dates').textContent).toContain(
      '27 Sept 2026',
    );
  });

  it('shows each farm as a column of status dots, with value and target on hover, and the alerts', async () => {
    render(<PiggeryGmDashboard />);
    const table = await screen.findByRole('region', {
      name: 'gmdBreedingMatrix',
    });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['gmdMetric', 'GRASMERE', 'PORTA']);
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole(
      'cell',
    );
    expect(
      cells[1].querySelector('[data-status]')?.getAttribute('data-status'),
    ).toBe('RED');
    expect(cells[1].getAttribute('title')).toBe(
      'GRASMERE — Farrowing Rate: 57.14% · gmdTarget 90%',
    );
    expect(cells[2].getAttribute('title')).toContain('N/A');
    // Kg Meat Sold / Sow / Year closes the matrix, with no target.
    const kgRow = within(table).getAllByRole('row').at(-1)!;
    expect(kgRow.textContent).toContain('gmdKgSoldPerSowYear');
    expect(
      within(kgRow).getAllByRole('cell')[1].getAttribute('title'),
    ).toContain('2,900 kg · gmdNoTarget');
    const alerts = screen.getByRole('region', { name: 'gmdAlerts' });
    expect(alerts.textContent).toContain(
      'Farrowing Rate gmdBelowTarget — GRASMERE',
    );
  });

  it('lays out the phase 2 cards, matrix and charts with no data yet', async () => {
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    const kpis = screen.getByTestId('gmd-kpis');
    expect(
      within(kpis)
        .getAllByRole('region')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual([
      'gmdPigsToSlaughter',
      'gmdAvgCdm',
      'gmdCostOfSales',
      'gmdGrossMargin',
      'gmdOtherOverheads',
    ]);
    expect(within(kpis).getAllByText('gmdNoDataYet')).toHaveLength(5);
    const financial = screen.getByRole('region', {
      name: 'gmdFinancialMatrix',
    });
    expect(within(financial).getAllByRole('row')).toHaveLength(9);
    expect(financial.querySelectorAll('[data-status="NONE"]')).toHaveLength(16);
    expect(
      screen.getByRole('region', { name: 'gmdPigsToSlaughterProgress' }),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'gmdPbtProgress' })).toBeTruthy();
    expect(screen.getByTestId('gmd-kg-value').textContent).toBe('3,000');
  });

  // Rishi, 16 Nov: Pigs to Slaughter, Cost of Sales and Gross Margin are the ledgers' sold disposals.
  it('fills the sales cards and matrix rows from the ledger figures', async () => {
    const sales = (heads: number, cost: number, revenue: number) => ({
      heads,
      cost_of_sales: cost,
      revenue,
      gross_margin: revenue - cost,
      gross_margin_pct: Math.round(((revenue - cost) / revenue) * 1000) / 10,
    });
    get.mockImplementation(async () => {
      const r = response('p10');
      return {
        data: {
          ...r.data,
          financial: {
            month: {
              all: sales(147, 8000, 36427),
              g: sales(122, 7000, 30232),
              p: sales(25, 1000, 6195),
            },
            ytd: {
              all: sales(500, 30000, 120000),
              g: sales(400, 25000, 100000),
              p: sales(100, 5000, 20000),
            },
            heads_by_period: [{ period_code: '2026-10', heads: 500 }],
          },
        },
      };
    });
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    const pigs = screen.getByRole('region', { name: 'gmdPigsToSlaughter' });
    expect(pigs.textContent).toContain('147');
    expect(pigs.textContent).toContain('500');
    expect(
      within(
        screen.getByRole('region', { name: 'gmdGrossMargin' }),
      ).queryByText('gmdNoDataYet'),
    ).toBeNull();
    const financial = screen.getByRole('region', {
      name: 'gmdFinancialMatrix',
    });
    const pigsRow = within(financial)
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('Pigs to Slaughter'))!;
    expect(
      within(pigsRow).getAllByRole('cell')[1].getAttribute('title'),
    ).toContain('122');
  });

  it('reloads for a chosen farm and keeps every farm in the picker', async () => {
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
    fireEvent.click(await screen.findByRole('option', { name: 'PORTA' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(expect.stringContaining('farmId=p')),
    );
    expect(await screen.findByRole('heading', { name: 'PORTA' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
    expect(
      await screen.findByRole('option', { name: 'GRASMERE' }),
    ).toBeTruthy();
  });
});

// Rishi, 2 Nov: with one farm chosen, the Farm view of the mockup.
describe('GM Dashboard — one farm', () => {
  async function chooseGrasmere() {
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
    fireEvent.click(await screen.findByRole('option', { name: 'GRASMERE' }));
    await screen.findByRole('heading', { name: 'GRASMERE' });
  }

  it('heads the page with the farm and its sows', async () => {
    await chooseGrasmere();
    expect(screen.getByText(/gmdSows/)).toBeTruthy();
  });

  it('shows This Week coloured by its status, the four averages and a six-week trend', async () => {
    await chooseGrasmere();
    const table = screen.getByRole('region', { name: 'gmdBreedingMatrix' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'gmdMetric',
      'gmdThisWeek',
      'gmdWeeklyAvg4w',
      'gmdThisMonthAvg',
      'gmdPrevMonthAvg',
      'gmdThreeMonthAvg',
      'gmdTrend',
    ]);
    const row = within(table).getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells.slice(0, 6).map((c) => c.textContent)).toEqual([
      'Farrowing Rate (%)',
      '100',
      '57.14',
      '57.14',
      '100',
      '91.84',
    ]);
    expect((cells[1] as HTMLElement).style.color).toBe('rgb(47, 158, 95)'); // #2f9e5f
    expect(within(table).getByTestId('trend').children).toHaveLength(6);
    expect(
      screen.getByRole('region', { name: 'gmdFinancialMatrix' }).textContent,
    ).toContain('Pigs to Slaughter');
  });

  it("shows Kg Meat Sold for the year to date and This Week's alerts, misses first and on-target after", async () => {
    await chooseGrasmere();
    expect(
      screen.getByRole('region', { name: 'gmdKgSoldPerSowYearYtd' }),
    ).toBeTruthy();
    expect(screen.getByTestId('gmd-kg-value').textContent).toBe('2,950');
    const items = within(screen.getByRole('region', { name: 'gmdAlerts' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items[0]).toContain('FCE Grower gmdAboveTarget (gmdThisWeek)');
    expect(items[1]).toContain('Farrowing Rate gmdOnTarget (gmdThisWeek)');
  });
});

// Task 7 of the GM Dashboard Budget master: the API's budget, Var and colours reach the screen.
describe('GM Dashboard — budgets', () => {
  const cell = (
    budget: number | null,
    actual: number | null,
    v: number | null,
    pct: number | null,
    status: 'GREEN' | 'AMBER' | 'RED' | null,
    missing: string[] = [],
  ) => ({
    budget,
    tolerance_pct: 5,
    missing,
    actual,
    var: v,
    var_pct: pct,
    status,
  });
  const sales = (heads: number, cost: number, pct: number) => ({
    heads,
    cost_of_sales: cost,
    revenue: 0,
    gross_margin: 0,
    gross_margin_pct: pct,
  });
  const load = async (extra: Record<string, unknown>) => {
    get.mockImplementation(async () => ({
      data: { ...response('p10').data, ...extra },
    }));
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
  };
  const empty = { month: {}, ytd: {}, by_period: [] };

  it('KPI cards show Budget and Var from the API', async () => {
    await load({
      financial: {
        month: { all: sales(4820, 0, 0) },
        ytd: { all: null },
        heads_by_period: [],
      },
      budget: {
        ...empty,
        month: {
          all: { pigs_to_slaughter: cell(4500, 4820, 320, 7.1, 'GREEN') },
        },
      },
    });
    const text = screen.getByRole('region', {
      name: 'gmdPigsToSlaughter',
    }).textContent!;
    expect(text).toContain('4,500');
    expect(text).toContain('+320');
    expect(text).toMatch(/\+7\.1\s?%/);
  });

  it("a percentage metric's Var reads in points", async () => {
    await load({
      financial: {
        month: { all: sales(1, 0, 35.4) },
        ytd: { all: null },
        heads_by_period: [],
      },
      budget: {
        ...empty,
        month: {
          all: { gross_margin_pct: cell(32, 35.4, 3.4, null, 'GREEN') },
        },
      },
    });
    const text = screen.getByRole('region', {
      name: 'gmdGrossMargin',
    }).textContent!;
    expect(text).toContain('32.0%');
    expect(text).toContain('+3.4 pp');
  });

  it('a cost metric under budget reads favourable', async () => {
    await load({
      financial: {
        month: { all: sales(1, 8000, 0) },
        ytd: { all: null },
        heads_by_period: [],
      },
      budget: {
        ...empty,
        month: {
          all: { cost_of_sales: cell(10000, 8000, -2000, -20, 'GREEN') },
        },
      },
    });
    const card = screen.getByRole('region', { name: 'gmdCostOfSales' });
    expect(card.textContent).toContain('-2,000');
    expect(
      within(card).getByLabelText('gmdOnOrBetterThanBudget'),
    ).toBeTruthy();
  });

  it('the arrow says worse than budget, or within tolerance, from the dictionary', async () => {
    await load({
      financial: {
        month: { all: sales(1, 12000, 0) },
        ytd: { all: null },
        heads_by_period: [],
      },
      budget: {
        ...empty,
        month: {
          all: { cost_of_sales: cell(10000, 12000, 2000, 20, 'RED') },
        },
        ytd: {
          all: { cost_of_sales: cell(10000, 10300, 300, 3, 'AMBER') },
        },
      },
    });
    const card = screen.getByRole('region', { name: 'gmdCostOfSales' });
    expect(within(card).getByLabelText('gmdWorseThanBudget')).toBeTruthy();
    expect(
      within(card).getByLabelText('gmdWithinToleranceOfBudget'),
    ).toBeTruthy();
  });

  it('a null budget shows N/A and the hover names the missing farms', async () => {
    await load({
      budget: {
        ...empty,
        month: {
          all: {
            avg_cdm: cell(null, null, null, null, null, ['MUL100', 'POR100']),
          },
        },
      },
    });
    const card = screen.getByRole('region', { name: 'gmdAvgCdm' });
    const hint = card.querySelector('[data-hint]')!;
    expect(hint.textContent).toBe('N/A');
    expect(hint.getAttribute('data-hint')).toContain('gmdNoBudgetFor');
    expect(hint.getAttribute('data-hint')).toContain('GRASMERE');
    expect(hint.getAttribute('data-hint')).toContain('PORTA');
  });

  it('a ratio YTD over a missing period shows the figure and says it is partial', async () => {
    await load({
      budget: {
        ...empty,
        ytd: {
          all: { avg_cdm: cell(92, null, null, null, null, ['2026-02']) },
        },
      },
    });
    const hint = screen
      .getByRole('region', { name: 'gmdAvgCdm' })
      .querySelector('[data-hint]')!;
    expect(hint.textContent).toBe('92');
    expect(hint.getAttribute('data-hint')).toContain('gmdBudgetPartial');
    expect(hint.getAttribute('data-hint')).toContain('2026-02');
  });

  it('the Slaughter & Financial rows take their dot colour from financial_rows', async () => {
    await load({
      financial_rows: [
        {
          key: 'pigs_to_slaughter',
          label: 'Pigs to Slaughter',
          unit: '',
          lower_is_better: false,
          cells: {
            g: { value: 100, target: 120, status: 'RED' },
            p: { value: 130, target: 120, status: 'GREEN' },
          },
        },
      ],
    });
    const table = screen.getByRole('region', { name: 'gmdFinancialMatrix' });
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole(
      'cell',
    );
    expect(
      cells[1].querySelector('[data-status]')?.getAttribute('data-status'),
    ).toBe('RED');
    expect(
      cells[2].querySelector('[data-status]')?.getAttribute('data-status'),
    ).toBe('GREEN');
    // Financial rows are measured against a budget, so the hover says Budget (production rows keep Target).
    expect(cells[1].getAttribute('title')).toContain('gmdBudget 120');
    expect(cells[1].getAttribute('title')).not.toContain('gmdTarget');
  });

  it('the Pigs to Slaughter chart draws the budget line from budget.by_period', async () => {
    await load({
      financial: {
        month: { all: null },
        ytd: { all: null },
        heads_by_period: [{ period_code: '2026-10', heads: 500 }],
      },
      budget: {
        ...empty,
        by_period: [
          { period_code: '2026-10', pigs_to_slaughter: 450, pbt: 10 },
          { period_code: '2026-11', pigs_to_slaughter: 900, pbt: null },
        ],
      },
    });
    const pts = chartProps
      .filter((c) => c.title === 'gmdPigsToSlaughterProgress')
      .at(-1)!.points;
    expect(pts.map((p) => [p.label, p.actual, p.budget])).toEqual([
      ['Oct', 500, 450],
      ['Nov', null, 900],
    ]);
  });

  it('the PBT chart draws only its budget line', async () => {
    await load({
      financial: {
        month: { all: null },
        ytd: { all: null },
        heads_by_period: [{ period_code: '2026-10', heads: 500 }],
      },
      budget: {
        ...empty,
        by_period: [
          { period_code: '2026-10', pigs_to_slaughter: 450, pbt: 10 },
          { period_code: '2026-11', pigs_to_slaughter: 900, pbt: 25 },
        ],
      },
    });
    const pts = chartProps
      .filter((c) => c.title === 'gmdPbtProgress')
      .at(-1)!.points;
    expect(pts.map((p) => [p.actual, p.budget])).toEqual([
      [null, 10],
      [null, 25],
    ]);
  });

  describe('one farm', () => {
    const open = async (extra: Record<string, unknown>) => {
      get.mockImplementation(async (url: string) => {
        const q = new URLSearchParams(url.split('?')[1]);
        const r = response('p10', q.get('farmId') ?? undefined).data;
        return { data: q.get('farmId') ? { ...r, ...extra } : r };
      });
      render(<PiggeryGmDashboard />);
      await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
      fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
      fireEvent.click(await screen.findByRole('option', { name: 'GRASMERE' }));
      await screen.findByRole('heading', { name: 'GRASMERE' });
      const table = screen.getByRole('region', { name: 'gmdFinancialMatrix' });
      return within(table)
        .getAllByRole('row')
        .find((row) => row.textContent?.includes('Pigs to Slaughter'))!;
    };

    it('the financial table takes its budget and dot from financial_rows', async () => {
      const row = await open({
        financial_rows: [
          {
            key: 'pigs_to_slaughter',
            label: 'Pigs to Slaughter',
            unit: '',
            lower_is_better: false,
            cells: { g: { value: 100, target: 120, status: 'RED' } },
          },
        ],
      });
      expect(
        row.querySelector('[data-status]')?.getAttribute('data-status'),
      ).toBe('RED');
      expect(row.innerHTML).toContain('gmdBudget 120');
    });

    it('without financial_rows the financial table has no target and no dot colour', async () => {
      const row = await open({});
      expect(
        row.querySelector('[data-status]')?.getAttribute('data-status'),
      ).toBe('NONE');
      expect(row.innerHTML).toContain('gmdNoBudget');
    });
  });
});

describe('GM Dashboard — layout and coverage', () => {
  beforeEach(() => {
    get.mockReset();
    chartProps.length = 0;
  });

  const withCoverage = (extra: Record<string, unknown>) => {
    const base = response('p10');
    get.mockResolvedValue({ data: { ...base.data, ...extra } });
  };

  it('says how many farms have records, and dims and dashes the ones with none', async () => {
    withCoverage({ farms_reporting: { reporting: 1, total: 2, farm_ids: ['g'] } });
    render(<PiggeryGmDashboard />);
    const chip = await screen.findByTestId('gmd-coverage');
    expect(chip.textContent).toContain('gmdFarmsReporting 1 2');
    const table = await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    const heads = within(table).getAllByRole('columnheader');
    expect(heads[1].className).not.toContain('opacity-50'); // GRASMERE reports
    expect(heads[2].className).toContain('opacity-50'); // PORTA has nothing
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[2].textContent).toBe('–');
    expect(cells[2].getAttribute('title')).toBe('PORTA — gmdNoRecordsThisPeriod');
    expect(cells[2].querySelector('[data-status]')).toBeNull();
  });

  it('shows the value under the dot for a farm that reports', async () => {
    withCoverage({ farms_reporting: { reporting: 2, total: 2, farm_ids: ['g', 'p'] } });
    render(<PiggeryGmDashboard />);
    const table = await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[1].textContent).toBe('57.1%'); // Farrowing Rate 57.14 under its red dot
    expect(
      cells[1].querySelector('[data-status]')?.getAttribute('data-status'),
    ).toBe('RED');
  });

  it('names the period it fell back to when the current one has no records yet', async () => {
    withCoverage({
      period: { ...response('p10').data.period, fallback_from: '2026-11' },
      farms_reporting: { reporting: 1, total: 2, farm_ids: ['g'] },
    });
    render(<PiggeryGmDashboard />);
    const chip = await screen.findByTestId('gmd-coverage');
    expect(chip.textContent).toContain('gmdShowingLatest 2026-10 2026-11');
  });

  it('says nothing about coverage when one farm is shown or the API sends none', async () => {
    withCoverage({ farms_reporting: { reporting: 1, total: 1, farm_ids: ['g'] } });
    const { unmount } = render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    expect(screen.queryByTestId('gmd-coverage')).toBeNull();
    unmount();
    const base = response('p10');
    get.mockResolvedValue({ data: { ...base.data, farms_reporting: undefined } });
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    expect(screen.queryByTestId('gmd-coverage')).toBeNull();
  });

  it('renders Avg CDM and COS per tonne from budget actuals filled by kill sheet data', async () => {
    const base = response('p10');
    get.mockResolvedValue({
      data: {
        ...base.data,
        budget: {
          month: {
            all: {
              avg_cdm: {
                budget: 88,
                actual: 86.9,
                var: -1.1,
                var_pct: -1.25,
                status: 'GREEN',
                missing: [],
              },
              cos_per_tonne: {
                budget: 1650,
                actual: 1540,
                var: -110,
                var_pct: -6.67,
                status: 'GREEN',
                missing: [],
              },
            },
          },
          ytd: {},
          by_period: [],
        },
      },
    });

    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    expect(screen.getByRole('region', { name: 'gmdAvgCdm' }).textContent).toContain('86.9');
  });
});

describe('fmtShort', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fmtShort } = jest.requireActual('../src/components/console/piggery/gm-dashboard-widgets');
  it.each([
    [102937.94, '102.9K'],
    [1542000, '1.54M'],
    [-643285.34, '-643.3K'],
    [20872.04, '20,872'],
    [4500, '4,500'],
    [57.14, '57.14'],
    [0, '0'],
  ])('shortens %s to %s', (value, text) => {
    expect(fmtShort(value)).toBe(text);
  });
});

describe('StatusDot', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { StatusDot } = jest.requireActual('../src/components/console/piggery/gm-dashboard-widgets');

  it('draws a light solid dot for a figure with no target, and a dashed ring for no data', () => {
    const { container, rerender } = render(<StatusDot status={null} hasValue />);
    const dot = container.querySelector('[data-status]') as HTMLElement;
    expect(dot.style.opacity).toBe('0.35');
    expect(dot.style.border).toBe('');
    rerender(<StatusDot status={null} />);
    const ring = container.querySelector('[data-status]') as HTMLElement;
    expect(ring.style.border).toContain('dashed');
    expect(ring.style.opacity).toBe('');
  });
});
