# Feed Requisition Sending Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A feed requisition can be sent for approval only on the farm's Sunday, with that day's posted stock count.

**Architecture:** A pure rule in `feed-requisition.rules.ts`; one service method that loads the facts and calls it; `submit()` refuses on its problems; a read-only endpoint exposes the same result so the open requisition can explain the block. No other path changes.

**Tech Stack:** NestJS, Drizzle/MySQL, Next.js, Jest, Nx.

**Spec:** `docs/superpowers/specs/2026-11-25-feed-requisition-stock-count-sunday-gate-design.md`

## Global Constraints

- Read `AGENTS.md` and `CLAUDE.md` first. Piggery only.
- Work in `/Users/nero/Desktop/navfarm` on the current branch. No worktree.
- **Do not commit or push** unless Rishi asks. Arun also pushes to `main`; do not pull, reset or stash without asking. This replaces the usual per-task commit step.
- Run tasks as `env -u NX_WORKSPACE_ROOT_PATH pnpm nx ...`. At most 2 Jest workers (8 GB machine).
- Gate only `submit`. Do not touch `createManual`, `createFromRun`, `autoDraft`, `update`, `changeLineTarget`. No scheduler, override, migration or setting.
- Sunday is fixed. Do not read `physical_count_weekday`.
- Farm day = `this.forecast.farmToday(companyId, tenantId).today`; convert count instants with `todayInZone(timeZone, epoch * 1000)` from `feed-forecast.engine.ts`.
- Read `counted_at` as `UNIX_TIMESTAMP(counted_at)` (it is written with `FROM_UNIXTIME`; reading the string as UTC moves the day — see `feed-stock-count.service.ts:1502`).
- Only `status = 'POSTED'` counts.
- New UI strings go in the `en` dictionary only.
- Before changing anything, record the current failing tests (names, not only totals) and the web lint error count, so "no new failures" is checkable. On 25 Nov: 15 web suites / 25 tests failed before commit `2709d5e0`; web lint showed 101 errors. Measure again.

## Review Focus

1. Count instant near midnight: Saturday 23:30 UTC is Sunday in `Africa/Harare` — it counts for that Sunday.
2. Refused submit that carries line edits: nothing is written.
3. Submit that changes a line's silo or item: the new pair is checked, not the saved one.
4. Count counted last Sunday but posted today: refused.
5. Company with no usable timezone: server's day, no crash.

---

### Task 1: The pure rule

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts`
- Test: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts`

**Interfaces (Produces):**

```ts
export interface SendGateLine {
  lineSeq: number;
  itemName: string;
  itemId: string | null;
  destinationId: string | null;
  destinationCode: string;
  isStore: boolean;
}
export function isSundayDay(day: string): boolean; // day = 'YYYY-MM-DD'
export function sendGateProblems(args: {
  today: string;
  lines: SendGateLine[];
  countedPairs: ReadonlySet<string>;   // lineKey(silo, item) in a POSTED count dated today
  countedSilos: ReadonlySet<string>;   // silo ids in those counts
  countablePairs: ReadonlySet<string>; // lineKey(silo, item) with ledger history
  countableSilos: ReadonlySet<string>; // silo ids with any ledger history
}): string[];
```

Use the existing `lineKey`.

Exact messages:
- Not Sunday (return only this one): `Feed requisitions can be sent only on Sunday. It is <Weekday> on this farm.`
- Pair not counted, or diet change into an uncounted silo: `Line <lineSeq>: <itemName> in <destinationCode> has no posted stock count dated today.`
- No destination or item on a line: `Line <lineSeq> has no destination or feed item.`

