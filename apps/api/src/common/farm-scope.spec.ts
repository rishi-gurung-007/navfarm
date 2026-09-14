import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { and } from 'drizzle-orm';
import { animalScopeConditions, batchReferenceScopeConditions, batchScopeConditions, farmScope, resolveFarmScope, restrictedScopeConditions, UNRESTRICTED_FARM_SCOPE } from './farm-scope';
import * as schema from '../core/database/schema';

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
  activeCompanyId: 'activeCompanyId' in over ? (over.activeCompanyId as string | undefined) : 'co-1',
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

  it('keeps a company admin inside its assigned company when the header is omitted', async () => {
    const req = input('COMPANY_ADMIN', { activeArea: undefined, activeCompanyId: undefined });
    req.user.companyId = 'company-assigned';
    await expect(resolveFarmScope(dbWith(undefined), req)).resolves.toMatchObject({
      companyId: 'company-assigned', farmId: null, restricted: false,
    });
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

  // The regression this whole helper exists for: an operational admin who sends
  // no x-active-farm-id has farmId null, so the farm half contributes nothing
  // and the company/LOB half is the only thing standing between them and every
  // record in the tenant.
  it('still bounds a batch query for an operational admin who selected no farm', () => {
    const { sql, params } = render(batchScopeConditions({ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' }));
    expect(sql).not.toContain('`batch_header`.`farm_id`');
    expect(sql).toContain('`batch_header`.`lob_id` = ?');
    expect(sql).toContain('`batch_header`.`company_id` = ?');
    expect(params).toEqual(['lob-pig', 'co-1']);
  });

  it('bounds an animal query by company and LOB when an operational admin selected no farm', () => {
    const { sql, params } = render(animalScopeConditions({ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' }));
    expect(sql).toContain('`animal_register`.`lob_id` = ?');
    expect(sql).toContain('`animal_register`.`company_id` = ?');
    expect(params).toEqual(['lob-pig', 'co-1']);
  });
});

describe('restrictedScopeConditions', () => {
  const both = { companyId: schema.batchTransfer.company_id, lobId: schema.schedulerHeader.lob_id };

  it('adds nothing for an unrestricted caller with no selected company', () => {
    expect(restrictedScopeConditions(UNRESTRICTED_FARM_SCOPE, both)).toEqual([]);
  });

  it('still bounds an unrestricted company admin to the selected company', () => {
    const { sql, params } = render(restrictedScopeConditions(
      { farmId: null, restricted: false, companyId: 'co-1', lobId: null },
      both,
    ));
    expect(sql).toContain('`batch_transfer`.`company_id` = ?');
    expect(sql).not.toContain('lob_id');
    expect(params).toEqual(['co-1']);
  });

  it('bounds by both LOB and company when the table carries both columns', () => {
    const conditions = restrictedScopeConditions({ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' }, both);
    expect(conditions).toHaveLength(2);
    const { sql, params } = render(conditions);
    expect(sql).toContain('`scheduler_header`.`lob_id` = ?');
    expect(sql).toContain('`batch_transfer`.`company_id` = ?');
    expect(params).toEqual(['lob-pig', 'co-1']);
  });

  it('bounds by company alone when the table has no lob_id column', () => {
    const conditions = restrictedScopeConditions(
      { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' },
      { companyId: schema.batchTransfer.company_id },
    );
    expect(conditions).toHaveLength(1);
    const { sql, params } = render(conditions);
    expect(sql).toContain('`batch_transfer`.`company_id` = ?');
    expect(params).toEqual(['co-1']);
  });

  it('bounds by company alone when the caller has no LOB', () => {
    const conditions = restrictedScopeConditions({ farmId: null, restricted: true, companyId: 'co-1', lobId: null }, both);
    expect(conditions).toHaveLength(1);
    const { sql, params } = render(conditions);
    expect(sql).not.toContain('lob_id');
    expect(sql).toContain('`batch_transfer`.`company_id` = ?');
    expect(params).toEqual(['co-1']);
  });

  // The farm half is the caller's job; mixing it in here would double-apply it
  // wherever a service already pushes its own farm condition.
  it('never contributes a farm condition, even with a farm selected', () => {
    const { sql } = render(restrictedScopeConditions({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' }, both));
    expect(sql).not.toContain('farm_id');
    expect(sql).not.toContain('farm-g');
  });
});

describe('batchReferenceScopeConditions', () => {
  it('bounds a batch-linked row by company and LOB when an operational admin selects no farm', () => {
    const { sql, params } = render(batchReferenceScopeConditions(
      { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' },
      schema.milkProductionLog.batch_id,
    ));
    expect(sql).toContain('FROM batch_header br');
    expect(sql).toContain('br.lob_id = ?');
    expect(sql).toContain('br.company_id = ?');
    expect(params).toEqual(['lob-pig', 'co-1']);
  });

  it('also bounds a batch-linked row to the selected farm', () => {
    const { sql, params } = render(batchReferenceScopeConditions(
      { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' },
      schema.qcBatchDetail.source_batch_id,
    ));
    expect(sql).toContain('SELECT bf.batch_id FROM batch_header bf WHERE bf.farm_id = ?');
    expect(params).toContain('farm-g');
  });

  it('bounds a company admin by the selected company without adding a LOB condition', () => {
    const { sql, params } = render(batchReferenceScopeConditions(
      { farmId: null, restricted: false, companyId: 'co-1', lobId: null },
      schema.qrCodeMaster.batch_id,
    ));
    expect(sql).toContain('br.company_id = ?');
    expect(sql).not.toContain('br.lob_id = ?');
    expect(params).toEqual(['co-1']);
  });

  it('adds nothing for an unrestricted caller with no selected farm', () => {
    expect(batchReferenceScopeConditions(UNRESTRICTED_FARM_SCOPE, schema.qrCodeMaster.batch_id)).toEqual([]);
  });
});
