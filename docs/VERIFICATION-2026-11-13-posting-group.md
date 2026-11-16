# Posting Group setup — verification (13 Nov 2026)

Design: `superpowers/plans/2026-11-13-posting-group-setup.md`. Groups hold the accounts; an item picks one; the item keeps a synced copy of the accounts so the posting paths are untouched.

## Built
- Migration `0250_gl_posting_group` (journalled, applied to nf_devco and nf_system): table, `item_master.posting_group_id`, and a data step that built one group per distinct set of accounts the items carried (12 BIOLOGICAL; no INVENTORY, no item had stock accounts). A stray `gl_posting_group` of the reverted design was replaced. Single-item groups are named after their item.
- API `finance/gl-posting-group` (list, one, create, update, retire, restore) on the GL Mapping permission. Item create/update take `posting_group_id`; the item list rows carry `posting_group_accounts` and `bio_costing_locked`.
- Screens: Finance, Posting Groups; on the Item, a single Posting Group dropdown on the Accounting tab (inventory groups for stock, biological groups for an animal item) and the group's accounts read-only. The six animal pickers and the inventory/COGS pickers are gone from the item form.

## Proved on the running app (nf_devco dumped before, restored after; only audit_log, user_master, user_session differ)
create group 201; duplicate code 409; biological group with an inventory account 400; link a stock item to a group (item columns equal the group's, in MySQL); an account sent that contradicts the group 400; changing a group's account moves its item's column; delete a group in use 400; a biological item to an inventory group 400; a charged group's accounts cannot change (names the item); rename of a charged group 200; dropping a required account 400. Browser: Posting Groups list (12), Add Item and Edit Item Accounting tab (group, lock note, accounts).

## Not done / open
- Items are Business Central-owned (BBP-1 §1.5); inventory and COGS accounts are listed as BC fields. Moving stock items to groups is the user's decision; confirm with Rishi that NAVFarm may set them.
- No INVENTORY group exists yet; none of the 51 items had stock accounts.
- A biological item with a costing method is not forced to pick a group (the existing missing-account check still stands).
- `gl_posting_group` has no service spec; the rules have (8 tests) and the flows were proved live.
- Seed: setup wizard now numbers starter GL mappings (separate change, same day).
- API suite: 6 failures, all present before (animal-stage-history, breeding.controller, farm-scope-coverage for fa-conversion.controller). Nothing is committed.