- [x] **Step 1: Write the failing tests** — `describe('sendGateProblems')`, with Sunday `2026-11-29`:
  - `2026-11-28` and `2026-11-30` each give exactly the Sunday message (`Saturday`, `Monday`), even with uncounted lines.
  - Sunday, silo line, pair countable and counted → `[]`.
  - Sunday, pair countable, not counted, same silo counted for another item → one count message.
  - Sunday, store line, nothing counted → `[]`.
  - Diet change (pair not countable, silo countable): silo counted → `[]`; silo not counted → count message.
  - Empty silo (neither pair nor silo countable) → `[]`.
  - Two uncounted lines → two messages in line order.
  - Line with `destinationId: null` → the "no destination or feed item" message.
- [x] **Step 2: Run, expect FAIL** (`sendGateProblems is not a function`):
  `env -u NX_WORKSPACE_ROOT_PATH pnpm nx test api --testPathPatterns=feed-requisition.rules --maxWorkers=2`
- [x] **Step 3: Implement** both functions. Weekday from `new Date(`${day}T00:00:00Z`).getUTCDay()`.
- [x] **Step 4: Run the same command, expect PASS.**

### Task 2: Enforce on submit and expose the check

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` (`submit`, about line 3603)
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.controller.ts`
- Test: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.submit.spec.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `submitGate(id: string, tenantId: string, user: UserCtx): Promise<{ allowed: boolean; today: string; problems: string[] }>` and `GET /feed-requisition/:id/submit-gate`, permission `('PROCUREMENT','REQUISITION','create')`, response `{ success: true, message: 'Feed requisition sending check.', data }`.

Add `private async sendGate(requisitionId, farmId, companyId, tenantId)` returning the same shape. It:
1. gets `{ today, timeZone }` from `farmToday`; if not Sunday, returns the rule's result without further queries;
2. loads gate lines: `requisition_line` left join `item_master` and `location_master` (destination): `line_seq, item_id, destination_location_id, item_name, location_code, location_type`, ordered by `line_seq`; `isStore = location_type === 'STORE'`;
3. only if there are silo lines: loads POSTED count lines (`feed_stock_count_line` inner join `feed_stock_count`) for this tenant, company and farm, those silos, `counted_at >= FROM_UNIXTIME(now - 3 days)`, selecting `silo_id, item_id, UNIX_TIMESTAMP(counted_at)`; keeps rows whose farm day equals `today`;
4. then loads countable pairs: `inventory_ledger` grouped by `warehouse_id, item_id`, same tenant and company, those silos, `entry_type in ('POSITIVE','NEGATIVE','TRANSFER')`.

In `submit`, call it inside the existing transaction, after `assertQuantityRules` and before `submitFarmDocument`; non-empty `problems` → `throw new BadRequestException(problems.join(' '))`. It must run after `applyLineEdits`. `submitGate` uses `resolveOwnFarm` + `forecast.withFarmScope`, as `submit` does, so another farm's user gets not found.

- [x] **Step 1: Make the existing spec date-independent.** Above `const TODAY = serverToday();` add:

```ts
jest
  .useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] })
  .setSystemTime(new Date('2026-11-29T12:00:00'));
```

  Add `groupBy: () => self` to `recordingDb`. Run the spec; expect PASS before any service change.
- [x] **Step 2: Write the failing tests** — `describe('send rule: Sunday + posted count')`. Queue order on `schema.requisitionLine` for a submit: `linesForCheck`, gate lines, urgency lines, then the view. Existing successful-submit tests need a gate-lines entry (`[]` is enough).
  - `setSystemTime('2026-11-30T12:00:00')`: submit rejects `/only on Sunday/`, `writes()` is `[]`.
  - Sunday, silo line, count rows empty, pair in ledger: rejects `/no posted stock count dated today/`, no approval request inserted.
  - Sunday, matching count row at today's epoch: succeeds.
  - Count row with last Sunday's epoch: rejects.
  - Company zone `Africa/Harare`, now `2026-11-29T09:00:00Z`, count epoch `2026-11-28T23:30:00Z`: succeeds.
  - Company with no zone: succeeds on the server's Sunday.
  - Submit with an edit changing the line's item on a refused gate: the transaction rejects (assert the error and that no `approvalRequest` insert or `PENDING_APPROVAL` update happened); gate lines reflect the new item and the message names it. Rollback itself is proven in Task 4 against MySQL.
  - The count query's where clause includes status `POSTED` (inspect the SQL the way the other list-sql specs do, so an APPROVED count cannot satisfy it).
  - `submitGate` on Monday returns `{ allowed: false, today: '2026-11-30', problems: [<Sunday message>] }`.
  - `submitGate` for another farm's user rejects with `NotFoundException`.
  - `update()` on Monday still saves (the existing edit tests, run with Monday set, in one case).
