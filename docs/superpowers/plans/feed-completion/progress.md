# Feed master completion plan — progress

Plan: `docs/superpowers/plans/2026-10-04-feed-master-completion-plan.md` (commit c08cc068).
Earlier ledgers (git-ignored, still readable in the worktree):
`.superpowers/sdd/2026-10-03-feed-tdd-alignment/progress.md` (Part A) and
`.superpowers/sdd/2026-10-04-feed-part-e-requisition/progress.md` (Part E, Tasks 1–20).

One builder at a time on this branch. Every work package ends with a live check through the app and MySQL.

## Controller log

- Controller: navfarm-48 active (4 Oct). Took over from the desktop session on Rishi's instruction.
  Verified the handover against git rather than the note: HEAD c08cc068, tree clean, and the master plan,
  the self-approval decision (4b670477) and the grid decision (430d9325) all present as described.
- Confirmed the desktop finished my Task 18 fix round: `requisition-new-dialog.tsx:198` now keys the
  step effect on a primitive (`[open, typesKey]`) instead of the array identity, which was the shape I
  ruled. That defect — inherited from the design's own code — could silently have discarded an
  in-progress requisition on any parent re-render.

## WP1 — Tenant / Company admins may approve their own requisitions

Pre-flight (navfarm-48), before dispatch — **the plan says "find the feed path's check"; here it is, and the
picture is worse than one rule in one place:**

- **THREE enforcement points, and they are already inconsistent.**
  1. `requisition/requisition.service.ts:683` — common, direct decide, via the shared `isSelfApproval`.
  2. `requisition/requisition.service.ts:946` — common, `decideFromApproval` (the registered handler), same helper.
  3. `feed-requisition/feed-requisition.service.ts:1327` — **feed, INLINE, not the shared helper**:
     `request.requested_by === user.userId || row.created_by === user.userId`.
- Point 3 is **broader** than points 1–2: it refuses on *either* `requested_by` **or** `created_by`, where the
  common helper keys on one. So the same user can already be treated differently by the two paths, and a
  change applied to only one of them leaves the other refusing.
- `approval.service.ts` has **no** self-check of its own — the engine delegates to each document's handler,
  which is why the rule lives in two services rather than one place.
- This is the defect class that has recurred most on this branch (a second implementation of one rule:
  a removed field with a second builder, a float tolerance with a second unguarded instance, `update()` as a
  second writer, a third posting path). WP1 must change all three **together** and prove each.

### WP1 widened mid-flight (Rishi, 4 Oct, commit d1b0d3e0 — docs only)

Rishi widened WP1 and added WP1b **while my implementer was working**. I intervened before it committed;
its code was untouched by the docs commit. My original dispatch was **under-scoped** — mine to correct.

- **WP1 is no longer only self-approval.** A `TENANT_ADMIN` or `COMPANY_ADMIN` may approve or reject **any**
  requisition in their scope, of every kind, their own and anyone else's, **whatever the approval tier or step
  would otherwise require.** So an admin who is not the step's named approver must still be able to decide.
- **Two surfaces beyond the three self-approval checks** I had identified: the engine's per-step **approver
  resolution** (role/tier) in `approval.service.ts`, and the permission `PROCUREMENT/REQUISITION/approve` that
  **`assertMayDecide`** requires.
- **The danger I flagged to the implementer, and will have verified:** do NOT bypass `assertMayDecide` wholesale
  for admins. That gate may also carry the **company boundary**, and the decision says "any requisition **in
  their scope**" — not anywhere. Short-circuiting the whole gate could let a company admin reach another
  company's requisition with nothing stopping them. Admins must *satisfy* the rule, or the exemption must be
  carved narrowly around the tier/step part only, with the report stating exactly which checks were relaxed and
  which were deliberately left in force.
- The plan now names the shape I had asked for independently: **one helper, every caller, no second copy** —
  `SELF_APPROVAL_EXEMPT_USER_TYPES` / `isSelfApproval`. The feed path's inline check (`:1327`) is expected to
  become one of those callers if its two-field difference (`requested_by` **or** `created_by`) allows it.
- `SYSTEM_ADMIN` remains **undecided and refused**. Still the easiest thing to get wrong — a check written as
  "if the user is an admin" quietly includes it, so the allow-list stays exactly the two named types with a test
  proving SYSTEM_ADMIN is refused.
- **WP1b is a separate package** (one Requisitions page; the inbox stops listing requisitions). Explicitly not
  the current implementer's, and it carries its own sequencing rule from Rishi: write the **inbox-to-hub
  equivalence test before** removing requisitions from the inbox.

