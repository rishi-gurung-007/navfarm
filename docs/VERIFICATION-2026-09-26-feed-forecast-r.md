# Feed Forecast Plan R — verification against `nf_devco`

Plan: `docs/superpowers/plans/2026-09-26-feed-forecast-r-report-alignment.md` (Task 11).
Spec: `docs/superpowers/specs/2026-09-25-feed-forecast-design.md`, decisions D16–D20.
Branch: `feat/feed-forecast-report`, at `ec807f1` (Task 10) when this ran.

**Run on 27 Sep 2026, 12:20–12:45 IST** — the document is named for the plan (26 Sep), like
`VERIFICATION-2026-09-26-feed-forecast-b.md`, not for the day it ran. Every figure below was
produced through the running API and checked against MySQL by hand; nothing here is asserted
from a passing test.

The API was the branch build (`pnpm nx run api:build`) started on its configured port 2877
(PID 39889) and stopped afterwards. No web dev server and no browser was started — the page
itself is Rishi's to look at.

Company admin session: `company.admin@triplec.local`, `userType` `COMPANY_ADMIN`, tenant
`devco` → database `nf_devco`, company `a702589e-c189-4ca9-b349-14b6a6b6c2c6`. Farm VIL100 =
`b52f5af8-a2a5-4e79-af10-99f99f8f1821`.

---

## Step 1 — suites, migrations, schema

| Check | Result |
|---|---|
| `pnpm nx test api --maxWorkers=2` | **104 suites, 1383 tests, all pass** |
| `pnpm nx test web --maxWorkers=2` | **42 suites, 250 tests, all pass** |
| `pnpm nx run-many -t typecheck -p api,web` | **pass** |
| `pnpm nx lint web` → ` error ` count | **94**, equal to the Task 9 Step 0 baseline (no new errors) |

`pnpm nx run api:db-migrate-all-tenants` was **refused by the auto-mode classifier**, as
`db-rebuild-demo` is. It was not worked around. It is also a no-op here, which the database
itself shows — migrations were already applied by the previous session:

```sql
SELECT COUNT(*) n, MAX(created_at) last FROM nf_devco.__drizzle_migrations;
-- n = 122, last = 1791135600000   (0121 is the highest migration; 122 rows = 0000..0121)

SHOW COLUMNS FROM nf_devco.location_master LIKE 'feed_lead_time_days';
-- feed_lead_time_days | int | YES | | Default 2 |      <- 0120's new default

SELECT feed_lead_time_days, COUNT(*) n FROM nf_devco.location_master
WHERE location_type='FARM' GROUP BY 1;
-- 2 | 11        <- all eleven farms, Q11 satisfied (none left at 0)

SHOW TABLES FROM nf_devco LIKE 'reporting_period';   -- reporting_period    (0121)
SHOW COLUMNS FROM nf_devco.location_master WHERE Field IN ('low_level_kg','high_level_kg');
-- low_level_kg | decimal(12,2) | YES | | NULL |       (0117, Plan B)
-- high_level_kg | decimal(12,2) | YES | | NULL |
```

## Step 3 — the planning date is the farm's day (D16, Q14)

```
GET /feed-forecast?farmId=$FARM&view=DAILY
{ "planningDate": "2026-09-27", "today": "2026-09-27", "timeZone": "Africa/Harare",
  "view": "DAILY", "from": "2026-09-27", "to": "2026-09-27",
  "forecastFrom": "2026-09-27", "horizonTo": "2026-11-11" }
```

`TZ=Africa/Harare date +%F` = `2026-09-27`; `+45d` = `2026-11-11`. The zone came from the
company's `default_timezone_id`, and the report names it, so a reader can tell whose day it
is. Daily set `from` = `to` = that one day, and the projection horizon still reached 45 days
past it — Q12's rule that a one-day view still shows Run-Down / Refill / Required On.

## Step 4 — Reporting Period Master (D20, Q9, Q10)

`POST /reporting-period/generate {"business_year_start":2026}` → **12 created**, none skipped
(the company had none: `SELECT COUNT(*) … WHERE company_id='…'` was 0 first).

