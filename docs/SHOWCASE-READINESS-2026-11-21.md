# Showcase readiness audit - Triple C piggery demo (21 Nov 2026)

Read-only audit. Nothing was edited and no database was written to. Data claims come from `SELECT` row counts and samples on local MySQL `nf_cccshow`. Page behaviour comes from reading the code: the nav in `apps/web/src/app/(app)/layout.tsx`, the page files, and the API services. The API was **not running** and I did not drive the UI, so no page was seen rendering.

Tags: **[D]** verified in data. **[C]** inferred from code only, not seen rendering.

## 0. The finding that shapes everything

`nf_cccshow` is the real-client import (commit f6b2c71e split the real import from the demo fabrication). It is rich in master and herd data and almost empty in transactional activity. `nf_ccc` is the older full-activity demo tenant. Counts for the tables that decide most pages **[D]**:

| Table | nf_cccshow | nf_ccc |
|---|---|---|
| animal_register | 1,828 | 74 |
| breeding_record | 4,940 | 393 |
| farrowing_record | 3,814 | 310 |
| batch_header | 17 | 400 |
| batch_daily_data | **0** | 108,706 |
| batch_transaction | **0** | 79,249 |
| feed_forecast_run | **0** | 9 |
| feed_plan | **0** | 5 |
| feed_alert | **0** | 101 |
| requisition | **0** | 9 |
| approval_request | **0** | 15 |
| logistics_trip | **0** | 10 |
| expense_document | **0** | 4 |
| supplier_master | **0** | 3 |
| customer_master | **0** | 2 |
| parameter_master | **0** | 4 |
| qc_parameter_master | **0** | 4 |
| alert_rule | **0** | 5 |
| semen_batch | **0** | 2 |
| accounting_period | **0** | 13 |
| gm_budget | 100 | 400 |

If tomorrow's demo is run on `nf_cccshow` as it stands, about 12 of the sidebar destinations open to an empty table.

Other facts **[D]** about `nf_cccshow`:
- 1,514 sows, 291 gilts and 23 boars, all ACTIVE.
- Breeding dates run 2021-11 to 2026-11-11 and farrowing dates to 2026-11-15, so the herd data is fresh.
- Every `breeding_record.boar_animal_id` is NULL (0 of 4,940 have a boar). Boar-based AI and boar performance views have nothing to join.
- Every batch has `total_cost = NULL`. All 17 batches are ACTIVE: 12 at the Multiplier farm and 5 at Porta.
- All 36 `reporting_period` rows are DRAFT. There are no OPEN periods and no `accounting_period` rows.
- 4 users, all assigned the Super Administrator role.
- `role_permissions` has no REPORTS, LOGISTICS or REQUISITION module codes. Admin user types bypass the check, and Super Administrator holds ALL [C], so this does not block the demo users. It would block the six named roles.
- 15 schedulers are ACTIVE with 124 lines. `batch_stage_log` is 0.
- Inventory: 10 feed items with positive lots (about 215k kg); 209 inventory ledger rows; 133 stock adjustments; 34 transfers; 13 goods receipts, none with a supplier.
- Finance: 211 journals from four sources (stock transfer, stock adjustment, goods receipt, slaughter) against 25 GL accounts and 12 mappings.
- Slaughter: 2 closed transfer orders, 2 kill sheet imports, 351 carcasses. `ear_tag` is NULL on all 351 carcasses.

## 1. Grading scale

- A: meaningful data, flow works as far as code shows.
- B: works, thin or partly dated data.
- C: page works but a visible part is empty.
- D: mostly empty or needs data entry live.
- F: broken or absent.

Effort: S under 1h, M under half a day, L over half a day.

## 2. Page-by-page grades

Gap column: E = empty state, D = data thin, U = unfinished vs client scope, B = suspect flow, OK = none.