Controller note: this is the second scope change to arrive mid-implementation today (Task 17's ruling reversed
the same way). There the stop message lost the race and cost a round. Here it was caught uncommitted. The
lesson stands and is now cheap to state: when a decision is being actively discussed with Rishi, a dispatch on
that subject is a bet — and the plan's own §0.4 "one builder at a time" does nothing to protect against a
*ruling* changing underneath a builder, only against two builders colliding.

### WP1c / WP1d recorded (Rishi, 4 Oct — commits c972a0a0, e4d1719e, docs only)

- **WP1c** — the common requisition follows Rishi's own field and button list, kept verbatim in
  `docs/superpowers/plans/feed-completion/common-requisition-spec.md`. Missing today: the department checks on
  Transfer Shipment and Transfer Receipt (the user's department must match the From/To sub-location's
  department), the Direct Transfer right in User Setup, and **Item Tracking (lot/serial)**.
- **WP1d** — page, tab and section names follow the workbook, per the plan's mapping table. **Labels only**:
  routes and tab keys stay.
- Order: WP1 → WP1b → WP1c → WP1d → WP2 …

### THE MERGE IN WP1c — NOT DONE, AND NOT ON A RELAY (controller decision)

WP1c says Item Tracking needs `origin/main` merged into this branch first (Arun's PR #13 lot/serial work,
13 commits), "merge locally only, never push". I have **not** done it, and I am surfacing it to Rishi instead.
The facts I established first, because two of them change what the instruction even means:

1. **Local `main` is stale and already contained in this branch.** `main` = `6831e6d0`, which is exactly the
   merge-base, and `git merge-base --is-ancestor main HEAD` is true. So merging *local* `main` would be a no-op.
2. **The work actually wanted is `origin/main` = `ef17b3f9`** (the PR #13 merge, carrying `ae2bd7b1` "add lot and
   serial tracking support to inventory panels and database seed scripts"). `ef17b3f9` is also the tip of
   `fix/series-and-item-kinds-batch`, the branch the main checkout sits on. So the ref matters: three plausible
   readings of "merge main", one a no-op and one a feature branch's history.
3. **The last fetch was 2 Oct 13:32** — two days ago. So even the local `origin/main` ref may be behind what the
   remote now holds; knowing what would actually arrive requires a fetch (a network operation).
4. **The conflict surface is the worst possible for this branch.** Arun's commit is literally about *inventory
   panels*, and this branch has rewritten the inventory panels more than anything else (requisitions-panel,
   feed-forecast-grid, feed-requisition-document, the new detail/dialog components). Conflicts are likely in
   precisely the files carrying the most verified work.
5. **It contradicts a standing constraint.** "Never push or merge" has bound every dispatch in Part A and Part E
   and is in `global-constraints.md`. A peer relay cannot lift a rule of Rishi's; only Rishi can, and I would
   rather have that from him than infer it.
6. My own standing note on this project is that **Arun's commits are to be reviewed, never assumed** — he is off
   but still lands work on shared branches.

**What I need from Rishi:** confirmation that he wants `origin/main` (`ef17b3f9` or newer after a fetch) merged
into this feature branch locally, knowing it brings another developer's 13 commits into the most-rewritten files
here. If yes, I would fetch first, do the merge in isolation as its own step, resolve conflicts with the feed
work as the authority on the files this branch owns, then run the full gates and a live check before any further
package builds on it — not fold it into WP1c's feature work.

**Meanwhile nothing is blocked.** WP1 is in flight; WP1b and WP1d need no merge; and two of WP1c's three gaps —
the Transfer Shipment/Receipt department checks and the Direct Transfer right in User Setup — need no merge
either. Only Item Tracking does, so only Item Tracking waits.

### Rishi's answers, 4 Oct (commit 5324875a, docs only) — three, and one bounds WP1 mid-flight

1. **Feed Forecast tab labels are exactly:** Dashboard · Calculation · Requisition · Physical Stock Count. (WP1d)
2. **Remove the forecast's "Stages (n)" sub-tab properly** — not just hide it. Named parts: the
   `FeedForecastStages` component in `feed-forecast-grid.tsx`, the toggle state in `feed-forecast-panel.tsx`, the
   strings only it uses, the **`stages` response field and its builder** (grep for other readers FIRST), and the
   specs that assert it. **KEEP the engine's stage-chain / next-diet projection.** And: remove any other
   feed-page feature that is not in the workbook and did not exist before 25 Sep the same way — **listing each in
   WP1d first**, so the list is reviewable before anything is deleted.
3. **Admins do NOT bypass the department checks** on Transfer Shipment and Receipt. Their **only** extra power is
   approving any requisition, whoever created it, their own included.

**Answer 3 relayed to the in-flight WP1 implementer immediately**, because it turns the caution in my previous
intervention into a firm requirement: the exemption is strictly about **approval authority over requisitions**
and nothing else. No bypass of the department match, the company boundary, scope, or the document's own checks
(remarks, deadline, capacity, reasons). Its report must list what it relaxed **and** name the department checks
and company boundary among what it deliberately left in force, so a reviewer verifies rather than infers.
Pleasing to have guessed right: I had already told it not to short-circuit `assertMayDecide` wholesale because
that gate may carry the company boundary — Rishi's answer independently confirms that shape.

**Controller notes on answer 2, for whoever builds WP1d — it is a deletion task, which is the riskiest kind here:**
- "Grep for other readers first" is the same question that has found a real defect in a majority of this
  branch's tasks (a removed field with a second builder; a float tolerance with a second unguarded instance;
  `update()` as a second writer; a third posting path). The `stages` response field is exactly that shape.