- [x] **Step 3: Run, expect FAIL.** `env -u NX_WORKSPACE_ROOT_PATH pnpm nx test api --testPathPatterns=feed-requisition --maxWorkers=2`
- [x] **Step 4: Implement** the service methods, the `submit` call and the route.
- [x] **Step 5: Run the same command, expect PASS** (all feed-requisition specs). Check `farm-scope-coverage.spec.ts` too: a new query may need to be listed there.

### Task 3: Explain the block on the open requisition

**Files:**
- Modify: `apps/web/src/components/console/inventory/feed-requisition-detail.tsx`
- Modify: `apps/web/src/utils/translations.ts` (`en` only)
- Test: `apps/web/specs/feed-requisition-detail.spec.tsx`

**Interfaces (Consumes):** Task 2's endpoint.

Behaviour: when the view is editable, GET the gate on open and again after Save (and when `view` changes; `view.requisition_id` alone does not change on Save). If `allowed` is false, show one `InlineAlert variant="warning"` near the actions, headed by a new key `rqSendBlocked` = `This requisition cannot be sent yet:`, listing the server's `problems` as they come. Disable Submit when `allowed === false` **and** no unsaved edit has `destinationId` or `itemId`. While loading or if the request fails, do not disable. A refused submit keeps showing the server message through the existing toast. Save is never disabled by this.

- [x] **Step 1: Write the failing tests:** blocked → warning shows the problem text, Submit disabled, Save enabled; allowed → no warning, Submit enabled; request fails → Submit enabled; unsaved item change while blocked → Submit enabled; after Save the gate is requested again; non-editable view → gate not requested.
- [x] **Step 2: Run, expect FAIL.** `env -u NX_WORKSPACE_ROOT_PATH pnpm nx test web --testPathPatterns=feed-requisition-detail --maxWorkers=2`
- [x] **Step 3: Implement.**
- [x] **Step 4: Run, expect PASS.** Then `env -u NX_WORKSPACE_ROOT_PATH pnpm nx run web:typecheck`.

### Task 4: Verify for real and report

- [x] **Step 1:** Run the full API and web suites and both builds. Compare failing test names and the lint error count with the record taken before Task 1: nothing new. Afterwards check `git status` and restore `apps/web/next-env.d.ts` if only the build changed it.
- [x] **Step 2:** Restart the API cleanly and confirm the new code is in `dist` (`nx serve api` does not reliably rebuild).
- [x] **Step 3 (any day but Sunday):** in the app, open a draft on `nf_ccc`: the warning shows and Submit is disabled; Save works. Call submit directly with a line edit: HTTP 400. In MySQL confirm the requisition's status, `approval_request_id` and the line are unchanged, and no `approval_request` row was added. Saving a draft and submitting write data: ask Rishi before any step that changes `nf_ccc` rows.
- [ ] **Step 4 (needs a real Sunday, next 29 November 2026):** the accepted path needs a posted count. `nf_ccc` had no POSTED count on 25 November. Creating, approving and posting one is test data: ask Rishi first. If it cannot be run, report it as **not verified**; do not add a date override to the product.
- [x] **Step 5:** Report to Rishi: what passed and what was not verified. Rishi approved spec rule 4 (pairs that cannot be counted) on 25 November. Nothing committed.
