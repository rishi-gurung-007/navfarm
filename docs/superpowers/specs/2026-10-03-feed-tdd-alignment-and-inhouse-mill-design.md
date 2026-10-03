# Feed TDD alignment and in-house mill pipeline — design

**Date:** 2026-10-03
**Branch:** `feat/feed-forecast-requisition-integration` (worktree `.worktrees/feed-forecast-requisition-integration`)
**Reference:** `NAVFarm_Feed forecast TDD with examples (1).xlsx` (seven sheets: Feed Forecast,
Master Setup, Feed Forecast Engine, Requisition and Loading Sheet, Silo Balance and Stock Take,
Checkpoints and Validations, Worked Example). Cited below as *TDD <sheet> row/§*.
**Approved by:** Rishi, section by section in chat on 2026-10-03.

## 1. Intent

Rishi's instruction (2026-10-03): the feed TDD workbook is the rule for feed. Make the forecast,
requisition and everything after it match the workbook — its calculations, its fields and its
checkpoints — and update the existing data to match. Where the workbook gives a step to Business
Central, build that step inside NAVFarm. Drop behaviour the workbook does not describe, **except
fields that existed before the feed-forecast work began (25 Sep 2026)**, which stay in the database
and on their masters; the forecast simply stops using them.

Success means the workbook's Worked Example runs end to end through the running application —
forecast, requisition, approval, production output, consolidation, Transfer Order, loading,
dispatch, receipt, POST Day, stock take, period close — and every quantity in MySQL equals the
workbook's figure.

## 2. Rulings recorded with this design

These go into `docs/decisions.md` under 2026-10-03 and supersede conflicting earlier rulings.

| # | Ruling | Supersedes |
|---|---|---|
| R1 | The feed TDD workbook governs feed behaviour; on conflict with earlier feed rulings, the workbook wins. | — |
| R2 | Shortfall = demand + **safety stock** − opening − confirmed incoming. Safety stock is a separate setting, default 0. The silo's Below Feed Level is an alert threshold only. | Q3 (2026-09-26) |
| R3 | Run-down date = **first shortage date**: the first forecast day on which demand exceeds the stock available. | 2026-10-02 ruling 2 (stock ÷ daily use) |
| R4 | Fulfilment is **in-house only**. No In-house/BC selector is built. Documents keep stable line IDs and an `integration_status` fixed at `NOT_APPLICABLE` so a BC connector can be added later. No outbox, no BC screens, no simulated BC state. | 2026-10-02 ruling 4's toggle |
| R5 | In-house mill stock comes from a **Production Output Entry** (diet, KG, bin, date). No raw-material consumption. | — |
| R6 | Fields created by feed work since 25 Sep that the workbook does not have are removed. Fields that predate it (`silo_reorder_days`, `feed_wastage_pct`) are kept but unused by the forecast. | — |
| R7 | 2026-10-02 rulings 1 (dates as columns in the forecast grid) and 3 (no placeholder dashes) stand; the workbook does not contradict them. | — |

## 3. Part A — forecast and requisition aligned to the workbook

### 3.1 Engine

