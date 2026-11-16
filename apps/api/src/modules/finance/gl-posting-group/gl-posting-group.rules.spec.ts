import {
  accountsContradictingGroup, accountsOfKind, changedAccounts, groupFitsItem, itemColumnsFromGroup, missingForMethod, validateGroup,
} from './gl-posting-group.rules';

const bio = { kind: 'BIOLOGICAL', group_code: 'G1', asset_gl_id: 'A', accum_amort_gl_id: 'B', amort_expense_gl_id: 'C', writeoff_gl_id: 'W', fv_gain_gl_id: null, fv_loss_gl_id: null };

describe('posting group rules', () => {
  it('a biological group needs the asset account; an inventory group the inventory account', () => {
    expect(validateGroup('BIOLOGICAL', 'G', 'n', {})).toEqual(['A biological group needs the acquisition cost account.']);
    expect(validateGroup('INVENTORY', 'G', 'n', {})).toEqual(['An inventory group needs the inventory account.']);
    expect(validateGroup('INVENTORY', 'G', 'n', { inventory_gl_id: 'I' })).toEqual([]);
  });
  it('refuses the other kind\'s accounts, a missing code and name, and an unknown kind', () => {
    expect(validateGroup('INVENTORY', 'G', 'n', { inventory_gl_id: 'I', asset_gl_id: 'A' })).toEqual(['Acquisition cost account does not belong on a INVENTORY group.']);
    expect(validateGroup('BIOLOGICAL', ' ', '', { asset_gl_id: 'A' })).toEqual(['Enter a group code.', 'Enter a group name.']);
    expect(validateGroup('X', 'G', 'n', {})).toEqual(['Kind must be BIOLOGICAL or INVENTORY.']);
  });
  it('clears the accounts of the other kind', () => {
    expect(accountsOfKind('INVENTORY', { inventory_gl_id: 'I', asset_gl_id: 'A' })).toMatchObject({ inventory_gl_id: 'I', asset_gl_id: null });
  });
  it('a method needs its accounts on the group', () => {
    expect(missingForMethod('AMORTIZATION', { ...bio, accum_amort_gl_id: null })).toEqual(['accum_amort_gl_id']);
    expect(missingForMethod('FAIR_VALUE', bio)).toEqual(['fv_gain_gl_id']);
    expect(missingForMethod(null, {})).toEqual([]);
  });
  it('a group fits an item of its kind with the accounts its method needs', () => {
    expect(groupFitsItem(bio, { is_biological_asset: true, bio_costing_method: 'AMORTIZATION' })).toBeNull();
    expect(groupFitsItem(bio, { is_biological_asset: true, bio_costing_method: 'FAIR_VALUE' })).toMatch(/fair value gain account/);
    expect(groupFitsItem(bio, { is_biological_asset: false })).toMatch(/biological group; a stock item needs an inventory group/);
    expect(groupFitsItem({ kind: 'INVENTORY', group_code: 'I1', inventory_gl_id: 'I' }, { is_biological_asset: true })).toMatch(/inventory group; a biological item/);
  });
  it('copies a group to the item columns by kind', () => {
    expect(itemColumnsFromGroup(bio)).toMatchObject({ bio_acquisition_gl_id: 'A', bio_accum_amort_gl_id: 'B', bio_fv_gain_loss_gl_id: null, bio_writeoff_gl_id: 'W' });
    expect(itemColumnsFromGroup({ kind: 'INVENTORY', inventory_gl_id: 'I', cogs_gl_id: null })).toEqual({ inventory_gl_account: 'I', cogs_gl_account: null });
  });
  it('finds accounts sent that contradict the group, treating blank as null', () => {
    expect(accountsContradictingGroup(bio, { bio_acquisition_gl_id: 'A', bio_fv_gain_loss_gl_id: '' })).toEqual([]);
    expect(accountsContradictingGroup(bio, { bio_acquisition_gl_id: 'Z' })).toEqual(['bio_acquisition_gl_id']);
  });
  it('lists the accounts a save changes', () => {
    expect(changedAccounts(bio, { asset_gl_id: 'A', accum_amort_gl_id: 'X', fv_gain_gl_id: '' })).toEqual(['accum_amort_gl_id']);
  });
});
