# Feed Forecast Plan B — verification against the running API (Task 12)

- **API:** http://127.0.0.1:2899/api/v1, built from `feat/feed-forecast-b` @ af352f8. It was not restarted or rebuilt.
- **Database:** tenant DB `nf_devco`, migrated through 0119.
- **Date:** run on 2026-09-26 (Saturday) from about 13:15 IST. The server's planning date is 2026-09-26.
- **How:** every write went through the API. MySQL was only read.
- **Evidence:** the scripts and the full request/response and SQL log are in `/private/tmp/claude-501/-Users-nero-Desktop-navfarm/ae14dddf-fbc5-4ab7-9706-990b49fa57b8/scratchpad/b12/`: `s1.py`…`s7.py`, `fin.py`, `run.log`.
- **Logins:** `company.admin@triplec.local` (COMPANY_ADMIN) with `x-workspace-scope: COMPANY` and `x-active-farm-id: <VIL100>`. Farm users log in with their operational area, as in the Plan A E2E report. Passwords are not recorded here.
- **Marking:** everything created carries `E2E-B` in its remarks or rejection reason.

Subjects used:

| Subject | ID |
|---|---|
| Farm VIL100 | `b52f5af8-a2a5-4e79-af10-99f99f8f1821` |
| Silo VIL100/SILO-004 | `7eaf126d-02e7-4a86-8eaf-3bfbd7607008` (capacity 15,000 kg; holds ICAT-004-ITM-0004 Weaner Grower Mash) |

## Starting state (MySQL)

- **FEED requisitions:** 0.
- **`feed_alert` rows:** 4, all RESOLVED, left over from Task 7.
- **`approval_request` rows:** none with doc_type FEED_REQUISITION.
- **`alert_rule` rows:** 5.
- **VIL100 silo levels:** every silo has `low_level_kg` and `high_level_kg` NULL.
- **SILO-004 balance:** 2,684 kg of ITM-0004, as the sum of `remaining_quantity` in the ledger.

---

## 1. Silo low/high levels through the location API: PASS

| Request `PUT /location/<SILO-004>` | Status | Message |
|---|---|---|
| `{"low_level_kg":5000,"high_level_kg":4000}` | 409 | The low feed level must be below the high feed level. |
| `{"low_level_kg":1000,"high_level_kg":16000}` | 409 | The high feed level cannot exceed the silo capacity. |
| `{"low_level_kg":15500}` | 409 | The low feed level cannot exceed the silo capacity. |
| `{"low_level_kg":1000,"high_level_kg":12000}` | 200 | Location updated successfully. |
| `{"high_level_kg":900}` (low 1000 is already stored) | 409 | The low feed level must be below the high feed level. |

What MySQL showed:

- **After the three refused PUTs:** the row was unchanged. Levels were NULL/NULL and `updated_at` was still 2026-09-24 16:06:25.
- **After the accepted PUT:** `low_level_kg 1000.00`, `high_level_kg 12000.00`.
- **After the refused `high_level_kg 900`:** still 1000/12000. The pair is checked against the stored row, so the half-update was refused.

## 2. Alert rules: PASS

- `GET /alert-rule` → 200 with **5** rules, all `delivery_channel = IN_APP`:
  - DIET-CHANGE: WARNING, ONCE.
  - FEED-ABOVE: INFO, ONCE.
  - FEED-BELOW-L1: CRITICAL_FIRST_PRIORITY, ESCALATING (4 h to HEAD_OF_FARM).
  - REQ-OVERDUE: CRITICAL, ONCE.
  - REQ-REMINDER: WARNING, ONCE.
- **Other channels are refused.** `POST /alert-rule` with `delivery_channel: "SMS"` → 400 "delivery_channel must be one of the following values: IN_APP". The same happens with `"WHATSAPP"`.
- **MySQL after both refusals:** `alert_rule` still holds 5 rows, all IN_APP, and no `E2E%` code.

## 3. A stock adjustment takes the silo below its low level: exactly one alert (PASS)

