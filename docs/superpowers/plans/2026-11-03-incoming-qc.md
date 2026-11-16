# Incoming QC — the item's inventory entry is written when the inspection is completed (3 Nov 2026)

**Status:** plan and build started 3 Nov. Nothing here is a client document: the reference is the Business Central QC
(QC Specification Master List and QC Inspection Order) the previous developer built, shown to us as screenshots. Rishi has
not confirmed scope — see "Questions". Label everything below as **ours**, not as a requirement.

## Status (3 Nov, end of day) — built for the GRN path, proved on the running app; **not committed**

Migration `0239_incoming_qc` (applied to nf_system and nf_devco). Item flag + QC Specification dialog, inspection API and screen
(**Inventory → QC Inspections**), GRN post deferral, deviation approve/refuse.

**Proved against MySQL (nf_devco), then every row removed and the number series put back:** a QC item with no spec is refused at
post and the GRN stays DRAFT; after a post `inventory_ledger` has 0 rows for the receipt; a failed lot rejected whole writes none; a pass
of 90 of 100 writes one entry of 90 and a 63.00 journal; a deviation writes none until a second user approves (the inspector gets 403),
then 20 and a 14.00 journal; a non-QC item still posts straight away. Completed once more in the browser (36 of 40 accepted): ledger
row 36 at 0.70 = 25.20. Counts after cleanup equal those before (461 ledger, 989 journals, 16 GRNs).

**Revised 3 Nov (Arun):** the QC Specification is also available on a *new* item (checks are held by the form and saved with the item
through `qc_specs` on `POST /item`; a new QC-required item must have at least one). A check is now **QC Code, Description, QC Type
(Value / Descriptive), Min, Max** — a Descriptive check's Description is its rule; stage, UOM and mandatory are no longer on the screen
(defaults INCOMING / item UOM / mandatory). Proved by creating an item in the browser and reading `item_qc_spec_line`.

