# NAVFarm ↔ Business Central — Developer Guide

**Audience:** the Business Central (AL) developer building the integration, and the NAVFarm (NestJS) developer on the other side.
**Version:** 1.0 — 16 Nov 2026. **Status:** design baseline; items marked **DECISION** need Finance / client sign-off.
**Companion:** `docs/BC-INTEGRATION-PLAN-2026-11-16.md` (project-manager view, build order).

## How this guide was built

Every statement about NAVFarm here was checked against the code and the dev database (`nf_devco`) on 16 Nov 2026. It is not based on the reference documents alone.

| Source | Used for |
|---|---|
| BBP-2: `OneDrive_1_04-09-2026/Solution Documents/NAVFarm_ Business Central Bio Asset (Current -Non Current )Accounts_Finance_Costing_BBP.docx` | Finance rules: FA acquisition, capitalisation, amortisation, fair value, mortality, disposal, reconciliation |
| BBP-1: `…/Triple-C_NAVFarm BBP1_V0.1_Final.docx` | Operational touchpoints: COA/item/dimension sync, PO→GRN, feed TO, expense voucher, slaughter TO, inventory journal types |
| `…/Triple-C_Bio Asset _Structure and Respective GL Entries.xlsx` | The 10 breeding categories, useful life, residual value, start week, Dr/Cr per event |
| `rak docs/Final_Docs/3. GL COA Item mapping.xlsx` | Account model and ledger-to-journal transaction types |
| `apps/api/src/core/database/schema.ts` | The NAVFarm tables and fields named below |
| `apps/api/src/modules/finance/journal/*.ts` and every posting service | Where each financial event is created |
| `nf_devco.gl_mapping_master` (live rows) | The actual Dr/Cr account rule for each NAVFarm posting type (Appendix A) |

## Where to start

| You are | Read first | Then |
|---|---|---|
| **BC (AL) developer** | §1 Architecture, §2 Environment, §5 API contract | §6 AL objects, §7 handlers, §12 sprint plan, §10 tests |
| **NAVFarm developer** | §1 Architecture, §4 Event catalogue, §9 Gaps | §5 API contract, §8 Reconciliation, §11 Cut-over |
| **Finance / functional consultant** | §4 Event catalogue, §13 Decisions | Appendix A (accounts), Appendix B (asset categories), §8 |
| **Project manager** | §12 Delivery sequence, §13 Decisions, §9 Gaps | `docs/BC-INTEGRATION-PLAN-2026-11-16.md` |

**Three ideas explain the whole design:**

1. **NAVFarm calculates, BC posts.** NAVFarm works out every amount (amortisation, fair value, piglet cost). BC records what it is sent and returns its entry numbers.
2. **One API for all postings.** Every financial event goes through the same `postingRequests` API: insert the request, call `post`, read back the result. Only the handler inside BC differs per event type.
3. **Nothing posts twice.** Every request carries a unique `navfarmEventId`. Sending it again returns the first result instead of posting again.

---

## Contents