| Behaviour | Rule | TDD |
|---|---|---|
| Daily demand | Unchanged: heads × lifecycle rate per batch, house, item, date. | Engine §2 Steps 1–4 |
| Next diet | Unchanged: separate line from the next lifecycle row's start date; changeover flagged when no designated silo holds the item. | Steps 5–6, cp. 5, 7, 8, 9 |
| Projected stock | Opening ledger balance per silo+item + confirmed incoming by expected date − daily use. | Step 7 |
| Shortage date | First date demand > available opening (incl. that day's confirmed incoming). | Step 7, Dashboard 55 |
| Shortfall | max over window of (cumulative demand + safety stock − opening − cumulative confirmed incoming), floored at 0. Next diet is never offset with the current diet's stock. | Dashboard 60 |
| Recommended order | Bulk: CEILING(shortfall, bulk multiple, default 3000). Bagged: CEILING(shortfall, bag size, default 50). Unrounded need shown beside it. | Step 8, cp. 16 |
| Free capacity | Warning (not a cap) if recommended order + projected balance on the delivery date exceeds silo capacity. | Step 8 |
| Required delivery date | Shortage date, moved no later than the configured production cutoff before it. Editable with a reason. | Req. §1 row 29 |
| Days remaining | Balance ÷ current daily demand, one decimal, labelled indicative. | Silo Balance row 9 |
| Horizon | Default 7 days, max 45, From ≤ To. | cp. 15 |

**Removed from the engine and its outputs:** refill buffer days, lead time days, refill date,
required-on date, overdue, use of `silo_reorder_days`, use of `feed_wastage_pct`, the low level
inside the shortfall.

**Worked Example acceptance (Below Feed Level 1,000 KG on both silos, safety stock 0):**
R1 demand 6,000, shortfall 4,500, order 6,000, shortage 23 Sep; R2 demand 10,000, shortfall 9,000,
order 9,000, shortage 26 Sep, next diet. Total 15,000.

### 3.2 Fields

**Silo — Location Master (TDD Master Setup §1)**

| Workbook field | Implementation |
|---|---|
| Location Code, Location name, Location Level = SILO | existing |
| House Code and silo house mapping | existing `silo_shed_link` |
| Silo Capacity KG | existing `silo_capacity_kg` |
| Below Feed Level KG | existing `low_level_kg`, relabelled |
| Above Threshold KG | existing `high_level_kg`, relabelled |
| Feed Type BULK / BAGGED | existing `feed_in_bags`, shown as Feed Type |
| Blocked | existing `status` (ACTIVE / BLOCKED) |
| Last Approved Physical Count, System Balance, Days to First Shortage, Feed in Silo, Available Stock, Last Feed Receipt Date, Next Diet Change Date | derived, read-only (ledger, count history, forecast) |
| Physical Count Date Time | on the count transaction, not the master |

Feed in Silo is the item of the last posted receipt into the silo (TDD Master Setup row 16).

**Item (Master Setup §2):** add `diet_no` (integer 1–14, nullable). Item Type FEED; Base UOM KG.
"Sync to NAVFarm" is a BC field and is not built (R4).

**Breed Lifecycle Stage Config (Master Setup §3):** add `feed_form` (BULK / BAGGED, nullable).
Existing Line, Stage, Calculation Unit, Period From/To, Feed Item, Rate unchanged.

**Feed Planning Settings:** add `safety_stock_kg` (default 0) and `bag_size_kg` (default 50);
existing `bulk_multiple_kg`, `truck_target_kg`, `production_weekday`. Company row with optional
farm override, as today.

**Requisition header (Req. §1):** number REQ-FarmCode-YYYY-NNNNN. One header per farm per cycle;
lines per silo and item, Line No. 10000, 20000, … (Worked Example; row 42). Status values:
AUTO_DRAFT, PENDING_APPROVAL, APPROVED, IN_CONSOLIDATION, PLAN_APPROVED, TO_SHIPPED,
PART_RECEIVED, RECEIVED, CLOSED, EXCEPTION. PLAN_APPROVED replaces the workbook's PUSHED_TO_BC
(ours, R4). Add `linked_transfer_id`. Remarks mandatory over 20 % deviation (cp. 18), own-farm
approval only (cp. 19), both diet lines from one run (cp. 23).

**Requisition line (Req. §2):** add `line_no`, `mill_approved_qty_kg`. Shipped/received use the
existing `qty_shipped` / `qty_received`. "Current Silo Feed Item No." is not shown (workbook:
REMOVED).

### 3.3 Columns removed (feed-era, not in the workbook)

`location_master.feed_refill_buffer_days`, `feed_lead_time_days`, `feed_bulk_multiple_kg`,
`feed_bag_size_kg`, `feed_truck_target_kg`, `feed_production_weekday`. The four logistics values are
first copied into a farm-override Feed Planning Settings row where they differ from the company row.

## 4. Part B — in-house mill pipeline

### 4.1 Masters

- **Location type `MILL`** in Location Master, company level, no parent farm.
- **Mill Capacity Master** (registry entry in `master-data/configs.ts`): mill, capacity KG/day and
  KG/hour, bulk and bagged daily allocation, diet priority order. Child **Loading Bin** rows: bin
  no., diet item, effective production date and slot. One diet per bin per slot — blocked
  (cp. 6, 35). Mill capacity available per diet = that diet's allocation for the production date.

### 4.2 Documents and flow

1. **Production Output Entry** — mill, production date, slot, diet item, bin, KG produced.
   Posts a positive inventory movement at the mill location through the shared posting path
   (same path as stock adjustment), valued at the item's current unit cost.
2. **Loading Instruction Sheet** — created when the Farm Manager approves a requisition
   (Req. §3). No. LOAD-ReqNo. One line per requisition line: delivery date, diet, description,
   bin, farm silo, KG ordered (system: the requisition line's requested KG, replaced by the mill approved KG once consolidation sets it); compartment no., KG loaded, loaded by, loading date-time
   (mill). Status DRAFT → LOADED → DISPATCHED → RECEIVED.
3. **Consolidation Sheet** — CONS-YYYYWW-NNN, one per production week. Loads APPROVED
   requisition lines only (cp. 41). Row per farm per diet: diet no., bin, farm requested KG,
   all-farms total per diet, mill capacity available, mill approved KG, adjustment reason
   (mandatory when approved ≠ requested; original kept; farm notified). Status DRAFT → REVIEWED →
   CONSOLIDATED → PLAN_APPROVED. Plan approval blocked while any diet total exceeds capacity
   (cp. 42). Requisitions move to IN_CONSOLIDATION, then PLAN_APPROVED.
4. **Transfer Order** — on plan approval, one TO per farm per diet from mill to farm, reusing
   `stock_transfer` with staged shipment and receipt. TO lines carry requisition line, consolidation
   line and destination silo; `requisition.linked_transfer_id` set. No. TO-MILL-FarmCode-NNNN.
5. **Dispatch** — blocked without compartment no. and KG loaded (cp. 24), when two diets share a
   compartment (cp. 25), or when mill stock is insufficient. Posts `transfer_shipment`, updates
   `qty_shipped`, requisition → TO_SHIPPED, loading sheet → DISPATCHED. In-app + email dispatch
   notice to farm recipients, deduplicated by shipment ID.
6. **TO Receipt** — one posting service invoked from the TO or the requisition (cp. 47). Fields:
   receipt date, delivery note no. (mandatory), loading sheet, compartment, destination silo,
   requested (locked, cp. 44), mill approved, shipped, previously received, outstanding, received
   this posting, variance, variance reason, bag count (bagged).
   - Silo filter: active, on the farm, holding this item or with zero balance of its current item
     (cp. 4, 45; Master Setup row 16). Feed Type match alone is not enough.
   - Variance ≠ 0 requires a reason; over-receipt posts, is flagged and notifies the mill
     (cp. 26, 29). Bagged: bag count × bag size within the configured tolerance (cp. 27).
   - Posts received KG once to silo+item (cp. 46); unique key per shipment line + receipt ID;
     partial receipts leave outstanding. Requisition → PART_RECEIVED / RECEIVED; loading sheet →
     RECEIVED. Low alert resolves and above-threshold INFO re-evaluates (cp. 12, 13).

`integration_status` on consolidation, TO and receipt is `NOT_APPLICABLE` (R4).

## 5. Part C — planning, reminders, notifications

- **Feed Plan** (Engine §3): per farm per diet per week. Code PLAN-FarmCode-YYYYWW-Rnn; type
  TENTATIVE or ACTUAL; versions retained. Tentative = 5 completed weeks of posted POST Day
  consumption per farm and diet, normalised per day, adjusted for projected head count and known
  diet changes. Actual = farm-approved requisition KG (requested and mill approved kept).
  Variance = Actual − Tentative. Capacity status GREEN < 90 %, AMBER 90–100 %, RED > 100 %.
- **Compare Report:** all-farm demand vs mill capacity per diet and bin; over-capacity notifies
  Mill Manager and Head of Farms and asks Farm Managers to reduce (cp. 34, 35).
- **Scheduler** (`@nestjs/schedule`, new dependency): Wednesday tentative plan + forecast + "plan
  ready" (cp. 36); Friday reminder for AUTO_DRAFT; Saturday cutoff CRITICAL to Farm Manager and Head
  of Farms (cp. 20); daily diet-change warning 3 days ahead (cp. 30); escalation of unacknowledged
  alerts. Times and zone from Feed Planning Settings.
- **Channels:** IN_APP and EMAIL per Alerts master rule, via existing nodemailer. Without SMTP
  configuration the email is logged SKIPPED, never SENT.

## 6. Part D — monthly stock take and period close

- Extend `feed_stock_count`: `count_type` WEEKLY / MONTHLY, `stock_take_type` FARM / FEED_MILL,
  `reporting_period_id`, location generalised so a mill can be counted. Number
  ST-FarmCode-YYYY-NNNNN / ST-MILL-YYYY-NNNNN; monthly date = period end date.
- Line adds `period_consumption_kg`; variance % = |variance| ÷ period consumption × 100
  (Silo Balance row 43). Reason for any nonzero variance; Finance approval above the configured
  threshold; adjustment type from the sign; posted once through the existing approval/adjustment
  path.
- **Period close:** allowed only with a posted MONTHLY stock take for every farm and mill
  (cp. 31). Closed period blocks POST Day, receipts and adjustments dated in it (cp. 32). Stock take
  refused if the period does not exist (cp. 40).

## 7. Data

- **Migrations** (one owner): apply pending 0135–0140 locally; 0141 additive (new tables and
  columns); 0142 drops §3.3 columns after the data script has copied them. Local `nf_devco` only;
  the test server waits for Rishi's backup.
- **Script** `db-align-feed-tdd` (read-only plan, `--verify`, `--apply`): safety stock 0, move
  farm logistics values, recalculate open AUTO_DRAFT requisitions, renumber feed requisition lines.
- **Illustrative fixture** (named, labelled illustrative): one MILL01 location, capacity 238,000
  KG/day (178,000 bulk / 60,000 bagged), bins BIN01 and BIN04 from the workbook. Not client data.

## 8. Verification

Each part: failing test first, then implementation, then the running app (API 2877, web 3002)
and MySQL `nf_devco`. Final run of the Worked Example: forecast 6,000 / 9,000 → requisition →
approval → production output → consolidation (Diet 1 12,000 vs 20,000 GREEN) → TO → loading →
dispatch → receipt (SILO1 7,500) → POST Day (5,500) → stock take −100 KG → period close. Also
cover: bagged destination, partial and over receipt, silo with a different non-empty item,
capacity breach, one-to-many and many-to-many silo topologies. Report in
`docs/VERIFICATION-<completion date>-feed-tdd-alignment.md`, dated the day verification finishes.

## 9. Out of scope

BC connector, outbox and mode selector (R4); raw-material consumption in production (R5); SMS
and WhatsApp; vehicle route ETA (Req. row 76 references a Vehicle Management module that does not
exist — dispatch notice omits the estimated arrival).
