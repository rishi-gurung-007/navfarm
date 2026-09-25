# Feed Forecast — Plan A: Silo Model, Diet Rows, Forecast Engine and Report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Farm users open Inventory → Feed Forecast, pick a date range, and see per batch, shed and feed item how long the silo lasts, when it runs out, when it must be refilled and when the order is due — computed from real silo stock, real head counts and the breed lifecycle feed rows.

**Architecture:** Silos and sheds become many-to-many through a new `silo_shed_link` table; a silo's feed item is read from the inventory ledger. A pure function (`buildFeedForecast`) does all arithmetic day by day; a thin service loads its inputs from MySQL under farm scope and a controller exposes `GET /feed-forecast`. The scheduler and the forecast share one rule for which lifecycle feed row applies on a given stage day.

**Tech Stack:** NestJS + Drizzle (MySQL, per-tenant DBs, hand-written SQL migrations in `apps/api/src/drizzle/tenant`), Jest; Next.js 16 web app, React Testing Library; Nx (`pnpm nx …`).

**Spec:** `docs/superpowers/specs/2026-09-25-feed-forecast-design.md` (decisions D1–D15 are referenced by number below).

## Status as of 2026-09-25 20:16

Tasks 1–9 have landed. **Tasks 1–8 were tracked by commit, not by ticking the
boxes below** — the boxes in those sections are still unticked and should not be
read as work outstanding. The commits are:

| Task | Commit |
|---|---|
| 1 Link table, backfill, farm offsets | `befb009` |
| 2 `SiloFeedService` | `9a2d7bd`, `65f06bd` |
| 3 Location service + web master data | `bdb5c19` |
| 4 Daily entry silo source | `5ce724f` |
| 5 Per-row feed lines | `98bf750` |
| 6 Forecast engine | `98ef76b`, `db59c26` |
| 7 `GET /feed-forecast` | `58190ed`, `b06441e` |
| 8 Web report | `605c02c` |
| — review fix rounds | `17f1b93`, `2f58a97` |
| 9 Seeds/demo on the link table, drop `feed_silo_id` | `ab7625e` |

**Only Task 10 remains**, and it is blocked on Rishi: Step 1 is
`pnpm nx run api:db-rebuild-demo -- --apply`, which an agent must not run.
Nothing in Tasks 1–9 has been verified against MySQL yet — that is what Task 10
is for, and until it runs the feature is green-suite-only (`CLAUDE.md`).

## Global Constraints

- Read `AGENTS.md` first. Comments explain **why**, in prose, matching the dense style of the file being edited.
- New UI strings go in the `en` dictionary only (`apps/web/src/utils/translations.ts`); `t()` falls back to English.
- Web lint baseline: gate on **no new errors** vs. the count before your change (94 on 2026-09-25); never "fix" pre-existing `exhaustive-deps`.
- Run tasks through Nx: `pnpm nx test api -- <pattern>`, `pnpm nx test web -- <pattern>`, `pnpm nx run-many -t typecheck -p api,web`.
- Every `@RequirePermission(module, resource, action)` pair must also be offered in `apps/web/src/components/console/console-tabs/roles-tab.tsx` (guarded by `apps/web/specs/role-permissions-coverage.spec.ts`).
- Databases are `nf_`-prefixed (`nf_master`, `nf_system`, `nf_<tenant>`); names come from `apps/api/src/core/database/database-names.ts`.
- **Verify by writing and reading MySQL**, not by a green suite (`CLAUDE.md`). `nx serve api` does not rebuild: rebuild and restart before testing an API change.
- Dates are `YYYY-MM-DD` strings in farm-local calendar days; all date arithmetic in the engine is done on UTC midnights of those strings to avoid DST shifts.
- Do not run `db-rebuild-demo -- --apply` yourself; ask Rishi to run it (the auto-mode classifier blocks it).

## Review Focus

1. **A silo shared by two sheds** — run-down must use the *combined* demand of every shed drawing that item from that silo, not each row's own intake. (Task 6 test "shared silo".)
2. **A diet change inside the range** — R1 and R2 are separate rows; stock of R1 never offsets R2 demand. (Task 6 worked-example test.)
3. **Today's demand is zero** (the row's diet starts later in the range) — days-left is `null`, not `Infinity` or a division error; run-down still computed. (Task 6 test "diet starts later".)
4. **A farm-pinned user asks for another farm's forecast** — answered as not found, never another farm's numbers. (Task 7 test.)
5. **No feed row for the stage day** (gap or overlap in lifecycle rows) — the row is flagged, not silently zero. (Task 6 test "missing row".)

---

## File map

