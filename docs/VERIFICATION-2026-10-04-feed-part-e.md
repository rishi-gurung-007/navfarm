# Verification — Feed TDD Part E (requisitions), 4 Oct 2026

**Scope:** Task 15 of `.superpowers/sdd/2026-10-04-feed-part-e-requisition/`
(brief `task-15-brief.md` with Controller Amendments V1–V6). This closes Part E.

**Method:** drive the running app (browser via Playwright, and real HTTP to the
API), then read `nf_devco` on local MySQL (127.0.0.1). No product code was
changed. Two verifiers did the work. The first ran out of session at about
12:40 local time and wrote no report. This document confirms that verifier's
work from MySQL, then adds the checks that were still missing.

| | |
|---|---|
| Worktree / HEAD | `.worktrees/feed-forecast-requisition-integration`, `adde9800` |
| API | PID **7060** on :2877, started 12:22:39 from `apps/api/dist/main.js` (built 12:22). The bundle contains adde9800's string "Could not find an unused requisition number" (1 hit), so it was not restarted. |
| Web | `next dev` PID 69923 on :3002, started from this worktree's `apps/web` |
| Creator | seed COMPANY_ADMIN `company.admin@triplec.local` (user `d003d7f5…`), scope COMPANY, Triple C |
| Approver | seed TENANT_ADMIN `tenant.admin@triplec.local` (user `452fc7a7…`) |
| Login | only through `POST /api/v1/auth/login` and the app's login page, with the seed users. No token was minted. |
| Times | `requisition.created_at` and `approval_request.*` are local (+05:45). `requisition.approved_at`, `released_at` and `stock_transfer.posted_at` are UTC (see O3). |

Screenshots are in `.superpowers/sdd/2026-10-04-feed-part-e-requisition/screens/`.
That directory is git-excluded and exists on this machine only.

## Summary

| # | Check | Result |
|---|---|---|
| 1 | Item / Store: create → submit → approve (other user) → release → staged transfer → partial ship/receive ×2 → RECEIVED | **PASS** (first verifier; confirmed from MySQL) |
| 2 | Item / Purchase: release → BC_PENDING → Link PO | **PASS** (first verifier; confirmed) |
| 3 | Fixed Asset, Service: create → submit → approve → release | **PASS** (first verifier; confirmed) |
| 4 | Every approval decided by a user other than the creator | **PASS** (approval_request rows) |
| 5 | Self-approval refused | **PASS** — 403 (this run) |
| 6 | Edit after submit refused | **PASS** — 400 (this run) |
| 7 | Return TR-000024's 2 units and read the balances back | **PASS** — TR-000027. Total quantity and value restored. UOM layer split changed (O2). |
| 8 | Manual FEED from Approvals → Requisitions → New → Feed | **PASS** — REQ-GRA100-2026-00004. Row-13 refusal and reason acceptance shown on screen. |
| 9 | Manual FEED from Feed Forecast → Internal Feed Transfer → New | **PASS** — REQ-GRA100-2026-00005: refusal, then reason accepted, then created, submitted, approved by the other user, and no Release |
| 10 | Feed Forecast tab's New offers FEED only | **PASS** (screenshot 06) |
| 11 | Approvals → Requisitions: New offers Feed/Item/FA/Service, and the list shows every kind | **PASS** (screenshots 01, 02) |
| 12 | Approvals inbox shows a common and a feed requisition as full read-only documents | **PASS** for the tenant admin (screenshots 09, 10). **Defect D1:** a company-scoped approver cannot see common requisitions at all. |
| 13 | Generic `/requisition` refuses a FEED row, and the row is unchanged | **PASS** — 400 |
| 14 | Numbering: common RQ-NNNNN from the illustrative series; feed REQ-<Farm>-YYYY-NNNNN | **PASS** |

**Defects:** 1 (D1). **Observations:** O1–O5 (not Part E defects, or minor).
**Stock:** restored. GRA100/STORE-001 and RIC100/STORE-001 Tylosin are at
17 / 5950.0000 each. GRA100/SILO-001 Weaner Grower Mash is at 5172 / 178434.0000.
All 27 stock transfers are POSTED.

