import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../../common/guards/system-admin.guard';
import { SetupWizardController } from './setup-wizard.controller';
import {
  canAccessCompany,
  canCreateCompany,
  SetupWizardAccessGuard,
  WIZARD_ACCESS_KEY,
  WizardAccessRule,
  WizardRequester,
} from './setup-wizard-access.guard';

const TENANT = 'tenant-1';
const HOME = 'company-home';
const OTHER = 'company-other';

const user = (userType: string, overrides: Partial<WizardRequester> = {}): WizardRequester => ({
  userId: 'user-1',
  userType,
  tenantId: TENANT,
  companyId: HOME,
  ...overrides,
});

describe('canAccessCompany', () => {
  const inTenant = { tenant_id: TENANT };
  const elsewhere = { tenant_id: 'tenant-2' };

  it('lets a System Admin reach any company, even one this tenant database does not hold', () => {
    expect(canAccessCompany(user('SYSTEM_ADMIN'), OTHER, null, false)).toBe(true);
    expect(canAccessCompany(user('SYSTEM_ADMIN'), OTHER, elsewhere, false)).toBe(true);
  });

  it('lets a Tenant Admin reach every company in their tenant and none outside it', () => {
    expect(canAccessCompany(user('TENANT_ADMIN'), OTHER, inTenant, false)).toBe(true);
    expect(canAccessCompany(user('TENANT_ADMIN'), OTHER, elsewhere, false)).toBe(false);
    expect(canAccessCompany(user('TENANT_ADMIN'), OTHER, null, false)).toBe(false);
  });

  it('lets a Company Admin reach their home company or an assigned one only', () => {
    expect(canAccessCompany(user('COMPANY_ADMIN'), HOME, inTenant, false)).toBe(true);
    expect(canAccessCompany(user('COMPANY_ADMIN'), OTHER, inTenant, true)).toBe(true);
    expect(canAccessCompany(user('COMPANY_ADMIN'), OTHER, inTenant, false)).toBe(false);
  });

  it('refuses a home company id that has no row or sits in another tenant', () => {
    expect(canAccessCompany(user('COMPANY_ADMIN'), HOME, null, false)).toBe(false);
    expect(canAccessCompany(user('COMPANY_ADMIN'), HOME, elsewhere, true)).toBe(false);
  });

  it('applies the same membership rule to non-admin readers', () => {
    expect(canAccessCompany(user('STANDARD_USER'), HOME, inTenant, false)).toBe(true);
    expect(canAccessCompany(user('OPERATIONAL_ADMIN'), OTHER, inTenant, false)).toBe(false);
  });
});

describe('canCreateCompany', () => {
  it('allows a System Admin in any tenant and a Tenant Admin only in their own', () => {
    expect(canCreateCompany(user('SYSTEM_ADMIN'), 'tenant-2')).toBe(true);
    expect(canCreateCompany(user('TENANT_ADMIN'), TENANT)).toBe(true);
    expect(canCreateCompany(user('TENANT_ADMIN'), 'tenant-2')).toBe(false);
    expect(canCreateCompany(user('TENANT_ADMIN'), undefined)).toBe(false);
  });

  it('never lets a Company Admin create or claim a company', () => {
    expect(canCreateCompany(user('COMPANY_ADMIN'), TENANT)).toBe(false);
  });
});

