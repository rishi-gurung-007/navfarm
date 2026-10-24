import * as schema from '../../../core/database/schema';
import {
  naturalKey,
  planTemplateAdoption,
  planTemplateCopies,
} from './copy-master-templates';

describe('company template snapshot', () => {
  it("remaps the vaccine, drug and resource ids inside a lifecycle stage's lists to the copied company (14 Oct)", () => {
    const copies = planTemplateCopies(
      [
        {
          table: schema.itemMaster,
          rows: [{ item_id: 'vaccine' }, { item_id: 'drug' }],
        },
        { table: schema.resourceMaster, rows: [{ resource_id: 'vet' }] },
        {
          table: schema.breedLifecycleStages,
          rows: [
            {
              lifecycle_id: 'stage',
              vaccination_protocol: [
                {
                  vaccine_item_id: 'vaccine',
                  trigger_type: 'AGE_WEEKS',
                  trigger_value: 6,
                },
              ],
              medication_protocol: [
                { medicine_item_id: 'drug', problem: 'Scour' },
                { medicine_item_id: 'not-copied' },
              ],
              resource_requirements: [{ resource_id: 'vet', quantity: 1 }],
            },
          ],
        },
      ],
      'company',
    );
    const id = (original: string, key: string) =>
      copies.find((c) => c.originalId === original)!.row[key];
    const stage = copies.find((c) => c.originalId === 'stage')!.row;
    expect(stage.vaccination_protocol).toEqual([
      {
        vaccine_item_id: id('vaccine', 'item_id'),
        trigger_type: 'AGE_WEEKS',
        trigger_value: 6,
      },
    ]);
    expect(stage.medication_protocol).toEqual([
      { medicine_item_id: id('drug', 'item_id'), problem: 'Scour' },
      { medicine_item_id: 'not-copied' },
    ]);
    expect(stage.resource_requirements).toEqual([
      { resource_id: id('vet', 'resource_id'), quantity: 1 },
    ]);
  });

  it('remaps legacy logical account references to company-owned accounts', () => {
    const copies = planTemplateCopies(
      [
        { table: schema.glAccountMaster, rows: [{ gl_account_id: 'account' }] },
        {
          table: schema.itemMaster,
          rows: [
            {
              item_id: 'item',
              inventory_gl_account: 'account',
              cogs_gl_account: 'account',
            },
          ],
        },
        {
          table: schema.resourceMaster,
          rows: [{ resource_id: 'resource', gl_cost_account: 'account' }],
        },
      ],
      'company',
    );
    const account = copies.find((copy) => copy.originalId === 'account')!.row
      .gl_account_id;
    expect(account).not.toBe('account');
    expect(
      copies.find((copy) => copy.originalId === 'item')!.row,
    ).toMatchObject({
      inventory_gl_account: account,
      cogs_gl_account: account,
    });
    expect(
      copies.find((copy) => copy.originalId === 'resource')!.row
        .gl_cost_account,
    ).toBe(account);
  });

  it('rejects a reference to a missing or inactive template rather than sharing its identity', () => {
    expect(() =>
      planTemplateCopies(
        [
          {
            table: schema.itemMaster,
            rows: [{ item_id: 'item', category_id: 'inactive-category' }],
          },
        ],
        'company',
      ),
    ).toThrow('active tenant template');
  });

  it('remaps recipe ingredients to company-owned formula and item copies', () => {
    const copies = planTemplateCopies(
      [
        {
          table: schema.itemMaster,
          rows: [{ item_id: 'feed' }, { item_id: 'maize' }],
        },
        {
          table: schema.feedFormulaMaster,
          rows: [{ formula_id: 'recipe', target_item_id: 'feed' }],
        },
        {
          table: schema.feedFormulaIngredients,
          rows: [
            { ingredient_id: 'line', formula_id: 'recipe', item_id: 'maize' },
          ],
        },
      ],
      'company',
    );
    const recipe = copies.find((c) => c.originalId === 'recipe')!;
    const maize = copies.find((c) => c.originalId === 'maize')!;
    const line = copies.find((c) => c.originalId === 'line')!;
    expect(line.row.company_id).toBe('company');
    expect(line.row.formula_id).toBe(recipe.row.formula_id);
    expect(line.row.item_id).toBe(maize.row.item_id);
  });

  it('creates independent identities and remaps category trees and item references', () => {
    const root = {
      category_id: 'root',
      company_id: null,
      category_code: 'ROOT',
    };
    const copies = planTemplateCopies(
      [
        {
          table: schema.itemCategoryMaster,
          rows: [root, { category_id: 'child', parent_category_id: 'root' }],
        },
        {
          table: schema.itemMaster,
          rows: [{ item_id: 'item', category_id: 'child', item_code: 'FEED' }],
        },
      ],
      'company',
    );
    const [parent, child, item] = copies;
    expect(parent.row.category_id).not.toBe('root');
    expect(parent.row.company_id).toBe('company');
    expect(child.deferred.parent_category_id).toBe(parent.row.category_id);
    expect(item.deferred.category_id).toBe(child.row.category_id);
    expect(root.company_id).toBeNull();
    expect(item.row.item_code).toBe('FEED');
  });

  it('defers cyclical stage transitions without disabling foreign keys', () => {
    const copies = planTemplateCopies(
      [
        {
          table: schema.stageMaster,
          rows: [
            { stage_id: 'one', next_stage_id: 'two' },
            { stage_id: 'two', next_stage_id: 'one' },
          ],
        },
      ],
      'company',
    );
    expect(copies[0].row.next_stage_id).toBeNull();
    expect(copies[0].deferred.next_stage_id).toBe(copies[1].row.stage_id);
    expect(copies[1].deferred.next_stage_id).toBe(copies[0].row.stage_id);
  });

  it('preserves global taxonomy and resets company number counters independently', () => {
    const inputs = [
      {
        table: schema.noSeries,
        rows: [
          {
            id: 'series',
            current_seq: 99,
            prefix: 'FARM',
            nob_id: 'livestock',
          },
        ],
      },
    ];
    const one = planTemplateCopies(inputs, 'one')[0].row;
    const two = planTemplateCopies(inputs, 'two')[0].row;
    expect(one.current_seq).toBe(0);
    expect(one.nob_id).toBe('livestock');
    expect(one.prefix).toBe('FARM');
    expect(one.id).not.toBe(two.id);
    expect(inputs[0].rows[0].current_seq).toBe(99);
  });

  it('adopts into an existing company: matches rows it already has by code, copies the rest onto its own rows (20 Oct)', () => {
    const plan = planTemplateAdoption(
      [
        {
          table: schema.itemCategoryMaster,
          rows: [{ category_id: 't-feed', category_code: 'FEED' }],
        },
        {
          table: schema.itemMaster,
          rows: [
            { item_id: 't-grower', item_code: 'GROWER', category_id: 't-feed' },
            { item_id: 't-piglet', item_code: 'PIGLET', category_id: 't-feed' },
          ],
        },
      ],
      [
        {
          table: schema.itemCategoryMaster,
          rows: [
            {
              category_id: 'c-feed',
              category_code: 'FEED',
              company_id: 'company',
            },
          ],
        },
        {
          table: schema.itemMaster,
          rows: [
            { item_id: 'c-grower', item_code: 'GROWER', company_id: 'company' },
          ],
        },
      ],
      'company',
    );

    // FEED and GROWER exist in the company: matched, not copied.
    expect(plan.identities.get('item_category_master:t-feed')).toBe('c-feed');
    expect(plan.identities.get('item_master:t-grower')).toBe('c-grower');
    // PIGLET is copied, pointing at the company's own category.
    expect(plan.copies.map((c) => c.originalId)).toEqual(['t-piglet']);
    const piglet = plan.copies[0];
    expect(piglet.row).toMatchObject({
      company_id: 'company',
      item_code: 'PIGLET',
    });
    expect(piglet.row.item_id).not.toBe('t-piglet');
    expect(piglet.row.category_id ?? piglet.deferred.category_id).toBe(
      'c-feed',
    );
    expect(plan.identities.get('item_master:t-piglet')).toBe(
      piglet.row.item_id,
    );
  });

  it('keys a stage by its line of business and code, a breed and the parameters by their codes', () => {
    expect(naturalKey(schema.stageMaster)).toEqual(['lob_id', 'stage_code']);
    expect(naturalKey(schema.itemMaster)).toEqual(['item_code']);
    expect(naturalKey(schema.breedMaster)).toEqual(['breed_code']);
    expect(naturalKey(schema.parameterMaster)).toEqual(['parameter_code']);
    expect(naturalKey(schema.qcParameterMaster)).toEqual(['param_code']);
  });
});