1. **Create:** `POST /stock-adjustment` (SILO-004, ITM-0004, −2200 KG, remarks "E2E-B take SILO-004 below its low level") → 201, draft **ADJ-000014** (`c40d90eb-ac79-4441-9479-f92d76000247`).
   - MySQL before posting: no `feed_alert` row for the silo.
2. **Post:** `POST /stock-adjustment/<id>/post` → 201.
   - Ledger: `ADJ-000014 NEGATIVE VARIANCE_NEGATIVE −2200 @36.613636 = −80,550`.
   - SILO-004 balance **484 kg**.
   - The posting hook raised the alert:

| alert_id | code | status | priority | observed | threshold | open key | notify_count |
|---|---|---|---|---|---|---|---|
| 56e6f39c-640b-47cd-87c6-71be20db1bf4 | FEED-BELOW-L1 | ACTIVE | CRITICAL_FIRST_PRIORITY | 484 | 1000 | yes | 1 |

3. **Evaluate twice:** `POST /feed-alert/evaluate {"farmId":VIL100}` → 201 both times with `raised 0, renotified 0, escalated 0, resolved 0`.
   - MySQL: still **one** row for the silo. `feed_alert` overall: 1 ACTIVE, 4 RESOLVED.
4. **List:** `GET /feed-alert?farmId=VIL100` as the admin → 200 with the one alert. Its message reads "VIL100/SILO-004 holds 484 kg of Weaner Grower Mash (18% CP) — at or below its low level of 1,000 kg."
5. **Cross-farm acknowledge:** as `gra100.entry` (STANDARD_USER on GRA100):
   - `GET /feed-alert?farmId=VIL100` → **404** "Farm not found."
   - `POST /feed-alert/<id>/acknowledge` → **404**.
   - MySQL: `acknowledged_by` and `acknowledged_at` still NULL.
6. **Acknowledge as the admin:** `POST /feed-alert/<id>/acknowledge` → 201.
   - MySQL: `acknowledged_by = company.admin`, `acknowledged_at 2026-09-26 07:45:38`, status still ACTIVE with its key open. An acknowledgement stops the escalation; it does not resolve the alert.
   - A further evaluate raised nothing, and the silo still has 1 ACTIVE row.

Recovery is in §7.

## 4. Auto-draft for VIL100: PASS

**Default window (planning date + 7).** `POST /feed-requisition/auto-draft {"farmId":VIL100}` → 201 "Nothing to order: stock covers the forecast." with `requisitionId null`. MySQL has no FEED requisition. The forecast explains it: SILO-004 has 484 kg against a walk demand of 130.56 kg over the window, and every store holds more than its demand.

**`to = 2026-11-10` (today + 45).** `POST /feed-requisition/auto-draft {"farmId":VIL100,"to":"2026-11-10"}` → 201, `created: true`, `linesDrafted: 2`, requisition `d024f245-c49d-4cdb-93b2-3a051e836bc5`.

The requisition header in MySQL:

| req_no | status | type | source | purpose | supply | priority | required | production | deadline | run key |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-VIL100-2026-00001 | AUTO_DRAFT | FEED_FORECAST | AUTO_FORECAST | INTERNAL_TRANSFER | MILL | CRITICAL_FIRST_PRIORITY | 2026-10-22 | 2026-09-27 (Sun) | 2026-09-26 (Sat) | RUN-VIL100-20260926-131550 |

The lines in MySQL (`requisition_line`):

| seq | destination | item | type | next diet | days before change | balance | daily | days left | unrounded | recommended | quantity | bags | delivery |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | VIL100/SILO-004 | ICAT-004-ITM-0004 | BULK | 0 | — | 484 | 16.32 | 29 | 152.48 | 3000 | 3000 | — | 2026-10-25 |
| 2 | VIL100/STORE-001 | ICAT-004-ITM-0001 Creep Feed | BAGGED | 1 | 26 | 0 | 2.55 | — | 2.55 | 50 | 50 | 1 | 2026-10-22 |