```sql
SELECT period_code, business_year, start_date, end_date, stock_take_date,
       production_start_date, DAYNAME(end_date), DAYNAME(production_start_date)
FROM nf_devco.reporting_period WHERE company_id='a702589e-…' ORDER BY start_date;
```

| code | year | start | end | stock take | production start | end day | prod day |
|---|---|---|---|---|---|---|---|
| 2026-07 | 2026-27 | 2026-06-28 | 2026-07-25 | 2026-07-25 | 2026-07-26 | Saturday | Sunday |
| 2026-08 | 2026-27 | 2026-07-26 | 2026-08-29 | 2026-08-29 | 2026-08-30 | Saturday | Sunday |
| **2026-09** | 2026-27 | **2026-08-30** | **2026-09-26** | **2026-09-26** | **2026-09-27** | Saturday | Sunday |
| 2026-10 | 2026-27 | 2026-09-27 | 2026-10-31 | 2026-10-31 | 2026-11-01 | Saturday | Sunday |
| 2026-11 | 2026-27 | 2026-11-01 | 2026-11-28 | 2026-11-28 | 2026-11-29 | Saturday | Sunday |
| 2026-12 | 2026-27 | 2026-11-29 | 2026-12-26 | 2026-12-26 | 2026-12-27 | Saturday | Sunday |
| 2027-01 | 2026-27 | 2026-12-27 | 2027-01-30 | 2027-01-30 | 2027-01-31 | Saturday | Sunday |
| 2027-02 | 2026-27 | 2027-01-31 | 2027-02-27 | 2027-02-27 | 2027-02-28 | Saturday | Sunday |
| 2027-03 | 2026-27 | 2027-02-28 | 2027-03-27 | 2027-03-27 | 2027-03-28 | Saturday | Sunday |
| 2027-04 | 2026-27 | 2027-03-28 | 2027-04-24 | 2027-04-24 | 2027-04-25 | Saturday | Sunday |
| 2027-05 | 2026-27 | 2027-04-25 | 2027-05-29 | 2027-05-29 | 2027-05-30 | Saturday | Sunday |
| 2027-06 | 2026-27 | 2027-05-30 | 2027-06-26 | 2027-06-26 | 2027-06-27 | Saturday | Sunday |

