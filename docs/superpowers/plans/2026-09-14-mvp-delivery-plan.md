# NAVFarm MVP Delivery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. This is the **roadmap**: phases,
> order, estimates and gates. Each phase is executed from its own detailed task
> plan, `docs/superpowers/plans/2026-09-14-phase-NN-<name>.md`, written when the
> phase starts against the code as it exists then. Phase 1's detailed plan is
> written with this roadmap.

**Goal:** every area on Triple C's `Project task list.docx` reaches its MVP —
a real web → API → MySQL flow that creates, validates, persists and reads back
its record — with 18 September 2026 10:00 IST as a demo checkpoint, and work
continuing in this order until all MVP criteria are met.

**Architecture:** the API is the authority. A farm-scope layer beside the
existing company/area scope (`roles.guard.ts`, `master-data-scope.ts`) bounds
every operational read and write; features are built on it; demo data is
rebuilt by seed scripts that post operational records through the services.

**Tech stack:** NestJS 11 + Drizzle + MySQL (`apps/api`), Next.js 16 + React 19
(`apps/web`), Nx with pnpm. Flutter out of scope.

**Specs (read both before any phase):**
- `docs/superpowers/specs/2026-09-14-access-scope-and-master-data-ux-design.md`
- `docs/superpowers/specs/2026-09-14-daily-data-entry-and-transfers-design.md`
- `docs/decisions.md` — especially the 14 September entries.

## Global constraints

- **Scope:** NOB Livestock → LOB Piggery only.
- **Access (decided 2026-09-14):** tenant admin → every company and farm; company
  admin → every farm in the company; operational admin → every farm in the
  company for the assigned LOB; standard user → **exactly one** assigned farm,
  fixed. `operational_area_master.farm_id` carries no access meaning.
- **Approvals:** requisitions and ordinary approval-required transfers are decided
  by tenant, company or operational admins within scope; **farm-to-farm transfers
  only by tenant or company admins**.
- **No backlog gate.** Missing entries are flagged and notified, never blocking.
- **Out-of-boundary reads by id answer 404**; a create naming another farm's
  location answers 403. Restricted users without the area header answer 400.
- **Demo data:** every NAVFarm record is dropped and rebuilt from seeds; operational
  demo records are posted through services, never raw-inserted; names are
  Zimbabwe-appropriate and clearly demo; never touch `navcrm_*` databases.
- **Never invent client data** beyond clearly-labelled demo operational records.
- **New UI strings:** English dictionary only.
- **Verification:** drive the running API and read MySQL after every write; UI
  phases also get one browser pass at 1440px, 834px and 390px. Tests are a gate,
  not proof.
- **Commits:** say what changed and why it was wrong before; end with the
  `Co-Authored-By` line. Record decisions in `docs/decisions.md`.

## Machine rules (8 GB, owner working alongside)

- At most **3 coding agents at once**, each owning a disjoint set of files named in
  its brief. Agents never run builds, tests, typechecks, servers, browsers or
  MySQL writes, and never commit — the lead does all of that, serially.
- Tests: `NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test api --runInBand --watchman=false` (web likewise).
- After API source changes: `pnpm nx build api --configuration=development`, stop
  only the PID from `lsof -ti :2877 -sTCP:LISTEN`, start `node --env-file-if-exists=.env dist/main.js` from `apps/api`. **`nx serve api` does not rebuild.**
- Leave dev servers up unless `top -l 1 -n 0 | grep PhysMem` / `sysctl vm.swapusage` show real pressure. Never `pkill`.
- One browser at a time, one pass per UI phase, closed afterwards.

## Phase gate (every phase, before it is called done)

1. API and web tests pass; API and web typecheck clean; `pnpm nx lint web` adds no errors over the current baseline.
2. API rebuilt and restarted; every new behaviour probed live, MySQL read after each write, including refused writes.
3. UI phases: one browser pass at three widths.
4. `docs/VERIFICATION-<date>-phase-NN.md` lists each probe and its result, and what was not verified.
5. Commits made; decisions recorded; the phase's demo-seed chapter updated (Phase 3 onward).

---

## Phases

Estimates are work hours including tests and live verification. Lanes run in
parallel where they touch disjoint files.

| # | Phase | Est. | Depends on | Lane |
|---|---|---|---|---|
| 1 | Access foundation (API) | 20 h | — | A |
| 2 | Farm-specific breeds and batch modes | 12 h | 1 | A |
| 3 | Demo data rebuild (seed rewrite) | 12 h (+2 h per later chapter) | 1, 2 schema | C |
| 4 | Quick fixes | 12 h | — | B |
| 5 | Farm context in the web | 5 h | 1 | B |
| 6 | Daily Data Entry MVP core | 20 h | 1, 2, 5 | A |
| 7 | Transfers | 20 h | 2, 6 | A |
| 8 | Breeding history and traceability | 7 h | 2 | B |
| 9 | Requisition MVP | 10 h | 1 | B |
| 10 | Feed Forecast MVP | 9 h | 2 | C |
| 11 | Resource Ledger MVP | 7 h | 6 | C |
| 12 | Demo checkpoint: freeze, rebuild, full pass, rehearsal | 8 h | all reached | lead |
| 13 | MVP completion after the checkpoint | 40–50 h | 12 | all |

