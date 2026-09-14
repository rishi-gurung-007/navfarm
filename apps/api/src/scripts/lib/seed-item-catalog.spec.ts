import {
  ITEM_CATALOG_1,
  ITEM_CATALOG_2,
  ITEM_CATEGORY_CATALOG,
  ITEM_SUBCATEGORY_CATALOG,
} from './seed-item-catalog';

describe('demo item catalogue master references', () => {
  it('gives every item a defined root category and child subcategory', () => {
    const roots = new Set<string>(ITEM_CATEGORY_CATALOG.map((row) => row.key));
    const children = new Map<string, (typeof ITEM_SUBCATEGORY_CATALOG)[number]>(
      ITEM_SUBCATEGORY_CATALOG.map((row) => [row.key, row]),
    );

    for (const item of [...ITEM_CATALOG_1, ...ITEM_CATALOG_2]) {
      expect(roots.has(item.cat)).toBe(true);
      expect(children.get(item.sub)?.parent).toBe(item.cat);
    }
  });

  it('keeps category handles and generated-name inputs unique in one scope', () => {
    const rows = [...ITEM_CATEGORY_CATALOG, ...ITEM_SUBCATEGORY_CATALOG];
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length);
  });
});
