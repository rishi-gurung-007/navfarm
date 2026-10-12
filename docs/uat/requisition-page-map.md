# Feed Forecast and Requisition page map

Reviewed 2026-10-09 against the workbook `NAVFarm_Feed forecast TDD with examples (1).xlsx` and the current worktree routes.

| Page | URL | Purpose / status | Main source |
|---|---|---|---|
| Feed Forecast | `/inventory/feed-forecast` | Dashboard, calculation, feed plan, requisition and physical stock-count tabs. Working; visible write-path UAT still needs dedicated browser coverage. | `feed-forecast/page.tsx`, `feed-forecast-panel.tsx` |
| Feed Requisitions | `/inventory/feed-requisitions` and Feed Forecast `?tab=feed-requisition` | Feed-only list/detail, approval, consolidation reference and shared transfer actions. Working through API; UI browser write path unverified. | `feed-requisitions/page.tsx`, `feed-requisition-document.tsx` |
| Feed Plan | Feed Forecast `?tab=feed-plan` | Tentative/actual plan from saved runs and approvals. Working in API/web tests. | `feed-plan-panel.tsx`, `feed-plan.service.ts` |
| Feed Loading Sheets | `/inventory/feed-loading` | Loading BIN, diet, compartment, loaded KG and dispatch state. Working; final receipt status needs a fresh post-fix run. | `feed-loading/page.tsx`, `feed-loading.service.ts` |
| Mill Consolidations | `/inventory/feed-consolidations` | Feed-only eligible selection, creation, adjustment and finalization. Working through API; visible browser write path unverified. | `feed-consolidations/page.tsx`, `feed-consolidation-dialog.tsx` |
| Physical Stock Count | Feed Forecast `?tab=physical-count` | Dated count, variance reason, approval and ledger posting. Working in API/web tests. | `feed-stock-count-panel.tsx`, `feed-stock-count.service.ts` |
| Common Requisitions | `/requisitions` and `/inventory/requisitions` | Generic item/fixed-asset/service requisitions; approval, release, shipment and receipt. Existing isolated workflow passed. | `requisitions/page.tsx`, `common-requisition-detail.tsx` |
| Approvals | `/approvals`, `/approvals/pending`, `/approvals/requisitions` | Authorized approval/rejection inbox. Working; permission edge cases need browser coverage. | `approvals-page-shell.tsx`, approval API |
| Stock Transfer | `/inventory/transfers` | Shared transfer documents and shipment/receipt operations. Working; used by common and feed paths. | `transfers/page.tsx`, `stock-transfer.service.ts` |
| Stock Balance | `/inventory/balance` | Ledger-derived balances. Working API path; full page visual UAT not yet evidenced. | `balance/page.tsx` |
| Goods Receipt | `/inventory/goods-receipt` | General inventory receipt path; feed receipt intentionally uses shared Stock Transfer, not feed GRN. | `goods-receipt/page.tsx` |
| Inventory Ledger | `/inventory/ledger` | Ledger list and `/inventory/ledger/[id]` detail. Working API; visual UAT not complete. | `ledger/page.tsx` |
| Stock Adjustment | `/inventory/stock-adjustment` | General stock adjustment. Related to, but distinct from, physical feed count. | `stock-adjustment/page.tsx` |
| Farm/Location Master | `/master-data/location` | Farm, shed, silo, store, mill and BIN locations. Existing locations reused; topology validation is active. | `master-data/[key]/page.tsx`, location API |
| Item Master | `/master-data/item` | Feed item code, description, feed type and diet metadata. Bulk/Bagged classification was corrected through this master. | `master-data/[key]/page.tsx`, item API |
| Feed settings | `/company/settings/feed` | Forecast horizons, truck target, bulk multiple and alert settings. Working configuration surface. | `company/settings/[section]/page.tsx` |
| Inventory setup / BIN configuration | `/settings/inventory-setup` | Inventory setup and silo-feed configuration; BIN diet assignment is API-backed and needs fuller page evidence. | `settings/inventory-setup/page.tsx`, bin assignment API |
| Reporting periods | `/settings/reporting-periods` | Period dates, stock-take date and production start date. Related workbook requirement; not part of the completed write-path UAT. | reporting-period route/API |
| Alerts | `/inventory/feed-alerts` | Feed alerts and shortage notifications. Implemented; visual notification delivery not fully browser-tested. | `feed-alerts/page.tsx` |

## Workflow connections

Common requisitions use `Create → Submit → Approve → Release → shared Stock Transfer → Shipment → Receipt → Inventory Ledger`. Purchase requisitions retain the Purchase/GRN path and do not enter feed consolidation.

Feed uses `Forecast or Manual → Requisition → Approve → Feed-only Mill Consolidation → Loading Sheet → Finalize → Release → shared Stock Transfer → Shipment → Loading Dispatch → Receipt → Inventory Ledger → forecast/plan refresh`.

The workbook also requires multi-farm forecast isolation, configurable reporting periods, silo/house mappings, item-to-diet and BIN assignment validation, physical count adjustments, and no double-counting of shipped versus received stock. Those requirements are not all proven by the prior API run: the visible Playwright page-by-page pass, permission matrix, both feed types, and the complete reporting-period/page review remain verification work.