### Phase 1 — Access foundation (API) · 20 h
Detailed plan: `2026-09-14-phase-01-access-foundation.md`.
- Migration: `user_master.farm_id` (a standard user's one farm), `batch_header.farm_id` (a batch's farm).
- Guard: operational-area header mandatory for OPERATIONAL_ADMIN and STANDARD_USER on operational routes (400); resolve the active farm — a standard user's assigned farm; for admins the optional `x-active-farm-id` header, validated as an active top-level location of the active company; none = all farms in scope. Store in CLS.
- `common/farm-scope.ts`: conditions "location / batch / animal / warehouse is on the active farm"; ledger rows without a warehouse through their batch; approvals without a batch or location visible to admins only.
- Apply to batches, schedulers, daily entry, animals, breeding, goods receipt/issue, stock adjustment/transfer, inventory ledger and balance, approvals, batch transfers: lists filtered, read-by-id 404, creates validated (403).
- `@FarmScoped()` marker plus a coverage spec that fails when an operational controller lacks it.
- Operator permission remap: close, dispose, split, merge, cancel, fair value, amortise, mature and transfer-stage require `approve`, not `edit`; bulk daily entry and batch transactions go through the entry rules.
- Remove the backlog gate from `entry-window.ts` / `batch-daily-data.service.ts`.
- **Acceptance:** access spec §2, §3, §3.1 and §12 bullets 1, 3, 4 (farm/batch parts); live proof with a Grasmere worker, a Kintyre worker, an operational admin and a company admin (users created by the Phase 3 seed, or by a labelled probe script if Phase 3 is not yet in).

### Phase 2 — Farm-specific breeds and batch modes · 12 h
- Breed Master: farm (top-level Location) required; uniqueness Farm + Breed Code; Breed Code = normalised name with spaces → `_`; list, filter and selector show Location code and name.
- Animal: breed required; its batch and location must be on the breed's farm (403 otherwise).
- Batch: farm required at create; its location on that farm; `animal_tracking` (Registered Animals / Count Only) in the create DTO and form, enforced — Count Only has no Animal rows and one Stage; stage counts come from active animals, never opening quantity.
- **Acceptance:** access spec §4 and §12 Breed/Batch/Animal bullets; data-entry spec §4.

### Phase 3 — Demo data rebuild · 12 h, plus one chapter per later phase
- A single registered command rebuilds NAVFarm's databases from empty: `db-bootstrap` → dev tenant → Triple C master templates (MULTIPLIER and PORTA locations, breeds per farm, resources, activities) → demo chapters.
- **Demo chapters post through the services** via a Nest application context — no raw inserts for batches, animals, receipts, issues, transfers, adjustments, daily entries, breeding or approvals.
- Content: Grasmere and Kintyre; users per role (tenant, company and operational admin; one Grasmere worker; one Kintyre worker); a Registered batch across two stages and a Count Only batch per farm; schedulers; about two weeks of posted daily entries with a few deliberately missing; receipts, issues, one adjustment, one stock transfer; complete breeding cycles; pending approvals. Each later phase adds its chapter (transfers, requisitions, forecast, resource postings).
- Idempotent: refuses to run against a database holding non-demo operational rows unless `--drop` is passed; prints what it created.
- **Acceptance:** full rebuild runs clean; every login works; every screen in the demo script shows data; MySQL shows ledger/journal rows linked to their source documents (`batch_transaction.ledger_id` populated).

### Phase 4 — Quick fixes · 12 h
- Scheduler: header and lines in one transaction; `DELETE /scheduler-header/:id` for unused schedulers; `MONTHLY` and `CUSTOM` due-date rules; create one through the UI.
- Login screen: "Forgot password" reworded to contact the administrator; MFA controls hidden.
- Masters: sort and filter honoured on UOM Conversions and Breed Lifecycle Stages; Indian placeholders removed (`GSTIN…`, `+91…`, "Pincode").
- Goods receipt: draft editable from the panel; inactive warehouses refused.
- Inventory ledger: reversal rows stamped in the same time base as other rows.
- Inventory journal: positive adjustment posted and verified.
- Gestation 114 → 116 days; GILT → SOW on first farrowing (moves here from Phase 8 because both are one-line, independent fixes).

### Phase 5 — Farm context in the web · 5 h
- `api-client` sends `x-active-farm-id` for admins; the switcher shows a standard user's farm as a fixed label and gives admins a farm picker with an "All farms" choice for viewing.
- Data-entry screens show "Recording for: <farm>"; entry always has an explicit farm (spec §3).

