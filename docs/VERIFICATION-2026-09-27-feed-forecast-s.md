# Feed Forecast Plan S — verification against `nf_devco`

Plan: `docs/superpowers/plans/2026-09-27-feed-forecast-s-fixes.md` (Task 22).
Spec: `docs/superpowers/specs/2026-09-25-feed-forecast-design.md`, decisions D21–D28.
Branch: `feat/feed-forecast-report`, at `e3c7cd9` (Task 21) when this ran.

**Run on 28 Sep 2026, 08:55–09:05 IST** — the document is named for the plan (27 Sep),
like `VERIFICATION-2026-09-26-feed-forecast-r.md`, not for the day it ran.

The API was this branch's build (`pnpm nx build api`) served from `apps/api/dist/main.js`
on the spare port **2899** (PID 66091) and stopped by that PID afterwards. Rishi's own
`nx serve` API on 2877 was **not running** during this session and was never touched.

Session: `tenant.admin@triplec.local`, tenant `devco` → `nf_devco`, company
`a702589e-…c2c6`, farm VIL100 = `b52f5af8-a2a5-4e79-af10-99f99f8f1821`. Company-scoped
master writes were sent with `x-workspace-scope: COMPANY` and the company header; the
feed and approval reads with `x-workspace-scope: TENANT`.

> **Two prerequisites of this task were not met, and the parts that depend on them are
> recorded as PENDING with the exact commands, not as passes.** They are listed in
> *Waiting on Rishi* at the end.
>
> 1. **Tenant migrations 0123–0126 are not applied to `nf_devco`.** Its journal is
>    **123 rows, last 1791222000000** — 0122 only. So the data those four migrations
>    repair is still unrepaired here: 52 of 53 silos have no feed levels, 22 batches
>    have no shed, the four ranged stage durations and the two successors are empty,
>    and 248 pens, sheds and crates still carry `storage_type = 'SILO'`. Applying them
>    is Rishi's action (the classifier refuses `db-migrate-all-tenants` to an agent);
>    they were rehearsed instead — `docs/VERIFICATION-2026-09-28-plan-s-migration-rehearsal.md`.
> 2. **No web dev server and no browser was started.** Nothing was listening on 2877 or
>    3002, and this machine has 8 GB with ~200 MB unused: a Next dev server plus Chromium
>    swaps it hard. Every check below is therefore through the running API and MySQL;
>    the browser-only checks (layout, badge wording, date format on screen, the
>    network log, the menus) are listed as PENDING.

---

## What was proved through the running API and MySQL

### A1 — the requisition list's Lines and Requested (kg)

`GET /feed-requisition?farmId=b52f5af8-…` against
`SELECT r.req_no, COUNT(l.line_id), ROUND(SUM(l.quantity),2) … GROUP BY r.req_no`:

| req_no | API `line_count` / `requested_kg` | MySQL | |
|---|---|---|---|
| REQ-VIL100-2026-00003 | 1 / 3000.0000 | 1 / 3000.00 | **PASS** |
| REQ-VIL100-2026-00002 | 1 / 1234.0000 | 1 / 1234.00 | **PASS** |
| REQ-VIL100-2026-00001 | 2 / 4550.0000 | 2 / 4550.00 | **PASS** |

`farmId` is a UUID, not a code: `?farmId=VIL100` is refused with
`farmId must be a UUID` (400). Worth knowing when reading the network log.

### D26 — New requisition creates a MANUAL DRAFT

`POST /feed-requisition` with one line → `REQ-VIL100-2026-00004`; MySQL
`requisition_type` **MANUAL**, `status` **DRAFT**. **PASS**

A second create for the same silo and item was refused, 409: *"VIL100/SILO-004 already
has Weaner Grower Mash (18% CP) on requisition REQ-VIL100-2026-00004 (DRAFT) this cycle —
change that line instead."* The two further cases below were therefore written to
SILO-002 and SILO-005.

### D25 / S9 — submit → inbox → approve, reject, withdraw (the live proof Task 7 deferred)

Three requisitions, each `POST /feed-requisition/:id/submit` with farm remarks:

| | req_no | requisition | approval_request | `ar.farm_id = r.farm_id` | `ar.document_id = r.requisition_id` |
|---|---|---|---|---|---|
| | 00004 | PENDING_APPROVAL | PENDING | 1 | 1 |
| | 00005 | PENDING_APPROVAL | PENDING | 1 | 1 |
| | 00006 | PENDING_APPROVAL | PENDING | 1 | 1 |

**PASS** — the plan's expected `PENDING_APPROVAL, PENDING, 1, 1` on all three.

