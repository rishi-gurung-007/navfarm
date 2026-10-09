# Feed Forecast non-TO UAT

Date: 2026-10-09

## Environment

- Worktree: `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`
- Branch: `feat/feed-forecast-requisition-integration`
- Commit at start of UAT: `429d2e82`
- Web: `http://localhost:3002` (served from the required worktree)
- API: `http://localhost:2877` (served from the required worktree)
- Database: local MySQL, development schema `nf_devco`
- Migration state: tenant migrations 152–156 present; `feed_consolidation` and
  `feed_consolidation_line` exist.
- Browser: Brave was already open on the Feed Forecast calculation route.

No production database was modified. No reset, cleanup, merge, commit, or push
was performed.

## Browser evidence

The initial native Computer Use bridge was unavailable (`-10005
noWindowsAvailable`), so the UAT was rerun with Playwright against the same
worktree services. Playwright login succeeded with the local company-admin
fixture and all observed requests were made against `nf_devco`.

Observed evidence:

- Feed Forecast → Calculation loaded real GRA100 data after Calculate. The
  grid showed batch, shed, silo, required/current item, head count, rate,
  opening balance, projected daily values and shortage/delivery columns.
- Notes opened as a dialog and displayed grouped “Days with no feed rate” and
  “Head counts” notes with batch/date context.
- Run history opened as a dialog with four “View calculation” actions. Opening
  a saved run restored its snapshot, displayed “Return to current calculation”,
  and hid current-run Save/Delete actions.
- Feed Forecast → Requisition loaded with **All farms** selected. The list
  displayed farm code/name and real requisitions; the API returned HTTP 200 for
  both `/feed-requisition?` and
  `/feed-requisition/consolidations/eligible` after the API was rebuilt from
  this worktree.
- The feed-only `Consolidate (15)` action opened its dialog with the two
  supported filter modes (requisition number and date range), without creating
  a sheet. The consolidation page rendered and showed the current empty-sheet
  state. Eligible rows now show the destination silo code/name rather than an
  internal UUID. Existing local master data has no mill loading-bin mapping,
  so those cells correctly remain `Not configured` and a consolidation write
  was not manufactured.

Screenshots captured during this run (temporary local evidence):

- `/tmp/navfarm-feed-requisition-after-api-restart.png`
- `/tmp/navfarm-notes-dialog.png`
- `/tmp/navfarm-run-history-dialog.png`
- `/tmp/navfarm-historical-run.png`
- `/tmp/navfarm-consolidate-dialog.png`

## Write-path UAT

All writes below used unique `UAT-NONTO-20261009-*` remarks in the local
development tenant. No existing requisition, consolidation, or stock-count
row was selected for mutation. The two fixture stock counts were posted and
then reversed to the original balance with a second approved count.

### 1. Forecast shortage → requisition → approval → incoming projection — PASS

- Saved source run: `RUN-VIL100-20261009-001`
  (`50e270c5-940e-435a-8539-6e50ee1d6c91`).
- Preview contained a shortage for `ICAT-004-ITM-0002` at
  `VIL100/SILO-002`: recommended/rounded quantity `3,000 kg`, delivery
  `24/10/26`.
- Created requisition `REQ-VIL100-2026-00005`
  (`d16f94b2-5b79-4bef-ad91-523925d4a280`) with two prefilled lines and the
  UAT remark. Database status was `DRAFT`.
- Submitted through the real requisition endpoint: `PENDING_APPROVAL`, approval
  request `df939565-b668-484b-988c-52e0ebccf971`.
- Approved by a separate authorized company-admin session: `APPROVED`.
- Recalculation showed the expected incoming on the delivery date:

  | Date | Incoming | Opening | Projected closing |
  |---|---:|---:|---:|
  | 23/10/26 | 0 kg | 1,057.5 kg | 730 kg |
  | 24/10/26 | **3,000 kg** | 730 kg | **3,402.5 kg** |
  | 25/10/26 | 0 kg | 3,402.5 kg | 3,075 kg |
  | 26/10/26 | 0 kg | 3,075 kg | 2,747.5 kg |

  The incoming reference was `REQ-VIL100-2026-00005`.

Playwright opened the saved requisition and showed the approved status, farm
code, forecast run, delivery date and requested kilograms:
`/tmp/navfarm-uat-approved-requisition.png`.

### 2. Two-farm consolidation with adjustment and finalization — PASS

- Created and approved second fixture requisition `REQ-GRA100-2026-00008`
  (`c0834aeb-9f38-47e0-9535-ac37c9f99922`) for GRA100, 1,200 kg requested.
- Selected it together with VIL100 requisition
  `REQ-VIL100-2026-00005`.
- Created consolidation `CONS-202641-001`
  (`43e27c19-7213-4395-906e-b93ef1320797`) with two lines.