**Semen collection (3 Nov, Arun):** a collection whose output item is QC required no longer writes the ledger entry or journal: it raises
an inspection (source `SEMEN_COLLECTION`, migration `0240`) and the lot is held (`semen_batch.inventory_posted = 0`). An AI mating on a
waiting or failed lot is refused (`SemenLotService.assertNotHeldByQc`). On completion the accepted doses are written as the collection
would have (`BREEDING` / `OUTPUT`, `BIO_SEMEN_PRODUCTION` when mapped, the boar's batch no.), `inventory_posted` becomes 1, and a part
acceptance sets `doses_collected` to the accepted doses with a note. Proved on the running API: 20 collected, 0 ledger rows, mating refused,
18 accepted → one 18-dose entry and a 13.50 journal, mating then allowed (and issued 1 dose); a failed lot writes nothing and cannot be
used; a non-QC item posts at once. All test rows removed afterwards (ledger 461, journals 989, semen lots 25) and the LOT, QR, journal
and item counters put back. The lot's QR is still made at collection (it is not voided if the lot fails).

**Transfer receipt (3 Nov, Arun):** both ways a transfer is received now honour QC — the Transfer Order's own **Receive** (`TRANSFER_RECEIPT`) and a
**receipt against a shipment** (also what Direct Transfer and requisition/feed receipts call; `TRANSFER_EVENT`, one layer per serial on acceptance).
For a QC-required item the good quantity writes no ledger entry: an inspection holds it (migration `0241`: the unique source index becomes a plain one
because a line can be received in parts; the inspection also keeps the amount it takes out of In Transit and the source location). A pending inspection
counts as received on the transfer (`pendingQcReceipts`), so the order closes as RECEIVED and cannot be received twice; a closing receipt takes the
remaining In Transit value less what is still pending (`pendingQcAmount`). On acceptance the accepted part is written at the destination; the **rejected
part is returned to the source location at its cost** (the same return a short-closed transfer makes, `returnRejected`), so In Transit nets to zero. DOA is
unchanged: the DOA part is received and written off at once, only the good part waits. Proved on the running API (B: 60 held, 50 accepted + 10 returned,
journals 42 = 35 + 7 on 1040; C: direct transfer; D: failed lot returns to the source; E: 8 good + 2 DOA). All rows removed afterwards.
**Not yet:** the Transfer Order *Close* path (return/write-off in transit) is untouched, as is a QC item arriving by mill output, batch output or
stock adjustment. The Goods Receipt, semen collection and transfer receipt are the three covered.

**Not done:** stock-transfer receipt (now done, above), mill output, batch output and stock adjustment still write the ledger directly (phase 5 above).
The Reason picker lists every reason, none of them QC (CUL-001 "LEGS" was used in the test) — a QC reason category is a question for Rishi.
Rejected quantity is not posted anywhere. The API suite has 3 failures in files outside this change (`breeding.controller.spec`,
`bio-asset-entry-types.spec` on `animal.service.ts`, `farm-scope-coverage.spec` on `fa-conversion.controller.ts`); the web suite has
`breeding-rules.spec` and `animal-details-modal.spec`, all in work that was already uncommitted.

## The rule (from Arun, 3 Nov)

If an item has **QC required**, the Inventory Ledger Entry (ILE) is **not** written when the stock arrives. A QC inspection
is raised instead. The ILE (and its G/L journal) is written **only when the inspection is completed and the quantity is
accepted**. In the BC screen the inspection's "ILE No." is 0 until then — the same thing.

This is simpler and safer than holding stock in the ledger with a flag: nothing is issued, costed, counted in a silo or
forecast as "incoming" until it has passed, because it does not exist in the ledger yet.

## Reference (BC) → what we build

| BC | NAVFarm |
|---|---|
| Item QC specification list: stage, measurement code/description, sampling type Value/Descriptive, min, max, comment, line no | `item_qc_spec_line` + a **QC Specification** tab on the Item card; flag `item_master.is_qc_required` |
| QC Inspection Order (document no, PO no, receipt no, item, qty, sample/accepted/rejected qty, reason, deviation, user, approved user, ILE No.) | `qc_inspection` (+ `qc_inspection_line`, a snapshot of the spec) and **Inventory → QC Inspections** |
| Posted purchase receipt creates the inspection | GRN **post** raises one inspection per QC-required line instead of writing the ledger |
| Accept moves stock to the accepted location | Accepted quantity is written to the ledger at the GRN's location on completion |

## Fields

- `item_master.is_qc_required` boolean, default false.
- `item_qc_spec_line`: item, `line_no` (10000-step), `stage` (default INCOMING), `measurement_code`,
  `measurement_description`, `sampling_type` VALUE | DESCRIPTIVE, `uom`, `min_value`/`max_value` (VALUE only),
  `acceptance_text` (DESCRIPTIVE only), `is_mandatory`, `is_active`. VALUE needs a min or a max; DESCRIPTIVE needs text.
  Unique (item, stage, measurement_code) among live rows.
- `qc_inspection`: `inspection_no` (Number Series QC_INSPECTION), `status` OPEN | PENDING_APPROVAL | CLOSED,
  `result` PASS | FAIL | DEVIATION, source (`source_doc_type`, `source_doc_no`, `source_line_id`, `supplier_id`, `po_no`
  from the GRN's external reference), item, lot/serial/expiry, `quantity`, `uom`, `rate`, `price_variance`,
  `warehouse_id`, `sample_qty`, `accepted_qty`, `rejected_qty`, `reason_id`, `deviation`, `posting_date`,
  `inspected_by/at`, `approved_by/at`, `ledger_entry_id` (the ILE, null until it is written).
- `qc_inspection_line`: the spec copied at the time (code, description, type, uom, min, max, text, mandatory) +
  `actual_value`, `actual_text`, `result` PASS | FAIL, `remarks`.

## Flow

1. Item: tick QC required, add spec lines. An item with the flag and no active spec line **cannot be received** (clear message).
2. GRN post: for each non-bio line of a QC item, no ledger entry, no journal; an OPEN inspection is created with the spec
   copied in, carrying everything needed to post later (rate after any standard-cost variance, lot, serial, expiry, location).
   Other lines of the same GRN post as today.
3. Inspector completes it: VALUE lines are judged by the system against min/max; DESCRIPTIVE lines are marked by the
   inspector. Sample/accepted/rejected quantities entered; accepted + rejected = quantity.
4. All mandatory lines pass → CLOSED/PASS; accepted quantity is written to the ledger and journalled (the same calls the
   GRN used), `ledger_entry_id` stored.
5. A failure → accepted must be 0 and the lot is CLOSED/FAIL with **no ledger entry** — unless the inspector asks for a
   **deviation** (reason required) → PENDING_APPROVAL; a **different** user with approve permission releases it, and only
   then is the accepted quantity written.
6. Rejected quantity is never written to the ledger (it goes back to the supplier / is scrapped; no stock, no value).
   Recorded on the inspection with its reason.

## Phases

1. Migration 0239 + schema, item flag, spec-line API and tab. 2. Inspection service, GRN post deferral, completion,
deviation approval. 3. Web: Item QC tab, QC Inspections list and form, nav and permission. 4. Tests; **prove by posting a GRN
through the API and reading MySQL**: no `inventory_ledger` row after post, one after a passing completion, none after a
failing one. 5. **Not in this pass — other inbound paths** (stock-transfer receipt, mill output, batch output, stock
adjustment): each has its own costing and DOA/by-product logic. The service is written so a path can adopt it (it stores
the document type and the ledger parameters), but wiring each is its own verified step.

## Questions for Triple C / Rishi (not answered by us)

- Is incoming QC in scope for the piggery programme, and for which inbound sources beyond the GRN?
- Rejected stock: back to the supplier (what we do now — no entry), or held in a rejected location as BC did? *(12 Nov: until answered, the inspection records Return to supplier / Scrap / Hold for a decision, posting nothing; decisions.md 12 Nov.)*
- Deviation: who approves, and is a reason mandatory?
- Are specifications ever per supplier or per grade (BC had a Customer column and two `Si` rows with different ranges)?
- Is sample quantity a rule (a % or a count per lot) or typed by the inspector?
