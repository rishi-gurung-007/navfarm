import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MASTER_DATA_CONFIGS } from '@/modules/master-data/configs';
import { BUDGET_CONFIGS, BUDGET_GRANTS } from '@/modules/master-data/budget-configs';
import { grantsFor } from '@/utils/nav-permissions';

const budget = () => MASTER_DATA_CONFIGS.find((c) => c.key === 'budget');
const field = (key: string) => budget()?.fields.find((f) => f.key === key);

describe('Budget master configuration', () => {
  it('budget config is registered with its grant', () => {
    expect(BUDGET_CONFIGS).toHaveLength(1);
    const cfg = budget();
    expect(cfg).toBeDefined();
    expect(cfg).toMatchObject({
      label: 'Budget',
      singular: 'Budget line',
      apiBase: '/piggery/budget',
      idKey: 'budget_id',
      group: 'Budget',
      supportsRestore: true,
      businessAdminOnly: true,
    });
    expect(BUDGET_GRANTS).toEqual({ budget: ['PIGGERY', 'BUDGET'] });
    expect(grantsFor('/master-data/budget')).toEqual([['PIGGERY', 'BUDGET']]);
    expect(cfg!.columns!.map((c) => c.label)).toEqual(['Period', 'Farm', 'Metric', 'Amount', 'Tolerance %']);
    expect(cfg!.fields.filter((f) => !f.hideInForm).map((f) => f.label)).toEqual([
      'Reporting Period',
      'Farm',
      'Metric',
      'Amount',
      'Tolerance %',
      'Notes',
    ]);
  });

  it('period, farm and metric are required and read-only on edit', () => {
    for (const key of ['period_id', 'location_id', 'metric_code']) {
      expect(field(key)).toMatchObject({ required: true, createOnly: true });
    }
    expect(field('amount')).toMatchObject({ type: 'number', required: true });
    expect(field('amount')?.createOnly).toBeFalsy();
    expect(field('tolerance_pct')).toMatchObject({ min: 0, max: 100, helpText: 'Blank means 10 %' });
    expect(field('notes')).toMatchObject({ maxLength: 500 });
  });

  it('the grant appears in the role matrix list', () => {
    const source = readFileSync(join(__dirname, '../src/components/console/console-tabs/roles-tab.tsx'), 'utf8');
    const pairs = [...source.matchAll(/module_code:\s*["']([A-Z_]+)["'],\s*resource:\s*["']([A-Z_]+)["']/g)].map(
      (m) => `${m[1]}/${m[2]}`,
    );
    for (const [module, resource] of Object.values(BUDGET_GRANTS)) expect(pairs).toContain(`${module}/${resource}`);
  });
});