Checked by hand against `GET /feed-forecast?farmId=VIL100&to=2026-11-10`:

- **Line 1:**
  - The forecast gives walkDemandKg 636.48 (39 days × 16.32, stage days 5–43) and balanceKg 484.
  - Unrounded need: 636.48 − 484 = **152.48**.
  - BULK rounds up to a multiple of 3,000: ⌈152.48 / 3000⌉ × 3000 = **3000**.
  - Days left: ⌊484 / 16.32⌋ = 29. Run-down date 2026-10-25, which is also the delivery date.
- **Line 2:**
  - The forecast gives walkDemandKg 2.55, balanceKg 0, and marks it as the next diet (first demand 2026-10-22).
  - Unrounded need: **2.55**.
  - BAGGED rounds up to 50 kg: ⌈2.55 / 50⌉ × 50 = **50**, which is **1** bag.
  - Days before the diet change: 09-26 → 10-22 = **26**.
- **Header:**
  - **Priority:** SILO-004 is at 484 kg, below its low level of 1,000, so the priority is **CRITICAL_FIRST_PRIORITY** (Requisition §1 row 34).
  - **Required date:** the earliest line date, 10-22.
  - **Cycle:** planning day Saturday 09-26, so production is Sunday 09-27 and the deadline is Saturday 09-26.
- **Deadline alert:** the evaluation after the commit raised `REQ-OVERDUE` (CRITICAL, ACTIVE) on the requisition, because today is the deadline day. This is the Q6 default.

**Rerun, no duplicate.**

- A second `auto-draft` with the same `to` → 201 `created: false`, the same requisitionId.
- MySQL: `COUNT(*)` of live FEED requisitions for VIL100 with deadline 2026-09-26 = **1**. The lines are unchanged and `forecast_run_key` moved to `…-131610`.

## 5. Edit kept on rerun; manual entry refused for a silo and item already on the cycle (PASS)

- **Edit:** `PUT /feed-requisition/<REQ-1> {"lines":[{"line_id":"4014de37…","quantity_kg":4500}],"remarks":null}` → 200.
  - MySQL line 1: `quantity 4500`, `recommended 3000`, `quantity_edited 1`.
  - The `remarks: null` body is accepted (the af352f8 fix).
- **Rerun after the edit:** `auto-draft` → 201 on the same requisition.
  - MySQL: the count is still **1**. Line 1 keeps **4500** with `quantity_edited 1`, and the run key moved to `…-131613`.
- **Manual line for a pair already on the draft:** `POST /feed-requisition` with SILO-004 + ITM-0004, 1000 kg → **409** "VIL100/SILO-004 already has Weaner Grower Mash (18% CP) on requisition REQ-VIL100-2026-00001 (AUTO_DRAFT) this cycle — change that line instead."
  - MySQL: the count is still 1.
  - It is refused because the auto line was edited. An untouched auto line would have been superseded instead, by design.
- **Manual line for a pair not on the cycle:** SILO-005 + ITM-0004, 1234 kg, remarks "E2E-B manual requisition" → 201 **REQ-VIL100-2026-00002** (`ce4fb9e7-5eb8-4856-80e3-0fceebb607a2`).
  - MySQL: DRAFT / MANUAL / MANUAL_ENTRY, one BULK line of 1234 kg with no recommendation.
- **A second manual line for SILO-005 + ITM-0004** → **409** naming REQ-VIL100-2026-00002 (DRAFT). MySQL: the count stays 2.

## 6. Approval rules: PASS

Before any approval attempt, MySQL showed REQ-1 as `AUTO_DRAFT`, with `approval_request_id` NULL and remarks NULL.

- **No remarks:** `POST /feed-requisition/<REQ-1>/approve {}` → **400** "Line 1 (Weaner Grower Mash (18% CP)): requested 4,500 kg is more than 20% from the recommended 3,000 kg — remarks are required."
  - MySQL: still AUTO_DRAFT, `updated_at` unchanged.
