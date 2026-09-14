# Daily Data Entry and Transfers design

**Date:** 2026-09-14

**Decision owner:** Rishi

**Status:** Approved in conversation; awaiting review of this written specification

## 1. Purpose and deadline boundary

NAVFarm needs one fast daily workspace where a farm worker can enter every
scheduled activity for a Batch and Stage, review earlier entries, and initiate
animal movements without jumping among modules.

The delivery target for 18 September 2026 is a demonstrable end-to-end MVP for
all ten named areas. For this feature, MVP means a real
create/draft/post/review/correct-or-transfer path that is verified through the
web, API and MySQL. A screen or endpoint without that proof is not complete.

This design is Piggery-only and covers Next.js web and NestJS API work. Flutter
is out of scope.

This specification supersedes the edit-window and daily-entry presentation in
sections 4.1 and 6.1 of
`2026-09-02-piggery-first-class-records-design.md`. Its append-only correction,
inventory reversal, GL reversal and audit requirements remain applicable.

## 2. Page model from the approved wireframe

Data Entry is one route with two retained states, not two independent pages.

### 2.1 Stage overview

After the applicable company, farm, Batch and entry date are resolved, the page
shows a grid of Stage cards. Each card includes the Stage name, animal count and
daily completion summary. Selecting a Stage changes the same route into the
daily workspace.

Returning to the Stage overview preserves company, farm, Batch, date, drafts
and scroll state. Browser Back must not discard Draft work.

### 2.2 Selected-Stage workspace

The workspace has three regions:

1. Stage cards/tabs with live counts across the top.
2. Activity cards and their Scheduler-line sub-cards in the main work area.
3. A History rail containing the eligible entry dates and each date's
   completion state.

On a small screen these regions become one column. History opens as a secondary
view or sheet rather than permanently consuming the narrow viewport. The
selected Batch, Stage and date remain visible.

The page follows the approved application-shell and dialog rules in
`2026-09-14-access-scope-and-master-data-ux-design.md`.

## 3. Context and access

The workspace always has an explicit Company, Farm, Batch, Stage and Date
context.

- A Standard User's one assigned farm is fixed and not presented as a switch.
- An Operational Admin may select any farm in the assigned Piggery LOB.
- A Company Admin may select any farm in the active company.
- A Tenant Admin may select any company and farm in the tenant.
- Batches are filtered by the selected farm before a Stage is selected.
- The API independently validates every context identifier; client filtering is
  not authorization.

Date defaults to today. Future entry dates are unavailable.

## 4. Batch tracking modes

`batch_header.animal_tracking` remains explicit. The persisted codes are
`REGISTERED` and `COUNT_ONLY`; the user-facing labels are **Registered Animals**
and **Count Only**.

### 4.1 Registered Animals

- The Batch contains individual Animal Register rows.
- Animals in the same Batch may occupy different Stages at the same time.
- Every Stage card count is derived from the active registered animals in that
  Stage, never from a stale Scheduler snapshot or opening quantity.
- Selecting a Stage limits the daily workspace to animals currently in that
  Stage.
- An activity targets all animals in the Stage by default.
- Where the activity permits individual entry, the user may switch to selected
  animals.
- The API rejects a selected animal that is inactive, outside the Batch, outside
  the selected Stage or outside the user's scope.

### 4.2 Count Only

- The Batch stores a headcount and has no individual Animal Register rows.
- The whole Batch occupies one Stage at a time.
- Individual-animal selection and assignment are unavailable and rejected by
  the API.
- Daily activities apply to the whole Batch.
- A whole-Batch Stage or location transfer keeps the Batch together.
- A partial transfer creates a new Count Only Batch.

Batch creation must expose the mode and enforce it end to end. Existing data is
audited rather than inferred from whether Animal rows happen to exist.

## 5. Scheduler-to-workspace hierarchy

Activities are derived from the Scheduler for the exact Batch + Stage pair.
A Scheduler belonging to another Stage cannot contribute cards.

The display hierarchy is:

1. A parent Activity card, grouped by the Scheduler line type such as
   Consumption, Output, Descriptive, Overhead, Resource or Transfer.
2. One sub-card for every Scheduler line due on the selected date.

