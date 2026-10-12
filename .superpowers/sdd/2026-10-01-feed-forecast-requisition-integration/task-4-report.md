# Task 4 implementation report — persisted forecast runs

## Outcome

Implemented Task 4 on `feat/feed-forecast-requisition-integration`. Ordinary
`GET /feed-forecast` remains read-only and response-compatible. An explicitly
authorized `POST /feed-forecast/runs` now creates an append-only header and
dated-line snapshot in one tenant transaction, with a farm-local version
stream serialized by locking the exact FARM row before reading the latest
version. Run history is tenant/company/LOB/farm scoped. Matching editable feed
requisition drafts can retain durable run/run-line provenance, while approved
and pending requisitions are not selected for mutation.

Implementation commit:
`aba55858cc292f24d1abdd98a699b2527df94dc6`

The evidence report is committed separately so it can contain the immutable
implementation commit SHA above.

## Interfaces delivered

- Schema declarations for append-only `feed_forecast_run` and
  `feed_forecast_run_line`, including unique `(farm_id, version)` and
  `(company_id, run_code)` keys. No migration SQL or journal was created.
- `FeedForecastRunService.createRun(input, output, actor)` returns
  `{ runId, runCode, version }`.
- `GET /feed-forecast/runs?farmId=...` lists the selected farm's saved versions.
- `GET /feed-forecast/runs/:id` returns a scoped header plus its dated lines.
- `POST /feed-forecast/runs` recalculates and explicitly saves the normalized
  displayed forecast. It requires `INVENTORY/LEDGER/create`; history and the
  ordinary forecast require `INVENTORY/LEDGER/view`.
- Run headers snapshot tenant/company/farm, planning date, normalized view and
  range, nullable Reporting Period, source cutoff, effective configuration
  values/version/hash, creator, creation time and farm-local version.
- Run lines snapshot date, batch, nullable shed/destination/current item,
  required item, heads/rate, opening/receipt/demand/closing quantities,
  shortage/recommended/required-on values and detached provenance. Missing
  mandatory audit values are rejected before insert.
- Requisition and line declarations now include restrictive foreign-key links
  to the persisted run and run line. Auto-draft lookup only accepts an exact
  tenant/company/farm/planning-date/CUSTOM-range match and takes the newest
  matching version.
- The Forecast panel has an explicit, create-authority-gated **Save Run**
  action and farm-scoped run history. Page load and filter changes only issue
  reads. Task 3's draft Reporting Period generation and active-period flow are
  preserved.

## Changed files

- `apps/api/src/core/database/schema.ts`
- `apps/api/src/modules/inventory/feed-forecast/dto/feed-forecast.dto.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.module.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.save-run.spec.ts`
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts`
- `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- `apps/web/src/components/console/inventory/feed-forecast-run-history.tsx`
- `apps/web/specs/feed-forecast-panel.spec.tsx`
- `apps/web/specs/feed-forecast-run-history.spec.tsx`
- `apps/web/src/utils/translations.ts`

## TDD evidence

All commands were run from the isolated Task 4 worktree.

### Initial run boundary and service

1. RED:
   `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast-run.rules|feed-forecast.controller'`
   — 2 suites failed: the rules module did not exist and
   `controller.saveRun` did not exist. The ordinary-GET read-only regression
   already passed (1 passing test).
2. GREEN: the same command — 2 suites, 5 tests passed.
3. RED:
   `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast-run.service'`
   — 1 suite failed because the run service module did not exist.
4. GREEN: the same command — 1 suite, 5 tests passed.
5. RED:
   `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast.save-run'`
   — 1 test failed because `FeedForecastService.saveRun` did not exist.
6. GREEN combined boundary:
   `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast-run|feed-forecast.controller|feed-forecast.save-run'`
   — 4 suites, 11 tests passed.

### Requisition provenance and approved immutability

1. RED:
   `pnpm nx test api -- --runInBand --testPathPatterns='feed-requisition.service'`
   — 1 failed, 24 passed. A new draft still held only the legacy timestamp key
   and had no persisted run/run-line IDs. The companion approved-rerun
   non-mutation case passed.
2. GREEN: the same command — 1 suite, 25 tests passed.

### History UI and action authority

