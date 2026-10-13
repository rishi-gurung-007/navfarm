# Uniformity audit — screen by screen (13 Oct 2026)

Static check of every screen in `apps/web` (65 routes): each route's page and the components it imports
(not the shared UI kit), with `t("key")` resolved to its English text. It shows where a screen mixes two
names or two ways of doing the same thing. Shared panels count on every screen that uses them. Counts in
brackets are occurrences. Nothing here was changed; this is the list to work from.

## Proposed standard (one per concept)

| Concept | Use | Instead of |
|---|---|---|
| Animal tag | **needs Rishi:** RFID *or* Ear Tag | the other |
| Bio-asset | Bio-Asset | Bio Asset, Biological Asset |
| Head count | Head Count | Headcount, Head count |
| Unit | KG | kg, Kg |
| Quantity | Qty in table headers, Quantity in forms | mixing on one screen |
| Number | No. | Number, # |
| Stage move | one of Transfer Stage / Change Stage | Stage Transition |
| Item lot | Lot No. | Batch No. (that is a production batch) |
| Remove a record | Deactivate (masters) / Delete (drafts) | Remove |
| Change a record | Edit | Update, Modify |
| Create button | **Add X** (40 uses today) | New X (20), Create X (8) |
| Draft button | Save Draft | Save to Draft, Save as Draft |
| Dates | `formatDate` / `formatDateShort` | `toLocaleString`, raw `2026-10-13` text |
| Money | `formatMoney` | hardcoded `$` |
| Codes (enums, stages) | a label (`Dry Sow`) | `DRY_SOW`, `.replace(/_/g, ' ')` |
| Tables / buttons / dialogs / loading | `Table`, `Button`, `Dialog`, `LoadingState` | hand-built `<table>`, `<button>`, overlays, spinners |

## App-wide (not one screen)

- **Sidebar label ≠ page title:** GRN → *Procurement & GRN*; Inventory & Stock → *Inventory & Procurement*; Stock Balance → *Company Inventory & Stock Balance*; Stock Adjustment → *Stock Adjustment & Physical Count*; Health & Mortality → *Mortality & Health*; Farm Master → *Master Data* in messages.
- **Create buttons:** Add (40), New (20), Log (14), Record (12), Create (8), Register (4) — e.g. *New Batch*, *New Receipt*, *Create Scheduler*, *Add Location*, *Log Mortality Record*.
- **Record codes:** lots `LOT-00001` / `LOT00007` / `LOT-1`; serials `SN00020`; items `ICAT-004-ITM-0002` / `ITM-0001` / `FEED0001`; 3–6 digits by series. The GRN's lot/serial generator (`previewNextNumbersById`) drops the series separator.
- **Dates:** tables `2026-10-13`, pickers `13/10/2026`, timestamps `13/10/2026, 20:16:24`.
- **Capitalisation:** 1,230 Title Case vs 572 sentence-case labels; 61 labels exist in both forms (Data Entry / Data entry, Save Draft / Save draft, Acquisition Cost / Acquisition cost…).
- **Translations:** hi, mr, es, fr, bn, te, ta each miss the same 1,500 of 4,603 keys.

## Screen by screen

### Piggery

**Piggery Dashboard** (`/dashboard`)
- Head count: Head Count(2) / Headcount(2)
- Tables: only native <table> (1)
- Buttons: native <button> (8) vs <Button> (2)

### Batches

**Batches — Batch Animals** (`/batches/animals`)
- Tag: Ear Tag(4) / RFID(5)
- Stage move: Change Stage(2) / Stage Transition(2)
- Money: hardcoded $ (2) next to money helper (17)
- Codes: underscores replaced inline (2) instead of a label
- Codes: stage code shown raw (3)
- Tables: only native <table> (10)
- Loading: own spinners only (5)
- Language: much hardcoded English (101 literal texts vs 144 translated)

