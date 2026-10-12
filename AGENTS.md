<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# NAVFarm — read this before planning or writing anything

Everything below the Nx block replaces an earlier version of this file that is
now wrong in ways that will send you to the wrong documents and the wrong
conclusions. Where this file and your instincts disagree, this file wins; where
this file and Rishi disagree, **Rishi wins** — say so and update this file.

## 1. Who and what

- **Client:** Triple C (Colcom Group), Zimbabwe. **Scope: NOB Livestock → LOB
  Piggery only.** Sixteen LOBs exist as taxonomy; nothing but piggery is in
  scope. Do not build out poultry/dairy/aqua screens unless asked.
- **One maintainer: Rishi.** `apps/api` (NestJS 11 + Drizzle + MySQL),
  `apps/web` (Next.js 16 + React 19), `apps/mobile` (Flutter, only on request),
  `apps/web-e2e` / `apps/api-e2e` (Playwright).
- **The backend is in scope.** An older version of this file said "do not
  authorize backend implementation in the current frontend-only phase". That is
  obsolete. Auth, master data, batches, animals, breeding and costing are real
  endpoints against a real database.
- A second developer, Arun, used to land commits on shared branches. **Review
  anything you did not write** rather than assuming it is correct.

## 2. Source of truth

**Rishi is the source of truth.** Not the BBP, not the TDD tracker, not the
templates. Every document in this repo is *reference* — evidence of what the
client has said so far — and every one of them is incomplete, unsigned, or
contradicts another. What the application should do is what Rishi says it
should do.

That is not a formality. The BBP is unsigned (§18's approval boxes are all
empty), the BBP and the TDD tracker disagree on stage names and on the animal
code prefix, and the BBP contradicts itself on the reporting currency. There is
no document you can defer to in order to avoid asking.

**`docs/decisions.md` is the record of what Rishi has decided.** Read it before
planning. Add to it when he decides something new — the decision, the date, and
the reasoning, so the next agent does not re-ask a settled question or quietly
reverse it.

Reference material, most useful first:

1. **`TDD_Triple-C Development Testing_Tracker`** — 143 numbered requirement
   rows, the most specific statement of what each screen must do. Quote row
   numbers in commit messages.
2. **`OneDrive_1_04-09-2026/`** — the latest client material: BBP-1 in
   `Solution Documents/`, the eight `Master Templates/`, and the `MOMs/`.
3. **`rak docs/`** — older, superseded. Reference only, and rarely worth
   opening. An earlier version of this file called it the Product Source of
   Truth; it never was.

When two documents disagree, or when a document is silent, **ask Rishi** and
then record the answer. Do not pick one silently and do not invent a third.

### Reading the client documents

They are `.docx` / `.xlsx`, so read them as zip archives:

```bash
mkdir -p /tmp/doc && cd /tmp/doc && unzip -q "<file>.docx"   # then parse word/document.xml
mkdir -p /tmp/xl  && cd /tmp/xl  && unzip -q "<file>.xlsx"   # xl/worksheets/sheet1.xml + xl/sharedStrings.xml
```

`openpyxl` is not installed. Do not claim a field is absent from a document you
have not opened.

## 3. How to work here

- **Drive the running app. Reading the code is not verification.** Nearly every
  defect that mattered in this project passed its tests and read correctly:
  a slaughter recorded with the food-safety check skipped, a number series that
  had never once issued a code, an animal panel contradicting itself. Each was
  found by clicking, or by calling the API and then looking in MySQL.
- **Check the database after a write.** `mysql -u root nf_devco -e "..."`.
  A 200 response is not proof the row is right.
