# NAVFarm ↔ Dynamics 365 Business Central — Integration Plan

16 Nov 2026. Written for three readers: the **project manager**, the **BC (AL)
developer**, and the **NAVFarm (NestJS) developer**.

## Sources this is built from

| Document | What it gives us |
|---|---|
| `OneDrive_1_04-09-2026/Solution Documents/NAVFarm_ Business Central Bio Asset (Current -Non Current )Accounts_Finance_Costing_BBP.docx` (**BBP-2**) | The finance integration: FA acquisition, capitalisation, amortisation, fair value, WIP, mortality, disposal, reconciliation — with the Dr/Cr for each |
| `OneDrive_1_04-09-2026/Solution Documents/Triple-C_NAVFarm BBP1_V0.1_Final.docx` (**BBP-1**) | The operational touchpoints: company setup, COA/item/dimension sync, PO→GRN, feed requisition→TO, expense voucher, transfer order→kill sheet→invoice, the 5 inventory journal types, retry/POSTED_PENDING_ERP |
| `rak docs/Final_Docs/3. GL COA Item mapping.xlsx`, `Transaction Ledger Structure.xlsx`, `Triple-C_Bio Asset _Structure and Respective GL Entries.xlsx` | Account mapping and ledger structure (read these with Finance when writing each interface spec) |
| `AGENTS.md` | Current state: fulfilment mode is `IN_HOUSE`, BC is **not connected**, no fake BC calls allowed |

There is **no BC developer guide in the repository yet**. Part 4 of this document is that guide.

> BBP-1 itself says: *"D365BC Event Integration list will be shared after CRP"* and
> *"D365BC development rights with dependency will be required by PTL"*. Both are
> still open. Part 2 below is a proposed event list derived from the two BBPs —
> it needs Finance sign-off before it becomes the contract.

---

## 1. The picture in one paragraph

**Business Central owns the money; NAVFarm owns the animals.** BC is the master
for the chart of accounts, items, posting groups, dimensions, vendors, customers,
fixed-asset classes and purchase orders. NAVFarm records what happens on the
farm (receipts, consumption, births, deaths, transfers, sales) and calculates
the biological-asset values (capitalisation, amortisation, fair value, piglet
cost). Every NAVFarm event with a financial effect is sent to BC, BC posts it,
and BC returns its ledger entry numbers so NAVFarm can reconcile.

```
           MASTERS (BC → NAVFarm)                 TRANSACTIONS (NAVFarm → BC)
  ┌──────────────────────────────┐        ┌─────────────────────────────────────┐
  │ COA, Dimensions, Items,      │        │ Requisitions, GRN, Consumption,     │
  │ Posting groups, Vendors,     │  ───▶  │ Adjustments, Overheads, EV, FA      │
  │ Customers, Main FAs,         │        │ acquisition/capitalisation/         │
  │ Released POs                 │        │ amortisation/fair value, piglet     │
  └──────────────────────────────┘        │ output, mortality, disposal, sales  │
                                          └──────────────┬──────────────────────┘
                                                         │ BC posts, returns
                                                         ▼ entry nos.
                                          ┌─────────────────────────────────────┐
                                          │ RECONCILIATION (BC → NAVFarm)       │
                                          │ Item / Value / FA / G/L entry nos.  │
                                          └─────────────────────────────────────┘
```

### Three corrections to the BBP wording — tell the team early

1. **BC ledger entries cannot be POSTed directly.** BBP-1 names endpoints such as
   `POST /itemLedgerEntries`, `POST /fixedAssetLedgerEntries`, `POST /faDisposal`,
   `POST /purchaseRequisitionLines`. None of these exist in BC. Ledger entries are
   read-only and are created only by **posting a journal or a document**. So every
   NAVFarm → BC transaction becomes: *insert into a journal/staging record → call a
   `post` action → BC returns the entry numbers*. That is what Part 4 builds.
2. **Most of this needs custom AL APIs, not the standard v2.0 API.** The standard
   API covers companies, accounts, dimensions, items (basic), vendors, customers,
   purchase orders and general journals. It does **not** expose item journal
   posting with lots, FA G/L journals, posting-group detail, the "Sync to NAVFarm"
   flag, or an Animal Register. Those are a PTL extension.
