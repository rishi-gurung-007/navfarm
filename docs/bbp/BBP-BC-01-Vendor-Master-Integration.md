<!-- cover: {"kicker":"NAVFarm  ↔  Microsoft Dynamics 365 Business Central","title":"BBP-BC-01 Vendor Master Integration","subtitle":"Business Central Vendors → NAVFarm Suppliers: blueprint, field mapping, sync rules, controls and UAT script","header":"BBP-BC-01 — Vendor Master Integration","meta":[["Document","BBP-BC-01 Vendor Master Integration"],["Version","1.3 — 18 November 2026"],["Status","Built and verified against BC SandboxUAT (read, create, update, link/unlink); open points in §12"],["Scope","Vendor master: list, create, update and link BC vendors from NAVFarm; sync BC → NAVFarm"],["Client","Triple C (Colcom Group) — BC company \"Triple C Pigs\""],["Based on","MOM 18 Aug 2026 (Triple C Office); BBP-1 §1 masters; BC VendorCardApi web service; NAVFarm supplier_master"]]} -->

# BBP-BC-01 — Vendor Master Integration

**Version 1.2 — 18 Nov 2026** (1.1 added list / create / update / link from NAVFarm, §5a; 1.2 lists **every** BC vendor, §5b; 1.3 shows only BC Vendor Card fields and calls them Vendors, §7). Part of the NAVFarm ↔ Business Central integration. Technical background: `docs/BC-DEVELOPER-GUIDE.md`.

## Why this integration exists

The client's documents put vendors in Business Central:

- **MOM 18 Aug 2026 (Triple C Office)**, procurement flow Req → Order → Vendor → GRV → PI: *"Requisition (Req) will be raised and maintained in NavFarm. Order, Vendor selection, GRV and PI will be processed in D365BC."*
- **BBP-1 §1** lists Vendor among the masters, without detailing it.

So BC is the master for vendors, and NAVFarm keeps a read-only copy as **Suppliers**. NAVFarm uses suppliers on goods receipts, requisitions and animal purchases (health certificate and breeding-farm checks). Without the copy, a GRN in NAVFarm could name a supplier that BC does not know.

## 1. BBP — Vendor Master Integration

| S.NO. 1 | Vendor Master: Business Central → NAVFarm Supplier |
|---|---|
| **Subject** | Vendor master synchronisation from Microsoft Dynamics 365 Business Central to NAVFarm. Masters: BC **Vendor** (Vendor Card) → NAVFarm **Supplier** (`supplier_master`). |
| **NAVFarm Solution** | **Business Central is the vendor master**; the vendor record always lives in BC. On the BC Vendor Card a custom Boolean **"NavFarm Sync"** decides whether the vendor is used on the farm, and every vendor with it ticked appears in NAVFarm Suppliers (Vendor No. = Supplier Code; name, address, contact, tax, payment terms, currency and posting groups copied). From NAVFarm's **Suppliers** screen a user can also **list** every BC vendor live, **create** a vendor (saved in BC first; BC assigns the Vendor No.), **update** it (only the changed fields are sent to BC), and **link / unlink** it (tick / untick NavFarm Sync). NAVFarm never deletes a BC vendor. NAVFarm adds only farm-side information BC does not hold: vendor type (animal / feed / medicine / semen supplier…), health certificate, breeding-farm registration, NOB/LOB. |
| **Process Flow** | Finance creates or edits the vendor in BC → ticks **NavFarm Sync** → NAVFarm sync runs (hourly, or **Sync now**) → NAVFarm reads vendors with NavFarm Sync = Yes → each vendor is matched by Vendor No. → **new** = Supplier created (approved, active) / **changed** = BC fields updated / **same** = left alone / **unticked or removed** = Supplier deactivated → run logged → result written back on the BC vendor (sync error flag and message, sync status). |
| **Integration with ERP or Any Third-Party App** | **Business Central → NAVFarm** through the ODataV4 web service **VendorCardApi** (page Vendor Card) published by the BC developer, read with OAuth 2.0 client credentials (Entra ID app). Filter `NavFarm_Sync eq true`, only the fields in §4 (`$select`), paged, with an ETag per vendor. **NAVFarm → Business Central**: `POST VendorCardApi` (create), `PATCH VendorCardApi('{No}')` with `If-Match` ETag (update, link/unlink via NavFarm_Sync), and — when enabled — the sync result (**Navfarm_Sync_Error**, **Navfarm_Error_Message**, **Sync_Status**). |
| **Alert & Notification** | 🔴 Sync run FAILED (BC unreachable, credentials rejected, company not found) → Integration monitor and logs, with BC's correlation id. 🟠 Vendor not synced (e.g. no name in BC) → error flag and message on the BC Vendor Card (write-back) and on the NAVFarm supplier. 🟠 Run refused because it would deactivate more than 50% of BC suppliers → nothing changed; investigate the BC service. ℹ Each run's counts (fetched / created / updated / unchanged / deactivated / failed) in the sync history. |
| **Control Points on NAVFarm App Level** | • Vendor No. is the key: unique per company, never changed. • Every create/update of a BC field goes to BC **first**; NAVFarm stores what BC returns, so BC's validation (payment terms, currency, posting groups, country codes) always applies and NAVFarm can never hold a value BC refused. • Updates are ETag-guarded: a vendor changed in BC meanwhile is not overwritten (user is asked to reload). • Delete in NAVFarm = untick NavFarm Sync in BC + deactivate here; the BC vendor is never deleted. • When the BC connection is off, BC fields are read-only in NAVFarm and new suppliers are refused (BC master). • A vendor that stops syncing is **deactivated, never deleted**: GRNs and requisitions keep their supplier. • BC **Blocked = All** or **Privacy Blocked** → supplier inactive; **Blocked = Payment** → supplier stays usable (goods may still be received; payment is BC's concern). • One run at a time per tenant; a run is all-or-nothing inside one database transaction. • A run that would deactivate most BC suppliers is refused (guard against a bad read). • Every run is logged (`integration_sync_log`) and audited. |

