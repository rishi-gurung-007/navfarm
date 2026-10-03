# Verification — Feed TDD alignment, Part A (Tasks 1–9), 2026-10-03

**Branch** `feat/feed-forecast-requisition-integration`, worktree
`/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`,
HEAD `061d5c3a`.
**Databases** local only: `nf_devco`, `nf_system` on `127.0.0.1:3306` (TiDB lines
commented out in `apps/api/.env`). The test server was never touched.
**API** `http://127.0.0.1:2877/api/v1`, rebuilt from this worktree's source and
restarted (see "The build that was not the build" below — this mattered).
**Web** `http://localhost:3002`, Next dev server started from this worktree.
**Login** `company.admin@triplec.local` (COMPANY_ADMIN), workspace scope COMPANY.

This is a verification by driving the running application and reading MySQL, as
`CLAUDE.md` and `AGENTS.md` require. Nothing below is asserted on the strength of
a passing test. Where I could not drive a path, it says so.

---

## 0. Headline

Three real defects, found only because the app was driven:

| # | Defect | Owner | Status |
|---|---|---|---|
| **D1** | `POST /feed-requisition/auto-draft` **500s** on any farm with an animal-registered batch — `requisition_line_batch.batch_id` is `varchar(36)` with an FK to `batch_header`, but the engine's row key for a stage-split batch is the 73-char composite `"<batchId>:<stageId>"`. The breakdown insert fails with `ER_DATA_TOO_LONG`. Seven of the nine demo farms cannot draft at all. | **Part A, Task 9** (migration 0143 created the table) | open |
| **D2** | `POST /feed-forecast/runs` ("Save Run") **500s** with the same `ER_DATA_TOO_LONG` on `feed_forecast_run_line.batch_id` for the same reason. Pre-existing (the composite id is from `b06441ee`, 25 Sep), but it has evidently never been exercised. | pre-Part-A | open |
| **D3** | nx replays **another tree** for `api:build` and `web:dev` too, not only `test web`/`lint web`. `pnpm nx run api:build` from inside this worktree writes the **main checkout's** `apps/api/dist`. Running the API from `apps/api/dist/main.js` therefore served a bundle that did not contain the Task 9 review fixes, and produced one false "mismatch" before I caught it. | tooling | documented, workaround below |

Plus four smaller findings (F1–F4) in §6.

All four debts Part A owed this task are **verified** (§2). The forecast and
requisition arithmetic was checked by hand against MySQL and matched exactly
(§3).

---

## 1. Gates (Step 1) — exact counts

Run in this worktree. Per the Amendments, nx was **not** used for the web suite
or lint; `tsc` was also invoked directly rather than through `nx run-many`,
because of D3.

| Gate | Command | Result |
|---|---|---|
| API unit suite | `cd apps/api && npx jest --maxWorkers=2` | **165 suites, 2011 tests, all passed** (12.5 s) |
| Web unit suite | `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2` | **81 suites, 485 tests, all passed** (6.4 s) |
| API typecheck | `cd apps/api && npx tsc --noEmit -p tsconfig.app.json` | **0 errors** |
| Web typecheck | `cd apps/web && npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| web-e2e typecheck | `cd apps/web-e2e && npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| Web lint | `cd apps/web && npx eslint . --format json` | **93 errors, 925 warnings over 348 files** |

Web lint: the memory baseline is 94 errors as of 2026-09-28; this branch measures
**93**, i.e. no new errors. **Not one error is in a feed file** — the error list
is entirely pre-existing panels (`animal-panel.tsx` 11, `batch-panel.tsx` 8,
`goods-issue-panel.tsx` 6, `goods-receipt-panel.tsx` 6, …). No
`feed-forecast-*`, `feed-requisition-*`, `requisitions-panel`, `feed-planning-*`
file appears. `react-hooks/exhaustive-deps` was not touched.

Nothing in the gates failed, so nothing was routed back.

---

## 2. The four debts Part A owed this task

### Debt 1 — Task 7's `loadSiloFacts` / `loadLatestRequisitionStatuses` SQL had never run

**Verdict: VERIFIED. The SQL runs clean and its output matches MySQL by hand.**

