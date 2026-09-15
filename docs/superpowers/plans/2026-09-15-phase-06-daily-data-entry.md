# Phase 6 — Daily Data Entry MVP Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Roadmap: `2026-09-14-mvp-delivery-plan.md` — Global constraints and Machine rules apply.

**Goal:** the daily workspace the spec describes — Stage overview, a selected-Stage workspace
of Activity parent cards with one sub-card per due Scheduler line, Drafts that persist with no
side effects, individual and atomic bulk Post, Registered/Count Only targeting enforced by the
API, a History rail with Complete / In progress / Missing, and append-only correction for the
lines that can be reversed today.

**Architecture:** `batch_daily_data` gains a status machine (`DRAFT → POSTED → SUPERSEDED`), a
version, a target scope and a supersession link; uniqueness moves to "one active row per line
per date" through a generated column. A child table snapshots targeted animals. Two pure
modules decide targeting and History/Activity states so both API and tests share one rule.
The service splits saving (draft, no side effects) from posting (the existing side-effect
switch, now run for a set of drafts inside one transaction). The web screen is split into
focused components around a URL-state container.

**Tech stack:** NestJS 11, Drizzle ORM (MySQL 8 generated columns), Jest; Next.js 16 / React 19.

**Specs:** `docs/superpowers/specs/2026-09-14-daily-data-entry-and-transfers-design.md` §2–§9,
§15, §16 (criteria 1–8, 21–25). Decisions: no backlog gate; Registered animals only from
explicit data.

## Rulings this plan makes

1. **One table, a status machine.** Drafts live in `batch_daily_data` with `status = 'DRAFT'`,
   not a second table, so a line/date has exactly one active row whatever its state and every
   existing read keeps working with a `status <> 'SUPERSEDED'` filter.
2. **Existing rows are POSTED.** Every row written before this phase was committed through the
   old save-is-post path; the migration defaults them to `POSTED`.
3. **Correction in this phase covers CONSUMPTION and non-mutating DESCRIPTIVE lines.** Those
   can be reversed today (consumption through `reverseConsumption`; a descriptive value has no
   side effect). OUTPUT, OVERHEAD, RESOURCE, TRANSFER and DESCRIPTIVE lines whose
   `kpi_metric` is `HEAD_COUNT` or `MORTALITY_COUNT` keep refusing with 409 until Phase 13.
   Past-date correction requests with one-time unlock are Phase 13.
4. **The web opens on today.** The backlog banner that steered workers to the oldest owed day
   is removed; owed days appear as Missing in History and are entered from there.
5. **Stage-wide targeting snapshots at post.** A Registered `STAGE_ANIMALS` draft stores no
   animal list; posting records the stage's active animals at that moment. A
   `SELECTED_ANIMALS` draft stores its selection, re-validated at post.

## Global constraints (this phase)

- Status codes `DRAFT` / `POSTED` / `SUPERSEDED`; target scopes `BATCH` / `STAGE_ANIMALS` / `SELECTED_ANIMALS`; History states `COMPLETE` / `IN_PROGRESS` / `MISSING` / `NOT_STARTED` / `NOT_DUE`; Activity states `NOT_STARTED` / `IN_PROGRESS` / `COMPLETE`.
- Messages (exact): `A Count Only batch has no individual animals.` · `Choose the whole stage or the animals in it.` · `Select at least one animal.` · `Animal <code or id> is not an active animal in this stage.` · `This entry was changed by someone else. Reload to see the latest.` · `This line is already posted. Use Correct to change it.` · `Correction of <line type> entries is not available yet.` · `Nothing to post.`
- Every new endpoint is under the existing `@FarmScoped()` controller and loads its batch with `batchScopeConditions(farmScope(this.cls))`; out-of-scope → the existing not-found.
- Drafts create no `batch_transaction`, `inventory_ledger`, `journal_*`, `animal_register`, `batch_transfer` or `notification_alert_log` rows.
- A bulk post is all-or-nothing inside `withTenantTransaction`.
- No Activity time field; audit timestamps are never labelled as work time.
- New web strings: English dictionary only. Agents edit only; the lead runs everything.