## 2. Process flow

```
 BUSINESS CENTRAL                                         NAVFARM
 ─────────────────                                        ───────
 Finance creates / edits Vendor
 ticks "NavFarm Sync" = Yes
            │
            │   hourly schedule  or  Suppliers → "Sync now" (POST /integration/business-central/vendors/sync)
            ▼
 VendorCardApi  ── GET ?$filter=NavFarm_Sync eq true&$select=… ──►  1. Read all flagged vendors (paged)
                                                                    2. Map fields (§4), validate (name present…)
                                                                    3. Match by Vendor No. → plan:
                                                                       CREATE / UPDATE / UNCHANGED / DEACTIVATE / FAILED
                                                                    4. Safety check (no mass deactivation)
                                                                    5. Apply plan in ONE transaction
                                                                    6. Log run (integration_sync_log) + audit
 VendorCardApi('VEN0001') ◄── PATCH If-Match ETag ────────────────  7. Write back result (when enabled):
   Navfarm_Sync_Error / Navfarm_Error_Message / Sync_Status            error flag, message, status
```

### Step table

| Step | Actor / system | Action | Result |
|---|---|---|---|
| 1 | Finance (BC) | Create or edit the vendor on the Vendor Card; tick **NavFarm Sync** | Vendor is in scope for NAVFarm |
| 2 | NAVFarm scheduler / user | Hourly run, or **Sync now** (needs Supplier *edit* permission) | Sync starts; a second run at the same time is refused |
| 3 | NAVFarm | `GET VendorCardApi` with `NavFarm_Sync eq true`, §4 fields only | Flagged vendors with their ETags |
| 4 | NAVFarm | Map each vendor (§4) and validate | Vendors without a name → FAILED with reason |
| 5 | NAVFarm | Match by `bc_vendor_no`, else by supplier code = Vendor No. | CREATE, UPDATE (only changed fields), UNCHANGED, DEACTIVATE |
| 6 | NAVFarm | Safety check | Run refused if it would deactivate > 50% of BC suppliers |
| 7 | NAVFarm | Apply all changes in one transaction | Suppliers created/updated/deactivated together, or not at all |
| 8 | NAVFarm | Log the run and audit it | `integration_sync_log` row with counts and failures |
| 9 | NAVFarm → BC | Write back per vendor (only where BC's values differ) | BC user sees whether the vendor reached NAVFarm, and why not |

## 3. What happens in each case

| Case in BC | NAVFarm result |
|---|---|
| New vendor, NavFarm Sync ticked | Supplier **created**: code = Vendor No., approved, active (unless blocked), vendor type GENERAL until the farm sets it |
| Vendor edited (name, address, terms, currency…) | Supplier **updated**: only the BC fields that changed; NAVFarm's own fields untouched |
| Vendor edited in a field NAVFarm does not read (e.g. balance) | **Unchanged**: only the stored ETag moves |
| **Blocked = All** or **Privacy Blocked** | Supplier **inactive** (status INACTIVE); BC Blocked shown on the supplier |
| **Blocked = Payment** | Supplier stays **active**; "Blocked in BC: Payment" shown |
| NavFarm Sync **unticked**, or vendor deleted in BC | Supplier **deactivated** with the reason; never deleted |
| NavFarm Sync ticked again | Supplier **reactivated** (and restored if it had been soft-deleted) |
| Vendor has **no name** | **Not synced**; reason "Name is empty in Business Central." on the BC vendor (write-back) and in the run log |
| A NAVFarm supplier already uses the Vendor No. as its code | The two are **linked**; the supplier becomes BC-sourced and BC's values win |

## 4. Field mapping — BC Vendor Card → NAVFarm Supplier

Source: ODataV4 service `VendorCardApi`, company *Triple C Pigs*, environment *SandboxUAT*. Examples are real values from that service on 17 Nov 2026.

| # | BC field (VendorCardApi) | BC type | NAVFarm field (`supplier_master`) | Rule | Example |
|---|---|---|---|---|---|
| 1 | `No` | Code 20 (key) | `supplier_code` and `bc_vendor_no` | Key. Never changes. | `VEN0001` |
| 2 | `Name` | Text 100 | `supplier_name` | Trimmed; **mandatory** (vendor not synced without it) | `IRVINE 'S AFRICA` |
| 3 | `Name_2` | Text 50 | `bc_name_2` | Shown as "Name 2 (legacy code)"; on Triple C it holds the old account code and currency | `IRV001 RAND` |
| 4 | `Address` + `Address_2` | Text 100 + 50 | `address_line1` | Joined with ", " | `72 Lytton Road, Workington` |
| 5 | `City` | Text 30 | `city` | | `HRE` |
| 6 | `County` | Text 30 | `state` | | `ZW` |
| 7 | `Post_Code` | Code 20 | `pincode` | | |
| 8 | `Country_Region_Code` | Code 10 | `country` | | `ZW` |
| 9 | `Phone_No` (else `MobilePhoneNo`) | Text 30 | `phone` | Mobile used when Phone No. is blank | |
| 10 | `E_Mail` | Text 80 | `email` | | |
| 11 | `VAT_Registration_No` | Text 20 | `tax_number` | | |
| 12 | `Registration_Number` | Text 50 | `registration_number` | Company registration no. | |
| 13 | `Payment_Terms_Code` | Code 10 | `payment_terms` | | `14 DAYS`, `30 DAYS`, `COD` |
| 14 | `Currency_Code` | Code 10 | `currency_code` | Blank in BC = local currency → NULL | `ZAR`, `ZWG`, `ZWS` |
| 15 | `Gen_Bus_Posting_Group` | Code 20 | `gen_bus_posting_group` | For posting (GRN, invoices) later | `LOCAL`, `FOREIGN`, `INTERCOMPANY` |
| 16 | `Vendor_Posting_Group` | Code 20 | `vendor_posting_group` | For posting later | `TRADE USD`, `TRADE ZWG`, `PAYROLUSD` |
| 17 | `Blocked` | Option | `bc_blocked`, `is_active`, `status` | `' '` → not blocked; `Payment` → active; `All` → inactive | `All` (VEN0078) |
| 18 | `Privacy_Blocked` | Boolean | `is_active`, `status` | Yes → inactive | (VEN0448) |
| 19 | `Last_Date_Modified` | Date | `bc_last_modified_date` | Information | `2026-11-03` |
| 19a | `Control16` (label **Contact**; list API `contactName`) | Text 100 | `contact_name` | Read from BC (0258); not written | `Mangezi` |
| 19b | `Purchaser_Code` | Code 20 | `purchaser_code` | Read and written (0258) | `M00777` |
| 20 | `@odata.etag` | — | `bc_etag` | Change detection; `If-Match` on write-back | |
| 21 | `NavFarm_Sync` | Boolean | — | **Filter**: only `true` is synced | |
| 22 | `Sync_Status` | Option | — | **Written back** (value per §12 Q1) | |
| 23 | `Navfarm_Sync_Error` | Boolean | — | **Written back**: true when NAVFarm could not take the vendor | |
| 24 | `Navfarm_Error_Message` | Text 250 | `bc_sync_error` | **Written back**: the reason | `Name is empty in Business Central.` |
| 25 | `Status` | Option | — | Read, not used yet (§12 Q2) | `Modified` |

NAVFarm also sets `source_system = 'BC'`, `is_approved = true` (the vendor was approved by being created in BC), `bc_synced_at` (time of the last successful sync) and `vendor_type = GENERAL` for new suppliers.

### Fields deliberately **not** synced

| BC fields | Why |
|---|---|
| `Balance_LCY`, `Balance_Due_LCY`, `BalanceAsCustomer` | Financial balances change with every invoice and payment; they belong in BC and would be stale in NAVFarm |
| `VAT_Bus_Posting_Group`, `Prices_Including_VAT`, `Tax_*`, `Application_Method`, `Prepayment_Percent`, `Invoice_Disc_Code`, `Price_Calculation_Method` | Invoice and payment setup, used only by BC's purchase invoice |
| `Payment_Method_Code`, `Preferred_Bank_Account_Code`, `Creditor_No`, `Block_Payment_Tolerance`, `Cash_Flow_Payment_Terms_Code` | Payments are made in BC, not NAVFarm |
| `Purchaser_Code`, `Responsibility_Center`, `IC_Partner_Code`, `Partner_Type`, `Intrastat_Partner_Type`, `Document_Sending_Profile`, `Language_Code`, `Format_Region`, `Company_Size_Code`, `Statistics_Group`, `Priority`, `GLN`, `EORI_Number`, `Our_Account_No`, `Pay_to_Vendor_No` | BC administration; not used on the farm |
| `Location_Code`, `Shipment_Method_Code`, `Lead_Time_Calculation`, `Base_Calendar_Code`, `Customized_Calendar`, `Over_Receipt_Code` | Empty on every Triple C vendor today; can be added if procurement starts using them |
| `Search_Name`, `Disable_Search_by_Name`, `Fax_No`, `Home_Page`, `ShowMap`, `Control16`, `Primary_Contact_No`, `*_Filter` fields | Page/UI fields or duplicates |

### Fields NAVFarm owns (never written by the sync)

| NAVFarm field | Purpose |
|---|---|
| `vendor_type` | ANIMAL_SUPPLIER, BREEDING_FARM, SEMEN_SUPPLIER, FEED_SUPPLIER, MEDICINE_SUPPLIER, EQUIPMENT_SUPPLIER, SERVICES, GENERAL — drives farm checks |
| `health_cert_url`, `breeding_farm_code` | Required for animal suppliers; checked before a GRN posts |
| `nob_id`, `lob_id` | Which business vertical uses the supplier |
| `credit_limit`, bank fields | Kept for NAVFarm-created suppliers; for BC vendors these live in BC (§12 Q5) |

## 5. Integration specification

| Item | Value |
|---|---|
| BC environment / company | `SandboxUAT` / `Triple C Pigs` (company id `309328f9-0b8c-f011-b419-002248cf7a74`) |
| Endpoint | `GET https://api.businesscentral.dynamics.com/v2.0/{tenant}/SandboxUAT/ODataV4/Company('Triple%20C%20Pigs')/VendorCardApi` |
| Query | `$filter=NavFarm_Sync eq true` · `$select=` the 26 fields of §4 · `$orderby=No` · `Prefer: odata.maxpagesize=1000` (follows `@odata.nextLink`) |
| Write-back | `PATCH …/VendorCardApi('VEN0001')` with `If-Match: <ETag>`, body e.g. `{"Navfarm_Sync_Error":true,"Navfarm_Error_Message":"Name is empty in Business Central."}`; only fields whose value differs are sent |
| Authentication | OAuth 2.0 client credentials (Entra ID app); token cached ≈ 55 min; credentials only in `apps/api/.env` |
| Retries | 429/5xx/time-outs retried with back-off for reads; writes retried only when BC certainly did not process them (429/503) |
| Frequency | Hourly (`BC_VENDOR_SYNC_SCHEDULE_ENABLED=true`) and on demand |
| NAVFarm API | `GET /api/v1/integration/business-central/vendors/preview` (dry run) · `POST …/vendors/sync` · `GET …/vendors/runs` |
| Command line | `pnpm nx run api:db-bc-sync-vendors` (read-only) · `--verify` (apply + roll back) · `--apply` |
| Run log | `integration_sync_log` (entity VENDOR): trigger, status, counts, failures, written-back count |

### Configuration (`apps/api/.env`)

| Setting | Meaning | Current |
|---|---|---|
| `BC_COMPANY_NAME` | BC company name for ODataV4 | `Triple C Pigs` |
| `BC_NAVFARM_TENANT_CODE` / `BC_NAVFARM_COMPANY_CODE` | NAVFarm tenant and company that receive the vendors | `devco` / `TRIPLEC` |
| `BC_VENDOR_SERVICE` | Web service name | `VendorCardApi` |
| `BC_VENDOR_SYNC_SCOPE` | `FLAGGED` (NavFarm Sync ticked) or `ALL` (every vendor, §5b) | `ALL` (18 Nov 2026) |
| `BC_VENDOR_MASTER_SOURCE` | `BC` = BC is the vendor master: create/update from NAVFarm write to BC (§5a), or are refused when BC is unreachable; `NAVFARM` = local creation allowed | `BC` (set 17 Nov 2026) |
| `BC_VENDOR_SYNC_SCHEDULE_ENABLED` | Hourly sync | `true` (18 Nov 2026) |
| `BC_VENDOR_WRITEBACK_ENABLED` | Write result back to BC | `false` until §12 Q1 is answered |
| `BC_VENDOR_SYNC_STATUS_SYNCED` / `_ERROR` | BC option values for Sync_Status | empty (not written) |
| `BC_VENDOR_MAX_DEACTIVATE_RATIO` | Mass-deactivation guard | `0.5` |


## 5a. List, create, update and link from NAVFarm (write-through)

Active when `BC_VENDOR_MASTER_SOURCE=BC` and the BC connection is configured (`GET /integration/business-central/vendors/settings` → `writeThrough: true`).

| User action in NAVFarm Suppliers | Call to Business Central | NAVFarm result |
|---|---|---|
| **Browse BC vendors** (search by No. prefix or name, filter linked / not linked, 25 per page) | `GET VendorCardApi?$filter=…&$top&$skip&$count=true` | Live list with the linked supplier, if any |
| **Add Supplier** | `POST VendorCardApi` with the BC fields + `NavFarm_Sync = true` (no Vendor No.: BC's number series assigns it) | Supplier created from BC's reply (`source_system = BC`); vendor type, compliance, NOB/LOB saved locally |
| **Edit** a BC field (name, address, terms, currency, posting groups…) | `PATCH VendorCardApi('VEN0464')`, `If-Match` = stored ETag, **only changed fields** | Supplier refreshed from BC; NAVFarm-only fields saved locally |
| Edit only NAVFarm fields (vendor type, health certificate…) | none | Saved locally |
| **Deactivate** or **Delete** | `PATCH … {"NavFarm_Sync": false}` | Supplier inactive (delete = soft-delete); BC vendor kept |
| **Activate** / **Restore** | `PATCH … {"NavFarm_Sync": true}` | Supplier active again, refreshed from BC |
| **Link** in the browse list | `PATCH … {"NavFarm_Sync": true}` then read the vendor | Supplier created / updated |
| **Unlink** in the browse list | `PATCH … {"NavFarm_Sync": false}` | Supplier deactivated |
| **Sync from BC** | full read of flagged vendors (§2) | created / updated / deactivated per §3 |

**Field rules on write** (BC limits, enforced before calling BC): Name 100, City 30, County 30, Post Code 20, Country/Region Code 10, Phone 30, E-Mail 80, VAT Registration No. 20, Registration No. 50, Payment Terms / Currency 10, posting groups 20; code fields are upper-cased. NAVFarm's single Address line is split back into BC Address (100) + Address 2 (50) at ", ".

**Errors shown to the user**, from BC itself, e.g. *"Business Central rejected it: The field Payment Terms Code of table Vendor contains a value (99 DAYS) that cannot be found in the related table (Payment Terms)."* — nothing is saved in NAVFarm when BC refuses.

**Search note:** BC's ODataV4 refuses an OR across two fields, so the term is used on one field: a term with a digit and no spaces (e.g. `VEN04`) searches the Vendor No. prefix; anything else searches `Search_Name` (BC's upper-case copy of the name), which makes name search case-insensitive.

**API endpoints** (NAVFarm): `GET /integration/business-central/vendors` (live list) · `GET …/vendors/settings` · `POST …/vendors/{no}/link` · `POST …/vendors/{no}/unlink` · plus the normal `POST/PUT/DELETE /supplier`, `PATCH /supplier/{id}/restore`.

**Validation change (for Rishi):** the 29 Sep supplier caps were Name ≤ 50 and Postal Code digits only. BC vendors break both (VEN0205's name has 51 characters; postcodes such as `HRE`, `NORTON`), so every save of those suppliers was refused. Supplier Name now allows 100 and Postal Code letters/digits/spaces/hyphens, matching BC.

## 5b. Every BC vendor listed (scope ALL) — decision of 18 Nov 2026

The client's documents do not say whether all vendors or only selected ones reach NAVFarm (MOM 18 Aug 2026 and BBP-1 only say vendors are kept in BC; the "Sync to NAVFarm" Boolean in BBP-1 §1.5 is for items). On 18 Nov 2026 the decision was to **show every BC vendor in NAVFarm Suppliers** (`BC_VENDOR_SYNC_SCOPE=ALL`).

| Rule in ALL mode | Behaviour |
|---|---|
| Which vendors | Every vendor in BC, whatever NavFarm Sync says (payroll vendor posting groups included) |
| Active / inactive | From BC only: **Blocked = All** or **Privacy Blocked** → inactive; otherwise active |
| Stop using a vendor | Set **Blocked = All** on the BC Vendor Card. Deactivate / delete / Unlink in NAVFarm are refused with that instruction (unticking NavFarm Sync would be undone by the next sync) |
| Vendor removed in BC | Supplier deactivated, never deleted |
| Freshness | Hourly scheduled sync, and the Suppliers screen syncs on opening when the last successful sync is older than 15 minutes (`POST /integration/business-central/vendors/refresh-if-stale`) |
| Create / edit from NAVFarm | Unchanged (§5a): written to BC first |

**First full load (18 Nov 2026, `pnpm nx run api:db-bc-sync-vendors --verify` then `--apply`):** 463 BC vendors read → 456 suppliers created, 1 updated (VEN0464 reactivated), 4 unchanged, 2 not synced (**VEN0384**, **VEN0388**: no name in BC) → **461 BC suppliers** (459 active; VEN0078 and VEN0448 inactive, Blocked = All). By vendor posting group: TRADE USD 341, TRADE ZWG 49, PAYROLZWG 23, TRADE FOREIGN OTHER 20, PAYROLUSD 15, PAYROLZWS 7, SUNDRY OTHER 2, blank 4. Supplier list API and screen show 462 records (461 BC + 1 NAVFarm-created).

To go back to selected vendors only, set `BC_VENDOR_SYNC_SCOPE=FLAGGED`: the next sync deactivates (never deletes) every supplier whose vendor is not ticked — note the mass-deactivation guard (§9) will refuse that run until `BC_VENDOR_MAX_DEACTIVATE_RATIO` is raised for it deliberately.

## 6. NAVFarm data model changes

Migration `0257_supplier_bc_vendor_sync` (additive; existing suppliers keep `source_system = NAVFARM`):

| Table | Column | Type | Purpose |
|---|---|---|---|
| `supplier_master` | `source_system` | varchar(10), default NAVFARM | NAVFARM or BC |
| | `bc_vendor_no` | varchar(20), unique per company | BC Vendor No. |
| | `bc_name_2`, `registration_number`, `currency_code`, `gen_bus_posting_group`, `vendor_posting_group` | varchar | BC values (§4) |
| | `bc_blocked` | varchar(10) | BC Blocked option |
| | `bc_etag`, `bc_last_modified_date`, `bc_synced_at`, `bc_sync_error` | | Sync tracking |
| `integration_sync_log` | new table | | One row per sync run (all BC entities to come) |

## 7. NAVFarm screens

**18 Nov 2026 — the screen is called Vendors and shows only Business Central fields**, labelled as BC labels them:

| Where | Content |
|---|---|
| List columns (from BC's `VendorlistApi`) | No., Name, Phone No., Contact, E-Mail, Purchaser Code (Address shown on the record, not in the list) |
| Form — General | Name, Name 2, Purchaser Code (No. is assigned by BC on create and shown in the list and record) |
| Form — Address & Contact | Address (saved as BC Address + Address 2), City, County, Post Code, Country/Region Code, Phone No., E-Mail |
| Form — Invoicing | VAT Registration No., Registration No., Gen. Bus. Posting Group, Vendor Posting Group, Currency Code |
| Form — Payments | Payment Terms Code |
| Record view, Business Central panel | Contact, Blocked, Last Date Modified, Last Synced, Sync Error |

**Removed from the screen** (no BC field and no client document asks for them): Vendor Type, Health Certificate URL, Breeding Farm Registration No., Bank Account Number, Bank IFSC / Routing Code, Credit Limit, Nature of Business / Line of Business. Their database columns are kept (nothing dropped). Bank details stay in BC only.

**"Vendor" replaces "Supplier"** in every label, button, message and help text users see (menu, list, form, GRN vendor picker and its "Vendor DC/Invoice No.", QC "Return to vendor", role permissions list, journal source, feed requisition "Vendor or Source"; Hindi and Marathi translations too). Internal names are unchanged — API route `/supplier`, table `supplier_master`, permission key `SUPPLIER` — so saved roles, links and data keep working.

The BC bar on the screen (connection text, Browse BC vendors, Sync from BC) was removed on request; the list still refreshes from BC when the screen opens (if the last sync is over 15 minutes old) and hourly.

Earlier layout (kept for reference):

- **Masters → Suppliers** list shows a **Source** column (NAVFARM / BC).
- A BC supplier's record shows a **Business Central** panel: BC Vendor No., Name 2, Registration No., Currency, Vendor and Gen. Bus. Posting Group, Blocked in BC, Last Modified in BC, Last Synced, Sync Error.
- A **Business Central** bar above the list: environment / company, the mode, **Browse BC vendors** (live list with search, filter, paging, Link / Unlink) and **Sync from BC**.
- With write-through on, every field is editable and saved to BC; with it off, BC fields are locked with the note *"maintained on the Business Central Vendor Card"*.
- New form fields: Currency, Vendor Posting Group, Gen. Bus. Posting Group, Registration No.
- Delete / restore of a BC supplier untick / tick NavFarm Sync in BC (never delete the BC vendor).

## 8. Alerts and notifications

| Level | Event | Where it shows |
|---|---|---|
| 🔴 Critical | Run FAILED: BC unreachable, 401 (app not enabled in BC), company not found | Run log (status FAILED, message, hint, correlation id); API log |
| 🟠 Warning | Run PARTIAL: some vendors not synced | Run log `details.failures`; BC Vendor Card error flag/message (write-back); supplier `bc_sync_error` |
| 🟠 Warning | Run refused: would deactivate > 50% of BC suppliers | Run log `error_message`; nothing changed |
| ℹ Info | Run SUCCESS with counts | Run history |

## 9. Control points (summary)

1. Vendor No. is the only matching key; supplier code = vendor no. for BC suppliers and is never edited.
2. BC-owned fields: no edit, delete or restore in NAVFarm (API-enforced, not only the form).
3. Deactivate, never delete; reactivate when synced again.
4. All-or-nothing apply per run; one run at a time per tenant.
5. Mass-deactivation guard.
6. Write-back uses ETags: a vendor edited in BC during the run is not overwritten (412 → retried next run).
7. Every run logged and audited; balances and payment data never leave BC.

## 10. Verification done (17 Nov 2026)

| Check | Result |
|---|---|
| Token + SandboxUAT companies | 6 companies; Triple C Pigs found |
| VendorCardApi metadata | 76 fields; key `No`; custom fields `NavFarm_Sync`, `Sync_Status`, `Navfarm_Sync_Error`, `Navfarm_Error_Message`, `Status` present |
| Data profile | 462 vendors; 0 with NavFarm Sync ticked; 2 Blocked = All; 1 privacy-blocked; 2 without a name; 9 names used by two vendor nos. |
| Rehearsal of **all 462** vendors (`--verify`, rolled back) | 460 would be created (458 active, 2 inactive), 2 refused (no name); values checked in MySQL inside the transaction; 0 rows left after rollback |
| Normal run through the API (`POST …/vendors/sync`, real login) | SUCCESS, 0 vendors (none flagged yet), run logged and audited |
| Live list through the API and the screen | `buhler` (lower case) → 3 vendors; `VEN04` + not linked → 63; vendors added in BC after the first read (VEN0460–0463) listed |
| **Create** from NAVFarm (`POST /supplier`) | BC created **VEN0464** "NAVFARM API TEST VENDOR" from its number series, NavFarm Sync ticked; supplier stored from BC's reply, vendor type kept locally |
| **Update** from NAVFarm (`PUT /supplier/:id`) | Payment terms 14 → 30 DAYS and e-mail written to BC; vendor type changed locally only |
| BC validation | Payment terms `99 DAYS` refused by BC; message shown; nothing changed |
| **Delete / Restore** from NAVFarm | NavFarm Sync unticked / ticked in BC; supplier soft-deleted / restored; BC vendor kept |
| Sync after NAVFarm's own writes | 1 fetched, unchanged — no change loop |
| Supplier screen (browser) | BC bar, Source column, browse dialog with Link / Unlink and status; no console errors |
| Unit tests | Mapper, planner, write-back rules, supplier lock — all passing |

## 11. UAT script

| # | In BC | In NAVFarm | Expected |
|---|---|---|---|
| 1 | Tick NavFarm Sync on 3 vendors (one in ZAR, one in ZWG, one local) | Suppliers → Sync now (or `POST …/vendors/sync`) | 3 suppliers created, Source = BC, currency and terms as in BC |
| 2 | Change the payment terms of one | Sync now | Only `payment_terms` updated; run log shows 1 updated |
| 3 | — | Try to edit that supplier's name | Refused: "maintained on the Business Central Vendor Card" |
| 4 | — | Set its Vendor Type to FEED_SUPPLIER | Saved; next sync leaves it alone |
| 5 | Set Blocked = All on one | Sync now | Supplier inactive; Blocked in BC = All |
| 6 | Untick NavFarm Sync on one | Sync now | Supplier deactivated, not deleted |
| 7 | Tick NavFarm Sync on a vendor with no name | Sync now | Run PARTIAL; with write-back on, BC vendor shows the error flag and message |
| 8 | Re-tick the vendor from step 6 | Sync now | Supplier active again |
| 9 | — | Add Supplier (name, terms 14 DAYS, currency, posting groups) | Vendor created in BC with a new VEN number; supplier shows Source = BC |
| 10 | Check the new vendor in BC | Edit its payment terms in NAVFarm | BC shows the new terms |
| 11 | — | Enter an unknown payment terms code | BC's error is shown; nothing saved |
| 12 | — | Browse BC vendors → Link a vendor | NavFarm Sync ticked in BC; supplier appears |

## 12. Open questions

| # | For | Question | Until answered |
|---|---|---|---|
| Q1 | BC developer | What are the option values of **Sync_Status** (today only blank is seen)? Which one means "synced" and which "error"? | Write-back is off; when switched on without values, only the error flag and message are written |
| Q2 | BC developer | What does **Status** (every vendor shows `Modified`) mean, and who resets it? Should NAVFarm set it after a sync? | NAVFarm reads but never writes it |
| Q3 | BC developer | Does a write-back PATCH set Status back to `Modified` (an OnModify trigger)? If so, NAVFarm's own write must not count as a change | NAVFarm stores BC's new ETag after its write, so it does not loop |
| Q4 | Client (Rishi / Finance) | Confirm that NAVFarm users may **create and edit BC vendors** from the Supplier screen (write-through, §5a), or whether vendor creation should stay with Finance in BC only | Write-through is on (`BC_VENDOR_MASTER_SOURCE=BC`); set `NAVFARM` to switch it off |
| Q9 | BC developer / Finance | Test vendor **VEN0464 "NAVFARM API TEST VENDOR"** was created in SandboxUAT during verification. Delete it in BC, or keep it for UAT? | Kept, linked |
| Q10 | Rishi | Supplier Name 100 and alphanumeric Postal Code now follow BC (was 50 / digits only) | Applied |
| Q5 | Client | Bank details of BC vendors: keep only in BC (recommended) and hide NAVFarm's bank fields for BC suppliers? | NAVFarm bank fields still editable |
| Q6 | Client / BC developer | Could the Vendor Card carry a **vendor category** (animal / feed / medicine…) so NAVFarm's vendor type comes from BC? | Vendor type set in NAVFarm |
| Q7 | Finance | Two vendors have no name, and nine names exist under two vendor nos. — clean up before ticking NavFarm Sync? | The two unnamed vendors are refused |
| Q8 | Client | Internal "vendors" `MILLSHED`, `PROD` and the ~45 payroll vendors (PAYROL* posting groups) are now listed as suppliers. Keep them, or exclude by vendor posting group? | Listed (scope ALL) |
| Q11 | Finance | VEN0384 and VEN0388 have no name in BC and are not synced; VEN0022's name carries test text "uuu" | Fix in BC; next sync picks them up |