A Scheduler line is therefore a sub-card, not a parent Activity card. Multiple
daily occurrences such as two feed lines remain separate sub-cards inside the
Consumption parent.

The parent grouping key is `scheduler_line.line_type`; its displayed label is
the localized human label for that type. The sub-card identity is the immutable
Scheduler `line_id` plus the entry date. Two Consumption lines with different
items or occurrence labels are two sub-cards under one Consumption parent.

The Scheduler decides whether a line is due on a date. It does not impose a
time-of-day entry window. A user may enter the day's sub-cards in one session or
across several sessions.

The entry does not ask for or claim the physical time the farm work occurred.
It stores:

- the applicable activity date;
- the Scheduler occurrence label when present;
- automatic Draft, Posted and correction timestamps;
- the responsible users.

An audit timestamp must not be labelled as the activity's actual occurrence
time.

## 6. Card and sub-card states

Each due sub-card has its own persisted state:

`NOT_ENTERED → DRAFT → POSTED`

- Draft saves entered values without creating inventory, GL, cost, animal or
  resource movements.
- Posted creates all consequences in one transaction.
- A Posted sub-card is read-only unless the applicable correction rule allows
  it.
- An identical retry returns the existing result and does not post twice.

One Draft exists per Batch + Stage + Scheduler line + entry date. The Stage is
verified through the line's Scheduler header rather than trusted from a client
field. A Draft stores its scope (`BATCH`, `STAGE_ANIMALS` or
`SELECTED_ANIMALS`) and normalized target-animal rows. Drafts are visible and
editable by any user authorized for that Batch/Stage, carry optimistic
concurrency/version data, survive reload, and create no posting side effects.
After Post, the target-animal snapshot is immutable.

The parent Activity card derives, rather than stores, its aggregate state:

- Not started: no due sub-card has data.
- In progress: at least one due sub-card is Draft or Posted and at least one
  required sub-card remains unposted.
- Complete: every required due sub-card is Posted.

Optional sub-cards do not prevent the parent from becoming Complete.

Every sub-card provides individual Save Draft and Post actions. The parent card
also provides **Post completed sub-cards**. That action selects every filled,
valid Draft sub-card in the parent and posts them atomically. Empty, invalid and
already-Posted sub-cards remain untouched. If any selected sub-card fails, none
of that bulk selection posts.

## 7. Scheduled and unscheduled activities

Scheduled cards are the normal daily path. An authorized user may also add an
unscheduled activity through the same card system. Authorization is permission-
based and independently checked by the API.

An unscheduled transfer has an additional role boundary:

- Tenant Admin, Company Admin and Operational Admin may initiate it within
  their data scope.
- Standard Users cannot initiate an unscheduled transfer.

A scheduled Transfer line remains visible in the relevant Activity card. The
page also exposes a primary **Transfer animals** action for authorized
unscheduled movement. Both use one transfer engine and one audit model.

## 8. Missing entries and History

After midnight in the active company's configured timezone, every required due
sub-card from the previous activity date that is not Posted is Overdue/Missing.
The state is derivable from Scheduler due lines and saved entries; an idempotent
daily check persists one in-app notification per missing Batch + Stage + line +
date. Re-running the check cannot duplicate it. The assigned farm worker and
Operational Admin are recipients, and read state is retained.

The History rail shows dates with meaningful summaries, for example:

- Complete · 8 of 8 Posted
- In progress · 6 Posted · 2 Draft
- Missing · 3 required entries

Selecting a date loads its Activity cards in the main workspace. Ordinary past
viewing is read-only.

A Standard User may enter a previously missing sub-card for any eligible past
date through today without requesting edit access. This is a new entry, not a
correction. Future entries remain forbidden.

## 9. Corrections and edit access

Direct edit scope is:

| User | Direct correction window |
| --- | --- |
| Tenant Admin | All dates inside the tenant scope |
| Company Admin | All dates inside the company scope |
| Operational Admin | All dates inside the assigned LOB scope |
| Standard User | Posted entries dated today only |

A Standard User correcting a Posted entry from an earlier date creates an edit
request. The requester may select multiple specific sub-cards from the same
Batch + Stage + Date. The request snapshots the selected IDs and their current
values.

Approval unlocks only those selected sub-cards for exactly one correction
submission. Unselected cards stay locked. After the correction posts, the
selected cards automatically relock; another correction requires another
request.

