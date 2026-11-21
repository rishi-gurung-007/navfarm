# Showcase demo plan - Triple C, 21 Nov 2026

Tenant `cccshow`, database `nf_cccshow`. Built from the readiness audit (`docs/SHOWCASE-READINESS-2026-11-21.md`) and table counts taken on 21 Nov. Another agent is loading suppliers, customers, daily data, forecast, requisitions, alerts and health; if those now have rows, add the matching pages back in. Nothing here was seen rendering except the API calls noted.

## Click-path (about 15 pages, in order)

1. **Dashboard** `/dashboard`. Open on the farrowing and herd tiles. Say: one view of the herd, 1,828 animals across two farms. Stay off feed, FCR and cost tiles unless daily data has landed.
2. **Master Data - Locations** and **Animal Register**. Say: the client's own farm, shed and pen structure and every animal, loaded from their workbook, each with a code that follows the number series.
3. **Master Data - Items, UoM, Reasons, KPI**. Say: items, units and reasons are configuration, not code. One quick screen, then move on.
4. **Batches** `/batches`. Two foundation-stock batches (renamed from SHOWCASE-*-SOURCE to MULTIPLIER-FOUNDATION-STOCK and PORTA-FOUNDATION-STOCK) plus the working batches. Say: every animal and lot belongs to a batch.
5. **Schedulers** `/schedulers`. 15 active schedulers with lines. Say: the activity plan per stage drives what the operator sees each day.
6. **Livestock - Breeding** `/livestock/breeding`. 4,940 AI matings. Say: full breeding history per sow (the client's Animal History item). Eight recent matings now name their boar.
7. **Livestock - Farrowing** and **Reports - Farrowing** `/reports/farrowing`. 3,814 farrowings, current to mid-November. Say: this is the real production record.
8. **Livestock - AI Station** `/livestock/ai-station` (Boar Selection and Boar Condition tabs). Now has: the body condition scale (5 scores, SOP 21), genetic level bands (4, placeholder TSI ranges), a company default line setup and one pooled semen batch of 42 doses from two boars (19 Nov). Say: the rules are master data, not code. Be clear the TSI ranges are ours, pending the client.
9. **Inventory Balance** `/inventory/balance`. About 215k kg of feed across 10 items. Say: lot-wise stock by location.
10. **Goods Receipt** `/inventory/goods-receipt`. 13 receipts. Say: receipt posts stock and, through GL mapping, a journal. Create one live only if suppliers now exist.
11. **Stock Adjustment** `/inventory/stock-adjustment`. 133 posted. Strongest area; one adjustment live is safe.
12. **Stock Transfers** `/inventory/transfers`. 34 transfers with shipment and receipt matching.
13. **Inventory Ledger** `/inventory/ledger`. 209 rows. Say: every movement is a ledger row, traceable to its document.
14. **Slaughter / Kill Sheets** `/livestock/slaughter` and `/batches/kill-sheets`. 2 closed transfer orders, 351 carcasses. Say: from live pig to carcass with the kill sheet imported.
15. **Finance - Journal, Trial Balance, Balance Sheet** `/finance/journal`, `/finance/trial-balance`, `/finance/balance-sheet`. 211 posted journals; debits equal credits (5,830,795.17 each). Say: stock and slaughter movements post to the ledger automatically. Warn yourself, not the room: P&L is dominated by one large "Inventory Adjustment Gain" (about 5.39M, the opening stock load), there is no cost of sales against the 83k pig sale, and there is no equity or bio-asset account. Keep to the journal and trial balance; show Profit & Loss only if asked.

Optional last stop: **Bio-Asset Ledger** `/inventory/bio-asset-ledger` (88 rows, about 370k).

## Skip these - they are empty (re-check if data has been added)

Counts on 21 Nov, all 0 in `nf_cccshow`:

| Screen | Why it is empty |
|---|---|
| Logistics (Trips, Dispatch) | all `logistics_*` tables empty |
| FA Conversions `/finance/fa-conversions` | `fa_inventory_conversion` 0; no fair-value rates |
| Batch Cost Variance `/finance/batch-cost-variance` | `batch_cost_variance` 0; batch totals are NULL |
| Bio Costing Runs `/finance/bio-costing-runs` | `bio_costing_run` 0 |
| QC Inspection `/inventory/qc-inspection` | `qc_inspection` and QC parameters 0 |
| Notifications `/notifications` | `notification_log` 0 |

Also thin today, so avoid unless the other agent's seeding has landed: Feed Forecast and its tabs, Requisitions, Approvals, Alerts, Expenses, Traceability, Monthly Ops report, Suppliers and Customers masters, Gilt Class Rules (0 rows; see below), UoM Conversions, Exchange Rates.

## Known soft spots to avoid or explain

- Gilt Class Rules is still empty. A rule needs a gilt item with a costing method, and `BIO-SWINE-GILT` has none (no living-asset item does). Setting one is a costing decision for the client, so it was not done.
- AI Station Tempo, L-Line and Z-Line setups were skipped: those breeds do not exist in this tenant (only TN-70-SOW, Z-LINE-SOW and TEASER-BOAR).
- Boar links on matings: only 8 of 4,940 carry a boar. The workbook names most boars as `L1`, `L2` or a truncated `BLXB0...`, which cannot be matched to a single boar.
- The foundation-stock batch names are descriptive, not `BATCH-0000NN`, so the batch number series is unaffected.
