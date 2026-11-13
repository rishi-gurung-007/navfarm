# NAVFarm: full-project audit, 10 Nov 2026

Branch `feat/system-schedulers` at `008df6ea`, plus the uncommitted working tree (the Incoming-QC work and the animal QR/barcode work, both unreviewed and uncommitted). Tenant database `nf_devco`. API on 127.0.0.1:2877, web on localhost:3002.

**Verdict: not production-ready.** The core that has been built is in better shape than most projects at this stage. Postings balance, scope isolation holds almost everywhere, and the test suite is large and mostly green. But measured against the client's documents, about half of the BBP scope is built. Two documented integrations (Business Central, Pig Expert) and a whole section (Logistics) do not exist. 18 of the 19 BBP reports are missing. One confirmed data-exposure defect needs fixing before any multi-farm or multi-company use.

## How this was checked

Nothing in the code or the database was changed. The ways of checking, and what each one can and cannot prove:

| Method | What it covered | Limit |
|---|---|---|
| Client documents parsed | TDD tracker (`OneDrive_1_04-09-2026/PTL_ Internal Docs/TDD_Triple-C Development Testing_Tracker_V0.1.xlsx`, 142 rows) and BBP-1 (`Triple-C_NAVFarm BBP1_V0.1_Final.docx`, 18 sections) | The tracker's status columns were never filled in; the BBP is unsigned (AGENTS.md §2) |
| Test suites | API jest: 343 suites / 4,415 tests. Web jest: 151 suites / 1,215 tests | Unit tests: AGENTS.md says they are not proof |
| Typecheck and lint | `tsc --noEmit` on the API app, spec and script configs; `nx typecheck web`; `nx lint web` | API spec typecheck swamped by a stale composite build (TS6305) |
| Live API smoke | Every parameter-free GET in Swagger (155 of 464 paths) in COMPANY and OPERATIONAL scope; every farm-scoped feed and report GET for all three farms | Read-only. Routes with path parameters were sampled, not exhausted |
| Live authorization probes | Signed in as a farm-bound OPERATOR (`por100.entry@triplec.local`). Writes sent only as requests that fail validation or name records that don't exist, so nothing could be written | One role type tested in depth |
| Live UI crawl | All 107 page routes (every page plus all 37 master-data screens), each loaded in the signed-in browser; rendered text, uncaught errors and failed API calls recorded | Rendering only: no forms submitted |
| MySQL, read-only | Schema, keys, indexes, migration journal; journal balance, trial balance vs reports, inventory FIFO, register caches vs ledger, register/breeding consistency; the project's read-only `db-check-bio-asset-reconciliation` | Data is small (24 animals, 30 batches, 767 journals) and mostly seeded |
| Write-path rehearsals | `pnpm verify:costing` (rolls back) and the four read-back verifiers (`verify:costing-two/-fv/-freq/-conv`) | **None could run on this database** (below) |

**What was not verified, and why.** No create, edit, post or approve workflow was run. You asked for no changes, and the development database is shared and in use. The project's own rollback rehearsal stopped at its precondition: *"MUL100 has no two free registered animals in one stage"*, because all 24 animals are in BATCH-000001. The four read-back verifiers each expect their own seed, which this database does not hold. The documented way to prove write paths without touching this database is a second, temporary MySQL server seeded with `pnpm seed:costing-test` (AGENTS.md §9). It was not done, pending your approval. The current database also holds **zero** daily-data-entry rows, approval requests, requisitions and expense documents, so those workflows have no evidence in it at all.

## 1. Overall completion

Scored against the BBP's 17 functional sections (section 18 is sign-off), each weighted equally, from what exists in code, schema and data, not from what the UI shows.

| | Estimate |
|---|---|
| BBP-1 functional scope (17 sections) | **≈ 49%** |
| Same, excluding §14 integrations (deferred by decision: "Business Central is not connected") | ≈ 52% |
| TDD tracker rows 1-142 (masters) | ≈ 85% (rows not met listed in §4) |
| Production readiness | **No**: see Critical and High below |

The percentages are judgement on evidence, not a count of lines. Each section's score and its reasons are in §2.

## 2. Module-wise status (BBP-1 sections)

Status key: **Built** = implemented and seen working live or in MySQL. **Partial** = some documented parts missing. **Not built** = nothing in code or schema.