A correction never mutates the original posting. It supersedes the original,
reverses its inventory/GL/cost/alert consequences where applicable, and posts a
replacement atomically. History exposes the original, reversal and replacement.

## 10. Transfer scopes

The transfer workflow supports:

- Stage-only movement.
- Location-only movement inside the same farm.
- Stage and location movement together.
- Farm-to-farm movement.
- One, selected, Stage-wide or Batch-wide registered-animal movement as allowed
  by context.
- Whole-Batch movement for Count Only Batches.
- Partial Count Only movement into a newly created Count Only Batch.

The destination may be an eligible existing Batch or a newly created Batch,
except that a partial Count Only transfer always creates a new Count Only Batch
so its lineage and proportional value are explicit.

A newly created Count Only child inherits tenant, company, NOB, LOB, tracking
mode and costing method. The transfer supplies its destination Farm,
farm-specific Breed profile, Stage, Location, start date and moved opening
headcount; its Scheduler is created for the destination Batch + Stage through
the normal Scheduler service. A selected existing destination must be active,
inside the same company/LOB and destination Farm, use the compatible tracking
mode and use the matching destination Breed profile. The API rechecks every
condition while holding the transfer locks.

Every destination validates company, farm, LOB, Batch mode, Breed profile,
Stage and Location hierarchy. A transfer is Draft/Pending until its approval
rule is satisfied. Posting updates the source and destination, animal or
headcount position, carrying value, Stage/location history and audit trail in
one transaction.

## 11. Transfer approvals

| Initiator | Same-farm Stage/location | Farm-to-farm |
| --- | --- | --- |
| Tenant Admin | Auto-approved within scope | Auto-approved within scope |
| Company Admin | Auto-approved within company | Auto-approved within company |
| Operational Admin | Auto-approved within assigned LOB | Approval required |
| Standard User | Approval required; scheduled only | Approval required; scheduled only |

Auto-approved still means fully recorded and posted through the transfer
engine. It does not bypass validation, audit or financial movements.

The person/role authorized to approve a pending transfer is controlled through
the existing Approval permission model. This design does not invent a new
hardcoded approver title.

## 12. Count Only proportional transfer

When `moved_count` of `source_count` animals leaves a Count Only Batch, the new
Batch receives the same proportion of the source Batch's current carrying
value:

`transferred_value = source_carrying_value × moved_count / source_count`

The source keeps the remainder. The calculation uses database decimal
arithmetic. Any rounding remainder remains with the source so the two resulting
values exactly reconcile to the pre-transfer carrying value.

The operation rejects a moved count that is zero, negative or greater than the
available count. It preserves a parent/source Batch link and posts balanced
bio-asset, GL and audit movements.

The source headcount is read and locked when the transfer posts, not copied from
the earlier Draft. A NULL source carrying value is a data-integrity error and
blocks posting. Zero carrying value is allowed and transfers zero value. A
second pending or concurrent transfer cannot consume the same headcount.

## 13. Cross-farm Breed profiles

Breed Code is the normalized Breed Name with spaces replaced by `_`. The same
biological breed uses the same code at every farm. Breed Master uniqueness is:

`Farm + Breed Code`

Location-dependent lifecycle, growth-performance and productive-life values
remain separate on each farm's Breed profile.

When a registered animal or Count Only Batch moves to another farm, the system
matches the destination profile by Breed Code + destination Farm. It records
the source and destination profile references in transfer history.

If no active matching destination profile exists:

1. The transfer remains `DRAFT_BLOCKED` with reason `BREED_PROFILE_REQUIRED`.
2. The request and entered destination are preserved.
3. Tenant/Company administrators and Operational Admins with Breed create or
   update permission in the destination context are notified.
4. Authorized users receive **Create destination Breed profile** with the
   destination Farm and biological Breed identity prefilled.
5. No location-dependent performance or lifecycle values are copied.
6. After creation, the transfer is revalidated and resumes its normal approval
   path.

The API must never silently select another Breed, clone the source farm's
standards or post with a source-farm profile at the destination.

## 14. Requisition relationship

The existing Approval module is real infrastructure, but an approval row is not
itself a Stock Requisition. The MVP should reuse the queue, decision permissions
and audit behavior while keeping the Requisition as a first-class document with
header and item lines.

