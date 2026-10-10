# Final UAT integration — progress record (2026-10-10)

Workspace: `/Users/nero/Desktop/navfarm-final-uat`
Branch: `integration/feed-forecast-final-uat-20261010`
Base commit: `b2be0a03` (tip of `integration/feed-forecast-main-20261009`, preserved as the recovery checkpoint)

Everything below was verified on this machine, not carried over from an
earlier agent's summary. Where a prior claim turned out to be wrong it is
marked **corrected**.

## Verified about the handoff's claims

| Claim | Verdict |
|---|---|
| `b2be0a03` contains both streams | True. Real merge; parents `1c3af137` (feed forecast) and `28db5c11` (= `origin/main` tip). `git merge-base --is-ancestor` passes for both; 0 commits of main missing. |
| Earlier integration commits `30ac230f`, `3fb035c7` | **Corrected** — not separate commits. Branch reflog shows both are amend-predecessors of the same merge. |
| 142 historical + 22 new = 164 journal entries | True. idx 0–141 historical (last `0141_inventory_ledger_line` @ `1792000000010`); idx 142–163 new; latest `1792000000032`. |
| Migration filename gap 0142–0164 | Intentional and consistent. Tag `0153` never existed; 22 SQL files match 22 journal entries. No migration should be invented to close it. |
| Drizzle ignores stored hashes when selecting replays (§5.4) | True, verified in installed drizzle-orm 0.45.2 `mysql-core/dialect.cjs:46-74`: selects `order by created_at desc limit 1` and replays only when `created_at < folderMillis`. Hash is written, never compared. **Historical hashes must not be rewritten.** |
| Migration preflight/lineage guard exists | True — `migrate-all-tenants.ts:52-70`. Verified it refuses both retained Mac DBs: `nf_devco` and `nf_system` are both at journal id 156, so neither matches `canonicalBaseline` or `canonicalComplete`. |
| Codex's UAT isolation guard was "partially implemented" | **Corrected — it did not exist.** `/private/tmp/navfarm-integration.AdoH3N` was reaped, its surviving git index diffs clean against `b2be0a03`, and the tree contains no allowlist/fail-closed DB logic. Written from scratch here. |
| Previous rehearsal results | Corroborated. `nf_integration_windows_20261009b` and `nf_integration_windows_pop_20261009` both hold 137 tables, 164 journal rows, max id 164, max created_at `1792000000032`. |
| MySQL 8.4 | **Corrected** for this machine: local server is MySQL **9.7.1** (Homebrew). The Windows server may still be 8.4. |

## The isolation blocker — cause and fix

Cause (verified, not inferred):
1. `apps/api/src/config/database.config.ts` defaults to `root` / empty password / `localhost`.
   `root@localhost` with no password **works** on this machine and reaches every
   retained database — including the unrelated **`navcrm_*`** application's.
2. `tenant.middleware.ts` resolves a tenant from the master registry and
   `connection-manager.service.ts` opens a pool with whatever `db_name` the row
   carries, with no validation. Retained `nf_master.tenant_master` maps
   `devco → nf_devco` and `system → nf_system`, both as `root`.
3. `ConnectionManagerService` caches pools by `tenant_id` only.

Every runtime DB path was enumerated (§12.1). The API has exactly **two**
connection sites — `database.module.ts` (master) and
`connection-manager.service.ts` (tenant). The only boot-time query is
`setup-wizard.service.ts.onModuleInit` reading `plan_master` through the master
connection; the other two `onModuleInit`s register in-memory handlers only.
There are no cron/queue workers, and `apps/web` has no DB access at all
(API-only via `NAVFARM_API_UPSTREAM_URL`). So guarding those two sites covers
the whole runtime.

Fix — two independent layers:

- **Code (fail-closed, opt-in):** `core/database/database-allowlist.ts`.
  `NAVFARM_DB_ALLOWLIST` unset → inactive, production startup unchanged. Set →
  every database the API opens must be named in it. Set-but-empty refuses
  everything. Enforced in the master factory and, deliberately *ahead of the
  cache*, in `getTenantConnection`. Also added to the four scripts used here
  (`migrate-master`, `migrate-all-tenants`, `bootstrap-database`,
  `seed-dev-tenant`) — proven necessary: before the guard, `migrate-master`
  happily built 15 tables in a database the allowlist forbade.