- **"KEEP the engine's stage-chain / next-diet projection" is the trap.** A careless removal of "stages" would
  take out the diet-change projection that Part A Task 3 built and that the whole next-diet behaviour rests on
  (`ForecastSource.isNextDiet`, `nextDietKeys`, the diet-change rows). The sub-tab is a *view*; the projection is
  the *calculation*. Deleting the former must not touch the latter.
- The "anything added after 25 Sep that is not in the workbook" sweep must produce **the list first**, reviewed,
  before any deletion — removing something that turns out to be needed is far more expensive than listing it.

**Still outstanding from Rishi: the WP1c merge question.** He answered these three but not whether to merge
`origin/main` (`ef17b3f9`, Arun's PR #13, 13 commits) into this branch locally. Item Tracking alone waits on it;
WP1, WP1b, WP1d and WP1c's other two gaps do not. Not re-asking yet — it is recorded and nothing is blocked.

## WP1: complete — 411ecdf6 (pending review)

Gates: `jest src/modules/procurement src/modules/production/approval` 388/388, 15 suites; tsc 0; lint 0 new.

- **All three self-approval points gated through one shared `maySelfApprove`.** The feed path's inline check was
  kept separate for a real reason — it also tests the approval request's `requested_by`, which the common row
  does not carry — but now **provably agrees** via the same allow-list. That is the right resolution of the
  two-field difference I flagged pre-flight.
- **Widened scope handled narrowly**, as Rishi's bound required: `approval.service.ts`'s `farmConditions` gained
  an OR branch **bounded to `doc_type IN ('REQUISITION','FEED_REQUISITION')`**, and `requisition.service.ts`'s
  `scopeConditions({bypassFarm})` lets admins reach another farm's requisition. Left untouched and named in the
  report: the company boundary, `assertMayDecide`'s pre-existing bypass, the department checks on Transfer
  Shipment/Receipt, and every document-level check.
- **SYSTEM_ADMIN refused on BOTH** self-approval and the farm-scope widening, with explicit tests for each. I had
  only asked about self-approval; it covered the widening too.
- **The live check found a real bug no test caught:** cross-farm admin approval 404'd because `decide()`'s
  read-back dropped `userType`, rolling the transaction back. Fixed, then confirmed live and in MySQL. This is
  the third time on this branch that driving the app found something a green suite ran straight over.
- Live proof: company.admin self-approved a common (`RQ-00011`) and a feed (`REQ-VIL100-2026-00003`) requisition
  — MySQL confirms `status=APPROVED`, `approved_by`=self, audit trail intact. Cross-farm admin approval proven on
  `REQ-LIO100-2026-00001` with the active farm ≠ the document's farm.

### SEVERE PRE-EXISTING DEFECT, found because WP1's negative live check was blocked by it

The implementer could not prove live that restricted users are *still refused*, because they 500 before reaching
the check. **Controller-verified, and it is real:**

- `company_master` has **no `lob_id` column in any database** — confirmed by `information_schema`: absent from
  `nf_devco`, `nf_system` **and** `nf_master` (nf_devco's `company_master` has 33 columns, none of them `lob_id`).
  It is absent from `schema.ts` too.
- Two services nonetheless filter on it, in **raw SQL**:
  `requisition.service.ts:124` and `feed-requisition.service.ts:156` —
  ``sql`${schema.requisition.company_id} IN (SELECT company_id FROM company_master WHERE lob_id IS NULL OR lob_id = ${scope.lobId})` ``
- **Raw SQL is why `tsc` never caught it**: drizzle's types cannot see inside a `sql\`\`` template, so a column
  that exists nowhere compiles cleanly and fails only at runtime.
- The condition is pushed only for a restricted user carrying a LOB, so the blast radius is exactly **Farm
  Manager, Head of Farms / OPERATIONAL_ADMIN and Standard User** — i.e. most real users — getting a **500** on
  requisition list/actions. Not WP1's doing; WP1 merely ran into it.
- Note the SQL was written **with** the NULL carve-out (`lob_id IS NULL OR lob_id = ?`), which is the correct
  "a company with no LOB belongs to every LOB" intent. Someone wrote the right logic against a column that was
  never created.
- **This is the third LOB defect on this branch**: Part A Task 4's strict `assertLobInScope` with no NULL
  carve-out, Task 17's LOB question (moot — `approval_request` has no `lob_id` either), and now this. LOB
  scoping on this codebase is repeatedly built against columns and semantics that do not line up.
- **Needs its own task and a decision from Rishi**: either add `company_master.lob_id` additively (0148+) if a
  company is meant to belong to a LOB, or remove the filter if it is not. Not something to guess.

### Rishi's answers on the two open questions (4 Oct, desktop controller)
- LOB bug → **WP1e**: scope by the farm's LOB (`location_master.lob_id`), farm-less/NULL visible to all. Do before WP1b.
- Merge → **yes**: fetch, merge `origin/main` locally as its own step before Item Tracking (WP1c). Never push.
- Next order: WP1 review → WP1e → WP1b → WP1c (merge first for tracking) → WP1d → WP2 …
- Controller: navfarm-48 (VS Code) stopped by usage limit after WP1 (411ecdf6).

### Rishi answered both open questions (decisions.md:2588-2597, commit e55ef0ca) — controller-verified in the repo, not taken from the relay

1. **The LOB bug → WP1e.** A requisition's line of business is **its farm's** (`location_master.lob_id`), not its
   company's. Requisitions with no farm, and farms with no LOB, are visible to every LOB. **No schema change.**
   One shared helper for both services. This is a good answer for a reason worth recording: it scopes by a column
   that actually exists, and its "no farm / no LOB is visible to every LOB" carve-out is the same principle Part A
   Task 4 established (`assertLocationOnActiveFarm` treats a NULL `lob_id` as belonging to every LOB) — so WP1e
   makes three LOB implementations consistent rather than adding a fourth.
2. **The local merge is APPROVED**, and now by a committed decision rather than a relay — which is the standard I
   held out for when I declined it earlier. At the **start of WP1c**: fetch, then merge `origin/main` locally **as
   its own step**, conflicts resolved keeping the feed work on the files this branch owns, then the full gates and
   a live check. Nothing pushed.

**Order of work (Rishi's):** WP1 review (411ecdf6) → WP1e → then finish WP1's blocked negative live check →
WP1b → WP1c (merge first) → WP1d → WP2 …

Controller note on the merge, for whoever performs it: the facts I established before declining still apply and
should shape it. Local `main` is stale (`6831e6d0`, already an ancestor of HEAD) so merging *it* is a no-op; the
work wanted is `origin/main` = `ef17b3f9` or newer after the fetch; the last fetch was 2 Oct 13:32, so fetch
first; and the conflict surface is the worst possible here, because Arun's commit is literally about *inventory
panels* and this branch has rewritten those more than anything else. Do it as its own commit with nothing else in
it, so a revert is one command.

### WP1 review dispatched (opus) — package review-ff08200b..411ecdf6.diff, 120KB, 5 commits

Eight named checks, the first three being where a permission relaxation goes wrong: whether the `farmConditions`
OR branch is genuinely bounded to requisition doc types (an over-wide branch would hand admins sign-off authority
over physical counts, stage moves and GRNs that Rishi never granted); whether `scopeConditions({ bypassFarm })`
relaxes **only** the farm and leaves the **company boundary** intact (Critical if not — "in their scope", not
anywhere); and whether `SYSTEM_ADMIN` is refused on **both** surfaces by distinct tests. Also: whether the three
self-approval points provably agree; whether Rishi's bound (department checks, document-level checks untouched)
holds in the code rather than in the report; whether the `userType` read-back fix has a regression test rather
than being live-only; whether the **negative** evidence is real-engine or a mock, since the negative half of a
permission change is the half that matters and it currently rests on the suite alone; and whether the audit trail
survives. Told it to grade any over-permissive path on its merits, not by likelihood.

### WP1 review (opus) — no Critical, 1 Important, 4 Minor; fix round 1 dispatched

It hunted specifically for an over-permissive path and found NONE: the farm bypass cannot reach another company
(company equality at `requisition.service.ts:119` and `approval.service.ts:269`), another tenant, a
non-requisition approval kind (`inArray` at `:268`; the other kinds use distinct strings — FEED_RATION,
GRN_RECEIPT, STOCK_TRANSFER, MEDICINE_REQUISITION, UNSCHEDULED_HEALTH), or `SYSTEM_ADMIN`. And
`RESTRICTED_USER_TYPES` and the exempt list are **disjoint**, both deriving from the same JWT `userType`, so no
restricted scope can coexist with an exempt type.

Two findings that resolve open questions rather than raising new ones:
- **There is no tier/step approver resolution in this codebase at all** (`grep` for tier/approval_step/
  approver_user_id finds only a comment and no column). So the plan's "whatever the approval tier or step would
  otherwise require" is satisfied by widening visibility — that IS the complete mechanism, not a partial one.
- **`assertMayDecide` passes for admins through a PRE-EXISTING `ADMIN_USER_TYPES` bypass** (`common/permissions.ts:40,100`)
  which the diff never touched. So the permission half of the rule was already in place; WP1 only had to widen visibility.

Credited, and none of it claimed by the implementer: `remove()` (withdraw) deliberately left un-widened, which is
exactly Rishi's bound; FOUR distinct SYSTEM_ADMIN refusals each failing for its own reason; the live-found
read-back fix carrying a real regression test; and the audit trail unconditional with no self-approval special case.

**Important (fix dispatched): `requisition.service.ts:732` has the SAME read-back defect the live check already
found and fixed on the sibling route.** `decide()` locks with `scopeConditions({ bypassFarm })` at :686 then, inside
the same transaction, returns `this.findOne(...)` at :732 — and `findOne` applies `scopeConditions()` with NO
bypass (:458). So an admin with an active farm deciding a cross-farm or farm-less **common** requisition succeeds
through the lock, the gate, the approve and the status write, then 404s on the read-back and **the whole
transaction rolls back**: the caller sees 404 and the database is unchanged. Byte-for-byte the defect fixed at
`approval.service.ts:436`, left on the other call site. The suite is STRUCTURALLY blind to it (the cross-farm spec
asserts only `whereCalls[0]`, and `makeDb()` never evaluates a WHERE), and the live run proved cross-farm only
through the feed/engine route. This is the "second call site of the same gate" class that has bitten this branch
more than any other.

### CARRIED FORWARD — two items from this review that belong to later packages

- **→ WP1b:** an admin can now *decide* a cross-farm requisition, but `findOne` (`:458`) and `findAll` (`:584`)
  still narrow by active farm. So **the hub's document dialog will 404 on precisely the cross-farm rows WP1b must
  show Approve on.** Concrete and actionable; handing it over rather than letting WP1b rediscover it.
- **→ WP1c:** Rishi's "admins do NOT bypass the department checks on Transfer Shipment/Receipt" bound is currently
  **vacuously satisfied** — those checks DO NOT EXIST yet (they are WP1c's own gap). "Untouched" is true but
  meaningless today; the bound must be **re-verified when WP1c builds them**, or the first implementation could
  quietly include an admin exemption Rishi explicitly refused.
- Noted, pre-existing, not actioned: a `COMPANY_ADMIN` whose `user.companyId` is NULL resolves to tenant-wide, and
  `bypassFarm` removes the last incidental guard on the decide path for that user. A data defect rather than a code
  one, bounded by tenant.

## WP1 fix round 1: complete — (see commit) (navfarm-49, 4 Oct)

The review's Important finding, fixed: `decide()`'s post-commit read-back (`findOne`, called inside the same
transaction) now carries the same `bypassFarm: mayDecideAnyRequisition(userPayload?.userType)` as its lock.
`findOne` grew an **opt-in** `opts.bypassFarm` — every other caller (create, submit, update, release, the
controller's GET) omits it, so this is not a general widening of the document view (that is WP1b's).

- **RED verified before trusting GREEN:** reverted `requisition.service.ts` to HEAD, ran
  `npx jest src/modules/procurement/requisition/requisition.service.spec.ts --maxWorkers=2` — the new regression
  assertion failed with the read-back SQL still carrying `farm_id` (`Tests: 2 failed, 56 passed`); restored the
  fix (`git apply` of the saved patch), same file `Tests: 58 passed`. The suite is no longer structurally blind
  to the second call site.
- Gates: `jest src/modules/procurement src/modules/production/approval` 388/388, 15 suites; tsc 0; eslint 0 new
  errors on the two touched files.
- **Live check (this round's target: the path the review said live evidence never covered — the DIRECT
  `POST /requisition/:id/approve` route, cross-farm, common):** rebuilt the API with the documented worktree
  incantation, grep-confirmed the bundle carries the new `opts.bypassFarm` comment marker, restarted by PID, then
  as company.admin (active farm VIL100) approved a cross-farm common requisition on LIO100 through the direct
  route: 200, and MySQL shows `status='APPROVED'`, `approved_by`=the admin, `approved_at` stamped — no rollback,
  the read-back returned the row. (The pre-fix symptom was a 404 + rolled-back transaction; reproduced by the
  suite's RED, not deliberately re-broken live.)

## WP1e: complete — 56adac6c (navfarm-49, 4 Oct)

The `company_master.lob_id` filter (a column in **no** database, so every restricted user's requisition read
500'd with ER_BAD_FIELD_ERROR) is replaced by the decision's shape: **one shared helper**,
`requisitionFarmLobCondition()` in `common/farm-scope.ts`, scoping by **the requisition farm's**
`location_master.lob_id`, with farm-less requisitions and NULL-LOB farms visible to every LOB — the same
carve-out `assertLocationOnActiveFarm` already applies. Both services' `scopeConditions()` now call it; the
columns are interpolated drizzle columns, so tsc sees them. A repo-wide grep confirms no other
`company_master`/`lob_id` raw-SQL use.

- Gates: RED first (8 failed across the three specs with the old code), then `jest src/common + procurement +
  approval` 566/566, the **full API suite 2,266/2,266 (174 suites)**, tsc 0, eslint 0 new.
- **Live (as a restricted user, the case that could not even be attempted before):** with temporary area
  assignments (and, for the permission grant only, temporary SUPER_ADMIN role assignments — see the note
  below) for `area.admin@triplec.local` (OPERATIONAL_ADMIN) and `user@triplec.local` (STANDARD_USER):
  `GET /requisition`, `GET /feed-requisition?farmId=…`, `GET /approval` all **200** for both users — they were
  a guaranteed 500 before this change. STANDARD_USER's feed list works farm-pinned; OPERATIONAL_ADMIN's with
  an explicit farm (the endpoint's own "Select a farm." rule, unchanged).
- **WP1's blocked negative live check finished here** (Rishi's order: WP1e → then finish it): the same two
  restricted users each created and submitted a common FA requisition (RQ-00014 for OPERATIONAL_ADMIN, and one
  more for STANDARD_USER) — creation itself exercises the fixed scope — then attempted self-approval:
  **403 "You may not approve a requisition you created. Another authorized approver must decide it."** The
  refusal is reached and enforced; WP1's negative half no longer rests on the suite alone.
- All temporary grants read back as absent first, then deleted; re-queried after: 0 role-assignment rows,
  0 area-assignment rows, STANDARD_USER's `farm_id` back to NULL. The proof requisitions (RQ-00013/00014 etc.)
  stay, as WP1's did.
- **Observation, not actioned (data, not code):** the seeded MANAGER and OPERATOR roles carry **no**
  PROCUREMENT permission rows at all, so a realistic restricted user gets the permission guard's 403 on
  requisition routes before any scope logic runs. The live check needed SUPER_ADMIN grants purely to exercise
  the LOB path with a restricted userType. If Triple C's demo users are expected to see Approvals →
  Requisitions, the role permission matrix needs a seeded fix (a data script decision for Rishi, not mine).

### 5 Oct (desktop controller)
- WP1 fix round + WP1e committed by navfarm-49 (cab1919b, 56adac6c, 2e405f22). VS Code Claude then hit its limit.
- Freebuff (GLM, VS Code terminal) took over and is **mid-WP1b** — uncommitted changes in requisition/approval
  services, controllers, `requisitions-hub.spec.tsx`, new `approvals-page-shell.spec.tsx`. The next agent must check
  `git status` and finish or review these before starting anything new.
- Rishi answered the roles observation → **WP1f** (seed requisition permissions for demo roles), after WP1b.
- Order now: WP1b (in flight) → WP1f → WP1c → WP1d → WP2 …

## WP1b: complete — 223e2485 (navfarm-49/GLM Freebuff, 5 Oct)

The Approvals inbox no longer lists requisitions; **Approvals → Requisitions is the one list**, with the
"Waiting for my approval" filter and Approve/Reject in the document dialog. Decisions.md 2026-10-04
"one Requisitions page" governs.

- **One predicate, not two.** `ApprovalService.farmConditions` (which already carries the WP1 admin rule) is
  public; `requisitionRequestConditions()` = farmConditions + the two kinds; the hub's waiting filter
  (`GET /requisition?waiting_for_me=1`, an EXISTS on the requisition list), the inbox card's count
  (`GET /approval/counts-requisitions`), and the inbox's own remaining surfaces all build on it. The
  equivalence test pins the hub predicate to the inbox's own condition objects (`toBe` per element) — the
  "write the equivalence test before removing them from the inbox" sequencing rule, honoured.
- **Inbox excludes the kinds** in `findAll` AND `counts` (the badges count only what it shows);
  `findOne`/`decide` deliberately do not — the hub decides through the same endpoints.
- **Carried-forward item from the WP1 review resolved:** the hub's list and `GET /requisition/:id` span farms
  for admins (same `mayDecideAnyRequisition` opt-in as the decide lock), so the dialog opens exactly the
  cross-farm rows an admin may approve. Company boundary untouched.
- Gates: RED first (10 API + 6 web), then web 592/592 (89 suites), API procurement+approval 405/405,
  tsc 0 both, eslint 0 new.
- **Live:** as company.admin with VIL pinned, `?waiting_for_me=1` returned 9 pending rows across five farms
  (LIO cross-farm FA included — the old farm-narrowed list hid five of them); `counts-requisitions` = 9;
  `GET /approval` rows were only FEED_STOCK_VARIANCE / MEDICINE_REQUISITION / STOCK_TRANSFER / FEED_RATION and
  its PENDING count dropped to 3; approving RQ-00016 through the hub's endpoint (with remarks) wrote
  `status=APPROVED`, `approved_by`, `decided_by` in MySQL. Web pages compile and serve on :3002 (auth redirect
  for an unauthenticated fetch, as before).
- Not done here, deliberately: row-level Approve/Reject buttons in the list rows (they are in the dialog, which
  is where editing happens per the 4 Oct dialog ruling) and the Feed tab's reuse check (it already mounts the
  same detail components; verified unchanged).

## WP1f: complete — e91cbc87 (navfarm-49/GLM Freebuff, 5 Oct)

The 5 Oct decision (demo roles get requisition permissions) as the data script
`db-align-requisition-permissions` (`src/scripts/align-requisition-permissions.ts`,
§4 shape: read-only plan / --verify rollback / --apply, GET_LOCK, non-local hosts
refused): MANAGER → view/create/edit/submit/approve; OPERATOR → view/create/edit/
submit, no approve. "Submit" rides on can_create (no can_submit column; the
submit route guards on 'create'). ACCOUNTANT/SUPER_ADMIN untouched; no duplicates.

- 7 tests, written first; --verify left 0 rows; --apply committed and read back in
  MySQL (MANAGER 1/1/1/1, OPERATOR 1/1/1/0).
- **Live:** vil100.entry@triplec.local (OPERATOR, standing area): view 200, feed
  view 200, drafted RQ-00017, submitted, approve → 403 (row stayed
  PENDING_APPROVAL). area.admin@triplec.local (MANAGER) with a **temporary** area
  assignment (0 standing rows read first; deleted and re-queried after): approved
  RQ-00017 → APPROVED in MySQL, approved_by stamped.
- **Flagged for WP4:** the demo personas' standing wiring is incomplete — no
  MANAGER-role user holds a standing operational-area assignment (area.admin@ has
  none; the per-farm `*.manager@` users hold NO role at all — NULL
  user_role_assignment rows). The permission grant is correct; the persona wiring
  is demo-data work.

## WP1c — Common requisition to Rishi's field and button list (IN PROGRESS)

Controller: navfarm-30 (Claude Opus 5) took over 5 Oct ~10:50 on Rishi's
instruction, after he stopped the GLM Freebuff session mid-task.

Done so far on this row:

- **origin/main merged** (`6f28462f`, 5 Oct 00:50) — the prerequisite WP1c
  names for Item Tracking (Arun's PR #13 lot/serial work).
- **Department checks on Transfer Shipment and Transfer Receipt** —
  `143ebb1a` (Freebuff). Spec rows "user dept must match From/To Sub-Location
  dimension". Admins do not bypass (Rishi's 4 Oct bound).
- **Direct Transfer right in User Setup** — `51940e15` (Freebuff).
  `user_master.direct_transfer_allowed`, migration 0148, the ONE source the
  rule reads; `ship()` routes a direct requisition through
  `postDirectTransfer`.
- **Item Tracking on the line, enforced at shipment** — `0483df28`
  (navfarm-30). See below: this one was recovered, not inherited clean.

### Freebuff's uncommitted work was corrupt; it was repaired, not discarded

The stopped session left 9 modified files that **did not compile — 20 tsc
errors**. The intent was sound and the tests were spec-aligned, so the work
was repaired rather than thrown away (the raw diff was kept while repairing).
What was wrong, in case it recurs with that agent:

- `transfer-execution.rules.ts`: `assertTrackingAssignments` written **twice**
  in one module, the new copy referencing an undeclared `qty`; an import of
  `./tracking-helpers`, **a file that was never created**.
- `requisition.dto.ts`: the `lines` property had been **deleted** from
  `CreateRequisitionDto` and replaced by a second `RequisitionLineInput`
  class — 7 downstream errors, and the create endpoint would have taken no
  lines at all.
- `requisition.rules.ts`: `const present` and `assertLineFields` each declared
  twice.
- `requisition.service.spec.ts`: text glued mid-token (`};function
  releaseSetup(`), the function prologue duplicated, `recordingDb` declared
  twice, and a test referencing `STORE_SCOPE` — **an identifier that exists
  nowhere in that file**. It had been copy-pasted from
  `requisition.release.spec.ts`, where the harness already exists; the test
  was moved there instead.

**Ruling:** `assignmentsFromLine` takes one object (`{lot_no, serial_no, qty}`)
rather than `(line, qty)`, because its tests — written first — call it that
way. Cost if wrong: one signature change at one call site.

**The defect none of the inherited tests could have caught:** `release()` did
not select `lot_no`/`serial_no`, so every transfer line was created untracked.
The recording database returns queued rows **whole**, ignoring the select
projection — so a row-shaped assertion passes whether or not the service asked
for the column. Verified by removing the fix: the row assertion still passed.
The test now asserts the **projection**, and that does go RED→GREEN.

Gates at `0483df28`: api 178 suites / 2319 tests pass, tsc 0, eslint 0 errors.

### navfarm-30 session, 5 Oct (stopped by Rishi to check the app)

Commits, in order:

- `0483df28` Item Tracking enforced at shipment (API) — Freebuff's repaired work
  plus the release-projection defect below.
- `6d4317b1` Item Tracking button on the line (web) — the Store Item sub-form
  gains the column, reusing main's `LotSerialPicker`; `options()` returns
  `is_lot_tracked` / `is_serial_tracked` as real booleans.
- `c9bacdd9` findOne returns the assignment — **second projection defect of the
  same kind**: the columns were written and then not read back, so the
  assignment vanished from the editor on reload although it was stored.
- `015b0d20` header follows Rishi's field list — order asserted in the spec;
  Requester User ID added; Requester Department made read-only ("auto from
  User Setup"); Status (Open / Released) added as its own projected field,
  with Approval still separate.

Gates at `015b0d20`: api 178 suites / 2320 tests, web 90 suites / 604 tests,
tsc 0 errors both sides, eslint 0 errors.

**Ruling (navfarm-30):** the project ledger stays this file rather than an
`sdd-workspace` one — plan §0.4 and CONTINUE-PROMPT rule 5 both name it, and it
is committed where the sdd ledgers are git-ignored. Cost if wrong: none beyond
a second ledger nobody reads.

**Pattern worth naming, because it has now bitten twice:** the recording
database in these specs returns queued rows **whole**, ignoring the select
projection. A row-shaped assertion therefore passes whether or not the service
asked for the column. Both tracking defects were invisible to row assertions
and only showed up once the test asserted `Object.keys(projection)`. Any future
"the service returns X" test over this harness should assert the projection.

### Open question for Rishi (do not decide it here)

Rishi's list says **"FA and Service: Description + Qty only"**, and the WP1c gap
table turns that into "no item, UOM or rate" on those lines. But
`requisition_line.uom` is **NOT NULL** (varchar(20), verified in `nf_devco`) and
`RequisitionLineInput.uom` is `@IsNotEmpty()`. Hiding the UOM column would make
every FA/Service document unsaveable unless we either make the column nullable
(a schema change, and the branch is additive-only until WP11) or silently
default a unit, which is a data decision and not mine. **The line-column work is
therefore left unstarted** rather than half-done. Rate is safe to hide; UOM is
the blocked half.

### Still open on WP1c

| Spec row | State |
|---|---|
| Header fields in Rishi's order and labels | **done** `015b0d20` |
| FA/Service = Description + Qty only (UI) | **blocked** — see the UOM question above |
| Status shows Open / Released, Approval separate | **done** `015b0d20` |
| Line columns in Rishi's order | not started (same UOM question) |
| **Item Tracking dialog on the line (web)** | **done** `6d4317b1` + `c9bacdd9` |
| Location dept + user dept visible in Location Master / Team Management | not started |
| Item Ledger + Value Entry on shipment/receipt | live verify owed |
| Live check: two users, two departments, tracked item end to end | **owed** |