3. **Webhooks need a public HTTPS NAVFarm URL.** BC webhooks only tell you *that*
   a record changed; NAVFarm then has to call back to read it, the subscription
   expires every few days and must be renewed, and NAVFarm must answer BC's
   validation handshake. Start with **scheduled polling on
   `lastModifiedDateTime`** (BBP-1 already asks for nightly COA and hourly PO sync)
   and add webhooks for items only once the server is publicly reachable.

---

## 2. What connects — the interface catalogue

Codes are used in the rest of this document and should be used in tickets.
**Dir**: `IN` = BC → NAVFarm, `OUT` = NAVFarm → BC.

### 2a. Foundation and masters (build first — every transaction depends on them)

| Code | Interface | Dir | Trigger | BC side | BBP ref |
|---|---|---|---|---|---|
| **M0** | Connection & company | IN | Company setup | Standard `GET /companies` | BBP-1 Company Master |
| **M1** | Chart of accounts | IN | Nightly 01:00 UTC + "Sync COA" button | Standard `GET /accounts` (filter not blocked, direct posting) | BBP-1 §1.6 |
| **M2** | Dimensions & values (Cost Centre = Farm Code, LOB, Batch, Stage) | IN (+ OUT for new batch values) | Setup / farm create / batch create | Standard `GET /dimensions`, `/dimensionValues`; **custom** API to create Batch values | BBP-1 Dimensions |
| **M3** | Items + posting groups (+ "Sync to NAVFarm" flag, withdrawal days, lot tracking) | IN | Poll (later webhook) | **Custom** API page on Item + table extension | BBP-1 §1.5 |
| **M4** | Posting setup (inventory/consumption G/L per posting group & location) | IN | With M3 | **Custom** API on Inventory Posting Setup / General Posting Setup | BBP-1 §1.5 |
| **M5** | Vendors | IN | Poll | Standard `GET /vendors` | BBP-1 masters list |
| **M6** | Customers (Colcom etc.) | IN | Poll | Standard `GET /customers` | Needed by T16 |
| **M7** | Main (parent) fixed assets & FA classes | IN | Poll | **Custom** API on Fixed Asset | BBP-2 §1 |

### 2b. Procurement loop