- **Never invent client data.** No placeholder company names, no example
  identifiers, no "typical" values dressed as the client's. If a document does
  not give an example, use none. (Real bug: Indian demo placeholders —
  `greenvalleyfarms.in`, `GSTIN12345`, `Asia/Kolkata` — shipped on a Zimbabwe
  piggery's screens.)
- **Say what a document says, then what we did.** If a field has no document
  behind it, label it as ours. Do not present an invention as a requirement.
- **Ask when a decision is the client's.** Residual value per-kg vs percentage,
  ZWL vs ZiG, what "weaning" means — these are not yours to settle.

## 4. Conventions that already exist — follow them, don't reinvent

- **Data-changing scripts** live in `apps/api/src/scripts/`, are registered as
  `db-*` Nx targets, and follow one shape: **read-only by default, `--verify`
  applies inside a transaction and rolls back, `--apply` commits.** They print
  a reviewable plan and refuse to touch tables that already hold rows. See
  `configure-demo-master-series.ts`, `align-stages-to-tdd.ts`,
  `seed-demo-breeding-chain.ts`. Always run `--verify` and read the plan first.
- **Master data is config-driven.** One registry,
  `apps/web/src/modules/master-data/configs.ts`, feeds `MasterDataTable` for
  all ~23 masters through the single route `/master-data/[key]`. Add a config
  entry; do not add a page.
- **Guard specs in `apps/web/specs/`** enforce cross-cutting rules —
  `role-permissions-coverage`, `nav-scope-consistency`,
  `master-data-singular-label`, `finance-sections`. If one fails, it has
  usually caught something real. Read it before changing it.
- **Design:** `apple.design.md` is the authority. §19: "Do not create one-off
  label/input markup when the shared Field primitive is appropriate." Use
  `Field`, `ReadField`, `FieldGroup`, `ConsolePage`, `PageHeader`.
- **Scope headers** the API expects: `x-tenant-id`, `x-active-company-id`,
  `x-workspace-scope` (`TENANT` | `COMPANY` | `OPERATIONAL`). Master scope
  matching is exact — a company-scoped row is invisible to a tenant-scoped
  query and the reverse. This has caused real bugs; see `master-data-scope.ts`.

## 5. Commands

```bash
pnpm seed                   # DROPS nf_master/nf_system/nf_devco, then seeds the small demo (2 farms, light volume)
pnpm verify:costing          # rehearses FIFO/Average × tracked/untracked through batch + scheduler, ROLLS BACK (changes nothing)
pnpm nx test api            # 463 tests / 52 suites
pnpm nx test web            # 108 tests / 17 suites
pnpm nx run-many -t typecheck -p api web web-e2e
pnpm nx lint web            # 85 errors is the accepted baseline — gate on "no new"
```

- **Never run `pkill`.** It has killed a whole session here. Stop a server by a
  PID confirmed with `lsof -ti :PORT`.
- Web app is **port 3002 only** (dev and start), API **2877**. Why 3002 and not
  anything else: currently the assigned port is 3002 and other are occupied by
  other applications in the server. Do not move it. Rishi browses the app in Brave
  while you work — **leave the dev server running** unless memory is genuinely
  red (`top -l 1 -n 0 | grep PhysMem`, `sysctl vm.swapusage`). The machine has
  8 GB and swaps hard.
- If `tsc` reports a wall of `TS6305 … has not been built from source file`,
  that is a stale composite build, not your change:
  `rm -rf apps/api/dist apps/api/out-tsc && npx tsc --build apps/api/tsconfig.json --emitDeclarationOnly --force`

## 6. Commit messages

Say what changed and **why it was wrong before**, in prose. Quote the document
row that drove it. If a test caught something you missed, say so. Do not write
"Refactor code structure for improved readability and maintainability" — a
commit that added the client's document folder was labelled exactly that, and
the message describes nothing that happened.

## 7. Open questions for Triple C — do not answer these yourself

- Animal code prefix: TDD row 7 and the Animal Register template say
  `PIG-YYYY-SEQ`; BBP §2.1 says `ANM-YYYY-NNNNN`.
- Does "weaning" mean the sow's event or the piglets' phase? On the BBP's chain
  (Sow → Piglet Lot → Weaner Batch) the weaner phase belongs to a batch.
- Residual value: a percentage (our column) or a per-kg rate (the Bio Asset BBP
  and the 20 Aug MOM)?
- Reporting currency: §1.1's flowchart says ZWL, its field spec says USD.
- ZWL or ZiG.
- 47 reason codes were promised; 3 exist. Mortality alone is specified as 21.
- The Kill Sheet and DOA have **no tables**. BBP gives the kill sheet a process
  (attached to the transfer order, carcass weights per line, invoice =
  Delivered Qty × Avg Carcass Weight × Price/KG) but no field specification.

## 8. Current feed programme — state and rules for future agents

Read the 30 Sep 2026 entries at the end of `docs/decisions.md` before changing
feed, locations, inventory, requisitions or demo data. The approved four-farm
seed plan is `docs/superpowers/plans/2026-09-30-four-farm-feed-seed-and-migration.md`.

### What exists now

- Feed work through farm approval exists: farm/shed/silo setup, feed items,
  lifecycle feed rows, batch/head-count inputs, ledger-derived silo stock,
  daily forecast, run-down/refill/required-on dates, in-app feed alerts, feed
  requisition drafting and farm approval. Do not describe later workflow as
  complete merely because its fields appear in a reference document.
- Mill consolidation/capacity execution, loading and dispatch, Transfer Order
  receipt, stock take and period reconciliation are later phases unless Rishi
  explicitly brings one into scope.
- The current fulfilment mode is **IN_HOUSE**. Business Central is not connected.
  Preserve stable IDs and a separate integration status so `BC_INTEGRATED` can
  be added later, but do not add fake BC calls, references or success states.
- Notifications are **IN_APP only**. Other channels are future work.
- One feed requisition header is one farm/submission cycle; silo/item demand is
  represented by lines. Feed is an internal transfer, displayed as “Internal
  Feed Transfer”.

### Requisitions — Part E, verified live 4 Oct 2026

Evidence: `docs/VERIFICATION-2026-10-04-feed-part-e.md`.

- **The common requisition is mounted**: `/api/v1/requisition` (RequisitionModule)
  handles the kinds **ITEM** (purpose STORE or PURCHASE), **FA** and **SERVICE**
  (line by resource or description). Its routes are create, PUT (only while
  Open), submit, approve, reject, release, shipment, receipt, reopen and
  link-po.
- **FEED never goes through it.** One shared guard makes every generic mutation
  refuse a FEED row with a 400, and the row stays unchanged. The DTO refuses
  `doc_type: FEED` on create. Feed keeps `/feed-requisition` and its own
  approval handler. A feed requisition stops at **Approved** and has no Release.
- **Company boundary:** `/requisition` reads and writes only inside the selected
  company. A foreign company returns 403.
- **Approvals:** a creator cannot approve their own manual requisition (403).
  `approved_by` is stamped from the deciding user. **Open defect D1 (4 Oct):**
  the Approvals inbox (`ApprovalService.farmConditions`) hides approval rows
  that have no farm and no batch from any company- or farm-scoped user. So
  common requisitions are visible and approvable only by a tenant-scoped user.
- **Store release creates a staged stock transfer.** Each line carries
  `stock_transfer_line.requisition_line_id`. Ship and receive go through the
  requisition and post one ledger row per event. Transfer status runs DRAFT →
  IN_TRANSIT → PARTIALLY_RECEIVED → POSTED. The requisition's fulfilment runs
  NOT_APPLICABLE / PARTIALLY_SHIPPED / SHIPPED / PARTIALLY_RECEIVED / RECEIVED,
  from the line's qty_shipped and qty_received. Purchase, FA and Service release
  set `integration_status = BC_PENDING`. A PO number is linked by hand
  (link-po), because BC is not connected.
- **Numbering:** common requisitions take the company Number Series with code
  REQUISITION (on nf_devco this is the illustrative `RQ` series, 5 digits:
  RQ-00001…), and skip numbers already in use. Without a series they fall back
  to `REQ-YYYY-NNNN`. Feed requisitions keep `REQ-<FarmCode>-YYYY-NNNNN`.
- **Where each kind is created:** **Approvals → Requisitions**
  (`/approvals/requisitions`) lists every kind, and its New offers Feed, Item,
  Fixed Asset and Service. **Inventory → Feed Forecast → "Internal Feed
  Transfer" tab** (`?tab=feed-requisition`) offers **Feed only** (Rishi, 4 Oct).
  Both open the same feed dialog and create the same document through
  `/feed-requisition`. A manual feed line whose item differs from the
  destination's forecast demand needs an exception reason (Requisition row 13).
  The Approvals inbox shows both kinds as the full document, read-only.

### Feed planning settings — what the forecast actually reads (3 Oct 2026)

- The shortfall is **demand + safety stock − opening − confirmed incoming**.
  There is **no lead time and no refill buffer** in it. `silo_reorder_days` and
  `feed_wastage_pct` still exist as columns and master fields and the forecast
  must not read them; do not reintroduce either into the calculation.
- **Planning settings own the logistics values**, not `location_master`:
  `FeedSettingsService.resolve(companyId, farmId?)` returns `safetyStockKg`,
  `bagSizeKg`, `bulkMultipleKg`, `truckTargetKg` and `productionWeekday`, and
  there is deliberately **no `leadTimeDays`**. Defaults: safety stock **0**,
  bulk multiple **3000 KG**, bag size **50 KG**, truck target **30000 KG** (a
  target, never a block), horizon 7 days by default and 45 maximum.
- They are edited in the app at **Settings → Inventory Setup → Silo Feed
  Setup**: a company row (safety stock, bag size) and a per-farm row (safety
  stock, bag size, bulk multiple, truck target, production weekday), stored in
  `feed_planning_setting` keyed by `active_scope_key` (`F:<farmId>` for a farm).
  Only **Feed Type**, **Below Feed Level** and **Above Threshold** are per silo
  on `location_master`. Verified by changing a farm's safety stock 0 → 500 in the
  browser and watching every unrounded need rise by exactly 500.
- The silo's Below Feed Level never enters the shortfall; it drives alerts only.
  The silo balance is always labelled **“System Balance”** (cp. 37).
- A requisition line carries a per batch + house breakdown
  (`requisition_line_batch`); rounding and ordering stay per silo + item. Line
  numbers are 10000-step and displayed as such; Days Remaining is displayed to
  one decimal and stored `decimal(10,1)`.
- **Known defect, open as of 3 Oct:** the engine keys a stage-split
  (`animal_tracking = 'REGISTERED'`) batch as the composite `"<batchId>:<stageId>"`
  (`feed-forecast.service.ts:499`), which does not fit `varchar(36)` —
  `requisition_line_batch.batch_id` (which also has an FK to `batch_header`) or
  `feed_forecast_run_line.batch_id`. Auto-draft and Save Run therefore return 500
  on seven of the nine demo farms. Evidence:
  `docs/VERIFICATION-2026-10-03-feed-tdd-part-a.md`.

### Silo topology

- FARM, SHED, PEN and SILO are rows in `location_master`.
  `parent_location_id` is canonical: SHED → FARM, PEN → SHED, SILO → FARM.
- `silo_shed_link` is canonical and many-to-many. A silo may serve several
  sheds and a shed may draw from several silos. The old `feed_silo_id` and the
  old statement “a shed draws from exactly one silo” are superseded.
- When several silos serve one shed, they must not hold the same positive-stock
  feed item. Forecast and inventory posting use the link plus item, not an
  invented primary silo.
- The approved demo matrix is four farms: 1:1; one silo to many sheds; a
  many-to-many farm; and a mixed farm containing 1:1, one-to-many and
  many-to-one examples.

### Examples and configuration

- Every value in the supplied feed examples is illustrative seed data, not a
  production default or confirmed client value. Keep examples in named seed
  fixtures and label them. Never migrate an example into every customer row
  merely because the document calls it a default.
- Approved configurable recommendations: 7-day default forecast view and
  45-day maximum; capacity GREEN <90%, AMBER 90–100%, RED >100%; production
  date plus configurable shift/slot; configurable bag tolerance (illustrative
  seed 1%); reason for every nonzero stock-take variance and configurable
  Finance percentage/amount escalation.
- Currency and the monetary Finance threshold remain open. Do not seed or
  hardcode either as customer truth.

### Seed and migration safety

- The old master pipeline is nine-farm and `demo/chapters/02-inventory.ts`
  assumes at least two silos per farm. Both assumptions must be removed before
  claiming a four-farm full rebuild works.
- Topology itself needs no new schema: `silo_shed_link` already supports 1:1,
  1:N, N:1 and N:N. A retained nine-farm database needs an approved,
  non-destructive transition policy; rerunning a seed will not remove old rows.
- Keep the master-only seed separate from operational demo transactions. Never
  run the destructive reset against RDP/test data.
- `migrate-all-tenants.ts` attempts every registered tenant and now exits
  non-zero if any tenant fails. Still inspect output for `FAILED` and query
  every tenant's Drizzle journal after application. MySQL DDL is not
  transactionally rolled back; take a backup first.
- Tenant migration generation is hazardous because SQL/journal files extend
  beyond the latest snapshot. One agent owns migration SQL and journal
  numbering at a time; review generated SQL completely and never edit
  `dist/drizzle`.

### How to extend feed safely

1. Identify the exact decision or reference row and distinguish rule text from
   example values.
2. Add or update `docs/decisions.md` before implementing a new interpretation.
3. Keep business status independent of external integration status.
4. Add a failing pure-rule/service test, implement through the existing shared
   posting path, then verify the database after the write.
5. Exercise the running UI and all affected topology shapes; code review and a
   green unit suite alone are insufficient.
6. Update the relevant implementation plan and this section when scope or
   architecture changes, so another agent does not reconstruct history from
   stale workbook examples.
7. **In a git worktree, nx builds and serves the wrong tree.** `nx run
   api:build`, `nx run web:dev`, `nx test web` and `nx lint web` all replayed the
   main checkout on 3 Oct, even with `--skip-nx-cache`, `NX_DAEMON=false` and the
   worktree's own nx binary. Build the API with
   `cd apps/api && NODE_ENV=production NX_WORKSPACE_ROOT_PATH=<worktree>
   NX_TASK_TARGET_PROJECT=api NX_TASK_TARGET_TARGET=build
   ../../node_modules/.bin/webpack-cli build`, serve the web with
   `cd apps/web && ../../node_modules/.bin/next dev --port 3002`, and run jest
   with `../../node_modules/.bin/jest --maxWorkers=2`. Then **grep the bundle for
   a string from your newest commit** before believing anything the API tells
   you — a stale `dist/main.js` reports a fixed defect as still broken.