(The brief calls the second method `loadOpenRequisitionStatuses`; in the code it
is `loadLatestRequisitionStatuses`, `feed-forecast.service.ts:1324`.)

```
GET /api/v1/feed-forecast/silo-status?farmId=<GRA100>   → 200, 6641 bytes, 8 rows
```

First row as returned:

```json
{"siloId":"86b562f4-b2c9-49d3-af58-81524764841c","siloCode":"GRA100/SILO-001",
 "houseCodes":["GRA100/SHED-001"],"capacityKg":12000,"belowFeedLevelKg":2400,
 "aboveThresholdKg":10800,"feedInSiloItemName":"Weaner Grower Mash (18% CP)",
 "feedType":"BULK","systemBalanceKg":5172,"lastApprovedCountKg":null,
 "lastFeedReceiptDate":"2026-09-28","dailyRequirementKg":6.6,"daysRemaining":783.6,
 "projectedNeedKg":46.2,"projectedShortfallKg":0,"recommendedOrderKg":0,
 "requisitionStatus":"PENDING_APPROVAL","submissionDeadline":"2026-10-03","alert":null}
```

Checked by hand against MySQL:

```sql
-- systemBalanceKg
select posting_date, entry_type, transaction_type, quantity
from inventory_ledger where warehouse_id='86b562f4-b2c9-49d3-af58-81524764841c'
order by posting_date, created_at;
-- 12 BIO_CONSUMPTION_PREMATURE rows summing to -528.00, one PURCHASE +6000.0000
-- (2026-09-28), one TRANSFER_SHIPMENT -300.0000.
-- 6000 - 300 - 528 = 5172  → matches systemBalanceKg 5172 exactly.
-- lastFeedReceiptDate: the only POSITIVE/PURCHASE row is 2026-09-28 → matches.
```

```sql
-- requisitionStatus (the loader the brief flagged)
select r.req_no, r.status, r.submission_deadline, r.deleted_at,
       l.line_seq, s.location_code
from requisition r join requisition_line l using(requisition_id)
left join location_master s on s.location_id=l.destination_location_id
where r.doc_type='FEED' and r.farm_id='91fc4563-61db-4a04-a1cb-4f78b00df1ac';
-- REQ-GRA100-2026-00001 | PENDING_APPROVAL | 2026-10-03 | NULL | 10000 | GRA100/SILO-001
```

The one GRA100 feed requisition line targets SILO-001 with
`submission_deadline = 2026-10-03`, the same deadline the API computed — and
SILO-001 is the only row in the response carrying a `requisitionStatus`; the
other seven are `null`. The join, the deadline equality, the `notInArray`
exclusion and the newest-wins reduction all behaved. Internal consistency also
holds: `5172 / 6.6 = 783.6` (one decimal), `6.6 × 7 = 46.2`.

The endpoint was additionally called for **eight further farms** (AI100, LEX100,
LEA100, LIO100, MUL100, POR100, RIC100, VIL100) — 200 on every one, 2 to 8 rows
each, no SQL error anywhere.

### Debt 2 — Task 9 had written nothing through the running app

**Verdict: VERIFIED for `requisition_line_batch`, `requisition_date`, the PUT 400
refusals and the `header` payload — on a COUNT_ONLY farm. BLOCKED by D1 on every
animal-registered farm.**

A draft was created by clicking **Draft from forecast** in the browser
(`/inventory/feed-forecast?tab=feed-requisition`, farm LEX100). MySQL
immediately after:

```sql
select * from requisition where req_no='REQ-LEX100-2026-00001'\G
--        req_no: REQ-LEX100-2026-00001        status: AUTO_DRAFT
--      doc_type: FEED                  requisition_type: FEED_FORECAST
--        source: AUTO_FORECAST                  purpose: INTERNAL_TRANSFER
-- supply_source: MILL                          priority: CRITICAL_FIRST_PRIORITY
-- requisition_date: 2026-10-03     submission_deadline: 2026-10-03
--   required_date: 2026-10-05        production_date: 2026-10-04
-- forecast_run_key: RUN-LEX100-20261003-190750
```

`requisition_date` is written on a new draft — the Task 9 column, proven by a
real write, not a fixture.

