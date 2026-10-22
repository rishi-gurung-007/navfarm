import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { and } from 'drizzle-orm';
import * as schema from '../core/database/schema';
import { enforceMasterRequest, masterControllerPath, MasterScope, masterScopeConditions } from './master-data-scope';

describe('master workspace scope', () => {
  const dialect = new MySqlDialect();
  const clsFor = (scope: Partial<MasterScope>) => ({ get: (key: string) => key === 'masterScope' ? scope : undefined }) as unknown as ClsService;
  it('selects only tenant templates even with a stale company query', () => {
    const query = dialect.sqlToQuery(and(...masterScopeConditions(clsFor({ kind: 'TENANT', tenantId: 'tenant', companyId: null }), schema.itemMaster, 'stale'))!);
    expect(query.sql).toContain('`company_id` is null');
    expect(query.params).toEqual(['tenant']);
  });
  it('does not union tenant templates into company rows', () => {
    const query = dialect.sqlToQuery(and(...masterScopeConditions(clsFor({ kind: 'COMPANY', tenantId: 'tenant', companyId: 'company' }), schema.itemMaster))!);
    expect(query.sql).not.toContain('is null');
    expect(query.params).toEqual(['tenant', 'company']);
  });
  it('uses company and real NOB/LOB IDs, including common company references', () => {
    const scope: MasterScope = { kind: 'OPERATIONAL', tenantId: 'tenant', companyId: 'company', nobId: 'livestock', lobId: 'piggery' };
    const query = dialect.sqlToQuery(and(...masterScopeConditions(clsFor(scope), schema.itemMaster))!);
    expect(query.params).toEqual(['tenant', 'company', 'livestock', 'piggery']);
    expect(query.sql).toContain('`lob_id` is null');
    expect(query.sql).not.toContain('item_name');
  });
  it('rejects changing the company through the request body', async () => {
    const store = new Map();
    const cls = { get: (k: string) => store.get(k), set: (k: string, v: unknown) => store.set(k, v) } as unknown as ClsService;
    await expect(enforceMasterRequest(cls, { user: { userType: 'COMPANY_ADMIN', tenantId: 'tenant' }, headers: { 'x-workspace-scope': 'COMPANY', 'x-active-company-id': 'company' }, body: { company_id: 'other' } }, 'item')).rejects.toThrow('must match');
  });
  it('rejects tenant scope for a company admin', async () => {
    await expect(enforceMasterRequest(clsFor({}), { user: { userType: 'COMPANY_ADMIN' }, headers: { 'x-workspace-scope': 'TENANT' } }, 'item')).rejects.toThrow('Tenant templates');
  });

  /**
   * Guards run BEFORE the ValidationPipe, so this code sees the raw body: an
   * @IsUUID() decorator has not run yet. A malformed reference used to go
   * straight into eq(column, value) and surface as ER_OPERAND_COLUMNS — a 500
   * carrying the SQL statement, rather than a 400 naming the bad field.
   */
  describe('malformed master references', () => {
    const requestWith = (body: Record<string, unknown>) => ({
      user: { userType: 'COMPANY_ADMIN', tenantId: 'tenant', companyId: 'company' },
      headers: { 'x-workspace-scope': 'COMPANY', 'x-active-company-id': 'company' },
      method: 'POST',
      body,
    });
    const store = () => {
      const map = new Map();
      return { get: (k: string) => map.get(k), set: (k: string, v: unknown) => map.set(k, v) } as unknown as ClsService;
    };

    it.each([
      ['an array', [1, 'a3f1e2d4-0000-4000-8000-000000000000']],
      ['an object', { id: 'a3f1e2d4-0000-4000-8000-000000000000' }],
      ['a number', 42],
    ])('rejects %s as a foreign key with 400, not a database error', async (_label, value) => {
      await expect(
        enforceMasterRequest(store(), requestWith({ breed_id: value }), 'animal'),
      ).rejects.toThrow(/single identifier/i);
    });
  });
});

describe('masterControllerPath', () => {
  it('finds the master route of a controller mounted on several paths (20 Oct: @Controller([\'item\', \'items\']) skipped scoping)', () => {
    expect(masterControllerPath(['item', 'items'])).toBe('item');
    expect(masterControllerPath(['items', 'item'])).toBe('item');
    expect(masterControllerPath('location')).toBe('location');
    expect(masterControllerPath(['batch'])).toBe('batch');
    expect(masterControllerPath(undefined)).toBeUndefined();
  });
});