- Adjustment was applied to GRA100 from 1,200 kg to **1,000 kg** with reason
  `UAT capacity allocation adjustment`; VIL100 remained **3,000 kg**.
- Database verification matched requested/approved quantities and reasons.
- Finalized through the real endpoint: status `CONSOLIDATED`.
- Both requisitions were linked to the consolidation and moved to
  `IN_CONSOLIDATION`.

Mill master verification found `MILL-001` but no BIN. A legitimate isolated
development BIN was created under that mill through the Location Master API:
`MILL-001/BIN-001`, `UAT Mill Bulk Bin 20261009`, `BULK`, capacity `30,000 KG`.
Eligible consolidation rows then returned that BIN and capacity instead of
`Not configured`. No production/default mill values were invented.

### 3. Actual Feed Plan quantities — PASS after in-scope fix

The first Actual Plan attempt exposed a defect: it copied requested quantities
but left `mill_approved_qty_kg` null after consolidation. The service now reads
all approved requisitions for the run and aggregates finalized consolidation
line approvals by item. A regenerated plan produced:

- `PLAN-VIL100-202643-R02`, type `ACTUAL`;
- Dry Sow Gestation Mash: requested `3,000.0000 kg`, mill approved
  `3,000.0000 kg`.

The Feed Plan UI displayed the VIL100 rows and the approved `3,000 KG` value:
`/tmp/navfarm-uat-feed-plan-vil.png`.

### 4. Physical Stock Count → inventory ledger → forecast balance — PASS

- Created count `FSC-7e031c9a-e613-4177-8027-1e21e30514dd-1791551400`
  (`cf6d548b-71f4-4914-8d4a-e67807e1f549`) for all seven active VIL100
  silo/item pairs.
- Counted `VIL100/SILO-007` at `2,990 kg` against system `3,000 kg`; the
  required adjustment reason `RSN-001` was supplied.
- Submitted, independently approved by Tenant Administrator, and posted.
- Stock adjustment `ADJ-000018` posted `-10 kg`; inventory ledger entry
  `bac08841-fa7e-48f0-9782-7f88f8735e2c` recorded transaction type
  `VARIANCE_NEGATIVE`.
- Silo status/forecast then reported system balance **2,990 kg** and last
  approved count **2,990 kg**.
- A second full count `FSC-...-1791552600`
  (`d8e56b29-ce65-44c9-9f25-fad0145c182f`) restored the same silo to 3,000 kg,
  was independently approved and posted, returning the fixture to its original
  balance.

The Physical Stock Count UI listed both posted counts:
`/tmp/navfarm-uat-physical-count-vil.png`.

## Automated verification

| Area | Command | Result |
|---|---|---|
| Feed requisition / transfer compatibility | `pnpm nx test api -- --runInBand --watchman=false --testPathPatterns='stock-transfer|requisition.*transfer|requisition\\.service'` | 306 passed |
| Feed forecast UI | `pnpm nx test web -- --runInBand --watchman=false --testPathPatterns='feed-forecast-panel|feed-forecast-run-history'` | 34 passed |
| Common/feed requisition UI | `pnpm nx test web -- --runInBand --watchman=false --testPathPatterns='common-requisition|feed-requisition-detail|requisitions-panel'` | 149 passed |
| Web typecheck | `pnpm nx run web:typecheck` | Passed |
| API application typecheck | `pnpm exec tsc --noEmit -p apps/api/tsconfig.app.json` | Passed |
| Formatting | `git diff --check` | Passed |

## Implemented non-TO behavior

- Farm-local calculation defaults and persisted forecast runs.
- Approved requisition incoming projection without changing physical ledger
  stock.
- Shortage-to-requisition flow and duplicate-demand protection.
- All-farms feed requisition listing with farm code/name.
- Feed-only Mill Consolidation eligibility, creation, adjustment validation,
  snapshots, listing, detail and finalization.
- Notes dialog and saved Run History dialog with persisted snapshot restoration.
- Feed Plan and Physical Stock Count paths retained.

## Determination

The exercised non-TO acceptance criteria passed: shortage-driven
requisition persistence, independent approval, dated incoming projection,
two-farm feed-only consolidation with adjustment/finalization, Actual Feed Plan
approved quantities, and physical-count ledger posting with forecast balance
change and restoration.

The Playwright UI was used to open and verify the resulting requisition, Feed
Plan, Physical Stock Count and consolidation surfaces; the mutating actions were
performed through the same authenticated API handlers that those screens call,
with database verification after every write. No TO, shipment, receipt, or
Business Central action was performed.