| # | BBP section | Status | Score | Evidence and gaps |
|---|---|---|---|---|
| 1 | Master Data Setup | Partial | 85% | 37 master screens all render. KPI parameters: 26 in DB vs 32 in BBP. Reason codes: 115 (BBP 47; seeded set exceeds). No COA/Item sync from D365BC. Ear tag, serial no. and landing cost dropped (§4, A1) |
| 2 | Animal Register & Lifecycle | Partial | 70% | Register, lineage, status, TSI/grading as manual fields, age, card facts all live. **Not built:** gilt tag format `G[YY][WW][Seq]`, Quarantine 8-step process. Animal barcode exists only in uncommitted work |
| 3 | AI Station & Insemination | Partial | 60% | Boar selection, semen collection by line, BCS, insemination, pregnancy check, semen lot labels. **Not built:** mating-advice upload, negative-advice hard block. Empty days: column/config only, no calculation |
| 4 | Batch Management | Partial | 65% | Batches, schedulers, transfers, day reversal. **Not built:** 21 permanent sow batches. Scheduler data uses 2 line types (CONSUMPTION, DESCRIPTIVE) of the 6 documented |
| 5 | Daily Data Entry | Partial (unverified here) | 60% | Screen, lock and reversal service exist (`batch-day-reversal.service.ts`); the 14 Sep verification docs exercised it. `batch_daily_data` currently has **0 rows** |
| 6 | Gilt Lifecycle | Partial | 40% | Gilt selection from litter, teat hard block. **Not built:** checkpoint weights 10/15/16/19/21/23/25/28 wk, parity distribution, stand-over tracking |
| 7 | Feed Management & Silo | Built (core) | 80% | Forecast, silo status, alerts, feed plan, requisitions, stock count all 200 for all three farms. Mill dispatch and transfer-order receipt are later phases. No D365BC PO |
| 8 | GRN & Procurement | Partial | 60% | GRN (13), lots, incoming QC (1 inspection), requisition module. No D365BC PO sync. QC rejection disposition not applied (C3) |
| 9 | Logistics & Vehicle | **Not built** | 0% | No vehicle, route, driver or freight-rate tables or screens |
| 10 | Transfer Order & DOA | Partial | 35% | Stock and batch transfers, DOA at receipt (`receipt-doa.ts`), FA→Inventory conversion. **Not built:** Kill Sheet (no table, deferred 20 Oct), slap mark, HO approval for TO, WhatsApp |
| 11 | Inventory Management | Built (core) | 70% | Ledger, adjustments, transfers, stock count; FIFO remaining quantities reconcile. Physical Inventory Journal as a general journal type not found |
| 12 | GL & Dimension Setup | Partial | 50% | COA, GL mapping, cost centres; journals balance. No D365BC COA/posting-group sync, no dimension sets |
| 13 | Expense Voucher & Requisition | Partial (unexercised) | 55% | Screens and API exist; 0 expense documents and 0 requisitions in the DB. No D365BC journal API |
| 14 | Integration: Pig Expert & D365BC | **Not built** | 0% | No client code, no retry queue, no `POSTED_PENDING_ERP`. `integration_status` exists only on requisitions. Deferred by decision |
| 15 | Traceability & Barcode | Partial | 35% | Traceability page, pack QR (`qr_code_master`), semen lot labels; animal barcode uncommitted. Chain stops before TO/DOA/Kill Sheet |
| 16 | Reports, Dashboards & KPI | Partial | 20% | **1 of 19** BBP reports (R07 Farrowing) plus trial balance, P&L, balance sheet, herd analytics. Not found: WOS/WOB/WOW, Piglet Loss Matrix, Gilt Weight Tracking, the 7 role-based views |
| 17 | Events & Approval Workflow | Partial | 45% | In-app alerts, alert rules, approval requests, period close. The 17-row approval matrix is not configurable as a matrix. Notifications are IN_APP only (decided). 0 approval requests in DB |

## 3. Documentation vs implementation