1. [Architecture and ground rules](#1-architecture-and-ground-rules)
2. [Environment, authentication and conventions](#2-environment-authentication-and-conventions)
3. [Master data — field-level mapping](#3-master-data--field-level-mapping)
4. [Financial events — the complete catalogue](#4-financial-events--the-complete-catalogue)
5. [The integration API contract](#5-the-integration-api-contract)
6. [AL objects to build — specification and code](#6-al-objects-to-build--specification-and-code)
7. [Posting handlers, one per event type](#7-posting-handlers-one-per-event-type)
8. [Reconciliation and period close](#8-reconciliation-and-period-close)
9. [Gaps NAVFarm must close (NAVFarm developer)](#9-gaps-navfarm-must-close-navfarm-developer)
10. [Testing and acceptance](#10-testing-and-acceptance)
11. [Go-live cut-over and opening balances](#11-go-live-cut-over-and-opening-balances)
12. [Delivery sequence for the BC developer](#12-delivery-sequence-for-the-bc-developer)
13. [Decisions needed](#13-decisions-needed)
- [Appendix A — NAVFarm G/L mapping rules today](#appendix-a--navfarm-gl-mapping-rules-today)
- [Appendix B — Breeding-asset categories](#appendix-b--breeding-asset-categories)
- [Appendix C — Glossary](#appendix-c--glossary)

---

## 1. Architecture and ground rules

### 1.1 Who owns what

| Area | Owner (system of record) | The other system holds |
|---|---|---|
| Chart of accounts, dimensions, posting groups, posting setup | **BC** | Read-only copy |
| Items, units of measure | **BC** | Read-only copy plus farm-only attributes (diet no., feed form, silo data) |
| Vendors, customers | **BC** | Read-only copy |
| Purchase orders, purchase and sales invoices, payments | **BC** | PO copy as expected receipt; invoice no. on slaughter TO |
| Fixed-asset cards (main + child), FA ledger, depreciation books | **BC** | FA No. on each animal |
| Animals, batches, sheds, silos, daily data, breeding, farrowing, mortality | **NAVFarm** | Child FA per breeding animal; dimension value per batch |
| **Biological-asset calculations** (capitalisation, amortisation, fair value, piglet cost, NBV) | **NAVFarm** calculates | **BC** posts the amounts it is given; it does not recalculate |
| Accounting periods | **BC** | NAVFarm blocks posting into closed periods |

### 1.2 NAVFarm is always the caller

NAVFarm authenticates **users** only (JWT plus an `x-tenant-id` header). It has no service-to-service API and no public HTTPS endpoint for BC to call. So:

- **BC is passive.** It exposes APIs and never calls NAVFarm.
- **NAVFarm pulls** master data by polling on `lastModifiedDateTime`. This replaces the item webhook in BBP-1 §1.5; you can add a BC webhook later without changing any contract.
- **NAVFarm pushes** transactions into BC staging, asks BC to post them, then reads the result back.

This removes outbound HTTP, retries and secrets from the AL code entirely.

### 1.3 What gets sent: the NAVFarm "system journal" is the unit of integration

NAVFarm already creates a balanced double-entry journal for every financial event. They all go through one function:

```
apps/api/src/modules/finance/journal/journal.service.ts → createAndPostSystemJournal()
   writes journal_header (source='SYSTEM', source_document_type, source_document_no, source_ledger_id)
   and    journal_line   (gl_account_id, cost_center_id, debit_amount, credit_amount, nob_id, lob_id)
```

It is called from `GlPostingService.postInventoryLedgerEntry` (inventory movements), `postBatchCostEntry` (batch and animal costs), `postAccountTransfer` (reclasses) and the expense service. The G/L accounts are picked from `gl_mapping_master` (Appendix A).

Live counts in the dev database (16 Nov):

| `source_document_type` | Journals | Example events |
|---|---|---|
| BATCH | 747 | Daily consumption, overhead, mortality, output, litter cost, fair value |
| BIO_COSTING_RUN | 73 | Amortisation and fair-value runs |
| BREEDING | 53 | Semen production and use |
| GOODS_RECEIPT | 21 | Purchases, livestock acquisition |
| ANIMAL_REGISTRATION | 4 | Opening animal value |
| BIO_ASSET_EXIT | 2 | Cull / FA → inventory |
| (in code, not yet in dev data) | — | SLAUGHTER_TO, BATCH_TRANSFER, PURCHASE_PRICE_VARIANCE, EXPENSE_VOUCHER |

Each journal row comes from a **source ledger row**. That source row holds the operational detail BC needs: item, quantity, lot, location, batch, animal.

| NAVFarm ledger | Holds | Key fields |
|---|---|---|
| `inventory_ledger` | Stock movements (feed, medicine, vaccine, semen, finished goods) | `entry_no, item_code, document_type, document_no, transaction_type, entry_type, gl_mapping_type, quantity (signed), uom, rate, amount, lot_no, expiry_date, batch_no, location_id, warehouse_id, posting_date, reversal_of_ledger_id` |
| `bio_asset_ledger` | Biological-asset value by animal or batch | `entry_no, bio_asset_item_id, document_type, entry_type, transaction_type, animal_id, batch_id, batch_no, stage, lot_no, quantity, cost_amount, costing_method (COST_ACCUMULATION / AMORTIZED_COST / FAIR_VALUE), run_id` |
| `resource_ledger` | Labour, equipment and overhead usage | `resource_code, document_no (=batch no), batch_id, stage_id, quantity, rate, amount, entry_type (USAGE/REVERSAL)` |
| `bio_costing_run` / `_line` | Amortisation and fair-value runs, one line per animal | `run_no, method, period_key, period_start/end, status; line: animal_id, book_value_before, residual, charge, book_value_after, integration_status` |

### 1.4 Two ways BC records an event — and which to use when

| Style | How BC posts | BC sub-ledger populated | Use for |
|---|---|---|---|
| **Native** | Item journal, FA G/L journal, purchase receipt, transfer order, sales invoice | Item Ledger + Value Entries, or FA Ledger | Anything that moves **stock quantity** or changes a **fixed asset** (BBP-2 asks for Item/Value/FA ledger entry numbers back) |
| **G/L mirror** | General journal with NAVFarm's lines as they are (accounts, amounts, dimensions) | G/L only | Pure value events with no quantity: overhead absorption, expense vouchers, cost reclasses, batch fair value, variances, litter-cost reclass |

**Rule:** for a native posting, BC's posting setup chooses the G/L accounts. Those accounts must match what NAVFarm's `gl_mapping_master` chose; the reconciliation in §8 checks this. For a G/L-mirror posting, BC uses NAVFarm's accounts exactly as sent.

**Safety net:** the generic `GL_JOURNAL` event type (§5.4) accepts any NAVFarm system journal as general-journal lines. Any NAVFarm event that has no dedicated handler yet can still reach BC's G/L, so the two G/Ls never drift apart.

### 1.5 Flow of one transaction

```
NAVFarm user posts a document (POST Day, GRN, run, …)
   │  same DB transaction
   ├─► NAVFarm ledgers + system journal (as today)
   └─► bc_sync_queue row  status=PENDING  navfarm_event_id=<uuid>
                │  worker (async, retries 3× at 15 min — BBP-1)
                ▼
   POST /postingRequests        (deep insert: header + lines)        BC: status=Received
   POST /postingRequests({id})/Microsoft.NAV.post                    BC: validate → post → status=Posted|Failed
   GET  /postingRequests({id})?$expand=postingRequestLines           BC: entry numbers per line
                │
                ▼
   NAVFarm stores BC refs on the source rows, queue status=BC_POSTED (or BC_FAILED + alert)
```

---

## 2. Environment, authentication and conventions

### 2.1 Prerequisites for the BC developer

- A BC SaaS **sandbox** copied from the production company, with COA, posting groups, dimensions, FA classes and posting groups, depreciation book, number series and locations.
- Extension development rights. BBP-1 lists "D365BC development rights" as a PTL dependency, so request them on day 1.
- An object ID range. This guide uses **50100–50199**; replace it with the licensed range.
- VS Code with the AL Language extension, and symbols downloaded from the sandbox.
- Platform/runtime: whatever the sandbox reports. The code below needs BC 22+ (API pages, `WebServiceActionContext`, enum extensions).

### 2.2 Service authentication (Entra ID, client credentials)

1. Register the Entra app **NAVFarm-Integration**. Under API permissions, add *Dynamics 365 Business Central → Application → API.ReadWrite.All*, then grant admin consent. Create a client secret or certificate.
2. In BC, open the **Microsoft Entra Applications** page, add the client ID, set State = Enabled, and assign permission set **NVF-INTEGRATION** (§6.9). Never assign SUPER.
3. NAVFarm requests a token:

```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
grant_type=client_credentials&client_id=…&client_secret=…&scope=https://api.businesscentral.dynamics.com/.default
```

4. URLs:

```
Standard: https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/v2.0/companies({companyId})/{entitySet}
Custom:   https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/ptl/navfarm/v1.0/companies({companyId})/{entitySet}
```

The NAVFarm company record stores the tenant ID, environment name, company ID (from `GET /companies`), client ID and the encrypted secret (see gap G5).

### 2.3 Conventions

| Item | Rule |
|---|---|
| Object and field prefix | `NVF` (for example `"NVF Posting Request"`, field `"NVF Animal Code"`) |
| API publisher / group / version | `ptl` / `navfarm` / `v1.0`. Never change a published v1.0 contract; add v1.1 or v2.0 instead |
| JSON names | camelCase; keys are `SystemId` GUIDs exposed as `id` |
| Dates | `postingDate` as `YYYY-MM-DD`, timestamps in ISO-8601 UTC |
| Amounts | Decimal, 2 dp for G/L amounts, up to 5 dp for unit costs; currency = company LCY (USD per BBP-1) |
| Quantities | Always positive in BC payloads; the direction comes from `entryType` (NAVFarm stores them signed) |
| Document No. | NAVFarm document no. (for example `RQ-00001`, a batch no., `TO-…`). **External Document No.** = `navfarmEventId` (truncated to the field length; full value stays on the staging record) |
| Idempotency | `navfarmEventId` is unique in BC. A repeat returns the first result and never posts again |
| Codes | NAVFarm sends **BC codes** (item no., G/L account no., location code, dimension value code), never NAVFarm UUIDs |

---

## 3. Master data — field-level mapping

Masters are synced **into** NAVFarm. A transaction is accepted by BC only if every code it carries exists in BC.

### 3.1 Summary

| # | NAVFarm table | BC table | API | Direction | Frequency |
|---|---|---|---|---|---|
| M0 | `company_master` (+ new BC fields) | Company | std `companies` | BC→NF | Setup |
| M1 | `gl_account_master` | G/L Account (15) | std `accounts` | BC→NF | Nightly 01:00 UTC and on demand |
| M2 | `cost_center_master` + new dimension tables | Dimension (348), Dimension Value (349) | std `dimensions`, `dimensionValues`; custom `nvfDimensionValues` (create) | BC→NF; NF→BC for BATCH values | Nightly; batch values on batch creation |
| M3 | `item_master` | Item (27) + extension | custom `farmItems` | BC→NF | Every 15 min (delta) |
| M4 | `gl_posting_group` (INVENTORY kind) | Inventory Posting Setup (5813), General Posting Setup (252) | custom `inventoryPostingSetups`, `generalPostingSetups` | BC→NF | Nightly |
| M5 | `gl_posting_group` (BIOLOGICAL kind) | FA Posting Group (5606) | custom `faPostingGroups` | BC→NF | Nightly |
| M6 | `uom_master` | Unit of Measure (204), Item Unit of Measure (5404) | std `unitsOfMeasure`; custom on Item UoM | BC→NF | Nightly |
| M7 | `supplier_master` | Vendor (23) | std `vendors` | BC→NF | Hourly |
| M8 | `customer_master` | Customer (18) | std `customers` | BC→NF | Hourly |
| M9 | `location_master` (FARM, MILL) | Location (14) | std `locations` | BC→NF | Nightly |
| M10 | `animal_register` (breeding) | Fixed Asset (5600) + FA Depreciation Book (5612) | custom `farmFixedAssets` | NF→BC create; BC→NF values | On event |
| M11 | `accounting_period` | Accounting Period (50), G/L Setup posting window | std `accountingPeriods` + custom setup read | BC→NF | Nightly |
| M12 | (new) expected receipts | Purchase Header/Line (38/39) | std `purchaseOrders`, `purchaseOrderLines` | BC→NF | Hourly |

### 3.2 M1 — G/L accounts

| NAVFarm `gl_account_master` | BC `G/L Account` | Note |
|---|---|---|
| `account_code` | `No.` | **Must become the BC number.** Dev data holds illustrative codes (69 accounts, for example 160500, 170100) |
| `account_name` | `Name` | |
| `account_type` (ASSET…EXPENSE) | `Account Category` (+ `Income/Balance`) | Map Assets→ASSET, Liabilities→LIABILITY, Equity→EQUITY, Income→INCOME, Cost of Goods Sold/Expense→EXPENSE |
| `is_active` | `not Blocked` | |
| (new) `direct_posting` | `Direct Posting` | BBP-1: the EV / service G/L dropdown shows only Direct Posting = Yes |
| (new) `bc_system_id`, `bc_last_modified` | `SystemId`, `SystemModifiedAt` | Delta sync key |

Query: `GET /accounts?$filter=lastModifiedDateTime gt {lastSync}`. Set the standard `accounts` entity's `blocked` flag on deactivation; NAVFarm keeps the row and marks it INACTIVE (BBP-1 blocks posting to inactive accounts).

### 3.3 M2 — Dimensions

BBP-1: *"Cost Centre dimension = Farm Code is MANDATORY on all G/L entries. Optional: Batch, Stage, LOB."*

| BC Dimension Code (proposed) | Values | Source of values | Global/Shortcut |
|---|---|---|---|
| `COSTCENTRE` | One per farm and the mill (Farm Code, for example `POR100`, `MUL100`) | Created in BC by Finance; NAVFarm links `location_master.cost_center_id` | **Global Dimension 1** (**DECISION D5**) |
| `LOB` | `LVS_PIGGERY` | BC | Global Dimension 2 or Shortcut 3 |
| `BATCH` | NAVFarm `batch_header.batch_no` | **Created by NAVFarm** via `nvfDimensionValues` when a batch is activated (**DECISION D4**) | Shortcut 4 |
| `STAGE` | `stage_master` codes | BC (small fixed list) | Shortcut 5 |

Do **not** make the animal a dimension; the animal is the child FA (§3.6).

NAVFarm today: `cost_center_master` has **0 rows** in the dev database, and **none** of the 2,000+ journal lines carries a cost centre. `journal_line` has no batch or stage column at all. See gaps **G1** and **G2**. Until these are fixed, BC would reject every posting.

### 3.4 M3 — Items

BBP-1 §1.5: items are created in BC only. The BC user ticks **Sync to NAVFarm Farm Item**, and only those items reach NAVFarm.

| BC field | API name | NAVFarm `item_master` | Note |
|---|---|---|---|
| `No.` | `number` | `item_code` | |
| `Description` | `description` | `item_name` | |
| `Type` (Inventory / Non-Inventory / Service) | `type` | `is_inventoriable` | |
| `Item Category Code` | `itemCategoryCode` | `category_id` (by code) | |
| `Base Unit of Measure` | `baseUnitOfMeasure` | `uom_primary` | |
| `Purch. Unit of Measure` + Item UoM qty | `purchUnitOfMeasure`, `purchUomQtyPer` | `uom_secondary`, `uom_conversion_factor` | 50 kg bag ↔ KG |
| `Item Tracking Code` → Lot Specific | `lotTracked` (bool) | `is_lot_tracked` | |
| `Item Tracking Code` → SN Specific | `serialTracked` | `is_serial_tracked` | |
| `Lot Nos.` | `lotNos` | `tracking_series_id` (by code) | |
| `Expiration Calculation` | `expirationCalculation` | `shelf_life_days` | |
| `Inventory Posting Group` | `inventoryPostingGroup` | `posting_group` / `posting_group_id` | |
| `Gen. Prod. Posting Group` | `genProdPostingGroup` | (new) `gen_prod_posting_group` | |
| `Costing Method` | `costingMethod` | `valuation_method` | **DECISION D9** |
| `Unit Cost` | `unitCost` | `standard_cost` | |
| `Blocked` | `blocked` | `is_blocked` | |
| `NVF Sync to NAVFarm` (ext.) | (filter only) | — | |
| `NVF Withdrawal Days` (ext.) | `withdrawalDays` | `withdrawal_days` | Hard block on slaughter TO |
| `NVF Item Kind` (ext., enum) | `farmItemKind` | `item_type` | FEED, MEDICINE, VACCINE, SEMEN, RAW_MATERIAL, CONSUMABLE, FINISHED_GOODS, LIVING_ASSET |
| `NVF Bio Category` (ext.) | `bioCategory` | `bio_costing_method`, `bio_gender` | For living-asset items only (weaners, growers, finishers) |
| `SystemModifiedAt` | `lastModifiedDateTime` | (new) `bc_last_modified` | Delta key |

NAVFarm keeps farm-only fields that BC does not have: `diet_no`, `feed_form`, QC spec, QR settings, min/max stock per farm.

**Breeding-animal categories (GGP-IMP-F … P-LOC-M) are not BC items.** In BC they are FA subclasses with FA posting groups (§3.6, Appendix B). NAVFarm currently stores them as `item_master` rows with `item_type = LIVING_ASSET` and `bio_*` fields (dev examples: `GGP-IMP-F`, `GP-LOC-F`). NAVFarm keeps those rows as **costing profiles** and maps each one to a BC FA subclass and FA posting group.

### 3.5 M4/M5 — Posting groups

NAVFarm's `gl_posting_group` has two kinds. Dev rows: `INV-FEED`, `INV-FEED-RAW`, `INV-MED`, `INV-VET`, `INV-FG`, `INV-WEANERS` (INVENTORY) and `BIO-PREMATURE`, `BIO-MATURE` (BIOLOGICAL).

| NAVFarm `gl_posting_group` field | BC target |
|---|---|
| `group_code` (INVENTORY kind) | Inventory Posting Group `Code` |
| `inventory_gl_id` | Inventory Posting Setup → `Inventory Account` (per location) |
| `cogs_gl_id` | General Posting Setup → `COGS Account` |
| `group_code` (BIOLOGICAL kind) | FA Posting Group `Code` (one per breeding category, Appendix B) |
| `asset_gl_id` | FA Posting Group → `Acquisition Cost Account` |
| `accum_amort_gl_id` | → `Accum. Depreciation Account` |
| `amort_expense_gl_id` | → `Depreciation Expense Acc.` |
| `fv_gain_gl_id` | → `Appreciation Account` (with `Appreciation Bal. Account`) |
| `fv_loss_gl_id` | → `Write-Down Account` (with `Write-Down Expense Acc.`) |
| `writeoff_gl_id` | → `Acq. Cost Acc. on Disposal`, `Losses Acc. on Disposal` |

For each **native** event, BC picks the account through *General Posting Setup* (`Gen. Bus. Posting Group` × `Gen. Prod. Posting Group`). To route the same feed item to different accounts per event (capitalise vs expense), create one Gen. Bus. Posting Group per NAVFarm mapping type. The handler sets it on the journal line:

| Gen. Bus. Posting Group (proposed) | NAVFarm `gl_mapping_type` / `transaction_type` | `Inventory Adjmt. Account` in General Posting Setup |
|---|---|---|
| `NVF-CONS` | CONSUMPTION (non-bio batch) | Batch WIP / Overhead Expense |
| `NVF-CAP` | BIO_CONSUMPTION_PREMATURE | **FA capitalisation clearing** (§7.6) |
| `NVF-EXP` | BIO_CONSUMPTION_MATURE | Bio-Asset Consumption Expense (Mature) |
| `NVF-SEMEN` | BIO_SEMEN_USE / BIO_SEMEN_EXPENSE | Pre-mature asset / Consumption expense |
| `NVF-OUTPUT` | OUTPUT / BIO_OUTPUT / BIO_LITTER_BIRTH | WIP / Bio-Asset WIP |
| `NVF-ADJ` | VARIANCE_POSITIVE / VARIANCE_NEGATIVE | Inventory Adjustment Gain / Loss |
| `NVF-MORT` | MORTALITY / BIO_MORTALITY_* | Mortality / Impairment Loss |

The NAVFarm developer exposes this mapping as a table (`gl_mapping_type` → BC Gen. Bus. Posting Group) so it is configuration, not code.

### 3.6 M10 — Breeding animals as Fixed Assets

BBP-2 §1–2: every breeding animal is a **Child Fixed Asset** under a **Main Fixed Asset**, and each child links to exactly one NAVFarm animal.

| BC Fixed Asset field | Value | NAVFarm source |
|---|---|---|
| `No.` | From FA no. series (BC assigns) | Returned → `animal_register.bc_fa_no` (new, gap G3) |
| `Description` | `{animal_code} {category}` | `animal_code`, category |
| `FA Class Code` | `BIOLOGICAL` | constant |
| `FA Subclass Code` | `GGP-IMP-F` … `P-LOC-M` | animal's costing profile (`item_id` → `item_code`) |
| `Main Asset/Component` | `Component` | constant |
| `Component of Main Asset` | Main FA no. for the category (and farm, **DECISION D7**) | Main FA synced via M10 read |
| `FA Location Code` | Farm | `current_location_id` → farm |
| `Global Dimension 1 Code` | Farm cost centre | farm |
| `NVF Animal Code` (ext.) | `animal_code` (tattoo) — **unique** | `animal_code` |
| `NVF Animal Id` (ext.) | NAVFarm `animal_id` (GUID) | `animal_id` |
| `NVF Gender` (ext.) | F/M | `gender` |
| `NVF Origin` (ext.) | IMPORTED / LOCAL | `entry_type` |
| `NVF Mating Line` (ext.) | Z+Z / Z+L / Z+Tempo | gilt selection (local only) |
| `NVF Birth Date` (ext.) | | `dob` |

**FA Depreciation Book** (one per child, book code e.g. `COMPANY`):

| Field | Value |
|---|---|
| `FA Posting Group` | Category (Appendix B) |
| `Depreciation Method` | **Manual**. NAVFarm calculates amortisation and BC must never run *Calculate Depreciation* on these assets |
| `Depreciation Starting Date` | Amortisation start (week 33 F / week 26 M from birth) |
| `No. of Depreciation Months` | 36 (F) / 18 (M) — informational, since the method is Manual |
| `Salvage Value` | Female imported: residual (150 kg × 2.05 = 307.50); male: 0 |

The Depreciation Book needs *G/L Integration* ticked for Acquisition Cost, Depreciation, Write-Down, Appreciation and Disposal.

---

## 4. Financial events — the complete catalogue

Each row is a NAVFarm event that creates a system journal today. The **mapping type** is the `gl_mapping_master.transaction_type` NAVFarm uses. The Dr/Cr account names come from the dev database (Appendix A); real numbers come from BC. **BC event type** is the `eventType` sent in §5.

### 4.1 Procurement and stock

| # | NAVFarm event (where) | Mapping type | Dr / Cr (NAVFarm today) | BC event type → BC posting |
|---|---|---|---|---|
| E1 | GRN posted — feed, medicine, vet, consumables (`goods-receipt.service`) | PURCHASE | Dr Feed/Vet/Medicine Inventory · Cr Trade Payables | `PURCHASE_RECEIPT` → set Qty. to Receive on PO lines with lots, `Purch.-Post` Receive only (§7.3) |
| E2 | GRN price differs from PO | PURCHASE_PRICE_VARIANCE | Dr/Cr Price Variance · WIP | **Not sent.** BC handles price through the invoice and Adjust Cost |
| E3 | GRN posted — imported livestock (`goods-receipt.service` → BIO_ACQUISITION) | BIO_ACQUISITION | Dr Bio Assets Pre-mature · Cr Trade Payables | `LIVESTOCK_RECEIPT` → create child FA per animal, post PO receipt, FA acquisition (§7.4) |
| E4 | Stock transfer shipped (`stock-transfer.service`) | TRANSFER_SHIPMENT | Dr Inventory in Transit · Cr Inventory | `TRANSFER_SHIPMENT` → BC Transfer Order ship (§7.5) |
| E5 | Stock transfer received (`stock-transfer.service`) | TRANSFER_RECEIPT | Dr Inventory · Cr Inventory in Transit | `TRANSFER_RECEIPT` → BC Transfer Order receive |
| E6 | Transfer short-received (`stock-transfer.service`) | VARIANCE_NEGATIVE | Dr Inventory Adjustment Loss · Cr Inventory | `INVENTORY_ADJUSTMENT` (negative) |
| E7 | Stock adjustment + / − (`stock-adjustment.service`) | VARIANCE_POSITIVE / VARIANCE_NEGATIVE | Dr Inventory · Cr Adj. Gain / Dr Adj. Loss · Cr Inventory | `INVENTORY_ADJUSTMENT` → Item journal Positive/Negative Adjmt., Gen. Bus. PG `NVF-ADJ` |
| E8 | Feed stock count (`feed-stock-count.service`) | VARIANCE_* | as E7 | `PHYSICAL_INVENTORY` → item journal adjustments, Gen. Bus. PG `NVF-ADJ` |
| E9 | Mill output (`mill-output.service`) | MILL_OUTPUT | Dr Finished Feed · Cr Raw Material/WIP | **DECISION D10**: if the mill produces in BC (BBP-1 says the feed-mill user works in BC), NAVFarm does **not** send this |

### 4.2 Daily batch operations (POST Day)

| # | NAVFarm event | Mapping type | Dr / Cr | BC event type → posting |
|---|---|---|---|---|
| E10 | Feed/medicine consumed by a non-bio batch (`batch.service` CONSUMPTION) | CONSUMPTION / BATCH_CONSUMPTION / BATCH_INPUT | Dr WIP (or Overhead Expense) · Cr Feed/Med Inventory | `CONSUMPTION` → Item journal Negative Adjmt., Gen. Bus. PG `NVF-CONS`, dims Farm + Batch + Stage |
| E11 | Feed/medicine consumed by a **pre-mature** breeding animal or lot (capitalised) | BIO_CONSUMPTION_PREMATURE | Dr Bio Assets Pre-mature · Cr Inventory | `CONSUMPTION_CAPITALISED` → Item journal negative (PG `NVF-CAP` → clearing) **plus** FA G/L journal Acquisition Cost per child FA, Bal. = clearing (§7.6). BBP-2 §3 |
| E12 | Feed/medicine consumed by a **mature** breeding animal (expensed) | BIO_CONSUMPTION_MATURE | Dr Bio Consumption Expense (Mature) · Cr Inventory | `CONSUMPTION` with Gen. Bus. PG `NVF-EXP` |
| E13 | Overhead / resource usage (labour, power, water) (`batch.service`, `resource_ledger`) | OVERHEAD, BIO_OVERHEAD_PREMATURE, BIO_OVERHEAD_MATURE | Dr WIP / Pre-mature asset / Overhead Expense · **Cr Trade Payables** (G7) | `OVERHEAD` → G/L mirror; pre-mature per animal also as FA acquisition cost |
| E14 | Batch output (finished goods) (`batch.service` OUTPUT) | OUTPUT / BATCH_OUTPUT / BIO_OUTPUT | Dr Finished Goods · Cr WIP | `OUTPUT` → Item journal Positive Adjmt. at NAVFarm unit cost, PG `NVF-OUTPUT` |
| E15 | Batch mortality (`batch.service`) | MORTALITY / BATCH_IMPAIRMENT / BIO_MORTALITY_PREMATURE | Dr Mortality/Impairment Loss · Cr WIP or Bio Pre-mature | `MORTALITY_BATCH` → G/L mirror for WIP batches; item negative if the batch is held as an item |
| E16 | Batch transfer between sheds/farms (`batch-transfer.service`) | BATCH_TRANSFER (account transfer) | Dr WIP (destination dims) · Cr WIP (source dims) | `BATCH_TRANSFER` → G/L mirror (dimension change only) |
| E17 | Batch close variances (standard costing) | PRICE/USAGE/OUTPUT/OVERHEAD_VARIANCE | Dr Variance · Cr WIP | `BATCH_VARIANCE` → G/L mirror |
| E18 | Day reversal (`batch-day-reversal.service`, `reverseJournal`) | (same type, opposite sign) | Mirror of the original | `REVERSAL` → posts the opposite of the referenced request (§7.12) |

### 4.3 Breeding and biological assets (BBP-2)

| # | NAVFarm event | Mapping type | Dr / Cr | BC event type → posting |
|---|---|---|---|---|
| E19 | Animal registered with opening value (`animal.service`, ANIMAL_REGISTRATION) | BIO_ACQUISITION | Dr Bio Assets · Cr (opening / payables) | `FA_CREATE` + `FA_ACQUISITION` (go-live only, §11) |
| E20 | Semen collected (`semen-lot.service` OUTPUT) | BIO_SEMEN_PRODUCTION | Dr Finished Goods (semen) · Cr Boar Cost Recovered | `OUTPUT` (semen item positive) |
| E21 | Semen used on a sow (`semen-lot.service` CONSUMPTION) | BIO_SEMEN_USE / BIO_SEMEN_EXPENSE | Dr Pre-mature asset (sow) or Consumption Exp · Cr Semen inventory | `CONSUMPTION_CAPITALISED` (pre-mature sow) or `CONSUMPTION` (mature) |
| E22 | Amortisation run, imported breeders (`bio-costing-run.service`, method AMORTIZATION) | BIO_AMORTIZATION | Dr Amortisation Expense · Cr Accumulated Amortisation (dev maps Cr to Mature asset; **G8**) | `FA_AMORTISATION` → FA G/L journal, FA Posting Type = Depreciation, one line per animal (§7.7) |
| E23 | Fair-value run, local breeders (`bio-costing-run.service`, method FAIR_VALUE) | BIO_FAIR_VALUE | Gain: Dr Asset · Cr FV Gain / Loss: Dr FV Loss · Cr Asset | `FA_FAIR_VALUE` → FA G/L journal, Appreciation (gain) or Write-Down (loss), per animal (§7.8) |
| E24 | Fair value of weaner/grower lots (`lot-fair-value.service`) | BIO_FAIR_VALUE_PREMATURE / LOT_WIP | Dr/Cr Lot value · FV Gain/Loss | `BATCH_FAIR_VALUE` → G/L mirror, Batch dimension (BBP-2 §6) |
| E25 | Pre-mature → mature (start week reached) | BIO_TRANSFORMATION | Dr Bio Mature · Cr Bio Pre-mature | `FA_MATURITY` → no BC FA posting if one FA posting group covers the life; G/L mirror reclass if Finance keeps separate pre-mature/mature accounts (**DECISION D11**) |
| E26 | Farrowing — litter birth cost to piglets (`litter-cost.service`) | BIO_LITTER_BIRTH (+ LITTER_*_EXP_FEED/OH reclasses) | Dr Weaners Inventory · Cr Bio Pre-mature / WIP | `LITTER_OUTPUT` → Item journal Positive Adjmt. of piglet item, qty = live born, unit cost = cost per piglet, Batch dim (BBP-2 §5); reclasses as G/L mirror |
| E27 | Gilt selection → local breeding asset (`gilt-selection`, GILT_SELECTION) | BIO_GILT_ACQUISITION | Dr Bio Pre-mature (Local GGP/GP/Parent) · Cr Weaners Inventory | `GILT_SELECTION` → per gilt: create child FA (category from mating line), Item journal Negative Adjmt. (clearing), FA acquisition from clearing (§7.9) |
| E28 | Breeding animal death (`animal.service` / `batch.service` MORTALITY) | BIO_MORTALITY_MATURE / BIO_MORTALITY_PREMATURE | Dr Mortality/Impairment Loss · Cr Bio Asset | `FA_MORTALITY` → FA disposal at zero proceeds (§7.10). BBP-2 §7 |
| E29 | Cull: FA → inventory (`bio-costing-exit.service`, `fa_inventory_conversion`) | BIO_FA_CONVERSION | Dr Finished Goods (culled breeding asset) · Cr Bio Mature | `FA_TO_INVENTORY` → BBP-2 §8 10-step: final amortisation, reverse FV, dispose FA, item positive at carrying cost; returns FA ledger + item ledger nos. to `fa_inventory_conversion.bc_fa_ledger_entry_no / bc_item_ledger_entry_no` (§7.11) |
| E30 | Animal/batch sold directly (`batch.service` SALE) | BIO_SALE_PROCEEDS + BIO_DISPOSAL_SOLD | Dr Receivables · Cr Asset; Dr Asset · Cr Gain on Disposal | `FA_SALE` → sales invoice with FA line (Disposal) or item line (**DECISION D12**) |

### 4.4 Sales to the abattoir (slaughter Transfer Order)

| # | NAVFarm event | Mapping type | BC event type → posting |
|---|---|---|---|
| E31 | TO confirmed — head dispatched (`slaughter-transfer.service.confirm`) | BIO_SLAUGHTER_DISPATCH | `SLAUGHTER_DISPATCH` → Transfer Order from farm location to an in-transit / customer-consignment location; one line per batch (BBP-1 "one line per batch per source") |
| E32 | DOA on arrival (`pod`) | BIO_SLAUGHTER_DOA | `SLAUGHTER_DOA` → Negative Adjmt. at the in-transit location, Gen. Bus. PG `NVF-MORT`, posted to the **original batch** dims (MOM 24 Aug) |
| E33 | Kill sheet entered — invoice (`killSheet`) | BIO_SLAUGHTER_SALE + BIO_SLAUGHTER_COGS | `SLAUGHTER_INVOICE` → Sales Invoice to customer (Colcom): qty = received head, amount = carcass kg × price/kg, Farm dim = **supplying farm**; ship from in-transit location. Returns posted invoice no. → `slaughter_transfer_order.invoice_no`. COMMERCIAL and CULLED_BREEDING_ASSET lines on separate invoices (BBP-1) |

### 4.5 Finance documents

| # | NAVFarm event | BC event type → posting |
|---|---|---|
| E34 | Expense voucher / expense (`expense.service`, `expense_document`) | `EXPENSE_VOUCHER` → new General Journal Batch named `EV-YYYY-NN` (BBP-1 7-step), lines Dr expense G/L (Farm + optional Batch dims) · Cr payment/bal. account; if FA-linked, an extra FA acquisition line. Returns G/L entry nos. → `expense_document` |
| E35 | Any other NAVFarm system journal not listed above | `GL_JOURNAL` → G/L mirror (safety net, §1.4) |

### 4.6 Requisitions (documents, not postings)

| # | NAVFarm event | BC API |
|---|---|---|
| R1 | Requisition **released**, kind ITEM (purpose PURCHASE), FA or SERVICE (`requisition.service.release`, today sets `integration_status = BC_PENDING`) | `purchaseRequests` → BC Requisition Worksheet lines in template `REQ`, batch `NAVFARM` (§7.13). BC buyer runs *Carry Out Action Message*; the PO no. flows back via the M12 PO sync and replaces today's manual *link-po* |
| R2 | Feed requisition **approved** (`feed-requisition`; stops at Approved today) | `transferRequests` → BC Transfer Order from mill location to farm location (BBP-1: the feed-mill user ships against it); shipment/receipt status read back via std `transferOrders`. NAVFarm's own stock-transfer shipment/receipt then becomes a mirror of BC (**DECISION D10**) |

---

## 5. The integration API contract

### 5.1 Endpoints (all under `/api/ptl/navfarm/v1.0/companies({companyId})/`)

| Entity set | Methods | Purpose |
|---|---|---|
| `farmItems` | GET | M3 items with sync flag |
| `inventoryPostingSetups`, `generalPostingSetups`, `faPostingGroups` | GET | M4/M5 |
| `farmFixedAssets` | GET, POST, PATCH | M10 child/main FAs + book values |
| `nvfDimensionValues` | GET, POST | Create BATCH values (M2) |
| `postingRequests` (+ `postingRequestLines` part) | GET, POST (deep insert), bound action `post` | All financial events (§4) |
| `purchaseRequests` (+ lines) | GET, POST, bound action `submit` | R1 |
| `transferRequests` (+ lines) | GET, POST, bound action `submit` | R2 |
| `faLedgerEntries`, `valueEntries` | GET | Reconciliation (std `itemLedgerEntries`, `generalLedgerEntries` cover the rest) |
| `nvfSetup` | GET | Posting window, template names, health check |

### 5.2 Posting request — header

| JSON | AL field | Type | Req. | Notes |
|---|---|---|---|---|
| `id` | SystemId | Guid | — | BC-assigned |
| `navfarmEventId` | NAVFarm Event Id | Text[50] | ✔ | **Unique key.** = `bc_sync_queue.navfarm_event_id` |
| `eventType` | Event Type | Enum "NVF Event Type" | ✔ | §5.4 |
| `navfarmDocumentType` | NAVFarm Document Type | Code[30] | ✔ | `journal_header.source_document_type` (BATCH, GOODS_RECEIPT…) |
| `navfarmDocumentNo` | NAVFarm Document No. | Code[20] | ✔ | Becomes BC `Document No.` (cut to 20; full in External Doc.) |
| `navfarmJournalNo` | NAVFarm Journal No. | Code[20] | | `journal_header.journal_no`, for reconciliation |
| `postingDate` | Posting Date | Date | ✔ | Must be inside BC's Allow Posting window |
| `farmCode` | Farm Code | Code[20] | ✔ | COSTCENTRE value |
| `description` | Description | Text[100] | | |
| `reversesEventId` | Reverses Event Id | Text[50] | for REVERSAL | |
| `bcDocumentNo` / `bcSourceNo` | | Code[20] | | Inputs for receipts/transfers/invoices: PO no., TO no., customer no. |
| `status` | Status | Enum | out | Received / Posting / Posted / Failed / Duplicate |
| `errorCode`, `errorText` | | Code[30], Text[2048] | out | §5.5 |
| `postedDocumentNo` | | Code[20] | out | Posted receipt / shipment / invoice no. |
| `glRegisterNo` | | Integer | out | |
| `postedAt` | | DateTime | out | |

### 5.3 Posting request — line

| JSON | AL field | Type | Notes |
|---|---|---|---|
| `lineNo` | Line No. | Integer | |
| `navfarmLineId` | NAVFarm Line Id | Text[50] | Source ledger row id (`inventory_ledger.ledger_id`, `bio_costing_run_line.line_id`, `journal_line.line_id`…) |
| `lineType` | Line Type | Enum | ITEM, GL_ACCOUNT, FIXED_ASSET, PO_LINE, TRANSFER_LINE |
| `number` | No. | Code[20] | Item no., G/L account no., or FA no. |
| `faNo` | FA No. | Code[20] | For FA lines; or empty + `animalCode` when the FA is created in the same request |
| `animalCode` | Animal Code | Code[30] | Tattoo; resolves the child FA |
| `faPostingType` | FA Posting Type | Option | Acquisition Cost, Depreciation, Write-Down, Appreciation, Disposal |
| `itemEntryType` | Item Entry Type | Option | Positive Adjmt., Negative Adjmt. |
| `genBusPostingGroup` | Gen. Bus. Posting Group | Code[20] | From the mapping-type table (§3.5) |
| `locationCode` | Location Code | Code[10] | BC location of the farm/mill |
| `quantity` | Quantity | Decimal | Positive |
| `unitOfMeasureCode` | UoM | Code[10] | |
| `unitCost` | Unit Cost | Decimal | Positive adjustments / output only |
| `amount` | Amount | Decimal | G/L and FA lines; signed (+ debit, − credit) for GL_ACCOUNT lines |
| `balAccountNo` | Bal. Account No. | Code[20] | FA and G/L lines where needed |
| `lotNo`, `expirationDate` | | Code[50], Date | Lot-tracked items |
| `sourceLineNo` | | Integer | PO line no. / TO line no. |
| `costCentreCode`, `batchCode`, `stageCode`, `lobCode` | | Code[20] | Dimension values |
| out: `itemLedgerEntryNo`, `valueEntryNo`, `faLedgerEntryNo`, `glEntryNo`, `costAmountActual` | | Integer / Decimal | Returned per line |

### 5.4 Event types (enum `NVF Event Type`)

```
PURCHASE_RECEIPT, LIVESTOCK_RECEIPT, TRANSFER_SHIPMENT, TRANSFER_RECEIPT,
INVENTORY_ADJUSTMENT, PHYSICAL_INVENTORY,
CONSUMPTION, CONSUMPTION_CAPITALISED, OUTPUT, LITTER_OUTPUT, OVERHEAD,
MORTALITY_BATCH, BATCH_TRANSFER, BATCH_VARIANCE, BATCH_FAIR_VALUE,
FA_CREATE, FA_ACQUISITION, FA_AMORTISATION, FA_FAIR_VALUE, FA_MATURITY,
GILT_SELECTION, FA_MORTALITY, FA_TO_INVENTORY, FA_SALE,
SLAUGHTER_DISPATCH, SLAUGHTER_DOA, SLAUGHTER_INVOICE,
EXPENSE_VOUCHER, GL_JOURNAL, REVERSAL
```

### 5.5 Error contract

`post` never throws to the caller for business errors. It sets `status = Failed` with:

| errorCode | Meaning | NAVFarm action |
|---|---|---|
| `DUPLICATE` | `navfarmEventId` already posted | Read the original result; mark the row posted |
| `MISSING_MASTER` | Item / G/L / location / FA / dimension value not found | Alert Finance (CRITICAL per BBP-1); no retry until fixed |
| `PERIOD_CLOSED` | Posting date outside the allowed window | Alert Finance |
| `RULE_VIOLATION` | A BBP-2 control point (§6.8) | Alert; needs correction in NAVFarm |
| `INSUFFICIENT_STOCK` | Negative inventory not allowed / lot not available | Alert farm + Finance |
| `PO_MISMATCH` | PO/line not found, already received or over-receipt | Alert purchasing |
| `BC_ERROR` | Any other platform error (text in `errorText`) | Retry 3× at 15 min, then alert |

HTTP-level failures (401, 429, 5xx, timeouts) are retried by NAVFarm with back-off. Because of `navfarmEventId`, a retry after a timeout is always safe.

### 5.6 Sample calls

```http
POST /api/ptl/navfarm/v1.0/companies(…)/postingRequests
Content-Type: application/json

{
  "navfarmEventId": "6f1c…-consumption-2026-11-16-POR100",
  "eventType": "CONSUMPTION",
  "navfarmDocumentType": "BATCH",
  "navfarmDocumentNo": "1-26-22",
  "postingDate": "2026-11-16",
  "farmCode": "POR100",
  "postingRequestLines": [
    { "lineNo": 10000, "navfarmLineId": "9b2…", "lineType": "ITEM",
      "number": "FEED-GROWER-2", "itemEntryType": "Negative Adjmt.",
      "genBusPostingGroup": "NVF-CONS", "locationCode": "POR100",
      "quantity": 1250, "unitOfMeasureCode": "KG", "lotNo": "L-2611-04",
      "costCentreCode": "POR100", "batchCode": "1-26-22", "stageCode": "GROWER", "lobCode": "LVS_PIGGERY" }
  ]
}
```

```http
POST /api/ptl/navfarm/v1.0/companies(…)/postingRequests({id})/Microsoft.NAV.post
GET  /api/ptl/navfarm/v1.0/companies(…)/postingRequests({id})?$expand=postingRequestLines
```

---

## 6. AL objects to build — specification and code

### 6.1 Object list

| ID | Type | Name | Purpose |
|---|---|---|---|
| 50100 | Table | NVF Setup | Journal templates/batches, clearing accounts, dimension codes, depreciation book |
| 50101 | Table | NVF Posting Request | Staging header (§5.2) |
| 50102 | Table | NVF Posting Request Line | Staging line (§5.3) |
| 50103 | Table | NVF Purchase Request (+ 50104 line) | R1 staging |
| 50105 | Table | NVF Transfer Request (+ 50106 line) | R2 staging |
| 50110 | Enum | NVF Event Type | §5.4 |
| 50111 | Enum | NVF Request Status | Received, Posting, Posted, Failed, Duplicate |
| 50112 | Enum | NVF Line Type | ITEM, GL_ACCOUNT, FIXED_ASSET, PO_LINE, TRANSFER_LINE |
| 50113 | Enum | NVF Item Kind | §3.4 |
| 50120 | TableExt | NVF Item (27) | Sync flag, withdrawal days, item kind, bio category |
| 50121 | TableExt | NVF Fixed Asset (5600) | Animal code (unique key), animal id, gender, origin, mating line, birth date |
| 50122 | TableExt | NVF Purchase Line (39) | NAVFarm requisition no./line id |
| 50123 | TableExt | NVF Requisition Line (246) | NAVFarm requisition no./line id |
| 50124 | TableExt | NVF Transfer Header (5740) | NAVFarm requisition / TO no. |
| 50130 | Codeunit | NVF Posting Mgt. | Entry point: idempotency, dispatch, error capture |
| 50131 | Codeunit | NVF Post Request | Runs one request inside its own transaction (`Codeunit.Run`) |
| 50132 | Codeunit | NVF Item Handlers | Consumption, output, adjustments, litter |
| 50133 | Codeunit | NVF FA Handlers | Create child FA, acquisition, amortisation, fair value, mortality, disposal, conversion |
| 50134 | Codeunit | NVF Document Handlers | Purchase receipt, transfer ship/receive, sales invoice |
| 50135 | Codeunit | NVF GL Handlers | G/L mirror, EV, reversal |
| 50136 | Codeunit | NVF Dimension Mgt. | Build Dimension Set IDs, create BATCH values |
| 50137 | Codeunit | NVF Event Subscribers | Copy NVF fields Req. line → Purchase line on Make Order |
| 50140–50160 | Page (API) | One per entity set in §5.1 | |
| 50170 | Page | NVF Posting Requests (list + card) | Finance can see, filter, and retry failed requests in BC |
| 50190 | PermissionSet | NVF-INTEGRATION | Least privilege for the Entra app |

### 6.2 Setup table

```al
table 50100 "NVF Setup"
{
    DataClassification = CustomerContent;
    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(10; "Item Jnl. Template"; Code[10]) { TableRelation = "Item Journal Template"; }
        field(11; "Item Jnl. Batch"; Code[10]) { }
        field(12; "Gen. Jnl. Template"; Code[10]) { TableRelation = "Gen. Journal Template"; }
        field(13; "Gen. Jnl. Batch"; Code[10]) { }
        field(14; "FA Jnl. Template"; Code[10]) { TableRelation = "Gen. Journal Template"; }  // FA G/L journal is a Gen. Journal
        field(15; "FA Jnl. Batch"; Code[10]) { }
        field(20; "Depreciation Book Code"; Code[10]) { TableRelation = "Depreciation Book"; }
        field(21; "Capitalisation Clearing Acc."; Code[20]) { TableRelation = "G/L Account"; }
        field(22; "Livestock Purch. Clearing Acc."; Code[20]) { TableRelation = "G/L Account"; }
        field(23; "Gilt Transfer Clearing Acc."; Code[20]) { TableRelation = "G/L Account"; }
        field(30; "Cost Centre Dim. Code"; Code[20]) { TableRelation = Dimension; }
        field(31; "Batch Dim. Code"; Code[20]) { TableRelation = Dimension; }
        field(32; "Stage Dim. Code"; Code[20]) { TableRelation = Dimension; }
        field(33; "LOB Dim. Code"; Code[20]) { TableRelation = Dimension; }
        field(34; "Auto-create Batch Values"; Boolean) { }
        field(40; "FA Class Code"; Code[10]) { TableRelation = "FA Class"; }
        field(41; "FA Nos."; Code[20]) { TableRelation = "No. Series"; }
        field(42; "In-Transit Location"; Code[10]) { TableRelation = Location; }
    }
    keys { key(PK; "Primary Key") { Clustered = true; } }
}
```

### 6.3 Staging tables (abridged — add every field from §5.2/5.3)

```al
table 50101 "NVF Posting Request"
{
    DataClassification = CustomerContent;
    fields
    {
        field(1; "Entry No."; BigInteger) { AutoIncrement = true; }
        field(2; "NAVFarm Event Id"; Text[50]) { NotBlank = true; }
        field(3; "Event Type"; Enum "NVF Event Type") { }
        field(4; "NAVFarm Document Type"; Code[30]) { }
        field(5; "NAVFarm Document No."; Code[20]) { }
        field(6; "NAVFarm Journal No."; Code[20]) { }
        field(7; "Posting Date"; Date) { }
        field(8; "Farm Code"; Code[20]) { }
        field(9; Description; Text[100]) { }
        field(10; "Reverses Event Id"; Text[50]) { }
        field(11; "BC Document No."; Code[20]) { }      // input: PO / TO no.
        field(12; "BC Source No."; Code[20]) { }        // input: customer / vendor no.
        field(20; Status; Enum "NVF Request Status") { }
        field(21; "Error Code"; Code[30]) { }
        field(22; "Error Text"; Text[2048]) { }
        field(23; "Posted Document No."; Code[20]) { }
        field(24; "G/L Register No."; Integer) { }
        field(25; "Posted At"; DateTime) { }
        field(26; "Attempts"; Integer) { }
    }
    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(EventId; "NAVFarm Event Id") { Unique = true; }
        key(Doc; "NAVFarm Document Type", "NAVFarm Document No.") { }
    }
}

table 50102 "NVF Posting Request Line"
{
    DataClassification = CustomerContent;
    fields
    {
        field(1; "Request Id"; Guid) { }                 // = header SystemId (API SubPageLink)
        field(2; "Line No."; Integer) { }
        field(3; "NAVFarm Line Id"; Text[50]) { }
        field(4; "Line Type"; Enum "NVF Line Type") { }
        field(5; "No."; Code[20]) { }
        field(6; "FA No."; Code[20]) { }
        field(7; "Animal Code"; Code[30]) { }
        field(8; "FA Posting Type"; Enum "Gen. Journal Line FA Posting Type") { }
        field(9; "Item Entry Type"; Enum "Item Ledger Entry Type") { }
        field(10; "Gen. Bus. Posting Group"; Code[20]) { TableRelation = "Gen. Business Posting Group"; }
        field(11; "Location Code"; Code[10]) { TableRelation = Location; }
        field(12; Quantity; Decimal) { DecimalPlaces = 0 : 5; }
        field(13; "Unit of Measure Code"; Code[10]) { }
        field(14; "Unit Cost"; Decimal) { DecimalPlaces = 2 : 5; }
        field(15; Amount; Decimal) { }
        field(16; "Bal. Account No."; Code[20]) { }
        field(17; "Lot No."; Code[50]) { }
        field(18; "Expiration Date"; Date) { }
        field(19; "Source Line No."; Integer) { }
        field(20; "Cost Centre Code"; Code[20]) { }
        field(21; "Batch Code"; Code[20]) { }
        field(22; "Stage Code"; Code[20]) { }
        field(23; "LOB Code"; Code[20]) { }
        field(30; "Item Ledger Entry No."; Integer) { }
        field(31; "Value Entry No."; Integer) { }
        field(32; "FA Ledger Entry No."; Integer) { }
        field(33; "G/L Entry No."; Integer) { }
        field(34; "Cost Amount (Actual)"; Decimal) { }
    }
    keys { key(PK; "Request Id", "Line No.") { Clustered = true; } }
}
```

### 6.4 Item extension and API page

```al
tableextension 50120 "NVF Item" extends Item
{
    fields
    {
        field(50100; "NVF Sync to NAVFarm"; Boolean) { Caption = 'Sync to NAVFarm Farm Item'; DataClassification = CustomerContent; }
        field(50101; "NVF Withdrawal Days"; Integer) { MinValue = 0; DataClassification = CustomerContent; }
        field(50102; "NVF Item Kind"; Enum "NVF Item Kind") { DataClassification = CustomerContent; }
        field(50103; "NVF Bio Category"; Code[20]) { DataClassification = CustomerContent; }
    }
}

page 50140 "NVF Farm Item API"
{
    PageType = API;
    APIPublisher = 'ptl';
    APIGroup = 'navfarm';
    APIVersion = 'v1.0';
    EntityName = 'farmItem';
    EntitySetName = 'farmItems';
    SourceTable = Item;
    SourceTableView = where("NVF Sync to NAVFarm" = const(true));
    ODataKeyFields = SystemId;
    Editable = false;
    DelayedInsert = true;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { }
                field(number; Rec."No.") { }
                field(description; Rec.Description) { }
                field(type; Rec.Type) { }
                field(itemCategoryCode; Rec."Item Category Code") { }
                field(baseUnitOfMeasure; Rec."Base Unit of Measure") { }
                field(purchUnitOfMeasure; Rec."Purch. Unit of Measure") { }
                field(itemTrackingCode; Rec."Item Tracking Code") { }
                field(lotNos; Rec."Lot Nos.") { }
                field(expirationCalculation; Rec."Expiration Calculation") { }
                field(inventoryPostingGroup; Rec."Inventory Posting Group") { }
                field(genProdPostingGroup; Rec."Gen. Prod. Posting Group") { }
                field(costingMethod; Rec."Costing Method") { }
                field(unitCost; Rec."Unit Cost") { }
                field(withdrawalDays; Rec."NVF Withdrawal Days") { }
                field(farmItemKind; Rec."NVF Item Kind") { }
                field(bioCategory; Rec."NVF Bio Category") { }
                field(blocked; Rec.Blocked) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
```

Expose `lotTracked` / `serialTracked` either as calculated fields from the Item Tracking Code (`OnAfterGetRecord`) or through a separate `itemTrackingCodes` API. Unticking the sync flag must **not** delete the item in NAVFarm. NAVFarm marks it inactive when it disappears from the filtered set; add a `syncToNavfarm` field and remove the `SourceTableView` filter if you prefer an explicit flag.

### 6.5 Posting request API with the `post` action

```al
page 50150 "NVF Posting Request API"
{
    PageType = API;
    APIPublisher = 'ptl';
    APIGroup = 'navfarm';
    APIVersion = 'v1.0';
    EntityName = 'postingRequest';
    EntitySetName = 'postingRequests';
    SourceTable = "NVF Posting Request";
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    InsertAllowed = true;
    ModifyAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { Editable = false; }
                field(navfarmEventId; Rec."NAVFarm Event Id") { }
                field(eventType; Rec."Event Type") { }
                field(navfarmDocumentType; Rec."NAVFarm Document Type") { }
                field(navfarmDocumentNo; Rec."NAVFarm Document No.") { }
                field(navfarmJournalNo; Rec."NAVFarm Journal No.") { }
                field(postingDate; Rec."Posting Date") { }
                field(farmCode; Rec."Farm Code") { }
                field(description; Rec.Description) { }
                field(reversesEventId; Rec."Reverses Event Id") { }
                field(bcDocumentNo; Rec."BC Document No.") { }
                field(bcSourceNo; Rec."BC Source No.") { }
                field(status; Rec.Status) { Editable = false; }
                field(errorCode; Rec."Error Code") { Editable = false; }
                field(errorText; Rec."Error Text") { Editable = false; }
                field(postedDocumentNo; Rec."Posted Document No.") { Editable = false; }
                field(glRegisterNo; Rec."G/L Register No.") { Editable = false; }
                field(postedAt; Rec."Posted At") { Editable = false; }
                part(postingRequestLines; "NVF Posting Req. Line API")
                {
                    EntityName = 'postingRequestLine';
                    EntitySetName = 'postingRequestLines';
                    SubPageLink = "Request Id" = field(SystemId);
                }
            }
        }
    }

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    var
        Existing: Record "NVF Posting Request";
    begin
        // Idempotency on insert: a repeat returns the existing record instead of an error.
        Existing.SetRange("NAVFarm Event Id", Rec."NAVFarm Event Id");
        if Existing.FindFirst() then begin
            Rec := Existing;
            exit(false);
        end;
        Rec.Status := Rec.Status::Received;
    end;

    [ServiceEnabled]
    procedure post(var ActionContext: WebServiceActionContext)
    var
        PostingMgt: Codeunit "NVF Posting Mgt.";
    begin
        PostingMgt.Post(Rec);
        ActionContext.SetObjectType(ObjectType::Page);
        ActionContext.SetObjectId(Page::"NVF Posting Request API");
        ActionContext.AddEntityKey(Rec.FieldNo(SystemId), Rec.SystemId);
        ActionContext.SetResultCode(WebServiceActionResultCode::Updated);
    end;
}
```

Test the duplicate-insert path early. If the platform does not accept `exit(false)` with a reassigned `Rec` for API inserts on your version, return an HTTP 409 with errorCode `DUPLICATE` instead, and NAVFarm will look the request up by `navfarmEventId`.

### 6.6 Posting manager — transaction safety

```al
codeunit 50130 "NVF Posting Mgt."
{
    procedure Post(var Req: Record "NVF Posting Request")
    begin
        if Req.Status = Req.Status::Posted then
            exit;                                   // idempotent: already done
        Req.Status := Req.Status::Posting;
        Req.Attempts += 1;
        Req.Modify();
        Commit();                                   // required before Codeunit.Run with a return value

        ClearLastError();
        if Codeunit.Run(Codeunit::"NVF Post Request", Req) then begin
            Req.Get(Req."Entry No.");
            Req.Status := Req.Status::Posted;
            Req."Posted At" := CurrentDateTime();
            Req."Error Code" := '';
            Req."Error Text" := '';
        end else begin
            Req.Get(Req."Entry No.");               // everything the run wrote is rolled back
            Req.Status := Req.Status::Failed;
            Req."Error Code" := ClassifyError(GetLastErrorCode(), GetLastErrorText());
            Req."Error Text" := CopyStr(GetLastErrorText(), 1, MaxStrLen(Req."Error Text"));
        end;
        Req.Modify();
    end;

    local procedure ClassifyError(Code: Text; Msg: Text): Code[30]
    begin
        // Handlers raise errors prefixed with a code, e.g. 'MISSING_MASTER: Item FEED-X does not exist.'
        if Msg.StartsWith('MISSING_MASTER') then exit('MISSING_MASTER');
        if Msg.StartsWith('RULE_VIOLATION') then exit('RULE_VIOLATION');
        if Msg.StartsWith('PO_MISMATCH') then exit('PO_MISMATCH');
        if Msg.StartsWith('INSUFFICIENT_STOCK') then exit('INSUFFICIENT_STOCK');
        if Msg.Contains('Allow Posting') or Msg.Contains('posting date') then exit('PERIOD_CLOSED');
        exit('BC_ERROR');
    end;
}

codeunit 50131 "NVF Post Request"
{
    TableNo = "NVF Posting Request";

    trigger OnRun()
    var
        ItemH: Codeunit "NVF Item Handlers";
        FAH: Codeunit "NVF FA Handlers";
        DocH: Codeunit "NVF Document Handlers";
        GLH: Codeunit "NVF GL Handlers";
    begin
        ValidateCommon(Rec);                        // farm code, posting date, masters exist
        case Rec."Event Type" of
            Rec."Event Type"::CONSUMPTION,
            Rec."Event Type"::OUTPUT,
            Rec."Event Type"::LITTER_OUTPUT,
            Rec."Event Type"::INVENTORY_ADJUSTMENT,
            Rec."Event Type"::PHYSICAL_INVENTORY,
            Rec."Event Type"::SLAUGHTER_DOA:
                ItemH.Post(Rec);
            Rec."Event Type"::CONSUMPTION_CAPITALISED:
                begin
                    ItemH.Post(Rec);
                    FAH.PostCapitalisation(Rec);
                end;
            Rec."Event Type"::FA_CREATE,
            Rec."Event Type"::FA_ACQUISITION,
            Rec."Event Type"::FA_AMORTISATION,
            Rec."Event Type"::FA_FAIR_VALUE,
            Rec."Event Type"::FA_MATURITY,
            Rec."Event Type"::FA_MORTALITY,
            Rec."Event Type"::FA_TO_INVENTORY,
            Rec."Event Type"::GILT_SELECTION:
                FAH.Post(Rec);
            Rec."Event Type"::PURCHASE_RECEIPT,
            Rec."Event Type"::LIVESTOCK_RECEIPT,
            Rec."Event Type"::TRANSFER_SHIPMENT,
            Rec."Event Type"::TRANSFER_RECEIPT,
            Rec."Event Type"::SLAUGHTER_DISPATCH,
            Rec."Event Type"::SLAUGHTER_INVOICE,
            Rec."Event Type"::FA_SALE:
                DocH.Post(Rec);
            else
                GLH.Post(Rec);                      // OVERHEAD, BATCH_*, MORTALITY_BATCH, EXPENSE_VOUCHER, GL_JOURNAL, REVERSAL
        end;
    end;
}
```

### 6.7 Dimension helper

```al
codeunit 50136 "NVF Dimension Mgt."
{
    procedure GetDimSetId(Line: Record "NVF Posting Request Line"): Integer
    var
        Setup: Record "NVF Setup";
        TempDimSetEntry: Record "Dimension Set Entry" temporary;
        DimMgt: Codeunit DimensionManagement;
    begin
        Setup.Get();
        AddDim(TempDimSetEntry, Setup."Cost Centre Dim. Code", Line."Cost Centre Code", true);
        AddDim(TempDimSetEntry, Setup."LOB Dim. Code", Line."LOB Code", false);
        AddDim(TempDimSetEntry, Setup."Batch Dim. Code", Line."Batch Code", false);
        AddDim(TempDimSetEntry, Setup."Stage Dim. Code", Line."Stage Code", false);
        exit(DimMgt.GetDimensionSetID(TempDimSetEntry));
    end;

    local procedure AddDim(var TempDimSetEntry: Record "Dimension Set Entry" temporary; DimCode: Code[20]; ValueCode: Code[20]; Mandatory: Boolean)
    var
        DimValue: Record "Dimension Value";
    begin
        if (DimCode = '') or (ValueCode = '') then begin
            if Mandatory then
                Error('MISSING_MASTER: Dimension %1 is mandatory.', DimCode);
            exit;
        end;
        if not DimValue.Get(DimCode, ValueCode) then
            Error('MISSING_MASTER: Dimension value %1 %2 does not exist.', DimCode, ValueCode);
        TempDimSetEntry.Init();
        TempDimSetEntry.Validate("Dimension Code", DimCode);
        TempDimSetEntry.Validate("Dimension Value Code", ValueCode);
        TempDimSetEntry.Insert();
    end;
}
```

After setting `"Dimension Set ID"` on a journal line, call `DimMgt.UpdateGlobalDimFromDimSetID(DimSetId, Line."Shortcut Dimension 1 Code", Line."Shortcut Dimension 2 Code")` so the global dimensions are filled.

### 6.8 BBP-2 control points enforced in BC

| Rule (BBP-2) | Where | Check |
|---|---|---|
| Duplicate posting prohibited | Posting Mgt. | Unique `NAVFarm Event Id` |
| Asset category, Main FA and Child FA mandatory on acquisition | FA handler | FA exists, is a component of a main asset, FA posting group set |
| Imported assets cannot use fair value; local cannot use amortisation | FA handler | `FA_AMORTISATION` only on `*-IMP-*` subclasses; `FA_FAIR_VALUE` only on `*-LOC-*` |
| No capitalisation after the amortisation start | FA handler | Posting date < Depreciation Starting Date |
| No amortisation before the start / no duplicate per period | FA handler | Posting date ≥ start; no FA ledger entry with the same External Doc. (run no. + period) |
| NBV may not fall below the residual value | FA handler | Book Value − amount ≥ Salvage Value |
| Duplicate fair value for the same asset and date prohibited | FA handler | Existing Appreciation/Write-Down with the same posting date |
| Write-off amount ≤ carrying value | FA handler | Amount ≤ Book Value |
| Asset cannot be disposed twice | FA handler | FA Depreciation Book `Disposal Date` empty |
| Posted transactions not editable; corrections by reversal | Design | Staging rows are read-only after Posted; `REVERSAL` event |

### 6.9 Permission set

```al
permissionset 50190 "NVF-INTEGRATION"
{
    Assignable = true;
    Caption = 'NAVFarm integration (service)';
    Permissions =
        tabledata "NVF Setup" = R,
        tabledata "NVF Posting Request" = RIM,
        tabledata "NVF Posting Request Line" = RIM,
        tabledata "NVF Purchase Request" = RIM,
        tabledata "NVF Transfer Request" = RIM,
        codeunit "NVF Posting Mgt." = X,
        codeunit "NVF Post Request" = X;
        // + the API pages, and the standard posting permissions the handlers need:
        // include D365 BASIC + D365 ITEM, EDIT / D365 FA, EDIT / D365 JOURNALS, POST /
        // D365 PURCH DOC, POST / D365 SALES DOC, POST / D365 INV DOC, POST
        // in the Entra app's permission list, or build an exact set with the recorder.
}
```

---

## 7. Posting handlers, one per event type

The code below shows the pattern; each handler follows it. Every handler: validates the codes, builds the journal or document lines, posts them, then writes entry numbers back to the request lines.

### 7.1 Finding the entries a posting created

Set **External Document No.** = `navfarmEventId` (truncated to 35 characters) on every journal line, and **Document No.** = the NAVFarm document no. After posting, read entries back:

```al
ItemLedgEntry.SetRange("Document No.", Req."NAVFarm Document No.");
ItemLedgEntry.SetRange("External Document No.", ExtDocNo);
ItemLedgEntry.SetRange("Item No.", Line."No.");
if ItemLedgEntry.FindLast() then Line."Item Ledger Entry No." := ItemLedgEntry."Entry No.";
```

G/L Entry and FA Ledger Entry are read the same way. Use the `G/L Register` created by the run for `glRegisterNo`.

### 7.2 Item journal (CONSUMPTION, OUTPUT, LITTER_OUTPUT, INVENTORY_ADJUSTMENT, SLAUGHTER_DOA)

```al
procedure PostItemLine(Req: Record "NVF Posting Request"; var Line: Record "NVF Posting Request Line")
var
    Setup: Record "NVF Setup";
    Item: Record Item;
    ItemJnlLine: Record "Item Journal Line";
    ItemJnlPostLine: Codeunit "Item Jnl.-Post Line";
    NvfDim: Codeunit "NVF Dimension Mgt.";
    DimMgt: Codeunit DimensionManagement;
begin
    Setup.Get();
    if not Item.Get(Line."No.") then
        Error('MISSING_MASTER: Item %1 does not exist.', Line."No.");

    ItemJnlLine.Init();
    ItemJnlLine."Journal Template Name" := Setup."Item Jnl. Template";
    ItemJnlLine."Journal Batch Name" := Setup."Item Jnl. Batch";
    ItemJnlLine.Validate("Posting Date", Req."Posting Date");
    ItemJnlLine.Validate("Entry Type", Line."Item Entry Type");
    ItemJnlLine."Document No." := Req."NAVFarm Document No.";
    ItemJnlLine."External Document No." := CopyStr(Req."NAVFarm Event Id", 1, MaxStrLen(ItemJnlLine."External Document No."));
    ItemJnlLine.Validate("Item No.", Line."No.");
    ItemJnlLine.Validate("Location Code", Line."Location Code");
    ItemJnlLine.Validate("Unit of Measure Code", Line."Unit of Measure Code");
    ItemJnlLine.Validate(Quantity, Line.Quantity);
    if Line."Item Entry Type" = Line."Item Entry Type"::"Positive Adjmt." then
        ItemJnlLine.Validate("Unit Cost", Line."Unit Cost");        // NAVFarm's cost per piglet / output cost
    if Line."Gen. Bus. Posting Group" <> '' then
        ItemJnlLine.Validate("Gen. Bus. Posting Group", Line."Gen. Bus. Posting Group");
    ItemJnlLine."Dimension Set ID" := NvfDim.GetDimSetId(Line);
    DimMgt.UpdateGlobalDimFromDimSetID(ItemJnlLine."Dimension Set ID",
        ItemJnlLine."Shortcut Dimension 1 Code", ItemJnlLine."Shortcut Dimension 2 Code");

    if Line."Lot No." <> '' then
        AssignLot(ItemJnlLine, Line);                               // see 7.2.1

    ItemJnlPostLine.RunWithCheck(ItemJnlLine);
    ReadBackItemEntries(Req, Line);
end;
```

**7.2.1 Lots.** For lot-tracked items, create the tracking with codeunit *Create Reserv. Entry* (`CreateReservEntryFor` on `Item Journal Line` + `CreateEntry` with status Prospect) before posting. Wrap this in one helper and use it for item journals, purchase receipts and transfers. On a negative adjustment, BC validates that the lot has stock at that location; a shortfall raises `INSUFFICIENT_STOCK`.

**7.2.2 Cost to G/L.** Item posting creates Value Entries. They reach the G/L only if **Inventory Setup → Automatic Cost Posting = Yes**. Turn it on in the sandbox, or schedule *Post Inventory Cost to G/L*. Also schedule **Adjust Cost – Item Entries**; until it runs, consumption cost in BC can differ from NAVFarm (**DECISION D9**).

### 7.3 Purchase receipt (PURCHASE_RECEIPT)

1. Header `bcDocumentNo` = PO no.; each line has `sourceLineNo` = PO line no., `quantity` = accepted qty, and lot + expiry.
2. Find the PO (`Purchase Header`, Document Type Order, status Released). If it is missing, raise `PO_MISMATCH`.
3. Set every PO line's `Qty. to Receive` to 0, then set it to the requested quantity on the listed lines (validate ≤ outstanding qty).
4. Assign lots (7.2.1, on the Purchase Line).
5. Set `Vendor Shipment No.` = NAVFarm GRN no. and post with codeunit `Purch.-Post` (`Receive := true; Invoice := false`).
6. Return `Posted Document No.` = the Purch. Rcpt. No.; read item ledger entries back by receipt no.

Finance posts the purchase invoice in BC later (BBP-2 §2). NAVFarm credits **Trade Payables** at GRN today, but BC credits the interim/accrual account at receipt. Reconcile them as "GRN not invoiced" (gap G8).

### 7.4 Livestock receipt (LIVESTOCK_RECEIPT) — BBP-2 §2

Recommended BC set-up (**DECISION D13**): the PO line for imported breeders is a **G/L Account line** on a *Livestock Purchase Clearing* account (one line per category; quantity = head).

Request lines: one per animal (`lineType FIXED_ASSET`, `animalCode`, category = FA subclass, `sourceLineNo` = PO line, `amount` = acquisition cost incl. landed cost).

Handler:
1. For each animal, `CreateChildFA` (§7.9.1) unless an FA with this `NVF Animal Code` already exists (that existence check is also the idempotency check).
2. Receive the PO line quantity (as in 7.3).
3. FA G/L journal per animal: `Account Type` = Fixed Asset, `FA Posting Type` = Acquisition Cost, `Amount` = acquisition cost, `Bal. Account` = Livestock Purchase Clearing.
4. Return `faNo` and `faLedgerEntryNo` per line. NAVFarm stores the FA no. on `animal_register` (gap G3).

When Finance invoices the PO (Dr Clearing · Cr Vendor), the clearing account nets to zero, matching BBP-2: Dr Imported Bio Asset Acquisition Cost · Cr Vendor.

### 7.5 Transfers (TRANSFER_SHIPMENT / TRANSFER_RECEIPT)

When the BC Transfer Order was created from NAVFarm (R2) or by the mill in BC, `bcDocumentNo` = TO no.:
- Shipment: set `Qty. to Ship` and lots, post with `TransferOrder-Post Shipment`.
- Receipt: set `Qty. to Receive`, post with `TransferOrder-Post Receipt`. A short receipt is a receipt for the received qty plus `INVENTORY_ADJUSTMENT` for the loss (E6). Close the TO only when NAVFarm says the transfer is POSTED.

For NAVFarm-only internal transfers with no BC TO (silo to silo inside one farm/location), **do not send anything**. A BC posting is needed only when the BC location changes.

### 7.6 Capitalised consumption (CONSUMPTION_CAPITALISED) — BBP-2 §3

NAVFarm sends one item line per item consumed **and** one FA line per animal for that day's capitalised amount.

1. Item journal Negative Adjmt. with Gen. Bus. PG `NVF-CAP` (Dr Capitalisation Clearing · Cr Inventory).
2. FA G/L journal per animal: FA Posting Type = **Acquisition Cost**, Amount = the animal's share, Bal. Account = Capitalisation Clearing.

The clearing account must net to zero per request. Check this in the handler, and raise `RULE_VIOLATION` if `Σ FA amounts ≠ BC cost of the item lines` beyond a tolerance (**DECISION D9**). Also reject when the posting date ≥ the FA's Depreciation Starting Date (no capitalisation after week 33 F / 26 M).

### 7.7 Amortisation (FA_AMORTISATION) — BBP-2 §4

NAVFarm sends one `bio_costing_run` (method AMORTIZATION, status POSTED) as one request with one line per CHARGED animal: `faNo`, `amount = charge`, `faPostingType = Depreciation`. External Doc. = `run_no` + `period_key`.

```al
procedure PostFAJnlLine(Req: Record "NVF Posting Request"; var Line: Record "NVF Posting Request Line")
var
    Setup: Record "NVF Setup";
    GenJnlLine: Record "Gen. Journal Line";
    GenJnlPostLine: Codeunit "Gen. Jnl.-Post Line";
    NvfDim: Codeunit "NVF Dimension Mgt.";
    DimMgt: Codeunit DimensionManagement;
begin
    Setup.Get();
    CheckFARules(Req, Line);                               // §6.8: subclass, start date, residual, duplicates
    GenJnlLine.Init();
    GenJnlLine."Journal Template Name" := Setup."FA Jnl. Template";
    GenJnlLine."Journal Batch Name" := Setup."FA Jnl. Batch";
    GenJnlLine.Validate("Posting Date", Req."Posting Date");
    GenJnlLine."Document No." := Req."NAVFarm Document No.";
    GenJnlLine."External Document No." := CopyStr(Req."NAVFarm Event Id", 1, MaxStrLen(GenJnlLine."External Document No."));
    GenJnlLine.Validate("Account Type", GenJnlLine."Account Type"::"Fixed Asset");
    GenJnlLine.Validate("Account No.", Line."FA No.");
    GenJnlLine.Validate("Depreciation Book Code", Setup."Depreciation Book Code");
    GenJnlLine.Validate("FA Posting Type", Line."FA Posting Type");   // Depreciation
    GenJnlLine.Validate(Amount, -Abs(Line.Amount));                   // depreciation is a credit to the FA
    GenJnlLine."Dimension Set ID" := NvfDim.GetDimSetId(Line);
    DimMgt.UpdateGlobalDimFromDimSetID(GenJnlLine."Dimension Set ID",
        GenJnlLine."Shortcut Dimension 1 Code", GenJnlLine."Shortcut Dimension 2 Code");
    GenJnlPostLine.RunWithCheck(GenJnlLine);
    ReadBackFAEntries(Req, Line);
end;
```

With *G/L Integration – Depreciation* ticked, BC posts Dr Depreciation Expense Acc. · Cr Accum. Depreciation from the FA posting group. That is BBP-2's Dr Amortisation Expense · Cr Accumulated Amortisation.

### 7.8 Fair value (FA_FAIR_VALUE) — BBP-2 §5

One line per local-breeder animal; `amount` = current fair value − carrying value.
- Gain (> 0): FA Posting Type **Appreciation**, positive amount → Dr Asset (appreciation) · Cr Fair Value Gain (Appreciation Bal. Account).
- Loss (< 0): FA Posting Type **Write-Down**, negative amount → Dr Fair Value Loss · Cr Asset.

Batch-level fair value for weaners/growers (BBP-2 §6) is `BATCH_FAIR_VALUE`, a G/L mirror with the Batch dimension, because those animals are items, not FAs.

### 7.9 Gilt selection (GILT_SELECTION) — BBP-2 §5

Request: header = `gilt_selection.selection_no`; lines = one ITEM line (piglet/weaner item, Negative Adjmt., qty = head released, Gen. Bus. PG → Gilt Transfer Clearing) and one FIXED_ASSET line per gilt (`animalCode`, category from mating line Z+Z→GGP-LOC, Z+L→GP-LOC, Z+Tempo→P-LOC, `amount` = allocated piglet cost).

1. Item journal negative (Dr Gilt Transfer Clearing · Cr Weaner Inventory).
2. `CreateChildFA` per gilt.
3. FA acquisition per gilt, Bal. Account = Gilt Transfer Clearing.
4. Control (BBP-2): inventory reduction = Σ acquisition values. Otherwise raise `RULE_VIOLATION`.

**7.9.1 Create child FA**

```al
procedure CreateChildFA(Line: Record "NVF Posting Request Line"; MainFANo: Code[20]; StartDate: Date; Salvage: Decimal): Code[20]
var
    Setup: Record "NVF Setup";
    FA: Record "Fixed Asset";
    FADeprBook: Record "FA Depreciation Book";
begin
    Setup.Get();
    FA.SetRange("NVF Animal Code", Line."Animal Code");
    if FA.FindFirst() then
        exit(FA."No.");                                         // idempotent

    FA.Init();
    FA.Insert(true);                                            // takes No. from FA Nos.
    FA.Validate(Description, CopyStr(Line."Animal Code" + ' ' + Line."No.", 1, MaxStrLen(FA.Description)));
    FA.Validate("FA Class Code", Setup."FA Class Code");
    FA.Validate("FA Subclass Code", Line."No.");                // GGP-IMP-F … P-LOC-M
    FA.Validate("Main Asset/Component", FA."Main Asset/Component"::Component);
    FA.Validate("Component of Main Asset", MainFANo);
    FA.Validate("Global Dimension 1 Code", Line."Cost Centre Code");
    FA."NVF Animal Code" := Line."Animal Code";
    FA.Modify(true);

    FADeprBook.Init();
    FADeprBook.Validate("FA No.", FA."No.");
    FADeprBook.Validate("Depreciation Book Code", Setup."Depreciation Book Code");
    FADeprBook.Insert(true);
    FADeprBook.Validate("FA Posting Group", Line."No.");
    FADeprBook.Validate("Depreciation Method", FADeprBook."Depreciation Method"::Manual);
    FADeprBook.Validate("Depreciation Starting Date", StartDate);
    FADeprBook.Validate("Salvage Value", -Abs(Salvage));       // salvage is stored negative
    FADeprBook.Modify(true);
    exit(FA."No.");
end;
```

The *Component of Main Asset* field requires the main asset to have `Main Asset/Component = Main Asset`. Check this sequence in the sandbox, since BC validates main-asset components when the FA is updated.

### 7.10 Breeding-animal mortality (FA_MORTALITY) — BBP-2 §7

FA G/L journal, FA Posting Type **Disposal**, amount 0 proceeds, on the death date. With disposal G/L integration, BC removes acquisition cost and accumulated depreciation and books the loss to the FA posting group's loss account. Map that account to Mortality/Impairment Loss. Set the FA Depreciation Book disposal date and mark the FA `Inactive`.

### 7.11 Cull: FA → inventory (FA_TO_INVENTORY) — BBP-2 §8, 10 steps

Request from `fa_inventory_conversion` when it reaches POSTED. Lines: (a) optional final Depreciation up to the conversion date (imported); (b) reversal of fair-value adjustments (local) as a Write-Down equal to the cumulative appreciation; (c) Disposal of the FA at zero proceeds (the carrying value moves to the clearing account); (d) Item journal Positive Adjmt. of `CULLED-BREEDING-ASSET` (or the agreed item) at **carrying cost** (BBP-2: "inventory recognised at actual cost"), with the offset on the clearing account. Return `faLedgerEntryNo` (disposal) and `itemLedgerEntryNo`. NAVFarm writes them into `fa_inventory_conversion.bc_fa_ledger_entry_no` and `bc_item_ledger_entry_no`, which already exist. The animal then goes on a slaughter TO as a CULLED_BREEDING_ASSET line.

> BBP-1 suggests inventory at market value with gain/loss, while BBP-2 says actual cost after reversing fair value. NAVFarm stores both `market_value` and `nbv_at_conversion`/`gain_loss`. **DECISION D14**.

### 7.12 Reversals (REVERSAL)

NAVFarm reverses a posted day or journal with an opposite entry (`batch-day-reversal.service`, `GlPostingService.reverseJournal`, `inventory_ledger.reversal_of_ledger_id`). Send a new request with `eventType = REVERSAL`, `reversesEventId` = the original, and the same lines with opposite direction (Negative↔Positive Adjmt., amount sign flipped). Do **not** use BC's *Reverse Transaction*: it does not cover item entries, and NAVFarm's reversal may be dated differently from the original. Reject a reversal whose original is not Posted, and reject a second reversal of the same original.

### 7.13 Purchase requisitions (R1)

```
POST /purchaseRequests  { navfarmRequisitionNo: "RQ-00001", requisitionKind: "ITEM|FA|SERVICE",
                          farmCode, requiredDate, requester, justification,
                          lines: [{ navfarmLineId, type: "Item|Fixed Asset|G/L Account", number, description,
                                    quantity, unitOfMeasureCode, estUnitCost, locationCode, vendorNo? }] }
POST /purchaseRequests({id})/Microsoft.NAV.submit
```

`submit` inserts Requisition Lines into worksheet template `REQ`, batch `NAVFARM`, with `NVF Requisition No.` and `NVF Line Id`. Add an **event subscriber** on the Req. Wksh.-Make Order codeunit's purchase-line insert event to copy both fields to the Purchase Line. NAVFarm's hourly PO sync (M12) then finds POs by `NVF Requisition No.` and stores the PO no. on `requisition.linked_po_no`. For SERVICE lines, `number` is a G/L account (BBP-1 "Service GL").

---

## 8. Reconciliation and period close

BBP-1 R18 and BBP-2 §9: every NAVFarm financial event must have a BC counterpart.

| Check | NAVFarm side | BC side | Match key |
|---|---|---|---|
| Every event posted | `bc_sync_queue` where status ≠ BC_POSTED | — | Count must be 0 at period close |
| Inventory movements | `inventory_ledger` (qty, amount) | `itemLedgerEntries`, `valueEntries` | `External Document No.` = navfarmEventId; item; lot |
| Biological assets | `bio_asset_ledger`, `animal_register.book_value` | `faLedgerEntries`, FA Depreciation Book Book Value | FA No. ↔ `animal_register.bc_fa_no` |
| G/L | `journal_line` by account × cost centre × period | `generalLedgerEntries` by G/L × dim 1 × period | Account no. + farm + month |
| Clearing accounts | — | Capitalisation, Livestock Purchase, Gilt Transfer clearing | Balance = 0 |

`faLedgerEntries` API fields: `entryNo, faNo, faPostingType, postingDate, documentNo, externalDocumentNo, amount, depreciationBookCode, glEntryNo, dimension1Code`.
`valueEntries` API fields: `entryNo, itemLedgerEntryNo, itemNo, postingDate, documentNo, externalDocumentNo, costAmountActual, costPostedToGL, valuedQuantity, locationCode, dimension1Code`.

**Period close (BBP-2 §9):** NAVFarm blocks or warns on close while queue items are pending or failed. BC's *Allow Posting From/To* is the hard stop. NAVFarm reads it (M11) and refuses to post into a closed BC window before sending anything.

---

## 9. Gaps NAVFarm must close (NAVFarm developer)

Found by analysing the code and the dev database. The BC side cannot be tested end-to-end until G1–G6 are done.

| # | Gap | Evidence | Fix |
|---|---|---|---|
| **G1** | No cost centres; journals have no farm | `cost_center_master` = 0 rows; 2,000+ `journal_line` rows, all with `cost_center_id` NULL; `location_master` FARM rows have NULL `cost_center_id` | Sync COSTCENTRE dimension values (M2), link each FARM/MILL location, make the cost centre mandatory in `createAndPostSystemJournal` |
| **G2** | No batch / stage / animal on journal lines | `journal_line` has only `gl_account_id, cost_center_id, nob_id, lob_id` | Add `batch_no`, `stage_code`, `animal_id` (and `bc_fa_no`) to `journal_line`, or derive them from the source ledger when building the BC request |
| **G3** | No BC references on NAVFarm rows | `animal_register` has no FA no.; only `fa_inventory_conversion` has `bc_*` columns | Add `bc_fa_no` to `animal_register`; `bc_status`, `bc_request_id`, `bc_*_entry_no` to `journal_header`, `inventory_ledger`, `bio_asset_ledger`, `goods_receipt`, `slaughter_transfer_order`, `expense_document` |
| **G4** | GRN is not linked to a PO | `goods_receipt` has `supplier_id, external_reference_no` but no PO no./line | Add `bc_po_no` (header) and `bc_po_line_no` (line); GRN created from an expected receipt (M12) |
| **G5** | No BC connection settings | `company_master` has none of Tenant ID / environment / company ID / client ID / secret | Add them (secret encrypted with `EncryptionService`); "Test connection" = `GET /companies` |
| **G6** | NAVFarm creates its own masters | Items, G/L accounts, suppliers, customers are created in NAVFarm screens (suppliers/customers: 0 rows in dev) | BC-owned masters become read-only with "Sync now"; one-time code mapping for existing items/accounts (**DECISION D1**) |
| **G7** | Overhead credits Trade Payables | Mapping OVERHEAD / BIO_OVERHEAD_* → Cr 210100 Trade Payables | Finance to confirm; normally an absorption / accrual account. A payable needs a vendor in BC |
| **G8** | Amortisation credit and GRN credit differ from BC's model | BIO_AMORTIZATION Cr = 152200 Bio Mature (BBP: Accumulated Amortisation); PURCHASE Cr = Trade Payables at receipt (BC: accrual until invoice) | Align the mapping with the BC FA posting group; treat "received not invoiced" as a reconciliation item |
| **G9** | No integration outbox | Requisition has `integration_status = BC_PENDING` only | `bc_sync_queue` + `bc_api_log` tables, worker, monitor screen, retry, alerts (see the integration plan §5) |
| **G10** | Fulfilment mode | `IN_HOUSE` only (AGENTS.md) | Company switch `IN_HOUSE` / `BC_INTEGRATED`; nothing is queued in IN_HOUSE; no fake BC calls or states |
| **G11** | Event builder | — | A `BcRequestBuilder` per event type (§4) that reads the journal + source ledger rows and produces §5 payloads with BC codes, never UUIDs |

---

## 10. Testing and acceptance

### 10.1 Sandbox test data (BC)

COA matching Appendix A; dimensions COSTCENTRE (2 farms + mill), LOB, BATCH, STAGE; items: 1 feed (lot-tracked), 1 medicine (lot + expiry), 1 piglet/weaner item, `CULLED-BREEDING-ASSET`; locations for 2 farms + mill + in-transit; FA class BIOLOGICAL, subclasses and FA posting groups for at least GGP-IMP-F, GGP-IMP-M, GP-LOC-F; main FAs; vendor; customer (Colcom); a released PO for feed and one for imported gilts.

### 10.2 Test script per event (minimum)

| Event | Happy path | Must also prove |
|---|---|---|
| Every event | Posted; entries read back; amounts and dims correct | Same `navfarmEventId` twice → one posting; closed period → PERIOD_CLOSED; unknown code → MISSING_MASTER and nothing posted |
| PURCHASE_RECEIPT | Receipt posted, lots on ILE | Over-receipt → PO_MISMATCH |
| LIVESTOCK_RECEIPT | Child FAs under the main FA, acquisition per animal, clearing nets to zero after invoice | Re-send → no second FA (animal code unique) |
| CONSUMPTION_CAPITALISED | FA acquisition cost increases per animal; clearing = 0 | After the start week → RULE_VIOLATION |
| FA_AMORTISATION | Accum. depreciation per animal = NAVFarm `charge` | Same run twice → DUPLICATE; NBV < residual → RULE_VIOLATION; local FA → RULE_VIOLATION |
| FA_FAIR_VALUE | Gain → Appreciation, loss → Write-Down | Imported FA → RULE_VIOLATION |
| GILT_SELECTION | Inventory down = Σ new FA acquisition | Mismatch → RULE_VIOLATION |
| FA_TO_INVENTORY | FA disposed; item in stock at carrying cost; refs stored on `fa_inventory_conversion` | Second conversion → RULE_VIOLATION |
| SLAUGHTER_* | Dispatch to in-transit, DOA loss on original batch, invoice to supplying farm | Commercial + culled on one invoice → rejected |
| REVERSAL | Exact opposite entries | Reverse twice → rejected |

### 10.3 Definition of done (per event type)

1. Spec signed by Finance (use the template in the integration plan §4.9).
2. AL handler deployed to the sandbox, with an automated test codeunit (AL Test Toolkit) for the happy path and every rejection in §10.2.
3. NAVFarm builder + queue done.
4. End-to-end: post the document **in the NAVFarm UI** → check the BC entries → check the BC refs **in MySQL** on the NAVFarm rows. Per project rule, rows existing and green tests are not proof.
5. Reconciliation (§8) shows zero differences for the test period.
6. Finance signs the result.

---

## 11. Go-live cut-over and opening balances

The dev database already holds animals (24 registered, imported and local) and batches with accumulated cost. Production will too. Before switching to `BC_INTEGRATED`:

1. **Masters frozen and mapped:** every NAVFarm item, G/L account, supplier, customer and farm mapped to a BC code (G6).
2. **Breeding animals:** `FA_CREATE` + `FA_ACQUISITION` (Bal. = opening balance account) per live breeding animal at `acquisition_cost` + capitalised cost, then `FA_AMORTISATION` (one opening line = `total_amortised`) or `FA_FAIR_VALUE` (cumulative adjustment). Check NAVFarm `book_value` = BC Book Value per animal.
3. **Batch WIP and lots:** `BATCH_*` G/L mirror per batch at its open cost, Batch dimension.
4. **Stock:** item journal positive adjustments per item/location/lot at NAVFarm cost. Alternatively, if BC already holds the stock, run a NAVFarm stock count against BC quantities instead.
5. **Reconcile** the BC trial balance by farm against NAVFarm `journal_line` totals at the cut-over date. Sign off.
6. **Switch** the company to `BC_INTEGRATED`. Only events dated after cut-over are queued.

Run steps 2–5 as a dedicated `MIGRATION` posting type, so they can be filtered and reversed as a set if a rehearsal fails.

---

## 12. Delivery sequence for the BC developer

| Sprint | BC deliverable | Ready when |
|---|---|---|
| 1 | Extension skeleton, NVF Setup, permission set, Entra app; M3 `farmItems`, M4/M5 posting setups | NAVFarm pulls items and COA from the sandbox |
| 2 | Staging tables, `postingRequests` API, Posting Mgt., Dimension Mgt., `GL_JOURNAL` + `OVERHEAD` + `EXPENSE_VOUCHER` | First G/L posting from NAVFarm round-trips with entry nos. |
| 3 | Item handlers: CONSUMPTION, OUTPUT, INVENTORY_ADJUSTMENT, PHYSICAL_INVENTORY, lots | POST Day from NAVFarm reaches the item ledger |
| 4 | PURCHASE_RECEIPT, R1 purchase requests + Make-Order subscriber, M12 PO read | Requisition → PO → GRN loop works |
| 5 | FA: CreateChildFA, LIVESTOCK_RECEIPT, CONSUMPTION_CAPITALISED, FA_AMORTISATION | One imported gilt lives its life to amortisation in BC |
| 6 | FA_FAIR_VALUE, LITTER_OUTPUT, GILT_SELECTION, BATCH_FAIR_VALUE, FA_MATURITY | Local-breeder path complete |
| 7 | FA_MORTALITY, FA_TO_INVENTORY, MORTALITY_BATCH, SLAUGHTER_*, FA_SALE, R2 transfers | Exit and sales paths complete |
| 8 | REVERSAL, reconciliation APIs, Posting Requests list page with retry, migration run | Rehearsed cut-over reconciles |

---

## 13. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Master ownership of items, G/L accounts, suppliers, customers | BC owns them; NAVFarm keeps read-only copies (BBP-1 already says this for items and COA) |
| D2 | Final event list (BBP-1: "shared after CRP") | Approve §4 |
| D3 | Requisition → BC requisition worksheet, or straight to PO? | Worksheet (§7.13) |
| D4 | Who creates BATCH dimension values? | NAVFarm via API when a batch is activated |
| D5 | Global Dimension 1 | COSTCENTRE (farm) |
| D6 | Cut-over date and opening-balance method | §11 |
| D7 | Main FA per category only, or per category per farm? | Per category; the farm is a dimension |
| D8 | Daily consumption granularity | One request per farm per POST Day, lines per batch × item × lot |
| D9 | Who values consumed stock — NAVFarm rate or BC costing? | BC values purchased stock (FIFO/average + Adjust Cost). NAVFarm sends quantities and stores BC's cost back; capitalisation uses BC cost, and differences above a tolerance raise an alert |
| D10 | Do the feed mill and its transfers run in BC or NAVFarm? | BC (BBP-1). NAVFarm sends R2 and mirrors BC TO status; mill output is not sent |
| D11 | Separate pre-mature and mature asset accounts in BC? | One FA posting group per category for the whole life; pre-mature/mature becomes a reporting attribute |
| D12 | Direct sale of a breeding animal: FA sales invoice or via inventory? | Via FA → inventory (E29), then a normal sales invoice; one path for all exits |
| D13 | PO line type for imported livestock | G/L Account line on Livestock Purchase Clearing (§7.4) |
| D14 | Culled animal into inventory at carrying cost (BBP-2) or market value (BBP-1)? | Carrying cost after reversing fair value (BBP-2, the finance document) |
| D15 | Overhead credit account (G7) and amortisation credit account (G8) | Finance to set; update `gl_mapping_master` before sprint 2 |

---

## Appendix A — NAVFarm G/L mapping rules today

From `nf_devco.gl_mapping_master` on 16 Nov 2026 (active rows). The account numbers are the dev chart; production uses BC numbers. **BC must produce the same Dr/Cr for each native posting** (§1.4).

| Mapping type | Debit | Credit |
|---|---|---|
| PURCHASE | 170100 Feed / 170200 Veterinary / 170300 Medicine Inventory | 210100 Trade Payables |
| TRANSFER_SHIPMENT | 170900 Inventory in Transit | 1701xx–1703xx Inventory |
| TRANSFER_RECEIPT | 1701xx–1703xx Inventory | 170900 Inventory in Transit |
| VARIANCE_POSITIVE | 1701xx–1703xx Inventory | 730100 Inventory Adjustment Gain |
| VARIANCE_NEGATIVE | 830100 Inventory Adjustment Loss | 1701xx–1703xx Inventory |
| CONSUMPTION | 610100 Overhead Expense | 1701xx–1703xx Inventory |
| BATCH_CONSUMPTION / BATCH_INPUT | 160500 Work in Progress | 170100 Feed Inventory |
| BATCH_OUTPUT / OUTPUT | 171100 Finished Goods | 160500 WIP |
| BATCH_IMPAIRMENT | 830100 Inventory Adjustment Loss | 160500 WIP |
| MORTALITY | 610400 Mortality / Impairment Loss | 160500 WIP |
| OVERHEAD | 160500 WIP | 210100 Trade Payables |
| PRICE / USAGE / OUTPUT / OVERHEAD_VARIANCE | 6301xx–6304xx Variance | 160500 WIP |
| BIO_ACQUISITION | 152100 Bio Assets – Pre-mature | 210100 Trade Payables |
| BIO_CONSUMPTION_PREMATURE | 152100 Bio Assets – Pre-mature | 1701xx–1703xx Inventory |
| BIO_CONSUMPTION_MATURE | 610200 Bio-Asset Consumption Expense (Mature) | 1701xx–1703xx Inventory |
| BIO_OVERHEAD_PREMATURE | 152100 Bio Assets – Pre-mature | 210100 Trade Payables |
| BIO_OVERHEAD_MATURE | 610300 Bio-Asset Overhead Expense (Mature) | 210100 Trade Payables |
| BIO_AMORTIZATION | 520900 Amortization Expense – Bio Assets | 152200 Bio Assets – Mature |
| BIO_FAIR_VALUE | 152200 Bio Assets – Mature | 720900 Fair Value Gain / Loss – Herd |
| BIO_FAIR_VALUE_PREMATURE | 152100 Bio Assets – Pre-mature | 720900 Fair Value Gain / Loss – Herd |
| BIO_TRANSFORMATION | 152200 Bio Assets – Mature | 152100 Bio Assets – Pre-mature |
| BIO_LITTER_BIRTH | 170400 Weaners Inventory | 152100 Bio Assets – Pre-mature |
| BIO_GILT_ACQUISITION | 152100 Bio Assets – Pre-mature | 170400 Weaners Inventory |
| BIO_MORTALITY_MATURE | 610400 Mortality / Impairment Loss | 152200 Bio Assets – Mature |
| BIO_MORTALITY_PREMATURE | 610400 Mortality / Impairment Loss | 152100 Bio Assets – Pre-mature |
| BIO_FA_CONVERSION | 171100 Finished Goods | 152200 Bio Assets – Mature |
| BIO_OUTPUT / BIO_HARVEST | 171100 Finished Goods | 152200 Bio Assets – Mature |
| BIO_SALE_PROCEEDS | 120100 Trade Receivables | 152200 Bio Assets – Mature |
| BIO_DISPOSAL_SOLD | 152200 Bio Assets – Mature | 710500 Gain on Disposal of Animals |
| BIO_SEMEN_PRODUCTION | 171100 Finished Goods | 740100 Boar Cost Recovered (Semen Produced) |
| BIO_SEMEN_USE | 152100 Bio Assets – Pre-mature | 171100 Finished Goods |
| BIO_SEMEN_EXPENSE | 610200 Bio-Asset Consumption Expense (Mature) | 171100 Finished Goods |

Used in code but **not yet in the dev mapping table**: `MILL_OUTPUT`, `BIO_SLAUGHTER_DISPATCH`, `BIO_SLAUGHTER_DOA`, `BIO_SLAUGHTER_SALE`, `BIO_SLAUGHTER_COGS`, the lot-WIP fair-value type, `PURCHASE_PRICE_VARIANCE`. Finance must define them before those events are tested.

## Appendix B — Breeding-asset categories

From *Triple-C_Bio Asset Structure and Respective GL Entries.xlsx*. Each is a BC **FA Subclass + FA Posting Group**.

| Category | Method | Useful life | Residual | Start (amortisation / fair value) | BC FA Posting Group accounts |
|---|---|---|---|---|---|
| GGP-IMP-F, GP-IMP-F, P-IMP-F | Amortisation | 36 months | 150 kg × 2.05 = **307.50** | Week 33 | Acquisition Cost; Accum. Depreciation; Depreciation Expense |
| GGP-IMP-M, GP-IMP-M, P-IMP-M | Amortisation | 18 months | None | Week 26 | as above |
| GP-LOC-F, P-LOC-F (and GGP-LOC-F per BBP-2) | Fair value | 36 months | — | Week 33 | Acquisition Cost; Appreciation / Write-Down; FV Gain/Loss |
| GP-LOC-M, P-LOC-M (and GGP-LOC-M) | Fair value | 18 months | — | Week 26 | as above |
| PIGLETS / WEANERS / GROWERS / FINISHERS | Cost to week 17, fair value from week 18 | — | — | Week 17/18 | **Items**, not FAs — inventory posting groups, batch dimension |

Fair value per animal or batch = expected weight × approved price per kg; adjustment = fair value − carrying value (BBP-2 §5–6).
Mating line → local category: Z+Z → GGP Local, Z+L → GP Local, Z+Tempo → Parent Local.

## Appendix C — Glossary

| Term | Meaning |
|---|---|
| BBP | Business Blueprint document |
| CRP | Conference Room Pilot |
| GGP / GP / P | Great-grandparent / grandparent / parent breeding stock |
| IMP / LOC | Imported (cost + amortisation) / locally bred (fair value) |
| NBV | Net book value = acquisition + capitalised − accumulated amortisation (± fair value) |
| WIP | Work in progress — accumulated batch cost before output |
| GRN | Goods receipt note |
| TO | Transfer Order (feed transfer, or slaughter dispatch to Colcom) |
| DOA | Dead on arrival at the abattoir |
| EV | Expense voucher |
| POST Day | NAVFarm's daily posting of a batch's data entry (feed, medicine, mortality, overhead) |
| System journal | NAVFarm's balanced G/L journal created automatically for an event (`journal_header.source = 'SYSTEM'`) |
| Clearing account | A BC G/L account that is debited and credited in the same request and must net to zero |