## API contract (fixed — API and web lanes both build to this)

```ts
type EntryStatus = 'DRAFT' | 'POSTED';
type TargetScope = 'BATCH' | 'STAGE_ANIMALS' | 'SELECTED_ANIMALS';

interface EntryView {
  entry_id: string;
  status: EntryStatus;
  version: number;
  entered_value: number | null;
  entered_text: string | null;
  lot_no: string | null;
  remarks: string | null;
  target_scope: TargetScope;
  animal_ids: string[];            // SELECTED_ANIMALS: the selection; POSTED STAGE_ANIMALS: the snapshot
  supersedes_entry_id: string | null;
}

// GET /batch/:batchId/daily-data/form?date=&stageId=  (existing route; fields added, none removed)
interface EntryFormResponse {
  // ...every existing field (batch, date, today, hasScheduler, mayEditAnyDay, backlog, selected_stage_id, stages, lines, complete)
  lines: Array<ExistingFormLine & { entry: EntryView | null; correctable: boolean }>;
  activities: Array<{
    line_type: 'CONSUMPTION' | 'OUTPUT' | 'DESCRIPTIVE' | 'OVERHEAD' | 'RESOURCE' | 'TRANSFER';
    state: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';
    required: number; posted: number; drafts: number;
    line_ids: string[];            // in line_seq order
  }>;
  targeting: {
    mode: 'COUNT_ONLY' | 'REGISTERED';
    default_scope: 'BATCH' | 'STAGE_ANIMALS';
    stage_animals: Array<{ animal_id: string; animal_code: string; ear_tag: string | null }>; // [] for COUNT_ONLY
  };
}

// PUT /batch/:batchId/daily-data/draft          permission PRODUCTION/BATCH_ENTRY create
interface SaveDraftBody {
  line_id: string; entry_date: string;
  entered_value?: number; entered_text?: string; lot_no?: string; rate?: number;
  destination_batch_id?: string; remarks?: string;
  target_scope?: TargetScope; animal_ids?: string[];
  version?: number;                // required when a draft already exists
}
// → { data: EntryView }

// POST /batch/:batchId/daily-data/post           permission PRODUCTION/BATCH_ENTRY create
interface PostEntriesBody { entry_date: string; line_ids: string[] }  // 1..n drafts, all-or-nothing
// → { data: EntryView[] }

// POST /batch/:batchId/daily-data/correct        permission PRODUCTION/BATCH_ENTRY create (+ entry window)
interface CorrectEntryBody extends Omit<SaveDraftBody, 'version'> { version: number }
// → { data: EntryView }   (the new POSTED row; the old one becomes SUPERSEDED)

// GET /batch/:batchId/daily-data/history?to=YYYY-MM-DD&days=30   permission view
// → { data: Array<{ date: string; state: 'COMPLETE'|'IN_PROGRESS'|'MISSING'|'NOT_STARTED'|'NOT_DUE';
//                   required: number; posted: number; drafts: number }> }   newest first

// POST /batch/:batchId/daily-data   (existing) — kept: save draft + post in one transaction.
```

---

### Task 1: Schema, migration and the two rule modules

**Files:**
- Create `apps/api/src/drizzle/tenant/0095_daily_entry_drafts.sql`; journal idx 95
- Modify `apps/api/src/core/database/schema.ts` (`batchDailyData` ~2669-2692; add `batchDailyDataTarget`)
- Create `apps/api/src/modules/production/batch-daily-data/entry-targeting.ts` (+ spec)
- Create `apps/api/src/modules/production/batch-daily-data/entry-history-state.ts` (+ spec)

