# Feed workbook — recount against branch `wave4/wb100` (re-audit of `workbook-100-gaps.md`)

Audited 11 Oct 2026, read-only, from the code at HEAD `52a7b9a1` (branch `wave4/wb100`; includes the monthly stock take,
feed scheduler, cost centre, A1-A14 and W1-W13 work). Same method and same 310 rows as `workbook-100-gaps.md`.
Spec: `workbook-fields.md`, `docs/decisions.md` (newest wins), `common-requisition-spec.md` (counted separately).

Rulings applied: the email channel is DEFERRED (Rishi, 11 Oct) so email-only rows are N/A (deferred); the House is the
Shed; over-receipt stays blocked (Checkpoints 29 departs on purpose, N/A by ruling); BC-only rows are N/A per the
3 Oct ruling unless the in-house build exists (then they are judged on the in-house field). DONE needs the field readable
(no raw UUID or enum code) and linked where it references another record.

Path shorthands: `W/` = `apps/web/src/components/console/inventory/`, `CFG` = `apps/web/src/modules/master-data/configs.ts`,
`A/` = `apps/api/src/modules/`.

## 1. Totals (workbook, 310 rows)

| DONE | PARTIAL | MISSING | N/A | Total |
|---|---|---|---|---|
| **275** | **22** | **2** | **11** | 310 |

**Strict completion (DONE only, excluding N/A): 275 / 299 = 92.0 %** (was 154 / 300 = 51.3 %).
Weighted (PARTIAL = half): (275 + 22 x 0.5) / 299 = 95.7 %.

N/A (11): Master r28 (BC sync); Req r11, r12 (REMOVED / per-line silo), r44 (REMOVED), r87 (push to BC), r129 (Push to BC),
r156 (BC shipment line id), r157 (BC posting status); Checkpoints 29 (over-receipt allowed, N/A by ruling), 38
(in-app / email channels, email deferred), 39 (BC retries).

Judgement calls worth a second look: Master r51 Delivery Channel and Req r84/r85/r88 count DONE with in-app only (email
deferred); the scheduler (cp 20, 30, 36, Engine r64, r69, Req r84-85) counts DONE because the code and the Feed Planning
settings screen are complete, but the timer is off unless `FEED_SCHEDULER_ENABLED=true`
(`A/inventory/feed-scheduler/feed-scheduler.service.ts:80,117`) so it must be switched on at deployment; Silo Balance r47
(GL Entry) was N/A before and is now judged on the in-house build (`A/inventory/feed-stock-count/feed-stock-count.service.ts:546-564`).

## 2. Per-sheet totals

| Sheet | Rows | DONE | PARTIAL | MISSING | N/A |
|---|---|---|---|---|---|
| Feed Forecast (principles) | 10 | 10 | 0 | 0 | 0 |
| Master Setup | 43 | 38 | 4 | 0 | 1 |
| Feed Forecast Engine | 55 | 52 | 3 | 0 | 0 |
| Requisition and Loading Sheet | 115 | 102 | 5 | 1 | 7 |
| Silo Balance and Stock Take | 40 | 31 | 8 | 1 | 0 |
| Checkpoints and Validations | 47 | 42 | 2 | 0 | 3 |
| **Workbook total** | **310** | **275** | **22** | **2** | **11** |
| Common requisition list (separate) | 34 | 34 | 0 | 0 | 0 |

Requisition and Loading Sheet by section: §1 35 (32/1/0/2), §2 15 (14/0/0/1), §3 18 (16/1/1/0), §4 10 (8/1/0/1),
§5 16 (14/1/0/1), §6 16 (15/1/0/0), §7 5 (3/0/0/2).
Silo Balance by section: §1 6 (4/2/0/0), §2 17 (15/2/0/0), §3 17 (12/4/1/0).

## 3. Every remaining PARTIAL or MISSING row (24)

Effort: S ≤ ½ day, M ≈ 1-2 days, L ≥ 3 days.

