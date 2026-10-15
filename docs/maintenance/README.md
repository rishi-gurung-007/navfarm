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

All three scripts: read-only steps first, writes inside a transaction, and the
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

## 2026-10-15 — purge disabled locations

**`2026-10-15-purge-disabled-locations.sql`** — the same shape as the item
script, for the eleven rows the Locations grid shows with the toggle off. It
runs on its own; it does not depend on the two above.

`location_master` is referenced far more widely than `item_master` — 49 columns
across 28 tables — and, unlike the items, not all of those references are
RESTRICT. That is the thing to watch:

- **35 RESTRICT** block the delete. STEP 2 probes every one and prints a
  DELETABLE / IN USE verdict per location; STEP 2A says where the kept ones are
  still referenced.
- **11 SET NULL** do not block and do not warn. A requisition that pointed at a
  deleted farm keeps its lines and quantities and silently loses its `farm_id`.
- **3 CASCADE** delete rows you did not ask to delete: `feed_alert` rows for the
  farm, and both sides of `silo_shed_link`.

STEP 2B counts all fourteen before STEP 3 runs, so read it.

### Things worth knowing

- **Four of the RESTRICT columns are `location_master` pointing at itself**
  (`parent_location_id`, `farm_id`, `shed_id`, `warehouse_id`). A disabled
  parent is blocked only by a child that *survives* — a child being deleted in
  the same pass releases it. That is circular, so the self-reference probe runs
  three times, deeper than FARM > SHED > PEN goes. The delete is then ordered
  `location_level DESC` so children go first.
- **Some columns hold a location id with no foreign key at all** —
  `batch_header.sub_location_id`, `batch_stage_log.from/to_location_id`,
  `feed_schedule_log.farm_id`, `inventory_ledger_line.warehouse_id`,
  `semen_batch.warehouse_id`, `approval_request.farm_id`. Nothing blocks the
  delete and nothing repairs them; they are left dangling. STEP 2C lists
  whatever is actually in the database rather than trusting that list.
- **`location_code` is not unique** either. Match on `location_id`.
- **Deleting is not what the app does.** The soft delete
  (`is_active=0, status='INACTIVE', deleted_at=NOW()`) is the supported route
  and it is what every one of these eleven rows already carries. A hard delete
  suits a throwaway test database only.
