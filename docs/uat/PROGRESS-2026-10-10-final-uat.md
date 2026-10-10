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

## P0 — nx builds in a worktree compile the WRONG checkout

Discovered while proving the runtime, and it invalidates more than this session.

`npx nx build api` run from `/Users/nero/Desktop/navfarm-final-uat` wrote its
output into **`/Users/nero/Desktop/navfarm/apps/api/dist/`** (the dirty root
worktree). Invoking `webpack-cli` directly with the nx task env wrote to the
UAT `dist/` but **compiled the root worktree's sources**: the bundle contained
none of this branch's code (`grep -c NAVFARM_DB_ALLOWLIST dist/main.js` → 0)
and webpack resolved modules from `../../../navfarm/node_modules`. The build
hash was byte-identical across runs, so it was deterministically building the
wrong tree. `NxAppWebpackPlugin` normalizes `main: './src/main.ts'` against a
project-graph workspace root that resolves to the root worktree; killing the
root worktree's nx daemon did not change it, and the UAT worktree's dependency
tree is self-contained, so the daemon was not the cause.

Consequences:

- **The isolation guard appeared to fail when it had simply never been
  deployed.** The first strong negative test opened a real `root → nf_devco`
  connection because the running binary was the root worktree's build. The
  process was stopped per §12.3 and `nf_devco` verified unmodified: journal
  still 156 rows / max_id 156 (identical to the session-start reading) and no
  row created today across 92 tables. The request was a `GET` that failed at
  the JWT guard — one failed read, no writes.
- **Any "passing" result obtained through an nx target inside a worktree is
  suspect**, including the handoff's 209-suite / 2,680-test API baseline if it
  was produced that way. It may have exercised a different checkout.

Workarounds used here, both verified to read UAT sources:

- Build: `npx tsc -p tsconfig.app.json --emitDeclarationOnly false
  --declaration false --declarationMap false --composite false --outDir dist`
  (the base tsconfig sets `emitDeclarationOnly`, hence the overrides). Verified
  the guard is present in `dist/core/database/*.js` before trusting the binary.
- Tests: `npx jest --config apps/api/jest.config.cts` directly — confirmed
  reading UAT sources, since it discovers spec files that exist only here.

**Verify the artifact, not the exit code.** "Successfully ran target build" was
printed twice while producing either nothing or the wrong tree.

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

## Status

Done: git verification; isolated worktree; isolation guard (code + grants, 10
unit tests); disposable master/system/tenant databases; synthetic tenant with
company, piggery operational area, farm, warehouse, silo, shed and four users.

Next: prove runtime identity through the app's own connections; negative
isolation test with a retained tenant id; then the database-backed Common
Requisition and Feed Requisition E2E, the populated migration rehearsal, and
full regression.