`2026-09` came out **30 Aug – 26 Sep**, exactly the date pair Q9 predicted from the rule (the
workbook's illustrative 23 Aug – 26 Sep is a different start; Q9 already records that the
client's calendar has not been given and every row stays editable).

Every End is a Saturday and every Production Start the Sunday after. No gaps and no overlaps —
a self-join on consecutive rows gave `DATEDIFF(next.start, this.end) = 1` for all eleven pairs.
Worth telling Rishi: **the July period starts 28 June**, because Start is always the day after
the previous month's end-Saturday. That is the rule working, not a bug, but it means the
business year opens two days before July.

Re-running generate → `created: []`, twelve `already exists`, table still 12 rows. Idempotent.

Refusals, neither of which wrote a row (`SELECT COUNT(*) … WHERE period_code IN
('VERIFY-FRI','VERIFY-OVL')` → 0, total still 12):

- End on a Friday → **400** `End Date must be a Saturday (the month-end stock-take Saturday).`
- 2026-09-20 → 2026-10-03 → **409** `VERIFY-OVL (2026-09-20 to 2026-10-03) overlaps 2026-10 (2026-09-27 to 2026-10-31).`
  It names `2026-10`; the range overlaps both `2026-09` and `2026-10`, and Ruling M3 accepts
  a 409 naming either.

## Step 5 — Current Inventory, intake and Days of Stock by hand (Q5, Q6, D17, D18)

`GET /feed-forecast?farmId=$FARM&view=DAILY` returned 6 rows and 8 stage blocks. The one silo
row, and the three rows that share a store, are the two cases worth computing.

### The silo row — `VIL100/SILO-004`, BATCH-000024, Weaner Grower Mash

API: `currentInventoryKg 2684`, `heads 20`, `perDayIntakeKg 16`, `wastagePct 2`,
`demandKg 16.32`, `daysOfStock 164`, `sharedBatchCount 1`, `indicative false`,
`runDownDate null`.

```sql
-- opening: everything posted before the planning date
SELECT COALESCE(SUM(quantity),0) FROM nf_devco.inventory_ledger
WHERE warehouse_id='7eaf126d-…' AND item_id='e909f676-…'
  AND entry_type IN ('POSITIVE','NEGATIVE') AND posting_date < '2026-09-27';   -- 2684.0000
-- plus that day's posted non-feeding movements
… AND posting_date='2026-09-27' AND document_type<>'BATCH'
  AND transaction_type<>'CONSUMPTION';                                        -- 0.0000
-- the diet's rate and wastage
SELECT l.feed_qty_per_head_per_day_kg, l.feed_wastage_pct …
WHERE b.batch_no='BATCH-000024' AND l.feed_item_id='e909f676-…';
-- WEANER, period 1–43: rate 0.8000, wastage 2.00
```

```
Current Inventory = 2684 + 0                 = 2684 kg      API 2684        ✓
Per Day Intake    = 20 heads x 0.8 kg        = 16 kg        API 16          ✓   (no wastage — D17)
Demand (out)      = 16 x 1.02                = 16.32 kg     API 16.32       ✓   (with wastage — D17)
Days of Stock     = floor(2684 / 16.32)
                  = floor(164.4608)          = 164          API 164         ✓   (Q5: divides by the
                                                                                 with-wastage figure)
```

**Correction to the brief.** Task 11's Step 5 SQL reads heads from
`batch_header.closing_quantity`. That column is **NULL** on every forecast batch here; heads
come from `COALESCE(closing_quantity, opening_quantity)` — BATCH-000024 `opening_quantity` 20,
BATCH-000011 120, BATCH-000012 240, each equal to the API's `heads`. BATCH-000010 is a
registered breeding batch and does not follow either column: its three concurrent stages
reported 13, 12 and 10 heads against an `opening_quantity` of 58, because the forecast counts
that batch's animals per stage (the placeholder-animal handling the 26 Sep handoff describes).

### The shared store — three batches on `VIL100/STORE-001`, item `ICAT-004-ITM-0002`

Each of the three rows reported `sharedBatchCount 3` and `daysOfStock 93`.

```sql
SELECT COALESCE(SUM(quantity),0) FROM nf_devco.inventory_ledger
WHERE warehouse_id='74ddf320-…' AND item_id='<ITM-0002>'
  AND entry_type IN ('POSITIVE','NEGATIVE') AND posting_date < '2026-09-27';   -- 35800.0000
```

```
combined demand = 46.41 (FLUSH) + 30.6 (GESTATION) + 306 (BATCH-000011) = 383.01 kg/day
Days of Stock   = floor(35800 / 383.01) = floor(93.4701) = 93        API 93 on all three   ✓
```

That is D18 proven on real data: the divisor is everything the container feeds, not the row's
own intake, and the shared count tells the reader why.

## Step 6 — run-down to the low level (D19, Q1)

`VIL100/SILO-004` had `low_level_kg` **NULL** to begin with (restored at the end). Buffer and
lead time are read on the **FARM** row, both 2.

Set `low_level_kg` = 2684 − 1 × 16.32 = **2667.68** (`PUT /location/$SILO` → 200; read back
from MySQL = `2667.68`), so day one closes exactly on the level:

```
GET /feed-forecast?farmId=$FARM&view=CUSTOM
  runDownDate 2026-09-27   = the planning date — day one closes at 2667.68, "at or below" (Q1)  ✓
  refillDate  2026-09-25   = run-down − 2 (buffer)                                              ✓
  requiredOn  2026-09-23   = refill − 2 (lead)                                                  ✓
  overdue     true         — Required On is before the planning date                            ✓
  thresholdKg 2667.68
```

The Custom view's eight daily rows also show the balance walking down by exactly one day's
demand, which is the engine's arithmetic made visible:

```
2684.00, 2667.68, 2651.36, 2635.04, 2618.72, 2602.40, 2586.08, 2569.76   (−16.32 each)
daysOfStock  164,    163,     162,     161,     160,     159,     158,     157
```

`shortfallKg` was 114.24 = the window's 130.56 kg of demand (8 × 16.32) minus the 16.32 kg
standing above the level.

**With no low level, there is no run-down inside the horizon on this data.** Setting
`low_level_kg` back to NULL gave `thresholdKg 0`, `runDownDate null`, `refillDate null`,
`requiredOn null`, `overdue false`. The brief expected a zero-out date checked day by day; it
is not reachable here:

```
zero-out day = ceil(2684 / 16.32) = 165 days after 2026-09-27
horizon      = 46 days (planning date + 45) ending 2026-11-11
balance on the last horizon day = 2684 − 46 x 16.32 = 1933.28 kg — still positive
```

So `null` is the correct answer and "lasts beyond the horizon" is what the screen shows. A
zero run-down would need a silo with under 46 days of stock; none exists on VIL100 today.

## Step 7 — a booked transfer counts as incoming, cancelling takes it back (Q2)

Because there is no zero run-down to move (above), the low level was set to
2684 − 5 × 16.32 = **2602.40**, putting the run-down five days in. That is the reference point:

```
R0:  runDownDate 2026-10-01   refillDate 2026-09-29   requiredOn 2026-09-27   overdue false
```

2026-10-01 is the fifth day (27, 28, 29, 30 Sep, 1 Oct) — the day the closing balance reaches
2602.40 exactly.

A **DRAFT** stock transfer, never posted: `POST /stock-transfer`, STORE-001 → SILO-004, 48.96 kg
(= 3 × 16.32) of the same item, dated 2026-09-29, two days after the planning date.

```
created TR-000014, status DRAFT   (SELECT status, posting_date … -> DRAFT | 2026-09-29)

with the draft:   incomingKg 48.96   runDownDate 2026-10-04   refillDate 2026-10-02   requiredOn 2026-09-30
                                     = R0 + 3 days, the three days the 48.96 kg buys       ✓
```

`DELETE /stock-transfer/TR-000014` → `Stock Transfer 'TR-000014' has been cancelled.`

```
status CANCELLED
SELECT COUNT(*) FROM nf_devco.inventory_ledger WHERE document_no='TR-000014';   -- 0  (never posted) ✓
after cancelling: incomingKg 0   runDownDate 2026-10-01   refillDate 2026-09-29   requiredOn 2026-09-27
                                 = back to R0 exactly                                      ✓
```

## Step 8 — a back-dated planning date (Q8)

`planningDate=2026-09-20` (today − 7): `from` = `to` = 2026-09-20, `horizonTo` 2026-11-04
(= that day + 45), and the `AS_OF_PAST` flag was present with its own sentence:

> Stock is shown as of 2026-09-20; batches, head counts and stages are today's register
> (2026-09-27), not as they stood then. A batch that entered its current stage after
> 2026-09-20 carries no demand for the days before that stage began.

Only 2 rows came back, both on the store, and **`currentInventoryKg` was 0 on both**. The
ledger says why, and it is not a zero:

```sql
-- per item, on VIL100/STORE-001
item              before 2026-09-20   non-feeding on 2026-09-20   before 2026-09-27
ICAT-004-ITM-0002      -3000.0000                 0.0000              35800.0000
ICAT-004-ITM-0004      -3196.0000                 0.0000              35425.6000
```

The signed opening a week ago was **negative** — feed was posted out of the store before the
receipt that stocked it (the store's first ledger row is 2026-09-10). The Task 7 ruling carries
a negative opening into the day's arithmetic and clamps after that day's inflow, and `b3fff57`
("retrospective fallback never shows stock below zero") is what turns −3000 into a displayed 0.
So the brief's `currentInventoryKg = SUM(before) + SUM(that day)` holds as the *signed*
figure, and the screen shows it clamped. Today's figures need no clamp and match the ledger
to the cent: 35800 and 35425.6 against the API's 35800 and 35425.6.

`VIL100/SILO-004` has no row at all a week back, because BATCH-000024 started 2026-09-22 —
precisely the case the `AS_OF_PAST` sentence describes.

`planningDate=2026-08-12` (today − 46) → **400**
`The planning date must be within 45 days of today (2026-09-27).` (The message is under
`.error.message`, not `.message`.)

## Step 9 — views never change the numbers (workbook row 20, Q12)

Custom 2026-09-27 → 2026-10-03, demand summed per batch + item + source, against Weekly from
2026-09-27 (which resolved to the same `from`/`to`):

| batch · stage \| item \| source | kg |
|---|---|
| BATCH-000010 · FLUSH \| ICAT-004-ITM-0002 \| VIL100/STORE-001 | 324.87 |
| BATCH-000010 · GESTATION \| ICAT-004-ITM-0002 \| VIL100/STORE-001 | 214.2 |
| BATCH-000010 · LACTATION \| ICAT-004-ITM-0003 \| VIL100/STORE-001 | 428.4 |
| BATCH-000011 \| ICAT-004-ITM-0002 \| VIL100/STORE-001 | 2142 |
| BATCH-000012 \| ICAT-004-ITM-0004 \| VIL100/STORE-001 | 1370.88 |
| BATCH-000024 \| ICAT-004-ITM-0004 \| VIL100/SILO-004 | 114.24 |

`diff` of the two sorted sets: **identical keys and identical kilograms**. Each is exactly
seven days of the daily figure — 7 × 46.41 = 324.87, 7 × 30.6 = 214.2, 7 × 61.2 = 428.4,
7 × 306 = 2142, 7 × 195.84 = 1370.88, 7 × 16.32 = 114.24.

Reporting Period view with no `periodId` picked the period covering the planning date:
`period 2026-10`, `from` 2026-09-27, `to` 2026-10-31, `forecastFrom` 2026-09-27.

A period longer than the horizon: `POST /reporting-period` `VERIFY-LONG` 2030-01-06 →
2030-02-23 → **201**; then `view=PERIOD&periodId=<it>` → **400**

> Reporting period VERIFY-LONG runs 49 days (2030-01-06 to 2030-02-23); the forecast covers at most 46.

`DELETE /reporting-period/<it>` → 200, and the row survives as evidence with `is_active = 0`.
`GET /feed-forecast/periods?farmId=$FARM` → the twelve generated codes, no `VERIFY-LONG`.

## Step 10 — the stage block against Stage Master

```sql
SELECT b.batch_no, s.stage_code, sh.effective_from, sm.typical_duration_days,
       DATE_ADD(sh.effective_from, INTERVAL sm.typical_duration_days - 1 DAY) computed_to,
       (SELECT s2.stage_code FROM stage_master s2 WHERE s2.stage_id=sm.next_stage_id) next_code
FROM batch_header b JOIN scheduler_header sh ON sh.batch_id=b.batch_id
JOIN stage_master sm ON sm.stage_id=sh.stage_id JOIN stage_master s ON s.stage_id=sh.stage_id …
```

| batch | stage | effective_from | duration | computed `currentTo` | API `currentTo` | next |
|---|---|---|---|---|---|---|
| BATCH-000024 | WEANER | 2026-09-22 | 42 | 2026-11-02 | **2026-11-02** ✓ | none → `nextStageCode` null, `stageChangeDate` null ✓ |
| BATCH-000012 | WEANER | 2026-08-25 | 42 | 2026-10-05 | **2026-10-05** ✓ | none ✓ |
| BATCH-000011 | GESTATION | 2026-08-25 | 116 | 2026-12-18 | **2026-12-18** ✓ | FARROWING, `nextFrom` 2026-12-19 = `currentTo` + 1 ✓, `stageChangeDate` 2026-12-19 ✓ |

`2026-09-22 + 41 days` = 2026-11-02 (9 days of September, 31 of October, 2 of November = 42
inclusive). The **overdue** mark also fired truthfully: BATCH-000010 · INSEMINATION runs
2026-09-24 → 2026-09-25 (duration 2), so its change to GESTATION fell due 2026-09-26 and had
not been posted by 2026-09-27 — `stageChangeOverdue true`, which is the screen's "Due, not
posted".

## Step 11 — the requisition drafts the forecast's own numbers (Q3, Q4, Ruling I4)

With the low level at 2602.40 the default window (2026-09-27 → 2026-10-04) gave
`shortfallKg 48.96`, `runDownDate 2026-10-01`, `requiredOn 2026-09-27`.

`POST /feed-requisition/auto-draft {"farmId":…}` → `REQ-VIL100-2026-00003`, 1 line,
`status AUTO_DRAFT`, `priority WARNING`, `forecast_run_key RUN-VIL100-20260927-123816`.

```sql
SELECT d.location_code, l.unrounded_need_kg, l.recommended_qty_kg, l.first_shortage_date,
       l.proposed_delivery_date, l.system_balance_kg FROM nf_devco.requisition_line l …
```

| destination | unrounded need | recommended | first shortage | proposed delivery | system balance |
|---|---|---|---|---|---|
| VIL100/SILO-004 | 48.9600 | 3000.0000 | 2026-10-01 | 2026-09-27 | 2684.0000 |

```
unrounded need   = shortfallKg 48.96                                      ✓   (Q3)
recommended      = ceil(48.96 / 3000) x 3000 = 3000 kg  (BULK pack)       ✓
first shortage   = runDownDate 2026-10-01                                 ✓
proposed deliver = requiredOn 2026-09-27                                  ✓   (Q4)
system balance   = 2684 = SELECT SUM(quantity) … (the live ledger)        ✓   (Ruling I4 — the
                                                                               current balance,
                                                                               not start-of-day)
```

`POST /feed-alert/evaluate {"farmId":…}` → **201** `Feed alerts evaluated.`, **no
`forecastError`**; `raised 0` (Q1: the workbook's FARM_MANAGER / HEAD_OF_FARM roles do not
exist on this tenant, so nothing is notified yet — the Plan B open question, unchanged).

## Step 12 — restored, and what was left behind

`VIL100/SILO-004.low_level_kg` was put back to its original **NULL** and read back from MySQL
(`low_level_kg NULL`, `high_level_kg NULL`). The API process was stopped.

Left in `nf_devco` deliberately, as evidence:

| What | Id / code | Why it stays |
|---|---|---|
| 12 reporting periods, 2026-07 … 2027-06 | company `a702589e-…` | **The farm's first draft of its calendar.** Rishi should look at them — they are generated from the rule, not from a client list, and every row is editable. |
| Cancelled stock transfer | `TR-000014` / `291f85c8-…` | Proof a DRAFT counted as incoming and cancelling took it back out. Never posted; no ledger row. |
| Inactive reporting period | `VERIFY-LONG` / `40865143-…` | Proof of the 46-day horizon refusal. `is_active = 0`. |
| Auto-drafted feed requisition | `REQ-VIL100-2026-00003` / `84e74b39-…` | Proof the requisition carries the forecast's shortfall and Required On. |

## Not exercised, and why

- **A zero run-down (no low level).** Not reachable on VIL100: 165 days of stock against a
  46-day horizon. Shown by arithmetic above instead.
- **A diet change inside one week, for one batch.** BATCH-000010's three rows are three
  *concurrent* stages of a breeding batch, not one batch changing diet mid-week, so the
  "never one blended row" rule is demonstrated but the mid-week diet change is not. No batch
  on this farm changes diet inside the seven days tested.
- **A farm-bound (STANDARD_USER) login against the report.** D13's fixed Primary Location is
  covered by the web suite; Plan A verified the API's farm scoping. Not re-driven here.
- **Alert notification to farm staff.** Q1 — the recipient roles do not exist on this tenant.
- **`db-migrate-all-tenants`.** Refused by the classifier; proven unnecessary by reading
  `__drizzle_migrations` and the schema.
- **The screen itself.** No browser was started; Rishi looks at the page in Brave.
