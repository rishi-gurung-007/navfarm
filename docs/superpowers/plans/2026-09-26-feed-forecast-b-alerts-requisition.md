# Feed Forecast — Plan B: Thresholds, Alerts and Requisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A silo carries a low and a high feed level; NAVFarm raises, re-arms and resolves in-app feed alerts from a configurable Alerts and Notifications Master; and a forecast run drafts one feed requisition per farm and submission cycle — rounded, snapshotted, flagged for next diets — which the farm reviews, edits and approves on the first requisition screen.

**Architecture:** Three pure modules carry all the rules and are tested against the workbook's worked example: the engine gains a per-source summary and a list of diet changes (`feed-forecast.engine.ts`), `feed-requisition.rules.ts` does rounding, deviation, cycle and draft-merging, and `feed-alert.rules.ts` turns rules + facts + active alerts into a plan of raise / re-notify / escalate / resolve. Thin services load facts from MySQL under farm scope and write the plan. There is no scheduler in the API today (no `@Cron`, `ScheduleModule`, `setInterval` or queue anywhere under `apps/api/src` — checked 2026-09-26), so alerts are evaluated **on the writes that move silo stock**, **after requisition drafting and decisions**, and **through an explicit `POST /feed-alert/evaluate`** that the Feed Alerts screen calls when it opens.

**Tech Stack:** NestJS 11 + Drizzle (MySQL, per-tenant DBs, hand-written SQL migrations in `apps/api/src/drizzle/tenant` with `meta/_journal.json` entries), Jest; Next.js 16 / React 19, React Testing Library; Nx (`pnpm nx …`).

**Spec:** `docs/superpowers/specs/2026-09-25-feed-forecast-design.md` — Plan B section and decisions D1–D15. Client sources below the spec's decisions: `.superpowers/feed-forecast-sources/workbook-extract.txt` (sheets *Master Setup* §1 and §4, *Feed Forecast Engine* Steps 8–9 and §4, *Requisition and Loading Sheet* §1, §2 and §4, *Checkpoints and Validations* 10–13, 16–23, 30, 37, *Worked Example*) and `report-docx-extract.txt`. Builds on Plan A (`docs/superpowers/plans/2026-09-25-feed-forecast-a-silo-and-report.md`), which is committed on `feat/feed-forecast-a`.

## Open questions for Rishi

Each has a default the plan uses, so the plan is executable as written. Answers that differ change only the task named.

| # | Question | Why it is open | Default used (task) |
|---|---|---|---|
| Q1 | **Who receives feed alerts?** The workbook names roles `FARM_MANAGER` and `HEAD_OF_FARM`; no tenant has them. `nf_devco` has `MANAGER`, `OPERATOR`, `ACCOUNTANT`, `SUPER_ADMIN`, and the 22 farm logins hold `OPERATOR` or no role. | Creating roles or remapping the workbook's is the client's data, not ours. | Rules store role codes as the workbook writes them. A user sees an alert when they hold one of its recipient role codes (or its escalation role once escalated); tenant, company and operational admins see every alert of a farm in their scope. Until the roles exist or the rules are edited to `OPERATOR`/`MANAGER`, only admins see feed alerts. (Tasks 5, 7) |
| Q2 | **One requisition or two when a diet changes?** Engine Step 9 and the Worked Example draft one requisition with lines R1 and R2 (`REQ-GRS-2026-00041-L1/L2`); Approval step 2 and checkpoint 23 say a *second* slip is drafted for the next diet. | The workbook disagrees with itself. | One requisition per farm per submission cycle; the next-diet line is flagged `is_next_diet` with its days before the change (the spec's "lines per silo and item"). (Tasks 3, 8) |
| Q3 | **Approve directly from AUTO_DRAFT?** Existing requisitions go DRAFT → submit → PENDING_APPROVAL → approve. The workbook's step 4 has the Farm Manager approve the AUTO_DRAFT in one click. | Two flows exist. | Feed requisitions approve in one action from AUTO_DRAFT, DRAFT or PENDING_APPROVAL. If no approval request exists yet it is raised and approved in the same transaction, so the approval engine still records the decision. (Task 9) |
| Q4 | **Production calendar and cutoff time.** "Derive submission cutoff from configurable production calendar … Saturday by default" (checkpoint 22, Requisition §1 row 35); no calendar or time of day is given. | No calendar exists in NAVFarm. | Per-farm `feed_production_weekday` (default 0 = Sunday). Production date = the first such weekday after the planning date; submission deadline = the day before it (Saturday). The deadline is a date, whole day. (Tasks 1, 3) |
| Q5 | **Approving after the deadline.** Checkpoint 22: "BLOCK … after Saturday cutoff unless authorized exception." | "Authorized exception" is not defined. | After the deadline date, approval requires remarks, and the remarks are the recorded exception. (Task 9) |
| Q6 | **Reminder rules.** Checkpoint 20: Friday reminder, Saturday CRITICAL to Farm Manager and Head of Farm. The workbook's example code is `REQ-OVERDUE`. | Only one code is named. | Two seeded rules on event `REQ_DEADLINE`: `REQ-REMINDER` (ours; 1 day before, WARNING, FARM_MANAGER) and `REQ-OVERDUE` (on the deadline day and after, CRITICAL, FARM_MANAGER + HEAD_OF_FARM). (Task 5) |
| Q7 | **An empty silo and the low alert.** Checkpoint 11: alert when balance is at or below Below Feed Level. An emptied silo (0 kg) waiting for a changeover is at or below it. | Changeover practice is the client's. | An empty silo with a low level set alerts like any other; clearing its low level silences it. (Task 6) |
| Q8 | **Low and high levels mandatory?** Master Setup §1 marks both mandatory; every existing silo has neither. | Making them required would make all 50+ existing silos uneditable. | Optional on the form; a silo without a level is simply not evaluated for that event. (Task 1) |
| Q9 | **Silo free capacity in the recommendation.** Step 8 names "silo free capacity"; the Worked Example ignores it and says "more than one trip possible". | Not specified. | Not applied; the recommendation is the rounded shortfall only (safety stock zero, as the Worked Example's scope note). (Task 3) |
| Q10 | **Feed type of a line with no `feed_in_bags` on its destination.** Requisition §1 row 15 takes BULK/BAGGED "from Location Master"; every silo and store in `nf_devco` has `feed_in_bags` NULL. | No data. | NULL on a SILO = BULK, NULL on a STORE = BAGGED. (Task 3) |
| Q11 | **Requisition number.** Workbook: `REQ-FarmCode-YYYY-NNNNN`. The existing (non-feed) series is `REQ-YYYY-NNNN` per company. | Two series would coexist. | Feed requisitions use the workbook format per farm; other requisitions keep theirs. (Task 8) |
| Q12 | **Email channel.** Master Setup §4 row 51: "NAVFarm in app default; email if configured." | Plan B scope is in-app only. | The rule master accepts only `IN_APP`; `EMAIL` is refused with a message until it is built. (Task 5) |

Record the answers in `docs/decisions.md` (Task 12 adds the Plan B entry with these defaults marked "default, awaiting Rishi").

## Global Constraints

- Read `AGENTS.md` first. Comments explain **why**, in prose, matching the dense style of the file being edited. Say which document a value comes from; label our own inventions as ours.
- New UI strings go in the `en` dictionary only (`apps/web/src/utils/translations.ts`); `t()` falls back to English.
- Web lint baseline: gate on **no new errors** against the count taken before your change (94 on 2026-09-25); never "fix" pre-existing `exhaustive-deps`.
- Run through Nx: `pnpm nx test api -- <pattern>`, `pnpm nx test web -- <pattern>`, `pnpm nx run-many -t typecheck -p api,web`.
- Every `@RequirePermission(module, resource, action)` pair must also be offered in `apps/web/src/components/console/console-tabs/roles-tab.tsx` (guarded by `apps/web/specs/role-permissions-coverage.spec.ts`), with an `en` label key.
- Every new controller is listed in `apps/api/src/common/farm-scope-coverage.spec.ts`, as SCOPED (with `@FarmScoped()` and `RolesGuard`) or EXEMPT with a reason.
- Databases are `nf_`-prefixed; the dev tenant is `nf_devco`. MySQL: `cd apps/api && set -a && . ./.env && set +a && MYSQL_PWD="$DATABASE_PASSWORD" mysql -h 127.0.0.1 -u root -t -e "…"`.
- Tenant migrations start at **0117**; each gets a `meta/_journal.json` entry whose `when` is the previous entry's + 86400000 (0116 is `1790703600000`). Apply with `pnpm nx run api:db-migrate-all-tenants`.
- **Verify by writing and reading MySQL**, not by a green suite. `nx serve api` does not rebuild: `pnpm nx run api:build`, then restart the API by the PID from `lsof -ti :2877`. Never `pkill`.
- Dates are `YYYY-MM-DD` farm-local calendar days; date arithmetic on UTC midnights of those strings. Timestamps are written `YYYY-MM-DD HH:MM:SS` (UTC), as `alert.service.ts` does.
- Silo balance is labelled **System Balance** on every screen (checkpoint 37).
- Only the `IN_APP` channel is built. No SMS, WhatsApp or email sending; no D365BC calls (spec D12, Out of scope).
- Do not run `db-rebuild-demo`, `setup-fresh-database` or any DROP. Do not start dev servers or browsers (8 GB machine); Rishi's servers stay up.
- Commit only the files of the task; never stage `nx.json` or `apps/web/next-env.d.ts`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Rerun of the forecast after the farm edited a requested quantity** — the rerun refreshes the snapshots and the recommendation but keeps the farm's number, and never creates a second draft for the same cycle; a line already on a submitted or approved requisition of that cycle is not drafted again. (Task 8, `planDraftUpsert` tests "keeps an edited quantity" and "skips covered lines".)
2. **A silo balance landing exactly on the threshold, then crossing it back and forth** — at-or-below raises (checkpoint 11), rising above resolves (checkpoint 12), falling again raises a new alert; never two active alerts for one silo and rule. (Task 6 tests; Task 7 unique `active_key`.)
3. **Deviation at exactly 20 %, and deviation against a recommendation of 0 or none** — exactly 20 % needs no remarks; a manual line (no recommendation) never does; a line recommended 0 kg but requested > 0 does. (Task 3 tests.)
4. **A farm-pinned user approving another farm's requisition** — answered as not found and nothing written (checkpoint 19). (Task 9 test.)
5. **Alert evaluation failing inside a stock posting** — a misconfigured rule, a silo without levels or a database error while evaluating must never fail or roll back the stock transfer, receipt, adjustment or daily entry that triggered it. (Task 7 test "evaluateLevelsSafely swallows errors".)

---

## File map

| File | Responsibility |
|---|---|
| `apps/api/src/drizzle/tenant/0117_feed_levels_settings_requisition.sql` (new) | Silo `low_level_kg`/`high_level_kg`; farm bulk multiple, bag size, truck target, production weekday; feed columns on `requisition` and `requisition_line` |
| `apps/api/src/drizzle/tenant/0118_alert_rule.sql` (new) | Alerts and Notifications Master table + five seeded rules per company |
| `apps/api/src/drizzle/tenant/0119_feed_alert.sql` (new) | In-app alert instances |
| `apps/api/src/core/database/schema.ts` | Columns and tables above |
| `apps/api/src/modules/master-data/location/{location.service.ts,dto/location.dto.ts}` | Write and validate the new silo/farm fields |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` | + `sources`, `dietChanges` |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` | `resolveFarm`, `computeForFarm`, `withFarmScope`; response carries sources and diet changes |
| `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts` (new) | Pure: rounding, bags, deviation, cycle, recommendation, priority, draft merge, approval problems |
| `apps/api/src/modules/procurement/feed-requisition/{service,controller,module,dto}` (new) | Auto-draft, manual create, edit, approve, reject |
| `apps/api/src/modules/system/alert-rule/*` (new) | Alert rule master CRUD + pure validation |
| `apps/api/src/modules/inventory/feed-alert/feed-alert.rules.ts` (new) | Pure alert planning |
| `apps/api/src/modules/inventory/feed-alert/{service,controller,module}` (new) | Evaluate, list, acknowledge; `evaluateLevelsSafely` for posting hooks |
| `stock-transfer`, `goods-receipt`, `stock-adjustment`, `batch-daily-data` services | Call `evaluateLevelsSafely` after posting |
| `apps/api/src/modules/procurement/requisition/requisition.service.ts` | Refuse FEED documents on the generic submit/approve path |
| `apps/web/src/modules/master-data/configs.ts` | Silo levels, farm feed settings, Alert Rules master |
| `apps/web/src/components/console/inventory/use-feed-farm.ts` (new) | Farm picker state shared by the two new screens |
| `apps/web/src/components/console/inventory/feed-requisition-panel.tsx` (new) + route | Inventory → Feed Requisitions |
| `apps/web/src/components/console/inventory/feed-alerts-panel.tsx` (new) + route | Inventory → Feed Alerts |

## Order and parallelism

```
Task 1 (silo levels, farm settings, requisition columns) ─┐
Task 2 (engine: sources, diet changes)        ├─ Task 4 (forecast service entry points)
Task 3 (requisition rules, pure) ← needs 2's types
Task 5 (alert rule master)                    ─┐
Task 6 (alert rules, pure) ← needs 2, 5's constants
Task 7 (feed alert service + hooks) ← 1, 4, 5, 6
Task 8 (requisition: migration, auto-draft, manual) ← 1, 3, 4, 7
Task 9 (requisition: edit, approve, reject) ← 8
Task 10 (web: Feed Requisitions) ← 9      Task 11 (web: Feed Alerts) ← 7
Task 12 (MySQL verification + docs) last
```

---
### Task 1: Silo levels, farm requisition settings and feed requisition columns

Master Setup §1 row 10 ("Below Feed Level KG … Single low feed threshold for this silo") and row 12 ("Above Threshold KG … Typically 90% of silo capacity"); spec D10 keeps them **alongside** Silo Reorder Days. The four farm settings carry the workbook's configured defaults: Requisition §1 row 28 "Bulk Order Multiple — Configured default 3000 KG", row 27 "Bulk Truck Target KG — Configured default 30000", checkpoint 27 "configured bag size, default 50 KG", checkpoint 22 production calendar (Q4: weekday, default Sunday). The feed requisition columns (Requisition and Loading Sheet §1–§2) are added in the same migration; they are only written from Task 8.

**Files:**
- Create: `apps/api/src/drizzle/tenant/0117_feed_levels_settings_requisition.sql`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json` (append idx 117)
- Modify: `apps/api/src/core/database/schema.ts` (`locationMaster`, after `feed_lead_time_days`)
- Modify: `apps/api/src/modules/master-data/location/dto/location.dto.ts` (create and update DTOs, after `feed_lead_time_days`)
- Modify: `apps/api/src/modules/master-data/location/location.service.ts` (create values ~318–345, create validation ~824, update ~1120–1230)
- Modify: `apps/web/src/modules/master-data/configs.ts` (location fields after `silo_reorder_days`, ~134–150)
- Test: `apps/api/src/modules/master-data/location/location.service.spec.ts`

**Interfaces:**
- Produces: `schema.locationMaster.low_level_kg`, `.high_level_kg` (`decimal(12,2)`, null), `.feed_bulk_multiple_kg` (int, default 3000), `.feed_bag_size_kg` (int, default 50), `.feed_truck_target_kg` (int, default 30000), `.feed_production_weekday` (int, default 0 = Sunday). DTO fields of the same names (numbers).
- Produces for Tasks 7–9: `schema.requisition.{requisition_type, source, purpose, supply_source, priority, forecast_run_key, production_date, submission_deadline, remarks, approved_by, approved_at}` and `schema.requisitionLine.{destination_location_id, source_type, feed_type, is_next_diet, days_before_diet_change, lifecycle_ref_id, system_balance_kg, daily_requirement_kg, days_remaining, first_shortage_date, unrounded_need_kg, recommended_qty_kg, bag_count, proposed_delivery_date, needs_silo_changeover}`. They land here, with the other column additions, because the alert evaluator (Task 7) reads open feed requisitions before the requisition service (Task 8) writes them.

- [ ] **Step 1: Write the failing tests** — append inside `describe('LocationService canonical hierarchy', …)` in `location.service.spec.ts`:

```ts
  it('stores a silo low and high feed level in kilograms (Master Setup §1 rows 10 and 12)', async () => {
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series],
      [], // no existing SILO siblings under this farm yet
      [{ location_id: 'silo-1', location_code: 'FARM-001/SILO-001', location_type: 'SILO', location_level: 2,
         silo_capacity_kg: '12000.00', silo_capacity_uom: 'KG', low_level_kg: '1000.00', high_level_kg: '10800.00' }],
      [], // no sheds attached to it
    );

    await service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      capacity_uom: 'KG', silo_capacity_kg: 12000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: 1000, high_level_kg: 10800,
    } as any, 'tenant-1');

    expect(inserted().low_level_kg).toBe('1000');
    expect(inserted().high_level_kg).toBe('10800');
  });

  it('refuses a low feed level that is not below the high level', async () => {
    selectResults.push([company], [siloType], [farmParent()]);
    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      capacity_uom: 'KG', silo_capacity_kg: 12000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: 5000, high_level_kg: 5000,
    } as any, 'tenant-1')).rejects.toThrow('The low feed level must be below the high feed level.');
    expect(txInsert).not.toHaveBeenCalled();
  });

  it('refuses a high feed level above the silo capacity, in kilograms even when capacity was typed in tonnes', async () => {
    selectResults.push([company], [siloType], [farmParent()]);
    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      capacity_uom: 'KG', silo_capacity_kg: 12, silo_capacity_uom: 'TON', silo_reorder_days: 7,
      low_level_kg: 1000, high_level_kg: 12500,
    } as any, 'tenant-1')).rejects.toThrow('The high feed level cannot exceed the silo capacity.');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- location.service 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"`
Expected: 3 failing (`low_level_kg` undefined; no refusal).

- [ ] **Step 3: Migration** `apps/api/src/drizzle/tenant/0117_feed_levels_settings_requisition.sql`:

```sql
-- Feed Forecast Plan B (spec D10). Master Setup §1: one low threshold per
-- silo ("Below Feed Level KG", row 10) and one high ("Above Threshold KG",
-- row 12), both kilograms, alongside silo_reorder_days — not replacing it.
-- Nullable: every existing silo has neither, and a silo without a level is
-- simply not checked for that alert (open question Q8).
ALTER TABLE `location_master` ADD `low_level_kg` decimal(12,2);
--> statement-breakpoint
ALTER TABLE `location_master` ADD `high_level_kg` decimal(12,2);
--> statement-breakpoint
-- Per-farm requisition settings, read only on FARM rows, with the workbook's
-- configured defaults: Requisition §1 row 28 (bulk multiple 3000 KG), row 27
-- (truck target 30000 KG, a planning target, not a cap), checkpoint 27 (bag
-- size 50 KG). The production weekday stands in for the "configurable
-- production calendar" of checkpoint 22 until one exists (Q4): 0 = Sunday,
-- so the submission deadline defaults to Saturday.
ALTER TABLE `location_master` ADD `feed_bulk_multiple_kg` int DEFAULT 3000;
--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_bag_size_kg` int DEFAULT 50;
--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_truck_target_kg` int DEFAULT 30000;
--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_production_weekday` int DEFAULT 0;
--> statement-breakpoint
-- Feed requisition (Requisition and Loading Sheet §1 header, §2 lines) on
-- the existing requisition tables (0098) rather than a second document: the
-- approval link, farm scope and number column are the same. doc_type 'FEED'
-- marks them. Header: Requisition Type (FEED_FORECAST | MANUAL, row 7),
-- Source (row 8), Requisition Purpose (INTERNAL_TRANSFER, row 31), Supplier
-- or Source (MILL, row 30), Priority (row 34), Submission Deadline (row 35),
-- Remarks (row 36), Approved By / Approval Date Time (rows 37–38), plus the
-- production date the deadline derives from and the forecast run that last
-- drafted it (Engine Step 9: "Preserve run ID").
ALTER TABLE `requisition` ADD `requisition_type` varchar(20);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `source` varchar(30);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `purpose` varchar(30);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `supply_source` varchar(20);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `priority` varchar(30);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `forecast_run_key` varchar(64);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `production_date` date;
--> statement-breakpoint
ALTER TABLE `requisition` ADD `submission_deadline` date;
--> statement-breakpoint
ALTER TABLE `requisition` ADD `remarks` text;
--> statement-breakpoint
ALTER TABLE `requisition` ADD `approved_by` varchar(36);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `approved_at` timestamp NULL;
--> statement-breakpoint
CREATE INDEX `idx_requisition_feed_cycle` ON `requisition` (`farm_id`, `doc_type`, `submission_deadline`);
--> statement-breakpoint
-- Lines (§2): destination silo or store, feed type, next-diet flag and days
-- before the change, the lifecycle row, and the draft-time snapshots (System
-- Balance, Daily Requirement, Days Remaining, first shortage, unrounded need,
-- Recommended Qty, Bag Count, Proposed Delivery Date). Requested Qty is the
-- existing `quantity` column, in KG.
ALTER TABLE `requisition_line` ADD `destination_location_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD CONSTRAINT `requisition_line_destination_fk` FOREIGN KEY (`destination_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `source_type` varchar(10);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `feed_type` varchar(10);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `is_next_diet` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `days_before_diet_change` int;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `lifecycle_ref_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `system_balance_kg` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `daily_requirement_kg` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `days_remaining` int;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `first_shortage_date` date;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `unrounded_need_kg` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `recommended_qty_kg` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `bag_count` int;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `proposed_delivery_date` date;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `needs_silo_changeover` boolean NOT NULL DEFAULT false;
```

Journal entry appended to `meta/_journal.json`:

```json
    {
      "idx": 117,
      "version": "5",
      "when": 1790790000000,
      "tag": "0117_feed_levels_settings_requisition",
      "breakpoints": true
    }
```

- [ ] **Step 4: Schema** — in `locationMaster`, after `feed_lead_time_days`:

```ts
  // Master Setup §1 rows 10 and 12 (spec D10): the single low feed level and
  // the high (over-stock) level of a SILO, in KG. Null = not checked.
  low_level_kg: decimal('low_level_kg', { precision: 12, scale: 2 }),
  high_level_kg: decimal('high_level_kg', { precision: 12, scale: 2 }),
  // FARM rows only — feed requisition rounding and cycle (Requisition §1 rows
  // 27–28, checkpoints 22 and 27); defaults are the workbook's.
  feed_bulk_multiple_kg: int('feed_bulk_multiple_kg').default(3000),
  feed_bag_size_kg: int('feed_bag_size_kg').default(50),
  feed_truck_target_kg: int('feed_truck_target_kg').default(30000),
  feed_production_weekday: int('feed_production_weekday').default(0),
```

and in `requisition` (after `linked_po_no`; also extend the `doc_type` comment to `// ITEM, FA, SERVICE, FEED` and the `status` comment to `// DRAFT, AUTO_DRAFT, PENDING_APPROVAL, APPROVED, REJECTED`):

```ts
  // Feed requisition header (Requisition and Loading Sheet §1). Null on ITEM/FA/SERVICE documents.
  requisition_type: varchar('requisition_type', { length: 20 }), // FEED_FORECAST, MANUAL (row 7)
  source: varchar('source', { length: 30 }), // AUTO_FORECAST, MANUAL_ENTRY, STOCK_TAKE_TRIGGERED, DIET_CHANGE_UPCOMING (row 8)
  purpose: varchar('purpose', { length: 30 }), // INTERNAL_TRANSFER (row 31)
  supply_source: varchar('supply_source', { length: 20 }), // MILL (row 30)
  priority: varchar('priority', { length: 30 }), // row 34
  forecast_run_key: varchar('forecast_run_key', { length: 64 }), // Engine Step 9 "Preserve run ID"
  production_date: date('production_date', { mode: 'string' }),
  submission_deadline: date('submission_deadline', { mode: 'string' }), // row 35
  remarks: text('remarks'), // row 36
  approved_by: varchar('approved_by', { length: 36 }), // row 37
  approved_at: timestamp('approved_at', { mode: 'string' }), // row 38
```

and in `requisitionLine` (after `est_rate`):

```ts
  // Feed line (Requisition and Loading Sheet §2). `quantity` is Requested Qty KG.
  destination_location_id: varchar('destination_location_id', { length: 36 }).references(() => locationMaster.location_id, { onDelete: 'set null' }),
  source_type: varchar('source_type', { length: 10 }), // SILO, STORE
  feed_type: varchar('feed_type', { length: 10 }), // BULK, BAGGED
  is_next_diet: boolean('is_next_diet').default(false).notNull(),
  days_before_diet_change: int('days_before_diet_change'),
  lifecycle_ref_id: varchar('lifecycle_ref_id', { length: 36 }),
  system_balance_kg: decimal('system_balance_kg', { precision: 18, scale: 4 }),
  daily_requirement_kg: decimal('daily_requirement_kg', { precision: 18, scale: 4 }),
  days_remaining: int('days_remaining'),
  first_shortage_date: date('first_shortage_date', { mode: 'string' }),
  unrounded_need_kg: decimal('unrounded_need_kg', { precision: 18, scale: 4 }),
  recommended_qty_kg: decimal('recommended_qty_kg', { precision: 18, scale: 4 }),
  bag_count: int('bag_count'),
  proposed_delivery_date: date('proposed_delivery_date', { mode: 'string' }),
  needs_silo_changeover: boolean('needs_silo_changeover').default(false).notNull(),
```

- [ ] **Step 5: DTOs** — add to **both** the create and the update DTO in `dto/location.dto.ts`, after `feed_lead_time_days` (`IsNumber` and `Max` are already imported there; add them to the import if the file lacks either):

```ts
  // Master Setup §1 row 10: low feed alert at or below this System Balance.
  @ApiProperty({ description: 'SILO: low feed alert when System Balance is at or below this many KG. Blank = no low alert.', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  low_level_kg?: number | null;

  // Master Setup §1 row 12: over-stock notice at or above this System Balance.
  @ApiProperty({ description: 'SILO: over-stock notice when System Balance is at or above this many KG (typically 90% of capacity). Blank = none.', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  high_level_kg?: number | null;

  @ApiProperty({ description: 'FARM: bulk feed orders round up to this many KG (Requisition §1 row 28, default 3000).', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  feed_bulk_multiple_kg?: number;

  @ApiProperty({ description: 'FARM: bagged feed rounds to whole bags of this many KG (checkpoint 27, default 50).', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  feed_bag_size_kg?: number;

  @ApiProperty({ description: 'FARM: normal bulk truck load in KG — a planning target, not a cap (Requisition §1 row 27, default 30000).', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  feed_truck_target_kg?: number;

  @ApiProperty({ description: 'FARM: weekday feed is produced for this farm, 0 = Sunday … 6 = Saturday. The requisition deadline is the day before (default Sunday, so Saturday).', required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  feed_production_weekday?: number;
```

- [ ] **Step 6: Service** — in `location.service.ts` add this private method next to `assertSiloFieldsWhenSilo`:

```ts
  /**
   * Master Setup §1 rows 10 and 12: one low level and one high level per
   * silo, both kilograms whatever unit the capacity was typed in (capacity is
   * compared after its TON→KG conversion). Either may be blank (Q8); when both
   * are given the low must sit below the high, and neither may exceed what
   * the silo physically holds.
   */
  private assertSiloLevels(lowKg: number | null | undefined, highKg: number | null | undefined, capacityKg: number | null) {
    if (lowKg != null && highKg != null && lowKg >= highKg) {
      throw new ConflictException('The low feed level must be below the high feed level.');
    }
    if (capacityKg != null) {
      if (highKg != null && highKg > capacityKg) throw new ConflictException('The high feed level cannot exceed the silo capacity.');
      if (lowKg != null && lowKg > capacityKg) throw new ConflictException('The low feed level cannot exceed the silo capacity.');
    }
  }
```

In `create`, directly after `this.assertSiloFieldsWhenSilo(dto.storage_type, …)` (~line 824) and **before** the `if (dto.storage_type !== 'SILO')` block:

```ts
    if (dto.storage_type === 'SILO') {
      const capacityKg = siloCapacityToKg(dto.silo_capacity_kg, dto.silo_capacity_uom);
      this.assertSiloLevels(dto.low_level_kg, dto.high_level_kg, capacityKg == null ? null : Number(capacityKg));
    }
```

and inside that `if (dto.storage_type !== 'SILO')` block add `dto.low_level_kg = undefined; dto.high_level_kg = undefined;`.

In the insert values (after `silo_reorder_days`, ~line 332):

```ts
      low_level_kg: dto.storage_type === 'SILO' && dto.low_level_kg != null ? String(dto.low_level_kg) : null,
      high_level_kg: dto.storage_type === 'SILO' && dto.high_level_kg != null ? String(dto.high_level_kg) : null,
      ...(dto.feed_bulk_multiple_kg !== undefined ? { feed_bulk_multiple_kg: dto.feed_bulk_multiple_kg } : {}),
      ...(dto.feed_bag_size_kg !== undefined ? { feed_bag_size_kg: dto.feed_bag_size_kg } : {}),
      ...(dto.feed_truck_target_kg !== undefined ? { feed_truck_target_kg: dto.feed_truck_target_kg } : {}),
      ...(dto.feed_production_weekday !== undefined ? { feed_production_weekday: dto.feed_production_weekday } : {}),
```

In `update`, directly after `if (dto.silo_reorder_days !== undefined) updates.silo_reorder_days = dto.silo_reorder_days;`:

```ts
    // Levels are validated against the effective row, so saving only the
    // high level of a silo that already has a low one still checks the pair.
    if (effectiveStorage === 'SILO') {
      const effectiveLow = dto.low_level_kg !== undefined ? dto.low_level_kg : location.low_level_kg == null ? null : Number(location.low_level_kg);
      const effectiveHigh = dto.high_level_kg !== undefined ? dto.high_level_kg : location.high_level_kg == null ? null : Number(location.high_level_kg);
      const effectiveCapacity = updates.silo_capacity_kg !== undefined ? updates.silo_capacity_kg : location.silo_capacity_kg;
      this.assertSiloLevels(effectiveLow, effectiveHigh, effectiveCapacity == null ? null : Number(effectiveCapacity));
    }
    if (dto.low_level_kg !== undefined) updates.low_level_kg = dto.low_level_kg == null ? null : String(dto.low_level_kg);
    if (dto.high_level_kg !== undefined) updates.high_level_kg = dto.high_level_kg == null ? null : String(dto.high_level_kg);
```

inside the existing `if (effectiveStorage !== 'SILO') { … }` block add `updates.low_level_kg = null; updates.high_level_kg = null;`, and next to the `feed_lead_time_days` update line:

```ts
    if (dto.feed_bulk_multiple_kg !== undefined) updates.feed_bulk_multiple_kg = dto.feed_bulk_multiple_kg;
    if (dto.feed_bag_size_kg !== undefined) updates.feed_bag_size_kg = dto.feed_bag_size_kg;
    if (dto.feed_truck_target_kg !== undefined) updates.feed_truck_target_kg = dto.feed_truck_target_kg;
    if (dto.feed_production_weekday !== undefined) updates.feed_production_weekday = dto.feed_production_weekday;
```

- [ ] **Step 7: Web form** — in `configs.ts`, right after the `silo_reorder_days` field:

```ts
    // Master Setup §1 rows 10 and 12 (spec D10) — alongside Silo Reorder
    // Days, not replacing it. Optional (Q8): blank means no alert of that kind.
    { key: "low_level_kg", label: "Below Feed Level (KG)", type: "number", min: 0, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, section: "Identification",
      helpText: "Low feed alert when this silo's System Balance is at or below this many kilograms. Leave blank for no low alert." },
    { key: "high_level_kg", label: "Above Threshold (KG)", type: "number", min: 0, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, section: "Identification",
      helpText: "Over-stock notice when the System Balance is at or above this many kilograms — typically 90% of capacity. Leave blank for none." },
```

and after the `feed_lead_time_days` field:

```ts
    { key: "feed_bulk_multiple_kg", label: "Bulk Order Multiple (KG)", type: "number", min: 1, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] }, section: "Identification",
      helpText: "Feed requisitions round bulk orders up to this many kilograms (one truck compartment). Default 3000." },
    { key: "feed_bag_size_kg", label: "Feed Bag Size (KG)", type: "number", min: 1, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] }, section: "Identification",
      helpText: "Bagged feed is ordered in whole bags of this weight. Default 50." },
    { key: "feed_truck_target_kg", label: "Bulk Truck Target (KG)", type: "number", min: 1, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] }, section: "Identification",
      helpText: "Normal truck load, shown against the farm's requested total. A target, not a cap — more is served by extra trips. Default 30000." },
    { key: "feed_production_weekday", label: "Feed Production Day (0 = Sunday)", type: "number", min: 0, max: 6, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] }, section: "Identification",
      helpText: "Weekday the mill produces this farm's feed, 0 = Sunday to 6 = Saturday. Requisitions are due the day before. Default 0." },
```

- [ ] **Step 8: Run the tests** — `pnpm nx test api -- location.service` → PASS (all, including the three new).

- [ ] **Step 9: Apply and read back**