| Module / Page | Grade | Gap | Reason | Suggested fix (effort) |
|---|---|---|---|---|
| Dashboard `/dashboard` (GM dashboard) | B- | D | Farrowing KPIs and `gm_budget` (100 rows) have data [D]. Feed, FCR, mortality and cost tiles depend on `batch_daily_data`, `batch_mortality_detail` and journals, which are 0 or sparse in the DB [D]. Widgets built on those will be blank or zero. | Load activity data (see section 5), or demo only the farrowing and herd tiles (M) |
| Companies `/companies` | B | OK | 1 company [D]. Admin-scope page. | none |
| Company Settings `/company/settings` | B | OK | company_master, fiscal, address and contacts each have 1 row [D]. | none |
| Operational Areas | B | OK | 1 area [D] | none |
| Users `/users` | B | OK | 4 users, all Super Administrator [D]. Role variety cannot be shown. | Assign one user to Manager/Operator to show role scoping (S) |
| Roles `/roles` | B | D | 6 roles, 144 permissions [D]. No REPORTS, LOGISTICS or REQUISITION permission rows, so those modules cannot be granted on a role in the matrix [C, unconfirmed against the role UI]. | Seed those permission rows (M) |
| Audit ledger `/audit` | A- | OK | 2,183 rows [D] | none |
| Notifications `/notifications` (email, webhook) | D | E | `notification_config`, `notification_log` and `notification_alert_log` are all 0 [D]. | Skip it in the demo, or add one config (S) |
| Alerts `/alerts` | D | E | `alert_rule` 0, `feed_alert` 0 [D]. The page shows an empty list. | Seed 3-5 rules and run alert evaluation (M) |
| Approvals pending/approved/rejected | D | E | `approval_request` 0 [D]. All three tabs are empty. | Seed or submit a requisition and approve it live (M) |
| Batches list `/batches` | B | D | 17 ACTIVE batches in a good mix of ANIMAL_WISE and BATCH_WISE [D]. `total_cost` is NULL on all [D], so cost columns are blank. Two batches are named `SHOWCASE-*-SOURCE`. | Rename the two SHOWCASE-* batches (S). Run costing if cost is shown (L) |
| Batch Animals `/batches/animals` | B+ | OK | 1,828 animals, all with a `current_batch_id` [D] | none |
| Batch Entry `/batches/entry` | C | E | `batch_daily_data` 0 [D]. The entry form works for a live walkthrough; there is no history. 15 schedulers are ACTIVE [D], so the due list should populate [C]. | Pre-enter 3-5 days of data for 2 batches (M) |
| Batch Records `/batches/records` | D | E | `batch_daily_data` and `batch_transaction` 0 [D]. Stage-wise consumption/output reads those [C]. | Same as Batch Entry (M) |
| Batch Transfers `/batches/transfers` | D | E | `batch_transfer` 0 [D] | Do one live transfer, or seed (M) |
| Kill Sheets `/batches/kill-sheets` (list, new, detail) | B+ | D | 2 imports, 351 carcasses, 13 products [D]. All sick_code populated, ear_tag blank [D]. Large pages (417, 880 and 941 lines [C]). | Confirm the ear-tag blank is expected (S) |
| Batch Stages `/batches/stages` | C | U | Not in the sidebar (commented out in the layout) but the route exists [C]. `batch_stage_log` 0 [D]. | Leave hidden |
| Schedulers `/schedulers` (+ system scheduler tab) | B | D | 15 header and 124 line rows, all ACTIVE, effective 2025-01 to 2027-02 [D]. `system_scheduler` 0 [D], so the system tab is empty. Client item 4 was "Blocked" on 14 Sep; I did not re-verify the create flow. | Show only the list tab (S). Re-verify create via UI (M) |
| Livestock register `/livestock` | A | OK | 1,828 animals with sex, parity, dam/sire columns [D] | none |
| Livestock Scan | C | D | `qr_code_master` 0 [D]. Scan resolves from register cards [C]. | Print or generate one QR to demo (S) |
| Breeding `/livestock/breeding` | A- | D | 4,940 breeding and 3,814 farrowing records, current to 11-15 Nov [D]. No boar linked on any mating [D], so boar columns are blank. `gilt_selection` is 0 [D]. | Backfill boar on recent matings, or avoid boar columns (M) |
| AI Station `/livestock/ai-station` | D | E / U | 23 boars exist [D]. `semen_batch`, `semen_collection_plan`, `boar_condition_record`, `boar_tsi_history`, `bcs_scale`, `genetic_level_band`, `breeding_line_setup` and `gilt_class_rule` are all 0 [D]. The three client-defined lookups behind boar selection and body condition are unseeded. | Seed BCS scale, genetic bands and gilt rules, then collect one semen batch (L) |
| Livestock Health `/livestock/health` | D | E | `batch_mortality_*`, `animal_medication_log` and `batch_treatment_detail` all 0 [D]. `disease_master` 0 [D], so the disease picker is empty. | Seed diseases, log one mortality and one treatment (M) |
| Slaughter Transfers `/livestock/slaughter` | B+ | D | 2 closed TOs with 2 lines, linked to journals and `SLAUGHTER_DISPATCH` bio-asset rows [D]. A DOA or POD flow needs a fresh TO. | Pre-create one open TO for the live walkthrough (S) |
| Facility Occupancy `/livestock/facility` | B | OK | 1,481 locations, animals spread over 46 locations [D] | none |
| Herd Analytics `/livestock/analytics` | n/a | n/a | Hidden from the menu (`HIDDEN_FROM_MENU`) but the route exists [C] | Leave hidden |
| Gilt Selection `/livestock/gilt-selection` | n/a | n/a | Redirects to Breeding [C] | none |
| Inventory Stock Balance `/inventory/balance` | A- | OK | 10 feed items with stock, 103 items in the master [D]. Only feeds hold stock, so other items show zero. | none |
| Goods Receipt `/inventory/goods-receipt` | B | D | 13 receipts, 20 lines, journals posted [D]. `supplier_id` is NULL on all [D] and `supplier_master` is 0 [D], so the supplier column is blank and the supplier dropdown is empty for a live GRN. | Seed 2-3 suppliers (S) |
| QC Inspection `/inventory/qc-inspection` | D | E | `qc_inspection`, `qc_parameter_master` and `item_qc_spec_line` all 0 [D] | Seed QC parameters and one inspection (M) |
| Stock Transfers (+ receive) | B+ | OK | 34 transfers, with shipment and receipt rows all matching [D] | none |
| Stock Adjustment `/inventory/stock-adjustment` | A- | OK | 133 posted [D] | none |
| Inventory Ledger (+ detail) | A | OK | 209 ledger rows [D] | none |
| Bio-Asset Ledger | B | D | 88 rows across 4 document types, about 370k in value [D] | none |
| Feed Forecast (8 flyout tabs) | D | E | `feed_forecast_run`, `feed_plan`, `feed_planning_setting`, `feed_formula_master` and `feed_stock_count` are all 0 [D]. `silo_shed_link` (90) and `bin_diet_assignment` (8) exist [D], so inputs are present but no run. Dashboard, Compare Report, Requisition, Mill Consolidation, Loading and Physical Count tabs will be empty until a run is made. | Run a forecast live, or load the `nf_ccc` feed tables (M) |
| Feed Consolidations, Feed Loading, Feed Alerts | D | E | Tables 0 [D]. Feed Alerts redirects to `/alerts` [C]. | As Feed Forecast |
| Requisitions `/requisitions` (hub) | D | E | `requisition` 0 [D]. This is client item 9, which was "Absent" on 14 Sep and has since been built [C]. | Create one live, or seed (M) |
| Logistics Trips / Dispatch | D | E | All 11 `logistics_*` tables 0 [D]. Guarded by LOGISTICS/TRIP permission, so only admin types see it [C]. Is it even in scope for the demo? | Hide it from the demo, or seed vehicles, drivers and one trip (L) |
| Finance Journal | A- | OK | 211 journals and 422 lines, from 4 sources [D]. Postings dated 2024-12-31 and 10-19 Nov 2026. | none |
| Profit & Loss / Balance Sheet / Trial Balance | B- | D | 25 GL accounts, 12 mappings, 211 journals [D]. Only stock and slaughter movements post to GL; there is no feed consumption, mortality or cost run. Output will be real but small and lopsided. | Check each report once on this DB (S) |
| Bio-Asset Reconciliation | B | D | 88 bio-asset rows [D] | Check roll-forward ties out (S) |
| Bio Costing Runs | D | E | `bio_costing_run` 0 [D] | Run one costing run live (L) |
| FA Conversions | D | E | 0 [D]. `item_fair_value_rate` is also 0 [D]. | Hide, or seed (M) |
| Batch Cost Variance | D | E | 0 [D]. Batch `total_cost` is NULL [D] and `batch_standard` is 0 [D]. | Hide, or run costing first (L) |
| Expenses `/expenses/expense` | D | E | `expense_document` 0 [D]. `cost_center_master` and `gl_posting_group` are also 0 [D]. | Seed cost centres, create one voucher (M) |
| Reports: Farrowing | A | OK | 3,814 farrowing rows [D], aggregated by `farrowing-report.service` [C] | none |
| Reports: Monthly Ops | C | D | Joins `batch_mortality_detail` (0), `customer_master` (0), reason master (115) and bio-asset ledger [D, C]. Mortality and sales sections will be blank. | Seed one customer and a few mortalities (M) |
| Traceability `/traceability` | D | E | Renders Packs/QR via `PacksPanel`; `qr_code_master` is 0 [D] | Generate one pack/QR (S) |
| Master Data - Locations, Stage, Breed, Animal, Items, UoM, KPI, Reasons, Reporting Period, GL, GL Mapping, Currency, Resources, Number Series, Activity | A-/B | OK | All populated [D]: location 1,481; item 103; animal 1,828; KPI metric 28; reason 115; GL 25; resource 41; no_series 62 | none |
| Master Data - Suppliers | D | E | 0 [D] | Seed (S) |
| Master Data - Alert Rules / Accounting Periods / Posting Groups / Cost Centres | D | E | 0 [D] | Seed (S each) |
| Master Data - Breeding Line Setup / Genetic Level Bands / Gilt Class Rules / BCS Scale | D | E | 0 [D]. These four feed AI Station and gilt selection. | Seed (M) |
| Master Data - QC Parameter | D | E | 0 [D] | Seed (S) |
| Master Data - UoM Conversions, Exchange Rates | D | E | `uom_conversion_master` 0 and `exchange_rate` 0 [D]. Both were flagged in the 14 Sep handoff. | Seed (S) |
| Settings - Area / Parameters / Inventory Setup / QC | C | E | `operational_area_settings`, `parameter_master`, `inventory_setup` all 0 [D]. Forms open empty, which suits a live demo but shows nothing set. | Fill in defaults (S) |

