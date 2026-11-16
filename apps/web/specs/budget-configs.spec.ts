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
    });
    // Who may see or change budgets is the role matrix's call (PIGGERY/BUDGET), not an admins-only lock.
    expect(cfg!.businessAdminOnly).toBeFalsy();
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

  it('the Reporting Period picker offers inactive periods; Farm and Metric do not opt in', () => {
    // Only one period is active (open for posting); a budget may be set for any past or future period.
    expect(field('period_id')?.entityIncludeInactive).toBe(true);
    expect(field('farm_id')?.entityIncludeInactive).toBeFalsy();
    expect(field('metric_code')?.entityIncludeInactive).toBeFalsy();
  });

  it('period, farm and metric are required and read-only on edit', () => {
    for (const key of ['period_id', 'farm_id', 'metric_code']) {
      expect(field(key)).toMatchObject({ required: true, createOnly: true });
    }
    expect(field('amount')).toMatchObject({ type: 'number', required: true });
    expect(field('amount')?.createOnly).toBeFalsy();
    expect(field('tolerance_pct')).toMatchObject({ min: 0, max: 100, helpText: 'Blank means 10 %' });
    expect(field('notes')).toMatchObject({ maxLength: 500 });
  });

  it('every field sent on create is a field the API create reads, and a list row carries for edit', () => {
    // MasterDataTable posts each form field under its own key (company_id too, from the active company), and an edit
    // prefills each field from the list row's value under the same key. budget.service.ts create() reads these:
    const apiCreateReads = ['period_id', 'farm_id', 'metric_code', 'amount', 'tolerance_pct', 'notes'];
    const service = readFileSync(join(__dirname, '../../api/src/modules/piggery/budget/budget.service.ts'), 'utf8');
    const createBody = service.slice(service.indexOf('async create('), service.indexOf('async update('));
    const checked = service.slice(service.indexOf('private checked('), service.indexOf('private async farmOf('));
    for (const key of apiCreateReads) {
      const readsIt = createBody.includes(`dto.${key}`) || checked.includes(`values.${key}`);
      expect({ key, readsIt }).toEqual({ key, readsIt: true });
    }
    const sent = budget()!.fields.filter((f) => !f.hideInForm).map((f) => f.key);
    expect(sent).toEqual(apiCreateReads);
    // Selects store the option's value under the field key, so the value key must be what the row and API hold.
    expect(field('period_id')).toMatchObject({ entityValueKey: 'period_id' });
    expect(field('farm_id')).toMatchObject({ entityValueKey: 'location_id', entityLabelKeys: ['location_code', 'location_name'] });
    expect(field('metric_code')).toMatchObject({ entityValueKey: 'code' });
  });

  it('the grant appears in the role matrix list', () => {
    const source = readFileSync(join(__dirname, '../src/components/console/console-tabs/roles-tab.tsx'), 'utf8');
    const pairs = [...source.matchAll(/module_code:\s*["']([A-Z_]+)["'],\s*resource:\s*["']([A-Z_]+)["']/g)].map(
      (m) => `${m[1]}/${m[2]}`,
    );
    for (const [module, resource] of Object.values(BUDGET_GRANTS)) expect(pairs).toContain(`${module}/${resource}`);
  });
});