1. RED:
   `pnpm nx test web -- --runInBand --testPathPatterns='feed-forecast-(panel|run-history)'`
   — 2 suites failed: the history component did not exist and the panel had no
   Save Run action; the panel's prior 23 tests passed.
2. Initial GREEN: the same command — 2 suites, 25 tests passed.
3. RED authority regression:
   `pnpm nx test web -- --runInBand --testPathPatterns='feed-forecast-panel' -t='keeps run history visible'`
   — 1 failed, 2 passed, 23 skipped because Save Run remained visible to a
   view-only user.
4. GREEN authority regression: the same command — 1 suite passed, 3 matched
   tests passed, 23 skipped.
5. Final GREEN after the added authority case:
   `pnpm nx test web -- --runInBand --testPathPatterns='feed-forecast-(panel|run-history)'`
   — 2 suites, 26 tests passed.

### Concurrent allocation and complete audit rows

1. RED:
   `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast-run.rules|feed-forecast-run.service'`
   — 1 suite failed and 1 passed; 1 test failed and 9 passed. The snapshot
   builder accepted a line missing `confirmedReceiptKg`.
2. GREEN: the same command — 2 suites, 10 tests passed. This slice includes a
   stateful overlapping `Promise.all` test proving two same-farm saves persist
   versions 1 and 2 and distinct run codes, plus the independent-farm stream
   case.

### Final focused GREEN

- `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast-run|feed-forecast.controller|feed-forecast.save-run|feed-requisition.service'`
  — 5 suites, 41 tests passed.
- `pnpm nx test web -- --runInBand --testPathPatterns='feed-forecast-(panel|run-history)'`
  — 2 suites, 26 tests passed.

## Broader verification

- `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast|feed-requisition|farm-scope-coverage'`
  — 146 suites, 1,698 tests passed (the workspace Jest configuration expanded
  this pattern to the complete API suite).
- `pnpm nx test web -- --runInBand --testPathPatterns='feed-forecast|role-permissions-coverage|nav-scope-consistency'`
  — 75 suites, 443 tests passed (complete web suite under this configuration).
- `pnpm nx run-many -t typecheck -p api web` — both projects passed. API output
  was served from the verified Nx cache on the final combined run; an explicit
  `pnpm nx typecheck api` immediately beforehand also passed.
- `git diff --check` — passed with no output.
- `pnpm nx lint web` — nonzero inherited branch baseline: 999 findings,
  93 errors and 906 warnings. No reported error is in a Task 4 file.
- Focused ESLint over the five changed Task 4 web files — 0 errors,
  19 warnings. Focused ESLint over the new run rules/service files after the
  only two `prefer-const` findings were corrected — 0 errors, 23 warnings.

One intermediate API typecheck intentionally recorded during cleanup failed
with `TS2322`: TypeScript does not narrow several object properties after
data-driven indexed validation loops. The fix retains the runtime validation
and explicitly types the already-validated row; rerunning the exact
`pnpm nx typecheck api` command passed.

## Self-review

- Confirmed `GET /feed-forecast` neither invokes the run service nor changes
  its response shape; the internal daily result is returned only to the
  explicit save path.
- Confirmed the stable farm row is locked with `FOR UPDATE` before the latest
  run version is read, including when no earlier run exists. Header and lines
  use the same existing tenant transaction and there is no update/delete run
  API.
- Confirmed list/create/detail all pass tenant and company IDs through exact
  FARM lookup, apply fixed farm/area scope, and add the restricted LOB predicate.
  Unauthorized detail is normalized to not-found to avoid leaking existence.
- Confirmed approved and pending requisitions are never selected as the
  editable `AUTO_DRAFT`; no code updates their headers or lines. A current
  editable auto-draft may refresh its links when its calculated lines refresh.
- Confirmed task-owned schema changes only; no SQL, Drizzle journal, seed,
  server, database or `nf_devco` changes were made.
- Confirmed Task 3's Reporting Period draft generation copy/action and
  active-only lookup remain covered by the complete API/web suites.
- Reviewed all changed paths for Task 4 ownership and found no unrelated mill,
  physical count, common requisition, BC, animal, breeding, costing or posting
  work.

## Assumptions and concerns

