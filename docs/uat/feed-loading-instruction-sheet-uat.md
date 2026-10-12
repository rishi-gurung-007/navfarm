# Feed Loading Instruction Sheet UAT

Date: 2026-10-09
Worktree: `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`

## Result: PASS (local non-TO workflow)

Migration `0157_feed_loading_sheet` was applied to `nf_devco`. The existing
finalized consolidation `CONS-202641-001` was safely initialized through the
authorized API and created two sheets: `LOAD-000001` and `LOAD-000002`.
`LOAD-000002` was updated through the API with compartment `COMP-01` and
`2,500 KG`; the database records status `LOADED`, preserving its `3,000 KG`
requested/approved allocation. A clean isolated run then completed the full
local path for `REQ-GRA100-2026-00010` (line
`8a2f7756-d419-4638-a7b7-eb4305eda081`):
`CONS-202641-004` → `LOAD-000006` → `TR-000048` → `SH-2026-0039` →
partial receipts `RC-2026-0044` and `RC-2026-0045` (25 KG each). The loading
sheet was created with and transferred the finalized mill-approved quantity of
50 KG, not the original requested quantity when those differ.

The following behaviors are now implemented:

- generate a DRAFT sheet when a consolidation is created (including an
  authorized backfill for an existing sheet);
- link the sheet to requisition lines and later mill-approved quantities;
- require compartment number and KG loaded before dispatch;
- reject mixed bulk diets in one compartment;
- preserve partial loading and dispatch idempotency;
- require a linked shared shipment before dispatch.

The workbook requires these fields and lifecycle states:

`DRAFT → LOADED → DISPATCHED → RECEIVED`

with Loading Sheet No., requisition/line, consolidation reference, farm,
delivery date, diet/item, loading BIN, destination silo, original and
mill-approved KG, compartment, KG loaded, loader/time, shipment reference and
status.

The UI is available at `/inventory/feed-loading`, and the API exposes list,
update and dispatch operations. A posted shipment links to the sheet through
the shared feed requisition shipment path. The clean run verified shipment,
dispatch, partial receipt, final receipt, zero outstanding quantity, and
idempotent over-receipt rejection. Item Master classifications were corrected
through the existing Item Master (`ICAT-004-ITM-0001/0002/0004` are explicitly
classified as BAGGED/BULK for the isolated UAT setup), and the existing
`MILL-001/BIN-001` location was reused. No duplicate location or Business
Central reference was created.

The first run exposed and corrected a real defect: release used the requisition
requested quantity instead of the finalized consolidation mill-approved
quantity. Release now requires every feed line to be present in the finalized
sheet and uses `mill_approved_qty_kg` for the shared transfer.

The loading-sheet status update to `RECEIVED` is now wired to the final receipt
path for subsequent runs. The retained historical `LOAD-000006` row was created
before that correction and remains `DISPATCHED` as an auditable pre-fix record;
its linked requisition and transfer are fully received.