- **Engine (grants):** account `nf_uat` has `USAGE ON *.*` plus `ALL` on only
  the three disposable databases. Verified it cannot read `nf_devco`,
  `nf_master`, `nf_system`, `tenant_devco` or `navcrm_auth` (all ERROR 1142),
  and cannot create a database outside its grants (ERROR 1044).

## Disposable UAT environment

| Database | Purpose | State |
|---|---|---|
| `nf_uat_master_20261010` | master registry | 15 tables, 6 master migrations |
| `nf_uat_system_20261010` | system tenant | 137 tables, journal 164 |
| `nf_uat20261010` | synthetic business tenant | provisioned via `seed-dev-tenant` |

Named `nf_<code>` on purpose: other scripts recompute `nf_${tenantCode}`, so a
db_name that disagrees with the convention would break them.

Credentials live only in `apps/api/.env` in this worktree (gitignored,
chmod 600) and are synthetic. Registry rows were repointed from `root` to
`nf_uat` — `tenant_master.db_user` defaults to `root`, so leaving it would have
opened tenant pools as superuser and defeated the grant layer.

Full canonical lineage applied from empty: **137 tables / 164 journal rows /
max_id 164** — identical to the Windows-restore rehearsal, independent
corroboration that both paths converge on the same schema. Both entry-number
triggers (`trg_inventory_ledger_entry_no`, `trg_inventory_application_entry_no`)
exist.

## Findings worth acting on

1. **Migration 0139 is not retry-safe.** MySQL DDL is non-transactional and
   drizzle wraps the whole run in one transaction, so when its `CREATE TRIGGER`
   failed, the `entry_no` column stayed added, the trigger was absent, and no
   journal row was written — the retry then died on a duplicate column and the
   database needed a manual reset. Relevant to the populated rehearsal (§16/11)
   and to invariant §9/13.
2. **The migration set cannot be applied by a least-privileged account.**
   `CREATE TRIGGER` fails with ERRNO 1419 `ER_BINLOG_CREATE_ROUTINE_NEED_SUPER`
   (`log_bin=1`, `log_bin_trust_function_creators=0`). Here the schema build
   runs as `root` under the fail-closed allowlist, and only the app runtime uses
   `nf_uat`. Whoever migrates the Windows server needs the same privilege split.
3. **Registry passwords are stored in plaintext** (`tenant_master.db_password`,
   varchar(200)). Pre-existing design, noted not changed.
4. ~70 scripts under `apps/api/src/scripts/` open their own connections; four
   hardcode retained targets (`backfill-animal-age-at-entry.ts`,
   `align-demo-bbp-masters.ts` → `nf_devco`; `seed-breed-lifecycle-stages.ts`
   → `localhost/root`; `align-stages-to-tdd.ts` defaults to `nf_devco`). None
   are part of the API runtime. Not run, not modified.

## Hierarchy (§1.1) as actually implemented

`operational_area_master` has `company_id`, `farm_id` (FK → `location_master`)
and `lob_id` (FK → `lob_master`). There is no `farm_master`; a farm is a
`location_master` row of type `FARM`. So an area row is one configured
operating unit per (company, farm, LOB) — exactly the distinction §1.1 draws
between a classifying LOB master and a configured operating unit. "Operational
Area: Piggery → Farms A/B/C" is therefore several area rows sharing the piggery
`lob_id`, not a parent row owning farms. No extra level was introduced.

## P0 — every nx task runs in the main checkout (root cause found)

The session environment carries an override that is in no shell profile:

```
NX_WORKSPACE_ROOT_PATH=/Users/nero/Desktop/navfarm
```

`nx/dist/src/utils/workspace-root.js` returns it as the first action of
`workspaceRootInner()`, before any upward search for `nx.json`. So **every** nx
invocation — from this worktree, from a fresh clone anywhere on disk, daemon on
or off, `--skip-nx-cache` or not — executes its tasks with cwd inside
`/Users/nero/Desktop/navfarm`. Proven by overriding the target's own command:

```
nx run api:build --command='sh -c "echo CWD=$(pwd)"'
→ CWD=/Users/nero/Desktop/navfarm/apps/api      # invoked from a clone under /private/tmp
```

Consequences, all observed here:

- `nx build api` printed `webpack compiled` and `Successfully ran target build`
  while writing the bundle into the **main** checkout's `apps/api/dist`. This
  worktree got no artifact, and the artifact that did exist was compiled from
  main's sources. A constant build hash across different commits is the tell.