- **Other farm, and users with no approve grant:** every one of these answers **403** "Insufficient permissions to execute this request." to both `POST …/approve` and `GET /feed-requisition/<id>`:
  - `gra100.entry`, a STANDARD_USER on another farm.
  - `gra100.manager`, a STANDARD_USER on another farm.
  - `vil100.entry` and `vil100.manager`, STANDARD_USERs on the same farm.
- **Another company:** nf_devco holds only one company (TRIPLEC), so there is no admin of another company. `tenant.admin` with `x-active-company-id` set to a random UUID → **403** "Not authorized for this company." on approve and on GET.
- **After every refusal:** MySQL showed REQ-1 still AUTO_DRAFT, and **0** `approval_request` rows for `REQ-VIL100%`.
- **Why 403 and not 404:** no non-admin user in nf_devco holds any `PROCUREMENT/REQUISITION` grant. Their roles are OPERATOR only, and the managers have no active role. `RolesGuard` therefore refuses at the route before `resolveOwnFarm` runs. The by-id 404 (Ruling H3) could not be reached through the requisition routes with the existing users. The same by-id pattern is proven live on the feed-alert route in §3 step 5 (gra100.entry → 404, nothing written). Granting a role to make the requisition case reachable would be a configuration change, so it was not done.
- **Approve with remarks:** `POST …/approve {"remarks":"E2E-B verification: larger order for SILO-004 below its low level"}` → **200**.

MySQL after the approval:

| req_no | status | approved_by | approved_at | approval_request | doc_type | doc_no | ap. status | batch_id | urgency | justification |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-VIL100-2026-00001 | APPROVED | company.admin | 2026-09-26 07:47:10 | da00c67d-90ec-4817-8420-87db58a495c0 | FEED_REQUISITION | REQ-VIL100-2026-00001 | APPROVED | **NULL** | HIGH | the remarks |

- **`audit_log`:**
  - `CREATE approval_request da00c67d…` with the farm and doc_type FEED_REQUISITION.
  - `APPROVE approval_request da00c67d…`: old `{"status":"PENDING"}`, new APPROVED with the remarks.
- **Deadline alert:** the REQ-OVERDUE alert on REQ-1 went ACTIVE → **RESOLVED / CLOSED** with its key cleared, resolved at 07:47:10.
- **Nothing changes after approval:**
  - A second approve → 400 "Requisition REQ-VIL100-2026-00001 is APPROVED and can no longer be changed."
  - A `PUT` after approval → the same 400.

**The generic route is unmounted (Ruling C2).** Each of these answers **404** "Cannot GET/POST …":

- `GET /requisition`
- `GET /requisition/<id>`
- `POST /requisition/<id>/approve`

## 7. Recovery, over-stock, reject, restore: PASS

- **Recovery:**
  - `POST /stock-adjustment` (+2200 KG @36.613636, remarks "E2E-B restore SILO-004 (nets ADJ-000014)") → **ADJ-000015** (`15e29bcd-9128-4caf-8aef-636324961f90`). Posted → 201.
  - Ledger: `ADJ-000015 POSITIVE VARIANCE_POSITIVE +2200 = 80,549.9992`. SILO-004 balance **2684** again.
  - The posting hook resolved the alert: FEED-BELOW-L1 `56e6f39c…` → **RESOLVED / RECOVERED**, key cleared.
- **Over-stock (extra):**
  - `PUT /location/<SILO-004> {"low_level_kg":null,"high_level_kg":2500}` → 200; MySQL NULL/2500.
  - The first evaluate returned `raised 1`, the second `raised 0`.
  - MySQL: one **FEED-ABOVE / INFO / ACTIVE** row (`44a1b766…`), observed 2684, threshold 2500.
- **Reject the manual requisition:**
  - `POST /feed-requisition/<REQ-2>/reject {}` → 400 "A rejection reason is required."
  - With `{"rejection_reason":"E2E-B verification cleanup"}` → 200.
  - MySQL: REQ-2 is REJECTED, remarks gained "Rejected: E2E-B verification cleanup", `approval_request 4c329f37…` is FEED_REQUISITION / REJECTED with batch_id NULL, and REQ-2's REQ-OVERDUE alert is RESOLVED / CLOSED.