| Document says | Implementation | Assessment |
|---|---|---|
| TDD 17/19/22: serial no., unique ear tag number, landing cost on the animal | Dropped by migration `0137_animal_register_rfid_only.sql`; no entry in `docs/decisions.md`; arrived in commit `1cac62a1` titled "Add validation scripts for agents, skills, workflows, templates, and encoding" | **Undocumented deviation** (A1) |
| TDD 30/31/33/43: bio-asset value, amortised, residual "flow from BC" | Computed locally from `bio_asset_ledger` | Reasonable while BC is not connected; record it as a decision |
| TDD 41: TSI fetched from TOPIGS | Manual field | Integration missing |
| TDD 1: change log activation per table, managed by user | `audit_log` exists; no per-table activation setting | Partial |
| TDD 6: animal code `PIG-YYYY-SEQ` vs BBP §2.1 `ANM-YYYY-NNNNN` | `PIG-2024-0001` | Still an open client question (AGENTS.md §7) |
| BBP §16: 19 reports | 1 | Large gap |
| BBP §14: D365BC 14 event types, Pig Expert 9 | None | Deferred by decision; must be on the sign-off outstanding-items register |
| AGENTS.md §8: feed forecast stage-split `varchar(36)` defect "open as of 3 Oct" | Fixed in code: `realBatchId` kept apart from the composite key (`feed-forecast.service.ts:836`); forecast GETs 200 on all farms | **AGENTS.md is stale**; the save path was not re-run |
| AGENTS.md §8: D1, Approvals inbox hides farm-less rows | `ApprovalService.farmConditions` now admits requisition kinds for deciders (`approval.service.ts:274`) | Looks fixed; not verified live (no data) |
| `navfarm-work-remaining.md` (2 Sep), `navfarm-piggery-status.md` | Superseded | Stale status documents still in `docs/` |

## 4. Missing functionality

- Logistics module (§9): vehicle, route, driver, freight-rate masters; vehicle on TO; freight cost; dispatch notifications.
- Integrations (§14): D365BC (PO, COA, posting groups, inventory, journals), Pig Expert, TOPIGS TSI.
- Reports (§16): 18 of 19 BBP reports; Stage KPI, Gilt Weight Tracking, WOS/WOB/WOW, Piglet Loss Matrix dashboards; 7 role-based views.
- Kill Sheet, slap mark, full traceability chain past the transfer order (§10, §15).
- Gilt checkpoint weights, parity distribution, stand-over (§6).
- Mating-advice upload and negative-advice hard block; empty-days calculation (§3).
- 21 permanent sow batches (§4); quarantine 8-step process and gilt tag format (§2).
- Animal ear tag number, serial no., landing cost (TDD 17/19/22).
- QC rejection disposition (plan `2026-11-03-incoming-qc`): SQL written, never applied (C3).

## 5. Code-level issues and bugs

### C1 (High): FA→Inventory conversion ignores farm and company scope
- **Where:** `apps/api/src/modules/piggery/animal/fa-conversion/fa-conversion.service.ts`: `load()` (line 53), `request()` (line 76); controller `fa-conversion.controller.ts` (`/fa-conversions`).
- **Expected:** every operational record is limited to the user's company, area and farm (decision 15 Oct "Farm scope"; `farm-scope-coverage.spec.ts`).
- **Actual:** queries filter by `tenant_id` only. **Verified live:** the OPERATOR bound to farm POR100 listed and opened `FAC-2026-00001`, a conversion of `PIG-2024-0017` on MUL100. By code, the same user (who has `PIGGERY/ANIMAL edit`) can raise a conversion for, or cancel one of, an animal on any farm or in any company of the tenant.
- **Impact:** exposure of another farm's (or company's) asset values, and cross-farm changes to a step that relieves book value.
- **Fix:** mark the controller `@FarmScoped()`; in `load` and `request`, read the animal through `AnimalService.findOne` (already scoped) or add `animalScopeConditions(farmScope(cls))` plus the company condition; then re-run `farm-scope-coverage.spec.ts`.

### C2 (Medium): BATCH-000001 carrying value disagrees with its ledger
- **Where:** `db-check-bio-asset-reconciliation`: `batch_carrying_value 1927.77`, `ledger_expected 1903.08`, **difference 24.69**. Every animal cache matches its ledger; only the batch figure differs.
- **Expected:** AGENTS.md §9: "A difference there is a defect, not rounding."
- **Fix:** trace which posting changed `batch_bio_asset_state` without a matching ledger row (start with the 614 BATCH journals and the GL_RECLASS/registration entries).

### C3 (Medium): orphan migration never runs
- `apps/api/src/drizzle/tenant/0242_qc_inspection_disposition.sql` is committed (in `008df6ea`) but absent from `meta/_journal.json`. `rejection_disposition` and `rejection_ref` do not exist in `nf_devco`, and no code references them. Two files also share number `0242` (and two share `0102`).
- **Fix:** either journal it under the next free number and build the feature, or delete the file; one owner for migration numbering (AGENTS.md §8).

