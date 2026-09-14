# Internal Review Execution Plan

> **Review gate:** 2026-09-15 20:00 IST  
> **MVP checkpoint:** 2026-09-18 10:00 IST  
> **Design:** `../specs/2026-09-15-internal-review-mvp-cut-design.md`

## Goal

Deliver a coherent piggery review path which behaves normally and does not leak
scope, invent client facts, or leave accounting half-posted. Work not verified
before the meeting is documented and kept out of the review script.

## Machine and collaboration rules

- Maximum three editing agents in addition to the lead only when memory permits.
- Agents may inspect and edit their assigned files and add focused tests. They
  do not run Nx, builds, servers, database writes, or commits.
- The lead integrates, reviews diffs, runs all verification serially, drives the
  browser, checks MySQL, and commits.
- Keep the web server on 3002 and API on 2877 running. Stop only an exact PID
  confirmed with `lsof` if a restart is required. Never use `pkill`.
- Use `NODE_OPTIONS=--max-old-space-size=1024`, Jest `--runInBand`, and
  `--watchman=false` for verification.
- Preserve unrelated working-tree changes, especially generated
  `apps/web/next-env.d.ts`.

## Priority and cut line

P0 work is required before any path is represented as safe. P1 creates the
minimum coherent farm/Batch foundation. P2 makes the result presentable. If the
clock requires a cut, stop at the last completely verified priority.

## Task 1 — P0 financial-report scope

**Owner:** Agent A  
**Files:**

- `apps/api/src/app/reporting/financial-reports.service.ts`
- its existing focused spec file(s)

**Changes:**

1. Add exact active LOB restriction to bio-asset roll-forward ledger queries.
2. Reconcile a farm/LOB-filtered ledger only against a GL total with the same
   dimensions, or clearly omit reconciliation when the schema cannot express
   an equivalent scope.
3. Add discriminating tests for another LOB on the same farm and for an
   operational admin without an active farm.

**Gate:** focused API spec passes; lead reviews generated SQL conditions.

## Task 2 — P0 animal placement containment

**Owner:** Agent B  
**Files:**

- `apps/api/src/app/livestock/animal/animal.service.ts`
- its existing focused spec file(s)

**Changes:**

1. Prevent ordinary animal update and stage-transition routes from changing
   farm, Batch, or location in ways reserved for the transfer engine.
2. Refuse null/unplaced animals and mismatched Batch/location farms before any
   write.
3. Scope Breed and Stage references exactly to tenant, company, LOB, active
   farm, and Batch as required.
4. Add tests for null placement, cross-farm movement, Batch/location mismatch,
   Count Only destination, and cross-LOB secondary references.

**Gate:** refused calls leave the animal and Batch counts unchanged in MySQL.

## Task 3 — P0 transfer integrity

**Owner:** Agent C  
**Files:**

- `apps/api/src/app/livestock/batch-transfer/batch-transfer.service.ts`
- its existing focused spec file(s)

**Changes:**

1. Validate split destination location against company, LOB, active farm and
   the child's persisted farm.
2. Recheck and claim Registered animals inside the posting transaction with a
   source-Batch predicate so two drafts cannot post the same animal.
3. Reject and roll back when required transfer accounting item/ledger legs
   cannot be produced.
4. Add tests for unauthorized split destination, two transfers sharing one
   animal, and missing accounting prerequisites.
5. Do not claim cross-farm transfer complete; the destination Breed-profile
   matching workflow remains a later, explicit task.

**Gate:** focused specs pass and a same-farm transfer is checked in MySQL.

## Task 4 — P1 revise and implement the minimum Phase 2 foundation

**Owner:** Lead after integrating Tasks 1–3, with a fresh agent only for a
non-overlapping UI slice.  
**Source plan:** `2026-09-15-phase-02-farm-breeds-and-batch-modes.md`, corrected
by the audit findings below before execution.

**Required corrections:**

1. Apply `@FarmScoped()` and active-farm read/write enforcement to Breed.
2. Make Breed preview and save use the same BREED Number Series path.
3. Require every operational Breed used by a Batch/Animal to have
   `breed.location_id === batch.farm_id`; tenant templates cannot be placed.
4. Validate Farm as an active, top-level `FARM` belonging to the active company.
5. Validate every supplied Batch placement reference, not `location_id ||
   shed_id`.
6. Require explicit tracking-mode selection and initial Stage.
7. Count Only creates no Animal rows and occupies one Stage.
8. Registered batch creation does not call the helper which invents sex, type,
   or value. Explicit Animal registration supplies those facts.
9. Audit existing Batch/Breed rows before applying schema or seed assumptions.

**Gate:** focused Breed/Batch/Animal specs, API typecheck, and browser preview =
saved Breed code.

## Task 5 — P2 deterministic review data

**Owner:** Lead  
**Files:** existing registered scripts under `apps/api/src/scripts/` and Nx
target configuration only.

1. Reuse the project's read-only/`--verify`/`--apply` script convention.
2. Use explicit, clearly labelled demo animal data; do not derive unknown client
   facts.
3. Produce one Registered Animals and one Count Only Batch on the chosen review
   farm through application services.
4. Print a reviewable plan; refuse non-demo operational data.
5. Run `--verify`, inspect the plan, then `--apply`; query MySQL after writes.

**Gate:** rebuild or additive review seed is deterministic and its review rows
are visible through the scoped API and web.

## Task 6 — P2 presentation and handoff

**Owner:** Lead

1. Drive the review path in the browser at port 3002.
2. Verify API writes and refusals in MySQL.
3. Include daily entry, same-farm transfer, or breeding only if each path passes
   its focused test and live check.
4. Prepare `docs/handoffs/2026-09-15-2000-internal-review.md` with:
   - exact HEAD and commits;
   - demonstrated path and accounts/farm without passwords;
   - commands and results;
   - database evidence summary;
   - deferred and unsafe paths;
   - next ordered tasks to the 18 September checkpoint.

## Serial verification checklist

Run from the workspace root, one command at a time:

```bash
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test api -- --runInBand --watchman=false
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test web -- --runInBand --watchman=false
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx run-many -t typecheck -p api web web-e2e --parallel=1
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx build api --configuration=development
```

Record exact results. Existing web lint has an accepted baseline; if run, gate
on no new errors rather than zero errors.

## Explicitly deferred from the 20:00 promise

- Cross-farm transfer and destination Breed-profile creation/resume.
- Requisitions, feed forecast, and resource ledger.
- Broad lifecycle transaction refactoring not needed by the chosen review path;
  affected actions must not be demonstrated until made atomic.
- Phase 13 hardening and the full master-interaction redesign.