---

## 1. Item / Store — RQ-00005 (first verifier, confirmed)

**Steps (from rows):** created 12:25:33 by the creator in Approvals →
Requisitions, submitted 12:27:10, approved 12:28:02 by the approver, then
released by the creator. Release created TR-000024. It was shipped 1, received
1, shipped 1, received 1.

```
requisition  RQ-00005 ITEM STORE MANUAL_ENTRY status=APPROVED approval=APPROVED document=RELEASED
             fulfilment=RECEIVED integration=NOT_APPLICABLE created_by=d003d7f5 approved_by=452fc7a7
             released_by=d003d7f5 linked_transfer_id=81a1a813-754d-4b9e-a959-bceeaadc02e5
req line     35a19e52… item ICAT-005-ITM-0005 Tylosin, 2 PACK, from GRA100/STORE-001 to RIC100/STORE-001,
             qty_to_ship 2, qty_shipped 2, qty_to_receive 2, qty_received 2
stock_transfer TR-000024 POSTED (posted_at 07:00:37 UTC), line 1 qty 2,
             requisition_line_id = 35a19e52-4f93-4cf4-a49f-8d6466a85009   <- set
shipments    SH-2026-0019 qty 1 -> RC-2026-0021 qty 1
             SH-2026-0020 qty 1 -> RC-2026-0022 qty 1
inventory_ledger (STOCK_TRANSFER), one row per event, none doubled:
  TRANSFER_SHIPMENT GRA100/STORE-001 -1 -350 SH-2026-0019
  TRANSFER_RECEIPT  RIC100/STORE-001 +1 +350 RC-2026-0021
  TRANSFER_SHIPMENT GRA100/STORE-001 -1 -350 SH-2026-0020
  TRANSFER_RECEIPT  RIC100/STORE-001 +1 +350 RC-2026-0022
```

The intermediate fulfilment statuses after the first partial
(PARTIALLY_SHIPPED / PARTIALLY_RECEIVED) were not captured, because the first
verifier left no notes. The end state and the event rows above agree.
**PASS.**

## 2–3. Purchase, Fixed Asset, Service — RQ-00006/7/8 (first verifier, confirmed)

```
RQ-00006 ITEM    PURCHASE APPROVED/APPROVED/RELEASED integration=BC_PENDING linked_po_no=TEST-PO-PARTE-0001 (test value)
         line: ICAT-005-ITM-0004 Ivermectin, 1 VIAL
RQ-00007 FA      PURCHASE APPROVED/APPROVED/RELEASED integration=BC_PENDING, line "Part E verification - fixed asset line (test value)" 1 PCS
RQ-00008 SERVICE PURCHASE APPROVED/APPROVED/RELEASED integration=BC_PENDING, line resource_id 4c643978…, qty 1, uom '' (O4)
```

All three were released by the creator and approved by the approver at
07:03:45 UTC. Link PO on RQ-00006 is shown in `requisition.linked_po_no`.
`approval_request.linked_po_no` stays NULL (O4). **PASS.**

## 4. Approver is never the creator

```
approval_request  doc_type          doc_no                 status    requested_by  decided_by
                  REQUISITION       RQ-00005               APPROVED  d003d7f5      452fc7a7
                  REQUISITION       RQ-00006/7/8           APPROVED  d003d7f5      452fc7a7
                  REQUISITION       RQ-00009               APPROVED  d003d7f5      452fc7a7   (this run, from the inbox)
                  FEED_REQUISITION  REQ-GRA100-2026-00003  APPROVED  d003d7f5      452fc7a7
                  FEED_REQUISITION  REQ-GRA100-2026-00005  APPROVED  d003d7f5      452fc7a7   (this run, from the inbox)
```
**PASS.**

## 5–6. Self-approval and edit after submit — RQ-00009 (this run)