- **Restore the levels:**
  - `PUT /location/<SILO-004> {"low_level_kg":null,"high_level_kg":null}` → 200. MySQL: NULL/NULL, and no VIL100 silo has a level set.
  - A final evaluate returned `resolved 1`: FEED-ABOVE is RESOLVED / RECOVERED.
  - `feed_alert` overall: **0 ACTIVE**, 8 RESOLVED.

## Not exercised live, and why

- **DIET-CHANGE (3 days).** The farm's only diet change is BATCH-000010 LACTATION → Creep Feed on 2026-10-22, 26 days away. No lifecycle rows were edited to force one.
- **REQ-REMINDER.** Today is the deadline day, where the Q6 default raises REQ-OVERDUE instead. The reminder only fires the day before, and no date was changed to force it.
- **Late approval (after the deadline).** Approval happened on the deadline day, which counts as on time.
- **Escalation after 4 h.** The alert was acknowledged and then recovered well within 4 h. Task 7 exercised escalation.
- **The requisition by-id 404 for another farm's user or another company's admin.** It cannot be reached with the current nf_devco users and companies (see §6). The equivalent feed-alert by-id 404 was proven.

## Observations (not defects in Plan B code)

1. **Farm staff see no feed alerts.** `GET /feed-alert` as `vil100.entry` → 200 `[]` while the admin sees the ACTIVE alert. The default rules address FARM_MANAGER / HEAD_OF_FARM, which match no role in nf_devco. This is the Q1 default already recorded under Task 7; the client must create the roles or edit the rules.
2. **No non-admin user can open Feed Requisitions.** No role in nf_devco grants `PROCUREMENT/REQUISITION`. In the demo data, feed requisitions are admin-only until roles are granted.
3. **Mixed timestamps on the same approval.** `requisition.approved_at` and `feed_alert` times are UTC (07:47:10), while `approval_request.decided_at` and `audit_log.created_at` are server-local (13:17:10). This is the known project-wide convention question from Task 9, still for Rishi.
4. **The adjustments leave a 0.0008 value residue.** Quantity nets to zero, but the value is off by 0.0008. The positive adjustment's rate is stored to 6 dp (36.613636), so it re-values 2,200 kg at 80,549.9992 against the 80,550.0000 removed. Journals: JE-000537 80,550.0000 and JE-000538 80,549.9992. This is a property of the stock-adjustment module, not Plan B.

## Defects

None found in Plan B.

## What this run left in nf_devco

| Record | State |
|---|---|
| REQ-VIL100-2026-00001 `d024f245-c49d-4cdb-93b2-3a051e836bc5` (+2 lines) | **APPROVED**. It cannot be rejected or deleted through the API once approved, so it is left as evidence. |
| REQ-VIL100-2026-00002 `ce4fb9e7-5eb8-4856-80e3-0fceebb607a2` (+1 line) | **REJECTED** (E2E-B cleanup) |
| approval_request `da00c67d-90ec-4817-8420-87db58a495c0` (APPROVED), `4c329f37-84b9-4368-8e97-c280fc54b554` (REJECTED) | FEED_REQUISITION, batch_id NULL, plus their audit_log rows |
| ADJ-000014 `c40d90eb-…` (−2200) and ADJ-000015 `15e29bcd-…` (+2200) | POSTED. Net 0 kg; SILO-004 back at 2,684 kg. JE-000537 / JE-000538. |
| feed_alert: FEED-BELOW-L1 `56e6f39c…`, FEED-ABOVE `44a1b766…`, 2 × REQ-OVERDUE | All RESOLVED; 0 ACTIVE |
| SILO-004 low/high levels | NULL / NULL (as at the start); `updated_at`/`updated_by` changed by the PUTs |
| alert_rule | Unchanged (5 defaults; the refused SMS and WHATSAPP rules were never written) |
