# NAVFarm demo readiness — 2026-10-09

## Demo sequence

Use the running worktree applications at `http://localhost:3002` and API at
`http://localhost:2877`.

1. Open `/inventory/feed-forecast?tab=calculation` and show the selected farm,
   date range, shortage rows, Notes and Run History.
2. Open `/inventory/feed-forecast?tab=feed-plan` and show the saved plan.
3. Open `/inventory/feed-forecast?tab=feed-requisition` and open
   `REQ-GRA100-2026-00010` for the clean approved feed example.
4. Open `/inventory/feed-consolidations` and choose **View** on
   `CONS-202641-004`. The detail shows requisition, farm, destination, feed
   item, requested/approved KG, adjustment reason and loading-sheet reference.
5. Open `/inventory/feed-loading` and show `LOAD-000006`, its readable farm,
   destination, item, BIN, requested/approved KG, shipment reference and
   dispatched status.
6. Open the shared transfer page `/inventory/transfers` and show `TR-000048`
   and shipment `SH-2026-0039`.
7. Open `/inventory/ledger` to show the shipment and receipt ledger entries.
8. Open `/requisitions` and show the independent common requisition
   `RQ-00039`; it does not require consolidation or a loading sheet.

## Existing UAT references

These references were recorded by the previous authenticated UAT. Do not
recreate or repost them during the demo:

- `RUN-VIL100-20261009-001`
- `REQ-VIL100-2026-00005`
- `CONS-202641-004`
- `LOAD-000006`
- `REQ-GRA100-2026-00010`
- `TR-000048`
- `SH-2026-0039`
- `RQ-00039`

The clean feed path reconciled 50 KG approved, 50 KG shipped and two 25 KG
receipts. The transfer ended `POSTED` and the requisition ended `RECEIVED`.

## Demo-facing fixes in this pass

- Loading sheets no longer display farm, requisition, silo, feed item or BIN
  UUIDs as the primary labels. The API now supplies readable codes/names while
  retaining UUIDs internally.
- Loading-sheet quantities display consistently as `KG` values with thousands
  separators.
- Loading-sheet tables have minimum widths, readable wrapped descriptions,
  aligned action columns and clear status pills.
- Consolidation rows now have an explicit **View** action rather than relying
  on an invisible row click.
- Consolidation detail now shows readable requisition/farm/destination/item
  labels, requested and approved KG, adjustment reason and linked loading sheet.
- Existing finalized-sheet restrictions and transaction services were not
  changed.

## Verification

| Area | Result |
|---|---|
| API typecheck | PASS |
| Web typecheck | PASS |
| Feed/requisition focused web tests | PASS — 68 tests |
| API regression suite before this UI-only pass | PASS — 2,574 tests |
| `nf_devco` read-only connectivity | PASS — MySQL returned the tenant database and 65 requisitions |
| API health | PASS — `GET /api/v1/health` returned HTTP 200 and `status: ok` |
| Authenticated API smoke | PASS — requisitions, feed requisitions, consolidations and loading sheets each returned HTTP 200 |
| Existing demo-record re-query | PASS — all listed requisition, consolidation, loading, transfer and shipment references were found |
| Web service | PASS — worktree web service listening on port 3002; unauthenticated page redirect is expected |
| Headed Playwright smoke | PARTIAL/BLOCKED — browser launched, but unrelated legacy master-data assertions failed and Firefox/WebKit shell readiness timed out; no feed transaction was changed |
| Live record re-query | PASS — completed with read-only database/API checks; the earlier failure was sandbox network isolation, not a stopped service |

## Current service evidence

- MySQL is listening on `127.0.0.1:3306` (mysqld PID 958).
- The API is listening on port 2877 (node PID 58635), with its working
  directory in this worktree and established MySQL connections.
- The web app is listening on port 3002 from this worktree's `apps/web`
  directory.
- No service was restarted, killed, reseeded or migrated during this check.

The authenticated smoke checked these read-only endpoints:

- `/api/v1/requisition`
- `/api/v1/feed-requisition`
- `/api/v1/feed-requisition/consolidations`
- `/api/v1/feed-requisition/loading-sheets`

The database re-query confirmed the following existing references: `RUN-VIL100-
20261009-001`, `REQ-VIL100-2026-00005`, `CONS-202641-004`, `LOAD-000006`,
`REQ-GRA100-2026-00010`, `TR-000048`, `SH-2026-0039` and `RQ-00039`.

## Fallbacks and limitations

- If the browser automation bridge remains unavailable at demo time, use the
  existing UAT documents as fallback evidence and open the listed records
  manually. No new page screenshots were captured in this pass because the
  headed-browser automation bridge could not provide a stable window target.
  Do not create or repost transactions solely for the demo.
- Business Central and external TO integration are excluded.
- `LOAD-000006` is a historical pre-fix row whose loading status is
  `DISPATCHED`; its linked requisition and transfer were verified fully
  received. A later clean run should be used to demonstrate the new automatic
  `RECEIVED` loading-sheet transition.
- The headed Playwright failures were in legacy master-data/formula coverage,
  not in the feed forecast, requisition, consolidation, loading or transfer
  screens. They remain a test-suite limitation for this rehearsal, not a
  reason to alter the working demo data.
