# Feed Forecast Plan S: fixes from the running-app review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## How to continue (read first — work may stop at a usage limit)

- **Repo / branch:** `/Users/nero/Desktop/navfarm`, branch `feat/feed-forecast-report`. Work in place. Never switch branches, push or merge.
- **Ledger:** `.superpowers/sdd/2026-09-27-feed-forecast-s-fixes/progress.md`. Create it with the SDD layout on first start (a `# SDD ledger — plan: docs/superpowers/plans/2026-09-27-feed-forecast-s-fixes.md` heading, a `## Progress` section). Copy `context.md` from `.superpowers/sdd/2026-09-26-feed-forecast-r-report-alignment/context.md` into the same folder and change its first bullet's plan name to this plan.
- **Order:** strictly serial, Task 1 → Task 21, in the numbering below. Never run two tasks at once: Tasks 9–16 share `translations.ts`, and several pairs share a file (listed under "Task order").
- **Every task ends with one commit and one ledger line.** The ledger line is `Task N: complete (<first-sha>..<last-sha>, tests: <exact command> → <result>)`. A task without its ledger line is not done. On resume, read the ledger, run `git log --oneline -25`, and start at the first task with no ledger line. If a task's commit exists but its ledger line does not, re-run that task's verification step, then write the line.
- **Each task is self-contained:** its Files block names every file it touches, and its last steps name the exact verification command. A fresh agent can pick up any task from the ledger alone.
- **Rulings** made while executing (a deviation from this text, with the reason) go in the ledger as `Ruling (Task N): …`, as the Plan R ledger does.

**Goal:** Fix every item of the 27 Sep running-app review of the Feed Forecast screens (A1–A13, B1–B3, C), and carry out Rishi's decisions D21–D27: feed alerts in the one Alerts page, feed requisitions approved in the Approvals inbox, one Requisitions screen, required silo levels, and migrations that repair existing data without overwriting anything.

**Architecture:** The API fixes are local. The requisition list's correlated subquery gets its outer table name. A `GET /feed-forecast/farms` endpoint reuses `resolveFarm`'s scope rules. `PATCH /batch/:id/shed` sets a batch's shed. Silo levels become required. The approval engine learns farm-level documents (`approval_request.farm_id` / `document_id`, scoped by farm, with a per-document-type decision handler), and the feed requisition moves to submit → approve in the inbox. Feed alerts get tenant-scope list and evaluate endpoints for the Alerts page. The web gets one cached farm hook, a fixed-height page mode in which only the table scrolls (sticky header row and first columns), rewritten screens and copy. Data repairs are four tenant migrations (0122–0125) that only fill empty values. They are rehearsed on a scratch copy of `nf_devco`.

**Tech Stack:** NestJS 11 + Drizzle 0.45 (MySQL 8.4 on the server, 9.7 locally), Next.js 16 + React 19 + Tailwind v4, Jest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-25-feed-forecast-design.md` — D1–D27 bind. D21–D27 are this plan's. Scope: `.superpowers/feed-forecast-sources/review-2026-09-27-running-app.md`. Every item maps to a task (see the coverage table at the end).

## Open questions for Rishi (the plan uses the default)

| # | Question | Default used |
|---|---|---|
| S1 | D22/D27 Low level for existing silos | **Closed by D27:** Low = 20 %, High = 90 % of capacity, where empty. |
| S2 | Does a farm picked on a feed screen pin the farm for the whole app? | **Accepted (27 Sep):** feed screens only. It is stored under `nf_feed_farm_id`, started from the pinned farm, and falls back to the first farm by code. |
| S3 | Tenant-view farm picker | **Accepted (27 Sep):** one list sorted by code, grouped by company (`<optgroup>`) when there is more than one company. |
| S4 | Separate feed alert / approval screens | **Closed by D24–D26.** |
| S5 | Approving a feed requisition in the Approvals inbox: which grant? | Both: the inbox route's `PRODUCTION/APPROVAL approve` **and** the requisition's own `PROCUREMENT/REQUISITION approve` (Plan B's rule: approving commits the mill). A farm approver needs both grants in their role. |
| S6 | The Master Data group for Reporting Periods and Alert Rules (today "Inventory") | **Farm Operations**, beside Locations. Both are farm-planning setup, not stock items. |
| S7 | Stage durations the BBP gives only as a range (DRY_SOW 4–7, FLUSH 3–5, FARROWING 2–4), plus WEANING, and the WEANER → GROWER → FINISHER chain. The system stage seed deliberately leaves them empty. | Only the demo seed and the D23 migration fill them. The values come from the demo lifecycle rows Rishi set on 15 Sep: **FLUSH 14, FARROWING 3, WEANING 1**. DRY_SOW takes the BBP upper bound, **7**. Next stages are **WEANER → GROWER → FINISHER**. They are held in one constant (`DEMO_STAGE_TIMINGS`). The system seed (`piggery-bbp-stage-seed.ts`) stays range-honest, and its test is unchanged. FLUSH 14 is the lifecycle sheet's figure, not BBP §1.7's 3–5. |
| S8 | Should a late or >20 % requisition be refused at **submit** as well as at approval? | Yes, at both, with the same rule (`approvalProblems`). A requisition without the remarks it needs never reaches an approver. The approver may still add remarks in the inbox (D25). |
| S9 | Where a withdrawn approval request leaves its requisition | Back to **DRAFT**, with `approval_request_id` cleared. The farm can edit it and submit again. |
| S10 | Demo silo stock | Chapter 02 fills each silo to **50 %** of capacity, not the flat 2,000 kg. At 2,000 kg every silo would sit under the 20 % low level and raise 53 alerts. Chapter 07 then sets two VIL100 silos' low levels so that one runs down in about 10 days and one raises FEED_BELOW_L1 at once. |

## Global Constraints

- Comments explain **why**, in prose, matching the dense style of the file being edited.
- New UI strings go in the `en` dictionary only (`apps/web/src/utils/translations.ts`); `t()` falls back to English. Changed copy is changed in `en` only.
- Copy is plain farm-office English: a short title, at most one short line under it, labels a farm manager would use. No "—" chains, no explanations of our internal rules on the page, no raw codes (review C, A8).
- Dates on the feed screens, the Alerts page, the Requisitions screen and in their API messages are **DD/MM/YY** (D16). A time, where shown, is `DD/MM/YY HH:mm`. API messages carry no ISO dates (A9).
- Web lint baseline: gate on **no new errors** vs **94** (26 Sep). Never "fix" a pre-existing `exhaustive-deps`, and never add an `eslint-disable`.
- Inside effects, `t` goes through the tRef pattern. Every list read off a response is guarded with `Array.isArray`.
- Every `@RequirePermission(module, resource, action)` pair must also be offered in `apps/web/src/components/console/console-tabs/roles-tab.tsx`. This plan adds routes only under pairs already offered: INVENTORY/LEDGER, PROCUREMENT/REQUISITION, PRODUCTION/APPROVAL, PRODUCTION/BATCH.
- Run tasks through Nx: `pnpm nx test api -- --testPathPatterns=<pattern>`, `pnpm nx test web -- --testPathPatterns=<pattern>`, `pnpm nx run-many -t typecheck -p api,web`. Full runs use `--maxWorkers=2` (8 GB machine).
- Verify by writing through the API and reading MySQL, not by a green suite alone. `nx serve api` does not rebuild: rebuild (`pnpm nx run api:build --skipNxCache`) and restart the API by PID (`lsof -ti :2877`) before driving it. Never `pkill`.
- New tenant migrations are 0122–0125. Journal `when` values continue from 0121's 1791135600000 in steps of 86400000 (0122 = 1791222000000, 0123 = 1791308400000, 0124 = 1791394800000, 0125 = 1791481200000).
- Migrations fill NULLs only, never overwrite, and are idempotent: a second run changes 0 rows.
- Do NOT run `db-rebuild-demo`, `setup-fresh-database`, or any DROP outside a `nf_rehearsal_*` database. The demo rebuild is Rishi's to run (the classifier blocks agents).
- Do not start the web dev server or a browser except in Task 21. The machine has 8 GB. Stop what you started, by PID.
- MySQL (local dev tenant only): `cd apps/api && set -a && . ./.env && set +a && MYSQL_PWD="$DATABASE_PASSWORD" mysql -h 127.0.0.1 -u root -t nf_devco -e "…"`.
- Pipe Nx output through `sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|FAIL|error TS"`.
- Commit with explicit paths only: `git commit -m "…" -- <file> <file>`. Never stage `nx.json` or `apps/web/next-env.d.ts`. The commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Say what changed and why it was wrong before (AGENTS.md §6).

## Review Focus

The five inputs most likely to bite a user that no single task's happy path exercises, each pinned by a test in the owning task:

1. **A legacy PEN/SHED/CRATE row with `storage_type = 'SILO'`** (248 such rows in `nf_devco`). Editing a pen must not start demanding silo levels. Levels are required only when `location_type = 'SILO'` (Task 4, test "does not require levels on a pen that carries a legacy SILO storage type").
2. **A tenant admin in the tenant-wide workspace (no company)** opening Forecast, Requisitions and Alerts. The farm list must hold every active farm of every company, and each farm must still open (Task 2 "tenant admin with no company sees every company's farms"; Task 8 "evaluates and lists every farm in scope").
3. **A farm user (STANDARD_USER) in the Approvals inbox.** They must see their own farm's feed requisition, which has no batch, and nothing from another farm. Batch-based rows keep their old visibility (Task 6 rendered-SQL tests).
4. **An approver approving a requisition that needs remarks** (more than 20 % off, or late) without giving any. The decision is refused, and nothing is half-written in either table (Task 7 "refuses without remarks and leaves both documents pending").
5. **A tester's own value where a migration would fill a default:** a silo with only a high level set, a stage with a duration typed in, a batch with a shed already chosen, a batch whose animals stand in two sheds. None may change (Task 19 edge cases, checked by per-row hash in Task 20).

## File map

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` | list fields (A1); submit + approval handler (D25) | 1, 7 |
| `apps/api/src/modules/procurement/feed-requisition/feed-requisition.list-sql.spec.ts` (new) | rendered SQL of the list | 1 |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`, `.controller.ts` | `listFarms`, `GET /feed-forecast/farms` (A2); DD/MM/YY messages (A9) | 2, 3 |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` | `dayShort()` | 3 |
| `apps/api/src/modules/inventory/feed-alert/feed-alert.rules.ts` | plain alert copy (A9, C) | 3 |
| `apps/api/src/modules/master-data/location/location.service.ts` | required silo levels (A13) | 4 |
| `apps/api/src/modules/production/batch/*` | `PATCH /batch/:id/shed` (A12) | 5 |
| `apps/api/src/modules/production/approval/*`, `drizzle/tenant/0122_*` | farm documents in the approval engine (D25) | 6 |
| `apps/api/src/modules/inventory/feed-alert/feed-alert.service.ts`, `.controller.ts`; `apps/api/src/modules/production/alert/*` | scope-wide feed alerts, farm filter on batch alerts (D24) | 8 |
| `apps/web/src/components/console/inventory/use-feed-farm.ts`, `feed-farm-select.tsx`, `apps/web/src/utils/date-short.ts` | one farm list, shared selection (A3–A5) | 9 |
| `apps/web/src/app/global.css`, `components/ui/console-page.tsx`, `components/ui/scroll-table.tsx` | fixed-height page and scrolling table | 10 |
| `apps/web/src/components/console/inventory/feed-forecast-grid.tsx` | grid + stage table (A6, A7, C) | 11 |
| `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`, `feed-forecast-notes.tsx` | forecast screen (A11, C) | 12 |
| `apps/web/src/components/console/inventory/requisitions-panel.tsx`, `requisition-labels.ts` | Requisitions screen (D26, A8, A9) | 13 |
| `apps/web/src/components/console/inventory/requisition-new-dialog.tsx` | manual requisition entry (D26) | 14 |
| `apps/web/src/components/console/production/alert-panel.tsx`, `alerts-list.ts` | one Alerts list (D24) | 15 |
| `apps/web/src/components/console/approvals/approvals-page-shell.tsx` | feed requisitions in the inbox (D25) | 16 |
| `apps/web/src/modules/master-data/configs.ts`, `types.ts`, `MasterDataTable.tsx` | menu entries, labels, date columns (A8–A10) | 17 |
| `apps/api/src/core/database/demo-feed-defaults.ts` (new), `scripts/seed-nine-farm-demo.ts` | demo silo levels, stage timings, DRY_SOW feed row (B1) | 18 |
| `apps/api/src/scripts/demo/register-breeding-stock.ts`, `chapters/02-inventory.ts`, `chapters/07-feed-planning.ts` (new), `demo-chapters.ts` | demo stock, stage dates, periods, alerts (B1) | 19 |
| `apps/api/src/drizzle/tenant/0123–0125_*` | D21–D23 repairs (B2) | 20 |
| `docs/deploy-rdp-windows.md` §13 | runbook (B2) | 21 |
| `docs/VERIFICATION-2026-09-27-feed-forecast-s.md` (new) | running-app evidence | 22 |

## Task order

Strictly serial: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22.**

Files touched by more than one task, which is why the order is fixed: `feed-requisition.service.ts` (1, 7); `feed-forecast.service.ts` (2, 3); `translations.ts` (5, 9, 11–17); `inventory-page-shell.tsx` (12, 13); `configs.ts` (4, 17); `schema.ts` (6); `feed-alert.rules.ts` (3) and `feed-alert.service.ts` (8); `seed-nine-farm-demo.ts` (18) and `demo-feed-defaults.ts` (18, 19, 20); `drizzle/tenant/meta/_journal.json` (6, 20).

---

### Task 1: A1 — requisition list line count and total per requisition

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` (`findAll`, ~:576–603; new export above the class)
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.list-sql.spec.ts`

**Interfaces:**
- Produces: `export function requisitionListFields()` from `feed-requisition.service.ts`. It is the select map `findAll` uses, with the keys unchanged: `requisition_id, req_no, requisition_type, status, priority, required_date, submission_deadline, created_at, line_count, requested_kg`. Task 7 adds `approval_request_id` to it.

Why it is wrong today (proved on 27 Sep with `drizzle.mock()`): in a single-table select, Drizzle renders a column inside a `sql` field **without its table**. So the query MySQL receives is

```sql
select `requisition_id`, (SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = `requisition_id`) from `requisition` …
```

MySQL binds the bare `requisition_id` to `rl` itself, and every row counts every line of the farm. Writing the outer reference as raw SQL renders `` rl.requisition_id = `requisition`.`requisition_id` ``.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/procurement/feed-requisition/feed-requisition.list-sql.spec.ts
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { requisitionListFields } from './feed-requisition.service';

/**
 * Review A1 (27 Sep): the list showed "4 lines, 8,784 kg" on all three VIL100
 * requisitions against 2/1/1 lines in MySQL. The correlated subqueries must
 * name the OUTER table, or MySQL binds the column to requisition_line itself.
 * Rendered through a mock driver so the assertion is on the SQL MySQL runs.
 */
