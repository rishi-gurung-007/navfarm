# Feed TDD Alignment — Roadmap and Part A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the feed forecast and feed requisition match the TDD workbook (separate safety stock, first-shortage dates, workbook fields, no feed-era extras) and bring the local data in line, as the first of five parts.

**Architecture:** The pure engine (`feed-forecast.engine.ts`) stays the single calculation; the service feeds it settings from `FeedSettingsService.resolve`, which becomes the only home of the feed logistics values. The requisition rules (`feed-requisition.rules.ts`) turn engine sources into lines. Schema changes go through one additive migration (0141) with a `db-align-feed-tdd` data script after it; the column drop deferred by the 3 Oct ruling is a POST-MERGE follow-up, re-sited to migration **0146** (the 0142 slot this plan originally named for it was taken by `0142_reconcile_feed_stock_count`, applied during Part A — see I3, final whole-branch review).

**Tech Stack:** NestJS 11, Drizzle ORM, MySQL 8, Jest; Next.js 16 / React 19 web; Nx with pnpm.

**Spec:** `docs/superpowers/specs/2026-10-03-feed-tdd-alignment-and-inhouse-mill-design.md` (read it with this plan; Part A = spec §3, data = spec §7).

## Roadmap — five parts, one plan each

| Part | Plan | Spec | Depends on |
|---|---|---|---|
| A — forecast and requisition aligned | this file | §3, §7 | — |
| E — two entry points for feed, common requisition (Item/FA/Service) UI and Approvals detail; the feed document layout itself is Part A Task 9 | `2026-10-xx-feed-part-e-requisition.md`, written when A is merged into the branch | §6a | A |
| B — in-house mill pipeline | `…-feed-part-b-mill.md` | §4 | A, E |
| C — plan, scheduler, notifications | `…-feed-part-c-planning.md` | §5 | B |
| D — stock take and period close | `…-feed-part-d-stock-take.md` | §6 | A |

Each later plan is written against the code as it stands after the part before it, so it never
guesses at interfaces that do not exist yet. Each part ends with the running app and MySQL check
in its last task.

## Global Constraints

- Work only in the worktree `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`, branch `feat/feed-forecast-requisition-integration`.
- Local database `nf_devco` only. Never touch the test server or `nf_portatestnavfarm`.
- Safety stock default **0**; bulk multiple default **3000** KG; bag size default **50** KG; truck target default **30000** KG (a target, never a block); horizon default **7**, max **45** days.
- Shortfall = demand + safety stock − opening − confirmed incoming. The silo's Below Feed Level never enters it.
- Run-down date = first shortage date = first forecast day demand exceeds available opening.
- Keep `silo_reorder_days` and `feed_wastage_pct` columns and master fields; the forecast must not read them.
- Silo balance is always labelled **System Balance** (cp. 37).
- New UI strings go in the `en` dictionary only (`apps/web/src/utils/translations.ts`).
- Jest on this 8 GB machine: always `--maxWorkers=2` (memory `navfarm-8gb-memory-discipline`).
- `nx serve api` does not rebuild: after API edits, rebuild and restart by PID (`lsof -ti :2877`). Never `pkill`.
- Web lint gate: no new errors over the measured baseline (memory `web-lint-baseline-frozen`).
- One migration owner: this plan owns 0141 and `_journal.json` for it; the deferred drop is a separate POST-MERGE migration at 0146 (0142 was taken by `0142_reconcile_feed_stock_count` during Part A — see I3). Never edit `dist/drizzle`.
- Commit messages say what changed and why it was wrong before, quote the TDD sheet/row, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A silo with a low level and safety stock 0** — the order must equal the workbook (R2 9,000, not 12,000). Pinned in Task 3.
2. **A farm whose old farm-row logistics differ from the company setting** (e.g. bulk multiple 6000) — after the data script the forecast must still round to 6000 for that farm. Pinned in Task 2 and Task 8.
3. **A next-diet silo whose stock never runs out in the window** — no shortage date, recommended qty 0, no line drafted. Pinned in Task 4.
4. **An order that overfills the silo** (12,000 capacity, 1,000 opening, 12,000 order) — warning set, quantity unchanged. Pinned in Task 4.
5. **Editing a drafted delivery date without remarks** — refused; with remarks accepted. Pinned in Task 5.

---

## File Structure (Part A)

| File | Responsibility | Change |
|---|---|---|
| `apps/api/src/drizzle/tenant/0141_feed_tdd_alignment.sql` | additive columns | create |
| `apps/api/src/drizzle/tenant/0146_drop_feed_era_columns.sql` | drop feed-era columns — POST-MERGE follow-up, not this wave (re-sited from 0142; see I3). Part E's 0147 (`when: 1792000000016`) now exists journalled after 0145 with 0146 left open; drizzle applies by `when`, not idx, so **0146 MUST be journalled with a `when` greater than 0147's** (e.g. `1792000000017`) or any database that already ran 0147 will skip 0146 silently | deferred |
| `apps/api/src/drizzle/tenant/meta/_journal.json` | journal 141 (0146 follow-up journals separately, post-merge) | modify |
| `apps/api/src/drizzle/tenant/feed-tdd-migrations.spec.ts` | migration contract | create |
| `apps/api/src/core/database/schema.ts` | Drizzle schema | modify |
| `apps/api/src/modules/inventory/feed-settings/feed-settings.rules.ts` / `.service.ts` / `dto/feed-settings.dto.ts` | logistics + safety stock, farm override | modify |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` | calculation | modify |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`, `feed-forecast.view.ts`, `feed-forecast-run.rules.ts`, `feed-forecast-run.service.ts`, `dto/feed-forecast.dto.ts`, `feed-forecast.stock.ts` | plumbing, run lines | modify |
| `apps/api/src/modules/inventory/feed-forecast/feed-silo-status.ts` (+ spec) | derived silo fields | create |
| `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts` / `.service.ts` / `dto/*` | lines, delivery date, capacity warning, numbering | modify |
| `apps/api/src/modules/master-data/location/*`, `item/*`, breed lifecycle DTO/service | fields | modify |
| `apps/api/src/scripts/align-feed-tdd.ts` (+ `apps/api/package.json` target `db-align-feed-tdd`) | data | create |
| `apps/web/src/components/console/inventory/feed-forecast-grid.tsx`, `feed-forecast-panel.tsx`, `feed-planning-panel.tsx`, `feed-silo-dashboard.tsx` (new), `feed-forecast-tabs.tsx`, `requisitions-panel.tsx` | UI | modify/create |
| `apps/web/src/modules/master-data/configs.ts`, `apps/web/src/utils/translations.ts` | master fields, labels | modify |

---

### Task 1: Migration 0141 (additive) and schema