```sql
select * from requisition_line_batch\G
--     line_batch_id: fb9c8865-…        line_id: 17e0a899-…
--          batch_id: 94f5074b-1020-4441-8a5f-f8d77b725fca
--           shed_id: 346f67d2-…        heads: 120
--      feed_rate_kg: 0.800000       demand_kg: 672.0000
-- first_demand_date: 2026-10-03
```

The batch/house breakdown insert ran for real. On a second **Draft from
forecast** the row was deleted and re-inserted with a new `line_batch_id`
(`fb9c8865…` → `92640bee…`), the rerun behaviour Task 9 designed, observed live.

PUT refusals, driven from the line sub-form in the browser (item changed to
ICAT-004-ITM-0002 with no exception reason, destination left on SILO-001 which
holds Weaner Grower Mash):

```
PUT /api/v1/feed-requisition/811f4503-… → 400 Bad Request
"Line 10000: Feed item differs from the lifecycle requirement: record an exception
 reason (Requisition row 13). Line 10000: Silo holds another feed with stock: choose
 a silo holding this item or an empty one (checkpoint 4)."
```

and MySQL after the 400 showed the line **unchanged** (`item_id` still
`80f9fe4c…`, `destination_location_id` still SILO-001, `quantity_edited` 0) —
the refusal wrote nothing.

The `header` payload was read in the browser and every field cross-checked
against MySQL; the table is in §4.

### Debt 3 — migration 0144, and a one-decimal value actually landing

**Verdict: VERIFIED.** Migration state re-read independently:

```sql
select table_schema, column_type from information_schema.columns
where table_name='requisition_line' and column_name='days_remaining'
  and table_schema in ('nf_devco','nf_system');
-- nf_devco  decimal(10,1)
-- nf_system decimal(10,1)
select 'nf_devco', count(*) from nf_devco.__drizzle_migrations
union all select 'nf_system', count(*) from nf_system.__drizzle_migrations;
-- nf_devco 145 ; nf_system 145
```

A real write through the app landed a one-decimal value:

```sql
select days_remaining from requisition_line where line_seq=10000;  -- 2.7
```

`256 / 96 = 2.6666…` → stored `2.7`. The browser renders it as **2.7** in the
requisition line sub-form ("DAYS REMAINING / FIRST SHORTAGE DATE: 2.7 05/10/26")
and as **2.7** on the silo dashboard. One decimal on both sides, as the workbook
requires (Silo Balance and Stock Take row 9).

### Debt 4 — the silo/item-change blanking and the "capacity unknown" cell

**Verdict: VERIFIED — but only after the API was rebuilt correctly; see D3.**

Driven in the browser: line 10000 moved to LEX100/STORE-001, item changed to
ICAT-004-ITM-0002, exception reason "Vet instruction", Save.

```sql
select * from requisition_line … \G
--            item_id: 8f8518a2-…            description: Exception: Vet instruction
-- destination_location_id: 9d0d8f58-…(STORE-001)  source_type: STORE
--  system_balance_kg: NULL          daily_requirement_kg: NULL
--     days_remaining: NULL           first_shortage_date: NULL
-- recommended_qty_kg: NULL             unrounded_need_kg: NULL
-- exceeds_silo_capacity: 0                quantity_edited: 1
```

All six forecast-derived columns NULL, `exceeds_silo_capacity` false,
`quantity_edited` true, the reason stored with the `Exception: ` prefix.

The UI renders the unknown state, not a false "no warning":

```js
document.querySelector('[data-testid="rqd-capacity-unknown"]')
// text "—", title "Not yet calculated for this silo — rerun the forecast or
//                re-check after changing the destination or item"
```

and the row shows "—" for System Balance, Daily Requirement, Days Remaining and
Recommended Qty.

**The honest part.** On my first pass this check **failed** — all six columns
still held the old silo's numbers. That was not a code defect: the API I was
running had been built by `pnpm nx run api:build`, which wrote the *main
checkout's* dist, so `apps/api/dist/main.js` in this worktree was an 18:01
bundle from an earlier session that predates commit `061d5c3a`
(`grep -c "system_balance_kg: null" dist/main.js` → `0`). After rebuilding the
worktree properly the same UI steps produced the result above. I report the
false alarm because the tooling trap that caused it is itself a finding (D3).