| Sheet / row | Field | Status | What is missing | Evidence | Effort |
|---|---|---|---|---|---|
| Master r8 | House code and silo-house mapping | PARTIAL | Mapping exists (`attached_sheds` `CFG:220-231`), but no batch house allocation with effective dates ("Define each batch house allocation and effective dates"); `silo_shed_link` has no date columns (`apps/api/src/core/database/schema.ts:1329-1339`) | `CFG:220` | M |
| Master r15 | Days to First Shortage | PARTIAL | Silo record has no first-shortage / days field; only the dashboard shows it (`W/feed-silo-dashboard-cards.tsx:123-124`). Add read-only field beside the other silo facts | `CFG:241-251` | S |
| Master r16 | Feed in Silo | PARTIAL | Read-only text "CODE — name", not linked to the item record | `CFG:242`, `A/master-data/location/location.service.ts:727` | S |
| Master r45 | Event Type | PARTIAL | Nine of the workbook's events exist; STOCK_TAKE_DUE is absent (BC sync failure is N/A). Needs an evaluator that raises it before the period stock-take date | `A/system/alert-rule/alert-rule.rules.ts:14-17` | M |
| Engine r60 | Projected Shortfall KG | PARTIAL | Value shown (`W/feed-silo-dashboard-cards.tsx:130`); no "notification if greater than 0" event | `alert-rule.rules.ts:14-17` | S |
| Engine r61 | Recommended Order Qty KG | PARTIAL | Value shown; no "notification if requisition not yet drafted" event | same | S |
| Engine r62 | Farm Total Order This Cycle KG | PARTIAL | Value shown; no "approaching 30-ton cap" notification | same | S |
| Req r34 | Priority (FM may escalate) | PARTIAL | API accepts an escalation (`A/procurement/feed-requisition/feed-requisition.service.ts:1811-1819`, `feed-requisition.rules.ts:396-403`) but the document shows a read-only badge, no control | `W/feed-requisition-document.tsx:446` | S |
| Req r75 | Notification Status | MISSING | Loading sheet shows no dispatch-notification status (the MILL_DISPATCH alert is raised, `A/procurement/feed-requisition/feed-loading.service.ts:137`, but the sheet neither returns nor shows its status) | `W/feed-loading-panel.tsx:88-125` | S |
| Req r76 | Notification Content | PARTIAL | Text is built into the alert (diet, KG, compartment); not shown on the loading sheet; estimated arrival not included (Vehicle Management is out of scope) | `feed-loading.service.ts:137-140` | S |
| Req r80 | 1 Auto-draft (+ notify FM) | PARTIAL | AUTO_DRAFT is created; no "requisition auto-drafted" notification to the Farm Manager (no event type for it) | `feed-requisition.service.ts:658,799`; `alert-rule.rules.ts:14-17` | S |
| Req r128 | Consolidation Status | PARTIAL | Labels are readable (`W/requisition-labels.ts:34-39`) but REVIEWED is never set: the only transitions are DRAFT to CONSOLIDATED (PUSHED_TO_BC is N/A) | `A/procurement/feed-requisition/feed-consolidation.service.ts:346` | S |
| Req r139 | Feed Item No. (TO receipt) | PARTIAL | Item code in the receipt table is plain text, not linked to the item | `W/feed-requisition-detail.tsx:366-367` | S |
| Silo r8 | Equals System Balance (label) | PARTIAL | The balance dialog in the forecast grid says "Opening stock" and "closing stock", not SYSTEM BALANCE | `apps/web/src/utils/translations.ts:1952,1959`; `W/feed-forecast-grid.tsx:523,529` | S |
| Silo r9 | Days of Feed Remaining, 1 decimal | PARTIAL | Requisition shows 1 decimal (`W/feed-requisition-document.tsx:287-290`); the dashboard shows up to 2 (`W/feed-silo-dashboard-cards.tsx:57-60,123,164`) | as left | S |
| Silo r18 | Loading Sheet No. (receipt) | PARTIAL | Shown as plain text in the receipt table, not linked to the loading sheet | `W/feed-requisition-detail.tsx:378-381` | S |
| Silo r20 | Feed Item No. (receipt) | PARTIAL | Same cell as Req r139 (item unlinked) | `feed-requisition-detail.tsx:366-367` | S (with r139) |
| Silo r35 | Farm Code or Mill Code | PARTIAL | A saved stock take does not show its farm or mill code (`farm_code` is typed but never rendered; only "At mill" appears in the type) | `W/feed-stock-count-panel.tsx:94,484-490` | S |
| Silo r36 | Reporting Period | PARTIAL | Period code shown as plain text in the list; not linked to the Reporting Period record | `feed-stock-count-panel.tsx:487` | S (with r35) |
| Silo r45 | Adjustment Type | MISSING | POSITIVE_ADJUSTMENT / NEGATIVE_ADJUSTMENT is not shown on the stock take (only the signed variance); no such field in the panel or the count view | `feed-stock-count-panel.tsx:646-651` | S |
| Silo r47 | D365BC GL Entry | PARTIAL | In-house journal numbers are shown comma-joined, plain, not linked to the ledger entries; no cost-centre shown | `feed-stock-count-panel.tsx:636`; `feed-stock-count.service.ts:546-564` | S |
| Silo r48 | Period Status After Reconciliation | PARTIAL | Shows the raw code (`period_status_after` straight from `period.period_status`) | `feed-stock-count-panel.tsx:637`; `feed-stock-count.service.ts:541` | S |
| Checkpoint 5 | Changeover task + warn before approval | PARTIAL | The warning is built and shown on the line and the detail; no changeover task or alert is generated | `A/inventory/silo-feed/silo-feed.service.ts:92-106`; `W/feed-requisition-document.tsx:524-526` | S |
| Checkpoint 37 | Always "SYSTEM BALANCE" | PARTIAL | Count screens now say System Balance KG (`translations.ts:4614`); the forecast balance dialog still says opening and closing stock (same fix as Silo r8) | `translations.ts:1952,1959` | S (with Silo r8) |

