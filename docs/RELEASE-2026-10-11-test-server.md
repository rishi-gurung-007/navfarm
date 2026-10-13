# Test-server release 2 — feed workbook completion (11 Oct 2026)

Follows `docs/RELEASE-2026-10-10-test-server.md`. That release took every tenant to migration **164**. This release
takes every tenant to **192** (0165-0179 from main, 0180-0191 from the feat/system-schedulers merge of 13 Oct, 0192 Cost Centre spelling). Release commit: GitHub `main` at or after the commit that adds this runbook. **Migrate, never rebuild**: the
testers' data must survive.

## What changes in the databases (28 migrations, 0165-0192; nothing dropped — 0182, 0189 and 0192 also change data, see their rows)
| Migration | Adds |
|---|---|
| 0165 | Receipt line controls: variance, variance reason, bag count, delivery note, loading sheet ref |
| 0166 | Monthly stock take and period close columns |
| 0167 | Feed scheduler: tentative plan day/time setting and the schedule log table |
| 0168 | Farm/mill cost centre on locations |
| 0169 | Empty bags on daily data |
| 0170 | Effective dates on lifecycle feed rows |
| 0171 | Farm-level override on lifecycle feed rows |
| 0172 | Effective dates on silo–shed links |
| 0173 | Estimated arrival on loading sheets |
| 0174 | BIN diet slot column made optional (Production Slots removed, 11 Oct) |
| 0175 | Breed Lifecycle Stage: nullable `kpi_alert_period` column (Daily/Weekly/Monthly, 12 Oct) |
| 0176 | All ISO countries |
| 0177 | Item Master: nullable `feed_form` column (BULK/BAGGED) on feed items (12 Oct) |
| 0178 | New table `batch_mortality_animal`: which registered animals died on a Data Entry mortality line, with dead weight and reason (12 Oct) |
| 0179 | `batch_mortality_animal.animal_id` may be empty: a count-only batch records each death's dead weight and reason without naming an animal (12 Oct) |
| 0180 | System schedulers: new tables `system_scheduler`, `system_scheduler_line`, `system_scheduler_line_custom_days`; `scheduler_header.system_scheduler_id` |
| 0181 | `batch_transfer.transfer_basis` (ANIMALS / HEADCOUNT); `stage_master.applicable_gender` |
| 0182 | Data repair: the BCS activity's KPI code `BCS` -> `BCS_SCORE`, and BCS lines left on BODY_WEIGHT -> BCS_SCORE / SCORE (posted values untouched) |
| 0183 | `batch_transaction.reversed_at`, `reversed_by` (mortality reversal) |
| 0184 | `farrowing_record.piglet_batch_id`, `piglet_lot_no` |
| 0185 | `semen_batch`: lot no, expiry date, warehouse, QR |
| 0186 | `batch_daily_data.item_id`, `destination_batch_id` (output item, weaning destination) |
| 0187 | `animal_register`: out-of-production date, cull date, exit weight, disposal destination |
| 0188 | `semen_batch`: volume, motility, concentration |
| 0189 | Data: a QR_PACK number series per tenant and per company, counter continuing after the highest existing pack no. (idempotent) |
| 0190 | New table `semen_batch_boar` (pooled semen); `batch_daily_data.pool_animal_ids` |
| 0191 | `batch_daily_data.reason_id` |
| 0192 | Data, text only: the Cost Centre number series renamed "Cost Center Code ..." -> "Cost Centre Code ..." (13 Oct) |

Run the migrations as **root**. If any line says FAILED: stop, restore that database from the backup, and report it.
Do not re-run blindly, because MySQL table changes are not transactional.

## Steps (Command Prompt, repository root)
1. Stop the API and web. List tenants: `SELECT tenant_code, db_name FROM nf_master.tenant_master`.
2. Back up every NAVFarm database with `mysqldump --single-transaction --routines --triggers` into `C:\navfarm-backups`.
3. Update the code: `git pull --ff-only origin main`, then `pnpm install --frozen-lockfile` (adds the `@nestjs/schedule`
   package). Check `git log --oneline -1` shows the commit that adds this runbook or later.
4. Migrate: `pnpm nx run api:db-bootstrap`, then `pnpm nx run api:db-migrate-all-tenants`. Every tenant must end at
   **192**. Check:
   `SELECT COUNT(*), MAX(id) FROM nf_portatestnavfarm.__drizzle_migrations` → 192 / 192.
5. Data scripts, per tenant. Run read-only first (it prints a plan), then add `-- --apply` only if the plan lists rows:
   ```
   set DEV_TENANT_DATABASE=nf_portatestnavfarm
   pnpm nx run api:db-fix-feed-requisition-received
   pnpm nx run api:db-fix-requisition-farm
   pnpm nx run api:db-split-comma-serial-layers
   pnpm nx run api:db-fill-service-line-descriptions
   pnpm nx run api:db-seed-mill-manager-role
   pnpm nx run api:db-seed-departments
   ```
   Repeat for `nf_devco`.