An approval links to the Requisition rather than copying the Requisition into
free-text fields. Approval or rejection changes the Requisition state through
one transaction. Exact requisition fields, fulfillment and D365BC handoff are
specified in the delivery plan after Rishi confirms that module's remaining
business rules.

## 15. Failure and concurrency behavior

- Posting locks the applicable card/sub-cards and rejects concurrent duplicate
  posting.
- A bulk parent post is all-or-nothing for its selected valid Draft sub-cards.
- A transfer locks source and destination Batches and affected Animals before
  changing counts, locations, stages or value.
- A failed inventory, GL, approval or validation step leaves the card or
  transfer Draft/Pending with no partial business posting.
- Errors name the field or dependency that blocks the action and preserve all
  entered Draft values.
- The browser refreshes counts and statuses from the API after posting; it does
  not calculate authoritative headcounts locally.

## 16. MVP acceptance criteria

The feature is accepted only when browser, API and MySQL evidence demonstrates:

1. Batch creation in both Registered Animals and Count Only modes.
2. A Registered Batch with animals in at least two Stages and correct Stage
   counts.
3. A Count Only Batch with one Stage and no individual Animal rows.
4. Scheduler lines for the exact Batch + Stage rendered as sub-cards beneath
   their Activity parent.
5. Individual Draft/Post and an atomic parent **Post completed sub-cards** flow.
6. One parent Activity remaining In progress after one of two required
   sub-cards posts.
7. Stage-wide default targeting and selected-animal targeting in a Registered
   Batch.
8. Whole-Batch targeting and rejected individual selection in a Count Only
   Batch.
9. Missing-entry detection, worker/Admin notification and later backfill.
10. Same-day Standard User correction, past-date correction request covering
    multiple selected sub-cards, one-time unlock and automatic relock.
11. Direct authorized corrections for Operational, Company and Tenant Admins
    within their respective scopes.
12. Scheduled Standard User transfer approval; rejected unscheduled transfer
    initiation.
13. Operational Admin same-farm auto-approval and farm-to-farm pending approval.
14. Tenant/Company Admin auto-approved transfer within scope.
15. Whole and partial Count Only transfers, with the partial child Batch and
    carrying values reconciling exactly.
16. Registered selected-animal Stage/location movement with unaffected animals
    left in place.
17. Cross-farm movement through a matching destination Breed profile.
18. Missing-profile blocked Draft, permission-based notification, profile
    creation and successful resume.
19. History that retains original, reversal and replacement records after a
    financial correction.
20. Permission and identifier tampering rejected by the API.
21. Stage overview/workspace switching and browser Back preserve Company, Farm,
    Batch, Date and Draft values; a reload restores the persisted Draft.
22. A Draft row and normalized target set are visible in MySQL and create no
    inventory, GL, costing, resource or movement rows before Post.
23. The parent bulk action ignores empty, invalid and already-Posted sub-cards
    and rolls back every selected posting when one selected sub-card fails.
24. Count Only individual assignment, `animal_id` posting and selected-animal
    targeting are rejected by direct API calls.
25. A Registered target snapshot persists the all-Stage or selected-animal set;
    inactive, other-Stage and other-Batch animal identifiers are rejected.
26. Backfilling a missing entry creates no reversal, while correcting an older
    Posted entry creates and links its reversal and replacement.
27. Missing-entry and missing-Breed notifications persist once, name the
    correct recipients, retain read state and do not duplicate on retry.
28. Transfer history persists source/destination Farm and Breed-profile IDs and
    no source-farm lifecycle/performance values are copied.
29. No Activity time field exists and no UI label presents an audit timestamp
    as the physical work time.
30. Operational access requires the exact assigned area and its company/LOB;
    Standard User farm scope and header/identifier tampering are API-tested.

Representative checks cover 1440px, 834px and 390px viewports plus keyboard-
only operation. Tests and typechecks are necessary gates but do not replace the
browser/API/MySQL proof.

## 17. Out of scope

- Other LOB screens.
- Flutter/mobile implementation.
- Claiming an actual physical activity time that the user did not record.
- Automatic copying of farm-specific Breed performance data.
- Future-dated daily entry.
- A temporary transfer that posts without a valid destination Breed profile.