- [ ] **Step 1: Failing tests — `entry-targeting.spec.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import { resolveTarget } from './entry-targeting';

const stage = ['a1', 'a2', 'a3'];

describe('resolveTarget', () => {
  it('gives a Count Only batch the whole batch', () => {
    expect(resolveTarget({ mode: 'COUNT_ONLY', stageAnimalIds: [] })).toEqual({ scope: 'BATCH', animalIds: [] });
  });

  it('refuses individual animals on a Count Only batch', () => {
    expect(() => resolveTarget({ mode: 'COUNT_ONLY', requestedScope: 'SELECTED_ANIMALS', animalIds: ['a1'], stageAnimalIds: [] }))
      .toThrow(new BadRequestException('A Count Only batch has no individual animals.'));
  });

  it('defaults a Registered batch to the whole stage', () => {
    expect(resolveTarget({ mode: 'REGISTERED', stageAnimalIds: stage })).toEqual({ scope: 'STAGE_ANIMALS', animalIds: [] });
  });

  it('refuses BATCH scope on a Registered batch', () => {
    expect(() => resolveTarget({ mode: 'REGISTERED', requestedScope: 'BATCH', stageAnimalIds: stage }))
      .toThrow('Choose the whole stage or the animals in it.');
  });

  it('keeps a valid selection', () => {
    expect(resolveTarget({ mode: 'REGISTERED', requestedScope: 'SELECTED_ANIMALS', animalIds: ['a2', 'a1', 'a2'], stageAnimalIds: stage }))
      .toEqual({ scope: 'SELECTED_ANIMALS', animalIds: ['a1', 'a2'] });
  });

  it('refuses an empty selection', () => {
    expect(() => resolveTarget({ mode: 'REGISTERED', requestedScope: 'SELECTED_ANIMALS', animalIds: [], stageAnimalIds: stage }))
      .toThrow('Select at least one animal.');
  });

  it('refuses an animal outside the stage', () => {
    expect(() => resolveTarget({ mode: 'REGISTERED', requestedScope: 'SELECTED_ANIMALS', animalIds: ['zz'], stageAnimalIds: stage }))
      .toThrow('Animal zz is not an active animal in this stage.');
  });

  it('refuses an animal list with stage scope', () => {
    expect(() => resolveTarget({ mode: 'REGISTERED', requestedScope: 'STAGE_ANIMALS', animalIds: ['a1'], stageAnimalIds: stage }))
      .toThrow('Choose the whole stage or the animals in it.');
  });
});
```

- [ ] **Step 2: Failing tests — `entry-history-state.spec.ts`**

```ts
import { activityStates, dayState } from './entry-history-state';

describe('dayState', () => {
  const today = '2026-09-15';
  it('is NOT_DUE with no required lines', () => {
    expect(dayState({ date: today, today, required: 0, posted: 0, drafts: 0 })).toBe('NOT_DUE');
  });
  it('is COMPLETE when every required line is posted', () => {
    expect(dayState({ date: '2026-09-14', today, required: 3, posted: 3, drafts: 0 })).toBe('COMPLETE');
  });
  it('is MISSING for a past day with a required line unposted, even with drafts', () => {
    expect(dayState({ date: '2026-09-14', today, required: 3, posted: 2, drafts: 1 })).toBe('MISSING');
  });
  it('is IN_PROGRESS today once anything is saved', () => {
    expect(dayState({ date: today, today, required: 3, posted: 1, drafts: 0 })).toBe('IN_PROGRESS');
  });
  it('is NOT_STARTED today with nothing saved', () => {
    expect(dayState({ date: today, today, required: 3, posted: 0, drafts: 0 })).toBe('NOT_STARTED');
  });
});

describe('activityStates', () => {
  it('groups by line type and keeps a parent in progress until every required sub-card posts', () => {
    const lines = [
      { line_id: 'f1', line_type: 'CONSUMPTION', line_seq: 1, is_mandatory: true, status: 'POSTED' as const },
      { line_id: 'f2', line_type: 'CONSUMPTION', line_seq: 2, is_mandatory: true, status: null },
      { line_id: 'm1', line_type: 'DESCRIPTIVE', line_seq: 3, is_mandatory: false, status: 'DRAFT' as const },
    ];
    expect(activityStates(lines)).toEqual([
      { line_type: 'CONSUMPTION', state: 'IN_PROGRESS', required: 2, posted: 1, drafts: 0, line_ids: ['f1', 'f2'] },
      { line_type: 'DESCRIPTIVE', state: 'COMPLETE', required: 0, posted: 0, drafts: 1, line_ids: ['m1'] },
    ]);
  });
});
```
Note the DESCRIPTIVE parent: optional lines never hold a parent open (spec §6), so zero required reads COMPLETE.

