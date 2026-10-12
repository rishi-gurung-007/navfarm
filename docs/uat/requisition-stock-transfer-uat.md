# Requisition and shared Stock Transfer UAT

Date: 2026-10-09
Worktree: `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`
Database: `nf_devco`

## Common requisition — PASS

Isolated fixture `RQ-00039` (`a464e25a-dd15-4445-a3e5-30ca0ecc085c`) was
created as an ITEM / STORE request from GRA100 to RIC100 for 1 KG of
`ICAT-004-ITM-0004`.

| Operation | Result |
|---|---|
| Create | `OPEN` |
| Submit | `PENDING_APPROVAL` |
| Independent approval | `APPROVED` / `document_status=APPROVED` |
| Release | `TR-000043`, `RELEASED` / `TRANSFER_OPEN` |
| Shipment | `SH-2026-0037`, 1 KG posted |
| Receipt | 1 KG posted; fulfilment `RECEIVED`; outstanding quantity 0 |
| Transfer | `POSTED` |

The generic request did not require a feed consolidation reference. Purchase
requests remain on the Purchase/GRN path.

## Confirmed defect and correction

The first live receipt exposed reuse of an existing local `RC-2026-0037` due to
lexical descending event-number lookup. `StockTransferService.nextEventNo` now
uses a locked numeric `MAX(CAST(... AS UNSIGNED))` allocator. The original
fixture is retained as development evidence; no production data was changed.

## Feed release and local loading — PASS

The clean feed fixture `REQ-GRA100-2026-00010` was approved, finalized in
`CONS-202641-004`, loaded in `LOAD-000006`, released as `TR-000048`, shipped as
`SH-2026-0039`, dispatched, and received in two 25 KG receipts. The requisition
ended `document_status=RELEASED`, `fulfilment_status=RECEIVED`; the transfer
ended `POSTED`; remaining-to-receive was zero. The old fixture
`REQ-GRA100-2026-00008` remains a useful negative record because it was
released before the quantity correction and still carries its original 1,200 KG
transfer against a 1,000 KG consolidation allocation; it is not counted as a
pass.

The transfer quantity correction is covered by the release regression suite.
All three isolated Item Master feed rows were classified through the existing
master API, and the existing mill BIN and date-specific diet assignments were
used. No topology or capacity validation was bypassed.

## Remaining external scope

Business Central Transfer Order import/association and the external TO Receipt
remain BLOCKED/DEFERRED. Local shared shipment/receipt behavior is verified;
no BC success state is fabricated.