describe('feed requisition list — correlated line totals', () => {
  const sqlText = drizzle.mock().select(requisitionListFields()).from(schema.requisition).toSQL().sql;

  it('correlates the line count with the outer requisition row', () => {
    expect(sqlText).toContain('(SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = `requisition`.`requisition_id`)');
  });

  it('correlates the requested total with the outer requisition row', () => {
    expect(sqlText).toContain('(SELECT COALESCE(SUM(rl.quantity), 0) FROM requisition_line rl WHERE rl.requisition_id = `requisition`.`requisition_id`)');
  });

  it('never compares the line table with itself', () => {
    expect(sqlText).not.toMatch(/rl\.requisition_id = `requisition_id`/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm nx test api -- --testPathPatterns=feed-requisition.list-sql 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: FAIL, because `requisitionListFields` is not exported.

- [ ] **Step 3: Implement.** Add this above `@Injectable()` in `feed-requisition.service.ts`:

```ts
/**
 * The feed requisition list's columns (review A1, 27 Sep). The two totals are
 * correlated subqueries, and the outer reference is written as raw SQL on
 * purpose: in a single-table select Drizzle renders a column interpolated
 * into sql`` without its table, so `${schema.requisition.requisition_id}`
 * came out as a bare `requisition_id` that MySQL bound to requisition_line
 * itself — every row counted every line of the farm. Exported so the
 * rendered SQL is pinned by feed-requisition.list-sql.spec.ts.
 */
export function requisitionListFields() {
  const R = schema.requisition;
  const outer = sql.raw('`requisition`.`requisition_id`');
  return {
    requisition_id: R.requisition_id,
    req_no: R.req_no,
    requisition_type: R.requisition_type,
    status: R.status,
    priority: R.priority,
    required_date: R.required_date,
    submission_deadline: R.submission_deadline,
    created_at: R.created_at,
    line_count: sql<number>`(SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = ${outer})`,
    requested_kg: sql<string>`(SELECT COALESCE(SUM(rl.quantity), 0) FROM requisition_line rl WHERE rl.requisition_id = ${outer})`,
  };
}
```

In `findAll`, replace the whole literal object passed to `.select({ … })` (from `requisition_id: schema.requisition.requisition_id,` through the `requested_kg: …` line) with `.select(requisitionListFields())`.

- [ ] **Step 4: Run the module's specs**

Run: `pnpm nx test api -- --testPathPatterns=feed-requisition 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: all pass.

- [ ] **Step 5: Prove it on MySQL.** Rebuild and restart the API (`pnpm nx run api:build --skipNxCache`; stop the old one by the PID from `lsof -ti :2877`; start with `pnpm nx run api:serve` in the background). Log in as `tenant.admin@triplec.local` through `POST /api/v1/auth/login`. Call `GET /api/v1/feed-requisition?farmId=<VIL100 location_id>` and compare each row's `line_count` / `requested_kg` with:

```sql
SELECT r.req_no, COUNT(l.line_id) lines_n, COALESCE(SUM(l.quantity),0) kg FROM requisition r
LEFT JOIN requisition_line l ON l.requisition_id=r.requisition_id
WHERE r.doc_type='FEED' AND r.deleted_at IS NULL GROUP BY r.req_no;
```

Expected on the local data of 27 Sep: 2 / 1 / 1 lines and 4,550 / 1,234 / 3,000 kg, row for row. Stop the API by PID.

- [ ] **Step 6: Commit and write the ledger line**

```bash
git commit -m "fix(feed-requisition): count each requisition's own lines in the list (review A1)

The list's line count and requested total were correlated subqueries whose
outer reference Drizzle rendered without its table, so MySQL bound it to
requisition_line and every row showed the farm's grand total (4 lines,
8,784 kg on all three VIL100 requisitions; MySQL has 2/1/1 and
4,550/1,234/3,000). The outer column is now written qualified and the
rendered SQL is pinned by a test.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.list-sql.spec.ts
```

---

### Task 2: A2/A5 — `GET /feed-forecast/farms`: the farms the caller may open

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` (new `FeedFarmOption` type and `listFarms` method after `listPeriods`; add `SQL` to the drizzle import)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts` (new route)
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.farms.spec.ts`

**Interfaces:**
- Produces: `export interface FeedFarmOption { farmId: string; code: string; name: string; companyId: string; companyName: string | null }`
- Produces: `FeedForecastService.listFarms(tenantId: string, userType: string | undefined): Promise<FeedFarmOption[]>`, sorted by `code`
- Produces: `GET /api/v1/feed-forecast/farms` → `{ success, message, data: FeedFarmOption[] }` under `INVENTORY/LEDGER view`

The rules are the ones `resolveFarm` applies, so the list never offers a farm that `resolveFarm` would refuse:

- STANDARD_USER: only the farm the guard pinned (`scope.farmId`), inside `scope.companyId` when one is set. No pinned farm → `[]`.
- any other type with a company in scope: that company's active top-level farms. A restricted (OPERATIONAL_ADMIN) caller with an LOB gets only farms of that LOB, which is `resolveFarm`'s `farmRow.lob_id !== scope.lobId` rule.
- TENANT_ADMIN / SYSTEM_ADMIN with no company (tenant-wide workspace): every active farm of the tenant, labelled with its company.
- any other type with no company: `[]` (`resolveFarm` fails closed there too).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/inventory/feed-forecast/feed-forecast.farms.spec.ts
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { FeedForecastService } from './feed-forecast.service';

/**
 * Review A2 (27 Sep): a tenant admin in the tenant-wide workspace got an empty
 * farm picker on every feed screen — GET /location?locationType=FARM answers []
 * with no company — although resolveFarm already lets that admin open any
 * farm of the tenant. The list now comes from the same scope rules.
 */
describe('FeedForecastService.listFarms (A2)', () => {
  const dialect = new MySqlDialect();
  let where: unknown;
  const rows = [
    { farm_id: 'f-vil', code: 'VIL100', name: 'Villa Franca', company_id: 'co-1', company_name: 'Colcom Piggery' },
  ];
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: (w: unknown) => { where = w; return chain; },
    orderBy: async () => rows,
  };
  const db = { select: jest.fn(() => chain) };
  const rendered = () => dialect.sqlToQuery(where as any);

  beforeEach(() => { where = undefined; db.select.mockClear(); });

  it('tenant admin with no company sees every company\'s farms, labelled with the company', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    const list = await new FeedForecastService(cls, {} as any).listFarms('tenant-1', 'TENANT_ADMIN');
    expect(list).toEqual([{ farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom Piggery' }]);
    const q = rendered();
    expect(q.sql).toContain('`location_master`.`location_type` = ?');
    expect(q.sql).toContain('`location_master`.`parent_location_id` is null');
    expect(q.sql).not.toContain('`location_master`.`company_id` = ?');
    expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'FARM']));
  });

  it('a company admin sees the company\'s farms only', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'f-other', restricted: false, companyId: 'co-1', lobId: null });
    await new FeedForecastService(cls, {} as any).listFarms('tenant-1', 'COMPANY_ADMIN');
    const q = rendered();
    expect(q.sql).toContain('`location_master`.`company_id` = ?');
    expect(q.params).toContain('co-1');
    // A pinned farm does not narrow an admin's list: resolveFarm lets them open any farm of the company.
    expect(q.params).not.toContain('f-other');
  });

  it('an operational admin sees the farms of their LOB only', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await new FeedForecastService(cls, {} as any).listFarms('tenant-1', 'OPERATIONAL_ADMIN');
    expect(rendered().sql).toContain('`location_master`.`lob_id` = ?');
    expect(rendered().params).toContain('lob-pig');
  });

  it('a farm user sees only their pinned farm', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'f-vil', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await new FeedForecastService(cls, {} as any).listFarms('tenant-1', 'STANDARD_USER');
    expect(rendered().sql).toContain('`location_master`.`location_id` = ?');
    expect(rendered().params).toContain('f-vil');
  });

  it('answers an empty list, without querying, where resolveFarm would refuse every farm', async () => {
    for (const [scope, type] of [
      [{ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' }, 'STANDARD_USER'],
      [{ farmId: null, restricted: false, companyId: null, lobId: null }, 'COMPANY_ADMIN'],
      [{ farmId: null, restricted: false, companyId: null, lobId: null }, undefined],
    ] as const) {
      const cls = transactionCls(db);
      useFarmScope(cls, scope);
      await expect(new FeedForecastService(cls, {} as any).listFarms('tenant-1', type)).resolves.toEqual([]);
    }
    expect(db.select).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm nx test api -- --testPathPatterns=feed-forecast.farms 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: FAIL, because `listFarms` is not a function.

- [ ] **Step 3: Implement.** In `feed-forecast.service.ts`, add `SQL` to the type import from `drizzle-orm` (`import type { SQL } from 'drizzle-orm';` under the existing drizzle import). Add below the `ForecastFarm` interface:

```ts
/** One farm a feed screen may offer (review A2). companyName labels it in the tenant-wide workspace. */
export interface FeedFarmOption {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string | null;
}
```

Then add this method directly after `listPeriods`:

```ts
  /**
   * GET /feed-forecast/farms (review A2, A5): the farms the feed screens may
   * offer this caller, by the rules resolveFarm applies — so the picker never
   * lists a farm the report would then refuse, and never hides one it would
   * open. A tenant admin in the tenant-wide workspace (no company pinned) gets
   * every active farm of the tenant, which is what resolveFarm's
   * activeFarmOfTenant already allowed; the location list the screens used
   * before answered [] there. Sorted by code, the order the farms are known by.
   */
  async listFarms(tenantId: string, userType: string | undefined): Promise<FeedFarmOption[]> {
    const scope = farmScope(this.cls);
    const L = schema.locationMaster;
    const conditions: SQL[] = [
      eq(L.tenant_id, tenantId),
      eq(L.location_type, 'FARM'),
      isNull(L.parent_location_id),
      eq(L.is_active, true),
      isNull(L.deleted_at),
    ];
    if (userType === 'STANDARD_USER') {
      if (!scope.farmId) return [];
      conditions.push(eq(L.location_id, scope.farmId));
      if (scope.companyId) conditions.push(eq(L.company_id, scope.companyId));
    } else if (scope.companyId) {
      conditions.push(eq(L.company_id, scope.companyId));
      if (scope.restricted && scope.lobId) conditions.push(eq(L.lob_id, scope.lobId));
    } else if (userType !== 'TENANT_ADMIN' && userType !== 'SYSTEM_ADMIN') {
      return [];
    }
    const rows = await this.db
      .select({
        farm_id: L.location_id,
        code: L.location_code,
        name: L.location_name,
        company_id: L.company_id,
        company_name: schema.companyMaster.company_name,
      })
      .from(L)
      .leftJoin(schema.companyMaster, eq(schema.companyMaster.company_id, L.company_id))
      .where(and(...conditions))
      .orderBy(L.location_code);
    return rows.map((r) => ({
      farmId: r.farm_id,
      code: r.code,
      name: r.name,
      companyId: r.company_id as string,
      companyName: r.company_name ?? null,
    }));
  }
```

In `feed-forecast.controller.ts`, add this route directly after the `periods` route (before `@Get()`):

```ts
  // Read under the report's own grant for the same reason as 'periods': a farm
  // login has no Master Data grant, and the farm picker is part of the report.
  @Get('farms')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Farms the feed screens may offer this caller, by the same rules the report applies (review A2)' })
  async farms(@Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.listFarms(tenantId, req.user?.userType);
    return { success: true, message: 'Farms retrieved successfully.', data };
  }
```

- [ ] **Step 4: Run the forecast specs**

Run: `pnpm nx test api -- --testPathPatterns=feed-forecast 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: all pass.

- [ ] **Step 5: Prove it on the running API** (rebuild and restart as in Task 1 Step 5). As `tenant.admin@triplec.local`, send **no** `x-active-company-id` and `x-workspace-scope: TENANT`, then call `GET /api/v1/feed-forecast/farms`. Expected: every row of `SELECT location_code FROM location_master WHERE location_type='FARM' AND parent_location_id IS NULL AND is_active=1 AND deleted_at IS NULL ORDER BY 1`, in that order (FARM-001 is inactive and must be absent), each with its company name. Then call `GET /api/v1/feed-forecast?farmId=<VIL100>` with the same headers. Expected: 200. Stop the API by PID.

- [ ] **Step 6: Commit and write the ledger line**

```bash
git commit -m "feat(feed-forecast): list the farms a caller may open for the feed screens (review A2, A5)

A tenant admin in the tenant-wide workspace got an empty farm picker on
Feed Forecast, Requisitions and Alerts: the screens read
GET /location?locationType=FARM, which answers [] with no company, although
resolveFarm already lets that admin open any farm of the tenant. The new
GET /feed-forecast/farms applies resolveFarm's own rules and sorts by code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.farms.spec.ts
```

---

### Task 3: A9 + C (API) — DD/MM/YY and plain wording in API messages and feed alerts

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` (new export `dayShort`, after `todayInZone`)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` (`planningDateProblem`, `reachProblem`, `asOfPastNote`, the no-period message, `forecastNote`)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts` (`spanProblem`)
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts` (`approvalProblems`)
- Modify: `apps/api/src/modules/inventory/feed-alert/feed-alert.rules.ts` (titles and messages)
- Modify (tests): `feed-forecast.engine.spec.ts`, `feed-forecast.view.spec.ts`, `feed-forecast.service.spec.ts`, `feed-forecast.service.farm.spec.ts` (all in `apps/api/src/modules/inventory/feed-forecast/`), `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts`, `apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts`, `apps/api/src/modules/inventory/feed-alert/feed-alert.rules.spec.ts`

**Interfaces:**
- Produces: `export function dayShort(iso: string | null | undefined): string` in `feed-forecast.engine.ts`: `'2026-09-26'` → `'26/09/26'`, falsy → `'—'`, anything unparseable is returned unchanged.

Alerts already stored in `feed_alert` keep the text they were raised with. New and re-raised alerts carry the new text. This is recorded in the verification document, not migrated.

- [ ] **Step 1: Write the failing tests.** Append to `feed-forecast.engine.spec.ts` (it already imports from `./feed-forecast.engine`; add `dayShort` to that import):

```ts
describe('dayShort — the field specification\'s DD/MM/YY for API messages (review A9)', () => {
  it('formats a calendar day and a timestamp\'s day', () => {
    expect(dayShort('2026-09-26')).toBe('26/09/26');
    expect(dayShort('2026-11-07 10:00:00')).toBe('07/11/26');
  });
  it('dashes a missing day and leaves anything else alone', () => {
    expect(dayShort(null)).toBe('—');
    expect(dayShort('')).toBe('—');
    expect(dayShort('soon')).toBe('soon');
  });
});
```

Then change these existing expectations, old string → new string exactly:

`feed-forecast.view.spec.ts`
- `'The forecast covers at most 45 days after from.'` → `'Choose a range of at most 45 days.'`
- `'to must not be before from.'` → `'The end date is before the start date.'`
- `'Reporting period 2026-X runs 50 days (2026-08-01 to 2026-09-19); the forecast covers at most 46.'` → `'Reporting period 2026-X runs 50 days (01/08/26 to 19/09/26); the forecast covers at most 46.'`

`feed-forecast.service.spec.ts`
- `'Dates before the planning date (2026-09-23) are not forecast. Move the planning date back to see them.'` → `'Days before the planning date (23/09/26) are not forecast.'`
- `'No reporting period covers 2026-09-23. Add one under Master Data → Reporting Periods.'` → `'No reporting period covers 23/09/26. Add one under Farm Master → Reporting Periods.'`
- `'Reporting period 2026-X runs 50 days (2026-08-01 to 2026-09-19); the forecast covers at most 46.'` → `'Reporting period 2026-X runs 50 days (01/08/26 to 19/09/26); the forecast covers at most 46.'`
- `'Nothing in 2026-09-10 to 2026-09-15 is forecast: the range ends before the planning date (2026-09-23). Move the planning date back to see it.'` → `'Nothing from 10/09/26 to 15/09/26 is forecast: the range ends before the planning date (23/09/26).'`
- `'The planning date must be within 45 days of today (2026-09-23).'` → `'The planning date must be within 45 days of today (23/09/26).'`
- `'The forecast reaches at most 45 days past the planning date (to 2026-11-07).'` → `'The forecast reaches 07/11/26 at most (45 days after the planning date).'`
- `'No \`to\` was sent, so it defaults to from + 7 (2026-11-08), past the forecast\'s reach of 45 days after the planning date (2026-11-07). Send a \`to\` on or before 2026-11-07.'` → `'The range would end 08/11/26, after the last forecast day 07/11/26. Choose an end date on or before 07/11/26.'`

`feed-forecast.service.farm.spec.ts`
- the two-part `note:` expectation becomes
  `note: 'Stock as of 19/09/26. Batches, head counts and stages are as of today (26/09/26); a batch that entered its stage after 19/09/26 shows no feed before that.',`
- `'The planning date must be within 45 days of today (2026-09-26).'` (twice) → `'The planning date must be within 45 days of today (26/09/26).'`
- `'The forecast reaches at most 45 days past the planning date (to 2026-11-04).'` → `'The forecast reaches 04/11/26 at most (45 days after the planning date).'`
- `'No \`to\` was sent, so it defaults to from + 7 (2026-11-12), past the forecast\'s reach of 45 days after the planning date (2026-11-10). Send a \`to\` on or before 2026-11-10.'` → `'The range would end 12/11/26, after the last forecast day 10/11/26. Choose an end date on or before 10/11/26.'`

`feed-requisition.rules.spec.ts` and `feed-requisition.approve.spec.ts`
- `'Line 1 (Weaner Diet R1): requested 9,000 kg is more than 20% from the recommended 6,000 kg — remarks are required.'` → `'Line 1 (Weaner Diet R1): 9,000 kg is more than 20% off the recommended 6,000 kg. Add remarks to explain.'`
- `'The submission deadline 2026-09-26 has passed — give remarks to approve it as an exception.'` → `'The submission deadline (26/09/26) has passed. Add remarks to explain.'`
- In `feed-requisition.approve.spec.ts` the regex `/more than 20%/` stays as it is.

`feed-alert.rules.spec.ts`
- `'GRS/SILO-001 holds 1,000 kg of Weaner Diet R1 — at or below its low level of 1,000 kg.'` → `'GRS/SILO-001 has 1,000 kg of Weaner Diet R1, at or below its low level of 1,000 kg.'`
- `.toContain('Do not order.')` → `.toContain('No more feed needed yet.')`
- `'GRS/SILO-001 holds 0 kg of no feed — at or below its low level of 1,000 kg.'` → `'GRS/SILO-001 is empty, at or below its low level of 1,000 kg.'`
- `'WG-2026-38 in GRS/SHED-003 moves from Weaner Diet R1 to Weaner Diet R2 on 2026-09-26, in 3 days. Silo for the next diet: GRS/SILO-002.'` → `'WG-2026-38 in GRS/SHED-003 changes from Weaner Diet R1 to Weaner Diet R2 on 26/09/26 (in 3 days). Next diet silo: GRS/SILO-002.'`
- `.toContain('Silo for the next diet: none holds it yet.')` → `.toContain('Next diet silo: none yet.')`
- `'REQ-GRS-2026-00041 is AUTO_DRAFT; the submission deadline is 2026-09-26, 1 day left.'` → `'REQ-GRS-2026-00041 is a draft. Submission deadline 26/09/26, 1 day left.'`
- `'REQ-GRS-2026-00041 is AUTO_DRAFT; the submission deadline is 2026-09-26, today.'` → `'REQ-GRS-2026-00041 is a draft. Submission deadline 26/09/26, today.'`

Also add this test to `feed-alert.rules.spec.ts`, inside `describe('planAlerts — requisition deadline (checkpoint 20)', …)`, after the Friday/Saturday test (it uses that block's `draft` and the file's `base`, `reminderRule`, `overdueRule`, `dietRule`, `lowRule`, `silo1`):

```ts
  it('names the requisition status in words and carries no ISO date anywhere (review A8, A9)', () => {
    const pending = planAlerts(base({ today: '2026-09-25', rules: [reminderRule, overdueRule], requisitions: [{ ...draft, status: 'PENDING_APPROVAL' }] }));
    expect(pending.raise[0].message).toBe('REQ-GRS-2026-00041 is waiting for approval. Submission deadline 26/09/26, 1 day left.');
    const everything = planAlerts(base({
      today: '2026-09-23',
      rules: [lowRule, dietRule, reminderRule, overdueRule],
      silos: [silo1(900)],
      requisitions: [{ ...draft, submissionDeadline: '2026-09-23' }],
    }));
    expect(everything.raise.length).toBeGreaterThan(0);
    for (const r of everything.raise) expect(`${r.title} ${r.message}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm nx test api -- --testPathPatterns="feed-forecast|feed-requisition|feed-alert" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: FAIL (dayShort missing; messages differ).

- [ ] **Step 3: Implement.** In `feed-forecast.engine.ts`, after `todayInZone`:

```ts
/**
 * "YYYY-MM-DD" (or a timestamp starting with one) → "DD/MM/YY", the field
 * specification's date format (D16), for every message a user reads off the
 * API (review A9: alert texts said "deadline is 2026-09-26" while the screens
 * said 26/09/26). Anything that is not a date comes back as it was.
 */
export function dayShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
}
```

In `feed-forecast.service.ts`, add `dayShort` to the import from `./feed-forecast.engine`, then:

```ts
function planningDateProblem(today: string, planningDate: string): string | null {
  return Math.abs(diffDays(today, planningDate)) > MAX_SPAN_DAYS ? `The planning date must be within ${MAX_SPAN_DAYS} days of today (${dayShort(today)}).` : null;
}
```

```ts
function reachProblem(planningDate: string, to: string, toSent: boolean): string | null {
  const reach = addDays(planningDate, MAX_SPAN_DAYS);
  if (to <= reach) return null;
  return toSent
    ? `The forecast reaches ${dayShort(reach)} at most (${MAX_SPAN_DAYS} days after the planning date).`
    : `The range would end ${dayShort(to)}, after the last forecast day ${dayShort(reach)}. Choose an end date on or before ${dayShort(reach)}.`;
}
```

```ts
export function asOfPastNote(planningDate: string, today: string): string {
  return (
    `Stock as of ${dayShort(planningDate)}. Batches, head counts and stages are as of today (${dayShort(today)}); ` +
    `a batch that entered its stage after ${dayShort(planningDate)} shows no feed before that.`
  );
}
```

In `getForecast`, the no-period message becomes
`` `No reporting period covers ${dayShort(planningDate)}. Add one under Farm Master → Reporting Periods.` ``
and `forecastNote` becomes:

```ts
    const forecastNote = forecastFrom === null
      ? `Nothing from ${dayShort(from)} to ${dayShort(to)} is forecast: the range ends before the planning date (${dayShort(planningDate)}).`
      : forecastFrom > from
        ? `Days before the planning date (${dayShort(planningDate)}) are not forecast.`
        : null;
```

In `feed-forecast.view.ts`, change the import to `import { addDays, dayShort, diffDays, type DailyForecastRow } from './feed-forecast.engine';` and replace `spanProblem`'s body messages:

```ts
  if (to < from) return 'The end date is before the start date.';
  const span = diffDays(from, to);
  if (span <= MAX_SPAN_DAYS) return null;
  return period
    ? `Reporting period ${period.periodCode} runs ${span + 1} days (${dayShort(period.startDate)} to ${dayShort(period.endDate)}); the forecast covers at most ${MAX_SPAN_DAYS + 1}.`
    : `Choose a range of at most ${MAX_SPAN_DAYS} days.`;
```

In `feed-requisition.rules.ts`, change the engine import to `import { addDays, dayShort, diffDays, todayLocal, type ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';` and in `approvalProblems`:

```ts
      problems.push(`Line ${l.lineSeq} (${l.itemName}): ${kg(l.quantityKg)} kg is more than 20% off the recommended ${kg(l.recommendedQtyKg ?? 0)} kg. Add remarks to explain.`);
```

```ts
    problems.push(`The submission deadline (${dayShort(args.submissionDeadline)}) has passed. Add remarks to explain.`);
```

In `feed-alert.rules.ts`, change the engine import to `import { dayShort, type DietChange } from '../feed-forecast/feed-forecast.engine';`. Add below `days`:

```ts
/** A requisition status in the words the farm uses (review A8: alert texts said "is AUTO_DRAFT"). */
const REQ_STATUS_WORDS: Record<string, string> = {
  AUTO_DRAFT: 'a draft', DRAFT: 'a draft', PENDING_APPROVAL: 'waiting for approval',
};
```

and replace the three candidate texts:

```ts
        title: low ? `Low feed: ${silo.siloCode}` : `Over-stock: ${silo.siloCode}`,
        message: low
          ? silo.itemName
            ? `${silo.siloCode} has ${kg(silo.balanceKg)} kg of ${silo.itemName}, at or below its low level of ${kg(threshold)} kg.`
            : `${silo.siloCode} is empty, at or below its low level of ${kg(threshold)} kg.`
          : `${silo.siloCode} has ${kg(silo.balanceKg)} kg of ${what}, at or above its high level of ${kg(threshold)} kg. No more feed needed yet.`,
```

```ts
      const silo = dc.nextSourceType === 'SILO' && dc.nextSourceCode ? dc.nextSourceCode : 'none yet';
      const whenDiet = left === 0 ? 'today' : `in ${days(left)}`;
      out.push({
        rule, dedupKey: `${rule.ruleId}|${dc.batchId}|${dc.toItemId}|${dc.changeDate}`, subjectType: 'BATCH', subjectId: dc.batchId, itemId: dc.toItemId,
        title: `Diet change in ${days(left)}: ${dc.batchNo}`,
        message: `${dc.batchNo} in ${dc.shedCode} changes from ${dc.fromItemName} to ${dc.toItemName} on ${dayShort(dc.changeDate)} (${whenDiet}). Next diet silo: ${silo}.`,
```

```ts
        title: `Requisition ${req.reqNo} not approved`,
        message: `${req.reqNo} is ${REQ_STATUS_WORDS[req.status] ?? 'not approved'}. Submission deadline ${dayShort(req.submissionDeadline)}, ${when}.`,
```

The low-level message with no item: `what` is still used by the over-stock text. Leave its `const what = silo.itemName ?? 'no feed';` line as it is.

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm nx test api -- --testPathPatterns="feed-forecast|feed-requisition|feed-alert" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: all pass. Then: `grep -rn "Master Data → Reporting" apps/api/src` prints nothing.

- [ ] **Step 5: Commit and write the ledger line**

```bash
git commit -m "fix(feed): DD/MM/YY and plain wording in feed API messages and alerts (review A9, C)

Alert and error texts embedded ISO dates ('deadline is 2026-09-26') and raw
status codes ('is AUTO_DRAFT') while the screens show 26/09/26 (field spec,
D16). Messages now use dayShort() and farm-office wording; alert texts no
longer explain our rules ('— at or above its high level … Do not order.').

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.farm.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts apps/api/src/modules/inventory/feed-alert/feed-alert.rules.ts apps/api/src/modules/inventory/feed-alert/feed-alert.rules.spec.ts
```

---

### Task 4: A13 / D22 — Below Feed Level and Above Threshold required on a silo

**Files:**
- Modify: `apps/api/src/modules/master-data/location/location.service.ts` (`assertSiloLevels` ~:570 and its two callers ~:850, ~:1255)
- Modify: `apps/api/src/modules/master-data/location/dto/location.dto.ts` (the two `@ApiProperty` descriptions at ~:180–191 and ~:378–389)
- Modify: `apps/api/src/modules/master-data/location/location.service.spec.ts`
- Modify: `apps/web/src/modules/master-data/configs.ts` (the `low_level_kg` / `high_level_kg` fields, ~:135–143)

**Interfaces:**
- Produces: the API refuses a SILO (`location_type = 'SILO'`) create or update that leaves either level empty, with `400 "A silo needs both a Below Feed Level and an Above Threshold."`. The existing checks stay: low < high ≤ capacity in KG.
- Consumes: nothing new.

The requirement keys on `location_type = 'SILO'`, **not** on `storage_type`. `nf_devco` has 248 PEN/SHED/CRATE rows carrying a legacy `storage_type = 'SILO'` (Review Focus 1). Requiring levels there would block every edit of those pens.

- [ ] **Step 1: Write the failing tests.** Append inside the `describe` that holds the existing "stores a silo low and high feed level" test in `location.service.spec.ts` (same `selectResults`, `service`, `company`, `siloType`, `farmParent`, `txInsert`, `txUpdate` helpers):

```ts
  it('refuses a new silo without both feed levels (D22)', async () => {
    selectResults.push([company], [siloType], [farmParent()]);
    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      capacity_uom: 'KG', silo_capacity_kg: 12000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: 2400,
    } as any, 'tenant-1')).rejects.toThrow('A silo needs both a Below Feed Level and an Above Threshold.');
    expect(txInsert).not.toHaveBeenCalled();
  });

  it('refuses saving a silo that still has no levels, whatever else the edit changes (D22)', async () => {
    const silo = {
      location_id: 'silo-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_code: 'FARM-001/SILO-001',
      location_type: 'SILO', location_level: 2, parent_location_id: 'farm-1', farm_id: 'farm-1',
      storage_type: 'SILO', silo_capacity_kg: '12000.00', silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: null, high_level_kg: null,
    };
    selectResults.push([silo], [siloType], [farmParent()], [{ parent_location_id: null }]);
    await expect(service.update('silo-1', { location_name: 'Feed Silo 1b' }, 'tenant-1'))
      .rejects.toThrow('A silo needs both a Below Feed Level and an Above Threshold.');
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('does not require levels on a pen that carries a legacy SILO storage type (Review Focus 1)', async () => {
    const pen = {
      location_id: 'pen-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_code: 'FARM-001/SHED-001/PEN-001',
      location_type: 'PEN', location_level: 3, parent_location_id: 'shed-1', farm_id: 'farm-1',
      storage_type: 'SILO', silo_capacity_kg: null, silo_capacity_uom: null, silo_reorder_days: null,
      low_level_kg: null, high_level_kg: null,
    };
    selectResults.push([pen], [{ ...siloType, type_code: 'PEN', type_name: 'Pen', code_prefix: 'PEN' }], [farmParent()], [{ parent_location_id: null }]);
    const outcome = await service.update('pen-1', { location_name: 'Pen 1b' }, 'tenant-1').then(() => null, (e: Error) => e);
    expect(outcome?.message ?? '').not.toContain('Below Feed Level');
  });
```

- [ ] **Step 2: Run them and see the first two fail**

Run: `pnpm nx test api -- --testPathPatterns=location 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: the two D22 tests FAIL (no error thrown). The pen test passes before and after.

- [ ] **Step 3: Implement.** In `location.service.ts`, replace `assertSiloLevels`:

```ts
  /**
   * Master Setup §1 rows 10 and 12. D22 (Rishi, 27 Sep; supersedes Plan B's
   * optional levels): a SILO must carry both, because the forecast's run-down
   * and the FEED_BELOW_L1 / FEED_ABOVE alerts read them and a silo without
   * them was silently never alerted on. `required` is decided by the caller
   * from location_type, never from storage_type: 248 legacy pens and sheds
   * carry storage_type SILO and must stay editable without levels.
   */
  private assertSiloLevels(lowKg: number | null | undefined, highKg: number | null | undefined, capacityKg: number | null, required = false) {
    if (required && (lowKg == null || highKg == null)) {
      throw new BadRequestException('A silo needs both a Below Feed Level and an Above Threshold.');
    }
    if (lowKg != null && highKg != null && lowKg >= highKg) {
      throw new ConflictException('The low feed level must be below the high feed level.');
    }
    if (capacityKg != null) {
      if (highKg != null && highKg > capacityKg) throw new ConflictException('The high feed level cannot exceed the silo capacity.');
      if (lowKg != null && lowKg > capacityKg) throw new ConflictException('The low feed level cannot exceed the silo capacity.');
    }
  }
```

In `create` (the `if (dto.storage_type === 'SILO') { … }` block):

```ts
      this.assertSiloLevels(dto.low_level_kg, dto.high_level_kg, capacityKg == null ? null : Number(capacityKg), typeCode === 'SILO');
```

In `update` (inside `if (effectiveStorage === 'SILO') { … }`):

```ts
      this.assertSiloLevels(effectiveLow, effectiveHigh, effectiveCapacity == null ? null : Number(effectiveCapacity), location.location_type === 'SILO');
```

In `dto/location.dto.ts`, change both `low_level_kg` descriptions to `'SILO: low feed alert when System Balance is at or below this many KG. Required on a silo (D22).'` and both `high_level_kg` descriptions to `'SILO: over-stock notice when System Balance is at or above this many KG (typically 90% of capacity). Required on a silo (D22).'`.

Every existing silo test now needs levels. In `location.service.spec.ts`, add `low_level_kg: 200, high_level_kg: 1800,` to each `service.create({ … location_type: 'SILO' …` payload that has no level yet: the payloads at ~:251, :263, :281, :343, :376, :396, :413, :427, :441. Add `low_level_kg: '200.00', high_level_kg: '1800.00',` to the two silo rows used by the update tests at ~:460 and ~:480. Leave the payloads at ~:587, :600, :611 and the row at ~:626 as they are: they already carry levels.

In `apps/web/src/modules/master-data/configs.ts`, replace the two field definitions and the comment above them:

```ts
    // Master Setup §1 rows 10 and 12 (spec D10) — alongside Silo Reorder
    // Days, not replacing it. Required on a silo since D22 (Rishi, 27 Sep):
    // the forecast's run-down and the feed alerts read them.
    { key: "low_level_kg", label: "Below Feed Level (KG)", type: "number", min: 0, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "location_type", equals: "SILO" }] },
      requiredWhen: { anyOf: [{ key: "location_type", equals: "SILO" }] }, section: "Identification",
      helpText: "Low feed alert at or below this. Usually 20% of capacity." },
    { key: "high_level_kg", label: "Above Threshold (KG)", type: "number", min: 0, step: "1", nativeNumber: true,
      visibleWhen: { anyOf: [{ key: "location_type", equals: "SILO" }] },
      requiredWhen: { anyOf: [{ key: "location_type", equals: "SILO" }] }, section: "Identification",
      helpText: "Over-stock notice at or above this. Usually 90% of capacity." },
```

The `visibleWhen` also moves from `storage_type` to `location_type`, for the same reason as the API.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm nx test api -- --testPathPatterns=location 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no `error TS`.

- [ ] **Step 5: Prove it on the running API** (rebuild and restart as in Task 1 Step 5). Let `$S` be a VIL100 silo id with both levels NULL: `SELECT location_id FROM location_master WHERE location_code='VIL100/SILO-007'`. As tenant.admin, `PUT /api/v1/location/$S` with `{"location_name":"VIL100 Feed Silo 7"}` → 400 with the D22 message. Then `PUT` with `{"low_level_kg":1200,"high_level_kg":5400}` → 200, and `SELECT low_level_kg, high_level_kg FROM location_master WHERE location_id='$S'` → 1200.00 / 5400.00. Leave these values in place: they are exactly what Task 20's D22 migration writes for a 6,000 kg silo (20 % / 90 %), so the local database ends in the state the migration would have produced. Record the silo code in the ledger line. Stop the API by PID.

- [ ] **Step 6: Commit and write the ledger line**

```bash
git commit -m "feat(location): require both feed levels on a silo (D22, review A13)

Below Feed Level and Above Threshold were optional (Plan B Q8), so a silo
without them was never alerted on and ran down to zero in the forecast.
Rishi decided on 27 Sep that both are required on create and update; the
check keys on location_type SILO, not storage_type, because 248 legacy pens
and sheds carry storage_type SILO and must stay editable.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/modules/master-data/location/location.service.ts apps/api/src/modules/master-data/location/dto/location.dto.ts apps/api/src/modules/master-data/location/location.service.spec.ts apps/web/src/modules/master-data/configs.ts
```

---

### Task 5: A12 / D21 — set or change a batch's shed

**Files:**
- Modify: `apps/api/src/modules/production/batch/dto/batch.dto.ts` (new `UpdateBatchShedDto` at the end of the file)
- Modify: `apps/api/src/modules/production/batch/batch.service.ts` (new `changeShed` method after `update`)
- Modify: `apps/api/src/modules/production/batch/batch.controller.ts` (new `PATCH :id/shed` after `@Put(':id')`; add `Patch` to the `@nestjs/common` import and `UpdateBatchShedDto` to the dto import)
- Create: `apps/api/src/modules/production/batch/batch-shed.spec.ts`
- Create: `apps/web/src/components/console/production/batch-shed-field.tsx`
- Create: `apps/web/specs/batch-shed-field.spec.tsx`
- Modify: `apps/web/src/components/console/production/batch-panel.tsx` (one import, one element in the batch detail drawer)
- Modify: `apps/web/src/utils/translations.ts` (en: 4 new keys)

**Interfaces:**
- Produces: `PATCH /api/v1/batch/:id/shed` with body `{ shed_id: string | null }`, under `PRODUCTION/BATCH edit`. It answers `{ success, message, data: { batch_id, shed_id, farm_id } }`.
- Produces: `BatchService.changeShed(id: string, shedId: string | null, tenantId: string, userPayload?: UserContext): Promise<{ batch_id: string; shed_id: string | null; farm_id: string | null }>`
- Produces (web): `export function BatchShedField(props: { batch: { batch_id: string; status: string; shed_id: string | null; farm_id: string | null }; sheds: Array<{ shed_id: string; shed_code: string; shed_name: string; farm_id: string | null; is_active?: boolean }>; onSaved: (shedId: string | null) => void })`

Batch create already offers a shed (`batch-panel.tsx` ~:1756, `CreateBatchDto.shed_id`). Edit is DRAFT-only (`PUT /batch/:id`), and nearly every batch is ACTIVE. So D21's "batch create/edit must let the user set the shed" needs a shed-only change that works on an ACTIVE batch.

- [ ] **Step 1: Write the failing API test**

```ts
// apps/api/src/modules/production/batch/batch-shed.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { BatchService } from './batch.service';

/**
 * D21 (Rishi, 27 Sep): a batch with no shed has its feed drawn from the farm
 * store in the forecast, and only a user can say which shed it really stands
 * in when the data cannot. The shed must be settable on an ACTIVE batch —
 * the only edit path (PUT) is DRAFT-only.
 */
describe('BatchService.changeShed (D21, review A12)', () => {
  function harness(queue: unknown[][]) {
    const updates: Array<{ table: unknown; set: any }> = [];
    const db: any = {
      select: jest.fn(() => {
        const self: any = { from: () => self, where: () => self, limit: async () => queue.shift() ?? [] };
        return self;
      }),
      update: jest.fn((table: unknown) => ({ set: (set: any) => ({ where: async () => { updates.push({ table, set }); } }) })),
    };
    const cls = transactionCls(db);
    const audit = { log: jest.fn(async () => ({})) };
    const service = new BatchService(cls, audit as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, updates, audit, cls };
  }
  const batch = { batch_id: 'b1', batch_no: 'BATCH-000012', status: 'ACTIVE', company_id: 'co-1', lob_id: 'lob-pig', farm_id: 'farm-vil', shed_id: null };
  const shed = { location_id: 'shed-3', location_type: 'SHED', company_id: 'co-1', farm_id: 'farm-vil', parent_location_id: 'farm-vil', is_active: true, deleted_at: null };

  it('sets the shed of an ACTIVE batch and records the change', async () => {
    const { service, updates, audit } = harness([[batch], [shed]]);
    await expect(service.changeShed('b1', 'shed-3', 'tenant-1', { userId: 'u1' } as any))
      .resolves.toEqual({ batch_id: 'b1', shed_id: 'shed-3', farm_id: 'farm-vil' });
    expect(updates).toEqual([{ table: schema.batchHeader, set: { shed_id: 'shed-3', farm_id: 'farm-vil', updated_by: 'u1' } }]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', entityName: 'batch_header', entityId: 'b1', oldValues: { shed_id: null }, newValues: { shed_id: 'shed-3' },
    }));
  });

  it('takes the farm from the shed when the batch has none yet', async () => {
    const { service, updates } = harness([[{ ...batch, farm_id: null }], [shed]]);
    await service.changeShed('b1', 'shed-3', 'tenant-1');
    expect(updates[0].set).toMatchObject({ farm_id: 'farm-vil' });
  });

  it('clears the shed', async () => {
    const { service, updates } = harness([[{ ...batch, shed_id: 'shed-3' }]]);
    await service.changeShed('b1', null, 'tenant-1');
    expect(updates[0].set).toMatchObject({ shed_id: null, farm_id: 'farm-vil' });
  });

  it('refuses a shed on another farm, a pen, and a closed batch, writing nothing', async () => {
    for (const [queue, message] of [
      [[[batch], [{ ...shed, farm_id: 'farm-lex', parent_location_id: 'farm-lex' }]], 'That shed is on another farm.'],
      [[[batch], [{ ...shed, location_type: 'PEN' }]], 'Choose an active shed.'],
      [[[batch], [{ ...shed, company_id: 'co-2' }]], 'That shed belongs to another company.'],
      [[[{ ...batch, status: 'CLOSED' }]], 'BATCH-000012 is closed; its shed can no longer be changed.'],
    ] as const) {
      const { service, updates } = harness(queue.map((q) => [...q]));
      await expect(service.changeShed('b1', 'shed-3', 'tenant-1')).rejects.toThrow(new BadRequestException(message));
      expect(updates).toEqual([]);
    }
  });

  it('answers not found for a batch outside the caller\'s farm scope', async () => {
    const { service, cls } = harness([[]]);
    useFarmScope(cls, { farmId: 'farm-lex', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await expect(service.changeShed('b1', 'shed-3', 'tenant-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm nx test api -- --testPathPatterns=batch-shed 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: FAIL, because `changeShed` is not a function.

- [ ] **Step 3: Implement the API.** Append to `dto/batch.dto.ts`:

```ts
/** D21: set, change or clear a batch's shed at any status before it closes. */
export class UpdateBatchShedDto {
  @ApiProperty({ description: 'Shed (a SHED location of the batch farm), or null to clear', nullable: true, required: true })
  @IsOptional()
  @IsUUID()
  shed_id: string | null;
}
```

Add to `batch.service.ts`, directly after the `update(...)` method:

```ts
  /**
   * D21 (Rishi, 27 Sep): the shed a batch stands in, set or changed at any
   * status short of CLOSED/CANCELLED. The full edit (update) is DRAFT-only,
   * and nearly every batch is ACTIVE by the time anyone notices it has no
   * shed — the feed forecast then draws its feed from the farm store. The
   * shed must be an active SHED of the batch's company and farm; a batch with
   * no farm yet takes the shed's. Read scoped like every batch read here, so
   * a batch outside the caller's farm/LOB is not found.
   */
  async changeShed(id: string, shedId: string | null, tenantId: string, userPayload?: UserContext) {
    const [batch] = await this.db
      .select({
        batch_id: schema.batchHeader.batch_id,
        batch_no: schema.batchHeader.batch_no,
        status: schema.batchHeader.status,
        company_id: schema.batchHeader.company_id,
        farm_id: schema.batchHeader.farm_id,
        shed_id: schema.batchHeader.shed_id,
      })
      .from(schema.batchHeader)
      .where(and(
        eq(schema.batchHeader.batch_id, id),
        eq(schema.batchHeader.tenant_id, tenantId),
        isNull(schema.batchHeader.deleted_at),
        ...batchScopeConditions(farmScope(this.cls)),
      ))
      .limit(1);
    if (!batch) throw new NotFoundException(`Batch with ID '${id}' not found.`);
    if (batch.status === 'CLOSED' || batch.status === 'CANCELLED') {
      throw new BadRequestException(`${batch.batch_no} is ${batch.status.toLowerCase()}; its shed can no longer be changed.`);
    }
    let farmId = batch.farm_id;
    if (shedId) {
      const [shed] = await this.db
        .select({
          location_id: schema.locationMaster.location_id,
          location_type: schema.locationMaster.location_type,
          company_id: schema.locationMaster.company_id,
          farm_id: schema.locationMaster.farm_id,
          parent_location_id: schema.locationMaster.parent_location_id,
          is_active: schema.locationMaster.is_active,
          deleted_at: schema.locationMaster.deleted_at,
        })
        .from(schema.locationMaster)
        .where(and(eq(schema.locationMaster.location_id, shedId), eq(schema.locationMaster.tenant_id, tenantId)))
        .limit(1);
      if (!shed || shed.location_type !== 'SHED' || !shed.is_active || shed.deleted_at) {
        throw new BadRequestException('Choose an active shed.');
      }
      if (shed.company_id !== batch.company_id) throw new BadRequestException('That shed belongs to another company.');
      const shedFarm = shed.farm_id ?? shed.parent_location_id;
      if (batch.farm_id && shedFarm !== batch.farm_id) throw new BadRequestException('That shed is on another farm.');
      await assertLocationOnActiveFarm(this.db, farmScope(this.cls), shedId, 'Batch shed');
      farmId = batch.farm_id ?? shedFarm;
    }
    await this.db
      .update(schema.batchHeader)
      .set({ shed_id: shedId, farm_id: farmId, updated_by: userPayload?.userId ?? null })
      .where(eq(schema.batchHeader.batch_id, id));
    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'batch_header',
      entityId: id,
      oldValues: { shed_id: batch.shed_id },
      newValues: { shed_id: shedId },
    });
    return { batch_id: id, shed_id: shedId, farm_id: farmId };
  }
```

In `batch.controller.ts`, add `Patch,` to the `@nestjs/common` import list and `UpdateBatchShedDto,` to the `./dto/batch.dto` import list. Then add after the `@Put(':id')` handler:

```ts
  @Patch(':id/shed')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({ summary: "Set or change a batch's shed at any status before it closes (D21)" })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async changeShed(@Param('id') id: string, @Body() dto: UpdateBatchShedDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchService.changeShed(id, dto.shed_id ?? null, tenantId, req.user);
    return { success: true, message: 'Batch shed saved.', data };
  }
```

- [ ] **Step 4: Run the API tests**

Run: `pnpm nx test api -- --testPathPatterns=batch 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: all pass.

- [ ] **Step 5: Write the failing web test**

```tsx
// apps/web/specs/batch-shed-field.spec.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BatchShedField } from '../src/components/console/production/batch-shed-field';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { patch: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const patch = api.patch as jest.Mock;
const sheds = [
  { shed_id: 's1', shed_code: 'VIL100/SHED-001', shed_name: 'Gilt House', farm_id: 'farm-vil', is_active: true },
  { shed_id: 's2', shed_code: 'VIL100/SHED-002', shed_name: 'Dry Sow House', farm_id: 'farm-vil', is_active: true },
  { shed_id: 'x1', shed_code: 'LEX100/SHED-001', shed_name: 'Weaner House', farm_id: 'farm-lex', is_active: true },
];

describe('BatchShedField (D21)', () => {
  beforeEach(() => patch.mockReset());

  it('offers the sheds of the batch farm only and saves a new choice', async () => {
    patch.mockResolvedValue({ data: { batch_id: 'b1', shed_id: 's2', farm_id: 'farm-vil' } });
    const onSaved = jest.fn();
    render(<BatchShedField batch={{ batch_id: 'b1', status: 'ACTIVE', shed_id: null, farm_id: 'farm-vil' }} sheds={sheds} onSaved={onSaved} />);
    const select = screen.getByLabelText('blShed') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['blNoShed', 'VIL100/SHED-001 — Gilt House', 'VIL100/SHED-002 — Dry Sow House']);
    const save = screen.getByRole('button', { name: 'blSaveShed' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 's2' } });
    fireEvent.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/batch/b1/shed', { shed_id: 's2' }));
    expect(onSaved).toHaveBeenCalledWith('s2');
  });

  it('shows the API refusal and keeps the choice', async () => {
    patch.mockRejectedValue({ message: 'That shed is on another farm.' });
    render(<BatchShedField batch={{ batch_id: 'b1', status: 'ACTIVE', shed_id: null, farm_id: 'farm-vil' }} sheds={sheds} onSaved={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('blShed'), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: 'blSaveShed' }));
    expect(await screen.findByText('That shed is on another farm.')).toBeTruthy();
  });

  it('is read-only on a closed batch', () => {
    render(<BatchShedField batch={{ batch_id: 'b1', status: 'CLOSED', shed_id: 's1', farm_id: 'farm-vil' }} sheds={sheds} onSaved={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'blSaveShed' })).toBeNull();
    expect(screen.getByText('VIL100/SHED-001 — Gilt House')).toBeTruthy();
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns=batch-shed-field 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL (module missing).

- [ ] **Step 6: Implement the web part**

```tsx
// apps/web/src/components/console/production/batch-shed-field.tsx
"use client";

/**
 * The shed a batch stands in, changeable after the batch is active (D21,
 * review A12). The feed forecast draws a batch's feed from the silos of its
 * shed; a batch with no shed is fed from the farm store. Offers only the
 * sheds of the batch's own farm, since the API refuses any other.
 */
import { useState } from "react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/useLanguage";

interface ShedOption { shed_id: string; shed_code: string; shed_name: string; farm_id: string | null; is_active?: boolean }

export function BatchShedField({
  batch,
  sheds,
  onSaved,
}: {
  batch: { batch_id: string; status: string; shed_id: string | null; farm_id: string | null };
  sheds: ShedOption[];
  onSaved: (shedId: string | null) => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(batch.shed_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = (Array.isArray(sheds) ? sheds : [])
    .filter((s) => s.is_active !== false && (!batch.farm_id || s.farm_id === batch.farm_id))
    .sort((a, b) => a.shed_code.localeCompare(b.shed_code));
  const label = (id: string | null) => {
    const s = options.find((o) => o.shed_id === id) ?? sheds.find((o) => o.shed_id === id);
    return s ? `${s.shed_code} — ${s.shed_name}` : t("blNoShed");
  };
  const closed = batch.status === "CLOSED" || batch.status === "CANCELLED";

  if (closed) {
    return (
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("blShed")}</p>
        <p className="mt-0.5 font-semibold" style={{ color: "var(--text-primary)" }}>{label(batch.shed_id)}</p>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.patch(`/batch/${batch.batch_id}/shed`, { shed_id: value || null });
      onSaved(value || null);
    } catch (err: any) {
      setError(err?.message || t("blShedSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label htmlFor={`shed-${batch.batch_id}`} className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {t("blShed")}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <select
          id={`shed-${batch.batch_id}`}
          className="nf-input-sm nf-select min-w-0 flex-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" }}
        >
          <option value="">{t("blNoShed")}</option>
          {options.map((s) => (
            <option key={s.shed_id} value={s.shed_id}>{`${s.shed_code} — ${s.shed_name}`}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={save} disabled={saving || value === (batch.shed_id ?? "")}>
          {t("blSaveShed")}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
```

In `batch-panel.tsx`, add `import { BatchShedField } from '@/components/console/production/batch-shed-field';` after the `BatchPerformanceCurvesPanel` import. In the detail drawer, directly before the line `{viewing.current_stage_code && (` (~:2633), insert:

```tsx
              <BatchShedField
                key={`${viewing.batch_id}|${viewing.shed_id ?? ''}`}
                batch={{ batch_id: viewing.batch_id, status: viewing.status, shed_id: viewing.shed_id ?? null, farm_id: viewing.farm_id ?? null }}
                sheds={sheds as any}
                onSaved={(shedId) => setViewing((v) => (v ? { ...v, shed_id: shedId } : v))}
              />
```

In `translations.ts`, add to the `en` object directly after `blLabelShedColon: "Shed:",`:

```ts
    blShed: "Shed",
    blNoShed: "No shed",
    blSaveShed: "Save shed",
    blShedSaveFailed: "The shed could not be saved.",
```

- [ ] **Step 7: Run the web test, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns=batch-shed-field 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → the error count is 94 or lower.

- [ ] **Step 8: Prove it on MySQL** (rebuild and restart the API as in Task 1). Let `$B` be `SELECT batch_id FROM batch_header WHERE shed_id IS NULL AND status='ACTIVE' LIMIT 1` and `$SH` an active SHED on that batch's farm. `PATCH /api/v1/batch/$B/shed {"shed_id":"$SH"}` → 200. `SELECT shed_id, farm_id FROM batch_header WHERE batch_id='$B'` shows `$SH`. `SELECT action, entity_id FROM audit_log WHERE entity_id='$B' ORDER BY created_at DESC LIMIT 1` → UPDATE. Then `PATCH … {"shed_id":null}` → 200 and `shed_id` is NULL again. Stop the API by PID.

- [ ] **Step 9: Commit and write the ledger line**

```bash
git commit -m "feat(batch): set or change a batch's shed after activation (D21, review A12)

Batch create offered a shed, but edit was DRAFT-only, and nearly every batch
is ACTIVE by the time anyone sees 'no shed on record' on the forecast. A
shed-only PATCH /batch/:id/shed now works at any status before CLOSED (an
active SHED of the batch's company and farm), with an audit row, and the
batch drawer offers it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/modules/production/batch/dto/batch.dto.ts apps/api/src/modules/production/batch/batch.service.ts apps/api/src/modules/production/batch/batch.controller.ts apps/api/src/modules/production/batch/batch-shed.spec.ts apps/web/src/components/console/production/batch-shed-field.tsx apps/web/specs/batch-shed-field.spec.tsx apps/web/src/components/console/production/batch-panel.tsx apps/web/src/utils/translations.ts
```

---

### Task 6: D25 (engine) — farm-level documents in the approval engine

**Files:**
- Create: `apps/api/src/drizzle/tenant/0122_approval_request_farm_document.sql`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json` (entry idx 122)
- Modify: `apps/api/src/core/database/schema.ts` (`approvalRequest`: two columns, two indexes)
- Modify: `apps/api/src/modules/production/approval/approval.service.ts`
- Modify: `apps/api/src/modules/production/approval/dto/approval.dto.ts` (new `ApproveApprovalDto`)
- Modify: `apps/api/src/modules/production/approval/approval.controller.ts` (`approve` takes an optional body)
- Modify: `apps/api/src/modules/production/approval/approval.service.spec.ts`

**Interfaces:**
- Produces: `approval_request.farm_id varchar(36) NULL` and `approval_request.document_id varchar(36) NULL`. `listShape()` returns both.
- Produces: `export type ApprovalRequestRow = typeof schema.approvalRequest.$inferSelect;`
- Produces: `export interface ApprovalDocumentHandler { decide(request: ApprovalRequestRow, decision: 'APPROVED' | 'REJECTED', remarks: string | null, tenantId: string, user: any): Promise<void>; withdraw(request: ApprovalRequestRow, tenantId: string, user: any): Promise<void>; afterDecide?(request: ApprovalRequestRow, tenantId: string): Promise<void>; }`
- Produces: `ApprovalService.registerDocumentHandler(docType: string, handler: ApprovalDocumentHandler): void`
- Produces: `ApprovalService.submitFarmDocument(doc: { documentType: string; documentId: string; documentNo: string; farmId: string; companyId: string; title: string; urgency?: 'HIGH' | 'MEDIUM' | 'LOW'; itemOrStage?: string | null; requestedQty?: string | null; uom?: string | null; justification?: string | null }, tenantId: string, userPayload?: any): Promise<string>`. It returns the new PENDING request id.
- Changes: `ApprovalService.approve(requestId: string, tenantId: string, userPayload?: any, remarks?: string)`. `POST /approval/:id/approve` accepts `{ remarks?: string }`.
- Keeps: `decideFarmDocument` stays in this task. Task 7 removes it with its last caller.

Visibility rule (the old rule is kept exactly for batch rows and for batchless, farmless rows):

| row | who sees it |
|---|---|
| has `batch_id` | as before: `batchReferenceScopeConditions` |
| no batch, has `farm_id` (new) | `locationReferenceScopeConditions(scope, farm_id)`: a pinned farm sees its own, a company admin the company's, a restricted user their LOB's |
| neither | as before: only a caller with no farm, no company and no restriction (the old `batch_id IN (…)` was never true for a NULL batch otherwise) |

The selected company (`restrictedScopeConditions` on `company_id`) still applies to every row.

- [ ] **Step 1: Write the failing tests.** In `approval.service.spec.ts`, add inside `describe('ApprovalService farm scope', …)`:

```ts
  it('shows a farm user their own farm\'s documents that have no batch (D25)', async () => {
    useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });

    await service.findAll({} as any, 'tenant-1');

    const where = dialect.sqlToQuery(capturedWhere as any);
    expect(where.sql).toContain('`approval_request`.`farm_id` IN (SELECT lf.location_id FROM location_master lf WHERE lf.location_id = ? OR lf.farm_id = ?)');
    expect(where.params).toContain('farm-g');
    // The batch path is unchanged.
    expect(where.sql).toContain('batch_header bf');
  });

  it('shows a company admin the company\'s farm documents, but still not batchless farmless rows', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-1', lobId: null });

    await service.findAll({} as any, 'tenant-1');

    const where = renderedWhere();
    expect(where).toContain('`approval_request`.`farm_id` IN (SELECT ls.location_id FROM location_master ls WHERE ls.company_id = ?)');
    expect(where).not.toContain('`approval_request`.`farm_id` is null');
  });

  it('shows a tenant admin with nothing selected every row, farmless ones included', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });

    await service.findAll({} as any, 'tenant-1');

    expect(renderedWhere()).toContain('`approval_request`.`farm_id` is null');
  });
```

Append a new block at the end of the file:

```ts
/**
 * D25: a farm-level document (a feed requisition) is submitted into this
 * engine and decided in the inbox; the document's own module decides what
 * approval, rejection and withdrawal mean for it (ApprovalDocumentHandler).
 */
describe('ApprovalService farm documents (D25)', () => {
  interface Entry { op: string; table: unknown; values?: any; set?: any; inTx: boolean }
  function setup(queues: Map<unknown, unknown[][]>) {
    const log: Entry[] = [];
    const ref = {} as { cls: ReturnType<typeof transactionCls> };
    const inTx = () => ref.cls.get('tenantPostingTransaction') === true;
    const db: any = {
      select: jest.fn(() => {
        const entry = { table: undefined as unknown };
        const self: any = {
          from: (t: unknown) => { entry.table = t; return self; },
          leftJoin: () => self, where: () => self, orderBy: () => self, limit: () => self, for: () => self,
          then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
        };
        return self;
      }),
      insert: jest.fn((t: unknown) => ({ values: jest.fn(async (v: unknown) => { log.push({ op: 'insert', table: t, values: v, inTx: inTx() }); }) })),
      update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async () => { log.push({ op: 'update', table: t, set: v, inTx: inTx() }); } }) })),
    };
    const cls = (ref.cls = transactionCls(db));
    const service = new ApprovalService(cls, new AuditLogService(cls), {} as any);
    return { service, log, cls };
  }
  const PENDING = {
    request_id: 'ar-1', tenant_id: 'tenant-1', company_id: 'co-1', doc_type: 'FEED_REQUISITION', doc_no: 'REQ-VIL100-2026-00004',
    status: 'PENDING', batch_id: null, farm_id: 'farm-vil', document_id: 'req-4', deleted_at: null,
  };

  it('submits a farm document as a PENDING request carrying its farm and document', async () => {
    const { service, log } = setup(new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[{ code: 'VIL100', name: 'Villa Franca' }]]],
      [schema.approvalRequest, [[]]],
    ]));
    const id = await service.submitFarmDocument({
      documentType: 'FEED_REQUISITION', documentId: 'req-4', documentNo: 'REQ-VIL100-2026-00004', farmId: 'farm-vil', companyId: 'co-1',
      title: 'Feed requisition REQ-VIL100-2026-00004', urgency: 'HIGH', itemOrStage: 'Feed', requestedQty: '9,000', uom: 'KG', justification: null,
    }, 'tenant-1', { userId: 'u-farm', userType: 'STANDARD_USER', email: 'farm@x' });
    const insert = log.find((e) => e.op === 'insert' && e.table === schema.approvalRequest)!;
    expect(insert.values).toMatchObject({
      request_id: id, company_id: 'co-1', doc_type: 'FEED_REQUISITION', doc_no: 'REQ-VIL100-2026-00004', status: 'PENDING',
      farm_id: 'farm-vil', document_id: 'req-4', location_label: 'VIL100 — Villa Franca', requested_qty: '9,000', uom: 'KG', urgency: 'HIGH',
    });
    expect(insert.values.batch_id).toBeUndefined();
    expect(log.filter((e) => e.op === 'insert' && e.table === schema.auditLog).map((e) => e.values.action)).toEqual(['CREATE']);
    expect(log.every((e) => e.inTx)).toBe(true);
  });

  it('refuses a second open request for the same document', async () => {
    const { service, log } = setup(new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[{ code: 'VIL100', name: 'Villa Franca' }]]],
      [schema.approvalRequest, [[{ request_id: 'ar-1' }]]],
    ]));
    await expect(service.submitFarmDocument({
      documentType: 'FEED_REQUISITION', documentId: 'req-4', documentNo: 'REQ-VIL100-2026-00004', farmId: 'farm-vil', companyId: 'co-1', title: 't',
    }, 'tenant-1')).rejects.toThrow('REQ-VIL100-2026-00004 is already waiting for approval.');
    expect(log).toEqual([]);
  });

  it('lets the document\'s handler decide inside the transaction, then runs afterDecide once committed', async () => {
    const { service, log, cls } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[PENDING], [{ ...PENDING, status: 'APPROVED' }]]]]));
    const seen: Array<{ step: string; inTx: boolean; args?: unknown[] }> = [];
    service.registerDocumentHandler('FEED_REQUISITION', {
      decide: async (...args) => { seen.push({ step: 'decide', inTx: cls.get('tenantPostingTransaction') === true, args }); },
      withdraw: async () => undefined,
      afterDecide: async () => { seen.push({ step: 'after', inTx: cls.get('tenantPostingTransaction') === true }); },
    });
    await service.approve('ar-1', 'tenant-1', { userId: 'u-mgr' }, 'Extra pigs arriving');
    expect(seen.map((s) => [s.step, s.inTx])).toEqual([['decide', true], ['after', false]]);
    expect(seen[0].args!.slice(1, 4)).toEqual(['APPROVED', 'Extra pigs arriving', 'tenant-1']);
    expect(log.find((e) => e.op === 'update' && e.table === schema.approvalRequest)!.set).toMatchObject({ status: 'APPROVED', rejection_reason: null });
  });

  it('writes nothing when the handler refuses the decision', async () => {
    const { service, log } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[PENDING]]]]));
    const after = jest.fn();
    service.registerDocumentHandler('FEED_REQUISITION', {
      decide: async () => { throw new BadRequestException('Add remarks to explain.'); },
      withdraw: async () => undefined,
      afterDecide: after,
    });
    await expect(service.approve('ar-1', 'tenant-1', { userId: 'u-mgr' })).rejects.toThrow('Add remarks to explain.');
    expect(log.filter((e) => e.table === schema.approvalRequest)).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('passes the rejection reason, and a withdrawal, to the handler', async () => {
    const { service } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[PENDING], [PENDING], [PENDING]]]]));
    const handler = { decide: jest.fn(async () => undefined), withdraw: jest.fn(async () => undefined) };
    service.registerDocumentHandler('FEED_REQUISITION', handler);
    await service.reject('ar-1', { rejection_reason: 'Silo being cleaned' }, 'tenant-1', { userId: 'u-mgr' });
    expect(handler.decide).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'ar-1' }), 'REJECTED', 'Silo being cleaned', 'tenant-1', { userId: 'u-mgr' });
    await service.remove('ar-1', 'tenant-1', { userId: 'u-farm' });
    expect(handler.withdraw).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'ar-1' }), 'tenant-1', { userId: 'u-farm' });
  });

  it('refuses to decide a document request no module handles', async () => {
    const { service, log } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[PENDING]]]]));
    await expect(service.approve('ar-1', 'tenant-1')).rejects.toThrow('No handler is registered for FEED_REQUISITION documents.');
    expect(log).toEqual([]);
  });
});
```

Add `BadRequestException` to the file's `@nestjs/common` import.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm nx test api -- --testPathPatterns=approval 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: FAIL (`farm_id` not on the table, `submitFarmDocument` / `registerDocumentHandler` missing).

- [ ] **Step 3: Migration and schema.** Create `apps/api/src/drizzle/tenant/0122_approval_request_farm_document.sql`:

```sql
-- D25 (Rishi, 27 Sep): feed requisitions are approved in the Approvals inbox,
-- by the farm's own approvers, farm-level users included. The engine reached
-- a farm only through batch_id, and a requisition has a farm but no batch, so
-- the inbox hid it from every restricted user (Plan B's Ruling C1 worked
-- round that by deciding in one step outside the inbox). farm_id scopes a
-- farm-level document; document_id names the document the request decides.
-- The UPDATE carries the two onto the requisitions Plan B already recorded,
-- only where both are still empty, so a re-run changes nothing.
ALTER TABLE `approval_request` ADD `farm_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `approval_request` ADD `document_id` varchar(36);
--> statement-breakpoint
CREATE INDEX `idx_approval_request_farm` ON `approval_request` (`farm_id`);
--> statement-breakpoint
CREATE INDEX `idx_approval_request_document` ON `approval_request` (`doc_type`,`document_id`);
--> statement-breakpoint
UPDATE `approval_request` ar
JOIN `requisition` r ON r.`approval_request_id` = ar.`request_id`
SET ar.`farm_id` = r.`farm_id`, ar.`document_id` = r.`requisition_id`
WHERE ar.`doc_type` = 'FEED_REQUISITION' AND ar.`farm_id` IS NULL AND ar.`document_id` IS NULL;
```