**Batches — Batch List** (`/batches`)
- Tag: Ear Tag(1) / RFID(1)
- Qty: Qty(15) / Quantity(6)
- Lot: Lot No(1) / Batch No(2)
- Codes: stage code shown raw (3)
- Tables: native <table> (12) and Table kit (22)
- Buttons: native <button> (12) vs <Button> (23)
- Loading: own spinners only (4)

**Batches — Batch Transfers** (`/batches/transfers`)
- Tables: only native <table> (2)
- Loading: own spinner (1) and LoadingState (2)

**Batches — Data Entry** (`/batches/entry`)
- Tag: Ear Tag(2) / RFID(1)
- Number: No.(1) / Number(1)
- Stage move: Transfer Stage(7) / Change Stage(2) / Stage Transition(4)
- Dates: own toLocale date format (1) beside the date helper (25)
- Money: hardcoded $ (2) next to money helper (19)
- Numbers: en-US (3) and browser locale (5) both used
- Codes: stage code shown raw (13)
- Tables: native <table> (12) and Table kit (6)
- Buttons: native <button> (18) vs <Button> (31)
- Loading: own spinner (10) and LoadingState (1)
- Language: much hardcoded English (133 literal texts vs 167 translated)

**Batches — Records & Logs** (`/batches/records`)
- Qty: Qty(1) / Quantity(1)
- Remove: Delete(1) / Remove(1)
- Codes: underscores replaced inline (2) instead of a label
- Tables: only native <table> (6)
- Buttons: native <button> (14) vs <Button> (2)
- Modals: hand-built overlay (1)

**Batches — Stages** (`/batches/stages`)
- Tables: only native <table> (1)

### Schedulers

**Schedulers** (`/schedulers`)
- Qty: Qty(10) / Quantity(1)
- Remove: Delete(4) / Remove(1) / Deactivate(3)
- Codes: underscores replaced inline (5) instead of a label
- Codes: stage code shown raw (1)
- Tables: native <table> (6) and Table kit (12)
- Buttons: native <button> (11) vs <Button> (18)
- Loading: own spinner (9) and LoadingState (2)

### Livestock

**Livestock — Animal Register** (`/livestock`)
- Tag: Ear Tag(2) / RFID(16)
- Qty: Qty(2) / Quantity(1)
- Stage move: Transfer Stage(1) / Stage Transition(2)
- Dates: own toLocale date format (1) beside the date helper (8)
- Codes: underscores replaced inline (4) instead of a label
- Codes: stage code shown raw (2)
- Tables: native <table> (4) and Table kit (6)
- Loading: own spinner (10) and LoadingState (1)

**Livestock — Breeding & Insemination** (`/livestock/breeding`)
- Tag: Ear Tag(1) / RFID(2)
- Money: hardcoded $ (2) next to money helper (18)
- Numbers: en-US (3) and browser locale (1) both used
- Codes: stage code shown raw (2)
- Tables: native <table> (12) and Table kit (2)
- Buttons: native <button> (14) vs <Button> (11)
- Modals: hand-built overlay (5) beside <Dialog> (2)
- Loading: own spinners only (6)
- Language: much hardcoded English (107 literal texts vs 176 translated)

**Livestock — Mortality & Health** (`/livestock/health`)
- Tables: native <table> (2) and Table kit (6)
- Buttons: native <button> (8) vs <Button> (4)

### Inventory

**Inventory — Feed Forecast (and its Feed Loading / Mill Consolidation links)** (`/inventory/feed-forecast`)
- Unit: KG(78) / kg(10)
- Qty: Qty(6) / Quantity(1)
- Number: No.(13) / Number(1)
- Post/Submit: Post(3) / Submit(2)
- Remove: Delete(4) / Remove(1)
- Tables: only native <table> (16)
- Loading: own spinner (1) and LoadingState (11)

**Inventory — GRN** (`/inventory/goods-receipt`)
- Tables: native <table> (4) and Table kit (6)
- Buttons: native <button> (12) vs <Button> (8)