Effort total: 22 rows are S (about 9 distinct fixes once the shared ones are merged), 2 are M (Master r8, r45).

Distinct fixes: (1) forecast-grid balance dialog labels (Silo r8, cp 37); (2) link item and loading sheet in the receipt table
(Req r139, Silo r18, r20); (3) stock take record: farm/mill code, period link, adjustment type, readable period status,
linked GL refs (Silo r35, r36, r45, r47, r48); (4) loading sheet dispatch-notification status and content (Req r75, r76);
(5) four new alert events: shortfall, not drafted, near truck target, auto-drafted (Engine r60-62, Req r80), plus
STOCK_TAKE_DUE (Master r45); (6) silo record: first-shortage field and linked Feed in Silo (Master r15, r16);
(7) priority escalate control (Req r34); (8) REVIEWED step or drop (Req r128); (9) dashboard days to 1 decimal (Silo r9);
(10) changeover alert (cp 5); (11) batch house allocation with dates (Master r8, M).

## 4. Previously not-DONE rows now closed (by theme, all verified against current code)

- Linking: `RecordLink` and the shared `*Href` helpers (`W/feed-requisition-header.tsx:91-107`) are used on the requisition
  document (farm, silo, item, BIN, lifecycle row, batch, shed, run, transfers: `W/feed-requisition-document.tsx:432-565,629-636`),
  list (`W/requisitions-panel.tsx:303`), consolidation (`W/feed-consolidations-panel.tsx:93-138`), loading
  (`W/feed-loading-panel.tsx:90-106`), forecast grid (`W/feed-forecast-grid.tsx:468-474`), plan (`W/feed-plan-panel.tsx:178,249`),
  dashboard (`W/feed-silo-dashboard-cards.tsx:83,107,113,205,210`), stock count (`W/feed-stock-count-panel.tsx:189-212`),
  compare report (`W/mill-compare-panel.tsx:173-175`), transfers (`W/transfer-source-links.ts:28-58`,
  `W/stock-transfer-panel.tsx:164-165,807-809` for `?id=`) and the common requisition (`apps/web/src/components/console/requisitions/common-requisition-document.tsx:105-108,239,246-247`).
- Line table order fixed (23 headers, 23 cells, `W/feed-requisition-document.tsx:307-318` vs `:496-573`) and Shipped / Received /
  Outstanding columns added.
- Raw codes and UUIDs: label maps for requisition, consolidation, loading and next action
  (`W/requisition-labels.ts:14-52`); `labelOf(null)` is now an explanatory string (`:111`); the API UUID fallbacks in consolidation
  findOne and loading decorate are gone; run author is a name (`W/feed-forecast-run-history.tsx:83`).