Append to `meta/_journal.json`'s `entries` array, after the idx 121 object:

```json
    {
      "idx": 122,
      "version": "5",
      "when": 1791222000000,
      "tag": "0122_approval_request_farm_document",
      "breakpoints": true
    }
```

In `schema.ts`, in `approvalRequest`, directly after the `batch_id: …` line:

```ts
  // D25 (Rishi, 27 Sep): a farm-level document (a feed requisition) has a farm
  // but no batch; the inbox scopes it by this farm (0122). document_id names
  // the document the request decides, so the decision can update it.
  farm_id: varchar('farm_id', { length: 36 }),
  document_id: varchar('document_id', { length: 36 }),
```

and in its table-config callback, after `areaFk: …,`:

```ts
  farmIdx: index('idx_approval_request_farm').on(table.farm_id),
  documentIdx: index('idx_approval_request_document').on(table.doc_type, table.document_id),
```

- [ ] **Step 4: Engine.** In `approval.service.ts`:

Change the imports:

```ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { eq, and, or, isNull, gte, lte, desc, like, sql, SQL, inArray } from 'drizzle-orm';
…
import { assertCompanyInScope, batchReferenceScopeConditions, batchScopeConditions, farmScope, locationReferenceScopeConditions, restrictedScopeConditions } from '../../../common/farm-scope';
```