**Inventory — Inventory Ledger** (`/inventory/ledger`)
- Qty: Qty(1) / Quantity(12)
- Lot: Lot No(2) / Batch No(2)
- Codes: underscores replaced inline (3) instead of a label
- Tables: native <table> (8) and Table kit (16)
- Buttons: native <button> (10) vs <Button> (5)
- Loading: own spinners only (4)
- Language: much hardcoded English (66 literal texts vs 26 translated)

**Inventory — Ledger Entry (full page)** (`/inventory/ledger/[id]`)
- Qty: Qty(1) / Quantity(10)
- Lot: Lot No(2) / Batch No(1)
- Codes: underscores replaced inline (3) instead of a label
- Tables: native <table> (7) and Table kit (14)
- Buttons: native <button> (6) vs <Button> (5)
- Language: much hardcoded English (47 literal texts vs 10 translated)

**Inventory — Receive Transfer** (`/inventory/transfers/receive`)
- Qty: Qty(3) / Quantity(2)
- Tables: native <table> (2) and Table kit (4)
- Language: much hardcoded English (19 literal texts vs 10 translated)

**Inventory — Stock Adjustment** (`/inventory/stock-adjustment`)
- Qty: Qty(3) / Quantity(2)
- Money: hardcoded $ (1)
- Tables: native <table> (3) and Table kit (6)
- Language: much hardcoded English (29 literal texts vs 45 translated)

**Inventory — Stock Balance** (`/inventory/balance`)
- Qty: Qty(5) / Quantity(10)
- Lot: Lot No(2) / Batch No(1)
- Codes: underscores replaced inline (3) instead of a label
- Tables: native <table> (10) and Table kit (20)
- Buttons: native <button> (11) vs <Button> (6)
- Loading: own spinners only (3)
- Language: much hardcoded English (71 literal texts vs 30 translated)

**Inventory — Transfer Orders** (`/inventory/transfers`)
- Qty: Qty(10) / Quantity(5)
- Number: No.(2) / Number(1)
- Tables: native <table> (6) and Table kit (12)
- Buttons: native <button> (13) vs <Button> (23)
- Loading: own spinners only (9)
- Language: much hardcoded English (74 literal texts vs 36 translated)

### Requisition

**Requisition** (`/requisitions`)
- Unit: KG(36) / kg(8)
- Post/Submit: Post(4) / Submit(2)
- Tables: only native <table> (7)
- Loading: own spinner (1) and LoadingState (1)

### Finance

**Finance — Balance Sheet** (`/finance/balance-sheet`)
- Tables: native <table> (1) and Table kit (1)

**Finance — Batch Cost Variance** (`/finance/batch-cost-variance`)
- Tables: native <table> (1) and Table kit (2)

**Finance — Bio-Asset Reconciliation** (`/finance/bio-asset-reconciliation`)
- Tables: only native <table> (1)

**Finance — Journal** (`/finance/journal`)
- Tables: native <table> (3) and Table kit (6)

**Finance — Profit & Loss** (`/finance/profit-loss`)
- Tables: native <table> (1) and Table kit (1)

**Finance — Trial Balance** (`/finance/trial-balance`)
- Tables: native <table> (1) and Table kit (2)

### Approvals

**Approvals (Pending / Approved / Rejected)** (`/approvals/pending`)
- Unit: KG(9) / kg(4)
- Qty: Qty(3) / Quantity(1)
- Numbers: en-US (12) and browser locale (1) both used
- Tables: native <table> (4) and Table kit (2)

### Farm Master

**Farm Master — every master screen** (`/master-data/[key]`)
- Tag: Ear Tag(2) / RFID(3)
- Bio-asset: Bio-Asset(28) / Bio Asset(2) / Biological Asset(2)
- Unit: KG(18) / kg(3)
- Qty: Qty(3) / Quantity(4)
- Number: No.(30) / Number(8)
- Remove: Remove(3) / Deactivate(5)
- Edit: Edit(2) / Update(1)
- Codes: underscores replaced inline (18) instead of a label
- Tables: native <table> (4) and Table kit (6)
- Buttons: native <button> (59) vs <Button> (7)
- Loading: own spinners only (12)