6. Scheduler: it is **off** unless the API's environment has `FEED_SCHEDULER_ENABLED=true`. Turn it on only when you
   want the Wednesday plan, Friday/Saturday reminders, diet-change and stock-take-due notices to run. Its days and times
   come from Feed Planning Settings, in the company time zone.
7. Build: `pnpm nx run api:build --skipNxCache` and `pnpm nx run web:build --skipNxCache`. Start the API, check
   `/api/v1/health`, then start the web.
8. Smoke test as a Porta tester. Their farms, batches and stock are intact. Open Feed Forecast (all tabs), Requisition,
   the Location Master silo record, Breed Lifecycle, Alert Rules and Reporting Periods.

## Seed test master data into a tenant (optional, testing only)
New companies start with blank master data by design. To give a test company a working set, copy the masters of an
existing company (e.g. Triple C in `nf_devco`) into it. The target may be in another tenant database on the same MySQL
server. 
Tenant and company are given as codes (or db name / id): `SELECT tenant_code, db_name FROM nf_master.tenant_master;`
and `SELECT company_id, company_code FROM <db>.company_master;`. `--source-tenant` defaults to `devco`.

Repository root:
```
pnpm nx run api:db-seed-test-masters -- --source-tenant devco --source-company <code> --tenant ppl --company <code>            # plan only
pnpm nx run api:db-seed-test-masters -- --source-tenant devco --source-company <code> --tenant ppl --company <code> --verify   # writes, rolls back
pnpm nx run api:db-seed-test-masters -- --source-tenant devco --source-company <code> --tenant ppl --company <code> --apply
```
It prints a table per master table (rows to copy, rows skipped and why). A table where the target company already has
rows is skipped, so a second run plans nothing. New ids are generated, number series restart at 0, and the target
tenant and company are stamped on every row. References to rows outside the copied set (e.g. an inactive breed) are kept
if they exist in the target database, mapped by code, otherwise set to empty or the dependent row is skipped and
listed. Transactions, users, roles and other companies are never touched. Local database host only.

### Demo feed mill (MILL, BINs, BIN Diet Assignments)
A company with no feed mill shows empty Location (MILL/BIN) and BIN Diet Assignment screens. This creates only what is
missing: the MILL and BIN location types, `MILL-001` (238,000 KG/day: 178,000 bulk + 60,000 bagged), `MILL-001/BIN-001..004`
(30,000 KG each, BULK; the last one BAGGED if the company has a Bagged feed item) and one BIN Diet Assignment per BIN for
today..today+27, taking the feed items of the company's active breed lifecycle stages round-robin (only active items with an
explicit Bulk/Bagged type and a Diet No qualify; others are listed as notes). A second run plans nothing. Plan / `--verify`
(writes, rolls back) / `--apply` as above; local database host only.
```
pnpm nx run api:db-seed-feed-mill-demo -- --tenant ppl --company 00000000-0000-0000-0000-000000000000 --apply
# add --from YYYY-MM-DD --days N to cover earlier production dates (e.g. cloned requisitions)
```
Also run it for devco/TRIPLEC before cloning, so the clones include the mill.

### Clone the whole company, operations included (`--with-operational`)
Add `--with-operational` to copy not just the masters but the company's operational data as well: batches and every
`batch_*` table, schedulers, animals and breeding, stock (inventory ledger, goods receipts, adjustments, transfers,
shipments and receipts), feed (forecast runs, requisitions, plans, consolidations, loading sheets, stock counts, alerts),
journals, bio-asset ledger, approvals, and the operational areas. History and inactive rows are included.
```
pnpm nx run api:db-seed-test-masters -- --source-company <code> --tenant <tenant> --company <code> --with-operational            # plan
pnpm nx run api:db-seed-test-masters -- --source-company <code> --tenant <tenant> --company <code> --with-operational --verify   # writes, rolls back
pnpm nx run api:db-seed-test-masters -- --source-company <code> --tenant <tenant> --company <code> --with-operational --apply
```
Rules:
- **The target company must have no operations yet.** The run refuses if it already has any `batch_header`,
  `inventory_ledger` or `journal_header` row. Any other table in which it already has rows is skipped (listed).
- Everything is written in one transaction in foreign-key order; a failure leaves the target untouched.
- Every row gets a new id; all references are remapped. User columns (`created_by`, `posted_by`, `approved_by`,
  `requester_user_id` ...) become the target company's `COMPANY_ADMIN` user (else the tenant's `TENANT_ADMIN`);
  override with `--as-user <email>`. Users, roles, sessions, audit and notification logs and company configuration are
  never copied.
- Document numbers are kept. Number series and the tenant inventory entry counter keep the source's current values, so
  new postings do not repeat a copied number.
- Ids inside JSON columns (forecast snapshots, protocols, `feed_forecast_run_line_ids`) are remapped when they match a
  copied row; ids that match nothing stay as they were (printed in the summary).
- Inactive masters that an operational row points to are copied too, so history stays consistent.

## Rollback
Stop the API and web, restore each database from its step-2 dump, check out the previous commit (`214b2a9f`, release 1),
then rebuild and start.