Add above `@Injectable()`:

```ts
/** An approval_request row as the document handlers receive it. */
export type ApprovalRequestRow = typeof schema.approvalRequest.$inferSelect;

/**
 * D25: what a farm-level document type (today FEED_REQUISITION) does when its
 * approval request is decided or withdrawn. The document's own module
 * registers it (FeedRequisitionService.onModuleInit), so this engine never
 * imports the documents it serves — the requisition module already imports
 * this one.
 */
export interface ApprovalDocumentHandler {
  /**
   * Inside the decision's transaction, after the request is locked and found
   * PENDING and before it is marked decided. Throwing refuses the decision
   * and nothing is written. `remarks` is the approver's remarks on approval
   * and the reason on rejection.
   */
  decide(request: ApprovalRequestRow, decision: 'APPROVED' | 'REJECTED', remarks: string | null, tenantId: string, user: any): Promise<void>;
  /** Inside the withdrawal's transaction. */
  withdraw(request: ApprovalRequestRow, tenantId: string, user: any): Promise<void>;
  /** After the decision commits (e.g. re-evaluating alerts). Must not throw. */
  afterDecide?(request: ApprovalRequestRow, tenantId: string): Promise<void>;
}
```

Inside the class, after the constructor:

```ts
  private readonly documentHandlers = new Map<string, ApprovalDocumentHandler>();

  /** D25: called once by a document module at start-up. */
  registerDocumentHandler(docType: string, handler: ApprovalDocumentHandler): void {
    this.documentHandlers.set(docType, handler);
  }

  /** A request naming a document must have a handler; deciding it without one would leave the document stranded. */
  private handlerFor(request: ApprovalRequestRow): ApprovalDocumentHandler | undefined {
    if (!request.document_id) return undefined;
    const handler = this.documentHandlers.get(request.doc_type);
    if (!handler) throw new BadRequestException(`No handler is registered for ${request.doc_type} documents.`);
    return handler;
  }
```