| File | Responsibility |
|---|---|
| `apps/api/src/drizzle/tenant/0114_silo_shed_link.sql` (new) | Link table, backfill from `feed_silo_id`, farm refill-buffer and lead-time columns |
| `apps/api/src/drizzle/tenant/0115_drop_feed_silo_id.sql` (new) | Drop the old column once nothing reads it |
| `apps/api/src/core/database/schema.ts` | `siloShedLink` table; two FARM columns; later remove `feed_silo_id` |
| `apps/api/src/modules/inventory/silo-feed/silo-feed.service.ts` (new) | One place for silo item rules: current items, can-receive checks (one item, empty before change, D9 sibling rule) |
| `apps/api/src/modules/inventory/silo-feed/silo-feed.module.ts` (new) | Exports `SiloFeedService` |
| `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts` | Replace its private silo check with `SiloFeedService.assertCanReceive` |
| `apps/api/src/modules/inventory/goods-receipt/goods-receipt.service.ts` | Same check on post into a SILO |
| `apps/api/src/modules/master-data/location/location.service.ts` | Attached Sheds read/write via link table; D9 on attach; expose `current_feed_item_*` on silo rows |
| `apps/api/src/modules/production/batch-daily-data/batch-daily-data.service.ts` | Draw feed from the shed's silo holding the posted item |
| `apps/api/src/modules/production/scheduler-header/scheduler-header.service.ts` | One CONSUMPTION feed line per lifecycle row, by day range |
| `apps/api/src/modules/production/lifecycle/feed-row-days.ts` (new) | Shared `toStageDays(calcUnit, n)` and `feedRowFor(rows, dayOfStage)` |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` (new) | Pure arithmetic |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` (new) | Loads engine input under farm scope |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts` (new) | `GET /feed-forecast` |
| `apps/web/src/components/console/inventory/feed-forecast-panel.tsx` (new) | The report |
| `apps/web/src/app/(app)/inventory/feed-forecast/page.tsx` (new) | Route |
| `apps/web/src/modules/master-data/*` | Remove the greyed Attached Sheds rows; add the two FARM fields |
| Seeds / demo (`seed-nine-farm-demo.ts`, `seed-dev-tenant.ts`, `seed-farm-locations.ts`, `demo/farms.ts`, `demo/chapters/02-inventory.ts`) | Write/read `silo_shed_link` |

## Order and parallelism

```
Task 1 (schema + migration 0114)
 ├─ Task 2 (SiloFeedService)  ──┬─ Task 3 (location service + web master data)
 │                              └─ Task 4 (daily entry source)
 ├─ Task 5 (scheduler per-row feed lines)          ← parallel with 2
 └─ Task 6 (engine, pure)  ← can start before Task 1
Task 7 (service + controller)  after 1, 5, 6
Task 8 (web report)            after 7
Task 9 (seeds/demo + migration 0115) after 3, 4
Task 10 (rebuild + MySQL verification + docs) last
```

---

### Task 1: Link table, backfill, farm offsets

**Files:**
- Create: `apps/api/src/drizzle/tenant/0114_silo_shed_link.sql`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json` (append entry idx 114)
- Modify: `apps/api/src/core/database/schema.ts` (after `locationMaster`, ~line 1070)

**Interfaces:**
- Produces: `schema.siloShedLink` with columns `link_id, tenant_id, company_id, silo_id, shed_id, created_by, created_at`; unique `(silo_id, shed_id)`. `schema.locationMaster.feed_refill_buffer_days` (int, default 2) and `feed_lead_time_days` (int, default 0).

- [ ] **Step 1: Write the migration**

```sql
-- Silo <-> shed becomes many-to-many (Rishi, 2026-09-25; spec D7). A shed may
-- now draw from several silos — one per feed item (D9) — so the single
-- feed_silo_id column on the shed can no longer say it. The rows are copied
-- across here; the column is dropped in 0115 once nothing reads it.
CREATE TABLE `silo_shed_link` (
  `link_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `silo_id` varchar(36) NOT NULL,
  `shed_id` varchar(36) NOT NULL,
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `silo_shed_link_link_id` PRIMARY KEY(`link_id`),
  CONSTRAINT `uq_silo_shed_link` UNIQUE(`silo_id`,`shed_id`)
);
--> statement-breakpoint
ALTER TABLE `silo_shed_link` ADD CONSTRAINT `silo_shed_link_silo_fk` FOREIGN KEY (`silo_id`) REFERENCES `location_master`(`location_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `silo_shed_link` ADD CONSTRAINT `silo_shed_link_shed_fk` FOREIGN KEY (`shed_id`) REFERENCES `location_master`(`location_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_silo_shed_link_shed` ON `silo_shed_link` (`shed_id`);
--> statement-breakpoint
INSERT INTO `silo_shed_link` (`link_id`, `tenant_id`, `company_id`, `silo_id`, `shed_id`)
SELECT UUID(), s.`tenant_id`, s.`company_id`, s.`feed_silo_id`, s.`location_id`
FROM `location_master` s WHERE s.`feed_silo_id` IS NOT NULL;
--> statement-breakpoint
-- Spec D3: Date to Refill = run-down - buffer days; Required On = refill - lead
-- time. Per farm because delivery distance is per farm. Read only on FARM rows.
ALTER TABLE `location_master` ADD `feed_refill_buffer_days` int DEFAULT 2;
--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_lead_time_days` int DEFAULT 0;
```

- [ ] **Step 2: Append the journal entry** — copy the 0113 block in `meta/_journal.json`, set `"idx": 114`, `"tag": "0114_silo_shed_link"`, `"when"` = 0113's value + 86400000.

- [ ] **Step 3: Add to `schema.ts`** (next to `locationMaster`; add the two columns inside `locationMaster` after `feed_silo_id`):

```ts
  feed_refill_buffer_days: int('feed_refill_buffer_days').default(2),
  feed_lead_time_days: int('feed_lead_time_days').default(0),
```

```ts
// Silo <-> shed, many-to-many (spec D7). A row says "this shed may draw feed
// from this silo"; which silo a given posting uses is decided by the item the
// silo holds (D9), not by this table.
export const siloShedLink = mysqlTable('silo_shed_link', {
  link_id: varchar('link_id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }),
  silo_id: varchar('silo_id', { length: 36 }).notNull().references(() => locationMaster.location_id, { onDelete: 'cascade' }),
  shed_id: varchar('shed_id', { length: 36 }).notNull().references(() => locationMaster.location_id, { onDelete: 'cascade' }),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
}, (table) => ({
  uqSiloShed: uniqueIndex('uq_silo_shed_link').on(table.silo_id, table.shed_id),
  shedIdx: index('idx_silo_shed_link_shed').on(table.shed_id),
}));
```

- [ ] **Step 4: Apply and read back**

Run: `pnpm nx run api:db-migrate-all-tenants`
Then: `mysql -h 127.0.0.1 -u root -t -e "SELECT COUNT(*) links FROM nf_devco.silo_shed_link; SELECT COUNT(*) sheds_with_silo FROM nf_devco.location_master WHERE feed_silo_id IS NOT NULL;"`
Expected: both counts equal (52 on the demo data).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm nx run-many -t typecheck -p api` → PASS.
`git commit -m "feat(location): silo_shed_link table, backfill, farm refill offsets"`

---

### Task 2: `SiloFeedService` — one home for silo item rules

**Files:**
- Create: `apps/api/src/modules/inventory/silo-feed/silo-feed.service.ts`, `silo-feed.module.ts`, `silo-feed.service.spec.ts`
- Modify: `stock-transfer.service.ts` (replace the item part of `assertSiloDestination`, ~lines 164–216; keep its capacity part), `stock-transfer.module.ts`, `goods-receipt.service.ts` (+ module) — call on post when the destination is a SILO

**Interfaces:**
- Consumes: `InventoryLedgerService.getStockBalance({ companyId, warehouseId }, tenantId)` → `{ item_id, item_code, on_hand_qty, … }[]` (positive balances only).
- Produces:
  - `currentItems(siloIds: string[], companyId: string, tenantId: string): Promise<Map<string, { item_id: string; item_code: string; item_description: string | null; on_hand_qty: number } | null>>` — one entry per silo; `null` = empty.
  - `assertCanReceive(params: { siloId: string; siloName: string; companyId: string; tenantId: string; itemIds: string[] }): Promise<void>` — throws `BadRequestException` when: more than one item incoming; silo holds a different item; **any other silo linked to any shed this silo feeds** currently holds one of the incoming items (D9).
  - `assertAttachable(params: { siloId: string; shedIds: string[]; companyId: string; tenantId: string }): Promise<void>` — throws when a listed shed already has another silo holding the same item this silo holds (D9 at attach time). No-op when this silo is empty.

- [ ] **Step 1: Write failing tests** (`silo-feed.service.spec.ts`, mock `db` with the same chained-mock helpers the stock-transfer spec uses — copy its `mockDb` setup):
  - `assertCanReceive` rejects two items: expect message `holds one feed item at a time`.
  - rejects when silo holds `FEED-R1` and incoming is `FEED-R2`: message contains `already holds 'FEED-R1'` and `empty it`.
  - rejects D9: silo S1 feeds shed H3; sibling S2 also linked to H3 holds `FEED-R2`; incoming `FEED-R2` into S1 → message `Shed 'GRS/SHED-003' already draws 'FEED-R2' from silo 'GRS/SILO-002'`.
  - accepts `FEED-R1` into S1 when S1 is empty and no sibling holds R1.
  - `assertAttachable` rejects attaching S1 (holds R1) to H3 when S2 on H3 holds R1; accepts when S1 is empty.
- [ ] **Step 2: Run** `pnpm nx test api -- silo-feed` → FAIL (module not found).
- [ ] **Step 3: Implement.** Sibling lookup query:

```ts
// Every other silo that shares a shed with this one — the only silos whose
// item could make a posting ambiguous (D9).
const siblings = await this.db
  .selectDistinct({ silo_id: other.silo_id, shed_id: mine.shed_id, shed_code: schema.locationMaster.location_code })
  .from(mine)
  .innerJoin(other, and(eq(other.shed_id, mine.shed_id), ne(other.silo_id, mine.silo_id)))
  .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, mine.shed_id))
  .where(and(eq(mine.silo_id, siloId), eq(mine.tenant_id, tenantId)));
```
(`mine`/`other` = `alias(schema.siloShedLink, 'mine'|'other')` from `drizzle-orm/mysql-core`.) Resolve each sibling's current item with `currentItems`, and silo codes via one `inArray` query on `location_master`.
- [ ] **Step 4: Switch stock transfer and goods receipt** to `assertCanReceive` (stock transfer keeps its capacity check after it). Goods receipt: in `post()`, for each distinct destination warehouse that is `location_type = 'SILO'`, call it with that warehouse's line items.
- [ ] **Step 5: Run** `pnpm nx test api -- silo-feed stock-transfer goods-receipt` → PASS. Existing stock-transfer tests asserting the old messages keep passing (messages unchanged for the two old rules).
- [ ] **Step 6: Commit** `feat(inventory): SiloFeedService — one item per silo, D9 on transfer and goods receipt`

---

### Task 3: Location service on the link table; web master data

**Files:**
- Modify: `apps/api/src/modules/master-data/location/location.service.ts` (`syncAttachedSheds` ~361–457, `attachedShedIds` ~460–471, findAll `shedsForSilo` ~936–975 and the `feed_silo_name` block ~1023–1055)
- Modify: `location.service.spec.ts`, `dto/location.dto.ts` (update `attached_sheds` descriptions; drop `siloId` query param)
- Modify web: `configs.ts` (`attached_sheds` field: remove `disableOptionWhen`, rewrite `helpText`; add FARM fields), `types.ts` (remove `disableOptionWhen`), `MasterDataTable.tsx` (remove the `optionDisabledReason` block and the `initial[config.idKey]` line added for it), `EntityLookupField.tsx` (remove `optionDisabledReason`), `apps/web/specs/entity-lookup-field.spec.tsx` (remove the greyed-row test), `translations.ts` (remove `mdAnotherRecord`)

**Interfaces:**
- Consumes: `SiloFeedService.assertAttachable`, `currentItems`.
- Produces: silo rows from `GET /location` and `GET /location/:id` carry `attached_sheds: string[]`, `current_feed_item_code: string | null`, `current_feed_item_name: string | null`. Shed rows no longer carry `feed_silo_id`/`feed_silo_name`.

- [ ] **Step 1: Failing tests** in `location.service.spec.ts`: attaching shed H3 to a second silo **succeeds** (previously rejected — delete that old test); attaching when `assertAttachable` throws propagates the error; silo read returns `current_feed_item_code` from `currentItems`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `syncAttachedSheds`: keep the shed-type and same-farm checks; drop the exclusivity check; call `assertAttachable`; then `DELETE FROM silo_shed_link WHERE silo_id = ? AND shed_id NOT IN (…)` and insert missing pairs. `attachedShedIds` reads `silo_shed_link`. `shedsForSilo` returns every active shed of the farm; delete the `siloId` branch and the `feed_silo_name` enrichment. Rewrite the method comments: the rule is now "a shed may draw from several silos, one per feed item" (D7, D9).
- [ ] **Step 4: Web.** `attached_sheds.helpText`: `"The sheds on this silo's parent farm that may take their feed from it. A shed can draw from several silos, one per feed item; two silos feeding the same shed may not hold the same feed."` Add after `silo_reorder_days`… the FARM fields:

```ts
{ key: "feed_refill_buffer_days", label: "Feed Refill Buffer (Days)", type: "number", min: 0, max: 30, step: "1", nativeNumber: true,
  visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] }, section: "Identification",
  helpText: "Feed Forecast: the refill date is this many days before a silo runs out." },
{ key: "feed_lead_time_days", label: "Feed Lead Time (Days)", type: "number", min: 0, max: 30, step: "1", nativeNumber: true,
  visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] }, section: "Identification",
  helpText: "Feed Forecast: the order is due this many days before the refill date. 0 for feed from the internal mill." },
```
and the two DTO fields (`@IsOptional() @IsInt() @Min(0) @Max(30)`) in create/update DTOs; write them in `create`/`update`.
- [ ] **Step 5: Run** `pnpm nx test api -- location` and `pnpm nx test web` → PASS; `pnpm nx run-many -t typecheck -p api,web` → PASS; web lint error count unchanged.
- [ ] **Step 6: Commit** `feat(location): shed may draw from several silos; farm feed offsets on the form`

---

### Task 4: Daily entry draws from the silo holding the posted item

**Files:**
- Modify: `apps/api/src/modules/production/batch-daily-data/batch-daily-data.service.ts` (`resolveConsumptionWarehouse` ~670–746 and its caller ~276)
- Modify: `batch-daily-data.service.spec.ts`

**Interfaces:**
- Consumes: `SiloFeedService.currentItems`.
- Produces: `resolveConsumptionWarehouse(locationId, itemId, activityName, batchFarmId, companyId, tenantId): Promise<string>`.

- [ ] **Step 1: Failing tests:** shed with silos S1 (R1) and S2 (R2): posting R2 draws from S2; posting R1 from S1; posting medicine M (no silo holds it) → farm STORE; shed with no silos → STORE; the pre-existing "no store" error still thrown.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** after resolving `shed` (PEN → parent), load `silo_id`s from `silo_shed_link where shed_id = shed.location_id`, `currentItems(...)`, pick the silo whose item equals `itemId`; else fall back to the store exactly as today. Update the doc comment: the source is "the silo attached to this shed that holds this item (D9), else the farm store".
- [ ] **Step 4: Run** `pnpm nx test api -- batch-daily-data` → PASS.
- [ ] **Step 5: Commit** `feat(daily-entry): draw feed from the shed's silo that holds the posted item`

---

### Task 5: One feed line per lifecycle row (shared day-range rule)

**Files:**
- Create: `apps/api/src/modules/production/lifecycle/feed-row-days.ts`, `feed-row-days.spec.ts`
- Modify: `apps/api/src/modules/production/scheduler-header/scheduler-header.service.ts` (`generateLinesFromLifecycle` ~107–140)

**Interfaces:**
- Produces:

```ts
export type CalcUnit = 'DAY' | 'WEEK' | 'MONTH';
/** Stage days per unit. MONTH = 30 — confirm with Rishi when approving this plan. */
export const DAYS_PER_UNIT: Record<CalcUnit, number> = { DAY: 1, WEEK: 7, MONTH: 30 };
/** Inclusive stage-day range a lifecycle row covers: WEEK 2–3 -> days 8–21. */
export function stageDayRange(calcUnit: string, periodFrom: number, periodTo: number): { fromDay: number; toDay: number };
export interface FeedRow { lifecycleId: string; breedId: string; stageId: string; itemId: string; itemName: string | null; fromDay: number; toDay: number; kgPerHeadPerDay: number; wastagePct: number }
/** The single row covering dayOfStage, or an error kind when none or several do. */
export function feedRowFor(rows: FeedRow[], dayOfStage: number): { row: FeedRow } | { error: 'NONE' | 'OVERLAP' };
```

- [ ] **Step 1: Failing tests:** `stageDayRange('DAY',25,27)` → `{25,27}`; `('WEEK',2,3)` → `{8,21}`; `('MONTH',1,1)` → `{1,30}`; `feedRowFor` picks R1 on day 27 and R2 on day 28; returns `NONE` on day 32; `OVERLAP` when two rows cover day 26.
- [ ] **Step 2: Run** `pnpm nx test api -- feed-row-days` → FAIL.
- [ ] **Step 3: Implement** (`fromDay = (periodFrom - 1) * n + 1`, `toDay = periodTo * n`).
- [ ] **Step 4: Scheduler:** replace the `.limit(1)` read with all active rows for breed + stage; for each row with `feed_item_id` and `feed_qty_per_head_per_day_kg`, push one CONSUMPTION line with `start_day = fromDay`, `end_day = toDay`, `lifecycle_ref_id` = that row, `activity_name = \`${stage.stage_name} Feed — ${itemName}\``. Non-feed lines (mortality, output, weight, protocols) keep using the **first** row, as today. Test in `scheduler-header.service.spec.ts`: two rows → two feed lines with the right day ranges.
- [ ] **Step 5: Run** `pnpm nx test api -- feed-row-days scheduler-header` → PASS.
- [ ] **Step 6: Commit** `feat(scheduler): one feed line per lifecycle row by stage-day range`

