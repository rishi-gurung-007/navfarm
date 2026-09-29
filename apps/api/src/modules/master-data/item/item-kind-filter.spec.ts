import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { itemKindCondition } from './item-kind-filter';

/**
 * Porta Farm's living-asset type is code "LA-001", name "Living Asset", so
 * `GET /item?itemType=LIVESTOCK` — which asked for item_type = 'LIVESTOCK'
 * exactly — answered nothing and the Animal Register picker was empty. The
 * filter matches the KIND now, through item_type_master, in SQL: the list is
 * paged, so it cannot be decided in JavaScript after the fact.
 *
 * A type_code that is not a kind (MEDICINE, a tenant's own RAW-01) keeps the
 * old exact behaviour, so nothing that worked stops working.
 */
describe('itemKindCondition (item kinds, 29 Sep)', () => {
  const render = (itemType: string, tenantId = 'tenant-1', companyId: string | null = 'co-1') => {
    const condition = itemKindCondition(itemType, tenantId, companyId);
    return new MySqlDialect().sqlToQuery(condition as any);
  };

  /**
   * The real caller hands the CLS, so the types are scoped by the very same
   * masterScopeConditions the items are — the bug this replaced resolved the
   * company itself, got null, and narrowed the type lookup to tenant templates
   * while the items stayed company-scoped.
   */
  const renderWithCls = (itemType: string, scope: unknown) => {
    const cls = { get: () => scope } as any;
    return new MySqlDialect().sqlToQuery(itemKindCondition(itemType, 'tenant-1', cls) as any);
  };

  it('asks for the kind through item_type_master when the filter names a kind', () => {
    const q = render('LIVESTOCK');
    expect(q.sql).toContain('item_type_master');
    // the exact code, the code prefixes and the name fragments all appear
    expect(q.params).toEqual(expect.arrayContaining(['LIVESTOCK', 'LA-%', 'LA_%', 'LIVING%', '%living asset%', '%livestock%']));
    // bounded by tenant, and by the company-or-template scope masters use
    expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'co-1']));
  });

  it('does the same for FEED, with the workbook\'s FEED BULK / FEED-001 prefix', () => {
    const q = render('FEED');
    expect(q.params).toEqual(expect.arrayContaining(['FEED', 'FEED%', '%feed%']));
  });

  it('still matches the item_type column itself, so an exact LIVESTOCK item is included', () => {
    expect(render('LIVESTOCK').sql).toContain('`item_master`.`item_type`');
  });

  it('falls back to an exact match for a type that is not a kind', () => {
    const q = render('MEDICINE');
    expect(q.sql).not.toContain('item_type_master');
    expect(q.sql).toContain('`item_master`.`item_type` = ?');
    expect(q.params).toEqual(['MEDICINE']);
  });

  it('is case-insensitive about the filter it is given', () => {
    expect(render('livestock').sql).toContain('item_type_master');
    expect(render('feed').sql).toContain('item_type_master');
  });

  it('scopes the types with the caller\'s own master scope when given the CLS', () => {
    const q = renderWithCls('LIVESTOCK', { kind: 'COMPANY', tenantId: 'tenant-1', companyId: 'co-9' });
    expect(q.sql).toContain('item_type_master');
    // co-9 comes from the scope, not from a company this function guessed
    expect(q.params).toEqual(expect.arrayContaining(['co-9']));
  });

  it('narrows to templates only when the caller\'s scope has no company', () => {
    const q = renderWithCls('LIVESTOCK', { kind: 'TENANT', tenantId: 'tenant-1', companyId: null });
    expect(q.sql).toContain('`item_type_master`.`company_id` is null');
  });

  it('leaves the company clause out when there is no company (tenant-wide scope)', () => {
    const q = render('FEED', 'tenant-1', null);
    expect(q.sql).toContain('item_type_master');
    expect(q.params).not.toContain('co-1');
  });
});