Replace `farmConditions()` and its comment:

```ts
  /**
   * Who sees a request. A batch row reaches a farm through its batch, as it
   * always has. D25: a farm-level document (no batch, farm_id set) reaches it
   * through that farm — a farm user sees their own farm's, a company admin the
   * company's, a restricted user their LOB's — which is what lets a farm's own
   * approvers decide a feed requisition here. A row with neither stays visible
   * only to a caller with no farm, company or restriction, exactly as before:
   * the old batch_id IN (…) condition was never true for a NULL batch.
   */
  private farmConditions(): SQL[] {
    const scope = farmScope(this.cls);
    const R = schema.approvalRequest;
    const paths: SQL[] = [
      and(sql`${R.batch_id} IS NOT NULL`, ...batchReferenceScopeConditions(scope, R.batch_id))!,
      and(isNull(R.batch_id), sql`${R.farm_id} IS NOT NULL`, ...locationReferenceScopeConditions(scope, R.farm_id))!,
    ];
    if (!scope.restricted && !scope.farmId && !scope.companyId) {
      paths.push(and(isNull(R.batch_id), isNull(R.farm_id))!);
    }
    return [or(...paths)!, ...restrictedScopeConditions(scope, { companyId: R.company_id })];
  }
```

Change `approve`:

```ts
  async approve(requestId: string, tenantId: string, userPayload?: any, remarks?: string) {
    return this.decide(requestId, 'APPROVED', tenantId, remarks, userPayload);
  }
```

Replace the whole `decide(...)` method. The handler runs inside the transaction and `afterDecide` runs after the commit. Everything else is the existing body:

