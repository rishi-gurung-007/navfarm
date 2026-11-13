# Verification — bio-asset costing, Phase 5 (the due-date scheduler)

**Date:** 20 Oct 2026 · **Plan:** `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md` §2.2 · **Earlier:** Phases 0–3 committed (`e829e1be`); Phase 4 (parts 1–3) uncommitted.
**Method:** migration 0211 applied to both tenants after full backups; the API was driven with the seed tenant admin; the timer was proved by running the API with the scheduler switched
on and the cron set to every minute, and reading `nf_devco` and the API log; the notice was proved in the real browser. Afterwards `nf_devco` was restored from the pre-migration backup and
migrated again (211): it holds the new column and none of the test data. Nothing in this phase is committed.

## 1. What was built

| Piece | What it does | Where |
|---|---|---|
| Due logic (pure) | `duePeriods`: which finished periods a profile owes, oldest first, bounded; what blocks it | `finance/bio-costing/bio-costing.schedule.ts` |
| Scheduler | `BioCostingSchedulerService`: a daily `@Cron`, off unless `BIO_COSTING_SCHEDULER_ENABLED=true` (read when the timer fires); time of day from `BIO_COSTING_SCHEDULER_CRON`, default 02:00 server time (read at load). Walks every active tenant like the feed scheduler; one pass = for each profile with animals, Calculate what is due (and Post, if the profile's `auto_post` is on) | `bio-costing-scheduler.service.ts` |
| Failed runs | A period that cannot be run leaves a `FAILED` run with the reason (migration 0211, `bio_costing_run.error_message`); it claims no period | `bio-costing-run.service.ts` (`recordFailure`) |
| API | `GET /bio-costing/runs/due` (what is owed, waiting or failing) and `POST /bio-costing/runs/run-due` ("Run due now": the same pass, trigger MANUAL, for the active company) | `bio-costing-run.controller.ts` |
| Notice | A "Due for costing" box on the Finance screen: periods due, a run waiting to be posted (click to open it), a period that keeps failing; a **Run due now** button; FAILED runs in the list with their reason | `bio-costing-runs-panel.tsx` |

**Rules (the ones the documents do not give are marked ours).**
- A period is due only once it has finished.
- The first period is the one that holds the profile's effective date [ours]: charging for earlier periods is a backfill the client must ask for (Phase 6), not something a timer does alone.
- After that, the period after the latest posted run; a reversed run counts as not made.
- A run that is Calculated but not posted **blocks its profile** [ours]: the next period's book values would be wrong without it. It waits, and says so.
- A period that has failed **three times** is not retried by the timer [ours]; a person pressing *Run due now* ignores the cap.
- A catch-up is bounded to **three periods a pass** [ours].
- Default [ours]: calculate and leave the run for a person to read and post; post automatically only where the profile says `auto_post`.
- Safe with several API instances: a period is claimed by a unique key, so a second instance's attempt fails and is recorded, not repeated.

## 2. Proof

**API (manual passes), then MySQL.** Profile IMP-F effective 2026-07-01, so July, August and September are owed (October has not finished).

| Step | Result |
|---|---|
| `GET /runs/due`, no run made | `IMP-F due [2026-07, 2026-08, 2026-09]`; 0 runs |
| `POST /runs/run-due` | IMP-F `CALCULATED` BCR-2026-00001 for **2026-07 only**; 1 run, **0 ledger rows with a run id, 16 journals**: it posted nothing |
| again | `BLOCKED WAITING_TO_POST` (BCR-2026-00001); no new run; `GET /runs/due` shows the same |
| a person posts it, then run-due | `CALCULATED` BCR-2026-00002 for 2026-08 |
| a reporting period closed over 30 Sep (created through the API, closed by SQL), run-due three times | three `FAILED` runs for 2026-09, each with "Reporting period … is closed. Nothing dated 2026-09-30 can be posted into a closed period"; none claims a period (`active_key` null) |
| `GET /runs/due` after three failures | `blocked: TOO_MANY_FAILURES, attempts 3` with the last error (the timer's view) |
| fixture removed; a person presses Run due now | `CALCULATED` BCR-2026-00006 for 2026-09: the cap does not stop a human |

**The timer (API run with `BIO_COSTING_SCHEDULER_ENABLED=true` and `BIO_COSTING_SCHEDULER_CRON=*/1 * * * *`, via a temporary launch configuration, reverted).** A second profile LOC-F (fair value, `auto_post` on, effective 2026-07-01) was added; IMP-F still had September Calculated and unposted.
- Before the timer was on: **0** `SCHEDULED` runs, in half an hour of the API running with the default settings.
- At **23:39:00** the timer fired by itself: LOC-F was calculated and **posted for 2026-07, 2026-08 and 2026-09 in one pass** (BCR-2026-00007 to 00009, trigger `SCHEDULED`, no user), each with its journal; their ledger rows net −116.50, the figure Phase 4's fair-value run gave. IMP-F was left alone.
- At 23:40 and 23:41 nothing was added: **3 scheduled runs in all**. The API log reads `tenant devco: IMP-F BLOCKED, LOC-F POSTED`, then `IMP-F BLOCKED`.

**Browser (the real app).** With IMP-F waiting, *Finance > Bio-Asset Costing Runs* shows a "Due for costing" box: "IMP-F: run BCR-2026-00006 for 2026-09 is calculated and waiting to be posted. Nothing further runs until it is posted or reversed."; **Run due now** is disabled (nothing else can run); the list shows the scheduled Posted runs and the Failed ones.

Restore read back: 211 migrations, 0 runs, 0 profiles, ledger max 158, 16 journals, no fixture account, no reporting periods, `.claude/launch.json` reverted.

## 3. Tests

`pnpm nx test api`: **285 suites, 3 640 tests**, all passing (new: 9 due-logic cases, 9 scheduler cases including the timer switch, bounded catch-up, auto-post, waiting, failure recording, the cap and the manual override). `pnpm nx test web`: the new notice cases pass; the same 4 pre-existing suites fail (`reason-master`, `breeding-rules`, `requisitions-hub`, `requisitions-panel`). `api:typecheck` and `web:typecheck` as before (23 spec-file errors; web clean).

## 4. Departures from the plan

1. **The "in-app notice" is the Finance screen, not a row in the alerts inbox.** The existing in-app alerts (`feed_alert`) belong to a farm and a silo, batch or requisition; a costing run belongs to a company. Forcing runs into that table would have meant inventing a farm and a rule for each. The notice is shown where Finance works. If the client wants these in the Alerts inbox, that is a small generic-alert design of its own.
2. **No separate scheduler log table and no "stale RUNNING" reclaim.** A run is made inside one transaction, so there is no half-finished state to reclaim; the failed-run header and the unique period key do the job the feed scheduler's log does.
3. **The timer's catch-up is bounded to three periods a pass**, and only auto-posting profiles go through more than one (a calculate-only profile stops after one, because it then waits to be posted).

## 5. Limits and open items

- The timer is **off by default** and will stay off until `BIO_COSTING_SCHEDULER_ENABLED=true` is set; the repository does not set it anywhere.
- **BC-style alerts from the BBP** (amortisation due, batch not run, useful life completed, fully amortised, residual exceeds carrying value, failed posting): *due*, *not run* (waiting) and *failed* are in the notice; the line-level ones (life completed, fully amortised, residual exceeds book value) are shown as each run's skip reasons, not as alerts of their own.
- **Nothing is mailed** (email is deferred project-wide) and there is no push to a user; someone has to open the screen.
- A profile's blocked state logs one line per tick; with a daily timer that is one a day.
- The per-tenant pass runs one tenant after another; a tenant that is off the database allowlist is skipped with a warning.