- Repository search found no approved Feed Forecast Run Number Series. The
  implementation therefore follows the brief's fallback and uses the stable
  technical code `FFR-${farmId}-${version.padStart(6, '0')}`. This is not
  presented as client numbering truth. A later client-facing number convention
  needs Rishi's decision and a separately approved series.
- The Save Run authority is `INVENTORY/LEDGER/create`; viewing forecast/run
  history remains `INVENTORY/LEDGER/view`. The web action uses the same split.
- An `AUTO_DRAFT` is treated as editable and may refresh to the newest exact
  matching run. All non-editable statuses preserve their original links.
- Task 12 must create/apply the physical migration before these declarations
  can be used against a database. Per the hard boundary, no running app or DB
  write verification was performed in Task 4.
- The branch-wide web lint count is above the 85-error baseline documented in
  `AGENTS.md`; those errors pre-existed Task 4 in shared Task 1–3 files. Task 4
  adds no lint error, but the branch owner should retain the count as an
  integration concern.

---

## Independent-review remediation — 1 October 2026

Review findings Important 1–5 and the Minor history finding were corrected in:

`188ad11c98e1f64120eba973716a72169aa96e2a`

### Corrected interfaces and invariants

- A save obtains `CURRENT_TIMESTAMP` from the tenant database inside the same
  transaction that loads and persists the forecast. This timestamp records
  when the evidence was captured; it is not claimed to fence mutable tables.
- Deterministic reconstruction comes from the new non-null
  `feed_forecast_run.source_snapshot`: `{ version, hash, values }`, where
  `values.engineInput` is a detached, canonical copy of the complete
  `ForecastInput` passed to the pure engine. It includes the calculated dates,
  batch/stage segments, heads, lifecycle rates, location/silo allocation,
  stock balances, incoming movements, levels, items and lead time. The SHA-256
  hash is an equality check in addition to that stored payload, not a
  substitute for it. Detail reads return the stored payload rather than
  consulting current master or ledger data.
- The engine now calculates `shortageDate` independently as the first date on
  which demand exceeds available opening stock. D19 low-level `runDownDate`
  remains unchanged for display/refill planning and is retained in line
  provenance; persisted `shortage_date` and requisition first-shortage use the
  true insufficiency date. The new internal evidence is stripped from ordinary
  GET source rows so the existing response shape stays compatible.
- A requisition links to a saved run only if tenant/company/farm/date filters,
  the exact engine-input hash, all requisition settings and the live system
  balance used by the draft match. Every dated run-line ID contributing to an
  aggregate destination/item line is stored together. Linkage is all-or-none:
  a missing contributor or a retained farm-edited line detaches the editable
  header and line provenance. Non-editable/approved requisitions remain outside
  the rerun mutation path.
- `feed_forecast_run.created_by` is non-null and both save service boundaries
  refuse a missing authenticated user before forecast/database reads. No
  system identity was invented.
- The concurrency double now admits both transaction callbacks before either
  proceeds, then applies a mutex only to the selected farm row. It asserts
  same-farm versions `1/2` with one active same-farm lock and different-farm
  versions `1/1` with two simultaneously active farm locks. This is an honest
  transaction/row-lock mock, not a live two-connection database test.
- Run history keys loaded data to the farm. A farm change synchronously hides
  the prior rows and renders a loading state until the new request resolves.
- Schema coherence uses the requisition header as the sole relational run FK.
  Aggregate line evidence is a JSON list of contributing run-line IDs, so
  there is no independently mutable single-line FK that can contradict the
  header. Task 12 still owns the corresponding physical migration.

### Review-fix changed files

- `apps/api/src/core/database/schema.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.walk.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.sources.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast.save-run.spec.ts`
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts`
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts`
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts`
- `apps/web/src/components/console/inventory/feed-forecast-run-history.tsx`
- `apps/web/specs/feed-forecast-run-history.spec.tsx`
- `apps/web/src/utils/translations.ts`

No migration SQL/journal, seed, demo data, server or database was changed or
run.

### Review-fix TDD evidence

Focused RED was captured before implementation:

- `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast.engine.walk|feed-forecast-run.rules|feed-forecast.save-run|feed-forecast-run.service|feed-requisition.service'`
  — 5 suites failed; 10 tests failed and 57 passed. Failures proved the engine
  had no independent insufficiency date, run lines saved low-level run-down as
  shortage, saves used application wall-clock time and had no complete source
  payload, creator remained nullable, and requisitions accepted stale source
  evidence/one arbitrary dated line.