`GET /approval?status=PENDING` then listed 5: the three feed requisitions, each with
`doc_type FEED_REQUISITION`, `farm_id` and `document_id` set, and the two older
non-feed documents (FEED_RATION, MEDICINE_REQUISITION) with both columns empty — 0122
fills feed requisitions only. **PASS**

Then, as `tenant.admin`:

| action | endpoint | MySQL afterwards | |
|---|---|---|---|
| approve with remarks | `POST /approval/caaf8866…/approve` | requisition **APPROVED**, `approved_by` set, request **APPROVED**, remarks "Task 22: approved, line within 20%" | **PASS** |
| reject with a reason | `POST /approval/1548dc32…/reject` | requisition **REJECTED**, remarks end `Rejected: Task 22 verification: not needed this cycle` | **PASS** |
| withdraw | `DELETE /approval/61fa4780…` | requisition back to **DRAFT** with `approval_request_id` **NULL**; the request row soft-deleted (`deleted_at` set, status left PENDING as audit) | **PASS** (S9) |

`audit_log` on the three request ids: `CREATE` at submit for all three, then `APPROVE`,
`REJECT` and `DELETE` respectively. **PASS**

The inbox after the three decisions: PENDING **2**, APPROVED **3**, REJECTED **2**, and
`GET /approval/counts` returns the same three figures. The withdrawn request is in none
of the tabs. **PASS**

### D24 — feed alerts: one evaluation, the scope list, acknowledge

`POST /feed-alert/evaluate-scope` → `{"farms":10,"failed":[],"forecastErrors":[]}` — the
same 10 farms `GET /feed-forecast/farms` returns. **PASS**

All 8 rows of `feed_alert` were RESOLVED, because no VIL100 silo has a low level for the
evaluator to compare against (0124 is not applied). To prove the acknowledge path live, a
tester's edit was made and undone: `PUT /location/<VIL100/SILO-007>` with
`low_level_kg 2500` (its balance is 2,000 kg), then evaluate-scope, which raised

> `b0d525fe…` CRITICAL_FIRST_PRIORITY ACTIVE — "VIL100/SILO-007 has 2,000 kg of Dry Sow
> Gestation Mash (14% CP), at or …"

`GET /feed-alert/scope?status=ACTIVE` returned that one row with `farm_code VIL100` and
**no ISO date in its message** (A9). `POST /feed-alert/:id/acknowledge` → MySQL
`acknowledged_at 2026-09-28 03:32:48`, `acknowledged_by` set. **PASS**

The silo was then put back to `1200 / 5400` — 20 % and 90 % of its 6,000 kg capacity,
which is what 0124 will write, so the row is left in the state that migration produces.

### A12 — a batch's shed (`PATCH /batch/:id/shed`)

BATCH-000022 (`f86b41b4…`, shed NULL): set to `AI100/SHED-001` → 200, MySQL shows that
shed; cleared with `{"shed_id": null}` → 200, MySQL back to NULL. **PASS**, and the row
is left as it was found so 0123's repair still has it to fill.

### A13 — a silo needs both levels

Proved in Task 4 on VIL100/SILO-007 and recorded in the ledger: `PUT /location/:id` with
only a name → 400 *"A silo needs both a Below Feed Level and an Above Threshold."*;
with both levels → 200. Re-exercised here (the two writes above both carried both
levels and both succeeded). **PASS**

### The forecast's numbers against MySQL

`GET /feed-forecast?farmId=b52f5af8-…` → 48 rows, 8 stage rows, planning date 2026-09-28,
`from` 2026-09-28, `to` 2026-10-05, horizon 2026-11-12.

The one SILO row for today, VIL100/SILO-004 · ICAT-004-ITM-0004 · BATCH-000024:

| | API | by hand from MySQL | |
|---|---|---|---|
| Current Inventory | 2684 | `SELECT ROUND(SUM(quantity),2) FROM inventory_ledger WHERE warehouse_id='7eaf126d…'` → **2684.00** | **PASS** |
| Demand | 16.32 | 16 kg/day × (1 + 2 %) = **16.32** | **PASS** |
| Days of Stock | 164 | `floor(2684 ÷ 16.32)` = **164** | **PASS** |

**A7 (data side):** 24 of the 48 rows carry `sharedBatchCount > 1` — e.g. VIL100/STORE-001
shared by 3 — which is what the "Shared by N" badge renders. The badge's wording itself is
a browser check. **PASS (data)**