**Farm Master — index** (`/master-data`)
- Tag: Ear Tag(1) / RFID(1)
- Bio-asset: Bio-Asset(14) / Bio Asset(1) / Biological Asset(1)
- Unit: KG(8) / kg(1)
- Qty: Qty(1) / Quantity(2)
- Number: No.(14) / Number(4)
- Codes: underscores replaced inline (8) instead of a label

### Company

**Companies** (`/companies`)
- Tables: native <table> (1) and Table kit (2)

**Company detail & Company Settings sections** (`/companies/[companyId]`)
- Tag: Ear Tag(2) / RFID(3)
- Bio-asset: Bio-Asset(28) / Bio Asset(2) / Biological Asset(2)
- Unit: KG(18) / kg(5)
- Qty: Qty(3) / Quantity(4)
- Number: No.(30) / Number(8)
- Remove: Remove(3) / Deactivate(5)
- Edit: Edit(3) / Update(9)
- Codes: underscores replaced inline (17) instead of a label
- Tables: native <table> (5) and Table kit (8)
- Buttons: native <button> (62) vs <Button> (18)
- Modals: hand-built overlay (1) beside <Dialog> (10)
- Loading: own spinner (13) and LoadingState (1)

### Settings

**Settings — Area** (`/settings/area`)
- Codes: underscores replaced inline (1) instead of a label

**Settings — Inventory Setup** (`/settings/inventory-setup`)
- Codes: underscores replaced inline (1) instead of a label
- Tables: only native <table> (1)
- Buttons: native <button> (8) vs <Button> (5)
- Language: much hardcoded English (23 literal texts vs 0 translated)

**Settings — Parameters** (`/settings/parameters`)
- Qty: Qty(3) / Quantity(2)
- Tables: native <table> (1) and Table kit (2)

**Settings — QC** (`/settings/qc`)
- Tables: native <table> (1) and Table kit (2)

### Dashboards, admin and account

**Account — Profile** (`/account/profile`)
- Dates: own toLocale date format (1) — no date helper
- Codes: underscores replaced inline (1) instead of a label

**Account — Settings** (`/account/settings`)
- Tables: only native <table> (1)

**Audit Log** (`/audit`)
- Dates: own toLocale date format (2) — no date helper
- Codes: underscores replaced inline (1) instead of a label
- Tables: native <table> (2) and Table kit (2)

**Notifications — Email / Webhook** (`/notifications/email`)
- Tables: native <table> (1) and Table kit (2)

**Operational Areas** (`/operational-areas`)
- Dates: own toLocale date format (1) — no date helper
- Modals: hand-built overlay (1)

**Roles** (`/roles`)
- Remove: Delete(4) / Remove(1)
- Edit: Edit(3) / Update(2)
- Codes: underscores replaced inline (1) instead of a label
- Tables: native <table> (2) and Table kit (2)
- Buttons: native <button> (14) vs <Button> (7)
- Modals: hand-built overlay (1) beside <Dialog> (3)
- Loading: own spinner (1) and LoadingState (1)

**Users** (`/users`)
- Edit: Edit(2) / Update(1)
- Codes: underscores replaced inline (2) instead of a label
- Tables: native <table> (2) and Table kit (2)
- Buttons: native <button> (11) vs <Button> (6)
- Modals: hand-built overlay (1) beside <Dialog> (1)
- Loading: own spinner (1) and LoadingState (1)

### No mixing found

/approvals, /approvals/requisitions, /batches/schedulers, /company/settings, /finance, /inventory, /inventory/feed-alerts, /inventory/feed-requisitions, /inventory/requisitions, /notifications, /organization, /traceability, Alerts, Livestock — Herd Analytics, Livestock — Pen Occupancy

## Limits

- Static: it reads code, it does not open each screen. A shared panel's findings show on every screen that uses it.
- Counts of words include help text and messages, not only labels.
- *Native* `<table>` / `<button>` means hand-built and hand-styled; the kit has its own `Table` and `Button`.
