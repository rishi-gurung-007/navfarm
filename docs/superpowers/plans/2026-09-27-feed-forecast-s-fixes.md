# Feed Forecast Plan S: fixes from the running-app review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## How to continue (read first — work may stop at a usage limit)

- **Repo / branch:** `/Users/nero/Desktop/navfarm`, branch `feat/feed-forecast-report`. Work in place. Never switch branches, push or merge.
- **Ledger:** `.superpowers/sdd/2026-09-27-feed-forecast-s-fixes/progress.md`. Create it with the SDD layout on first start (a `# SDD ledger — plan: docs/superpowers/plans/2026-09-27-feed-forecast-s-fixes.md` heading, a `## Progress` section). Copy `context.md` from `.superpowers/sdd/2026-09-26-feed-forecast-r-report-alignment/context.md` into the same folder and change its first bullet's plan name to this plan.
- **Order:** strictly serial, Task 1 → Task 22, in the numbering below. Never run two tasks at once: Tasks 9–16 share `translations.ts`, and several pairs share a file (listed under "Task order").
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
- Do not start the web dev server or a browser except in Task 22. The machine has 8 GB. Stop what you started, by PID.
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

### Task 9: A3/A4/A5 — one farm list for the feed screens, one shared selection

**Files:**
- Create: `apps/web/src/utils/date-short.ts`
- Modify: `apps/web/src/components/console/inventory/feed-format.ts` (re-export `formatDateShort` instead of defining it)
- Modify (rewrite): `apps/web/src/components/console/inventory/use-feed-farm.ts`
- Create: `apps/web/src/components/console/inventory/feed-farm-select.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-requisition-panel.tsx`, `feed-alerts-panel.tsx` (one `<option>` line each: the farm fields were renamed. Both files are replaced in Task 13.)
- Modify (rewrite): `apps/web/specs/use-feed-farm.spec.tsx`
- Create: `apps/web/specs/feed-farm-select.spec.tsx`, `apps/web/specs/date-short.spec.ts`

**Interfaces:**
- Consumes (Task 2): `GET /feed-forecast/farms` → `FeedFarmOption[]` = `{ farmId, code, name, companyId, companyName }`, sorted by code.
- Produces: `apps/web/src/utils/date-short.ts`:
  - `formatDateShort(iso: string | null | undefined): string` → `"DD/MM/YY"` or `"—"`
  - `formatStampShort(ts: string | null | undefined, utc?: boolean): string` → `"DD/MM/YY HH:mm"` in the viewer's zone. `utc: true` for stamps written in UTC (feed alerts). Batch alerts are server-local.
- Produces: `use-feed-farm.ts`:
  - `export interface FeedFarm { farmId: string; code: string; name: string; companyId: string; companyName: string | null }`
  - `export function loadFeedFarms(user: { userId?: string } | null): Promise<FeedFarm[]>`: one request per workspace, shared by every caller (A3). A failed read is not cached.
  - `export function resetFeedFarmCache(): void` (tests)
  - `export const FEED_FARM_STORAGE_KEY = "nf_feed_farm_id"`
  - `export function useFeedFarm(): { farmId: string | null; setFarmId(id: string | null): void; farms: FeedFarm[]; loaded: boolean; failed: boolean; isFixed: boolean; fixedFarm: { location_code?: string; location_name?: string } | null }`. The initial farm is the stored feed farm, then the pinned farm, then the first farm by code (S2). `setFarmId` persists (A4). A STANDARD_USER is fixed to their farm and never fetches.
- Produces: `feed-farm-select.tsx`: `export function feedFarmLabel(f: { code: string; name: string }): string` (`"CODE — Name"`, A5) and `export function FeedFarmSelect(props: { id: string; label: string; farms: FeedFarm[]; farmId: string | null; onChange: (farmId: string) => void; fixedLabel?: string | null })`. It groups by company with `<optgroup>` when the list holds more than one company (S3). With `fixedLabel` set it renders a read-only value.

Why six requests (A3): the forecast panel fetched `/location` itself, the hook fetched it again for Requisitions/Alerts, the workspace switcher fetched it a third time, and React StrictMode doubles each in development. The feed screens now share one cached promise. The switcher's own read is left alone: it lists the pinned-farm choices for the whole app, a different job.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/specs/date-short.spec.ts
import { formatDateShort, formatStampShort } from '../src/utils/date-short';

describe('date-short (D16, review A9)', () => {
  it('formats a calendar day as DD/MM/YY and dashes what is unusable', () => {
    expect(formatDateShort('2026-09-26')).toBe('26/09/26');
    expect(formatDateShort(null)).toBe('—');
    expect(formatDateShort('soon')).toBe('—');
  });
  it('formats a UTC stamp in the viewer\'s zone, DD/MM/YY HH:mm', () => {
    const d = new Date(Date.UTC(2026, 8, 26, 13, 17, 28));
    const p = (n: number) => String(n).padStart(2, '0');
    expect(formatStampShort('2026-09-26 13:17:28', true))
      .toBe(`${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)} ${p(d.getHours())}:${p(d.getMinutes())}`);
    expect(formatStampShort('2026-09-26 13:17:28')).toBe('26/09/26 13:17');
    expect(formatStampShort(undefined)).toBe('—');
  });
});
```

```tsx
// apps/web/specs/use-feed-farm.spec.tsx
import { renderHook, waitFor, act } from '@testing-library/react';
import { FEED_FARM_STORAGE_KEY, resetFeedFarmCache, useFeedFarm } from '../src/components/console/inventory/use-feed-farm';
import { api } from '../src/services/api-client';
import { getActiveCompanyId, getActiveFarmId, getActiveWorkspaceScope, getStoredUser } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({
  getStoredUser: jest.fn(), getActiveFarmId: jest.fn(), getActiveCompanyId: jest.fn(), getActiveWorkspaceScope: jest.fn(),
}));

const get = api.get as jest.Mock;
const farms = [
  { farmId: 'farm-lex', code: 'LEX100', name: 'Lionshead Ext', companyId: 'co-1', companyName: 'Triple C' },
  { farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Triple C' },
];

beforeEach(() => {
  jest.clearAllMocks();
  resetFeedFarmCache();
  localStorage.clear();
  (getStoredUser as jest.Mock).mockReturnValue({ userId: 'u-admin', userType: 'TENANT_ADMIN' });
  (getActiveFarmId as jest.Mock).mockReturnValue(null);
  (getActiveCompanyId as jest.Mock).mockReturnValue(null);
  (getActiveWorkspaceScope as jest.Mock).mockReturnValue('TENANT');
  get.mockResolvedValue({ success: true, data: farms });
});

describe('useFeedFarm (A3, A4, A5, D13)', () => {
  it('fixes a STANDARD_USER to their own farm and never fetches', () => {
    (getStoredUser as jest.Mock).mockReturnValue({ userType: 'STANDARD_USER', farmId: 'farm-vil', farm: { location_code: 'VIL100', location_name: 'Villa Franca' } });
    const { result } = renderHook(() => useFeedFarm());
    expect(result.current).toMatchObject({ isFixed: true, farmId: 'farm-vil', loaded: true, fixedFarm: { location_code: 'VIL100', location_name: 'Villa Franca' } });
    expect(get).not.toHaveBeenCalled();
  });

  it('asks for the farm list once however many screens mount (A3)', async () => {
    const a = renderHook(() => useFeedFarm());
    const b = renderHook(() => useFeedFarm());
    await waitFor(() => expect(a.result.current.farms).toEqual(farms));
    await waitFor(() => expect(b.result.current.farms).toEqual(farms));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/feed-forecast/farms');
  });

  it('starts on the first farm by code when nothing is stored or pinned (S2)', async () => {
    const { result } = renderHook(() => useFeedFarm());
    await waitFor(() => expect(result.current.farmId).toBe('farm-lex'));
  });

  it('keeps a chosen farm for the next feed screen (A4)', async () => {
    const first = renderHook(() => useFeedFarm());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    act(() => first.result.current.setFarmId('farm-vil'));
    expect(localStorage.getItem(FEED_FARM_STORAGE_KEY)).toBe('farm-vil');
    const next = renderHook(() => useFeedFarm());
    await waitFor(() => expect(next.result.current.loaded).toBe(true));
    expect(next.result.current.farmId).toBe('farm-vil');
  });

  it('prefers the pinned farm over the first when nothing is stored, and drops a stored farm no longer offered', async () => {
    (getActiveFarmId as jest.Mock).mockReturnValue('farm-vil');
    const pinned = renderHook(() => useFeedFarm());
    await waitFor(() => expect(pinned.result.current.farmId).toBe('farm-vil'));
    localStorage.setItem(FEED_FARM_STORAGE_KEY, 'farm-gone');
    (getActiveFarmId as jest.Mock).mockReturnValue(null);
    const stale = renderHook(() => useFeedFarm());
    await waitFor(() => expect(stale.result.current.loaded).toBe(true));
    expect(stale.result.current.farmId).toBe('farm-lex');
  });

  it('asks again after a failed read, and reads a non-array body as no farms', async () => {
    get.mockRejectedValueOnce(new Error('network'));
    const failed = renderHook(() => useFeedFarm());
    await waitFor(() => expect(failed.result.current.failed).toBe(true));
    expect(failed.result.current.farmId).toBeNull();
    get.mockResolvedValueOnce({ data: { error: 'proxy timeout' } });
    const retry = renderHook(() => useFeedFarm());
    await waitFor(() => expect(retry.result.current.loaded).toBe(true));
    expect(get).toHaveBeenCalledTimes(2);
    expect(retry.result.current.farms).toEqual([]);
  });

  it('asks again when the workspace changes', async () => {
    const a = renderHook(() => useFeedFarm());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    (getActiveWorkspaceScope as jest.Mock).mockReturnValue('COMPANY');
    (getActiveCompanyId as jest.Mock).mockReturnValue('co-1');
    const b = renderHook(() => useFeedFarm());
    await waitFor(() => expect(b.result.current.loaded).toBe(true));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
```

```tsx
// apps/web/specs/feed-farm-select.spec.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeedFarmSelect, feedFarmLabel } from '../src/components/console/inventory/feed-farm-select';

const farm = (code: string, company: string) => ({ farmId: `f-${code}`, code, name: `${code} Farm`, companyId: company, companyName: company });

describe('FeedFarmSelect (A5, S3)', () => {
  it('labels each farm "CODE — Name" in the order given, flat for one company', () => {
    render(<FeedFarmSelect id="x" label="Farm" farms={[farm('LEX100', 'Triple C'), farm('VIL100', 'Triple C')]} farmId="f-VIL100" onChange={jest.fn()} />);
    const select = screen.getByLabelText('Farm') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['LEX100 — LEX100 Farm', 'VIL100 — VIL100 Farm']);
    expect(select.querySelectorAll('optgroup')).toHaveLength(0);
    expect(select.value).toBe('f-VIL100');
  });

  it('groups by company when there are several (tenant workspace)', () => {
    render(<FeedFarmSelect id="x" label="Farm" farms={[farm('AAA100', 'Colcom'), farm('BBB100', 'Triple C')]} farmId={null} onChange={jest.fn()} />);
    const groups = [...(screen.getByLabelText('Farm') as HTMLSelectElement).querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Colcom', 'Triple C']);
  });

  it('reports a choice, and shows a fixed farm read-only', () => {
    const onChange = jest.fn();
    const { rerender } = render(<FeedFarmSelect id="x" label="Farm" farms={[farm('LEX100', 'T'), farm('VIL100', 'T')]} farmId="f-LEX100" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Farm'), { target: { value: 'f-VIL100' } });
    expect(onChange).toHaveBeenCalledWith('f-VIL100');
    rerender(<FeedFarmSelect id="x" label="Farm" farms={[]} farmId="f-VIL100" onChange={onChange} fixedLabel="VIL100 — Villa Franca" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('VIL100 — Villa Franca')).toBeTruthy();
    expect(feedFarmLabel({ code: 'VIL100', name: 'Villa Franca' })).toBe('VIL100 — Villa Franca');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm nx test web -- --testPathPatterns="date-short|use-feed-farm|feed-farm-select" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"`
Expected: FAIL (modules and exports missing).

- [ ] **Step 3: Implement**

```ts
// apps/web/src/utils/date-short.ts
/**
 * The one date style of the feed screens, the Alerts page and the
 * Requisitions screen (field specification D16; review A9: the same screens
 * showed DD/MM/YY, dd-MMM-yyyy, ISO and "26/09/2026, 13:17:28").
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" (or a timestamp starting with one) -> "DD/MM/YY"; null/undefined/unparseable -> "—". */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "—";
}

/**
 * A stored MySQL timestamp ("YYYY-MM-DD HH:MM:SS") -> "DD/MM/YY HH:mm" in the
 * viewer's zone. `utc` says the stamp was written in UTC (feed_alert, Plan B's
 * convention); batch alerts are written in server-local time and read as such.
 */
export function formatStampShort(ts: string | null | undefined, utc = false): string {
  if (!ts) return "—";
  const d = new Date(`${ts.replace(" ", "T")}${utc ? "Z" : ""}`);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

In `feed-format.ts`, delete the `formatDateShort` function and its comment, and add at the top of the file, under the header comment:

```ts
// One definition of the D16 date format for every screen (Plan S, review A9).
export { formatDateShort } from "@/utils/date-short";
```

Replace `use-feed-farm.ts` entirely:

```ts
"use client";

/**
 * The farm a feed screen shows (spec D13), shared by Feed Forecast and
 * Requisitions. A STANDARD_USER's farm is their own and never a choice; every
 * other user type picks from GET /feed-forecast/farms (review A2: the farms
 * resolveFarm lets them open, so a tenant admin in the tenant-wide workspace
 * finally gets a list).
 *
 * One request per workspace (A3): the list is a module-level promise every
 * screen and every StrictMode double effect shares; a failed read is dropped
 * so the next screen asks again. One selection across the feed screens (A4,
 * S2): stored under its own key, so choosing a farm here does not pin it for
 * the rest of the app; it starts from the pinned farm, else the first by code.
 */
import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { getActiveCompanyId, getActiveFarmId, getActiveWorkspaceScope, getStoredUser } from "@/hooks/useAuth";

export interface FeedFarm {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string | null;
}

export const FEED_FARM_STORAGE_KEY = "nf_feed_farm_id";

let cache: { key: string; promise: Promise<FeedFarm[]> } | null = null;

/** For tests: forget the shared list. */
export function resetFeedFarmCache(): void {
  cache = null;
}

export function loadFeedFarms(user: { userId?: string } | null): Promise<FeedFarm[]> {
  const key = [user?.userId ?? "", getActiveWorkspaceScope(), getActiveCompanyId() ?? ""].join("|");
  if (!cache || cache.key !== key) {
    const promise = api.get("/feed-forecast/farms").then((res: any) => {
      // A proxy error page or a contract change can hand back a non-array body.
      const raw = res?.data ?? res;
      return Array.isArray(raw) ? (raw as FeedFarm[]) : [];
    });
    promise.catch(() => {
      if (cache?.promise === promise) cache = null;
    });
    cache = { key, promise };
  }
  return cache.promise;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(FEED_FARM_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(farmId: string | null): void {
  try {
    if (farmId) localStorage.setItem(FEED_FARM_STORAGE_KEY, farmId);
    else localStorage.removeItem(FEED_FARM_STORAGE_KEY);
  } catch {
    // Private window or blocked storage: the choice lasts for this page only.
  }
}

export function useFeedFarm() {
  const user = getStoredUser() as any;
  const isFixed = user?.userType === "STANDARD_USER";
  const fixedFarmId: string | null = isFixed ? user?.farmId ?? user?.farm_id ?? null : null;
  const [farmId, setFarmIdState] = useState<string | null>(() => fixedFarmId ?? readStored() ?? getActiveFarmId());
  const [farms, setFarms] = useState<FeedFarm[]>([]);
  const [loaded, setLoaded] = useState(isFixed);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isFixed) return;
    let alive = true;
    loadFeedFarms(getStoredUser() as any)
      .then((list) => {
        if (!alive) return;
        setFarms(list);
        setFarmIdState((current) => {
          if (current && list.some((f) => f.farmId === current)) return current;
          const pinned = getActiveFarmId();
          if (pinned && list.some((f) => f.farmId === pinned)) return pinned;
          return list[0]?.farmId ?? null;
        });
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setFarmIdState(null);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [isFixed]);

  const setFarmId = (id: string | null) => {
    setFarmIdState(id);
    writeStored(id);
  };

  return { farmId, setFarmId, farms, loaded, failed, isFixed, fixedFarm: isFixed ? (user?.farm ?? null) : null };
}
```

```tsx
// apps/web/src/components/console/inventory/feed-farm-select.tsx
"use client";

/**
 * The farm picker of the feed screens (A5, S3): "CODE — Name" in code order,
 * grouped by company when the tenant-wide workspace lists more than one. A
 * farm login's farm is shown, not offered (D13).
 */
import { Field } from "@/components/ui/field";
import type { FeedFarm } from "./use-feed-farm";

export function feedFarmLabel(f: { code: string; name: string }): string {
  return `${f.code} — ${f.name}`;
}

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

export function FeedFarmSelect({
  id,
  label,
  farms,
  farmId,
  onChange,
  fixedLabel,
}: {
  id: string;
  label: string;
  farms: FeedFarm[];
  farmId: string | null;
  onChange: (farmId: string) => void;
  fixedLabel?: string | null;
}) {
  if (fixedLabel !== undefined) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="nf-text-label text-(--text-secondary)">{label}</span>
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{fixedLabel || "—"}</p>
      </div>
    );
  }
  const list = Array.isArray(farms) ? farms : [];
  const byCompany = new Map<string, FeedFarm[]>();
  for (const f of list) {
    const key = f.companyName ?? "";
    byCompany.set(key, [...(byCompany.get(key) ?? []), f]);
  }
  const option = (f: FeedFarm) => <option key={f.farmId} value={f.farmId}>{feedFarmLabel(f)}</option>;
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className="nf-input-sm nf-select min-w-[14rem]" style={inputStyle} value={farmId ?? ""} onChange={(e) => onChange(e.target.value)}>
        {byCompany.size > 1
          ? [...byCompany].map(([company, farmsOf]) => (
              <optgroup key={company} label={company || "—"}>{farmsOf.map(option)}</optgroup>
            ))
          : list.map(option)}
      </select>
    </Field>
  );
}
```

In `feed-requisition-panel.tsx` **and** `feed-alerts-panel.tsx`, replace the line

```tsx
                <option key={f.location_id} value={f.location_id}>{f.location_code} — {f.location_name}</option>
```

with

```tsx
                <option key={f.farmId} value={f.farmId}>{f.code} — {f.name}</option>
```

(Both panels are removed in Task 13. This keeps the branch compiling in between.)

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns="date-short|use-feed-farm|feed-farm-select|feed-" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass. The existing feed specs still pass: their users are STANDARD_USER, or they mock `/location` only for the forecast panel's own fetch, which Task 12 removes.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.

- [ ] **Step 5: Commit and write the ledger line**

```bash
git commit -m "feat(web): one cached farm list and one shared farm choice for the feed screens (review A3, A4, A5)

Opening one feed screen sent six identical GET /location requests (the
forecast panel's own fetch, the hook's, each doubled by StrictMode), the
list was unsorted, a farm picked on Feed Forecast was forgotten on
Requisitions, and in the tenant-wide workspace the list was empty. The hook
now reads GET /feed-forecast/farms once per workspace through a shared
promise, keeps the choice under nf_feed_farm_id (S2), and FeedFarmSelect
shows 'CODE — Name' grouped by company (S3). formatDateShort moves to
utils/date-short with a DD/MM/YY HH:mm stamp formatter for the alert lists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/utils/date-short.ts apps/web/src/components/console/inventory/feed-format.ts apps/web/src/components/console/inventory/use-feed-farm.ts apps/web/src/components/console/inventory/feed-farm-select.tsx apps/web/src/components/console/inventory/feed-requisition-panel.tsx apps/web/src/components/console/inventory/feed-alerts-panel.tsx apps/web/specs/use-feed-farm.spec.tsx apps/web/specs/feed-farm-select.spec.tsx apps/web/specs/date-short.spec.ts
```

---

### Task 10: The fixed-height page and the scrolling table (review C, design)

**Files:**
- Modify: `apps/web/src/app/global.css` (a new block right before the `CONTEXTUAL NAVIGATION — LEVEL 2` banner comment, ~:478)
- Modify: `apps/web/src/components/ui/console-page.tsx` (`fill` prop)
- Create: `apps/web/src/components/ui/scroll-table.tsx`
- Create: `apps/web/specs/scroll-table.spec.tsx`

**Interfaces:**
- Produces: `ConsolePage` gets `fill?: boolean`. When set, the page element carries `data-fill-height`. At ≥1024 px the page then fills `<main>` exactly, and `<main>` stops scrolling.
- Produces: `export function ScrollTable(props: React.HTMLAttributes<HTMLDivElement> & { label?: string; children: React.ReactNode })`. It renders `<div data-table-scroll><table aria-label=… class="border-separate border-spacing-0 …">`. It scrolls both ways inside its box.
- Produces (CSS contract, used by Tasks 11–15):
  - `[data-fill-body]`: the flex column under the page header. Its children are the toolbar (fixed height), notices, and one `[data-table-scroll]` that takes the rest.
  - `th` inside `[data-table-scroll] thead` is sticky at the top.
  - `[data-sticky-col]` (value `"true"`, or `"last"` for the last sticky column, which gets the edge line) with the CSS variable `--sticky-left` is sticky at the left from 640 px up.
  - `tr[data-group-start="true"]` draws a separator above the row. `tr[data-group-alt="true"]` shades the group.

How it fits the shell (`app/global.css`, "desktop" block): at ≥1024 px `[data-shell-region='content']` (`<main>`) is the scroller, with the breadcrumb and then the page as direct children. `:has(> [data-fill-height])` turns that one `<main>` into a flex column that does not scroll. The page flexes to fill it (`min-height: 0`), the page header stays where it is, `[data-fill-body]` takes the remaining height, and only `[data-table-scroll]` inside it scrolls. Between 1024 and 1279 px the context nav is a strip above `<main>` in the workspace grid, so `<main>` is simply shorter and nothing else changes. Below 1024 px the document scrolls, as on every page: the table keeps its own box (`max-height: 70dvh`) and scrolls inside it, so nothing overflows the viewport sideways.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/specs/scroll-table.spec.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ScrollTable } from '../src/components/ui/scroll-table';
import { ConsolePage } from '../src/components/ui/console-page';

describe('ScrollTable and the fixed-height page (Plan S design)', () => {
  it('wraps a separate-border table in its own scroll box, labelled for assistive tech', () => {
    render(<ScrollTable label="Feed forecast"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></ScrollTable>);
    const table = screen.getByRole('table', { name: 'Feed forecast' });
    expect(table.className).toContain('border-separate');
    expect(table.parentElement!.hasAttribute('data-table-scroll')).toBe(true);
  });

  it('marks a fill page so the shell stops scrolling <main>, and leaves normal pages alone', () => {
    const { container, rerender } = render(<ConsolePage fill><p>x</p></ConsolePage>);
    expect(container.firstElementChild!.hasAttribute('data-fill-height')).toBe(true);
    rerender(<ConsolePage><p>x</p></ConsolePage>);
    expect(container.firstElementChild!.hasAttribute('data-fill-height')).toBe(false);
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns=scroll-table 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL (module missing).

- [ ] **Step 2: Implement**

```tsx
// apps/web/src/components/ui/scroll-table.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A table that scrolls inside its own box, both ways, with its header row —
 * and any cell marked data-sticky-col — held in place (Plan S, review C: the
 * feed grid is 14 columns by one row per batch per date, and the whole page
 * used to scroll with it). The CSS lives in app/global.css under
 * "FIXED-HEIGHT PAGES". Sticky cells need border-separate: with collapsed
 * borders the row lines scroll away from a sticky cell, so the lines are
 * drawn on the cells instead.
 */
export function ScrollTable({
  label,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { label?: string; children: React.ReactNode }) {
  return (
    <div
      data-table-scroll
      className={cn("rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]", className)}
      {...rest}
    >
      <table aria-label={label} className="w-max min-w-full border-separate border-spacing-0 text-left text-xs">
        {children}
      </table>
    </div>
  );
}

export default ScrollTable;
```

In `console-page.tsx`, change the component to:

```tsx
export function ConsolePage({
  children,
  size = "default",
  fill = false,
  className,
}: {
  children: ReactNode;
  size?: "default" | "narrow";
  /**
   * Plan S: the page holds its header and filters still and only its table
   * scrolls. Sets data-fill-height, which app/global.css ("FIXED-HEIGHT
   * PAGES") uses to stop <main> scrolling and hand the height to the page.
   */
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      data-fill-height={fill ? "" : undefined}
      className={cn(
        // pb-10, not pb-6: the last row of a long list used to finish flush
        // against the bottom of the scroller, so anything overlaying that
        // edge — a horizontal scrollbar on a wide table, the floating
        // assistant button — covered it with the list already scrolled to
        // its limit and no way to bring it further into view.
        "mx-auto space-y-6 px-4 pb-10 sm:px-6 lg:px-7",
        // A fill page's table scrolls inside its own box, so the page needs no bottom run-out.
        fill && "space-y-3 lg:pb-4",
        size === "narrow" ? "max-w-2xl" : "max-w-7xl",
        className
      )}
    >
      {children}
    </div>
  );
}
```

In `global.css`, insert before the `CONTEXTUAL NAVIGATION — LEVEL 2` banner comment:

```css
/* ─────────────────────────────────────────────────────────────────────────
   FIXED-HEIGHT PAGES (Feed Forecast Plan S, review C)

   A page whose work surface is one large table — the feed forecast, the
   requisitions, the alerts — holds its header and filters still, and only
   the table scrolls, both ways, with its header row and first columns held.
   ConsolePage fill sets data-fill-height; the page's body is a
   [data-fill-body] flex column; its one [data-table-scroll] takes the
   height that is left. Markup: components/ui/console-page.tsx and
   components/ui/scroll-table.tsx.
   ───────────────────────────────────────────────────────────────────────── */

[data-fill-height] {
  display: flex;
  flex-direction: column;
}

[data-fill-body] {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
}

/* Below 1024px the document scrolls, as on every page; the table keeps a box
   of its own so a 14-column grid never widens the page past the viewport. */
[data-table-scroll] {
  overflow: auto;
  max-height: 70dvh;
  overscroll-behavior: contain;
}

[data-table-scroll] thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--row-border);
}

[data-table-scroll] tbody td {
  border-bottom: 1px solid var(--row-border);
  background: var(--surface);
}

[data-table-scroll] [data-sticky-col] {
  position: sticky;
  left: var(--sticky-left, 0);
  z-index: 1;
}

[data-table-scroll] thead th[data-sticky-col] {
  z-index: 3;
}

[data-table-scroll] [data-sticky-col='last'] {
  box-shadow: 1px 0 0 var(--row-border);
}

/* A batch + item's consecutive dates read as one block, not a wall of rows. */
[data-table-scroll] tbody tr[data-group-start='true']:not(:first-child) td {
  border-top: 1px solid var(--border);
}

[data-table-scroll] tbody tr[data-group-alt='true'] td {
  background: var(--surface-raised);
}

[data-table-scroll] tbody tr:hover td {
  background: var(--row-hover);
}

/* Two sticky columns would take a phone's whole width; there they scroll. */
@media (max-width: 639.98px) {
  [data-table-scroll] [data-sticky-col] {
    position: static;
    box-shadow: none;
  }
}

@media (min-width: 1024px) {
  /* <main> is the scroller here; with a fill page in it, it hands its height
     to the page instead and stops scrolling. */
  [data-shell-region='content']:has(> [data-fill-height]) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  [data-shell-region='content'] > [data-fill-height] {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
  }

  [data-fill-height] > [data-fill-body] {
    flex: 1 1 auto;
  }

  [data-fill-body] [data-table-scroll] {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
  }
}
```

- [ ] **Step 3: Run the test, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns=scroll-table 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.

jsdom does not lay out CSS. The height and sticky behaviour is proved in the browser in Task 22.

- [ ] **Step 4: Commit and write the ledger line**

```bash
git commit -m "feat(web): fixed-height page mode and a scrolling table with sticky header and columns (review C)

The feed screens scrolled as a whole page: a 14-column grid with a row per
batch per date pushed the filters off screen and had no sticky header or
batch column. ConsolePage fill (data-fill-height) now makes <main> hand its
height to the page at >=1024px so only a ScrollTable scrolls, both ways,
with its header row and marked first columns held, group separators and
shading; below 1024px the table keeps its own box so nothing overflows.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/app/global.css apps/web/src/components/ui/console-page.tsx apps/web/src/components/ui/scroll-table.tsx apps/web/specs/scroll-table.spec.tsx
```

---

### Task 11: Feed Forecast grid and stage table (A6, A7, review C)

**Files:**
- Modify (rewrite): `apps/web/src/components/console/inventory/feed-forecast-grid.tsx`
- Modify (rewrite): `apps/web/specs/feed-forecast-grid.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts` (en: new and changed keys listed in Step 3)

**Interfaces:**
- Consumes (Task 10): `ScrollTable`, the `data-sticky-col` / `data-group-*` CSS contract. Consumes (Task 9): `formatDateShort` through `./feed-format`.
- Keeps (the panel and its spec import them): `ReportRow`, `StageBlock`, `GRID_COLUMNS` (the same 14 keys in the same order, the field spec's names), `fmtKg`, `wastageNote`, `FeedForecastGrid({ rows, loading, horizonTo, t })`, `FeedForecastStages({ stages, t })`.
- Produces: `export function groupRows(rows: ReportRow[]): Array<{ row: ReportRow; start: boolean; alt: boolean }>`. A group is consecutive rows with the same batch + item + source + stage. `alt` shades every second group.
- Produces: `export const STAGE_COLUMNS = ["ffStgBatch", "ffStgShed", "ffStgCurrent", "ffStgFrom", "ffStgTo", "ffStgNext", "ffStgChange"] as const`
- Changes: `fmtKg` always shows two decimals (`1,500.00`). `FeedForecastStages` renders a table, and an empty-state row when there are no stages (it no longer returns null).

Design rules applied here (review C):
- One line per row: `whitespace-nowrap`, `py-1.5`, `text-xs`, `tabular-nums` on numbers, numbers right-aligned.
- The "shared by N" note is a small badge **in the Source cell**, not a second line under Days of Stock. It says "Shared by N", not "Silo shared by N", so a STORE row reads correctly (A7).
- Batch No and Item are sticky (`8.5rem` + `13rem`). On a group's second and later rows they are muted, so the eye reads the group once.
- Dates are DD/MM/YY. A missing date is "—", never "(24/09/26 – —)" (A6).

- [ ] **Step 1: Write the failing spec** (replace the file):

```tsx
// apps/web/specs/feed-forecast-grid.spec.tsx
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import {
  FeedForecastGrid, FeedForecastStages, GRID_COLUMNS, STAGE_COLUMNS, ReportRow, StageBlock, fmtKg, groupRows, wastageNote,
} from '../src/components/console/inventory/feed-forecast-grid';
import { addDaysIso, formatDateShort } from '../src/components/console/inventory/feed-format';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  key: 'b|r1|GRS/SILO-001|2026-09-23', batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', stageCode: 'WEANER',
  itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1', sourceType: 'SILO', sourceCode: 'GRS/SILO-001',
  date: '2026-09-23', dateTo: '2026-09-23', days: 1, currentInventoryKg: 1500, heads: 1000, perDayIntakeKg: 2000, wastagePct: 0,
  intakeKg: 2000, demandKg: 2000, daysOfStock: 0, sharedBatchCount: 1, indicative: false,
  runDownDate: '2026-09-23', refillDate: '2026-09-21', requiredOn: '2026-09-19', overdue: true, ...over,
});

describe('feed-format date helpers (D16)', () => {
  it('formats DD/MM/YY and dashes anything unusable', () => {
    expect(formatDateShort('2026-09-23')).toBe('23/09/26');
    expect(formatDateShort(null)).toBe('—');
  });
  it('adds calendar days across a month end', () => {
    expect(addDaysIso('2026-09-28', 7)).toBe('2026-10-05');
  });
});

describe('FeedForecastGrid', () => {
  it("keeps the field specification's 14 columns in order", () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([...GRID_COLUMNS]);
    expect(GRID_COLUMNS).toHaveLength(14);
  });

  it('holds the header row and the Batch No and Item columns (sticky), and aligns numbers right with two decimals', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0].getAttribute('data-sticky-col')).toBe('true');
    expect(headers[1].getAttribute('data-sticky-col')).toBe('last');
    expect(headers[2].hasAttribute('data-sticky-col')).toBe(false);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[0].getAttribute('data-sticky-col')).toBe('true');
    expect(cells[6].textContent).toBe('1,500.00');
    expect(cells[6].className).toContain('text-right');
    expect(fmtKg(16.3)).toBe('16.30');
  });

  it('shows the Item No, DD/MM/YY dates and an Overdue badge', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('FEED-R1')).toBeTruthy();
    expect(within(table).getAllByText('23/09/26').length).toBe(2);
    expect(within(table).getByText('21/09/26')).toBeTruthy();
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
  });

  it('puts "shared by N" as a badge in the Source cell, worded for a store as well as a silo (A7)', () => {
    render(<FeedForecastGrid rows={[row({ sourceType: 'STORE', sourceCode: 'VIL100/STORE-001', sharedBatchCount: 3, indicative: true, daysOfStock: 93 })]} loading={false} horizonTo={null} t={t} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(within(cells[5]).getByText('ffSharedBy:{"count":3}')).toBeTruthy();
    expect(screen.queryByText(/ffSharedSilo/)).toBeNull();
    expect(within(cells[9]).getByText('93')).toBeTruthy();
    expect(within(cells[9]).getByText('ffIndicative')).toBeTruthy();
  });

  it("shows a grouped line's dates and says the stock lasts past the horizon when nothing runs down", () => {
    render(<FeedForecastGrid rows={[row({ days: 3, dateTo: '2026-09-25', runDownDate: null, refillDate: null, requiredOn: null, overdue: false })]} loading={false} horizonTo="2026-11-07" t={t} />);
    expect(screen.getByText('23/09/26 – 25/09/26')).toBeTruthy();
    expect(screen.getByText('ffBeyondHorizon:{"date":"07/11/26"}')).toBeTruthy();
    expect(screen.queryByText('ffOverdue')).toBeNull();
  });

  it('marks where each batch + item group starts and shades every second group', () => {
    const rows = [row(), row({ key: 'k2', date: '2026-09-24' }), row({ key: 'k3', itemId: 'r2', itemName: 'Weaner Diet R2' })];
    expect(groupRows(rows).map((g) => [g.start, g.alt])).toEqual([[true, false], [false, false], [true, true]]);
    render(<FeedForecastGrid rows={rows} loading={false} horizonTo={null} t={t} />);
    const body = screen.getAllByRole('row').slice(1);
    expect(body.map((r) => r.getAttribute('data-group-start'))).toEqual(['true', null, 'true']);
    expect(body[2].getAttribute('data-group-alt')).toBe('true');
  });

  it('shows an empty state and a loading state', () => {
    const { rerender } = render(<FeedForecastGrid rows={[]} loading={false} horizonTo={null} t={t} />);
    expect(screen.getByText(/ffNoRows/)).toBeTruthy();
    rerender(<FeedForecastGrid rows={[]} loading horizonTo={null} t={t} />);
    expect(screen.getByText(/ffLoading/)).toBeTruthy();
  });

  it('titles Days of Stock and Run-Down with what each counts to', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo={null} t={t} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.find((h) => h.textContent === 'ffColDaysOfStock')!.getAttribute('title')).toBe('ffDaysOfStockHint');
    expect(headers.find((h) => h.textContent === 'ffColRunDown')!.getAttribute('title')).toBe('ffRunDownHint');
  });
});

