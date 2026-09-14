# Internal Review MVP Cut

**Decision date:** 2026-09-15  
**Internal review:** 2026-09-15 20:00 IST  
**MVP checkpoint:** 2026-09-18 10:00 IST

## Outcome

The internal-review build must behave normally on the paths that are shown. A
smaller coherent workflow is preferable to exposing unfinished modules. Work
after the review continues toward the 18 September presentable MVP; this cut
does not redefine the client's final requirements.

## Review path

The review will demonstrate one explicit farm context and a small piggery data
set:

1. Sign in and select or display the active farm.
2. View a farm-specific Breed.
3. View or create a Batch with an explicit farm, initial Stage, and tracking
   mode.
4. Show a Registered Animals batch whose animals have explicit records.
5. Show a Count Only batch without Animal rows.
6. Open the relevant operational views and confirm that other farms and LOBs do
   not leak into the result.

Daily entry, same-farm transfer, and breeding traceability may be added to the
review path only after their safety checks pass. Cross-farm transfer,
requisitions, feed forecast, and resource ledger are not review promises.

## Safety invariants

- Every demonstrated operational read and write is restricted by tenant,
  company, LOB, and active farm where applicable.
- A Breed used by a Batch or Animal belongs to that Batch's farm.
- A Batch has an explicit farm, tracking mode, and initial Stage.
- Count Only batches never contain Animal rows.
- Registered Animals are created from explicit animal data. Opening quantity
  does not manufacture sex, type, value, or other client facts.
- Animal placement changes do not bypass the transfer workflow.
- Multi-row accounting and lifecycle operations are atomic or withheld from
  the review path.
- A failed or refused write is checked in MySQL, not inferred from an HTTP
  response alone.

## Containment before expansion

The post-handoff review identified unsafe report, transfer, animal-placement,
and batch-lifecycle paths. The order of work is:

1. Correct high-confidence scope and placement bypasses.
2. Add regression tests for each corrected path.
3. Finish the minimal farm/Breed/Batch-mode foundation.
4. Build deterministic review data through supported services.
5. Run serial Nx verification, restart only exact server PIDs if required, and
   drive the browser plus MySQL.

If an accounting workflow cannot be made atomic and verified before the
meeting, it remains outside the review script rather than being represented as
complete.

## Presentation rules

- Do not expose placeholder or invented Triple C data.
- Do not show unfinished navigation destinations as completed features.
- Label deferred work plainly in the handoff.
- Preserve the running web and API development environment unless memory is
  genuinely red.
- On the 8 GB machine, agents edit only; the lead runs builds, tests, servers,
  and database probes serially.

## Definition of the 20:00 checkpoint

- The chosen review path has fresh automated evidence and a browser walkthrough.
- Database reads confirm created and refused writes.
- The repository contains a concise handoff with commit, test, live-check, and
  known-gap information.
- Anything not verified is described as remaining work, not complete work.