---

## 3. The forecast and the draft, checked by hand (Step 3)

### Choice of farm — a deviation from the brief, stated plainly

The brief says to use "a four-farm demo farm". **The four-farm demo has never
been seeded into `nf_devco`**: `select location_code, location_name from
location_master where location_name like '%Demo Farm%'` returns nothing, and the
fixture's farms (`Demo Farm One`…`Four`,
`src/scripts/demo/four-farm-feed-fixture.ts`) do not exist. The nine seeded farms
(AI100, GRA100, LEA100, LEX100, LIO100, MUL100, POR100, RIC100, VIL100) are what
is there.

Worse, **no seeded farm has a shortage inside the 7-day window**. Calling
`silo-status` on all nine returned `recommendedOrderKg = 0` and no
`firstShortageDate` for every silo; the tightest were RIC100/SILO-002 at 15.2
days and VIL100/SILO-002 at 15.3. So "Draft from forecast" says *"Nothing to
order: stock covers the forecast."* on every farm — I drove that on RIC100 and
on LEX100 and saw exactly that message.

And the longer window is not reachable from the UI (F1 below).

So, to get a real write, I **posted a stock adjustment through the running app**
to create a genuine shortage on the one farm D1 does not block:

- `POST /stock-adjustment` + `/post` → **ADJ-000010**, LEX100/SILO-001,
  −5600 KG Weaner Grower Mash, reason VARIANCE_NEGATIVE, remarks "Task 10
  verification…". Balance 5856 → **256 KG**.
- Restored afterwards: **ADJ-000011**, +5600 KG @ 34.50 (the layer rate from the
  ledger). `select sum(quantity) … where warehouse_id='25944114-…'` → **5856.0000**,
  the original balance.

This is a parameter change to seeded data through the app's own posting path, not
an invented scenario; every rule under test (shortfall, rounding, delivery date,
safety stock, breakdown) is exercised unchanged. **It is still a deviation and
Rishi should know it was needed.**

### The forecast grid, read in the browser

LEX100/SILO-001 after the adjustment, from `GET /feed-forecast/silo-status` and
the Dashboard tab:

```
LEX100/SILO-001 | LEX100/SHED-001 | Bulk | Weaner Grower Mash (18% CP) |
capacity 15,000 | below feed level 3,000 | above threshold 13,500 |
System Balance 256 | last count — | last receipt 28/09/26 |
daily requirement 96 | days remaining 2.7 | first shortage 05/10/26 |
projected need 1,172 | projected shortfall 916 | recommended order 3,000 |
submission deadline 03/10/26 | alert "Critical — first priority"
```

The balance column is labelled **"System Balance"** throughout (cp. 37) — checked
on the dashboard header and on the requisition line sub-form.

### Line-by-line arithmetic, done by hand

Safety stock 0 (company default, `feed_planning_setting` empty for LEX100 at this
point; the API's own `settings` block returned
`{"safetyStockKg":0,"bulkMultipleKg":3000,"bagSizeKg":50}`):

| Quantity | Hand calculation | Stored in MySQL |
|---|---|---|
| daily requirement | 120 heads × 0.8 kg/head/day = **96** | `daily_requirement_kg` 96.0000 ✓ |
| window demand | 96 × 7 days = **672** | breakdown `demand_kg` 672.0000 ✓ |
| unrounded need | 672 demand + 0 safety − 256 opening − 0 confirmed incoming = **416** | `unrounded_need_kg` 416.0000 ✓ |
| recommended | CEILING(416 ÷ 3000) × 3000 = **3000** | `recommended_qty_kg` 3000.0000 ✓ |
| first shortage | close 03/10 = 160, 04/10 = 64, 05/10 would be −32 → **2026-10-05** | `first_shortage_date` 2026-10-05 ✓ |
| delivery date | = first shortage date → **2026-10-05** | `recommended_delivery_date` and `proposed_delivery_date` 2026-10-05 ✓ |
| days remaining | 256 ÷ 96 = 2.666… → **2.7** | `days_remaining` 2.7 ✓ |
| header required date | min line delivery date → **2026-10-05** | `required_date` 2026-10-05 ✓ |