---

### Task 6: The forecast engine (pure)

**Files:**
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts`, `feed-forecast.engine.spec.ts`

**Interfaces:**
- Consumes: `FeedRow`, `feedRowFor` from Task 5 (if Task 5 is not merged yet, import the types from its file path as specified there).
- Produces:

```ts
export interface ForecastInput {
  planningDate: string; from: string; to: string;
  refillBufferDays: number; leadTimeDays: number;
  sheds: { shedId: string; shedCode: string; siloIds: string[] }[];
  silos: { siloId: string; siloCode: string; itemId: string | null; balanceKg: number }[];
  store: { storeId: string; storeCode: string; balances: Record<string, number> } | null;
  items: Record<string, string>;            // itemId -> item name
  batches: {
    batchId: string; batchNo: string; breedId: string; shedId: string; heads: number;
    segments: { stageId: string; stageCode: string; start: string; end: string | null; projected: boolean }[];
  }[];
  feedRows: FeedRow[];
}
export type ForecastFlag =
  | { kind: 'NO_FEED_ROW'; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: 'OVERLAPPING_FEED_ROWS'; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: 'NO_SILO_HOLDS_ITEM'; shedCode: string; itemName: string }
  | { kind: 'STAGE_CHANGE_PROJECTED'; batchNo: string; stageCode: string; date: string }
  | { kind: 'HEADS_ASSUMED_FLAT'; batchNo: string };