## 3. Stubs and "coming soon"

A grep of the app and translations found no "coming soon" or "under construction" text [C]. The only intentional gates are:
- `/batches/stages` and `/livestock/analytics`, hidden from the nav on purpose.
- `/livestock/gilt-selection`, `/inventory/feed-alerts`, `/inventory/requisitions`, `/inventory/feed-requisitions`, `/approvals/requisitions` and `/expenses` index, all redirects.

## 4. Scope against the client task list (HANDOFF-2026-09-14)

I did not re-test any of these this pass. Status below is from the handoff and from table counts.
- Item 1 Logins and item 2 Farm-wise access: `farm_id` is on the batches [D]. The handoff marked both "not audited"; `docs/VERIFICATION-2026-09-14-logins.md` exists.
- Item 3 Masters: 27 configs. Known gaps still visible: exchange rate and UoM conversion are empty [D].
- Item 4 Scheduler: data exists for 15 [D]; the create-recoverability fix was not re-verified.
- Items 5 and 6 Batch Creation and Data Entry: batches exist; there is no daily entry data [D].
- Items 7 and 8 Purchase Receipt and Adjustment: strongest area; 13 GRNs and 133 adjustments [D].
- Item 9 Requisition: built [C]; no data [D].
- Item 10 Feed Forecast: built [C]; no runs [D].
- Resource Ledger: `resource_ledger` is 0 [D]. It was "absent" on 14 Sep and I found no web route for it.
- Animal History (breeding history): data-rich [D].
- Inventory Ledger: 209 rows [D].