Full row:

```sql
select r.req_no, r.status, r.requisition_date, r.required_date, r.forecast_run_key,
       l.line_seq, l.system_balance_kg, l.daily_requirement_kg, l.days_remaining,
       l.unrounded_need_kg, l.recommended_qty_kg, l.quantity, l.first_shortage_date,
       l.recommended_delivery_date, l.proposed_delivery_date, l.exceeds_silo_capacity,
       l.quantity_edited
from requisition r join requisition_line l using(requisition_id)
where r.farm_id='a985050d-247a-43aa-bb4c-22cb38782367';

REQ-LEX100-2026-00001 | AUTO_DRAFT | 2026-10-03 | 2026-10-05 | RUN-LEX100-20261003-190750
  | 10000 | 256.0000 | 96.0000 | 2.7 | 416.0000 | 3000.0000 | 3000.0000
  | 2026-10-05 | 2026-10-05 | 2026-10-05 | 0 | 0
```

`exceeds_silo_capacity` false is right by hand too: 256 + 3000 = 3256 against a
15,000 KG silo.

### Safety stock 0 → 500, re-draft

Set through the UI (Settings → Inventory Setup → **Silo Feed Setup** → LEX100 →
Safety Stock KG = 500 → Save). It landed:

```sql
select farm_id, safety_stock_kg, is_active, active_scope_key from feed_planning_setting;
-- a985050d-… | 500.00 | 1 | F:a985050d-…
```

**Draft from forecast** again, then MySQL:

```
REQ-LEX100-2026-00001 | 10000 | bal 256.0000 | daily 96.0000 | dr 2.7
                      | need 916.0000 | rec 3000.0000 | qty 3000.0000 | fsd 2026-10-05 | qe 0
```

**416 → 916: exactly +500**, and nothing else moved — balance, daily requirement,
days remaining, first shortage date and the recommendation are unchanged. The
silo's Below Feed Level (3,000 KG) is still nowhere in the shortfall, as the
constraints require.

(The same +500 result was produced twice: once on the first pass and once again
after the correct rebuild. Both are recorded.)

### An edited line keeps its quantity across a rerun

Requested Qty set to **6,000** in the line sub-form → Save:

```
quantity 6000.0000 | quantity_edited 1 | unrounded_need_kg 916.0000 | recommended_qty_kg 3000.0000
```

**Draft from forecast** again:

```
quantity 6000.0000 | quantity_edited 1 | unrounded_need_kg 916.0000 | recommended_qty_kg 3000.0000
```

The farm's own quantity survived the rerun untouched (Ruling M9).

---

## 4. The document, the refusals and the submit (Step 4)

### Delivery date without remarks → refused; with remarks → accepted

Proposed Delivery Date moved 05/10 → **08/10** in the sub-form and saved
(`proposed_delivery_date` 2026-10-08, `required_date` rolled to 2026-10-08,
`recommended_delivery_date` still 2026-10-05). The browser **disabled "Submit for
approval"** and showed the remarks prompt. Submitting through the API with no
remarks to see the server's own refusal:

```
POST /api/v1/feed-requisition/811f4503-…/submit  {}   → 400 Bad Request
"Line 10000 (Dry Sow Gestation Mash (14% CP)): the delivery date differs from the
 forecast's. Remarks are required (Requisition row 29).
 Line 10000 (Dry Sow Gestation Mash (14% CP)): feed item differs from the lifecycle
 requirement (exception). Remarks are required (Requisition row 36)."
```

Both Task 5's row-29 rule and the Task 9 review's row-36 rule fire, and the line
is named by its **item name**, not by the exception description — the
`linesForCheck` join fix, confirmed live.

Remarks typed into the header Remarks box, **Submit for approval** clicked in the
browser:

```sql
select req_no, status, remarks, required_date, approval_request_id,
       proposed_delivery_date, quantity, description …
-- REQ-LEX100-2026-00001 | PENDING_APPROVAL
-- | "Delivery moved to 08/10 at the mill's request; vet instructed the gestation diet for this house."
-- | 2026-10-08 | 3e699add-9905-4d5a-a159-e2819d5327ec | 2026-10-08 | 6000.0000 | Exception: Vet instruction
```

