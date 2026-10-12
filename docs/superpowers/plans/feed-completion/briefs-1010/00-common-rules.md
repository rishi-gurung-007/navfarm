# Rules for every builder (10 Oct, unbuilt pages)

- Code tree and branch are named in your dispatch. Never push or merge. Never use `git add -A`. Commit explicit paths,
  with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- ALWAYS prefix nx/jest/tsc with `env -u NX_WORKSPACE_ROOT_PATH`. Without it every nx task runs in /Users/nero/Desktop/navfarm.
- The workbook is the spec: `docs/superpowers/plans/feed-completion/workbook-fields.md`. Cite rows.
  Rishi's rulings are in `docs/decisions.md`, and the newest entry wins. Example values in the workbook are examples,
  not client data: demo rows are labelled "(illustrative)".
- In-house only: no Business Central calls. Where the workbook says BC, build the NAVFarm step.
- Test-first. Jest with `--maxWorkers=2` (8 GB machine). API typecheck: `npx tsc --noEmit -p tsconfig.app.json`.
  Web typecheck: `../../node_modules/.bin/tsc --noEmit -p tsconfig.json`. No new eslint errors.
- Migrations go in `apps/api/src/drizzle/tenant`. Add a journal entry with the idx/tag/when given in your dispatch.
  Additive only. Add a contract spec like `wp1c-migrations.spec.ts`. A schema column must come from a migration:
  `schema-migration-drift.spec.ts` enforces this.
- UI: master pages use the master-data registry `apps/web/src/modules/master-data/configs.ts` where they can.
  Strings go in the `en` dictionary only. Action results use `showToast` from `@/components/ui/toast`.
  Field hints and gate explanations stay inline.
- Never write a second copy of a rule. Grep first and reuse.
- Live proof: the local API on :2877 and web on :3002 run from /Users/nero/Desktop/navfarm-final-uat against nf_devco
  (127.0.0.1, root, no password). Log in only through POST /api/v1/auth/login, with users from
  apps/api/src/scripts/seed-dev-tenant.ts. Never print passwords and never mint tokens.
  To rebuild the API: `env -u NX_WORKSPACE_ROOT_PATH NX_DAEMON=false npx nx build api --skip-nx-cache` in that tree.
  Check that dist/main.js is fresh. Stop the API by the PID from `lsof -ti :2877 -sTCP:LISTEN` (never pkill) and
  restart it with the same command and env (see the log under the scratchpad, api.log).
- If the workbook and the decisions don't answer something, STOP and report the question. Do not guess.
