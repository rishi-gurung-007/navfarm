# Plan — Semen QC: five checks over collection day + 4 days, and a QC at the farm before insemination

**Date:** 23 Nov 2026 · **Asked by:** the client (via Arun) · **Status:** DRAFT. Nothing built. Open questions below are the client's to answer; Phase 1 cannot be finished until Q1 is answered.

## The two asks, as the client wrote them

1. *Semen QC in 4 parts for 4 days for clear pass (collection day + 4 days for QC).*
2. *Semen QC needed at the farm when reached and before insemination.*

## What exists today (read from the code, 23 Nov)

- A semen lot of a QC-required item raises **one** `qc_inspection` at collection (`semen-lot.service.ts`, `source_doc_type = 'SEMEN_COLLECTION'`, `source_line_id = semen_batch_id`). Its check lines are copied from `item_qc_spec_line` (every active line, whatever its `stage`).
- Completing it is all-or-nothing for the whole lot (the dialog no longer asks for sample/accepted/rejected quantities): pass posts the ledger entry (`postAccepted`), fail posts nothing. `assertNotHeldByQc` blocks `issueDoses` (AI mating) until the inspection is CLOSED **and** has a `ledger_entry_id`.
- A transfer receipt of a QC-required item already raises its own inspection (`TRANSFER_RECEIPT` / `TRANSFER_EVENT`, migration 0241). Whether that fires for a semen lot sent to a farm, and whether it gates insemination at the farm, is **not verified**; Phase 0 below checks it by driving the app.
- `item_qc_spec_line.stage` and `qc_inspection_line.stage` exist (default `INCOMING`) but nothing reads them.

## Interpretation (to confirm — Q1, Q2)

- **Part 1:** one lot, five dated checks: day 0 (collection) and days 1 to 4. Each check records a reading per QC parameter. The lot is a **clear pass** only when all five are done and passed. Any failed mandatory check fails the lot (consistent with the whole-lot rule: fully accepted or fully rejected).
- **Part 2:** a separate inspection when the lot arrives at a farm, raised on the receipt, completed before the first mating that uses it at that farm.

## Design

### A. Rounds inside one inspection (part 1)

New table `qc_inspection_round` (`inspection_id`, `round_no` 0..N, `due_date`, `status` PENDING/DONE, `result`, `inspected_by`, `inspected_at`, `remarks`) and `round_no` on `qc_inspection_line`.

- `raise()` takes `rounds` (a number from the item's QC setup, default 1 so every existing source behaves as today). For N > 1 it creates one set of lines per round and N round rows with due dates (collection date + round_no).
- The inspection stays OPEN while rounds are pending. Recording a round saves its readings and result without posting anything. The **last** round completes the inspection: all pass gives PASS and `postAccepted`; any fail gives FAIL and rejects the whole lot. A failed round may close the inspection early as FAIL; the remaining rounds are cancelled.
- Where the number of rounds lives: on the item's QC setup (`item_master`, a small `qc_rounds` column), not in code. "Nothing the client gave is a constant" (AGENTS.md §10).
- A daily "QC due" list: rounds due today or overdue, so the checks are not forgotten. Reuses the QC Inspection list with a Due filter; no new screen.

### B. Whether doses can be used before the clear pass (Q1 decides this)

- **Option 1, hold until clear pass:** no stock until day 4. Simplest and matches today's gate. Boar semen is commonly short-lived (days, not weeks), so this may leave little usable life. The item's `shelf_life_days` and the 4-day hold must be checked against each other; if the hold leaves less than a day or two, the client probably means Option 2.
- **Option 2, release on day 0 and recall on a failed round:** post stock at the day-0 pass, keep the inspection OPEN for days 1 to 4, and on a later fail raise a recall: block unused doses, list matings and transfers that already used the lot. This is more work (reversal of unused stock, a recall report) and carries accounting risk (cost already issued to matings).
- Build Option 1 first (Phase 1). Option 2 is Phase 4 and only if the client says so.

### C. Farm receipt QC (part 2)

- A second stage. `item_qc_spec_line.stage` gets a meaning: `COLLECTION` (rounds above) and `FARM_RECEIPT`. `raise()` selects spec lines by stage; existing sources keep `INCOMING`.
- On the transfer receipt of a semen lot at a farm store, raise a `SEMEN_FARM_RECEIPT` inspection with the `FARM_RECEIPT` checks (one round).
- The AI-mating gate (`assertNotHeldByQc`) also requires, for a lot that was transferred, that the inspection for the **sow's farm** location is passed. Rejected doses go through the existing disposition (return to source or scrap) and feed the "Destroyed" figure of the AI Station report (separate plan).

## Phases

0. **Verify what already happens.** Drive the running app: collect a semen lot of a QC item, send it to a farm by stock transfer, receive it, try an AI mating. Read MySQL after each step. Record what raised an inspection and what gated. Output: a short note appended here. No code.
1. **Rounds (Option 1).** Migration `0263_qc_inspection_rounds` (mind the unique foreign-key name guard in `foreign-key-names-unique.spec.ts`), `qc_rounds` on the item, `raise()` and `complete()` changes in `qc-inspection.service.ts` and pure rules in `qc-inspection.rules.ts` (with specs), the dialog gets a round tab strip, the list gets a "Rounds 2/5" column and a Due filter.
2. **Farm receipt QC.** Stage on the spec lines (item QC Specification tab gets a stage field), raise on receipt, gate in `semen-lot.service.ts`, link and status shown in the semen list and traceability exactly as the collection QC is (`QcLink`).
3. **Proof.** Through the API and the web app, read back from MySQL; rolled back by tag only (see the 2 Nov rule in AGENTS.md §10). Cases: five passing rounds then stock and mating allowed; a failing day-2 round rejects the lot and no stock is posted; mating blocked at day 3; farm receipt pending blocks mating at that farm, passes allows it; a lot with no QC and a non-semen QC item behave exactly as before (rounds = 1).
4. **Only if Q1 is "release on day 0":** recall flow (Option 2).

## Files expected to change

`apps/api/src/core/database/schema.ts`, a new migration, `qc-inspection.service.ts` / `.rules.ts` / `dto`, `semen-lot.service.ts`, `stock-transfer.service.ts` (receipt raise), the item QC spec service and DTO, `qc-inspection-panel.tsx`, the item QC Specification form, `breeding-panel.tsx`. The QC dialog's whole-lot behaviour (no partial quantities) is kept.

## Risks

- Posting stock only at the last round moves the ledger date. The posting date is the completion date, not the collection date; confirm the costing and expiry (from collection date) read correctly.
- A lot whose inspection stays OPEN for four days must not block other work: the doses already count as "collected" in the AI Station totals but not as usable. The semen list should show "QC 2/5" so this is visible.
- Existing open inspections have no rounds: they must keep working as a single round.

## Questions for the client

1. **Can doses be used or sent before the clear pass, or only after day 4?** Boar semen has a short shelf life; if the hold is the full four days, how many days are left to use it?
2. **"4 parts for 4 days":** five checks (collection day plus four), or four checks in total? Are all parameters checked every day, or different ones on different days?
3. Who does the daily checks, and may a different person than the collector do each?
4. If a day-2 check fails, is the whole lot rejected, including doses already sent to farms (needs a recall)?
5. **Farm QC:** what is checked at the farm (motility under the microscope?), by whom, and does a failure need an approval before the doses are destroyed?
6. Does the farm QC apply to every lot that reaches a farm, or only to lots that have not already had the full collection QC cleared?
