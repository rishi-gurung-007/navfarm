# WP1 report — Tenant/Company admins approve every requisition (theirs and others')

Branch `feat/feed-forecast-requisition-integration`, worked from HEAD `d1b0d3e0` (docs-only widening commit).
Scope widened mid-flight by Rishi (two decisions.md entries, both 4 Oct): first self-approval only, then
"approve or reject **any** requisition in their scope, their own and anyone else's." A third message bounded
it again: the admin exemption is **only** approval authority over requisitions — nothing else (not department
checks, not scope, not the document's own checks). This report covers the widened scope as bounded.

## The rule, exactly, as implemented

`SELF_APPROVAL_EXEMPT_USER_TYPES = ['TENANT_ADMIN', 'COMPANY_ADMIN']` (requisition.rules.ts) — the one source
of truth, two predicates over it:
- `maySelfApprove(userType)` — may this type approve its own requisition.
- `mayDecideAnyRequisition(userType)` — may this type decide a requisition it is not the farm's own approver
  for (same allow-list; separate name because the two call sites ask different questions).

`SYSTEM_ADMIN` is **not** in the list — still refused on both counts, by design, tested explicitly.

## What was relaxed, and what was deliberately left in force

**Relaxed (exactly two things, for exactly the two named types):**
1. Self-approval refusal, at the three enforcement points below.
2. The active-farm narrowing in the approval engine's `farmConditions()` (and the common requisition's own
   `scopeConditions()` for its direct decide endpoint) — bounded to `doc_type IN ('REQUISITION',
   'FEED_REQUISITION')` only, so a `TENANT_ADMIN`/`COMPANY_ADMIN` can see and decide a requisition raised
   by/for a different farm than whichever farm is active in their session.

**Left in force, unchanged, for every user type including admins:**
- The **company boundary**. `restrictedScopeConditions(scope, { companyId: R.company_id })` sits outside the
  OR in `farmConditions()` and is applied unconditionally — the admin-exemption OR branch is just as subject
  to it as every other branch. Proven in `requisition.release.spec.ts` ("a COMPANY_ADMIN's decide() lock query
  keeps the company_id boundary") and `approval.service.spec.ts` (company_id still required in the rendered
  SQL for the admin-exemption branch). A `TENANT_ADMIN` with no company selected is tenant-wide — that is the
  pre-existing rule for that type, not something this change touches.
- **`assertMayDecide` / `userHasPermission`** — untouched. Its admin bypass (`ADMIN_USER_TYPES` =
  `SYSTEM_ADMIN`, `TENANT_ADMIN`, `COMPANY_ADMIN`) is pre-existing, general-purpose code, not added or widened
  by WP1. I did not add a new bypass here.
- **Department checks on Transfer Shipment and Transfer Receipt** — not touched at all; no file under
  `inventory/stock-transfer` was changed. Admins get no new power there.
- **The document's own checks** — remarks-required-on-deviation (feed `approvalProblems`), rejection-reason
  required, capacity/exception checks, the submission deadline. None of these were relaxed; they still run for
  an admin exactly as before. The live check's own feed requisition line matched an existing silo's resident
  item specifically so these unrelated checks would not fire and mask the self-approval result.
- **SYSTEM_ADMIN** — stays refused on both self-approval and the farm-scope widening (tests below), per
  decisions.md: "treat it like Tenant Admin only if Rishi confirms."

## The three self-approval enforcement points — what was done to each

1. `requisition.service.ts:683` (`decide()`, common, direct `/requisition/:id/approve`) — gated the existing
   `isSelfApproval(row, userId)` call with `!maySelfApprove(userPayload?.userType)`.
2. `requisition.service.ts:946` (`decideFromApproval`, common, the registered handler reached from
   `/approval/:id/approve`) — same gate, same helper, added to the existing check.
