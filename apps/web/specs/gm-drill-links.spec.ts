import {
  budgetHref,
  DrillContext,
  drillHref,
  profitLossHref,
} from '../src/components/console/piggery/gm-drill-links';
import { parseDrillParams } from '../src/hooks/useDrillParams';

const ctx: DrillContext = {
  period: {
    period_code: '2026-11',
    start_date: '2026-10-25',
    ytd_from: '2026-06-28',
    to: '2026-11-21',
  },
  custom: false,
  hasSales: () => true,
};

const q = (href: string) =>
  Object.fromEntries(new URL(href, 'http://x').searchParams);
const path = (href: string) => new URL(href, 'http://x').pathname;

describe('GM Dashboard drill links', () => {
  it('passes month or ytd dates and the farm; All Farms passes none', () => {
    expect(
      q(drillHref('cost_of_sales', 'month', ctx, { farm_id: 'g', farm_name: 'G' })!),
    ).toEqual({ salesOnly: 'true', farmId: 'g', from: '2026-10-25', to: '2026-11-21' });
    expect(q(drillHref('cost_of_sales', 'ytd', ctx, null)!)).toEqual({
      salesOnly: 'true',
      from: '2026-06-28',
      to: '2026-11-21',
    });
  });

  it('sends pigs to kill sheets only without sales', () => {
    expect(path(drillHref('pigs_to_slaughter', 'month', ctx, null)!)).toBe(
      '/inventory/bio-asset-ledger',
    );
    expect(
      path(drillHref('pigs_to_slaughter', 'month', { ...ctx, hasSales: () => false }, null)!),
    ).toBe('/batches/kill-sheets');
  });

  it('asks about sales for the clicked span and farm', () => {
    const hasSales = jest.fn(() => false);
    drillHref('pigs_to_slaughter', 'ytd', { ...ctx, hasSales }, { farm_id: 'g', farm_name: 'G' });
    expect(hasSales).toHaveBeenCalledWith('ytd', 'g');
    drillHref('pigs_to_slaughter', 'month', { ...ctx, hasSales }, null);
    expect(hasSales).toHaveBeenLastCalledWith('month', null);
  });

  it('routes each stage 1 key to its page with its extras', () => {
    const dates = { from: '2026-10-25', to: '2026-11-21' };
    const cases: Array<[string[], string, Record<string, string>]> = [
      [
        ['cost_of_sales', 'gross_margin', 'gross_margin_pct'],
        '/inventory/bio-asset-ledger',
        { salesOnly: 'true' },
      ],
      [
        ['avg_cdm', 'cos_per_tonne', 'kg_sold_per_sow_year'],
        '/batches/kill-sheets',
        { status: 'IMPORTED' },
      ],
      [['other_overheads'], '/finance/journal', { status: 'POSTED', accounts: '4600' }],
      [['staff_overheads'], '/finance/journal', { status: 'POSTED', accounts: '4610' }],
      [
        [
          'total_born_per_litter',
          'born_alive_per_litter',
          'pre_wean_mortality_pct',
          'weaned_per_sow',
          'avg_wean_weight_kg',
          'litter_mass_kg',
        ],
        '/reports/farrowing',
        {},
      ],
    ];
    for (const [keys, route, extras] of cases)
      for (const key of keys) {
        const href = drillHref(key, 'month', ctx, null)!;
        expect([key, path(href), q(href)]).toEqual([key, route, { ...extras, ...dates }]);
      }
  });

  it('gives stage 2 measures no link', () => {
    for (const k of [
      'farrowing_rate_pct',
      'weight_70_day',
      'gain_70_day',
      'fce_weaner',
      'weaner_mortality',
      'fce_grower',
      'grower_mortality',
      'constructor',
    ]) {
      expect(drillHref(k, 'month', ctx, null)).toBeNull();
      expect(budgetHref(k, 'month', ctx, null)).toBeNull();
    }
  });

  it('filters the budget by period, farm and metric; ytd drops the period; custom range has none', () => {
    const farm = { farm_id: 'g', farm_name: 'MULTIPLIER (Triple C)' };
    expect(path(budgetHref('cos_per_tonne', 'month', ctx, farm)!)).toBe('/master-data/budget');
    expect(q(budgetHref('cos_per_tonne', 'month', ctx, farm)!)).toEqual({
      'filter[period_code]': '2026-11',
      'filter[farm_name]': 'MULTIPLIER (Triple C)',
      'filter[metric_label]': 'COS per tonne',
    });
    expect(q(budgetHref('avg_cdm', 'ytd', ctx, null)!)).toEqual({
      'filter[metric_label]': 'Avg CDM',
    });
    expect(budgetHref('avg_cdm', 'month', { ...ctx, custom: true }, null)).toBeNull();
  });

  it('names each budget metric as the API does', () => {
    const labels = {
      pigs_to_slaughter: 'Pigs to Slaughter',
      avg_cdm: 'Avg CDM',
      cost_of_sales: 'Cost of Sales',
      cos_per_tonne: 'COS per tonne',
      gross_margin: 'Gross Margin',
      gross_margin_pct: 'Gross Margin %',
      other_overheads: 'Other Overheads',
      staff_overheads: 'Staff Overheads',
      kg_sold_per_sow_year: 'Kg Meat Sold / Sow / Year',
    };
    for (const [key, label] of Object.entries(labels))
      expect(q(budgetHref(key, 'ytd', ctx, null)!)).toEqual({ 'filter[metric_label]': label });
  });

  it('opens profit and loss only on All Farms, with ytd dates', () => {
    expect(path(profitLossHref(ctx, null)!)).toBe('/finance/profit-loss');
    expect(q(profitLossHref(ctx, null)!)).toEqual({ from: '2026-06-28', to: '2026-11-21' });
    expect(profitLossHref(ctx, { farm_id: 'g', farm_name: 'G' })).toBeNull();
  });
});

describe('GM Dashboard drill link reader', () => {
  it('reads good link values', () => {
    expect(
      parseDrillParams(
        new URLSearchParams(
          'farmId=0b9c1e2a-1111-2222-3333-444455556666&from=2026-10-25&to=2026-11-21&status=POSTED&salesOnly=true&accounts=4600,4610',
        ),
      ),
    ).toEqual({
      farmId: '0b9c1e2a-1111-2222-3333-444455556666',
      from: '2026-10-25',
      to: '2026-11-21',
      status: 'POSTED',
      salesOnly: true,
      accounts: ['4600', '4610'],
    });
  });

  it('is empty on a visit without parameters', () => {
    expect(parseDrillParams(new URLSearchParams(''))).toEqual({
      farmId: '',
      from: '',
      to: '',
      status: '',
      salesOnly: false,
      accounts: [],
    });
  });

  it('ignores bad link values', () => {
    expect(
      parseDrillParams(
        new URLSearchParams('from=abc&to=2026-02-30&accounts=4600,drop&salesOnly=yes&status=a%20b'),
      ),
    ).toEqual({ farmId: '', from: '', to: '', status: '', salesOnly: false, accounts: ['4600'] });
  });
});
