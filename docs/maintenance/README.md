# Maintenance SQL

One-off clean-up scripts for a specific database and date. Not part of the
build, not run by anything automatically — paste them into a MySQL client.

Each is written against **`nf_portatestnavfarm`** (the Windows test server).
Change the `USE` line for any other database, and read what the read-only step
prints before running the step that writes.

## 2026-10-15 — purge test animals and the items left behind

**Run them in this order.** The items are blocked by the animals:
`animal_register.item_id` is one of the 30 `ON DELETE RESTRICT` references to
`item_master`, so an item that is still some animal's item cannot be deleted.
`ITM-0008` is exactly that — it is `P25003`'s item.

1. **`2026-10-15-delete-animals.sql`** — deletes P25003, P26302, P2975,
   DLNA8228 and the eleven kinds of child row that block them.
2. **`2026-10-15-purge-disabled-items.sql`** — deletes disabled items, but
   *only* those nothing references. It probes all 30 referencing columns and
   prints a DELETABLE / IN USE verdict per item first.

Both scripts: read-only steps first, writes inside a transaction, and the
working tables dropped at the end.

### Things worth knowing

- **"Disabled" is not one flag.** The app's Delete is a soft delete
  (`is_active=0, status='INACTIVE', deleted_at=NOW()`), but an item created
  from a template starts as `is_active=0, status='DRAFT'` — unfinished, not
  deleted. There is also `is_blocked`. Step 1 of the item script counts all
  four so the set is chosen deliberately.
- **`item_code` is not unique.** The same code exists per company. Match on
  `item_id`, never on code.
- **The item script uses `zz_` regular tables, not temporary ones.** MySQL
  cannot reference a temporary table more than once in a statement
  (`ERROR 1137: Can't reopen table`) and the audit references it thirty times.
  Step 4 drops them.
- **Journals survive.** `journal_header` links by `source_document_type` /
  `source_document_no` with no foreign key, so GL postings for deleted animals
  remain and balances still include them.
- **Deleting is not what the app does.** Dispose (animals) and the soft delete
  (items) are the supported routes, and they keep the accounting straight. A
  hard delete suits a throwaway test database only.