3. `feed-requisition.service.ts:1327` (`decideFromApproval`, feed, inline — **not** the shared `isSelfApproval`)
   — gated the existing broader check (`request.requested_by === user.userId || row.created_by === user.userId`,
   under `row.source === 'MANUAL_ENTRY'`) with the same `!maySelfApprove(user.userType)`.

**Did not unify point 3 onto the shared `isSelfApproval`.** Confirmed again this round: feed's row never
writes `requester_user_id` (`feed-requisition.service.ts` create paths only ever set `created_by`), so the
common helper's `row.requester_user_id === userId` arm would always be false for a feed row regardless — not
dangerous, just dead weight — but feed's check also reads `request.requested_by` from the **approval
request**, a field the common row-shaped helper never sees. Calling the common helper from feed would silently
drop that check. Kept separate; both now call the **same** `maySelfApprove` predicate, so they provably agree
on *which types* are exempt even though they disagree, correctly, on *which field* proves self-authorship.

## The farm-scope widening — two more call sites, found only once the scope changed

4. `approval.service.ts`'s `farmConditions(userType?)` — the gate behind **every** `/approval/*` route
   (`findAll`, `counts`, `findOne`, and the private `decide()` used by `approve`/`reject`). Added one more OR
   branch, active only when `mayDecideAnyRequisition(userType)`: `inArray(doc_type, ['REQUISITION',
   'FEED_REQUISITION'])`. Threaded `userType` from the controller (`req.user?.userType`) into `findAll` and
   `counts` (so the admin's own Approvals inbox can even show the row) and from `userPayload?.userType` inside
   `decide()`.
5. `requisition.service.ts`'s `scopeConditions()` — added an opt-in `{ bypassFarm?: boolean }`, used only by
   the direct `decide()` with `bypassFarm: mayDecideAnyRequisition(userPayload?.userType)`. Every other caller
   (`create`, `findOne`, `findAll`, `update`, `release`, …) is unaffected — the farm-active narrowing is still
   the default everywhere else, by design (decisions.md only names approve/reject).

Feed needed **no equivalent change**: its `decideFromApproval` → `lockForApproval` already matches the
requisition row by `document_id` + `company_id` taken from the already-scope-checked approval request, with no
second, caller-scope filter of its own — so fixing `approval.service.ts` alone was sufficient for both kinds.

## A real bug this live check found and fixed (not a hypothetical)

`ApprovalService.decide()`'s own read-back after committing the decision — `return this.findOne(requestId,
tenantId)` — did **not** pass `userType`. So for exactly the new cross-farm case (an admin approving a
different farm's request), the decision itself succeeded, but the immediate read-back used the un-widened,
farm-only visibility, threw `NotFoundException('Approval request not found.')`, and **rolled the whole
transaction back** — the API reported 404 and the database was left unchanged (no `requisition.status` write,
no `approval_request.status` write; confirmed in MySQL both stayed `PENDING`/`PENDING_APPROVAL` after the
failed call). Fixed by threading `userPayload?.userType` into that call too. A regression test was added
(`approval.service.spec.ts`, "decide()'s read-back after committing passes the same userType as its lock") —
confirmed it fails without the fix (reverted it locally, re-ran, got the exact `undefined` vs `'COMPANY_ADMIN'`
mismatch, then restored the fix) and passes with it. This is exactly the "second copy of a gate, found late"
class of defect the plan warned about — here a second *call site* of the same gate, not a second
implementation of the rule.

## Tests (TDD: RED command and output, then GREEN)

**RED** — `cd apps/api && npx jest src/modules/procurement/requisition/requisition.rules.spec.ts --maxWorkers=2`
before `maySelfApprove` existed:
```
TypeError: (0 , _requisitionrules.maySelfApprove) is not a function
Tests:       4 failed, 49 passed, 53 total
```
**RED** — `feed-requisition.submit.spec.ts` before the feed fix (admin exemption tests failing, the
non-exempt-type tests already passing — proving they exercise the refusal for its own reason):
```
Rejected to value: [ForbiddenException: You may not approve a requisition you created...]
Tests:       2 failed, 24 passed, 26 total
```
**RED** — `approval.service.spec.ts` before the farm-scope widening (new admin tests failing; the
non-exempt/no-userType negatives already passing):
```
Expected substring: "`approval_request`.`doc_type`"   (not found)
Tests:       2 failed, 30 passed, 32 total
```
**RED** — the read-back regression, reproduced by temporarily reverting the one-line fix:
```
Array [ "COMPANY_ADMIN", - "COMPANY_ADMIN", + undefined ]
Tests:       1 failed, 32 passed, 33 total
```

**GREEN**, final, full relevant surface:
```
cd apps/api && npx jest src/modules/procurement src/modules/production/approval --maxWorkers=2
Test Suites: 15 passed, 15 total
Tests:       388 passed, 388 total
```
`npx tsc --noEmit -p tsconfig.app.json` — 0 errors.
Lint (`./node_modules/.bin/eslint <every touched file>` from the worktree root) — 0 errors, 307 warnings, all
pre-existing classes (`no-explicit-any`, `no-non-null-assertion`) in test files, none new.

### Coverage added (by file)
- `requisition.rules.spec.ts` — `maySelfApprove` (allow-list, SYSTEM_ADMIN refused, every other type refused,
  no-type refused) and `mayDecideAnyRequisition` (agrees with `maySelfApprove` on every type tested).
- `requisition.service.spec.ts` — direct `decide()`: TENANT_ADMIN/COMPANY_ADMIN self-approve (own document,
  `approved_by` still the approver); STANDARD_USER/FARM_MANAGER/OPERATIONAL_ADMIN/SYSTEM_ADMIN self-approve
  refused (each with the right permission-grant queue so the refusal is the self-approval check, not an
  incidental permission 403); TENANT_ADMIN/COMPANY_ADMIN cross-farm decide (SQL-asserted: no `farm_id` filter,
  `company_id` filter still present); FARM_MANAGER/STANDARD_USER cross-farm still filtered by farm; a
  COMPANY_ADMIN still blocked from another **company's** row (bypassFarm widens farm, never company).
- `requisition.release.spec.ts` — the same self-approval and cross-farm-admin cases through the **real**
  `ApprovalService` + `AuditLogService` (not mocked), both of decide()'s self-approval checks exercised
  together; the one pre-existing test with a stale "COMPANY_ADMIN" comment was corrected (it was always
  testing STANDARD_USER — comment was wrong, behaviour wasn't).
- `feed-requisition.submit.spec.ts` — TENANT_ADMIN/COMPANY_ADMIN self-approve their own manual feed
  requisition (`approved_by` recorded); OPERATIONAL_ADMIN/STANDARD_USER/SYSTEM_ADMIN still refused.
- `approval.service.spec.ts` — `farmConditions(userType)`: COMPANY_ADMIN drops the active-farm filter for
  requisition doc types only (company boundary intact, the ordinary D25 farm branch still present too);
  TENANT_ADMIN the same, tenant-wide when no company selected; FARM_MANAGER and "no userType passed" add
  nothing; SYSTEM_ADMIN still refused the bypass. Plus the read-back regression test above.

## UI

No UI change was needed, and none was made. Read `apps/web/src/components/console/approvals/approvals-page-shell.tsx`:
Approve/Reject (both the row actions and the dialog's buttons) are gated **only** on `item.status === "PENDING"`
— there never was a creator/self check client-side; the refusal has always been server-side. The list itself
(`GET /approval`) is a plain `api.get` with no client override, so the server's widened `farmConditions`
reaches it automatically via the JWT's `userType` — once the backend shows the row, the existing button shows
with it. Also checked `common-requisition-detail.tsx` (Approve is "deliberately NOT here — stays in the
Approvals inbox") and `requisition-approval-detail.tsx` / `feed-requisition-approval-detail.tsx` (pure
read-only document views, no action buttons). No second copy of the rule exists in the web app.

## Live check

Rebuilt and restarted correctly on the **second** attempt — AGENTS.md's own documented worktree trap (§8 point
7) hit exactly as described: `pnpm nx run api:build` (with or without `--skip-nx-cache`/`NX_DAEMON=false`)
silently replayed a stale build from the **main checkout**, not this worktree — confirmed by finding a string
absent from the worktree's source but present in main's. Fixed with the exact documented incantation:
```
cd apps/api && NODE_ENV=production \
  NX_WORKSPACE_ROOT_PATH=/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration \
  NX_TASK_TARGET_PROJECT=api NX_TASK_TARGET_TARGET=build \
  ../../node_modules/.bin/webpack-cli build
