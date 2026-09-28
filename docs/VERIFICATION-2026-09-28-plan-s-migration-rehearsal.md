# Plan S migrations 0122–0126 — rehearsal on a server-like copy

28 Sep 2026. Scratch database `nf_rehearsal_s`, dropped at the end. Nothing
outside it was written; `nf_devco` was read once (`mysqldump`) and is unchanged.

## What was rehearsed

| | |
|---|---|
| copy | `mysqldump nf_devco` (6.1 MB, 118 tables, 11 589 rows) loaded into `nf_rehearsal_s` |
| rolled back to the server's state | `01_roll_to_server_state.sql`: 0122's columns and indexes dropped, `__drizzle_migrations` cut to **122 rows, last 1791135600000** (0121), every silo level cleared, the four ranged durations and the two successors cleared |
| tester-style edge cases | `02_edge_cases.sql`, E1–E9 below |
| migrator | the real one — `drizzle-orm/mysql2/migrator` over `apps/api/src/drizzle/tenant`, called as `migrate-all-tenants.ts` calls it, run twice |
| local MySQL | **9.7.1**; the server runs 8.4 — see *Residual risk* |

**The release is 0122–0126, not 0122–0125.** The plan was written before
0126 (D28, the legacy `storage_type = 'SILO'` rows) was added in Task 20a, so
its expected journal figures were one migration short. Run 1 ends at
**127 rows, last 1791567600000**.

## The edge cases

| | fixture | must happen |
|---|---|---|
| E1 | `VIL100/SILO-001` (cap 12 000) with only a high level, 11 000 | high kept, low filled 2 400 |
| E2 | `VIL100/SILO-002` (cap 20 000) with only a low level, 19 000, above the 90 % default | low kept, high left **empty** (18 000 ≤ 19 000) |
| E3 | `VIL100/SILO-003` with both levels, 1 000 / 5 000 | untouched |
| E4 | a tester's FLUSH duration of 10 on the company copy | kept; the tenant template still gets 14 |
| E5 | a tester's successor GROWER → QUARANTINE on the company copy | kept; the template still gets GROWER → FINISHER |
| E6 | every live animal of `f86b41b4…` moved into pens of one shed (`AI100/SHED-001`) | 0123 (1) sets that shed |
| E7 | `190d0826…` — a batch whose live animals stand in **three** sheds — given a shed by hand | kept, whatever its animals say |
| E8 | the company WEANER made **non-system** with an empty duration and an empty successor | stays empty — 0125 is system-only |
| E9 | `AI100/STORE-001`, a STORE, given the stale `storage_type = 'SILO'` | kept — 0126 excludes SILO and STORE |

`e6_batch` `f86b41b4-53a8-44bc-a68c-65c4ae6c81f7`, `e6_pen`
`322a85b4-7c38-4aa4-9feb-7e7957316351` (`AI100/SHED-001/PEN-001`),
`e7_batch` `190d0826-71ed-49a6-a2b3-abb13d908af8`,
`e9_store` `7b3ef95d-db05-4f63-8c9c-810faf446cf9`.

## Run 1 — `migrate OK  journal 127  last 1791567600000  297 ms`

Rows each statement changed, measured with `ROW_COUNT()` on the same fixture set:

| migration | statement | rows |
|---|---|---|
| 0122 | 4 × DDL (2 columns, 2 indexes) | — |
| 0122 | back-fill `farm_id`, `document_id` on decided feed requisitions | **2** |
| 0123 | (1) shed from the live animals | **1** (E6) |
| 0123 | (2) shed from the scheduler headers | 0 |
| 0124 | high = 90 % of capacity | **50** (53 silos − E1, E2, E3) |
| 0124 | low = 20 % of capacity | **51** (53 − E2, E3) |
| 0125 | the four durations | **7** |
| 0125 | the two successors | **2** (E5 and E8 keep theirs) |
| 0126 | clear the legacy `storage_type` | **248** |

### Nothing else moved

| check | expected | actual |
|---|---|---|
| `diff before-counts.txt after1-counts.txt` | only `__drizzle_migrations`, 122 → 127 | **as expected** — the only line that differs |
| `diff before-checksums.txt after1-checksums.txt` | only `__drizzle_migrations`, `approval_request`, `location_master`, `stage_master`, `batch_header` | **as expected** — the other 113 tables' checksums are identical |
| per-row hashes, `location_master` (all columns but `low_level_kg`, `high_level_kg`, `storage_type`, `updated_at`) | empty diff | **empty**, 697 rows |
| per-row hashes, `stage_master` (all but `typical_duration_days`, `next_stage_id`, `updated_at`) | empty diff | **empty**, 36 rows |
| per-row hashes, `batch_header` (all but `shed_id`, `farm_id`, `updated_at`) | empty diff | **empty**, 24 rows |

`storage_type` is excluded from the location hash because 0126 is entitled to
clear it; its effect is checked row by row below instead.