describe('wastageNote (D17)', () => {
  it('names each allowance used, or says there is none', () => {
    expect(wastageNote([row({ wastagePct: 5 }), row({ wastagePct: 2.5 }), row({ wastagePct: 5 })], t)).toBe('ffWastageUsed:{"pcts":"2.5%, 5%"}');
    expect(wastageNote([row()], t)).toBe('ffWastageNone');
  });
});

describe('FeedForecastStages — a table, not stacked cards (review C, A6)', () => {
  const block: StageBlock = {
    batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', currentStageCode: 'WEANER', currentFrom: '2026-08-01', currentTo: '2026-09-11',
    nextStageCode: 'GROWER', nextFrom: '2026-09-12', nextTo: '2026-11-06', stageChangeDate: '2026-09-12', stageChangeOverdue: true,
  };

  it('lists batch, current stage, from, to, next stage and change date, with a not-posted mark', () => {
    render(<FeedForecastStages stages={[block]} t={t} />);
    const table = screen.getByRole('table', { name: 'ffStagesTitle' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([...STAGE_COLUMNS]);
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['WG-2026-38', 'GRS/SHED-003', 'WEANER', '01/08/26', '11/09/26', 'GROWER', '12/09/26ffStageChangeNotPosted']);
  });

  it('shows a dash, never "( – —)", where a stage has no length or no successor (A6)', () => {
    render(<FeedForecastStages stages={[{ ...block, currentTo: null, nextStageCode: null, nextFrom: null, nextTo: null, stageChangeDate: null, stageChangeOverdue: false }]} t={t} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(4)).toEqual(['—', '—', '—']);
  });

  it('renders both rows of a batch with two concurrent stages, and an empty state', () => {
    const shared = { ...block, batchNo: 'BATCH-000010', nextStageCode: null, nextFrom: null, nextTo: null, stageChangeDate: null, stageChangeOverdue: false };
    const { rerender } = render(<FeedForecastStages stages={[{ ...shared, currentStageCode: 'GESTATION' }, { ...shared, currentStageCode: 'LACTATION' }]} t={t} />);
    expect(screen.getAllByText('BATCH-000010')).toHaveLength(2);
    rerender(<FeedForecastStages stages={[]} t={t} />);
    expect(screen.getByText('ffNoStages')).toBeTruthy();
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns=feed-forecast-grid 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL (`groupRows`, `STAGE_COLUMNS` missing; markup differs).

- [ ] **Step 2: Implement** (replace `feed-forecast-grid.tsx`):

```tsx
"use client";

/**
 * Inventory -> Feed Forecast: the report grid and the stage table (Feed
 * Forecast Plan R, the client's field specification of 26 Sep, spec
 * D16–D19; laid out for the fixed-height page in Plan S, review C).
 * Presentational only — feed-forecast-panel.tsx fetches, these render.
 * Dates are DD/MM/YY (D16). Current Inventory is the System Balance
 * (checkpoint 37), never "physical stock".
 *
 * One line per row; numbers right-aligned with two decimals; Batch No and
 * Item held while the grid scrolls sideways; a batch + item's consecutive
 * dates grouped (a separator where a group starts, every second group
 * shaded) so eight near-identical rows do not read as a wall.
 */
import type { CSSProperties, ReactNode } from "react";
import { Inbox, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollTable } from "@/components/ui/scroll-table";
import { cn } from "@/lib/utils";
import { formatDateShort } from "./feed-format";

/** One grid line as GET /feed-forecast sends it (apps/api …/feed-forecast.view.ts ReportRow). */
export interface ReportRow {
  key: string;
  batchId: string;
  batchNo: string;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string;
  itemName: string;
  sourceType: "SILO" | "STORE" | "NONE";
  sourceCode: string | null;
  date: string;
  dateTo: string;
  days: number;
  currentInventoryKg: number;
  heads: number;
  perDayIntakeKg: number;
  wastagePct: number;
  intakeKg: number;
  demandKg: number;
  daysOfStock: number | null;
  sharedBatchCount: number;
  indicative: boolean;
  runDownDate: string | null;
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean;
}

/** The current / next stage of one batch (apps/api …/feed-forecast.service.ts StageBlock). */
export interface StageBlock {
  batchId: string;
  batchNo: string;
  shedCode: string;
  currentStageCode: string;
  currentFrom: string;
  currentTo: string | null;
  nextStageCode: string | null;
  nextFrom: string | null;
  nextTo: string | null;
  stageChangeDate: string | null;
  stageChangeOverdue: boolean;
}

// `any` for the key, as Plan R's Task 9 brief specified: useLanguage's t is
// typed to TranslationKeys and the specs hand in a string-keyed mock.
type Translate = (key: any, vars?: any) => string;

/**
 * The field specification's Report Grid in its order, with two of ours: Source
 * after Planning Date (D6) and the feed that leaves the silo, wastage
 * included, last (D17).
 */
export const GRID_COLUMNS = [
  "ffColBatchNo", "ffColItemName", "ffColItemNo", "ffColShedNo", "ffColPlanningDate", "ffColSource",
  "ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg", "ffColDaysOfStock",
  "ffColRunDown", "ffColDateToRefill", "ffColRequiredOn", "ffColFeedOutKg",
] as const;

export const STAGE_COLUMNS = ["ffStgBatch", "ffStgShed", "ffStgCurrent", "ffStgFrom", "ffStgTo", "ffStgNext", "ffStgChange"] as const;

const RIGHT_ALIGNED = new Set<string>(["ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg", "ffColDaysOfStock", "ffColFeedOutKg"]);

/** Days of Stock and Run-Down count to two different things; the header title says which. */
const HEADER_HINT: Partial<Record<(typeof GRID_COLUMNS)[number], string>> = {
  ffColDaysOfStock: "ffDaysOfStockHint",
  ffColRunDown: "ffRunDownHint",
};

/** Kilograms, grouped, always two decimals (review C: consistent decimals). */
export function fmtKg(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** D17: "The screen states the wastage allowance used." */
export function wastageNote(rows: ReportRow[], t: Translate): string {
  const pcts = [...new Set(rows.map((r) => r.wastagePct).filter((p) => p > 0))].sort((a, b) => a - b);
  return pcts.length ? t("ffWastageUsed", { pcts: pcts.map((p) => `${p}%`).join(", ") }) : t("ffWastageNone");
}

/** Consecutive rows of one batch + item + source + stage form a group. */
export function groupRows(rows: ReportRow[]): Array<{ row: ReportRow; start: boolean; alt: boolean }> {
  let group = -1;
  let previous = "";
  return rows.map((row) => {
    const key = `${row.batchId}|${row.itemId}|${row.sourceCode ?? ""}|${row.stageCode}`;
    const start = key !== previous;
    if (start) {
      group += 1;
      previous = key;
    }
    return { row, start, alt: group % 2 === 1 };
  });
}

const BATCH_COL = { "--sticky-left": "0px" } as CSSProperties;
const ITEM_COL = { "--sticky-left": "8.5rem" } as CSSProperties;
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const MUTED = "text-[var(--text-muted)]";
const SMALL_BADGE = "px-1.5 py-0 text-[10px]";

function StateRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]">{children}</td>
    </tr>
  );
}

export function FeedForecastGrid({ rows, loading, horizonTo, t }: { rows: ReportRow[]; loading: boolean; horizonTo: string | null; t: Translate }) {
  return (
    <ScrollTable label={t("ffGridLabel")}>
      <thead>
        <tr>
          {GRID_COLUMNS.map((c, i) => (
            <th
              key={c}
              scope="col"
              title={HEADER_HINT[c] ? t(HEADER_HINT[c]) : undefined}
              data-sticky-col={i === 0 ? "true" : i === 1 ? "last" : undefined}
              style={i === 0 ? BATCH_COL : i === 1 ? ITEM_COL : undefined}
              className={cn(TH, i === 0 && "w-[8.5rem] min-w-[8.5rem]", i === 1 && "min-w-[13rem]", RIGHT_ALIGNED.has(c) && "text-right")}
            >
              {t(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <StateRow colSpan={GRID_COLUMNS.length}>
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} /> {t("ffLoading")}
          </StateRow>
        ) : rows.length === 0 ? (
          <StateRow colSpan={GRID_COLUMNS.length}>
            <Inbox className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--text-muted)" }} /> {t("ffNoRows")}
          </StateRow>
        ) : (
          groupRows(rows).map(({ row, start, alt }) => (
            <tr key={row.key} data-group-start={start ? "true" : undefined} data-group-alt={alt ? "true" : undefined}>
              <td data-sticky-col="true" style={BATCH_COL} className={cn(TD, "w-[8.5rem] min-w-[8.5rem] font-medium", !start && MUTED)}>{row.batchNo}</td>
              <td data-sticky-col="last" style={ITEM_COL} title={row.itemName} className={cn(TD, "min-w-[13rem] max-w-[16rem] truncate", !start && MUTED)}>{row.itemName}</td>
              <td className={cn(TD, MUTED)}>{row.itemNo || "—"}</td>
              <td className={cn(TD, MUTED)}>{row.shedCode || "—"}</td>
              <td className={TD}>{row.days > 1 ? `${formatDateShort(row.date)} – ${formatDateShort(row.dateTo)}` : formatDateShort(row.date)}</td>
              <td className={TD}>
                {row.sourceType === "NONE" ? t("ffNoSource") : row.sourceCode ?? "—"}
                {row.sharedBatchCount > 1 && (
                  <Badge variant="neutral" className={cn("ml-1.5", SMALL_BADGE)} title={t("ffSharedTitle", { count: row.sharedBatchCount })}>
                    {t("ffSharedBy", { count: row.sharedBatchCount })}
                  </Badge>
                )}
              </td>
              <td className={cn(TD, NUM)}>{fmtKg(row.currentInventoryKg)}</td>
              <td className={cn(TD, NUM)}>{row.heads.toLocaleString("en-US")}</td>
              <td className={cn(TD, NUM)}>{fmtKg(row.perDayIntakeKg)}</td>
              <td className={cn(TD, NUM)}>
                <span>{row.daysOfStock ?? "—"}</span>
                {row.indicative && <Badge variant="warning" className={cn("ml-1.5", SMALL_BADGE)}>{t("ffIndicative")}</Badge>}
              </td>
              <td className={TD}>
                {row.runDownDate ? formatDateShort(row.runDownDate) : horizonTo ? t("ffBeyondHorizon", { date: formatDateShort(horizonTo) }) : "—"}
              </td>
              <td className={TD}>{formatDateShort(row.refillDate)}</td>
              <td className={TD}>
                <span>{formatDateShort(row.requiredOn)}</span>
                {row.overdue && <Badge variant="danger" className={cn("ml-1.5", SMALL_BADGE)}>{t("ffOverdue")}</Badge>}
              </td>
              <td className={cn(TD, NUM)}>{fmtKg(row.demandKg)}</td>
            </tr>
          ))
        )}
      </tbody>
    </ScrollTable>
  );
}

/** The current / next stage of each batch (field spec supporting block), one table row per batch and stage. */
export function FeedForecastStages({ stages, t }: { stages: StageBlock[]; t: Translate }) {
  return (
    <ScrollTable label={t("ffStagesTitle")}>
      <thead>
        <tr>
          {STAGE_COLUMNS.map((c, i) => (
            <th key={c} scope="col" data-sticky-col={i === 0 ? "last" : undefined} style={i === 0 ? BATCH_COL : undefined} className={cn(TH, i === 0 && "min-w-[8.5rem]")}>
              {t(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {stages.length === 0 ? (
          <StateRow colSpan={STAGE_COLUMNS.length}>{t("ffNoStages")}</StateRow>
        ) : (
          stages.map((s) => (
            // A batch with concurrent stages (a registered breeding batch) has one row per stage.
            <tr key={`${s.batchId}|${s.currentStageCode}`}>
              <td data-sticky-col="last" style={BATCH_COL} className={cn(TD, "min-w-[8.5rem] font-medium")}>{s.batchNo}</td>
              <td className={cn(TD, MUTED)}>{s.shedCode || "—"}</td>
              <td className={TD}>{s.currentStageCode}</td>
              <td className={TD}>{formatDateShort(s.currentFrom)}</td>
              <td className={TD}>{formatDateShort(s.currentTo)}</td>
              <td className={TD}>{s.nextStageCode ?? "—"}</td>
              <td className={TD}>
                {formatDateShort(s.stageChangeDate)}
                {s.stageChangeOverdue && <Badge variant="warning" className={cn("ml-1.5", SMALL_BADGE)}>{t("ffStageChangeNotPosted")}</Badge>}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </ScrollTable>
  );
}
```

- [ ] **Step 3: Copy.** In `translations.ts` (`en` only), change these existing values:

| key | new value |
|---|---|
| `ffDaysOfStockHint` | `"Days the stock lasts at today's use."` |
| `ffRunDownHint` | `"Date the stock reaches the silo's low level."` |
| `ffNoRows` | `"Nothing to forecast for these dates."` |
| `ffLoading` | `"Loading forecast…"` |
| `ffBeyondHorizon` | `"After {{date}}"` |
| `ffWastageUsed` | `"Intake is without wastage. Refill dates and orders add {{pcts}} wastage."` |
| `ffWastageNone` | `"No wastage allowance on these diets."` |
| `ffStagesTitle` | `"Stages"` |

Delete `ffSharedSilo`, `ffStageCurrent`, `ffStageNext` and `ffStageChangeDate` (no longer referenced). Then add after `ffOverdue`:

```ts
    ffGridLabel: "Feed forecast",
    ffSharedBy: "Shared by {{count}}",
    ffSharedTitle: "{{count}} batches draw on this stock.",
    ffStgBatch: "Batch",
    ffStgShed: "Shed",
    ffStgCurrent: "Current stage",
    ffStgFrom: "From",
    ffStgTo: "To",
    ffStgNext: "Next stage",
    ffStgChange: "Stage change",
    ffNoStages: "No stages to show.",
```

- [ ] **Step 4: Run the tests, typecheck and lint**

The old panel still renders the stage block, which is now a second table, so its spec must name the table it means. The panel spec is replaced whole in Task 12; until then, make it pass with these exact edits to `apps/web/specs/feed-forecast-panel.spec.tsx`:

```bash
sed -i '' -e "s/findByRole('table')/findByRole('table', { name: 'ffGridLabel' })/g" \
  -e "s/getByRole('table')/getByRole('table', { name: 'ffGridLabel' })/g" \
  -e "s/queryByRole('table')/queryByRole('table', { name: 'ffGridLabel' })/g" \
  -e "s/ffSharedSilo:{\"count\":3}/ffSharedBy:{\"count\":3}/" \
  -e "s/getByRole('region', { name: 'ffStagesTitle' })/getByRole('table', { name: 'ffStagesTitle' })/" \
  apps/web/specs/feed-forecast-panel.spec.tsx
```

Run: `pnpm nx test web -- --testPathPatterns=feed-forecast 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass, grid and panel specs alike.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.

- [ ] **Step 5: Commit and write the ledger line**

```bash
git commit -m "feat(feed-forecast): compact sticky grid and a stage table (review A6, A7, C)

Rows were two lines tall ('Silo shared by N' wrapped inside Days of Stock,
wrong for a STORE source), numbers had loose decimals, eight near-identical
dated rows per batch read as a wall, and the stage block was stacked text
cards showing '(24/09/26 – —)'. The grid is now one line per row in a
ScrollTable with sticky Batch No / Item, right-aligned two-decimal numbers,
a 'Shared by N' badge in the Source cell, grouped and shaded batch+item
runs; stages are a table with a dash for any missing date.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/components/console/inventory/feed-forecast-grid.tsx apps/web/specs/feed-forecast-grid.spec.tsx apps/web/specs/feed-forecast-panel.spec.tsx apps/web/src/utils/translations.ts
```

---

### Task 12: Feed Forecast screen — fixed page, tabs, notes panel, defaults shown at once (A3, A6, A11, review C)

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-forecast-notes.tsx`
- Modify (rewrite): `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- Modify: `apps/web/src/components/console/inventory/inventory-page-shell.tsx` (`fill` prop)
- Modify: `apps/web/src/app/(app)/inventory/feed-forecast/page.tsx` (passes `fill`)
- Modify (rewrite): `apps/web/specs/feed-forecast-panel.spec.tsx`
- Create: `apps/web/specs/feed-forecast-notes.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts` (en)

**Interfaces:**
- Consumes: `useFeedFarm`, `FeedFarmSelect`, `feedFarmLabel` (Task 9); `ConsolePage fill`, `data-fill-body` (Task 10); `FeedForecastGrid`, `FeedForecastStages`, `wastageNote` (Task 11); `forecastQueryString`, `businessYearStartOf`, `FORECAST_VIEWS` (`feed-forecast-query.ts`, unchanged).
- Produces: `InventoryPageShell({ activeKey, fill?, children })`. With `fill`, the page is fixed-height and its header is not sticky, since it no longer scrolls.
- Produces: `feed-forecast-notes.tsx`: `export type ForecastFlag` (the union the panel had), `export interface NoteGroup { kind: string; title: string; items: string[] }`, `export function buildNoteGroups(flags: ForecastFlag[], t): NoteGroup[]`, and `export function FeedForecastNotes({ flags, t })`. The component is a `<details>` panel, closed by default, whose summary counts each kind. Opened, it lists the items grouped by kind in a box of at most `10rem` that scrolls.

What changes on the screen:
- The farm comes from the shared hook (one request, A3; kept across screens, A4). A user with no farms at all sees an empty state, not a pink error box (A11).
- Planning Date, Date From and Date To show their defaults before the first response (A11). Planning Date is the browser's today until the API answers with the farm's today, From is the planning date, and To is From + 7. They are shown, not sent: the API still decides the farm's today (D16).
- Tabs **Forecast | Stages (n)** switch the one scrolling table. The notes panel sits below it, collapsed. The page never scrolls at ≥1024 px.
- The wastage note is one short line beside the tabs.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/specs/feed-forecast-notes.spec.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { FeedForecastNotes, buildNoteGroups, type ForecastFlag } from '../src/components/console/inventory/feed-forecast-notes';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

describe('feed forecast notes — grouped by kind, with counts (review C)', () => {
  const flags: ForecastFlag[] = [
    { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 30, date: '2026-09-27' },
    { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 31, date: '2026-09-28' },
    { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 31, date: '2026-09-28' },
    { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 32, date: '2026-09-29' },
    { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000012' },
    { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000013' },
    { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000012' },
    { kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000012' },
    { kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000013' },
  ];

  it('folds a run of days into one item, dedupes repeats, and lists each shedless batch once', () => {
    const groups = buildNoteGroups(flags, t);
    expect(groups.map((g) => [g.kind, g.items.length])).toEqual([['NO_FEED_ROW', 1], ['BATCH_SHED_UNKNOWN', 2], ['HEADS_ASSUMED_FLAT', 1]]);
    expect(groups[0].items[0]).toBe('ffNoteDayRange:{"batchNo":"BATCH-1","stageCode":"WEANER","days":"30–32","dates":"27/09/26–29/09/26"}');
    expect(groups[1].items).toEqual(['BATCH-000012', 'BATCH-000013']);
  });

  it('is one collapsed panel whose summary counts each kind, and renders nothing without flags', () => {
    const { container, rerender } = render(<FeedForecastNotes flags={flags} t={t} />);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(screen.getByText('ffNotesTitle:{"count":3}')).toBeTruthy();
    expect(details.querySelector('summary')!.textContent).toContain('ffNoteNoFeedRow (1)');
    expect(details.querySelector('summary')!.textContent).toContain('ffNoteNoShed (2)');
    rerender(<FeedForecastNotes flags={[]} t={t} />);
    expect(container.innerHTML).toBe('');
  });
});
```

Replace `apps/web/specs/feed-forecast-panel.spec.tsx` with:

```tsx
import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import FeedForecastPanel from '../src/components/console/inventory/feed-forecast-panel';
import { api } from '../src/services/api-client';
import { getActiveWorkspaceScope } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
// A stable `t`: the effects must not depend on its identity (the tRef pattern).
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getActiveWorkspaceScope: jest.fn() }));
// The farm list and choice belong to the shared hook (use-feed-farm.spec.tsx); here it is a fixed answer.
let mockFarm: any;
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({ useFeedFarm: () => mockFarm }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const mockScope = getActiveWorkspaceScope as jest.Mock;

const FARMS = [
  { farmId: 'farm-vil100', code: 'VIL100', name: 'VILLA FRANCA FARM', companyId: 'co-1', companyName: 'Triple C' },
  { farmId: 'farm-oth', code: 'OTH100', name: 'OTHER FARM', companyId: 'co-1', companyName: 'Triple C' },
];
const adminFarm = (over: Record<string, unknown> = {}) => ({
  farmId: 'farm-vil100', setFarmId: jest.fn(), farms: FARMS, loaded: true, failed: false, isFixed: false, fixedFarm: null, ...over,
});

const forecastResponse = {
  success: true,
  data: {
    planningDate: '2026-09-25', today: '2026-09-25', timeZone: 'Africa/Harare', view: 'CUSTOM',
    from: '2026-09-25', to: '2026-10-02', forecastFrom: '2026-09-25', horizonTo: '2026-11-09', period: null,
    farm: { id: 'farm-vil100', code: 'VIL100', name: 'VILLA FRANCA FARM' },
    rows: [
      {
        key: 'b10|item-1|VIL100/STORE-001|2026-09-25', batchId: 'b10', batchNo: 'BATCH-000010', shedCode: '', stageCode: 'WEANER',
        itemId: 'item-1', itemNo: 'FEED-WG', itemName: 'Weaner Grower Mash (18% CP)', sourceType: 'STORE', sourceCode: 'VIL100/STORE-001',
        date: '2026-09-25', dateTo: '2026-09-25', days: 1, currentInventoryKg: 35525.6, heads: 58, perDayIntakeKg: 127, wastagePct: 2.5,
        intakeKg: 127, demandKg: 130.175, daysOfStock: 108, sharedBatchCount: 3, indicative: false,
        runDownDate: null, refillDate: null, requiredOn: null, overdue: false,
      },
      {
        key: 'b20|item-2|VIL100/SILO-002|2026-09-25', batchId: 'b20', batchNo: 'BATCH-000020', shedCode: 'SHED-1', stageCode: 'DRY_SOW',
        itemId: 'item-2', itemNo: 'FEED-DS', itemName: 'Dry Sow Gestation Mash (14% CP)', sourceType: 'SILO', sourceCode: 'VIL100/SILO-002',
        date: '2026-09-25', dateTo: '2026-09-25', days: 1, currentInventoryKg: 200, heads: 40, perDayIntakeKg: 100, wastagePct: 0,
        intakeKg: 100, demandKg: 100, daysOfStock: 2, sharedBatchCount: 1, indicative: true,
        runDownDate: '2026-09-26', refillDate: '2026-09-24', requiredOn: '2026-09-22', overdue: true,
      },
    ],
    stages: [
      { batchId: 'b20', batchNo: 'BATCH-000020', shedCode: 'SHED-1', currentStageCode: 'DRY_SOW', currentFrom: '2026-09-01', currentTo: '2026-09-07',
        nextStageCode: 'FLUSH', nextFrom: '2026-09-08', nextTo: '2026-09-21', stageChangeDate: '2026-09-08', stageChangeOverdue: true },
    ],
    flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000010' }, { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000010' }],
  },
};

function routedGet(over?: { feedForecast?: () => Promise<any>; periods?: () => Promise<any> }) {
  return (url: string) => {
    if (url.startsWith('/feed-forecast/periods')) return over?.periods ? over.periods() : Promise.resolve({ success: true, data: [] });
    return over?.feedForecast ? over.feedForecast() : Promise.resolve(forecastResponse);
  };
}
const forecastCalls = () => get.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/feed-forecast?'));

describe('FeedForecastPanel — admin', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation(routedGet());
    post.mockReset();
    mockScope.mockReset().mockReturnValue('COMPANY');
    mockFarm = adminFarm();
  });

  it("renders the field specification's 14 columns in order", async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(14);
  });

  it('never fetches the farm list itself: the shared hook owns it (A3)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(get.mock.calls.some(([url]) => String(url).startsWith('/location'))).toBe(false);
  });

  it('shows Overdue, Indicative, "Shared by", "after" the horizon and the wastage line; Stages is a tab', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
    expect(within(table).getByText('ffIndicative')).toBeTruthy();
    expect(within(table).getByText('ffSharedBy:{"count":3}')).toBeTruthy();
    expect(within(table).getByText('ffBeyondHorizon:{"date":"09/11/26"}')).toBeTruthy();
    expect(screen.getByText('ffWastageUsed:{"pcts":"2.5%"}')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'ffTabStages:{"count":1}' }));
    expect(screen.getByRole('table', { name: 'ffStagesTitle' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'ffGridLabel' })).toBeNull();
  });

  it('shows the farm chosen in the shared hook and hands a new choice back to it (A4)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    const select = screen.getByLabelText('ffFarm') as HTMLSelectElement;
    expect(select.value).toBe('farm-vil100');
    fireEvent.change(select, { target: { value: 'farm-oth' } });
    expect(mockFarm.setFarmId).toHaveBeenCalledWith('farm-oth');
  });

  it('shows default dates before the first answer arrives (A11)', () => {
    get.mockImplementation(() => new Promise(() => undefined));
    render(<FeedForecastPanel />);
    const planning = (screen.getByLabelText('ffPlanningDate') as HTMLInputElement).value;
    expect(planning).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((screen.getByLabelText('ffDateFrom') as HTMLInputElement).value).toBe(planning);
    expect((screen.getByLabelText('ffDateTo') as HTMLInputElement).value).not.toBe('');
  });

  it('fetches once on mount and once more after a date changes, without looping', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(forecastCalls()).toHaveLength(1);
    const input = screen.getByLabelText('ffDateFrom') as HTMLInputElement;
    const next = new Date(`${input.value}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    fireEvent.change(input, { target: { value: next.toISOString().slice(0, 10) } });
    await waitFor(() => expect(forecastCalls()).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(forecastCalls()).toHaveLength(2);
  });

  it('first asks for the Custom view with no dates, so the API plans from the farm\'s today (D16)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(forecastCalls()[0][0]).toBe('/feed-forecast?farmId=farm-vil100&view=CUSTOM');
  });

  it('sends a picked planning date as the as-of date', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffPlanningDate'), { target: { value: '2026-09-22' } });
    await waitFor(() => expect(forecastCalls().some(([url]) => url.includes('planningDate=2026-09-22'))).toBe(true));
  });

  it('does not crash when the response has rows but no flags array', async () => {
    get.mockImplementation(routedGet({ feedForecast: () => Promise.resolve({ success: true, data: { ...forecastResponse.data, flags: undefined } }) }));
    render(<FeedForecastPanel />);
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('shows the API error and hides the table', async () => {
    get.mockImplementation(routedGet({ feedForecast: () => Promise.reject({ message: 'Farm not found.' }) }));
    render(<FeedForecastPanel />);
    await screen.findByText('Farm not found.');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an empty state, not an error box, when the user has no farms (A11)', async () => {
    mockFarm = adminFarm({ farmId: null, farms: [] });
    render(<FeedForecastPanel />);
    expect(screen.getByText('ffNoFarms')).toBeTruthy();
    expect(forecastCalls()).toHaveLength(0);
  });

  it('collects the notes in one collapsed panel', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText('ffNotesTitle:{"count":2}')).toBeTruthy();
    expect(document.querySelector('details')!.open).toBe(false);
  });

  it('says nothing is forecast before the planning date when the range ends before it (Q7)', async () => {
    get.mockImplementation(routedGet({ feedForecast: () => Promise.resolve({ success: true, data: { ...forecastResponse.data, from: '2026-09-10', to: '2026-09-20', forecastFrom: null, rows: [], stages: [], flags: [] } }) }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText(/ffNoteRangeBeforePlanning/)).toBeTruthy();
  });

  it('notes that rows start at the planning date when the range only partly precedes it', async () => {
    get.mockImplementation(routedGet({ feedForecast: () => Promise.resolve({ success: true, data: { ...forecastResponse.data, from: '2026-09-20', to: '2026-09-30', forecastFrom: '2026-09-25' } }) }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText(/ffNoteRangeStartsAtPlanning/)).toBeTruthy();
  });

  it("the Reporting Period view lists the farm's periods", async () => {
    get.mockImplementation(routedGet({
      periods: () => Promise.resolve({ success: true, data: [{ periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' }] }),
    }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === '/feed-forecast/periods?farmId=farm-vil100')).toBe(true));
    const select = screen.getByLabelText('ffReportingPeriod') as HTMLSelectElement;
    expect(within(select).getByText('ffPeriodOption:{"code":"2026-09","from":"30/08/26","to":"26/09/26"}')).toBeTruthy();
  });

  it('offers to generate the business year when there are no periods, then reloads (Q9)', async () => {
    post.mockResolvedValue({ success: true, data: { created: ['2026-07'], skipped: [] } });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    fireEvent.click(await screen.findByRole('button', { name: /ffGeneratePeriods/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/reporting-period/generate', { business_year_start: 2026 }));
  });

  it('disables Generate Periods in the tenant-wide workspace and says why', async () => {
    mockScope.mockReturnValue('TENANT');
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    expect(((await screen.findByRole('button', { name: /ffGeneratePeriods/ })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('ffGenerateNeedsCompany')).toBeTruthy();
  });

  it('shows a refused generate beside the button without hiding the grid', async () => {
    post.mockRejectedValue({ message: 'Forbidden.' });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    fireEvent.click(await screen.findByRole('button', { name: /ffGeneratePeriods/ }));
    await screen.findByText('Forbidden.');
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows an error, not "No periods", when the periods read fails', async () => {
    get.mockImplementation(routedGet({ periods: () => Promise.reject(new Error('network')) }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    await screen.findByText('ffPeriodsLoadFailed');
    expect(screen.queryByText('ffNoPeriods')).toBeNull();
  });
});

describe('FeedForecastPanel — farm user (D13)', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation(routedGet());
    mockScope.mockReset().mockReturnValue('OPERATIONAL');
  });

  it('shows the farm, not a choice', async () => {
    mockFarm = adminFarm({ isFixed: true, farms: [], fixedFarm: { location_code: 'VIL100', location_name: 'VILLA FRANCA FARM' } });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.queryByRole('combobox', { name: 'ffFarm' })).toBeNull();
    expect(screen.getByText('VIL100 — VILLA FRANCA FARM')).toBeTruthy();
  });

  it("falls back to the response farm's code and name", async () => {
    mockFarm = adminFarm({ isFixed: true, farms: [], fixedFarm: null });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText('VIL100 — VILLA FRANCA FARM')).toBeTruthy();
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns="feed-forecast-(panel|notes)" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL.

- [ ] **Step 2: Notes component**

```tsx
// apps/web/src/components/console/inventory/feed-forecast-notes.tsx
"use client";

/**
 * The Feed Forecast's notes (review C): one compact panel, closed by default,
 * that counts each kind of note in its summary and lists the details grouped
 * when opened — instead of a long list of near-identical sentences ("BATCH-…
 * has no shed on record, so its feed is drawn from the farm store." once per
 * batch). Its box scrolls on its own so the page stays fixed-height.
 */
import { formatDateShort } from "./feed-format";

export type ForecastFlag =
  | { kind: "NO_FEED_ROW"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "OVERLAPPING_FEED_ROWS"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "NO_SILO_HOLDS_ITEM"; shedCode: string; itemName: string }
  | { kind: "STAGE_CHANGE_PROJECTED"; batchNo: string; stageCode: string; date: string }
  | { kind: "HEADS_ASSUMED_FLAT"; batchNo: string }
  | { kind: "BATCH_SHED_UNKNOWN"; batchNo: string }
  | { kind: "AS_OF_PAST"; planningDate: string; today: string };

export interface NoteGroup {
  kind: string;
  title: string;
  items: string[];
}

type Translate = (key: any, vars?: any) => string;
type DayFlag = { batchNo: string; stageCode: string; day: number; date: string };

/** Consecutive days of one batch + stage folded into one "days 30–32" item; exact repeats dropped. */
function dayRanges(flags: DayFlag[], t: Translate): string[] {
  const seen = new Set<string>();
  const sorted = flags
    .filter((f) => {
      const key = `${f.batchNo}|${f.stageCode}|${f.day}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.batchNo.localeCompare(b.batchNo) || a.stageCode.localeCompare(b.stageCode) || a.day - b.day);
  const runs: Array<{ batchNo: string; stageCode: string; from: number; to: number; dateFrom: string; dateTo: string }> = [];
  for (const f of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.batchNo === f.batchNo && last.stageCode === f.stageCode && f.day === last.to + 1) {
      last.to = f.day;
      last.dateTo = f.date;
    } else {
      runs.push({ batchNo: f.batchNo, stageCode: f.stageCode, from: f.day, to: f.day, dateFrom: f.date, dateTo: f.date });
    }
  }
  return runs.map((r) =>
    t("ffNoteDayRange", {
      batchNo: r.batchNo,
      stageCode: r.stageCode,
      days: r.from === r.to ? String(r.from) : `${r.from}–${r.to}`,
      dates: r.from === r.to ? formatDateShort(r.dateFrom) : `${formatDateShort(r.dateFrom)}–${formatDateShort(r.dateTo)}`,
    }),
  );
}

const unique = (values: string[]) => [...new Set(values)];

export function buildNoteGroups(flags: ForecastFlag[], t: Translate): NoteGroup[] {
  const list = Array.isArray(flags) ? flags : [];
  const of = <K extends ForecastFlag["kind"]>(kind: K) => list.filter((f): f is Extract<ForecastFlag, { kind: K }> => f.kind === kind);
  const groups: NoteGroup[] = [];
  const asOf = of("AS_OF_PAST")[0];
  if (asOf) groups.push({ kind: "AS_OF_PAST", title: t("ffNoteAsOf"), items: [t("ffFlagAsOfPast", { date: formatDateShort(asOf.planningDate), today: formatDateShort(asOf.today) })] });
  const noRow = dayRanges(of("NO_FEED_ROW"), t);
  if (noRow.length) groups.push({ kind: "NO_FEED_ROW", title: t("ffNoteNoFeedRow"), items: noRow });
  const overlap = dayRanges(of("OVERLAPPING_FEED_ROWS"), t);
  if (overlap.length) groups.push({ kind: "OVERLAPPING_FEED_ROWS", title: t("ffNoteOverlap"), items: overlap });
  const noSilo = unique(of("NO_SILO_HOLDS_ITEM").map((f) => t("ffNoteShedItem", { shedCode: f.shedCode, itemName: f.itemName })));
  if (noSilo.length) groups.push({ kind: "NO_SILO_HOLDS_ITEM", title: t("ffNoteNoSilo"), items: noSilo });
  const changes = unique(of("STAGE_CHANGE_PROJECTED").map((f) => t("ffNoteStageChangeItem", { batchNo: f.batchNo, stageCode: f.stageCode, date: formatDateShort(f.date) })));
  if (changes.length) groups.push({ kind: "STAGE_CHANGE_PROJECTED", title: t("ffNoteStageChange"), items: changes });
  const noShed = unique(of("BATCH_SHED_UNKNOWN").map((f) => f.batchNo)).sort();
  if (noShed.length) groups.push({ kind: "BATCH_SHED_UNKNOWN", title: t("ffNoteNoShed"), items: noShed });
  // HEADS_ASSUMED_FLAT is raised for every batch (D11): one line covers them all.
  if (of("HEADS_ASSUMED_FLAT").length) groups.push({ kind: "HEADS_ASSUMED_FLAT", title: t("ffNoteHeads"), items: [t("ffFlagHeadsAssumedFlat")] });
  return groups;
}

export function FeedForecastNotes({ flags, t }: { flags: ForecastFlag[]; t: Translate }) {
  const groups = buildNoteGroups(flags, t);
  if (!groups.length) return null;
  return (
    <details className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs">
        <span className="font-semibold text-[var(--text-primary)]">{t("ffNotesTitle", { count: groups.length })}</span>
        <span className="ml-2 text-[var(--text-muted)]">{groups.map((g) => `${g.title} (${g.items.length})`).join(" · ")}</span>
      </summary>
      <dl className="max-h-40 space-y-2 overflow-auto border-t border-[var(--border)] px-3 py-2 text-xs">
        {groups.map((g) => (
          <div key={g.kind}>
            <dt className="font-semibold text-[var(--text-primary)]">{g.title} <span className="font-normal text-[var(--text-muted)]">({g.items.length})</span></dt>
            <dd className="text-[var(--text-secondary)]">{g.items.join(g.kind === "BATCH_SHED_UNKNOWN" ? ", " : "; ")}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
```

- [ ] **Step 3: Panel** (replace `feed-forecast-panel.tsx`):

```tsx
"use client";

/**
 * Inventory -> Feed Forecast (Plans A, R; laid out in Plan S). The farm
 * comes from the shared feed-farm hook (one request, one choice across the
 * feed screens — review A3, A4); the query per view is feed-forecast-query.ts;
 * the grid, the stage table and the notes are their own components. The page
 * is fixed-height (ConsolePage fill): the filters stay put and only the table
 * scrolls (review C). The planning date and range are shown before the first
 * answer (A11) but only sent once the user changes them — the farm's own
 * today is the API's to decide (D16).
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { getActiveWorkspaceScope } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { addDaysIso, formatDateShort, todayIso, unwrap } from "./feed-format";
import { FeedForecastGrid, FeedForecastStages, ReportRow, StageBlock, wastageNote } from "./feed-forecast-grid";
import { FeedForecastNotes, type ForecastFlag } from "./feed-forecast-notes";
import { businessYearStartOf, forecastQueryString, FORECAST_VIEWS, ForecastView } from "./feed-forecast-query";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { useFeedFarm } from "./use-feed-farm";

interface PeriodOption {
  periodId: string;
  periodCode: string;
  startDate: string;
  endDate: string;
  stockTakeDate: string;
  productionStartDate: string;
}

interface ForecastData {
  planningDate: string;
  today: string;
  timeZone: string | null;
  view: ForecastView;
  from: string;
  to: string;
  forecastFrom: string | null;
  horizonTo: string;
  period: PeriodOption | null;
  farm: { id: string; code: string; name: string };
  rows: ReportRow[];
  stages: StageBlock[];
  flags: ForecastFlag[];
}

const VIEW_LABEL: Record<ForecastView, TranslationKeys> = { DAILY: "ffViewDaily", WEEKLY: "ffViewWeekly", PERIOD: "ffViewPeriod", CUSTOM: "ffViewCustom" };
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const labelCls = "nf-text-label block text-(--text-secondary)";

export default function FeedForecastPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const farm = useFeedFarm();
  const farmId = farm.farmId;

  const [view, setView] = useState<ForecastView>("CUSTOM");
  // "" = the API's default: planning date = the farm's today (D16), from/to = the view's own range.
  const [planningDate, setPlanningDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [periods, setPeriods] = useState<PeriodOption[] | null>(null);
  const [periodsFailed, setPeriodsFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"forecast" | "stages">("forecast");

  useEffect(() => {
    if (view !== "PERIOD" || !farmId) {
      setPeriods(null);
      setPeriodsFailed(false);
      return;
    }
    let cancelled = false;
    setPeriodsFailed(false);
    api
      .get(`/feed-forecast/periods?${new URLSearchParams({ farmId }).toString()}`)
      .then((res) => {
        if (cancelled) return;
        const list = unwrap<PeriodOption[]>(res);
        setPeriods(Array.isArray(list) ? list : []);
        setPeriodsFailed(!Array.isArray(list));
      })
      .catch(() => {
        if (cancelled) return;
        setPeriods([]);
        setPeriodsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId, view, reload]);

  useEffect(() => {
    if (!farmId) {
      setData(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .get(`/feed-forecast?${forecastQueryString({ farmId, view, planningDate, from: dateFrom, to: dateTo, periodId })}`)
      .then((res) => {
        if (!cancelled) setData(unwrap<ForecastData>(res));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || tRef.current("ffFailedToLoad"));
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId, view, planningDate, dateFrom, dateTo, periodId, reload]);

  function changeView(next: ForecastView) {
    setView(next);
    setDateFrom("");
    setDateTo("");
    setPeriodId("");
  }

  // Open question Q9: an admin drafts the July–June year, then edits it in the master.
  async function generatePeriods() {
    const year = businessYearStartOf(planningDate || data?.planningDate || todayIso());
    setGenerating(true);
    setGenerateError("");
    try {
      await api.post("/reporting-period/generate", { business_year_start: year });
      setReload((n) => n + 1);
    } catch (err: any) {
      setGenerateError(err?.message || tRef.current("ffGenerateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  const rows = Array.isArray(data?.rows) ? data!.rows : [];
  const stages = Array.isArray(data?.stages) ? data!.stages : [];
  const flags = Array.isArray(data?.flags) ? data!.flags : [];
  const periodList = Array.isArray(periods) ? periods : [];
  const rangeBeforePlanning = !!data && data.forecastFrom === null;
  const rangeStartsAtPlanning = !!data && data.forecastFrom !== null && data.forecastFrom > data.from;
  // A11: what the inputs show before (and between) answers — displayed, not sent.
  const shownPlanning = planningDate || data?.planningDate || todayIso();
  const shownFrom = dateFrom || data?.from || shownPlanning;
  const shownTo = dateTo || data?.to || addDaysIso(shownFrom, 7);
  const businessYear = businessYearStartOf(shownPlanning);
  const isTenantWorkspace = getActiveWorkspaceScope() === "TENANT";
  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : data?.farm
        ? feedFarmLabel(data.farm)
        : null
    : undefined;
  const noFarms = !farm.isFixed && farm.loaded && farm.farms.length === 0;

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <FeedFarmSelect id="ff-farm" label={t("ffFarm")} farms={farm.farms} farmId={farmId} onChange={farm.setFarmId} fixedLabel={fixedLabel} />
        <div>
          <label className={labelCls} htmlFor="ff-planning">{t("ffPlanningDate")}</label>
          <input id="ff-planning" type="date" value={shownPlanning} onChange={(e) => setPlanningDate(e.target.value)} className="nf-input-sm mt-1.5" style={inputStyle}
            title={data ? (data.timeZone ? t("ffTimeZone", { zone: data.timeZone }) : t("ffServerDay")) : undefined} />
        </div>
        <div>
          <label className={labelCls} htmlFor="ff-view">{t("ffView")}</label>
          <select id="ff-view" value={view} onChange={(e) => changeView(e.target.value as ForecastView)} className="nf-input-sm nf-select mt-1.5" style={inputStyle}>
            {FORECAST_VIEWS.map((v) => <option key={v} value={v}>{t(VIEW_LABEL[v])}</option>)}
          </select>
        </div>
        {view === "PERIOD" ? (
          <div>
            <label className={labelCls} htmlFor="ff-period">{t("ffReportingPeriod")}</label>
            <select id="ff-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="nf-input-sm nf-select mt-1.5" style={inputStyle}>
              <option value="">{t("ffPeriodCovering")}</option>
              {periodList.map((p) => (
                <option key={p.periodId} value={p.periodId}>{t("ffPeriodOption", { code: p.periodCode, from: formatDateShort(p.startDate), to: formatDateShort(p.endDate) })}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className={labelCls} htmlFor="ff-from">{t(view === "DAILY" ? "ffDate" : view === "WEEKLY" ? "ffWeekStart" : "ffDateFrom")}</label>
            <input id="ff-from" type="date" value={shownFrom} onChange={(e) => setDateFrom(e.target.value)} className="nf-input-sm mt-1.5" style={inputStyle} />
          </div>
        )}
        {view === "CUSTOM" && (
          <div>
            <label className={labelCls} htmlFor="ff-to">{t("ffDateTo")}</label>
            <input id="ff-to" type="date" value={shownTo} onChange={(e) => setDateTo(e.target.value)} className="nf-input-sm mt-1.5" style={inputStyle} />
          </div>
        )}
      </div>

      {view === "PERIOD" && !!farmId && periodsFailed && <InlineAlert>{t("ffPeriodsLoadFailed")}</InlineAlert>}
      {view === "PERIOD" && !!farmId && !periodsFailed && periods !== null && periodList.length === 0 && (
        <InlineAlert variant="info">
          <span className="mr-3">{t("ffNoPeriods")}</span>
          <Button size="sm" variant="outline" onClick={generatePeriods} disabled={generating || isTenantWorkspace}>
            {t("ffGeneratePeriods", { year: businessYear })}
          </Button>
          {isTenantWorkspace && <span className="ml-3 text-xs" style={{ color: "var(--text-secondary)" }}>{t("ffGenerateNeedsCompany")}</span>}
          {generateError && <span className="ml-3 text-xs" style={{ color: "var(--danger)" }}>{generateError}</span>}
        </InlineAlert>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
      {rangeBeforePlanning && !error && <InlineAlert variant="info">{t("ffNoteRangeBeforePlanning", { date: formatDateShort(data!.planningDate) })}</InlineAlert>}
      {rangeStartsAtPlanning && !error && <InlineAlert variant="info">{t("ffNoteRangeStartsAtPlanning", { date: formatDateShort(data!.forecastFrom!) })}</InlineAlert>}

      {!farm.loaded ? (
        <LoadingState label={t("ffLoading")} />
      ) : noFarms || (!farmId && !farm.isFixed) ? (
        <EmptyState title={t("ffNoFarms")} />
      ) : error ? null : (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <Tabs
              items={[
                { value: "forecast", label: t("ffTabForecast") },
                { value: "stages", label: t("ffTabStages", { count: stages.length }) },
              ]}
              value={tab}
              onChange={(v) => setTab(v as "forecast" | "stages")}
            />
            {rows.length > 0 && !loading && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{wastageNote(rows, t)}</p>}
          </div>
          {tab === "forecast"
            ? <FeedForecastGrid rows={rows} loading={loading} horizonTo={data?.horizonTo ?? null} t={t} />
            : <FeedForecastStages stages={stages} t={t} />}
          <FeedForecastNotes flags={flags} t={t} />
        </>
      )}
    </div>
  );
}
```

`addDaysIso` is already exported by `feed-format.ts`.

- [ ] **Step 4: Shell and page.** In `inventory-page-shell.tsx`, change the signature to `export function InventoryPageShell({ activeKey, fill = false, children }: { activeKey: InventoryTabKey; fill?: boolean; children: React.ReactNode })` and the final return to:

```tsx
  return (
    // Plan S: a feed screen holds its header and filters still; only its table scrolls.
    <ConsolePage fill={fill}>
      <PageHeader title={title} description={description} sticky={!fill} />
      {children}
    </ConsolePage>
  );
```

In `app/(app)/inventory/feed-forecast/page.tsx`, use `<InventoryPageShell activeKey="feed-forecast" fill>`.

- [ ] **Step 5: Copy** (`en` only). Change these values:

| key | new value |
|---|---|
| `invFeedForecastTitle` | `"Feed Forecast"` |
| `invFeedForecastDesc` | `"Feed on hand, daily use and refill dates for each batch."` |
| `ffNotesTitle` | `"Notes ({{count}})"` |
| `ffFlagHeadsAssumedFlat` | `"Head counts stay at the last posted count."` |
| `ffFlagAsOfPast` | `"Stock as of {{date}}. Batches and stages are as of today ({{today}})."` |
| `ffNoteRangeBeforePlanning` | `"Nothing is forecast before the planning date ({{date}})."` |
| `ffNoteRangeStartsAtPlanning` | `"The forecast starts at the planning date ({{date}})."` |
| `ffServerDay` | `"Server date (no time zone set for this company)."` |
| `ffTimeZone` | `"Time zone: {{zone}}"` |
| `ffFailedToLoad` | `"The forecast could not be loaded."` |
| `ffNoPeriods` | `"No reporting periods yet."` |
| `ffGeneratePeriods` | `"Create July–June {{year}} periods"` |
| `ffGenerateNeedsCompany` | `"Switch to the farm's company to create periods."` |

Delete these keys, which nothing references any more: `ffPrimaryLocation`, `ffSelectFarm`, `ffPickFarmPrompt`, `ffFlagBatchShedUnknown`, `ffFlagNoSiloHoldsItem`, `ffFlagStageChangeProjected`, `ffFlagNoFeedRowSingle`, `ffFlagNoFeedRowRange`, `ffFlagOverlappingSingle`, `ffFlagOverlappingRange`. Add after `ffNotesTitle`:

```ts
    ffFarm: "Farm",
    ffNoFarms: "No farms to show.",
    ffTabForecast: "Forecast",
    ffTabStages: "Stages ({{count}})",
    ffNoteAsOf: "Past planning date",
    ffNoteNoFeedRow: "Days with no feed rate",
    ffNoteOverlap: "Days with two feed rates",
    ffNoteNoSilo: "No silo holds the diet (fed from the store)",
    ffNoteStageChange: "Expected stage changes",
    ffNoteNoShed: "No shed recorded (fed from the store)",
    ffNoteHeads: "Head counts",
    ffNoteDayRange: "{{batchNo}} {{stageCode}} day {{days}} ({{dates}})",
    ffNoteShedItem: "{{shedCode}}: {{itemName}}",
    ffNoteStageChangeItem: "{{batchNo}} to {{stageCode}} on {{date}}",
```

Then run `grep -rn "ffPrimaryLocation\|ffPickFarmPrompt\|ffFlagBatchShedUnknown\|ffSelectFarm" apps/web/src apps/web/specs` → no output.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns=feed-forecast 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.

- [ ] **Step 7: Commit and write the ledger line**

```bash
git commit -m "feat(feed-forecast): fixed-height screen with tabs, grouped notes and shown defaults (review A3, A6, A11, C)

The forecast screen scrolled as a whole, fetched its own farm list, listed
every note as its own machine-written sentence, and showed a pink
'Select a farm' box with empty date inputs. It now sits in a fixed-height
page (only the table scrolls), takes the farm from the shared hook, switches
Forecast | Stages in the one scrolling area, collects notes in a collapsed
panel grouped by kind with counts, and shows the planning date and range at
once. Copy rewritten in plain farm-office English.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/components/console/inventory/feed-forecast-notes.tsx apps/web/src/components/console/inventory/feed-forecast-panel.tsx apps/web/src/components/console/inventory/inventory-page-shell.tsx "apps/web/src/app/(app)/inventory/feed-forecast/page.tsx" apps/web/specs/feed-forecast-panel.spec.tsx apps/web/specs/feed-forecast-notes.spec.tsx apps/web/src/utils/translations.ts
```

---

### Task 13: D26 + D24 (web) — Inventory → Requisitions with Submit for approval; the Feed Alerts tab goes

**Files:**
- Create: `apps/web/src/components/console/inventory/requisition-labels.ts`
- Create: `apps/web/src/components/console/inventory/requisitions-panel.tsx`
- Create: `apps/web/src/app/(app)/inventory/requisitions/page.tsx`
- Modify (rewrite as redirects): `apps/web/src/app/(app)/inventory/feed-requisitions/page.tsx`, `apps/web/src/app/(app)/inventory/feed-alerts/page.tsx`
- Modify: `apps/web/src/components/console/inventory/inventory-page-shell.tsx` (sections, titles)
- Modify: `apps/web/src/components/console/inventory/feed-format.ts` (drop `MONTHS` and `formatDate`, whose only user goes)
- Delete: `apps/web/src/components/console/inventory/feed-requisition-panel.tsx`, `apps/web/src/components/console/inventory/feed-alerts-panel.tsx`, `apps/web/specs/feed-requisition-panel.spec.tsx`, `apps/web/specs/feed-alerts-panel.spec.tsx`
- Create: `apps/web/specs/requisitions-panel.spec.tsx`, `apps/web/specs/requisition-labels.spec.ts`
- Modify: `apps/web/src/utils/translations.ts` (en)

**Interfaces:**
- Consumes (Task 7): `GET /feed-requisition?farmId=&status=` (rows carry `approval_request_id`), `GET /feed-requisition/:id`, `PUT /feed-requisition/:id`, `POST /feed-requisition/auto-draft`, `POST /feed-requisition/:id/submit` `{ remarks, lines }`. Consumes (Tasks 9, 10): `useFeedFarm`, `FeedFarmSelect`, `ScrollTable`, `data-fill-body`, `InventoryPageShell fill`.
- Produces: `requisition-labels.ts`:
  - `export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger" | "info"`
  - `REQ_STATUS_LABEL`, `REQ_TYPE_LABEL`, `PRIORITY_LABEL`, `FEED_TYPE_LABEL`, `SOURCE_LABEL`, `PURPOSE_LABEL`, `SUPPLY_LABEL`: code → translation key, or `{ key, variant }` for the badge maps
  - `labelOf(map, code, t): string` (an unknown code is humanized, `SOME_CODE` → `Some Code`, never shown raw; A8)
  - `variantOf(map, code): BadgeVariant`
  - `humanizeCode(code: string): string`
  Task 15 reuses `PRIORITY_LABEL` for alert priorities.
- Produces: `export default function RequisitionsPanel()`, `export interface RequisitionView` (Task 14 uses it), and `export function needsRemarks(recommended: number | null, requested: number): boolean` (checkpoint 18, kept from the old panel).
- Produces: route `/inventory/requisitions`. `?id=<requisition_id>` opens that requisition (the Approvals inbox links here, Task 16). `/inventory/feed-requisitions` redirects here, and `/inventory/feed-alerts` redirects to `/alerts`.
- The Requisitions screen links a submitted requisition to `/approvals/<pending|approved|rejected>?request=<approval_request_id>` (Task 16 opens it).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/specs/requisition-labels.spec.ts
import { PRIORITY_LABEL, REQ_STATUS_LABEL, humanizeCode, labelOf, variantOf } from '../src/components/console/inventory/requisition-labels';

const t = (key: string) => `T:${key}`;

describe('requisition labels — no raw codes on screen (review A8)', () => {
  it('labels known codes through t() and humanizes unknown ones', () => {
    expect(labelOf(REQ_STATUS_LABEL, 'PENDING_APPROVAL', t)).toBe('T:reqStatusPending');
    expect(labelOf(PRIORITY_LABEL, 'CRITICAL_FIRST_PRIORITY', t)).toBe('T:prioUrgent');
    expect(labelOf(REQ_STATUS_LABEL, 'ON_HOLD_BY_MILL', t)).toBe('On Hold By Mill');
    expect(labelOf(REQ_STATUS_LABEL, null, t)).toBe('—');
    expect(humanizeCode('FEED_FORECAST')).toBe('Feed Forecast');
  });
  it('colours status and priority badges', () => {
    expect(variantOf(REQ_STATUS_LABEL, 'APPROVED')).toBe('success');
    expect(variantOf(REQ_STATUS_LABEL, 'REJECTED')).toBe('danger');
    expect(variantOf(PRIORITY_LABEL, 'WARNING')).toBe('warning');
    expect(variantOf(PRIORITY_LABEL, 'SOMETHING')).toBe('neutral');
  });
});
```

```tsx
// apps/web/specs/requisitions-panel.spec.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RequisitionsPanel, { needsRemarks } from '../src/components/console/inventory/requisitions-panel';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
let mockFarm: any;
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({ useFeedFarm: () => mockFarm }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

const listRow = {
  requisition_id: 'req-1', req_no: 'REQ-VIL100-2026-00004', requisition_type: 'FEED_FORECAST', status: 'AUTO_DRAFT', priority: 'CRITICAL',
  required_date: '2099-09-23', submission_deadline: '2099-09-26', line_count: 2, requested_kg: '15000.0000', approval_request_id: null,
};
const view = {
  requisition_id: 'req-1', req_no: 'REQ-VIL100-2026-00004', requisition_type: 'FEED_FORECAST', source: 'AUTO_FORECAST',
  purpose: 'INTERNAL_TRANSFER', supply_source: 'MILL', status: 'AUTO_DRAFT', priority: 'CRITICAL', approval_request_id: null,
  production_date: '2099-09-27', submission_deadline: '2099-09-26', remarks: null, truck_target_kg: 30000,
  lines: [
    { line_id: 'L1', line_seq: 1, destination_code: 'VIL100/SILO-001', item_code: 'FEED-R1', item_name: 'Weaner Diet R1', feed_type: 'BULK',
      is_next_diet: false, days_before_diet_change: null, system_balance_kg: '1500.0000', daily_requirement_kg: '2000.0000', days_remaining: 0,
      unrounded_need_kg: '4500.0000', recommended_qty_kg: '6000.0000', quantity: '6000.0000', bag_count: null, proposed_delivery_date: '2099-09-23', needs_silo_changeover: false },
    { line_id: 'L2', line_seq: 2, destination_code: 'VIL100/SILO-002', item_code: 'FEED-R2', item_name: 'Weaner Diet R2', feed_type: 'BULK',
      is_next_diet: true, days_before_diet_change: 3, system_balance_kg: '1000.0000', daily_requirement_kg: '2500.0000', days_remaining: null,
      unrounded_need_kg: '9000.0000', recommended_qty_kg: '9000.0000', quantity: '9000.0000', bag_count: null, proposed_delivery_date: '2099-09-26', needs_silo_changeover: false },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/inventory/requisitions');
  mockFarm = { farmId: 'farm-vil', setFarmId: jest.fn(), farms: [{ farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co', companyName: 'T' }], loaded: true, failed: false, isFixed: false, fixedFarm: null };
  get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: view } : { data: [listRow] }));
  post.mockImplementation(async (url: string) =>
    url === '/feed-requisition/auto-draft' ? { data: { requisitionId: 'req-1', requisition: view } } : { data: { ...view, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' } });
  put.mockResolvedValue({ data: view });
});

describe('needsRemarks — checkpoint 18', () => {
  it('matches the API rule', () => {
    expect(needsRemarks(6000, 9000)).toBe(true);
    expect(needsRemarks(6000, 7200)).toBe(false);
    expect(needsRemarks(null, 50000)).toBe(false);
  });
});

describe('RequisitionsPanel (D26)', () => {
  it("lists the farm's requisitions with labels, not codes, and DD/MM/YY dates (A8, A9)", async () => {
    render(<RequisitionsPanel />);
    const table = await screen.findByRole('table', { name: 'rqListLabel' });
    expect(get).toHaveBeenCalledWith('/feed-requisition?farmId=farm-vil');
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['REQ-VIL100-2026-00004', 'reqTypeForecast', 'reqStatusAutoDraft', 'prioCritical', '23/09/99', '26/09/99', '2', '15,000']);
    expect(screen.queryByText('FEED_FORECAST')).toBeNull();
    expect(screen.getByLabelText('rqType')).toBeTruthy();
  });

  it('filters by status through the API', async () => {
    render(<RequisitionsPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('rqShow'), { target: { value: 'PENDING_APPROVAL' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition?farmId=farm-vil&status=PENDING_APPROVAL'));
  });

  it('drafts from the forecast and opens it with Save and Submit for approval, and no approve or reject (D25)', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-vil' });
    expect(screen.getByRole('button', { name: 'rqSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve|reject/i })).toBeNull();
    const lines = screen.getByRole('table', { name: 'rqLinesLabel' });
    expect(within(lines).getAllByRole('columnheader')).toHaveLength(14);
    expect(within(lines).getAllByText('reqFeedBulk')).toHaveLength(2);
  });

  it('asks for remarks when a quantity moves more than 20 %, and submits with them', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    fireEvent.change(screen.getByLabelText('rqRequestedFor:{"line":1}'), { target: { value: '9000' } });
    expect(screen.getByText('rqRemarksRequired')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('rqRemarks'), { target: { value: 'Extra pigs arriving' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqSubmit' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/req-1/submit', { remarks: 'Extra pigs arriving', lines: [{ line_id: 'L1', quantity_kg: 9000 }] }));
    expect(await screen.findByText('rqSubmitted')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'rqOpenApproval' }).getAttribute('href')).toBe('/approvals/pending?request=ar-1');
    expect(screen.queryByRole('button', { name: 'rqSubmit' })).toBeNull();
  });

  it('saves an edited delivery date', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    fireEvent.change(screen.getByLabelText('rqDeliveryFor:{"line":1}'), { target: { value: '2099-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqSave' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-requisition/req-1', { remarks: '', lines: [{ line_id: 'L1', proposed_delivery_date: '2099-09-30' }] }));
  });

  it('opens the requisition named in the address (the Approvals inbox links here)', async () => {
    window.history.replaceState(null, '', '/inventory/requisitions?id=req-1');
    render(<RequisitionsPanel />);
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(get).toHaveBeenCalledWith('/feed-requisition/req-1');
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns="requisition" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL (modules missing).

- [ ] **Step 2: Labels**

```ts
// apps/web/src/components/console/inventory/requisition-labels.ts
/**
 * Words for the codes the requisition and alert APIs send (review A8: the
 * screens showed FEED_FORECAST, AUTO_DRAFT, CRITICAL_FIRST_PRIORITY). A code
 * with no entry is humanized rather than shown raw, so a new status the API
 * starts sending reads "On Hold" until it gets its own label.
 */
import type { TranslationKeys } from "@/utils/translations";

export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
type Entry = TranslationKeys | { key: TranslationKeys; variant: BadgeVariant };
type LabelMap = Record<string, Entry>;
type Translate = (key: any, vars?: any) => string;

export const REQ_STATUS_LABEL: LabelMap = {
  AUTO_DRAFT: { key: "reqStatusAutoDraft", variant: "neutral" },
  DRAFT: { key: "reqStatusDraft", variant: "neutral" },
  PENDING_APPROVAL: { key: "reqStatusPending", variant: "warning" },
  APPROVED: { key: "reqStatusApproved", variant: "success" },
  REJECTED: { key: "reqStatusRejected", variant: "danger" },
  CANCELLED: { key: "reqStatusCancelled", variant: "neutral" },
};

export const PRIORITY_LABEL: LabelMap = {
  CRITICAL_FIRST_PRIORITY: { key: "prioUrgent", variant: "danger" },
  CRITICAL: { key: "prioCritical", variant: "danger" },
  WARNING: { key: "prioWarning", variant: "warning" },
  INFO: { key: "prioInfo", variant: "info" },
};

export const REQ_TYPE_LABEL: LabelMap = { FEED_FORECAST: "reqTypeForecast", MANUAL: "reqTypeManual" };
export const FEED_TYPE_LABEL: LabelMap = { BULK: "reqFeedBulk", BAGGED: "reqFeedBagged" };
export const SOURCE_LABEL: LabelMap = {
  AUTO_FORECAST: "reqSourceForecast", MANUAL_ENTRY: "reqSourceManual", STOCK_TAKE_TRIGGERED: "reqSourceStockTake", DIET_CHANGE_UPCOMING: "reqSourceDietChange",
};
export const PURPOSE_LABEL: LabelMap = { INTERNAL_TRANSFER: "reqPurposeTransfer" };
export const SUPPLY_LABEL: LabelMap = { MILL: "reqSupplyMill" };

export function humanizeCode(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function labelOf(map: LabelMap, code: string | null | undefined, t: Translate): string {
  if (!code) return "—";
  const entry = map[code];
  if (!entry) return humanizeCode(code);
  return t(typeof entry === "string" ? entry : entry.key);
}

export function variantOf(map: LabelMap, code: string | null | undefined): BadgeVariant {
  const entry = code ? map[code] : undefined;
  return entry && typeof entry !== "string" ? entry.variant : "neutral";
}
```

- [ ] **Step 3: Panel**

```tsx
// apps/web/src/components/console/inventory/requisitions-panel.tsx
"use client";

/**
 * Inventory → Requisitions (D26; was Feed Requisitions, Plan B Task 10). Type
 * Feed for now. The farm drafts a feed requisition from the forecast (Engine
 * Step 9, POST /feed-requisition/auto-draft) or by hand (Task 14), edits
 * Requested Qty and the delivery date, writes remarks, and submits it for
 * approval (D25): the decision is taken in the Approvals inbox, so this
 * screen has no approve or reject — a submitted requisition links to its
 * approval instead. The 20 % rule and the deadline rule are mirrored here only
 * to say so before the click; the API enforces both (checkpoints 18, 22) and
 * its message is shown as it comes. Fixed-height page: the list, or the open
 * requisition's lines, is the one scrolling table (review C).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { todayIso, unwrap } from "./feed-format";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import {
  FEED_TYPE_LABEL, PRIORITY_LABEL, PURPOSE_LABEL, REQ_STATUS_LABEL, REQ_TYPE_LABEL, SOURCE_LABEL, SUPPLY_LABEL, labelOf, variantOf,
} from "./requisition-labels";
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
  approval_request_id: string | null;
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

export interface RequisitionView {
  requisition_id: string;
  req_no: string;
  requisition_type: string | null;
  source: string | null;
  purpose: string | null;
  supply_source: string | null;
  status: string;
  priority: string | null;
  approval_request_id: string | null;
  production_date: string | null;
  submission_deadline: string | null;
  remarks: string | null;
  truck_target_kg: number;
  lines: Line[];
}

interface LineEdit {
  quantity?: string;
  date?: string;
}

/** Checkpoint 18, as the API applies it (feed-requisition.rules.ts deviationNeedsRemarks). */
export function needsRemarks(recommended: number | null, requested: number): boolean {
  if (recommended === null) return false;
  if (recommended <= 0) return requested > 0;
  return Math.abs(requested - recommended) / recommended > 0.2 + 1e-9;
}

/** D25: what the farm may still change — mirrors isEditableFeedRequisition in the API. */
const isEditable = (v: { status: string; approval_request_id: string | null }) =>
  v.status === "AUTO_DRAFT" || v.status === "DRAFT" || (v.status === "PENDING_APPROVAL" && !v.approval_request_id);

/** The inbox tab a submitted requisition's approval sits in. */
function approvalHref(v: { status: string; approval_request_id: string | null }): string | null {
  if (!v.approval_request_id) return null;
  const tab = v.status === "APPROVED" ? "approved" : v.status === "REJECTED" ? "rejected" : "pending";
  return `/approvals/${tab}?request=${v.approval_request_id}`;
}

const STATUS_FILTER = ["AUTO_DRAFT", "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"];
const LINE_COLUMNS = [
  "rqColLine", "rqColDestination", "rqColItem", "rqColFeedType", "rqColNextDiet", "rqColDaysBeforeChange", "rqColSystemBalance",
  "rqColDailyRequirement", "rqColDaysRemaining", "rqColUnroundedNeed", "rqColRecommended", "rqColRequested", "rqColBagCount", "rqColDelivery",
] as const;
const LIST_COLUMNS = ["rqColReqNo", "rqColType", "rqColStatus", "rqColPriority", "rqColRequiredBy", "rqColDeadline", "rqColLines", "rqColKg"] as const;
const RIGHT = new Set<string>([
  "rqColLine", "rqColDaysBeforeChange", "rqColSystemBalance", "rqColDailyRequirement", "rqColDaysRemaining", "rqColUnroundedNeed",
  "rqColRecommended", "rqColRequested", "rqColBagCount", "rqColLines", "rqColKg",
]);

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const kg = (v: string | number | null | undefined) => {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const SMALL_BADGE = "px-1.5 py-0 text-[10px]";

export default function RequisitionsPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const farm = useFeedFarm();
  const farmId = farm.farmId;
  const [type, setType] = useState("FEED");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<ListRow[]>([]);
  const [selected, setSelected] = useState<RequisitionView | null>(null);
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const show = (view: RequisitionView | null) => {
    setSelected(view);
    setEdits({});
    setRemarks(view?.remarks ?? "");
  };

  const loadList = useCallback(async () => {
    if (!farmId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ farmId });
      if (status) params.set("status", status);
      const list = unwrap<ListRow[]>(await api.get(`/feed-requisition?${params.toString()}`));
      setRows(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || tRef.current("rqLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [farmId, status]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Opened from the Approvals inbox (Task 16): /inventory/requisitions?id=<requisition>.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = new URLSearchParams(window.location.search).get("id");
    } catch {
      id = null;
    }
    if (!id) return;
    api
      .get(`/feed-requisition/${id}`)
      .then((res) => {
        const view = unwrap<RequisitionView>(res);
        setSelected(view);
        setEdits({});
        setRemarks(view?.remarks ?? "");
      })
      .catch((err: any) => setError(err?.message || tRef.current("rqLoadFailed")));
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err: any) {
      setError(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const openRequisition = (id: string) => run(async () => show(unwrap<RequisitionView>(await api.get(`/feed-requisition/${id}`))));

  const draftFromForecast = () =>
    run(async () => {
      const result = unwrap<{ requisition: RequisitionView | null }>(await api.post("/feed-requisition/auto-draft", { farmId }));
      if (result.requisition) show(result.requisition);
      else setNotice(tRef.current("rqNothingToOrder"));
      await loadList();
    });

  const requestedOf = (line: Line) => (edits[line.line_id]?.quantity !== undefined ? Number(edits[line.line_id].quantity) : Number(line.quantity));
  const dateOf = (line: Line) => edits[line.line_id]?.date ?? line.proposed_delivery_date ?? "";
  const setQuantity = (lineId: string, value: string) => setEdits((cur) => ({ ...cur, [lineId]: { ...cur[lineId], quantity: value } }));
  const setDate = (lineId: string, value: string) => setEdits((cur) => ({ ...cur, [lineId]: { ...cur[lineId], date: value } }));
  const lineEdits = () =>
    Object.entries(edits).map(([line_id, edit]) => ({
      line_id,
      ...(edit.quantity !== undefined ? { quantity_kg: Number(edit.quantity) } : {}),
      ...(edit.date !== undefined ? { proposed_delivery_date: edit.date } : {}),
    }));

  const editable = !!selected && isEditable(selected);
  const lines = Array.isArray(selected?.lines) ? selected!.lines : [];
  const deviating = lines.filter((l) => needsRemarks(num(l.recommended_qty_kg), requestedOf(l)));
  const late = !!selected?.submission_deadline && todayIso() > selected.submission_deadline;
  const remarksMissing = editable && (deviating.length > 0 || late) && !remarks.trim();
  // Requisition §1 rows 26–27: the requested bulk total against the truck target — trips, not a cap (checkpoint 17).
  const bulkTotal = lines.filter((l) => l.feed_type === "BULK").reduce((sum, l) => sum + requestedOf(l), 0);
  const trips = selected && bulkTotal > 0 ? Math.ceil(bulkTotal / selected.truck_target_kg) : 0;
  const href = selected ? approvalHref(selected) : null;

  const save = () =>
    run(async () => {
      show(unwrap<RequisitionView>(await api.put(`/feed-requisition/${selected!.requisition_id}`, { remarks, lines: lineEdits() })));
      setNotice(tRef.current("rqSaved"));
    });

  const submit = () =>
    run(async () => {
      show(unwrap<RequisitionView>(await api.post(`/feed-requisition/${selected!.requisition_id}/submit`, { remarks, lines: lineEdits() })));
      setNotice(tRef.current("rqSubmitted"));
      await loadList();
    });

  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : null
    : undefined;

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <FeedFarmSelect id="rq-farm" label={t("rqFarm")} farms={farm.farms} farmId={farmId} fixedLabel={fixedLabel}
            onChange={(id) => { farm.setFarmId(id); show(null); }} />
          <Field label={t("rqType")} htmlFor="rq-type">
            <select id="rq-type" className="nf-input-sm nf-select" style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="FEED">{t("rqTypeFeed")}</option>
            </select>
          </Field>
          <Field label={t("rqShow")} htmlFor="rq-status">
            <select id="rq-status" className="nf-input-sm nf-select" style={inputStyle} value={status} onChange={(e) => { setStatus(e.target.value); show(null); }}>
              <option value="">{t("rqShowAll")}</option>
              {STATUS_FILTER.map((s) => <option key={s} value={s}>{labelOf(REQ_STATUS_LABEL, s, t)}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={draftFromForecast} disabled={!farmId || busy}>{t("rqDraftFromForecast")}</Button>
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <InlineAlert variant="success">{notice}</InlineAlert>}

      {selected ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => show(null)}><ArrowLeft className="h-3.5 w-3.5" /> {t("rqBack")}</Button>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{selected.req_no}</h2>
            <Badge variant={variantOf(REQ_STATUS_LABEL, selected.status)}>{labelOf(REQ_STATUS_LABEL, selected.status, t)}</Badge>
            {selected.priority && <Badge variant={variantOf(PRIORITY_LABEL, selected.priority)}>{labelOf(PRIORITY_LABEL, selected.priority, t)}</Badge>}
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("rqHeaderLine", {
                type: labelOf(REQ_TYPE_LABEL, selected.requisition_type, t),
                source: labelOf(SOURCE_LABEL, selected.source, t),
                purpose: labelOf(PURPOSE_LABEL, selected.purpose, t),
                supply: labelOf(SUPPLY_LABEL, selected.supply_source, t),
                deadline: formatDateShort(selected.submission_deadline),
                production: formatDateShort(selected.production_date),
              })}
            </span>
          </div>
          <p className="shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>
            {t("rqFarmTotal", { total: bulkTotal.toLocaleString("en-US"), target: selected.truck_target_kg.toLocaleString("en-US"), trips })}
          </p>
          <ScrollTable label={t("rqLinesLabel")}>
            <thead>
              <tr>{LINE_COLUMNS.map((c) => <th key={c} scope="col" className={cn(TH, RIGHT.has(c) && "text-right")}>{t(c)}</th>)}</tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.line_id}>
                  <td className={cn(TD, NUM)}>{line.line_seq}</td>
                  <td className={TD}>
                    {line.destination_code ?? "—"}
                    {line.needs_silo_changeover && <Badge variant="warning" className={cn("ml-1.5", SMALL_BADGE)}>{t("rqChangeover")}</Badge>}
                  </td>
                  <td className={TD}>{line.item_code} — {line.item_name}</td>
                  <td className={TD}>{labelOf(FEED_TYPE_LABEL, line.feed_type, t)}</td>
                  <td className={TD}>{line.is_next_diet ? t("rqYes") : t("rqNo")}</td>
                  <td className={cn(TD, NUM)}>{line.days_before_diet_change ?? "—"}</td>
                  <td className={cn(TD, NUM)}>{kg(line.system_balance_kg)}</td>
                  <td className={cn(TD, NUM)}>{kg(line.daily_requirement_kg)}</td>
                  <td className={cn(TD, NUM)}>{line.days_remaining ?? "—"}</td>
                  <td className={cn(TD, NUM)}>{kg(line.unrounded_need_kg)}</td>
                  <td className={cn(TD, NUM)}>{kg(line.recommended_qty_kg)}</td>
                  <td className={cn(TD, NUM)}>
                    {editable ? (
                      <input type="number" min={0} step="any" className="nf-input-sm w-28 px-2 text-right" style={inputStyle}
                        aria-label={t("rqRequestedFor", { line: line.line_seq })}
                        value={edits[line.line_id]?.quantity ?? String(Number(line.quantity))}
                        onChange={(e) => setQuantity(line.line_id, e.target.value)} />
                    ) : kg(line.quantity)}
                  </td>
                  <td className={cn(TD, NUM)}>{line.bag_count ?? "—"}</td>
                  <td className={TD}>
                    {editable ? (
                      <input type="date" className="nf-input-sm w-36 px-2" style={inputStyle}
                        aria-label={t("rqDeliveryFor", { line: line.line_seq })}
                        value={dateOf(line)} onChange={(e) => setDate(line.line_id, e.target.value)} />
                    ) : formatDateShort(line.proposed_delivery_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <div className="flex shrink-0 flex-col gap-2">
            <Field label={t("rqRemarks")} htmlFor="rq-remarks">
              <textarea id="rq-remarks" className="nf-input w-full px-2 py-1" style={inputStyle} rows={2}
                value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!editable} />
            </Field>
            {remarksMissing && <p className="text-xs" style={{ color: "var(--danger)" }}>{t("rqRemarksRequired")}</p>}
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={save} disabled={busy}>{t("rqSave")}</Button>
                <Button size="sm" onClick={submit} disabled={busy || remarksMissing}>{t("rqSubmit")}</Button>
              </div>
            ) : href ? (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {selected.status === "PENDING_APPROVAL" && <span className="mr-2">{t("rqWaiting")}</span>}
                <a href={href} className="font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rqOpenApproval")}</a>
              </p>
            ) : null}
          </div>
        </>
      ) : loading ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("rqLoading")}</div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("rqNone")}</div>
      ) : (
        <ScrollTable label={t("rqListLabel")}>
          <thead>
            <tr>{LIST_COLUMNS.map((c) => <th key={c} scope="col" className={cn(TH, RIGHT.has(c) && "text-right")}>{t(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.requisition_id} className="cursor-pointer" onClick={() => openRequisition(r.requisition_id)}>
                <td className={cn(TD, "font-medium")}>{r.req_no}</td>
                <td className={TD}>{labelOf(REQ_TYPE_LABEL, r.requisition_type, t)}</td>
                <td className={TD}><Badge variant={variantOf(REQ_STATUS_LABEL, r.status)} className={SMALL_BADGE}>{labelOf(REQ_STATUS_LABEL, r.status, t)}</Badge></td>
                <td className={TD}>{r.priority ? <Badge variant={variantOf(PRIORITY_LABEL, r.priority)} className={SMALL_BADGE}>{labelOf(PRIORITY_LABEL, r.priority, t)}</Badge> : "—"}</td>
                <td className={TD}>{formatDateShort(r.required_date)}</td>
                <td className={TD}>{formatDateShort(r.submission_deadline)}</td>
                <td className={cn(TD, NUM)}>{r.line_count}</td>
                <td className={cn(TD, NUM)}>{kg(r.requested_kg)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Routes and shell**

```tsx
// apps/web/src/app/(app)/inventory/requisitions/page.tsx
"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import RequisitionsPanel from "@/components/console/inventory/requisitions-panel";

export default function InventoryRequisitionsPage() {
  return (
    <InventoryPageShell activeKey="requisitions" fill>
      <RequisitionsPanel />
    </InventoryPageShell>
  );
}
```

Replace `apps/web/src/app/(app)/inventory/feed-requisitions/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

/** D26: Inventory → Feed Requisitions became Inventory → Requisitions; old links and bookmarks still land. */
export default function FeedRequisitionsMoved() {
  redirect("/inventory/requisitions");
}
```

Replace `apps/web/src/app/(app)/inventory/feed-alerts/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

/** D24: feed alerts are shown on the one Alerts page; old links and bookmarks still land there. */
export default function FeedAlertsMoved() {
  redirect("/alerts");
}
```

In `inventory-page-shell.tsx`, replace the two `INVENTORY_SECTIONS` entries

```ts
  { key: "feed-requisitions", href: "/inventory/feed-requisitions", labelKey: "invFeedRequisitions" },
  { key: "feed-alerts", href: "/inventory/feed-alerts", labelKey: "invFeedAlerts" },
```

with

```ts
  { key: "requisitions", href: "/inventory/requisitions", labelKey: "invRequisitions" },
```

In the `title` chain, replace the two lines for `feed-requisitions` and `feed-alerts` with `activeKey === "requisitions" ? t("invRequisitionsTitle") :`. In the `description` chain, replace the same two lines with `activeKey === "requisitions" ? t("invRequisitionsDesc") :`.

Delete the four old files: `git rm -q apps/web/src/components/console/inventory/feed-requisition-panel.tsx apps/web/src/components/console/inventory/feed-alerts-panel.tsx apps/web/specs/feed-requisition-panel.spec.tsx apps/web/specs/feed-alerts-panel.spec.tsx`.

In `feed-format.ts`, delete `MONTHS` and `formatDate` with its comment. Then `grep -rn "formatDate(" apps/web/src` must show no call of the removed function (calls of `formatDateShort(` do not match that pattern).

- [ ] **Step 5: Copy** (`en` only). Every key starting with `frq` or `fal`, and `invFeedRequisitions*` / `invFeedAlerts*`, exists in the `en` object only. Check that first: `grep -c "frqFarm\|falFarm" apps/web/src/utils/translations.ts` must print `2`. Then run this script, saved as `$SCRATCH/drop-dead-keys.py` (`$SCRATCH` = the session scratchpad directory):

```python
import re
p = 'apps/web/src/utils/translations.ts'
lines = open(p).read().split('\n')
dead = re.compile(r'^    (frq[A-Z]\w*|fal[A-Z]\w*|invFeedRequisitions\w*|invFeedAlerts\w*): ')
out = [l for l in lines if not dead.match(l) and l != '    // Console — Inventory — Feed Alerts panel']
print('removed', len(lines) - len(out))
open(p, 'w').write('\n'.join(out))
```

Run it with `python3 $SCRATCH/drop-dead-keys.py` from the repo root. It prints `removed` followed by a number between 60 and 90. Then add after `invFeedForecastDesc`:

```ts
    invRequisitions: "Requisitions",
    invRequisitionsTitle: "Requisitions",
    invRequisitionsDesc: "Feed orders to the mill, drafted from the forecast or entered by hand.",
    rqFarm: "Farm",
    rqType: "Type",
    rqTypeFeed: "Feed",
    rqShow: "Show",
    rqShowAll: "All",
    rqDraftFromForecast: "Draft from forecast",
    rqNothingToOrder: "Nothing to order: stock covers the forecast.",
    rqLoading: "Loading requisitions…",
    rqNone: "No requisitions for this farm.",
    rqLoadFailed: "Requisitions could not be loaded.",
    rqActionFailed: "That did not work. Try again.",
    rqListLabel: "Requisitions",
    rqLinesLabel: "Requisition lines",
    rqColReqNo: "Requisition",
    rqColType: "Type",
    rqColStatus: "Status",
    rqColPriority: "Priority",
    rqColRequiredBy: "Required by",
    rqColDeadline: "Submit by",
    rqColLines: "Lines",
    rqColKg: "Requested (kg)",
    rqBack: "All requisitions",
    rqHeaderLine: "{{type}} · {{source}} · {{purpose}} from {{supply}} · submit by {{deadline}} · production {{production}}",
    rqFarmTotal: "Bulk total {{total}} kg: {{trips}} truck(s) of {{target}} kg.",
    rqColLine: "Line",
    rqColDestination: "Silo / store",
    rqColItem: "Feed",
    rqColFeedType: "Bulk / bagged",
    rqColNextDiet: "Next diet",
    rqColDaysBeforeChange: "Days to diet change",
    rqColSystemBalance: "In stock (kg)",
    rqColDailyRequirement: "Daily use (kg)",
    rqColDaysRemaining: "Days left",
    rqColUnroundedNeed: "Needed (kg)",
    rqColRecommended: "Recommended (kg)",
    rqColRequested: "Requested (kg)",
    rqColBagCount: "Bags",
    rqColDelivery: "Deliver by",
    rqRequestedFor: "Requested kg, line {{line}}",
    rqDeliveryFor: "Deliver by, line {{line}}",
    rqChangeover: "No silo holds this feed",
    rqYes: "Yes",
    rqNo: "No",
    rqRemarks: "Remarks",
    rqRemarksRequired: "Add remarks: a quantity is more than 20% off the recommendation, or the deadline has passed.",
    rqSave: "Save",
    rqSubmit: "Submit for approval",
    rqSaved: "Saved.",
    rqSubmitted: "Submitted for approval.",
    rqWaiting: "Waiting for approval.",
    rqOpenApproval: "Open in Approvals",
    reqStatusAutoDraft: "Draft (forecast)",
    reqStatusDraft: "Draft",
    reqStatusPending: "Waiting for approval",
    reqStatusApproved: "Approved",
    reqStatusRejected: "Rejected",
    reqStatusCancelled: "Cancelled",
    reqTypeForecast: "From forecast",
    reqTypeManual: "Manual",
    reqFeedBulk: "Bulk",
    reqFeedBagged: "Bagged",
    reqSourceForecast: "Forecast",
    reqSourceManual: "Manual entry",
    reqSourceStockTake: "Stock take",
    reqSourceDietChange: "Diet change",
    reqPurposeTransfer: "Internal transfer",
    reqSupplyMill: "Mill",
    prioUrgent: "Urgent",
    prioCritical: "Critical",
    prioWarning: "Warning",
    prioInfo: "Info",
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns="requisition|feed-" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors. A leftover reference to a deleted key or file shows here.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.
Run: `grep -rn "feed-requisitions\|feed-alerts\|FeedAlertsPanel\|FeedRequisitionPanel" apps/web/src apps/web/specs | grep -v "app/(app)/inventory/feed-"` → no output.

- [ ] **Step 7: Commit and write the ledger line**

```bash
git commit -m "feat(web): Inventory → Requisitions with Submit for approval; Feed Alerts tab removed (D24, D25, D26, review A8, A9)

Rishi's decisions of 27 Sep: one Requisitions screen (type Feed for now)
instead of Feed Requisitions, decided in the Approvals inbox rather than by
approve/reject buttons on the screen, and feed alerts on the one Alerts
page. The new screen drafts, edits and submits, then links to the approval;
type, status and priority are labelled badges instead of codes, dates are
DD/MM/YY, and the list or the open requisition's lines is the one scrolling
table. The old routes redirect; the old panels, specs and copy are removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/components/console/inventory/requisition-labels.ts apps/web/src/components/console/inventory/requisitions-panel.tsx "apps/web/src/app/(app)/inventory/requisitions/page.tsx" "apps/web/src/app/(app)/inventory/feed-requisitions/page.tsx" "apps/web/src/app/(app)/inventory/feed-alerts/page.tsx" apps/web/src/components/console/inventory/inventory-page-shell.tsx apps/web/src/components/console/inventory/feed-format.ts apps/web/src/components/console/inventory/feed-requisition-panel.tsx apps/web/src/components/console/inventory/feed-alerts-panel.tsx apps/web/specs/feed-requisition-panel.spec.tsx apps/web/specs/feed-alerts-panel.spec.tsx apps/web/specs/requisitions-panel.spec.tsx apps/web/specs/requisition-labels.spec.ts apps/web/src/utils/translations.ts
```

---

### Task 14: D26 — a requisition entered by hand

**Files:**
- Create: `apps/web/src/components/console/inventory/requisition-new-dialog.tsx`
- Create: `apps/web/specs/requisition-new-dialog.spec.tsx`
- Modify: `apps/web/src/components/console/inventory/requisitions-panel.tsx` (one import, one state, the "New requisition" button, the dialog element)
- Modify: `apps/web/src/utils/translations.ts` (en)

**Interfaces:**
- Consumes: `POST /feed-requisition` with `{ farmId, remarks?, lines: [{ destination_location_id, item_id, quantity_kg, proposed_delivery_date }] }` (Plan B `createManual`; it answers the requisition view). `GET /location?farmId=<farm>&isActive=true` (keep `location_type` SILO or STORE). `GET /item?itemType=FEED&isActive=true`.
- Consumes (Task 13): `RequisitionView` from `requisitions-panel.tsx`.
- Produces: `export function RequisitionNewDialog(props: { open: boolean; farmId: string; onClose: () => void; onCreated: (view: RequisitionView) => void })`

D26 says a requisition is "drafted from the forecast or entered by hand". The API has had the manual path since Plan B, but no screen offered it. The dialog reads its two lists only when it opens, so the screen still makes one request on load (A3).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/specs/requisition-new-dialog.spec.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequisitionNewDialog } from '../src/components/console/inventory/requisition-new-dialog';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation(async (url: string) => url.startsWith('/location')
    ? { data: [
      { location_id: 's1', location_code: 'VIL100/SILO-001', location_type: 'SILO' },
      { location_id: 'st', location_code: 'VIL100/STORE-001', location_type: 'STORE' },
      { location_id: 'p1', location_code: 'VIL100/SHED-001/PEN-001', location_type: 'PEN' },
    ] }
    : { data: [{ item_id: 'i1', item_code: 'FEED-R1', item_name: 'Weaner Diet R1' }] });
  post.mockResolvedValue({ data: { requisition_id: 'req-9', req_no: 'REQ-VIL100-2026-00009', lines: [] } });
});

describe('RequisitionNewDialog (D26)', () => {
  it('offers only the farm\'s silos and store, and creates the requisition', async () => {
    const onCreated = jest.fn();
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={onCreated} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/location?farmId=farm-vil&isActive=true'));
    expect(get).toHaveBeenCalledWith('/item?itemType=FEED&isActive=true');
    const dest = await screen.findByLabelText('rqNewDestination:{"line":1}') as HTMLSelectElement;
    await waitFor(() => expect(dest.options.length).toBe(3));
    expect([...dest.options].map((o) => o.textContent)).toEqual(['rqNewChoose', 'VIL100/SILO-001', 'VIL100/STORE-001']);
    fireEvent.change(dest, { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('rqNewItem:{"line":1}'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewCreate' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition', {
      farmId: 'farm-vil', lines: [{ destination_location_id: 's1', item_id: 'i1', quantity_kg: 3000, proposed_delivery_date: '2099-10-01' }],
    }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ requisition_id: 'req-9' }));
  });

  it('keeps Create off until every line is complete, and shows the API refusal', async () => {
    post.mockRejectedValue({ message: 'Destination VIL100/SILO-001 has the same feed item on two lines.' });
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    const create = await screen.findByRole('button', { name: 'rqNewCreate' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await waitFor(() => expect((screen.getByLabelText('rqNewDestination:{"line":1}') as HTMLSelectElement).options.length).toBe(3));
    fireEvent.change(screen.getByLabelText('rqNewDestination:{"line":1}'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('rqNewItem:{"line":1}'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(await screen.findByText('Destination VIL100/SILO-001 has the same feed item on two lines.')).toBeTruthy();
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns=requisition-new-dialog 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL (module missing).

- [ ] **Step 2: Implement**

```tsx
// apps/web/src/components/console/inventory/requisition-new-dialog.tsx
"use client";

/**
 * A feed requisition entered by hand (D26; Requisition §1 row 7, type
 * MANUAL). One line per silo or store and feed item; the API refuses the
 * same pair twice and anything that is not an active silo or store of the
 * farm, and its message is shown as it comes. The two lists are read only
 * when the dialog opens.
 */
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { unwrap } from "./feed-format";
import type { RequisitionView } from "./requisitions-panel";

interface Destination { location_id: string; location_code: string; location_type: string }
interface FeedItem { item_id: string; item_code: string; item_name: string }
interface Draft { dest: string; item: string; kg: string; date: string }

const EMPTY: Draft = { dest: "", item: "", kg: "", date: "" };
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

export function RequisitionNewDialog({
  open,
  farmId,
  onClose,
  onCreated,
}: {
  open: boolean;
  farmId: string;
  onClose: () => void;
  onCreated: (view: RequisitionView) => void;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [lines, setLines] = useState<Draft[]>([{ ...EMPTY }]);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLines([{ ...EMPTY }]);
    setRemarks("");
    setError("");
    Promise.all([
      api.get(`/location?${new URLSearchParams({ farmId, isActive: "true" }).toString()}`),
      api.get("/item?itemType=FEED&isActive=true"),
    ])
      .then(([locRes, itemRes]) => {
        if (!alive) return;
        const locs = unwrap<Destination[]>(locRes);
        const feed = unwrap<FeedItem[]>(itemRes);
        setDestinations((Array.isArray(locs) ? locs : []).filter((l) => l.location_type === "SILO" || l.location_type === "STORE")
          .sort((a, b) => a.location_code.localeCompare(b.location_code)));
        setItems(Array.isArray(feed) ? feed : []);
      })
      .catch((err: any) => {
        if (alive) setError(err?.message || tRef.current("rqLoadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [open, farmId]);

  const setLine = (i: number, patch: Partial<Draft>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const complete = lines.every((l) => l.dest && l.item && Number(l.kg) > 0 && l.date);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        farmId,
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        lines: lines.map((l) => ({ destination_location_id: l.dest, item_id: l.item, quantity_kg: Number(l.kg), proposed_delivery_date: l.date })),
      };
      onCreated(unwrap<RequisitionView>(await api.post("/feed-requisition", body)));
    } catch (err: any) {
      setError(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("rqNewTitle")}
      maxWidth="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>{t("rqNewCancel")}</Button>
          <Button size="sm" onClick={create} disabled={busy || !complete}>{t("rqNewCreate")}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-xs">
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_7rem_9rem_auto] sm:items-end">
            <Field label={t("rqNewDestination", { line: i + 1 })} htmlFor={`rqn-dest-${i}`}>
              <select id={`rqn-dest-${i}`} className="nf-input-sm nf-select" style={inputStyle} value={line.dest} onChange={(e) => setLine(i, { dest: e.target.value })}>
                <option value="">{t("rqNewChoose")}</option>
                {destinations.map((d) => <option key={d.location_id} value={d.location_id}>{d.location_code}</option>)}
              </select>
            </Field>
            <Field label={t("rqNewItem", { line: i + 1 })} htmlFor={`rqn-item-${i}`}>
              <select id={`rqn-item-${i}`} className="nf-input-sm nf-select" style={inputStyle} value={line.item} onChange={(e) => setLine(i, { item: e.target.value })}>
                <option value="">{t("rqNewChoose")}</option>
                {items.map((it) => <option key={it.item_id} value={it.item_id}>{it.item_code} — {it.item_name}</option>)}
              </select>
            </Field>
            <Field label={t("rqNewKg", { line: i + 1 })} htmlFor={`rqn-kg-${i}`}>
              <input id={`rqn-kg-${i}`} type="number" min={0} step="any" className="nf-input-sm text-right" style={inputStyle} value={line.kg} onChange={(e) => setLine(i, { kg: e.target.value })} />
            </Field>
            <Field label={t("rqNewDate", { line: i + 1 })} htmlFor={`rqn-date-${i}`}>
              <input id={`rqn-date-${i}`} type="date" className="nf-input-sm" style={inputStyle} value={line.date} onChange={(e) => setLine(i, { date: e.target.value })} />
            </Field>
            <Button variant="ghost" size="sm" aria-label={t("rqNewRemoveLine", { line: i + 1 })} disabled={lines.length === 1}
              onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div>
          <Button variant="outline" size="sm" onClick={() => setLines((cur) => [...cur, { ...EMPTY }])}><Plus className="h-3.5 w-3.5" /> {t("rqNewAddLine")}</Button>
        </div>
        <Field label={t("rqRemarks")} htmlFor="rqn-remarks">
          <textarea id="rqn-remarks" className="nf-input w-full px-2 py-1" style={inputStyle} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </Dialog>
  );
}
```

In `requisitions-panel.tsx`:
- add `import { RequisitionNewDialog } from "./requisition-new-dialog";`
- add `const [creating, setCreating] = useState(false);` after the `notice` state
- in the right-hand button group, before the "Draft from forecast" button: `<Button size="sm" variant="outline" onClick={() => setCreating(true)} disabled={!farmId || busy}>{t("rqNew")}</Button>`
- as the last child of the top-level `<div data-fill-body>`:

```tsx
      {farmId && (
        <RequisitionNewDialog
          open={creating}
          farmId={farmId}
          onClose={() => setCreating(false)}
          onCreated={(view) => {
            setCreating(false);
            show(view);
            setNotice(tRef.current("rqCreated"));
            loadList();
          }}
        />
      )}
```

- [ ] **Step 3: Copy** (`en`), added after `rqOpenApproval`:

```ts
    rqNew: "New requisition",
    rqNewTitle: "New feed requisition",
    rqNewDestination: "Silo or store, line {{line}}",
    rqNewItem: "Feed, line {{line}}",
    rqNewKg: "Kg, line {{line}}",
    rqNewDate: "Deliver by, line {{line}}",
    rqNewChoose: "Choose…",
    rqNewAddLine: "Add line",
    rqNewRemoveLine: "Remove line {{line}}",
    rqNewCancel: "Cancel",
    rqNewCreate: "Create",
    rqCreated: "Requisition created.",
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns="requisition" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.

- [ ] **Step 5: Commit and write the ledger line**

```bash
git commit -m "feat(web): enter a feed requisition by hand on the Requisitions screen (D26)

D26: a requisition is drafted from the forecast or entered by hand. The API
has taken manual requisitions since Plan B, but no screen offered it. A
dialog now takes lines of silo or store, feed, kilograms and delivery date,
reads its lists only when opened, and shows the API's refusal as it comes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/components/console/inventory/requisition-new-dialog.tsx apps/web/specs/requisition-new-dialog.spec.tsx apps/web/src/components/console/inventory/requisitions-panel.tsx apps/web/src/utils/translations.ts
```

---

### Task 15: D24 (web) — one Alerts page for batch and feed alerts

**Files:**
- Create: `apps/web/src/components/console/production/alerts-list.ts`
- Modify (rewrite): `apps/web/src/components/console/production/alert-panel.tsx`
- Modify: `apps/web/src/components/console/production/production-page-shell.tsx` (`fill` prop)
- Modify: `apps/web/src/app/(app)/alerts/page.tsx` (passes `fill`)
- Create: `apps/web/specs/alerts-page.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts` (en)

**Interfaces:**
- Consumes (Task 8): `POST /feed-alert/evaluate-scope` → `{ farms, failed: [{ farmCode, reason }], forecastErrors: [{ farmCode, reason }] }`; `GET /feed-alert/scope?status=ACTIVE|ALL&farmId=`; `POST /feed-alert/:id/acknowledge`; `GET /alert?companyId=&farmId=&isRead=false&limit=200` (rows carry `batch_no`, `farm_id`); `POST /alert/:id/read` `{ companyId }`.
- Consumes (Task 9): `loadFeedFarms(user)` (the farm filter's list and each batch alert's farm code; the same single cached request); `formatStampShort`. Consumes (Task 13): `PRIORITY_LABEL`, `labelOf`, `variantOf`. Consumes (Task 10): `ScrollTable`, `ConsolePage fill`.
- Produces: `alerts-list.ts`:
  - `export type AlertKind = "BATCH" | "FEED"`
  - `export type AlertState = "OPEN" | "READ" | "ACKNOWLEDGED" | "RESOLVED"`
  - `export interface AlertRow { key: string; kind: AlertKind; id: string; companyId: string | null; priority: string; title: string; message: string; farmId: string | null; farmCode: string | null; raisedAt: string; raisedUtc: boolean; state: AlertState }`
  - `fromBatchAlert(a, farmCodeOf: (farmId: string | null) => string | null): AlertRow`, `fromFeedAlert(a): AlertRow`, `mergeAlerts(...lists: AlertRow[][]): AlertRow[]` (newest first)
- Produces: `ProductionPageShell({ titleKey, fill?, children })`.

Behaviour (D24): opening the page evaluates the feed rules of every farm in scope **once** (there is no scheduler), then lists batch and feed alerts in one table. Filters are Type (All / Batch performance / Feed), Farm (All farms or one) and Show (Open / All). Each row carries a labelled priority badge, the alert, the farm, the time it was raised (DD/MM/YY HH:mm), its status, and Mark read or Acknowledge. A user without the feed grant (INVENTORY/LEDGER view) still sees their batch alerts. The feed read's refusal is not shown as an error.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/specs/alerts-page.spec.tsx
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AlertPanel from '../src/components/console/production/alert-panel';
import { fromBatchAlert, fromFeedAlert, mergeAlerts } from '../src/components/console/production/alerts-list';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: jest.fn(() => 'co-1'), getStoredUser: jest.fn(() => ({ userId: 'u', userType: 'TENANT_ADMIN' })) }));
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({
  loadFeedFarms: jest.fn(async () => [
    { farmId: 'farm-gra', code: 'GRA100', name: 'Grasmere', companyId: 'co-1', companyName: 'T' },
    { farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'T' },
  ]),
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

const batchAlert = {
  alert_id: 'b1', company_id: 'co-1', severity: 'WARNING', title: 'ADG below target', message: 'BATCH-000013 ADG 520 g against 600 g.',
  batch_no: 'BATCH-000013', farm_id: 'farm-gra', is_read: false, created_at: '2026-09-26 08:00:00',
};
const feedAlert = {
  alert_id: 'f1', company_id: 'co-1', farm_id: 'farm-vil', farm_code: 'VIL100', priority_level: 'CRITICAL_FIRST_PRIORITY', status: 'ACTIVE',
  title: 'Low feed: VIL100/SILO-004', message: 'VIL100/SILO-004 has 900 kg of Weaner Diet R1, at or below its low level of 1,000 kg.',
  raised_at: '2026-09-27 06:00:00', last_notified_at: '2026-09-27 06:00:00', acknowledged_at: null,
};

function route(over: { feed?: () => Promise<any> } = {}) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/feed-alert/scope')) return over.feed ? over.feed() : Promise.resolve({ data: [feedAlert] });
    return Promise.resolve({ data: [batchAlert] });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  route();
  post.mockResolvedValue({ data: { farms: 2, failed: [], forecastErrors: [] } });
});

describe('alerts-list (D24)', () => {
  it('maps both kinds onto one row shape and orders newest first', () => {
    const rows = mergeAlerts([fromBatchAlert(batchAlert, () => 'GRA100')], [fromFeedAlert(feedAlert)]);
    expect(rows.map((r) => [r.kind, r.id, r.farmCode, r.state, r.priority])).toEqual([
      ['FEED', 'f1', 'VIL100', 'OPEN', 'CRITICAL_FIRST_PRIORITY'],
      ['BATCH', 'b1', 'GRA100', 'OPEN', 'WARNING'],
    ]);
    expect(fromFeedAlert({ ...feedAlert, acknowledged_at: '2026-09-27 07:00:00' }).state).toBe('ACKNOWLEDGED');
    expect(fromFeedAlert({ ...feedAlert, status: 'RESOLVED' }).state).toBe('RESOLVED');
    expect(fromBatchAlert({ ...batchAlert, is_read: true }, () => null).state).toBe('READ');
  });
});

describe('Alerts page (D24)', () => {
  it('evaluates feed alerts once on open, then lists both kinds in one table with labels', async () => {
    render(<AlertPanel />);
    const table = await screen.findByRole('table', { name: 'alrtTableLabel' });
    await within(table).findByText('Low feed: VIL100/SILO-004');
    expect(post).toHaveBeenCalledWith('/feed-alert/evaluate-scope', {});
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder.find((_, i) => String(get.mock.calls[i][0]).startsWith('/feed-alert/scope'))!);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('prioUrgent')).toBeTruthy();
    expect(within(rows[0]).getByText('VIL100')).toBeTruthy();
    expect(within(rows[1]).getByText('GRA100')).toBeTruthy();
    expect(within(rows[1]).getByText('26/09/26 08:00')).toBeTruthy();
    expect(screen.queryByText('CRITICAL_FIRST_PRIORITY')).toBeNull();
    expect(get).toHaveBeenCalledWith('/feed-alert/scope?status=ACTIVE');
    expect(get).toHaveBeenCalledWith('/alert?companyId=co-1&isRead=false&limit=200');
  });

  it('filters by type and farm without evaluating again', async () => {
    render(<AlertPanel />);
    await screen.findByText('Low feed: VIL100/SILO-004');
    get.mockClear();
    fireEvent.change(screen.getByLabelText('alrtType'), { target: { value: 'FEED' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-alert/scope?status=ACTIVE'));
    expect(get.mock.calls.some(([url]) => String(url).startsWith('/alert?'))).toBe(false);
    fireEvent.change(screen.getByLabelText('alrtFarm'), { target: { value: 'farm-vil' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-alert/scope?status=ACTIVE&farmId=farm-vil'));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a feed alert and marks a batch alert read', async () => {
    render(<AlertPanel />);
    await screen.findByText('Low feed: VIL100/SILO-004');
    fireEvent.click(screen.getByRole('button', { name: 'alrtAcknowledge' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-alert/f1/acknowledge', {}));
    fireEvent.click(await screen.findByRole('button', { name: 'alrtMarkRead' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/alert/b1/read', { companyId: 'co-1' }));
  });

  it('still shows batch alerts when the feed read is refused, without an error', async () => {
    route({ feed: () => Promise.reject({ message: 'Forbidden resource', statusCode: 403 }) });
    render(<AlertPanel />);
    expect(await screen.findByText('ADG below target')).toBeTruthy();
    expect(screen.queryByText('Forbidden resource')).toBeNull();
  });

  it('says which farms could not be fully checked', async () => {
    post.mockResolvedValue({ data: { farms: 2, failed: [{ farmCode: 'GRA100', reason: 'x' }], forecastErrors: [{ farmCode: 'VIL100', reason: 'y' }] } });
    render(<AlertPanel />);
    expect(await screen.findByText('alrtFeedPartly:{"farms":"GRA100, VIL100"}')).toBeTruthy();
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns=alerts-page 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL.

- [ ] **Step 2: Implement.** The list model:

```ts
// apps/web/src/components/console/production/alerts-list.ts
/**
 * One row shape for the Alerts page (D24): batch KPI alerts
 * (notification_alert_log, GET /alert) and feed alerts (feed_alert,
 * GET /feed-alert/scope) side by side. Batch stamps are server-local;
 * feed stamps are UTC (Plan B's convention), hence raisedUtc.
 */
export type AlertKind = "BATCH" | "FEED";
export type AlertState = "OPEN" | "READ" | "ACKNOWLEDGED" | "RESOLVED";

export interface AlertRow {
  key: string;
  kind: AlertKind;
  id: string;
  companyId: string | null;
  priority: string;
  title: string;
  message: string;
  farmId: string | null;
  farmCode: string | null;
  raisedAt: string;
  raisedUtc: boolean;
  state: AlertState;
}

export function fromBatchAlert(a: Record<string, any>, farmCodeOf: (farmId: string | null) => string | null): AlertRow {
  const farmId = a.farm_id ?? null;
  return {
    key: `BATCH|${a.alert_id}`,
    kind: "BATCH",
    id: String(a.alert_id),
    companyId: a.company_id ?? null,
    priority: a.severity ?? "WARNING",
    title: a.title ?? "",
    message: a.message ?? "",
    farmId,
    farmCode: farmCodeOf(farmId),
    raisedAt: a.created_at ?? "",
    raisedUtc: false,
    state: a.is_read ? "READ" : "OPEN",
  };
}

export function fromFeedAlert(a: Record<string, any>): AlertRow {
  return {
    key: `FEED|${a.alert_id}`,
    kind: "FEED",
    id: String(a.alert_id),
    companyId: a.company_id ?? null,
    priority: a.priority_level ?? "INFO",
    title: a.title ?? "",
    message: a.message ?? "",
    farmId: a.farm_id ?? null,
    farmCode: a.farm_code ?? null,
    raisedAt: a.last_notified_at ?? a.raised_at ?? "",
    raisedUtc: true,
    state: a.status === "RESOLVED" ? "RESOLVED" : a.acknowledged_at ? "ACKNOWLEDGED" : "OPEN",
  };
}

function stampMs(row: AlertRow): number {
  const ms = Date.parse(`${row.raisedAt.replace(" ", "T")}${row.raisedUtc ? "Z" : ""}`);
  return Number.isNaN(ms) ? 0 : ms;
}

export function mergeAlerts(...lists: AlertRow[][]): AlertRow[] {
  return lists.flat().sort((a, b) => stampMs(b) - stampMs(a));
}
```

Replace `alert-panel.tsx`:

```tsx
"use client";

/**
 * The Alerts page (D24, Rishi 27 Sep): batch KPI alerts and feed alerts in
 * one list, with a type and farm filter. Opening the page evaluates the feed
 * rules of every farm the user may open, once — there is still no scheduler,
 * so diet-change and deadline alerts are only as fresh as the last
 * evaluation. A user without the feed grant still sees their batch alerts.
 * Fixed-height page: the table is the one thing that scrolls (review C).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { getActiveCompanyId, getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatStampShort } from "@/utils/date-short";
import type { TranslationKeys } from "@/utils/translations";
import { loadFeedFarms, type FeedFarm } from "@/components/console/inventory/use-feed-farm";
import { PRIORITY_LABEL, labelOf, variantOf } from "@/components/console/inventory/requisition-labels";
import { AlertRow, AlertState, fromBatchAlert, fromFeedAlert, mergeAlerts } from "./alerts-list";

type TypeFilter = "ALL" | "BATCH" | "FEED";
type ShowFilter = "OPEN" | "ALL";

const STATE_KEY: Record<AlertState, TranslationKeys> = {
  OPEN: "alrtStatusOpen", READ: "alrtStatusRead", ACKNOWLEDGED: "alrtStatusAcknowledged", RESOLVED: "alrtStatusResolved",
};
const COLUMNS = ["alrtColPriority", "alrtColType", "alrtColAlert", "alrtColFarm", "alrtColRaised", "alrtColStatus", "alrtColAction"] as const;
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const SMALL_BADGE = "px-1.5 py-0 text-[10px]";
const unwrapList = (res: any): any[] => {
  const raw = res?.data ?? res;
  return Array.isArray(raw) ? raw : [];
};

export default function AlertPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const [farms, setFarms] = useState<FeedFarm[]>([]);
  const [type, setType] = useState<TypeFilter>("ALL");
  const [farmId, setFarmId] = useState("");
  const [show, setShow] = useState<ShowFilter>("OPEN");
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const evaluated = useRef(false);
  const farmsRef = useRef<FeedFarm[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!evaluated.current) {
      evaluated.current = true;
      try {
        farmsRef.current = await loadFeedFarms(getStoredUser() as any);
      } catch {
        farmsRef.current = [];
      }
      setFarms(farmsRef.current);
      try {
        const res: any = await api.post("/feed-alert/evaluate-scope", {});
        const result = res?.data ?? res;
        const short = [...(result?.failed ?? []), ...(result?.forecastErrors ?? [])].map((f: any) => f.farmCode);
        if (short.length) setNotice(tRef.current("alrtFeedPartly", { farms: [...new Set(short)].sort().join(", ") }));
      } catch {
        // No feed grant, or the evaluation failed: the batch alerts still show.
        setNotice(tRef.current("alrtFeedCheckFailed"));
      }
    }
    const codeOf = (id: string | null) => farmsRef.current.find((f) => f.farmId === id)?.code ?? null;
    try {
      const batchParams = new URLSearchParams();
      const companyId = getActiveCompanyId();
      if (companyId) batchParams.set("companyId", companyId);
      if (farmId) batchParams.set("farmId", farmId);
      if (show === "OPEN") batchParams.set("isRead", "false");
      batchParams.set("limit", "200");
      const feedParams = new URLSearchParams({ status: show === "OPEN" ? "ACTIVE" : "ALL" });
      if (farmId) feedParams.set("farmId", farmId);
      const [batch, feed] = await Promise.all([
        type === "FEED" ? Promise.resolve([]) : api.get(`/alert?${batchParams.toString()}`).then(unwrapList),
        type === "BATCH" ? Promise.resolve([]) : api.get(`/feed-alert/scope?${feedParams.toString()}`).then(unwrapList).catch(() => []),
      ]);
      setRows(mergeAlerts(batch.map((a) => fromBatchAlert(a, codeOf)), feed.map(fromFeedAlert)));
    } catch (err: any) {
      setError(err?.message || tRef.current("alrtLoadFailed"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [type, farmId, show]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (row: AlertRow) => {
    setActing(row.key);
    try {
      if (row.kind === "FEED") await api.post(`/feed-alert/${row.id}/acknowledge`, {});
      else await api.post(`/alert/${row.id}/read`, { companyId: row.companyId });
      await load();
    } catch (err: any) {
      setError(err?.message || tRef.current(row.kind === "FEED" ? "alrtAckFailed" : "alrtMarkReadFailed"));
    } finally {
      setActing(null);
    }
  };

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <Field label={t("alrtType")} htmlFor="alrt-type">
          <select id="alrt-type" className="nf-input-sm nf-select" style={inputStyle} value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
            <option value="ALL">{t("alrtTypeAll")}</option>
            <option value="BATCH">{t("alrtTypeBatch")}</option>
            <option value="FEED">{t("alrtTypeFeed")}</option>
          </select>
        </Field>
        <Field label={t("alrtFarm")} htmlFor="alrt-farm">
          <select id="alrt-farm" className="nf-input-sm nf-select" style={inputStyle} value={farmId} onChange={(e) => setFarmId(e.target.value)}>
            <option value="">{t("alrtFarmAll")}</option>
            {farms.map((f) => <option key={f.farmId} value={f.farmId}>{f.code} — {f.name}</option>)}
          </select>
        </Field>
        <Field label={t("alrtShow")} htmlFor="alrt-show">
          <select id="alrt-show" className="nf-input-sm nf-select" style={inputStyle} value={show} onChange={(e) => setShow(e.target.value as ShowFilter)}>
            <option value="OPEN">{t("alrtShowOpen")}</option>
            <option value="ALL">{t("alrtShowAll")}</option>
          </select>
        </Field>
      </div>

      {notice && <InlineAlert variant="warning">{notice}</InlineAlert>}
      {error && <InlineAlert>{error}</InlineAlert>}

      <ScrollTable label={t("alrtTableLabel")}>
        <thead>
          <tr>{COLUMNS.map((c) => <th key={c} scope="col" className={TH}>{t(c)}</th>)}</tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("alrtLoading")}</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]"><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("alrtNoAlerts")}</td></tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} className={row.state === "OPEN" ? undefined : "opacity-70"}>
                <td className={TD}><Badge variant={variantOf(PRIORITY_LABEL, row.priority)} className={SMALL_BADGE}>{labelOf(PRIORITY_LABEL, row.priority, t)}</Badge></td>
                <td className={cn(TD, "text-[var(--text-secondary)]")}>{t(row.kind === "FEED" ? "alrtTypeFeed" : "alrtTypeBatch")}</td>
                <td className={cn(TD, "max-w-[36rem]")}>
                  <span className="font-medium">{row.title}</span>
                  <span className="ml-2 inline-block max-w-[24rem] truncate align-bottom text-[var(--text-secondary)]" title={row.message}>{row.message}</span>
                </td>
                <td className={TD}>{row.farmCode ?? "—"}</td>
                <td className={cn(TD, "tabular-nums")}>{formatStampShort(row.raisedAt, row.raisedUtc)}</td>
                <td className={TD}>{t(STATE_KEY[row.state])}</td>
                <td className={TD}>
                  {row.state === "OPEN" && (
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={() => act(row)} disabled={acting === row.key}>
                      <CheckCircle2 className="h-3 w-3" /> {t(row.kind === "FEED" ? "alrtAcknowledge" : "alrtMarkRead")}
                    </Button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </ScrollTable>
    </div>
  );
}
```

In `production-page-shell.tsx`, add `fill = false` to the props (`fill?: boolean` in the type, with the comment `/** Plan S: fixed-height page; only its table scrolls. */`). In the final return, use `<ConsolePage fill={fill}>` and pass `sticky={!fill}` to its `PageHeader`. In `app/(app)/alerts/page.tsx`, use `<ProductionPageShell titleKey="navAlerts" fill>`.

- [ ] **Step 3: Copy** (`en` only). Change `alrtMarkRead` to `"Mark read"` and `alrtLoadFailed` to `"Alerts could not be loaded."`. Add after `alrtMarkReadFailed`:

```ts
    alrtTableLabel: "Alerts",
    alrtType: "Type",
    alrtTypeAll: "All alerts",
    alrtTypeBatch: "Batch performance",
    alrtTypeFeed: "Feed",
    alrtFarm: "Farm",
    alrtFarmAll: "All farms",
    alrtShow: "Show",
    alrtShowOpen: "Open",
    alrtShowAll: "All",
    alrtColPriority: "Priority",
    alrtColType: "Type",
    alrtColAlert: "Alert",
    alrtColFarm: "Farm",
    alrtColRaised: "Raised",
    alrtColStatus: "Status",
    alrtColAction: "Action",
    alrtStatusOpen: "Open",
    alrtStatusRead: "Read",
    alrtStatusAcknowledged: "Acknowledged",
    alrtStatusResolved: "Resolved",
    alrtAcknowledge: "Acknowledge",
    alrtAckFailed: "The alert could not be acknowledged.",
    alrtFeedPartly: "Feed alerts not fully checked for {{farms}}.",
    alrtFeedCheckFailed: "Feed alerts could not be checked just now.",
```

`alrtPageTitle`, `alrtPageSubtitle`, `alrtAllSeverities`, `alrtSeverityWarning`, `alrtSeverityCritical`, `alrtAll`, `alrtUnread`, `alrtRead` and `alrtExpectedActual` are no longer used by this panel. They exist in all languages, so leave them rather than editing seven dictionaries.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns="alerts-page|nav-scope|app-shell" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.

- [ ] **Step 5: Commit and write the ledger line**

```bash
git commit -m "feat(web): one Alerts page for batch and feed alerts (D24, review A8, A9, C)

Feed alerts had their own Inventory tab, one farm at a time, with raw
priority codes, 'there is no scheduler' copy and big cards; batch alerts
were cards on the Alerts page. Rishi decided on 27 Sep that feed alerts
belong on the one Alerts page. It now evaluates every farm in scope once on
open, lists both kinds in one fixed-height table with a type, farm and open
filter, labelled priority badges, DD/MM/YY HH:mm times, and Acknowledge or
Mark read per row; batch alerts still show to a user without the feed grant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/components/console/production/alerts-list.ts apps/web/src/components/console/production/alert-panel.tsx apps/web/src/components/console/production/production-page-shell.tsx "apps/web/src/app/(app)/alerts/page.tsx" apps/web/specs/alerts-page.spec.tsx apps/web/src/utils/translations.ts
```

---

### Task 16: D25 (web) — feed requisitions in the Approvals inbox

**Files:**
- Create: `apps/web/src/components/console/approvals/feed-requisition-approval-detail.tsx`
- Create: `apps/web/specs/feed-requisition-approval-detail.spec.tsx`
- Modify: `apps/web/src/components/console/approvals/approvals-page-shell.tsx`
- Modify: `apps/web/src/utils/translations.ts` (en)

**Interfaces:**
- Consumes (Task 6): approval rows carry `document_id` and `farm_id`. `POST /approval/:id/approve` accepts `{ remarks? }`. Consumes (Task 7): `GET /feed-requisition/:document_id` answers the requisition view for an approver who may see the farm (`resolveOwnFarm`).
- Produces: `export function FeedRequisitionApprovalDetail(props: { documentId: string; pending: boolean; remarks: string; onRemarksChange: (value: string) => void })`
- Produces: `/approvals/<tab>?request=<request_id>` opens that request's dialog once the list has loaded (the Requisitions screen links here, Task 13). The dialog links back with `/inventory/requisitions?id=<document_id>`.

What the approver sees for a FEED_REQUISITION: a "Feed requisition" type badge (today it falls to the default "Clinical / Disposal" badge), the lines (silo or store, feed, recommended kg, requested kg, deliver by), the farm's remarks, and, while pending, a remarks box. The remarks go with Approve, which is D25's "20 % deviation and past-deadline remarks at approval". There is also a link to the requisition. Reject already asks for a reason (the existing reject dialog), and the handler requires it.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/specs/feed-requisition-approval-detail.spec.tsx
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FeedRequisitionApprovalDetail } from '../src/components/console/approvals/feed-requisition-approval-detail';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;
const view = {
  requisition_id: 'req-4', req_no: 'REQ-VIL100-2026-00004', remarks: 'Extra pigs arriving',
  lines: [{ line_id: 'L1', line_seq: 1, destination_code: 'VIL100/SILO-004', item_code: 'FEED-R1', item_name: 'Weaner Diet R1',
    recommended_qty_kg: '6000.0000', quantity: '9000.0000', proposed_delivery_date: '2099-10-01' }],
};

describe('FeedRequisitionApprovalDetail (D25)', () => {
  beforeEach(() => get.mockReset().mockResolvedValue({ data: view }));

  it('shows the lines, the farm\'s remarks and a link to the requisition', async () => {
    render(<FeedRequisitionApprovalDetail documentId="req-4" pending remarks="" onRemarksChange={jest.fn()} />);
    const table = await screen.findByRole('table', { name: 'apReqLinesLabel' });
    expect(get).toHaveBeenCalledWith('/feed-requisition/req-4');
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['VIL100/SILO-004', 'FEED-R1 — Weaner Diet R1', '6,000', '9,000', '01/10/99']);
    expect(screen.getByText('apReqFarmRemarks:{"remarks":"Extra pigs arriving"}')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'apReqOpen' }).getAttribute('href')).toBe('/inventory/requisitions?id=req-4');
  });

  it('takes the approver\'s remarks while pending, and hides the box once decided', async () => {
    const onRemarksChange = jest.fn();
    const { rerender } = render(<FeedRequisitionApprovalDetail documentId="req-4" pending remarks="" onRemarksChange={onRemarksChange} />);
    fireEvent.change(await screen.findByLabelText('apReqApproverRemarks'), { target: { value: 'Mill has capacity' } });
    expect(onRemarksChange).toHaveBeenCalledWith('Mill has capacity');
    rerender(<FeedRequisitionApprovalDetail documentId="req-4" pending={false} remarks="" onRemarksChange={onRemarksChange} />);
    expect(screen.queryByLabelText('apReqApproverRemarks')).toBeNull();
  });

  it('says so when the lines cannot be read', async () => {
    get.mockRejectedValue({ message: 'Requisition not found.' });
    render(<FeedRequisitionApprovalDetail documentId="req-4" pending remarks="" onRemarksChange={jest.fn()} />);
    expect(await screen.findByText('apReqLinesUnavailable')).toBeTruthy();
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns=feed-requisition-approval-detail 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL.

- [ ] **Step 2: Implement the detail**

```tsx
// apps/web/src/components/console/approvals/feed-requisition-approval-detail.tsx
"use client";

/**
 * A feed requisition as the approver sees it in the Approvals inbox (D25):
 * its lines, the farm's remarks, and — while pending — the approver's own
 * remarks, which go with Approve (checkpoints 18 and 22 are checked again at
 * approval: a line more than 20 % off, or a late submission, needs them).
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort } from "@/utils/date-short";

interface ReqLine {
  line_id: string;
  destination_code: string | null;
  item_code: string | null;
  item_name: string | null;
  recommended_qty_kg: string | null;
  quantity: string;
  proposed_delivery_date: string | null;
}

const kg = (v: string | null) => (v == null || v === "" ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const TH = "h-8 whitespace-nowrap px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-2 py-1 text-[11px] text-[var(--text-primary)]";

export function FeedRequisitionApprovalDetail({
  documentId,
  pending,
  remarks,
  onRemarksChange,
}: {
  documentId: string;
  pending: boolean;
  remarks: string;
  onRemarksChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const [lines, setLines] = useState<ReqLine[] | null>(null);
  const [farmRemarks, setFarmRemarks] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api
      .get(`/feed-requisition/${documentId}`)
      .then((res: any) => {
        if (!alive) return;
        const view = res?.data ?? res;
        setLines(Array.isArray(view?.lines) ? view.lines : []);
        setFarmRemarks(view?.remarks ?? null);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [documentId]);

  return (
    <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      {failed ? (
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{t("apReqLinesUnavailable")}</p>
      ) : lines ? (
        <ScrollTable label={t("apReqLinesLabel")} className="max-h-48">
          <thead>
            <tr>
              <th scope="col" className={TH}>{t("apReqColDestination")}</th>
              <th scope="col" className={TH}>{t("apReqColItem")}</th>
              <th scope="col" className={`${TH} text-right`}>{t("apReqColRecommended")}</th>
              <th scope="col" className={`${TH} text-right`}>{t("apReqColRequested")}</th>
              <th scope="col" className={TH}>{t("apReqColDelivery")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line_id}>
                <td className={TD}>{l.destination_code ?? "—"}</td>
                <td className={TD}>{l.item_code} — {l.item_name}</td>
                <td className={`${TD} text-right tabular-nums`}>{kg(l.recommended_qty_kg)}</td>
                <td className={`${TD} text-right tabular-nums`}>{kg(l.quantity)}</td>
                <td className={TD}>{formatDateShort(l.proposed_delivery_date)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      ) : null}
      {farmRemarks && <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{t("apReqFarmRemarks", { remarks: farmRemarks })}</p>}
      {pending && (
        <Field label={t("apReqApproverRemarks")} htmlFor={`ap-req-remarks-${documentId}`} hint={t("apReqApproverRemarksHint")}>
          <textarea id={`ap-req-remarks-${documentId}`} rows={2} className="nf-input w-full px-2 py-1 text-xs"
            value={remarks} onChange={(e) => onRemarksChange(e.target.value)} />
        </Field>
      )}
      <a href={`/inventory/requisitions?id=${documentId}`} className="inline-block text-[11px] font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>
        {t("apReqOpen")}
      </a>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the inbox** (`approvals-page-shell.tsx`):
1. Change the React import to `import { useCallback, useEffect, useRef, useState } from "react";` and add `import { FeedRequisitionApprovalDetail } from "./feed-requisition-approval-detail";` after the `useCompanyCurrency` import.
2. In `type ApprovalItem`, add `document_id?: string;` after `batch_no?: string;`. In `fromApi`, add `document_id: r.document_id || undefined,` after `batch_no: …`.
3. After the `const [viewingItem, setViewingItem] = …` line add:

```tsx
  // D25: an approver's remarks on a feed requisition travel with Approve.
  const [approverRemarks, setApproverRemarks] = useState("");
  useEffect(() => setApproverRemarks(""), [viewingItem?.id]);
  // The Requisitions screen links here with ?request=<id>; open it once the list is in.
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current || approvals.length === 0) return;
    let requested: string | null = null;
    try {
      requested = new URLSearchParams(window.location.search).get("request");
    } catch {
      requested = null;
    }
    if (!requested) return;
    const match = approvals.find((a) => a.id === requested);
    if (match) {
      openedFromLink.current = true;
      setViewingItem(match);
    }
  }, [approvals]);
```

(The `approvals` state is declared above `viewingItem` at ~:124, so it is in scope.)
4. In `handleApprove`, replace `await api.post(\`/approval/${item.id}/approve\`);` with:

```tsx
      await api.post(`/approval/${item.id}/approve`, approverRemarks.trim() ? { remarks: approverRemarks.trim() } : {});
```

5. In `getDocTypeBadge`, add before `default:`:

```tsx
      case "FEED_REQUISITION":
        return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"><Wheat className="h-3 w-3" /> {t("apDocType_FEED_REQUISITION")}</span>;
```

6. In the details dialog, directly before `{viewingItem.status === "APPROVED" && viewingItem.approver && (` (~:559), insert:

```tsx
            {viewingItem.doc_type === "FEED_REQUISITION" && viewingItem.document_id && (
              <FeedRequisitionApprovalDetail
                documentId={viewingItem.document_id}
                pending={viewingItem.status === "PENDING"}
                remarks={approverRemarks}
                onRemarksChange={setApproverRemarks}
              />
            )}
```

- [ ] **Step 4: Copy** (`en`), added after `apDocType_VET_DISPOSAL`:

```ts
    apDocType_FEED_REQUISITION: "Feed requisition",
    apReqLinesLabel: "Requisition lines",
    apReqColDestination: "Silo / store",
    apReqColItem: "Feed",
    apReqColRecommended: "Recommended (kg)",
    apReqColRequested: "Requested (kg)",
    apReqColDelivery: "Deliver by",
    apReqFarmRemarks: "Farm remarks: {{remarks}}",
    apReqApproverRemarks: "Your remarks",
    apReqApproverRemarksHint: "Needed when a quantity is more than 20% off the recommendation, or the deadline has passed.",
    apReqOpen: "Open requisition",
    apReqLinesUnavailable: "The requisition lines could not be loaded.",
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns="approval" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.

The inbox wiring (the badge, the dialog, `?request=` opening, the remarks posted with Approve) is proved in the browser in Task 22, step 4.

- [ ] **Step 6: Commit and write the ledger line**

```bash
git commit -m "feat(approvals): show feed requisitions with their lines and take approver remarks (D25)

Feed requisitions now reach the Approvals inbox (farm-scoped since 0122) but
would have shown as 'Clinical / Disposal' with no lines, and approval had no
way to carry the remarks D25 still requires for a >20 % or late
requisition. The inbox now labels them 'Feed requisition', lists the lines
and the farm's remarks, takes the approver's remarks with Approve, links to
the requisition, and opens a request named in ?request= from the
Requisitions screen.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/components/console/approvals/feed-requisition-approval-detail.tsx apps/web/specs/feed-requisition-approval-detail.spec.tsx apps/web/src/components/console/approvals/approvals-page-shell.tsx apps/web/src/utils/translations.ts
```

---

### Task 17: A10 + A8 + A9 (masters) — Reporting Periods and Alert Rules in the Farm Master menu, labels and dates in their lists

**Files:**
- Modify: `apps/web/src/modules/master-data/types.ts` (column `format` / `labels`; `MasterDataColumn` type)
- Create: `apps/web/src/modules/master-data/column-format.ts`
- Modify: `apps/web/src/modules/master-data/MasterDataTable.tsx` (`displayValue` uses it: one import, one line, a wider parameter type)
- Modify: `apps/web/src/modules/master-data/configs.ts` (`alertRule`, `reportingPeriod`, `MASTER_DATA_NAV_ORDER`)
- Create: `apps/web/specs/master-data-feed-masters.spec.ts`

**Interfaces:**
- Produces: in `types.ts`, `columns?: MasterDataColumn[]` with `export type MasterDataColumn = { key: string; label: string; decimals?: number; decimalsFromKey?: string; format?: "date" | "codes"; labels?: Record<string, string> }`
- Produces: `export function formatColumnValue(value: unknown, col?: { format?: "date" | "codes"; labels?: Record<string, string> }): string | undefined` in `column-format.ts`. `date` gives DD/MM/YY (A9). `labels` maps a code to its words and `codes` humanizes codes; both handle a list value (A8). `undefined` means the column asks for no formatting.
- Consumes: `formatDateShort` (Task 9), `humanizeCode` (Task 13).

Why they were missing (A10): the Farm Master menu (`app/(app)/layout.tsx` `masterDataChildren`) lists only configs with `isPrimary: true`, ordered by `MASTER_DATA_NAV_ORDER`. Both configs lacked `isPrimary`, and their `group` was "Inventory", which is the heading their pages showed. They move to **Farm Operations** (S6). The menu has no per-entry permission filter for any master. The gate that applies is the page's own `businessAdminOnly` (tenant and company admins may edit), which both configs already carry. So "the gating the other entries use" is kept as is, and nothing new is added.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/specs/master-data-feed-masters.spec.ts
import { MASTER_DATA_CONFIGS, MASTER_DATA_NAV_ORDER, getConfig } from '../src/modules/master-data/configs';
import { formatColumnValue } from '../src/modules/master-data/column-format';

describe('Reporting Periods and Alert Rules in the Farm Master menu (review A10, S6)', () => {
  it.each(['reporting-period', 'alert-rule'])('%s is a menu entry under Farm Operations, admin-gated like the other masters', (key) => {
    const config = getConfig(key)!;
    expect(config.isPrimary).toBe(true);
    expect(config.group).toBe('Farm Operations');
    expect(config.businessAdminOnly).toBe(true);
    expect(MASTER_DATA_NAV_ORDER).toContain(key);
  });

  it('shows the reporting period dates as DD/MM/YY (A9)', () => {
    const cols = getConfig('reporting-period')!.columns!;
    for (const key of ['start_date', 'end_date', 'stock_take_date', 'production_start_date']) {
      expect(cols.find((c) => c.key === key)!.format).toBe('date');
    }
  });

  it('shows alert rule codes as words (A8)', () => {
    const cols = getConfig('alert-rule')!.columns!;
    const col = (key: string) => cols.find((c) => c.key === key)!;
    expect(formatColumnValue('FEED_BELOW_L1', col('event_type'))).toBe('Feed at or below low level');
    expect(formatColumnValue('CRITICAL_FIRST_PRIORITY', col('priority_level'))).toBe('Urgent');
    expect(formatColumnValue('ON_EACH_OCCURRENCE', col('frequency'))).toBe('Each time the value changes');
    expect(formatColumnValue(['FARM_MANAGER', 'HEAD_OF_FARM'], col('recipient_roles'))).toBe('Farm Manager, Head Of Farm');
    const eventField = getConfig('alert-rule')!.fields.find((f) => f.key === 'event_type')!;
    expect(eventField.options!.map((o) => o.label)).not.toContain('FEED_BELOW_L1');
  });

  it('leaves every other column as it was', () => {
    expect(formatColumnValue('2026-09-26', { format: 'date' })).toBe('26/09/26');
    expect(formatColumnValue('X', undefined)).toBeUndefined();
    expect(formatColumnValue(null, { format: 'date' })).toBeUndefined();
    expect(MASTER_DATA_CONFIGS.filter((c) => c.isPrimary).length).toBeGreaterThan(2);
  });
});
```

Run: `pnpm nx test web -- --testPathPatterns=master-data-feed-masters 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL.

- [ ] **Step 2: Implement.** In `types.ts`, add above `MasterDataConfig`:

```ts
/**
 * A list column. `decimals`/`decimalsFromKey` trim a stored-precision number
 * (display only). Plan S: `format: "date"` shows a day as DD/MM/YY (review
 * A9), `labels` maps a stored code to its words and `format: "codes"`
 * humanizes codes it has no label for (review A8) — both handle a list value.
 */
export type MasterDataColumn = {
  key: string;
  label: string;
  decimals?: number;
  decimalsFromKey?: string;
  format?: "date" | "codes";
  labels?: Record<string, string>;
};
```

and change the `columns?:` line to `columns?: MasterDataColumn[];`, keeping its comment.

```ts
// apps/web/src/modules/master-data/column-format.ts
import { formatDateShort } from "@/utils/date-short";
import { humanizeCode } from "@/components/console/inventory/requisition-labels";

/**
 * A list cell's text for the column formats Plan S added (review A8: raw
 * codes such as CRITICAL_FIRST_PRIORITY in the Alert Rules list; A9: ISO
 * dates in the Reporting Periods list), or undefined when the column asks for
 * no formatting and the table's usual display applies.
 */
export function formatColumnValue(value: unknown, col?: { format?: "date" | "codes"; labels?: Record<string, string> }): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (col?.format === "date") return formatDateShort(String(value));
  if (!col?.labels && col?.format !== "codes") return undefined;
  const one = (v: unknown) => {
    const code = String(v);
    return col?.labels?.[code] ?? (col?.format === "codes" ? humanizeCode(code) : code);
  };
  if (Array.isArray(value)) return value.length ? value.map(one).join(", ") : "—";
  return one(value);
}
```

In `MasterDataTable.tsx`, add `import { formatColumnValue } from "./column-format";` after the `singularLabel` import. Change `displayValue`'s last parameter to `col?: { decimals?: number; decimalsFromKey?: string; format?: "date" | "codes"; labels?: Record<string, string> }`, and directly after its `if (v === null || v === undefined || v === "") { … }` block add:

```ts
  const formatted = formatColumnValue(v, col);
  if (formatted !== undefined) return formatted;
```

In `configs.ts`, add above `const alertRule`:

```ts
// Plan S (review A8): the words the list and the form show for each stored code.
const ALERT_EVENT_TYPES = [
  { value: "FEED_BELOW_L1", label: "Feed at or below low level" },
  { value: "FEED_ABOVE", label: "Feed at or above high level" },
  { value: "DIET_CHANGE", label: "Diet change coming" },
  { value: "REQ_DEADLINE", label: "Requisition deadline" },
];
const ALERT_TRIGGER_ENTITIES = [
  { value: "SILO", label: "Silo" },
  { value: "REQUISITION", label: "Requisition" },
  { value: "FEED_PLAN", label: "Feed plan" },
  { value: "STOCK_TAKE", label: "Stock take" },
];
const ALERT_THRESHOLD_REFERENCES = [
  { value: "SILO_BELOW", label: "Silo's low level" },
  { value: "SILO_ABOVE", label: "Silo's high level" },
  { value: "FIXED_VALUE", label: "Fixed value" },
];
const ALERT_PRIORITIES = [
  { value: "CRITICAL_FIRST_PRIORITY", label: "Urgent" },
  { value: "CRITICAL", label: "Critical" },
  { value: "WARNING", label: "Warning" },
  { value: "INFO", label: "Info" },
];
const ALERT_FREQUENCIES = [
  { value: "ONCE", label: "Once until resolved" },
  { value: "DAILY", label: "Daily" },
  { value: "ON_EACH_OCCURRENCE", label: "Each time the value changes" },
  { value: "ESCALATING", label: "Escalating" },
];
const labelsOf = (options: { value: string; label: string }[]) => Object.fromEntries(options.map((o) => [o.value, o.label]));
```

In `alertRule`:
- `group: "Inventory", businessAdminOnly: true,` → `group: "Farm Operations", isPrimary: true, businessAdminOnly: true,`
- `description:` → `"Which feed events raise an alert, how urgently, and for whom."`
- `columns:` →

```ts
  columns: [
    { key: "notification_code", label: "Notification Code" }, { key: "notification_name", label: "Notification Name" },
    { key: "event_type", label: "Event Type", labels: labelsOf(ALERT_EVENT_TYPES) },
    { key: "priority_level", label: "Priority Level", labels: labelsOf(ALERT_PRIORITIES) },
    { key: "recipient_roles", label: "Recipient Role(s)", format: "codes" },
    { key: "frequency", label: "Frequency", labels: labelsOf(ALERT_FREQUENCIES) },
  ],
```

- in `fields`, the five `options: [...].map((value) => ({ value, label: value }))` become `options: ALERT_EVENT_TYPES`, `options: ALERT_TRIGGER_ENTITIES`, `options: ALERT_THRESHOLD_REFERENCES`, `options: ALERT_PRIORITIES` and `options: ALERT_FREQUENCIES` for `event_type`, `trigger_entity`, `threshold_reference`, `priority_level` and `frequency`. The delivery channel's options become `[{ value: "IN_APP", label: "In app" }]`.

In `reportingPeriod`:
- `group: "Inventory", businessAdminOnly: true,` → `group: "Farm Operations", isPrimary: true, businessAdminOnly: true,`
- `description:` → `"Monthly periods of the July–June business year, each ending on the month-end Saturday."`
- `columns:` →

```ts
  columns: [
    { key: "period_code", label: "Period Code" }, { key: "business_year", label: "Business Year" },
    { key: "start_date", label: "Start Date", format: "date" }, { key: "end_date", label: "End Date", format: "date" },
    { key: "stock_take_date", label: "Stock Take Date", format: "date" }, { key: "production_start_date", label: "Production Start Date", format: "date" },
  ],
```

Change `MASTER_DATA_NAV_ORDER` to `["location", "number-series", "item", "stage", "breed", "animal", "activity", "reporting-period", "alert-rule"]`.

- [ ] **Step 3: Run the tests, typecheck and lint**

Run: `pnpm nx test web -- --testPathPatterns="master-data|nav-scope|app-shell" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run: `pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"` → errors ≤ 94.

- [ ] **Step 4: Commit and write the ledger line**

```bash
git commit -m "feat(masters): Reporting Periods and Alert Rules in the Farm Master menu, with words and DD/MM/YY in their lists (review A8, A9, A10)

Both masters were reachable only by typing the URL (not isPrimary) and
were headed 'Inventory'; the Alert Rules list showed event, priority,
frequency and role codes and the Reporting Periods list ISO dates. They are
now Farm Master entries under Farm Operations (S6), admin-gated as before;
list columns gain a date format and code labels (formatColumnValue) and the
Alert Rule form's choices read as words.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/web/src/modules/master-data/types.ts apps/web/src/modules/master-data/column-format.ts apps/web/src/modules/master-data/MasterDataTable.tsx apps/web/src/modules/master-data/configs.ts apps/web/specs/master-data-feed-masters.spec.ts
```

---

### Task 18: B1 (masters) — demo silo levels, stage timings and a DRY_SOW feed row

**Files:**
- Create: `apps/api/src/core/database/demo-feed-defaults.ts`
- Create: `apps/api/src/core/database/demo-feed-defaults.spec.ts`
- Modify: `apps/api/src/scripts/seed-nine-farm-demo.ts` (one import; silo levels after each silo upsert; the stage-timing block after section 3; a DRY_SOW row in `SOW_STAGE_PLAN`; DRY_SOW in the MULTIPLIER stage list)

**Interfaces:**
- Produces (`demo-feed-defaults.ts`):
  - `export const SILO_LOW_LEVEL_PCT = 20` and `export const SILO_HIGH_LEVEL_PCT = 90` (D22, D27)
  - `export function defaultSiloLevels(capacityKg: number): { lowKg: number; highKg: number }` (rounded to 2 decimals)
  - `export const DEMO_STAGE_DURATIONS: Readonly<Record<string, number>> = { DRY_SOW: 7, FLUSH: 14, FARROWING: 3, WEANING: 1 }` (S7)
  - `export const DEMO_NEXT_STAGES: Readonly<Record<string, string>> = { WEANER: 'GROWER', GROWER: 'FINISHER' }` (S7)
  - `export const DEMO_SILO_FILL_PCT = 50` (S10)
  Task 19 adds `siloFillKg`. Task 20's spec pins migrations 0124/0125 to these constants.

Why each value (S7). The system stage seed (`piggery-bbp-stage-seed.ts`) leaves DRY_SOW, FLUSH, FARROWING and WEANING without a duration on purpose ("ranges stay ranges"), and its test says so. So the demo does not change that seed. The demo's lifecycle rows already give each stage a length, and the durations match those rows, so no stage day of the demo falls outside a feed row (B1):

| stage | lifecycle row (stage days) | duration used | source |
|---|---|---|---|
| FLUSH | 1–14 | 14 | Rishi, 15 Sep ("Flush 14") |
| INSEMINATION | 1–2 | 2 (already set) | BBP §1.7 |
| FARROWING | 1–3 | 3 | Rishi, 15 Sep ("farrowing held as the first 3 days") |
| WEANING | 1–1 | 1 | the weaning event |
| DRY_SOW | 1–7 (new row) | 7 | BBP §1.7 "4–7 days", upper bound |
| WEANER → GROWER → FINISHER | 1–43, 1–71, 1–31 | 42, 70, 30 (already set) | the 15 Sep decision |

The DRY_SOW row exists because a sow in LACTATION (28 days) reaches WEANING and then DRY_SOW inside the 45-day horizon. Without a row, those days would raise NO_FEED_ROW.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/core/database/demo-feed-defaults.spec.ts
import { DEMO_NEXT_STAGES, DEMO_SILO_FILL_PCT, DEMO_STAGE_DURATIONS, SILO_HIGH_LEVEL_PCT, SILO_LOW_LEVEL_PCT, defaultSiloLevels } from './demo-feed-defaults';
import { SYSTEM_STAGE_SEED } from './system-master-data-seed';

describe('demo feed defaults (D22, D27, S7, S10)', () => {
  it('sets a silo at 20 % low and 90 % high of its capacity', () => {
    expect([SILO_LOW_LEVEL_PCT, SILO_HIGH_LEVEL_PCT]).toEqual([20, 90]);
    expect(defaultSiloLevels(12000)).toEqual({ lowKg: 2400, highKg: 10800 });
    expect(defaultSiloLevels(6000)).toEqual({ lowKg: 1200, highKg: 5400 });
    expect(defaultSiloLevels(5.8)).toEqual({ lowKg: 1.16, highKg: 5.22 });
  });

  it('times only stages the system seed leaves open, and chains the grow-out stages', () => {
    const seeded = (code: string) => SYSTEM_STAGE_SEED.find((s) => s.stage_code === code) as { typical_duration_days?: number } | undefined;
    for (const code of Object.keys(DEMO_STAGE_DURATIONS)) expect(seeded(code)?.typical_duration_days).toBeUndefined();
    expect(DEMO_STAGE_DURATIONS).toEqual({ DRY_SOW: 7, FLUSH: 14, FARROWING: 3, WEANING: 1 });
    expect(DEMO_NEXT_STAGES).toEqual({ WEANER: 'GROWER', GROWER: 'FINISHER' });
    expect(DEMO_SILO_FILL_PCT).toBe(50);
  });
});
```

Run: `pnpm nx test api -- --testPathPatterns=demo-feed-defaults 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL (module missing).

- [ ] **Step 2: Implement the constants**

```ts
// apps/api/src/core/database/demo-feed-defaults.ts
/**
 * Feed defaults shared by the demo seed, the demo chapters and the Plan S
 * data migrations, so the three can never disagree (demo-feed-defaults.spec.ts
 * and drizzle/tenant/plan-s-migrations.spec.ts pin them).
 *
 * - Silo levels (D22, Rishi 27 Sep; D27 confirms 20 %): High = 90 % of capacity
 *   (workbook Master Setup §1 row 12), Low = 20 % (ours, confirmed by Rishi).
 * - Stage timings (open question S7): the stages BBP §1.7 gives only as a
 *   range are left empty by the system seed on purpose; the demo takes the
 *   lengths of its own lifecycle rows (seed-nine-farm-demo.ts), and migration
 *   0125 fills the same values into existing data only where empty.
 * - Demo silo fill (S10): half of capacity, so a fresh demo sits between the
 *   two levels instead of raising a low-feed alert on every silo.
 */
export const SILO_LOW_LEVEL_PCT = 20;
export const SILO_HIGH_LEVEL_PCT = 90;

export function defaultSiloLevels(capacityKg: number): { lowKg: number; highKg: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    lowKg: round2((capacityKg * SILO_LOW_LEVEL_PCT) / 100),
    highKg: round2((capacityKg * SILO_HIGH_LEVEL_PCT) / 100),
  };
}

export const DEMO_STAGE_DURATIONS: Readonly<Record<string, number>> = { DRY_SOW: 7, FLUSH: 14, FARROWING: 3, WEANING: 1 };
export const DEMO_NEXT_STAGES: Readonly<Record<string, string>> = { WEANER: 'GROWER', GROWER: 'FINISHER' };

export const DEMO_SILO_FILL_PCT = 50;
```

- [ ] **Step 3: The seed.** In `seed-nine-farm-demo.ts`:

(a) Add `import { DEMO_NEXT_STAGES, DEMO_STAGE_DURATIONS, defaultSiloLevels } from '../core/database/demo-feed-defaults';` with the other imports.

(b) Directly after the line `if (write) await db.query('UPDATE location_master SET warehouse_id = ? WHERE location_id = ?', [silo.placed.id, silo.placed.id]);`, insert:

```ts
        // D22 (Rishi, 27 Sep): a silo carries both feed levels. The demo's are
        // the defaults migration 0124 gives existing silos (20 % / 90 %),
        // written only where empty so a level edited on a re-seeded demo survives.
        const levels = defaultSiloLevels(spec.siloCapacityKg);
        if (write) {
          await db.query(
            'UPDATE location_master SET low_level_kg = COALESCE(low_level_kg, ?), high_level_kg = COALESCE(high_level_kg, ?) WHERE location_id = ?',
            [dec(levels.lowKg), dec(levels.highKg), silo.placed.id],
          );
        }
```

(c) Directly after the line `plan.stagesAdded = stageAdded.length ? stageAdded : 'none — WEANER/GROWER/FINISHER already present';`, insert:

```ts
    // S7 (Plan S): durations and successors for the stages the demo's pigs
    // walk through, so the forecast can date each stage change (review A6).
    // Only where empty, in both scopes (tenant template and company copy) —
    // the same rule migration 0125 applies to existing data.
    if (write) {
      for (const [code, days] of Object.entries(DEMO_STAGE_DURATIONS)) {
        await db.query(
          `UPDATE stage_master SET typical_duration_days = ?
            WHERE tenant_id = ? AND lob_id = ? AND stage_code = ? AND typical_duration_days IS NULL AND deleted_at IS NULL`,
          [days, scope.tenant_id, scope.lob_id, code],
        );
      }
      for (const [code, next] of Object.entries(DEMO_NEXT_STAGES)) {
        await db.query(
          `UPDATE stage_master s
             JOIN stage_master n ON n.tenant_id = s.tenant_id AND n.lob_id = s.lob_id AND n.company_id <=> s.company_id
                                AND n.stage_code = ? AND n.deleted_at IS NULL
              SET s.next_stage_id = n.stage_id
            WHERE s.tenant_id = ? AND s.lob_id = ? AND s.stage_code = ? AND s.next_stage_id IS NULL AND s.deleted_at IS NULL`,
          [next, scope.tenant_id, scope.lob_id, code],
        );
      }
    }
    plan.stageTimings = write ? 'durations and grow-out successors filled where empty' : 'would fill durations and grow-out successors where empty';
```

(`plan` is a `Record<string, unknown>`, ~:621, so the new key needs no type change.)

(d) In `SOW_STAGE_PLAN`, directly after the `WEANING` entry (the one with `stage: 'WEANING', category: 'PIGLET', from: 1, to: 1,`), insert:

```ts
  {
    stage: 'DRY_SOW', category: 'SOW', from: 1, to: 7,
    feed: FEED.GESTATION, feedKgPerHeadPerDay: 2.5,
    bodyWeightKg: 180, adgGpd: null, fcr: null, mortalityPct: 0.5,
    vaccinations: [],
    medications: [],
    kpis: [{ metric: 'BCS_SCORE', lower_limit: 2.5, upper_limit: 3.5, severity: 'INFO' }],
    note: `After weaning, before the next flush. BBP §1.7 gives 4-7 days; held as 7 (Plan S, S7). ${DEMO_CAVEAT}`,
  },
```

(e) In `stagePlanFor`, the `MULTIPLIER` list becomes `['QUARANTINE', 'GILT_GROWER', 'FLUSH', 'INSEMINATION', 'GESTATION', 'FARROWING', 'LACTATION', 'WEANING', 'DRY_SOW', 'WEANER']`.

- [ ] **Step 4: Run the tests, typecheck and a read-only seed plan**

Run: `pnpm nx test api -- --testPathPatterns="demo-feed-defaults|piggery-bbp-stage-seed" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → pass. The BBP seed test is unchanged and still passes.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run (read-only, writes nothing): `cd apps/api && node --env-file-if-exists=.env --import tsx src/scripts/seed-nine-farm-demo.ts 2>&1 | tail -30`. Expected: the plan prints and includes `stageTimings: 'would fill durations and grow-out successors where empty'`, with no error. **Do not pass `--apply`.**

- [ ] **Step 5: Commit and write the ledger line**

```bash
git commit -m "feat(demo): silo levels, stage timings and a DRY_SOW feed row in the nine-farm seed (B1, D22, S7)

A fresh demo had silos with no feed levels (so no low-feed alert or run-down
to a level could show), FLUSH/FARROWING/WEANING/DRY_SOW with no duration and
WEANER/GROWER with no successor (so the stage table read '(24/09/26 – —)'),
and no feed row for DRY_SOW days reached inside the horizon. The seed now
writes 20 %/90 % levels and the lifecycle rows' own stage lengths, only
where empty, from one constants file the migrations will share.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/core/database/demo-feed-defaults.ts apps/api/src/core/database/demo-feed-defaults.spec.ts apps/api/src/scripts/seed-nine-farm-demo.ts
```

---

### Task 19: B1 (chapters) — demo stock at half capacity, breeding stages that fit their dates, a reporting year, a VIL100 low-feed story

**Files:**
- Modify: `apps/api/src/core/database/demo-feed-defaults.ts` (`siloFillKg`) and `demo-feed-defaults.spec.ts`
- Create: `apps/api/src/scripts/demo/feed-planning.ts` (pure helpers)
- Create: `apps/api/src/scripts/demo/feed-planning.spec.ts`
- Create: `apps/api/src/scripts/demo/chapters/07-feed-planning.ts`
- Modify: `apps/api/src/scripts/demo-chapters.ts` (register chapter 07)
- Modify: `apps/api/src/scripts/demo/chapters/02-inventory.ts` (receipt quantity per silo)
- Modify: `apps/api/src/scripts/demo/register-breeding-stock.ts` (transition dates per stage)
- Create: `.superpowers/sdd/2026-09-27-feed-forecast-s-fixes/verify-after-rebuild.sh`

**Interfaces:**
- Consumes (Task 18): `DEMO_SILO_FILL_PCT`. Consumes (existing services): `ReportingPeriodService.generate({ company_id, business_year_start }, tenantId, user)` → `{ created: string[]; skipped }`; `FeedForecastService.computeForFarm(farmId, companyId, tenantId)` → `{ sources: ForecastSource[] }`; `LocationService.update(id, { low_level_kg }, tenantId, user)`; `FeedAlertService.evaluateFarmSafely(farmId, companyId, tenantId)`.
- Produces: `export function siloFillKg(capacityKg: number | null, fallbackKg: number): number` (demo-feed-defaults).
- Produces (`feed-planning.ts`):
  - `export function stageEntryDaysAgo(durationDays: number | null): number`
  - `export interface DemoLevelChange { siloId: string; siloCode: string; lowKg: number; why: 'RUNS_DOWN' | 'BELOW_NOW' }`
  - `export function pickDemoLevels(sources: Array<Pick<ForecastSource, 'sourceType' | 'sourceCode' | 'locationId' | 'balanceKg' | 'planningDayDemandKg'>>, highOf: Map<string, number | null>): DemoLevelChange[]`
- Produces: chapter `07-feed-planning` after `06-approvals`.

What a fresh demo then shows (B1, S10):
- Every silo sits at about half its capacity, between its 20 % and 90 % levels, so there is no alert flood.
- VIL100's busiest feeding silo gets a low level about 10 days of use below its stock. The forecast shows a Run-Down about 10 days out, with Date to Refill and Required On ahead of it, not overdue.
- VIL100's next feeding silo gets a low level just above its stock, so a FEED_BELOW_L1 alert is raised at once.
- The breeding animals the demo spreads across stages entered each stage early enough to still be in it: a 2-day INSEMINATION today, a 3-day FARROWING yesterday, longer stages 5 days ago. Nothing is "Due, not posted".
- The July–June reporting year containing today exists for the demo company.

- [ ] **Step 1: Write the failing tests.** Append to `apps/api/src/core/database/demo-feed-defaults.spec.ts` (and add `siloFillKg` to its import):

```ts
describe('siloFillKg (S10)', () => {
  it('fills a silo to half its capacity, or the fallback when the capacity is unknown', () => {
    expect(siloFillKg(15000, 2000)).toBe(7500);
    expect(siloFillKg(null, 2000)).toBe(2000);
    expect(siloFillKg(0, 2000)).toBe(2000);
  });
});
```

```ts
// apps/api/src/scripts/demo/feed-planning.spec.ts
import { pickDemoLevels, stageEntryDaysAgo } from './feed-planning';

describe('stageEntryDaysAgo — no "Due, not posted" in a fresh demo (B1)', () => {
  it('keeps each animal inside its stage on the day the demo is built', () => {
    expect([null, 116, 28, 14, 7, 3, 2, 1].map(stageEntryDaysAgo)).toEqual([5, 5, 5, 5, 5, 1, 0, 0]);
    for (const days of [1, 2, 3, 7, 14, 28, 116]) expect(days - 1).toBeGreaterThanOrEqual(stageEntryDaysAgo(days));
  });
});

describe('pickDemoLevels — one run-down inside the horizon, one alert now (B1, S10)', () => {
  const source = (locationId: string, balanceKg: number, planningDayDemandKg: number, sourceType: 'SILO' | 'STORE' = 'SILO') =>
    ({ sourceType, sourceCode: `VIL100/${locationId}`, locationId, balanceKg, planningDayDemandKg });

  it('puts the busiest silo ~10 days above its low level and the next just under it', () => {
    const changes = pickDemoLevels(
      [source('SILO-004', 7500, 16.32), source('SILO-004', 7500, 12), source('SILO-002', 10000, 100), source('SILO-006', 9000, 0), source('STORE-001', 40000, 400, 'STORE')],
      new Map([['SILO-002', 18000], ['SILO-004', 13500]]),
    );
    expect(changes).toEqual([
      { siloId: 'SILO-002', siloCode: 'VIL100/SILO-002', lowKg: 9000, why: 'RUNS_DOWN' },
      { siloId: 'SILO-004', siloCode: 'VIL100/SILO-004', lowKg: 7501, why: 'BELOW_NOW' },
    ]);
  });

  it('never proposes a low level at or above the silo\'s high level, nor a non-positive one', () => {
    expect(pickDemoLevels([source('A', 50, 10), source('B', 1000, 5)], new Map([['B', 1000]]))).toEqual([]);
  });
});
```

Run: `pnpm nx test api -- --testPathPatterns="demo-feed-defaults|feed-planning" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL.

- [ ] **Step 2: Helpers.** Append to `demo-feed-defaults.ts`:

```ts
/** S10: what the demo's inventory chapter receives into a silo — half its capacity, or the old flat figure when it has none. */
export function siloFillKg(capacityKg: number | null, fallbackKg: number): number {
  return capacityKg && capacityKg > 0 ? Math.round((capacityKg * DEMO_SILO_FILL_PCT) / 100) : fallbackKg;
}
```

```ts
// apps/api/src/scripts/demo/feed-planning.ts
/**
 * Pure helpers for the demo's feed story (Plan S, B1): kept out of the chapter
 * files so they can be tested without booting the app.
 */
import type { ForecastSource } from '../../modules/inventory/feed-forecast/feed-forecast.engine';

/**
 * How many days before the build an animal the demo moves into a stage
 * entered it. Five, as before, but never so early that a short stage has
 * already run out: a stage lasting N days is left on day N at the latest, so
 * a 2-day INSEMINATION is entered today and a 3-day FARROWING yesterday.
 * Review A6 found a fresh demo's INSEMINATION "Due, not posted".
 */
export function stageEntryDaysAgo(durationDays: number | null): number {
  if (durationDays == null || durationDays <= 0) return 5;
  return Math.max(0, Math.min(5, durationDays - 2));
}

export interface DemoLevelChange {
  siloId: string;
  siloCode: string;
  lowKg: number;
  why: 'RUNS_DOWN' | 'BELOW_NOW';
}

/**
 * S10: the two VIL100 silo levels that make the feed features visible in a
 * fresh demo. The busiest feeding silo gets a low level ten days of today's
 * use below its stock (a run-down inside the 45-day horizon, with refill and
 * required-on dates ahead of today); the next gets one just above its stock
 * (FEED_BELOW_L1 at once). A proposal that would reach the silo's high level,
 * or fall to zero, is dropped rather than bent.
 */
export function pickDemoLevels(
  sources: Array<Pick<ForecastSource, 'sourceType' | 'sourceCode' | 'locationId' | 'balanceKg' | 'planningDayDemandKg'>>,
  highOf: Map<string, number | null>,
): DemoLevelChange[] {
  const bySilo = new Map<string, (typeof sources)[number]>();
  for (const s of sources) {
    if (s.sourceType !== 'SILO' || !s.locationId || s.planningDayDemandKg <= 0 || s.balanceKg <= 0) continue;
    const seen = bySilo.get(s.locationId);
    if (!seen || s.planningDayDemandKg > seen.planningDayDemandKg) bySilo.set(s.locationId, s);
  }
  const [busiest, next] = [...bySilo.values()].sort((a, b) => b.planningDayDemandKg - a.planningDayDemandKg);
  const fits = (siloId: string, lowKg: number) => {
    const high = highOf.get(siloId);
    return lowKg > 0 && (high == null || lowKg < high);
  };
  const out: DemoLevelChange[] = [];
  if (busiest) {
    const lowKg = Math.floor(busiest.balanceKg - 10 * busiest.planningDayDemandKg);
    if (fits(busiest.locationId, lowKg)) out.push({ siloId: busiest.locationId, siloCode: busiest.sourceCode, lowKg, why: 'RUNS_DOWN' });
  }
  if (next) {
    const lowKg = Math.ceil(next.balanceKg + 1);
    if (fits(next.locationId, lowKg)) out.push({ siloId: next.locationId, siloCode: next.sourceCode, lowKg, why: 'BELOW_NOW' });
  }
  return out;
}
```

- [ ] **Step 3: Chapter 07**

```ts
// apps/api/src/scripts/demo/chapters/07-feed-planning.ts
/**
 * Chapter `07-feed-planning` — Plan S, B1. Makes a fresh demo show the feed
 * features working, through the application's own services (Ruling 1):
 *
 *   - the July–June reporting year containing today, for the demo company
 *     (the Feed Forecast's Reporting Period view needs one);
 *   - two VIL100 silo low levels (S10, pickDemoLevels): one run-down inside
 *     the horizon, one FEED_BELOW_L1 at once;
 *   - a feed-alert evaluation of every demo farm, so the Alerts page opens
 *     with the demo's alerts already raised.
 *
 * Resume-safe: generate skips existing periods; the levels are recomputed
 * from the stock at run time; evaluation is idempotent.
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=07-feed-planning
 */
import { inArray } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { FeedForecastService } from '../../../modules/inventory/feed-forecast/feed-forecast.service';
import { FeedAlertService } from '../../../modules/inventory/feed-alert/feed-alert.service';
import { LocationService } from '../../../modules/master-data/location/location.service';
import { ReportingPeriodService } from '../../../modules/master-data/reporting-period/reporting-period.service';
import { businessYearOf } from '../../../modules/master-data/reporting-period/reporting-period.rules';
import type { DemoChapter, DemoContext } from '../chapter';
import { pickDemoLevels } from '../feed-planning';

export const feedPlanningChapter: DemoChapter = {
  name: '07-feed-planning',

  async run(ctx: DemoContext): Promise<void> {
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('07-feed-planning: tenantDb is not set — run through the harness.');

    // 1. The reporting year containing today.
    const startYear = Number(businessYearOf(new Date().toISOString().slice(0, 10)).slice(0, 4));
    const generated = await ctx.app.get(ReportingPeriodService).generate({ company_id: ctx.companyId, business_year_start: startYear }, ctx.tenantId, ctx.actor);
    ctx.log(`07 reporting year ${startYear}: ${generated.created.length} period(s) created, ${generated.skipped.length} already there`);

    // 2. VIL100's two silo levels.
    const vil = ctx.demoFarms.find((f) => f.code === 'VIL100');
    if (!vil) {
      ctx.log('07 VIL100 is not part of this run — silo levels left at their defaults');
    } else {
      const report = await ctx.app.get(FeedForecastService).computeForFarm(vil.farmId, ctx.companyId, ctx.tenantId);
      const siloIds = [...new Set(report.sources.filter((s) => s.sourceType === 'SILO').map((s) => s.locationId))];
      const highs = siloIds.length
        ? await db
            .select({ id: schema.locationMaster.location_id, high: schema.locationMaster.high_level_kg })
            .from(schema.locationMaster)
            .where(inArray(schema.locationMaster.location_id, siloIds))
        : [];
      const highOf = new Map(highs.map((h) => [h.id, h.high == null ? null : Number(h.high)] as const));
      const changes = pickDemoLevels(report.sources, highOf);
      for (const change of changes) {
        await ctx.app.get(LocationService).update(change.siloId, { low_level_kg: change.lowKg }, ctx.tenantId, ctx.actor);
        ctx.log(`07 ${change.siloCode} low level set to ${change.lowKg} kg (${change.why === 'RUNS_DOWN' ? 'runs down in about 10 days' : 'below it now'})`);
      }
      if (changes.length < 2) ctx.log(`07 only ${changes.length} VIL100 silo(s) had stock and use to set a level on`);
    }

    // 3. Raise the demo's feed alerts now, so the Alerts page opens with them.
    const alerts = ctx.app.get(FeedAlertService);
    for (const farm of ctx.demoFarms) await alerts.evaluateFarmSafely(farm.farmId, ctx.companyId, ctx.tenantId);
    ctx.log(`07 feed alerts evaluated on ${ctx.demoFarms.length} farm(s)`);
  },
};
```

In `demo-chapters.ts`, add `import { feedPlanningChapter } from './demo/chapters/07-feed-planning';` after the `approvalsChapter` import, and append `feedPlanningChapter` to `CHAPTERS` after `approvalsChapter`.

- [ ] **Step 4: Chapter 02 and the breeding stock.** In `02-inventory.ts`, add `import { siloFillKg } from '../../../core/database/demo-feed-defaults';`. Inside `for (const silo of siloIds) {` in section 1, directly after `const feed = await itemByHandle(db, silo.feedHandle);`, insert:

```ts
            // S10: half the silo's capacity, so a fresh demo sits between its 20 % and 90 % levels.
            const [capacity] = await db
              .select({ kg: schema.locationMaster.silo_capacity_kg })
              .from(schema.locationMaster)
              .where(eq(schema.locationMaster.location_id, silo.id))
              .limit(1);
```

and change that receipt line's `quantity: DEMO_OPERATIONS.feedReceiptKgPerSilo,` to `quantity: siloFillKg(capacity?.kg == null ? null : Number(capacity.kg), DEMO_OPERATIONS.feedReceiptKgPerSilo),`. Change the comment on `feedReceiptKgPerSilo` in `DEMO_OPERATIONS` to `// Only for a silo with no recorded capacity; see siloFillKg (S10).`

In `register-breeding-stock.ts`, change `import { and, eq } from 'drizzle-orm';` to `import { and, eq, inArray } from 'drizzle-orm';` and add `import { stageEntryDaysAgo } from './feed-planning';`. Inside `if (batchAnimals.length) {`, before `let cursor = 0;`, insert:

```ts
      // B1: each destination stage's length, so an animal enters it early enough to still be in it today.
      const durations = new Map(
        (await db
          .select({ stage_id: schema.stageMaster.stage_id, days: schema.stageMaster.typical_duration_days })
          .from(schema.stageMaster)
          .where(inArray(schema.stageMaster.stage_id, [...new Set(destStages)]))).map((r) => [r.stage_id, r.days] as const),
      );
```

and change `transition_date: dateNdaysAgo(5),` to `transition_date: dateNdaysAgo(stageEntryDaysAgo(durations.get(target) ?? null)),`.

- [ ] **Step 5: The rebuild check script** (for Rishi to run after his rebuild; read-only):

```bash
#!/bin/bash
# Plan S: read-only MySQL checks after a local db-rebuild-demo. Reads nf_devco only.
# Runs Plan A's checks first, then the Plan S ones.
bash /Users/nero/Desktop/navfarm/.superpowers/sdd/2026-09-25-feed-forecast-a-silo-and-report/verify-after-rebuild.sh
cd /Users/nero/Desktop/navfarm/apps/api; set -a; . ./.env; set +a; export MYSQL_PWD="$DATABASE_PASSWORD"
Q() { mysql -h 127.0.0.1 -u root -t nf_devco -e "$1"; }
echo "== migrations (expect 126 rows, last 1791481200000 — 0125)"
Q "SELECT COUNT(*) n, MAX(created_at) last FROM __drizzle_migrations"
echo "== silos without both feed levels (expect 0)"
Q "SELECT COUNT(*) n FROM location_master WHERE location_type='SILO' AND deleted_at IS NULL AND (low_level_kg IS NULL OR high_level_kg IS NULL)"
echo "== silos below their low level (expect exactly the VIL100 one chapter 07 set)"
Q "SELECT w.location_code, w.low_level_kg, ROUND(SUM(il.quantity),2) kg FROM location_master w JOIN inventory_ledger il ON il.warehouse_id=w.location_id WHERE w.location_type='SILO' GROUP BY w.location_id HAVING kg <= MAX(w.low_level_kg)"
echo "== FEED_BELOW_L1 alerts open (expect >= 1, on VIL100)"
Q "SELECT l.location_code farm, a.title FROM feed_alert a JOIN location_master l ON l.location_id=a.farm_id WHERE a.event_type='FEED_BELOW_L1' AND a.status='ACTIVE'"
echo "== stage timings (expect DRY_SOW 7, FLUSH 14, FARROWING 3, WEANING 1; WEANER->GROWER, GROWER->FINISHER; both scopes)"
Q "SELECT s.stage_code, s.company_id IS NULL tmpl, s.typical_duration_days dur, n.stage_code next FROM stage_master s LEFT JOIN stage_master n ON n.stage_id=s.next_stage_id WHERE s.stage_code IN ('DRY_SOW','FLUSH','INSEMINATION','FARROWING','WEANING','WEANER','GROWER') AND s.deleted_at IS NULL ORDER BY 1,2"
echo "== DRY_SOW feed rows (expect > 0)"
Q "SELECT COUNT(*) n FROM breed_lifecycle_stages l JOIN stage_master s ON s.stage_id=l.stage_id WHERE s.stage_code='DRY_SOW' AND l.feed_item_id IS NOT NULL"
echo "== reporting periods of the demo company (expect 12)"
Q "SELECT business_year, COUNT(*) n FROM reporting_period WHERE deleted_at IS NULL GROUP BY 1"
echo "== ACTIVE batches with and without a shed"
Q "SELECT SUM(shed_id IS NOT NULL) with_shed, SUM(shed_id IS NULL) no_shed FROM batch_header WHERE status='ACTIVE' AND deleted_at IS NULL"
echo "== FEED_REQUISITION approval rows carry farm and document (0122)"
Q "SELECT status, SUM(farm_id IS NOT NULL) farm, SUM(document_id IS NOT NULL) doc, COUNT(*) n FROM approval_request WHERE doc_type='FEED_REQUISITION' GROUP BY 1"
```

Save it as `.superpowers/sdd/2026-09-27-feed-forecast-s-fixes/verify-after-rebuild.sh` (`chmod +x`). The `.superpowers/` folder is git-ignored scratch, so the script is not committed.

- [ ] **Step 6: Run the tests, typecheck and a read-only chapter plan**

Run: `pnpm nx test api -- --testPathPatterns="demo-feed-defaults|feed-planning|batch-helpers|daily-entry-plan" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"` → no errors.
Run the chapter runner **without `--apply`**, which only prints the chapter list: `pnpm nx run api:db-demo-chapters 2>&1 | grep -E "Chapters to|Read-only"`. It must list `07-feed-planning` last. If the batch_header guard refuses first ("already holds … row(s)"), that is its read-only refusal, and the list check waits for Rishi's rebuild. Record it in the ledger.

- [ ] **Step 7: Commit and write the ledger line**

```bash
git commit -m "feat(demo): half-full silos, in-date breeding stages, a reporting year and a VIL100 low-feed story (B1, S10)

A fresh demo put every silo at 2,000 kg (under the new 20 % low level on all
53), moved breeding animals into every stage five days back (so a 2-day
INSEMINATION read 'Due, not posted'), had no reporting year, and showed no
run-down or low-feed alert. Chapter 02 now fills silos to half capacity,
the breeding spread enters short stages late enough to still be in them,
and the new chapter 07 generates the business year, sets two VIL100 silo
levels (one runs down in ~10 days, one alerts now) and raises the alerts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/core/database/demo-feed-defaults.ts apps/api/src/core/database/demo-feed-defaults.spec.ts apps/api/src/scripts/demo/feed-planning.ts apps/api/src/scripts/demo/feed-planning.spec.ts apps/api/src/scripts/demo/chapters/07-feed-planning.ts apps/api/src/scripts/demo-chapters.ts apps/api/src/scripts/demo/chapters/02-inventory.ts apps/api/src/scripts/demo/register-breeding-stock.ts
```

---

### Task 20: B2 — migrations 0123 (D21 shed), 0124 (D22 levels), 0125 (D23 stage gaps)

**Files:**
- Create: `apps/api/src/drizzle/tenant/0123_batch_shed_from_placement.sql`
- Create: `apps/api/src/drizzle/tenant/0124_silo_level_defaults.sql`
- Create: `apps/api/src/drizzle/tenant/0125_system_stage_timings.sql`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json` (entries 123–125)
- Create: `apps/api/src/drizzle/tenant/plan-s-migrations.spec.ts`

**Interfaces:**
- Consumes (Task 18): `SILO_LOW_LEVEL_PCT`, `SILO_HIGH_LEVEL_PCT`, `DEMO_STAGE_DURATIONS`, `DEMO_NEXT_STAGES`. The spec pins the SQL to them.
- Produces: journal entries `{ idx: 123, when: 1791308400000, tag: "0123_batch_shed_from_placement" }`, `{ idx: 124, when: 1791394800000, tag: "0124_silo_level_defaults" }`, `{ idx: 125, when: 1791481200000, tag: "0125_system_stage_timings" }`.

Rules every statement keeps (B2): it writes only a column that is still NULL (its WHERE says so), so a second run changes nothing and a tester's value is never overwritten. Nothing is deleted, dropped or altered.

- **0123 (D21)** sets `batch_header.shed_id` only when the answer is certain:
  - (a) Every live animal of the batch stands in a location that resolves to a shed (the shed itself, or a pen or crate under it, up to two levels), and all of them resolve to the same shed.
  - (b) Or the batch has no placed live animal that points elsewhere, and every scheduler header of the batch that names a location resolves to the same single shed.
  - In both cases the shed must be an active SHED of the batch's company and, when the batch has a farm, of that farm. A batch with no farm takes the shed's.
  - Anything else (animals in two sheds, animals placed on the farm itself, no evidence) is left alone and keeps the "no shed on record" note.
  - On `nf_devco` of 27 Sep: (a) finds none (the animals are unplaced or spread over three sheds). (b) finds the one batch (`620768db…`) whose single header names a shed.
- **0124 (D22, D27)** fills only empty levels on `location_type = 'SILO'` rows: High = 90 % and Low = 20 % of `silo_capacity_kg`. That column is already kilograms: the location service converts a tonne entry on save, and this was verified in Plan A. A default is not written where it would break `low < high` against a value a tester already set. That silo then keeps one empty level and the form (Task 4) asks for it on the next edit.
- **0125 (D23, S7)** fills only an empty `typical_duration_days` on the four ranged system stages (DRY_SOW 7, FLUSH 14, FARROWING 3, WEANING 1) and only an empty `next_stage_id` on WEANER → GROWER and GROWER → FINISHER. It applies to `is_system = 1` rows in either scope, and the successor is looked up in the same tenant, LOB and company scope. Feed-row gaps inside a stage are not migrated (D23): they stay visible as a note for the farm to fix in Breed Lifecycle Stage Config.

- [ ] **Step 1: Write the failing spec**

```ts
// apps/api/src/drizzle/tenant/plan-s-migrations.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_NEXT_STAGES, DEMO_STAGE_DURATIONS, SILO_HIGH_LEVEL_PCT, SILO_LOW_LEVEL_PCT } from '../../core/database/demo-feed-defaults';

/**
 * Plan S, B2: the three data repairs run on testers' presentation data. They
 * must only fill what is empty, never delete or reshape anything, and use the
 * same values the demo seed uses. Their behaviour on real rows is proved in
 * the rehearsal (Task 21); this pins their text.
 */
const dir = __dirname;
const read = (tag: string) => readFileSync(join(dir, `${tag}.sql`), 'utf8');
const statements = (tag: string) => read(tag).split('--> statement-breakpoint').map((s) => s.replace(/^--.*$/gm, '').trim()).filter(Boolean);
const TAGS = ['0123_batch_shed_from_placement', '0124_silo_level_defaults', '0125_system_stage_timings'];

describe('Plan S data migrations (D21–D23)', () => {
  it('are journalled after 0122, a day apart', () => {
    const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
    const tail = journal.slice(-4);
    expect(tail.map((e) => [e.idx, e.when, e.tag])).toEqual([
      [122, 1791222000000, '0122_approval_request_farm_document'],
      [123, 1791308400000, TAGS[0]],
      [124, 1791394800000, TAGS[1]],
      [125, 1791481200000, TAGS[2]],
    ]);
  });

  it('only UPDATE, and only where the column they set is still empty', () => {
    const guard: Record<string, string[]> = {
      [TAGS[0]]: ['b.`shed_id` IS NULL', 'b.`shed_id` IS NULL'],
      [TAGS[1]]: ['`high_level_kg` IS NULL', '`low_level_kg` IS NULL'],
      [TAGS[2]]: ['`typical_duration_days` IS NULL', 's.`next_stage_id` IS NULL'],
    };
    for (const tag of TAGS) {
      const list = statements(tag);
      expect(list).toHaveLength(guard[tag].length);
      list.forEach((sql, i) => {
        expect(sql).toMatch(/^UPDATE /);
        expect(sql).toContain(guard[tag][i]);
        expect(sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
      });
    }
  });

  it('fill silo levels with the same percentages as the demo seed (D22, D27)', () => {
    const [high, low] = statements(TAGS[1]);
    expect(high).toContain(`* ${(SILO_HIGH_LEVEL_PCT / 100).toFixed(2)}`);
    expect(low).toContain(`* ${(SILO_LOW_LEVEL_PCT / 100).toFixed(2)}`);
    expect(high).toContain("`location_type` = 'SILO'");
  });

  it('fill stage timings with the same values as the demo seed (S7), on system stages only', () => {
    const [durations, next] = statements(TAGS[2]);
    for (const [code, days] of Object.entries(DEMO_STAGE_DURATIONS)) expect(durations).toContain(`WHEN '${code}' THEN ${days}`);
    for (const [code, successor] of Object.entries(DEMO_NEXT_STAGES)) expect(next).toContain(`WHEN '${code}' THEN '${successor}'`);
    expect(durations).toContain('`is_system` = 1');
    expect(next).toContain('s.`is_system` = 1');
  });

  it('set a batch shed only from a single shed, of the batch\'s own company and farm (D21)', () => {
    for (const sql of statements(TAGS[0])) {
      expect(sql).toContain('COUNT(DISTINCT');
      expect(sql).toContain("sh.`location_type` = 'SHED'");
      expect(sql).toContain('sh.`company_id` = b.`company_id`');
      expect(sql).toContain("NOT IN ('DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED')");
    }
  });
});
```

Run: `pnpm nx test api -- --testPathPatterns=plan-s-migrations 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → FAIL (files missing).

- [ ] **Step 2: The migrations**

```sql
-- apps/api/src/drizzle/tenant/0123_batch_shed_from_placement.sql
-- D21 (Rishi, 27 Sep): a batch with no shed is fed from the farm store in
-- the Feed Forecast. On existing data the shed is set only where it is
-- certain, and never over a shed someone chose:
--   (1) every live animal of the batch stands in one shed (the shed, or a
--       pen/crate under it), or
--   (2) no placed live animal says otherwise and every scheduler header of
--       the batch that names a location names the same one shed.
-- The shed must be an active SHED of the batch's company and farm; a batch
-- with no farm takes the shed's. Anything ambiguous is left alone and keeps
-- the "no shed on record" note; batch edit (PATCH /batch/:id/shed) sets it.
UPDATE `batch_header` b
JOIN (
  SELECT x.`batch_id`, MIN(x.`shed_id`) AS `shed_id`
  FROM (
    SELECT a.`current_batch_id` AS `batch_id`,
           COALESCE(IF(l.`location_type` = 'SHED', l.`location_id`, NULL),
                    IF(p.`location_type` = 'SHED', p.`location_id`, NULL),
                    IF(g.`location_type` = 'SHED', g.`location_id`, NULL)) AS `shed_id`
    FROM `animal_register` a
    LEFT JOIN `location_master` l ON l.`location_id` = a.`current_location_id`
    LEFT JOIN `location_master` p ON p.`location_id` = l.`parent_location_id`
    LEFT JOIN `location_master` g ON g.`location_id` = p.`parent_location_id`
    WHERE a.`current_batch_id` IS NOT NULL
      AND a.`status` NOT IN ('DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED')
  ) x
  GROUP BY x.`batch_id`
  HAVING COUNT(*) = COUNT(x.`shed_id`) AND COUNT(DISTINCT x.`shed_id`) = 1
) s ON s.`batch_id` = b.`batch_id`
JOIN `location_master` sh ON sh.`location_id` = s.`shed_id`
SET b.`shed_id` = s.`shed_id`,
    b.`farm_id` = COALESCE(b.`farm_id`, sh.`farm_id`, sh.`parent_location_id`)
WHERE b.`shed_id` IS NULL
  AND b.`deleted_at` IS NULL
  AND sh.`location_type` = 'SHED'
  AND sh.`is_active` = 1
  AND sh.`deleted_at` IS NULL
  AND sh.`company_id` = b.`company_id`
  AND (b.`farm_id` IS NULL OR b.`farm_id` = COALESCE(sh.`farm_id`, sh.`parent_location_id`));
--> statement-breakpoint
UPDATE `batch_header` b
JOIN (
  SELECT y.`batch_id`, MIN(y.`shed_id`) AS `shed_id`
  FROM (
    SELECT h.`batch_id`,
           COALESCE(IF(l.`location_type` = 'SHED', l.`location_id`, NULL),
                    IF(p.`location_type` = 'SHED', p.`location_id`, NULL),
                    IF(g.`location_type` = 'SHED', g.`location_id`, NULL)) AS `shed_id`
    FROM `scheduler_header` h
    JOIN `location_master` l ON l.`location_id` = h.`location_id`
    LEFT JOIN `location_master` p ON p.`location_id` = l.`parent_location_id`
    LEFT JOIN `location_master` g ON g.`location_id` = p.`parent_location_id`
  ) y
  GROUP BY y.`batch_id`
  HAVING COUNT(*) = COUNT(y.`shed_id`) AND COUNT(DISTINCT y.`shed_id`) = 1
) s ON s.`batch_id` = b.`batch_id`
JOIN `location_master` sh ON sh.`location_id` = s.`shed_id`
SET b.`shed_id` = s.`shed_id`,
    b.`farm_id` = COALESCE(b.`farm_id`, sh.`farm_id`, sh.`parent_location_id`)
WHERE b.`shed_id` IS NULL
  AND b.`deleted_at` IS NULL
  AND sh.`location_type` = 'SHED'
  AND sh.`is_active` = 1
  AND sh.`deleted_at` IS NULL
  AND sh.`company_id` = b.`company_id`
  AND (b.`farm_id` IS NULL OR b.`farm_id` = COALESCE(sh.`farm_id`, sh.`parent_location_id`))
  AND NOT EXISTS (
    SELECT 1
    FROM `animal_register` a
    LEFT JOIN `location_master` l2 ON l2.`location_id` = a.`current_location_id`
    LEFT JOIN `location_master` p2 ON p2.`location_id` = l2.`parent_location_id`
    LEFT JOIN `location_master` g2 ON g2.`location_id` = p2.`parent_location_id`
    WHERE a.`current_batch_id` = b.`batch_id`
      AND a.`status` NOT IN ('DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED')
      AND a.`current_location_id` IS NOT NULL
      AND NOT (COALESCE(IF(l2.`location_type` = 'SHED', l2.`location_id`, NULL),
                        IF(p2.`location_type` = 'SHED', p2.`location_id`, NULL),
                        IF(g2.`location_type` = 'SHED', g2.`location_id`, NULL)) <=> s.`shed_id`)
  );
```

```sql
-- apps/api/src/drizzle/tenant/0124_silo_level_defaults.sql
-- D22 / D27 (Rishi, 27 Sep): a silo must carry both feed levels. Existing
-- silos without them get High = 90 % of capacity (workbook Master Setup §1
-- row 12) and Low = 20 % (confirmed by Rishi, D27) — only where the level is
-- empty, and never where the default would break low < high against a value
-- someone already set (that silo keeps its empty level and the form asks for
-- it). silo_capacity_kg is kilograms whatever unit was typed: the location
-- service converts on save (checked in Plan A). Editable afterwards.
UPDATE `location_master`
SET `high_level_kg` = ROUND(`silo_capacity_kg` * 0.90, 2)
WHERE `location_type` = 'SILO'
  AND `high_level_kg` IS NULL
  AND `silo_capacity_kg` > 0
  AND (`low_level_kg` IS NULL OR ROUND(`silo_capacity_kg` * 0.90, 2) > `low_level_kg`);
--> statement-breakpoint
UPDATE `location_master`
SET `low_level_kg` = ROUND(`silo_capacity_kg` * 0.20, 2)
WHERE `location_type` = 'SILO'
  AND `low_level_kg` IS NULL
  AND `silo_capacity_kg` > 0
  AND (`high_level_kg` IS NULL OR ROUND(`silo_capacity_kg` * 0.20, 2) < `high_level_kg`);
```

```sql
-- apps/api/src/drizzle/tenant/0125_system_stage_timings.sql
-- D23 (Rishi, 27 Sep): system (seeded) stages missing a duration or a next
-- stage leave the Feed Forecast unable to date a stage change ("24/09/26 –
-- —"). Only EMPTY values on is_system rows are filled, never a tester's:
-- the four stages BBP §1.7 gives only as a range take the demo lifecycle's
-- own lengths (open question S7: DRY_SOW 7, FLUSH 14, FARROWING 3, WEANING 1
-- — demo-feed-defaults.ts), and the grow-out chain WEANER -> GROWER ->
-- FINISHER is linked within the same tenant, LOB and company scope.
UPDATE `stage_master`
SET `typical_duration_days` = CASE `stage_code`
    WHEN 'DRY_SOW' THEN 7
    WHEN 'FLUSH' THEN 14
    WHEN 'FARROWING' THEN 3
    WHEN 'WEANING' THEN 1
  END
WHERE `is_system` = 1
  AND `deleted_at` IS NULL
  AND `typical_duration_days` IS NULL
  AND `stage_code` IN ('DRY_SOW', 'FLUSH', 'FARROWING', 'WEANING');
--> statement-breakpoint
UPDATE `stage_master` s
JOIN `stage_master` n
  ON n.`tenant_id` = s.`tenant_id`
 AND n.`lob_id` = s.`lob_id`
 AND n.`company_id` <=> s.`company_id`
 AND n.`deleted_at` IS NULL
 AND n.`stage_code` = CASE s.`stage_code` WHEN 'WEANER' THEN 'GROWER' WHEN 'GROWER' THEN 'FINISHER' END
SET s.`next_stage_id` = n.`stage_id`
WHERE s.`is_system` = 1
  AND s.`deleted_at` IS NULL
  AND s.`next_stage_id` IS NULL
  AND s.`stage_code` IN ('WEANER', 'GROWER');
```

The first comment line of each block names the file. It may stay in the file: the migrator skips comments.

Append to `meta/_journal.json`'s `entries`, after the idx 122 object:

```json
    {
      "idx": 123,
      "version": "5",
      "when": 1791308400000,
      "tag": "0123_batch_shed_from_placement",
      "breakpoints": true
    },
    {
      "idx": 124,
      "version": "5",
      "when": 1791394800000,
      "tag": "0124_silo_level_defaults",
      "breakpoints": true
    },
    {
      "idx": 125,
      "version": "5",
      "when": 1791481200000,
      "tag": "0125_system_stage_timings",
      "breakpoints": true
    }
```

- [ ] **Step 3: Run the spec**

Run: `pnpm nx test api -- --testPathPatterns="plan-s-migrations|demo-feed-defaults" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|error TS"` → pass.

- [ ] **Step 4: Predict what they will change on nf_devco** (read-only):

```sql
SELECT COUNT(*) silos_high_to_fill FROM location_master WHERE location_type='SILO' AND high_level_kg IS NULL AND silo_capacity_kg > 0;
SELECT COUNT(*) silos_low_to_fill  FROM location_master WHERE location_type='SILO' AND low_level_kg  IS NULL AND silo_capacity_kg > 0;
SELECT stage_code, COUNT(*) FROM stage_master WHERE is_system=1 AND deleted_at IS NULL AND typical_duration_days IS NULL AND stage_code IN ('DRY_SOW','FLUSH','FARROWING','WEANING') GROUP BY 1;
SELECT stage_code, COUNT(*) FROM stage_master WHERE is_system=1 AND deleted_at IS NULL AND next_stage_id IS NULL AND stage_code IN ('WEANER','GROWER') GROUP BY 1;
SELECT COUNT(*) batches_without_shed FROM batch_header WHERE shed_id IS NULL AND deleted_at IS NULL;
```

Record the numbers in the ledger: they are the expected "rows changed" for Task 21. Expected on 27 Sep: 52 silos for each level (the 53 SILO rows less VIL100/SILO-007, which Task 4 filled; check this against the Task 4 ledger line), 2 per ranged stage code (tenant + company), 2 each for WEANER and GROWER, and 23 batches without a shed.

- [ ] **Step 5: Apply locally** with `pnpm nx run api:db-migrate-all-tenants 2>&1 | tail -20`. If the auto-mode classifier refuses it, do not work around it. Record `Ruling (Task 20): not applied locally; proved in Task 21's rehearsal; Rishi to run db-migrate-all-tenants before Task 22`. If it runs: `SELECT COUNT(*), MAX(created_at) FROM __drizzle_migrations` → 126, 1791481200000. Re-run the Step 4 queries: silos and stages 0 left to fill, and batches without a shed down by the number 0123 set (1 expected).

- [ ] **Step 6: Commit and write the ledger line**

```bash
git commit -m "feat(db): repair existing data for Plan S — batch sheds, silo levels, stage timings (D21, D22, D23)

Testers' presentation data on the test server predates D21–D23: batches
with no shed (fed from the store in the forecast), silos with no feed
levels (never alerted on), and system stages without a duration or next
stage (no stage-change date). 0123 sets a batch shed only when the animals
or scheduler headers name exactly one shed of the batch's own company and
farm; 0124 fills empty levels at 90 %/20 % of capacity without breaking a
level already set; 0125 fills empty durations and grow-out successors on
system stages from the same constants as the demo seed. Every statement
updates only NULL columns, so a re-run changes nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- apps/api/src/drizzle/tenant/0123_batch_shed_from_placement.sql apps/api/src/drizzle/tenant/0124_silo_level_defaults.sql apps/api/src/drizzle/tenant/0125_system_stage_timings.sql apps/api/src/drizzle/tenant/meta/_journal.json apps/api/src/drizzle/tenant/plan-s-migrations.spec.ts
```

---

### Task 21: B2 — rehearsal on a server-like copy, and the runbook

**Files:**
- Create (scratch, not committed; `$S` = this session's scratchpad directory): `$S/plan-s-rehearsal/01_roll_to_server_state.sql`, `02_edge_cases.sql`, `run-migrator.cjs`, `snapshot.sh`
- Create (git-ignored): `.superpowers/sdd/2026-09-27-feed-forecast-s-fixes/migration-rehearsal.md`
- Modify: `docs/deploy-rdp-windows.md` §13 (a Plan S release block)

**Interfaces:**
- Consumes: migrations 0122–0125 (Tasks 6, 20); the real Drizzle migrator, called the way `migrate-all-tenants.ts` calls it.
- Produces: a rehearsal report with before/after counts and checksums, the tested recovery for a half-applied 0122, and a runbook block for the server.

Method (Plan A's rehearsal, `.superpowers/sdd/2026-09-25-feed-forecast-a-silo-and-report/migration-rehearsal.md`): dump `nf_devco`, load it into the scratch database `nf_rehearsal_s`, and roll it back to the server's state (0121 applied, no Plan S data). Add tester-style edge cases, then run the real migrator twice. Compare the row count of every table, `CHECKSUM TABLE` of every table, and per-row hashes of the three tables the migrations change, excluding the columns they may set. Drop the scratch database at the end. Nothing else is written.

- [ ] **Step 1: The copy.** Run from `apps/api` with the `.env` loaded (`set -a; . ./.env; set +a; export MYSQL_PWD="$DATABASE_PASSWORD"`):

```bash
S=<scratchpad>/plan-s-rehearsal; mkdir -p $S
mysqldump -h 127.0.0.1 -u root --single-transaction --skip-lock-tables --no-tablespaces --routines --triggers --set-gtid-purged=OFF nf_devco --result-file=$S/nf_devco.sql
mysql -h 127.0.0.1 -u root -e "CREATE DATABASE nf_rehearsal_s CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
mysql -h 127.0.0.1 -u root nf_rehearsal_s < $S/nf_devco.sql
```

`$S/01_roll_to_server_state.sql` (run against `nf_rehearsal_s` only). The server has had none of Plan S: no 0122 columns, no silo levels, no stage timings.

```sql
-- Undo 0122's schema if the local database has it; the migrator re-applies it.
SET @has := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'approval_request' AND column_name = 'farm_id');
SET @sql := IF(@has > 0, 'ALTER TABLE approval_request DROP INDEX idx_approval_request_farm, DROP INDEX idx_approval_request_document, DROP COLUMN farm_id, DROP COLUMN document_id', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
DELETE FROM __drizzle_migrations WHERE created_at > 1791135600000;
-- The server's data as D22/D23 found it: no silo levels, no ranged-stage timings.
UPDATE location_master SET low_level_kg = NULL, high_level_kg = NULL WHERE location_type = 'SILO';
UPDATE stage_master SET typical_duration_days = NULL WHERE is_system = 1 AND stage_code IN ('DRY_SOW', 'FLUSH', 'FARROWING', 'WEANING');
UPDATE stage_master SET next_stage_id = NULL WHERE is_system = 1 AND stage_code IN ('WEANER', 'GROWER');
SELECT COUNT(*) journal_rows, MAX(created_at) last FROM __drizzle_migrations;  -- expect 122, 1791135600000
```

If Task 20 applied 0123 locally, also clear the sheds it set: `UPDATE batch_header SET shed_id = NULL WHERE batch_id IN (<the ids the Task 20 ledger line names>);`.

`$S/02_edge_cases.sql`. These are tester-style values the migrations must leave alone (Review Focus 5), each written as a tester would:

```sql
-- E1: a silo with only a high level set -> high kept, low default written (2400 < 11000).
UPDATE location_master SET high_level_kg = 11000 WHERE location_code = 'VIL100/SILO-001';
-- E2: a silo with only a low level set above the 90 % default -> low kept, high left EMPTY (18000 <= 19000).
UPDATE location_master SET low_level_kg = 19000 WHERE location_code = 'VIL100/SILO-002';
-- E3: a silo with both levels set -> untouched.
UPDATE location_master SET low_level_kg = 1000, high_level_kg = 5000 WHERE location_code = 'VIL100/SILO-003';
-- E4: a tester's own FLUSH duration on the company copy -> kept; the tenant template still gets 14.
UPDATE stage_master SET typical_duration_days = 10 WHERE stage_code = 'FLUSH' AND company_id IS NOT NULL AND is_system = 1;
-- E5: a tester's own successor for GROWER on the company copy -> kept.
UPDATE stage_master g JOIN stage_master q ON q.stage_code = 'QUARANTINE' AND q.company_id = g.company_id
  SET g.next_stage_id = q.stage_id WHERE g.stage_code = 'GROWER' AND g.company_id IS NOT NULL;
-- E6: every live animal of one unplaced batch moved into pens of ONE shed of its farm -> 0123 (1) sets that shed.
SET @b := (SELECT batch_id FROM batch_header WHERE batch_id LIKE 'f86b41b4%');
SET @pen := (SELECT p.location_id FROM location_master p JOIN location_master s ON s.location_id = p.parent_location_id
             JOIN batch_header b ON b.batch_id = @b
             WHERE p.location_type = 'PEN' AND s.location_type = 'SHED' AND s.company_id = b.company_id
               AND (b.farm_id IS NULL OR COALESCE(s.farm_id, s.parent_location_id) = b.farm_id) AND s.is_active = 1
             ORDER BY p.location_code LIMIT 1);
UPDATE animal_register SET current_location_id = @pen WHERE current_batch_id = @b AND status NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED');
-- E7: a batch whose shed a tester chose -> kept, whatever its animals say.
SET @kept := (SELECT batch_id FROM batch_header WHERE shed_id IS NULL AND deleted_at IS NULL AND batch_id NOT IN (@b) AND batch_id NOT LIKE '620768db%' ORDER BY batch_id LIMIT 1);
UPDATE batch_header SET shed_id = (SELECT location_id FROM location_master WHERE location_type = 'SHED' AND company_id = batch_header.company_id ORDER BY location_code LIMIT 1) WHERE batch_id = @kept;
SELECT @b e6_batch, @pen e6_pen, @kept e7_batch;
```

Record `e6_batch`, `e6_pen` and `e7_batch` in the report. The batches whose live animals are spread over three sheds (`190d0826…` and five more) are the natural "ambiguous" case. They must stay without a shed.

- [ ] **Step 2: Snapshot and migrate.** `$S/snapshot.sh <label>` writes `$S/<label>-counts.txt` (per-table `COUNT(*)`), `$S/<label>-checksums.txt` (`CHECKSUM TABLE` of every table) and the per-row hashes of `location_master` (excluding `low_level_kg`, `high_level_kg`, `updated_at`), `stage_master` (excluding `typical_duration_days`, `next_stage_id`, `updated_at`) and `batch_header` (excluding `shed_id`, `farm_id`, `updated_at`):

```bash
#!/bin/bash
# Read-only snapshot of nf_rehearsal_s. Usage: snapshot.sh <label>
set -euo pipefail
S=$(cd "$(dirname "$0")" && pwd); L=$1; DB=nf_rehearsal_s
Q() { mysql -h 127.0.0.1 -u root -N -B "$DB" -e "$1"; }
[ "$(Q 'SELECT DATABASE()')" = "$DB" ] || { echo "refusing: not $DB"; exit 2; }
Q "SELECT table_name FROM information_schema.tables WHERE table_schema='$DB' AND table_type='BASE TABLE' ORDER BY 1" > "$S/$L-tables.txt"
: > "$S/$L-counts.txt"; : > "$S/$L-checksums.txt"
while read -r t; do
  echo "$t $(Q "SELECT COUNT(*) FROM \`$t\`")" >> "$S/$L-counts.txt"
  Q "CHECKSUM TABLE \`$t\`" >> "$S/$L-checksums.txt"
done < "$S/$L-tables.txt"
rowhash() { # table pk excluded-columns-quoted-list
  local cols; cols=$(Q "SELECT GROUP_CONCAT(CONCAT('IFNULL(CAST(\`',column_name,'\` AS CHAR),''~'')') ORDER BY ordinal_position SEPARATOR ',') FROM information_schema.columns WHERE table_schema='$DB' AND table_name='$1' AND column_name NOT IN ($3)")
  Q "SELECT \`$2\`, SHA2(CONCAT_WS('|',$cols),256) FROM \`$1\` ORDER BY 1" > "$S/$L-rows-$1.txt"
}
rowhash location_master location_id "'low_level_kg','high_level_kg','updated_at'"
rowhash stage_master stage_id "'typical_duration_days','next_stage_id','updated_at'"
rowhash batch_header batch_id "'shed_id','farm_id','updated_at'"
echo "snapshot $L written"
```

`$S/run-migrator.cjs`, with the same calls as `migrate-all-tenants.ts`, refusing any database but a `nf_rehearsal_*` one:

```js
// Usage: node run-migrator.cjs nf_rehearsal_s [migrations-folder]
const path = require('node:path');
const api = '/Users/nero/Desktop/navfarm/apps/api';
const req = (m) => require(require.resolve(m, { paths: [api] }));
const mysql = req('mysql2/promise');
const { drizzle } = req('drizzle-orm/mysql2');
const { migrate } = req('drizzle-orm/mysql2/migrator');
const db = process.argv[2];
if (!/^nf_rehearsal_/.test(db || '')) { console.error(`refusing: ${db}`); process.exit(2); }
(async () => {
  const pool = mysql.createPool({ host: '127.0.0.1', user: 'root', password: process.env.DATABASE_PASSWORD, database: db });
  const started = Date.now();
  await migrate(drizzle(pool, { mode: 'default' }), { migrationsFolder: process.argv[3] || path.join(api, 'src/drizzle/tenant') });
  const [[row]] = await pool.query('SELECT COUNT(*) n, MAX(created_at) last FROM __drizzle_migrations');
  console.log(`migrate OK  journal ${row.n}  last ${row.last}  ${Date.now() - started} ms`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
```

Run in this order:

```bash
mysql -h 127.0.0.1 -u root nf_rehearsal_s < $S/01_roll_to_server_state.sql
mysql -h 127.0.0.1 -u root nf_rehearsal_s < $S/02_edge_cases.sql
bash $S/snapshot.sh before
node $S/run-migrator.cjs nf_rehearsal_s        # run 1: expect journal 126, last 1791481200000
bash $S/snapshot.sh after1
node $S/run-migrator.cjs nf_rehearsal_s        # run 2: expect journal 126, nothing applied
bash $S/snapshot.sh after2
```

- [ ] **Step 3: Check, and write the report.** Each line below is a check. Its expected result goes in `migration-rehearsal.md`, with the actual figure beside it.

| check | expected |
|---|---|
| `diff before-counts.txt after1-counts.txt` | only `__drizzle_migrations` (122 → 126) |
| `diff before-checksums.txt after1-checksums.txt` | only `__drizzle_migrations`, `approval_request` (0122 columns and back-fill), `location_master`, `stage_master`, `batch_header` |
| `diff before-rows-location_master.txt after1-rows-location_master.txt` | empty (only the level columns changed) |
| `diff … stage_master …` and `diff … batch_header …` | empty |
| silo levels: `SELECT location_code, low_level_kg, high_level_kg FROM location_master WHERE location_code IN ('VIL100/SILO-001','VIL100/SILO-002','VIL100/SILO-003','VIL100/SILO-004')` | E1 2400/11000, E2 19000/NULL, E3 1000/5000, SILO-004 3000/13500 |
| silos still missing a level | exactly one (E2) |
| stages: FLUSH company 10 (E4) and template 14; DRY_SOW 7, FARROWING 3, WEANING 1 in both scopes; WEANER → GROWER both scopes; GROWER → QUARANTINE on the company copy (E5) and → FINISHER on the template | as stated |
| batch sheds: `e6_batch` set to the shed of `e6_pen`; `e7_batch` unchanged; `620768db…` set by (2); `190d0826…` and the other batches spread over three sheds still NULL | as stated |
| `SELECT doc_type, SUM(farm_id IS NOT NULL), SUM(document_id IS NOT NULL) FROM approval_request WHERE doc_type='FEED_REQUISITION' GROUP BY 1` | both counts = the FEED_REQUISITION row count (2 on 27 Sep) |
| run 2: `diff after1-checksums.txt after2-checksums.txt` | empty (idempotent) |

A partial failure of 0122 is its only risk, because it is DDL, which MySQL commits statement by statement. 0123–0125 are DML inside Drizzle's migration transaction, so a failure rolls them back whole. Rehearse it: copy `apps/api/src/drizzle/tenant` to `$S/mig-fail/`. In the copy's `0122_approval_request_farm_document.sql`, directly after its first `--> statement-breakpoint` line, insert two lines: `SELECT * FROM plan_s_forced_failure;` and `--> statement-breakpoint`. Roll `nf_rehearsal_s` back with Step 1's script (01 only), then run `node $S/run-migrator.cjs nf_rehearsal_s $S/mig-fail`. Expect it to fail on the missing table, with `farm_id` added and the journal at 122. Re-run against the real folder (`node $S/run-migrator.cjs nf_rehearsal_s`): expect `Duplicate column name 'farm_id'`. Recover with `ALTER TABLE approval_request DROP COLUMN farm_id;` and re-run: expect journal 126. Record all three outputs.

MySQL here is 9.7; the server runs 8.4. The statements use only multi-table `UPDATE … JOIN`, derived tables, `<=>` and `CASE`, all available in 8.0. Note the residual risk in the report, as Plan A did.

Drop the scratch database: `mysql -h 127.0.0.1 -u root -e "DROP DATABASE nf_rehearsal_s"`. Confirm `nf_devco`'s journal count is what it was before Step 1.

- [ ] **Step 4: The runbook.** In `docs/deploy-rdp-windows.md`, add at the end of §13 (before its closing "Never run `db-rebuild-demo`…" paragraph):

````markdown
### Plan S release (tenant migrations 0122–0125)

What it changes on testers' data, and what it leaves alone (rehearsed on
a server-like copy, `.superpowers/sdd/2026-09-27-feed-forecast-s-fixes/migration-rehearsal.md`):

- **0122** adds `approval_request.farm_id` and `document_id` (feed requisitions are
  approved in the Approvals inbox) and fills them on the feed requisitions already
  decided. It is DDL: see "If 0122 fails part-way" below.
- **0123** sets a batch's shed only where its live animals, or its scheduler
  headers, name exactly one shed of its own company and farm. A shed someone chose
  is never changed; ambiguous batches keep "no shed on record".
- **0124** gives a silo without feed levels High = 90 % and Low = 20 % of its
  capacity. A level someone set is never changed. A silo where the default would
  break low < high keeps that level empty, and the form asks for it.
- **0125** fills an empty duration on DRY_SOW (7), FLUSH (14), FARROWING (3) and
  WEANING (1), and an empty next stage on WEANER → GROWER → FINISHER. System stages only.

**Before stopping anything**, for each tenant database (read-only):

```sql
SELECT COUNT(*), MAX(created_at) FROM nf_<code>.__drizzle_migrations;   -- note it; the release adds 4 rows
-- What the release will fill, kept so it can be told apart from later edits:
SELECT location_id, location_code FROM nf_<code>.location_master
 WHERE location_type='SILO' AND (low_level_kg IS NULL OR high_level_kg IS NULL);
SELECT stage_id, stage_code, company_id FROM nf_<code>.stage_master
 WHERE is_system=1 AND ((typical_duration_days IS NULL AND stage_code IN ('DRY_SOW','FLUSH','FARROWING','WEANING'))
    OR (next_stage_id IS NULL AND stage_code IN ('WEANER','GROWER')));
SELECT batch_id, batch_no FROM nf_<code>.batch_header WHERE shed_id IS NULL AND deleted_at IS NULL;
```

Save the three lists to `C:\navfarm-backups\plan-s-fill-$ts.txt`, then back up as above.

**After `db-migrate-all-tenants`**, for each tenant:

```sql
SELECT COUNT(*), MAX(created_at) FROM nf_<code>.__drizzle_migrations;   -- +4 rows, 1791481200000
SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='nf_<code>'
  AND table_name='approval_request' AND column_name IN ('farm_id','document_id');   -- 2
SELECT COUNT(*) FROM nf_<code>.location_master WHERE location_type='SILO'
  AND (low_level_kg IS NULL OR high_level_kg IS NULL);   -- only silos where a tester's level blocks the default
```

Then sign in as a tester: open Inventory → Feed Forecast (the page does not scroll,
the table does), Inventory → Requisitions, the Alerts page (feed alerts are listed
there now) and Approvals. Check that a tester's batch, goods receipt and silo from
before the update are unchanged.

**If 0122 fails part-way** (`Duplicate column name 'farm_id'` on a re-run): MySQL
committed the first ALTER. Put back what it added, then re-run:
`ALTER TABLE approval_request DROP COLUMN farm_id;` (and `DROP COLUMN document_id`,
`DROP INDEX idx_approval_request_farm`, `DROP INDEX idx_approval_request_document`
for whichever of those exist). 0123–0125 change data only and roll back whole on a
failure, so a re-run is enough.

**Rolling back after testers have entered data**: do not restore the backup. The
fills are defaults testers can edit; the lists saved above show which rows the release
filled. 0122 can be reversed with the four statements above plus
`DELETE FROM __drizzle_migrations WHERE created_at >= 1791222000000;`, once the
previous build is back in place.

Known and not changed by this release: 248 older pens, sheds and crates carry
`storage_type = 'SILO'` and cannot be saved in the Location form ("A SILO location
requires silo_capacity_kg …"). That is open question S11.
````

- [ ] **Step 5: Commit and write the ledger line** (the report and scripts are git-ignored scratch; the ledger line names the report path and the headline numbers: rows changed per migration, checksum diffs, idempotency)

```bash
git commit -m "docs(deploy): Plan S release — what 0122–0125 change, checks, recovery (B2)

Rehearsed on nf_rehearsal_s, a copy of nf_devco rolled back to the server's
state with tester-style edge cases (a lone high level, a low level above the
default, a tester's stage duration and successor, a chosen shed, a batch in
one shed and batches spread over three): the real migrator applied 0122–0125,
only the target columns changed (row hashes elsewhere identical), every
tester value survived, and a second run changed nothing. The runbook gains
the pre-flight lists of what will be filled, post-checks, the 0122 partial-
failure recovery and the rollback.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/deploy-rdp-windows.md
```

---

### Task 22: Verification in the running app, and the demo rebuild check

**Files:**
- Create: `docs/VERIFICATION-2026-09-27-feed-forecast-s.md`
- Scratch (git-ignored): screenshots and JSON under `.superpowers/sdd/2026-09-27-feed-forecast-s-fixes/`

**Interfaces:**
- Consumes: everything above. Nothing is produced for another task. This task proves the plan against the running app and MySQL (AGENTS.md §3: a green suite is not evidence).

**Prerequisites. Stop and ask Rishi (through the coordinator) if either is missing; do not work round them:**
1. `nf_devco` has 0122–0125 applied: `SELECT COUNT(*), MAX(created_at) FROM __drizzle_migrations` → 126, 1791481200000. Rishi runs `pnpm nx run api:db-migrate-all-tenants` if the classifier refused it in Tasks 6 and 20.
2. The API on 2877 and the web on 3002 run this branch's head. `nx serve api` does not rebuild. If the 2877 process (`lsof -ti :2877`, then `ps -o lstart= -p <pid>`) started before the last `apps/api` commit, ask Rishi to restart it. Do not kill his process (the Plan S ledger's Task 1 ruling). The Next dev server on 3002 picks up web changes by itself. Build and serve your own copy of the API on 2899 only for the curl checks, as Tasks 1–8 did, and stop it by its PID afterwards.

Browser: the Browser pane (`mcp__Claude_Browser__navigate`, `resize_window`, `javascript_tool`, `computer` screenshot), signed in at `http://localhost:3002` as `tenant.admin@triplec.local`, with the password from the project's seed or example-config files. Do not state it in chat. Reset the viewport with `resize_window { preset: "desktop" }` when done.

- [ ] **Step 1: The fixed-height layout (review C).** Run each check at **1440×900** and at **1024×768**, on `/inventory/feed-forecast` (VIL100 chosen), `/inventory/requisitions`, and `/alerts`.

In `javascript_tool`:

```js
(() => {
  const main = document.querySelector("[data-shell-region='content']");
  const box = document.querySelector('[data-table-scroll]');
  const title = document.querySelector('[data-page-title]');
  const before = title.getBoundingClientRect().top;
  const r = {
    documentScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    mainScrolls: main.scrollHeight > main.clientHeight + 1 && getComputedStyle(main).overflowY !== 'hidden',
    tableScrollsY: box.scrollHeight > box.clientHeight,
    tableScrollsX: box.scrollWidth > box.clientWidth,
  };
  box.scrollTop = 400; box.scrollLeft = 600;
  const top = box.getBoundingClientRect();
  const th = box.querySelector('thead th');
  const firstBodyCell = box.querySelector('tbody tr td[data-sticky-col]');
  r.titleStill = Math.abs(title.getBoundingClientRect().top - before) < 1;
  r.headerRowHeld = Math.abs(th.getBoundingClientRect().top - top.top) <= 2;
  r.batchColumnHeld = firstBodyCell ? Math.abs(firstBodyCell.getBoundingClientRect().left - top.left) <= 2 : 'no sticky column on this screen';
  r.rowHeights = [...box.querySelectorAll('tbody tr')].slice(0, 20).map((tr) => Math.round(tr.getBoundingClientRect().height));
  return r;
})()
```

Expected on the forecast at both sizes: `documentScrolls: false`, `mainScrolls: false`, `tableScrollsY: true` (VIL100 has more rows than fit), `tableScrollsX: true` at 1024, `titleStill`, `headerRowHeld` and `batchColumnHeld` all `true`, and every row height the same single-line value (about 29 px). On Requisitions and Alerts: the same, except `batchColumnHeld` (they have no sticky column) and `tableScrollsY`, which depends on the row count. Take one screenshot per screen and size.

At **375×812** (`resize_window { preset: "mobile" }`, then reload), on each of the three screens: `document.documentElement.scrollWidth <= window.innerWidth` → `true` (nothing overflows sideways), and the table box scrolls sideways inside itself.

- [ ] **Step 2: Feed Forecast (A3–A7, A11, C).**
- **A3:** with the network log (`read_network_requests`, `urlPattern: "/feed-forecast/farms"`), opening Forecast, then Requisitions, then Forecast again sends **one** `/feed-forecast/farms` request per full page load, and none to `/location?locationType=FARM` from these screens.
- **A4:** choose VIL100 on Forecast and open Requisitions. It opens on VIL100. Open Forecast in a new tab: still VIL100.
- **A5:** the farm list is sorted by code and reads "CODE — Name". In the tenant-wide workspace (switch to "Tenant" in the workspace switcher) the list is not empty. It is grouped by company when there is more than one.
- **A11:** on first load, before the grid arrives, the three date inputs are filled. No pink box appears.
- **A6:** the Stages tab shows From / To / Next stage / Stage change for FLUSH and FARROWING batches with dates, not "—". Nothing reads "Due, not posted" unless the data really is overdue. On a fresh demo nothing may.
- **A7:** a STORE row shared by several batches shows the badge "Shared by N", without the word silo.
- **Notes:** one collapsed "Notes (n)" panel. Opened, it lists groups with counts.
- **Numbers vs MySQL:** take one VIL100 SILO row for today. Current Inventory must equal `SELECT ROUND(SUM(quantity),2) FROM inventory_ledger WHERE warehouse_id='<silo id>'` (to the cent). Days of Stock must equal `floor(balance ÷ (Σ that silo's per-day intake × (1 + wastage%)))`, worked out by hand from the rows that share it. Record both.

- [ ] **Step 3: Requisitions (A1, A8, A9, D26).** On `/inventory/requisitions` for VIL100:
- Each list row's Lines and Requested (kg) equals `SELECT r.req_no, COUNT(l.line_id), SUM(l.quantity) FROM requisition r LEFT JOIN requisition_line l USING (requisition_id) WHERE r.doc_type='FEED' AND r.deleted_at IS NULL GROUP BY r.req_no` (A1).
- Type, status and priority are words in coloured badges. No `FEED_FORECAST`, `AUTO_DRAFT` or `CRITICAL_FIRST_PRIORITY` appears anywhere on the page. Check with `get_page_text` and a regex `/[A-Z]+_[A-Z_]+/` over the text: only item and location codes may match.
- All dates are DD/MM/YY.
- The screen has no Approve or Reject button.
- **New requisition** creates a MANUAL requisition. Check `SELECT requisition_type, status FROM requisition WHERE req_no='<new>'` → MANUAL, DRAFT.

- [ ] **Step 4: Submit → inbox → approve (D25; the live proof Task 7 deferred).**
1. On Requisitions, Draft from forecast (or open the new manual one), write remarks, **Submit for approval**. It then shows "Waiting for approval" and an "Open in Approvals" link.
2. MySQL: `SELECT r.status, ar.status, ar.farm_id = r.farm_id, ar.document_id = r.requisition_id FROM requisition r JOIN approval_request ar ON ar.request_id = r.approval_request_id WHERE r.req_no='<no>'` → `PENDING_APPROVAL, PENDING, 1, 1`.
3. Follow the link. The Approvals dialog opens on that request. It shows the "Feed requisition" badge, the lines, the farm's remarks and a remarks box.
4. Sign in as the VIL100 farm login in a second browser profile or after signing out. The request is listed in its Pending tab and another farm's is not. If the login lacks `PRODUCTION/APPROVAL view` or `PROCUREMENT/REQUISITION approve`, record it as S5's role gap, not a defect.
5. As tenant.admin, approve with remarks. MySQL → requisition `APPROVED` with `approved_by` set, request `APPROVED`, and the audit rows `CREATE` and `APPROVE` on the request.
6. Repeat with a second requisition, reject with a reason. MySQL → requisition `REJECTED`, remarks ending in `Rejected: <reason>`.
7. Repeat with a third, withdraw it in the inbox. MySQL → requisition `DRAFT`, `approval_request_id` NULL.

- [ ] **Step 5: Alerts (D24, A8, A9).** On `/alerts`:
- Exactly one `POST /feed-alert/evaluate-scope` is sent on open (network log).
- The list holds feed alerts and batch alerts. The row count for Type = All and Show = Open equals `SELECT COUNT(*) FROM feed_alert WHERE status='ACTIVE'` + the count of unread `notification_alert_log` rows visible to the admin.
- Priority shows as words. Times read DD/MM/YY HH:mm. Feed alert messages contain no ISO date.
- Acknowledge one feed alert → `SELECT acknowledged_at FROM feed_alert WHERE alert_id='<id>'` is set.
- The Inventory sub-navigation has no Feed Alerts entry, and `/inventory/feed-alerts` lands on `/alerts`.

- [ ] **Step 6: Masters and batch (A10, A12, A13).**
- The Farm Master menu lists Reporting Periods and Alert Rules. Both pages are headed "Farm Operations". The Alert Rules list shows words, and the Reporting Periods list shows DD/MM/YY.
- **A12:** open an ACTIVE batch with no shed and choose a shed of its farm. MySQL shows `shed_id` set. Put it back to "No shed" if it had none.
- **A13:** open a silo in Locations. Both levels are required; saving with one cleared is refused.

- [ ] **Step 7: The demo rebuild check (B1).** The rebuild is Rishi's to run. The classifier blocks agents from `db-rebuild-demo`. Ask him (through the coordinator) to run `pnpm nx run api:db-rebuild-demo -- --apply` from `apps/api` and say when it has finished. Then run `bash .superpowers/sdd/2026-09-27-feed-forecast-s-fixes/verify-after-rebuild.sh` (Task 19) and record its output. Expected:
- Plan A's checks pass.
- 0 silos without levels.
- The "silos below their low level" list and the open FEED_BELOW_L1 alerts both name the VIL100 silo chapter 07 set.
- DRY_SOW 7, FLUSH 14, FARROWING 3, WEANING 1 and the WEANER→GROWER→FINISHER links, in both scopes.
- DRY_SOW feed rows are present.
- 12 reporting periods.
- Then, in the browser, VIL100's forecast shows the other chosen silo with a Run-Down about 10 days out and a Required On in the future (not Overdue). The Stages tab has no "Due, not posted".

If Rishi has not rebuilt when every other step is done, record Step 7 as pending with the exact commands, rather than blocking the document on it.

- [ ] **Step 8: Write `docs/VERIFICATION-2026-09-27-feed-forecast-s.md`.** Follow the shape of `docs/VERIFICATION-2026-09-26-feed-forecast-r.md`: the date, the branch head, who drove it, then one section per step with each expected result, the actual figure or screenshot path, and PASS or FAIL. Record these as well:
- Alerts raised before Task 3 keep their old ISO-date text (not migrated).
- Batch-alert farm filtering could only be shown on data if `notification_alert_log` has rows (0 on 27 Sep; the Task 8 note).
- Any S5 role gap found in Step 4.
- The 248 legacy `storage_type = 'SILO'` pens (S11).

Any FAIL is reported back to the coordinator with the evidence. Do not patch it inside this task.

- [ ] **Step 9: Final gates, commit and the ledger line**

```bash
pnpm nx test api -- --maxWorkers=2 --skip-nx-cache 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|Test Suites:|✕"
pnpm nx test web -- --maxWorkers=2 --skip-nx-cache 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|Test Suites:|✕"
pnpm nx run-many -t typecheck -p api,web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully"
pnpm nx lint web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✖ [0-9]+ problems"
git commit -m "docs: Plan S verification in the running app and MySQL

Every review item (A1–A13, B1–B3, C) and D21–D27 driven in the browser at
1440×900, 1024×768 and phone width and read back from MySQL: the feed
screens hold their header and filters while only the table scrolls, the
submit → inbox → approve/reject/withdraw path writes both documents
together, the Alerts page lists and acknowledges feed alerts, and the demo
rebuild check results (or its pending commands) are recorded.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/VERIFICATION-2026-09-27-feed-forecast-s.md
```

The ledger line records the four gate results (api suites/tests, web suites/tests, typecheck, lint errors ≤ 94) and the count of PASS/FAIL/PENDING in the document.

---

## Review item coverage

| Review / spec item | Task(s) |
|---|---|
| A1 requisition counts | 1 (proof: 22 Step 3) |
| A2 farm list in tenant view | 2, 9 |
| A3 one request per screen | 9, 12 |
| A4 shared farm choice | 9, 12, 13 |
| A5 sorted "CODE — Name" | 2, 9 |
| A6 stage dates | 11, 18, 19, 20 |
| A7 "Shared by N" for a store | 11 |
| A8 labels, not codes | 3, 13, 15, 17 |
| A9 DD/MM/YY everywhere, no ISO in messages | 3, 9, 13, 15, 17 |
| A10 masters in the Farm Master menu | 17 |
| A11 prompt not an error, dates shown | 12 |
| A12 batch shed on create/edit | 5 |
| A13 silo levels required | 4 |
| B1 demo seed | 18, 19 (check: 22 Step 7) |
| B2 migrations + rehearsal + runbook | 20, 21 |
| B3 local test leftovers | cleared by Rishi's rebuild (22 Step 7); nothing to migrate |
| C wording | 3, 11, 12, 13, 15, 16, 17 (copy given verbatim in each) |
| C design (fixed page, sticky header/columns, compact rows, grouped dates, notes panel, stage table, table alerts) | 10, 11, 12, 13, 15 |
| D21 | 5, 20 |
| D22 / D27 | 4, 18, 20 |
| D23 | 18, 20 |
| D24 | 8, 13, 15 |
| D25 | 6, 7, 13, 16 |
| D26 | 13, 14 |

## Open question found while executing Tasks 1–8

| # | Question | Default used |
|---|---|---|
| S11 | 248 PEN/SHED/CRATE rows carry a legacy `storage_type = 'SILO'`, and the older silo-fields check (`assertSiloFieldsWhenSilo`, keyed on `storage_type`) refuses every save of them ("A SILO location requires silo_capacity_kg …"). This was true before Plan S (Task 4 ledger finding). Should Plan S clear their `storage_type`, or key that check on `location_type`? | Not changed in Plan S: it changes validation for 248 rows outside the review's scope. It is recorded in the runbook and the verification document for Rishi to decide. |

## Errata to the committed header (the first two are now corrected in the header; kept here for the record)

- "How to continue" says "Task 1 → Task 21". The plan has **22** tasks. Task 22 is the running-app verification, and it is not optional.
- Review Focus item 5 says "Task 19 edge cases, checked by per-row hash in Task 20". The edge cases (E1–E7) and the per-row hashes are in **Task 21**, and the migrations they test are Task 20.
- The "Task order" line lists `translations.ts` for Tasks 5, 9 and 11–17. Task 9 does not touch it, and Tasks 11–17 do, in that order.
