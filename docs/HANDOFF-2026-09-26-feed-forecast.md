# Feed Forecast — overnight handoff (26 Sep 2026)

Rishi asked (25 Sep, night) for Feed Forecast to be finished autonomously, with
subagents, for review at 10 am. This is where it stands. Nothing from Feed
Forecast is on `main` or on the test server yet: `main` only has the fixes
shipped on 25 Sep (roles, operational areas, chunk reload, currency envelope,
Create button on a fresh tenant).

## Branches

| Branch | What | State |
|---|---|---|
| `feat/feed-forecast-a` | Plan A: silo↔shed links, one feed per silo, daily entry from the right silo, one feed line per diet row, forecast engine, `GET /feed-forecast`, Inventory → Feed Forecast page, demo seeds, migrations 0114–0116 | **Done, reviewed, live-verified.** Ready to merge to `main` after your review. 28 commits ahead of `main`. |
| `feat/feed-forecast-report` | Plan R (cut from B): the report screen aligned with the 26 Sep field specification — D16–D20; migrations 0120 (lead time default 2) and 0121 (Reporting Period Master) | **Done, reviewed, verified** (`docs/VERIFICATION-2026-09-26-feed-forecast-r.md`). Contains Plans A and B, so it is the one branch to merge. |
| `feat/feed-forecast-b` | Plan B (cut from A): silo low/high levels, alert rules master, in-app feed alerts, feed requisition (draft, decide, screen) — migrations 0117–0119 | **Done, reviewed, live-verified** (`docs/VERIFICATION-2026-09-26-feed-forecast-b.md`). Final whole-branch review: ready to merge after Plan A (fast-forward onto `origin/main` — not the stale local `main`). |

Neither branch is pushed. Ledgers with every finding and ruling:
`.superpowers/sdd/2026-09-25-feed-forecast-a-silo-and-report/progress.md` and
`.superpowers/sdd/2026-09-26-feed-forecast-b-alerts-requisition/progress.md`.

## Plan A — what was proven

- **Migrations on data, the server path.** A copy of `nf_devco` was rolled back to
  the server's state (0113) and migrated with the real migrator: row counts and
  table checksums unchanged apart from the tables meant to change, 54/54
  silo↔shed pairs carried, idempotent. Then the real local tenants (`nf_system`,
  `nf_devco`, `nf_kkp`) were backed up
  (`/Users/nero/Desktop/navfarm-backups/nf-20260925-2311.sql`) and migrated.
- **End to end through the running API** (branch build on port 2899, all 8
  scenarios PASS, each proved in MySQL — `.superpowers/sdd/…-a-…/e2e-report.md`):
  D9 refusals on attach, goods receipt and transfer; a batch placed in a shed gets
  one feed line per diet row from stage day 1; a daily entry drew 16 kg from that
  shed's silo; forecast numbers equal a hand calculation; farm buffer/lead-time
  move the refill dates; a user cannot open another farm, admins can switch.
- **Your decision applied:** feed rows' Period From/To are stage days. Demo seeds
  converted, and migration 0116 converts existing age-based rows (WEANER 28–70 →
  1–43 …) — rows already starting at day 1 are untouched.

## Needs you

1. **Local demo rebuild** — the classifier blocks me from running
   `pnpm nx run api:db-rebuild-demo -- --apply`. After you run it, the check is
   one command:
   `bash .superpowers/sdd/2026-09-25-feed-forecast-a-silo-and-report/verify-after-rebuild.sh`
   (batches in sheds, silo top-ups posted, feed drawn from silos, no negative silo).
   This only affects the local demo; the server does not rebuild.
2. **Merge Plan A to `main`** once you have looked at it, then update the server
   with runbook sections 12 and 13 (`docs/deploy-rdp-windows.md`): stop services,
   back up the `nf_` databases, pull, install, `db-bootstrap` **and**
   `db-migrate-all-tenants` (bootstrap alone does not migrate the tenant
   databases — this was a real gap), check, build, start. No rebuild on the
   server; the testers' data stays.
3. **Plan B's open questions** — the plan runs on these defaults; each is easy to
   change. Full wording in the plan's table
   (`docs/superpowers/plans/2026-09-26-feed-forecast-b-alerts-requisition.md`):
   - Q1 alert recipients are the workbook's FARM_MANAGER / HEAD_OF_FARM roles,
     which no tenant has yet — until they exist (or rules are edited), only
     admins see feed alerts.
   - Q2 one requisition per farm per cycle, next-diet line flagged.
   - Q3 a feed requisition approves in one step from its draft.
   - Q4 per-farm production weekday (default Sunday), deadline the day before.
   - Q5 approving after the deadline needs remarks.
   - Q6 REQ-REMINDER (1 day before, WARNING) + REQ-OVERDUE (on/after, CRITICAL).
   - Q7 an empty silo with a low level set raises a low alert.
   - Q8 low/high levels optional.
   - Q9 silo free capacity not applied to the recommendation.
   - Q10 unknown bulk/bagged: silo = BULK, store = BAGGED.
   - Q11 feed requisitions numbered REQ-FarmCode-YYYY-NNNNN.
   - Q12 in-app only; email refused until built.
   - Q13 (ours) default alert rules are created for a company the first time its
     rules are listed or evaluated, so companies created later get them too.
4. **No scheduler exists in the API.** Date-driven alerts (diet change in 3 days,
   requisition deadline, 4-hour escalation) advance when stock is posted or when
   the Feed Alerts screen is opened (it calls evaluate). A real scheduler is a
   separate decision.

## Found along the way (outside Feed Forecast, not fixed)

