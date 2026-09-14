# NAVFarm continuation handoff — 14 September 2026

Read this file in full, then `AGENTS.md`, `docs/decisions.md`, and the original
`docs/HANDOFF-2026-09-14.md` before planning or writing code. This continuation
supersedes the original handoff's completion status, not its client scope.

## Start here

Rishi asked to prepare this handoff for another agent. No new implementation
phase was started after the dialog work. The next useful independent task is
**item 1: audit login and role behavior by driving the app/API**. Do not repeat
F1–F6 as if they were still untouched. They have commits and live evidence.

**Item 2 is decided (14 Sep, Rishi): farm scope restricts operational data
entry and viewing only, NOT master data.** Do not add a farm dimension to
`masterScopeConditions`. See `docs/decisions.md`, "Farm scope restricts data entry
and viewing, not master data". Whether MULTIPLIER and PORTA replace FARM-001 is
still unresolved. Other client decisions remain in AGENTS and the original
handoff; do not settle them silently.

Rishi wants working phases, actual app verification, and backend work too.
He explicitly requested subagents to help with server-side work and reduce
local load. Agents were used for bounded backend review/fixes and UI changes;
that does not move MySQL, browsers or builds off this Mac. Keep those local
jobs serial. Do not create a separate user-owned task unless requested.

## Repository and completed commits

Workspace `/Users/nero/Desktop/navfarm`, branch `neroen`. Tracked working tree
was clean before writing this handoff. Latest implementation HEAD `7eeed75`.
No push was performed in these phases.

| Commit | Completed change |
|---|---|
| `727e30e` | F1: omitted GL dimensions impose no constraint; removed seed over-pins and repaired existing company mappings through verify/apply script. |
| `02f45fd` | F2: FIFO refuses shortages; no fabricated opening stock. FIFO also filters company. |
| `27d5a2b` | F3: stock, GL, source and audit posting share transactions. Consumption corrections reverse original layers/cost and repost; identical retries do not duplicate. Includes review fixes for reversal cost and lot forwarding. |
| `a8e795f` | F5: generic health approval dispatches stock/cost posting atomically; repeat decisions and shortage failures cannot leave false approval. |
| `37f449c` | Recovered stale-session redirect loop so expired saved sessions can reach login. This is not a complete auth/role audit. |
| `bff20d3` | F6: explicit medicine/vaccine and stock quantity/unit; reject arbitrary fallback; batch treatments participate in animal withdrawal/slaughter checks. |
| `7eeed75` | Shared responsive form-dialog frame, pinned actions, grouped treatment fields; company/user creation moved from drawers; removed fictional user placeholders. |

## Verification already performed — read the evidence, not only this summary

Read both reports in full:

- `docs/VERIFICATION-2026-09-14-foundation.md`
- `docs/VERIFICATION-2026-09-14-health.md`

F4's five documents were actually posted through the rebuilt API, with MySQL
checked after each write: GR-000003, GI-000002, TR-000002, ADJ-000002 and batch
consumption. Additional live checks covered daily 4.6→5 correction, exact retry,
failed lot correction, multi-line shortage rollback, no-context overhead,
generic health approval success/retry/shortage, and selected-vaccine treatment.

The successful vaccine treatment was entered through the browser, read back
from MySQL, retained after reload, and caused slaughter refusal. The animal
remained active/PREGNANT without disposal. Diagnostic withdrawal is not a real
clinical prescription. Exact UUIDs, amounts, lots and SQL are in the reports.

**Diagnostic records remain intentionally for inspection.** Do not reseed or
silently delete them. All new fixtures are labelled DEMO VERIFICATION, reuse
existing identities, and are not Triple C operational facts. Examples:
GI-000003 is a failed-post DRAFT; HLT-UNS-2026-0003 is a shortage PENDING request;
SOW-LW-018 has the diagnostic vaccine treatment. Original clinical seed rows
were not comprehensively repaired. Last recorded posting counts after F6 were
19 ledger / 11 applications / 19 journals / 38 journal lines / 314 batch
transactions; these are historical observations, not freshly queried here.

Latest completed checks: API 623 tests/61 suites, web 156 tests/24 suites;
API/web typechecks pass. API build passes with the existing Express dynamic
require warning. Web lint last measured 79 errors/671 warnings versus the
85-error baseline. No full web production build or deployment was verified.
Do not call tests proof of the write path; the reports contain that proof.

## Dialog decision and browser state

Rishi asked all dialogs with fields to share width/height, mentioning BC and
authorizing a better design. Implemented one shared frame: maximum 1120×768
CSS pixels; desktop viewport margins 24px; full screen below 640px. Header and
footer remain fixed while fields scroll. Compact presentation is explicit for
short confirmations. This overrides the old field-count-dependent sizing and
creation-drawer guidance. `maxWidth` remains accepted for compatibility but
only controls compact presentation; `page` shares the standard frame.