describe('SetupWizardAccessGuard', () => {
  const select = jest.fn();
  const rows = (value: unknown[]) => ({ from: () => ({ where: () => ({ limit: async () => value }) }) });

  const guardFor = (rule: WizardAccessRule | undefined) =>
    new SetupWizardAccessGuard(
      { getAllAndOverride: () => rule } as unknown as Reflector,
      { get: () => ({ select }) } as unknown as ClsService,
    );

  const context = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ params: {}, body: {}, ...request }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  beforeEach(() => select.mockReset());

  it('passes routes without a rule (NOB/LOB reference lists) for any signed-in user', async () => {
    await expect(guardFor(undefined).canActivate(context({ user: user('STANDARD_USER') }))).resolves.toBe(true);
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects a non-admin on an admin step before touching the database', async () => {
    const guard = guardFor({ admin: true, target: 'company' });
    await expect(guard.canActivate(context({ user: user('STANDARD_USER'), params: { companyId: HOME } }))).rejects.toThrow('Only a System, Tenant or Company Admin');
    expect(select).not.toHaveBeenCalled();
  });

  it('allows a Company Admin to write their own company by route param', async () => {
    select.mockReturnValueOnce(rows([{ tenant_id: TENANT }]));
    const guard = guardFor({ admin: true, target: 'company' });
    await expect(guard.canActivate(context({ user: user('COMPANY_ADMIN'), params: { companyId: HOME } }))).resolves.toBe(true);
  });

  it('rejects a Company Admin writing a company they are not assigned to, read from body company_id', async () => {
    select.mockReturnValueOnce(rows([{ tenant_id: TENANT }])).mockReturnValueOnce(rows([]));
    const guard = guardFor({ admin: true, target: 'company' });
    await expect(guard.canActivate(context({ user: user('COMPANY_ADMIN'), body: { company_id: OTHER } }))).rejects.toThrow('Not authorized for this company');
  });

  it('asks for a company when a company step arrives without one', async () => {
    const guard = guardFor({ admin: true, target: 'company' });
    await expect(guard.canActivate(context({ user: user('TENANT_ADMIN'), body: {} }))).rejects.toThrow('company_id is required');
    // A non-string id is not an id — guards run before validation.
    await expect(guard.canActivate(context({ user: user('TENANT_ADMIN'), body: { company_id: ['x'] } }))).rejects.toThrow('company_id is required');
  });

  it('lets a same-company standard user read company details (currency formatting)', async () => {
    select.mockReturnValueOnce(rows([{ tenant_id: TENANT }]));
    const guard = guardFor({ admin: false, target: 'company' });
    await expect(guard.canActivate(context({ user: user('STANDARD_USER'), params: { companyId: HOME } }))).resolves.toBe(true);
  });

  describe('step 1 (profile)', () => {
    const guard = () => guardFor({ admin: true, target: 'profile' });

    it('lets a Tenant Admin register the first company in their own tenant without a company_id', async () => {
      await expect(guard().canActivate(context({ user: user('TENANT_ADMIN'), body: { tenant_id: TENANT } }))).resolves.toBe(true);
      expect(select).not.toHaveBeenCalled();
    });

    it('rejects a Company Admin registering a new company', async () => {
      await expect(guard().canActivate(context({ user: user('COMPANY_ADMIN'), body: { tenant_id: TENANT } }))).rejects.toThrow('Only a Tenant Admin can register');
    });

    it('rejects a body tenant_id from a tenant other than the requester', async () => {
      await expect(guard().canActivate(context({ user: user('TENANT_ADMIN'), body: { tenant_id: 'tenant-2', company_id: HOME } }))).rejects.toThrow('Not authorized for this tenant');
    });

    it('checks company membership when step 1 updates an existing company', async () => {
      select.mockReturnValueOnce(rows([{ tenant_id: TENANT }]));
      await expect(guard().canActivate(context({ user: user('COMPANY_ADMIN'), body: { tenant_id: TENANT, company_id: HOME } }))).resolves.toBe(true);
    });

    it('rejects an unknown company_id rather than letting the service create a company under it', async () => {
      select.mockReturnValueOnce(rows([]));
      await expect(guard().canActivate(context({ user: user('TENANT_ADMIN'), body: { tenant_id: TENANT, company_id: OTHER } }))).rejects.toThrow('Not authorized for this company');
    });

    it('lets a System Admin act in any tenant', async () => {
      await expect(guard().canActivate(context({ user: user('SYSTEM_ADMIN', { tenantId: null }), body: { tenant_id: 'tenant-2' } }))).resolves.toBe(true);
    });
  });
});

describe('SetupWizardController guard wiring', () => {
  const proto = SetupWizardController.prototype as any;
  const rule = (name: string) => Reflect.getMetadata(WIZARD_ACCESS_KEY, proto[name]);

  it('requires authentication and the wizard access guard on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SetupWizardController)).toEqual([JwtAuthGuard, SetupWizardAccessGuard]);
  });

  it.each([
    ['uploadLogo', { admin: true, target: 'none' }],
    ['saveStep1', { admin: true, target: 'profile' }],
    ['saveStep2', { admin: true, target: 'company' }],
    ['saveStep3', { admin: true, target: 'company' }],
    ['saveStep4', { admin: true, target: 'company' }],
    ['saveStep5', { admin: true, target: 'company' }],
    ['saveStep6', { admin: true, target: 'company' }],
    ['saveStep7', { admin: true, target: 'company' }],
    ['saveStep8', { admin: true, target: 'company' }],
    ['getStatus', { admin: true, target: 'company' }],
    ['completeWizard', { admin: true, target: 'company' }],
    ['getCompanySetupDetails', { admin: false, target: 'company' }],
  ])('%s carries its access rule', (name, expected) => {
    expect(rule(name)).toEqual(expected);
  });

  it('keeps the NOB/LOB lists authentication-only and their writes platform-admin-only', () => {
    expect(rule('listNobs')).toBeUndefined();
    expect(rule('listLobs')).toBeUndefined();
    for (const name of ['createNob', 'updateNob', 'deleteNob', 'createLob', 'updateLob', 'deleteLob']) {
      expect(Reflect.getMetadata(GUARDS_METADATA, proto[name])).toContain(SystemAdminGuard);
    }
  });

  it('leaves no route outside the list above', () => {
    // The class itself carries @Controller's path, and proto.constructor is the class.
    const routes = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined);
    expect(routes).toHaveLength(20);
  });
});