The local Loading Instruction Sheet path is now implemented and verified in
`docs/uat/feed-loading-instruction-sheet-uat.md`. Business Central and external
TO integration are intentionally out of scope for this UAT. Base Currency is
used for monetary stock-count snapshots when optional Local Currency is absent;
the former `MISSING_LOCAL_CURRENCY` block is removed without hardcoding a
currency.

Database verification during UAT found 35 legacy approved requisitions, 10
manual approved requisitions, two pending manual requisitions, two approved
feed-forecast requisitions, and the finalized `CONS-202641-001` row in
`feed_consolidation`. The database table is `requisition` (not a separate
`feed_requisition` table); this matches the shared requisition model used by the
feed list.

### Deferred to Final TO Integration

- Transfer Order generation/import and external association.
- Shipment and TO Receipt click-through.
- Partial/full receipt reconciliation in the final integration scenario.
- Business Central synchronization dependencies.

### Additional local feed transfer evidence (2026-10-09)

Item Master and existing mill configuration were used for an isolated run:

- Feed classification fixture: `FEED_BULK_UAT`; existing feed items
  `ICAT-004-ITM-0001`, `ICAT-004-ITM-0002`, and `ICAT-004-ITM-0004` were updated
  through Item Master rather than duplicated.
- Existing mill BIN `MILL-001/BIN-001` (`30,000 KG`) and date-specific diet
  assignments for 2026-10-11 were reused. Goods receipt `GR-000073` supplied
  isolated development stock.
- `REQ-GRA100-2026-00010` (`06cee494-342a-454f-a203-4365d86fe13e`) was
  approved, consolidated as `CONS-202641-004`, and finalized. The loading sheet
  `LOAD-000006` was generated with 50 KG mill-approved/scheduled quantity.
- Release created `TR-000048` with 50 KG, shipment posted as `SH-2026-0039`,
  loading was dispatched with compartment `COMP-GRA-UAT-03`, and receipts
  `RC-2026-0044`/`RC-2026-0045` posted 25 KG each. MySQL verified one -50 KG
  `TRANSFER_SHIPMENT` ledger entry and two +25 KG `TRANSFER_RECEIPT` entries;
  the requisition and transfer ended fully received/posted.
- An over-receipt after final receipt returned HTTP 400 and created no ledger
  entry. This verifies no double counting.

### Automated browser verification

`pnpm nx run web-e2e:e2e -- --grep feed` was attempted against the running
worktree. The selected legacy master-data cases did not pass (the formula-code
control and operational item-master creation assertions disagree with the
current UI), and no feed requisition write was driven by those tests. The
feed-specific write path above was exercised through the authenticated API
handlers used by the UI and verified in MySQL; this e2e failure is recorded as
a separate pre-existing UI-suite issue rather than treated as feed workflow
evidence.

## Requisition workflow continuation (2026-10-09)

An isolated common-requisition fixture completed the shared transfer workflow:

- `RQ-00039` (`a464e25a-dd15-4445-a3e5-30ca0ecc085c`) was created as an ITEM /
  STORE request for 1 KG, submitted, and approved in separate sessions.
- Release created shared transfer `TR-000043` and changed the document to
  `RELEASED / TRANSFER_OPEN`.
- Shipment `SH-2026-0037` posted 1 KG; receipt posted the same shipment and the
  requisition ended `RECEIVED` with zero remaining balances. MySQL showed the
  transfer as `POSTED`.

During this write, the receipt-number allocator reused an existing local
`RC-2026-0037`. The allocator is now based on a locked numeric MAX query rather
than lexical ordering, preventing reuse on subsequent writes. The fixture is
retained as local UAT evidence; it is not a production record.

Feed release validation also confirmed that BAGGED feed may target an active
farm STORE. The finalized fixture then stopped with the correct actionable
blocker that `ICAT-004-ITM-0002` has no active mill BIN/diet assignment for
production date `2026-10-11`; no fake assignment or capacity was invented.

The feed requisition detail now shows the finalized consolidation sheet number,
consolidation status, next action, requested KG, mill-approved KG and adjustment
reason from the immutable consolidation-line snapshot. This removes the prior
ambiguous “In Consolidation” display.

### Remaining genuine blockers / deferred scope

- Loading Instruction Sheet is now persisted from consolidation migration
  `0157_feed_loading_sheet`, exposed at `/inventory/feed-loading`, and verified
  with `LOAD-000001`/`LOAD-000002`. `LOAD-000002` reached `LOADED` with
  compartment `COMP-01` and 2,500 KG. Dispatch correctly remained blocked until
  a posted shared shipment is linked. Full shipment/receipt click-through and
  notification verification remain blocked by the missing date-specific
  BIN/diet assignment on the fixture.
- Business Central Transfer Order import/association and final TO Receipt
  integration remain deferred.
- Base-currency stock-count valuation now uses an auditable identity rate when
  optional Local Currency is absent; the former `MISSING_LOCAL_CURRENCY` block
  is removed.