### C4 (Medium): 500 on a missing query parameter
- `GET /no-series/preview-by-master` with no `masterType` → **500**: `masterType.toUpperCase()` on undefined at `apps/api/src/modules/system/number-series/number-series.service.ts:2561`.
- **Fix:** validate the query with a DTO (400 "Master is required.", as `/number-series/preview` already does).

### C5 (Low): wrong status codes or raw messages for missing parameters
- `GET /goods-receipt/next-number` without `company_id` → 403 "Not authorized for this company." (`goods-receipt.controller.ts:39`); `GET /user/assignable-areas|farms` without `companyId` → 403 "That company is not part of your tenant." (`user.controller.ts:51`). These should be 400.
- `GET /item-qc-spec` without `itemId` → 400 "The value passed as UUID is not a string" (library text shown to the user).

### C6 (Low): type and lint regressions
- `apps/api/src/scripts/seed-ai-station-fixture.ts:73,75`: 3 × TS2339 (`notes`, `path`, `body` on a union type). This alone fails `nx typecheck api`.
- Web lint: **101 errors vs the accepted baseline of 85** (AGENTS.md §5), so 16 new. Includes `no-constant-binary-expression` ×2 in `apps/web/src/modules/master-data/AnimalDetailPanel.tsx` (`Number(x) ?? 0` never falls back, so a missing figure becomes `NaN` instead of 0), and `react-hooks/exhaustive-deps` in the journal, bio-costing-runs, goods-receipt and batch panels.
- Financial report totals are summed in floating point (`totalDebit: 93201.62839999999`), so display and rounding are fragile.

### C7 (Low): failing tests
- API: `farm-scope-coverage.spec.ts` (C1, a real defect); `breeding.controller.spec.ts` expects 10 routes, there are 12 (stale count; all 12 carry `PIGGERY/ANIMAL` permissions).
- Web: `breeding-rules.spec.ts` (×2: a mating now also requires `semen_lot_id`; spec or rule must be decided); `goods-receipt-panel-edit.spec.tsx` (×3: `tLabel is not a function`, a mock missing after the uncommitted QC work).

## 6. API and database

**Correct, verified in MySQL:**
- 767 journals, all POSTED, every one balanced; header totals equal line totals; no line with both debit and credit; trial balance nets to 0.
- Trial balance, P&L and balance sheet API figures equal sums computed directly from `journal_line` (assets 27,739.40; liabilities 53,855.85; net income −26,116.45 = equity; TB 93,201.63 both sides).
- Inventory: no negative item×location balance; FIFO `remaining_quantity` sums equal balances for every item×location.
- No duplicate journal, GRN, batch or animal codes.
- Register: animal caches equal ledger for all 24 animals; parity, born-live and weaned totals equal farrowing records; expected farrowing 114–116 days after mating; no dangling sire/dam; no active animal in a closed batch.
- Schema: 165 InnoDB tables, all with primary keys, one collation, 480 foreign keys; migration journal 246/246 applied, monotonic.
- API smoke: 114 of 155 parameter-free GETs return 200 in both scopes. The rest are 400s for missing required parameters, except C4 and C5. All responses under 200 ms.

**Issues:**
- C2, C3, C4, C5 above.
- **Indexes (Medium, scalability):** 149 `*_id` columns have no index; `batch_daily_data` (grows daily per line per animal) has no index leading on `company_id`; `audit_log` none on `tenant_id`. Invisible at today's volume (24 animals). Add composite indexes matching the list queries (`company_id, posting_date` etc.) before real data volumes.

## 7. Failed and incomplete workflows

- **Not exercisable on this database:** daily data entry, approvals, requisitions, expense vouchers (0 rows each). Costing rehearsals stopped at their preconditions (see "How this was checked").
- **Verified working (read side):** feed forecast, silo status, feed plan, feed alerts, requisition options, stock count, farrowing report for all three farms; financial statements; animal lookup and card.
- **UI:** all 107 routes render with no error text and no uncaught exception. The pages made 2,290 API calls between them; the only non-2xx responses were two 401s on the first page (the expired access token being refreshed, as designed), and no call took longer than 1.5 s. Redirect routes (e.g. `/inventory/feed-requisitions` → `/inventory/feed-forecast`) log a development-only React profiling error, which is harmless.

## 8. Business logic and calculation mismatches

- Batch carrying value vs ledger (C2).
- Mating rule vs its spec: `semen_lot_id` now required where the spec says only batch, sow and boar for a natural mating (C7). One of the two is wrong; TDD 47/48 say the semen lot appears only for AI.
- `Number(x) ?? 0` fallbacks in the animal card (C6).
- Empty days (BBP §3) and service-target KPIs: empty days not calculated; service target only in the farrowing report.