The creator ran `POST /requisition` (ITEM/PURCHASE, Ivermectin 1 VIAL) and got
201 **RQ-00009**. `POST /requisition/:id/submit` returned 201 (PENDING_APPROVAL).

- Creator `POST /requisition/fd07c63c…/approve` → **403** "You may not approve a requisition you created. Another authorized approver must decide it."
- Creator `PUT /requisition/fd07c63c…` with qty 5 → **400** "Requisition RQ-00009 can no longer be edited; only an Open requisition can change."
- Read back: status PENDING_APPROVAL, approved_by NULL, line quantity 1.0000, and approval_request PENDING with decided_by NULL. Nothing changed.
- The creator's `POST /approval/<request>/approve` from the inbox returned **404 "Approval request not found."** This is not a self-approval rule. The company-scoped creator cannot see the request at all (D1).

Afterwards the approver opened RQ-00009 in the inbox (screenshot 09) and
clicked **Approve Document**. The result was status APPROVED / APPROVED /
APPROVED, with approved_by and decided_by both 452fc7a7. **PASS.**

## 7. Return of TR-000024 (this run)

**Pre-TR-000024 value, derived from the ledger:** current minus TR-000024's
four rows. GRA100/STORE-001 was 15 + 2 = **17**, 5250 + 700 = **5950**.
RIC100/STORE-001 was 19 − 2 = **17**, 6650 − 700 = **5950**. This matches
Task 4b's recorded start of 17 / 5950 at each store.

**Steps:** creator `POST /stock-transfer` (RIC100/STORE-001 → GRA100/STORE-001,
2 PACK) returned 201 **TR-000027**. `POST /stock-transfer/:id/post` returned
201, and the transfer is POSTED.

```
ledger TR-000027: TRANSFER_SHIPMENT RIC100/STORE-001 -2 -700 SH-2026-0023
                  TRANSFER_RECEIPT  GRA100/STORE-001 +2 +700 RC-2026-0025
SUM(quantity), SUM(amount), SUM(remaining_quantity) for Tylosin:
  GRA100/STORE-001  17.0000  5950.0000  17.0000
  RIC100/STORE-001  17.0000  5950.0000  17.0000
```

