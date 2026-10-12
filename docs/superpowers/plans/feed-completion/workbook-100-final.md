# Feed workbook: final recount against branch `wave5/wb100` (HEAD `417193d4`, equal to GitHub main)

Audited 11 Oct 2026, read-only. Starting point: `workbook-100-recount.md` (275 DONE, 22 PARTIAL, 2 MISSING, 11 N/A). All 24 remaining
rows were re-read in the current code, about 20 DONE rows were spot-checked for regressions, and the newest rulings in
`docs/decisions.md` (11 Oct, "Rishi's answers on the open interpretations" and the entries before it) were reapplied.

Rulings applied: email deferred, so email-only rows are N/A; over-receipt stays blocked (Checkpoints 29 is N/A by ruling);
BC-only rows are N/A (or judged on the in-house build where one exists); House = Shed; delivery note optional; a short
receipt needs a reason on every short receipt; Direct Transfer has no department check; Status becomes Received when fully
received. DONE means the field is readable (no raw UUID or enum code) and linked where it references another record.

Path shorthands: `W/` = `apps/web/src/components/console/inventory/`, `A/` = `apps/api/src/modules/`,
`CFG` = `apps/web/src/modules/master-data/configs.ts`.

## 1. Totals (workbook, 310 rows)

| DONE | PARTIAL | MISSING | N/A | Total |
|---|---|---|---|---|
| **297** | **2** | **0** | **11** | 310 |

**Strict completion (DONE only, excluding N/A): 297 / 299 = 99.3 %** (was 275 / 299 = 92.0 %).
Weighted (PARTIAL = half): 298 / 299 = 99.7 %.

N/A (11, unchanged): Master r28; Req r11, r12, r44, r87, r129, r156, r157; Checkpoints 29 (over-receipt, by ruling), 38 (email
deferred), 39 (BC retries).

## 2. Per-sheet totals

| Sheet | Rows | DONE | PARTIAL | MISSING | N/A |
|---|---|---|---|---|---|
| Feed Forecast (principles) | 10 | 10 | 0 | 0 | 0 |
| Master Setup | 43 | 42 | 0 | 0 | 1 |
| Feed Forecast Engine | 55 | 55 | 0 | 0 | 0 |
| Requisition and Loading Sheet | 115 | 107 | 1 | 0 | 7 |
| Silo Balance and Stock Take | 40 | 39 | 1 | 0 | 0 |
| Checkpoints and Validations | 47 | 44 | 0 | 0 | 3 |
| **Workbook total** | **310** | **297** | **2** | **0** | **11** |
| Common requisition list (separate) | 34 | 34 | 0 | 0 | 0 |

## 3. Remaining PARTIAL or MISSING rows (2)

| Sheet / row | Field | Status | What is missing | Evidence |
|---|---|---|---|---|
| Req r76 | Notification Content | PARTIAL | The text carries farm code, diet, KG and compartment and is shown on the loading sheet, but "Estimated arrival, based on route from Vehicle Management" is absent. Vehicle Management is a separate module outside the piggery feed scope; if the client rules that part out, this row becomes DONE. | `A/procurement/feed-requisition/feed-loading.service.ts:140`; `W/feed-loading-panel.tsx:123-124` |
| Silo r47 | D365BC GL Entry | PARTIAL | In-house journal numbers are shown and each links, but the link goes to the Finance journal list (`/finance/journal`), which has no deep link to one entry (its only filter is free-text search); the farm cost centre the journal carries is not shown on the stock take. | `W/feed-stock-count-panel.tsx:189,653-655`; `A/inventory/feed-stock-count/feed-stock-count.service.ts:547-564`; `apps/web/src/components/console/finance/journal-panel.tsx:50,74` |

## 4. The 24 rows re-checked (all against current code)

Closed since the last recount (22 rows moved to DONE, 1 MISSING plus 21 PARTIAL):

- Master r8 House/silo-shed mapping with effective dates: `silo_shed_link.effective_from/to` (`apps/api/src/core/database/schema.ts:1336-1337`),
  per-shed date inputs on the silo form (`apps/web/src/modules/master-data/MasterDataTable.tsx:2709-2725`, saved at `:1843-1846`),
  API validation and read (`A/master-data/location/location.service.ts:467-478,624-631`).