**A2/A5 (data side):** `GET /feed-forecast/farms` with `x-workspace-scope: TENANT` and no
company header returns all 10 active top-level farms in code order (AI100, FARM-002,
GRA100, LEA100, LEX100, LIO100, MUL100, POR100, RIC100, VIL100), each labelled "Triple C";
inactive FARM-001 is absent. **PASS (data)** — the grouping and the "CODE — Name" text are
browser checks.

---

## What the unapplied migrations make visible here

These are not defects. They are the state 0123–0126 exist to repair, and they are what
the same checks will look like before the release on the server.

| | on `nf_devco` today | after the release |
|---|---|---|
| A6, the Stages tab | BATCH-000010 · FARROWING and · FLUSH have a From but **no To and no stage-change date** (`currentTo` and `nextStageDate` null) — their `typical_duration_days` is NULL | 0125 fills FARROWING 3 and FLUSH 14, and the two successors |
| shed on a forecast row | **40 of 48** rows have an empty `shedCode`; those batches are fed from the farm store | 0123 sets the shed of every batch whose live animals or scheduler headers name exactly one |
| silo levels | 52 of 53 silos have none, so no silo can raise FEED_BELOW_L1 without a tester's edit | 0124 fills 90 % / 20 % |
| the Location form | 248 pens, sheds and crates carry `storage_type = 'SILO'` | 0126 clears it (D28; this was S11) |

Nothing in the payload reads "Due, not posted": `stages overdue` is 0 on all 8 rows, and
no stage row is missing its From date.

---

## Recorded as the plan asks

- **Alerts raised before Task 3 keep their old ISO-date text.** They were not migrated.
  The 8 pre-existing `feed_alert` rows are all RESOLVED; the one raised in this session
  (after Task 3) carries no ISO date.
- **Batch-alert farm filtering could not be shown on data.** `notification_alert_log`
  has **0 rows** in `nf_devco` (unchanged from 27 Sep), so the Alerts page's batch half
  has nothing to list and the farm filter over it cannot be exercised here.
- **No S5 role gap was found**, because the farm-login half of Step 4 is a browser check
  and is pending. `tenant.admin` holds both `PRODUCTION/APPROVAL` and
  `PROCUREMENT/REQUISITION` rights and met no permission refusal.
- **The 248 legacy `storage_type = 'SILO'` rows (S11)** are fixed by 0126 in this
  release, not left open. Counted on the rehearsal copy: 102 PEN, 89 CRATE, 57 SHED
  cleared; 53 SILO and any STORE keep theirs.

---

## Waiting on Rishi

Neither can be done by an agent in this session; both are listed with the exact commands.

**1. Apply the tenant migrations** (from `apps/api`):

```bash
pnpm nx run api:db-migrate-all-tenants
```

Follow `docs/deploy-rdp-windows.md` §13 → *Plan S release (tenant migrations 0122–0126)*
for the before and after checks. Expect each tenant's journal to gain **5** rows, last
`1791567600000`. The rehearsal report holds the before/after counts, every table's
checksum, and the recovery for a part-way 0122.

**2. Rebuild the demo** (B1, Step 7 — the classifier refuses `db-rebuild-demo` to an agent):

```bash
cd apps/api && pnpm nx run api:db-rebuild-demo -- --apply
bash .superpowers/sdd/2026-09-27-feed-forecast-s-fixes/verify-after-rebuild.sh   # local dev machine only (git-ignored)
```

**3. The browser steps** (Steps 1, 2, 3, 5 and 6 of Task 22), once 1 and 2 are done and a
web dev server can be spared on this machine, at 1440×900, 1024×768 and 375×812 on
`/inventory/feed-forecast`, `/inventory/requisitions` and `/alerts`:

- the page does not scroll, the table does; the title, the header row and the batch
  column hold while it scrolls; every row one line high (~29 px);
- one `/feed-forecast/farms` request per page load and none to `/location?locationType=FARM`;
- the chosen farm survives a move between the feed screens and a new tab;
- the three date inputs are filled before the grid arrives, with no pink box;
- type, status and priority read as words — no `FEED_FORECAST`, `AUTO_DRAFT` or
  `CRITICAL_FIRST_PRIORITY` anywhere on the page; all dates DD/MM/YY;
- Requisitions has no Approve or Reject button; the Approvals dialog shows the
  "Feed requisition" badge, the lines, the farm's remarks and a remarks box;
- the VIL100 farm login sees its own request in Pending and not another farm's;
- the Inventory sub-navigation has no Feed Alerts entry and `/inventory/feed-alerts`
  lands on `/alerts`;
- Farm Master lists Reporting Periods and Alert Rules, both headed "Farm Operations".

The `javascript_tool` snippet for the layout checks is in the plan, Task 22 Step 1.
