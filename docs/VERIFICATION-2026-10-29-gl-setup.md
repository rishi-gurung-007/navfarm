# Verification: GL mapping by transaction type and entry type

> **30 Oct 2026: the transaction type master was removed.** An earlier version of this change added `gl_transaction_type_master` (migration 0233) and a GL Transaction Types screen. Both are gone: a G/L Mapping is set up by Inventory Ledger transaction type and entry type, and nothing else. The postings below that exercised the master were not repeated for the new design; what was re-checked is listed under "After the master was removed".

## What shipped

- **0232** adds `gl_mapping_master.entry_type`, a sixth lookup dimension (NULL = any entry type). Existing mappings keep matching what they matched before.
- The GL Mapping screen offers the ten `INVENTORY_TRANSACTION_TYPES` (PURCHASE, CONSUMPTION, OUTPUT, TRANSFER_SHIPMENT, TRANSFER_RECEIPT, SALES, VARIANCE_POSITIVE, VARIANCE_NEGATIVE, OVERHEAD, DESCRIPTIVE) and the five `INVENTORY_ENTRY_TYPES`.
- The API refuses a new mapping for any other transaction type, and an entry type the transaction type is never written with (`ENTRY_TYPES_BY_TRANSACTION_TYPE`: a PURCHASE is only POSITIVE; a TRANSFER_SHIPMENT is TRANSFER or NEGATIVE). Rules: `gl-mapping.rules.ts`.
- Mappings that already exist for other types (the MORTALITY, variance and BIO_* ones the batch and animal postings look up by name, seeded at setup) keep posting and can still be edited without changing their type. They can no longer be **created** from the screen.

## Entry type decides the accounts (run 29 Oct, goods receipts through the API, scratch MySQL, read from `journal_line`)

PURCHASE, entry type POSITIVE, 10 kg x 5. The existing PURCHASE mapping is pinned on NOB and LOB (score 2); the test mappings were cloned from it with `entry_type` set, so they score 3.

| Receipt | Mappings live | Posted |
|---|---|---|
| GR-000030 | PURCHASE (any) | Dr 1010 / Cr 2010 |
| GR-000031 | + PURCHASE/POSITIVE, Dr 1040 | **Dr 1040** / Cr 2010 |
| GR-000032 | + PURCHASE/NEGATIVE, Dr 5020 | **Dr 1040** / Cr 2010 (a NEGATIVE rule is not used for a POSITIVE row) |
| GR-000033 | POSITIVE rule deleted through the API | Dr 1010 / Cr 2010 |

An entry-type mapping on its own (score 1) loses to a mapping pinned on NOB and LOB (score 2): **an entry-type mapping must repeat the NOB and LOB of the mapping it overrides.**

## After the master was removed (30 Oct)

- `api:test` for finance, journal, tenant migrations and setup-wizard: 212 passed. New: `gl-mapping.rules.spec.ts`, and the guard `gl-mapping-transaction-types.spec.ts` (the screen offers exactly the inventory types and entry types; every type the services post under still has a starter mapping).
- Web: the Add GL Mapping form opened in the running app with Transaction Type and Entry Type; the Transaction Type list shows the inventory options. `web:typecheck` passes.
- **Not re-run:** posting after the removal, and saving a mapping from the form. The dev database does not have 0232 yet, so the GL Mappings list returns 500 there until it is migrated.

## Found and not fixed

- The seeded demo NOB/LOB ids (`50000000-5000-5000-5000-00000000000N`) are not valid under `@IsUUID()`, so `POST /gl-mapping` with those ids is refused. The test mappings above were cloned in SQL for that reason.
- `farm-scope-coverage.spec.ts` fails on `piggery/animal/fa-conversion/fa-conversion.controller.ts` (the FA conversion work already in the tree).
- `api:typecheck` reports constructor-argument errors in other specs (`batch-shed.spec.ts` and similar); web has two failing suites (`breeding-rules.spec.ts`, `animal-details-modal.spec.tsx`) in files this change does not touch.