export interface ForecastRow {
  batchNo: string; itemId: string; itemName: string; shedCode: string; planningDate: string;
  sourceType: 'SILO' | 'STORE' | 'NONE'; sourceCode: string | null;
  currentInventoryKg: number; heads: number;
  perDayIntakeKg: number | null;      // this row, first day it has demand in range
  sourceDailyDemandKg: number | null; // all rows on the same source+item, planning day
  daysLeft: number | null;            // D1
  runDownDate: string | null;         // D2; null = lasts the whole range
  refillDate: string | null; requiredOn: string | null; overdue: boolean; // D3
  rangeDemandKg: number;
}
export function buildFeedForecast(input: ForecastInput): { rows: ForecastRow[]; flags: ForecastFlag[] };
```

Rules the implementation must follow:
- For each date d in `from…to` and each batch: the segment containing d gives `dayOfStage = d − segment.start + 1`; `feedRowFor(rowsOf(breed, stage), dayOfStage)`; demand = `round3(heads × kg × (1 + wastage/100))` (D5).
- Source of (shed, item): the shed's silo whose `itemId === item` → SILO; else, if the shed has **no** silos → STORE (D6); else STORE **and** flag `NO_SILO_HOLDS_ITEM` (daily entry falls back to the store the same way — Task 4); no store → `NONE`.
- Balance projection per (source, item) across **all** rows sharing it (Review Focus 1): walk the days; run-down = first d with `remaining < demand(d)` and `demand(d) > 0`; else `remaining -= demand(d)`.
- `daysLeft = sourceDailyDemandKg > 0 ? Math.floor(balance / sourceDailyDemandKg) : null`, where `sourceDailyDemandKg` is the combined demand on the **planning date** (D1, Review Focus 3).
- `refillDate = runDown − refillBufferDays`, `requiredOn = refillDate − leadTimeDays`, `overdue = requiredOn < planningDate` (D3).
- Every batch gets `HEADS_ASSUMED_FLAT` (D11); every `projected` segment gets `STAGE_CHANGE_PROJECTED`.
- Rows sorted by shedCode, batchNo, first-demand date.

- [ ] **Step 1: Write the failing tests** — the workbook's worked example must reproduce exactly:

```ts
const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 0,
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null, items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  batches: [{ batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }] }],
  feedRows: [
    { lifecycleId: 'a', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'b', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 0 },
  ],
};