Accepted, an approval request created, and the moved date persisted.

### The item change refusals

Both drove from the UI and both refused with 400 (§2, Debt 2). The exception
reason input appeared in the row **only** once the item differed from
`required_item_id`, as Task 9 specified.

A note on coverage: the brief also asks for "a silo holding another item with
stock". At LEX100 **both** silos hold the same feed (Weaner Grower Mash), so the
cross-silo form of that rule could not be set up there. What I drove is the same
rule's other arm — the line's own destination holding a different feed with stock
— and it refused with the checkpoint-4 message. The two-lines-in-one-silo variant
added by the Task 9 review (*"a silo cannot hold two feeds at once"*) was **not**
driven; it has unit-test evidence only. See §7.

### Header and line, field by field, against MySQL

Read from the browser after submit (read-only document) and compared to the row:

| Document field | Shown | MySQL |
|---|---|---|
| Requisition No. | REQ-LEX100-2026-00001 | `req_no` same ✓ |
| Requisition Date | 03/10/26 | `requisition_date` 2026-10-03 ✓ |
| Requisition Type | From forecast | `requisition_type` FEED_FORECAST ✓ |
| Source | Forecast | `source` AUTO_FORECAST ✓ |
| Farm Code / Farm Name | LEX100 / LIONSHEAD EXTENSION | `location_master` ✓ |
| Is Next Diet Requisition | No | line `is_next_diet` 0 ✓ |
| Status | Waiting for approval | `status` PENDING_APPROVAL ✓ |
| Priority | Urgent | `priority` CRITICAL_FIRST_PRIORITY (label map) ✓ |
| Submission Deadline | 03/10/26 | `submission_deadline` 2026-10-03 ✓ |
| Required Delivery Date | 08/10/26 | `required_date` 2026-10-08 ✓ |
| Supplier or Source | Mill | `supply_source` MILL ✓ |
| Requisition Purpose | Internal Feed Transfer | `purpose` INTERNAL_TRANSFER ✓ |
| Farm Total Requested KG | **0 KG of 30,000 KG target · 0 truck trip(s)** | line `quantity` 6000.0000 — **see F2** |
| Bulk Order Multiple | 3,000 KG | settings default ✓ |
| Approved By / Approval Date Time | — / — | `approved_by` NULL, `approved_at` NULL ✓ |
| Linked Transfer Order No. | — | `linked_transfer_id` NULL ✓ |
| Forecast Run | RUN-LEX100-20261003-190928 | `forecast_run_key` same ✓ |
| Remarks | the typed text | `remarks` same ✓ |

Line columns (15, in workbook order): Line No. **10000** displayed as the
10000-step number, Silo Code LEX100/STORE-001, Feed Item No. ICAT-004-ITM-0002,
Description "Dry Sow Gestation Mash (14% CP)" with "Vet instruction" beneath,
Feed Type **Bagged** (store default), Is Next Diet Line No, Days Before Diet
Change —, Breed Lifecycle Row "Z-Line-Sow WEANER days 1–43"
(`lifecycle_ref_id` b7d9093f-…), System Balance —, Daily Requirement —, Days
Remaining / First Shortage —, Recommended Qty —, Requested Qty **6,000**, Bag
Count **120** (= 6000 ÷ 50 ✓), Proposed Delivery Date 08/10/26. The nested
breakdown table shows BATCH-000023 | LEX100/SHED-001 | 120 | 0.8 |
Z-Line-Sow WEANER days 1–43 | 672, read-only. All match the rows above.

---

## 5. The two 500s, in full

### D1 — the batch/house breakdown cannot be written for an animal-wise batch

`POST /feed-requisition/auto-draft` for RIC100 (`to=2026-11-16`) → **500**. API log:

```
Unhandled Exception: DrizzleQueryError: Failed query: insert into `requisition_line_batch`
 (`line_batch_id`, `line_id`, `batch_id`, `shed_id`, `heads`, `feed_rate_kg`,
  `lifecycle_ref_id`, `demand_kg`, `first_demand_date`, `created_at`) values (?,?,…)
  cause: Error: Data too long for column 'batch_id' at row 1   (ER_DATA_TOO_LONG, 1406)
```