```
Verified each time with `grep -c "<marker>" apps/api/dist/main.js` before trusting the server (a deliberate
`ZZDEBUGMARKERZZ` string round-tripped through one such check, confirming the fresh build matched my edits,
then was removed). Final bundle confirmed to contain `mayDecideAnyRequisition`, `SELF_APPROVAL_EXEMPT_USER_TYPES`,
`REQUISITION_APPROVAL_DOC_TYPES`, and the read-back fix's comment text. Server restarted by PID only
(`lsof -ti :2877 -sTCP:LISTEN`, then `kill <pid>`; never `pkill`), four times across the debugging arc.

Logged in through `POST /api/v1/auth/login` as the seeded `company.admin@triplec.local` (never minted a JWT).

**1. Common requisition, self-approval.** Created `RQ-00011` (FA/PURCHASE) as company.admin, submitted it,
approved it through `POST /approval/:id/approve` as the same user. MySQL (`nf_devco.requisition`):
`status='APPROVED'`, `approved_by` = the same user id as `created_by`/`requester_user_id`
(`d003d7f5-a4fb-4940-b0a5-9472d9c4eb90`), `approved_at` stamped. `approval_request.decided_by` = same id,
`decider_label='Company Administrator'` — the audit trail names the approver even though it is a
self-approval, exactly as decisions.md requires.

**2. Feed requisition, self-approval.** Created `REQ-VIL100-2026-00003` (manual line, matched to a silo
already holding that item so checkpoint 4 and the exception-reason rule didn't interfere) as company.admin,
submitted, self-approved via the same `/approval/:id/approve`. MySQL: `requisition.status='APPROVED'`,
`approved_by = created_by` (same admin), `approval_request.decided_by` = same, `decider_label` recorded.

**3. The widened rule, live: cross-farm, not-self.** Created `REQ-LIO100-2026-00001` on LIONSHEAD FARM while
company.admin's active farm (`x-active-farm-id`) was set to **VILLA FRANCA FARM** — a different farm, same
company. Submitted. First approve attempt **404'd** ("Approval request not found.") — this was the live bug
described above; fixed the read-back, rebuilt, restarted, retried: `approve` now **succeeds**. MySQL:
`requisition.status='APPROVED'`, `farm_id` = Lionshead's id (not the admin's active farm), `approved_by`
recorded, `approval_request.status='APPROVED'`, `decided_by` recorded.

**Negative check — blocked, not skipped; here is exactly why and what was proven instead.** Attempted to
reproduce "a non-admin creator is still refused" live, as STANDARD_USER and separately as OPERATIONAL_ADMIN.
Both are `RESTRICTED_USER_TYPES`, so both need an active operational area header; with one, `resolveFarmScope`
sets `scope.restricted=true` and `scope.lobId` to that area's lob — and **every** scope-bounded write to a
common or feed requisition (`scopeConditions()` in `requisition.service.ts` line 124, the identical line in
`feed-requisition.service.ts` line 156, `restrictedScopeConditions` in `farm-scope.ts`) issues `SELECT
company_id FROM company_master WHERE lob_id IS NULL OR lob_id = ?` — and **`company_master` has no `lob_id`
column** (confirmed in both the live DB schema and `core/database/schema.ts`). The request 500s with
`ER_BAD_FIELD_ERROR: Unknown column 'lob_id'` before it ever reaches the self-approval check. This is
pre-existing (confirmed via `git diff`/`git blame`: none of these three lines are touched by this branch's
diff; `farm-scope.ts`'s farm-scope module itself is from 14 Sep) and unrelated to WP1 — it blocks **every**
restricted-type user (`OPERATIONAL_ADMIN`/`FARM_MANAGER`/`STANDARD_USER`) from creating or deciding **any**
common or feed requisition on this local `nf_devco` database once they have an active area, regardless of this
branch. I did not attempt a schema fix (out of scope, additive-only rule, not mine to decide). **What is
actually proven for the negative case**: the automated suite, including real-`ApprovalService`-engine
integration tests (not mocks) — `requisition.release.spec.ts` ("refuses self-approval for a non-exempt user
type"), `feed-requisition.submit.spec.ts` (OPERATIONAL_ADMIN/STANDARD_USER/SYSTEM_ADMIN refused), and
`requisition.service.spec.ts`/`approval.service.spec.ts` (SQL-level, FARM_MANAGER/SYSTEM_ADMIN still farm- and
scope-bound). This is a genuine gap in the live proof specifically, not in the proof overall, and I am flagging
it rather than papering over it.

**Data moved and restored.** To reach the negative live check I temporarily granted `SUPER_ADMIN` role
assignments to `area.admin@triplec.local` and `user@triplec.local`, an operational-area assignment to each,
and set `user@triplec.local`'s `farm_id`. All were read back before changing (role/area assignments: none
existed for either grant I added; `farm_id` was `NULL`) and all were deleted/reverted afterward, confirmed by
re-querying MySQL (0 rows left for the role/area assignment ids I'd inserted; `farm_id` back to `NULL`). The
test documents created during the live check (`RQ-00011`, the three feed requisitions) were left in place —
they are the proof artifacts, the same as the task's own "create, submit, approve" instruction asked for, not
incidental state to clean up.

## Files touched

- `apps/api/src/modules/procurement/requisition/requisition.rules.ts` — `SELF_APPROVAL_EXEMPT_USER_TYPES`,
  `maySelfApprove`, `mayDecideAnyRequisition`.
- `apps/api/src/modules/procurement/requisition/requisition.service.ts` — enforcement point 1
  (`decide()`), point 2 (`decideFromApproval`), `scopeConditions({ bypassFarm })`.
- `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` — enforcement point 3.
- `apps/api/src/modules/production/approval/approval.service.ts` — `farmConditions(userType)`, `findAll`/
  `counts`/`findOne`/`decide()` threading, the read-back fix.
- `apps/api/src/modules/production/approval/approval.controller.ts` — passes `req.user?.userType` into
  `findAll`/`counts`/`findOne`.
- Specs: `requisition.rules.spec.ts`, `requisition.service.spec.ts`, `requisition.release.spec.ts`,
  `feed-requisition.submit.spec.ts`, `approval.service.spec.ts`.

## Concerns for the reviewer

1. **The `company_master.lob_id` gap** (above) — real, pre-existing, blocks every restricted user type from
   requisitions on this local database; not fixed here, needs its own decision (add the column? stop querying
   it?). I'd flag this to Rishi directly rather than let it sit only in this report.
2. The live negative check is proven by the automated suite, not by a live HTTP+MySQL round trip, for the
   reason above. If a live negative proof is required before sign-off, it needs either a seeded `FARM_MANAGER`
   with an area assignment that doesn't trigger the bug, or the bug fixed first.
3. WP1b (one Requisitions page; inbox stops listing requisitions) is explicitly not touched — confirmed the
   inbox's `farmConditions` change here does not by itself alter what the inbox *shows* beyond the admin-scope
   widening; the "Waiting for my approval" filter and the hub wiring are still to be built.
