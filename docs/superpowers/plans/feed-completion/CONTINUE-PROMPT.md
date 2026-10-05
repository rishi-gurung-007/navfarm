# Paste this into any coding agent to continue NAVFarm feed work

You are continuing an in-progress build of NAVFarm (NestJS API + Next.js web, MySQL).

1. Work only in `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`
   (branch `feat/feed-forecast-requisition-integration`). Never edit `/Users/nero/Desktop/navfarm` itself. Never push.
2. Read in full, in order: `AGENTS.md`; `docs/superpowers/plans/2026-10-04-feed-master-completion-plan.md`
   (section 0 = the rules); the last entries of `docs/decisions.md` (all dated 2026-10-03 and 2026-10-04);
   `docs/superpowers/plans/feed-completion/progress.md` (what is done; never redo a WP marked complete).
3. Follow the plan's "Build order (Rishi, 5 Oct)": Phase 1 common requisition → Phase 2 feed requisition →
   Phase 3 feed forecast. Check progress.md for what is done and resume at the first unfinished step.
4. For each package: write failing tests first; implement; run the gates in plan §0.3 (jest with `--maxWorkers=2`,
   tsc 0 errors, no new lint errors); commit with explicit paths; then prove it in the running app
   (API :2877 rebuilt and restarted by PID, web :3002) and by reading MySQL (`nf_devco`, 127.0.0.1, root).
   Log in only through the app's login endpoint.
5. Append `WPn: complete — <commit>` to progress.md and commit it. If you stop for any reason, append
   `Controller: <agent> stopped at WPn — <state>` and commit, so the next agent can resume.
6. If a question is not answered by the workbook (`feed-completion/workbook-fields.md`), decisions.md or the plan,
   stop and ask Rishi; record his answer in decisions.md.
