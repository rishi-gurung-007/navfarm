import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { and } from 'drizzle-orm';
import { batchScopeConditions, farmScope, resolveFarmScope, UNRESTRICTED_FARM_SCOPE } from './farm-scope';

const dialect = new MySqlDialect();
const render = (conditions: any[]) => dialect.sqlToQuery(and(...conditions)!);

/** Answers the farm-row lookup with whatever the test puts in `farmRow`. */
const dbWith = (farmRow: object | undefined) => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => Promise.resolve(farmRow ? [farmRow] : []) };
  return { select: () => chain } as any;
};
const area = { area_id: 'area-1', company_id: 'co-1', nob_id: 'nob-1', lob_id: 'lob-pig' };
const input = (userType: string, over: Record<string, unknown> = {}) => ({
  user: { userId: 'u-1', tenantId: 't-1', companyId: 'co-1', userType, farmId: null, ...(over.user as object) },
  headers: (over.headers as Record<string, string>) ?? {},
  activeArea: 'activeArea' in over ? (over.activeArea as any) : area,
  activeCompanyId: 'co-1',
  tenantId: 't-1',
});

describe('resolveFarmScope', () => {
  it('fixes a standard user to their assigned farm', async () => {
    const scope = await resolveFarmScope(dbWith({ location_id: 'farm-g' }), input('STANDARD_USER', { user: { farmId: 'farm-g' } }));
    expect(scope).toEqual({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
  });

  it('refuses a standard user with no assigned farm', async () => {
    await expect(resolveFarmScope(dbWith(undefined), input('STANDARD_USER'))).rejects.toThrow(new ForbiddenException('No farm is assigned to this user.'));
  });

  it('refuses a standard user naming another farm', async () => {
    const req = input('STANDARD_USER', { user: { farmId: 'farm-g' }, headers: { 'x-active-farm-id': 'farm-k' } });
    await expect(resolveFarmScope(dbWith({ location_id: 'farm-g' }), req)).rejects.toThrow(new ForbiddenException('Not authorized for this farm.'));
  });

  it('refuses a restricted user with no operational area', async () => {
    const req = input('OPERATIONAL_ADMIN', { activeArea: undefined });
    await expect(resolveFarmScope(dbWith(undefined), req)).rejects.toThrow(new BadRequestException('Select an operational area first.'));
  });

  it('gives an operational admin every farm, bounded by LOB, when none is selected', async () => {
    const scope = await resolveFarmScope(dbWith(undefined), input('OPERATIONAL_ADMIN'));
    expect(scope).toEqual({ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
  });

  it('narrows an admin to a selected farm of the active company', async () => {
    const req = input('COMPANY_ADMIN', { activeArea: undefined, headers: { 'x-active-farm-id': 'farm-k' } });
    const scope = await resolveFarmScope(dbWith({ location_id: 'farm-k' }), req);
    expect(scope).toEqual({ farmId: 'farm-k', restricted: false, companyId: 'co-1', lobId: null });
  });

  it('refuses a selected farm that is not an active farm of the company', async () => {
    const req = input('COMPANY_ADMIN', { activeArea: undefined, headers: { 'x-active-farm-id': 'nowhere' } });
    await expect(resolveFarmScope(dbWith(undefined), req)).rejects.toThrow(new ForbiddenException('Not authorized for this farm.'));
  });
});

describe('farm conditions', () => {
  it('reads as unrestricted when the guard set nothing', () => {
    expect(farmScope({ get: () => undefined } as any)).toEqual(UNRESTRICTED_FARM_SCOPE);
  });

  it('bounds batch queries by farm and, for restricted users, LOB', () => {
    const { sql, params } = render(batchScopeConditions({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' }));
    expect(sql).toContain('`batch_header`.`farm_id` = ?');
    expect(sql).toContain('`batch_header`.`lob_id` = ?');
    expect(params).toEqual(expect.arrayContaining(['farm-g', 'lob-pig', 'co-1']));
  });

  it('adds nothing for an unrestricted admin with no farm selected', () => {
    expect(batchScopeConditions(UNRESTRICTED_FARM_SCOPE)).toEqual([]);
  });
});
