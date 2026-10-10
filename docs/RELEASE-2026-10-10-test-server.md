# Test-server release — feed forecast + requisitions (10 Oct 2026)

Target: the Windows RDP test server (layout in `docs/deploy-rdp-windows.md`). Release commit: GitHub `main` at or after
`f13a04cc`. **Testers' data must survive — migrate, never rebuild.** Never run `db-rebuild-demo` or any `seed-*demo*`
/ `align-requisition-demo-data` script on this server.

## What changes in the databases
- Tenant schema goes from the server's current journal (134/135, GitHub numbering) to **164**: 22–30 additive migrations
  (feed planning settings, forecast runs, stock count, common requisition, transfer shipment/receipt events, requisition
  line batches, mill/bin, feed plan versions, consolidation, loading sheets). Nothing is dropped.
- The migration script refuses any database on a different lineage (it checks the journal and `feed_loading_sheet`), so
  a wrong database is refused, not damaged.
- Three migrations create triggers → run migrations as **root** (or set `log_bin_trust_function_creators=1`).
- Migration 0139 is **not safely re-runnable** if it fails half-way (MySQL DDL is non-transactional). If any migration
  fails: stop, restore that database from the backup below, report. Do not re-run blindly.

## Steps (PowerShell, repository root, as the admin user)

1. **Stop** API and web (Ctrl+C in their windows, or stop the services); confirm ports 2877 and 3002 are free.
2. **List tenants** (new tester tenants may have appeared):
   ```
   mysql -u root -p -e "SELECT tenant_code, db_name FROM nf_master.tenant_master"
   ```
3. **Back up every NAVFarm database** (nf_master, nf_system and every db_name above), e.g.:
   ```
   mysqldump -u root -p --single-transaction --routines --triggers --result-file=C:\navfarm-backups\nf_portatestnavfarm-20261010.sql nf_portatestnavfarm
   ```
4. **Record the current journal** of each tenant (expected 134 or 135) and check none has `feed_loading_sheet`:
   ```
   mysql -u root -p -e "SELECT COUNT(*), MAX(id) FROM nf_portatestnavfarm.__drizzle_migrations; SHOW TABLES FROM nf_portatestnavfarm LIKE 'feed_loading_sheet';"
   ```
5. **Update code**: `git status --short` (keep any server-only changes), then
   `git fetch origin`, `git switch main`, `git pull --ff-only origin main`, `pnpm install --frozen-lockfile`.
   Confirm `git log --oneline -1` shows `f13a04cc` or later.
6. **Migrate** (in this order; read the output for any `FAILED` or `REFUSED`):
   ```
   pnpm nx run api:db-bootstrap
   pnpm nx run api:db-migrate-all-tenants
   ```
   Every tenant must print "migrations applied". Re-check step 4: each tenant now at **164**, and both triggers exist:
   `SHOW TRIGGERS FROM <db> LIKE 'inventory_%';` → `trg_inventory_ledger_entry_no`, `trg_inventory_application_entry_no`.
7. **Data alignment, per tenant** — set the tenant, run each script **read-only first** (prints a plan), read it, then
   `--apply`. They are idempotent and refuse non-local hosts.
   ```
   $env:DEV_TENANT_DATABASE="nf_portatestnavfarm"
   pnpm nx run api:db-seed-feed-mill-location-types            # adds MILL / BIN location types
   pnpm nx run api:db-seed-feed-mill-location-types -- --apply
   pnpm nx run api:db-align-requisition-permissions            # requisition rights for roles — check the role codes it names exist in this tenant
   pnpm nx run api:db-align-requisition-permissions -- --apply
   pnpm nx run api:db-fix-requisition-farm                     # usually "nothing to do" on a tenant with no old requisitions
   pnpm nx run api:db-split-comma-serial-layers                # repairs any "SN1,SN2" stock layer
   pnpm nx run api:db-fill-service-line-descriptions
   ```
   Apply the last three only if their plan lists rows. Repeat for each tenant (`nf_devco`, `nf_system` as applicable).
   `align-feed-tdd` takes `--tenant=<db>`: run it read-only and apply only if it lists feed settings to carry over.
8. **Build**: `pnpm nx run api:build --skipNxCache` and `pnpm nx run web:build --skipNxCache`.
9. **Start** API, check `http://127.0.0.1:2877/api/v1/health`, then start web and check the proxied health.
10. **Smoke test as a tester**: log in; open Inventory & Stock → Feed Forecast (Dashboard, Calculation, Feed Plan, Compare
    Report, Requisition, Mill Consolidation, Loading Instructions, Physical Count) and the top-level Requisition page;
    confirm existing tester records (farms, batches, stock) are still there.

## Rollback
Stop API/web; restore each database from its step-3 dump (`mysql -u root -p <db> < file.sql`); `git switch --detach`
to the previous commit (`2b521466` was the last before today's UI work; the server's previous release was `df638eb7`);
rebuild and start.

## After the release (not needed for it)
- Testers who will use the mill flow need: a MILL location with BIN children, Diet No. on feed items, BIN Diet
  Assignments, and Feed Planning Settings — entered through the app (Farm Master / Settings), not by script.
- Not yet on `main`: Scheduler/email and Monthly Stock Take + Period Close (separate branches, still to be reviewed).