it('reproduces the workbook worked example', () => {
  const { rows } = buildFeedForecast(workedExample);
  const r1 = rows.find((r) => r.itemId === 'r1')!;
  const r2 = rows.find((r) => r.itemId === 'r2')!;
  expect(r1).toMatchObject({ sourceCode: 'GRS/SILO-001', rangeDemandKg: 6000, perDayIntakeKg: 2000, daysLeft: 0,
    runDownDate: '2026-09-23', refillDate: '2026-09-21', requiredOn: '2026-09-21', overdue: true });
  expect(r2).toMatchObject({ sourceCode: 'GRS/SILO-002', rangeDemandKg: 10000, perDayIntakeKg: 2500, daysLeft: null,
    runDownDate: '2026-09-26', refillDate: '2026-09-24', requiredOn: '2026-09-24', overdue: false });
});
```

Plus: **D1** — 525 kg, 100 heads × 1.0 kg → `daysLeft 5`, run-down = planning + 5 days; **shared silo** — one silo feeding two sheds of 100 heads at 1 kg, 450 kg → both rows `daysLeft 2`, same run-down date; **wastage** — 100 heads × 1 kg × 10 % → `perDayIntakeKg 110`; **missing row** — day 32 → flag `NO_FEED_ROW`, no demand added; **no silo holds item** — shed with only an R1 silo facing R2 → `sourceType 'STORE'` + flag; **lasts the range** — big balance → `runDownDate null`, `overdue false`.
- [ ] **Step 2: Run** `pnpm nx test api -- feed-forecast.engine` → FAIL.
- [ ] **Step 3: Implement** to the rules above (date helpers: `addDays(iso, n)` and `diffDays(a, b)` on `Date.UTC`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(feed-forecast): pure forecast engine, reproduces the workbook example`

