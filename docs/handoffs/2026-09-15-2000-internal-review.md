# NAVFarm internal-review handoff — 15 September 2026, 20:00 IST

This handoff covers the deliberately reduced, presentable Piggery review cut.
It does **not** claim that the full production application or all 13 roadmap
phases are complete. The demonstrated paths below are the paths verified for
the internal meeting; unfinished or unsafe paths are named explicitly.

## Repository and running services

- Workspace: `/Users/nero/Desktop/navfarm`
- Branch: `neroen`
- Implementation HEAD before this handoff document: `978adc1`
- Review-cut commits:
  - `620becd` — define the verified 15 September review cut
  - `40ebe1b` — make reporting, Animal, Transfer, Breed, and Batch foundations
    farm-consistent and transactional
  - `f3e9c8c` — show each Breed's actual joined Farm in the master table
  - `978adc1` — make Batch Animals a truthful, read-only review surface
- Nothing was pushed.
- Web: port 3002, PID 34790 at handoff preparation.
- API: port 2877, PID 49796 at handoff preparation, running the rebuilt bundle.
- Do not use `pkill`. Resolve an exact listener PID with `lsof` before stopping
  anything. Leave both services running for the meeting.

## Five-minute meeting route

Use the existing Triple C Company Administrator session in Brave. If a new
login is needed, the account is `company.admin@triplec.local`; passwords are
intentionally not recorded here.

1. Open `/dashboard`.
   - Show Triple C, one Piggery operational area, 27 Animal records, and five
     Batches.
2. Open `/batches` and then **New Batch**.
   - Show explicit Farm, Animal Tracking, and Initial Stage controls.
   - Do not save from the meeting unless every value is a deliberate review
     value. Count Only and Registered Animals are now different creation modes.
3. Open `/master-data/breed`.
   - Show the actual Farm columns: `TN-70-Sow` at `POR100 / KINTYRE ESTATE,
     NORTON`, and `Z-Line-Sow` at `MUL100 / GRASMERE FARM NORTON`.
4. Open `/batches/animals`.
   - It defaults to Registered Batch `PIG-BAT-2026-0101`, showing 22 assigned,
     21 active, and one isolated Animal.
   - The page intentionally does not offer direct assign, unassign, relocate,
     or split controls. Placement changes belong to the Batch Transfer workflow.
   - Selecting a Count Only Batch explains that its headcount lives on the
     Batch record and does not imply individual Animal rows.
5. Open `/finance/bio-asset-reconciliation`.
   - The current statement renders opening 650,000, movements 6,492,250,
     closing 7,142,250, and 14 transactions.
   - A farm-filtered view no longer presents an incomparable company-level GL
     total as if it were a valid reconciliation.

Return to `/dashboard` after the walkthrough. Do not improvise into Breeding,
Daily Entry, or cross-farm Transfer during this review.

## What changed and why

- Financial reporting now applies exact LOB scope and reports GL reconciliation
  as unavailable when the ledger and GL cannot be compared at the same Farm
  dimension.
- Animal creation is atomic with its number, IAS 41 ledger, audit, and readback.
  New Animals must be placed in exactly one valid Batch or Farm location;
  ordinary update routes cannot bypass transfer placement rules.
- Transfer posting rechecks and conditionally claims Registered Animals inside
  the transaction. Missing accounting prerequisites roll back the operation.
  Cross-farm posting is blocked until destination Breed remapping is designed.
- Breed is Farm-scoped, uses the Number Series consistently, cannot be moved to
  another Farm after creation, and is unique by tenant/company/Farm/code.
- Batch creation requires Farm, Animal Tracking mode, and Initial Stage;
  validates every placement reference; creates no invented placeholder Animals;
  and commits all creation work together.
- Batch Animals no longer exposes UI actions which call routes now correctly
  forbidden by placement rules. It shows stored facts without synthetic
  fallback labels.

## Verification evidence

Fresh checks completed against the final implementation:

| Check | Result |
|---|---|
| Full API Jest suite | 79 suites, 997 tests passed |
| Full web Jest suite | 24 suites, 156 tests passed |
| API, web, and web-e2e typechecks | passed |
| API development build | passed |
| Migration `0094_breed_code_per_farm.sql` | applied successfully to `tenant_system` and `tenant_devco` |
| Final API health request | HTTP 200 |
| Live Brave walkthrough | dashboard, Batch list/modal, Breed table, Batch Animals, and IAS 41 statement rendered |
| Final `git diff --check` for UI change | passed |

Final MySQL readback on `tenant_devco`:

- five Batches: two Registered, three Count Only, zero missing Farm;
- 27 Animals, all assigned to a Batch;
- two active Breeds attached to active Farms, with the Farm/code pairs shown in
  the meeting route;
- the new Breed uniqueness index covers tenant, coalesced company, coalesced
  location, and Breed code.

## Honest status against the 13-phase roadmap

- Phase 1, Access Foundation: complete and previously independently reviewed.
- Phase 2, Farm Breeds and Batch Modes: the minimum foundation needed by this
  review is implemented and verified. The phase should not be called fully
  closed until legacy data alignment and the remaining Stage/Breed edge cases
  are resolved.
- Phase 3, deterministic demo-data rebuild: not completed. Existing labelled
  synthetic operational rows remain and are used read-only in the meeting.
- Phases 4–13: contain a mixture of older partial code and unstarted work; they
  have not passed their roadmap acceptance gates.

So the internal-review cut is ready, while the broader MVP is still materially
in progress. Counting only passed roadmap gates, one phase is closed, one is
substantially advanced, and eleven later phases remain unaudited or incomplete.

## Deferred or unsafe paths

Do not represent these as meeting-ready:

- cross-farm Transfer and destination Breed-profile remapping;
- same-farm Transfer where destination Batch Breed differs;
- Batch split Stage selection, which still depends on broader Stage scope
  cleanup;
- creating a new Registered Animal until a deliberate active-Farm Registered
  Batch and its real review facts are prepared;
- Daily Data Entry posting/correction, Breeding traceability, health approval,
  and full lifecycle close;
- Requisition, Feed Forecast, and Resource Ledger;
- tenant-template Stage/Farm alignment and the deterministic review-data rebuild;
- replacement of old synthetic Animal/Batch facts with an agreed review fixture.

Legacy synthetic data is acceptable only when clearly treated as demonstration
data. It must not be described as supplied by Triple C.

## Next ordered work toward 18 September, 10:00 IST

1. Build the deterministic review fixture using the existing read-only /
   `--verify` / `--apply` script convention; create one active-Farm Registered
   Batch and one Count Only Batch without inventing client facts.
2. Live-probe a same-Farm Transfer and verify the Animal claim, Batch counts,
   accounting legs, and rollback behavior in MySQL. Add exact Breed matching.
3. Make Daily Data Entry correction idempotent and transactional, then perform
   one feed/health write with inventory and MySQL readback.
4. Join and verify the existing Breeding chain only after its placement and
   withdrawal implications are checked end to end.
5. Rehearse the full chosen demo route, freeze it, rerun the serial verification
   suite, and update this handoff with new evidence rather than assumptions.

## Machine state

This is an 8 GB machine and memory remains tight. Two confirmed obsolete Claude
worker processes were stopped by exact PID earlier; Brave, VS Code, the API,
and the web server were preserved. At final preparation macOS reported about
70 MB immediately unused and 3.33 GB swap used, so avoid parallel Nx jobs and
additional browser tabs. Run verification serially with a capped Node heap.