```ts
  private async decide(requestId: string, status: 'APPROVED' | 'REJECTED', tenantId: string, reason: string | undefined, userPayload?: any, expectedHealthBatchId?: string) {
    // Set inside the transaction, run after it commits (D25): a document's
    // follow-up work, such as re-evaluating feed alerts, must read committed rows.
    const after: { run?: () => Promise<void> } = {};
    const result = await withTenantTransaction(this.cls, async () => {
    // A locking read does not establish a repeatable-read snapshot. Every
    // decision locks the request first; health posting then locks its batch.
    const [current] = await this.db.select().from(schema.approvalRequest)
      .where(and(
        eq(schema.approvalRequest.request_id, requestId),
        eq(schema.approvalRequest.tenant_id, tenantId),
        isNull(schema.approvalRequest.deleted_at),
        ...this.farmConditions(),
      ))
      .for('update');
    if (!current) throw new NotFoundException('Approval request not found.');
    if (expectedHealthBatchId && (current.doc_type !== 'UNSCHEDULED_HEALTH' || current.batch_id !== expectedHealthBatchId)) {
      throw new BadRequestException('That request is not an unscheduled health event on this batch.');
    }
    if (current.status !== 'PENDING') {
      throw new BadRequestException(`This request was already ${current.status.toLowerCase()} and cannot be decided again.`);
    }

    // D25: a farm document's own module decides what the decision means for
    // it, and may refuse it (e.g. a feed requisition that needs remarks).
    const handler = this.handlerFor(current);
    await handler?.decide(current, status, reason?.trim() || null, tenantId, userPayload);
    if (handler?.afterDecide) after.run = () => handler.afterDecide!(current, tenantId);

    if (status === 'APPROVED' && current.doc_type === 'UNSCHEDULED_HEALTH') {
      if (!current.batch_id) throw new BadRequestException('This health request has no batch.');
      const [batch] = await this.db.select().from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.batch_id, current.batch_id), eq(schema.batchHeader.tenant_id, tenantId), isNull(schema.batchHeader.deleted_at)))
        .for('update');
      if (!batch || batch.company_id !== current.company_id) throw new BadRequestException('The health request batch does not belong to its company.');
      await this.postHealthTreatment(current, tenantId, userPayload);
    }

    await this.db
      .update(schema.approvalRequest)
      .set({
        status,
        decided_at: toMysqlTimestamp(),
        decided_by: userPayload?.userId || null,
        decider_label: userPayload?.fullName || userPayload?.email || null,
        rejection_reason: status === 'REJECTED' ? reason || 'Rejected by authorizer.' : null,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.approvalRequest.request_id, requestId));

    await this.auditService.log({
      tenantId,
      companyId: current.company_id,
      userId: userPayload?.userId,
      action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      entityName: 'approval_request',
      entityId: requestId,
      oldValues: { status: 'PENDING' },
      newValues: status === 'APPROVED'
        ? { status, rejection_reason: null, ...(reason ? { remarks: reason } : {}) }
        : { status, rejection_reason: reason || null },
    });

    return this.findOne(requestId, tenantId);
    });
    await after.run?.();
    return result;
  }
```

In `remove(...)`, directly after the `if (current.status !== 'PENDING') { … }` block, add:

```ts
    // D25: a withdrawn farm document goes back to its owner as a draft.
    await this.handlerFor(current)?.withdraw(current, tenantId, userPayload);
```

Add after `decideFarmDocument`:

```ts
  /**
   * D25: a farm-level document (today a feed requisition) submitted for
   * approval. The caller has already proved the farm is the actor's (the
   * requisition resolves its own farm for this user and runs under
   * withFarmScope), so this checks only that the farm is a FARM of that
   * company in this tenant and that the document has no request open. It
   * writes a PENDING row with farm_id and document_id, which is what makes it
   * visible in the inbox to that farm's approvers (farmConditions), and a
   * CREATE audit row carrying the document. Runs inside the caller's
   * transaction when there is one, so the document and its request commit
   * together.
   */
  async submitFarmDocument(
    doc: {
      documentType: string;
      documentId: string;
      documentNo: string;
      farmId: string;
      companyId: string;
      title: string;
      urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
      itemOrStage?: string | null;
      requestedQty?: string | null;
      uom?: string | null;
      justification?: string | null;
    },
    tenantId: string,
    userPayload?: any,
  ): Promise<string> {
    assertCompanyInScope(farmScope(this.cls), doc.companyId);
    return withTenantTransaction(this.cls, async () => {
      const [farm] = await this.db
        .select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.location_id, doc.farmId),
          eq(schema.locationMaster.company_id, doc.companyId),
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.location_type, 'FARM'),
          isNull(schema.locationMaster.deleted_at),
        ))
        .limit(1);
      if (!farm) throw new NotFoundException('Farm not found.');
      const [open] = await this.db
        .select({ request_id: schema.approvalRequest.request_id })
        .from(schema.approvalRequest)
        .where(and(
          eq(schema.approvalRequest.tenant_id, tenantId),
          eq(schema.approvalRequest.doc_type, doc.documentType),
          eq(schema.approvalRequest.document_id, doc.documentId),
          eq(schema.approvalRequest.status, 'PENDING'),
          isNull(schema.approvalRequest.deleted_at),
        ))
        .limit(1);
      if (open) throw new ConflictException(`${doc.documentNo} is already waiting for approval.`);

      const requestId = randomUUID();
      await this.db.insert(schema.approvalRequest).values({
        request_id: requestId,
        tenant_id: tenantId,
        company_id: doc.companyId,
        doc_type: doc.documentType,
        // The document's own number: the inbox then names the requisition, not a second number for it.
        doc_no: doc.documentNo.slice(0, 50),
        title: doc.title.slice(0, 200),
        requested_by: userPayload?.userId || null,
        requestor_label: userPayload?.fullName || userPayload?.email || null,
        requestor_role: (userPayload?.userType || '').replace(/_/g, ' ') || null,
        location_label: `${farm.code} — ${farm.name ?? ''}`.trim().slice(0, 200),
        farm_id: doc.farmId,
        document_id: doc.documentId,
        urgency: doc.urgency || 'MEDIUM',
        item_or_stage: doc.itemOrStage || null,
        requested_qty: doc.requestedQty || null,
        uom: doc.uom || null,
        justification: doc.justification || null,
        status: 'PENDING',
        created_by: userPayload?.userId || null,
      });
      await this.auditService.log({
        tenantId,
        companyId: doc.companyId,
        userId: userPayload?.userId,
        action: 'CREATE',
        entityName: 'approval_request',
        entityId: requestId,
        newValues: { doc_no: doc.documentNo, doc_type: doc.documentType, title: doc.title, document_id: doc.documentId, farm_id: doc.farmId },
      });
      return requestId;
    });
  }
```

In `listShape()`, add after `batch_no: schema.batchHeader.batch_no,`:

```ts
      farm_id: schema.approvalRequest.farm_id,
      document_id: schema.approvalRequest.document_id,
```

In `dto/approval.dto.ts`, add after `DecideApprovalDto`:

```ts
/** D25: an approver's remarks on approval — a feed requisition needs them when it is late or more than 20 % off. */
export class ApproveApprovalDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}
```

In `approval.controller.ts`, import `ApproveApprovalDto` and change the approve handler:

```ts
  @Post(':id/approve')
  @RequirePermission('PRODUCTION', 'APPROVAL', 'approve')
  async approve(@Param('id') id: string, @Body() dto: ApproveApprovalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.approvalService.approve(id, tenantId, req.user, dto?.remarks);
    return { success: true, message: 'Request approved.', data };
  }
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm nx test api -- --testPathPatterns="approval|feed-requisition" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass (the requisition approve spec still passes: `decideFarmDocument` is untouched).
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.

- [ ] **Step 6: Apply the migration locally and read MySQL.** `pnpm nx run api:db-migrate-all-tenants 2>&1 | tail -20`. If the auto-mode classifier refuses it, do not work around it. Record `Ruling (Task 6): migration not applied locally; applied in Task 21's rehearsal instead` and skip to Step 7. If it runs:

```sql
SELECT COUNT(*), MAX(created_at) FROM __drizzle_migrations;                          -- 123, 1791222000000
SHOW COLUMNS FROM approval_request LIKE '%_id';                                      -- farm_id, document_id present
SELECT doc_no, status, farm_id IS NOT NULL f, document_id IS NOT NULL d FROM approval_request WHERE doc_type='FEED_REQUISITION';  -- both rows 1/1
```

- [ ] **Step 7: Commit and write the ledger line**

```bash
git commit -m "feat(approval): scope farm-level documents by farm and let their module decide them (D25)

The approval engine reached a farm only through batch_id, so a feed
requisition (a farm, no batch) was invisible to every farm-level approver
and Plan B had to decide it in one step outside the inbox. approval_request
gains farm_id and document_id (0122, back-filled for Plan B's requisitions);
the inbox scopes a farm document by its farm; submitFarmDocument raises a
PENDING request; a registered ApprovalDocumentHandler decides, refuses or
withdraws the document inside the same transaction, with follow-up work
after commit. Batch rows keep their old visibility exactly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/drizzle/tenant/0122_approval_request_farm_document.sql apps/api/src/drizzle/tenant/meta/_journal.json apps/api/src/core/database/schema.ts apps/api/src/modules/production/approval/approval.service.ts apps/api/src/modules/production/approval/dto/approval.dto.ts apps/api/src/modules/production/approval/approval.controller.ts apps/api/src/modules/production/approval/approval.service.spec.ts
```

---

### Task 7: D25 (requisition) — submit for approval, decide in the inbox

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` (implements `OnModuleInit`; new `submit`, `decideFromApproval`, `withdrawFromApproval`, `lockForApproval`, `linesForCheck`; `lockOpen` rule; `requisitionListFields` gains `approval_request_id`; `approve` and `reject` removed)
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.controller.ts` (`POST :id/submit` replaces `:id/approve` and `:id/reject`)
- Modify: `apps/api/src/modules/procurement/feed-requisition/dto/feed-requisition.dto.ts` (`DecideFeedRequisitionDto` removed)
- Modify: `apps/api/src/modules/production/approval/approval.service.ts` (`decideFarmDocument` removed; its last caller goes in this task)
- Delete: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts`
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.submit.spec.ts`

**Interfaces:**
- Consumes (Task 6): `ApprovalService.submitFarmDocument`, `registerDocumentHandler`, `ApprovalRequestRow`, and `approve(id, tenantId, user, remarks?)` / `reject` / `remove`.
- Produces: `POST /api/v1/feed-requisition/:id/submit`, body `UpdateFeedRequisitionDto` (`{ remarks?, lines? }`), under `PROCUREMENT/REQUISITION create`. It answers the requisition view with `status: 'PENDING_APPROVAL'` and `approval_request_id` set.
- Produces: `export const FEED_APPROVAL_DOC_TYPE = 'FEED_REQUISITION';`
- Produces: `export function isEditableFeedRequisition(row: { status: string; approval_request_id: string | null }): boolean`: true for AUTO_DRAFT, DRAFT, and a PENDING_APPROVAL row Plan B left **without** a request.
- Removes: `POST /feed-requisition/:id/approve`, `POST /feed-requisition/:id/reject`, `FeedRequisitionService.approve/reject`, `DecideFeedRequisitionDto`, `ApprovalService.decideFarmDocument`.
- The list rows (`GET /feed-requisition`) gain `approval_request_id` (Task 13 links to the inbox with it).

Behaviour (D25, S8, S9):
- **Submit:** own farm only (`resolveOwnFarm`). It applies any line edits sent with it, then refuses anything needing remarks (>20 % off, or past the deadline) unless remarks are given or saved. It raises the PENDING request and sets PENDING_APPROVAL, all in one transaction. It re-evaluates the farm's alerts after the commit.
- **In the inbox:** approve needs the requisition's approve grant too (S5). It re-checks the remarks rule on the approval day, with the approver's remarks or the saved ones. Reject needs a reason, which is appended to the remarks. A withdrawal puts the requisition back to DRAFT. Alerts are re-evaluated after a decision commits.
- A requisition waiting for approval can no longer be edited, submitted or auto-drafted over.

- [ ] **Step 1: Write the failing spec.** Delete `feed-requisition.approve.spec.ts` (`git rm apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts`) and create:

