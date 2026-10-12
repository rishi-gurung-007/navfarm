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

