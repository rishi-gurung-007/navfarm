import * as schema from '../../../core/database/schema';
import { planTemplateCopies } from './copy-master-templates';

describe('company template snapshot', () => {
  it('remaps legacy logical account references to company-owned accounts', () => {
    const copies = planTemplateCopies([
      { table: schema.glAccountMaster, rows: [{ gl_account_id: 'account' }] },
      { table: schema.itemMaster, rows: [{ item_id: 'item', inventory_gl_account: 'account', cogs_gl_account: 'account' }] },
      { table: schema.resourceMaster, rows: [{ resource_id: 'resource', gl_cost_account: 'account' }] },
    ], 'company');
    const account = copies.find((copy) => copy.originalId === 'account')!.row.gl_account_id;
    expect(account).not.toBe('account');
    expect(copies.find((copy) => copy.originalId === 'item')!.row).toMatchObject({ inventory_gl_account: account, cogs_gl_account: account });
    expect(copies.find((copy) => copy.originalId === 'resource')!.row.gl_cost_account).toBe(account);
  });

  it('rejects a reference to a missing or inactive template rather than sharing its identity', () => {
    expect(() => planTemplateCopies([
      { table: schema.itemMaster, rows: [{ item_id: 'item', category_id: 'inactive-category' }] },
    ], 'company')).toThrow('active tenant template');
  });

  it('remaps recipe ingredients to company-owned formula and item copies', () => {
    const copies = planTemplateCopies([
      { table: schema.itemMaster, rows: [{ item_id: 'feed' }, { item_id: 'maize' }] },
      { table: schema.feedFormulaMaster, rows: [{ formula_id: 'recipe', target_item_id: 'feed' }] },
      { table: schema.feedFormulaIngredients, rows: [{ ingredient_id: 'line', formula_id: 'recipe', item_id: 'maize' }] },
    ], 'company');
    const recipe = copies.find((c) => c.originalId === 'recipe')!;
    const maize = copies.find((c) => c.originalId === 'maize')!;
    const line = copies.find((c) => c.originalId === 'line')!;
    expect(line.row.company_id).toBe('company');
    expect(line.row.formula_id).toBe(recipe.row.formula_id);
    expect(line.row.item_id).toBe(maize.row.item_id);
  });

  it('creates independent identities and remaps category trees and item references', () => {
    const root = { category_id: 'root', company_id: null, category_code: 'ROOT' };
    const copies = planTemplateCopies([
      { table: schema.itemCategoryMaster, rows: [root, { category_id: 'child', parent_category_id: 'root' }] },
      { table: schema.itemMaster, rows: [{ item_id: 'item', category_id: 'child', item_code: 'FEED' }] },
    ], 'company');
    const [parent, child, item] = copies;
    expect(parent.row.category_id).not.toBe('root');
    expect(parent.row.company_id).toBe('company');
    expect(child.deferred.parent_category_id).toBe(parent.row.category_id);
    expect(item.deferred.category_id).toBe(child.row.category_id);
    expect(root.company_id).toBeNull();
    expect(item.row.item_code).toBe('FEED');
  });

  it('defers cyclical stage transitions without disabling foreign keys', () => {
    const copies = planTemplateCopies([{ table: schema.stageMaster, rows: [
      { stage_id: 'one', next_stage_id: 'two' }, { stage_id: 'two', next_stage_id: 'one' },
    ] }], 'company');
    expect(copies[0].row.next_stage_id).toBeNull();
    expect(copies[0].deferred.next_stage_id).toBe(copies[1].row.stage_id);
    expect(copies[1].deferred.next_stage_id).toBe(copies[0].row.stage_id);
  });

  it('preserves global taxonomy and resets company number counters independently', () => {
    const inputs = [
      { table: schema.noSeries, rows: [{ id: 'series', current_seq: 99, prefix: 'FARM', nob_id: 'livestock' }] },
    ];
    const one = planTemplateCopies(inputs, 'one')[0].row;
    const two = planTemplateCopies(inputs, 'two')[0].row;
    expect(one.current_seq).toBe(0);
    expect(one.nob_id).toBe('livestock');
    expect(one.prefix).toBe('FARM');
    expect(one.id).not.toBe(two.id);
    expect(inputs[0].rows[0].current_seq).toBe(99);
  });
});