`GET /inventory-ledger/balance` reports **15 PCS + 2 PACK** at each store
(5250 + 700). The total is restored. The UOM split of the open layers is not,
which O2 explains. GRA100/SILO-001 (the first verifier's TR-000025/26) is at
5172 / 178434.0000, and the forecast source shows `balanceKg` 5172. Ledger row
count went from 546 to 548. **PASS** on quantity and value.

## 8–9. Manual FEED from both entry points (this run)

**Which entry point created REQ-GRA100-2026-00003 is not recorded** (it has no
source/path column). Both entry points were therefore driven again in this run.

The row-13 rule (`requiredItemForManualLine`) fires only on a destination that
has forecast demand. Every demanded silo on every demo farm holds a different
feed with stock, so checkpoint 4 ("silo holds another feed with stock") always
fires together with row 13. A demanded silo would have to be emptied first,
and that stock move was not approved in this session. This run therefore shows
two things: the refusal; and that once the reason is supplied, **only** the
checkpoint 4 message remains. The first verifier's REQ-GRA100-2026-00003
line 20000 shows a full accept with a reason. That line was a sow diet into
GRA100/SILO-001 after TR-000025 emptied the silo (TR-000026 restored it).

**From Approvals → Requisitions → New → Feed** (creator, browser):
- The dialog offers Feed requisition / Item / Fixed Asset / Service (screenshot 02).
- GRA100, GRA100/SILO-008, Creep Feed, 500 KG, 2026-10-08 → created **REQ-GRA100-2026-00004** (DRAFT). SILO-008 has no demand, so row 13 does not apply. The document opened (screenshot 03).
- GRA100/SILO-001 (demand: Weaner), Dry Sow, 300 KG, no reason → 400, shown on screen: "Line 1: Feed item differs from the lifecycle requirement: record an exception reason (Requisition row 13). Line 1: Silo holds another feed with stock: … (checkpoint 4)." (screenshot 04)
- The same with a reason → 400, and only the checkpoint 4 sentence remains, so row 13 is satisfied (screenshot 05). No row was written.

**From Feed Forecast → Internal Feed Transfer → New** (creator, browser, `?tab=feed-requisition`):
- New offers **Feed requisition only** (screenshot 06).
- Line 1 GRA100/SILO-004 Weaner 400 KG, plus line 2 SILO-004 Dry Sow 100 KG with no reason → line 2 got both the row-13 and checkpoint 4 messages (screenshot 07). With a reason, only checkpoint 4 remained.
- With line 2 removed, Create returned **409**: "GRA100/SILO-004 already has Weaner Grower Mash (18% CP) on requisition REQ-GRA100-2026-00003 (APPROVED) this cycle — change that line instead." This is the existing one-requisition-per-cycle guard working as designed.
- Line 1 changed to GRA100/SILO-003 Lactation Diet 400 KG → created **REQ-GRA100-2026-00005** (screenshot 08). Submit for approval set it to PENDING_APPROVAL, with approval_request FEED_REQUISITION carrying the remarks as justification. The approver approved it from the inbox with remarks (screenshot 10), and it is now APPROVED, approved_by 452fc7a7, linked_transfer_id NULL. In the hub its document shows **no Release** (screenshot 11).

**Same document shape** from both entry points and the earlier one (MySQL):

```
req_no                 doc_type purpose           source       farm   line_seq uom source_type feed_type delivery
REQ-GRA100-2026-00003  FEED     INTERNAL_TRANSFER MANUAL_ENTRY GRA100 10000,20000 KG SILO BULK 2026-10-08
REQ-GRA100-2026-00004  FEED     INTERNAL_TRANSFER MANUAL_ENTRY GRA100 10000    KG  SILO        BULK      2026-10-08
REQ-GRA100-2026-00005  FEED     INTERNAL_TRANSFER MANUAL_ENTRY GRA100 10000    KG  SILO        BULK      2026-10-08
```
**PASS.**

## 10–12. Screens

- 01 `01-requisitions-hub-all-kinds.png`: Approvals → Requisitions lists Feed, Item, Fixed Asset and Service rows. The Type filter offers All/Feed/Item/Fixed Asset/Service.
- 02 `02-approvals-new-four-kinds.png`: New → four kinds.
- 06 `06-feed-forecast-new-feed-only.png`: the Feed Forecast tab's New → Feed only.
- 09 `09-inbox-common-RQ-00009-readonly.png`, 10 `10-inbox-feed-REQ-GRA100-00005-readonly.png`: inbox Details shows the full document (header + Requisition + Lines) with no editable field. The only input is the approver's own "Your remarks" box, plus Approve/Reject.

**D1 — common requisitions are invisible to a company-scoped approver.**
`ApprovalService.farmConditions()` (`apps/api/src/modules/production/approval/approval.service.ts:213-224`)
lets through a row only if it has a batch or a farm. The exception is when the
scope has no company and no farm (tenant-wide). A common requisition has
neither (`approval_request.farm_id` NULL for RQ-00005/9), so in a COMPANY
scope it is filtered out.

```
GET /approval?doc_type=REQUISITION       creator (COMPANY_ADMIN, scope COMPANY) -> 200, 0 rows
                                         approver (TENANT_ADMIN)                -> 200, RQ-00009 RQ-00007 RQ-00006 RQ-00008 RQ-00005
GET /approval?doc_type=FEED_REQUISITION  both -> the same 7 rows
GET /approval/ff9b050b… (RQ-00009)       creator -> 404 "Approval request not found."; approver -> 200
MySQL: approval_request doc_no RQ-00009 farm_id NULL, batch_id NULL, company_id 7a7fb7be…
```

Effect: only a tenant-scoped user can approve an Item/FA/Service requisition
from the inbox. A company or farm approver never sees one. The rule predates
Part E; Part E made it reachable. It needs its own task (for example, a
company-scope path `batch_id IS NULL AND farm_id IS NULL AND company_id = scope.companyId`).

## 13. Generic /requisition refuses a FEED row

`POST /requisition/181bdcf1…/reopen` (REQ-GRA100-2026-00003, approver) →
**400** "A feed requisition cannot be reopened through /requisition; use
/feed-requisition." Before and after, the row was the same: APPROVED,
approved_by 452fc7a7, approved_at 07:08:41, updated_at 12:38:41. Also,
`POST /requisition` with `doc_type: FEED` → 400 "A feed requisition cannot be
created or edited through /requisition; use /feed-requisition." **PASS.**

## 14. Numbering

`no_series` row `15bd9329…`: code REQUISITION, company Triple C, prefix `RQ`,
seq_length 5, is_default 1, current_seq 9, last_no_used `RQ-00009`.
"(local illustrative)" is Task 16's series, and it is kept. Common requisitions
in this run and the first verifier's run got RQ-00005…RQ-00009 in order. Feed
requisitions continue `REQ-GRA100-2026-00003/4/5`. The pre-series drafts
REQ-2026-0001/0002 and RQ-00001…4 are Task 13/16 rows and are kept. **PASS.**

## Observations (not Part E defects)

- **O1:** the exception reason replaces the line's `description`. REQ-GRA100-2026-00003 line 20000 reads "Exception: Verification test: sow diet into emptied silo", so the item name is no longer in `description` (item_id is still set). Worth a separate column if the reason must be reported.
- **O2:** Tylosin (`uom_primary` PACK) was seeded and moved in Task 4b as **PCS**. The RQ-00005 lines use PACK. FIFO shipments consume layers across UOMs, and `/inventory-ledger/balance` groups by UOM, so after the round trip each store shows 15 PCS + 2 PACK where it showed 17 PCS. The total quantity and value are exact. This is seed data quality (no conversion between labels), not the requisition.
- **O3:** `requisition.approved_at` and `released_at` are written in UTC, while `created_at` in the same row is local time.
- **O4:** RQ-00008 (SERVICE with a resource) saved `uom` as an empty string. The PO number linked on RQ-00006 is not mirrored to `approval_request.linked_po_no`.
- **O5:** the Feed Forecast tab is labelled "Internal Feed Transfer" (key `feed-requisition`), not "Feed Requisition".

## Rows created by the two verifiers (nf_devco)

| Row | By | State |
|---|---|---|
| RQ-00005 (ITEM/STORE), line 35a19e52… | first | APPROVED / RELEASED / RECEIVED |
| TR-000024 + SH-2026-0019/0020, RC-2026-0021/0022, 4 ledger rows | first | POSTED |
| RQ-00006 (ITEM/PURCHASE, PO TEST-PO-PARTE-0001), RQ-00007 (FA), RQ-00008 (SERVICE) | first | RELEASED, BC_PENDING |
| REQ-GRA100-2026-00003 (FEED manual, 2 lines) | first | APPROVED |
| TR-000025 / TR-000026 (GRA100/SILO-001 5172 KG out to GRA100/STORE-001 and back), SH-2026-0021/0022, RC-2026-0023/0024, 4 ledger rows | first | POSTED, net zero |
| approval_request rows for RQ-00005…8 and REQ-GRA100-2026-00003 | first | APPROVED |
| RQ-00009 (ITEM/PURCHASE, Ivermectin 1 VIAL) + approval_request ff9b050b… | this run | APPROVED (not released) |
| TR-000027 (return of TR-000024), SH-2026-0023, RC-2026-0025, 2 ledger rows | this run | POSTED |
| REQ-GRA100-2026-00004 (FEED, Approvals entry, SILO-008 Creep 500 KG) | this run | DRAFT |
| REQ-GRA100-2026-00005 (FEED, Feed Forecast entry, SILO-003 Lactation 400 KG) + approval_request | this run | APPROVED |
| `no_series` RQ current_seq 4 → 9 | both | — |

Nothing was deleted.
