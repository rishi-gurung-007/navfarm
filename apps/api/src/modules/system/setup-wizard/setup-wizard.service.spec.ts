import { SetupWizardService } from './setup-wizard.service';
import * as templateCopies from '../../core/company/copy-master-templates';

jest.mock('../../core/company/copy-master-templates', () => ({
  copyCompanyMasterTemplates: jest.fn(),
}));

describe('SetupWizardService company template adoption', () => {
  const tenantId = 'tenant-1';
  const placeholderId = '00000000-0000-0000-0000-000000000000';

  const profile = {
    tenant_id: tenantId,
    company_code: 'TRIPLEC',
    company_name: 'Triple C',
    company_type: 'Private Limited',
    industry_type: 'Piggery',
  } as any;

  const makeService = (existingCompany: Record<string, unknown>) => {
    const updatedCompany = { ...existingCompany, company_code: profile.company_code, company_name: profile.company_name };
    const resultSets = [[existingCompany], [updatedCompany], [{ role_id: 'role-1' }]];
    const select = jest.fn(() => {
      const rows = resultSets.shift() || [];
      const builder: any = {
        from: () => builder,
        where: () => builder,
        limit: async () => rows,
      };
      return builder;
    });
    const tx = {
      select,
      update: jest.fn(() => ({ set: () => ({ where: async () => ({}) }) })),
    };
    const db = {
      select,
      transaction: jest.fn(async (work: (executor: any) => Promise<unknown>) => work(tx)),
    };
    const service = new SetupWizardService(
      {} as any,
      { get: () => db } as any,
      { log: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
    );
    return { service, tx };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    (templateCopies.copyCompanyMasterTemplates as jest.Mock).mockReset();
  });

  it('copies tenant master templates when onboarding claims the placeholder company', async () => {
    const { service, tx } = makeService({
      company_id: placeholderId,
      tenant_id: tenantId,
      company_code: 'PLACEHOLDER',
    });
    const copy = templateCopies.copyCompanyMasterTemplates as jest.MockedFunction<typeof templateCopies.copyCompanyMasterTemplates>;
    copy.mockResolvedValue(28);

    await service.saveStep1Profile(profile);

    expect(copy).toHaveBeenCalledWith(tx, tenantId, placeholderId);
  });

  it('does not copy templates again when an established company profile is edited', async () => {
    const companyId = 'company-1';
    const { service } = makeService({ company_id: companyId, tenant_id: tenantId, company_code: 'TRIPLEC' });
    const copy = templateCopies.copyCompanyMasterTemplates as jest.MockedFunction<typeof templateCopies.copyCompanyMasterTemplates>;
    copy.mockResolvedValue(28);

    await service.saveStep1Profile({ ...profile, company_id: companyId });

    expect(copy).not.toHaveBeenCalled();
  });
});

describe('SetupWizardService company currencies', () => {
  function recordingService() {
    const writes: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const select = jest.fn(() => {
      const chain: any = { from: () => chain, where: () => chain, limit: async () => [] };
      return chain;
    });
    const tx: any = {
      select,
      update: jest.fn((table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updates.push({ table, values }); } }) })),
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          writes.push({ table, values });
          return { onDuplicateKeyUpdate: async () => undefined };
        },
      })),
    };
    const db = { transaction: jest.fn(async (work: (executor: any) => Promise<unknown>) => work(tx)) };
    const service = new SetupWizardService({} as any, { get: () => db } as any, {} as any, {} as any);
    return { service, db, tx, writes, updates };
  }

  it('saves the canonical base and exactly one explicit local currency in one transaction', async () => {
    const { service, db, writes, updates } = recordingService();
    await service.saveStep5Currency('co-1', 'currency-base', 'currency-local');

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(updates.some(({ values }) => values.base_currency_id === 'currency-base')).toBe(true);
    expect(updates.some(({ values }) => values.is_base === false && values.is_local === false)).toBe(true);
    expect(writes.map(({ values }) => values)).toEqual(expect.arrayContaining([
      expect.objectContaining({ company_id: 'co-1', currency_id: 'currency-base', is_base: true, is_local: false }),
      expect.objectContaining({ company_id: 'co-1', currency_id: 'currency-local', is_base: false, is_local: true }),
    ]));
  });

  it('stores one row as both base and local when the user explicitly selects the same currency', async () => {
    const { service, writes } = recordingService();
    await service.saveStep5Currency('co-1', 'currency-one', 'currency-one');
    expect(writes.map(({ values }) => values).filter((value) => value.currency_id === 'currency-one')).toEqual([
      expect.objectContaining({ is_base: true, is_local: true }),
    ]);
  });

  it('does not read Country Master or infer a local currency during an explicit save', async () => {
    const { service, tx, writes } = recordingService();
    await service.saveStep5Currency('co-1', 'currency-base', 'currency-chosen-local');
    expect(tx.select).toHaveBeenCalledTimes(1); // setup-step logging only
    expect(writes.some(({ values }) => values.currency_id === 'currency-chosen-local' && values.is_local === true)).toBe(true);
  });
});