```ts
// apps/api/src/modules/procurement/feed-requisition/feed-requisition.submit.spec.ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { ApprovalService } from '../../production/approval/approval.service';
import { FeedForecastService } from '../../inventory/feed-forecast/feed-forecast.service';
import { addDaysIso, serverToday } from './feed-requisition.rules';
import { FeedRequisitionService, isEditableFeedRequisition } from './feed-requisition.service';

/**
 * D25 (Rishi, 27 Sep): the farm drafts, edits and submits a feed requisition;
 * the farm's own approvers approve or reject it in the Approvals inbox. Run
 * through the REAL FeedForecastService, ApprovalService and AuditLogService
 * over a recording database, like the Plan B approve spec this replaces.
 */

interface Entry { op: string; table: unknown; values?: any; set?: any; inTx?: boolean }

function recordingDb(queues: Map<unknown, unknown[][]>, cls: () => ClsService) {
  const log: Entry[] = [];
  const inTx = () => cls().get('tenantPostingTransaction') === true;
  const db: any = {
    select: jest.fn(() => {
      const entry: Entry = { op: 'select', table: undefined, inTx: inTx() };
      log.push(entry);
      const self: any = {
        from: (t: unknown) => { entry.table = t; return self; },
        leftJoin: () => self, innerJoin: () => self, where: () => self, orderBy: () => self, limit: () => self, for: () => self,
        then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
      };
      return self;
    }),
    insert: jest.fn((t: unknown) => ({ values: jest.fn(async (v: unknown) => { log.push({ op: 'insert', table: t, values: v, inTx: inTx() }); }) })),
    update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async () => { log.push({ op: 'update', table: t, set: v, inTx: inTx() }); } }) })),
    delete: jest.fn((t: unknown) => ({ where: async () => { log.push({ op: 'delete', table: t, inTx: inTx() }); } })),
  };
  return { db, log };
}

const TODAY = serverToday();
const REQ_ROW = {
  requisition_id: 'req-1', tenant_id: 'tenant-1', company_id: 'co-1', farm_id: 'farm-grs', req_no: 'REQ-GRS-2026-00041', doc_type: 'FEED',
  status: 'AUTO_DRAFT', priority: 'CRITICAL', remarks: null, submission_deadline: addDaysIso(TODAY, 1), approval_request_id: null,
};
const PENDING_ROW = { ...REQ_ROW, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' };
const FARM = { code: 'GRS', name: 'Green Ridge' };
const LINE_6000 = { line_seq: 1, description: 'Weaner Diet R1', quantity: '6000.0000', recommended: '6000.0000' };
const VIEW = [{ req: { ...REQ_ROW, status: 'PENDING_APPROVAL', approval_request_id: 'ar-new' }, farm_code: 'GRS', truck_target_kg: 30000 }];
const REQUEST = {
  request_id: 'ar-1', tenant_id: 'tenant-1', company_id: 'co-1', doc_type: 'FEED_REQUISITION', doc_no: 'REQ-GRS-2026-00041',
  status: 'PENDING', batch_id: null, farm_id: 'farm-grs', document_id: 'req-1', deleted_at: null,
};

const COMPANY_ADMIN_SCOPE: FarmScope = { farmId: 'farm-x', companyId: 'co-1', restricted: false, lobId: null };
const OWN_FARM_SCOPE: FarmScope = { farmId: 'farm-grs', companyId: 'co-1', restricted: true, lobId: 'lob-pig' };
const ADMIN = { userId: 'u-admin', userType: 'COMPANY_ADMIN', email: 'admin@x' };
const FARM_USER = { userId: 'u-farm', userType: 'STANDARD_USER' };

function setup(queues: Map<unknown, unknown[][]>) {
  const ref = {} as { cls: ClsService };
  const { db, log } = recordingDb(queues, () => ref.cls);
  const cls = (ref.cls = transactionCls(db));
  const forecast = new FeedForecastService(cls, {} as any);
  const approvals = new ApprovalService(cls, new AuditLogService(cls), {} as any);
  const evaluated: Array<{ args: unknown[]; inTx: boolean }> = [];
  const alerts: any = {
    evaluateFarmSafely: jest.fn(async (...args: unknown[]) => { evaluated.push({ args, inTx: cls.get('tenantPostingTransaction') === true }); }),
  };
  const service = new FeedRequisitionService(cls, forecast, approvals, alerts, {} as any, {} as any);
  service.onModuleInit();
  const as = <T>(scope: FarmScope, work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, scope); return work(); });
  const writes = () => log.filter((e) => e.op !== 'select');
  return { service, approvals, evaluated, as, writes };
}

describe('isEditableFeedRequisition (D25)', () => {
  it('is true for drafts and for a Plan B PENDING_APPROVAL row that never got a request', () => {
    expect(isEditableFeedRequisition({ status: 'AUTO_DRAFT', approval_request_id: null })).toBe(true);
    expect(isEditableFeedRequisition({ status: 'DRAFT', approval_request_id: null })).toBe(true);
    expect(isEditableFeedRequisition({ status: 'PENDING_APPROVAL', approval_request_id: null })).toBe(true);
    expect(isEditableFeedRequisition({ status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' })).toBe(false);
    expect(isEditableFeedRequisition({ status: 'APPROVED', approval_request_id: 'ar-1' })).toBe(false);
  });
});

describe('FeedRequisitionService.submit (D25)', () => {
  it('raises a PENDING request for the farm and sets the requisition waiting, in one transaction, then re-evaluates alerts', async () => {
    const { service, as, writes, evaluated } = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW], VIEW]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }], [FARM]]],
      [schema.requisitionLine, [[LINE_6000], []]],
      [schema.approvalRequest, [[]]],
    ]));
    const view = await as(COMPANY_ADMIN_SCOPE, () => service.submit('req-1', {}, 'tenant-1', ADMIN));
    expect(view).toMatchObject({ status: 'PENDING_APPROVAL' });
    const request = writes().find((e) => e.op === 'insert' && e.table === schema.approvalRequest)!;
    expect(request.values).toMatchObject({
      doc_type: 'FEED_REQUISITION', doc_no: 'REQ-GRS-2026-00041', status: 'PENDING', farm_id: 'farm-grs', document_id: 'req-1',
      company_id: 'co-1', urgency: 'HIGH', requested_qty: '6,000', uom: 'KG', location_label: 'GRS — Green Ridge', justification: null,
    });
    const header = writes().find((e) => e.op === 'update' && e.table === schema.requisition)!;
    expect(header.set).toMatchObject({ status: 'PENDING_APPROVAL', approval_request_id: request.values.request_id, remarks: null });
    expect(writes().every((e) => e.inTx)).toBe(true);
    expect(evaluated).toEqual([{ args: ['farm-grs', 'co-1', 'tenant-1'], inTx: false }]);
  });

  it('refuses more than 20 % from the recommendation without remarks, writing nothing', async () => {
    const { service, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
      [schema.requisitionLine, [[{ ...LINE_6000, quantity: '9000.0000' }]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => service.submit('req-1', {}, 'tenant-1', ADMIN)))
      .rejects.toThrow(new BadRequestException('Line 1 (Weaner Diet R1): 9,000 kg is more than 20% off the recommended 6,000 kg. Add remarks to explain.'));
    expect(writes()).toEqual([]);
  });

  it('refuses a late submission without remarks, and takes the remarks sent with it', async () => {
    const late = { ...REQ_ROW, submission_deadline: addDaysIso(TODAY, -1) };
    const refused = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [late]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    await expect(refused.as(COMPANY_ADMIN_SCOPE, () => refused.service.submit('req-1', {}, 'tenant-1', ADMIN))).rejects.toThrow(/has passed/);
    const ok = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [late], VIEW]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }], [FARM]]],
      [schema.requisitionLine, [[LINE_6000], []]],
      [schema.approvalRequest, [[]]],
    ]));
    await ok.as(COMPANY_ADMIN_SCOPE, () => ok.service.submit('req-1', { remarks: 'Mill closed Friday' }, 'tenant-1', ADMIN));
    expect(ok.writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ remarks: 'Mill closed Friday' });
  });

  it('answers not found to a farm user of another farm, before anything is written', async () => {
    const { service, as, writes } = setup(new Map<unknown, unknown[][]>([[schema.requisition, [[{ farm_id: 'farm-other', company_id: 'co-1' }]]]]));
    await expect(as(OWN_FARM_SCOPE, () => service.submit('req-1', {}, 'tenant-1', FARM_USER))).rejects.toBeInstanceOf(NotFoundException);
    expect(writes()).toEqual([]);
  });

  it('will not edit a requisition that is waiting for approval', async () => {
    const { service, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [PENDING_ROW]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => service.update('req-1', { remarks: 'x' }, 'tenant-1', ADMIN)))
      .rejects.toThrow('Requisition REQ-GRS-2026-00041 is waiting for approval and can no longer be changed.');
    expect(writes()).toEqual([]);
  });
});

describe('Feed requisition decided in the Approvals inbox (D25)', () => {
  it('approving updates the requisition and the request together, then re-evaluates alerts after commit', async () => {
    const { approvals, as, writes, evaluated } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST], [{ ...REQUEST, status: 'APPROVED' }]]],
      [schema.requisition, [[PENDING_ROW]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN));
    expect(writes().find((e) => e.op === 'update' && e.table === schema.requisition)!.set)
      .toMatchObject({ status: 'APPROVED', approved_by: 'u-admin', remarks: null });
    expect(writes().find((e) => e.op === 'update' && e.table === schema.approvalRequest)!.set).toMatchObject({ status: 'APPROVED' });
    expect(writes().every((e) => e.inTx)).toBe(true);
    expect(evaluated).toEqual([{ args: ['farm-grs', 'co-1', 'tenant-1'], inTx: false }]);
  });

  it('refuses without remarks and leaves both documents pending (Review Focus 4)', async () => {
    const { approvals, as, writes, evaluated } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST]]],
      [schema.requisition, [[PENDING_ROW]]],
      [schema.requisitionLine, [[{ ...LINE_6000, quantity: '9000.0000' }]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN))).rejects.toThrow(/more than 20% off/);
    expect(writes()).toEqual([]);
    expect(evaluated).toEqual([]);
  });

  it('accepts the approver\'s remarks for a deviating line', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST], [REQUEST]]],
      [schema.requisition, [[PENDING_ROW]]],
      [schema.requisitionLine, [[{ ...LINE_6000, quantity: '9000.0000' }]]],
    ]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN, 'Extra pigs arriving'));
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'APPROVED', remarks: 'Extra pigs arriving' });
  });

  it('rejecting needs a reason and records it on the requisition', async () => {
    const none = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[REQUEST]]], [schema.requisition, [[PENDING_ROW]]]]));
    await expect(none.as(COMPANY_ADMIN_SCOPE, () => none.approvals.reject('ar-1', {}, 'tenant-1', ADMIN))).rejects.toThrow('A rejection reason is required.');
    expect(none.writes()).toEqual([]);
    const withReason = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[REQUEST], [REQUEST]]], [schema.requisition, [[PENDING_ROW]]]]));
    await withReason.as(COMPANY_ADMIN_SCOPE, () => withReason.approvals.reject('ar-1', { rejection_reason: 'Silo being cleaned' }, 'tenant-1', ADMIN));
    expect(withReason.writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'REJECTED', remarks: 'Rejected: Silo being cleaned' });
  });

  it('a withdrawal puts the requisition back to draft (S9)', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[REQUEST]]], [schema.requisition, [[PENDING_ROW]]]]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.remove('ar-1', 'tenant-1', ADMIN));
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'DRAFT', approval_request_id: null });
  });

  it('refuses a farm approver without the requisition approve grant (S5), writing nothing', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST]]],
      [schema.userRoleAssignment, [[]]],
    ]));
    await expect(as(OWN_FARM_SCOPE, () => approvals.approve('ar-1', 'tenant-1', FARM_USER))).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes()).toEqual([]);
  });

  it('will not decide a request whose requisition moved on', async () => {
    const { approvals, as } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST]]],
      [schema.requisition, [[{ ...PENDING_ROW, status: 'APPROVED' }]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN)))
      .rejects.toThrow('Requisition REQ-GRS-2026-00041 is not waiting for this approval.');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm nx test api -- --testPathPatterns=feed-requisition.submit 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: FAIL (`submit`, `onModuleInit` and `isEditableFeedRequisition` are missing).

- [ ] **Step 3: Implement the service.** In `feed-requisition.service.ts`:

Imports: add `OnModuleInit` to the `@nestjs/common` import. Add `import type { ApprovalRequestRow } from '../../production/approval/approval.service';`. In the `./dto/feed-requisition.dto` import, drop `DecideFeedRequisitionDto`. Add `ApprovalLine` to the `./feed-requisition.rules` import.

Replace the `OPEN_FEED_STATUSES` block (the comment and constant) with:

```ts
/** Statuses Plan B treated as open. Kept for the REQ_DEADLINE facts and the auto-draft cycle, which still count a requisition waiting for approval as "not approved". */
export const OPEN_FEED_STATUSES = ['AUTO_DRAFT', 'DRAFT', 'PENDING_APPROVAL'];
/** D25: the approval_request doc_type a feed requisition is submitted as. */
export const FEED_APPROVAL_DOC_TYPE = 'FEED_REQUISITION';
const STATUS_WORDS: Record<string, string> = {
  PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', REJECTED: 'rejected', CANCELLED: 'cancelled',
};

/**
 * D25: a requisition the farm may still change and submit — a draft, or a
 * PENDING_APPROVAL one Plan B left with no approval request (nothing in the
 * inbox can decide it, so the farm submits it again). Once submitted it is
 * the approver's, and changes wait for a rejection or a withdrawal.
 */