Actual measured treatment and user form rectangles at viewport 1280×800 were
1120×752 at (80,24). Treatment also checked at 834×1112 and 480×844 without
horizontal overflow. Scrolling reached veterinarian while actions stayed
visible. Escape from Invite User restored trigger focus; Escape from the
medicine picker closed only that picker and restored treatment-item focus.
Not every form was opened, company submission was not exercised, and 390px
was not verified (the in-app viewport clamped to 480 CSS pixels).

Last browser state: two in-app tabs; tab 2 on `/livestock/health`, logged in as
Company Administrator, treatment form open, no new diagnostic write from the
UI-only phase. The tab was marked deliverable. Rediscover browser IDs rather
than assuming old JavaScript bindings survive agent handoff.

Viewport tooling on this Retina setup doubled requested dimensions: requesting
640×400 yielded DOM clientWidth/clientHeight 1280×800. Measure the DOM viewport
instead of claiming the tool's requested size was honored. Screenshots also
contained extra white canvas. Do not infer layout from image dimensions alone.

`apple.design.md` is locally present but gitignored. Its dialog guidance was
updated locally; that file was not included in the commit. The tracked,
portable decision is in `docs/decisions.md`.

## Remaining work in working phases

These are backlog items from the original handoff, not newly verified absence
claims. Audit each area before coding and search fragments/concepts as well as
exact names; report spellings used before declaring a feature missing.

1. **Logins/access:** audit each role and workspace transition. Farm access is
   now decided (data entry and viewing only, not masters) and can be designed.
2. **Scheduler:** transactional/recoverable creation, then make one through UI
   and read MySQL. Original orphan-header/retry concern remains unaddressed.
3. **Batch creation:** expose REGISTERED/COUNT_ONLY end to end; reconcile
   register/scheduler/opening headcounts. Do not invent animals or identities.
4. **Daily entry:** drive remaining branches. Consumption corrections work;
   posted OUTPUT/OVERHEAD/RESOURCE/TRANSFER corrections needing their own
   reversal now refuse with 409. Their correction workflows remain unfinished.
5. **Masters and inventory hardening:** re-audit sort/filter/total contracts,
   exchange rates and remaining placeholders. Inactive warehouse acceptance
   and warehouse-filtered history omitting company-wide batch issues remain
   known gaps. Positive adjustment and all valuation methods not exercised.
6. **Remaining client scope:** requisition, feed forecast, resource ledger,
   linked animal BREEDING history, inventory-ledger completion. Do not silently
   drop these or treat the original absence audit as a current code search.
7. Original gestation 114→116 concern and other scope findings have not been
   claimed repaired in these phases. Consult recorded decisions and re-audit.

Remaining technical verification includes batch closing/variance, biological
costing and reversal, concurrent-request stress, standalone medication-log
concurrency, batch approval withdrawal for all animals, expiry-boundary
disposal, all-role UI permissions, all forms and production deployment.
Approval requests still store medicine names rather than item UUIDs; renamed,
ambiguous or unit-changed requests refuse. This schema was not redesigned.

## Servers, memory and commands

8 GB machine shared with Rishi's Brave. Leave servers up unless pressure is
actually red. Never pkill, never stop MySQL, never touch/drop navcrm databases.
Check `top -l 1 -n 0`, `sysctl vm.swapusage` and optionally `memory_pressure`.
Last check before handoff: 41% system-wide free according to memory_pressure,
about 3 GB swap used. Do not assume this remains current.

API :2877 last confirmed listener PID 14863; web :3002 last PID 12966. These
are clues only: confirm fresh listening PIDs with lsof before stopping any.
API runs the compiled bundle directly, not nx serve. Web hot-reloads.
Logs `/tmp/api.log`, `/tmp/navfarm-web.log`. Redirect logs so a disconnected
PTY cannot reproduce the frontend EPIPE loop encountered earlier.

After API edits, serially build then stop only the confirmed API listener and
start the new bundle. **nx serve api does not rebuild on source changes.**

```bash
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx build api --configuration=development
lsof -ti :2877 -sTCP:LISTEN
# kill only the PID just confirmed above; then from apps/api:
NODE_OPTIONS=--max-old-space-size=1024 node --env-file-if-exists=.env dist/main.js > /tmp/api.log 2>&1
```

Only if frontend restart is needed/authorized, from the repo:

```bash
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx dev web --port=3002 > /tmp/navfarm-web.log 2>&1
```

Tests serially, no parallel local heavy jobs:

```bash
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test api --runInBand --watchman=false
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test web --runInBand --watchman=false
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx typecheck api
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx typecheck web
```

The original handoff §8 contains existing demo login credentials, all four
scope headers, batch UUID and API examples. Database is `tenant_devco`, read
with `mysql -u root tenant_devco -e "..."`. Check MySQL after every write,
including failed writes. Master scope matching is exact. Use the Nx skills
for workspace/tasks and registered read-only/verify/apply scripts for repairs.

Commit as working phases complete, record decisions, and report separately:
what changed, what was driven and persisted, what was not verified, what remains.
