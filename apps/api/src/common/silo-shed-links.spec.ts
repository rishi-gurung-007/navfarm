import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { linkEffectiveOn, linksEffectiveOn, siloShedLinkEffectiveOn } from './silo-shed-links';

describe('links effective on a date', () => {
  it('no dates means always; ends are inclusive; a null end is open', () => {
    expect(linkEffectiveOn({}, '2026-10-11')).toBe(true);
    expect(linkEffectiveOn({ effectiveFrom: '2026-10-11' }, '2026-10-11')).toBe(true);
    expect(linkEffectiveOn({ effectiveFrom: '2026-10-12' }, '2026-10-11')).toBe(false);
    expect(linkEffectiveOn({ effectiveTo: '2026-10-11' }, '2026-10-11')).toBe(true);
    expect(linkEffectiveOn({ effectiveTo: '2026-10-10' }, '2026-10-11')).toBe(false);
  });
  it('filters a list', () => {
    const links = [{ id: 'a', effectiveTo: '2026-10-01' }, { id: 'b', effectiveFrom: '2026-10-02' }, { id: 'c' }];
    expect(linksEffectiveOn(links, '2026-10-05').map((l: { id: string }) => l.id)).toEqual(['b', 'c']);
  });
  it('the SQL form carries both ends and the date', () => {
    const { sql, params } = new MySqlDialect().sqlToQuery(siloShedLinkEffectiveOn('2026-10-05'));
    expect(sql).toContain('`silo_shed_link`.`effective_from`');
    expect(sql).toContain('`silo_shed_link`.`effective_to`');
    expect(params.filter((p) => p === '2026-10-05')).toHaveLength(2);
  });
});