- `pnpm nx test web -- --runInBand --testPathPatterns='feed-forecast-run-history'`
  — 1 suite failed; 1 test failed and 1 passed because the previous farm row
  remained visible after switching farms.
- The prior concurrency test itself was the defect: its transaction-wide gate
  made `Promise.all` sequential, so production could not produce a meaningful
  RED. It was replaced rather than presenting that false green as concurrency
  evidence.

Focused GREEN after the complete fix:

- `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast.engine.walk|feed-forecast.engine.sources|feed-forecast-run.rules|feed-forecast.save-run|feed-forecast-run.service|feed-forecast.service|feed-requisition.service'`
  — 8 suites, 167 tests passed.
- `pnpm nx test web -- --runInBand --testPathPatterns='feed-forecast-run-history'`
  — 1 suite, 2 tests passed.
- Final post-review boundary:
  `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast.service|feed-forecast.save-run|feed-forecast-run.service|feed-requisition.service'`
  — 5 suites, 130 tests passed.

Additional focused regressions prove that the source payload is detached from
later input mutation and returned on historical detail; current ledger changes,
missing aggregate contributors and mixed kept/editable lines detach run
provenance; exact matching aggregates retain all contributing line IDs; and
ordinary GET omits persistence-only evidence.

### Review-fix broader verification

- `pnpm nx test api -- --runInBand` — 146 suites, 1,708 tests passed.
- `pnpm nx test web -- --runInBand` — 75 suites, 444 tests passed. The final
  repeat used verified Nx cache output; the same 75/444 suite had run directly
  earlier in this remediation.
- `pnpm nx run-many -t typecheck -p api web` — both projects passed.
- `git diff --check` — passed with no output.
- `pnpm nx lint api` — inherited nonzero branch baseline: 2,595 findings,
  4 errors and 2,591 warnings. Focused ESLint on all review-fix API files:
  0 errors, 149 warnings (existing project warning rules/test idioms).
- `pnpm nx lint web` — inherited nonzero baseline: 999 findings, 93 errors and
  906 warnings. Focused ESLint on the changed history spec/component and
  translations: 0 findings.

### Review-fix self-review and remaining concerns

- Confirmed ordinary `GET /feed-forecast` remains a read-only path and neither
  returns the persistence-only source snapshot nor changes its prior source
  field shape. Only explicit `POST /feed-forecast/runs` persists.
- Confirmed version/header/lines are still one tenant transaction, the stable
  farm row is locked before the version read, and no run update/delete path
  exists.
- Confirmed create/list/detail scope checks and Task 3 Reporting Period behavior
  remain covered by the complete suites.
- Confirmed the technical fallback `FFR-${farmId}-${version}` remains the only
  run code because no approved client-facing series exists. This is documented
  technical identity, not client numbering truth.
- A live DB/two-connection check was intentionally not run because the task
  prohibits tenant/database/server actions. The corrected mock demonstrates
  transaction overlap and per-farm locking; Task 12 migration/application must
  still be followed by database-level verification in an authorized task.

---

## Second independent-review remediation — 1 October 2026

The remaining persisted-output linkage finding was corrected in:

`9a554537cbaad62e5fa96e0eef0585e6253984da`

### Corrected output-evidence contract

- `feed_forecast_run.output_snapshot` is a required JSON header value with the
  stable version `forecast-run-lines:v1`, a SHA-256 hash and the contributor
  count. The hash input is the canonical, order-independent multiset of every
  material `ForecastRunLineSnapshot` field. Volatile database run-line IDs,
  run/header identity and creation timestamps are deliberately excluded.
- A run computes that snapshot from the exact detached line objects used for
  the immutable line inserts. The persisted run lines remain the complete
  historical output evidence; the hash is an integrity/equality check and is
  not represented as sufficient reconstruction data by itself.