**Files:**
- Create: `apps/api/src/drizzle/tenant/0141_feed_tdd_alignment.sql`
- Create: `apps/api/src/drizzle/tenant/feed-tdd-migrations.spec.ts`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`
- Modify: `apps/api/src/core/database/schema.ts` (`feedPlanningSetting` ~283, `itemMaster` ~874, `breedLifecycleStages` ~2259, `requisition` ~4370, `requisitionLine` ~4430)

**Interfaces:**
- Produces columns: `feed_planning_setting.safety_stock_kg decimal(14,2) NOT NULL DEFAULT 0`, `feed_planning_setting.bag_size_kg decimal(14,2) NULL`; `item_master.diet_no int NULL`; `breed_lifecycle_stages.feed_form varchar(10) NULL`; `requisition.linked_transfer_id varchar(36) NULL`; `requisition_line.mill_approved_qty_kg decimal(18,4) NULL`, `requisition_line.recommended_delivery_date date NULL`, `requisition_line.exceeds_silo_capacity boolean NOT NULL DEFAULT false`.
- Drizzle names: `feedPlanningSetting.safety_stock_kg`, `.bag_size_kg`; `itemMaster.diet_no`; `breedLifecycleStages.feed_form`; `requisition.linked_transfer_id`; `requisitionLine.mill_approved_qty_kg`, `.recommended_delivery_date`, `.exceeds_silo_capacity`.

- [ ] **Step 1: Write the failing migration test**

```ts
// apps/api/src/drizzle/tenant/feed-tdd-migrations.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0141 — feed TDD alignment (additive)', () => {
  it('is journalled at idx 141 after 0140', () => {
    expect(journal().find((e) => e.idx === 141)).toEqual({ idx: 141, version: '5', when: 1792000000010, tag: '0141_feed_tdd_alignment', breakpoints: true });
  });

  it('adds exactly the workbook columns and nothing destructive', () => {
    const sql = statements('0141_feed_tdd_alignment');
    expect(sql).toEqual([
      'ALTER TABLE `feed_planning_setting` ADD `safety_stock_kg` decimal(14,2) NOT NULL DEFAULT \'0.00\';',
      'ALTER TABLE `feed_planning_setting` ADD `bag_size_kg` decimal(14,2);',
      'ALTER TABLE `item_master` ADD `diet_no` int;',
      'ALTER TABLE `breed_lifecycle_stages` ADD `feed_form` varchar(10);',
      'ALTER TABLE `requisition` ADD `linked_transfer_id` varchar(36);',
      'ALTER TABLE `requisition_line` ADD `mill_approved_qty_kg` decimal(18,4);',
      'ALTER TABLE `requisition_line` ADD `recommended_delivery_date` date;',
      'ALTER TABLE `requisition_line` ADD `exceeds_silo_capacity` boolean NOT NULL DEFAULT false;',
      'ALTER TABLE `requisition` ADD CONSTRAINT `requisition_linked_transfer_fk` FOREIGN KEY (`linked_transfer_id`) REFERENCES `stock_transfer`(`transfer_id`) ON DELETE set null ON UPDATE no action;',
    ]);
    expect(sql.join('\n')).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/i);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd apps/api && npx jest src/drizzle/tenant/feed-tdd-migrations.spec.ts --maxWorkers=2`
Expected: FAIL — `ENOENT ... 0141_feed_tdd_alignment.sql`.

- [ ] **Step 3: Write the migration, journal entry and schema columns**

`0141_feed_tdd_alignment.sql` — the nine statements above, in that order, each followed by `--> statement-breakpoint` except the last, with a first line comment `-- Feed TDD alignment (spec 2026-10-03 §3.2): safety stock, bag size, diet no, feed form, mill/TO links on requisition.`

Append to `_journal.json` `entries`:

```json
{ "idx": 141, "version": "5", "when": 1792000000010, "tag": "0141_feed_tdd_alignment", "breakpoints": true }
```

In `schema.ts`:

```ts
// feedPlanningSetting, after bulk_multiple_kg
  // TDD Engine Step 8 / Dashboard row 60: configured safety stock; the Worked Example's buffer is zero.
  safety_stock_kg: decimal('safety_stock_kg', { precision: 14, scale: 2 }).default('0.00').notNull(),
  bag_size_kg: decimal('bag_size_kg', { precision: 14, scale: 2 }),
// itemMaster
  diet_no: int('diet_no'), // TDD Master Setup §2 / Loading Sheet row 65: Diet number 1 to 14
// breedLifecycleStages, after feed_item_id
  feed_form: varchar('feed_form', { length: 10 }), // TDD Master Setup row 37: BULK | BAGGED
// requisition, after supply_source
  linked_transfer_id: varchar('linked_transfer_id', { length: 36 }).references((): AnyMySqlColumn => stockTransfer.transfer_id, { onDelete: 'set null' }), // Req. §1 row 39
// requisitionLine, after recommended_qty_kg
  mill_approved_qty_kg: decimal('mill_approved_qty_kg', { precision: 18, scale: 4 }), // Consolidation row 126
  recommended_delivery_date: date('recommended_delivery_date', { mode: 'string' }), // drafted date; edits need remarks (Req. row 29)
  exceeds_silo_capacity: boolean('exceeds_silo_capacity').default(false).notNull(), // Engine Step 8 free-capacity warning
```

The FK name in schema must be `requisition_linked_transfer_fk`: if Drizzle generates a different name, declare it in the table's foreign-key block with `foreignKey({ columns: [table.linked_transfer_id], foreignColumns: [stockTransfer.transfer_id], name: 'requisition_linked_transfer_fk' }).onDelete('set null')` and drop the inline `.references`.

- [ ] **Step 4: Run test and typecheck**

Run: `cd apps/api && npx jest src/drizzle/tenant --maxWorkers=2` → PASS (0135–0140 spec still passes).
Run: `pnpm nx run api:typecheck` → 0 errors.

- [ ] **Step 5: Apply locally and read MySQL**

```bash
mysqldump -u root nf_devco > /private/tmp/claude-501/-Users-nero-Desktop-navfarm/f0c866c5-cf96-4f53-987a-1efa659eca1e/scratchpad/nf_devco-before-0135.sql
pnpm nx run api:db-migrate-all-tenants
mysql -u root nf_devco -e "select count(*) from __drizzle_migrations; show columns from feed_planning_setting like 'safety_stock_kg'; show columns from requisition_line like 'exceeds_silo_capacity';"
```
Expected: 142 journal rows (0000–0141), both columns present. Output must contain no `FAILED`. Every tenant DB in the output is local; if a non-local host appears, stop.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/drizzle/tenant/0141_feed_tdd_alignment.sql apps/api/src/drizzle/tenant/meta/_journal.json apps/api/src/drizzle/tenant/feed-tdd-migrations.spec.ts apps/api/src/core/database/schema.ts
git commit   # message: why each column (TDD rows), and that 0135–0140 were applied to nf_devco for the first time
```

---

### Task 2: Feed Planning Settings own the logistics values and safety stock

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-settings/feed-settings.rules.ts`
- Modify: `apps/api/src/modules/inventory/feed-settings/feed-settings.service.ts:21-77` (`resolve`) and `saveCompany`/farm save
- Modify: `apps/api/src/modules/inventory/feed-settings/dto/feed-settings.dto.ts`
- Test: `apps/api/src/modules/inventory/feed-settings/feed-settings.rules.spec.ts`, `feed-settings.service.spec.ts`

**Interfaces:**
- Produces: `resolvePlanningRules(row)` returns additionally `safetyStockKg: number` (default 0), `bagSizeKg: number` (default 50), and `bulkMultipleKg: number` (default 3000), `truckTargetKg: number` (default 30000), `productionWeekday: number` (default 0) — the last three were `number | null`, now always numbers.
- Produces: `FeedSettingsService.resolve(companyId, farmId?)` applies a farm row's non-null `safety_stock_kg`, `bag_size_kg`, `bulk_multiple_kg`, `truck_target_kg`, `production_weekday` over the company row, and reports `sources.logistics: 'FARM' | 'COMPANY' | 'SYSTEM'`. It no longer returns `leadTimeDays` or `sources.leadTime`.
- Produces: `toFarmFeedSettings(resolved): FarmFeedSettings` exported from `feed-settings.rules.ts` = `{ bulkMultipleKg, bagSizeKg, truckTargetKg, productionWeekday, safetyStockKg }`. `FarmFeedSettings` in `feed-requisition.rules.ts` gains `safetyStockKg: number`; `DEFAULT_FEED_SETTINGS` gains `safetyStockKg: 0`.

- [ ] **Step 1: Failing rules tests**

```ts
// feed-settings.rules.spec.ts — add
describe('resolvePlanningRules — logistics and safety stock (TDD Engine Step 8)', () => {
  it('defaults to the workbook defaults with zero safety stock', () => {
    expect(resolvePlanningRules(null)).toMatchObject({ safetyStockKg: 0, bagSizeKg: 50, bulkMultipleKg: 3000, truckTargetKg: 30000, productionWeekday: 0 });
  });
  it('reads stored decimals as numbers', () => {
    expect(resolvePlanningRules({ safety_stock_kg: '500.00', bag_size_kg: '25.00', bulk_multiple_kg: '6000.00' }))
      .toMatchObject({ safetyStockKg: 500, bagSizeKg: 25, bulkMultipleKg: 6000 });
  });
  it('refuses negative safety stock and non-positive multiples', () => {
    expect(() => resolvePlanningRules({ safety_stock_kg: -1 })).toThrow('Safety stock cannot be negative.');
    expect(() => resolvePlanningRules({ bag_size_kg: 0 })).toThrow('Bag size must be greater than zero.');
    expect(() => resolvePlanningRules({ bulk_multiple_kg: 0 })).toThrow('Bulk multiple must be greater than zero.');
  });
});
```

Service test (in `feed-settings.service.spec.ts`, using the file's existing db mock helpers): company row `bulk_multiple_kg '3000.00'`, farm row `bulk_multiple_kg '6000.00', safety_stock_kg null` → `resolve('c1','f1')` gives `bulkMultipleKg: 6000, safetyStockKg: 0, sources.logistics: 'FARM'`; and the result has no `leadTimeDays` key (`expect(result).not.toHaveProperty('leadTimeDays')`).

- [ ] **Step 2: Run and see them fail**

Run: `cd apps/api && npx jest src/modules/inventory/feed-settings --maxWorkers=2` → FAIL (`safetyStockKg` undefined).

- [ ] **Step 3: Implement**

In `feed-settings.rules.ts`, add `safety_stock_kg` and `bag_size_kg` to `PersistedPlanningSetting`, then:

```ts
const positive = (value: number | null, fallback: number, label: string): number => {
  const v = value ?? fallback;
  if (!(v > 0)) throw new BadRequestException(`${label} must be greater than zero.`);
  return v;
};
// inside resolvePlanningRules, before return
  const safetyStockKg = numberOrNull(row?.safety_stock_kg) ?? 0;
  if (safetyStockKg < 0) throw new BadRequestException('Safety stock cannot be negative.');
// in the returned object, replace the three nullable fields:
    productionWeekday: weekday(row?.production_weekday ?? null, 'Production weekday') ?? 0,
    truckTargetKg: positive(numberOrNull(row?.truck_target_kg), 30000, 'Truck target'),
    bulkMultipleKg: positive(numberOrNull(row?.bulk_multiple_kg), 3000, 'Bulk multiple'),
    bagSizeKg: positive(numberOrNull(row?.bag_size_kg), 50, 'Bag size'),
    safetyStockKg,

export function toFarmFeedSettings(r: ReturnType<typeof resolvePlanningRules>) {
  return { bulkMultipleKg: r.bulkMultipleKg, bagSizeKg: r.bagSizeKg, truckTargetKg: r.truckTargetKg, productionWeekday: r.productionWeekday, safetyStockKg: r.safetyStockKg };
}
```

In `feed-settings.service.ts` `resolve`: drop `feed_lead_time_days` from the farm select; after computing `effective`, overlay the farm row:

```ts
    const LOGISTICS = ['safety_stock_kg', 'bag_size_kg', 'bulk_multiple_kg', 'truck_target_kg', 'production_weekday'] as const;
    const farmLogistics = farmSetting ? Object.fromEntries(LOGISTICS.filter((k) => farmSetting[k] !== null && farmSetting[k] !== undefined).map((k) => [k, farmSetting[k]])) : {};
    if (Object.keys(farmLogistics).length) {
      const merged = resolvePlanningRules({ ...companySetting, ...farmLogistics });
      Object.assign(effective, { safetyStockKg: merged.safetyStockKg, bagSizeKg: merged.bagSizeKg, bulkMultipleKg: merged.bulkMultipleKg, truckTargetKg: merged.truckTargetKg, productionWeekday: merged.productionWeekday });
    }
```

and return `sources.logistics: Object.keys(farmLogistics).length ? 'FARM' : companySetting ? 'COMPANY' : 'SYSTEM'`, removing `leadTimeDays` and `sources.leadTime`. Add `safety_stock_kg` (`@IsOptional() @IsNumber() @Min(0)`) and `bag_size_kg` (`@IsOptional() @IsNumber() @IsPositive()`) to both the company and farm DTOs and to the save paths' column lists. Add `safetyStockKg: number` to `FarmFeedSettings` and `safetyStockKg: 0` to `DEFAULT_FEED_SETTINGS` in `feed-requisition.rules.ts`.

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx jest src/modules/inventory/feed-settings src/modules/procurement/feed-requisition --maxWorkers=2` → PASS. Fix any spec that asserted `leadTimeDays` from `resolve` by deleting that assertion (lead time is gone, spec R6).

- [ ] **Step 5: Commit** — `feat(feed): planning settings own logistics and safety stock (TDD Engine Step 8)`.

---

### Task 3: Engine — safety stock shortfall, no refill/lead-time, one-decimal days

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` (lines ~74–105 input, 140–162 `ForecastRow`, 176–208 `DailyForecastRow`, 210–235 `ForecastSource`, 495–506, 660–750 projection, 800–880 assembly, 895–915)
- Test: `feed-forecast.engine.sources.spec.ts` (new block), and update `feed-forecast.engine*.spec.ts`, `feed-forecast.refill-per-silo.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ForecastInput` without `leadTimeDays`; silo entries without `reorderDays`; new optional `safetyStockKg?: number` (default 0). `ForecastSource` without `refillDate`, `requiredOn`, `overdue`; with `safetyStockKg: number`, `deliveryDayOpeningKg: number` (projected opening on `shortageDate ?? to`), `daysLeft: number | null` rounded to 1 decimal. `ForecastRow` and `DailyForecastRow` without `refillDate`, `requiredOn`, `overdue`; `DailyForecastRow.daysOfStock` 1 decimal. `DEFAULT_REFILL_BUFFER_DAYS` deleted. `runDownDate` and `shortageDate` both remain and are equal.

- [ ] **Step 1: Failing test — the workbook's own master data**

```ts
// feed-forecast.engine.sources.spec.ts — add after the existing describe
describe('buildFeedForecast — TDD workbook alignment (3 Oct rulings 2 and 3)', () => {
  const withLevels = (safetyStockKg?: number): ForecastInput => ({
    ...workedExample,
    safetyStockKg,
    silos: workedExample.silos.map((s) => ({ ...s, lowLevelKg: 1000 })), // Master Setup row 10: 1,000 KG each
  });

  it('orders the workbook quantities even with the 1,000 KG Below Feed Level set', () => {
    const { sources } = buildFeedForecast(withLevels());
    expect(sources.map((s) => [s.itemId, s.walkDemandKg, s.shortfallKg, s.shortageDate, s.safetyStockKg]))
      .toEqual([['r1', 6000, 4500, '2026-09-23', 0], ['r2', 10000, 9000, '2026-09-26', 0]]);
  });

  it('adds configured safety stock to the shortfall', () => {
    const { sources } = buildFeedForecast(withLevels(500));
    expect(sources.map((s) => s.shortfallKg)).toEqual([5000, 9500]);
  });

  it('no longer reports refill or required-on dates', () => {
    const { sources, rows, daily } = buildFeedForecast(withLevels());
    for (const o of [...sources, ...rows, ...daily]) {
      expect(o).not.toHaveProperty('refillDate');
      expect(o).not.toHaveProperty('requiredOn');
      expect(o).not.toHaveProperty('overdue');
    }
  });

  it('gives days remaining to one decimal and the delivery-day opening', () => {
    const input = withLevels();
    input.silos = input.silos.map((s) => (s.siloId === 's1' ? { ...s, balanceKg: 5500 } : s));
    const r1 = buildFeedForecast(input).sources.find((s) => s.itemId === 'r1')!;
    expect(r1.daysLeft).toBe(2.8); // 5,500 ÷ 2,000 = 2.75 → 2.8 (Silo Balance row 9: "about 2.75 days", one decimal)
    // 5,500 lasts 23–24 Sep; on 25 Sep the opening is 1,500 against 2,000 demand → shortage 25 Sep, opening 1,500.
    expect(r1.shortageDate).toBe('2026-09-25');
    expect(r1.deliveryDayOpeningKg).toBe(1500);
  });
});
```

Also delete `leadTimeDays: 0` from the `workedExample` fixture in every engine spec and remove `reorderDays` from silo fixtures (`feed-forecast.refill-per-silo.spec.ts` tested only refill dates: delete that file — its subject no longer exists, spec R6).

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/api && npx jest src/modules/inventory/feed-forecast/feed-forecast.engine.sources.spec.ts --maxWorkers=2` → FAIL (R2 shortfall 10000, `safetyStockKg` undefined).

- [ ] **Step 3: Implement in the engine**

1. Delete `DEFAULT_REFILL_BUFFER_DAYS`, `refillBufferDaysFor`, the `leadTimeDays` field and its doc comment, and `reorderDays` from the silo type. Add to `ForecastInput`:
   ```ts
   /** TDD Engine Step 8 / Dashboard row 60: configured safety stock per silo and item. Worked Example: 0. */
   safetyStockKg?: number;
   ```
2. In the projection loop replace the refill block and the shortfall line:
   ```ts
   const safety = toMicrograms(input.safetyStockKg ?? 0);
   const daysLeft = sourceDailyDemandMicrograms > 0 ? Math.round((planningOpening / sourceDailyDemandMicrograms) * 10) / 10 : null;
   ...
   // Dashboard row 60: demand plus safety stock minus available opening and confirmed incoming. The silo's
   // Below Feed Level is an alert threshold only (3 Oct ruling 2, supersedes Q3).
   shortfallMicrograms = Math.max(shortfallMicrograms, walkDemandMicrograms + safety - planningOpening - incomingMicrograms);
   ...
   const deliveryDay = shortageDate ?? input.to;
   const deliveryDayOpeningMicrograms = opening.get(deliveryDay) ?? planningOpening;
   ```
   and store `safetyStockKg: toKg(safety)`, `deliveryDayOpeningKg: toKg(deliveryDayOpeningMicrograms)` in the projection; remove `refillDate`, `requiredOn`, `overdue` from the projection type, `projectionByKey.set`, the sources mapping, the daily-row mapping and the `ForecastRow` assembly. Keep `thresholdKg` (alerts still use it).
3. Daily row: `daysOfStock: ... ? Math.round((opening / rowIntakeMicrograms) * 10) / 10 : null`.
4. Update the file header comments that describe D19 refill/required-on and Q3 to say they are superseded by the 3 Oct rulings.

- [ ] **Step 4: Fix the engine specs and run**

Run: `cd apps/api && npx jest src/modules/inventory/feed-forecast/feed-forecast.engine --maxWorkers=2`.
For each failure: remove `refillDate`/`requiredOn`/`overdue` expectations; change `daysLeft`/`daysOfStock` expectations from floors to one-decimal values (compute each by hand from the fixture: balance ÷ that day's demand, rounded half-up to 1 decimal); change any shortfall that included a non-zero `thresholdKg` to the threshold-free value. Do not change a demand, shortage-date or diet-change expectation — if one of those fails, the implementation is wrong. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(feed): shortfall uses separate safety stock; drop refill and lead time (TDD Dashboard 60, Engine Step 7–8)`; quote the 12,000 → 9,000 R2 result.

---

### Task 4: Forecast service, view, saved runs

**Files:**
- Modify: `feed-forecast.service.ts` (~56–111 input building, ~236, ~645, ~759–778 farm settings writes), `feed-forecast.view.ts`, `feed-forecast.stock.ts`, `feed-forecast-run.rules.ts`, `feed-forecast-run.service.ts`, `dto/feed-forecast.dto.ts`
- Test: `feed-forecast.service.spec.ts`, `feed-forecast.farm-settings.spec.ts`, `feed-forecast-run.rules.spec.ts`, `feed-forecast.save-run.spec.ts`, `feed-forecast.view.spec.ts`

**Interfaces:**
- Consumes: `FeedSettingsService.resolve(companyId, farmId)` (Task 2) and `ForecastInput.safetyStockKg` (Task 3).
- Produces: `FeedForecastReport` without `leadTimeDays`, with `settings: { safetyStockKg: number; bulkMultipleKg: number; bagSizeKg: number }`. Saved run lines no longer carry `required_on_date` (column dropped in Task 8; stop writing it here).

- [ ] **Step 1: Failing service test**

In `feed-forecast.service.spec.ts`, with the spec's existing mocks, make the settings stub return `safetyStockKg: 500` and assert the engine spy received `expect.objectContaining({ safetyStockKg: 500 })` and not a `leadTimeDays` key, and that the report has `settings.safetyStockKg === 500` and no `leadTimeDays`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

- Inject `FeedSettingsService` into `FeedForecastService` (add `FeedSettingsModule` to `feed-forecast.module.ts` imports if not already present) and in `computeForFarm` call `const settings = await this.feedSettings.resolve(companyId, farmId);` then pass `safetyStockKg: settings.safetyStockKg` to `buildFeedForecast`; delete every read of `feed_lead_time_days`, `feed_refill_buffer_days` and `silo_reorder_days` and the `leadTimeDays`/`reorderDays` fields in the service's internal types.
- Delete the farm-setting writes for `feed_lead_time_days` (the `{ key: 'feed_lead_time_days', ... }` entry ~759) and the silo `silo_reorder_days` write from the forecast's silo-settings endpoint (the column stays; Location Master still edits it, spec R6).
- `feed-forecast-run.rules.ts` / `.service.ts`: stop mapping `requiredOn` to `required_on_date`.
- `feed-forecast.view.ts`: drop refill/required-on/overdue from grouped rows.
- Report: replace `leadTimeDays: result.leadTimeDays` with `settings: { safetyStockKg, bulkMultipleKg, bagSizeKg }`.

- [ ] **Step 4: Run the whole feed-forecast folder**

Run: `cd apps/api && npx jest src/modules/inventory/feed-forecast src/modules/inventory/feed-alert --maxWorkers=2` → PASS after removing assertions on deleted fields only.

- [ ] **Step 5: Commit** — `feat(feed): forecast reads safety stock from planning settings; stop writing lead-time and refill evidence`.

---

### Task 5: Requisition lines — delivery date, capacity warning, line numbers

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts:130-240`
- Modify: `feed-requisition.service.ts` (settings loader ~150–176, line insert/update, `update` path), `dto/*` (update DTO)
- Test: `feed-requisition.rules.spec.ts`, `feed-requisition.service.spec.ts`

**Interfaces:**
- Consumes: `toFarmFeedSettings` (Task 2), `ForecastSource.deliveryDayOpeningKg`, `shortageDate` (Task 3).
- Produces: `DestinationInfo` gains `capacityKg: number | null`. `DraftLine` gains `recommendedDeliveryDate: string`, `exceedsSiloCapacity: boolean`, `lineNo: number`. `DraftLine.proposedDeliveryDate = recommendedDeliveryDate`. Export `deliveryDateNeedsRemarks(line: { recommendedDeliveryDate: string | null; proposedDeliveryDate: string }): boolean`. Feed lines are stored with `line_seq` = 10000, 20000, … in draft order.

- [ ] **Step 1: Failing rules tests**

```ts
describe('recommendLines — workbook delivery date and capacity (Req. row 29, Engine Step 8)', () => {
  const base = { planningDate: '2026-09-23', to: '2026-09-29', settings: { ...DEFAULT_FEED_SETTINGS } };
  const dest = (capacityKg: number | null) => new Map([
    ['s1', { locationId: 's1', locationType: 'SILO' as const, feedInBags: false, lowLevelKg: 1000, capacityKg }],
    ['s2', { locationId: 's2', locationType: 'SILO' as const, feedInBags: false, lowLevelKg: 1000, capacityKg }],
  ]);

  it('delivers on the first shortage date and numbers lines 10000, 20000', () => {
    const lines = recommendLines({ ...base, sources: buildFeedForecast(workedExampleWithLevels).sources, destinations: dest(12000) });
    expect(lines.map((l) => [l.itemId, l.recommendedQtyKg, l.recommendedDeliveryDate, l.proposedDeliveryDate, l.lineNo, l.exceedsSiloCapacity]))
      .toEqual([['r1', 6000, '2026-09-23', '2026-09-23', 10000, false], ['r2', 9000, '2026-09-26', '2026-09-26', 20000, false]]);
  });

  it('warns but keeps the quantity when the order would overfill the silo', () => {
    const lines = recommendLines({ ...base, sources: buildFeedForecast(workedExampleWithLevels).sources, destinations: dest(9500) });
    const r2 = lines.find((l) => l.itemId === 'r2')!;
    expect([r2.recommendedQtyKg, r2.exceedsSiloCapacity]).toEqual([9000, true]); // 9,000 + 1,000 opening > 9,500
  });

  it('drafts nothing for a next-diet silo that never runs short in the window', () => {
    const input = { ...workedExampleWithLevels, silos: workedExampleWithLevels.silos.map((s) => (s.siloId === 's2' ? { ...s, balanceKg: 11000 } : s)) };
    const lines = recommendLines({ ...base, sources: buildFeedForecast(input).sources, destinations: dest(12000) });
    expect(lines.map((l) => l.itemId)).toEqual(['r1']);
  });
});

describe('deliveryDateNeedsRemarks', () => {
  it('requires remarks only when the date moved from the drafted one', () => {
    expect(deliveryDateNeedsRemarks({ recommendedDeliveryDate: '2026-09-23', proposedDeliveryDate: '2026-09-23' })).toBe(false);
    expect(deliveryDateNeedsRemarks({ recommendedDeliveryDate: '2026-09-23', proposedDeliveryDate: '2026-09-24' })).toBe(true);
    expect(deliveryDateNeedsRemarks({ recommendedDeliveryDate: null, proposedDeliveryDate: '2026-09-24' })).toBe(false); // manual line
  });
});
```

Define `workedExampleWithLevels` at the top of the spec: the engine Worked Example fixture (copy from `feed-forecast.engine.sources.spec.ts`) with `lowLevelKg: 1000` on both silos and no `leadTimeDays`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

In `recommendLines`:

```ts
    const unroundedNeedKg = Math.max(0, round3(s.shortfallKg));
    if (unroundedNeedKg <= 0) continue; // Engine Step 8: no shortage, no order (supersedes the "lands on its level" minimum)
    ...
    const recommendedQtyKg = roundOrderKg(unroundedNeedKg, feedType, settings);
    // Req. row 29: derived from the earliest projected shortage; nothing short in the window → the window's end.
    const shortage = s.shortageDate ?? null;
    const recommendedDeliveryDate = shortage ? (shortage < planningDate ? planningDate : shortage) : to;
    const exceedsSiloCapacity = dest.locationType === 'SILO' && dest.capacityKg !== null
      && recommendedQtyKg + s.deliveryDayOpeningKg > dest.capacityKg + 1e-6;
    lines.push({ ..., recommendedDeliveryDate, proposedDeliveryDate: recommendedDeliveryDate, exceedsSiloCapacity, lineNo: (lines.length + 1) * 10000 });
```

Remove the `runsDownInWindow` branch and the minimum-one-compartment fallback (not in the workbook). Add:

```ts
/** Req. row 29: "Farm Manager can edit with reason". */
export function deliveryDateNeedsRemarks(line: { recommendedDeliveryDate: string | null; proposedDeliveryDate: string }): boolean {
  return line.recommendedDeliveryDate !== null && line.proposedDeliveryDate !== line.recommendedDeliveryDate;
}
```

Include it in `approvalProblems` and in the update path's remarks check next to `deviationNeedsRemarks` with message `Remarks are required when a delivery date differs from the forecast's (Requisition row 29).`

Service: replace the farm-row settings loader with `toFarmFeedSettings(await this.feedSettings.resolve(companyId, farmId))` (inject `FeedSettingsService`), keep reading `location_code` for the req number; add `silo_capacity_kg` to the destination select as `capacityKg`; write `recommended_delivery_date`, `exceeds_silo_capacity`, and `line_seq: line.lineNo` on insert and update.

- [ ] **Step 4: Run** `cd apps/api && npx jest src/modules/procurement --maxWorkers=2` → PASS (update older expectations of `line_seq` 1,2 to 10000,20000 and of minimum-compartment lines by removing them).

- [ ] **Step 5: Commit** — `feat(feed): requisition delivery date from first shortage, capacity warning, 10000-step lines (Req. rows 29, 42; Engine Step 8)`.

---

### Task 6: Workbook fields on masters — item diet no., lifecycle feed form, silo labels

**Files:**
- Modify: `apps/api/src/modules/master-data/item/dto/item.dto.ts`, `item.service.ts`
- Modify: breed lifecycle DTO/service (find with `grep -rln "feed_qty_per_head_per_day_kg" apps/api/src/modules/master-data | grep -v spec`)
- Modify: `apps/api/src/modules/master-data/location/dto/location.dto.ts`, `location.service.ts` (remove the six feed-era farm fields from DTO and writes)
- Modify: `apps/web/src/modules/master-data/configs.ts`, `apps/web/src/utils/translations.ts`
- Test: the item, lifecycle and location service specs; `apps/web/specs/*` guard specs

**Interfaces:**
- Produces API fields: item `diet_no` (integer 1–14, optional); lifecycle `feed_form` (`'BULK' | 'BAGGED'`, optional). Location DTO no longer accepts `feed_refill_buffer_days`, `feed_lead_time_days`, `feed_bulk_multiple_kg`, `feed_bag_size_kg`, `feed_truck_target_kg`, `feed_production_weekday`.

- [ ] **Step 1: Failing DTO tests** — item DTO validation: `diet_no: 15` fails with `Diet No. must be between 1 and 14.`, `diet_no: 4` passes; lifecycle DTO `feed_form: 'LOOSE'` fails, `'BULK'` passes; location DTO with `feed_lead_time_days: 2` is rejected by the whitelist (`forbidNonWhitelisted` behaviour of the global pipe — assert via `validate(plainToInstance(...), { whitelist: true, forbidNonWhitelisted: true })` returns an error on that property).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — DTO decorators `@IsOptional() @IsInt() @Min(1) @Max(14)` with the message above; `@IsOptional() @IsIn(['BULK','BAGGED'])`; persist both in the services' insert/update column lists; delete the six fields from the location DTO and service. In `configs.ts`: add `diet_no` (number, label `dietNo`) to the item config, `feed_form` (select BULK/BAGGED, label `feedForm`) to the lifecycle config, remove the six farm fields from the location config, relabel `low_level_kg` → `belowFeedLevelKg` ("Below Feed Level KG") and `high_level_kg` → `aboveThresholdKg` ("Above Threshold KG"), and show `feed_in_bags` as `feedType` with options BULK (false) / BAGGED (true). Add the `en` strings.

- [ ] **Step 4: Run** API master-data specs and `pnpm nx test web -- --maxWorkers=2` (guard specs included) → PASS.

- [ ] **Step 5: Commit** — `feat(masters): Diet No., lifecycle feed form, workbook silo labels; farm rows lose feed-era logistics (TDD Master Setup §1–3)`.

---

### Task 7: Silo dashboard — derived workbook fields (Engine §4, Master Setup §1)

**Files:**
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-silo-status.ts`, `feed-silo-status.spec.ts`
- Modify: `feed-forecast.service.ts` (new method `siloStatus`), `feed-forecast.controller.ts` (`GET /feed-forecast/silo-status?farmId=&planningDate=`)
- Create: `apps/web/src/components/console/inventory/feed-silo-dashboard.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-tabs.tsx` (new first tab "Dashboard"), translations

**Interfaces:**
- Produces: `buildSiloStatus(args: { silos: SiloFact[]; result: Pick<ForecastResult, 'sources' | 'dietChanges'>; requisitionStatusBySilo: Map<string, string>; submissionDeadline: string | null }): SiloStatusRow[]` where

```ts
export interface SiloFact {
  siloId: string; siloCode: string; houseCodes: string[]; capacityKg: number | null; belowFeedLevelKg: number | null;
  aboveThresholdKg: number | null; feedInSiloItemId: string | null; feedInSiloItemName: string | null; feedType: 'BULK' | 'BAGGED';
  systemBalanceKg: number; lastApprovedCountKg: number | null; lastApprovedCountAt: string | null; lastFeedReceiptDate: string | null; blocked: boolean;
}
export interface SiloStatusRow extends SiloFact {
  currentDietItemId: string | null; dailyRequirementKg: number; daysRemaining: number | null; firstShortageDate: string | null;
  projectedNeedKg: number; nextDietItemId: string | null; nextDietDate: string | null; siloAvailableForNextDiet: boolean | null;
  projectedShortfallKg: number; recommendedOrderKg: number; requisitionStatus: string | null; submissionDeadline: string | null;
  alert: 'CRITICAL_FIRST_PRIORITY' | 'INFO' | null; // at/below Below Feed Level; at/above Above Threshold (Dashboard row 53)
}
```
- Feed in Silo = item of the last posted inbound movement into the silo (Master Setup row 16), read from the inventory ledger; Available Stock = `systemBalanceKg` of that item.

- [ ] **Step 1: Failing pure test** — Worked Example: SILO1 (R1, 1,500, capacity 12,000, below 1,000, above 10,800) and SILO2 (R2, 1,000). Expect SILO1 row `{ currentDietItemId: 'r1', dailyRequirementKg: 2000, firstShortageDate: '2026-09-23', projectedNeedKg: 6000, nextDietItemId: 'r2', nextDietDate: '2026-09-26', projectedShortfallKg: 4500, recommendedOrderKg: 6000, alert: null }` and SILO2 `{ currentDietItemId: null, projectedNeedKg: 10000, projectedShortfallKg: 9000, recommendedOrderKg: 9000, alert: 'CRITICAL_FIRST_PRIORITY' }` (1,000 ≤ 1,000). A third silo with balance 11,000 and above 10,800 → `alert: 'INFO'`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `buildSiloStatus` from the engine sources (one source per silo+item; current diet = source with `planningDayDemandKg > 0`; next diet from `dietChanges` whose `nextSourceCode` is this silo), rounding orders with `roundOrderKg`. Service method loads silo facts (location_master + `silo_shed_link` + ledger last inbound + latest POSTED `feed_stock_count_line`), runs `computeForFarm` for a 7-day window from the planning date, and joins open feed requisition lines by destination. **Step 4:** web tab renders one row per silo with the columns of Engine §4 rows 47–64 (mill bin column left out until Part B) and the label "System Balance". Run API spec and `pnpm nx test web -- --maxWorkers=2`.

- [ ] **Step 5: Commit** — `feat(feed): silo dashboard with workbook derived fields (TDD Engine §4, Master Setup §1)`.

---

### Task 8: Data script, forecast grid port (drop migration deferred post-merge) — DONE, see note below

> **I3 correction (final whole-branch review, 4 Oct):** this task is complete (commits
> `b7bfaa11`..`c4f74f77`, ledger "Task 8: complete"). The column-drop migration below
> (Steps 1–3) was never run — the 3 Oct ruling deferred every column drop to merge
> time, and by the time that merge-time work happens, slot **0142 has been taken by
> `0142_reconcile_feed_stock_count`** (applied to `nf_devco`/`nf_system`; journal now
> runs through idx 145, 146 rows). Steps 1–3 below are **struck as written** — do not
> journal anything at idx 142. The deferred drop is re-sited as a **named POST-MERGE
> follow-up at migration 0146**; whoever picks it up re-derives the journal entry
> (`{ "idx": 146, "version": "5", "when": <next>, "tag": "0146_drop_feed_era_columns",
> "breakpoints": true }`) against the journal as it stands then, not against this
> stale text.

**Files:**
- Create: `apps/api/src/scripts/align-feed-tdd.ts`; Modify: `apps/api/package.json` (target `db-align-feed-tdd`, same shape as `db-align-stages-to-tdd` at line ~155 but with `--env-file-if-exists=.env`)
- POST-MERGE follow-up, not this task: `apps/api/src/drizzle/tenant/0146_drop_feed_era_columns.sql` (re-sited from 0142 — see note above); `_journal.json`, `feed-tdd-migrations.spec.ts`, `schema.ts` (delete the six `location_master` columns and `feed_forecast_run_line.required_on_date`)
- Modify (web): `feed-forecast-grid.tsx`, `feed-forecast-panel.tsx` using `docs/superpowers/plans/assets/2026-10-02-forecast-grid-date-columns.patch`; `feed-planning-panel.tsx`

**Interfaces:**
- Consumes: Task 2 columns; Task 3–5 field removals.

- [ ] **STRUCK — do not implement as written (I3).** The column-drop migration is a
  POST-MERGE follow-up at **0146**, not a step of this plan. Kept here only as the
  shape the follow-up should take; the journal numbers below are stale the moment
  another migration lands before the follow-up runs — re-check `_journal.json` at
  that time rather than trusting `idx: 146` literally.

  <details><summary>Shape for the 0146 follow-up (re-derive the journal entry when it is actually run)</summary>

  Failing migration test — extend `feed-tdd-migrations.spec.ts`:

  ```ts
  describe('Tenant migration 0146 — drop feed-era columns (3 Oct ruling 6; re-sited from 0142, I3)', () => {
    it('is journalled at idx 146', () => {
      expect(journal().find((e) => e.idx === 146)).toEqual({ idx: 146, version: '5', when: 1792000000015, tag: '0146_drop_feed_era_columns', breakpoints: true });
    });
    it('drops only the feed-era columns and keeps the pre-feed ones', () => {
      const sql = statements('0146_drop_feed_era_columns');
      expect(sql).toEqual([
        'ALTER TABLE `location_master` DROP COLUMN `feed_refill_buffer_days`;',
        'ALTER TABLE `location_master` DROP COLUMN `feed_lead_time_days`;',
        'ALTER TABLE `location_master` DROP COLUMN `feed_bulk_multiple_kg`;',
        'ALTER TABLE `location_master` DROP COLUMN `feed_bag_size_kg`;',
        'ALTER TABLE `location_master` DROP COLUMN `feed_truck_target_kg`;',
        'ALTER TABLE `location_master` DROP COLUMN `feed_production_weekday`;',
        'ALTER TABLE `feed_forecast_run_line` DROP COLUMN `required_on_date`;',
      ]);
      expect(sql.join('\n')).not.toMatch(/silo_reorder_days|feed_wastage_pct/);
    });
  });
  ```

  Run → FAIL, then write the SQL (breakpoints between statements), journal entry
  `{ "idx": 146, "version": "5", "when": 1792000000015, "tag": "0146_drop_feed_era_columns", "breakpoints": true }`,
  delete the columns from `schema.ts`. Confirm nothing references them:
  `grep -rn -E "feed_refill_buffer_days|feed_lead_time_days|feed_bulk_multiple_kg|feed_bag_size_kg|feed_truck_target_kg|feed_production_weekday|required_on_date" apps/api/src apps/web/src --include=*.ts --include=*.tsx | grep -v drizzle/tenant`
  → no output. Seed scripts that write them (`scripts/lib/seed-demo-detail.ts`, `seed-four-farm-feed-demo.ts`)
  are changed to write the farm-override `feed_planning_setting` row instead. Also fix,
  before this runs, the carry-forward noted in the final review: `align-feed-tdd.ts:74`
  skips inactive/soft-deleted farms, which becomes silent data loss the moment this
  drop runs (NOT in this fix wave — Rishi's call before the follow-up ships).

  </details>

- [x] **Step 4 (done): the data script** `align-feed-tdd.ts`, shaped like `backfill-feed-forecast-requisition.ts` (no flag = plan, `--verify` = transaction + rollback, `--apply` = commit, `--tenant=`). Actions, each printed as a plan line with counts:
  1. For every FARM whose `feed_bulk_multiple_kg`, `feed_bag_size_kg`, `feed_truck_target_kg` or `feed_production_weekday` differs from its company's active company-level `feed_planning_setting` value (or default 3000/50/30000/0 when none), insert or update that farm's active `feed_planning_setting` row with only the differing values; equal values are not copied.
  2. Set `safety_stock_kg = 0` on every active `feed_planning_setting` row (default already 0; prints 0 changes on a fresh 0141).
  3. Renumber `requisition_line.line_seq` of `doc_type = 'FEED'` requisitions to 10000-steps in existing order.
  4. Print open `AUTO_DRAFT` feed requisitions by farm: these are recalculated by re-running **Draft from forecast** in Task 9, not by SQL (the engine is the only calculation).

  Run on `nf_devco`: `pnpm nx run api:db-align-feed-tdd` (read plan) → `-- --verify` (read the verified counts) → `-- --apply`. Result (ledger): 0 farm overrides (all farms at defaults), 4 FEED requisitions renumbered to 10000-steps. The `-- --apply` run does **not** apply 0142/0146 — that drop stays deferred; the script only touches `feed_planning_setting` and `requisition_line`.

- [x] **Step 5 (done): port the grid and remove dead UI** — resolved the patch's date-pivot columns against the worktree's run-history and tab structure; removed the Refill Date, Required On, Overdue and Lead Time columns/inputs from the grid, panel and `feed-planning-panel.tsx`; renamed "Run Down Date" to "First Shortage Date"; days shown to one decimal; added Safety Stock KG and Bag Size KG inputs to the planning panel (company and farm override). Web test + lint confirmed no new errors (see Task 4's web-test baseline correction in the ledger — nx had fabricated 5 phantom failures; real run was 78/78 suites, 466/466 tests).

- [x] **Step 6 (done): commit** `b7bfaa11` `chore(data): db-align-feed-tdd; app stops reading the farm logistics columns on location_master` and the grid/panel port alongside it (see ledger "Task 8: complete", commits `b7bfaa11..c4f74f77`).

---

### Task 9: Feed requisition document — header form and lines sub-form (Req. §1, §2)

Rishi, 3 Oct: the requisition is a document with a **header** carrying the workbook's required
fields and a **sub-form of lines** below it. Today the header is one sentence of text and only
quantity and delivery date are editable.

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-requisition-document.tsx` (header form + lines sub-form; used by `requisitions-panel.tsx` and later by the Approvals detail)
- Modify: `apps/web/src/components/console/inventory/requisitions-panel.tsx` (render the document instead of the inline header/table), `requisition-labels.ts`, `apps/web/src/utils/translations.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` (`get` view adds header and line display fields), `dto/update-feed-requisition.dto.ts` (line `item_id`, `destination_location_id`, `exception_reason`), `feed-requisition.rules.ts` (`lineChangeProblems`)
- Test: `feed-requisition.rules.spec.ts`, `feed-requisition.service.spec.ts`, `apps/web/src/components/console/inventory/__tests__/feed-requisition-document.test.tsx`

**Interfaces:**
- Consumes: Task 5 line fields (`recommended_delivery_date`, `exceeds_silo_capacity`, `line_seq` 10000-steps), Task 2 settings (`truckTargetKg`, `bulkMultipleKg`).
- Produces: `GET /feed-requisition/:id` returns, besides today's fields, `header: { farm_code, farm_name, requisition_date, is_next_diet_requisition, farm_total_requested_kg, truck_target_kg, bulk_multiple_kg, trips, required_delivery_date, approved_by_name, linked_transfer_no, forecast_run_no }` and on each line `item_code`, `item_description`, `destination_code`, `lifecycle_ref_label` (e.g. `L-LINE WEANER days 25–27`), `exceeds_silo_capacity`, `recommended_delivery_date`.
- Produces: `lineChangeProblems(line: { requiredItemId: string | null; itemId: string; exceptionReason: string | null; destination: { locationType: 'SILO' | 'STORE'; heldItemId: string | null; heldBalanceKg: number } }): string[]`.

**Header form** (two-column `FieldGroup` of `ReadField`s; editable fields as `Field`), in workbook order:

| Field | Source | Editable |
|---|---|---|
| Requisition No. | `req_no` (REQ-FarmCode-YYYY-NNNNN, row 5) | no |
| Requisition Date | `requisition_date` (row 6) | no |
| Requisition Type | FEED_FORECAST / MANUAL (row 7) | no |
| Source | AUTO_FORECAST / MANUAL_ENTRY / STOCK_TAKE_TRIGGERED / DIET_CHANGE_UPCOMING (row 8) | no |
| Farm Code, Farm Name | farm (rows 9–10) | no |
| Is Next Diet Requisition | any line next diet (row 16) | no |
| Status, Priority | rows 33–34 | no |
| Submission Deadline | row 35 | no |
| Required Delivery Date | earliest line delivery date (row 29) | via lines |
| Supplier or Source | MILL (row 30) | no |
| Requisition Purpose | Internal Feed Transfer (row 31) | no |
| Farm Total Requested KG vs Bulk Truck Target KG, trips | rows 26–27 (target, never a block) | no |
| Bulk Order Multiple | row 28 | no |
| Remarks | row 36 — required over 20 % deviation, delivery-date change, or item exception | while open |
| Approved By, Approval Date Time | rows 37–38 | no |
| Linked Transfer Order No. | row 39 (empty until Part B) | no |
| Forecast Run | run no. (Engine Step 9 "Preserve run ID") | no |

**Lines sub-form** (one row per line, workbook §2 order): Line No. (row 42) · Silo Code / Destination Silo (rows 43, 55 — editable while open) · Feed Item No. to Order (row 45 — editable) · Feed Item Description · Feed Type (row 46) · Is Next Diet Line (row 47) · Days Before Diet Change (row 48) · Breed Lifecycle Row Reference (§1 row 17) · System Balance KG (row 49) · Daily Requirement KG (row 50) · Days Remaining / First Shortage Date (row 51) · Recommended Qty KG with unrounded need beneath (row 52) · Requested Qty KG (row 53 — editable) · Bag Count (row 54, bagged only) · Proposed Delivery Date (row 56 — editable) · capacity warning icon when `exceeds_silo_capacity`. "Current Silo Feed Item No." is not shown (rows 12, 44: REMOVED).

- [ ] **Step 1: Failing rules test**

```ts
describe('lineChangeProblems — Req. row 13 and cp. 4', () => {
  const silo = (heldItemId: string | null, heldBalanceKg: number) => ({ locationType: 'SILO' as const, heldItemId, heldBalanceKg });
  it('accepts the lifecycle item into a silo holding it', () => {
    expect(lineChangeProblems({ requiredItemId: 'r1', itemId: 'r1', exceptionReason: null, destination: silo('r1', 1500) })).toEqual([]);
  });
  it('needs an exception reason for an item the lifecycle does not require', () => {
    expect(lineChangeProblems({ requiredItemId: 'r1', itemId: 'r2', exceptionReason: null, destination: silo('r2', 0) }))
      .toEqual(['Feed item differs from the lifecycle requirement: record an exception reason (Requisition row 13).']);
    expect(lineChangeProblems({ requiredItemId: 'r1', itemId: 'r2', exceptionReason: 'Vet instruction', destination: silo('r2', 0) })).toEqual([]);
  });
  it('refuses a silo that still holds another item', () => {
    expect(lineChangeProblems({ requiredItemId: 'r2', itemId: 'r2', exceptionReason: null, destination: silo('r1', 1500) }))
      .toEqual(['Silo holds another feed with stock: choose a silo holding this item or an empty one (checkpoint 4).']);
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && npx jest src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts --maxWorkers=2` → FAIL.
- [ ] **Step 3: Implement** `lineChangeProblems` with exactly those two messages; call it in the update path for any line whose `item_id` or `destination_location_id` changed (the destination's held item and balance come from the same ledger read `recommendLines` uses); store `exception_reason` in the line's existing `description` column prefixed `Exception: ` (no new column). Extend the `get` view with the header and line fields above (farm from `location_master`, approver name from `user_master`, run no. from `feed_forecast_run`, lifecycle label from `breed_lifecycle_stages` joined to breed and stage codes).
- [ ] **Step 4: Failing then passing web test** — render `FeedRequisitionDocument` with the Worked Example view (REQ-GRS-2026-00041, lines 10000 R1 6,000 to SILO1 and 20000 R2 9,000 to SILO2) and assert: header shows "REQ-GRS-2026-00041", "Internal Feed Transfer", "15,000 KG of 30,000 KG target", "Is Next Diet Requisition: Yes"; lines show "10000" and "20000" in order, "L-LINE WEANER days 25–27", no "Current Silo Feed Item" text; with `status: 'APPROVED'` no input is editable. Implement the component with `FieldGroup`, `ReadField`, `Field` (apple.design.md §19) and `ScrollTable`; replace the inline header and table in `requisitions-panel.tsx` with it. Run `pnpm nx test web -- --maxWorkers=2` and `pnpm nx lint web` (no new errors).
- [ ] **Step 5: Commit** — `feat(feed): requisition as a document — workbook header form and lines sub-form (Req. §1, §2)`.

---

### Task 10: Verify Part A in the running app and MySQL

**Files:**
- Create: `docs/VERIFICATION-<date>-feed-tdd-part-a.md`
- Modify: `AGENTS.md` §8 (what exists now: safety stock, no lead time/refill, settings own logistics), `docs/HANDOFF-2026-09-29.md` successor note

- [ ] **Step 1: Full gates** — `pnpm nx test api -- --maxWorkers=2`, `pnpm nx test web -- --maxWorkers=2`, `pnpm nx run-many -t typecheck -p api web web-e2e`, `pnpm nx lint web`. Record exact counts. Any failure is fixed in the task that owns it, not here.
- [ ] **Step 2: Rebuild and restart the API** — `pnpm nx run api:build`, `lsof -ti :2877` → `kill <pid>`, start with the project's serve target; confirm `curl -s localhost:2877/api/health` (or the project's health route) answers.
- [ ] **Step 3: Drive it** — in the browser pane at `http://localhost:3002`, open Inventory → Feed Forecast for a four-farm demo farm: set safety stock 0 and Below Feed Level on its silos, run the forecast, save the run, **Draft from forecast**. Then read MySQL:
  ```sql
  select r.req_no, l.line_seq, l.item_id, l.unrounded_need_kg, l.recommended_qty_kg, l.first_shortage_date, l.recommended_delivery_date, l.exceeds_silo_capacity
  from requisition r join requisition_line l using (requisition_id) where r.doc_type='FEED' order by r.created_at desc, l.line_seq limit 10;
  ```
  Check each line by hand against the forecast grid: unrounded = demand + safety − opening − incoming; recommended = CEILING to 3000; delivery = first shortage date. Then set safety stock to 500 for that farm, re-draft, and confirm each unrounded need rose by exactly 500 and edited lines kept their quantity.
- [ ] **Step 4: Edit a delivery date without remarks** (expect refusal message from Task 5) and with remarks (accepted; row shows the new date). Open the requisition document and check every header field and line column of Task 9 against MySQL; change a line's item to one the lifecycle does not require (refused without an exception reason) and to a silo holding another item with stock (refused).
- [ ] **Step 5: Write the report** with the SQL output, screenshots of the grid and dashboard, the gate counts, and anything that did not match. Commit with AGENTS.md and the handoff note.
