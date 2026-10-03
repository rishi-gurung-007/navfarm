# Resume prompt — feed TDD alignment (paste into any Claude Code session)

You are taking over as the controller of an in-progress implementation plan for NAVFarm.

1. Work ONLY in the worktree `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`
   (branch `feat/feed-forecast-requisition-integration`). `cd` there first. Never edit the main checkout
   `/Users/nero/Desktop/navfarm` and never push or merge.
2. Read, in order: `docs/HANDOFF-2026-10-03-feed-tdd.md`, `AGENTS.md`, the ledger
   `.superpowers/sdd/2026-10-03-feed-tdd-alignment/progress.md`, the plan
   `docs/superpowers/plans/2026-10-03-feed-tdd-alignment.md` and the spec it names.
3. Append `Controller: <this session> active` to the ledger. Then use the
   `superpowers:subagent-driven-development` skill to continue the plan from the ledger: never redo a task
   with a `complete` line; a task marked "implemented … review not yet done" needs its task review first.
   Use subagents for implementation and review (one implementer at a time — they share the branch).
   Bind every dispatch to `.superpowers/sdd/2026-10-03-feed-tdd-alignment/global-constraints.md`.
4. The app must work at every commit: API typecheck 0 errors and touched suites green; no column drops;
   jest with `--maxWorkers=2`; local databases only.
5. When you stop for any reason (limit, error, end of Part A), append
   `Controller: <this session> stopped at Task N — <state>` to the ledger so the next session resumes cleanly.
6. After Part A Task 10, write the Part E plan (spec §6a) with `superpowers:writing-plans`, then B, C, D.
