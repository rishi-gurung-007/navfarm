import { getTableName } from 'drizzle-orm';
import * as schema from '../core/database/schema';
import { planTemplateCopies } from '../modules/core/company/copy-master-templates';
import { collectExternalRefs, prepareSeedSets, summarize } from './seed-test-masters.lib';

describe('seed-test-masters planning', () => {
  const tables = [schema.itemCategoryMaster, schema.itemMaster];
  const cat = (id: string, parent: string | null = null) => ({ category_id: id, tenant_id: 'T-SRC', company_id: 'SRC', category_code: id, parent_category_id: parent });
  const empty = { exists: new Set<string>(), remap: new Map<string, string>() };

  it('stamps the target tenant and lets planTemplateCopies copy with fresh ids into the target company', () => {
    const { sets } = prepareSeedSets([{ table: schema.itemCategoryMaster, rows: [cat('a'), cat('b', 'a')] }], 'T-TGT', empty, tables);
    const copies = planTemplateCopies(sets, 'TGT');
    expect(copies).toHaveLength(2);
    expect(copies.every((c) => c.row.company_id === 'TGT' && c.row.tenant_id === 'T-TGT')).toBe(true);
    expect(copies.map((c) => c.row.category_id)).not.toContain('a');
    const child = copies.find((c) => c.row.category_code === 'b')!;
    expect(copies.map((c) => c.row.category_id)).toContain(child.deferred.parent_category_id ?? child.row.parent_category_id);
  });

  it('nulls a nullable reference to a row that is not copied and reports it', () => {
    const { sets, reports } = prepareSeedSets([{ table: schema.itemCategoryMaster, rows: [cat('b', 'gone')] }], 'T', empty, tables);
    expect(sets[0].rows[0].parent_category_id).toBeNull();
    expect(reports.get(getTableName(schema.itemCategoryMaster))!.nulled).toBe(1);
  });

  it('maps a reference by code when a mapping exists', () => {
    const name = getTableName(schema.itemCategoryMaster);
    const lookup = { exists: new Set<string>(), remap: new Map([[`${name}:gone`, 'mapped']]) };
    const { sets } = prepareSeedSets([{ table: schema.itemCategoryMaster, rows: [cat('b', 'gone')] }], 'T', lookup, tables);
    expect(sets[0].rows[0].parent_category_id).toBe('mapped');
  });

  it('lists external references for lookup', () => {
    const refs = collectExternalRefs([{ table: schema.itemCategoryMaster, rows: [cat('a'), cat('b', 'gone')] }], tables);
    expect(refs.map((r) => r.value)).toEqual(['gone']);
  });

  it('summarises copy, skip and table-skip counts', () => {
    const { reports } = prepareSeedSets([{ table: schema.itemCategoryMaster, rows: [cat('a')] }], 'T', empty, tables);
    const s = summarize(reports, new Map([['item_category_master', 1]]), new Map([['uom_master', 'target already has 3 rows']]));
    expect(s.totals).toEqual({ copy: 1, rows_skipped: 0, tables_skipped: 1 });
  });
});