| Code | Interface | Dir | NAVFarm trigger | BC result | BBP ref |
|---|---|---|---|---|---|
| **T1** | Purchase requisition (ITEM / FA / SERVICE) | OUT | Requisition **Release** (today sets `integration_status = BC_PENDING`) | Requisition worksheet line or PO; PO No. returned (replaces today's manual link-po) | BBP-1 Requisition, BBP-2 §2 |
| **T2** | Released purchase orders → Expected Receipts | IN | Hourly poll | — | BBP-1 GRN step 1 |
| **T3** | GRN — feed / medicine / items | OUT | GRN **POST** | Purchase receipt posted against the PO, with lots; Item Ledger Entry No. returned | BBP-1 GRN 9-step |
| **T4** | GRN — imported livestock | OUT | GRN **POST** | Child FA created under Main FA + BC Animal Register record; receipt posted; FA No. returned | BBP-2 §2 |
| **T5** | Feed requisition → feed-mill Transfer Order (+ shipment status back) | OUT + IN | Feed requisition approved | Transfer Order No.; shipment/receipt status polled back | BBP-1 Feed forecast 8-step |

### 2c. Daily operations and cost

| Code | Interface | Dir | NAVFarm trigger | BC posting (from BBP) |
|---|---|---|---|---|
| **T6** | Consumption (feed, medicine) | OUT | Daily data **POST Day** | Item journal negative: Dr WIP / Consumption, Cr Inventory — dims Farm, Batch |
| **T7** | Inventory adjustments (positive, negative, physical count) | OUT | Adjustment / stock count posted | Item journal / phys. inventory journal |
| **T8** | Overheads & resource absorption (labour, power, water) | OUT | POST Day | General journal: Dr WIP, Cr Absorption |
| **T9** | Expense voucher | OUT | Finance approval | New gen. journal batch `EV-YYYY-NN`, post, return G/L Entry Nos (BBP-1 7-step) |

### 2d. Biological assets (BBP-2 — the reason this integration exists)

| Code | Interface | Dir | NAVFarm trigger | BC posting |
|---|---|---|---|---|
| **T10** | Capitalisation of imported breeders (until wk 33 F / wk 26 M) | OUT | Period cost run, per animal | FA G/L journal **Acquisition Cost**: Dr Imported Bio Asset, Cr Feed/Med/Resource |
| **T11** | Amortisation run (imported only) | OUT | Amortisation request page | FA G/L journal **Depreciation**: Dr Amortisation Exp, Cr Acc. Amortisation |
| **T12** | Piglet output (cost per piglet) | OUT | Farrowing POST | Item journal positive: Dr Piglet Inventory, Cr Bio-Asset WIP |
| **T13** | Gilt selection → Local breeding asset | OUT | Gilt selection posted | Child FA created (GGP/GP/Parent Local), Dr Local Bio Asset, Cr Piglet Inventory |
| **T14** | Fair value run — local breeders (per FA) and weaners/growers (per batch) | OUT | Fair value request page | FA G/L journal **Appreciation** / gen. journal: gain or loss |
| **T15** | Mortality / impairment write-off | OUT | Mortality posted (incl. DOA) | FA write-down/disposal or item negative: Dr Mortality Loss |
| **T16** | Cull: FA → Inventory conversion | OUT + IN | FA conversion approved (`fa_conversion` already has `bc_fa_ledger_entry_no`, `bc_item_ledger_entry_no`) | Reverse amortisation / fair value, dispose FA, item receipt at cost; BC confirms (BBP-2 §8, 10 steps) |

### 2e. Sales and close

| Code | Interface | Dir | NAVFarm trigger | BC result |
|---|---|---|---|---|
| **T17** | Transfer Order to slaughter → in-transit | OUT | TO confirmed | Transfer shipment to IN-TRANSIT per line |
| **T18** | Kill sheet → sales invoice | OUT | Kill sheet entered | Sales invoice to customer, revenue to supplying farm cost centre |
| **R1** | Reconciliation pull (R18 report) | IN | Monthly / on demand | Item, Value, FA and G/L entries filtered by NAVFarm document no. |

That is **8 master interfaces + 18 transactions + 1 reconciliation**. BBP-1
mentions "14 event types"; some of the above will merge once Finance confirms
the list.

### What NAVFarm already has (so the NAVFarm side is mostly "send what we already calculate")

- Ledgers exist: `inventory_ledger_line`, `bio_asset_ledger`, `resource_ledger`,
  `journal_line`, plus G/L posting groups and G/L mapping modules.
- `fa_conversion` already has `bc_fa_ledger_entry_no` and `bc_item_ledger_entry_no` columns.
- Requisition release already sets `integration_status = BC_PENDING`; PO number is linked by hand today.
- NAVFarm currently **creates its own items, G/L accounts and suppliers**. BBP-1 says
  items and COA must come **from BC only**. That conflict is decision **D1** below.

---

## 3. Build order

Build in **vertical slices**: one interface at a time, working end-to-end
(NAVFarm → BC sandbox → entry numbers back → reconciled), before starting the
next. Do not build all BC APIs first and all NAVFarm code later.

| Wave | Interfaces | Why this order | Size |
|---|---|---|---|
| **0. Plumbing** | Auth, connector, sync queue, audit log, M0 | Nothing works without it | M |
| **1. Masters** | M1 COA → M2 Dimensions → M3/M4 Items + posting setup → M5 Vendors → M6 Customers → M7 Main FAs | Every transaction needs valid accounts, dims and item codes | M |
| **2. Procurement** | T2 POs in → T3 GRN items → T1 requisition out → T5 feed TO | First real money flow; easy to verify (PO → receipt) | L |
| **3. Daily cost** | T6 consumption → T7 adjustments → T8 overheads → T9 EV | High volume; proves batching, dimensions, retry | L |
| **4. Bio assets** | T4 livestock GRN → T10 capitalisation → T11 amortisation → T12 piglet output → T13 gilt → T14 fair value → T15 mortality → T16 cull | Depends on FA setup + waves 2–3 | XL |
| **5. Sales & close** | T17 TO → T18 invoice → R1 reconciliation, period close checks | Needs everything upstream | M |

**Definition of done for every interface** (this matches the project rule
*"verify by driving the app and reading MySQL"*):

1. Spec signed by Finance (template in §4.9).
2. BC API built and deployed to the **sandbox**.
3. NAVFarm side built.
4. One real document posted from the NAVFarm UI → BC entries checked in BC →
   BC entry numbers checked **in MySQL** on the NAVFarm row.
5. Sending the same document twice creates **no** second posting.
6. BC down / BC rejects → NAVFarm row shows `FAILED` with the BC error, retries,
   alert fires; NAVFarm operations continue.
7. Finance reviewer ticks the G/L result.

---

## 4. BC developer guide — building the APIs from scratch

### 4.1 Prerequisites (ask for these in week 1)

- A **BC SaaS sandbox** environment that is a copy of production setup (COA,
  posting groups, dimensions, FA classes, number series).
- **Development rights** in that sandbox (BBP-1 calls this out as a PTL dependency).
- An **object ID range** for the PTL extension from the BC partner/licence.
- VS Code + **AL Language** extension; `AL: Download Symbols` working against the sandbox.
- Git repository for the AL extension (keep it separate from this Nx monorepo, or as `apps/bc-extension` if the team prefers one repo).

### 4.2 Authentication (service-to-service)

1. In **Microsoft Entra ID**, register an app `NAVFarm-Integration`; add API permission
   *Dynamics 365 Business Central → Application → `API.ReadWrite.All`*; grant admin consent;
   create a client secret (or certificate).
2. In BC, open **Microsoft Entra Applications**, add the Client ID, state = Enabled,
   assign a dedicated permission set `NVF-INTEGRATION` (built in the extension —
   only the tables/pages the APIs need; never SUPER).
3. NAVFarm gets a token with OAuth2 **client credentials**:
   `POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`,
   `scope=https://api.businesscentral.dynamics.com/.default`.
4. Base URLs:
   - Standard: `https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/v2.0/companies({companyId})/...`
   - Custom: `https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/ptl/navfarm/v1.0/companies({companyId})/...`

Tenant ID, environment, company ID, client ID and secret live in NAVFarm company
setup (BBP-1 already lists Tenant ID / Base URL / Company ID); the secret is
encrypted with the existing `EncryptionService`.

### 4.3 Extension skeleton

```
navfarm-bc/
  app.json                      // id range, publisher "PTL", name "NAVFarm Integration"
  src/
    Setup/        NVFSetup.Table.al, NVFSetup.Page.al
    Extensions/   NVFItem.TableExt.al          // "NVF Sync to NAVFarm", "NVF Withdrawal Days"
                  NVFFixedAsset.TableExt.al    // "NVF Animal ID", "NVF Parent FA No.", "NVF Category"
    AnimalRegister/ NVFAnimalRegister.Table.al  // BBP-2 asks for an Animal Register in BC
    Staging/      NVFPostingRequest.Table.al   // header: one NAVFarm document
                  NVFPostingRequestLine.Table.al
    Codeunits/    NVFPostingMgt.Codeunit.al     // validate + post, one procedure per event type
    API/          NVFFarmItemAPI.Page.al, NVFPostingSetupAPI.Page.al,
                  NVFFixedAssetAPI.Page.al, NVFPostingRequestAPI.Page.al,
                  NVFPostingRequestLineAPI.Page.al, NVFLedgerEntryAPI.Page.al
    Permissions/  NVFIntegration.PermissionSet.al
```

Conventions: prefix every object and field with `NVF`; API publisher `ptl`,
group `navfarm`, version `v1.0`; never change a published v1.0 contract — add `v2.0`.

### 4.4 Your first API — read-only masters (M3 items)

Start here: it is read-only, low risk, and proves auth, publishing and the URL.

```al
tableextension 50100 "NVF Item" extends Item
{
    fields
    {
        field(50100; "NVF Sync to NAVFarm"; Boolean) { Caption = 'Sync to NAVFarm Farm Item'; }
        field(50101; "NVF Withdrawal Days"; Integer) { Caption = 'Withdrawal Days'; MinValue = 0; }
    }
}

page 50100 "NVF Farm Item API"
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
                field(baseUnitOfMeasure; Rec."Base Unit of Measure") { }
                field(itemTrackingCode; Rec."Item Tracking Code") { }
                field(lotNos; Rec."Lot Nos.") { }
                field(inventoryPostingGroup; Rec."Inventory Posting Group") { }
                field(genProdPostingGroup; Rec."Gen. Prod. Posting Group") { }
                field(withdrawalDays; Rec."NVF Withdrawal Days") { }
                field(blocked; Rec.Blocked) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
```

Test: `GET .../api/ptl/navfarm/v1.0/companies({id})/farmItems?$filter=lastModifiedDateTime gt 2026-11-01T00:00:00Z`.

Note: the Inventory G/L and Consumption G/L that BBP-1 wants with the item are
**not on the Item** — they come from *Inventory Posting Setup* (posting group ×
location) and *General Posting Setup*. That is why M4 is a separate API.

Repeat the same pattern for M4 (posting setup) and M7 (fixed assets). M1, M2,
M5, M6 use the standard v2.0 API — no AL needed.

### 4.5 The posting pattern — one design reused for every OUT transaction

Do **not** write fourteen unrelated APIs. Build **one staging API** and one
posting codeunit with a branch per event type.

1. NAVFarm `POST .../postingRequests` with a **deep insert** (header + lines):
   - header: `eventType` (e.g. `CONSUMPTION`, `FA_CAPITALISATION`), `navfarmDocumentNo`,
     `navfarmEventId` (**idempotency key, unique**), `postingDate`, `farmCode`.
   - lines: account/item/FA no., quantity, amount, lot no., dimension codes
     (`costCentre`, `batch`, `stage`, `lob`), `navfarmLineId`.
2. NAVFarm calls the bound action `POST .../postingRequests({id})/Microsoft.NAV.post`.
3. The codeunit validates, builds the right journal (item / general / FA G/L),
   applies the dimension set, posts, and writes the resulting entry numbers and
   status back onto the staging record.
4. NAVFarm `GET .../postingRequests({id})?$expand=postingRequestLines` and stores
   `itemLedgerEntryNo`, `valueEntryNo`, `faLedgerEntryNo`, `glEntryNo`, `bcDocumentNo`.

Why this pattern:
- **Idempotency**: the unique `navfarmEventId` means a retry after a timeout can never post twice (BBP control point *"duplicate posting is prohibited"*).
- **Audit**: the staging table is BC's own log of everything NAVFarm sent, including failures.
- **Same code path** for every event type: auth, retry, error handling are written once.

Bound action skeleton:

```al
page 50110 "NVF Posting Request API"
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

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { Editable = false; }
                field(eventType; Rec."Event Type") { }
                field(navfarmEventId; Rec."NAVFarm Event Id") { }
                field(navfarmDocumentNo; Rec."NAVFarm Document No.") { }
                field(postingDate; Rec."Posting Date") { }
                field(farmCode; Rec."Farm Code") { }
                field(status; Rec.Status) { Editable = false; }
                field(errorText; Rec."Error Text") { Editable = false; }
                field(bcDocumentNo; Rec."BC Document No.") { Editable = false; }
                part(postingRequestLines; "NVF Posting Req. Line API")
                {
                    EntityName = 'postingRequestLine';
                    EntitySetName = 'postingRequestLines';
                    SubPageLink = "Request Id" = field(SystemId);
                }
            }
        }
    }

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

Inside `NVF Posting Mgt.`:
- `CONSUMPTION`, `ADJUSTMENT`, `PIGLET_OUTPUT` → Item Journal lines, posted via `Codeunit "Item Jnl.-Post Line"` (lot via reservation entries / item tracking).
- `OVERHEAD`, `EXPENSE_VOUCHER`, batch fair value → General Journal (new batch per EV as BBP-1 asks), posted via `Codeunit "Gen. Jnl.-Post Batch"`.
- `FA_ACQUISITION`, `FA_CAPITALISATION`, `FA_AMORTISATION`, `FA_FAIR_VALUE`, `FA_WRITE_OFF`, `FA_DISPOSAL` → FA G/L Journal with FA Posting Type = Acquisition Cost / Depreciation / Appreciation / Write-Down / Disposal.
- GRN (T3/T4) → set *Qty. to Receive* on the existing PO lines and post the purchase receipt (`Codeunit "Purch.-Post"` with Receive only) — the invoice stays with Finance, as BBP-2 says.
- Wrap each post in error handling: on failure set `Status = Failed`, `Error Text = GetLastErrorText()`, never leave half-posted journals.

### 4.6 Dimensions

- Agree with Finance which dimension is **Global Dimension 1** (recommend Cost Centre = Farm Code) — global dims are faster and simpler to set (`"Shortcut Dimension 1 Code"`).
- Batch / Stage / LOB go through a dimension set: build temp `Dimension Set Entry` records and call `DimensionManagement.GetDimensionSetID`.
- If a Farm Code or Batch value does not exist in BC → **fail the request** with a clear error (BBP-1: *"Farm Code not found → GL call fails, CRITICAL alert"*). Do not auto-create cost centres; batch values may be auto-created only if Finance agrees (decision D4).

### 4.7 BC-side rules to enforce (from BBP-2 control points)

- Reject a second request with the same `navfarmEventId` (return the original result instead).
- FA capitalisation after the amortisation start week → reject.
- Amortisation for the same FA and period twice → reject; NBV below residual value → reject.
- Fair value for the same FA and valuation date twice → reject.
- Write-off amount > carrying value → reject.
- Posting date outside an open period → reject with a clear message.

### 4.8 Performance and limits

BC SaaS throttles API calls. So: send **one request per document** (one POST Day
per farm, one EV, one amortisation run), not one per line; use `$batch` for
master reads; page with `$top/$skip` or `@odata.nextLink`; poll masters on
`lastModifiedDateTime`, not full reloads.

### 4.9 Interface spec template (one page per interface — fill before coding)

```
Code / Name:            T6 Consumption
Direction / Trigger:    NAVFarm → BC, on POST Day
Frequency / Volume:     daily, per farm, ~N lines
NAVFarm source:         inventory_ledger_line where entry_type = CONSUMPTION
BC object:              NVF Posting Request (eventType = CONSUMPTION) → Item Journal
Payload fields:         (table: NAVFarm field | BC field | type | mandatory)
Accounting (Dr/Cr):     from BBP / GL COA Item mapping.xlsx
Dimensions:             Cost Centre = farm code, Batch, Stage, LOB
Idempotency key:        navfarmEventId = <ledger header id>
Response stored:        item ledger entry no, value entry no, G/L entry no
Errors & handling:      list each BC error and the NAVFarm alert
Test case:              document, expected BC entries, expected MySQL values
Signed off by:          Finance ______  PTL ______  date ______
```

---

## 5. NAVFarm side — what the NestJS developer builds

New module `apps/api/src/modules/integration/bc/`:

| Piece | Purpose |
|---|---|
| `bc-auth.service` | Client-credentials token, cached until expiry |
| `bc-client.service` | Typed HTTP client: base URL from company setup, retries on 429/5xx with back-off, logs every call |
| `bc_sync_queue` table | Outbox: `id, company_id, event_type, source_table, source_id, navfarm_event_id (unique), payload JSON, status, attempts, next_attempt_at, last_error, bc_request_id, bc_refs JSON, created_at, posted_at` |
| `bc_api_log` table | Every request/response (BBP-1: *"Audit log of all API calls"*) |
| Queue worker | Picks `PENDING`/`FAILED` rows; **3 retries at 15-min intervals** (BBP-1); then `FAILED` + alert |
| Master sync jobs | Nightly COA, hourly POs, periodic items/vendors/customers/FAs |
| Event producers | In each existing service, at the moment a document is **posted**, write a queue row **in the same DB transaction** — never call BC inside the posting transaction |
| Status on source docs | `integration_status`: `NOT_APPLICABLE / BC_PENDING / POSTED_PENDING_ERP / BC_POSTED / BC_FAILED` (the requisition already uses `BC_PENDING`) |
| Fulfilment mode switch | Company setting `IN_HOUSE` (today) vs `BC_INTEGRATED`; with `IN_HOUSE` nothing is queued — the app keeps working exactly as now |
| Screens | Integration monitor (queue, errors, retry button), Sync COA / Sync Items buttons, R18 reconciliation report |

Rule from AGENTS.md that still applies: **no fake BC calls or success states.**
A row is `BC_POSTED` only when BC has returned real entry numbers.

---

## 6. For the project manager — how to start

### Week 1: unblock (no code yet)

1. **Kick-off with Finance + BC partner + PTL devs.** Walk through §1 and §2 of this document.
2. **Get access** — the critical path: BC sandbox, dev rights, object ID range,
   Entra app registration with admin consent. Raise these on day 1; they usually
   take the longest.
3. **Decide master-data ownership** (D1) — the single biggest design choice.
4. **Freeze the event list.** BBP-1 said it would be shared after CRP; use §2 as
   the draft and get Finance to confirm, merge or cut.
5. **Name owners**: one BC AL developer, one NAVFarm developer, one Finance
   reviewer who signs every spec and every test result.

### Week 2: first slice end-to-end

Wave 0 + M0 + M1: NAVFarm connects to the sandbox and pulls the chart of accounts.
It is small, but it proves auth, URLs, the extension deploy, the queue and logging.
**Do not move on until this demo works.**

### Then: one wave at a time

Run each wave in §3 as a mini-sprint:
**spec (Finance signs) → BC API → NAVFarm side → posted test → Finance sign-off.**
Track every interface on a board with these columns:
`Spec draft → Spec signed → BC built → NAVFarm built → E2E verified → Finance signed`.

### What to watch

| Risk | Mitigation |
|---|---|
| BC access arrives late | Ask on day 1; meanwhile NAVFarm builds the queue against a mock BC (clearly marked, never shipped) |
| Item / account codes differ between NAVFarm and BC | Do the D1 mapping exercise in week 1; a code-mapping table if codes cannot be aligned |
| Opening balances / cut-over (animals already on farm have no BC FA yet) | Plan a one-time migration interface (create child FAs for existing breeders, opening WIP per batch) — decision D6 |
| "It posted" without proof | Definition of done in §3: BC entries + MySQL entry numbers + Finance tick |
| Volume / throttling | One request per document, not per line (§4.8) |

---

## 7. Decisions needed from the client / Finance

| # | Decision | Recommendation |
|---|---|---|
| D1 | Who owns items, G/L accounts, suppliers, customers? NAVFarm creates them today; BBP-1 says BC only. | BC owns them. NAVFarm masters become read-only copies synced from BC; existing NAVFarm codes mapped to BC codes once. |
| D2 | Final event list ("14 event types after CRP") | Confirm §2 |
| D3 | Does NAVFarm create the PO, or only a requisition that BC turns into a PO? | Requisition worksheet in BC; BC procurement releases the PO (keeps approval in BC) |
| D4 | Batch dimension values: auto-created by NAVFarm, or by Finance? | Auto-create on batch creation via custom API |
| D5 | Which dimension is Global Dimension 1? | Cost Centre = Farm Code |
| D6 | Go-live cut-over: opening FAs, WIP and inventory | One-off migration interface, reconciled to BC trial balance before go-live |
| D7 | Does BC also keep an Animal Register table (BBP-2), or only FA cards with the Animal ID? | FA card + `NVF Animal ID` is enough unless Finance needs animal reports inside BC |
| D8 | Posting granularity for daily consumption — per line, per batch, or per farm per day? | One journal per farm per day, lines per batch/item |