- **The isolation guard appeared to fail when it had simply never been
  deployed.** The first strong negative test opened a real `root → nf_devco`
  connection because the running binary was the main checkout's build. The
  process was stopped per §12.3 and `nf_devco` verified unmodified: journal
  still 156 rows / max_id 156 (identical to the session-start reading) and no
  row created today across 92 tables. The request was a `GET` that failed at
  the JWT guard — one failed read, no writes.
- It also explains the two earlier incidents recorded against this workspace
  (worktree test runs reporting the main checkout's failures, and
  `db-migrate-all-tenants` "succeeding" without applying 0144): both ran
  against main's files, not the worktree's.

**I initially mis-diagnosed this** as an `nx`/`@nx/webpack` defect and reported
the API build as broken on `origin/main` — wrong: all three "reproductions"
were quietly building the main checkout. Nothing is wrong with the build target.

Strip the override and nx works correctly:

```
env -u NX_WORKSPACE_ROOT_PATH NX_DAEMON=false npx nx build api --skip-nx-cache
env -u NX_WORKSPACE_ROOT_PATH NX_DAEMON=false npx nx build web --skip-nx-cache
```

Verified in this worktree: API `dist/main.js` 10,159,198 bytes containing this
branch's guard, and a fresh web `BUILD_ID`. The shipping API bundle was then
booted and smoke-tested — login succeeded and every live connection was
`nf_uat` on a disposable database.

**Verify the artifact, not the exit code.** "Successfully ran target build" was
printed repeatedly while producing nothing in this tree.

## Runtime isolation — proven

With the correctly built binary:

- Master connection logs `nf_uat@127.0.0.1:3306/nf_uat_master_20261010`.
- Login as the synthetic tenant admin succeeds and issues a token for the
  synthetic tenant (Codex's session issued an `nf_devco` token — that is fixed).
- `GET /location` → 200 against the disposable tenant.
- Every live connection the API process holds, read from
  `information_schema.processlist`: `nf_uat → nf_uat_master_20261010` and
  `nf_uat → nf_uat20261010`. Nothing retained.
- Negative, weak form: `x-tenant-id: devco` and the retained tenant UUID → 400,
  no connection attempted.
- Negative, strong form: a registry row planted in the disposable master
  pointing at `nf_devco` with `db_user=root` → **refused**, 0 connections to
  `nf_devco`, log shows `Refusing to connect to database 'nf_devco' … not on
  NAVFARM_DB_ALLOWLIST`. The row was then removed. (It surfaces as HTTP 500,
  an unhandled error — loud and fail-closed, not a graceful status.)

## P1 — the merge broke every receipt (found, fixed, proven)

`transfer_receipt_line.remarks` was declared in `schema.ts` and created by no
migration on any branch. Drizzle builds an insert's column list from the schema
and emits `default` for omitted columns, so the statement named `remarks`
whether the code set it or not, and **every** Common Requisition and Feed
Requisition receipt failed against real MySQL with `Unknown column 'remarks'
in 'field list'` (errno 1054).

Provenance — a merge-resolution hand-edit, not either stream's work:

| Commit | `transferReceiptLine` |
|---|---|
| `28db5c11` upstream main | table absent entirely (shipment/receipt events are a feed-branch feature) |
| `1c3af137` feed forecast | table present, **no** `remarks`, `serial_no varchar(100)` |
| `b2be0a03` the merge | `remarks: text(...)` added, `serial_no` widened to `text` |

Neither artifact is used anywhere: `remarks` is read and written nowhere, and
`serial_no: text` contradicts migration 0146, the sibling
`transferShipmentLine.serial_no`, and the DTO's `@MaxLength(100)`. Both were
reverted to what 0146 creates, rather than adding a migration for a column
nothing uses.

A full schema-vs-database audit found this was the **only** drift: 0 missing
tables, 1 missing column, across the canonical database and the
Windows-restored rehearsal database alike — so the test server would have hit
it too.

`schema-migration-drift.spec.ts` now guards the class: it reads the migrations
in journal order and fails when the schema declares a column they never
produce. Its parser was validated against the live database — both report
exactly one drifted column and nothing else, so it is not guessing. (It checks
column existence, not types; the `serial_no` width was caught by hand.)

**2,690 unit tests passed over this bug** because they mock the database. This
is the project's documented lesson repeating itself, and the reason §14/§15
demand real-database E2E.

## Common Requisition E2E — PASS (real MySQL)

Opening stock created through the app's own path (`ADJ-000001`, 100 KG @ 2.50),
then:

| Step | Result |
|---|---|
| Create | `REQ-2026-0001` OPEN |
| Submit | PENDING_APPROVAL |
| Approve | APPROVED |
| Release | `TR-000001`, RELEASED / TRANSFER_OPEN |
| Shipment | `SH-2026-0001`, 50 KG, transfer IN_TRANSIT, requisition SHIPPED |
| Partial receipt | `RC-2026-0001`, 25 KG, both PARTIALLY_RECEIVED |
| Final receipt | `RC-2026-0002`, 25 KG, requisition RECEIVED, transfer POSTED |

Ledger (read from MySQL): entries 1–4, `entry_no` unique, rate 2.50 carried
throughout. Source 50 KG @ 125.00, destination 50 KG @ 125.00, against 100 KG
@ 250.00 opening — quantity and value both conserved.

Refusals, each leaving no ledger, shipment or receipt row:

- over-receipt 30 KG against 25 outstanding → "Receipt quantity exceeds the
  remaining quantity to receive."
- duplicate shipment → "Shipment quantity exceeds the remaining balance to ship."
- duplicate receipt after completion → "Stock Transfer TR-000001 cannot take a
  further shipment or receipt — it is already POSTED."

The earlier 500 on the first receipt attempt rolled back cleanly — no ledger
row, no receipt row — which is the atomicity §9/13 asks for.

## Fixture notes (for whoever rebuilds this)

- `seed-dev-tenant` leaves masters tenant-wide (`company_id IS NULL`), but
  requisitions require `item_master.company_id = companyId` (a deliberate
  cross-company leak guard, `requisition.service.ts:344`), and
  `assertItemTypeExists` requires the same of item types. The fixture therefore
  needs `adopt-company-master-templates.ts` (dry-run default; `--apply` needs a
  real backup) — 152 company-scoped copies, with existing stock references
  redirected onto them.
- That adoption rewrites role/permission rows and **invalidates live sessions**:
  the next call returned 401 "Invalid session token" until re-login.
- `mysqldump` needs RELOAD/FLUSH_TABLES, which the least-privileged account
  correctly lacks — take backups as an admin account.

## Verification results (this checkout, measured here)

| Check | Result |
|---|---|
| API regression | **213 suites, 2,693 tests passed** |
| Web regression | **108 suites, 827 tests passed** |
| API typecheck (`tsc --build`) | exit 0, no output |
| Web typecheck (`next typegen` + `tsc --noEmit`) | exit 0, no output |
| API build (`nx build api`, override stripped) | real bundle, 10,159,198 bytes, contains this branch's guard |
| Web build (`nx build web`, override stripped) | succeeded, fresh `BUILD_ID` |
| Shipping API bundle boots and serves | login OK, `GET /location` 200, connections `nf_uat` on disposable DBs only |

Baseline accounting against the handoff's 209 / 2,680: +3 suites / +10 tests
for the isolation specs, +1 suite / +3 tests for the drift guard. Web matches
the handoff exactly. No assertion was weakened and no suite skipped.

Run tests with jest directly — `apps/web` must run from `apps/web` because
`next/jest` resolves `dir: './'` against the CWD. Anything run through nx needs
`env -u NX_WORKSPACE_ROOT_PATH`, per the P0 above.

## Status

Done: git verification; isolated worktree; isolation guard (code + grants, 10
unit tests); disposable master/system/tenant databases; synthetic tenant with
company, piggery operational area, farm, warehouse, silo, shed and four users.

Done: git verification; isolated worktree; isolation guard (code + grants)
proven against a running API; disposable master/system/tenant databases;
synthetic tenant (company, piggery operational area, farm, warehouse, silo,
shed, four users, company-scoped masters); the P1 receipt fix and its drift
guard; the Common Requisition E2E; full regression and both typechecks.

Remaining: Feed Requisition E2E (§15 — forecast → plan → requisition →
consolidation → loading → transfer → receipts → forecast reconciliation); the
populated migration rehearsal with representative pre-upgrade data (§16); and
browser smoke tests (§17).

Commits on this branch: `47f64d9b` (isolation guard), `a147ec61` (receipt fix
and drift guard).
