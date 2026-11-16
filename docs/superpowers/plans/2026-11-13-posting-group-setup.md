# Posting Group setup (central accounts for items)

Decided with the user on 13 Nov 2026 (after the earlier GL-group build was reverted):

- Accounts are managed centrally in a **Posting Group**; an **item only picks one group** from a dropdown.
- Two kinds of group: **BIOLOGICAL** (asset, accumulated amortization, amortization expense, fair value gain, fair value loss, mortality/impairment loss) and **INVENTORY** (inventory account, COGS account).
- Mortality/impairment belongs on the biological group. Normal items move to groups too.

## Approach: groups hold the accounts, the item keeps a synced copy

The posting paths (goods receipt, costing runs, mortality, reports) read `item_master.bio_*_gl_id`, `inventory_gl_account`
and `cogs_gl_account`. They are the paths that have failed before, so they are **not touched**. Instead:

1. `gl_posting_group` holds the accounts. `item_master.posting_group_id` names the group.
2. Saving an item with a group copies the group's accounts into those item columns, in the same transaction.
3. Saving a group with changed accounts copies them into every item of the group, in one transaction.
4. The item form shows the accounts read-only (from the group); the pickers are gone from the form.

## Edge cases and rules

| Case | Rule |
|---|---|
| Group kind vs item | A biological item takes only a BIOLOGICAL group; a stock item only an INVENTORY group. |
| Costing method | Amortization needs asset, accumulated, expense; Fair Value needs asset and gain (loss optional). The item refuses a group missing them; a group cannot drop an account an item of it needs. |
| Costed animals | Once a costing run has charged an animal of any item of the group, the group's accounts and the item's group are locked (the item's existing costing lock). |
| Stock already posted | Changing an INVENTORY group's accounts is allowed but only affects later postings; the screen says so. |
| Inactive or deleted account | Refused when saving a group. |
| Deleting/deactivating a group | Refused while any active item uses it. |
| Duplicate code | Unique per company. |
| Items with their own accounts today | A one-off data step builds a group per distinct account set and links the items; nothing is lost. Items with no accounts stay ungrouped. |
| Item with no group | Allowed (a new item can be saved first); a biological item with a costing method needs a group or its accounts before a run — the existing missing-account check stands. |
| Concurrency | Group and item saves run in transactions and re-read the group inside. |

## Steps

1. Migration 0250: `gl_posting_group`, `item_master.posting_group_id`, data step.
2. API module `gl-posting-group` and item service link.
3. Screens: Posting Group master; item dropdown plus read-only accounts.
4. Prove on the running app and read MySQL.