export function isEditableFeedRequisition(row: { status: string; approval_request_id: string | null }): boolean {
  return row.status === 'AUTO_DRAFT' || row.status === 'DRAFT' || (row.status === 'PENDING_APPROVAL' && !row.approval_request_id);
}
```

In `requisitionListFields()`, add `approval_request_id: R.approval_request_id,` after `created_at: R.created_at,`.

Change the class declaration to `export class FeedRequisitionService implements OnModuleInit {` and change the constructor comment on `approvals` to `// D25: submitted feed requisitions are decided in its inbox; this module registers what a decision does.` Add after the `db` getter:

```ts
  /** D25: tells the approval engine what approving, rejecting and withdrawing a feed requisition does. */
  onModuleInit(): void {
    this.approvals.registerDocumentHandler(FEED_APPROVAL_DOC_TYPE, {
      decide: (request, decision, remarks, tenantId, user) => this.decideFromApproval(request, decision, remarks, tenantId, user),
      withdraw: (request, tenantId, user) => this.withdrawFromApproval(request, tenantId, user),
      afterDecide: (request, tenantId) => this.feedAlerts.evaluateFarmSafely(request.farm_id, request.company_id, tenantId),
    });
  }
```

Replace the last three lines of `lockOpen` (the status check and `return row;`) with:

```ts
    if (!isEditableFeedRequisition(row)) {
      throw new BadRequestException(`Requisition ${row.req_no} is ${STATUS_WORDS[row.status] ?? row.status.toLowerCase()} and can no longer be changed.`);
    }
    return row;
```

and change its comment's first sentence to `The requisition the farm may still change (isEditableFeedRequisition), locked for the change.`

Delete the methods `approve(...)` and `reject(...)` with their comments. In their place add:

```ts
  /** The lines as approvalProblems reads them (checkpoint 18). */
  private async linesForCheck(requisitionId: string): Promise<ApprovalLine[]> {
    const lines = await this.db
      .select({
        line_seq: schema.requisitionLine.line_seq,
        description: schema.requisitionLine.description,
        quantity: schema.requisitionLine.quantity,
        recommended: schema.requisitionLine.recommended_qty_kg,
      })
      .from(schema.requisitionLine)
      .where(eq(schema.requisitionLine.requisition_id, requisitionId))
      .orderBy(schema.requisitionLine.line_seq);
    return lines.map((l) => ({
      lineSeq: l.line_seq, itemName: l.description ?? '', quantityKg: Number(l.quantity),
      recommendedQtyKg: l.recommended == null ? null : Number(l.recommended),
    }));
  }

  /**
   * D25 (Rishi, 27 Sep): the farm submits its requisition to the Approvals
   * inbox. Own farm only (resolveOwnFarm, checkpoint 19); last edits are
   * applied first, then the remarks rule is checked (S8: a requisition that
   * needs remarks — more than 20 % off, checkpoint 18, or past its deadline,
   * checkpoint 22 — never reaches an approver without them). The request and
   * the status change commit together; the farm's alerts are re-evaluated
   * after, so the REQ_DEADLINE reminder reads "waiting for approval" at once.
   */
  async submit(id: string, dto: UpdateFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.resolveOwnFarm(id, tenantId, user);
    await this.forecast.withFarmScope(farmId, companyId, () => withTenantTransaction(this.cls, async () => {
      const row = await this.lockOpen(id, tenantId, farmId, companyId);
      await this.applyLineEdits(id, dto.lines, farmId, tenantId);
      const lines = await this.linesForCheck(id);
      const remarks = dto.remarks !== undefined ? dto.remarks?.trim() || null : row.remarks?.trim() || null;
      const { today } = await this.forecast.farmToday(companyId, tenantId);
      const problems = approvalProblems({ lines, remarks, today, submissionDeadline: row.submission_deadline });
      if (problems.length) throw new BadRequestException(problems.join(' '));
      const totalKg = lines.reduce((sum, l) => sum + l.quantityKg, 0);
      const requestId = await this.approvals.submitFarmDocument({
        documentType: FEED_APPROVAL_DOC_TYPE,
        documentId: id,
        documentNo: row.req_no,
        farmId,
        companyId,
        title: `Feed requisition ${row.req_no}`,
        urgency: row.priority === 'CRITICAL_FIRST_PRIORITY' || row.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
        itemOrStage: 'Feed',
        requestedQty: totalKg.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        uom: 'KG',
        justification: remarks,
      }, tenantId, user);
      await this.db.update(schema.requisition).set({
        status: 'PENDING_APPROVAL',
        approval_request_id: requestId,
        remarks,
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, id));
    }));
    await this.feedAlerts.evaluateFarmSafely(farmId, companyId, tenantId);
    return this.forecast.withFarmScope(farmId, companyId, () => this.readView(id, tenantId));
  }

  /**
   * The requisition an approval request decides, locked. The request row has
   * already passed the inbox's farm scope for this approver (farmConditions),
   * so the requisition is found by the request's own document, company and
   * farm — never by the caller's pin — and must still be waiting on exactly
   * this request: a withdrawn-and-resubmitted requisition answers only to its
   * newest request.
   */
  private async lockForApproval(request: ApprovalRequestRow, tenantId: string) {
    const [row] = await this.db
      .select()
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, request.document_id ?? ''),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        eq(schema.requisition.company_id, request.company_id),
        isNull(schema.requisition.deleted_at),
      ))
      .limit(1)
      .for('update');
    if (!row || row.farm_id !== request.farm_id) throw new NotFoundException('Requisition not found.');
    if (row.status !== 'PENDING_APPROVAL' || row.approval_request_id !== request.request_id) {
      throw new BadRequestException(`Requisition ${row.req_no} is not waiting for this approval.`);
    }
    return row;
  }

  /**
   * D25: the inbox's decision, inside its transaction. Approval needs the
   * requisition approve grant as well as the inbox's (S5: approving commits
   * the mill), and re-checks the remarks rule on the approval day with the
   * approver's remarks or the saved ones — D25 keeps checkpoints 18 and 22 at
   * approval. A rejection needs a reason, appended to the remarks.
   */
  private async decideFromApproval(request: ApprovalRequestRow, decision: 'APPROVED' | 'REJECTED', remarks: string | null, tenantId: string, user: UserCtx) {
    await this.assertMayDecide(user);
    const row = await this.lockForApproval(request, tenantId);
    if (decision === 'REJECTED') {
      if (!remarks) throw new BadRequestException('A rejection reason is required.');
      await this.db.update(schema.requisition).set({
        status: 'REJECTED',
        remarks: row.remarks ? `${row.remarks}\nRejected: ${remarks}` : `Rejected: ${remarks}`,
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, row.requisition_id));
      return;
    }
    const finalRemarks = remarks || row.remarks?.trim() || null;
    const { today } = await this.forecast.farmToday(row.company_id, tenantId);
    const problems = approvalProblems({ lines: await this.linesForCheck(row.requisition_id), remarks: finalRemarks, today, submissionDeadline: row.submission_deadline });
    if (problems.length) throw new BadRequestException(problems.join(' '));
    await this.db.update(schema.requisition).set({
      status: 'APPROVED',
      remarks: finalRemarks,
      approved_by: user?.userId ?? null,
      approved_at: nowTs(),
      updated_by: user?.userId ?? null,
    }).where(eq(schema.requisition.requisition_id, row.requisition_id));
  }

  /** S9: a withdrawn request hands the requisition back to the farm as a draft. */
  private async withdrawFromApproval(request: ApprovalRequestRow, tenantId: string, user: UserCtx) {
    const row = await this.lockForApproval(request, tenantId);
    await this.db.update(schema.requisition).set({
      status: 'DRAFT',
      approval_request_id: null,
      updated_by: user?.userId ?? null,
    }).where(eq(schema.requisition.requisition_id, row.requisition_id));
  }
```

In `dto/feed-requisition.dto.ts`, delete `DecideFeedRequisitionDto` (its comment and class).

In `feed-requisition.controller.ts`, drop `DecideFeedRequisitionDto` from the dto import and replace the `approve` and `reject` handlers with:

```ts
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Submit an open feed requisition to the Approvals inbox (D25); remarks needed over 20 % deviation (cp. 18) or after the deadline (cp. 22)' })
  async submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.submit(id, dto ?? {}, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition submitted for approval.', data };
  }
```

Change the controller's class comment to: `// Feed requisitions ride the Procurement Requisition grant: drafted and submitted here, approved in the Approvals inbox (D25) by whoever may approve requisitions, and only for a farm in the caller's scope (checkpoint 19).`

In `approval.service.ts`, delete `decideFarmDocument` with its comment.

- [ ] **Step 4: Run the specs and typecheck**

Run: `pnpm nx test api -- --testPathPatterns="feed-requisition|approval|feed-alert" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"`. The web still calls `/feed-requisition/:id/approve` in `feed-requisition-panel.tsx`. That is a runtime path, not a type error, and Task 13 replaces the panel. Expect no `error TS`.
Run: `grep -rn "decideFarmDocument\|DecideFeedRequisitionDto" apps/api/src` → nothing.

- [ ] **Step 5: Prove it on MySQL** (apply 0122 first if Task 6 could not: `pnpm nx run api:db-migrate-all-tenants`. If refused, record it and do this step in Task 22 instead). Rebuild and restart the API. As tenant.admin in the VIL100 company workspace:
1. `POST /api/v1/feed-requisition/auto-draft {"farmId":"<VIL100>"}` → note `requisition.requisition_id` = `$R`.
2. `POST /api/v1/feed-requisition/$R/submit {"remarks":"Plan S verification"}` → 200, `status: PENDING_APPROVAL`.
3. `SELECT ar.status, ar.farm_id=r.farm_id same_farm, ar.document_id=r.requisition_id same_doc FROM requisition r JOIN approval_request ar ON ar.request_id=r.approval_request_id WHERE r.requisition_id='$R'` → `PENDING, 1, 1`.
4. As a VIL100 farm login (`vil100.manager@triplec.local` or the farm user named in `docs/HANDOFF-2026-09-14-continuation.md`), `GET /api/v1/approval?status=PENDING` lists the request. If that login lacks `PRODUCTION/APPROVAL view`, record that as the S5 role gap, not a defect.
5. As tenant.admin, `POST /api/v1/approval/<request_id>/approve {"remarks":"Plan S verification"}` → 200. Then `SELECT status, approved_by IS NOT NULL FROM requisition WHERE requisition_id='$R'` → `APPROVED, 1`, and the request is `APPROVED`.
Record the ids in the ledger. Stop the API by PID.

- [ ] **Step 6: Commit and write the ledger line**

```bash
git commit -m "feat(feed-requisition): submit to the Approvals inbox and decide there (D25)

Plan B approved a feed requisition in one step on its own screen (Ruling C1)
because the inbox could not see a batchless document. With the engine now
scoping farm documents (0122), the farm submits: the remarks rule is checked
(S8), a PENDING approval_request with the farm and document is raised, and
the requisition waits, locked against edits. The registered handler applies
approve (checkpoints 18/22 re-checked on the approval day, approver remarks
accepted), reject (reason required) and withdraw (back to DRAFT) inside the
engine's transaction, then re-evaluates the farm's alerts. The one-step
approve/reject routes and decideFarmDocument are removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.controller.ts apps/api/src/modules/procurement/feed-requisition/dto/feed-requisition.dto.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.submit.spec.ts apps/api/src/modules/production/approval/approval.service.ts
```

---

### Task 8: D24 (API) — feed alerts for every farm in scope; a farm filter on batch alerts

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-alert/feed-alert.service.ts` (new `evaluateScope`, `listScope`)
- Modify: `apps/api/src/modules/inventory/feed-alert/feed-alert.controller.ts` (new `GET scope`, `POST evaluate-scope`)
- Create: `apps/api/src/modules/inventory/feed-alert/feed-alert.scope.spec.ts`
- Modify: `apps/api/src/modules/production/alert/dto/alert.dto.ts` (`farmId`)
- Modify: `apps/api/src/modules/production/alert/alert.service.ts` (farm filter; batch number and farm on each row)
- Create: `apps/api/src/modules/production/alert/alert.service.spec.ts`

**Interfaces:**
- Consumes (Task 2): `FeedForecastService.listFarms(tenantId, userType): Promise<FeedFarmOption[]>`
- Produces: `POST /api/v1/feed-alert/evaluate-scope` → `{ data: { farms: number; failed: Array<{ farmCode: string; reason: string }>; forecastErrors: Array<{ farmCode: string; reason: string }> } }`, under `INVENTORY/LEDGER view`.
- Produces: `GET /api/v1/feed-alert/scope?farmId=&status=ACTIVE|RESOLVED|ALL` → the feed alert rows (all `feed_alert` columns plus `farm_code`) of every farm in the caller's scope, or of the one named. Filtered by recipient role (Q1) as the single-farm list is. Newest notification first, at most 500.
- Produces: `GET /api/v1/alert?farmId=` filters batch alerts to one farm's batches. Every row now also carries `batch_no` and `farm_id`.
- Keeps: `GET /feed-alert`, `POST /feed-alert/evaluate`, `POST /feed-alert/:id/acknowledge` unchanged. Acknowledge already resolves the alert's own farm through `resolveFarm`, which works in the tenant-wide workspace.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/inventory/feed-alert/feed-alert.scope.spec.ts
import { NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { FeedAlertService } from './feed-alert.service';

/**
 * D24 (Rishi, 27 Sep): feed alerts are shown in the one Alerts page, for every
 * farm the user may open, and opening that page evaluates those farms (there
 * is still no scheduler). Farm scope is listFarms' — the same rules as
 * resolveFarm — so nothing here widens who sees what.
 */
describe('FeedAlertService — every farm in scope (D24)', () => {
  const farms = [
    { farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom' },
    { farmId: 'farm-lex', code: 'LEX100', name: 'Lionshead Ext', companyId: 'co-1', companyName: 'Colcom' },
  ];
  const alertRow = (over: Record<string, unknown>) => ({
    alert_id: 'a', tenant_id: 't', company_id: 'co-1', farm_id: 'farm-vil', status: 'ACTIVE', recipient_roles: ['FARM_MANAGER'],
    escalation_role: null, escalated_at: null, last_notified_at: '2026-09-27 08:00:00', ...over,
  });

  function build(rows: unknown[], roleCodes: string[] = []) {
    let where: unknown;
    const db: any = {
      select: jest.fn(() => {
        let table: unknown;
        const self: any = {
          from: (t: unknown) => { table = t; return self; },
          leftJoin: () => self, innerJoin: () => self,
          where: (w: unknown) => { if (table === schema.feedAlert) where = w; return self; },
          orderBy: () => self,
          limit: async () => rows,
          then: (ok: any, err: any) => Promise.resolve(roleCodes.map((code) => ({ code }))).then(ok, err),
        };
        return self;
      }),
    };
    const forecast = { listFarms: jest.fn(async () => farms) };
    const service = new FeedAlertService(transactionCls(db), forecast as any, {} as any, {} as any);
    return { service, forecast, where: () => new MySqlDialect().sqlToQuery(where as any) };
  }

  it('lists the alerts of every farm in scope, with the farm code, for an admin', async () => {
    const { service, where } = build([
      { alert: alertRow({ alert_id: 'a1' }), farm_code: 'VIL100' },
      { alert: alertRow({ alert_id: 'a2', farm_id: 'farm-lex' }), farm_code: 'LEX100' },
    ]);
    const list = await service.listScope({}, 't', { userId: 'u', userType: 'TENANT_ADMIN' });
    expect(list.map((a: any) => [a.alert_id, a.farm_code])).toEqual([['a1', 'VIL100'], ['a2', 'LEX100']]);
    expect(where().params).toEqual(expect.arrayContaining(['farm-vil', 'farm-lex', 'ACTIVE']));
  });

  it('narrows to one farm, and answers not found for a farm outside the scope', async () => {
    const { service, where } = build([]);
    await service.listScope({ farmId: 'farm-lex', status: 'ALL' }, 't', { userId: 'u', userType: 'COMPANY_ADMIN' });
    expect(where().params).toContain('farm-lex');
    expect(where().params).not.toContain('farm-vil');
    await expect(service.listScope({ farmId: 'farm-other' }, 't', { userId: 'u', userType: 'COMPANY_ADMIN' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shows a non-admin only the alerts addressed to one of their roles', async () => {
    const { service } = build([
      { alert: alertRow({ alert_id: 'mine' }), farm_code: 'VIL100' },
      { alert: alertRow({ alert_id: 'theirs', recipient_roles: ['HEAD_OF_FARM'] }), farm_code: 'VIL100' },
    ], ['FARM_MANAGER']);
    const list = await service.listScope({}, 't', { userId: 'u', userType: 'STANDARD_USER' });
    expect(list.map((a: any) => a.alert_id)).toEqual(['mine']);
  });

  it('drops a row whose company is not its farm\'s company in scope', async () => {
    const { service } = build([{ alert: alertRow({ alert_id: 'x', company_id: 'co-2' }), farm_code: 'VIL100' }]);
    await expect(service.listScope({}, 't', { userId: 'u', userType: 'TENANT_ADMIN' })).resolves.toEqual([]);
  });

  it('evaluates and lists every farm in scope, reporting a failed farm and a forecast gap without stopping (Review Focus 2)', async () => {
    const { service } = build([]);
    jest.spyOn(service, 'evaluateFarm')
      .mockImplementationOnce(async () => ({ raise: [], renotify: [], escalate: [], resolve: [], forecastError: 'Silo holds feed in BAG' }) as any)
      .mockImplementationOnce(async () => { throw new Error('connection lost'); });
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const result = await service.evaluateScope('t', { userId: 'u', userType: 'TENANT_ADMIN' });
    expect(service.evaluateFarm).toHaveBeenNthCalledWith(1, 'farm-vil', 'co-1', 't');
    expect(service.evaluateFarm).toHaveBeenNthCalledWith(2, 'farm-lex', 'co-1', 't');
    expect(result).toEqual({
      farms: 2,
      forecastErrors: [{ farmCode: 'VIL100', reason: 'Silo holds feed in BAG' }],
      failed: [{ farmCode: 'LEX100', reason: 'connection lost' }],
    });
  });
});
```

```ts
// apps/api/src/modules/production/alert/alert.service.spec.ts
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { AlertService } from './alert.service';

/** D24: the Alerts page filters batch alerts by farm, and shows each alert's batch. */
describe('AlertService.findAll — farm filter (D24)', () => {
  it('limits batch alerts to the batches of one farm when a farm is named', async () => {
    let where: unknown;
    const chain: any = {
      from: () => chain, leftJoin: () => chain,
      where: (w: unknown) => { where = w; return chain; },
      orderBy: () => chain, limit: () => chain, offset: async () => [],
    };
    const db = { select: jest.fn(() => chain) };
    await new AlertService(transactionCls(db)).findAll({ farmId: 'farm-vil' } as any, 'tenant-1');
    const q = new MySqlDialect().sqlToQuery(where as any);
    expect(q.sql).toContain('IN (SELECT bf.batch_id FROM batch_header bf WHERE bf.farm_id = ?)');
    expect(q.params).toContain('farm-vil');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm nx test api -- --testPathPatterns="feed-alert.scope|production/alert" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: FAIL (`listScope`, `evaluateScope` missing; the farm condition is absent).

- [ ] **Step 3: Implement.** Add to `FeedAlertService` after `list(...)`:

```ts
  /**
   * D24 (Rishi, 27 Sep): the Alerts page evaluates every farm this user may
   * open — there is still no scheduler, so diet-change and deadline alerts
   * are only as fresh as the last evaluation. The farms are listFarms' (the
   * rules resolveFarm applies); one farm's failure is reported and the rest
   * still run, and a farm whose forecast cannot be built is named so the page
   * can say its diet-change alerts were skipped.
   */
  async evaluateScope(tenantId: string, user: AlertUser): Promise<{
    farms: number;
    failed: Array<{ farmCode: string; reason: string }>;
    forecastErrors: Array<{ farmCode: string; reason: string }>;
  }> {
    const farms = await this.forecast.listFarms(tenantId, user?.userType);
    const failed: Array<{ farmCode: string; reason: string }> = [];
    const forecastErrors: Array<{ farmCode: string; reason: string }> = [];
    for (const farm of farms) {
      try {
        const plan = await this.evaluateFarm(farm.farmId, farm.companyId, tenantId);
        if (plan.forecastError) forecastErrors.push({ farmCode: farm.code, reason: plan.forecastError });
      } catch (error) {
        this.logger.warn(`Feed alerts not evaluated for farm ${farm.code}: ${(error as Error).message}`);
        failed.push({ farmCode: farm.code, reason: (error as Error).message });
      }
    }
    return { farms: farms.length, failed, forecastErrors };
  }

  /**
   * D24: the feed alerts of every farm in scope (or the one named), for the
   * Alerts page. A farm outside the scope is not found, as on the single-farm
   * list; a row is kept only when its company is its farm's company in scope,
   * and only when it is addressed to one of the user's roles (Q1, L15 — role
   * codes are read once per company).
   */
  async listScope(query: { farmId?: string; status?: 'ACTIVE' | 'RESOLVED' | 'ALL' }, tenantId: string, user: AlertUser) {
    const farms = await this.forecast.listFarms(tenantId, user?.userType);
    const chosen = query.farmId ? farms.filter((f) => f.farmId === query.farmId) : farms;
    if (query.farmId && !chosen.length) throw new NotFoundException('Farm not found.');
    if (!chosen.length) return [];
    const companyOf = new Map(chosen.map((f) => [f.farmId, f.companyId]));
    const status = query.status ?? 'ACTIVE';
    const rows = await this.db
      .select({ alert: schema.feedAlert, farm_code: schema.locationMaster.location_code })
      .from(schema.feedAlert)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.feedAlert.farm_id))
      .where(and(
        eq(schema.feedAlert.tenant_id, tenantId),
        inArray(schema.feedAlert.farm_id, [...companyOf.keys()]),
        ...(status === 'ALL' ? [] : [eq(schema.feedAlert.status, status)]),
      ))
      .orderBy(desc(schema.feedAlert.last_notified_at))
      .limit(500);
    const seesAll = SEES_ALL.includes(user?.userType ?? '');
    const rolesByCompany = new Map<string, string[]>();
    const out: Array<typeof schema.feedAlert.$inferSelect & { farm_code: string | null }> = [];
    for (const r of rows) {
      if (companyOf.get(r.alert.farm_id) !== r.alert.company_id) continue;
      if (!seesAll && !rolesByCompany.has(r.alert.company_id)) {
        rolesByCompany.set(r.alert.company_id, await this.roleCodesOf(user?.userId, r.alert.company_id));
      }
      if (visibleTo(r.alert, rolesByCompany.get(r.alert.company_id) ?? [], seesAll)) out.push({ ...r.alert, farm_code: r.farm_code });
    }
    return out;
  }
```

In `feed-alert.controller.ts`, add after `evaluate`:

```ts
  // D24: the Alerts page reads and evaluates every farm the user may open,
  // under the same grant as the single-farm routes.
  @Get('scope')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Feed alerts of every farm the caller may open, or of one (D24)' })
  async listScope(@Query() query: QueryFeedAlertDto, @Req() req: any) {
    const data = await this.alerts.listScope(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed alerts retrieved successfully.', data };
  }

  @Post('evaluate-scope')
  @HttpCode(200)
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Evaluate the feed alert rules of every farm the caller may open (D24; there is no scheduler)' })
  async evaluateScope(@Req() req: any) {
    const data = await this.alerts.evaluateScope(req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed alerts evaluated.', data };
  }
```

Add `HttpCode` to the controller's `@nestjs/common` import.

In `production/alert/dto/alert.dto.ts`, add to `QueryAlertDto` after `batchId`:

```ts
  // D24: the Alerts page filters by farm; a batch alert reaches a farm through its batch.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;
```

In `production/alert/alert.service.ts`, change the imports:

```ts
import { eq, and, desc, getTableColumns } from 'drizzle-orm';
import { batchOnFarm, batchReferenceScopeConditions, farmScope } from '../../../common/farm-scope';
```

and in `findAll` add `if (query.farmId) conditions.push(batchOnFarm(schema.notificationAlertLog.batch_id, query.farmId));` after the `batchId` line, then replace the returned query with:

```ts
    // D24: the batch number and farm travel with each row, so the one Alerts
    // list can name the batch and filter by farm without a second read.
    return this.db
      .select({
        ...getTableColumns(schema.notificationAlertLog),
        batch_no: schema.batchHeader.batch_no,
        farm_id: schema.batchHeader.farm_id,
      })
      .from(schema.notificationAlertLog)
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.notificationAlertLog.batch_id))
      .where(and(...conditions))
      .orderBy(desc(schema.notificationAlertLog.created_at))
      .limit(limit)
      .offset(offset);
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm nx test api -- --testPathPatterns="feed-alert|production/alert" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.

- [ ] **Step 5: Prove it on MySQL.** Rebuild and restart the API. As tenant.admin with `x-workspace-scope: TENANT` and no company: `POST /api/v1/feed-alert/evaluate-scope` → `farms` equals the number of rows `GET /feed-forecast/farms` returned in Task 2. `GET /api/v1/feed-alert/scope?status=ALL` → every row's `farm_code` is one of those farms. The count equals `SELECT COUNT(*) FROM feed_alert` (the admin sees all). Record both numbers. `GET /api/v1/alert?farmId=<VIL100>&limit=200` → every row's `farm_id` is VIL100's. Stop the API by PID.

- [ ] **Step 6: Commit and write the ledger line**

```bash
git commit -m "feat(alerts): feed alerts for every farm in scope, farm filter on batch alerts (D24)

Feed alerts lived on their own Inventory screen, one farm at a time, and a
tenant admin in the tenant-wide workspace could open none. Rishi decided
they belong in the one Alerts page (D24): evaluate-scope runs the rules for
every farm listFarms allows (no scheduler exists; one farm's failure is
reported, not fatal), scope lists their alerts with the farm code under the
same role visibility (Q1), and batch alerts can be filtered by farm and carry
their batch number.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/modules/inventory/feed-alert/feed-alert.service.ts apps/api/src/modules/inventory/feed-alert/feed-alert.controller.ts apps/api/src/modules/inventory/feed-alert/feed-alert.scope.spec.ts apps/api/src/modules/production/alert/dto/alert.dto.ts apps/api/src/modules/production/alert/alert.service.ts apps/api/src/modules/production/alert/alert.service.spec.ts
```

---

