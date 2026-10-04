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