## 5. Overall grade: C+

- Herd, master, inventory and kill-sheet pages are strong (A/B) and the data is current.
- Everything transactional is empty: daily data, feed forecast, requisitions, approvals, alerts, QC, logistics, expenses, bio-costing and notifications.
- On `nf_ccc` the same pages have data, but it is an older, differently shaped tenant.
- Page code shows no stubs.
- The risk is entirely data: an empty screen in front of the client.

## 6. Top-10 fix before tomorrow

1. **Decide which DB the demo runs on.** `nf_cccshow` is the real-client import; `nf_ccc` has the activity. If a hybrid is wanted, load `nf_ccc` feed, requisition, approval, alert and daily-data tables into `nf_cccshow` (S to decide, L to load safely; do not run `clone-cccshow-to-tenant.mjs --apply` without a backup).
2. **Daily Data and Records**: pre-enter some days for 2-3 batches so Records, Dashboard feed/FCR and Monthly Ops are not blank (M).
3. **Feed Forecast**: run one forecast and consolidation on current data so all eight tabs show something (M).
4. **Suppliers and Customers**: seed 2-3 of each. This unblocks a live GRN and the Monthly Ops sales section (S).
5. **Requisitions and Approvals**: create one requisition, submit it and approve it, so both screens and the inbox have a row (M).
6. **AI Station lookups**: seed BCS Scale, Genetic Level Bands and Gilt Class Rules, plus a semen batch (M-L). Skip the page if there is no time.
7. **Alert Rules and Alerts**: seed 3-5 rules and run an evaluation so `/alerts` is not an empty list (M).
8. **Health**: seed `disease_master` and log one mortality and one treatment (M).
9. **Hide or skip**: Logistics, FA Conversions, Batch Cost Variance, Bio Costing Runs, QC Inspection and Notifications, unless they are seeded. Better to leave them out than open an empty screen (S, demo plan only).
10. **Cosmetic and consistency**: rename the two `SHOWCASE-*-SOURCE` batches, and backfill `boar_animal_id` on recent matings. Then take one pass through P&L, Balance Sheet and Trial Balance on this DB to confirm they balance and read sensibly (S-M).

Before the demo, bring up the API and web against the chosen DB and click through the top 15 pages. I read everything above from SQL and code; none of it was seen rendering.