- Master r15 first shortage date `CFG:248`, `location.service.ts:741`. The workbook calls the field date based, so a date is correct.
- Master r16 Feed in Silo is a link to the item record: `apps/web/src/modules/master-data/MasterFieldValue.tsx:58-60`, `location.service.ts:740`.
- Master r45 event types: the full list including STOCK_TAKE_DUE and CHANGEOVER is `A/system/alert-rule/alert-rule.rules.ts:14-17`;
  the STOCK_TAKE_DUE evaluator is `A/inventory/feed-alert/feed-alert.service.ts:399-437`, with a daily scheduler job (`feed-scheduler.service.ts:282`).
- Engine r60, r61, r62: SHORTFALL, NOT_DRAFTED and TRUCK_TARGET evaluators `A/inventory/feed-alert/feed-alert.rules.ts:263-290`
  (default rules `alert-rule.service.ts:49-51`).
- Req r80 AUTO_DRAFTED notification `A/procurement/feed-requisition/feed-requisition.service.ts:893`; Checkpoint 5 CHANGEOVER alert `:1945`.
- Req r34 priority escalate control: select on the editable document `W/feed-requisition-document.tsx:455-462`, wired in `W/feed-requisition-detail.tsx:330`.
- Req r75 notification status (SENT / NOT_SENT with time and text) `A/procurement/feed-requisition/feed-loading.service.ts:192-225`,
  `W/feed-loading-panel.tsx:26,123-124`.
- Req r128 REVIEWED step: `A/procurement/feed-requisition/feed-consolidation.service.ts:349-363`, controller `feed-requisition.controller.ts:91-94`,
  button `W/feed-consolidations-panel.tsx:65,108`, label `W/requisition-labels.ts:34`.
- Req r139 / Silo r20 item link and Silo r18 loading sheet link in the receipt table: `W/feed-requisition-detail.tsx:397-411`.
- Silo r8 / Checkpoint 37 SYSTEM BALANCE wording in the forecast balance dialog: `apps/web/src/utils/translations.ts:1952,1959`;
  the double open-transfer line is gone (`W/feed-forecast-grid.tsx:523-530`).
- Silo r9 days of feed remaining to one decimal everywhere: `W/feed-silo-dashboard-cards.tsx:65-66,127-129,175`.
- Silo r35, r36, r45, r48 on the saved stock take: farm or mill code link, period link, adjustment type, readable period status
  `W/feed-stock-count-panel.tsx:192-196,501,649-658`.

## 5. Spot-check of DONE rows (no regression found)

Master r9-r14 and r17-r20 (`CFG:241-251`, `location.service.ts:687-741`); Engine flags (`A/inventory/feed-forecast/feed-forecast.engine.ts:163-168`);
cp 16 off-multiple needs remarks (`A/procurement/feed-requisition/feed-requisition.rules.ts:363-364`); cp 6 BIN diet assignment
(`A/master-data/bin-diet-assignment/bin-diet-assignment.service.ts`); cp 15 forecast span (`feed-forecast.service.ts:775`); cp 26 shortfall
reason on every short receipt (`A/inventory/stock-transfer/transfer-execution.rules.ts:277-286`) with delivery note optional
(`stock-transfer.service.ts:1457`, `W/feed-requisition-detail.tsx:232`); cp 28 empty bags flag-only (`batch-daily-data.service.ts`);
cp 31 period close with `nothing_to_count` (`A/master-data/reporting-period/reporting-period.service.ts:236`); cp 34 capacity alert
(`feed-consolidation.service.ts`, event `CAPACITY_EXCEEDED`); cp 47 no GRN of feed into a silo (`A/inventory/goods-receipt/goods-receipt.service.ts:92-111`);
Farm cost centre on journals (commit `f5fbfac3`, `location.service.ts:406,1077`); Status RECEIVED when fully received
(`feed-requisition.service.ts:1554,2469`, `W/requisition-labels.ts:27-28`); scheduler Email deferred and timer off unless
`FEED_SCHEDULER_ENABLED=true` (`feed-scheduler.service.ts:78-82`); linked loading sheet / consolidation (`W/feed-consolidations-panel.tsx:139`,
`W/feed-requisition-document.tsx:478`).

## 6. Notes outside the count

- The scheduler timer is off by default; it must be switched on at deployment (carried over from the last recount).
- Req r84/r85/r88 and Master r51 count DONE with the in-app channel only, because email is deferred.
- Alert recipients accept Role Master codes plus the user types Farm Manager, Head of Farms and Mill Manager (Rishi, 11 Oct).
- This audit read code and the decision log only; it did not drive the running app or read MySQL.
