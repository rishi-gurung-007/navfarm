# Handoff — Feed TDD alignment and in-house mill (started 2026-10-03)

Read this first if you are picking up feed work. It supersedes the "next action" of
`docs/superpowers/handoffs/2026-10-01-feed-forecast-requisition-handoff.md`.

## Where the work is

- **Worktree:** `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`
- **Branch:** `feat/feed-forecast-requisition-integration` (not merged into `main`; do not merge or push without Rishi).
- **Source of truth for feed:** `NAVFarm_Feed forecast TDD with examples (1).xlsx` (copy in the main
  checkout root), per Rishi's 3 Oct rulings in `docs/decisions.md` ("2026-10-03 — Feed TDD workbook governs feed").
- **Spec:** `docs/superpowers/specs/2026-10-03-feed-tdd-alignment-and-inhouse-mill-design.md`
- **Plan (roadmap + Part A):** `docs/superpowers/plans/2026-10-03-feed-tdd-alignment.md`
- **Progress ledger:** `.superpowers/sdd/2026-10-03-feed-tdd-alignment/progress.md` inside the worktree
  (git-ignored). Every `Task N: complete` line is done — never redo it. Every `Ruling:` line is a
  decision taken on Rishi's behalf; carry it forward.

## How to resume

1. `cd` into the worktree; `git log --oneline -15`; read the ledger.
2. Resume at the first Part A task without a `complete` line, using
   `superpowers:subagent-driven-development` (Rishi asked for subagents on 3 Oct) with the same
   ledger. A task with a fix-round line but no complete line is mid-review: resume its loop.
3. After Part A's Task 10, write the Part E plan, then B, C, D (order in the plan's roadmap).

## Rules that keep the app working at every stop (Rishi, 3 Oct)

- Commit only green states: API typecheck 0 errors and the touched suites passing.
- Database changes are additive. **No column is dropped until the branch is merged into main**
  (the main checkout still runs against `nf_devco`). The feed-era column drop is the last step.
- A new screen appears in navigation only when its part is complete.
- Local databases only: `nf_devco`, `nf_system` (both on 127.0.0.1). Never the test server.
- Jest with `--maxWorkers=2` (8 GB machine). Never `pkill`; stop a server by PID from `lsof -ti :PORT`.

## Database state (3 Oct)

- Both local tenants at 143 journal rows (through `0142_reconcile_feed_stock_count`).
- `nf_devco` had 0135–0138 objects from an earlier schema push without constraints/journal; they
  were completed and journalled. Backups before that: the session scratchpad
  (`nf_devco-before-0135.sql`, `nf_system-before-0135.sql`) — temporary, not in the repo.
- 0142 fixed a real defect in 0137: a freshly migrated tenant could not save a stock count.