- Requisition auto-drafting now performs a three-way equality gate before it
  attaches provenance: the stored header snapshot must equal the freshly
  computed forecast output and must also equal a new hash/count recomputed from
  every stored run line. The run-line query reads every material field, not
  only destination/item identifiers. A version, hash, count, value or
  contributor mismatch returns no matching run, so the requisition header and
  every line remain detached.
- Exact matches still preserve every contributing dated run-line ID for each
  aggregate destination/item requisition line. Existing all-or-none behavior,
  live-balance/config/input checks and edited-line detachment remain in place.

### Changed files

- `apps/api/src/core/database/schema.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.spec.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.ts`
- `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.spec.ts`
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts`

No migration SQL/journal, seed, demo data, running server or database was
changed or run.

### Focused RED evidence

- `pnpm nx test api -- --runInBand --testPathPatterns='feed-requisition.service' -t='older engine output|partial multiset'`
  — the older-engine case failed with the expected behavioral mismatch: the
  new requisition received `feed_forecast_run_id: "run-old-engine"` instead of
  `null` (1 failed, 29 skipped). Nx's shell forwarding also interpreted the
  pipe and emitted `/bin/sh: partial: command not found`; the partial case was
  therefore rerun separately rather than counting this malformed combined
  invocation as its evidence.
- `pnpm nx test api -- --runInBand --testPathPatterns='feed-requisition.service' '-t=partial.*multiset'`
  — 1 suite failed; 1 test failed and 29 were skipped. A persisted one-line
  subset of the expected two-line multiset incorrectly attached
  `run-partial` instead of returning a null run link.
- `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast-run.rules' '-t=material run-line multiset'`
  — 1 suite failed; 1 test failed and 5 were skipped because
  `buildOutputSnapshot` did not exist.

These failures were captured before the output-snapshot implementation. The
test fixtures derive their expected versioned SHA-256 independently of the
production helper.

### Focused GREEN evidence

- `pnpm nx test api -- --runInBand --testPathPatterns='feed-requisition.service' '-t=older.*engine.*output'`
  — 1 test passed and 29 were skipped.
- `pnpm nx test api -- --runInBand --testPathPatterns='feed-requisition.service' '-t=partial.*multiset'`
  — 1 test passed and 29 were skipped.
- `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast-run.rules' '-t=material.*multiset'`
  — 1 test passed and 5 were skipped.
- `pnpm nx test api -- --runInBand --testPathPatterns='feed-forecast-run.rules|feed-forecast-run.service|feed-requisition.service'`
  — 3 suites, 46 tests passed on the final post-implementation run.

### Broader verification

- `pnpm nx typecheck api` — passed.
- `pnpm nx test api --skipNxCache -- --runInBand` — 146 suites, 1,711 tests
  passed in an uncached final run.
- `git diff --check` — passed with no output before the implementation commit.
- `pnpm nx lint api --skipNxCache` — inherited nonzero baseline: 2,594
  findings, 4 errors and 2,590 warnings. The four errors are outside Task 4 in
  `goods-receipt.service.spec.ts`, `animal.dto.ts` (two), and
  `batch.service.ts`.
- Focused ESLint over the seven changed files — 0 errors and 78 warnings; no
  Task 4 lint error was introduced.

### Self-review, assumptions and concerns

- Confirmed output equality covers the entire dated-line multiset and all its
  material numeric, identity, date and provenance values. Removing a line,
  changing an engine result while preserving the input hash, or mutating a
  persisted material value causes detachment.
- Confirmed ordinary `GET /feed-forecast` is untouched and remains read-only
  and response-compatible. Only explicit Save Run persists the new header
  snapshot.
- Confirmed the saved hash is created inside the existing atomic run
  transaction from the same normalized lines inserted immediately afterward;
  immutable versioning, farm lock allocation and creator requirements are
  unchanged.
- Confirmed requisition provenance stays all-or-none. When output verification
  fails, neither the header run FK nor any aggregate run-line ID list is
  attached.
- Existing physical databases do not yet have `output_snapshot`. Per the task
  boundary, this change is a schema declaration only; Task 12 must add and
  apply the migration before database/runtime verification is authorized.
- Pre-versioned historical runs without an `output_snapshot` deliberately do
  not qualify for new requisition linkage. No output hash is guessed or
  backfilled, and no client-facing number-series behavior changed.