Cause, traced in the source: `feed-forecast.service.ts:499`

```ts
// ANIMAL_WISE groups need distinct ids: the engine keys its rows by (batchId, item).
batchId: animalWise ? `${b.batch_id}:${g.stageId}` : b.batch_id,
```

That composite is 73 characters. `requisition_line_batch.batch_id` is
`varchar(36)` **and** carries
`requisition_line_batch_batch_id_fk  batch_id → batch_header.batch_id`, so
widening the column alone would not help: a composite id is not a batch key at
all. The breakdown needs the real `batch_id` (and, if the stage matters, its own
column).

Blast radius in the demo data: batches with `animal_tracking = 'REGISTERED'` exist
on **RIC100, GRA100, POR100, VIL100, LIO100, LEA100 and MUL100** — seven of nine
farms. Only AI100 and LEX100 can auto-draft, and only LEX100 could be made to
produce a line at all.

Rollback was clean: after the 500, `select count(*) from requisition where
doc_type='FEED'` was unchanged at 4 and `requisition_line_batch` had 0 rows.

### D2 — Save Run has the same problem on `feed_forecast_run_line`

Clicking **Save Run** on the Forecast tab for RIC100 → **500**, surfaced in the
UI as "Internal server error" beside the button. API log:

```
insert into `feed_forecast_run_line` (… `batch_id` …) values
 ('5cfb0707-…','b33b884a-…','2026-10-03',
  '1013720d-aada-4594-adc0-4297d1019a0d:5f1b226d-8f67-42e1-a5e3-2167fedb14ea', …)
  cause: Error: Data too long for column 'batch_id' at row 1
```

Reproduced from the API directly, and bisected:

```
POST /feed-forecast/runs  {farmId: AI100,  2026-10-03 … 2026-10-09} → 201
   data: {runCode:"FFR-7ce78031-4d54-42d3-a80e-6b801573471f-000001", version:1}
POST /feed-forecast/runs  {farmId: RIC100, 2026-10-03 … 2026-10-09} → 500
```

AI100 has only a COUNT_ONLY batch, RIC100 has a REGISTERED one. MySQL after the
201: one `feed_forecast_run` row, 7 `feed_forecast_run_line` rows. The composite
id predates this branch (`b06441ee`, 25 Sep), so D2 is **not** Part A's — but it
means Save Run has never worked on a farm with registered animals, which is most
of them.

---

## 6. Other findings

**F1 — "Draft from forecast" ignores the forecast window the user is looking at.**
`requisitions-panel.tsx:176` posts `{ farmId }` only; `AutoDraftFeedRequisitionDto`
accepts `to` (default planning date + 7, max + 45) and the panel never sends it.
So the draft is always a 7-day draft, however the Forecast tab's Date To is set,
and there is no way to raise a requisition for a shortage 15 or 30 days out from
the UI. This is why the brief's Step 3 could not be completed on the seeded data
without a stock adjustment.

**F2 — "Farm Total Requested KG" reads 0 KG for a 6,000 KG bagged line.**
After the line moved to a STORE its `feed_type` became BAGGED, and the header then
showed `0 KG of 30,000 KG target · 0 truck trip(s)` while the line requests 6,000
KG. The value is the *bulk* total (Task 9 report, "the bulk total … from
`resolveForFeedPlanning`), but the label says *Farm Total Requested KG*, so the
document contradicts its own line. Either the label or the computation needs a
decision from Rishi. Observed, not judged.

**F3 — the saved-run code embeds a UUID.**
`FFR-7ce78031-4d54-42d3-a80e-6b801573471f-000001`. Every other document code in
this app uses the farm *code* (`REQ-LEX100-2026-00001`, `ADJ-000010`), and the
draft's own `forecast_run_key` is `RUN-LEX100-20261003-190928`. Cosmetic, but it
will show in Run history.

**F4 — a drafted requisition does not link to a saved run.**
`requisition.feed_forecast_run_id` was NULL on every draft I made, and
`feed_forecast_run` had no LEX100 row at all; the link is carried only by the
free-text `forecast_run_key`. The document's "Forecast Run" field therefore shows
a key that matches no stored run. Consistent with how Task 9 wrote the view
(`run_code`, falling back to `forecast_run_key`), so probably by design — flagged
because an auditor following that reference will find nothing.

