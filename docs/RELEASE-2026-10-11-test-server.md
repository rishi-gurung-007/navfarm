# Test-server release 2 — feed workbook completion (11 Oct 2026)

Follows `docs/RELEASE-2026-10-10-test-server.md`. That release took every tenant to migration **164**. This release
takes every tenant to **173**. Release commit: GitHub `main` at or after the commit that adds this runbook. **Migrate, never rebuild**: the
testers' data must survive.

## What changes in the databases (9 migrations, all additive — nothing dropped)
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

Run the migrations as **root**. If any line says FAILED: stop, restore that database from the backup, and report it.
Do not re-run blindly, because MySQL table changes are not transactional.

## Steps (Command Prompt, repository root)
1. Stop the API and web. List tenants: `SELECT tenant_code, db_name FROM nf_master.tenant_master`.
2. Back up every NAVFarm database with `mysqldump --single-transaction --routines --triggers` into `C:\navfarm-backups`.
3. Update the code: `git pull --ff-only origin main`, then `pnpm install --frozen-lockfile` (adds the `@nestjs/schedule`
   package). Check `git log --oneline -1` shows the commit that adds this runbook or later.
4. Migrate: `pnpm nx run api:db-bootstrap`, then `pnpm nx run api:db-migrate-all-tenants`. Every tenant must end at
   **173**. Check:
   `SELECT COUNT(*), MAX(id) FROM nf_portatestnavfarm.__drizzle_migrations` → 173 / 173.
5. Data scripts, per tenant. Run read-only first (it prints a plan), then add `-- --apply` only if the plan lists rows:
   ```
   set DEV_TENANT_DATABASE=nf_portatestnavfarm
   pnpm nx run api:db-fix-feed-requisition-received
   pnpm nx run api:db-fix-requisition-farm
   pnpm nx run api:db-split-comma-serial-layers
   pnpm nx run api:db-fill-service-line-descriptions
   ```
   Repeat for `nf_devco`.
6. Scheduler: it is **off** unless the API's environment has `FEED_SCHEDULER_ENABLED=true`. Turn it on only when you
   want the Wednesday plan, Friday/Saturday reminders, diet-change and stock-take-due notices to run. Its days and times
   come from Feed Planning Settings, in the company time zone.
7. Build: `pnpm nx run api:build --skipNxCache` and `pnpm nx run web:build --skipNxCache`. Start the API, check
   `/api/v1/health`, then start the web.
8. Smoke test as a Porta tester. Their farms, batches and stock are intact. Open Feed Forecast (all tabs), Requisition,
   the Location Master silo record, Breed Lifecycle, Alert Rules and Reporting Periods.

## Rollback
Stop the API and web, restore each database from its step-2 dump, check out the previous commit (`214b2a9f`, release 1),
then rebuild and start.