## 9. Security and performance

| ID | Severity | Finding | Where | Recommendation |
|---|---|---|---|---|
| S1 | High | Cross-farm/company exposure in FA conversion (C1) | `fa-conversion.*` | Scope it |
| S2 | High | `POST /tenant/signup` is unauthenticated and creates a database (`CREATE DATABASE` in `tenant.service.ts:64`), with no rate limit, CAPTCHA or email verification | `tenant.controller.ts:45` | Gate behind system admin or invitation in production; rate-limit |
| S3 | High | No rate limiting anywhere (no throttler); login relies on per-account lockout only | `main.ts`, `app.module.ts` | `@nestjs/throttler` on auth and signup at least |
| S4 | Medium | Swagger UI and `/api/docs-json` served unconditionally, including production | `main.ts:204` | Serve only when `NODE_ENV !== 'production'` or behind auth |
| S5 | Medium | `RolesGuard` fails open: a route with no permission metadata is allowed to any signed-in user (`roles.guard.ts`, `if (!requiredPermissions.length) return true`). Today 130 routes have no decorator; the ones probed are protected by the master path map or their own guards (verified: OPERATOR got 403 on all 7 master writes), but a new route outside that map would be open by default | `common/guards/roles.guard.ts` | Fail closed; require explicit `@Public`/`@AnyAuthenticated` |
| S6 | Medium | Access and refresh tokens in `localStorage`; no Content-Security-Policy or security headers (`helmet` absent) | `apps/web/src/lib/api-client.ts:169,343` | httpOnly refresh cookie; CSP; helmet |
| S7 | Low | 6 reference endpoints public by design (country, language, timezone, plan, costing-method, health) | — | Acceptable |
| P1 | Medium | Missing indexes (§6) | — | Index before volume |
| P2 | Low | Each page re-fetches tenant, company, language, currency, timezone, country and NOB lists, and many lists twice (partly React dev double-mount) | web layout and panels | Cache these lists per session |

**Verified sound:** JWT secret mandatory in production (`config/jwt.config.ts`); bcrypt with constant-time dummy hash; lockout after 5 failures; 15-minute access tokens; `.env` not committed; `forbidNonWhitelisted` validation; tenant code regex-validated before `CREATE DATABASE`; upload size and MIME limits; farm isolation on animal, batch, GRN and tag lookup (farm-bound user got 404/403 on another farm's records and on an explicit other-farm header).

## 10. Recommendations by priority

**Critical**
1. Fix S1/C1 (FA conversion scope) before any multi-farm or multi-company use.
2. Agree with Rishi and Triple C what "production" covers. Sections 9 and 14 (and most of 16) are not built; the BBP's sign-off "outstanding items register" must list them, or go-live cannot be honestly claimed.

**High**
3. Gate tenant signup and add rate limiting (S2, S3).
4. Prove the write paths on an isolated database: start a second MySQL on another port, `pnpm seed:costing-test`, run `verify:costing` and the four verifiers, then a daily-entry → post → reverse, a GRN with QC, a requisition through approval and an expense voucher, reading MySQL after each.
5. Resolve C2 (batch carrying value vs ledger).
6. Record or reverse the dropped TDD fields (A1: ear tag, serial no., landing cost) in `docs/decisions.md`.

**Medium**
7. Fix the migration orphan and duplicate numbers (C3).
8. Make `RolesGuard` fail closed (S5); hide Swagger in production (S4); move tokens out of `localStorage` and add CSP and helmet (S6).
9. Add indexes for the growing tables (P1).
10. Fix C4; return 400 for missing parameters (C5).
11. Build the reports in priority order with the client (R07 done; the other 18 next).

**Low**
12. Bring web lint back to baseline; fix `seed-ai-station-fixture.ts` types; settle the 4 failing specs (C6, C7).
13. Update AGENTS.md §8: the feed `varchar(36)` defect and D1 look fixed. Archive the 2 Sep status documents.
14. Use decimal arithmetic for report totals; cache shared reference lists in the web app.

## Appendix: evidence files

Raw outputs are in the session scratchpad (`audit/`): `api-jest.txt`, `web-lint.txt`, `smoke.json` (155 GETs × 2 scopes), `perms.json` (652 routes and their permission decorators), `recon.txt` (bio-asset reconciliation), `tdd-rows.txt` (the 142 TDD rows), `bbp.txt` (BBP text).