---

### Task 7: Service and `GET /feed-forecast`

**Files:**
- Create: `feed-forecast.service.ts`, `feed-forecast.controller.ts`, `feed-forecast.module.ts`, `dto/feed-forecast.dto.ts`, `feed-forecast.service.spec.ts` (all in `apps/api/src/modules/inventory/feed-forecast/`)
- Modify: `apps/api/src/app.module.ts` (register next to `InventoryLedgerModule`)

**Interfaces:**
- Consumes: `buildFeedForecast`, `stageDayRange`, `SiloFeedService.currentItems`, `InventoryLedgerService.getStockBalance`, `farmScope(this.cls)`.
- Produces: `GET /feed-forecast?farmId=&from=&to=` guarded by `@RequirePermission('INVENTORY', 'LEDGER', 'view')` and `@FarmScoped()`, returning `{ success, data: { planningDate, from, to, farm: { id, code, name }, rows: ForecastRow[], flags: ForecastFlag[] } }`.

Loading rules:
- `planningDate` = today (server date, `YYYY-MM-DD`). `from` defaults to planningDate, `to` to from + 7; reject `to < from` and spans over **45 days** (workbook checkpoint 15) with `BadRequestException`.
- Farm: when `farmScope(cls).restricted`, the farm is `scope.farmId`; a different `farmId` → `NotFoundException('Farm not found.')` (Review Focus 4). Unrestricted callers must pass `farmId`.
- Farm offsets from the FARM row (`feed_refill_buffer_days ?? 2`, `feed_lead_time_days ?? 0`).
- Sheds: active SHED rows of the farm + their `silo_shed_link` silo ids. Silos: linked silos + `currentItems` → `itemId`, `balanceKg` (the item's on-hand quantity). Feed is held in KG; if a silo's balance row has a `uom` other than `KG`, throw `ConflictException` naming the silo and the unit, because the forecast would otherwise add kilograms to bags.
- Store: the farm's STORE and its balances by item.
- Batches: status ACTIVE, `farm_id` = farm. Heads = `closing_quantity ?? opening_quantity`. Current segment: `stage_id`, start = `scheduler_header.effective_from` for (batch, stage) else `batch.start_date`; shed = that header's `location_id` (PEN → parent SHED), else `batch.shed_id`. Projected segments: while segment end < `to` and the stage has `typical_duration_days` and `next_stage_id`: `end = start + duration − 1`, next starts `end + 1`, `projected: true`.
- ANIMAL_WISE batches: one input batch per current stage group (heads = live animals in that stage), same shed rule.
- Feed rows: active `breed_lifecycle_stages` of those breeds with `feed_item_id` and a rate, converted with `stageDayRange`.

- [ ] **Step 1: Failing tests** (mock loaders): restricted user asking for another farm → NotFound; `to` before `from` → BadRequest; 46-day span → BadRequest; happy path passes the loaded input to the engine (spy) with `planningDate` = today.
- [ ] **Step 2: Run** `pnpm nx test api -- feed-forecast` → FAIL.
- [ ] **Step 3: Implement** service, DTO (`@IsOptional() @IsUUID() farmId`, `@IsOptional() @IsDateString() from/to`), controller, module.
- [ ] **Step 4: Run** tests → PASS; typecheck → PASS.
- [ ] **Step 5: Rebuild, restart, call it** (`pnpm nx run api:build`, restart the API by PID), then `curl` with a demo token for `farmId` of VIL100 and a 7-day range; keep the JSON for Task 10.
- [ ] **Step 6: Commit** `feat(feed-forecast): GET /feed-forecast under farm scope`

---

### Task 8: Inventory → Feed Forecast page

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`, `apps/web/src/app/(app)/inventory/feed-forecast/page.tsx`, `apps/web/specs/feed-forecast-panel.spec.tsx`
- Modify: `apps/web/src/components/console/inventory/inventory-page-shell.tsx` (add `{ key: "feed-forecast", href: "/inventory/feed-forecast", labelKey: "invFeedForecast" }` after `balance`, and its title), `apps/web/src/utils/translations.ts` (`en` only)

**Interfaces:**
- Consumes: `GET /feed-forecast` (Task 7), `getActiveFarmId()` and `getStoredUser()` from `@/hooks/useAuth`, `/location?locationType=FARM&rootOnly=true&isActive=true` for the farm picker.

UI:
- Header: Primary Location (farm) — fixed text for `STANDARD_USER`; a select for other user types, defaulting to `getActiveFarmId()` (D13). Planning Date (read-only, from the response). Date From / Date To (defaults today, today + 7).
- Table columns, in this order (docx Section 3, plus Source and Range Demand): Batch No · Item Name · Shed No · Planning Date · Source · Current Inventory (Kg) · Current No. of Pigs · Per Day Intake (Kg) · No. of Days Inventory Left · Silo Level (Run Down) · Date to Refill · Required On · Demand in Range (Kg). `null` shows "—"; `runDownDate` null shows "Lasts the range"; `overdue` shows a danger badge "Overdue". Dates `dd-MMM-yyyy`.
- Below the table, the flags as plain sentences, e.g. "No feed row for WEANER day 32 on WG-2026-38 (29-Sep-2026)", "Head counts are held at the latest posted count; no movements are scheduled."
- Use the shared `Table` primitives, `StatRow` not required.

- [ ] **Step 1: Failing test** (mock `api.get`): renders the 13 headers; shows "Overdue" for an overdue row; shows "Lasts the range" for a null run-down; a STANDARD_USER sees no farm select.
- [ ] **Step 2: Run** `pnpm nx test web -- feed-forecast-panel` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, typecheck, lint (no new errors) → PASS.
- [ ] **Step 5: Commit** `feat(web): Inventory → Feed Forecast report`

---

### Task 9: Seeds and demo on the link table; drop `feed_silo_id`

**Files:**
- Modify: `seed-nine-farm-demo.ts` (the `UPDATE … SET feed_silo_id` after each silo → `INSERT IGNORE INTO silo_shed_link`), `seed-dev-tenant.ts` (same), `seed-farm-locations.ts` (every `feed_silo_id` use), `demo/farms.ts` (read `silo_shed_link`; a shed may now list several silos — `DemoShed.siloIds: string[]`, keep `siloId` as the first for chapter 02), `demo/chapters/02-inventory.ts` (use `siloIds`)
- Create: `apps/api/src/drizzle/tenant/0115_drop_feed_silo_id.sql` + journal entry 115
- Modify: `schema.ts` (remove `feed_silo_id`, its FK and index), `system-master-data-seed.ts` if it references it

- [x] **Step 1:** `grep -rn "feed_silo_id" apps/api/src apps/web/src` → only the files above remain; change each.
- [x] **Step 2: Migration 0115:**

```sql
-- silo_shed_link (0114) now carries every silo -> shed relation and nothing
-- reads feed_silo_id any more (spec D7).
ALTER TABLE `location_master` DROP FOREIGN KEY `location_master_feed_silo_id_fk`;
--> statement-breakpoint
DROP INDEX `idx_location_master_feed_silo_id` ON `location_master`;
--> statement-breakpoint
ALTER TABLE `location_master` DROP COLUMN `feed_silo_id`;
```
- [x] **Step 3:** `grep -rn "feed_silo_id" apps/api/src apps/web/src` → only the two migration files. Typecheck, all API and web tests → PASS.
- [x] **Step 4: Commit** `refactor(location): seeds and demo on silo_shed_link; drop feed_silo_id`

---

### Task 10: Rebuild, verify in MySQL, record

- [ ] **Step 1:** Ask Rishi to run `pnpm nx run api:db-rebuild-demo -- --apply`.
- [ ] **Step 2: Links and items:**
`SELECT COUNT(*) FROM nf_devco.silo_shed_link;` → 52. For VIL100: silo, linked shed, current item from `inventory_ledger` (sum of `remaining_quantity` by warehouse and item where positive).
- [ ] **Step 3: Hand-compute one row.** For VIL100's first shed: heads (`batch_header.closing_quantity`), day of stage from `scheduler_header.effective_from`, the lifecycle row's kg and wastage, the silo balance; compute demand, days left, run-down, refill, required-on by hand; compare with `GET /feed-forecast` for the same range. They must match exactly.
- [ ] **Step 4: Posting draws from the right silo.** Attach a second silo to a VIL100 shed, transfer a different feed item into it, post a daily feed entry for that item, and confirm the negative ledger row's `warehouse_id` is that silo. Try transferring an item another silo on the same shed already holds → refused with the D9 message.
- [ ] **Step 5:** Write `docs/VERIFICATION-2026-09-25-feed-forecast-a.md` (queries, outputs, the hand calculation) and add a `docs/decisions.md` entry summarising D1–D15.
- [ ] **Step 6: Commit** `docs: feed forecast plan A verification`