### Final calculation-visibility check (2026-10-09)

The live `VIL100` forecast response was inspected before changing the grid.
The API already returns a canonical `sourceBalances` series keyed by
destination silo, feed item and date, including opening stock, daily use,
planned incoming, references and projected closing stock. This is the correct
physical movement grain; shared batches do not need separate incoming
quantities.

The existing `REQ-VIL100-2026-00005` rows were re-queried read-only. Its 3,000
KG line has `required_date`, `proposed_delivery_date` and
`recommended_delivery_date` set to `2026-10-24`, but the requisition is now
`APPROVED / RELEASED / IN_CONSOLIDATION` and already has a linked draft
transfer (`TR-000044`). The forecast therefore correctly excludes it from
`PLANNED_REQUISITION` and reports the 3,000 KG as an `OPEN_TRANSFER` on the
transfer posting date. Treating it as planned again would double-count stock,
so the completed UAT record was not changed.

The frontend now preserves the batch/date grid and, whenever the API provides
planned incoming, shows one `+N KG planned incoming` badge per silo/feed-item/
date. Clicking a date cell opens `Opening Stock + Planned Incoming + Other
Incoming − Daily Consumption = Closing Stock`. The badge is deduplicated across
batches sharing a silo, subsequent dates carry the source closing balance, and
saved forecast runs remain unchanged.

### Open-transfer arrival visibility fix (2026-10-09)

The remaining gap was that an outstanding transfer was dated by its transfer
posting date (`2026-10-11`) even when the linked requisition had a later
delivery date. `loadDraftTransfers()` now joins linked requisition lines and
uses `COALESCE(proposed_delivery_date, recommended_delivery_date, required_date)`
as the expected date; manually-created transfers still fall back to their
posting date. Posted ledger movements remain excluded, and outstanding
quantities are still calculated as ordered minus shipped/received. Transfer
identity is retained when movements share a silo/item/date so explanations can
name every source without changing the silo-level balance.

Read-only live API verification for `VIL100/SILO-002` /
`ICAT-004-ITM-0002` confirmed the 3,000 KG linked transfer `TR-000044` from
requisition `REQ-VIL100-2026-00005` now arrives on `2026-10-24`, not
`2026-10-11`:

| Date | Opening KG | Expected incoming | Consumed KG | Projected closing KG |
|---|---:|---:|---:|---:|
| 23/10/26 | 677.5 | 0 | 327.5 | 350.0 |
| 24/10/26 | 350.0 | **3,000 (OPEN_TRANSFER)** | 327.5 | **3,022.5** |
| 25/10/26 | 3,022.5 | 0 | 327.5 | 2,695.0 |
| 26/10/26 | 2,695.0 | 0 | 327.5 | 2,367.5 |

The response carried `referenceNo=TR-000044`,
`relatedReferenceNo=REQ-VIL100-2026-00005`, and
`expectedDate=2026-10-24`. The existing browser smoke view showed the same
VIL100 silo row and 3,000 KG open-transfer total; changing the date window
through the native date control returned a transient 500 while the API process
was being restarted, so no write-path action or record mutation was attempted.
The previously captured approved-untransferred requisition browser evidence
remains valid for the `PLANNED_REQUISITION` path. The API quantities above are
the authoritative read-only verification for the linked-transfer path.

## Loading and release blocker verification (2026-10-09)

Focused repairs were applied without changing operational records:

- LEX100 release now resolves the immutable consolidation-line snapshot when
  the legacy requisition header back-link is null. The live detail shows
  `CONS-202640-002`, `CONSOLIDATED`, and next action `RELEASE`. Release remains
  disabled for the genuine prerequisite failure: `ICAT-004-ITM-0004` has no
  active mill BIN/diet assignment for production date `2026-10-04`.
- Loading conflict validation now identifies the conflicting compartment,
  production date, diet code/name, loading-sheet number and consolidation
  number while preserving different-diet separation.
- Dispatch still requires a posted shared Stock Transfer shipment. Missing
  shipment text now names the loading sheet and directs the user to post from
  the released requisition. Existing `LOAD-000006` remains the verified
  linked/dispatched example (`SH-2026-0039`); no new shipment was created.
- Loading rows expose Requested KG, Mill-approved KG, Adjustment reason,
  KG loaded and Compartment. Existing RIC100 data remains explicit:
  `LOAD-000004` requested `50 KG`, mill approved `3,000 KG`, loaded `3,000 KG`,
  adjustment reason `q`.

Focused API feed-requisition/release suites (59 tests), web feed-loading/feed-
requisition suites (10 tests), API/web typechecks and the live LEX browser
detail all passed. LEX release itself is **BLOCKED** by the missing
date-specific BIN/diet master data; this is not a frontend permission defect.