| table | rows before → after | checksum before | after run 1 | after run 2 |
|---|---|---|---|---|
| `__drizzle_migrations` | 122 → 127 | 3613413200 | 793824261 | 793824261 |
| `approval_request` | 5 → 5 | 2710081066 | 1133622478 | 1133622478 |
| `batch_header` | 24 → 24 | 3831991820 | 468572683 | 468572683 |
| `location_master` | 697 → 697 | 1947422123 | 1069579398 | 1069579398 |
| `stage_master` | 36 → 36 | 4062841082 | 2839082490 | 2839082490 |

### What it did do

| check | expected | actual |
|---|---|---|
| silo levels E1–E3 and a plain silo | 2 400 / 11 000 · 19 000 / — · 1 000 / 5 000 · `SILO-004` 3 000 / 13 500 | **as expected** |
| silos still missing a level | exactly one, E2 | **one**: `VIL100/SILO-002`, 19 000 / NULL |
| FLUSH | company 10 (E4), template 14 | **as expected** |
| DRY_SOW / FARROWING / WEANING | 7 / 3 / 1 in both scopes | **as expected** |
| WEANER → GROWER, GROWER → FINISHER | template both; company GROWER keeps QUARANTINE (E5) | **as expected** |
| the non-system WEANER (E8) | duration and successor still empty | **still NULL / NULL** |
| `e6_batch` | gets the shed of `e6_pen` | **`AI100/SHED-001`** |
| `e7_batch` | unchanged | **unchanged** (`AI100/SHED-001`, set by hand) |
| `620768db…` | — | already had `VIL100/SHED-004` in the dump; unchanged. The plan expected 0123 (2) to set it; on this copy it was set already, so (2) changed nothing |
| the six batches whose live animals are spread over three sheds | still no shed | **all six still NULL**; batches with no shed 22 → 21 |
| `approval_request` FEED_REQUISITION | `farm_id` and `document_id` on every row | **2 of 2** |
| `approval_request` other doc types (FEED_RATION, MEDICINE_REQUISITION, STOCK_TRANSFER) | untouched | **3 rows, 0 filled** |
| legacy `storage_type = 'SILO'` | cleared on PEN/SHED/CRATE, kept on SILO and STORE | **248 cleared** (102 PEN, 89 CRATE, 57 SHED); 53 SILO and the E9 STORE keep it |

## Run 2 — idempotent

`migrate OK  journal 127  last 1791567600000  25 ms`. Counts, every table's
checksum and all three per-row hash files are **byte-identical to run 1**.

## A part-way 0122

0122 is DDL, which MySQL commits statement by statement. Drizzle runs a
release's pending migrations inside one `session.transaction`, but 0122's
`ALTER` and `CREATE INDEX` implicitly commit it and MySQL then returns to
autocommit — so 0123–0126 do **not** roll back whole behind it. Each of their
statements fills a value that is still empty, which is what makes a re-run
safe: a failure leaves the finished ones applied and recorded, and running the
set again completes the rest and changes nothing else. (Corrected after the
final review, M1: the earlier wording claimed the transaction, and the forced
failure below sits inside 0122, so the claim was never tested.) Rehearsed by
copying the migration folder and inserting `SELECT * FROM plan_s_forced_failure;`
after 0122's first `ALTER`:

1. `node run-migrator.cjs nf_rehearsal_s <copy>` → `DrizzleQueryError: Failed query: SELECT * FROM plan_s_forced_failure;`
   State: `farm_id` **present**, `document_id` absent, neither index created, journal **122**.
2. Re-run against the real folder → `Error: Duplicate column name 'farm_id'`. Journal still 122.
3. `ALTER TABLE approval_request DROP COLUMN farm_id;` then re-run →
   `migrate OK  journal 127  last 1791567600000  194 ms`, both columns, both
   indexes, both feed requisitions back-filled.

This third run started from the rolled-back state without the edge cases, so
its silo levels and stage timings hold the plain defaults; `batch_header`'s
per-row hashes are identical to run 1's, and the counts of every table match.

## Residual risk

Rehearsed on MySQL **9.7.1**; the server runs **8.4**. The statements use
multi-table `UPDATE … JOIN`, derived tables in the `FROM` of a join, `<=>`,
`CASE`, `ROUND` and `COALESCE` — all available in 8.0 and unchanged in 8.4.
No window function, no CTE, no `LATERAL`. As in Plan A's rehearsal, the risk
is not zero: it is the risk that an 8.4 optimiser rejects a join shape 9.7
accepts, which would fail the whole migration rather than half-apply it
(0123–0126 are DML and each idempotent), with 0122's DDL recovery above as the
only manual step.

## Afterwards

`DROP DATABASE nf_rehearsal_s`. `nf_devco.__drizzle_migrations` is 123 rows,
`MAX(created_at)` 1791222000000 — what it was before the dump. **The
migrations have not been applied to any real tenant database.**