- Receipt controls: variance with reason on the final receipt (decision 11 Oct), bag count, delivery note, compartment,
  silo balance after receipt, per-line previous/outstanding (`W/feed-requisition-detail.tsx:355-470`;
  `A/inventory/stock-transfer/stock-transfer.service.ts:1397-1500`).
- Loading sheet: `LOAD-<ReqNo>-<LineNo>`, delivery date, diet, BIN, loaded by (name), loaded at, status label
  (`A/procurement/feed-requisition/feed-loading.service.ts:42-65,160-215`; `W/feed-loading-panel.tsx`).
- Consolidation sheet: manager name, diet, BIN, per-diet total, capacity, transfer and loading sheet per line
  (`feed-consolidation.service.ts:297-335`; panel `:107-140`).
- Silo record facts (Master r13, r14, r17, r19, r20): `CFG:241-251`, `location.service.ts:687-731`; silo-needs-shed
  (`location.service.ts:411-412,1517-1522`); feed-only pickers (`CFG:1306,1686`); Role Master pickers (`CFG:1573,1593`);
  effective-dated and farm-override lifecycle rows (`CFG:1315-1320`, schema `farm_id`, `effective_from/to`).
- Stock take, Reporting Period close, closed-period guard (`A/inventory/feed-stock-count/monthly-stock-take.rules.ts`,
  `A/master-data/reporting-period/reporting-period.service.ts:195-236`, `common/period-close.ts:38`).
- Scheduler (Friday/Saturday, daily diet change, Wednesday tentative plan, escalation hourly):
  `feed-scheduler.service.ts:115-117`, `feed-scheduler.rules.ts:17-40`; PLAN_AVAILABLE, MILL_DISPATCH, MILL_ADJUSTED,
  RECEIPT_VARIANCE, NO_NEXT_FEED_ROW, NEXT_DIET_NO_SILO, CAPACITY_EXCEEDED (`alert-rule.rules.ts:14-17`).
- Cp 15 (span setting `feed-forecast.service.ts:728,775`), cp 16 (off-multiple needs remarks `feed-requisition.rules.ts:363-364`),
  cp 28 (empty bags warning, never blocks, `batch-daily-data.service.ts:1015-1062`), cp 47 (GRN of feed into a silo refused,
  `A/inventory/goods-receipt/goods-receipt.service.ts:92-111`), cp 1 as above.

## 5. Spot-check of DONE rows (no regression found)

Re-read in the current code: Master r9, r10, r12, r39 (`CFG:181-199,1307`); Engine flags r22-r28 (`feed-forecast.engine.ts:160-167`);
Engine r29-r30 (`feed-requisition.rules.ts:129,288`); Req r29 moved date needs remarks (`:226-227`); Req r36 and cp 18 (`:141,354`);
cp 6 (`bin-diet-assignment.service.ts:152`); cp 14 (`inventory-ledger.service.ts:567`); cp 19/21/41 (`feed-consolidation.service.ts:90`);
cp 22 (`feed-requisition.rules.ts:345-347`); cp 24/25 (`feed-loading.service.ts:96,106-110`); cp 34 (`mill-capacity.service.ts:190`);
cp 32 (`period-close.ts`); Req r4 / Engine r4 (grid Required vs Current Silo Item). All still hold.

## 6. Observations outside the 310 rows (not counted)

- `W/feed-forecast-grid.tsx:524-526` prints the open-transfer quantity twice in the balance dialog ("expected transfer" and
  "open transfer" both use `openTransferKg`), which reads like a double count to the user. Likely a merge artefact; check before UAT.
- Requisition document shows the consolidation sheet number as plain text (`W/feed-requisition-document.tsx:~468`, comment says
  the panel cannot open from `?id=`), but `consolidationHref` and the `?id=` open now exist (`W/feed-consolidations-panel.tsx:36,64`). One-line link.
- `W/transfer-source-links.ts:35,45` falls back to the requisition / consolidation id when the number is missing (only reachable on bad data).
- Common requisition (Rishi's list, 34 items): all DONE. In edit mode locations are codes inside selects (expected); the
  linked PO number is a typed external number with no record to link.
