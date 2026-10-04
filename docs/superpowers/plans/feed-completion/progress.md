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
