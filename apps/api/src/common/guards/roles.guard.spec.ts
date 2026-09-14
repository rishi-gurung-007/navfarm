import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { RolesGuard } from './roles.guard';
import { CODE_PREVIEW_PERMISSION_KEY } from '../decorators/require-code-preview-permission.decorator';
import { FARM_SCOPED_KEY } from '../farm-scope';

describe('RolesGuard operational context', () => {
  const area = { area_id: 'area-1', company_id: 'company-1', nob_id: 'livestock', lob_id: 'piggery' };
  const select = jest.fn();
  const set = jest.fn();
  const rows = (value: unknown[]) => ({ from: () => ({ where: () => ({ limit: async () => value }) }) });
  let guard: RolesGuard;

  beforeEach(() => {
    select.mockReset();
    set.mockReset();
    guard = new RolesGuard(
      { getAllAndOverride: () => undefined } as unknown as Reflector,
      { get: () => ({ select }), set } as unknown as ClsService,
    );
  });

  const context = (headers: Record<string, string>, userType = 'COMPANY_ADMIN') => ({
    switchToHttp: () => ({ getRequest: () => ({ headers, user: { userType, tenantId: 'tenant-1', companyId: 'company-1' } }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

  it('publishes validated area context for downstream master services', async () => {
    select.mockReturnValueOnce(rows([area]));
    await expect(guard.canActivate(context({ 'x-active-company-id': 'company-1', 'x-active-operational-area-id': 'area-1' }))).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith('activeOperationalArea', area);
  });

  it('rejects a mismatched company/area even for a company admin', async () => {
    select.mockReturnValueOnce(rows([{ ...area, company_id: 'company-2' }]));
    await expect(guard.canActivate(context({ 'x-active-company-id': 'company-1', 'x-active-operational-area-id': 'area-1' }))).rejects.toThrow('does not belong');
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects a missing, deleted or inactive area', async () => {
    select.mockReturnValueOnce(rows([]));
    await expect(guard.canActivate(context({ 'x-active-company-id': 'company-1', 'x-active-operational-area-id': 'area-1' }))).rejects.toThrow('does not belong');
  });

  it('requires company context when an area is selected', async () => {
    select.mockReturnValueOnce(rows([area]));
    await expect(guard.canActivate(context({ 'x-active-operational-area-id': 'area-1' }))).rejects.toThrow('does not belong');
  });

  it('leaves requests without an area unchanged', async () => {
    await expect(guard.canActivate(context({ 'x-active-company-id': 'company-1' }))).resolves.toBe(true);
    expect(select).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

describe('RolesGuard master code previews', () => {
  const permissions = jest.fn();
  const query = { from: () => query, innerJoin: () => query, where: permissions };
  const select = jest.fn(() => query);
  const context = (master: unknown, isPreview = true, headers = {}) => ({
    switchToHttp: () => ({ getRequest: () => ({ headers, query: { master }, user: { userType: 'OPERATIONAL_ADMIN', userId: 'operator', tenantId: 'tenant-1', companyId: 'company-1' } }) }),
    getHandler: () => isPreview,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;
  const guard = new RolesGuard(
    { getAllAndOverride: (key: string, targets: unknown[]) => key === CODE_PREVIEW_PERMISSION_KEY ? targets[0] : { moduleCode: 'SYSTEM', resource: 'NUMBER_SERIES', action: 'view' } } as unknown as Reflector,
    { get: () => ({ select }), set: jest.fn() } as unknown as ClsService,
  );
  beforeEach(() => { permissions.mockReset(); select.mockClear(); });
  it('allows a UOM creator to preview UOM without Number Series permission', async () => {
    permissions.mockResolvedValue([{ moduleCode: 'MASTER_DATA', resource: 'UOM', canCreate: true }]);
    await expect(guard.canActivate(context('UOM'))).resolves.toBe(true);
    await expect(guard.canActivate(context('BREED'))).rejects.toThrow('Insufficient permissions');
    await expect(guard.canActivate(context('UOM', false))).rejects.toThrow('Insufficient permissions');
  });
  it('does not treat view-only master access as create permission', async () => {
    permissions.mockResolvedValue([{ moduleCode: 'MASTER_DATA', resource: 'UOM', canView: true }]);
    await expect(guard.canActivate(context('UOM'))).rejects.toThrow('Insufficient permissions');
  });
  it.each([['STAGE', 'PRODUCTION', 'STAGE'], ['ANIMAL', 'PIGGERY', 'ANIMAL'], ['LOCATION_TYPE', 'MASTER_DATA', 'LOCATION']])('uses the exact %s controller permission', async (master, moduleCode, resource) => {
    permissions.mockResolvedValue([{ moduleCode, resource, canCreate: true }]);
    await expect(guard.canActivate(context(master))).resolves.toBe(true);
  });
  it('retains the existing Number Series viewer path', async () => {
    permissions.mockResolvedValue([{ moduleCode: 'SYSTEM', resource: 'NUMBER_SERIES', canView: true }]);
    await expect(guard.canActivate(context('UOM'))).resolves.toBe(true);
  });
  it.each([undefined, ['UOM', 'BREED'], 'UNKNOWN', '__proto__'])('rejects unsupported master %p', async (master) => {
    await expect(guard.canActivate(context(master))).rejects.toThrow('supported master');
  });
  it('still validates company assignments before permissions', async () => {
    select.mockImplementationOnce(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) as unknown as typeof query);
    await expect(guard.canActivate(context('UOM', true, { 'x-active-company-id': 'other-company' }))).rejects.toThrow('Not authorized for this company');
  });
});

describe('RolesGuard farm scope', () => {
  const select = jest.fn();
  const set = jest.fn();

  beforeEach(() => {
    select.mockReset();
    set.mockReset();
  });

  const buildGuard = (farmScoped: boolean) => new RolesGuard(
    { getAllAndOverride: (key: string) => (key === FARM_SCOPED_KEY ? farmScoped : undefined) } as unknown as Reflector,
    { get: (key: string) => (key === 'tenantDb' ? { select } : undefined), set } as unknown as ClsService,
  );

  const context = (headers: Record<string, string>, user: Record<string, unknown>) => ({
    switchToHttp: () => ({ getRequest: () => ({ headers, user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

  it('stores the resolved scope for a farm-scoped route', async () => {
    const guard = buildGuard(true);
    const ctx = context(
      { 'x-active-company-id': 'co-1' },
      { userType: 'COMPANY_ADMIN', tenantId: 'tenant-1', companyId: 'co-1' },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith('farmScope', { farmId: null, restricted: false, companyId: 'co-1', lobId: null });
  });

  it('refuses a standard user on a farm-scoped route without an area header', async () => {
    const guard = buildGuard(true);
    const ctx = context(
      { 'x-active-company-id': 'co-1' },
      { userType: 'STANDARD_USER', tenantId: 'tenant-1', companyId: 'co-1', farmId: 'farm-g' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow('Select an operational area first.');
  });

  it('does not resolve a farm scope for routes that are not farm-scoped', async () => {
    const guard = buildGuard(false);
    const ctx = context(
      { 'x-active-company-id': 'co-1' },
      { userType: 'COMPANY_ADMIN', tenantId: 'tenant-1', companyId: 'co-1' },
    );
    await guard.canActivate(ctx);
    expect(set).not.toHaveBeenCalledWith('farmScope', expect.anything());
  });
});