Run: `pnpm nx run api:db-migrate-all-tenants`
Then: `mysql … -e "SELECT COUNT(*) silos, SUM(low_level_kg IS NULL) no_low FROM nf_devco.location_master WHERE location_type='SILO'; SELECT location_code, feed_bulk_multiple_kg, feed_bag_size_kg, feed_truck_target_kg, feed_production_weekday FROM nf_devco.location_master WHERE location_type='FARM' LIMIT 3;"`
Expected: `no_low` equals `silos`; farms show `3000, 50, 30000, 0`.
And: `mysql … -e "SHOW COLUMNS FROM nf_devco.requisition LIKE 'submission_deadline'; SHOW COLUMNS FROM nf_devco.requisition_line LIKE 'recommended_qty_kg';"` → one row each.

- [ ] **Step 10: Typecheck, web tests, commit**

Run: `pnpm nx run-many -t typecheck -p api,web` → PASS; `pnpm nx test web` → PASS.

```bash
git add apps/api/src/drizzle/tenant/0117_feed_levels_settings_requisition.sql apps/api/src/drizzle/tenant/meta/_journal.json apps/api/src/core/database/schema.ts apps/api/src/modules/master-data/location apps/web/src/modules/master-data/configs.ts
git commit -m "feat(location): silo feed levels, farm requisition settings, feed requisition columns

Master Setup §1 rows 10 and 12 give each silo one low and one high feed
level in KG (spec D10, alongside Silo Reorder Days). The farm row gains the
workbook's configured requisition defaults: bulk multiple 3000 KG, bag
50 KG, truck target 30000 KG, and a production weekday (Sunday) standing in
for the production calendar of checkpoint 22. requisition and
requisition_line gain the feed fields of the Requisition sheet §1–§2.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Engine — per-source summary and diet changes

The requisition needs one line per silo and item (spec Plan B; Requisition §2) with snapshots the Plan A rows do not carry — which silo, the demand over the window, the first day of demand, whether it is the next diet, which lifecycle row. The DIET_CHANGE alert needs each batch's diet change date (checkpoint 30). Both are derived from what the engine already walks, so they are added there rather than recomputed by callers.

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts`
- Test: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.sources.spec.ts` (new)

**Interfaces:**
- Consumes: Plan A's `buildFeedForecast`, `ForecastInput`, `FeedRow`.
- Produces (exported from `feed-forecast.engine.ts`):

```ts
export interface ForecastSource {
  sourceType: 'SILO' | 'STORE';
  sourceCode: string;
  locationId: string;           // silo_id or the store's location_id
  itemId: string;
  itemName: string;
  balanceKg: number;            // System Balance at the planning date
  planningDayDemandKg: number;  // combined demand on the planning date
  firstDemandDate: string | null; // first walk day (planningDate..to) with demand
  firstDayDemandKg: number;     // combined demand on firstDemandDate
  walkDemandKg: number;         // combined demand planningDate..to
  daysLeft: number | null;      // D1
  runDownDate: string | null;   // D2
  isNextDiet: boolean;          // a batch changes onto this item in the window and nothing eats it today
  noSiloHoldsItem: boolean;     // a shed with silos draws it from the store because no silo holds it
  lifecycleIds: string[];       // lifecycle rows that produce its demand in the window, sorted
}
export interface DietChange {
  batchId: string; batchNo: string; shedCode: string;
  fromItemId: string; fromItemName: string; toItemId: string; toItemName: string;
  changeDate: string;           // first day of the new diet, > planningDate
  nextSourceType: 'SILO' | 'STORE' | 'NONE';
  nextSourceCode: string | null; // the silo that will feed it, null unless SILO
}
export interface ForecastResult { rows: ForecastRow[]; flags: ForecastFlag[]; sources: ForecastSource[]; dietChanges: DietChange[] }
export function buildFeedForecast(input: ForecastInput): ForecastResult;
```

- [ ] **Step 1: Write the failing test** — `feed-forecast.engine.sources.spec.ts`:

```ts
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * Plan B needs the engine's per-container view (one requisition line per silo
 * and item) and each batch's diet change date (DIET_CHANGE alert). The fixture
 * is the workbook's Worked Example: GRS H3, WG-2026-38, 1,000 pigs, R1 days
 * 25–27 at 2.0 kg (23–25 Sep), R2 days 28–31 at 2.5 kg (26–29 Sep), SILO1 R1
 * 1,500 kg, SILO2 R2 1,000 kg.
 */
const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 0,
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  batches: [{
    batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
  }],
  feedRows: [
    { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 0 },
  ],
};

describe('buildFeedForecast — sources and diet changes (Plan B)', () => {
  it('summarises each silo and item over the planning window, as the Worked Example tabulates it', () => {
    const { sources } = buildFeedForecast(workedExample);
    expect(sources).toEqual([
      {
        sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 's1', itemId: 'r1', itemName: 'Weaner Diet R1',
        balanceKg: 1500, planningDayDemandKg: 2000, firstDemandDate: '2026-09-23', firstDayDemandKg: 2000,
        walkDemandKg: 6000, daysLeft: 0, runDownDate: '2026-09-23', isNextDiet: false, noSiloHoldsItem: false,
        lifecycleIds: ['row-r1'],
      },
      {
        sourceType: 'SILO', sourceCode: 'GRS/SILO-002', locationId: 's2', itemId: 'r2', itemName: 'Weaner Diet R2',
        balanceKg: 1000, planningDayDemandKg: 0, firstDemandDate: '2026-09-26', firstDayDemandKg: 2500,
        walkDemandKg: 10000, daysLeft: null, runDownDate: '2026-09-26', isNextDiet: true, noSiloHoldsItem: false,
        lifecycleIds: ['row-r2'],
      },
    ]);
  });

  it('reports the R1 → R2 change on 26 Sep and the silo that will feed it', () => {
    const { dietChanges } = buildFeedForecast(workedExample);
    expect(dietChanges).toEqual([{
      batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003',
      fromItemId: 'r1', fromItemName: 'Weaner Diet R1', toItemId: 'r2', toItemName: 'Weaner Diet R2',
      changeDate: '2026-09-26', nextSourceType: 'SILO', nextSourceCode: 'GRS/SILO-002',
    }]);
  });

  it('marks a next diet no silo on the shed holds as drawn from the store, flagged for changeover', () => {
    const input: ForecastInput = {
      ...workedExample,
      sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1'] }],
      silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 }],
      store: { storeId: 'st', storeCode: 'GRS/STORE-001', balances: {} },
    };
    const { sources, dietChanges } = buildFeedForecast(input);
    const r2 = sources.find((s) => s.itemId === 'r2')!;
    expect(r2).toMatchObject({ sourceType: 'STORE', sourceCode: 'GRS/STORE-001', locationId: 'st', isNextDiet: true, noSiloHoldsItem: true, balanceKg: 0 });
    expect(dietChanges[0]).toMatchObject({ nextSourceType: 'STORE', nextSourceCode: null });
  });

  it('leaves sources with no container out, and reports no change for a batch that stays on one diet', () => {
    const input: ForecastInput = { ...workedExample, to: '2026-09-25', store: null, sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: [] }], silos: [] };
    const { sources, dietChanges } = buildFeedForecast(input);
    expect(sources).toEqual([]);
    expect(dietChanges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test api -- feed-forecast.engine.sources`
Expected: FAIL — `sources` / `dietChanges` undefined.

- [ ] **Step 3: Implement** in `feed-forecast.engine.ts`.

3a. Add the three exported interfaces from **Interfaces** above after `ForecastRow`, and change the signature to `export function buildFeedForecast(input: ForecastInput): ForecastResult {`. Add to the file's header comment a fifth point:

```ts
 * 5. Plan B reads two more things off the same walk: `sources` (one entry per
 *    physical container and item — the unit a feed requisition line is
 *    drafted for) and `dietChanges` (each batch's switch to its next
 *    lifecycle feed row inside planningDate..to, for the DIET_CHANGE alert).
 *    They are computed here, not by callers, so the requisition, the alert
 *    and the report can never disagree about demand or dates.
```

3b. Replace the `SourceResolution` type and `SourceKey` interface:

```ts
type SourceResolution = {
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  siloId: string | null;
  storeId: string | null;
  // The shed has silos but none holds this item, so it falls back to the store (Plan A Task 4's rule).
  noSiloHoldsItem: boolean;
};

/** One physical container (a silo, or the shared farm store) holding one item — the unit balance projection runs over. */
interface SourceKey {
  key: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  siloId: string | null;
  storeId: string | null;
  itemId: string;
}
```

3c. In `resolveSource`, give every resolution the two new fields:

```ts
    if (matching) {
      resolution = { sourceType: 'SILO', sourceCode: matching.siloCode, siloId: matching.siloId, storeId: null, noSiloHoldsItem: false };
    } else if (shedSilos.length === 0) {
      // D6: sheds without a silo are included, fed from the farm STORE — no flag, this is expected.
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode, siloId: null, storeId: input.store.storeId, noSiloHoldsItem: false }
        : { sourceType: 'NONE', sourceCode: null, siloId: null, storeId: null, noSiloHoldsItem: false };
    } else {
      // The shed has silos, but none of them hold this item — falls back to STORE (Task 4's daily-entry rule), flagged.
      flags.push({ kind: 'NO_SILO_HOLDS_ITEM', shedCode: shed!.shedCode, itemName: input.items[itemId] ?? itemId });
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode, siloId: null, storeId: input.store.storeId, noSiloHoldsItem: true }
        : { sourceType: 'NONE', sourceCode: null, siloId: null, storeId: null, noSiloHoldsItem: true };
    }
```

and in `sourceKeyFor` add `storeId: resolution.storeId,`.

3d. Before `for (const batch of input.batches) {` (the demand loop) declare:

```ts
  // Plan B: which lifecycle rows feed each container inside the walk window, which item each batch eats on each walk
  // day (for diet changes), and which containers are a store fallback for a shed that has silos.
  const lifecycleIdsByKey = new Map<string, Set<string>>();
  const itemByBatchDate = new Map<string, string>();
  const noSiloKeys = new Set<string>();
```

and inside the loop, immediately after `byDate.set(date, (byDate.get(date) ?? 0) + demandMicrograms);` and **before** `if (!isInRange(date)) continue;`:

```ts
      if (date >= input.planningDate && date <= input.to) {
        let ids = lifecycleIdsByKey.get(sk.key);
        if (!ids) {
          ids = new Set();
          lifecycleIdsByKey.set(sk.key, ids);
        }
        ids.add(feedRow.lifecycleId);
        itemByBatchDate.set(`${batch.batchId}|${date}`, feedRow.itemId);
        if (resolution.noSiloHoldsItem) noSiloKeys.add(sk.key);
      }
```

3e. Extend `KeyProjection` with `walkDemandKg: number; firstDemandDate: string | null; firstDayDemandKg: number;`, and in the projection loop, before `projectionByKey.set(…)`:

```ts
    // Plan B: demand over the walk window and its first day — the requisition's shortfall and daily requirement.
    let walkDemandMicrograms = 0;
    let firstDemandDate: string | null = null;
    let firstDayDemandMicrograms = 0;
    for (const date of walkDates) {
      const m = byDate.get(date) ?? 0;
      if (m > 0 && firstDemandDate === null) {
        firstDemandDate = date;
        firstDayDemandMicrograms = m;
      }
      walkDemandMicrograms += m;
    }
```

adding `walkDemandKg: toKg(walkDemandMicrograms), firstDemandDate, firstDayDemandKg: toKg(firstDayDemandMicrograms),` to the object passed to `projectionByKey.set`.

3f. After the projection loop and before `const entries`, add:

```ts
  // Diet changes (checkpoint 30): a batch whose item on walk day i differs from day i-1. Days before planningDate are
  // not walked, so a change that already happened is never reported as upcoming.
  const dietChanges: DietChange[] = [];
  const nextDietKeys = new Set<string>();
  for (const batch of input.batches) {
    for (let i = 1; i < walkDates.length; i++) {
      const before = itemByBatchDate.get(`${batch.batchId}|${walkDates[i - 1]}`);
      const after = itemByBatchDate.get(`${batch.batchId}|${walkDates[i]}`);
      if (!before || !after || before === after) continue;
      const next = resolveSource(batch.shedId, after); // cached: already resolved by the demand loop
      nextDietKeys.add(sourceKeyFor(next, after).key);
      dietChanges.push({
        batchId: batch.batchId,
        batchNo: batch.batchNo,
        shedCode: shedById.get(batch.shedId)?.shedCode ?? '',
        fromItemId: before,
        fromItemName: input.items[before] ?? before,
        toItemId: after,
        toItemName: input.items[after] ?? after,
        changeDate: walkDates[i],
        nextSourceType: next.sourceType,
        nextSourceCode: next.sourceType === 'SILO' ? next.sourceCode : null,
      });
    }
  }

  // One summary per real container and item. NONE (no silo, no store) has nowhere to deliver to, so no requisition line.
  const sources: ForecastSource[] = [];
  for (const [key, sk] of keyMeta) {
    if (sk.sourceType === 'NONE') continue;
    const p = projectionByKey.get(key)!;
    const planningDayDemandKg = p.sourceDailyDemandKg ?? 0;
    sources.push({
      sourceType: sk.sourceType,
      sourceCode: sk.sourceCode!,
      locationId: (sk.siloId ?? sk.storeId)!,
      itemId: sk.itemId,
      itemName: input.items[sk.itemId] ?? sk.itemId,
      balanceKg: p.currentInventoryKg,
      planningDayDemandKg,
      firstDemandDate: p.firstDemandDate,
      firstDayDemandKg: p.firstDayDemandKg,
      walkDemandKg: p.walkDemandKg,
      daysLeft: p.daysLeft,
      runDownDate: p.runDownDate,
      // "Is Next Diet Requisition — True if generated for the upcoming next diet" (Requisition §1 row 16): a batch
      // changes onto it inside the window and nothing on this container eats it on the planning date.
      isNextDiet: nextDietKeys.has(key) && planningDayDemandKg === 0,
      noSiloHoldsItem: noSiloKeys.has(key),
      lifecycleIds: [...(lifecycleIdsByKey.get(key) ?? [])].sort(),
    });
  }
  sources.sort((a, b) => (a.sourceCode !== b.sourceCode ? (a.sourceCode < b.sourceCode ? -1 : 1) : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
```

3g. Change the final return to `return { rows: entries.map((e) => e.row), flags, sources, dietChanges };`.

- [ ] **Step 4: Run** `pnpm nx test api -- feed-forecast` → PASS (new spec and Plan A's engine and service specs unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.sources.spec.ts
git commit -m "feat(feed-forecast): engine reports per-silo sources and diet changes

A feed requisition is drafted per silo and item (Requisition §2) with
snapshots of the forecast, and the DIET_CHANGE alert needs each batch's
change date (checkpoint 30). Both come off the engine's own walk so the
report, the requisition and the alert cannot disagree. Reproduces the
Worked Example: R1 6,000 kg over 1,500; R2 10,000 kg over 1,000, next diet
from 26 Sep in SILO2.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Requisition rules (pure)

All arithmetic and decisions of a feed requisition, with no database: rounding (Step 8: "Bulk rounding defaults to 3000 KG per compartment … Bagged rounds to 50 KG"), bag count (Requisition §1 row 23 "Recommended Qty divided by 50"), the 20 % deviation rule (checkpoint 18), the submission cycle (checkpoint 22, Q4), the recommendation per source (Worked Example: `MAX(0, requirement − opening)`, then `CEILING(…, 3000)`), and priority (Requisition §1 row 34).

**Files:**
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts`
- Test: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts`

**Interfaces:**
- Consumes: `ForecastSource` (Task 2).
- Produces:

```ts
export type FeedType = 'BULK' | 'BAGGED';
export type Priority = 'CRITICAL_FIRST_PRIORITY' | 'CRITICAL' | 'WARNING' | 'INFO';
export interface FarmFeedSettings { bulkMultipleKg: number; bagSizeKg: number; truckTargetKg: number; productionWeekday: number }
export const DEFAULT_FEED_SETTINGS: FarmFeedSettings; // 3000, 50, 30000, 0
export const DEVIATION_LIMIT = 0.2;
export interface DestinationInfo { locationId: string; locationType: 'SILO' | 'STORE'; feedInBags: boolean | null; lowLevelKg: number | null }
export interface DraftLine {
  key: string; destinationLocationId: string; sourceType: 'SILO' | 'STORE'; sourceCode: string;
  itemId: string; itemName: string; feedType: FeedType; isNextDiet: boolean; daysBeforeDietChange: number | null;
  lifecycleRefId: string | null; systemBalanceKg: number; dailyRequirementKg: number; daysRemaining: number | null;
  firstShortageDate: string | null; unroundedNeedKg: number; recommendedQtyKg: number; bagCount: number | null;
  proposedDeliveryDate: string; belowLowLevel: boolean; needsSiloChangeover: boolean;
}
export function lineKey(destinationLocationId: string, itemId: string): string;
export function feedTypeOf(dest: Pick<DestinationInfo, 'locationType' | 'feedInBags'>): FeedType;
export function roundOrderKg(needKg: number, feedType: FeedType, s: FarmFeedSettings): number;
export function bagCountFor(kg: number, feedType: FeedType, s: FarmFeedSettings): number | null;
export function deviationNeedsRemarks(recommendedKg: number | null, requestedKg: number): boolean;
export function productionCycle(planningDate: string, productionWeekday: number): { productionDate: string; submissionDeadline: string };
export function recommendLines(args: { planningDate: string; to: string; sources: ForecastSource[]; destinations: Map<string, DestinationInfo>; settings: FarmFeedSettings }): DraftLine[];
export function requisitionPriority(planningDate: string, lines: Pick<DraftLine, 'belowLowLevel' | 'firstShortageDate'>[]): Priority;
export function addDaysIso(iso: string, n: number): string;
export function diffDaysIso(a: string, b: string): number;
```

- [ ] **Step 1: Write the failing tests** — `feed-requisition.rules.spec.ts`:

```ts
import type { ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';
import {
  DEFAULT_FEED_SETTINGS, DestinationInfo, bagCountFor, deviationNeedsRemarks, feedTypeOf, productionCycle,
  recommendLines, requisitionPriority, roundOrderKg,
} from './feed-requisition.rules';

const S = DEFAULT_FEED_SETTINGS;

// Task 2's sources for the Worked Example (23–29 Sep, SILO1 R1 1,500 kg, SILO2 R2 1,000 kg).
const r1: ForecastSource = {
  sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 's1', itemId: 'r1', itemName: 'Weaner Diet R1',
  balanceKg: 1500, planningDayDemandKg: 2000, firstDemandDate: '2026-09-23', firstDayDemandKg: 2000, walkDemandKg: 6000,
  daysLeft: 0, runDownDate: '2026-09-23', isNextDiet: false, noSiloHoldsItem: false, lifecycleIds: ['row-r1'],
};
const r2: ForecastSource = {
  sourceType: 'SILO', sourceCode: 'GRS/SILO-002', locationId: 's2', itemId: 'r2', itemName: 'Weaner Diet R2',
  balanceKg: 1000, planningDayDemandKg: 0, firstDemandDate: '2026-09-26', firstDayDemandKg: 2500, walkDemandKg: 10000,
  daysLeft: null, runDownDate: '2026-09-26', isNextDiet: true, noSiloHoldsItem: false, lifecycleIds: ['row-r2'],
};
const silo = (id: string, extra: Partial<DestinationInfo> = {}): [string, DestinationInfo] =>
  [id, { locationId: id, locationType: 'SILO', feedInBags: null, lowLevelKg: null, ...extra }];

describe('roundOrderKg and bagCountFor', () => {
  it('rounds bulk up to 3,000 kg multiples — Worked Example H8/H9', () => {
    expect(roundOrderKg(4500, 'BULK', S)).toBe(6000);
    expect(roundOrderKg(9000, 'BULK', S)).toBe(9000);
    expect(roundOrderKg(0, 'BULK', S)).toBe(0);
  });
  it('rounds bagged up to whole 50 kg bags and counts them', () => {
    expect(roundOrderKg(1234, 'BAGGED', S)).toBe(1250);
    expect(bagCountFor(1250, 'BAGGED', S)).toBe(25);
    expect(bagCountFor(6000, 'BULK', S)).toBeNull();
  });
  it('does not round a whole multiple up by float noise', () => {
    expect(roundOrderKg(0.1 * 3 * 10000, 'BULK', S)).toBe(3000);
  });
});

describe('feedTypeOf (Q10)', () => {
  it('reads feed_in_bags, and falls back to BULK for a silo and BAGGED for a store', () => {
    expect(feedTypeOf({ locationType: 'SILO', feedInBags: true })).toBe('BAGGED');
    expect(feedTypeOf({ locationType: 'STORE', feedInBags: false })).toBe('BULK');
    expect(feedTypeOf({ locationType: 'SILO', feedInBags: null })).toBe('BULK');
    expect(feedTypeOf({ locationType: 'STORE', feedInBags: null })).toBe('BAGGED');
  });
});

describe('deviationNeedsRemarks — checkpoint 18', () => {
  it('requires remarks above 20 %: 6,000 → 9,000 kg', () => expect(deviationNeedsRemarks(6000, 9000)).toBe(true));
  it('does not at exactly 20 %', () => {
    expect(deviationNeedsRemarks(6000, 7200)).toBe(false);
    expect(deviationNeedsRemarks(6000, 4800)).toBe(false);
  });
  it('never for a manual line with no recommendation', () => expect(deviationNeedsRemarks(null, 50000)).toBe(false));
  it('always when the recommendation was 0 kg and something is requested', () => {
    expect(deviationNeedsRemarks(0, 3000)).toBe(true);
    expect(deviationNeedsRemarks(0, 0)).toBe(false);
  });
});

describe('productionCycle — Saturday deadline for Sunday production (checkpoint 22, Q4)', () => {
  it('Wednesday 23 Sep 2026 → produce Sunday 27, submit by Saturday 26', () => {
    expect(productionCycle('2026-09-23', 0)).toEqual({ productionDate: '2026-09-27', submissionDeadline: '2026-09-26' });
  });
  it('on the Saturday itself the deadline is today', () => {
    expect(productionCycle('2026-09-26', 0)).toEqual({ productionDate: '2026-09-27', submissionDeadline: '2026-09-26' });
  });
  it('on the Sunday the next cycle is a week away', () => {
    expect(productionCycle('2026-09-27', 0)).toEqual({ productionDate: '2026-10-04', submissionDeadline: '2026-10-03' });
  });
  it('honours another production weekday (Wednesday = 3)', () => {
    expect(productionCycle('2026-09-23', 3)).toEqual({ productionDate: '2026-09-30', submissionDeadline: '2026-09-29' });
  });
});

describe('recommendLines — Worked Example', () => {
  const lines = recommendLines({
    planningDate: '2026-09-23', to: '2026-09-29', sources: [r1, r2],
    destinations: new Map([silo('s1'), silo('s2')]), settings: S,
  });

  it('drafts R1 6,000 kg to SILO1 and R2 9,000 kg to SILO2 as the next diet', () => {
    expect(lines).toEqual([
      expect.objectContaining({
        key: 's1|r1', destinationLocationId: 's1', itemId: 'r1', feedType: 'BULK', isNextDiet: false, daysBeforeDietChange: null,
        lifecycleRefId: 'row-r1', systemBalanceKg: 1500, dailyRequirementKg: 2000, daysRemaining: 0,
        firstShortageDate: '2026-09-23', unroundedNeedKg: 4500, recommendedQtyKg: 6000, bagCount: null,
        proposedDeliveryDate: '2026-09-23', belowLowLevel: false, needsSiloChangeover: false,
      }),
      expect.objectContaining({
        key: 's2|r2', destinationLocationId: 's2', itemId: 'r2', isNextDiet: true, daysBeforeDietChange: 3,
        dailyRequirementKg: 2500, daysRemaining: null, unroundedNeedKg: 9000, recommendedQtyKg: 9000,
        proposedDeliveryDate: '2026-09-26',
      }),
    ]);
  });

  it('drafts nothing for a source whose stock covers the window', () => {
    expect(recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [{ ...r1, balanceKg: 6000 }], destinations: new Map([silo('s1')]), settings: S })).toEqual([]);
  });

  it('marks a silo at or below its low level (priority input) and a store fallback as needing a changeover', () => {
    const [line] = recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [r1], destinations: new Map([silo('s1', { lowLevelKg: 1500 })]), settings: S });
    expect(line.belowLowLevel).toBe(true);
    const [store] = recommendLines({
      planningDate: '2026-09-23', to: '2026-09-29',
      sources: [{ ...r2, sourceType: 'STORE', sourceCode: 'GRS/STORE-001', locationId: 'st', noSiloHoldsItem: true }],
      destinations: new Map([['st', { locationId: 'st', locationType: 'STORE', feedInBags: null, lowLevelKg: null }]]), settings: S,
    });
    expect(store).toMatchObject({ feedType: 'BAGGED', needsSiloChangeover: true, recommendedQtyKg: 9000, bagCount: 180 });
  });
});