### Phase 6 — Daily Data Entry MVP core · 20 h
- Stage overview and selected-Stage workspace; Activity parent cards grouped by line type with one sub-card per due Scheduler line; History rail with Complete / In progress / Missing summaries.
- Drafts persisted (new table, versioned, no side effects), individual Post, atomic "Post completed sub-cards".
- Targeting: Registered — whole Stage by default, selected animals where allowed; Count Only — whole Batch only, individual selection refused by the API.
- Missing state derived for History; same-day standard-user correction; direct admin correction for consumption lines (already reversible).
- **Acceptance:** data-entry spec §16 criteria 1–8, 21–25.

### Phase 7 — Transfers · 20 h
- One transfer engine: Stage-only, location-only, both, and farm-to-farm; Registered single/selected/Stage/whole; Count Only whole.
- Approval matrix per spec §11 with the approvers decided on 14 September.
- Count Only partial transfer into a new child batch with proportional carrying value (§12).
- Farm-to-farm breed-profile matching and the `DRAFT_BLOCKED` / `BREED_PROFILE_REQUIRED` resume flow (§13).
- **Acceptance:** criteria 12–18, 28.

### Phase 8 — Breeding history and traceability · 7 h
- Farrowing resolves and closes the sow's open breeding record (`breeding_id` populated); sire and dam shown on the animal timeline; the "Traceability" sidebar item opens the animal chain, not the QR-pack list; the transfer order appears on the timeline.
- **Acceptance:** one sow walked service → scan → farrow → wean on screen with each step linked in MySQL.

### Phase 9 — Requisition MVP · 10 h
- First step: extract requisition fields from the TDD tracker and BBP; any field without a document behind it is labelled as ours and listed for Rishi.
- First-class requisition header and lines for a farm; submit → approval (admins) → approved/rejected in one transaction; approval links to the requisition, not free text.
- **Acceptance:** create, submit, approve and reject through the web, rows correct in MySQL, farm scope enforced.

### Phase 10 — Feed Forecast MVP · 9 h
- Fix the performance curve: filter lifecycle standards by the batch's stage and scope; compare standard and actual over the same window.
- BBP §7.2 forecast per farm: head count × feed rate × 7 days, including `feed_wastage_pct`, against on-hand silo stock, showing shortfall.
- **Acceptance:** forecast figures reproduced by hand from MySQL for one farm.

### Phase 11 — Resource Ledger MVP · 7 h
- Resource ledger table; posting from `RESOURCE` scheduler lines through daily entry; usage and cost list per farm and batch.
- **Acceptance:** a posted resource line appears in the ledger with its rate and amount; resources without a cost rate are refused with a clear message.

### Phase 12 — Demo checkpoint · 8 h
- Code freeze Thursday 17 September 22:00 IST. Full rebuild from seeds, full verification pass across every reached phase, demo script walked once end to end. Friday until 10:00: rehearsal only, no code.
- **Demo-ready line:** Phases 1–6, 7's same-farm transfers and approval matrix, and 8 verified. Phases 9–11 as far as reached, each either verified or absent from the demo script — never shown half-done.

### Phase 13 — MVP completion after the checkpoint · 40–50 h
Continue in this order until every spec acceptance criterion is met:
1. Remaining Phase 7 and 9–11 work.
2. Corrections for output, overhead, resource and transfer lines (supersede, reverse, replace).
3. Past-date correction requests with one-time unlock and automatic relock (spec §9).
4. Missing-entry notification job, idempotent, with recipients and read state (§8).
5. Unscheduled activities including the health-event screen (§7).
6. Master interaction system: page shell, anchored selector, full-list dialog, dialog exit rules, two-level navigation, fixed table footer — Breed and Location first, then Batch and Animal, then every remaining master (access spec §5–§11).
7. Role-filtered sidebar consistent with the API.

### Beyond MVP (not in this plan)
Login rate limiting, immediate logout revocation, the app-wide UTC timestamp
writer, weighted-average / standard / bio-asset valuation, lots on stock issues,
batch close and variance proof, D365BC handoff, and everything awaiting Triple C
(reason codes, kill sheet and DOA, piglet lot entity, exchange rates, resource cost
rates, activity defaults).

## Schedule to the checkpoint

| When | Lane A | Lane B | Lane C |
|---|---|---|---|
| Mon 14 evening | Phase 1 detailed plan | — | — |
| Tue 15 | Phase 1 | Phase 4 | Phase 3 harness, masters and users chapters |
| Wed 16 | Phase 2 → start 6 | Phase 5 → 8 | Phase 3 operational chapters; first full rebuild |
| Thu 17 | Phase 6 → 7 same-farm | Phase 9 | Phases 10 → 11; 22:00 freeze → Phase 12 |
| Fri 18 until 10:00 | rehearsal | | |

If work runs ahead, pull the next phase forward in table order; if behind, the
demo-ready line above decides what is shown.
