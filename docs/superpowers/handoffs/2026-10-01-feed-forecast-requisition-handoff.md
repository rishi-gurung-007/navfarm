# Feed Forecast and Requisition Agent Handoff

**Prepared:** 2026-10-01  
**Repository:** `/Users/nero/Desktop/navfarm`  
**Observed branch:** `fix/series-and-item-kinds-batch`  
**Observed HEAD:** `c9886e85a26b2cfb8bd771716fb3a380cd56d7ca`

## Read first

1. `AGENTS.md`
2. `docs/decisions.md`, especially the 30 Sep and 1 Oct feed entries
3. `docs/superpowers/specs/2026-10-01-feed-forecast-requisition-integration-design.md`
4. `docs/superpowers/plans/2026-10-01-feed-forecast-requisition-integration.md`
5. `.superpowers/sdd/2026-10-01-feed-forecast-requisition-integration/progress.md`
6. `git status --short` and `git log --oneline -25`

The earlier `2026-09-25` through `2026-09-27` feed plans describe already
implemented foundations. Use them for history and test intent. Do not restart
those plans or interpret their unticked boxes as unfinished work.

## Current status

- Design decisions: complete.
- Design/spec document: complete.
- Executable implementation plan: complete.
- Feature implementation (Tasks 1–11): complete and committed across `feat/feed-forecast-requisition-integration`.
- Additive migrations (Task 12): 0135–0140 authored, tested, and rehearsed with 100% data preservation.
- Full verification (Task 13): complete; report documented in `docs/VERIFICATION-2026-10-01-feed-forecast-requisition-integration.md`.
  - API tests: 161 suites / 1,918 tests passed uncached.
  - Web tests: 78 suites / 466 tests passed uncached.
  - Typecheck: 0 errors across `api`, `web`, `web-e2e`.
  - Web lint: exactly 93 errors (0 new errors, baseline maintained).
  - Production builds: `api:build` and `web:build` succeeded cleanly.
- Test-server migration: BLOCKED on verified backups, tenant/data inventory and explicit application approval from Rishi.


## What already exists and must be preserved

- Many-to-many `silo_shed_link` topology and item-aware silo routing.
- Ledger-derived feed stock and shared inventory/GL posting.
- Daily feed engine with lifecycle rows, head counts, stock walk, run-down,
  refill/required-on dates and 45-day validation.
- Daily, weekly, Reporting Period and custom forecast views.
- Reporting Period Master, although generated rows currently become active and
  must be corrected to inactive drafts.
- In-app feed alerts.
- Feed requisition auto-draft/manual entry, submit, approval inbox and decision.
- Basic common requisition header/lines.
- Atomic stock transfer with lot/serial copying.
- Four-farm illustrative topology fixture and safe seed conventions.

## Confirmed gaps

- No `FARM_MANAGER` user type.
- Alert configuration still contains the legacy string `HEAD_OF_FARM`.
- No typed company feed schedule/threshold settings record.
- Base currency exists, but user-selected local currency and a reusable current
  rate resolver are incomplete.
- `nf_devco` has no company-currency-config rows or exchange-rate rows.
- No persisted forecast-run header/lines.
- No feed-specific physical-count/variance transaction.
- Generated Reporting Periods are active immediately.
- Feed requisition is not yet a tab under Feed Forecast.
- Common requisition lacks the supplied complete fields and separate approval,
  release and fulfilment states.
- Stock Transfer posts shipment and receipt together; staged partial events do
  not exist.

## Decisions that must not be reopened silently

- `FARM_MANAGER` is distinct from `STANDARD_USER`.
- Head of Farms is the UI/business name for stored type
  `OPERATIONAL_ADMIN`; its farm reach is the authorized active LOB/area.
- Base and local currencies are user-selected company settings.
- Current rate = newest `rate_date`, then newest `created_at`.
- Finance percentage escalation is absolute variance `>= 5.00%`.
- Monetary threshold remains null until Triple C supplies it.
- Friday 18:00 reminder, Saturday 12:00 cutoff, Sunday 08:00 count and
  `Africa/Harare` are Triple C's initial configuration, not hard-coded rules.
- Approval precedes Release.
- Manual self-approval is forbidden.
- System feed draft may follow the approved Farm Manager path.
- Feed stops at Approved while mill execution is absent.
- Purchase release records `BC_PENDING`; no BC success is simulated.
- Silo setup belongs in Location/Feed Planning; remove the duplicate screen only
  after parity is proven.
- Reporting Period generation creates inactive drafts.

## Migration ownership and safety

The repository currently ends at tenant migration 0134; local journal has 135
entries through timestamp `1792000000003`. One agent must reserve and own all
new migration numbers and `_journal.json` edits. Feature workers may modify
`schema.ts`, but they must not independently generate competing migrations.

Never edit `dist/drizzle`. Review every generated SQL statement. MySQL DDL is
not transactionally rolled back. Do not apply to the test server until Rishi
has supplied and verified backups and the exact tenant/data inventory.

## Work ownership

| Work | Owner files | Coordination rule |
|---|---|---|
| Access/personas | user hierarchy, auth, farm scope, alert role mapping | Finish Task 1 first |
| Settings/currency | feed-settings and currency modules, Company Settings | May not edit migration journal |
| Forecast/count | forecast-run and feed-stock-count modules | Consume Task 2 interfaces |
| Requisition | procurement requisition/feed-requisition and approval handlers | Serial Tasks 7–9 |
| Transfer | stock-transfer and inventory-ledger transfer execution | Starts after Task 9 |
| Web | feed tabs, approvals, transfer UI, roles/nav | Respect API contracts already landed |
| Migration | all tenant SQL/journal files | One owner only, Task 12 |
| Verification | running UI/API/MySQL and final report | No feature fixes mixed into Task 13 |

## Resume protocol

1. Read the progress ledger and find the first task without `complete`.
2. Confirm no other agent owns the same files.
3. Rebase assumptions on current `git status` without discarding user changes.
4. Run the task's focused pre-test or add its failing test.
5. Implement only that task's interface.
6. Run the task verification, inspect the diff and commit explicit paths.
7. Add a progress line:
   `Task N: complete (<sha>, tests: <command> → <result>)`.
8. Record any approved deviation as:
   `Ruling (Task N): <decision and reason>`.
9. Stop at any missing business decision; ask Rishi and update
   `docs/decisions.md` before proceeding.

## Verification expectations

Do not claim completion from source review or unit tests alone. Each posting
task must be driven through its API and inspected in MySQL. Final verification
must cover:

- `STANDARD_USER`, `FARM_MANAGER` and Head of Farms;
- 1:1, one-to-many, many-to-one and many-to-many silo shapes;
- zero, below-5%, exactly-5% and above-5% stock variances;
- base=local, current-rate, missing-rate and duplicate-date rate cases;
- manual self-approval and system-draft approval;
- Purchase `BC_PENDING`, Store shipment/receipt and Direct Transfer;
- partial quantities and lot/serial tracking;
- old URLs and response compatibility;
- unrelated application smoke checks.

## Deferred and intentionally absent

Do not implement mill capacity, consolidation, loading, dispatch, actual BC
calls, Transfer Order sync, SMS/email/WhatsApp or the mill-dependent weekly
Tentative/Actual plan. Preserve stable references for those later phases.

## Immediate next action

1. Request final code review from Rishi for branch `feat/feed-forecast-requisition-integration`.
2. Await verified test-server database backups, tenant inventory review, and explicit application approval from Rishi before unblocking `pnpm nx run api:db-migrate-all-tenants` on the server.
3. Merge `feat/feed-forecast-requisition-integration` into the base branch once approved.