**D3 in detail — nx replays another tree for `api:build` and `web:dev` as well.**
- `pnpm nx run web:dev` from this worktree served the **main checkout**, which
  currently fails to compile (`Module not found: Can't resolve
  './feed-forecast-run-history'` — the file exists here and is tracked, but is
  absent from the main checkout's working tree). The Feed Forecast page 500'd
  until I started Next directly. *(Side note for Rishi: the main checkout on
  `fix/series-and-item-kinds-batch` is currently broken for that page.)*
- `pnpm nx run api:build`, with `--skip-nx-cache`, with `NX_DAEMON=false`, and
  with the worktree's own `./node_modules/.bin/nx` — all three wrote the **main
  checkout's** `apps/api/dist`. Proof: I moved this worktree's `dist/main.js`
  aside, ran the build, nx reported success, and `apps/api/dist/main.js` was
  **still absent**.
- **The workaround that works** (use it, and verify the bundle after):
  ```bash
  cd apps/api && NODE_ENV=production \
    NX_WORKSPACE_ROOT_PATH=<worktree-root> NX_TASK_TARGET_PROJECT=api \
    NX_TASK_TARGET_TARGET=build ../../node_modules/.bin/webpack-cli build
  grep -c "<a string from your newest commit>" dist/main.js   # must be ≥ 1
  ```
  Web: `cd apps/web && ../../node_modules/.bin/next dev --port 3002`.
- Running the API from source (`node --import tsx src/main.ts`) fails on
  `experimentalDecorators`; it is not an escape hatch.

---

## 7. What I could not verify, and why

- **Any auto-draft on an animal-registered farm** (RIC100, GRA100, POR100,
  VIL100, LIO100, LEA100, MUL100) — blocked by D1. Everything in §3 and §4 was
  therefore proven on **one** farm, **one** line and **one** breakdown row.
  Multi-line drafts, per-silo ordering, two lines in one requisition, and the
  truck-trip total over several lines are **not** verified by a live write.
- **Save Run on any farm with a registered batch** — blocked by D2. The one
  saved run is AI100's.
- **The two-lines-in-one-silo refusal** added by the Task 9 review
  (*"a silo cannot hold two feeds at once (checkpoint 4)"*) — needs a
  two-line requisition, which needs D1 fixed. Unit-test evidence only.
- **A capacity warning actually firing** (`exceeds_silo_capacity` true) — the one
  line I could create orders 3,000 KG into a 15,000 KG silo holding 256 KG. Not
  driven.
- **Bagged rounding to the 50 KG bag size** — the one line was BULK until it
  moved to a store, where `bag_count` 120 was computed from an already-rounded
  6,000. The bag-size rounding path itself was not driven.
- **The approval screens** (Part E) — out of scope by ruling, not touched.
- **`nx run-many -t typecheck`** — not run as such; each project's `tsc` was run
  directly because of D3. The counts in §1 are from those direct runs.

## 8. Changes this verification made to `nf_devco`

| What | Why | Reversed? |
|---|---|---|
| ADJ-000010, −5600 KG on LEX100/SILO-001 | create a 7-day shortage so a draft could be raised at all | **yes** — ADJ-000011, +5600 KG @ 34.50; balance back to 5856.0000 |
| `feed_planning_setting` row for LEX100 | the safety-stock 0 → 500 → 0 test | value back to **0.00** (the default); the row remains |
| `feed_forecast_run` FFR-…-000001 (AI100) | proving Save Run works where D2 does not bite | left in place as evidence |
| REQ-LEX100-2026-00001 (PENDING_APPROVAL) | the verification draft | left in place as evidence |
| One earlier REQ-LEX100-2026-00001 | created on the stale bundle; deleted so the rerun was clean | deleted (rows removed from `requisition`, `requisition_line`, `requisition_line_batch`) |

Screenshots: `.playwright-mcp/t10-forecast-ric100.png`,
`t10-requisition-document.png`, `t10-requisition-submitted.png`,
`t10-silo-dashboard-lex100.png` (worktree-local, not committed).