describe('requisitionPriority — Requisition §1 row 34', () => {
  it('CRITICAL_FIRST_PRIORITY when any silo is at or below its low level', () => {
    expect(requisitionPriority('2026-09-23', [{ belowLowLevel: true, firstShortageDate: '2026-10-10' }])).toBe('CRITICAL_FIRST_PRIORITY');
  });
  it('CRITICAL under 3 days to shortage, WARNING under 7, INFO otherwise', () => {
    expect(requisitionPriority('2026-09-23', [{ belowLowLevel: false, firstShortageDate: '2026-09-23' }])).toBe('CRITICAL');
    expect(requisitionPriority('2026-09-23', [{ belowLowLevel: false, firstShortageDate: '2026-09-26' }])).toBe('WARNING');
    expect(requisitionPriority('2026-09-23', [{ belowLowLevel: false, firstShortageDate: '2026-09-30' }])).toBe('INFO');
    expect(requisitionPriority('2026-09-23', [])).toBe('INFO');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm nx test api -- feed-requisition.rules` → FAIL (module not found).

- [ ] **Step 3: Implement** `feed-requisition.rules.ts`:

```ts
/**
 * Feed requisition rules — pure, no database (Feed Forecast Plan B).
 *
 * Every number on a drafted feed requisition line comes from here, so the
 * workbook's own figures can be pinned in a unit test:
 * - Recommended quantity: Worked Example columns G–H, `MAX(0, requirement −
 *   opening)` then `CEILING(…, 3000)`; Engine Step 8 "Bulk rounding defaults
 *   to 3000 KG per compartment … Bagged rounds to 50 KG". Safety stock is 0
 *   and silo free capacity is not applied (Worked Example scope note; Q9).
 * - Bag count: Requisition §1 row 23, quantity ÷ bag size (default 50).
 * - Remarks: checkpoint 18, more than 20 % from the recommendation.
 * - Submission cycle: checkpoint 22 — produced on the farm's production
 *   weekday (default Sunday), due the day before (Q4).
 * - Priority: Requisition §1 row 34 — CRITICAL_FIRST_PRIORITY only for a
 *   silo at or below its single low level; otherwise from the shortage date
 *   ("Below 3 days = first priority. Below 7 days = warning", Engine §4 row
 *   55), which we map to CRITICAL and WARNING because the workbook reserves
 *   first priority for the low level ("not a second low threshold").
 */
import type { ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';

export type FeedType = 'BULK' | 'BAGGED';
export type Priority = 'CRITICAL_FIRST_PRIORITY' | 'CRITICAL' | 'WARNING' | 'INFO';

export interface FarmFeedSettings {
  bulkMultipleKg: number;
  bagSizeKg: number;
  truckTargetKg: number;
  productionWeekday: number;
}

export const DEFAULT_FEED_SETTINGS: FarmFeedSettings = { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 };

/** Checkpoint 18: "deviates more than 20 percent from Recommended Qty". */
export const DEVIATION_LIMIT = 0.2;

export interface DestinationInfo {
  locationId: string;
  locationType: 'SILO' | 'STORE';
  feedInBags: boolean | null;
  lowLevelKg: number | null;
}

export interface DraftLine {
  key: string;
  destinationLocationId: string;
  sourceType: 'SILO' | 'STORE';
  sourceCode: string;
  itemId: string;
  itemName: string;
  feedType: FeedType;
  isNextDiet: boolean;
  daysBeforeDietChange: number | null;
  lifecycleRefId: string | null;
  systemBalanceKg: number;
  dailyRequirementKg: number;
  daysRemaining: number | null;
  firstShortageDate: string | null;
  unroundedNeedKg: number;
  recommendedQtyKg: number;
  bagCount: number | null;
  proposedDeliveryDate: string;
  belowLowLevel: boolean;
  needsSiloChangeover: boolean;
}

function parseIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysIso(iso: string, n: number): string {
  return new Date(parseIso(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

export function diffDaysIso(a: string, b: string): number {
  return Math.round((parseIso(b) - parseIso(a)) / 86_400_000);
}

/** Kilograms to three decimals — the precision the ledger stores quantities in. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A requisition line is one destination and one item ("lines per silo and item", spec Plan B). */
export function lineKey(destinationLocationId: string, itemId: string): string {
  return `${destinationLocationId}|${itemId}`;
}

/** Requisition §1 row 15: Feed Type from Location Master. Nothing is recorded today, so a silo is bulk, a store bags (Q10). */
export function feedTypeOf(dest: Pick<DestinationInfo, 'locationType' | 'feedInBags'>): FeedType {
  if (dest.feedInBags === true) return 'BAGGED';
  if (dest.feedInBags === false) return 'BULK';
  return dest.locationType === 'STORE' ? 'BAGGED' : 'BULK';
}

export function roundOrderKg(needKg: number, feedType: FeedType, s: FarmFeedSettings): number {
  if (needKg <= 0) return 0;
  const multiple = feedType === 'BULK' ? s.bulkMultipleKg : s.bagSizeKg;
  // Rounded to 1e-6 before the ceiling so 3000.0000000004 kg does not become two compartments.
  return Math.ceil(Math.round((needKg / multiple) * 1e6) / 1e6) * multiple;
}

export function bagCountFor(kg: number, feedType: FeedType, s: FarmFeedSettings): number | null {
  if (feedType !== 'BAGGED') return null;
  return Math.ceil(Math.round((kg / s.bagSizeKg) * 1e6) / 1e6);
}

export function deviationNeedsRemarks(recommendedKg: number | null, requestedKg: number): boolean {
  if (recommendedKg === null) return false; // a manual line has nothing to deviate from
  if (recommendedKg <= 0) return requestedKg > 0;
  return Math.abs(requestedKg - recommendedKg) / recommendedKg > DEVIATION_LIMIT + 1e-9;
}

export function productionCycle(planningDate: string, productionWeekday: number): { productionDate: string; submissionDeadline: string } {
  const weekday = new Date(parseIso(planningDate)).getUTCDay();
  // Strictly after the planning date: a request made on production day itself is for the next cycle.
  const ahead = ((productionWeekday - weekday + 7) % 7) || 7;
  const productionDate = addDaysIso(planningDate, ahead);
  return { productionDate, submissionDeadline: addDaysIso(productionDate, -1) };
}

export function recommendLines(args: {
  planningDate: string;
  to: string;
  sources: ForecastSource[];
  destinations: Map<string, DestinationInfo>;
  settings: FarmFeedSettings;
}): DraftLine[] {
  const { planningDate, to, sources, destinations, settings } = args;
  const lines: DraftLine[] = [];
  for (const s of sources) {
    // Worked Example G8: MAX(0, requirement − opening). "Never offset next diet with stock of current diet" holds
    // because each source is one container and one item.
    const unroundedNeedKg = Math.max(0, round3(s.walkDemandKg - s.balanceKg));
    if (unroundedNeedKg <= 0) continue;
    const dest = destinations.get(s.locationId) ?? { locationId: s.locationId, locationType: s.sourceType, feedInBags: null, lowLevelKg: null };
    const feedType = feedTypeOf(dest);
    const recommendedQtyKg = roundOrderKg(unroundedNeedKg, feedType, settings);
    lines.push({
      key: lineKey(s.locationId, s.itemId),
      destinationLocationId: s.locationId,
      sourceType: s.sourceType,
      sourceCode: s.sourceCode,
      itemId: s.itemId,
      itemName: s.itemName,
      feedType,
      isNextDiet: s.isNextDiet,
      daysBeforeDietChange: s.isNextDiet && s.firstDemandDate ? diffDaysIso(planningDate, s.firstDemandDate) : null,
      lifecycleRefId: s.lifecycleIds[0] ?? null,
      systemBalanceKg: s.balanceKg,
      // Requisition §2 row 50 "Daily consumption for this silo": today's, or for a next diet its first day's.
      dailyRequirementKg: s.planningDayDemandKg > 0 ? s.planningDayDemandKg : s.firstDayDemandKg,
      daysRemaining: s.daysLeft,
      firstShortageDate: s.runDownDate,
      unroundedNeedKg,
      recommendedQtyKg,
      bagCount: bagCountFor(recommendedQtyKg, feedType, settings),
      // Requisition §1 row 29: "Derived from earliest projected shortage". A need inside the window implies a
      // shortage inside it, so `to` is only a guard.
      proposedDeliveryDate: s.runDownDate ?? to,
      belowLowLevel: dest.locationType === 'SILO' && dest.lowLevelKg !== null && s.balanceKg <= dest.lowLevelKg,
      needsSiloChangeover: s.noSiloHoldsItem,
    });
  }
  return lines;
}

export function requisitionPriority(planningDate: string, lines: Pick<DraftLine, 'belowLowLevel' | 'firstShortageDate'>[]): Priority {
  if (lines.some((l) => l.belowLowLevel)) return 'CRITICAL_FIRST_PRIORITY';
  const shortages = lines.map((l) => l.firstShortageDate).filter((d): d is string => !!d).sort();
  if (!shortages.length) return 'INFO';
  const days = diffDaysIso(planningDate, shortages[0]);
  if (days < 3) return 'CRITICAL';
  if (days < 7) return 'WARNING';
  return 'INFO';
}
```

- [ ] **Step 4: Run** `pnpm nx test api -- feed-requisition.rules` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts
git commit -m "feat(feed-requisition): pure rounding, deviation, cycle and recommendation rules

Worked Example H8/H9 (4,500 -> 6,000 kg; 9,000 stays 9,000), bagged to
50 kg bags, remarks above 20 % (checkpoint 18), Saturday deadline for
Sunday production (checkpoint 22), priority per Requisition §1 row 34.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Forecast service — farm resolution and a system entry point

The alert evaluator and the requisition auto-draft both need "the forecast for this farm" without re-implementing Plan A's farm-scope rules (D13, fix rounds 1–2 in `feed-forecast.service.ts`), and the stock-posting hooks need it for a farm the caller did not name. So `getForecast` is split into three public pieces; its behaviour does not change.

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` (`getForecast` ~351–436, `FeedForecastResponse` ~50)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.module.ts` (export the service)
- Test: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.farm.spec.ts` (new)

**Interfaces:**
- Consumes: `ForecastSource`, `DietChange`, `ForecastResult` (Task 2).
- Produces (public on `FeedForecastService`):

```ts
export interface ResolvedFarm { farmId: string; companyId: string }
resolveFarm(queryFarmId: string | undefined, tenantId: string, userType?: string): Promise<ResolvedFarm>;
computeForFarm(farmId: string, companyId: string, tenantId: string, range?: { from?: string; to?: string }): Promise<FeedForecastResponse>;
withFarmScope<T>(farmId: string, companyId: string, work: () => Promise<T>): Promise<T>;
// FeedForecastResponse gains: sources: ForecastSource[]; dietChanges: DietChange[];
```
- `FeedForecastModule` exports `FeedForecastService`.

- [ ] **Step 1: Write the failing test** — `feed-forecast.service.farm.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { farmScope } from '../../../common/farm-scope';
import { FeedForecastService } from './feed-forecast.service';

/**
 * Plan B callers (alerts, requisition auto-draft, posting hooks) reach the
 * forecast through resolveFarm + computeForFarm. These pin the two promises
 * those callers rely on: a farm-bound user cannot name another farm, and
 * every loader runs under the farm being computed, not the pinned one.
 */
describe('FeedForecastService — Plan B entry points', () => {
  const farm = { id: 'farm-b', code: 'GRS', name: 'Grasmere', companyId: 'co-1', refillBufferDays: 2, leadTimeDays: 0 };
  const emptyInput = {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 0,
    sheds: [], silos: [], store: null, items: {}, batches: [], feedRows: [],
  };

  it('answers NotFound when a farm-bound user names another farm (D13)', async () => {
    const cls = transactionCls({});
    useFarmScope(cls, { farmId: 'farm-a', restricted: true, companyId: 'co-1', lobId: null });
    const service = new FeedForecastService(cls, {} as any, {} as any);
    await expect(service.resolveFarm('farm-b', 'tenant-1', 'STANDARD_USER')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the pinned farm and its company for a farm-bound user who names none', async () => {
    const cls = transactionCls({});
    useFarmScope(cls, { farmId: 'farm-a', restricted: true, companyId: 'co-1', lobId: null });
    const service = new FeedForecastService(cls, {} as any, {} as any);
    await expect(service.resolveFarm(undefined, 'tenant-1', 'STANDARD_USER')).resolves.toEqual({ farmId: 'farm-a', companyId: 'co-1' });
  });

  it('runs every loader under the computed farm and returns sources and diet changes', async () => {
    const cls = transactionCls({});
    const service = new FeedForecastService(cls, {} as any, {} as any);
    const seen: Array<string | null> = [];
    jest.spyOn(service as any, 'loadFarm').mockImplementation(async () => { seen.push(farmScope(cls).farmId); return farm; });
    jest.spyOn(service as any, 'loadInput').mockImplementation(async () => { seen.push(farmScope(cls).farmId); return { input: emptyInput, flags: [] }; });

    const result = await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1', { from: '2026-09-23', to: '2026-09-29' }));

    expect(seen).toEqual(['farm-b', 'farm-b']);
    expect(result).toMatchObject({ farm: { id: 'farm-b', code: 'GRS' }, rows: [], sources: [], dietChanges: [] });
  });
});
```

- [ ] **Step 2: Run** `pnpm nx test api -- feed-forecast.service.farm` → FAIL (`resolveFarm` is not a function).

- [ ] **Step 3: Implement.**

3a. Add to the imports `DietChange, ForecastSource` from `./feed-forecast.engine`, and extend `FeedForecastResponse`:

```ts
export interface FeedForecastResponse {
  planningDate: string;
  from: string;
  to: string;
  farm: { id: string; code: string; name: string };
  rows: ForecastRow[];
  flags: ForecastFlag[];
  // Plan B: the requisition's lines and the DIET_CHANGE alert read these (engine Task 2).
  sources: ForecastSource[];
  dietChanges: DietChange[];
}

export interface ResolvedFarm {
  farmId: string;
  companyId: string;
}
```

3b. Replace `getForecast` with the four methods below. `resolveFarm`'s body from `const scope = farmScope(this.cls);` down to `if (!farmId) throw new BadRequestException('Select a farm.');` is the **existing** block of `getForecast`, moved unchanged (keep every comment); the only new lines are the last three.

```ts
  async getForecast(query: QueryFeedForecastDto, tenantId: string, userType?: string): Promise<FeedForecastResponse> {
    const planningDate = todayLocal();
    const from = query.from ?? planningDate;
    const to = query.to ?? addDays(from, DEFAULT_SPAN_DAYS);
    if (!isCalendarDay(from) || !isCalendarDay(to)) {
      throw new BadRequestException('from and to must be calendar dates (YYYY-MM-DD).');
    }
    if (to < from) throw new BadRequestException('to must not be before from.');
    if (diffDays(from, to) > MAX_SPAN_DAYS) {
      throw new BadRequestException(`The forecast covers at most ${MAX_SPAN_DAYS} days after from.`);
    }
    const { farmId, companyId } = await this.resolveFarm(query.farmId, tenantId, userType);
    return this.computeForFarm(farmId, companyId, tenantId, { from, to });
  }

  /**
   * Which farm a caller may be answered for (D13 and fix rounds 1–2) — shared
   * by the report, the feed alerts and the feed requisitions so the three can
   * never disagree about whose farm a user may see.
   */
  async resolveFarm(queryFarmId: string | undefined, tenantId: string, userType?: string): Promise<ResolvedFarm> {
    const query = { farmId: queryFarmId };
    // ── moved unchanged from getForecast: from `const scope = farmScope(this.cls);`
    //    through `if (!farmId) throw new BadRequestException('Select a farm.');` ──
    const companyId = effectiveCompanyId ?? (await this.activeFarmOfTenant(farmId, tenantId));
    if (!companyId) throw new NotFoundException('Farm not found.');
    return { farmId, companyId };
  }

  /**
   * The forecast for a farm already resolved (or, from a posting hook, known
   * from the location that was posted). No user checks here — callers are
   * resolveFarm or trusted internal code. from/to default as the report does.
   */
  async computeForFarm(farmId: string, companyId: string, tenantId: string, range: { from?: string; to?: string } = {}): Promise<FeedForecastResponse> {
    const planningDate = todayLocal();
    const from = range.from ?? planningDate;
    const to = range.to ?? addDays(from, DEFAULT_SPAN_DAYS);
    return this.withFarmScope(farmId, companyId, async () => {
      const farm = await this.loadFarm(farmId, tenantId);
      const { input, flags: loadFlags } = await this.loadInput(farm, planningDate, from, to, tenantId);
      const { rows, flags, sources, dietChanges } = buildFeedForecast(input);
      return {
        planningDate, from, to,
        farm: { id: farm.id, code: farm.code, name: farm.name },
        rows, flags: [...flags, ...loadFlags], sources, dietChanges,
      };
    });
  }

  /**
   * Runs `work` with the CLS farm scope replaced by this farm (fix round 2,
   * finding 1: InventoryLedgerService and SiloFeedService read farmScope(cls)
   * themselves). Public so the alert evaluator reads silo balances the same way.
   */
  async withFarmScope<T>(farmId: string, companyId: string, work: () => Promise<T>): Promise<T> {
    const effectiveScope: FarmScope = { ...farmScope(this.cls), farmId, companyId };
    return this.cls.run(async () => {
      this.cls.set(FARM_SCOPE_KEY, effectiveScope);
      return work();
    });
  }
```

Remove the now-unused `planningDate`/`from`/`to` references from the moved block (it used none of them), and delete the old `const farmIdResolved … return this.cls.run(…)` tail of `getForecast` (replaced by `computeForFarm`).

3c. `feed-forecast.module.ts`: add `exports: [FeedForecastService],`.

- [ ] **Step 4: Run** `pnpm nx test api -- feed-forecast` → PASS (new spec, and Plan A's `feed-forecast.service.spec.ts` unchanged — it exercises `getForecast`).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm nx run-many -t typecheck -p api` → PASS.

```bash
git add apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.module.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.farm.spec.ts
git commit -m "refactor(feed-forecast): resolveFarm, computeForFarm and withFarmScope

Alerts and requisition drafting need the forecast for a farm without a
second copy of the D13 farm-scope rules. getForecast now composes the
three; its responses gain sources and dietChanges (engine, Plan B Task 2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Alerts and Notifications Master

Workbook Master Setup §4, fields verbatim: Notification Code, Notification Name, Event Type, Trigger Entity, Threshold Value, Threshold Reference, Priority Level, Recipient Role(s), Delivery Channel, Frequency, Escalation After Hours, Escalation Recipient Role, Active, Farm Filter. Checkpoint 10: "All notification thresholds, recipient roles, delivery channels, and escalation rules must be defined in Alerts and Notifications Master … No hardcoded notification logic." So the four Plan B events are driven by rows here, seeded with the workbook's own values.

**Files:**
- Create: `apps/api/src/drizzle/tenant/0118_alert_rule.sql`; modify `meta/_journal.json` (idx 118)
- Modify: `apps/api/src/core/database/schema.ts` (new `alertRule` table, after `notificationLog`)
- Create: `apps/api/src/modules/system/alert-rule/alert-rule.rules.ts`, `alert-rule.dto.ts`, `alert-rule.service.ts`, `alert-rule.controller.ts`, `alert-rule.module.ts`
- Test: `apps/api/src/modules/system/alert-rule/alert-rule.rules.spec.ts`, `alert-rule.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `AlertRuleModule` next to `ReasonModule`)
- Modify: `apps/api/src/common/master-data-scope.ts` (`MASTER_TABLES`: `'alert-rule': schema.alertRule`)
- Modify: `apps/api/src/common/farm-scope-coverage.spec.ts` (EXEMPT entry)
- Modify: `apps/web/src/components/console/console-tabs/roles-tab.tsx`, `apps/web/src/utils/translations.ts`
- Modify: `apps/web/src/modules/master-data/configs.ts` (new `alertRule` config, registered in `MASTER_DATA_CONFIGS` after `reason`), `apps/web/specs/master-data-singular-label.spec.ts` (`"alert-rule": "Alert Rule"`)

**Interfaces:**
- Produces:
  - `schema.alertRule` — columns listed in the migration below.
  - From `alert-rule.rules.ts`:

```ts
export const EVENT_TYPES = ['FEED_BELOW_L1', 'FEED_ABOVE', 'DIET_CHANGE', 'REQ_DEADLINE'] as const;
export type AlertEventType = (typeof EVENT_TYPES)[number];
export const TRIGGER_ENTITIES = ['SILO', 'REQUISITION', 'FEED_PLAN', 'STOCK_TAKE'] as const;
export const TRIGGER_FOR_EVENT: Record<AlertEventType, string>;
export const THRESHOLD_REFERENCES = ['SILO_BELOW', 'SILO_ABOVE', 'FIXED_VALUE'] as const;
export const PRIORITY_LEVELS = ['CRITICAL_FIRST_PRIORITY', 'CRITICAL', 'WARNING', 'INFO'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
export const DELIVERY_CHANNELS = ['IN_APP'] as const;
export const FREQUENCIES = ['ONCE', 'DAILY', 'ON_EACH_OCCURRENCE', 'ESCALATING'] as const;
export type AlertFrequency = (typeof FREQUENCIES)[number];
export interface AlertRuleShape { event_type: string; trigger_entity: string; threshold_reference: string; threshold_value?: number | null; priority_level: string; recipient_roles: string[]; delivery_channel: string; frequency: string; escalation_after_hours?: number | null; escalation_role?: string | null }
export function alertRuleProblems(rule: AlertRuleShape): string[];
```
  - REST `/alert-rule`: `GET` (query `companyId`, `isActive`, `eventType`, `limit`, `offset`), `GET /:id`, `POST`, `PUT /:id`, `DELETE /:id` (deactivate), `PATCH /:id/restore`, guarded by `('NOTIFICATION', 'ALERT_RULE', view|create|edit|delete)`.

- [ ] **Step 1: Write the failing tests**

`alert-rule.rules.spec.ts`:

```ts
import { alertRuleProblems, AlertRuleShape } from './alert-rule.rules';

const lowRule: AlertRuleShape = {
  event_type: 'FEED_BELOW_L1', trigger_entity: 'SILO', threshold_reference: 'SILO_BELOW', threshold_value: null,
  priority_level: 'CRITICAL_FIRST_PRIORITY', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP',
  frequency: 'ESCALATING', escalation_after_hours: 4, escalation_role: 'HEAD_OF_FARM',
};

describe('alertRuleProblems — Master Setup §4', () => {
  it('accepts the workbook FEED-BELOW-L1 example (rows 43–56, column F)', () => {
    expect(alertRuleProblems(lowRule)).toEqual([]);
  });
  it('refuses an event Plan B does not evaluate yet', () => {
    expect(alertRuleProblems({ ...lowRule, event_type: 'MILL_DISPATCH' })).toContain('Event type MILL_DISPATCH is not evaluated yet.');
  });
  it('ties the trigger entity to the event', () => {
    expect(alertRuleProblems({ ...lowRule, trigger_entity: 'REQUISITION' })).toContain('FEED_BELOW_L1 is triggered by SILO, not REQUISITION.');
  });
  it('only lets a low rule read the silo low level, and needs a value for FIXED_VALUE', () => {
    expect(alertRuleProblems({ ...lowRule, threshold_reference: 'SILO_ABOVE' })).toContain('FEED_BELOW_L1 takes its threshold from SILO_BELOW or FIXED_VALUE.');
    expect(alertRuleProblems({ ...lowRule, threshold_reference: 'FIXED_VALUE', threshold_value: null })).toContain('A FIXED_VALUE rule needs a threshold value of 0 or more.');
    expect(alertRuleProblems({ ...lowRule, event_type: 'DIET_CHANGE', trigger_entity: 'FEED_PLAN', threshold_reference: 'SILO_BELOW' }))
      .toContain('DIET_CHANGE takes its threshold from FIXED_VALUE.');
  });
  it('needs at least one well-formed recipient role code', () => {
    expect(alertRuleProblems({ ...lowRule, recipient_roles: [] })).toContain('Name at least one recipient role.');
    expect(alertRuleProblems({ ...lowRule, recipient_roles: ['farm manager'] })).toContain("Role code 'farm manager' must be upper-case letters, digits and underscores.");
  });
  it('builds only the in-app channel (Q12)', () => {
    expect(alertRuleProblems({ ...lowRule, delivery_channel: 'EMAIL' })).toContain('Only IN_APP delivery is built; EMAIL is not sent yet.');
  });
  it('needs hours and a role for ESCALATING (rows 53–54)', () => {
    expect(alertRuleProblems({ ...lowRule, escalation_after_hours: null })).toContain('An ESCALATING rule needs Escalation After Hours of 1 or more.');
    expect(alertRuleProblems({ ...lowRule, escalation_role: null })).toContain('An ESCALATING rule needs an Escalation Recipient Role.');
  });
});
```

`alert-rule.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { AlertRuleService } from './alert-rule.service';

/** "Only one low feed event applies per silo" (Master Setup §4 row 45). */
describe('AlertRuleService', () => {
  const selectQueue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, orderBy: () => self, offset: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const db = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn() };
  const service = new AlertRuleService(transactionCls(db), { log: jest.fn() } as any);

  it('refuses a second active FEED_BELOW_L1 rule for the same company and farm filter', async () => {
    selectQueue.push([{ rule_id: 'existing', notification_code: 'FEED-BELOW-L1' }]); // the clash lookup
    await expect(service.create({
      company_id: 'co-1', notification_code: 'FEED-LOW-2', notification_name: 'Second low rule',
      event_type: 'FEED_BELOW_L1', trigger_entity: 'SILO', threshold_reference: 'SILO_BELOW', priority_level: 'CRITICAL_FIRST_PRIORITY',
      recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE',
    }, 'tenant-1', { userId: 'u' })).rejects.toThrow(ConflictException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `pnpm nx test api -- alert-rule` → FAIL (modules not found).

- [ ] **Step 3: Migration** `0118_alert_rule.sql`:

```sql
-- Alerts and Notifications Master (feed workbook, Master Setup §4; spec Plan
-- B). Columns are §4's fields in order. farm_id NULL is the workbook's
-- "ALL". Checkpoint 10: every threshold, recipient, channel and escalation
-- lives here, not in code.
CREATE TABLE `alert_rule` (
  `rule_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `notification_code` varchar(20) NOT NULL,
  `notification_name` varchar(100) NOT NULL,
  `event_type` varchar(40) NOT NULL,
  `trigger_entity` varchar(20) NOT NULL,
  `threshold_reference` varchar(20) NOT NULL DEFAULT 'FIXED_VALUE',
  `threshold_value` decimal(18,4),
  `priority_level` varchar(30) NOT NULL,
  `recipient_roles` json NOT NULL,
  `delivery_channel` varchar(30) NOT NULL DEFAULT 'IN_APP',
  `frequency` varchar(20) NOT NULL DEFAULT 'ONCE',
  `escalation_after_hours` int,
  `escalation_role` varchar(50),
  `farm_id` varchar(36),
  `is_active` boolean NOT NULL DEFAULT true,
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `alert_rule_rule_id` PRIMARY KEY(`rule_id`),
  CONSTRAINT `uq_alert_rule_code` UNIQUE(`tenant_id`,`company_id`,`notification_code`)
);
--> statement-breakpoint
ALTER TABLE `alert_rule` ADD CONSTRAINT `alert_rule_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `alert_rule` ADD CONSTRAINT `alert_rule_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;
--> statement-breakpoint
-- Seed, per company, the workbook's own rules. FEED-BELOW-L1 is §4 column F
-- verbatim (CRITICAL_FIRST_PRIORITY, FARM_MANAGER, ONCE until resolved and
-- escalate after 4 hours to HEAD_OF_FARM, i.e. ESCALATING). FEED-ABOVE is
-- checkpoint 13 (INFO). DIET-CHANGE is checkpoint 30 (3 days, WARNING).
-- REQ-OVERDUE is §4 row 43's example code with checkpoint 20's Saturday
-- CRITICAL to Farm Manager and Head of Farm; REQ-REMINDER (code and name
-- ours) is its Friday reminder (Q6). The role codes are the workbook's; no
-- tenant has them yet (Q1). Email is not delivered, so IN_APP only (Q12).
INSERT INTO `alert_rule` (`rule_id`,`tenant_id`,`company_id`,`notification_code`,`notification_name`,`event_type`,`trigger_entity`,`threshold_reference`,`threshold_value`,`priority_level`,`recipient_roles`,`delivery_channel`,`frequency`,`escalation_after_hours`,`escalation_role`)
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'FEED-BELOW-L1', 'Low silo feed, first priority', 'FEED_BELOW_L1', 'SILO', 'SILO_BELOW', NULL, 'CRITICAL_FIRST_PRIORITY', JSON_ARRAY('FARM_MANAGER'), 'IN_APP', 'ESCALATING', 4, 'HEAD_OF_FARM' FROM `company_master` c
UNION ALL
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'FEED-ABOVE', 'Silo feed above high level, do not order', 'FEED_ABOVE', 'SILO', 'SILO_ABOVE', NULL, 'INFO', JSON_ARRAY('FARM_MANAGER'), 'IN_APP', 'ONCE', NULL, NULL FROM `company_master` c
UNION ALL
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'DIET-CHANGE', 'Diet change within 3 days', 'DIET_CHANGE', 'FEED_PLAN', 'FIXED_VALUE', 3, 'WARNING', JSON_ARRAY('FARM_MANAGER'), 'IN_APP', 'ONCE', NULL, NULL FROM `company_master` c
UNION ALL
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'REQ-REMINDER', 'Requisition not yet approved', 'REQ_DEADLINE', 'REQUISITION', 'FIXED_VALUE', 1, 'WARNING', JSON_ARRAY('FARM_MANAGER'), 'IN_APP', 'ONCE', NULL, NULL FROM `company_master` c
UNION ALL
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'REQ-OVERDUE', 'Requisition deadline reached', 'REQ_DEADLINE', 'REQUISITION', 'FIXED_VALUE', 0, 'CRITICAL', JSON_ARRAY('FARM_MANAGER','HEAD_OF_FARM'), 'IN_APP', 'ONCE', NULL, NULL FROM `company_master` c;
```

Journal: idx 118, `"when": 1790876400000`, tag `0118_alert_rule`.

- [ ] **Step 4: Schema** (after `notificationLog`):

```ts
/**
 * Alerts and Notifications Master — feed workbook, Master Setup §4, one row
 * per notification rule. farm_id null = "ALL" farms. recipient_roles holds
 * role_master.role_code values as the client writes them (Q1). Plan B
 * evaluates FEED_BELOW_L1, FEED_ABOVE, DIET_CHANGE and REQ_DEADLINE, and
 * delivers IN_APP only.
 */
export const alertRule = mysqlTable('alert_rule', {
  rule_id: varchar('rule_id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  notification_code: varchar('notification_code', { length: 20 }).notNull(),
  notification_name: varchar('notification_name', { length: 100 }).notNull(),
  event_type: varchar('event_type', { length: 40 }).notNull(),
  trigger_entity: varchar('trigger_entity', { length: 20 }).notNull(),
  threshold_reference: varchar('threshold_reference', { length: 20 }).default('FIXED_VALUE').notNull(),
  threshold_value: decimal('threshold_value', { precision: 18, scale: 4 }),
  priority_level: varchar('priority_level', { length: 30 }).notNull(),
  recipient_roles: json('recipient_roles').$type<string[]>().notNull(),
  delivery_channel: varchar('delivery_channel', { length: 30 }).default('IN_APP').notNull(),
  frequency: varchar('frequency', { length: 20 }).default('ONCE').notNull(),
  escalation_after_hours: int('escalation_after_hours'),
  escalation_role: varchar('escalation_role', { length: 50 }),
  farm_id: varchar('farm_id', { length: 36 }).references(() => locationMaster.location_id, { onDelete: 'set null' }),
  is_active: boolean('is_active').default(true).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  created_by: varchar('created_by', { length: 36 }),
  updated_by: varchar('updated_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { mode: 'string' }),
}, (table) => ({
  uqCode: uniqueIndex('uq_alert_rule_code').on(table.tenant_id, table.company_id, table.notification_code),
}));
```

- [ ] **Step 5: Pure rules** — `alert-rule.rules.ts`:

```ts
/**
 * Shape rules of an Alerts and Notifications Master row (feed workbook,
 * Master Setup §4). Pure so the form, the service and the evaluator agree on
 * one list of events and what each may reference.
 */
export const EVENT_TYPES = ['FEED_BELOW_L1', 'FEED_ABOVE', 'DIET_CHANGE', 'REQ_DEADLINE'] as const;
export type AlertEventType = (typeof EVENT_TYPES)[number];

/** §4 row 46: "SILO or REQUISITION or FEED_PLAN or STOCK_TAKE". */
export const TRIGGER_ENTITIES = ['SILO', 'REQUISITION', 'FEED_PLAN', 'STOCK_TAKE'] as const;
export const TRIGGER_FOR_EVENT: Record<AlertEventType, string> = {
  FEED_BELOW_L1: 'SILO',
  FEED_ABOVE: 'SILO',
  DIET_CHANGE: 'FEED_PLAN',
  REQ_DEADLINE: 'REQUISITION',
};

/** §4 row 48. SILO_BELOW reads location_master.low_level_kg, SILO_ABOVE high_level_kg. */
export const THRESHOLD_REFERENCES = ['SILO_BELOW', 'SILO_ABOVE', 'FIXED_VALUE'] as const;
const REFERENCES_FOR_EVENT: Record<AlertEventType, string[]> = {
  FEED_BELOW_L1: ['SILO_BELOW', 'FIXED_VALUE'],
  FEED_ABOVE: ['SILO_ABOVE', 'FIXED_VALUE'],
  DIET_CHANGE: ['FIXED_VALUE'],
  REQ_DEADLINE: ['FIXED_VALUE'],
};

/** §4 row 49. */
export const PRIORITY_LEVELS = ['CRITICAL_FIRST_PRIORITY', 'CRITICAL', 'WARNING', 'INFO'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
/** §4 row 51 lists IN_APP, EMAIL, SMS; Plan B delivers in-app only (Q12). */
export const DELIVERY_CHANNELS = ['IN_APP'] as const;
/** §4 row 52. */
export const FREQUENCIES = ['ONCE', 'DAILY', 'ON_EACH_OCCURRENCE', 'ESCALATING'] as const;
export type AlertFrequency = (typeof FREQUENCIES)[number];

const ROLE_CODE = /^[A-Z][A-Z0-9_]{0,49}$/;

export interface AlertRuleShape {
  event_type: string;
  trigger_entity: string;
  threshold_reference: string;
  threshold_value?: number | null;
  priority_level: string;
  recipient_roles: string[];
  delivery_channel: string;
  frequency: string;
  escalation_after_hours?: number | null;
  escalation_role?: string | null;
}

export function alertRuleProblems(rule: AlertRuleShape): string[] {
  const problems: string[] = [];
  if (!(EVENT_TYPES as readonly string[]).includes(rule.event_type)) {
    problems.push(`Event type ${rule.event_type} is not evaluated yet.`);
    return problems;
  }
  const event = rule.event_type as AlertEventType;
  if (rule.trigger_entity !== TRIGGER_FOR_EVENT[event]) {
    problems.push(`${event} is triggered by ${TRIGGER_FOR_EVENT[event]}, not ${rule.trigger_entity}.`);
  }
  if (!REFERENCES_FOR_EVENT[event].includes(rule.threshold_reference)) {
    problems.push(`${event} takes its threshold from ${REFERENCES_FOR_EVENT[event].join(' or ')}.`);
  }
  if (rule.threshold_reference === 'FIXED_VALUE' && (rule.threshold_value == null || rule.threshold_value < 0)) {
    problems.push('A FIXED_VALUE rule needs a threshold value of 0 or more.');
  }
  if (!(PRIORITY_LEVELS as readonly string[]).includes(rule.priority_level)) {
    problems.push(`Priority ${rule.priority_level} is not one of ${PRIORITY_LEVELS.join(', ')}.`);
  }
  if (!rule.recipient_roles?.length) problems.push('Name at least one recipient role.');
  for (const code of rule.recipient_roles ?? []) {
    if (!ROLE_CODE.test(code)) problems.push(`Role code '${code}' must be upper-case letters, digits and underscores.`);
  }
  if (!(DELIVERY_CHANNELS as readonly string[]).includes(rule.delivery_channel)) {
    problems.push(`Only IN_APP delivery is built; ${rule.delivery_channel} is not sent yet.`);
  }
  if (!(FREQUENCIES as readonly string[]).includes(rule.frequency)) {
    problems.push(`Frequency ${rule.frequency} is not one of ${FREQUENCIES.join(', ')}.`);
  }
  if (rule.frequency === 'ESCALATING') {
    if (rule.escalation_after_hours == null || rule.escalation_after_hours < 1) problems.push('An ESCALATING rule needs Escalation After Hours of 1 or more.');
    if (!rule.escalation_role) problems.push('An ESCALATING rule needs an Escalation Recipient Role.');
    else if (!ROLE_CODE.test(rule.escalation_role)) problems.push(`Role code '${rule.escalation_role}' must be upper-case letters, digits and underscores.`);
  }
  return problems;
}
```

- [ ] **Step 6: DTOs** — `alert-rule.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';
import { DELIVERY_CHANNELS, FREQUENCIES, PRIORITY_LEVELS, THRESHOLD_REFERENCES, TRIGGER_ENTITIES } from './alert-rule.rules';

/** Master Setup §4, one field per row 43–56. Event type is free text here and checked by alertRuleProblems, which names what is supported. */
export class CreateAlertRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() company_id?: string;
  @ApiProperty({ description: 'Row 43, e.g. FEED-BELOW-L1' }) @IsString() @Matches(/^[A-Za-z0-9-]{1,20}$/) notification_code: string;
  @ApiProperty({ description: 'Row 44' }) @IsString() @MaxLength(100) notification_name: string;
  @ApiProperty({ description: 'Row 45' }) @IsString() @MaxLength(40) event_type: string;
  @ApiProperty({ enum: TRIGGER_ENTITIES }) @IsIn(TRIGGER_ENTITIES as unknown as string[]) trigger_entity: string;
  @ApiProperty({ enum: THRESHOLD_REFERENCES }) @IsIn(THRESHOLD_REFERENCES as unknown as string[]) threshold_reference: string;
  @ApiPropertyOptional({ description: 'Row 47: KG for FIXED_VALUE silo rules, days for DIET_CHANGE and REQ_DEADLINE' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) threshold_value?: number | null;
  @ApiProperty({ enum: PRIORITY_LEVELS }) @IsIn(PRIORITY_LEVELS as unknown as string[]) priority_level: string;
  @ApiProperty({ type: [String], description: 'Row 50: role_master.role_code values' })
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v: unknown) => String(v).trim().toUpperCase()).filter(Boolean) : value))
  recipient_roles: string[];
  @ApiProperty({ enum: DELIVERY_CHANNELS }) @IsString() delivery_channel: string;
  @ApiProperty({ enum: FREQUENCIES }) @IsIn(FREQUENCIES as unknown as string[]) frequency: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) escalation_after_hours?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  escalation_role?: string | null;
  @ApiPropertyOptional({ description: 'Row 56: a farm, or blank for ALL' }) @IsOptional() @IsUUID() farm_id?: string | null;
}

export class UpdateAlertRuleDto extends PartialType(CreateAlertRuleDto) {}

export class QueryAlertRuleDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() eventType?: string;
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() isActive?: boolean;
}
```

- [ ] **Step 7: Service** — `alert-rule.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { AuditLogService } from '../audit-log/audit-log.service';
import { alertRuleProblems } from './alert-rule.rules';
import { CreateAlertRuleDto, QueryAlertRuleDto, UpdateAlertRuleDto } from './alert-rule.dto';

const table = schema.alertRule;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * Alerts and Notifications Master CRUD (Master Setup §4). Scoped like every
 * other master (master-data-scope.ts). A rule is never deleted: deactivating
 * it is §4 row 55's "temporary suppression without deleting the rule", and the
 * evaluator then resolves its open alerts (Task 6, reason RULE_OFF).
 */
@Injectable()
export class AlertRuleService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  private scope(tenantId: string) {
    return [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table)];
  }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(table).where(and(eq(table.rule_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Alert rule is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryAlertRuleDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.eventType) conditions.push(eq(table.event_type, query.eventType));
    return this.db.select().from(table).where(and(...conditions)).orderBy(table.notification_code).limit(query.limit || 50).offset(query.offset || 0);
  }

  private assertShape(rule: Parameters<typeof alertRuleProblems>[0]) {
    const problems = alertRuleProblems(rule);
    if (problems.length) throw new BadRequestException(problems.join(' '));
  }

  /** Row 56: a farm filter must be a top-level FARM of the rule's company. */
  private async assertFarm(farmId: string | null | undefined, companyId: string | null | undefined, tenantId: string) {
    if (!farmId) return;
    const [farm] = await this.db.select({ id: schema.locationMaster.location_id }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, farmId), eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.location_type, 'FARM'), isNull(schema.locationMaster.deleted_at),
      ...(companyId ? [eq(schema.locationMaster.company_id, companyId)] : []),
    )).limit(1);
    if (!farm) throw new BadRequestException('Farm Filter must be a farm of this company.');
  }

  /** Row 45: "Only one low feed event applies per silo" — one active FEED_BELOW_L1 rule per company and farm filter. */
  private async assertSingleLowRule(rule: { event_type: string; company_id: string | null; farm_id: string | null; is_active: boolean }, tenantId: string, excludeId?: string) {
    if (rule.event_type !== 'FEED_BELOW_L1' || !rule.is_active) return;
    const [clash] = await this.db.select({ rule_id: table.rule_id, notification_code: table.notification_code }).from(table).where(and(
      eq(table.tenant_id, tenantId), eq(table.event_type, 'FEED_BELOW_L1'), eq(table.is_active, true),
      rule.company_id ? eq(table.company_id, rule.company_id) : isNull(table.company_id),
      rule.farm_id ? or(eq(table.farm_id, rule.farm_id), isNull(table.farm_id))! : isNull(table.farm_id),
      ...(excludeId ? [ne(table.rule_id, excludeId)] : []),
    )).limit(1);
    if (clash) throw new ConflictException(`Only one low feed rule applies per silo; ${clash.notification_code} already covers these farms.`);
  }

  private async log(action: string, row: typeof table.$inferSelect, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'alert_rule', entityId: row.rule_id, oldValues, newValues: row });
    return row;
  }

  async create(dto: CreateAlertRuleDto, tenantId: string, user?: any) {
    const code = dto.notification_code.trim().toUpperCase();
    this.assertShape({ ...dto, recipient_roles: dto.recipient_roles ?? [] });
    await this.assertSingleLowRule({ event_type: dto.event_type, company_id: dto.company_id ?? null, farm_id: dto.farm_id ?? null, is_active: true }, tenantId);
    await this.assertFarm(dto.farm_id, dto.company_id, tenantId);
    const rule_id = randomUUID();
    await this.db.insert(table).values({
      rule_id, tenant_id: tenantId, company_id: dto.company_id ?? null, notification_code: code,
      notification_name: dto.notification_name.trim(), event_type: dto.event_type, trigger_entity: dto.trigger_entity,
      threshold_reference: dto.threshold_reference, threshold_value: dto.threshold_value == null ? null : String(dto.threshold_value),
      priority_level: dto.priority_level, recipient_roles: dto.recipient_roles, delivery_channel: dto.delivery_channel,
      frequency: dto.frequency, escalation_after_hours: dto.escalation_after_hours ?? null, escalation_role: dto.escalation_role ?? null,
      farm_id: dto.farm_id ?? null, created_by: user?.userId, updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(rule_id, tenantId), user);
  }

  async update(id: string, dto: UpdateAlertRuleDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.notification_code !== undefined && dto.notification_code.trim().toUpperCase() !== before.notification_code) {
      throw new BadRequestException('Notification codes cannot be renamed. Deactivate the rule and create a new one.');
    }
    const merged = {
      event_type: dto.event_type ?? before.event_type,
      trigger_entity: dto.trigger_entity ?? before.trigger_entity,
      threshold_reference: dto.threshold_reference ?? before.threshold_reference,
      threshold_value: dto.threshold_value !== undefined ? dto.threshold_value : before.threshold_value == null ? null : Number(before.threshold_value),
      priority_level: dto.priority_level ?? before.priority_level,
      recipient_roles: dto.recipient_roles ?? (before.recipient_roles as string[]),
      delivery_channel: dto.delivery_channel ?? before.delivery_channel,
      frequency: dto.frequency ?? before.frequency,
      escalation_after_hours: dto.escalation_after_hours !== undefined ? dto.escalation_after_hours : before.escalation_after_hours,
      escalation_role: dto.escalation_role !== undefined ? dto.escalation_role : before.escalation_role,
      farm_id: dto.farm_id !== undefined ? dto.farm_id : before.farm_id,
    };
    this.assertShape(merged);
    await this.assertSingleLowRule({ event_type: merged.event_type, company_id: before.company_id, farm_id: merged.farm_id ?? null, is_active: before.is_active }, tenantId, id);
    await this.assertFarm(merged.farm_id, before.company_id, tenantId);
    await this.db.update(table).set({
      notification_name: dto.notification_name?.trim() ?? before.notification_name,
      ...merged,
      threshold_value: merged.threshold_value == null ? null : String(merged.threshold_value),
      farm_id: merged.farm_id ?? null,
      updated_by: user?.userId, updated_at: nowTs(),
    }).where(and(eq(table.rule_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (active) await this.assertSingleLowRule({ event_type: before.event_type, company_id: before.company_id, farm_id: before.farm_id, is_active: true }, tenantId, id);
    const now = nowTs();
    await this.db.update(table).set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : now, updated_at: now, updated_by: user?.userId })
      .where(and(eq(table.rule_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}
```

- [ ] **Step 8: Controller and module**

`alert-rule.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { AlertRuleService } from './alert-rule.service';
import { CreateAlertRuleDto, QueryAlertRuleDto, UpdateAlertRuleDto } from './alert-rule.dto';

// A company master (Master Setup §4). A rule's farm_id is a filter on which
// farms it applies to, not an access boundary — exempt from farm scope.
@ApiTags('Alerts and Notifications Master') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alert-rule')
export class AlertRuleController {
  constructor(private readonly rules: AlertRuleService) {}
  @Get() @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'view')
  async list(@Query() query: QueryAlertRuleDto, @Req() req: any) { return { data: await this.rules.findAll(query, req.user.tenantId) }; }
  @Get(':id') @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.findOne(id, req.user.tenantId) }; }
  @Post() @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'create')
  async create(@Body() dto: CreateAlertRuleDto, @Req() req: any) { return { data: await this.rules.create(dto, req.user.tenantId, req.user) }; }
  @Put(':id') @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateAlertRuleDto, @Req() req: any) { return { data: await this.rules.update(id, dto, req.user.tenantId, req.user) }; }
  @Delete(':id') @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.setActive(id, false, req.user.tenantId, req.user) }; }
  @Patch(':id/restore') @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.setActive(id, true, req.user.tenantId, req.user) }; }
}
```

`alert-rule.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AlertRuleController } from './alert-rule.controller';
import { AlertRuleService } from './alert-rule.service';

@Module({ controllers: [AlertRuleController], providers: [AlertRuleService], exports: [AlertRuleService] })
export class AlertRuleModule {}
```

Register `AlertRuleModule` in `app.module.ts` (import + `imports` array next to `ReasonModule`). In `master-data-scope.ts` `MASTER_TABLES` add `'alert-rule': schema.alertRule,` after `reason`. In `farm-scope-coverage.spec.ts` `EXEMPT`, in the `// system` group:

```ts
  'system/alert-rule/alert-rule.controller.ts': 'Company master (Alerts and Notifications Master); a rule\'s farm_id filters where it applies, it is not an access boundary.',
```

- [ ] **Step 9: Roles tab and translations** — in `roles-tab.tsx` under `// NOTIFICATION`:

```ts
  { module_code: "NOTIFICATION", resource: "ALERT_RULE", name: "Alerts and Notifications Master", nameKey: "rolAlertRules" },
```

and in `translations.ts` `en`, next to `rolNotificationGateway`: `rolAlertRules: "Alerts and Notifications Master",`.

- [ ] **Step 10: Web master** — in `configs.ts`, after the `reason` config:

```ts
// Alerts and Notifications Master — feed workbook, Master Setup §4, fields in
// the workbook's order. Recipient roles are role codes typed as chips (Q1: the
// workbook's FARM_MANAGER / HEAD_OF_FARM exist in no tenant yet, so a picker
// over role_master could not even offer them).
const alertRule: MasterDataConfig = {
  key: "alert-rule", label: "Alert Rules", singular: "Alert Rule", apiBase: "/alert-rule", idKey: "rule_id",
  group: "Inventory", businessAdminOnly: true,
  description: "Alerts and Notifications Master: which event raises an in-app alert, at what threshold, how urgently, for which roles, how often, and to whom it escalates.",
  columns: [
    { key: "notification_code", label: "Notification Code" }, { key: "notification_name", label: "Notification Name" },
    { key: "event_type", label: "Event Type" }, { key: "priority_level", label: "Priority Level" },
    { key: "recipient_roles", label: "Recipient Role(s)" }, { key: "frequency", label: "Frequency" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "notification_code", label: "Notification Code", type: "text", required: true, createOnly: true, maxLength: 20 },
    { key: "notification_name", label: "Notification Name", type: "text", required: true, maxLength: 100 },
    { key: "event_type", label: "Event Type", type: "select", required: true,
      options: ["FEED_BELOW_L1", "FEED_ABOVE", "DIET_CHANGE", "REQ_DEADLINE"].map((value) => ({ value, label: value })) },
    { key: "trigger_entity", label: "Trigger Entity", type: "select", required: true,
      options: ["SILO", "REQUISITION", "FEED_PLAN", "STOCK_TAKE"].map((value) => ({ value, label: value })),
      helpText: "FEED_BELOW_L1 and FEED_ABOVE: SILO. DIET_CHANGE: FEED_PLAN. REQ_DEADLINE: REQUISITION." },
    { key: "threshold_reference", label: "Threshold Reference", type: "select", required: true,
      options: ["SILO_BELOW", "SILO_ABOVE", "FIXED_VALUE"].map((value) => ({ value, label: value })),
      helpText: "SILO_BELOW reads each silo's Below Feed Level, SILO_ABOVE its Above Threshold. FIXED_VALUE uses the value below." },
    { key: "threshold_value", label: "Threshold Value", type: "number", min: 0, nativeNumber: true,
      requiredWhen: { anyOf: [{ key: "threshold_reference", equals: "FIXED_VALUE" }] },
      helpText: "KG for a silo rule; days before the diet change for DIET_CHANGE; days before the submission deadline for REQ_DEADLINE." },
    { key: "priority_level", label: "Priority Level", type: "select", required: true,
      options: ["CRITICAL_FIRST_PRIORITY", "CRITICAL", "WARNING", "INFO"].map((value) => ({ value, label: value })) },
    { key: "recipient_roles", label: "Recipient Role(s)", type: "string-list", required: true,
      helpText: "Role codes from Role Master. Tenant, company and operational admins see every alert regardless." },
    { key: "delivery_channel", label: "Delivery Channel", type: "select", required: true,
      options: [{ value: "IN_APP", label: "IN_APP" }], helpText: "In-app only for now; email is not sent yet." },
    { key: "frequency", label: "Frequency", type: "select", required: true,
      options: ["ONCE", "DAILY", "ON_EACH_OCCURRENCE", "ESCALATING"].map((value) => ({ value, label: value })),
      helpText: "ONCE until resolved; DAILY re-alerts each day; ON_EACH_OCCURRENCE re-alerts when the value changes; ESCALATING adds the escalation role if nobody acknowledges in time." },
    { key: "escalation_after_hours", label: "Escalation After Hours", type: "number", min: 1, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "frequency", equals: "ESCALATING" }] }, requiredWhen: { anyOf: [{ key: "frequency", equals: "ESCALATING" }] } },
    { key: "escalation_role", label: "Escalation Recipient Role", type: "text", maxLength: 50,
      visibleWhen: { anyOf: [{ key: "frequency", equals: "ESCALATING" }] }, requiredWhen: { anyOf: [{ key: "frequency", equals: "ESCALATING" }] } },
    { key: "farm_id", label: "Farm Filter", type: "select-entity", entityEndpoint: "/location?locationType=FARM&rootOnly=true",
      entityValueKey: "location_id", entityLabelKeys: ["location_code", "location_name"], helpText: "Leave blank for ALL farms." },
  ],
};
```

Add `alertRule` to `MASTER_DATA_CONFIGS` right after `reason`, and `"alert-rule": "Alert Rule",` to `EXPECTED` in `apps/web/specs/master-data-singular-label.spec.ts`.

- [ ] **Step 11: Run** `pnpm nx test api -- alert-rule farm-scope-coverage` → PASS; `pnpm nx test web -- role-permissions-coverage master-data-singular-label` → PASS; typecheck `api,web` → PASS; web lint error count unchanged.

- [ ] **Step 12: Apply and read back** — `pnpm nx run api:db-migrate-all-tenants`, then
`mysql … -e "SELECT notification_code, event_type, threshold_reference, threshold_value, priority_level, recipient_roles, frequency, escalation_after_hours, escalation_role FROM nf_devco.alert_rule ORDER BY company_id, notification_code;"`
Expected: five rows per company with the values of the migration.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/drizzle/tenant/0118_alert_rule.sql apps/api/src/drizzle/tenant/meta/_journal.json apps/api/src/core/database/schema.ts apps/api/src/modules/system/alert-rule apps/api/src/app.module.ts apps/api/src/common/master-data-scope.ts apps/api/src/common/farm-scope-coverage.spec.ts apps/web/src/components/console/console-tabs/roles-tab.tsx apps/web/src/utils/translations.ts apps/web/src/modules/master-data/configs.ts apps/web/specs/master-data-singular-label.spec.ts
git commit -m "feat(alerts): Alerts and Notifications Master with the workbook's feed rules

Master Setup §4's fields as a company master; checkpoint 10 forbids
hardcoded notification logic, so FEED-BELOW-L1, FEED-ABOVE, DIET-CHANGE and
the two requisition-deadline rules are seeded rows with the workbook's
values. In-app only; recipient role codes as the workbook writes them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Alert planning (pure)

One pure function decides, from the rules, the current facts and the alerts already open, what to raise, re-notify, escalate and resolve. Checkpoint 11: "Issue first priority NAVFarm alert when System Balance for the silo and item is at or below its single configured Below Feed Level KG. Deduplicate until recovery." Checkpoint 12: "When posted System Balance rises above the configured low threshold, resolve the active low feed alert. Issue a new alert only after a later downward crossing or configured repeat interval." Checkpoint 13: "INFO notification when System Balance is greater than or equal to Above Threshold KG." Checkpoint 30: diet change "3 days before current feed period ends … next diet item, days remaining, silo status for next diet." Checkpoint 20: reminders while a requisition is unapproved.

**Files:**
- Create: `apps/api/src/modules/inventory/feed-alert/feed-alert.rules.ts`
- Test: `apps/api/src/modules/inventory/feed-alert/feed-alert.rules.spec.ts`

**Interfaces:**
- Consumes: `DietChange` (Task 2); `AlertEventType`, `AlertFrequency`, `PriorityLevel` (Task 5).
- Produces:

```ts
export interface AlertRuleFact {
  ruleId: string; notificationCode: string; eventType: string; thresholdReference: string; thresholdValue: number | null;
  priorityLevel: PriorityLevel; recipientRoles: string[]; frequency: AlertFrequency; escalationAfterHours: number | null;
  escalationRole: string | null; farmId: string | null; isActive: boolean;
}
export interface SiloLevelFact { siloId: string; siloCode: string; itemId: string | null; itemName: string | null; balanceKg: number; lowLevelKg: number | null; highLevelKg: number | null }
export interface OpenRequisitionFact { requisitionId: string; reqNo: string; status: string; submissionDeadline: string }
export interface ActiveAlertFact { alertId: string; ruleId: string; eventType: string; subjectType: 'SILO' | 'BATCH' | 'REQUISITION'; dedupKey: string; raisedAtMs: number; lastNotifiedDay: string; acknowledged: boolean; escalated: boolean; observedValue: number | null }
export interface AlertCandidate { rule: AlertRuleFact; dedupKey: string; subjectType: 'SILO' | 'BATCH' | 'REQUISITION'; subjectId: string; itemId: string | null; title: string; message: string; observedValue: number | null; thresholdValue: number | null }
export type ResolveReason = 'RECOVERED' | 'PASSED' | 'CLOSED' | 'RULE_OFF';
export interface AlertPlan {
  raise: AlertCandidate[];
  renotify: { alertId: string; observedValue: number | null }[];
  escalate: { alertId: string; role: string }[];
  resolve: { alertId: string; reason: ResolveReason }[];
}
export interface PlanAlertsInput { today: string; nowMs: number; farmId: string; rules: AlertRuleFact[]; silos: SiloLevelFact[]; dietChanges: DietChange[]; requisitions: OpenRequisitionFact[]; active: ActiveAlertFact[]; levelsOnly: boolean }
export function planAlerts(input: PlanAlertsInput): AlertPlan;
export const SILO_EVENTS: readonly string[]; // ['FEED_BELOW_L1', 'FEED_ABOVE']
```

- [ ] **Step 1: Write the failing tests** — `feed-alert.rules.spec.ts`:

```ts
import { ActiveAlertFact, AlertRuleFact, PlanAlertsInput, SiloLevelFact, planAlerts } from './feed-alert.rules';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

const lowRule: AlertRuleFact = {
  ruleId: 'rule-low', notificationCode: 'FEED-BELOW-L1', eventType: 'FEED_BELOW_L1', thresholdReference: 'SILO_BELOW', thresholdValue: null,
  priorityLevel: 'CRITICAL_FIRST_PRIORITY', recipientRoles: ['FARM_MANAGER'], frequency: 'ESCALATING', escalationAfterHours: 4,
  escalationRole: 'HEAD_OF_FARM', farmId: null, isActive: true,
};
const aboveRule: AlertRuleFact = { ...lowRule, ruleId: 'rule-above', notificationCode: 'FEED-ABOVE', eventType: 'FEED_ABOVE', thresholdReference: 'SILO_ABOVE', priorityLevel: 'INFO', frequency: 'ONCE', escalationAfterHours: null, escalationRole: null };
const dietRule: AlertRuleFact = { ...aboveRule, ruleId: 'rule-diet', notificationCode: 'DIET-CHANGE', eventType: 'DIET_CHANGE', thresholdReference: 'FIXED_VALUE', thresholdValue: 3, priorityLevel: 'WARNING' };
const reminderRule: AlertRuleFact = { ...aboveRule, ruleId: 'rule-remind', notificationCode: 'REQ-REMINDER', eventType: 'REQ_DEADLINE', thresholdReference: 'FIXED_VALUE', thresholdValue: 1, priorityLevel: 'WARNING' };
const overdueRule: AlertRuleFact = { ...reminderRule, ruleId: 'rule-overdue', notificationCode: 'REQ-OVERDUE', thresholdValue: 0, priorityLevel: 'CRITICAL', recipientRoles: ['FARM_MANAGER', 'HEAD_OF_FARM'] };

// Master Setup §1 column F: SILO1 low 1,000 KG, high 10,800 KG, capacity 12,000.
const silo1 = (balanceKg: number, extra: Partial<SiloLevelFact> = {}): SiloLevelFact => ({
  siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', itemName: 'Weaner Diet R1', balanceKg, lowLevelKg: 1000, highLevelKg: 10800, ...extra,
});
const active = (extra: Partial<ActiveAlertFact>): ActiveAlertFact => ({
  alertId: 'a1', ruleId: 'rule-low', eventType: 'FEED_BELOW_L1', subjectType: 'SILO', dedupKey: 'rule-low|s1',
  raisedAtMs: NOW - HOUR, lastNotifiedDay: '2026-09-23', acknowledged: false, escalated: false, observedValue: 900, ...extra,
});
const base = (over: Partial<PlanAlertsInput>): PlanAlertsInput => ({
  today: '2026-09-23', nowMs: NOW, farmId: 'farm-grs', rules: [lowRule, aboveRule], silos: [], dietChanges: [],
  requisitions: [], active: [], levelsOnly: false, ...over,
});

describe('planAlerts — silo levels (checkpoints 11–13)', () => {
  it('raises FEED_BELOW_L1 at exactly the low level', () => {
    const plan = planAlerts(base({ silos: [silo1(1000)] }));
    expect(plan.raise).toHaveLength(1);
    expect(plan.raise[0]).toMatchObject({ dedupKey: 'rule-low|s1', subjectType: 'SILO', subjectId: 's1', itemId: 'r1', observedValue: 1000, thresholdValue: 1000 });
    expect(plan.raise[0].title).toBe('Low feed: GRS/SILO-001');
    expect(plan.raise[0].message).toBe('GRS/SILO-001 holds 1,000 kg of Weaner Diet R1 — at or below its low level of 1,000 kg.');
  });

  it('does not raise a second alert while one is active (deduplicate until recovery)', () => {
    const plan = planAlerts(base({ silos: [silo1(900)], active: [active({})] }));
    expect(plan).toEqual({ raise: [], renotify: [], escalate: [], resolve: [] });
  });

  it('resolves when the balance rises above the low level — 900 → 6,900 kg after a 6,000 kg receipt', () => {
    const plan = planAlerts(base({ silos: [silo1(6900)], active: [active({})] }));
    expect(plan.resolve).toEqual([{ alertId: 'a1', reason: 'RECOVERED' }]);
    expect(plan.raise).toEqual([]);
  });

  it('re-arms: after recovery a later downward crossing raises a new alert', () => {
    expect(planAlerts(base({ silos: [silo1(800)], active: [] })).raise).toHaveLength(1);
  });

  it('raises FEED_ABOVE at or above the high level, as INFO', () => {
    const plan = planAlerts(base({ silos: [silo1(10800)] }));
    expect(plan.raise.map((c) => c.rule.notificationCode)).toEqual(['FEED-ABOVE']);
    expect(plan.raise[0].message).toContain('Do not order.');
  });

  it('skips a silo without a level for SILO_BELOW, and uses a FIXED_VALUE instead when the rule says so', () => {
    expect(planAlerts(base({ silos: [silo1(10, { lowLevelKg: null })] })).raise).toEqual([]);
    const fixed = { ...lowRule, thresholdReference: 'FIXED_VALUE', thresholdValue: 500 };
    expect(planAlerts(base({ rules: [fixed], silos: [silo1(500, { lowLevelKg: null })] })).raise[0].thresholdValue).toBe(500);
  });

  it('alerts an empty silo with a low level set (Q7)', () => {
    const plan = planAlerts(base({ silos: [silo1(0, { itemId: null, itemName: null })] }));
    expect(plan.raise[0].message).toBe('GRS/SILO-001 holds 0 kg of no feed — at or below its low level of 1,000 kg.');
  });

  it('honours the farm filter and resolves the alerts of a deactivated rule', () => {
    expect(planAlerts(base({ rules: [{ ...lowRule, farmId: 'farm-other' }], silos: [silo1(10)] })).raise).toEqual([]);
    const plan = planAlerts(base({ rules: [{ ...lowRule, isActive: false }], silos: [silo1(10)], active: [active({})] }));
    expect(plan.resolve).toEqual([{ alertId: 'a1', reason: 'RULE_OFF' }]);
  });
});

describe('planAlerts — frequency (Master Setup §4 rows 52–54)', () => {
  it('ESCALATING: escalates to HEAD_OF_FARM once 4 hours pass unacknowledged', () => {
    expect(planAlerts(base({ silos: [silo1(900)], active: [active({ raisedAtMs: NOW - 4 * HOUR })] })).escalate)
      .toEqual([{ alertId: 'a1', role: 'HEAD_OF_FARM' }]);
    expect(planAlerts(base({ silos: [silo1(900)], active: [active({ raisedAtMs: NOW - 3 * HOUR })] })).escalate).toEqual([]);
    expect(planAlerts(base({ silos: [silo1(900)], active: [active({ raisedAtMs: NOW - 5 * HOUR, acknowledged: true })] })).escalate).toEqual([]);
    expect(planAlerts(base({ silos: [silo1(900)], active: [active({ raisedAtMs: NOW - 5 * HOUR, escalated: true })] })).escalate).toEqual([]);
  });

  it('DAILY: re-notifies once a day while the condition holds', () => {
    const daily = { ...lowRule, frequency: 'DAILY' as const };
    expect(planAlerts(base({ rules: [daily], silos: [silo1(900)], active: [active({ lastNotifiedDay: '2026-09-22' })] })).renotify)
      .toEqual([{ alertId: 'a1', observedValue: 900 }]);
    expect(planAlerts(base({ rules: [daily], silos: [silo1(900)], active: [active({})] })).renotify).toEqual([]);
  });

  it('ON_EACH_OCCURRENCE: re-notifies when the observed value changes', () => {
    const each = { ...lowRule, frequency: 'ON_EACH_OCCURRENCE' as const };
    expect(planAlerts(base({ rules: [each], silos: [silo1(700)], active: [active({ observedValue: 900 })] })).renotify)
      .toEqual([{ alertId: 'a1', observedValue: 700 }]);
    expect(planAlerts(base({ rules: [each], silos: [silo1(900)], active: [active({ observedValue: 900 })] })).renotify).toEqual([]);
  });
});

describe('planAlerts — diet change (checkpoint 30)', () => {
  const change = {
    batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', fromItemId: 'r1', fromItemName: 'Weaner Diet R1',
    toItemId: 'r2', toItemName: 'Weaner Diet R2', changeDate: '2026-09-26', nextSourceType: 'SILO' as const, nextSourceCode: 'GRS/SILO-002',
  };

  it('warns 3 days before, naming the next diet, the days left and its silo', () => {
    const plan = planAlerts(base({ rules: [dietRule], dietChanges: [change] }));
    expect(plan.raise).toHaveLength(1);
    expect(plan.raise[0]).toMatchObject({ subjectType: 'BATCH', subjectId: 'b', itemId: 'r2', observedValue: 3, dedupKey: 'rule-diet|b|r2|2026-09-26' });
    expect(plan.raise[0].message).toBe('WG-2026-38 in GRS/SHED-003 moves from Weaner Diet R1 to Weaner Diet R2 on 2026-09-26, in 3 days. Silo for the next diet: GRS/SILO-002.');
  });

  it('says so when no silo holds the next diet', () => {
    const plan = planAlerts(base({ rules: [dietRule], dietChanges: [{ ...change, nextSourceType: 'STORE', nextSourceCode: null }] }));
    expect(plan.raise[0].message).toContain('Silo for the next diet: none holds it yet.');
  });

  it('stays quiet 4 days out and resolves once the change has passed', () => {
    expect(planAlerts(base({ rules: [dietRule], dietChanges: [{ ...change, changeDate: '2026-09-27' }] })).raise).toEqual([]);
    const passed = active({ alertId: 'd1', ruleId: 'rule-diet', eventType: 'DIET_CHANGE', subjectType: 'BATCH', dedupKey: 'rule-diet|b|r2|2026-09-22' });
    expect(planAlerts(base({ rules: [dietRule], active: [passed] })).resolve).toEqual([{ alertId: 'd1', reason: 'PASSED' }]);
  });
});

describe('planAlerts — requisition deadline (checkpoint 20)', () => {
  const draft = { requisitionId: 'req-1', reqNo: 'REQ-GRS-2026-00041', status: 'AUTO_DRAFT', submissionDeadline: '2026-09-26' };

  it('Friday reminder one day before, Saturday CRITICAL on the day', () => {
    const friday = planAlerts(base({ today: '2026-09-25', rules: [reminderRule, overdueRule], requisitions: [draft] }));
    expect(friday.raise.map((c) => c.rule.notificationCode)).toEqual(['REQ-REMINDER']);
    expect(friday.raise[0].message).toBe('REQ-GRS-2026-00041 is AUTO_DRAFT; the submission deadline is 2026-09-26, 1 day left.');
    const saturday = planAlerts(base({ today: '2026-09-26', rules: [reminderRule, overdueRule], requisitions: [draft] }));
    expect(saturday.raise.map((c) => c.rule.notificationCode).sort()).toEqual(['REQ-OVERDUE', 'REQ-REMINDER']);
  });

  it('says nothing on Thursday, and closes the alert once the requisition is approved', () => {
    expect(planAlerts(base({ today: '2026-09-24', rules: [reminderRule], requisitions: [draft] })).raise).toEqual([]);
    const open = active({ alertId: 'q1', ruleId: 'rule-remind', eventType: 'REQ_DEADLINE', subjectType: 'REQUISITION', dedupKey: 'rule-remind|req-1' });
    expect(planAlerts(base({ today: '2026-09-25', rules: [reminderRule], requisitions: [], active: [open] })).resolve)
      .toEqual([{ alertId: 'q1', reason: 'CLOSED' }]);
  });
});

describe('planAlerts — levelsOnly (evaluation after a stock posting)', () => {
  it('evaluates silo rules only and leaves other open alerts alone', () => {
    const openDiet = active({ alertId: 'd1', ruleId: 'rule-diet', eventType: 'DIET_CHANGE', subjectType: 'BATCH', dedupKey: 'rule-diet|b|r2|2026-09-26' });
    const plan = planAlerts(base({ levelsOnly: true, rules: [lowRule, dietRule], silos: [silo1(900)], active: [openDiet] }));
    expect(plan.raise.map((c) => c.rule.eventType)).toEqual(['FEED_BELOW_L1']);
    expect(plan.resolve).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `pnpm nx test api -- feed-alert.rules` → FAIL (module not found).

- [ ] **Step 3: Implement** `feed-alert.rules.ts`:

```ts
/**
 * Feed alert planning — pure (Feed Forecast Plan B). Given the Alerts and
 * Notifications Master rows that apply to one farm, today's facts (silo
 * balances, diet changes, open feed requisitions) and the alerts already
 * open, return what to raise, re-notify, escalate and resolve. The service
 * (Task 7) only loads facts and writes this plan, so every checkpoint below
 * is pinned by a unit test:
 * - 11: FEED_BELOW_L1 at or below the single low level; one open alert per
 *   rule and silo until recovery ("Only one low feed event applies per silo").
 * - 12: rising above resolves it (RECOVERED); a later fall raises a new one.
 * - 13: FEED_ABOVE at or above the high level, INFO.
 * - 30: DIET_CHANGE within the rule's days before a batch's next diet.
 * - 20: REQ_DEADLINE within the rule's days before (and after) the
 *   submission deadline while the requisition is unapproved.
 * Frequencies (§4 rows 52–54): ONCE until resolved; DAILY re-notifies on a
 * new day; ON_EACH_OCCURRENCE re-notifies when the observed value changes
 * (a new posting moved the balance); ESCALATING adds the escalation role
 * once, when unacknowledged for Escalation After Hours.
 */
import type { DietChange } from '../feed-forecast/feed-forecast.engine';
import type { AlertFrequency, PriorityLevel } from '../../system/alert-rule/alert-rule.rules';

export const SILO_EVENTS: readonly string[] = ['FEED_BELOW_L1', 'FEED_ABOVE'];

export interface AlertRuleFact {
  ruleId: string;
  notificationCode: string;
  eventType: string;
  thresholdReference: string;
  thresholdValue: number | null;
  priorityLevel: PriorityLevel;
  recipientRoles: string[];
  frequency: AlertFrequency;
  escalationAfterHours: number | null;
  escalationRole: string | null;
  farmId: string | null;
  isActive: boolean;
}

export interface SiloLevelFact {
  siloId: string;
  siloCode: string;
  itemId: string | null;
  itemName: string | null;
  balanceKg: number;
  lowLevelKg: number | null;
  highLevelKg: number | null;
}

export interface OpenRequisitionFact {
  requisitionId: string;
  reqNo: string;
  status: string;
  submissionDeadline: string;
}

export interface ActiveAlertFact {
  alertId: string;
  ruleId: string;
  eventType: string;
  subjectType: 'SILO' | 'BATCH' | 'REQUISITION';
  dedupKey: string;
  raisedAtMs: number;
  lastNotifiedDay: string;
  acknowledged: boolean;
  escalated: boolean;
  observedValue: number | null;
}

export interface AlertCandidate {
  rule: AlertRuleFact;
  dedupKey: string;
  subjectType: 'SILO' | 'BATCH' | 'REQUISITION';
  subjectId: string;
  itemId: string | null;
  title: string;
  message: string;
  observedValue: number | null;
  thresholdValue: number | null;
}

export type ResolveReason = 'RECOVERED' | 'PASSED' | 'CLOSED' | 'RULE_OFF';

export interface AlertPlan {
  raise: AlertCandidate[];
  renotify: { alertId: string; observedValue: number | null }[];
  escalate: { alertId: string; role: string }[];
  resolve: { alertId: string; reason: ResolveReason }[];
}

export interface PlanAlertsInput {
  today: string;
  nowMs: number;
  farmId: string;
  rules: AlertRuleFact[];
  silos: SiloLevelFact[];
  dietChanges: DietChange[];
  requisitions: OpenRequisitionFact[];
  active: ActiveAlertFact[];
  levelsOnly: boolean;
}

const REASON_BY_EVENT: Record<string, ResolveReason> = {
  FEED_BELOW_L1: 'RECOVERED',
  FEED_ABOVE: 'RECOVERED',
  DIET_CHANGE: 'PASSED',
  REQ_DEADLINE: 'CLOSED',
};

function diffDays(a: string, b: string): number {
  const p = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

function siloThreshold(rule: AlertRuleFact, silo: SiloLevelFact): number | null {
  if (rule.thresholdReference === 'FIXED_VALUE') return rule.thresholdValue;
  if (rule.eventType === 'FEED_BELOW_L1' && rule.thresholdReference === 'SILO_BELOW') return silo.lowLevelKg;
  if (rule.eventType === 'FEED_ABOVE' && rule.thresholdReference === 'SILO_ABOVE') return silo.highLevelKg;
  return null;
}

function candidatesFor(rule: AlertRuleFact, input: PlanAlertsInput): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  if (rule.eventType === 'FEED_BELOW_L1' || rule.eventType === 'FEED_ABOVE') {
    const low = rule.eventType === 'FEED_BELOW_L1';
    for (const silo of input.silos) {
      const threshold = siloThreshold(rule, silo);
      if (threshold === null) continue;
      if (low ? silo.balanceKg > threshold : silo.balanceKg < threshold) continue;
      const what = silo.itemName ?? 'no feed';
      out.push({
        rule, dedupKey: `${rule.ruleId}|${silo.siloId}`, subjectType: 'SILO', subjectId: silo.siloId, itemId: silo.itemId,
        title: low ? `Low feed: ${silo.siloCode}` : `Over-stock: ${silo.siloCode}`,
        message: low
          ? `${silo.siloCode} holds ${kg(silo.balanceKg)} kg of ${what} — at or below its low level of ${kg(threshold)} kg.`
          : `${silo.siloCode} holds ${kg(silo.balanceKg)} kg of ${what} — at or above its high level of ${kg(threshold)} kg. Do not order.`,
        observedValue: silo.balanceKg, thresholdValue: threshold,
      });
    }
  } else if (rule.eventType === 'DIET_CHANGE') {
    const window = rule.thresholdValue ?? 3;
    for (const dc of input.dietChanges) {
      const left = diffDays(input.today, dc.changeDate);
      if (left < 0 || left > window) continue;
      const silo = dc.nextSourceType === 'SILO' && dc.nextSourceCode ? dc.nextSourceCode : 'none holds it yet';
      out.push({
        rule, dedupKey: `${rule.ruleId}|${dc.batchId}|${dc.toItemId}|${dc.changeDate}`, subjectType: 'BATCH', subjectId: dc.batchId, itemId: dc.toItemId,
        title: `Diet change in ${days(left)}: ${dc.batchNo}`,
        message: `${dc.batchNo} in ${dc.shedCode} moves from ${dc.fromItemName} to ${dc.toItemName} on ${dc.changeDate}, in ${days(left)}. Silo for the next diet: ${silo}.`,
        observedValue: left, thresholdValue: window,
      });
    }
  } else if (rule.eventType === 'REQ_DEADLINE') {
    const window = rule.thresholdValue ?? 0;
    for (const req of input.requisitions) {
      const left = diffDays(input.today, req.submissionDeadline);
      if (left > window) continue;
      const when = left >= 0 ? `${days(left)} left` : `${days(-left)} past`;
      out.push({
        rule, dedupKey: `${rule.ruleId}|${req.requisitionId}`, subjectType: 'REQUISITION', subjectId: req.requisitionId, itemId: null,
        title: `Requisition ${req.reqNo} not approved`,
        message: `${req.reqNo} is ${req.status}; the submission deadline is ${req.submissionDeadline}, ${when}.`,
        observedValue: left, thresholdValue: window,
      });
    }
  }
  return out;
}

export function planAlerts(input: PlanAlertsInput): AlertPlan {
  const plan: AlertPlan = { raise: [], renotify: [], escalate: [], resolve: [] };
  const rules = input.rules.filter(
    (r) => r.isActive && (r.farmId === null || r.farmId === input.farmId) && (!input.levelsOnly || SILO_EVENTS.includes(r.eventType)),
  );
  const activeByKey = new Map(input.active.map((a) => [a.dedupKey, a]));
  const wanted = new Set<string>();

  for (const rule of rules) {
    for (const c of candidatesFor(rule, input)) {
      if (wanted.has(c.dedupKey)) continue;
      wanted.add(c.dedupKey);
      const open = activeByKey.get(c.dedupKey);
      if (!open) {
        plan.raise.push(c);
        continue;
      }
      if (rule.frequency === 'DAILY' && open.lastNotifiedDay < input.today) {
        plan.renotify.push({ alertId: open.alertId, observedValue: c.observedValue });
      } else if (rule.frequency === 'ON_EACH_OCCURRENCE' && c.observedValue !== open.observedValue) {
        plan.renotify.push({ alertId: open.alertId, observedValue: c.observedValue });
      } else if (
        rule.frequency === 'ESCALATING' && !open.acknowledged && !open.escalated && rule.escalationRole &&
        rule.escalationAfterHours !== null && input.nowMs - open.raisedAtMs >= rule.escalationAfterHours * 3_600_000
      ) {
        plan.escalate.push({ alertId: open.alertId, role: rule.escalationRole });
      }
    }
  }

  const liveRuleIds = new Set(rules.map((r) => r.ruleId));
  for (const open of input.active) {
    if (wanted.has(open.dedupKey)) continue;
    // After a stock posting only silo facts were loaded; anything else stays as it is until a full evaluation.
    if (input.levelsOnly && open.subjectType !== 'SILO') continue;
    plan.resolve.push({ alertId: open.alertId, reason: liveRuleIds.has(open.ruleId) ? REASON_BY_EVENT[open.eventType] ?? 'CLOSED' : 'RULE_OFF' });
  }
  return plan;
}
```

- [ ] **Step 4: Run** `pnpm nx test api -- feed-alert.rules` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/inventory/feed-alert/feed-alert.rules.ts apps/api/src/modules/inventory/feed-alert/feed-alert.rules.spec.ts
git commit -m "feat(feed-alert): pure alert planning — raise, re-arm, escalate, resolve

Checkpoints 11–13 (low at-or-below with dedup until recovery, resolve on
recovery and re-arm on the next crossing, over-stock INFO), 30 (diet change
3 days ahead) and 20 (requisition deadline reminders), with the §4
frequencies ONCE, DAILY, ON_EACH_OCCURRENCE and ESCALATING.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Feed alerts — store, evaluate, list, acknowledge, and evaluate after postings

The in-app alerts themselves, and the three ways evaluation is triggered. **Scheduling:** the API has no periodic runner (no `@Cron`, `ScheduleModule`, `setInterval`, queue or worker under `apps/api/src`, checked 2026-09-26), and adding one is a platform decision outside Plan B. So:
1. **On every write that moves silo stock** — posted stock transfer, goods receipt, stock adjustment and daily entry — the silo-level events (FEED_BELOW_L1, FEED_ABOVE) are evaluated for the farms touched (checkpoint 12: "On TO receipt, POST Day, approved adjustment and alert scheduler").
2. **After a feed requisition is drafted, approved or rejected** (Tasks 8–9) — a full evaluation, so a deadline alert closes as soon as the requisition is approved.
3. **`POST /feed-alert/evaluate`** — a full evaluation for one farm, called by the Feed Alerts screen when it opens (Task 11). Date-driven events (DIET_CHANGE, REQ_DEADLINE, escalation, DAILY repeats) advance whenever this runs; with no scheduler, they advance only when someone opens the screen or posts.

A failed evaluation never fails the posting that triggered it (Review Focus 5).

**Files:**
- Create: `apps/api/src/drizzle/tenant/0119_feed_alert.sql`; modify `meta/_journal.json` (idx 119)
- Modify: `apps/api/src/core/database/schema.ts` (new `feedAlert`, after `alertRule`)
- Create: `apps/api/src/modules/inventory/feed-alert/feed-alert.service.ts`, `feed-alert.controller.ts`, `feed-alert.module.ts`, `dto/feed-alert.dto.ts`
- Test: `apps/api/src/modules/inventory/feed-alert/feed-alert.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `FeedAlertModule` after `FeedForecastModule`)
- Modify: `apps/api/src/common/farm-scope-coverage.spec.ts` (`FeedAlertController` in `SCOPED`)
- Modify (hooks): `inventory/stock-transfer/stock-transfer.{service,module}.ts`, `inventory/goods-receipt/goods-receipt.{service,module}.ts`, `inventory/stock-adjustment/stock-adjustment.{service,module}.ts`, `production/batch-daily-data/batch-daily-data.{service,module}.ts`

**Interfaces:**
- Consumes: `planAlerts` and fact types (Task 6); `FeedForecastService.resolveFarm/computeForFarm/withFarmScope` (Task 4); `SiloFeedService.currentItems` (Plan A); `schema.requisition.submission_deadline` etc. (Task 1); `schema.alertRule` (Task 5).
- Produces:

```ts
// feed-alert.service.ts
export function visibleTo(alert: { recipient_roles: unknown; escalation_role: string | null; escalated_at: string | null }, roleCodes: string[], seesAll: boolean): boolean;
export class FeedAlertService {
  evaluateFarm(farmId: string, companyId: string, tenantId: string, opts?: { levelsOnly?: boolean }): Promise<AlertPlan>;
  evaluateFarmSafely(farmId: string | null | undefined, companyId: string | null | undefined, tenantId: string): Promise<void>;
  evaluateLevelsSafely(locationIds: Array<string | null | undefined>, tenantId: string): Promise<void>;
  evaluateNow(queryFarmId: string | undefined, tenantId: string, userType?: string): Promise<{ farmId: string; raised: number; renotified: number; escalated: number; resolved: number }>;
  list(query: { farmId?: string; status?: 'ACTIVE' | 'RESOLVED' | 'ALL' }, tenantId: string, user: { userId?: string; userType?: string }): Promise<Array<typeof schema.feedAlert.$inferSelect & { farm_code: string | null }>>;
  acknowledge(alertId: string, tenantId: string, user: { userId?: string; userType?: string }): Promise<typeof schema.feedAlert.$inferSelect>;
}
```
- REST: `GET /feed-alert?farmId=&status=ACTIVE|RESOLVED|ALL`, `POST /feed-alert/evaluate` body `{ farmId? }`, `POST /feed-alert/:id/acknowledge` — all `@RequirePermission('INVENTORY', 'LEDGER', 'view')` (the same grant as the forecast: whoever may see the balances may see their alerts), `@FarmScoped()`.
- `FeedAlertModule` exports `FeedAlertService`.

- [ ] **Step 1: Write the failing tests** — `feed-alert.service.spec.ts`:

```ts
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedAlertService, visibleTo } from './feed-alert.service';
import type { AlertPlan } from './feed-alert.rules';

describe('visibleTo — who sees a feed alert (Q1)', () => {
  const alert = { recipient_roles: ['FARM_MANAGER'], escalation_role: 'HEAD_OF_FARM', escalated_at: null as string | null };
  it('shows a recipient role holder their alert', () => expect(visibleTo(alert, ['FARM_MANAGER'], false)).toBe(true));
  it('hides it from a user with none of its roles', () => expect(visibleTo(alert, ['OPERATOR'], false)).toBe(false));
  it('shows the escalation role only once escalated', () => {
    expect(visibleTo(alert, ['HEAD_OF_FARM'], false)).toBe(false);
    expect(visibleTo({ ...alert, escalated_at: '2026-09-23 16:00:00' }, ['HEAD_OF_FARM'], false)).toBe(true);
  });
  it('shows admins everything', () => expect(visibleTo(alert, [], true)).toBe(true));
});

describe('FeedAlertService', () => {
  const inserted: any[] = [];
  const updates: any[] = [];
  const db: any = {
    insert: jest.fn(() => ({ values: jest.fn(async (v: any) => { inserted.push(v); }) })),
    update: jest.fn(() => ({ set: jest.fn((v: any) => ({ where: jest.fn(async () => { updates.push(v); }) })) })),
    select: jest.fn(() => { throw new Error('connection lost'); }),
  };
  const cls = transactionCls(db);
  const service = new FeedAlertService(cls, {} as any, {} as any);

  beforeEach(() => { inserted.length = 0; updates.length = 0; });

  it('evaluateLevelsSafely swallows errors so a posting is never failed by its alerts (Review Focus 5)', async () => {
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.evaluateLevelsSafely(['silo-1'], 'tenant-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
  });

  it('writes a raised alert with active_key = dedup key, and a resolved one with active_key cleared', async () => {
    const rule = { ruleId: 'rule-low', notificationCode: 'FEED-BELOW-L1', eventType: 'FEED_BELOW_L1', thresholdReference: 'SILO_BELOW', thresholdValue: null,
      priorityLevel: 'CRITICAL_FIRST_PRIORITY', recipientRoles: ['FARM_MANAGER'], frequency: 'ESCALATING', escalationAfterHours: 4, escalationRole: 'HEAD_OF_FARM', farmId: null, isActive: true } as const;
    const plan: AlertPlan = {
      raise: [{ rule: rule as any, dedupKey: 'rule-low|s1', subjectType: 'SILO', subjectId: 's1', itemId: 'r1', title: 'Low feed: GRS/SILO-001', message: 'm', observedValue: 900, thresholdValue: 1000 }],
      renotify: [], escalate: [{ alertId: 'a2', role: 'HEAD_OF_FARM' }], resolve: [{ alertId: 'a1', reason: 'RECOVERED' }],
    };
    await (service as any).applyPlan(plan, { tenantId: 't', companyId: 'co', farmId: 'farm', nowMs: Date.UTC(2026, 8, 23, 12) });

    expect(inserted[0]).toMatchObject({
      tenant_id: 't', company_id: 'co', farm_id: 'farm', rule_id: 'rule-low', notification_code: 'FEED-BELOW-L1', event_type: 'FEED_BELOW_L1',
      priority_level: 'CRITICAL_FIRST_PRIORITY', subject_type: 'SILO', subject_id: 's1', item_id: 'r1', dedup_key: 'rule-low|s1', active_key: 'rule-low|s1',
      status: 'ACTIVE', observed_value: '900', threshold_value: '1000', recipient_roles: ['FARM_MANAGER'], raised_at: '2026-09-23 12:00:00',
    });
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ escalated_at: '2026-09-23 12:00:00', escalation_role: 'HEAD_OF_FARM' }),
      expect.objectContaining({ status: 'RESOLVED', active_key: null, resolved_reason: 'RECOVERED', resolved_at: '2026-09-23 12:00:00' }),
    ]));
  });

  it('ignores a duplicate active_key raised concurrently rather than failing', async () => {
    db.insert.mockImplementationOnce(() => ({ values: jest.fn(async () => { throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }); }) }));
    const plan: AlertPlan = { raise: [{ rule: { ruleId: 'r', notificationCode: 'X', eventType: 'FEED_ABOVE', recipientRoles: ['A'], priorityLevel: 'INFO' } as any,
      dedupKey: 'r|s1', subjectType: 'SILO', subjectId: 's1', itemId: null, title: 't', message: 'm', observedValue: 1, thresholdValue: 1 }], renotify: [], escalate: [], resolve: [] };
    await expect((service as any).applyPlan(plan, { tenantId: 't', companyId: 'co', farmId: 'farm', nowMs: 0 })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** `pnpm nx test api -- feed-alert.service` → FAIL (module not found).

- [ ] **Step 3: Migration** `0119_feed_alert.sql`:

```sql
-- In-app feed alerts (Plan B; Master Setup §4, checkpoints 11–13, 20, 30).
-- One row per raised alert. active_key carries the dedup key while the alert
-- is ACTIVE and NULL once RESOLVED, so the unique index allows exactly one
-- open alert per rule and subject (checkpoint 11 "Deduplicate until
-- recovery") while keeping every resolved one as history (checkpoint 12's
-- re-arm raises a new row).
CREATE TABLE `feed_alert` (
  `alert_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `farm_id` varchar(36) NOT NULL,
  `rule_id` varchar(36) NOT NULL,
  `notification_code` varchar(20) NOT NULL,
  `event_type` varchar(40) NOT NULL,
  `priority_level` varchar(30) NOT NULL,
  `subject_type` varchar(20) NOT NULL,
  `subject_id` varchar(36) NOT NULL,
  `item_id` varchar(36),
  `dedup_key` varchar(191) NOT NULL,
  `active_key` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `title` varchar(200) NOT NULL,
  `message` text NOT NULL,
  `observed_value` decimal(18,4),
  `threshold_value` decimal(18,4),
  `recipient_roles` json NOT NULL,
  `escalation_role` varchar(50),
  `escalated_at` timestamp NULL,
  `acknowledged_by` varchar(36),
  `acknowledged_at` timestamp NULL,
  `raised_at` timestamp NOT NULL,
  `last_notified_at` timestamp NOT NULL,
  `notify_count` int NOT NULL DEFAULT 1,
  `resolved_at` timestamp NULL,
  `resolved_reason` varchar(20),
  CONSTRAINT `feed_alert_alert_id` PRIMARY KEY(`alert_id`),
  CONSTRAINT `uq_feed_alert_active_key` UNIQUE(`active_key`)
);
--> statement-breakpoint
ALTER TABLE `feed_alert` ADD CONSTRAINT `feed_alert_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `feed_alert` ADD CONSTRAINT `feed_alert_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `feed_alert` ADD CONSTRAINT `feed_alert_rule_fk` FOREIGN KEY (`rule_id`) REFERENCES `alert_rule`(`rule_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_feed_alert_farm_status` ON `feed_alert` (`farm_id`, `status`);
```

Journal: idx 119, `"when": 1790962800000`, tag `0119_feed_alert`.

- [ ] **Step 4: Schema** (after `alertRule`):

```ts
/**
 * In-app feed alerts raised from alert_rule (Plan B). active_key = dedup_key
 * while ACTIVE, NULL once RESOLVED: the unique index is what makes "one open
 * alert per rule and subject" (checkpoint 11) hold under concurrent postings.
 */
export const feedAlert = mysqlTable('feed_alert', {
  alert_id: varchar('alert_id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).notNull().references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  farm_id: varchar('farm_id', { length: 36 }).notNull().references(() => locationMaster.location_id, { onDelete: 'cascade' }),
  rule_id: varchar('rule_id', { length: 36 }).notNull().references(() => alertRule.rule_id, { onDelete: 'cascade' }),
  notification_code: varchar('notification_code', { length: 20 }).notNull(),
  event_type: varchar('event_type', { length: 40 }).notNull(),
  priority_level: varchar('priority_level', { length: 30 }).notNull(),
  subject_type: varchar('subject_type', { length: 20 }).notNull(), // SILO, BATCH, REQUISITION
  subject_id: varchar('subject_id', { length: 36 }).notNull(),
  item_id: varchar('item_id', { length: 36 }),
  dedup_key: varchar('dedup_key', { length: 191 }).notNull(),
  active_key: varchar('active_key', { length: 191 }),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, RESOLVED
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull(),
  observed_value: decimal('observed_value', { precision: 18, scale: 4 }),
  threshold_value: decimal('threshold_value', { precision: 18, scale: 4 }),
  recipient_roles: json('recipient_roles').$type<string[]>().notNull(),
  escalation_role: varchar('escalation_role', { length: 50 }),
  escalated_at: timestamp('escalated_at', { mode: 'string' }),
  acknowledged_by: varchar('acknowledged_by', { length: 36 }),
  acknowledged_at: timestamp('acknowledged_at', { mode: 'string' }),
  raised_at: timestamp('raised_at', { mode: 'string' }).notNull(),
  last_notified_at: timestamp('last_notified_at', { mode: 'string' }).notNull(),
  notify_count: int('notify_count').default(1).notNull(),
  resolved_at: timestamp('resolved_at', { mode: 'string' }),
  resolved_reason: varchar('resolved_reason', { length: 20 }),
}, (table) => ({
  uqActive: uniqueIndex('uq_feed_alert_active_key').on(table.active_key),
  farmStatus: index('idx_feed_alert_farm_status').on(table.farm_id, table.status),
}));
```

- [ ] **Step 5: Service** — `feed-alert.service.ts`:

```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { ADMIN_USER_TYPES } from '../../../common/permissions';
import { FeedForecastService } from '../feed-forecast/feed-forecast.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import type { DietChange } from '../feed-forecast/feed-forecast.engine';
import type { AlertFrequency, PriorityLevel } from '../../system/alert-rule/alert-rule.rules';
import {
  ActiveAlertFact, AlertPlan, AlertRuleFact, OpenRequisitionFact, SiloLevelFact, planAlerts,
} from './feed-alert.rules';

const ts = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const parseTs = (s: string) => Date.parse(`${s.replace(' ', 'T')}Z`);
const num = (v: string | null) => (v == null ? null : Number(v));

/** The server's calendar day (same rule as feed-forecast.service.ts todayLocal). */
function localDay(ms: number = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Feed requisitions not yet approved — the statuses a REQ_DEADLINE reminder is about (checkpoint 20). */
const OPEN_FEED_REQ_STATUSES = ['AUTO_DRAFT', 'DRAFT', 'PENDING_APPROVAL'];
/** Q1: admins see every alert of a farm in their scope; everyone else by role code. */
const SEES_ALL = [...ADMIN_USER_TYPES, 'OPERATIONAL_ADMIN'];

export function visibleTo(
  alert: { recipient_roles: unknown; escalation_role: string | null; escalated_at: string | null },
  roleCodes: string[],
  seesAll: boolean,
): boolean {
  if (seesAll) return true;
  const recipients = Array.isArray(alert.recipient_roles) ? (alert.recipient_roles as string[]) : [];
  if (recipients.some((r) => roleCodes.includes(r))) return true;
  return !!alert.escalated_at && !!alert.escalation_role && roleCodes.includes(alert.escalation_role);
}

/**
 * In-app feed alerts (Plan B). Loads the facts planAlerts needs for one farm,
 * under that farm's scope (FeedForecastService.withFarmScope — silo balances
 * come through SiloFeedService, which reads farmScope itself), and writes the
 * plan. No scheduler exists in the API, so evaluation runs after stock
 * postings (levels only), after requisition decisions, and on demand.
 */
@Injectable()
export class FeedAlertService {
  private readonly logger = new Logger(FeedAlertService.name);

  constructor(
    private readonly cls: ClsService,
    private readonly forecast: FeedForecastService,
    private readonly siloFeed: SiloFeedService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async evaluateNow(queryFarmId: string | undefined, tenantId: string, userType?: string) {
    const { farmId, companyId } = await this.forecast.resolveFarm(queryFarmId, tenantId, userType);
    const plan = await this.evaluateFarm(farmId, companyId, tenantId);
    return { farmId, raised: plan.raise.length, renotified: plan.renotify.length, escalated: plan.escalate.length, resolved: plan.resolve.length };
  }

  async evaluateFarm(farmId: string, companyId: string, tenantId: string, opts: { levelsOnly?: boolean } = {}): Promise<AlertPlan> {
    const levelsOnly = !!opts.levelsOnly;
    return this.forecast.withFarmScope(farmId, companyId, async () => {
      const nowMs = Date.now();
      const today = localDay(nowMs);
      const rules = await this.loadRules(companyId, farmId, tenantId);
      const silos = await this.loadSiloLevels(farmId, companyId, tenantId);
      let dietChanges: DietChange[] = [];
      let requisitions: OpenRequisitionFact[] = [];
      if (!levelsOnly) {
        const dietRules = rules.filter((r) => r.isActive && r.eventType === 'DIET_CHANGE');
        if (dietRules.length) {
          // The forecast only needs to look as far ahead as the widest DIET_CHANGE window (checkpoint 15 caps it at 45).
          const horizon = Math.min(45, Math.max(1, ...dietRules.map((r) => r.thresholdValue ?? 3)));
          dietChanges = (await this.forecast.computeForFarm(farmId, companyId, tenantId, { from: today, to: addDays(today, horizon) })).dietChanges;
        }
        requisitions = await this.loadOpenRequisitions(farmId, tenantId);
      }
      const active = await this.loadActive(farmId, tenantId);
      const plan = planAlerts({ today, nowMs, farmId, rules, silos, dietChanges, requisitions, active, levelsOnly });
      await this.applyPlan(plan, { tenantId, companyId, farmId, nowMs });
      return plan;
    });
  }

  async evaluateFarmSafely(farmId: string | null | undefined, companyId: string | null | undefined, tenantId: string): Promise<void> {
    if (!farmId || !companyId) return;
    try {
      await this.evaluateFarm(farmId, companyId, tenantId);
    } catch (error) {
      this.logger.warn(`Feed alerts not evaluated for farm ${farmId}: ${(error as Error).message}`);
    }
  }

  /**
   * Called by the stock postings after they commit. Takes whatever locations
   * the posting touched (silos, stores, a batch's farm) and re-checks the silo
   * levels of their farms. Never throws: an alert must not undo a posting.
   */
  async evaluateLevelsSafely(locationIds: Array<string | null | undefined>, tenantId: string): Promise<void> {
    try {
      const ids = [...new Set(locationIds.filter((id): id is string => !!id))];
      if (!ids.length) return;
      const rows = await this.db
        .select({
          location_id: schema.locationMaster.location_id,
          location_type: schema.locationMaster.location_type,
          farm_id: schema.locationMaster.farm_id,
          company_id: schema.locationMaster.company_id,
        })
        .from(schema.locationMaster)
        .where(and(eq(schema.locationMaster.tenant_id, tenantId), inArray(schema.locationMaster.location_id, ids)));
      const farms = new Map<string, string>();
      for (const r of rows) {
        const farmId = r.location_type === 'FARM' ? r.location_id : r.farm_id;
        if (farmId && r.company_id) farms.set(farmId, r.company_id);
      }
      for (const [farmId, companyId] of farms) await this.evaluateFarm(farmId, companyId, tenantId, { levelsOnly: true });
    } catch (error) {
      this.logger.warn(`Feed level alerts not evaluated: ${(error as Error).message}`);
    }
  }

  async list(query: { farmId?: string; status?: 'ACTIVE' | 'RESOLVED' | 'ALL' }, tenantId: string, user: { userId?: string; userType?: string }) {
    const { farmId } = await this.forecast.resolveFarm(query.farmId, tenantId, user?.userType);
    const status = query.status ?? 'ACTIVE';
    const rows = await this.db
      .select({ alert: schema.feedAlert, farm_code: schema.locationMaster.location_code })
      .from(schema.feedAlert)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.feedAlert.farm_id))
      .where(and(
        eq(schema.feedAlert.tenant_id, tenantId),
        eq(schema.feedAlert.farm_id, farmId),
        ...(status === 'ALL' ? [] : [eq(schema.feedAlert.status, status)]),
      ))
      .orderBy(desc(schema.feedAlert.last_notified_at))
      .limit(200);
    const seesAll = SEES_ALL.includes(user?.userType ?? '');
    const roleCodes = seesAll ? [] : await this.roleCodesOf(user?.userId);
    return rows.filter((r) => visibleTo(r.alert, roleCodes, seesAll)).map((r) => ({ ...r.alert, farm_code: r.farm_code }));
  }

  async acknowledge(alertId: string, tenantId: string, user: { userId?: string; userType?: string }) {
    const [row] = await this.db.select().from(schema.feedAlert)
      .where(and(eq(schema.feedAlert.alert_id, alertId), eq(schema.feedAlert.tenant_id, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Alert not found.');
    // The same farm rule as the list: an alert of a farm the caller may not see is not found (D13).
    await this.forecast.resolveFarm(row.farm_id, tenantId, user?.userType);
    const seesAll = SEES_ALL.includes(user?.userType ?? '');
    if (!visibleTo(row, seesAll ? [] : await this.roleCodesOf(user?.userId), seesAll)) throw new NotFoundException('Alert not found.');
    const now = ts(Date.now());
    await this.db.update(schema.feedAlert).set({ acknowledged_by: user?.userId ?? null, acknowledged_at: now })
      .where(eq(schema.feedAlert.alert_id, alertId));
    return { ...row, acknowledged_by: user?.userId ?? null, acknowledged_at: now };
  }

  private async roleCodesOf(userId: string | undefined): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.db
      .select({ code: schema.roleMaster.role_code })
      .from(schema.userRoleAssignment)
      .innerJoin(schema.roleMaster, eq(schema.roleMaster.role_id, schema.userRoleAssignment.role_id))
      .where(and(eq(schema.userRoleAssignment.user_id, userId), eq(schema.userRoleAssignment.is_active, true), eq(schema.roleMaster.is_active, true)));
    return rows.map((r) => r.code);
  }

  /** Every rule of the company (or tenant-wide) that could apply to this farm — inactive ones too, so their open alerts resolve as RULE_OFF. */
  private async loadRules(companyId: string, farmId: string, tenantId: string): Promise<AlertRuleFact[]> {
    const rows = await this.db.select().from(schema.alertRule).where(and(
      eq(schema.alertRule.tenant_id, tenantId),
      or(eq(schema.alertRule.company_id, companyId), isNull(schema.alertRule.company_id)),
      or(eq(schema.alertRule.farm_id, farmId), isNull(schema.alertRule.farm_id)),
    ));
    return rows.map((r) => ({
      ruleId: r.rule_id,
      notificationCode: r.notification_code,
      eventType: r.event_type,
      thresholdReference: r.threshold_reference,
      thresholdValue: num(r.threshold_value),
      priorityLevel: r.priority_level as PriorityLevel,
      recipientRoles: (r.recipient_roles as string[]) ?? [],
      frequency: r.frequency as AlertFrequency,
      escalationAfterHours: r.escalation_after_hours,
      escalationRole: r.escalation_role,
      farmId: r.farm_id,
      isActive: r.is_active && !r.deleted_at,
    }));
  }

  /** Active silos of the farm with their levels and System Balance (the one resident item's on-hand quantity, D8). */
  private async loadSiloLevels(farmId: string, companyId: string, tenantId: string): Promise<SiloLevelFact[]> {
    const silos = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        low_level_kg: schema.locationMaster.low_level_kg,
        high_level_kg: schema.locationMaster.high_level_kg,
      })
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.farm_id, farmId),
        eq(schema.locationMaster.location_type, 'SILO'),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.deleted_at),
      ));
    const levelled = silos.filter((s) => s.low_level_kg != null || s.high_level_kg != null);
    if (!levelled.length) return [];
    const residents = await this.siloFeed.currentItems(levelled.map((s) => s.location_id), companyId, tenantId);
    return levelled.map((s) => {
      const resident = residents.get(s.location_id) ?? null;
      return {
        siloId: s.location_id,
        siloCode: s.location_code,
        itemId: resident?.item_id ?? null,
        itemName: resident ? resident.item_description ?? resident.item_code : null,
        balanceKg: resident?.on_hand_qty ?? 0,
        lowLevelKg: num(s.low_level_kg),
        highLevelKg: num(s.high_level_kg),
      };
    });
  }

  private async loadOpenRequisitions(farmId: string, tenantId: string): Promise<OpenRequisitionFact[]> {
    const rows = await this.db
      .select({
        requisition_id: schema.requisition.requisition_id,
        req_no: schema.requisition.req_no,
        status: schema.requisition.status,
        submission_deadline: schema.requisition.submission_deadline,
      })
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.farm_id, farmId),
        eq(schema.requisition.doc_type, 'FEED'),
        inArray(schema.requisition.status, OPEN_FEED_REQ_STATUSES),
        isNull(schema.requisition.deleted_at),
      ));
    return rows
      .filter((r) => !!r.submission_deadline)
      .map((r) => ({ requisitionId: r.requisition_id, reqNo: r.req_no, status: r.status, submissionDeadline: r.submission_deadline! }));
  }

  private async loadActive(farmId: string, tenantId: string): Promise<ActiveAlertFact[]> {
    const rows = await this.db.select().from(schema.feedAlert).where(and(
      eq(schema.feedAlert.tenant_id, tenantId), eq(schema.feedAlert.farm_id, farmId), eq(schema.feedAlert.status, 'ACTIVE'),
    ));
    return rows.map((r) => ({
      alertId: r.alert_id,
      ruleId: r.rule_id,
      eventType: r.event_type,
      subjectType: r.subject_type as ActiveAlertFact['subjectType'],
      dedupKey: r.dedup_key,
      raisedAtMs: parseTs(r.raised_at),
      lastNotifiedDay: localDay(parseTs(r.last_notified_at)),
      acknowledged: !!r.acknowledged_at,
      escalated: !!r.escalated_at,
      observedValue: num(r.observed_value),
    }));
  }

  private async applyPlan(plan: AlertPlan, ctx: { tenantId: string; companyId: string; farmId: string; nowMs: number }): Promise<void> {
    const now = ts(ctx.nowMs);
    for (const c of plan.raise) {
      try {
        await this.db.insert(schema.feedAlert).values({
          alert_id: randomUUID(),
          tenant_id: ctx.tenantId,
          company_id: ctx.companyId,
          farm_id: ctx.farmId,
          rule_id: c.rule.ruleId,
          notification_code: c.rule.notificationCode,
          event_type: c.rule.eventType,
          priority_level: c.rule.priorityLevel,
          subject_type: c.subjectType,
          subject_id: c.subjectId,
          item_id: c.itemId,
          dedup_key: c.dedupKey,
          active_key: c.dedupKey,
          status: 'ACTIVE',
          title: c.title.slice(0, 200),
          message: c.message,
          observed_value: c.observedValue == null ? null : String(c.observedValue),
          threshold_value: c.thresholdValue == null ? null : String(c.thresholdValue),
          recipient_roles: c.rule.recipientRoles,
          raised_at: now,
          last_notified_at: now,
          notify_count: 1,
        });
      } catch (error) {
        // Two postings evaluating the same farm at once both see "no open alert"; the unique active_key lets only one in.
        if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
      }
    }
    for (const r of plan.renotify) {
      await this.db.update(schema.feedAlert).set({
        last_notified_at: now,
        notify_count: sql`${schema.feedAlert.notify_count} + 1`,
        acknowledged_by: null,
        acknowledged_at: null,
        observed_value: r.observedValue == null ? null : String(r.observedValue),
      }).where(eq(schema.feedAlert.alert_id, r.alertId));
    }
    for (const e of plan.escalate) {
      await this.db.update(schema.feedAlert).set({ escalated_at: now, escalation_role: e.role }).where(eq(schema.feedAlert.alert_id, e.alertId));
    }
    for (const r of plan.resolve) {
      await this.db.update(schema.feedAlert).set({ status: 'RESOLVED', active_key: null, resolved_at: now, resolved_reason: r.reason })
        .where(eq(schema.feedAlert.alert_id, r.alertId));
    }
  }
}
```

- [ ] **Step 6: DTO, controller, module**

`dto/feed-alert.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class QueryFeedAlertDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'RESOLVED', 'ALL'] }) @IsOptional() @IsIn(['ACTIVE', 'RESOLVED', 'ALL']) status?: 'ACTIVE' | 'RESOLVED' | 'ALL';
}

export class EvaluateFeedAlertDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
}
```

`feed-alert.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { FeedAlertService } from './feed-alert.service';
import { EvaluateFeedAlertDto, QueryFeedAlertDto } from './dto/feed-alert.dto';

// Under the Inventory Ledger grant, like the forecast: whoever may see a
// silo's balance may see that it is low. Evaluate is idempotent (one open
// alert per rule and subject), so it needs no stronger grant.
@ApiTags('Feed Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('feed-alert')
export class FeedAlertController {
  constructor(private readonly alerts: FeedAlertService) {}

  @Get()
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Feed alerts of one farm visible to the caller' })
  async list(@Query() query: QueryFeedAlertDto, @Req() req: any) {
    const data = await this.alerts.list(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed alerts retrieved successfully.', data };
  }

  @Post('evaluate')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Evaluate every feed alert rule for one farm now (there is no scheduler)' })
  async evaluate(@Body() dto: EvaluateFeedAlertDto, @Req() req: any) {
    const data = await this.alerts.evaluateNow(dto?.farmId, req.user?.tenantId || req['tenantId'], req.user?.userType);
    return { success: true, message: 'Feed alerts evaluated.', data };
  }

  @Post(':id/acknowledge')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Acknowledge a feed alert — stops its escalation' })
  async acknowledge(@Param('id') id: string, @Req() req: any) {
    const data = await this.alerts.acknowledge(id, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed alert acknowledged.', data };
  }
}
```

`feed-alert.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FeedForecastModule } from '../feed-forecast/feed-forecast.module';
import { SiloFeedModule } from '../silo-feed/silo-feed.module';
import { FeedAlertController } from './feed-alert.controller';
import { FeedAlertService } from './feed-alert.service';

@Module({
  imports: [FeedForecastModule, SiloFeedModule],
  controllers: [FeedAlertController],
  providers: [FeedAlertService],
  exports: [FeedAlertService],
})
export class FeedAlertModule {}
```

Register `FeedAlertModule` in `app.module.ts`; add `FeedAlertController` to `SCOPED` in `farm-scope-coverage.spec.ts` (import it next to `FeedForecastController`).

- [ ] **Step 7: Hooks on the four stock writers.** In each service, inject the alert service as **optional** so the existing specs' testing modules, which do not provide it, keep compiling and passing:

```ts
import { Optional } from '@nestjs/common';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service'; // from production/: '../../inventory/feed-alert/feed-alert.service'; from inventory/: '../feed-alert/feed-alert.service'
// constructor parameter, last:
    @Optional() private readonly feedAlerts?: FeedAlertService,
```

and add `FeedAlertModule` to each module's `imports`. Then change each `post` so the evaluation runs after the transaction has committed:

`stock-transfer.service.ts` `post`:

```ts
  async post(id: string, tenantId: string, userPayload?: any) {
    const posted = await withTenantTransaction(this.cls, async () => {
      // … the existing body, unchanged, ending in `return this.findOne(id);`
    });
    // Checkpoint 12: re-check silo levels after the stock has moved — both ends, since a transfer out of a silo lowers it.
    await this.feedAlerts?.evaluateLevelsSafely([posted.from_warehouse_id, posted.to_warehouse_id], tenantId);
    return posted;
  }
```

`goods-receipt.service.ts` `post` — same shape, with `await this.feedAlerts?.evaluateLevelsSafely([posted.warehouse_id, ...((posted as any).lines ?? []).map((l: any) => l.warehouse_id)], tenantId);`.

`stock-adjustment.service.ts` `post` — same shape, with `await this.feedAlerts?.evaluateLevelsSafely([posted.warehouse_id], tenantId);`.

`batch-daily-data.service.ts` `postEntry` — keep the existing `await this.batchService.findOne(batchId);` result as `const batch = …`, keep the method's existing body, and immediately before its final `return` add:

```ts
    // POST Day consumption lowers the silo it drew from (Plan A Task 4); re-check the farm's silo levels (checkpoint 12).
    await this.feedAlerts?.evaluateLevelsSafely([batch.farm_id], tenantId);
```

If `postEntry` has more than one `return` of a posted entry, add the line before each; if the final `return` is inside a `withTenantTransaction` callback, restructure as for `post` above (assign, evaluate, return) so evaluation runs after commit.

- [ ] **Step 8: Run** `pnpm nx test api -- feed-alert stock-transfer goods-receipt stock-adjustment batch-daily-data farm-scope-coverage` → PASS; `pnpm nx test web -- role-permissions-coverage` → PASS (no new pair: `INVENTORY/LEDGER` is already offered); typecheck → PASS. If Nest reports a circular import between `FeedAlertModule` and `BatchDailyDataModule` (it should not: FeedAlert → FeedForecast → InventoryLedger/SiloFeed only), wrap the import in `forwardRef(() => FeedAlertModule)`.

- [ ] **Step 9: Apply the migration** — `pnpm nx run api:db-migrate-all-tenants`; `mysql … -e "SHOW INDEX FROM nf_devco.feed_alert WHERE Key_name='uq_feed_alert_active_key';"` → one row, `Non_unique = 0`.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/drizzle/tenant/0119_feed_alert.sql apps/api/src/drizzle/tenant/meta/_journal.json apps/api/src/core/database/schema.ts apps/api/src/modules/inventory/feed-alert apps/api/src/app.module.ts apps/api/src/common/farm-scope-coverage.spec.ts apps/api/src/modules/inventory/stock-transfer apps/api/src/modules/inventory/goods-receipt apps/api/src/modules/inventory/stock-adjustment apps/api/src/modules/production/batch-daily-data
git commit -m "feat(feed-alert): in-app feed alerts, evaluated after postings and on demand

feed_alert holds one open alert per rule and subject (unique active_key,
checkpoint 11) and keeps resolved ones as history (checkpoint 12 re-arm).
The API has no scheduler, so silo levels are re-checked after every posted
transfer, receipt, adjustment and daily entry, and POST /feed-alert/evaluate
runs the date-driven rules; a failed evaluation never fails the posting.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Feed requisition — auto-draft from the forecast, manual entry, read

Engine Step 9: "Create or update linked draft lines per farm, batch, house, destination silo, item and required date. Preserve run ID and avoid duplicate drafts on rerun. Never push draft directly to BC." Requisition §1 row 9: "One requisition per farm per silo per feed item per submission cycle." Row 7: FEED_FORECAST for auto-drafted, MANUAL for manually raised; row 30 Source fixed MILL; row 31 Purpose fixed INTERNAL_TRANSFER.

The rerun rule (Review Focus 1), as `planDraftUpsert` implements it: within the farm's current submission cycle, the one AUTO_DRAFT requisition is updated in place — snapshots and recommendation refreshed; the requested quantity refreshed **only if the farm never changed it**; lines no longer needed removed unless edited; new lines added. A (destination, item) already on another requisition of the same cycle that is not an AUTO_DRAFT (a manual one, or one pending or approved) is not drafted again.

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts` (append `planDraftUpsert`, `serverToday`, `runKeyFor`)
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts` (append)
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`, `feed-requisition.controller.ts`, `feed-requisition.module.ts`, `dto/feed-requisition.dto.ts`
- Test: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `FeedRequisitionModule` after `RequisitionModule`), `apps/api/src/common/farm-scope-coverage.spec.ts` (`FeedRequisitionController` in `SCOPED`)

**Interfaces:**
- Consumes: Task 3 rules; `FeedForecastService.resolveFarm/computeForFarm/withFarmScope` (Task 4); `FeedAlertService.evaluateFarmSafely` (Task 7); `ApprovalService` (existing, used in Task 9); Task 1 columns.
- Produces:

```ts
// feed-requisition.rules.ts (appended)
export interface ExistingDraftLine { lineId: string; key: string; quantityKg: number; recommendedQtyKg: number | null }
export interface DraftUpsertPlan {
  insert: DraftLine[];
  update: { lineId: string; line: DraftLine; keepQuantity: boolean; priorQuantityKg: number }[];
  remove: string[];
  keep: string[];
}
export function planDraftUpsert(existing: ExistingDraftLine[], covered: Set<string>, wanted: DraftLine[]): DraftUpsertPlan;
export function serverToday(now?: Date): string;
export function runKeyFor(farmCode: string, now?: Date): string; // RUN-<FARM>-YYYYMMDD-HHmmss (format ours; workbook's example is RUN-GRS-20260923-001)

// FeedRequisitionService
autoDraft(dto: AutoDraftFeedRequisitionDto, tenantId: string, user: UserCtx): Promise<{ requisitionId: string | null; created: boolean; linesDrafted: number; requisition: FeedRequisitionView | null }>;
createManual(dto: CreateManualFeedRequisitionDto, tenantId: string, user: UserCtx): Promise<FeedRequisitionView>;
findAll(query: QueryFeedRequisitionDto, tenantId: string, user: UserCtx): Promise<FeedRequisitionListRow[]>;
findOne(id: string, tenantId: string): Promise<FeedRequisitionView>;
// type UserCtx = { userId?: string; userType?: string; email?: string }
// FeedRequisitionView = requisition row + { farm_code, lines: (requisition_line row + item_code, item_name, destination_code)[], farm_total_requested_kg, truck_target_kg, truck_trips }
```
- REST (`@FarmScoped()`, `PROCUREMENT/REQUISITION`): `GET /feed-requisition?farmId=&status=` (view), `GET /feed-requisition/:id` (view), `POST /feed-requisition` manual (create), `POST /feed-requisition/auto-draft` body `{ farmId?, to? }` (create).

- [ ] **Step 1: Write the failing tests**

Append to `feed-requisition.rules.spec.ts` (add `planDraftUpsert, runKeyFor` to the import):

```ts
describe('planDraftUpsert — rerun without duplicate drafts (Engine Step 9, Review Focus 1)', () => {
  const [lineR1, lineR2] = recommendLines({
    planningDate: '2026-09-23', to: '2026-09-29', sources: [r1, r2],
    destinations: new Map([silo('s1'), silo('s2')]), settings: S,
  });

  it('inserts every line on the first run', () => {
    expect(planDraftUpsert([], new Set(), [lineR1, lineR2])).toEqual({ insert: [lineR1, lineR2], update: [], remove: [], keep: [] });
  });

  it('refreshes an untouched line, quantity included', () => {
    const plan = planDraftUpsert([{ lineId: 'L1', key: 's1|r1', quantityKg: 6000, recommendedQtyKg: 6000 }], new Set(), [lineR1]);
    expect(plan.update).toEqual([{ lineId: 'L1', line: lineR1, keepQuantity: false, priorQuantityKg: 6000 }]);
  });

  it('keeps a quantity the farm edited', () => {
    const plan = planDraftUpsert([{ lineId: 'L1', key: 's1|r1', quantityKg: 7000, recommendedQtyKg: 6000 }], new Set(), [lineR1]);
    expect(plan.update[0]).toMatchObject({ keepQuantity: true, priorQuantityKg: 7000 });
  });

  it('removes a line no longer needed, unless the farm edited it', () => {
    expect(planDraftUpsert([{ lineId: 'L9', key: 's9|r9', quantityKg: 3000, recommendedQtyKg: 3000 }], new Set(), []).remove).toEqual(['L9']);
    expect(planDraftUpsert([{ lineId: 'L9', key: 's9|r9', quantityKg: 4000, recommendedQtyKg: 3000 }], new Set(), []).keep).toEqual(['L9']);
  });

  it('skips lines already on another requisition of the cycle', () => {
    expect(planDraftUpsert([], new Set(['s2|r2']), [lineR1, lineR2]).insert).toEqual([lineR1]);
  });
});

describe('runKeyFor', () => {
  it('names the farm and the moment', () => {
    expect(runKeyFor('GRS', new Date(2026, 8, 23, 9, 5, 7))).toBe('RUN-GRS-20260923-090507');
  });
});
```

`feed-requisition.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedRequisitionService } from './feed-requisition.service';

describe('FeedRequisitionService.createManual', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, leftJoin: () => self, orderBy: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const selectQueue: unknown[][] = [];
  const db: any = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn() };
  const forecast: any = {
    resolveFarm: jest.fn(async () => ({ farmId: 'farm-grs', companyId: 'co-1' })),
    withFarmScope: jest.fn(async (_f: string, _c: string, work: () => Promise<unknown>) => work()),
  };
  const service = new FeedRequisitionService(transactionCls(db), forecast, {} as any, { evaluateFarmSafely: jest.fn() } as any);

  it('refuses a destination that is not an active silo or store of the farm', async () => {
    selectQueue.push(
      [{ location_code: 'GRS', feed_bulk_multiple_kg: 3000, feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0 }], // farm
      [{ location_id: 'shed-1', location_code: 'GRS/SHED-003', location_type: 'SHED', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: null }],
    );
    await expect(service.createManual({ lines: [{ destination_location_id: 'shed-1', item_id: 'r1', quantity_kg: 3000, proposed_delivery_date: '2026-09-26' }] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.toThrow(new BadRequestException('Destination GRS/SHED-003 must be an active silo or store of farm GRS.'));
    expect(db.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `pnpm nx test api -- feed-requisition` → FAIL (`planDraftUpsert` / service not found).

- [ ] **Step 3: Append to `feed-requisition.rules.ts`:**

```ts
export interface ExistingDraftLine {
  lineId: string;
  key: string;
  quantityKg: number;
  recommendedQtyKg: number | null;
}

export interface DraftUpsertPlan {
  insert: DraftLine[];
  update: { lineId: string; line: DraftLine; keepQuantity: boolean; priorQuantityKg: number }[];
  remove: string[];
  keep: string[];
}

/** A line the farm changed: its requested quantity is not the recommendation it was drafted with (or it had none). */
function wasEdited(line: ExistingDraftLine): boolean {
  return line.recommendedQtyKg === null || Math.abs(line.quantityKg - line.recommendedQtyKg) > 1e-6;
}

/**
 * Engine Step 9 on rerun: update the cycle's one AUTO_DRAFT in place. A farm's
 * own quantity is never overwritten (Requisition §1 row 24: Requested Qty is
 * "Farm Manager final … qty"), and a (destination, item) already on another
 * requisition of the cycle is not drafted twice (row 9).
 */
export function planDraftUpsert(existing: ExistingDraftLine[], covered: Set<string>, wanted: DraftLine[]): DraftUpsertPlan {
  const plan: DraftUpsertPlan = { insert: [], update: [], remove: [], keep: [] };
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const wantedKeys = new Set<string>();
  for (const line of wanted) {
    if (covered.has(line.key)) continue;
    wantedKeys.add(line.key);
    const prior = byKey.get(line.key);
    if (!prior) plan.insert.push(line);
    else plan.update.push({ lineId: prior.lineId, line, keepQuantity: wasEdited(prior), priorQuantityKg: prior.quantityKg });
  }
  for (const prior of existing) {
    if (wantedKeys.has(prior.key)) continue;
    (wasEdited(prior) ? plan.keep : plan.remove).push(prior.lineId);
  }
  return plan;
}

/** The server's calendar day — the same rule as the forecast's planning date. */
export function serverToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Engine Step 9 "Preserve run ID". Format ours (the workbook's example RUN-GRS-20260923-001 uses a daily sequence). */
export function runKeyFor(farmCode: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `RUN-${farmCode}-${serverToday(now).replace(/-/g, '')}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
```

- [ ] **Step 4: DTOs** — `dto/feed-requisition.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class QueryFeedRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}

export class AutoDraftFeedRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional({ description: 'Last forecast day the draft covers (default planning date + 7, at most + 45)' })
  @IsOptional() @IsDateString() to?: string;
}

/** Requisition §2: a manual line names its destination silo or store, the item, the kilograms and the delivery date. */
export class ManualFeedLineInput {
  @ApiProperty() @IsUUID() destination_location_id: string;
  @ApiProperty() @IsUUID() item_id: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.001) quantity_kg: number;
  @ApiProperty() @IsDateString() proposed_delivery_date: string;
}

export class CreateManualFeedRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiProperty({ type: [ManualFeedLineInput] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ManualFeedLineInput)
  lines: ManualFeedLineInput[];
}

/** Requisition §2 rows 53 and 56: the farm may change Requested Qty and Proposed Delivery Date. */
export class FeedLineEditInput {
  @ApiProperty() @IsUUID() line_id: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.001) quantity_kg?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() proposed_delivery_date?: string;
}

export class UpdateFeedRequisitionDto {
  @ApiPropertyOptional({ description: 'Requisition §1 row 36' }) @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiPropertyOptional({ type: [FeedLineEditInput] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FeedLineEditInput)
  lines?: FeedLineEditInput[];
}

export class DecideFeedRequisitionDto extends UpdateFeedRequisitionDto {
  @ApiPropertyOptional({ description: 'Required when rejecting' }) @IsOptional() @IsString() @MaxLength(2000) rejection_reason?: string;
}
```

- [ ] **Step 5: Service** — `feed-requisition.service.ts` (Task 9 appends `update`, `approve`, `reject`):

```ts
/**
 * Feed requisitions (Feed Forecast Plan B; Requisition and Loading Sheet §1–§2
 * and §4 steps 1–5). Stored on the existing requisition tables as doc_type
 * FEED. Every number on a drafted line comes from feed-requisition.rules.ts;
 * this service loads, locks and writes. Farm scope is resolved exactly as the
 * forecast resolves it (FeedForecastService.resolveFarm, D13), and every
 * read runs under that farm (withFarmScope).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { farmScope } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { FeedForecastService, MAX_SPAN_DAYS } from '../../inventory/feed-forecast/feed-forecast.service';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';
import { ApprovalService } from '../../production/approval/approval.service';
import {
  DestinationInfo, DraftLine, FarmFeedSettings, bagCountFor, diffDaysIso, feedTypeOf, lineKey, planDraftUpsert,
  productionCycle, recommendLines, requisitionPriority, runKeyFor, serverToday, FeedType,
} from './feed-requisition.rules';
import { AutoDraftFeedRequisitionDto, CreateManualFeedRequisitionDto, QueryFeedRequisitionDto } from './dto/feed-requisition.dto';

export type UserCtx = { userId?: string; userType?: string; email?: string };

export const FEED_DOC_TYPE = 'FEED';
/** Statuses a feed requisition can still be edited, approved or rejected in (Requisition §1 row 33, up to APPROVED). */
export const OPEN_FEED_STATUSES = ['AUTO_DRAFT', 'DRAFT', 'PENDING_APPROVAL'];

const dec = (n: number | null | undefined) => (n == null ? null : String(n));
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

interface FarmRow { code: string; settings: FarmFeedSettings }

@Injectable()
export class FeedRequisitionService {
  constructor(
    private readonly cls: ClsService,
    private readonly forecast: FeedForecastService,
    private readonly approvals: ApprovalService,
    private readonly feedAlerts: FeedAlertService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /** The same farm/LOB bound requisition.service.ts applies. */
  private scopeConditions(): SQL[] {
    const scope = farmScope(this.cls);
    const conditions: SQL[] = [];
    if (scope.farmId) conditions.push(eq(schema.requisition.farm_id, scope.farmId));
    if (scope.restricted && scope.lobId) {
      conditions.push(sql`${schema.requisition.company_id} IN (SELECT company_id FROM company_master WHERE lob_id IS NULL OR lob_id = ${scope.lobId})`);
    }
    return conditions;
  }

  private async loadFarm(farmId: string, tenantId: string): Promise<FarmRow> {
    const [row] = await this.db
      .select({
        location_code: schema.locationMaster.location_code,
        feed_bulk_multiple_kg: schema.locationMaster.feed_bulk_multiple_kg,
        feed_bag_size_kg: schema.locationMaster.feed_bag_size_kg,
        feed_truck_target_kg: schema.locationMaster.feed_truck_target_kg,
        feed_production_weekday: schema.locationMaster.feed_production_weekday,
      })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, farmId), eq(schema.locationMaster.tenant_id, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Farm not found.');
    return {
      code: row.location_code,
      settings: {
        bulkMultipleKg: row.feed_bulk_multiple_kg ?? 3000,
        bagSizeKg: row.feed_bag_size_kg ?? 50,
        truckTargetKg: row.feed_truck_target_kg ?? 30000,
        productionWeekday: row.feed_production_weekday ?? 0,
      },
    };
  }

  private async loadDestinations(ids: string[], tenantId: string): Promise<Map<string, DestinationInfo & { code: string; farmId: string | null; isActive: boolean; rawType: string }>> {
    const map = new Map<string, DestinationInfo & { code: string; farmId: string | null; isActive: boolean; rawType: string }>();
    if (!ids.length) return map;
    const rows = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        location_type: schema.locationMaster.location_type,
        farm_id: schema.locationMaster.farm_id,
        is_active: schema.locationMaster.is_active,
        feed_in_bags: schema.locationMaster.feed_in_bags,
        low_level_kg: schema.locationMaster.low_level_kg,
      })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.tenant_id, tenantId), inArray(schema.locationMaster.location_id, [...new Set(ids)])));
    for (const r of rows) {
      map.set(r.location_id, {
        locationId: r.location_id,
        locationType: r.location_type === 'STORE' ? 'STORE' : 'SILO',
        rawType: r.location_type,
        feedInBags: r.feed_in_bags,
        lowLevelKg: r.low_level_kg == null ? null : Number(r.low_level_kg),
        code: r.location_code,
        farmId: r.farm_id,
        isActive: r.is_active,
      });
    }
    return map;
  }

  /** Requisition §1 row 5: REQ-FarmCode-YYYY-NNNNN (Q11). */
  private async nextReqNo(farmCode: string, tenantId: string): Promise<string> {
    const prefix = `REQ-${farmCode}-${new Date().getFullYear()}-`;
    const [last] = await this.db
      .select({ req_no: schema.requisition.req_no })
      .from(schema.requisition)
      .where(and(eq(schema.requisition.tenant_id, tenantId), sql`${schema.requisition.req_no} LIKE ${prefix + '%'}`))
      .orderBy(desc(schema.requisition.req_no))
      .limit(1);
    const lastSeq = last ? Number(last.req_no.slice(prefix.length)) : 0;
    return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(5, '0')}`;
  }

  /** The draft-time snapshot columns of a line (Requisition §2). */
  private lineValues(line: DraftLine) {
    return {
      item_id: line.itemId,
      description: line.itemName.slice(0, 200),
      uom: 'KG',
      destination_location_id: line.destinationLocationId,
      source_type: line.sourceType,
      feed_type: line.feedType,
      is_next_diet: line.isNextDiet,
      days_before_diet_change: line.daysBeforeDietChange,
      lifecycle_ref_id: line.lifecycleRefId,
      system_balance_kg: dec(line.systemBalanceKg),
      daily_requirement_kg: dec(line.dailyRequirementKg),
      days_remaining: line.daysRemaining,
      first_shortage_date: line.firstShortageDate,
      unrounded_need_kg: dec(line.unroundedNeedKg),
      recommended_qty_kg: dec(line.recommendedQtyKg),
      bag_count: line.bagCount,
      proposed_delivery_date: line.proposedDeliveryDate,
      needs_silo_changeover: line.needsSiloChangeover,
    };
  }

  async autoDraft(dto: AutoDraftFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const today = serverToday();
    if (dto.to && (dto.to < today || diffDaysIso(today, dto.to) > MAX_SPAN_DAYS)) {
      throw new BadRequestException(`to must be between today and ${MAX_SPAN_DAYS} days ahead.`);
    }
    const { farmId, companyId } = await this.forecast.resolveFarm(dto.farmId, tenantId, user?.userType);
    const outcome = await this.forecast.withFarmScope(farmId, companyId, async () => {
      const forecast = await this.forecast.computeForFarm(farmId, companyId, tenantId, { to: dto.to });
      const farm = await this.loadFarm(farmId, tenantId);
      const destinations = await this.loadDestinations(forecast.sources.map((s) => s.locationId), tenantId);
      const wanted = recommendLines({ planningDate: forecast.planningDate, to: forecast.to, sources: forecast.sources, destinations, settings: farm.settings });
      const cycle = productionCycle(forecast.planningDate, farm.settings.productionWeekday);
      const runKey = runKeyFor(farm.code);

      return withTenantTransaction(this.cls, async () => {
        // Every live feed requisition of this farm's cycle, locked so two reruns cannot both create the draft.
        const cycleRows = await this.db
          .select({ requisition_id: schema.requisition.requisition_id, status: schema.requisition.status, requisition_type: schema.requisition.requisition_type })
          .from(schema.requisition)
          .where(and(
            eq(schema.requisition.tenant_id, tenantId),
            eq(schema.requisition.farm_id, farmId),
            eq(schema.requisition.doc_type, FEED_DOC_TYPE),
            eq(schema.requisition.submission_deadline, cycle.submissionDeadline),
            ne(schema.requisition.status, 'REJECTED'),
            isNull(schema.requisition.deleted_at),
          ))
          .for('update');
        const draft = cycleRows.find((r) => r.status === 'AUTO_DRAFT' && r.requisition_type === 'FEED_FORECAST');
        const otherIds = cycleRows.filter((r) => r !== draft).map((r) => r.requisition_id);

        const covered = new Set<string>();
        if (otherIds.length) {
          const otherLines = await this.db
            .select({ dest: schema.requisitionLine.destination_location_id, item: schema.requisitionLine.item_id })
            .from(schema.requisitionLine)
            .where(inArray(schema.requisitionLine.requisition_id, otherIds));
          for (const l of otherLines) if (l.dest && l.item) covered.add(lineKey(l.dest, l.item));
        }

        const existing = draft
          ? (await this.db
              .select({
                line_id: schema.requisitionLine.line_id, line_seq: schema.requisitionLine.line_seq,
                dest: schema.requisitionLine.destination_location_id, item: schema.requisitionLine.item_id,
                quantity: schema.requisitionLine.quantity, recommended: schema.requisitionLine.recommended_qty_kg,
              })
              .from(schema.requisitionLine)
              .where(eq(schema.requisitionLine.requisition_id, draft.requisition_id)))
          : [];
        const plan = planDraftUpsert(
          existing.filter((l) => l.dest && l.item).map((l) => ({
            lineId: l.line_id, key: lineKey(l.dest!, l.item!), quantityKg: Number(l.quantity),
            recommendedQtyKg: l.recommended == null ? null : Number(l.recommended),
          })),
          covered,
          wanted,
        );

        const drafted = [...plan.insert, ...plan.update.map((u) => u.line)];
        const header = {
          priority: requisitionPriority(forecast.planningDate, drafted),
          forecast_run_key: runKey,
          required_date: drafted.map((l) => l.proposedDeliveryDate).sort()[0] ?? null,
          production_date: cycle.productionDate,
          submission_deadline: cycle.submissionDeadline,
          updated_by: user?.userId ?? null,
        };

        if (!draft) {
          if (!plan.insert.length) return { requisitionId: null as string | null, created: false, linesDrafted: 0 };
          const requisitionId = randomUUID();
          await this.db.insert(schema.requisition).values({
            requisition_id: requisitionId,
            tenant_id: tenantId,
            company_id: companyId,
            farm_id: farmId,
            req_no: await this.nextReqNo(farm.code, tenantId),
            doc_type: FEED_DOC_TYPE,
            status: 'AUTO_DRAFT',
            requisition_type: 'FEED_FORECAST',
            source: 'AUTO_FORECAST',
            purpose: 'INTERNAL_TRANSFER',
            supply_source: 'MILL',
            created_by: user?.userId ?? null,
            ...header,
          });
          await this.db.insert(schema.requisitionLine).values(
            plan.insert.map((line, i) => ({ requisition_id: requisitionId, line_seq: i + 1, quantity: String(line.recommendedQtyKg), ...this.lineValues(line) })),
          );
          return { requisitionId, created: true, linesDrafted: plan.insert.length };
        }

        if (plan.remove.length) {
          await this.db.delete(schema.requisitionLine).where(inArray(schema.requisitionLine.line_id, plan.remove));
        }
        for (const u of plan.update) {
          await this.db.update(schema.requisitionLine).set({
            ...this.lineValues(u.line),
            ...(u.keepQuantity
              ? { bag_count: bagCountFor(u.priorQuantityKg, u.line.feedType, farm.settings) }
              : { quantity: String(u.line.recommendedQtyKg) }),
          }).where(eq(schema.requisitionLine.line_id, u.lineId));
        }
        if (plan.insert.length) {
          const maxSeq = Math.max(0, ...existing.map((l) => l.line_seq));
          await this.db.insert(schema.requisitionLine).values(
            plan.insert.map((line, i) => ({ requisition_id: draft.requisition_id, line_seq: maxSeq + i + 1, quantity: String(line.recommendedQtyKg), ...this.lineValues(line) })),
          );
        }
        if (!drafted.length && !plan.keep.length) {
          // Nothing is needed any more and the farm kept nothing: the draft goes, rather than lingering empty.
          await this.db.update(schema.requisition).set({ deleted_at: nowTs(), updated_by: user?.userId ?? null })
            .where(eq(schema.requisition.requisition_id, draft.requisition_id));
          return { requisitionId: null as string | null, created: false, linesDrafted: 0 };
        }
        await this.db.update(schema.requisition).set(header).where(eq(schema.requisition.requisition_id, draft.requisition_id));
        return { requisitionId: draft.requisition_id as string | null, created: false, linesDrafted: drafted.length };
      });
    });

    // Checkpoint 20: the new draft's deadline reminders start from here.
    await this.feedAlerts.evaluateFarmSafely(farmId, companyId, tenantId);
    const requisition = outcome.requisitionId
      ? await this.forecast.withFarmScope(farmId, companyId, () => this.findOne(outcome.requisitionId!, tenantId))
      : null;
    return { ...outcome, requisition };
  }

  async createManual(dto: CreateManualFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.forecast.resolveFarm(dto.farmId, tenantId, user?.userType);
    const requisitionId = await this.forecast.withFarmScope(farmId, companyId, async () => {
      const farm = await this.loadFarm(farmId, tenantId);
      const destinations = await this.loadDestinations(dto.lines.map((l) => l.destination_location_id), tenantId);
      for (const line of dto.lines) {
        const dest = destinations.get(line.destination_location_id);
        if (!dest || dest.farmId !== farmId || !dest.isActive || !['SILO', 'STORE'].includes(dest.rawType)) {
          throw new BadRequestException(`Destination ${dest?.code ?? line.destination_location_id} must be an active silo or store of farm ${farm.code}.`);
        }
      }
      const itemIds = [...new Set(dto.lines.map((l) => l.item_id))];
      const items = await this.db
        .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name })
        .from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, itemIds)));
      const nameOf = new Map(items.map((i) => [i.item_id, i.item_name]));
      const missing = itemIds.find((id) => !nameOf.has(id));
      if (missing) throw new BadRequestException(`Feed item ${missing} was not found.`);

      const cycle = productionCycle(serverToday(), farm.settings.productionWeekday);
      return withTenantTransaction(this.cls, async () => {
        const id = randomUUID();
        await this.db.insert(schema.requisition).values({
          requisition_id: id,
          tenant_id: tenantId,
          company_id: companyId,
          farm_id: farmId,
          req_no: await this.nextReqNo(farm.code, tenantId),
          doc_type: FEED_DOC_TYPE,
          status: 'DRAFT',
          requisition_type: 'MANUAL',
          source: 'MANUAL_ENTRY',
          purpose: 'INTERNAL_TRANSFER',
          supply_source: 'MILL',
          remarks: dto.remarks?.trim() || null,
          required_date: dto.lines.map((l) => l.proposed_delivery_date).sort()[0],
          production_date: cycle.productionDate,
          submission_deadline: cycle.submissionDeadline,
          created_by: user?.userId ?? null,
        });
        await this.db.insert(schema.requisitionLine).values(dto.lines.map((line, i) => {
          const dest = destinations.get(line.destination_location_id)!;
          const feedType: FeedType = feedTypeOf(dest);
          return {
            requisition_id: id,
            line_seq: i + 1,
            item_id: line.item_id,
            description: (nameOf.get(line.item_id) ?? '').slice(0, 200),
            quantity: String(line.quantity_kg),
            uom: 'KG',
            destination_location_id: line.destination_location_id,
            source_type: dest.locationType,
            feed_type: feedType,
            bag_count: bagCountFor(line.quantity_kg, feedType, farm.settings),
            proposed_delivery_date: line.proposed_delivery_date,
          };
        }));
        return id;
      });
    });
    await this.feedAlerts.evaluateFarmSafely(farmId, companyId, tenantId);
    return this.forecast.withFarmScope(farmId, companyId, () => this.findOne(requisitionId, tenantId));
  }

  async findAll(query: QueryFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId } = await this.forecast.resolveFarm(query.farmId, tenantId, user?.userType);
    const conditions = [
      eq(schema.requisition.tenant_id, tenantId),
      eq(schema.requisition.farm_id, farmId),
      eq(schema.requisition.doc_type, FEED_DOC_TYPE),
      isNull(schema.requisition.deleted_at),
    ];
    if (query.status) conditions.push(eq(schema.requisition.status, query.status));
    return this.db
      .select({
        requisition_id: schema.requisition.requisition_id,
        req_no: schema.requisition.req_no,
        requisition_type: schema.requisition.requisition_type,
        status: schema.requisition.status,
        priority: schema.requisition.priority,
        required_date: schema.requisition.required_date,
        submission_deadline: schema.requisition.submission_deadline,
        created_at: schema.requisition.created_at,
        line_count: sql<number>`(SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = ${schema.requisition.requisition_id})`,
        requested_kg: sql<string>`(SELECT COALESCE(SUM(rl.quantity), 0) FROM requisition_line rl WHERE rl.requisition_id = ${schema.requisition.requisition_id})`,
      })
      .from(schema.requisition)
      .where(and(...conditions))
      .orderBy(desc(schema.requisition.created_at))
      .limit(200);
  }

  async findOne(requisitionId: string, tenantId: string) {
    const [row] = await this.db
      .select({ req: schema.requisition, farm_code: schema.locationMaster.location_code, truck_target_kg: schema.locationMaster.feed_truck_target_kg })
      .from(schema.requisition)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.requisition.farm_id))
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(),
      ))
      .limit(1);
    if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    const destination = schema.locationMaster;
    const lines = await this.db
      .select({
        line: schema.requisitionLine,
        item_code: schema.itemMaster.item_code,
        item_name: schema.itemMaster.item_name,
        destination_code: destination.location_code,
      })
      .from(schema.requisitionLine)
      .leftJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.requisitionLine.item_id))
      .leftJoin(destination, eq(destination.location_id, schema.requisitionLine.destination_location_id))
      .where(eq(schema.requisitionLine.requisition_id, requisitionId))
      .orderBy(schema.requisitionLine.line_seq);
    // Requisition §1 row 26: "Sum of requested bulk quantities this cycle", shown against the 30,000 kg truck target (row 27) — trips, not a cap (checkpoint 17).
    const farmTotal = lines.filter((l) => l.line.feed_type === 'BULK').reduce((sum, l) => sum + Number(l.line.quantity), 0);
    const truckTarget = row.truck_target_kg ?? 30000;
    return {
      ...row.req,
      farm_code: row.farm_code,
      lines: lines.map((l) => ({ ...l.line, item_code: l.item_code, item_name: l.item_name, destination_code: l.destination_code })),
      farm_total_requested_kg: farmTotal,
      truck_target_kg: truckTarget,
      truck_trips: farmTotal > 0 ? Math.ceil(farmTotal / truckTarget) : 0,
    };
  }
}
```

`OPEN_FEED_STATUSES` is exported for Task 9's `lockOpen`.

- [ ] **Step 6: Controller and module**

`feed-requisition.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { FeedRequisitionService } from './feed-requisition.service';
import { AutoDraftFeedRequisitionDto, CreateManualFeedRequisitionDto, QueryFeedRequisitionDto } from './dto/feed-requisition.dto';

// Feed requisitions ride the Procurement Requisition grant: they are
// requisitions (doc_type FEED), approved by whoever may approve requisitions,
// and only for a farm in the caller's scope (checkpoint 19).
@ApiTags('Feed Requisitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('feed-requisition')
export class FeedRequisitionController {
  constructor(private readonly feedRequisitions: FeedRequisitionService) {}

  @Get()
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: "One farm's feed requisitions, newest first" })
  async findAll(@Query() query: QueryFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.findAll(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisitions retrieved successfully.', data };
  }

  @Post('auto-draft')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Draft (or refresh) the farm\'s AUTO_DRAFT requisition for this cycle from the feed forecast (Engine Step 9)' })
  async autoDraft(@Body() dto: AutoDraftFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.autoDraft(dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: data.requisitionId ? 'Feed requisition drafted.' : 'Nothing to order: stock covers the forecast.', data };
  }

  @Post()
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Raise a MANUAL feed requisition (Requisition §1 row 7)' })
  async create(@Body() dto: CreateManualFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.createManual(dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition created.', data };
  }

  @Get(':id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiParam({ name: 'id' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const data = await this.feedRequisitions.findOne(id, req.user?.tenantId || req['tenantId']);
    return { success: true, message: 'Feed requisition retrieved successfully.', data };
  }
}
```

`feed-requisition.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ApprovalModule } from '../../production/approval/approval.module';
import { FeedForecastModule } from '../../inventory/feed-forecast/feed-forecast.module';
import { FeedAlertModule } from '../../inventory/feed-alert/feed-alert.module';
import { FeedRequisitionController } from './feed-requisition.controller';
import { FeedRequisitionService } from './feed-requisition.service';

@Module({
  imports: [ApprovalModule, FeedForecastModule, FeedAlertModule],
  controllers: [FeedRequisitionController],
  providers: [FeedRequisitionService],
})
export class FeedRequisitionModule {}
```

Register in `app.module.ts`; add `FeedRequisitionController` to `SCOPED` in `farm-scope-coverage.spec.ts`.

- [ ] **Step 7: Run** `pnpm nx test api -- feed-requisition farm-scope-coverage` → PASS; `pnpm nx run-many -t typecheck -p api` → PASS.

- [ ] **Step 8: Rebuild, restart, call it once.** `pnpm nx run api:build`; restart the API by the PID from `lsof -ti :2877` (never `pkill`); log in as the company admin documented in `docs/HANDOFF-2026-09-14.md` §8 and `POST /api/v1/feed-requisition/auto-draft` with `{ "farmId": "<VIL100 location_id>" }` and the four scope headers. Keep the response for Task 12.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/procurement/feed-requisition apps/api/src/app.module.ts apps/api/src/common/farm-scope-coverage.spec.ts
git commit -m "feat(feed-requisition): auto-draft from the forecast, manual entry, read

Engine Step 9: one AUTO_DRAFT per farm per submission cycle, updated in
place on rerun — snapshots and recommendation refreshed, a farm-edited
quantity kept, lines already on another requisition of the cycle not
drafted again. Requisition sheet §1: type FEED_FORECAST/MANUAL, purpose
INTERNAL_TRANSFER, source MILL, REQ-FarmCode-YYYY-NNNNN.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Feed requisition — edit, approve (own farm, 20 % remarks, deadline), reject

Requisition §4 step 3: "Can edit Requested Qty and Required By Date." Step 4 / checkpoint 18: "If Qty deviates more than 20% from Recommended: Remarks mandatory." Checkpoint 19: "Farm Manager can only approve requisitions for their own farm. Cross-farm approval not allowed." Checkpoint 22 and Q5: after the deadline, remarks record the authorized exception. Q3: approve directly from AUTO_DRAFT / DRAFT / PENDING_APPROVAL, raising the approval request in the same transaction when there is none. The generic `/requisition` submit/approve path must not bypass these rules for FEED documents.

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts` (append `approvalProblems`) and its spec
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` (append methods), `feed-requisition.controller.ts` (three routes)
- Modify: `apps/api/src/modules/procurement/requisition/requisition.service.ts` (refuse FEED in `submit`, `decide`, `linkPo`)
- Test: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts`, `apps/api/src/modules/procurement/requisition/requisition.service.feed.spec.ts`

**Interfaces:**
- Consumes: Task 8's service internals (`loadFarm`, `scopeConditions`, `findOne`, `OPEN_FEED_STATUSES`), `ApprovalService.create/approve/reject`, `userHasPermission`.
- Produces:

```ts
// rules
export interface ApprovalLine { lineSeq: number; itemName: string; quantityKg: number; recommendedQtyKg: number | null }
export function approvalProblems(args: { lines: ApprovalLine[]; remarks: string | null | undefined; today: string; submissionDeadline: string | null }): string[];
// service
update(id: string, dto: UpdateFeedRequisitionDto, tenantId: string, user: UserCtx): Promise<FeedRequisitionView>;
approve(id: string, dto: DecideFeedRequisitionDto, tenantId: string, user: UserCtx): Promise<FeedRequisitionView>;
reject(id: string, dto: DecideFeedRequisitionDto, tenantId: string, user: UserCtx): Promise<FeedRequisitionView>;
```
- REST: `PUT /feed-requisition/:id` (`create`), `POST /feed-requisition/:id/approve` and `/:id/reject` (`approve`).

- [ ] **Step 1: Write the failing tests**

Append to `feed-requisition.rules.spec.ts` (add `approvalProblems` to the import):

```ts
describe('approvalProblems — checkpoints 18 and 22', () => {
  const r1Line = { lineSeq: 1, itemName: 'Weaner Diet R1', quantityKg: 9000, recommendedQtyKg: 6000 };

  it('names the line that deviates more than 20 % when there are no remarks — 6,000 → 9,000 kg', () => {
    expect(approvalProblems({ lines: [r1Line], remarks: '  ', today: '2026-09-23', submissionDeadline: '2026-09-26' }))
      .toEqual(['Line 1 (Weaner Diet R1): requested 9,000 kg is more than 20% from the recommended 6,000 kg — remarks are required.']);
  });
  it('accepts it with remarks', () => {
    expect(approvalProblems({ lines: [r1Line], remarks: 'Extra pigs arriving', today: '2026-09-23', submissionDeadline: '2026-09-26' })).toEqual([]);
  });
  it('accepts exactly 20 % and a manual line without remarks', () => {
    expect(approvalProblems({ lines: [{ ...r1Line, quantityKg: 7200 }, { lineSeq: 2, itemName: 'X', quantityKg: 50000, recommendedQtyKg: null }], remarks: null, today: '2026-09-23', submissionDeadline: '2026-09-26' })).toEqual([]);
  });
  it('needs remarks after the deadline (Q5)', () => {
    expect(approvalProblems({ lines: [{ ...r1Line, quantityKg: 6000 }], remarks: null, today: '2026-09-27', submissionDeadline: '2026-09-26' }))
      .toEqual(['The submission deadline 2026-09-26 has passed — give remarks to approve it as an exception.']);
  });
  it('refuses a requisition with no lines', () => {
    expect(approvalProblems({ lines: [], remarks: 'x', today: '2026-09-23', submissionDeadline: null })).toEqual(['A requisition needs at least one line to be approved.']);
  });
});
```

`feed-requisition.approve.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { FeedRequisitionService } from './feed-requisition.service';

/** Checkpoint 19: "BLOCK: Porta Farm Manager cannot approve GRS requisition." */
describe('FeedRequisitionService.approve — own farm only', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, leftJoin: () => self, orderBy: () => self, limit: () => self,
      for: async () => rows, then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const selectQueue: unknown[][] = [];
  const db: any = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), update: jest.fn(), insert: jest.fn() };
  const approvals = { create: jest.fn(), approve: jest.fn() };

  function serviceFor(scope: { farmId: string | null; restricted: boolean }) {
    const cls = transactionCls(db);
    useFarmScope(cls, { ...scope, companyId: 'co-1', lobId: null });
    return new FeedRequisitionService(cls, {} as any, approvals as any, { evaluateFarmSafely: jest.fn() } as any);
  }

  beforeEach(() => { selectQueue.length = 0; jest.clearAllMocks(); });

  it("answers not found when a user pinned to another farm approves this farm's requisition, writing nothing", async () => {
    selectQueue.push([{ requisition_id: 'req-1', farm_id: 'farm-grs', company_id: 'co-1', status: 'AUTO_DRAFT', req_no: 'REQ-GRS-2026-00041', doc_type: 'FEED' }]);
    const service = serviceFor({ farmId: 'farm-porta', restricted: true });
    await expect(service.approve('req-1', {}, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.update).not.toHaveBeenCalled();
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('refuses a caller without the requisition approve permission', async () => {
    const service = serviceFor({ farmId: null, restricted: false });
    await expect(service.approve('req-1', {}, 'tenant-1', { userType: 'STANDARD_USER' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

`requisition.service.feed.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { RequisitionService } from './requisition.service';

/** Feed requisitions carry the 20 % remark, own-farm and deadline rules; the generic path must not approve them around those. */
describe('RequisitionService refuses FEED documents', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: () => self, for: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const feedRow = { requisition_id: 'req-1', req_no: 'REQ-GRS-2026-00041', doc_type: 'FEED', status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', company_id: 'co-1' };
  const db: any = { select: jest.fn(() => chain([feedRow])), update: jest.fn() };
  const service = new RequisitionService(transactionCls(db), { approve: jest.fn(), create: jest.fn() } as any);

  it('on submit', async () => {
    await expect(service.submit('req-1', undefined, 'tenant-1', { userType: 'TENANT_ADMIN' }))
      .rejects.toThrow(new BadRequestException('Feed requisitions are decided on Inventory → Feed Requisitions.'));
  });
  it('on approve', async () => {
    await expect(service.decide('req-1', {}, 'APPROVED', 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' } as any))
      .rejects.toThrow('Feed requisitions are decided on Inventory → Feed Requisitions.');
    expect(db.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `pnpm nx test api -- feed-requisition requisition.service.feed` → FAIL.

- [ ] **Step 3: Rules** — append to `feed-requisition.rules.ts`:

```ts
export interface ApprovalLine {
  lineSeq: number;
  itemName: string;
  quantityKg: number;
  recommendedQtyKg: number | null;
}

const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * What stops an approval (Requisition §4 step 4). Remarks answer both the 20 %
 * deviation (checkpoint 18) and a late approval (checkpoint 22, Q5); they are
 * one field on the header (row 36), so one set of remarks covers every line.
 */
export function approvalProblems(args: { lines: ApprovalLine[]; remarks: string | null | undefined; today: string; submissionDeadline: string | null }): string[] {
  const problems: string[] = [];
  if (!args.lines.length) return ['A requisition needs at least one line to be approved.'];
  if (args.remarks?.trim()) return problems;
  for (const l of args.lines) {
    if (deviationNeedsRemarks(l.recommendedQtyKg, l.quantityKg)) {
      problems.push(`Line ${l.lineSeq} (${l.itemName}): requested ${kg(l.quantityKg)} kg is more than 20% from the recommended ${kg(l.recommendedQtyKg ?? 0)} kg — remarks are required.`);
    }
  }
  if (args.submissionDeadline && args.today > args.submissionDeadline) {
    problems.push(`The submission deadline ${args.submissionDeadline} has passed — give remarks to approve it as an exception.`);
  }
  return problems;
}
```

- [ ] **Step 4: Service** — add `ForbiddenException` to the `@nestjs/common` import, `import { userHasPermission } from '../../../common/permissions';`, `approvalProblems` to the rules import, `DecideFeedRequisitionDto, FeedLineEditInput, UpdateFeedRequisitionDto` to the DTO import, and append these methods to `FeedRequisitionService`:

```ts
  private async assertMayDecide(user: UserCtx) {
    const may = await userHasPermission(this.db, user, { moduleCode: 'PROCUREMENT', resource: 'REQUISITION', action: 'approve' });
    if (!may) throw new ForbiddenException('You are not allowed to decide requisitions.');
  }

  /**
   * An open feed requisition of the caller's farm, locked. Checkpoint 19 is
   * enforced twice on purpose: the scope conditions filter the read, and the
   * row's farm is compared again, so a farm-pinned user can never act on
   * another farm's requisition even if a condition is dropped by a refactor.
   */
  private async lockOpen(requisitionId: string, tenantId: string) {
    const [row] = await this.db
      .select()
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(),
      ))
      .limit(1)
      .for('update');
    const scope = farmScope(this.cls);
    if (!row || (scope.farmId && row.farm_id !== scope.farmId)) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    if (!OPEN_FEED_STATUSES.includes(row.status)) {
      throw new BadRequestException(`Requisition ${row.req_no} is ${row.status} and can no longer be changed.`);
    }
    return row;
  }

  private async applyLineEdits(requisitionId: string, edits: FeedLineEditInput[] | undefined, farmId: string | null, tenantId: string) {
    if (!edits?.length) return;
    const settings = farmId ? (await this.loadFarm(farmId, tenantId)).settings : undefined;
    for (const edit of edits) {
      const [line] = await this.db
        .select({ line_id: schema.requisitionLine.line_id, feed_type: schema.requisitionLine.feed_type, quantity: schema.requisitionLine.quantity })
        .from(schema.requisitionLine)
        .where(and(eq(schema.requisitionLine.line_id, edit.line_id), eq(schema.requisitionLine.requisition_id, requisitionId)))
        .limit(1);
      if (!line) throw new BadRequestException(`Line ${edit.line_id} is not on this requisition.`);
      const quantity = edit.quantity_kg ?? Number(line.quantity);
      await this.db.update(schema.requisitionLine).set({
        quantity: String(quantity),
        // §2 row 54: Bag Count = Requested Qty ÷ bag size, for bagged lines.
        bag_count: settings ? bagCountFor(quantity, (line.feed_type ?? 'BULK') as FeedType, settings) : null,
        ...(edit.proposed_delivery_date ? { proposed_delivery_date: edit.proposed_delivery_date } : {}),
      }).where(eq(schema.requisitionLine.line_id, edit.line_id));
    }
  }

  async update(id: string, dto: UpdateFeedRequisitionDto, tenantId: string, user: UserCtx) {
    await withTenantTransaction(this.cls, async () => {
      const row = await this.lockOpen(id, tenantId);
      await this.applyLineEdits(id, dto.lines, row.farm_id, tenantId);
      await this.db.update(schema.requisition).set({
        ...(dto.remarks !== undefined ? { remarks: dto.remarks.trim() || null } : {}),
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, id));
    });
    return this.findOne(id, tenantId);
  }

  async approve(id: string, dto: DecideFeedRequisitionDto, tenantId: string, user: UserCtx) {
    await this.assertMayDecide(user);
    const decided = await withTenantTransaction(this.cls, async () => {
      const row = await this.lockOpen(id, tenantId);
      await this.applyLineEdits(id, dto.lines, row.farm_id, tenantId);
      const lines = await this.db
        .select({
          line_seq: schema.requisitionLine.line_seq,
          description: schema.requisitionLine.description,
          quantity: schema.requisitionLine.quantity,
          recommended: schema.requisitionLine.recommended_qty_kg,
        })
        .from(schema.requisitionLine)
        .where(eq(schema.requisitionLine.requisition_id, id))
        .orderBy(schema.requisitionLine.line_seq);
      const remarks = dto.remarks?.trim() || row.remarks || null;
      const problems = approvalProblems({
        lines: lines.map((l) => ({ lineSeq: l.line_seq, itemName: l.description ?? '', quantityKg: Number(l.quantity), recommendedQtyKg: l.recommended == null ? null : Number(l.recommended) })),
        remarks,
        today: serverToday(),
        submissionDeadline: row.submission_deadline,
      });
      if (problems.length) throw new BadRequestException(problems.join(' '));

      // Q3: one action from AUTO_DRAFT/DRAFT; the approval engine still records the decision.
      let requestId = row.approval_request_id;
      if (!requestId) {
        const [farm] = row.farm_id
          ? await this.db.select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
              .from(schema.locationMaster).where(eq(schema.locationMaster.location_id, row.farm_id)).limit(1)
          : [];
        const created = await this.approvals.create({
          company_id: row.company_id,
          doc_type: 'REQUISITION',
          title: `Feed requisition ${row.req_no}`,
          location_label: farm ? `${farm.code} — ${farm.name ?? ''}`.trim() : undefined,
          urgency: row.priority === 'CRITICAL_FIRST_PRIORITY' || row.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
          item_or_stage: 'FEED',
          justification: remarks ?? undefined,
        } as any, tenantId, user);
        requestId = created.request_id;
      }
      await this.approvals.approve(requestId!, tenantId, user);
      await this.db.update(schema.requisition).set({
        status: 'APPROVED',
        approval_request_id: requestId,
        remarks,
        approved_by: user?.userId ?? null,
        approved_at: nowTs(),
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, id));
      return { farmId: row.farm_id, companyId: row.company_id };
    });
    // Its REQ_DEADLINE alerts close now, not at the next evaluation.
    await this.feedAlerts.evaluateFarmSafely(decided.farmId, decided.companyId, tenantId);
    return this.findOne(id, tenantId);
  }

  async reject(id: string, dto: DecideFeedRequisitionDto, tenantId: string, user: UserCtx) {
    await this.assertMayDecide(user);
    const reason = dto.rejection_reason?.trim();
    if (!reason) throw new BadRequestException('A rejection reason is required.');
    const decided = await withTenantTransaction(this.cls, async () => {
      const row = await this.lockOpen(id, tenantId);
      if (row.approval_request_id) {
        await this.approvals.reject(row.approval_request_id, { rejection_reason: reason } as any, tenantId, user);
      }
      await this.db.update(schema.requisition).set({
        status: 'REJECTED',
        remarks: row.remarks ? `${row.remarks}\nRejected: ${reason}` : `Rejected: ${reason}`,
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, id));
      return { farmId: row.farm_id, companyId: row.company_id };
    });
    await this.feedAlerts.evaluateFarmSafely(decided.farmId, decided.companyId, tenantId);
    return this.findOne(id, tenantId);
  }
```

- [ ] **Step 5: Controller routes** — append to `FeedRequisitionController` (import `Put` and the two DTOs):

```ts
  @Put(':id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Edit requested quantities, delivery dates and remarks of an open feed requisition' })
  async update(@Param('id') id: string, @Body() dto: UpdateFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.update(id, dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition saved.', data };
  }

  @Post(':id/approve')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Approve: own farm only (cp. 19), remarks over 20 % deviation (cp. 18) or after the deadline (cp. 22)' })
  async approve(@Param('id') id: string, @Body() dto: DecideFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.approve(id, dto ?? {}, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition approved.', data };
  }

  @Post(':id/reject')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Reject with a reason' })
  async reject(@Param('id') id: string, @Body() dto: DecideFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.reject(id, dto ?? {}, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition rejected.', data };
  }
```

- [ ] **Step 6: Generic path** — in `requisition.service.ts` add

```ts
/** Feed requisitions have their own rules (remarks over 20 %, own farm, deadline) — Feed Forecast Plan B. */
const FEED_ELSEWHERE = 'Feed requisitions are decided on Inventory → Feed Requisitions.';
```

and in `submit`, `decide` and `linkPo`, directly after each `if (!row) throw new NotFoundException(…)`:

```ts
      if (row.doc_type === 'FEED') throw new BadRequestException(FEED_ELSEWHERE);
```

(`linkPo` selects only `status`; add `doc_type: schema.requisition.doc_type` to its select.) Update the file header comment's "the feed-forecast auto-draft lands with Phase 10" to "feed requisitions (doc_type FEED) are drafted and decided by feed-requisition.service.ts and refused here".

- [ ] **Step 7: Run** `pnpm nx test api -- feed-requisition requisition` → PASS; typecheck → PASS; `pnpm nx test web -- role-permissions-coverage` → PASS (`PROCUREMENT/REQUISITION` already offered).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/procurement
git commit -m "feat(feed-requisition): edit, approve and reject with the workbook's controls

Checkpoint 18: remarks when requested deviates more than 20 % from
recommended. Checkpoint 19: only a requisition of the approver's own farm.
Checkpoint 22: after the Saturday deadline, remarks are the recorded
exception. Approval goes through the approval engine in one action from
AUTO_DRAFT; the generic /requisition path now refuses FEED documents so
these rules cannot be bypassed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Web — Inventory → Feed Requisitions

The first requisition screen (spec Plan B). Requisition §4 step 3: the Farm Manager "Reviews: Silo, Current Diet …, Feed Item to Order, Qty, Required By Date. Checks farm total vs 30-ton target. Can edit Requested Qty and Required By Date"; the system shows "System Balance, Days Remaining, Recommended Qty, Farm Total Order KG, Submission Deadline". Column names are §2's; "Unrounded Need" is shown because checkpoint 16 says "Show recommended 3000 KG rounding and unrounded need". Silo balance is labelled System Balance (checkpoint 37).

**Files:**
- Create: `apps/web/src/components/console/inventory/use-feed-farm.ts`
- Create: `apps/web/src/components/console/inventory/feed-requisition-panel.tsx`
- Create: `apps/web/src/app/(app)/inventory/feed-requisitions/page.tsx`
- Modify: `apps/web/src/components/console/inventory/inventory-page-shell.tsx` (section + title + description)
- Modify: `apps/web/src/utils/translations.ts` (`en` only)
- Test: `apps/web/specs/feed-requisition-panel.spec.tsx`

**Interfaces:**
- Consumes: `GET /feed-requisition?farmId=`, `GET /feed-requisition/:id`, `POST /feed-requisition/auto-draft`, `PUT /feed-requisition/:id`, `POST /feed-requisition/:id/approve|reject` (Tasks 8–9); `getStoredUser`, `getActiveFarmId` from `@/hooks/useAuth`; `/location?locationType=FARM&rootOnly=true&isActive=true`.
- Produces: `useFeedFarm(): { farmId: string | null; setFarmId: (id: string) => void; farms: FarmItem[]; isFixed: boolean; fixedFarm: { location_code?: string; location_name?: string } | null }` (also used by Task 11); `needsRemarks(recommended: number | null, requested: number): boolean` exported from the panel.

- [ ] **Step 1: Write the failing test** — `apps/web/specs/feed-requisition-panel.spec.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FeedRequisitionPanel, { needsRemarks } from '../src/components/console/inventory/feed-requisition-panel';
import { api } from '../src/services/api-client';
import { getStoredUser, getActiveFarmId } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getStoredUser: jest.fn(), getActiveFarmId: jest.fn() }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

// The Worked Example drafted: R1 6,000 kg to SILO1, R2 9,000 kg (next diet, 3 days) to SILO2.
const view = {
  requisition_id: 'req-1', req_no: 'REQ-GRS-2026-00041', requisition_type: 'FEED_FORECAST', source: 'AUTO_FORECAST',
  purpose: 'INTERNAL_TRANSFER', supply_source: 'MILL', status: 'AUTO_DRAFT', priority: 'CRITICAL',
  production_date: '2099-09-27', submission_deadline: '2099-09-26', required_date: '2099-09-23', remarks: null,
  farm_code: 'GRS', farm_total_requested_kg: 15000, truck_target_kg: 30000, truck_trips: 1,
  lines: [
    { line_id: 'L1', line_seq: 1, destination_code: 'GRS/SILO-001', item_code: 'FEED-R1', item_name: 'Weaner Diet R1', feed_type: 'BULK',
      is_next_diet: false, days_before_diet_change: null, system_balance_kg: '1500.0000', daily_requirement_kg: '2000.0000', days_remaining: 0,
      unrounded_need_kg: '4500.0000', recommended_qty_kg: '6000.0000', quantity: '6000.0000', bag_count: null, proposed_delivery_date: '2099-09-23', needs_silo_changeover: false },
    { line_id: 'L2', line_seq: 2, destination_code: 'GRS/SILO-002', item_code: 'FEED-R2', item_name: 'Weaner Diet R2', feed_type: 'BULK',
      is_next_diet: true, days_before_diet_change: 3, system_balance_kg: '1000.0000', daily_requirement_kg: '2500.0000', days_remaining: null,
      unrounded_need_kg: '9000.0000', recommended_qty_kg: '9000.0000', quantity: '9000.0000', bag_count: null, proposed_delivery_date: '2099-09-26', needs_silo_changeover: false },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (getStoredUser as jest.Mock).mockReturnValue({ userId: 'u1', userType: 'STANDARD_USER', farmId: 'farm-grs', farm: { location_code: 'GRS', location_name: 'Grasmere' } });
  (getActiveFarmId as jest.Mock).mockReturnValue(null);
  get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: view } : { data: [] }));
  post.mockImplementation(async (url: string) => (url === '/feed-requisition/auto-draft' ? { data: { requisitionId: 'req-1', created: true, linesDrafted: 2, requisition: view } } : { data: view }));
});

describe('needsRemarks — checkpoint 18', () => {
  it('matches the API rule', () => {
    expect(needsRemarks(6000, 9000)).toBe(true);
    expect(needsRemarks(6000, 7200)).toBe(false);
    expect(needsRemarks(null, 50000)).toBe(false);
    expect(needsRemarks(0, 3000)).toBe(true);
  });
});

describe('FeedRequisitionPanel', () => {
  it('drafts from the forecast for the user\'s own farm and shows the §2 columns', async () => {
    render(<FeedRequisitionPanel />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition?farmId=farm-grs'));
    expect(screen.queryByLabelText('frqFarm')).toBeNull(); // STANDARD_USER: no farm choice (D13)

    fireEvent.click(screen.getByRole('button', { name: 'frqDraftFromForecast' }));
    await screen.findByText('REQ-GRS-2026-00041');
    expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-grs' });
    for (const h of ['frqColLine', 'frqColDestination', 'frqColItem', 'frqColFeedType', 'frqColNextDiet', 'frqColDaysBeforeChange',
      'frqColSystemBalance', 'frqColDailyRequirement', 'frqColDaysRemaining', 'frqColUnroundedNeed', 'frqColRecommended',
      'frqColRequested', 'frqColBagCount', 'frqColDelivery']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy();
    }
    expect(screen.getByText('frqFarmTotal:{"total":"15,000","target":"30,000","trips":1}')).toBeTruthy();
  });

  it('asks for remarks when a requested quantity moves more than 20 % and blocks Approve until given', async () => {
    render(<FeedRequisitionPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'frqDraftFromForecast' }));
    await screen.findByText('REQ-GRS-2026-00041');

    fireEvent.change(screen.getByLabelText('frqRequestedFor:{"line":1}'), { target: { value: '9000' } });
    expect(screen.getByText('frqRemarksRequired')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'frqApprove' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('frqRemarks'), { target: { value: 'Extra pigs arriving' } });
    const approve = screen.getByRole('button', { name: 'frqApprove' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/req-1/approve', {
      remarks: 'Extra pigs arriving', lines: [{ line_id: 'L1', quantity_kg: 9000 }],
    }));
  });
});
```

- [ ] **Step 2: Run** `pnpm nx test web -- feed-requisition-panel` → FAIL (module not found).

- [ ] **Step 3: Farm hook** — `use-feed-farm.ts`:

```ts
"use client";

/**
 * The farm a feed screen shows (spec D13), shared by Feed Requisitions and
 * Feed Alerts: a STANDARD_USER's farm is their own and never a choice; every
 * other user type picks from the active company's farms, defaulting to the
 * pinned one. farmId is always sent explicitly, as the Feed Forecast page
 * does, because the API client only sends x-active-farm-id when one is pinned.
 */
import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { getActiveFarmId, getStoredUser } from "@/hooks/useAuth";

export interface FarmItem {
  location_id: string;
  location_code: string;
  location_name: string;
}

export function useFeedFarm() {
  const user = getStoredUser() as any;
  const isFixed = user?.userType === "STANDARD_USER";
  const fixedFarmId: string | null = isFixed ? user?.farmId ?? user?.farm_id ?? null : null;
  const [farmId, setFarmId] = useState<string | null>(() => fixedFarmId ?? getActiveFarmId());
  const [farms, setFarms] = useState<FarmItem[]>([]);

  useEffect(() => {
    if (isFixed) return;
    let alive = true;
    api
      .get("/location?locationType=FARM&rootOnly=true&isActive=true")
      .then((res: any) => {
        if (!alive) return;
        const list: FarmItem[] = (res?.data ?? res) || [];
        setFarms(list);
        setFarmId((current) => current ?? list[0]?.location_id ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isFixed]);

  return { farmId, setFarmId, farms, isFixed, fixedFarm: isFixed ? (user?.farm ?? null) : null };
}
```

- [ ] **Step 4: Panel** — `feed-requisition-panel.tsx`:

```tsx
"use client";

/**
 * Inventory → Feed Requisitions (Feed Forecast Plan B, Task 10). The farm's
 * feed requisitions; "Draft from forecast" runs Engine Step 9 on the server
 * (POST /feed-requisition/auto-draft), and a draft opens with the Requisition
 * sheet §2 columns. The farm edits Requested Qty and the delivery date,
 * writes remarks, and approves or rejects (§4 steps 3–4). The 20 % remark
 * rule and the deadline rule are mirrored here only to say so before the
 * click; the API enforces both (checkpoints 18 and 22).
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useFeedFarm } from "./use-feed-farm";

interface ListRow {
  requisition_id: string;
  req_no: string;
  requisition_type: string | null;
  status: string;
  priority: string | null;
  required_date: string | null;
  submission_deadline: string | null;
  line_count: number;
  requested_kg: string | number;
}

interface Line {
  line_id: string;
  line_seq: number;
  destination_code: string | null;
  item_code: string | null;
  item_name: string | null;
  feed_type: string | null;
  is_next_diet: boolean;
  days_before_diet_change: number | null;
  system_balance_kg: string | null;
  daily_requirement_kg: string | null;
  days_remaining: number | null;
  unrounded_need_kg: string | null;
  recommended_qty_kg: string | null;
  quantity: string;
  bag_count: number | null;
  proposed_delivery_date: string | null;
  needs_silo_changeover: boolean;
}

interface View {
  requisition_id: string;
  req_no: string;
  requisition_type: string | null;
  source: string | null;
  purpose: string | null;
  supply_source: string | null;
  status: string;
  priority: string | null;
  production_date: string | null;
  submission_deadline: string | null;
  remarks: string | null;
  truck_target_kg: number;
  lines: Line[];
}

const OPEN = ["AUTO_DRAFT", "DRAFT", "PENDING_APPROVAL"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Checkpoint 18, as the API applies it (feed-requisition.rules.ts deviationNeedsRemarks). */
export function needsRemarks(recommended: number | null, requested: number): boolean {
  if (recommended === null) return false;
  if (recommended <= 0) return requested > 0;
  return Math.abs(requested - recommended) / recommended > 0.2 + 1e-9;
}

function unwrap<T>(res: any): T {
  return (res?.data ?? res) as T;
}
const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const kg = (v: string | number | null | undefined) => {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  CRITICAL_FIRST_PRIORITY: "danger", CRITICAL: "danger", WARNING: "warning", INFO: "info",
};

export default function FeedRequisitionPanel() {
  const { t } = useLanguage();
  const { farmId, setFarmId, farms, isFixed, fixedFarm } = useFeedFarm();
  const [rows, setRows] = useState<ListRow[]>([]);
  const [selected, setSelected] = useState<View | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    setError("");
    try {
      setRows(unwrap<ListRow[]>(await api.get(`/feed-requisition?farmId=${farmId}`)) || []);
    } catch (err: any) {
      setError(err?.message || "frqLoadFailed");
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const show = (view: View | null) => {
    setSelected(view);
    setEdits({});
    setRemarks(view?.remarks ?? "");
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err: any) {
      setError(err?.message || "frqActionFailed");
    } finally {
      setBusy(false);
    }
  };

  const openRequisition = (id: string) => run(async () => show(unwrap<View>(await api.get(`/feed-requisition/${id}`))));

  const draftFromForecast = () =>
    run(async () => {
      const result = unwrap<{ requisition: View | null }>(await api.post("/feed-requisition/auto-draft", { farmId }));
      if (result.requisition) show(result.requisition);
      else setNotice(t("frqNothingToOrder"));
      await loadList();
    });

  const requestedOf = (line: Line) => (edits[line.line_id] !== undefined ? Number(edits[line.line_id]) : Number(line.quantity));
  const lineEdits = () => Object.entries(edits).map(([line_id, value]) => ({ line_id, quantity_kg: Number(value) }));

  const editable = !!selected && OPEN.includes(selected.status);
  const deviating = selected ? selected.lines.filter((l) => needsRemarks(num(l.recommended_qty_kg), requestedOf(l))) : [];
  const late = !!selected?.submission_deadline && todayIso() > selected.submission_deadline;
  const remarksMissing = (deviating.length > 0 || late) && !remarks.trim();
  // Requisition §1 row 26: requested bulk total vs the truck target (row 27) — trips, not a cap (checkpoint 17).
  const bulkTotal = selected ? selected.lines.filter((l) => l.feed_type === "BULK").reduce((sum, l) => sum + requestedOf(l), 0) : 0;
  const trips = selected && bulkTotal > 0 ? Math.ceil(bulkTotal / selected.truck_target_kg) : 0;

  const save = () =>
    run(async () => {
      show(unwrap<View>(await api.put(`/feed-requisition/${selected!.requisition_id}`, { remarks, lines: lineEdits() })));
      setNotice(t("frqSaved"));
    });

  const approve = () =>
    run(async () => {
      show(unwrap<View>(await api.post(`/feed-requisition/${selected!.requisition_id}/approve`, { remarks, lines: lineEdits() })));
      setNotice(t("frqApproved"));
      await loadList();
    });

  const reject = () =>
    run(async () => {
      if (!remarks.trim()) throw new Error(t("frqRejectNeedsReason"));
      show(unwrap<View>(await api.post(`/feed-requisition/${selected!.requisition_id}/reject`, { rejection_reason: remarks })));
      await loadList();
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {isFixed ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {fixedFarm ? `${fixedFarm.location_code ?? ""} — ${fixedFarm.location_name ?? ""}` : ""}
          </p>
        ) : (
          <Field label={t("frqFarm")} htmlFor="frq-farm">
            <select id="frq-farm" aria-label={t("frqFarm")} className="nf-input-sm px-2" value={farmId ?? ""} onChange={(e) => { setFarmId(e.target.value); show(null); }}>
              {farms.map((f) => (
                <option key={f.location_id} value={f.location_id}>{f.location_code} — {f.location_name}</option>
              ))}
            </select>
          </Field>
        )}
        <Button onClick={draftFromForecast} disabled={!farmId || busy}>{t("frqDraftFromForecast")}</Button>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <InlineAlert variant="success">{notice}</InlineAlert>}

      {loading ? (
        <div className="p-10 text-center text-xs"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("frqLoading")}</div>
      ) : rows.length === 0 && !selected ? (
        <div className="p-10 text-center text-xs"><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("frqNone")}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("frqColReqNo")}</TableHead>
              <TableHead>{t("frqColType")}</TableHead>
              <TableHead>{t("frqColStatus")}</TableHead>
              <TableHead>{t("frqColPriority")}</TableHead>
              <TableHead>{t("frqColRequiredDelivery")}</TableHead>
              <TableHead>{t("frqColDeadline")}</TableHead>
              <TableHead>{t("frqColLines")}</TableHead>
              <TableHead>{t("frqColRequestedKg")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.requisition_id} onClick={() => openRequisition(r.requisition_id)} className="cursor-pointer">
                <TableCell>{r.req_no}</TableCell>
                <TableCell>{r.requisition_type ?? "—"}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{r.priority ? <Badge variant={PRIORITY_VARIANT[r.priority] ?? "neutral"}>{r.priority}</Badge> : "—"}</TableCell>
                <TableCell>{formatDate(r.required_date)}</TableCell>
                <TableCell>{formatDate(r.submission_deadline)}</TableCell>
                <TableCell>{r.line_count}</TableCell>
                <TableCell>{kg(r.requested_kg)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected && (
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{selected.req_no}</h3>
            <Badge>{selected.status}</Badge>
            {selected.priority && <Badge variant={PRIORITY_VARIANT[selected.priority] ?? "neutral"}>{selected.priority}</Badge>}
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {t("frqHeaderLine", {
              type: selected.requisition_type ?? "—", source: selected.source ?? "—", purpose: selected.purpose ?? "—",
              supply: selected.supply_source ?? "—", deadline: formatDate(selected.submission_deadline), production: formatDate(selected.production_date),
            })}
          </p>
          <p className="text-sm">{t("frqFarmTotal", { total: bulkTotal.toLocaleString("en-US"), target: selected.truck_target_kg.toLocaleString("en-US"), trips })}</p>

          <Table>
            <TableHeader>
              <TableRow>
                {["frqColLine", "frqColDestination", "frqColItem", "frqColFeedType", "frqColNextDiet", "frqColDaysBeforeChange",
                  "frqColSystemBalance", "frqColDailyRequirement", "frqColDaysRemaining", "frqColUnroundedNeed", "frqColRecommended",
                  "frqColRequested", "frqColBagCount", "frqColDelivery"].map((key) => (
                  <TableHead key={key}>{t(key as any)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.lines.map((line) => (
                <TableRow key={line.line_id}>
                  <TableCell>{line.line_seq}</TableCell>
                  <TableCell>
                    {line.destination_code ?? "—"}
                    {line.needs_silo_changeover && <Badge variant="warning" className="ml-1">{t("frqChangeover")}</Badge>}
                  </TableCell>
                  <TableCell>{line.item_code} — {line.item_name}</TableCell>
                  <TableCell>{line.feed_type ?? "—"}</TableCell>
                  <TableCell>{line.is_next_diet ? t("frqYes") : t("frqNo")}</TableCell>
                  <TableCell>{line.days_before_diet_change ?? "—"}</TableCell>
                  <TableCell>{kg(line.system_balance_kg)}</TableCell>
                  <TableCell>{kg(line.daily_requirement_kg)}</TableCell>
                  <TableCell>{line.days_remaining ?? "—"}</TableCell>
                  <TableCell>{kg(line.unrounded_need_kg)}</TableCell>
                  <TableCell>{kg(line.recommended_qty_kg)}</TableCell>
                  <TableCell>
                    {editable ? (
                      <input
                        type="number" min={0} step="any" className="nf-input-sm w-28 px-2"
                        aria-label={t("frqRequestedFor", { line: line.line_seq })}
                        value={edits[line.line_id] ?? String(Number(line.quantity))}
                        onChange={(e) => setEdits((cur) => ({ ...cur, [line.line_id]: e.target.value }))}
                      />
                    ) : (
                      kg(line.quantity)
                    )}
                  </TableCell>
                  <TableCell>{line.bag_count ?? "—"}</TableCell>
                  <TableCell>{formatDate(line.proposed_delivery_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Field label={t("frqRemarks")} htmlFor="frq-remarks">
            <textarea id="frq-remarks" aria-label={t("frqRemarks")} className="nf-input w-full px-2 py-1" rows={2}
              value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!editable} />
          </Field>
          {remarksMissing && <p className="text-xs" style={{ color: "var(--danger)" }}>{t("frqRemarksRequired")}</p>}

          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={save} disabled={busy}>{t("frqSave")}</Button>
              <Button onClick={approve} disabled={busy || remarksMissing}>{t("frqApprove")}</Button>
              <Button variant="destructive" onClick={reject} disabled={busy}>{t("frqReject")}</Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
```

The remarks warning is a plain paragraph rather than `Field`'s `error` prop so it renders exactly once whatever `Field` does with `error`.

- [ ] **Step 5: Route, shell, translations**

`apps/web/src/app/(app)/inventory/feed-requisitions/page.tsx`:

```tsx
"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import FeedRequisitionPanel from "@/components/console/inventory/feed-requisition-panel";

export default function InventoryFeedRequisitionsPage() {
  return (
    <InventoryPageShell activeKey="feed-requisitions">
      <FeedRequisitionPanel />
    </InventoryPageShell>
  );
}
```

In `inventory-page-shell.tsx` add to `INVENTORY_SECTIONS` after `feed-forecast`: `{ key: "feed-requisitions", href: "/inventory/feed-requisitions", labelKey: "invFeedRequisitions" },`; in `title`: `activeKey === "feed-requisitions" ? t("invFeedRequisitionsTitle") :`; in `description`: `activeKey === "feed-requisitions" ? t("invFeedRequisitionsDesc") :`.

`translations.ts`, `en` dictionary, next to `invFeedForecast…`:

```ts
    invFeedRequisitions: "Feed Requisitions",
    invFeedRequisitionsTitle: "Inventory → Feed Requisitions",
    invFeedRequisitionsDesc: "Feed ordered from the mill for each silo and diet: drafted from the forecast, reviewed and approved by the farm.",
    frqFarm: "Farm",
    frqDraftFromForecast: "Draft from forecast",
    frqNothingToOrder: "Nothing to order: stock covers the forecast, or every need is already on a requisition of this cycle.",
    frqLoading: "Loading requisitions…",
    frqNone: "No feed requisitions for this farm yet.",
    frqLoadFailed: "Feed requisitions could not be loaded.",
    frqActionFailed: "That did not work. Try again.",
    frqColReqNo: "Requisition No.",
    frqColType: "Type",
    frqColStatus: "Status",
    frqColPriority: "Priority",
    frqColRequiredDelivery: "Required Delivery",
    frqColDeadline: "Submission Deadline",
    frqColLines: "Lines",
    frqColRequestedKg: "Requested (KG)",
    frqHeaderLine: "{{type}} · {{source}} · {{purpose}} from {{supply}} · submit by {{deadline}} for production on {{production}}",
    frqFarmTotal: "Farm total requested (bulk): {{total}} KG against a {{target}} KG truck target — {{trips}} trip(s).",
    frqColLine: "Line No.",
    frqColDestination: "Destination Silo",
    frqColItem: "Feed Item No. to Order",
    frqColFeedType: "Feed Type",
    frqColNextDiet: "Next Diet",
    frqColDaysBeforeChange: "Days Before Diet Change",
    frqColSystemBalance: "System Balance (KG)",
    frqColDailyRequirement: "Daily Requirement (KG)",
    frqColDaysRemaining: "Days Remaining",
    frqColUnroundedNeed: "Unrounded Need (KG)",
    frqColRecommended: "Recommended Qty (KG)",
    frqColRequested: "Requested Qty (KG)",
    frqColBagCount: "Bag Count",
    frqColDelivery: "Proposed Delivery Date",
    frqRequestedFor: "Requested Qty for line {{line}}",
    frqChangeover: "No silo holds this feed",
    frqYes: "Yes",
    frqNo: "No",
    frqRemarks: "Remarks",
    frqRemarksRequired: "Remarks are required: a requested quantity is more than 20% from the recommendation, or the submission deadline has passed.",
    frqSave: "Save",
    frqApprove: "Approve",
    frqReject: "Reject",
    frqRejectNeedsReason: "Write the reason for rejecting in Remarks.",
    frqSaved: "Saved.",
    frqApproved: "Approved.",
```

Placeholders use the file's `{{name}}` form (as `invUnitBalanceTitle` does).

- [ ] **Step 6: Run** `pnpm nx test web -- feed-requisition-panel` → PASS; `pnpm nx test web` → PASS; `pnpm nx run-many -t typecheck -p web` → PASS; `pnpm nx lint web` → error count unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/console/inventory/use-feed-farm.ts apps/web/src/components/console/inventory/feed-requisition-panel.tsx "apps/web/src/app/(app)/inventory/feed-requisitions/page.tsx" apps/web/src/components/console/inventory/inventory-page-shell.tsx apps/web/src/utils/translations.ts apps/web/specs/feed-requisition-panel.spec.tsx
git commit -m "feat(web): Inventory → Feed Requisitions

The first requisition screen: draft from the forecast, review the lines
with the Requisition sheet §2 columns (System Balance, unrounded need and
3,000 kg rounding, next-diet flag), edit requested quantities, and approve
with remarks when a quantity moves more than 20 % or the deadline passed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Web — Inventory → Feed Alerts

The in-app surface for the alerts (Master Setup §4 row 51 "NAVFarm in app default"). Opening it runs `POST /feed-alert/evaluate` for the farm first — with no scheduler (Task 7), that is what advances the date-driven alerts — then lists what the user may see.

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-alerts-panel.tsx`
- Create: `apps/web/src/app/(app)/inventory/feed-alerts/page.tsx`
- Modify: `inventory-page-shell.tsx`, `translations.ts` (`en`)
- Test: `apps/web/specs/feed-alerts-panel.spec.tsx`

**Interfaces:**
- Consumes: `POST /feed-alert/evaluate { farmId }`, `GET /feed-alert?farmId=&status=`, `POST /feed-alert/:id/acknowledge` (Task 7); `useFeedFarm` (Task 10).

- [ ] **Step 1: Write the failing test** — `apps/web/specs/feed-alerts-panel.spec.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FeedAlertsPanel from '../src/components/console/inventory/feed-alerts-panel';
import { api } from '../src/services/api-client';
import { getStoredUser, getActiveFarmId } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getStoredUser: jest.fn(), getActiveFarmId: jest.fn() }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const lowAlert = {
  alert_id: 'a1', notification_code: 'FEED-BELOW-L1', event_type: 'FEED_BELOW_L1', priority_level: 'CRITICAL_FIRST_PRIORITY',
  status: 'ACTIVE', title: 'Low feed: GRS/SILO-001', message: 'GRS/SILO-001 holds 900 kg of Weaner Diet R1 — at or below its low level of 1,000 kg.',
  raised_at: '2026-09-23 08:00:00', last_notified_at: '2026-09-23 08:00:00', escalation_role: null, escalated_at: null, acknowledged_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getStoredUser as jest.Mock).mockReturnValue({ userId: 'u1', userType: 'STANDARD_USER', farmId: 'farm-grs' });
  (getActiveFarmId as jest.Mock).mockReturnValue(null);
  post.mockResolvedValue({ data: {} });
  get.mockResolvedValue({ data: [lowAlert] });
});

describe('FeedAlertsPanel', () => {
  it('evaluates the farm first, then lists its alerts', async () => {
    render(<FeedAlertsPanel />);
    await screen.findByText('Low feed: GRS/SILO-001');
    expect(post).toHaveBeenCalledWith('/feed-alert/evaluate', { farmId: 'farm-grs' });
    expect(get).toHaveBeenCalledWith('/feed-alert?farmId=farm-grs&status=ACTIVE');
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0]);
    expect(screen.getByText('CRITICAL_FIRST_PRIORITY')).toBeTruthy();
  });

  it('still lists alerts when evaluation fails', async () => {
    post.mockRejectedValueOnce(new Error('boom'));
    render(<FeedAlertsPanel />);
    await screen.findByText('Low feed: GRS/SILO-001');
  });

  it('acknowledges an alert', async () => {
    render(<FeedAlertsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'falAcknowledge' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-alert/a1/acknowledge', {}));
  });
});
```

- [ ] **Step 2: Run** `pnpm nx test web -- feed-alerts-panel` → FAIL.

- [ ] **Step 3: Panel** — `feed-alerts-panel.tsx`:

```tsx
"use client";

/**
 * Inventory → Feed Alerts (Feed Forecast Plan B, Task 11). NAVFarm's in-app
 * channel for the Alerts and Notifications Master (Master Setup §4). The API
 * has no scheduler, so opening this page evaluates the farm's rules first
 * (POST /feed-alert/evaluate) — that is when diet-change and deadline alerts
 * and escalations advance — and then lists the alerts this user may see.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { useFeedFarm } from "./use-feed-farm";

interface FeedAlert {
  alert_id: string;
  notification_code: string;
  event_type: string;
  priority_level: string;
  status: string;
  title: string;
  message: string;
  raised_at: string;
  last_notified_at: string;
  escalation_role: string | null;
  escalated_at: string | null;
  acknowledged_at: string | null;
}

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  CRITICAL_FIRST_PRIORITY: "danger", CRITICAL: "danger", WARNING: "warning", INFO: "info",
};

/** Stored UTC "YYYY-MM-DD HH:MM:SS" shown in the viewer's local time. */
const when = (ts: string) => new Date(`${ts.replace(" ", "T")}Z`).toLocaleString();

export default function FeedAlertsPanel() {
  const { t } = useLanguage();
  const { farmId, setFarmId, farms, isFixed } = useFeedFarm();
  const [alerts, setAlerts] = useState<FeedAlert[]>([]);
  const [status, setStatus] = useState<"ACTIVE" | "ALL">("ACTIVE");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    setError("");
    try {
      // Evaluation failing must not hide the alerts already raised.
      await api.post("/feed-alert/evaluate", { farmId }).catch(() => undefined);
      const res = await api.get(`/feed-alert?farmId=${farmId}&status=${status}`);
      setAlerts(((res as any)?.data ?? res) || []);
    } catch (err: any) {
      setError(err?.message || t("falLoadFailed"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/feed-alert/${id}/acknowledge`, {});
      await load();
    } catch (err: any) {
      setError(err?.message || t("falAckFailed"));
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {!isFixed && (
          <Field label={t("falFarm")} htmlFor="fal-farm">
            <select id="fal-farm" className="nf-input-sm px-2" value={farmId ?? ""} onChange={(e) => setFarmId(e.target.value)}>
              {farms.map((f) => (
                <option key={f.location_id} value={f.location_id}>{f.location_code} — {f.location_name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("falShow")} htmlFor="fal-status">
          <select id="fal-status" className="nf-input-sm px-2" value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "ALL")}>
            <option value="ACTIVE">{t("falActiveOnly")}</option>
            <option value="ALL">{t("falIncludingResolved")}</option>
          </select>
        </Field>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {loading ? (
        <div className="p-10 text-center text-xs"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("falLoading")}</div>
      ) : alerts.length === 0 ? (
        <div className="p-10 text-center text-xs"><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("falNone")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((a) => (
            <div key={a.alert_id} className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] border p-4"
              style={{ borderColor: "var(--border)", opacity: a.status === "RESOLVED" || a.acknowledged_at ? 0.65 : 1 }}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={PRIORITY_VARIANT[a.priority_level] ?? "neutral"}>{a.priority_level}</Badge>
                    <p className="text-sm font-semibold">{a.title}</p>
                    {a.status === "RESOLVED" && <Badge variant="success">{t("falResolved")}</Badge>}
                  </div>
                  <p className="mt-1 text-xs">{a.message}</p>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {a.notification_code} · {t("falRaised", { at: when(a.raised_at) })}
                    {a.escalated_at && a.escalation_role ? ` · ${t("falEscalated", { role: a.escalation_role })}` : ""}
                  </p>
                </div>
              </div>
              {a.status === "ACTIVE" && !a.acknowledged_at && (
                <Button size="sm" variant="outline" onClick={() => acknowledge(a.alert_id)} disabled={acting === a.alert_id}>
                  <CheckCircle2 className="h-3 w-3" /> {t("falAcknowledge")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

(The `<CheckCircle2>` icon has no text, so the button's accessible name is `falAcknowledge`, as the test expects.)

- [ ] **Step 4: Route, shell, translations**

`apps/web/src/app/(app)/inventory/feed-alerts/page.tsx`:

```tsx
"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import FeedAlertsPanel from "@/components/console/inventory/feed-alerts-panel";

export default function InventoryFeedAlertsPage() {
  return (
    <InventoryPageShell activeKey="feed-alerts">
      <FeedAlertsPanel />
    </InventoryPageShell>
  );
}
```

Shell: section `{ key: "feed-alerts", href: "/inventory/feed-alerts", labelKey: "invFeedAlerts" },` after `feed-requisitions`; title `activeKey === "feed-alerts" ? t("invFeedAlertsTitle") :`; description `activeKey === "feed-alerts" ? t("invFeedAlertsDesc") :`.

`en` translations:

```ts
    invFeedAlerts: "Feed Alerts",
    invFeedAlertsTitle: "Inventory → Feed Alerts",
    invFeedAlertsDesc: "Low and over-stocked silos, upcoming diet changes and unapproved feed requisitions, from the Alerts and Notifications Master.",
    falFarm: "Farm",
    falShow: "Show",
    falActiveOnly: "Active",
    falIncludingResolved: "Active and resolved",
    falLoading: "Checking feed alerts…",
    falNone: "No feed alerts for this farm.",
    falLoadFailed: "Feed alerts could not be loaded.",
    falAckFailed: "The alert could not be acknowledged.",
    falAcknowledge: "Acknowledge",
    falResolved: "Resolved",
    falRaised: "raised {{at}}",
    falEscalated: "escalated to {{role}}",
```

- [ ] **Step 5: Run** `pnpm nx test web -- feed-alerts-panel` → PASS; `pnpm nx test web` → PASS; typecheck `web` → PASS; lint → no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/console/inventory/feed-alerts-panel.tsx "apps/web/src/app/(app)/inventory/feed-alerts/page.tsx" apps/web/src/components/console/inventory/inventory-page-shell.tsx apps/web/src/utils/translations.ts apps/web/specs/feed-alerts-panel.spec.tsx
git commit -m "feat(web): Inventory → Feed Alerts

The in-app channel of the Alerts and Notifications Master. Opening it
evaluates the farm's rules first — the API has no scheduler — then lists
the alerts the user's roles may see, with acknowledge to stop escalation.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Prove it in MySQL by driving the API; record

The project rule: a write is proven by making it through the running API and reading MySQL, not by a green suite. Everything below is against `nf_devco`, through `http://localhost:2877/api/v1`, on one farm — VIL100 unless it has no silo holding feed, in which case the first farm that does (Plan A Task 10 found VIL100's silos stocked). Keep every command and its output; they go into the verification document.

**Files:**
- Create: `docs/VERIFICATION-2026-09-26-feed-forecast-b.md`
- Modify: `docs/decisions.md` (Plan B entry)

- [ ] **Step 1: Suites, build, restart.**
`pnpm nx test api`, `pnpm nx test web`, `pnpm nx run-many -t typecheck -p api,web` → all PASS; `pnpm nx lint web` → error count unchanged. `pnpm nx run api:db-migrate-all-tenants`. `pnpm nx run api:build`; restart the API by the PID from `lsof -ti :2877` (never `pkill`). Confirm the journal: `mysql … -e "SELECT COUNT(*) FROM nf_devco.alert_rule; SHOW TABLES FROM nf_devco LIKE 'feed_alert';"` → rules > 0, one table.

- [ ] **Step 2: Session.** Credentials and the four scope headers are in `docs/HANDOFF-2026-09-14.md` §8 (company admin); do not paste the password into the verification document.

```bash
API=http://localhost:2877/api/v1
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.data.accessToken // .data.access_token // .accessToken')
H=(-H "Authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT" -H "x-active-company-id: $COMPANY" -H "x-workspace-scope: COMPANY" -H 'Content-Type: application/json')
FARM=$(mysql … -N -e "SELECT location_id FROM nf_devco.location_master WHERE location_code='VIL100' AND location_type='FARM'")
```

Pick one silo of the farm that holds feed and record its balance **from the ledger**, not from the API:

```sql
SELECT s.location_id, s.location_code, il.item_id, SUM(il.remaining_quantity) AS balance_kg
FROM nf_devco.location_master s JOIN nf_devco.inventory_ledger il ON il.warehouse_id = s.location_id
WHERE s.farm_id = '<FARM>' AND s.location_type = 'SILO'
GROUP BY s.location_id, s.location_code, il.item_id HAVING balance_kg > 0 ORDER BY s.location_code LIMIT 1;
```

Call the silo `$SILO`, its item `$ITEM`, its balance `B`, and note its current `low_level_kg`/`high_level_kg` (NULL) to restore at the end.

- [ ] **Step 3: Low level at the threshold raises exactly one alert (checkpoint 11).**
`curl -s -X PUT $API/location/$SILO "${H[@]}" -d '{"low_level_kg": B, "high_level_kg": <capacity_kg>}'` (B written out; the high level must stay ≤ capacity). Read back `SELECT low_level_kg, high_level_kg FROM nf_devco.location_master WHERE location_id='$SILO'` → B and capacity.
`curl -s -X POST $API/feed-alert/evaluate "${H[@]}" -d "{\"farmId\":\"$FARM\"}"` twice. Then:

```sql
SELECT notification_code, status, subject_id, observed_value, threshold_value, active_key IS NOT NULL AS open_key, priority_level
FROM nf_devco.feed_alert WHERE subject_id = '$SILO' ORDER BY raised_at;
```

Expected: **one** `FEED-BELOW-L1` row, ACTIVE, `observed_value = threshold_value = B`, `CRITICAL_FIRST_PRIORITY`, open key — not two, although evaluate ran twice.

- [ ] **Step 4: A receipt lifts it above the level and resolves it (checkpoint 12).** Post a goods receipt of `$ITEM` into `$SILO` (create then post; the payload shape is `apps/api/src/modules/inventory/goods-receipt/dto/` — the same the Goods Receipt screen sends; a quantity of 100 kg is enough and fits under capacity). The post hook evaluates levels. Then the same SELECT → the row is `RESOLVED`, `resolved_reason = 'RECOVERED'`, `active_key` NULL. And `SELECT SUM(remaining_quantity) FROM nf_devco.inventory_ledger WHERE warehouse_id='$SILO' AND item_id='$ITEM'` → B + 100.

- [ ] **Step 5: Re-arm on the next downward crossing.** `PUT /location/$SILO` with `low_level_kg` = B + 100 (the new balance) and evaluate → a **second** row, ACTIVE, beside the RESOLVED one: `SELECT status, resolved_reason FROM nf_devco.feed_alert WHERE subject_id='$SILO' AND notification_code='FEED-BELOW-L1' ORDER BY raised_at` → `RESOLVED/RECOVERED`, `ACTIVE/NULL`.

- [ ] **Step 6: Over-stock (checkpoint 13).** `PUT /location/$SILO` with `low_level_kg` null and `high_level_kg` = B + 100, evaluate → a `FEED-ABOVE` row, `INFO`, ACTIVE (balance B + 100 ≥ high level B + 100). The open low alert from Step 5 resolves as `RECOVERED`: with no low level the silo no longer meets the low condition, and the evaluator resolves any open alert whose condition is gone (Task 6).

- [ ] **Step 7: Auto-draft and hand-check one line (Worked Example arithmetic).**
`curl -s -X POST $API/feed-requisition/auto-draft "${H[@]}" -d "{\"farmId\":\"$FARM\"}"` → note `requisitionId`.
`curl -s "$API/feed-forecast?farmId=$FARM" "${H[@]}" | jq '.data.sources'` → for one source: `walkDemandKg`, `balanceKg`.

```sql
SELECT r.req_no, r.status, r.requisition_type, r.source, r.purpose, r.supply_source, r.priority, r.production_date, r.submission_deadline, r.forecast_run_key
FROM nf_devco.requisition r WHERE r.requisition_id = '<id>';
SELECT l.line_seq, d.location_code, l.item_id, l.feed_type, l.is_next_diet, l.days_before_diet_change, l.system_balance_kg,
       l.daily_requirement_kg, l.days_remaining, l.unrounded_need_kg, l.recommended_qty_kg, l.quantity, l.bag_count, l.proposed_delivery_date
FROM nf_devco.requisition_line l LEFT JOIN nf_devco.location_master d ON d.location_id = l.destination_location_id
WHERE l.requisition_id = '<id>' ORDER BY l.line_seq;
```

Expected: `req_no` = `REQ-VIL100-2026-00001` (or the next number), `AUTO_DRAFT / FEED_FORECAST / AUTO_FORECAST / INTERNAL_TRANSFER / MILL`, `submission_deadline` = the Saturday before the next Sunday, `production_date` that Sunday. By hand for one line: `unrounded = max(0, walkDemandKg − balanceKg)`; `recommended = ceil(unrounded / 3000) × 3000` for BULK (÷ 50 × 50 and bags = kg ÷ 50 for BAGGED) — must equal `unrounded_need_kg` and `recommended_qty_kg` exactly; `quantity = recommended_qty_kg`.

- [ ] **Step 8: Rerun makes no duplicate and keeps an edit (Review Focus 1).**
`PUT $API/feed-requisition/<id>` with `{"lines":[{"line_id":"<line 1>","quantity_kg":<recommended × 1.5>}]}`; then auto-draft again.
`SELECT COUNT(*) FROM nf_devco.requisition WHERE farm_id='$FARM' AND doc_type='FEED' AND submission_deadline='<deadline>' AND deleted_at IS NULL` → **1**; line 1's `quantity` still recommended × 1.5; `forecast_run_key` changed.

- [ ] **Step 9: Approval rules (checkpoints 18, 19; Q3).**
Approve without remarks → HTTP 400 naming line 1 and "more than 20%"; `SELECT status FROM …requisition WHERE requisition_id='<id>'` still `AUTO_DRAFT`.
Cross-farm: with a login whose scope is pinned to another farm (an operational admin sending `x-active-farm-id` of another farm, or a farm user of another farm), `POST …/<id>/approve` → 404 (403 if that login lacks the approve grant — record which); status unchanged.
Approve with `{"remarks":"verification: larger order"}` → 200. Then:

```sql
SELECT r.status, r.approved_by, r.approved_at, r.remarks, a.status AS approval_status, a.doc_type
FROM nf_devco.requisition r JOIN nf_devco.approval_request a ON a.request_id = r.approval_request_id WHERE r.requisition_id = '<id>';
```

→ `APPROVED`, approver and time set, approval request `APPROVED`, doc_type `REQUISITION`.
Generic path refuses it: `POST $API/requisition/<id>/approve` → 400 "Feed requisitions are decided on Inventory → Feed Requisitions."

- [ ] **Step 10: Deadline alerts follow the requisition (checkpoint 20).** Before Step 9's approval, if today is within one day of the deadline, evaluate and read `SELECT notification_code, status FROM nf_devco.feed_alert WHERE subject_id='<id>'` → `REQ-REMINDER` (and `REQ-OVERDUE` on the deadline day) ACTIVE; after approval → `RESOLVED/CLOSED`. If today is further from the deadline, say so in the document; do not change dates to force it.

- [ ] **Step 11: Diet change (checkpoint 30).** `GET /feed-forecast?farmId=$FARM&to=<today+3>` → `.data.dietChanges`. If any change falls within 3 days, evaluate and read the `DIET-CHANGE` row: its message names the next item, the days left and the silo. If none does, record that the farm's batches change no diet in the next 3 days and that the rule was not exercised live — do not edit lifecycle rows to force one.

- [ ] **Step 12: Restore and record.** Put `$SILO`'s `low_level_kg`/`high_level_kg` back to what Step 2 recorded (NULL) with `PUT /location/$SILO`, read back. Leave the requisition, the goods receipt and the alerts as the evidence; list their ids. Write `docs/VERIFICATION-2026-09-26-feed-forecast-b.md`: each step's command, the SQL, its output, the hand calculation of Step 7, and anything not exercised and why. Add to `docs/decisions.md` a "Feed Forecast Plan B — defaults awaiting Rishi" entry listing Q1–Q12 with the default each uses and the date.

- [ ] **Step 13: Commit**

```bash
git add docs/VERIFICATION-2026-09-26-feed-forecast-b.md docs/decisions.md
git commit -m "docs: feed forecast plan B verification against nf_devco

Low-level alert raised once at the threshold, resolved by a posted
receipt and re-armed on the next crossing; over-stock INFO; an
auto-drafted requisition whose rounded line matches a hand calculation;
a rerun that kept the farm's edit and made no second draft; approval
refused without remarks and across farms, then approved through the
approval engine.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec Plan B item / source | Task |
|---|---|
| Silo `low_level_kg`, `high_level_kg` on the silo form, alongside Silo Reorder Days (D10; Master Setup §1 rows 10, 12) | 1 |
| Alert rules master, §4 fields (code, name, event type, trigger entity, threshold value and reference, priority, recipient roles, channel, frequency, escalation hours and role, active, farm filter); checkpoint 10 | 5 |
| In-app FEED_BELOW_L1 / FEED_ABOVE / DIET_CHANGE (3 days) / REQ_DEADLINE; recover and re-arm (checkpoints 11–13, 20, 30) | 6, 7, 11 |
| Requisition type FEED_FORECAST/MANUAL, purpose INTERNAL_TRANSFER, source MILL, lines per silo and item, snapshots, next-diet flag | 1, 2, 3, 8 |
| Rounding: bulk 3,000 kg multiples, bagged 50 kg bags (Step 8; §1 rows 23, 28; checkpoints 16, 27) | 3 |
| > 20 % deviation needs remarks (checkpoint 18) | 3, 9, 10 |
| Own-farm approval only (checkpoint 19) | 9 |
| Auto-draft from a forecast run without duplicate drafts (Step 9; §1 row 9) | 8 |
| Submission deadline from a production calendar, Saturday default (checkpoint 22; §1 row 35) | 1, 3 |
| Farm total vs 30,000 kg truck target, trips not a cap (§1 rows 26–27; checkpoint 17) | 8, 10 |
| First web screen for requisitions | 10 |
| In-app only; no SMS/WhatsApp; no D365BC calls | Global Constraints, 5 |
| Scheduling: none exists — on writes + evaluate endpoint | 7, 11 |
| Prove writes in MySQL | 12 |

Out of Plan B, left for Plans C–D as the spec assigns them: loading instruction sheet, mill consolidation, transfer orders and receipt (Plan C); forecast run versions, Wednesday tentative plan, reporting periods and stock take (Plan D); the next-diet "no silo of the right feed type" CRITICAL notification of checkpoint 9 (only its flag on the requisition line is built here).
