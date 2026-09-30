import { planCompanyTemplateRepair, missingNumberSeriesTemplates } from './repair-company-template-snapshots.lib';

describe('company template repair planning', () => {
  const coverage = (companyRows: number) => [
    { table: 'no_series', tenantRows: 28, companyRows },
    { table: 'stage_master', tenantRows: 8, companyRows },
  ];

  it('takes a complete snapshot only when every company template table is empty', () => {
    expect(planCompanyTemplateRepair('TRIPLEC', coverage(0), ['STAGE'])).toMatchObject({
      action: 'FULL_TEMPLATE_SNAPSHOT',
      missingNumberSeries: ['STAGE'],
    });
  });

  it('repairs only unambiguous Number Series codes when any template table is already owned', () => {
    expect(planCompanyTemplateRepair('TRIPLEC', coverage(1), ['STAGE'])).toMatchObject({
      action: 'ADD_NUMBER_SERIES_ONLY',
      missingNumberSeries: ['STAGE'],
      partiallyOwnedTables: ['no_series', 'stage_master'],
    });
  });

  it('audits without mutating when an independently owned snapshot has no missing series', () => {
    expect(planCompanyTemplateRepair('TRIPLEC', coverage(1), [])).toMatchObject({
      action: 'AUDIT_ONLY',
      missingNumberSeries: [],
    });
  });

  it('never adopts the signup placeholder before onboarding claims it', () => {
    expect(planCompanyTemplateRepair('PLACEHOLDER', coverage(0), ['STAGE']).action).toBe('SKIP_PLACEHOLDER');
  });

  it('matches Number Series by code without resetting or replacing existing rows', () => {
    const templates = [
      { id: 'tenant-stage', code: 'STAGE', current_seq: 0 },
      { id: 'tenant-item', code: 'ITEM', current_seq: 0 },
    ];
    const existing = [{ id: 'company-item', code: 'ITEM', current_seq: 91, last_no_used: 'ITM-0091' }];

    expect(missingNumberSeriesTemplates(templates, existing)).toEqual([templates[0]]);
    expect(existing[0]).toEqual({ id: 'company-item', code: 'ITEM', current_seq: 91, last_no_used: 'ITM-0091' });
  });
});