- [ ] **Step 3: Implement `entry-targeting.ts`**

```ts
import { BadRequestException } from '@nestjs/common';

export type TargetScope = 'BATCH' | 'STAGE_ANIMALS' | 'SELECTED_ANIMALS';

/**
 * Who a daily entry is about (spec §4). A Count Only batch has no animal rows, so it is
 * always the whole batch; a Registered batch is the stage's animals by default or a
 * selection of them, never "the batch", because its animals can stand in several stages.
 */
export function resolveTarget(input: {
  mode: 'COUNT_ONLY' | 'REGISTERED';
  requestedScope?: TargetScope;
  animalIds?: string[];
  stageAnimalIds: string[];
}): { scope: TargetScope; animalIds: string[] } {
  const requested = input.animalIds ?? [];
  if (input.mode === 'COUNT_ONLY') {
    if ((input.requestedScope && input.requestedScope !== 'BATCH') || requested.length) {
      throw new BadRequestException('A Count Only batch has no individual animals.');
    }
    return { scope: 'BATCH', animalIds: [] };
  }
  const scope = input.requestedScope ?? 'STAGE_ANIMALS';
  if (scope === 'BATCH' || (scope === 'STAGE_ANIMALS' && requested.length)) {
    throw new BadRequestException('Choose the whole stage or the animals in it.');
  }
  if (scope === 'STAGE_ANIMALS') return { scope, animalIds: [] };
  const unique = [...new Set(requested)].sort();
  if (!unique.length) throw new BadRequestException('Select at least one animal.');
  const inStage = new Set(input.stageAnimalIds);
  const stranger = unique.find((id) => !inStage.has(id));
  if (stranger) throw new BadRequestException(`Animal ${stranger} is not an active animal in this stage.`);
  return { scope, animalIds: unique };
}
```
(The service replaces the id in the message with the animal code when it has it.)

- [ ] **Step 4: Implement `entry-history-state.ts`**

```ts
export type DayState = 'COMPLETE' | 'IN_PROGRESS' | 'MISSING' | 'NOT_STARTED' | 'NOT_DUE';
export type ActivityState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

/** A past day with a required line unposted is Missing (spec §8); drafts do not complete a day. */
export function dayState(d: { date: string; today: string; required: number; posted: number; drafts: number }): DayState {
  if (d.required === 0) return 'NOT_DUE';
  if (d.posted >= d.required) return 'COMPLETE';
  if (d.date < d.today) return 'MISSING';
  return d.posted + d.drafts > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
}

export interface ActivityLine { line_id: string; line_type: string; line_seq: number; is_mandatory: boolean; status: 'DRAFT' | 'POSTED' | null }

/** Parent cards derive their state from their sub-cards; optional sub-cards never hold a parent open (spec §6). */
export function activityStates(lines: ActivityLine[]) {
  const order: string[] = [];
  const groups = new Map<string, ActivityLine[]>();
  for (const line of [...lines].sort((a, b) => a.line_seq - b.line_seq)) {
    if (!groups.has(line.line_type)) { groups.set(line.line_type, []); order.push(line.line_type); }
    groups.get(line.line_type)!.push(line);
  }
  return order.map((line_type) => {
    const group = groups.get(line_type)!;
    const required = group.filter((l) => l.is_mandatory).length;
    const posted = group.filter((l) => l.is_mandatory && l.status === 'POSTED').length;
    const drafts = group.filter((l) => l.status === 'DRAFT').length;
    const anySaved = group.some((l) => l.status !== null);
    const state: ActivityState = posted >= required && (required > 0 || anySaved) ? 'COMPLETE' : anySaved ? 'IN_PROGRESS' : 'NOT_STARTED';
    return { line_type, state, required, posted, drafts, line_ids: group.map((l) => l.line_id) };
  });
}
```

- [ ] **Step 5: Migration `0095_daily_entry_drafts.sql`**