- Daily entry stores the lot number but does not use it to choose which stock is
  drawn (`batch-daily-data.service.ts:286-306`).
- The client's gilt/weaner/grower sheets give pig age in weeks; loading the
  client's real feed rows will need the same age → stage-day conversion.
- Registered breeding batches carry one placeholder animal per head as well as
  the real animals; the forecast now counts them correctly, but the scheduler
  still records 116 head for VIL100's breeding batch's later stages.

## Plan B status (final)

Every task was implemented by a subagent and reviewed by a separate one (spec
and quality), with fix rounds until clean. Migrations 0117–0119 are applied to
the local tenant databases.

| # | Task | State | Commits |
|---|---|---|---|
| 1 | Silo low/high levels, farm requisition settings, feed requisition columns (0117) | done, reviewed | 2a0b0f6 |
| 2 | Engine: per-silo sources and diet changes | done, reviewed | 6fc0344, bc9d628 |
| 3 | Requisition rules: rounding, bags, 20 % deviation, Saturday deadline, priority | done, reviewed (numbers hand-checked against the workbook) | 3fbc999 |
| 4 | Forecast service entry points; farm lookup fails closed for every user type | done, security-reviewed | a5c2ec0, 9d59c27 |
| 5 | Alerts and Notifications Master (0118), 5 workbook rules per company | done, reviewed | 4f4494b, 3f8acae |
| 6 | Alert planning: raise, re-arm, escalate, resolve | done, reviewed (state machine hand-traced) | 4d618a9, d0e9fd4 |
| 7 | Feed alerts (0119), evaluated after every stock posting and on demand | done, security-reviewed, stock-adjustment path proved in MySQL | 6c486fd, 049af6b |
| 8 | Feed requisition auto-draft, manual entry, read | done, reviewed, auto-draft proved in MySQL | cf39c4e, 9ffeaca |
| 9 | Approve / reject (own farm only, remarks rules, approval audit) | done, security-reviewed, approval proved in MySQL | a1d3579, af352f8 |
| 10 | Web: Inventory → Feed Requisitions | done, reviewed | 51e5de6, 54c3f66 |
| 11 | Web: Inventory → Feed Alerts | done, reviewed | 534fa30, 8a63b09 |
| 12 | Full check through the running API + MySQL | PASS (one case blocked by demo roles, see verification doc) | f4b7839 |
| — | Final whole-branch review fixes: forecast failure no longer stalls date alerts; tenant-wide low-rule clash; deactivated silo reason | done, re-reviewed | 0796ddb |

Decisions I made overnight that you may want to change (all in the ledger):
- Feed approvals are recorded through a new farm-level approval method, not
  the batch-scoped approval engine (which refused farm-level documents). They
  appear in the generic approvals inbox as history only.
- The generic `/requisition` API stays unmounted, as it was.
- Plan B timestamps are written in UTC like most of the API; the approval module
  keeps its own local-time helper. The project mixes both — one decision needed.
- Farm staff see no feed alerts until the FARM_MANAGER / HEAD_OF_FARM roles
  exist or the rules are edited (Q1).

## Field specification received 26 Sep

`NAVFarm_Feed_Forecast_Report_Field_Specification.docx` (text in
`.superpowers/feed-forecast-sources/field-specification-2026-09-26.txt`) changes
the report screen: one row per batch + item + date, selectable planning date in
the farm time zone, Daily/Weekly/Reporting Period/Custom views, Item No, run-down
to the low level with confirmed incoming, an "indicative" flag, and a current /
next stage block. Recommendations on wastage, days of stock, refill dates and
the Reporting Period Master were given to Rishi; the report-alignment plan is
written after his confirmation. Batch numbering is left as is (Rishi).

## Plan R — report alignment (27 Sep)

Branch `feat/feed-forecast-report` (contains A and B). Spec decisions D16–D20
(`8b1e6b0`); plan `docs/superpowers/plans/2026-09-26-feed-forecast-r-report-alignment.md`;
ledger `.superpowers/sdd/2026-09-26-feed-forecast-r-report-alignment/progress.md`.

- One row per batch + item + date, grouped for Weekly / Reporting Period; the
  Planning Date is selectable (default today in Africa/Harare); Item No;
  DD/MM/YY; stage cards (current / next stage, date of stage change).
- Per Day Intake without wastage; run-down, refill and orders with wastage (D17).
- Days of Stock at silo level, whole days, shared-silo count (D18); labelled
  against Run-Down, which now stops at the silo's low level and counts booked
  (DRAFT) transfers; Date to Refill = run-down − 2, Required On = refill − lead
  time, lead time default now 2 (migration 0120 moved all farms still at 0).
- Reporting Period Master with a "generate July–June" button (migration 0121);
  September 2026 = 30 Aug – 26 Sep. Nothing is seeded — an admin generates a year.
- Requisitions order the forecast's shortfall, dated Required On; System Balance
  and CRITICAL priority read the current ledger, as the low-feed alert does.

Tasks 9–11 were finished by the other session (navfarm-e2) at your instruction;
I re-ran every gate without cache and had the whole branch reviewed by a fresh
reviewer, whose findings are fixed (`3c2e9bf`). Final gates: api 1383, web 258,
typecheck clean, lint at baseline.

Left in nf_devco by the verification: 12 reporting periods (2026/27),
cancelled TR-000014, inactive VERIFY-LONG, REQ-VIL100-2026-00003.
Deferred minors (in the ledger): API English error text shown as-is (Plan A
pattern); raw `<tr>` in the grid header; roles-tab row under the NOTIFICATION
comment.
