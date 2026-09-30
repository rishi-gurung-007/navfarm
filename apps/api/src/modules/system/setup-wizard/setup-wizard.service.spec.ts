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