```sql
ALTER TABLE `batch_daily_data` ADD `status` varchar(12) NOT NULL DEFAULT 'POSTED';--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `version` int NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `target_scope` varchar(20);--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `supersedes_entry_id` varchar(36);--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `superseded_at` timestamp NULL;--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `active_slot` tinyint GENERATED ALWAYS AS (IF(`status` = 'SUPERSEDED', NULL, 1)) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_batch_daily_data_line_date_active` ON `batch_daily_data` (`line_id`,`entry_date`,`active_slot`);--> statement-breakpoint
ALTER TABLE `batch_daily_data` DROP INDEX `uq_batch_daily_data_line_date`;--> statement-breakpoint
CREATE TABLE `batch_daily_data_target` (
  `target_id` varchar(36) NOT NULL,
  `entry_id` varchar(36) NOT NULL,
  `animal_id` varchar(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `batch_daily_data_target_pk` PRIMARY KEY(`target_id`),
  CONSTRAINT `uq_batch_daily_data_target_entry_animal` UNIQUE(`entry_id`,`animal_id`),
  CONSTRAINT `bddt_entry_fk` FOREIGN KEY (`entry_id`) REFERENCES `batch_daily_data`(`entry_id`) ON DELETE cascade,
  CONSTRAINT `bddt_animal_fk` FOREIGN KEY (`animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict
);
```
The new unique index is created before the old one is dropped because `line_id`'s foreign key needs an index that starts with it. NULL `active_slot` values do not collide, so superseded rows can repeat.
Journal: `{ "idx": 95, "version": "5", "when": 1789234408180, "tag": "0095_daily_entry_drafts", "breakpoints": true }` — the implementer must first read the real last `when` (after 0094) and use a larger value.

- [ ] **Step 6: Schema** — add the five columns to `batchDailyData` (`active_slot: tinyint('active_slot').generatedAlwaysAs(sql\`IF(\${sql.raw('`status`')} = 'SUPERSEDED', NULL, 1)\`, { mode: 'stored' })` — verify Drizzle's MySQL generated-column API in `node_modules/drizzle-orm/mysql-core` and follow it), replace the index callback with `uqLineDateActive: uniqueIndex('uq_batch_daily_data_line_date_active').on(table.line_id, table.entry_date, table.active_slot)`, and add `batchDailyDataTarget` matching the SQL.
- [ ] **Step 7: Run (lead)** — both specs; `pnpm nx run api:db-migrate-all-tenants`; `SHOW CREATE TABLE batch_daily_data` shows the generated column and index; existing rows read `POSTED`.
- [ ] **Step 8: Commit (lead).**

---

### Task 2: Drafts, posting and correction (API service)

**Files:** `batch-daily-data.service.ts`, `batch-daily-data.controller.ts`, `dto/batch-daily-data.dto.ts`, `batch-daily-data.service.spec.ts`.

**Interfaces:** Consumes Task 1 modules and schema. Produces `saveDraft(batchId, body, tenantId, user): Promise<EntryView>`, `postDrafts(batchId, body, tenantId, user): Promise<EntryView[]>`, `correctEntry(batchId, body, tenantId, user): Promise<EntryView>`; `postEntry` becomes `saveDraft` + `postDrafts` of one line in one transaction.

- [ ] **Step 1: Failing tests** (table-keyed `rows` mock; extend it for `batchDailyDataTarget` and an insert capture):
  - `saveDraft` writes a DRAFT row and **no** `batch_transaction`/ledger insert and no `batchService.addTransaction` call.
  - A second `saveDraft` with a stale `version` → 409 `This entry was changed by someone else. Reload to see the latest.`; with the current version → version + 1.
  - `saveDraft` on a line/date whose active row is POSTED → 409 `This line is already posted. Use Correct to change it.`
  - Count Only + `animal_ids` → 400 `A Count Only batch has no individual animals.`; Registered + outside-stage animal → 400.
  - `postDrafts` of two drafts calls the side-effect switch for both inside one transaction; when the second throws, the first's side effects are rolled back (assert the transaction work rejects and no row reads POSTED).
  - `postDrafts` with a line id that has no DRAFT → 400 `Nothing to post.` for that request, nothing posted.
  - Posting a Registered `STAGE_ANIMALS` draft inserts one target row per active stage animal.
  - `correctEntry` on a POSTED CONSUMPTION entry: old row → SUPERSEDED with `superseded_at`, `reverseConsumption` called, new POSTED row with `supersedes_entry_id` = old id; on OUTPUT → 409 `Correction of OUTPUT entries is not available yet.`; a standard user correcting yesterday → the existing PAST_EDIT refusal.
  - Existing `postEntry` tests keep passing through the wrapper.
- [ ] **Step 2: Implement**
  - Every existing read of `batch_daily_data` (entry form, day status, pending days, entry dates, find for date, idempotency check) adds `ne(schema.batchDailyData.status, 'SUPERSEDED')`; completeness counts only `POSTED`.
  - `saveDraft`: load batch with scope (existing loader); load line (active, same batch's scheduler); `assertMayRecord` (future refused; today-or-owed allowed); load active row for (line, date): POSTED → 409; DRAFT → require `body.version === row.version`; compute stage animal ids when Registered (active `animal_register` where `current_batch_id` = batch and `current_stage_id` = line.stage_id); `resolveTarget`; upsert DRAFT with `version` incremented, `target_scope`, values; replace its target rows only for SELECTED_ANIMALS. No other writes.
  - `postDrafts`: inside `withTenantTransaction`: lock the batch row `FOR UPDATE`; load all requested active DRAFT rows (all must exist, else 400 `Nothing to post.`); for each, re-run targeting (stage animals as of now) and the existing per-line-type side-effect switch extracted from `postEntry` into `private applyPosting(batch, line, draft, user)`; set `status = 'POSTED'`, `posted`, `posting_reference`; write target snapshot rows for STAGE_ANIMALS. Any throw aborts all.
  - `correctEntry`: `mayEditAnyDay` or today (existing verdict); active row must be POSTED and `version` must match; line type check per Ruling 3; in one transaction: mark old SUPERSEDED (`superseded_at = now`), reverse (`reverseConsumption` for CONSUMPTION; nothing for plain DESCRIPTIVE), insert new DRAFT from body then `applyPosting` → POSTED with `supersedes_entry_id`.
  - `postEntry` (existing POST route): `saveDraft` then `postDrafts([line])` in one transaction; keep its idempotent same-value shortcut.
  - Controller: `PUT draft`, `POST post`, `POST correct` with `@RequirePermission('PRODUCTION','BATCH_ENTRY','create')`; DTOs with class-validator (`@IsIn` for scope, `@IsArray @IsUUID('4',{each:true})` for ids, `@ArrayMinSize(1)` for line_ids, `@IsInt @Min(1)` version).
- [ ] **Step 3: Run (lead)** `--testPathPatterns=batch-daily-data`; **Step 4: Commit (lead).**

### Task 3: Form enrichment and History endpoint (API)

**Files:** `batch-daily-data.service.ts`, controller, spec (after Task 2 lands).

- [ ] **Failing tests:** form lines carry `entry` as `EntryView` (status, version, target) and `correctable` (Ruling 3 and entry window); `activities` equals `activityStates(...)` for the chosen stage; `targeting` gives `COUNT_ONLY`/`BATCH`/`[]` or `REGISTERED`/`STAGE_ANIMALS`/active stage animals with codes; `GET history` returns newest-first days with `dayState` per date computed from due required lines (use `isLineDue` across the batch's schedulers) and active POSTED/DRAFT rows, bounded to `days` ≤ 60 and never before batch start.
- [ ] **Implement** per the contract; `history` shares the due-line loading `pendingDays` already does.
- [ ] **Run (lead), commit (lead).**

### Task 4: Web — container, URL state, Stage overview, History rail

**Files:** Create `apps/web/src/components/console/production/entry/entry-workspace.tsx` (container), `entry/stage-overview.tsx`, `entry/history-rail.tsx`, `entry/types.ts` (the contract types above, copied verbatim); modify `apps/web/src/app/(app)/batches/entry/page.tsx` to render `EntryWorkspace` instead of `SchedulerBatchDataEntry` for non-dairy; keep `scheduler-batch-data-entry.tsx` untouched until Task 5 lands, then delete it in Task 6. `apps/web/src/utils/translations.ts` (`en` only).

**Interfaces produced for Task 5:**

```ts
// entry/activity-section.tsx is Task 5's; the container renders it like this:
<ActivitySection
  form={form}                                   // EntryFormResponse
  batchId={batchId}
  onChanged={() => reload()}                    // re-fetch form + history after any save/post/correct
/>
```

- [ ] URL state: `/batches/entry?batch=<id>&date=YYYY-MM-DD&stage=<id>`. No `stage` → Stage overview; choosing a stage `router.push`es `stage`, so browser Back returns to the overview with batch and date intact. Missing `date` → the form's `today` (Ruling 4 — never the backlog).
- [ ] Stage overview: a grid of cards from `form.stages` (name, animal count, completion from the stage's due/entered counts; unscheduled stages labelled "No schedule"); Farm badge ("Recording for") kept from the current screen.
- [ ] History rail: `GET history`; each date shows its state with count text — `Complete · 8 of 8 posted`, `In progress · 6 posted · 2 draft`, `Missing · 3 required`, `Not started`, and hides `NOT_DUE`; selecting a date updates `date`. Desktop side rail; below `lg` a horizontally scrolling strip, as today.
- [ ] Remove the backlog banner and the jump-to-oldest-day effect.
- [ ] Web spec (apps/web/specs, plain Jest matchers — this project has no jest-dom): the History rail renders the four state texts from a fixture; URL without `stage` renders the overview.

### Task 5: Web — Activity cards, sub-cards, targeting, bulk post, correction

**Files:** Create `entry/activity-section.tsx`, `entry/activity-card.tsx`, `entry/sub-card.tsx`, `entry/target-selector.tsx`; `translations.ts` (`en` only, coordinate keys with Task 4 by prefix `deW`).

- [ ] `ActivitySection` renders one `ActivityCard` per `form.activities` entry (title = line type label, state chip, `required/posted/drafts`), each containing a `SubCard` per `line_ids` entry.
- [ ] `SubCard`: value input (48px, as today), lot and remarks where applicable, state chip `Not entered / Draft / Posted`; buttons **Save draft** (`PUT draft` with the row's `version`), **Post** (`POST post` with this line), and for a POSTED `correctable` line **Correct** (opens the same inputs and sends `POST correct` with `version`). Locked lines show `locked_reason`. A 409 version conflict shows the contract message and reloads.
- [ ] `ActivityCard` action **Post completed sub-cards**: collects line ids whose entry is DRAFT and whose inputs are valid, sends one `POST post`; disabled when none; on failure shows the returned message and leaves every card as it was.
- [ ] `TargetSelector` (inside a sub-card, Registered only): radio **Whole stage (N animals)** / **Select animals** with a checkbox list from `form.targeting.stage_animals`; Count Only shows a static `Whole batch` label and sends no `animal_ids`.
- [ ] Web spec: bulk post sends only valid DRAFT line ids; Count Only sub-card never sends `animal_ids`; Correct appears only for `correctable` POSTED lines.

### Task 6: Phase gate (lead)

- [ ] Delete `scheduler-batch-data-entry.tsx` if nothing imports it; full API and web suites; both typechecks; web lint delta; migrate; build; restart API by PID; start web.
- [ ] Live probes (MySQL after each; label remarks `DEMO VERIFICATION`): save a draft → only a DRAFT row, zero new `batch_transaction`/`inventory_ledger`; reload the form → draft restored; post two drafts where the second is invalid → nothing posted; post both valid → both POSTED with ledger rows; Count Only with `animal_ids` → 400, no row; Registered selected animals → target rows equal the selection; stage-wide post → target rows equal active stage animals; correct a CONSUMPTION → old SUPERSEDED, reversal row, new POSTED linked; correct an OUTPUT → 409; stale version → 409; History shows a skipped past day as MISSING and today as IN_PROGRESS after one post.
- [ ] Browser pass at 1440, 834, 390 px: overview → stage → draft → post → Back to overview keeps batch/date → reload restores draft; history states; bulk post; correction.
- [ ] `docs/VERIFICATION-<date>-phase-06.md`; rulings 1–5 into `docs/decisions.md`.
