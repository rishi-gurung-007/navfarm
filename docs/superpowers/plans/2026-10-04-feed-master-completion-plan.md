# NAVFarm Feed — Master Completion Plan (any agent can finish from here)

**Written:** 2026-10-04 by the desktop controller session, at Rishi's request, so that the work can be
finished by **any** coding agent if both Claude sessions are out of usage.
**Owner / source of truth:** Rishi. Where this plan and Rishi disagree, Rishi wins — record it in
`docs/decisions.md` and update this plan.

> **Read this whole section 0 before touching anything.** It is short and it prevents the mistakes
> that cost this project the most time.

---

## 0. How to work on this plan

### 0.1 Where the work is
- **Worktree:** `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`
- **Branch:** `feat/feed-forecast-requisition-integration` (≈160 commits ahead of `main`; merge is a clean
  fast-forward — **never push or merge without Rishi**).
- **Main checkout** `/Users/nero/Desktop/navfarm` is on `fix/series-and-item-kinds-batch` and clean
  (old superseded edits were discarded on Rishi's instruction, 4 Oct). Do not edit it.
- **The client workbook** (the feed spec): `/Users/nero/Desktop/navfarm/NAVFarm_Feed forecast TDD with examples (1).xlsx`.
  Every field of it, page by page, is in **`docs/superpowers/plans/feed-completion/workbook-fields.md`** —
  use that file; cite fields as `<Sheet> row N`.

### 0.2 Read first (in this order)
1. `AGENTS.md` (project rules; §3 verification, §4 conventions, §8 feed state incl. point 7 worktree build traps).
2. `docs/decisions.md` — especially every entry dated **2026-10-03** and **2026-10-04** (summarised in §1 below).
3. This plan.
4. For the work package you take: its supporting file in `docs/superpowers/plans/feed-completion/`.

### 0.3 Non-negotiable rules
- **The workbook governs feed** (3 Oct). Field names, order and content follow it page by page, except where
  Rishi ruled otherwise (§1). Example values in the workbook are examples, never client data.
- **In-house only.** Everything the workbook gives to Business Central is built inside NAVFarm. No BC calls,
  no simulated BC success, no In-house/BC selector. Keep `integration_status = NOT_APPLICABLE` on feed documents.
- **The app must work at every commit:** API typecheck 0 errors and touched test suites green before each commit.
- **Database changes are additive only.** No column drop until the branch is merged (the deferred drop is §4 WP11).
- **Local databases only:** `nf_devco`, `nf_system` on 127.0.0.1 (root, no password). Never the test server.
- **Verify by driving the running app and reading MySQL.** A green suite is not evidence: in this branch,
  2,011 passing tests ran over an auto-draft that returned 500 on 7 of 9 farms, and unit tests passed over a
  dashboard query that crashed on every farm. Every work package ends with a live check.
- **Log in through the app's login endpoint** with the seeded local test users (company.admin@triplec.local etc. —
  credentials are in the project's seed files; never print them). **Never mint JWTs with the secret.**
- **Never `pkill`.** Stop a server by the PID from `lsof -ti :PORT -sTCP:LISTEN`. API = :2877, web = :3002
  (web is `next dev` — hot reload; API is `node dist/main.js` — it does NOT rebuild: rebuild then restart by PID,
  and grep the bundle for a string from your newest commit before trusting it — AGENTS.md §8 point 7).
- **Test commands (do not use `pnpm nx test` in the worktree — nx can replay another tree):**
  - API: `cd apps/api && npx jest <paths> --maxWorkers=2` and `npx tsc --noEmit -p tsconfig.app.json`
  - Web: `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2` and `../../node_modules/.bin/tsc --noEmit -p tsconfig.json`
  - Lint: `./node_modules/.bin/eslint <files>` from the worktree root — no NEW errors (baseline ≈93).
  - Always `--maxWorkers=2`: this is an 8 GB machine.
- **Migrations:** tenant SQL in `apps/api/src/drizzle/tenant`, journal `meta/_journal.json`; latest applied is
  **0147** (`when` 1792000000016). **0146 is RESERVED** for the deferred feed-era column drop and its `when` MUST be
  greater than every applied migration's `when`, or databases that ran later migrations will silently skip it.
  New additive migrations use 0148+. Apply with `pnpm nx run api:db-migrate-all-tenants` (both local tenants) and
  read the table back in MySQL. Contract tests live in `feed-tdd-migrations.spec.ts` — extend them.
- **Data scripts** follow AGENTS.md §4: read-only plan by default, `--verify` (transaction + rollback),
  `--apply`; refuse non-local hosts; registered as `db-*` targets in `apps/api/package.json`.
- **New UI strings in the `en` dictionary only.** Use the shared `Field` / `ReadField` / `FieldGroup` primitives.
- **Commits:** explicit paths (never `git add -A`), message says what changed and why it was wrong before,
  quotes the workbook row / decision, ends with the co-author trailer used on this branch.
- **Ask Rishi** only for things no document or decision answers; record his answer in `docs/decisions.md`.

### 0.4 Process (recommended)
For each task: write the failing test first (TDD), implement, run the gates, commit, then a **separate
review** (a fresh reviewer reads the diff against this plan + the workbook rows), fix what it finds, then the
**live check**. Keep a progress ledger (the previous ledgers are in the git-ignored
`.superpowers/sdd/2026-10-04-feed-part-e-requisition/progress.md`; a new agent may start a fresh one, e.g.
`docs/superpowers/plans/feed-completion/progress.md`, committed). One builder at a time on this branch.

---

## 1. Decisions that govern the remaining work (all in `docs/decisions.md`)

| Date | Decision |
|---|---|
| 3 Oct | The feed TDD workbook governs feed; behaviour it does not describe is dropped (except fields that existed before 25 Sep). |
| 3 Oct | Shortfall = demand + **safety stock** − opening − confirmed incoming. Safety stock is a Feed Planning Setting, default 0 (Below Feed Level is an alert threshold only). |
| 3 Oct | Run-down date = **first shortage date** (first day demand > available stock). |
| 3 Oct | In-house only; Production Output Entry replaces "BC produces feed" (no raw-material consumption). |
| 3 Oct | Feed requisition lines per **batch + house + silo + item**: one order line per silo+item (rounding per compartment) with a read-only batch/house breakdown. |
| 3 Oct | Common requisition (Item / Fixed Asset / Service; Store only for Item; approval precedes release) kept as first developed (1 Oct spec). |
| 4 Oct | Feed Forecast tab creates **feed requisitions only** (New opens feed directly, no picker); Approvals → Requisitions creates **every kind**. |
| 4 Oct | Requisitions (common and feed) are created and edited in a **dialog** (header fields first, then lines); read-only once not editable. |
| 4 Oct | Every page shows the workbook's fields for it, field for field. |
| 4 Oct | The Feed Forecast **Dashboard is a dashboard**: filter bar first, then KPI tiles and charts, then the workbook table. |
| 4 Oct | The forecast shows **silo number (code) and silo name**. Silo codes stay as the LOCATION Number Series issues them (e.g. `GRA100/SILO-001`); the workbook's `FarmCode-HouseCode-SILOx` is an example only. |
| 4 Oct | The forecast grid shows each row's silo/item **stock every day (Daily) / every week (Weekly) until it runs out** (red 0 on the run-out date), range extending to the run-out (≤45 days). |
| 4 Oct | Feed header **Required Delivery Date is derived** from the lines (earliest), read-only; dates are edited on the lines (reason when moved). |
| 4 Oct | New common requisition dialog **title names the kind** ("New Fixed Asset requisition" …). |
| 4 Oct | A company admin with an active farm selected **still sees company-wide (farm-less) requisitions** in the Approvals inbox. |
| 4 Oct | **Tenant Admin and Company Admin may approve every requisition, their own and others'** (supersedes 1 Oct "self-approval forbidden" for those two types only). |
| 4 Oct | **One requisition list: Approvals → Requisitions** (with "Waiting for my approval" + Approve/Reject). The Approvals inbox no longer lists requisitions. The Feed Forecast tab stays a feed-only view on the same components. |
| 4 Oct | Shared table/number/timestamp display primitives: do it as a small task **after** Parts B–D. |
| 4 Oct | The Save Run fix ships with the whole branch (no separate PR). |
| 1 Oct (still valid) | FARM_MANAGER distinct from STANDARD_USER; "Head of Farms" = OPERATIONAL_ADMIN; base/local currency are company settings; Finance escalation at ≥5% variance; monetary threshold null until Triple C supplies it; Friday 18:00 reminder / Saturday 12:00 cutoff / Sunday 08:00 count / `Africa/Harare` are configuration, not hard-coded; Purchase release records `BC_PENDING`. |

---

## 2. Where everything is (pages and code)

| Page | Menu path in the app | Main code |
|---|---|---|
| Feed Forecast (grid, stages, run history, Save Run) | Inventory → Feed Forecast → **Forecast** tab | web `components/console/inventory/feed-forecast-panel.tsx`, `feed-forecast-grid.tsx`; API `modules/inventory/feed-forecast/` (engine = pure calculation in `feed-forecast.engine.ts`) |
| Feed Forecast Dashboard | Inventory → Feed Forecast → **Dashboard** tab | web `feed-silo-dashboard.tsx`; API `feed-silo-status.ts`, `GET /feed-forecast/silo-status` |
| Feed Requisition (feed only) | Inventory → Feed Forecast → **Feed Requisition** tab (currently labelled "Internal Feed Transfer" — gap) | web `requisitions-panel.tsx`, `feed-requisition-detail.tsx`, `feed-requisition-document.tsx`, `feed-requisition-header.tsx`, `requisition-new-dialog.tsx`; API `modules/procurement/feed-requisition/` |
| Physical Count | Inventory → Feed Forecast → **Physical Count** tab | web `feed-stock-count-panel.tsx`; API `modules/inventory/feed-stock-count/` |
| Requisitions hub (all kinds) | **Approvals → Requisitions** | web `components/console/requisitions/requisitions-hub.tsx`, `common-requisition-document.tsx`, `common-requisition-detail.tsx`; API `modules/procurement/requisition/` (`/requisition`, mounted 4 Oct; refuses FEED rows) |
| Approvals inbox | **Approvals** | web `components/console/approvals/*`; API `modules/production/approval/` |
| Feed Planning (settings + silo setup) | Inventory → Feed Forecast → Feed Planning panel | web `feed-planning-panel.tsx`; API `modules/inventory/feed-settings/` |
| Stock transfers (staged: shipment / receipt) | Inventory → Stock Transfer & Sales | API `modules/inventory/stock-transfer/` (statuses DRAFT / IN_TRANSIT / PARTIALLY_RECEIVED / POSTED) |
| Masters: Location (silo), Item, Breed Lifecycle, Alert Rules, Reporting Periods, Number Series | Farm Master / Master data / Settings | web `modules/master-data/configs.ts` (one registry, route `/master-data/[key]`) |

Evidence of what is done: `docs/VERIFICATION-2026-10-03-feed-tdd-part-a.md`, `docs/VERIFICATION-2026-10-04-feed-part-e.md`.

---

## 3. Status (as of 4 Oct, HEAD `4b670477`)

**Done and live-verified**
- **Part A** — forecast and feed requisition aligned to the workbook (safety stock, first-shortage date,
  7-day default window, 45-day cap, delivery date = first shortage, capacity warning, 10000-step lines,
  batch/house breakdown, feed requisition as a header + lines document, silo dashboard, master fields
  Diet No. / Feed Form / Feed Type, data script `db-align-feed-tdd`, migrations 0141–0145, final review).
- **Part E** — common requisition (Item/FA/Service) screens on the mounted `/requisition` API with a FEED
  guard and company boundary; Store release creates a stock transfer (line-linked, staged shipment/receipt,
  stock moves once, transfer status follows events); Purchase release `BC_PENDING` + Link PO; manual feed
  line checked against the lifecycle item (exception reason); one Approvals inbox showing full read-only
  documents; company Number Series numbering for common requisitions (fallback REQ-YYYY-NNNN, collision-proof);
  migration 0147; live verification across every kind.
- **4 Oct changes** — company admins see/approve farm-less requisitions (incl. with a farm selected);
  requisitions in a dialog (common + feed); Feed Forecast New opens feed directly; New feed dialog shows the
  workbook header then lines (Feed Type follows the silo's Bulk/Bagged); silo code + name on forecast,
  dashboard and requisition lines (per-silo rows).

**Not done** — everything in §4.

---

## 4. Remaining work packages (do them in this order)

Estimates are agent wall-clock including review and the live check, at the pace observed on this branch
(S ≈ 20–30 min, M ≈ 35–60 min, L ≈ 1–2 h).

### WP1 — Tenant / Company admins approve every requisition, their own included (M) — Rishi 4 Oct (twice)
- **Rule (decisions.md, both 4 Oct admin entries):** a `TENANT_ADMIN` or `COMPANY_ADMIN` may approve or reject
  **any** requisition in their scope, of every kind, **their own and anyone else's**, whatever the approval tier
  or step would otherwise require. Every other type keeps the existing rules (no self-approval; tier/step approvers).
  SYSTEM_ADMIN is undecided: leave it as before.
- **Where the rule lives (one helper, every caller):** `SELF_APPROVAL_EXEMPT_USER_TYPES` / `isSelfApproval` in
  `apps/api/src/modules/procurement/requisition/requisition.rules.ts`. Call sites are the common requisition
  service, the feed requisition service's `decideFromApproval` (the D25 MANUAL_ENTRY check), and the approval
  engine `modules/production/approval/approval.service.ts`. Also check the engine's per-step approver resolution
  (role/tier) so an admin who is not the step's named approver can still decide, and the permission
  `PROCUREMENT/REQUISITION/approve` that `assertMayDecide` requires.
- **Tests:** for each of tenant admin and company admin × common and feed: approving their **own** → APPROVED;
  approving **another user's** at a step where they are not the named approver → APPROVED; reject likewise.
  Farm manager, operational admin and standard user: own → still refused; not the step approver → still refused.
- **UI:** Approve/Reject is shown to admins on every pending requisition, theirs included.
- **Live:** log in as company.admin and as the tenant admin. Approve one of your own and one raised by a farm
  manager, both common and feed. Read `requisition.status` and `approved_by` (and the approval request rows) in MySQL.

### WP1e — Fix the requisition LOB filter (S, do it before WP1b) — Rishi 4 Oct
`requisition.service.ts` (~line 124) and `feed-requisition.service.ts` (~line 156) filter with raw SQL on
`company_master.lob_id`, which exists in **no** database. As a result Farm Manager, Head of Farms and Standard User
get a 500 on requisition lists and actions (found during WP1; see progress.md). Decision: scope by **the requisition's
farm's LOB**, `location_master.lob_id` (a farm with a NULL LOB, or a requisition with no farm, is visible to every LOB).
Use one shared helper for both services. Prefer drizzle columns over raw SQL so `tsc` sees the column; grep for any other
`company_master`/`lob_id` raw-SQL use and fix it the same way.
**Tests:** a restricted user with a LOB lists, opens and decides requisitions of their LOB; refused or hidden for another
LOB's farm; farm-less visible. **Live:** log in as a farm manager and as a standard user and open Approvals → Requisitions
and the Feed Requisition tab; no 500. Then finish WP1's negative live check: restricted users are still refused
self-approval.

### WP1b — One Requisitions page (M) — Rishi 4 Oct
Decision: decisions.md "2026-10-04 — … one Requisitions page".
- **Approvals → Requisitions** (`requisitions-hub.tsx`) is the only requisition list. Add a "Waiting for my
  approval" filter. It needs an API filter returning requisitions whose open approval request the current user
  may decide, using the same predicate as the inbox (`ApprovalService.farmConditions` plus the WP1 admin rule;
  no second copy). Add Approve / Reject on pending rows and in the document dialog, calling the **existing**
  approval decide endpoints, so the checks (remarks, deadline, capacity, reasons) stay in one place.
- **Approvals inbox** (`/approvals/pending`, history, rejected): exclude requisition request types (feed and
  common) from the list and the counts. Add a card or link: "Requisitions waiting for approval: N → open
  Requisitions". The other sign-offs are unchanged.
- **Feed Forecast → Feed Requisition tab:** unchanged in role (feed-only, farm-scoped, draft from forecast). Make
  sure it reuses the same row and document components and actions as the hub.
- **Tests:** the inbox no longer returns requisition types. The hub filter returns exactly what the inbox used to
  return for the same user (write that equivalence test **before** removing them from the inbox). Approve from
  the hub reaches the same handler.
- **Live:** as company.admin, the pending count shown on Requisitions equals the old inbox's requisition count.
  Approve one from the hub and read MySQL. The inbox shows only non-requisition items.

### WP1f — Seed requisition permissions for the demo roles (S) — Rishi 5 Oct
Decision: decisions.md "2026-10-05 — Demo roles get requisition permissions". Add a `db-seed-requisition-role-permissions`
script (plan / `--verify` / `--apply`, refuses non-local hosts, idempotent). It grants PROCUREMENT / REQUISITION actions:
MANAGER (Farm Manager) and the Head of Farms role get view, create, edit, submit and approve; OPERATOR / Standard User
roles get view, create, edit and submit, without approve. Find the real role codes and the action vocabulary in the
permission tables first (do not guess). Also add the grants to the seed that new tenants get, so a fresh tenant matches.
**Live:** log in as a seeded farm manager (no temporary grants) and open Approvals → Requisitions and the Feed
Requisition tab, then create, submit and approve another user's requisition. As a standard user, create and submit, and
check that Approve is refused. Read the permission rows in MySQL.

### WP1c — Common requisition to Rishi's field and button list (≈5–7 h) — Rishi 4 Oct
Spec (verbatim): `feed-completion/common-requisition-spec.md`. The decision that frames it is in decisions.md
("2026-10-04 — Common requisition field and button list"). Code: API `modules/procurement/requisition/`,
`modules/inventory/stock-transfer/`; web `components/console/requisitions/common-requisition-*.tsx`,
`requisition-new-dialog.tsx`.

Gap table, checked against the code on 4 Oct. Re-verify each row in the running app before building it.

| Spec item | State on 4 Oct | Work |
|---|---|---|
| Header fields: No. (series), Date, Main/Farm Location, Requester User ID, Name, Requester Dept (auto from User Setup), Sender Dept (select), Type, Purpose, From/To Sub-Location (Store only), Direct Transfer, Remarks | All columns exist on `requisition`; dialog shows most | Show them **in this order and with these labels** in the dialog and the document. Requester User ID shown. From/To Sub-Location shown only when Purpose = Store. Requester Department read-only from the user. |
| Type FA / Service = Description + Qty only; Item chosen on the line | Partly | FA/Service lines show only Description and Qty (no item, UOM or rate). Item lines show Item No. + Item Description. |
| Status: Open / Released | The document shows Open / Approved / Released, with approval as a separate state | The **Status** field shows Open / Released. Approval stays a separate "Approval" field (1 Oct: approval precedes release). Hub columns: Status + Approval. |
| Line: Line No., Item No., Item Description, FA/Service Description, Qty, From/To Location (auto from header), Qty to Ship, Qty Shipped, Qty to Receive, Qty Received, Remaining to Receive = Shipped − Received, Balance to Ship = Qty − Shipped | Columns exist (`line_seq`, `from/to_location_id`, `qty_*`). The two balances are computed. | Show every column in this order. From/To come from the header and are read-only. The two balances are computed, never stored. |
| Release: Purchase → PR to "BC" creates PO; Store → internal transfer only | Done (BC_PENDING + Link PO; Store creates a staged transfer) | Keep. Live re-check only. |
| Transfer Shipment by the sender department user; **user dept must match the From Sub-Location's department** | **Missing** (no department check on shipment) | Before posting a shipment: the user's `user_master.department_id` must equal the From location's `location_master.department_id` (Cost Center identity, never text). A clear refusal otherwise. Same rule in the Direct Transfer path. |
| Transfer Receipt by the requester at the To Sub-Location; **user dept must match the To Sub-Location's department** | **Missing** | Same check against the To location. |
| Direct Transfer checkbox — the user needs the right **in User Setup** | Enforced via an explicit permission; not visible in User Setup | Add a "Direct Transfer allowed" toggle to the user record (Team Management → user). Make it the **one** source the rule reads (migrate the existing permission into it, or have the toggle grant/revoke that permission; never two checks). The dialog checkbox is disabled for users without it. Direct Transfer posts shipment + receipt together (exists). |
| Item Tracking button on the line: Lot/Serial assignment; mandatory before shipment if the item is Lot or Serial tracked; receipt auto-fills from shipment | **Missing** in the feed branch. Lot/serial tracking is on `origin/main` (Arun, PR #13: 13 commits, 52 files) | **First** (Rishi approved 4 Oct) `git fetch`, then merge `origin/main` into this branch (local merge only, no push) as its own commit and step. Resolve conflicts, chiefly `translations.ts`, `schema.ts`, migrations and journal numbering (renumber the branch's migrations after main's if the indexes clash, and re-run the contract tests). Run the full API and web suites. Then add a per-line Item Tracking dialog reusing main's lot/serial pickers. Block shipment while a tracked line's lot/serial quantity ≠ Qty to Ship. The receipt copies the shipment's lot/serial rows. The ledger rows carry `lot_no` / `serial_no`. |
| Location department ("dimension") and user department in User Setup | Columns exist (`location_master.department_id`, `user_master.department_id`) | Make sure both are visible and editable in Location Master and Team Management. Demo data: every sub-location used by Store requisitions has a department, and the demo users have departments. |
| Item Ledger + Value Entry on shipment and receipt | Inventory ledger and the In Transit journal exist (Part E) | Live-verify that shipment and receipt each write ledger rows with cost (and lot/serial once tracked). No new ledger. |

Tests first for each gap: department mismatch refused (shipment, receipt, direct); right-less user cannot tick
Direct Transfer (API and UI); tracked item blocks shipment without lot/serial; receipt inherits them; FA/Service
line rejects item fields.
**Live:** two users in different departments. A sender-department user ships, the requester-department user
receives, and each is refused at the other's step. A tracked item end to end with its lot/serial on both ledger
sides in MySQL. A Purchase release shows BC_PENDING. Put any moved stock back.
**Rishi 4 Oct:** admins do **not** bypass the department checks; their extra power is approval only (any requisition, by anyone).

### WP1d — Page, tab and section names follow the workbook (S–M, ≈1–1½ h) — Rishi 4 Oct
"the proper naming of the tabs and the pages according to the shared file". Use the workbook's own names (sheet titles
and SECTION headings, see `feed-completion/workbook-fields.md`) for page titles, tabs, section headings, menu entries,
breadcrumbs and the document dialog titles. Change labels in the `en` dictionary (`apps/web/src/utils/translations.ts`)
and page headers only; **do not rename routes** (bookmarks: `/inventory/feed-forecast?tab=…` keys stay). Update the specs
that assert the old labels.

| Where in the app | Current label | Workbook name (use this) | Workbook source |
|---|---|---|---|
| Inventory → Feed Forecast (page) | Feed Forecast | **Feed Forecast** | sheet "Feed Forecast" |
| Feed Forecast tab `dashboard` | Dashboard | **Dashboard** (Rishi 4 Oct; workbook "Feed Forecast Dashboard") | Engine SECTION 4 |
| Feed Forecast tab `forecast` | Forecast | **Calculation** (Rishi 4 Oct; workbook "Feed Forecast Calculation") | Engine SECTION 2 |
| …its filter bar / run history | (filters, run history) | **Forecast Filters** / **Run Audit** | Engine SECTION 5 "Flexible Forecast Filters and Run Audit" |
| …its "Stages (n)" sub-tab | Stages (n) | **REMOVE** (Rishi 4 Oct: not in the file → remove it properly; see below) | — |
| Feed Forecast tab `feed-requisition` | Internal Feed Transfer | **Requisition** (Rishi 4 Oct) | sheet "Requisition and Loading Sheet" |
| Feed requisition document: header block / lines block | (various) | **Requisition Header** / **Requisition Sub-Form** | Req. SECTION 1 / SECTION 2 |
| Feed requisition approval panel | (Approval) | **Approval Workflow** | Req. SECTION 4 |
| Feed Forecast tab `physical-count` | Physical Count | **Physical Stock Count** | Engine SECTION 1 |
| Location Master, silo section | (Silo fields) | **Location Master – Silo Level** | Master Setup §1 |
| Item Master, feed section | (Feed fields) | **Feed Item Setup** | Master Setup §2 |
| Breed lifecycle master | (current name) | **Breed Lifecycle Stage Config** | Master Setup §3 |
| Alert rules master | Alert Rules | **Alerts and Notifications Master** | Master Setup §4 |
| Reporting periods master | Reporting Periods | **Reporting Period Master** | Feed Forecast sheet r18 |
| Feed Planning Settings | Feed Planning Settings | keep (ours; workbook "Design principles" settings) | — |
| New pages (Part B–D) | — | **Mill Capacity Master**, **Loading Instruction Sheet**, **Feed Mill Manager Consolidation Sheet**, **TO Receipt**, **Feed Plan – Tentative vs Actual**, **Compare Report**, **Silo Balance**, **Monthly Stock Take** | Feed Forecast r11; Req. §3, §5, §6; Engine §3; Silo Balance §1, §3 |
| Approvals → Requisitions dialogs | New … requisition | "New Feed Requisition"; common: "New Purchase Requisition – Item / Fixed Asset / Service" (Rishi's list calls the number "Purchase Requisition No.") | Req. title; common-requisition-spec.md |

Rishi's tab names (4 Oct, final): **Dashboard · Calculation · Requisition · Physical Stock Count**, in that order.

**Remove the "Stages (n)" sub-tab properly** (Rishi 4 Oct: "if not in the file then remove it properly"). It is a
display aggregate (`stages: StageBlock[]` in the forecast response, rendered by `FeedForecastStages` in
`feed-forecast-panel.tsx`). Remove the sub-tab and its toggle state, the `FeedForecastStages` component, the
`ffTabStages` and other strings used only by it, the `stages` field and its builder in `feed-forecast.service.ts` if
nothing else reads it (grep first, including `feed-forecast-grid.tsx`), and the specs that assert it. **Keep** the engine's
stage-chain projection (`nextStageId`, used to pick the next diet; workbook Engine Step 3–5), because that is in the file.
Expected stage changes that matter stay visible where the workbook puts them: next diet / diet change dates in the
Calculation output and on the Dashboard. Same rule for anything else found on the feed pages that the workbook does not
have and that did not exist before the feed work began (25 Sep, the 3 Oct ruling): list it here, then remove it the same way.

Before building it, re-read every current label in the running app and record any extra mismatch in this table.
Live check: screenshot each renamed page and tab.

### WP1g — Requisition as its own menu item, common kinds only (M, ≈1–1½ h) — Rishi 5 Oct
Decision: decisions.md "2026-10-05 — Requisition is its own menu item…". Move the hub (`requisitions-hub.tsx`) to a
top-level sidebar entry **Requisition**, for example `/requisitions`. Restrict its list, filters, "Waiting for my approval",
New dialog and decide actions to ITEM / FA / SERVICE; FEED rows are excluded server-side via a `kind=common` filter,
not only hidden. Remove the Approvals sub-navigation entry for it. Redirect `/approvals/requisitions` and
`/inventory/requisitions` to the new route, keeping the query. Feed requisitions remain only on Feed Forecast →
Requisition, including their Approve/Reject there (that tab must offer the decide actions WP1b added to the hub).
The Approvals inbox keeps excluding requisitions. **Tests:** hub never shows or creates FEED; the redirects; the feed tab
can approve. **Live:** sidebar shows Requisition; a feed requisition can be approved from the Feed Forecast tab; screenshot.

### WP1c addendum — FA/Service lines are Description + Qty only (Rishi 5 Oct)
Migration 0148 (or the next free index; never 0146): `ALTER TABLE requisition_line MODIFY COLUMN uom varchar(20);`
(relax NOT NULL, nothing dropped). Add a contract test like 0142's. DTO: `uom` is required only for ITEM lines.
UI: FA/Service lines show only Description and Qty (no unit, no rate). Apply it to both local tenants and read the column
back.

### WP2 — Forecast grid shows stock every day/week until it runs out (M) — Rishi 4 Oct
Brief: `feed-completion/task-21a-brief.md`. Defect at `feed-forecast-grid.tsx` ~349–368 (cells render only on
days the batch eats). Expose the engine's per-source by-date balance (no second calculation); Daily = one column
per day to the latest first-shortage date (≤45); Weekly = 7-day columns showing end-of-week balance; red 0 on the
run-out date. Live on VIL100 (Rishi's screenshots: BATCH-000012 blank after 09/10 though stock remained).

### WP3 — Feed Forecast Dashboard as a dashboard (L, ≈4 pieces) — Rishi 4 Oct
Design (approved shape): `feed-completion/task-21-design.md`; brief `task-21-brief.md`.
- **Filter bar first:** Farm (fixed for a Farm Manager), View/Period (Daily / Weekly / Reporting Period / Custom),
  House, Silo, Feed Item, Bulk/Bagged.
- **KPI tiles:** silos at/below Below Feed Level (CRITICAL), at/above Above Threshold (INFO), earliest first-shortage
  date, farm total recommended order vs 30,000 KG truck target, requisition status + submission deadline.
- **Charts (recharts):** (a) System Balance vs capacity per silo with level lines (meter bars); (b) projected
  closing balance by date to shortage; (c) demand by feed item, current vs next diet; (d) shortfall vs
  recommended order.
- **Table beneath, workbook Engine §4 rows 47–64, in order:** Farm · House Shed · Silo Code (+ Silo Name; code
  links to the silo record) · Current Diet Feed Item · Mill Loading Bin No. (fill in Part B) · Silo Capacity KG ·
  System Balance KG (always labelled "System Balance") · Daily Requirement KG · Days of Feed Remaining (date-based;
  colour <3 critical, <7 warning) · Projected Need for Selected Range KG (split old/next item) · Current Diet Days
  Remaining · Next Diet Feed Item · Silo Available for Next Diet Feed Type · Projected Shortfall KG · Recommended
  Order Qty KG · Farm Total Order This Cycle KG (vs 30t) · Requisition Status (label, links to the requisition) ·
  Submission Deadline.
- API: extend `GET /feed-forecast/silo-status` with the filters and the by-date series (reshape engine output only).

### WP4 — Proper feed demo data (M) — Rishi 4 Oct ("proper data for the feed forecast")
Today `nf_devco` (9 farms, ~2 companies) gives a misleading forecast: the Notes show "Days with no feed rate",
"No silo holds the diet", and each breed stage has a single feed for the whole stage (no diet changes), WEANING has
no feed row, and 25 of 97 lifecycle rows have no item/rate (DEAD/SLAUGHTERED are correct to have none).
Build an **illustrative, labelled** demo fixture with a `db-seed-feed-demo` script (AGENTS.md §4 shape;
`apps/api/src/scripts/seed-four-farm-feed-demo.ts` already exists — extend it rather than starting over):
- Lifecycle feed rows per active breed/line covering **every feeding day of every feeding stage** with **diet
  changes inside stages** like the workbook (e.g. weaner days 25–27 R1 2.0 kg, days 28–31 R2 2.5 kg), feed form
  BULK/BAGGED, rate per head/day; no gaps or overlaps (Engine Step 3 blocks on missing/overlapping rows).
- Feed items with Diet No. 1–14 (illustrative), Item Type FEED, UOM KG.
- Each farm: silos (capacity, Below Feed Level, Above Threshold, Feed Type) holding the diets its batches need
  (cover 1:1, one-to-many, many-to-one, many-to-many silo–house shapes — the approved four-farm matrix), stock via
  real ledger postings (stock adjustment / receipt — not raw inserts), so that: some silos run short within 7 days,
  some within 8–45 days, some never; at least one next-diet change inside the 7-day window; one bagged store.
- Batches with head counts and stage start dates that put them mid-stage; one REGISTERED/animal-wise group.
- Feed Planning Settings (safety stock 0, bulk 3000, bag 50, truck 30000) and a Reporting Period covering today.
- Label every row as illustrative (name/description) and never on a real customer tenant.
- **Live:** for each demo farm the Forecast shows no "no feed rate"/"no silo holds the diet" notes except the
  deliberate ones, the Dashboard tiles/charts populate, Draft from forecast produces lines.

### WP5 — Requisition follow-ups (≈1 h)
- **Priority editable** on the feed requisition (Req. §1 row 34 "Yes – can escalate") — API: add `priority` to the
  update DTO + a `priority_edited` marker so a rerun keeps it (like `quantity_edited`); web: editable select. (M)
- Physical Count page shows names not raw IDs (part of WP6 Task 28). Feed tab label "Feed Requisition" (WP6 Task 27).

### WP6 — Remaining workbook field gaps, Tasks 23–36 (≈10–13 h)
Full detail per task (files, API vs web, effort, order): **`feed-completion/task-22-task-list.md`**; the field-by-field
evidence: **`feed-completion/task-22-audit.md`**. Summary:

| Task | Page | Change | Workbook rows | Effort |
|---|---|---|---|---|
| 23 | Forecast | Filters House / Batch / Silo / Feed Item / Bulk-Bagged (bulk/bagged needs `feed_form` threaded to rows) | Feed Forecast sheet r8; Engine r20 | M |
| 24 | Forecast | Output columns: current silo item, rate per head, opening, receipts, daily use, projected closing, shortage date, recommended qty, delivery date | Engine r70, r11, Step 8 | M |
| 25 | Forecast | Run history shows stored audit fields (as-of, cutoff, filters, lifecycle version, author, version) | Engine r68 | S |
| 26 | Cross-page | Replace dash placeholders with real values or blanks (2 Oct ruling 3) | — | S |
| 27 | Feed Requisition tab | Superseded by WP1d (all names) | Req. sheet title | — |
| 28 | Physical Count | Resolve raw IDs (silo, item, reason) in count lines | Engine r8–11 | S |
| 29 | Physical Count | Missing entry columns (Silo Name, House(s) linked, Silo Feed Item, Current Diet, Capacity, Current Balance, Projected Shortfall, Next Diet change, Next Feed Item) + one label | Engine r6–18 | M |
| 30 | Feed requisition document | Header order/labels (r26–35), Destination Silo column, Priority editable (with WP5) | Req. r26–35, r55, r34 | M |
| 31 | Manual create dialog + list | Workbook labels (re-check after Task 18/18b — much is done) | Req. §1–§2 | S |
| 32 | Location Master (silo) | Show derived read-only fields on the record: Last Approved Physical Count, System Balance, Days to First Shortage, Feed in Silo, Available Stock, Last Feed Receipt Date, Next Diet Change Date | Master Setup r13–20 | M |
| 33 | Item Master | Workbook labels (Item No., Item Description, Item Type, Base UOM, Diet No.) | Master Setup r24–28 | S |
| 34 | Breed Lifecycle Stage Config | Workbook labels and order (Line, Stage, Calculation Unit, Period From/To, Feed bulk/bagged, Feed Item No., Feed Rate KG/Day/Animal) | Master Setup r32–39 | S |
| 35 | Breed Lifecycle Stage Config | **Effective dates and farm override** (future-dated rows for diet change planning; farm-level override; engine picks the effective row per date and farm) | Master Setup r30, r38–39 | L (likely 2×L) |
| 36 | Alert Rules Master | Auto-numbered Notification Code; recipient/escalation roles picked from the Role Master | Master Setup r43–56 | M |

### WP7 — Part B: the mill (≈12–16 h). Spec §4 (`docs/superpowers/specs/2026-10-03-feed-tdd-alignment-and-inhouse-mill-design.md`).
Write a detailed task plan first (one task per page/flow, TDD, live proof). Pages and their workbook fields:

**B1. Location type MILL + Mill Capacity Master** (new master in `configs.ts`) — Mill, Capacity KG/day and KG/hour,
bulk and bagged daily allocation (workbook example 238,000 / 178,000 / 60,000), Diet priority order, **Loading Bins**
child rows (Bin No., Diet item, effective production date + slot). Checkpoint 6/35: one diet per bin per slot (block).
Feed Forecast sheet r11; Engine §3 r42–43.

**B2. Production Output Entry** (ours, 3 Oct ruling 5) — Mill, Production date, Slot/shift, Diet item, Bin, KG produced →
positive inventory posting at the mill location through the shared posting path (like a stock adjustment), valued at the
item's current unit cost. No raw-material consumption.

**B3. Loading Instruction Sheet** — Requisition and Loading Sheet §3 rows 60–77: Loading Sheet No. (LOAD-ReqNo-LineNo),
Requisition No., Farm Code, Farm Name, Delivery Date, Feed Item No. Diet (Diet 1–14), Feed Item Description, Mill Loading
Bin No. (from Mill Capacity Master via Diet No.), Silo Code at Farm, KG Ordered (mill-approved KG once consolidation
sets it), Compartment No. (mill fills), KG Loaded (mill fills), Loaded By, Loading Date Time, Dispatch action,
Notification Status, Notification Content, Status DRAFT → LOADED → DISPATCHED → RECEIVED. Created when the Farm Manager
approves a feed requisition. Checkpoints 24 (compartment + KG loaded mandatory before dispatch) and 25 (no two diets in one
compartment).

**B4. Feed Mill Manager Consolidation Sheet** — §5 rows 115–130: Consolidation Sheet No. (CONS-YYYY-WW-NNN, one per
production week), Production Week (YYWW), Consolidation Date, Feed Mill Manager, rows per Farm × Diet: Farm Code, Diet Feed
Item No., Diet No., Mill Loading Bin No., Farm Requested Qty KG, Total All Farms KG (this diet), Mill Capacity Available KG,
Mill Approved Qty KG (reason if different; original kept; farm notified), Adjustment Reason, Consolidation Status
DRAFT → REVIEWED → CONSOLIDATED → **PLAN_APPROVED** (our name for PUSHED_TO_BC), Approve Plan action (in-house: creates the
Transfer Orders), Transfer Order No. per farm. Checkpoints 41 (only APPROVED requisitions), 42 (cannot approve the plan while
any diet exceeds capacity). Requisition status → IN_CONSOLIDATION → PLAN_APPROVED.

**B5. Transfer Orders from the plan** — one TO per farm per diet from the mill to the farm (reuse `stock_transfer` with
staged shipment/receipt; lines carry requisition line, consolidation line, destination silo; `requisition.linked_transfer_id`).
Number TO-MILL-FarmCode-NNNN.

**B6. Dispatch** — blocked without compartment + KG loaded (cp 24), two diets in one compartment (cp 25), or insufficient mill
stock; posts the shipment; requisition → TO_SHIPPED; loading sheet → DISPATCHED; in-app (and, after Part C, email) dispatch
notice to the farm, deduplicated by shipment.

**B7. Feed TO Receipt** — §6 rows 135–157 and Silo Balance §2 rows 13–29: TO Receipt No., Requisition Slip No., Farm Code,
Destination Silo (filtered: holds this item or its current item's balance is 0 — cp 4, 45), Feed Item No., Description, Feed Type,
Farm Requested Qty KG (locked, cp 44), Mill Approved Qty, BC Shipped Qty KG (= shipped), Previously Received, Outstanding,
Received Qty This Posting KG, Variance Shipped vs Received (reason mandatory if ≠0; over-receipt posts but flagged, mill
notified — cp 26, 29), Variance Reason, Bag Count Received (bagged: bags × bag size within tolerance — cp 27), Compartment No.
Received From, Delivery Note No. (mandatory), Loading Sheet No., Receipt Date, Post Receipt (one posting path from TO or
requisition; unique per shipment line — cp 46, 47), Silo Balance After Receipt. Requisition → PART_RECEIVED / RECEIVED / CLOSED;
loading sheet → RECEIVED; low-feed alert resolves, above-threshold INFO re-evaluates (cp 12, 13).

**B8. Dashboard Mill Loading Bin column** (Engine r51) filled from B1.

**B9. Part B live verification** — the workbook's Worked Example end to end: forecast 6,000 / 9,000 → requisition → approval →
production output → consolidation (Diet 1 12,000 vs 20,000 GREEN) → TO → loading → dispatch → receipt (SILO1 1,500 + 6,000 =
7,500) → POST Day 2,000 → 5,500. Read MySQL at each step; put any moved stock back.

### WP8 — Part C: planning, reports, notifications (≈6–8 h). Spec §5.
- **C1. Feed Plan — Tentative vs Actual** (Engine §3 rows 34–44): Plan Code (PLAN-FarmCode-YYYYWW-Rnn), Plan Type
  (TENTATIVE / ACTUAL, versions kept), Farm Code, Plan Week YYWW, Feed Item No., Tentative Quantity KG (5 completed weeks of
  posted POST Day consumption, normalised per day, adjusted for projected heads and known diet changes), Actual Requested
  Quantity KG (sum of farm-approved requisitions; requested and mill-approved kept), Variance Actual vs Tentative, Mill
  Capacity Available KG, Plan vs Mill Capacity (GREEN <90% / AMBER 90–100% / RED >100%), 5-Week History rolling dataset.
- **C2. Compare Report** — all-farm demand vs mill capacity per diet and bin; over capacity notifies Mill Manager and Head of
  Farms and asks Farm Managers to reduce (cp 34, 35).
- **C3. Scheduler** (`@nestjs/schedule`, new dependency): Wednesday tentative plan + forecast + "plan ready" (cp 36); Friday
  reminder for AUTO_DRAFT; Saturday cutoff CRITICAL to Farm Manager + Head of Farms (cp 20); daily diet-change warning 3 days
  ahead (cp 30); escalation of unacknowledged alerts. Days/times/time zone from Feed Planning Settings.
- **C4. Notifications** — IN_APP + EMAIL per the Alerts and Notifications Master (Master Setup §4 rows 43–56: Notification
  Code, Name, Event Type, Trigger Entity, Threshold Value, Threshold Reference, Priority Level, Recipient Role(s), Delivery
  Channel, Frequency, Escalation After Hours, Escalation Recipient Role, Active, Farm Filter) via the existing nodemailer; without
  SMTP configuration log SKIPPED, never SENT.

### WP9 — Part D: monthly stock take and period close (≈5–6 h). Spec §6.
- **D1. Monthly Stock Take** (Silo Balance and Stock Take §3 rows 33–49): Stock Take No. (ST-FarmCode-YYYY-NNNNN /
  ST-MILL-YYYY-NNNNN), Stock Take Type (FARM / FEED_MILL), Farm Code or Mill Code, Reporting Period, Stock Take Date (= period
  end, month-end Saturday), Silo Code or Location (all active), Physical Feed Item in Silo, System Balance KG at Stock Take Date,
  Physical Count KG, Variance KG, Variance Percent (= |variance| ÷ period consumption × 100), Variance Reason (any nonzero;
  Finance approval over threshold), Adjustment Type (POSITIVE/NEGATIVE), Post Approved Stock Adjustment (once), GL entry
  (in-house journal), Period Status After Reconciliation, Production Start Date Next Period. Extend `feed_stock_count`
  (count_type WEEKLY/MONTHLY, stock_take_type, reporting_period_id, location generalised to the mill).
- **D2. Period close** — only with a posted MONTHLY stock take for every farm and mill (cp 31); a closed period blocks POST Day,
  receipts and adjustments dated in it (cp 32); stock take refused if the period does not exist (cp 40).

### WP10 — Shared display primitives (S, after B–D) — Rishi 4 Oct
Seven feed screens keep private copies of the table styling, number and timestamp formatting (forecast grid, planning panel,
silo dashboard, stock count, requisitions list, both documents). Move them to one shared module; every screen's specs pass
unchanged; screenshot each screen.

### WP11 — Final review, merge prerequisites, release
- Whole-branch review of everything after Part A's review (Parts E, B, C, D and all 4 Oct changes).
- **Before the deferred column drop:** fix `apps/api/src/scripts/align-feed-tdd.ts` so it also handles inactive and
  soft-deleted farms (today it skips them — the drop would then lose their values silently). Then write migration
  **0146** dropping the six feed-era `location_master` columns (`feed_refill_buffer_days`, `feed_lead_time_days`,
  `feed_bulk_multiple_kg`, `feed_bag_size_kg`, `feed_truck_target_kg`, `feed_production_weekday`) and
  `feed_forecast_run_line.required_on_date`, with a journal `when` greater than every applied migration, run only after
  the merge into main, and only after the data script has run.
- Test-server release: Rishi takes verified backups first; migrate (never rebuild) the testers' tenant
  `nf_portatestnavfarm`; read every tenant's journal afterwards. `nf_replay_feed_tdd` (throwaway local DB) can be dropped.

---

## 5. Things Rishi asked for beyond the workbook (keep them)

| Ask | Where | Status |
|---|---|---|
| Safety stock as its own setting (default 0) | Feed Planning Settings | done |
| Silo Feed Type settable (Bulk/Bagged) | Feed Planning silo row | done |
| Silo number **and name** on the forecast, dashboard, requisition lines | Forecast / Dashboard / Requisitions | done |
| Feed New = feed automatically; requisitions in a dialog; header first then lines | Feed Requisition tab, Approvals → Requisitions | done |
| Dialog title names the kind | Approvals → Requisitions | done |
| Dashboard with filters, tiles and charts | Feed Forecast → Dashboard | WP3 |
| Stock shown every day/week until it runs out | Forecast grid | WP2 |
| Company admin with a farm selected still sees company-wide requisitions | Approvals inbox | done |
| Tenant/Company admin may approve every requisition, theirs and others' | Approvals / requisitions | WP1 |
| One page for requisition requests | Approvals → Requisitions | WP1b |
| Common requisition header/lines/buttons/item tracking per his list | Approvals → Requisitions | WP1c |
| Page and tab names as in the workbook | all feed pages | WP1d |
| Proper demo data for the forecast | `nf_devco` | WP4 |
| Common requisition numbering from the company Number Series | Requisitions | done |

---

## 6. Pages and their status

| Page | Where | Status |
|---|---|---|
| Feed Forecast | Inventory → Feed Forecast → Forecast | built · WP2, WP6 (23–26) |
| Feed Forecast Dashboard | … → Dashboard | table only · WP3 |
| Physical Count (weekly) | … → Physical Count | built · WP6 (28–29) |
| Feed Requisition | … → Feed Requisition tab; Approvals → Requisitions | built · WP5, WP6 (27, 30, 31) |
| Common Requisition (Item/FA/Service) | Approvals → Requisitions | built · WP1c (Rishi's 4 Oct field list: dept checks, Direct Transfer right, Item Tracking) |
| Approvals inbox | Approvals | built · WP1, WP1b (stops listing requisitions) |
| Location (silo), Item, Breed Lifecycle, Alert Rules masters | Farm Master / Master data | built · WP6 (32–36) |
| Reporting Periods, Feed Planning Settings, Number Series | Farm Master / Feed Forecast / Settings | built |
| Mill Capacity Master, Production Output, Loading Instruction Sheet, Consolidation Sheet, Transfer Orders from plan, Dispatch, Feed TO Receipt | new | WP7 (Part B) |
| Feed Plan (Tentative vs Actual), Compare Report, scheduler, email | new | WP8 (Part C) |
| Monthly Stock Take, Period Close | new | WP9 (Part D) |

---

## 7. Estimate (remaining) and actual (so far)

| Work | Estimate | Actual |
|---|---|---|
| Spec + Part A plan | ½ day | ~2 h |
| Part A | 2 days | ~12½ h clock (3 Oct 12:13 → 4 Oct 00:49) |
| Part E + 4 Oct changes (Tasks 1–20, 18b, 4b, 9b–9d) | ½–1 day | ~16 h clock (4 Oct 01:08 → ~17:30, incl. limit pauses) |
| WP1 admins approve all requisitions | 45 min | done 411ecdf6 (review pending) |
| WP1e requisition LOB filter fix | 30–45 min | — |
| WP1b one Requisitions page | 1–1½ h | — |
| WP1f seed requisition permissions for demo roles | 30–45 min | — |
| WP1g Requisition own menu item, common only | 1–1½ h | — |
| WP1c common requisition to Rishi's list (incl. merging origin/main lot/serial) | 5–7 h | — |
| WP1d page/tab/section names per workbook | 1–1½ h | — |
| WP2 grid until run-out | 1 h | — |
| WP3 dashboard | 3–4½ h | — |
| WP4 demo data | 1–1½ h | — |
| WP5 requisition follow-ups | 1 h | — |
| WP6 field gaps (14 tasks) | 10–13 h | — |
| WP7 Part B mill | 12–16 h | — |
| WP8 Part C | 6–8 h | — |
| WP9 Part D | 5–6 h | — |
| WP10 shared primitives | 1 h | — |
| WP11 review, drop prerequisites | 3–4 h | — |
| **Remaining total** | **≈51–67 h** | |

---

## 8. Open questions for Rishi (do not decide them yourself)
1. Should **System Admin** also be allowed to approve their own requisitions (4 Oct names only Tenant and Company admins)?
2. Silo–house mapping **effective dates** (Master Setup r8) — needed for the piggery MVP?
3. Monetary Finance threshold for stock variances, and the reporting/local currency (still open from 1 Oct).
4. Bulk compartment capacity, production cutoff and lead time (workbook "Customer validation" row) — confirm before Part B goes to testers.
