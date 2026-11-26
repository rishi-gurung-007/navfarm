# Verification — review fixes of 26 Nov 2026 (transfer authorization, semen costing, QC decoupling, semen requests)

**Scope.** The eight findings of the 26 Nov review, and the company boundary added to semen requests:

| # | Fix | Where |
|---|-----|-------|
| 1 | A Direct Transfer's receipt is authorized on the source farm, as the shipment and the whole post are (`receiveShipment('from')`). A staged receipt stays the destination farm's (`postReceipt` → `'to'`). | `stock-transfer.service.ts` |
| 2, 3 | Mating dose issue and semen write-off cost from the lot's own receipt layers through `costFromLot`, across as many layers as it takes. `lotCostLayers` uses the lot's layers first even when they hold only part of the quantity. | `semen-lot.service.ts`, `semen-disposal.service.ts`, `lot-balance.ts` |
| 4 | The QC service no longer imports piggery or writes `semen_batch` / the semen QR. Sources register a handler (`QcSourceHandlers`); the semen one is `SemenQcSource` in the breeding module. | `qc-source-handlers.ts`, `semen-qc-source.ts` |
| 5 | `sources()` uses the shared scope helpers (company and line of business; the farm is left out on purpose). | `semen-request.service.ts` |
| 6 | Owed doses leave out cancelled, rejected and deleted requests (`owedDoses`); allocation skips a cancelled or unapproved request. | `semen-request.rules.ts` |
| 7 | A lot with no breeding line matches no request (`lineMismatch`). | `semen-request.rules.ts` |
| 8 | `farmOfLocationLookup` caches farm lookups for one call; `lines()` also caches place names. | `farm-scope.ts` |
| + | Semen request `lines()` and `allocate()` stay inside the caller's company (before: the whole tenant). | `semen-request.service.ts` |

**Method.** The watch-mode API on :2877, checked to be running this code (`dist/main.js` contains `receiveShipment('from'`, `farmOfLocationLookup`, `SemenQcSource`, `owedDoses`). Logged in through `POST /api/v1/auth/login` with seed users: `mul100.entry@triplec.local` (STANDARD_USER bound to MUL100, OPERATOR role) and `tenant.admin@triplec.local`. No password was changed and no user was created. Before writing: `mysqldump` of `nf_devco` and `nf_system`, `CHECKSUM TABLE` of all 191 tables in each, and the binlog position. Every write was read back in MySQL.

## Results

### #1 — a farm-scoped user posts a Direct Transfer to another farm

`mul100.entry` (active farm MUL100) created TR-000009, MUL100/STORE-001 → POR100/STORE-001, 2 doses of semen LOT-00054. Then posted two 1-dose Direct Transfers.

| Call | Response | MySQL |
|------|----------|-------|
| `POST /stock-transfer` | 201, DRAFT | `stock_transfer.created_by` = mul100.entry |
| `POST /stock-transfer/:id/direct-transfer` (1) | 201, PARTIALLY_RECEIVED | SH-2026-0005 and RC-2026-0003, both `created_by` mul100.entry; shipment ledger −1 at 54.928 (LOT-00054's own rate); receipt held by QC-000017 (TRANSFER_EVENT, POR100 store) |
| `POST /stock-transfer/:id/direct-transfer` (2) | 201, POSTED | SH-2026-0006, RC-2026-0004, QC-000018 |

Before the fix this call threw 403 ("Destination location is not on your active farm") and rolled the shipment back. The new spec `post-direct-transfer-sync.spec.ts` fails against the old code and passes against the new one. A staged receipt posted by the source farm is still refused (same spec).

### QC completion through the refactored service

The tenant admin completed QC-000017 and QC-000018 (`POST /qc-inspection/:id/complete`, reading 345 inside 21–432, accepted 1 each): 201, CLOSED, PASS. Two TRANSFER_RECEIPT layers of LOT-00054 landed at POR100/STORE-001 (entries 279 and 280), 1 dose each at 54.928, with journals JE-000936/937. This path runs `settleSource` → `QcSourceHandlers` (TRANSFER_EVENT has no handler, so nothing else is written).

### #3 — the write-off is costed from the lot's own layers

POR100/STORE-001 layers with stock, oldest first, before the write-off:

| entry | lot | remaining | rate |
|------:|-----|---------:|-----:|
| 259 | LOT-00059 | 1 | 0.000000 |
| 262 | LOT-00057 | 3 | 11.983675 |
| 266 | LOT-00063 | 1 | 0.000000 |
| 273 | LOT-00066 | 12 | 0.000000 |
| 275 | LOT-00056 | 30 | 0.000000 |
| 279 | LOT-00054 | 1 | 54.928000 |
| 280 | LOT-00054 | 1 | 54.928000 |

`POST /piggery/semen-disposal/<LOT-00054>` (2 doses, DAMAGED, POR100 store) → 201, SD-000005.

- Ledger: VARIANCE_NEGATIVE −2 at **54.928**, amount **−109.856**.
- `inventory_application`: entry 279 → 1 at 54.928, entry 280 → 1 at 54.928. Entries 259/262/266 untouched.
- JE-000938 for 109.856; `semen_batch.doses_destroyed` 0 → 2; `semen_dose_disposal.farm_id` = POR100 (taken from the farm `stock()` already resolved).

The old code needed one layer that held both doses. With none, it fell back to the oldest layers in the store: 1 of LOT-00059 at 0 and 1 of LOT-00057 at 11.98, about **11.98** for LOT-00054's two doses.

### #5, #8 and the company boundary (read-only)

| Call | Result | MySQL |
|------|--------|-------|
| `GET /piggery/semen-requests/sources` | 200: 3 farms, 3 stores, Z-Line-Sow 5 boars | 6 active FARM/STORE rows; 5 active Z-Line boars |
| `GET /piggery/semen-requests?status=ALL` | 200: 6 lines with farm and store names | 6 semen request lines, one company |
| `GET /piggery/ai-station/dashboard` | 200 | — |
| same, unknown company header | 403 "Not authorized for this company." | — |

### #6 — allocation's owed doses (the new query runs)

`POST /piggery/semen-requests/allocate` (LOT-00054, REQ-2026-0002's line) → 201, `free_before` 10 (10 held at MUL100/STORE-001, 0 owed), REQ-2026-0002 skipped "not released yet". Nothing written but the audit row.

## Not proven live

- **#2 (mating issue).** Not driven: a mating writes breeding and sow records. It makes the same `costFromLot` ledger call that #3 proved live, and `semen-lot.service.spec.ts` checks the call.
- **#4 (the semen handler itself).** Settling a SEMEN_COLLECTION inspection needs one to finish. The only open one, QC-000013, is someone else's work, and a fresh collection's rounds fall due over the next 4 days. The API booted with the handler wired, and the QC path ran (above). `qc-source-handlers.spec.ts` covers the registry, the semen handler's writes and a guard that the QC module imports nothing from piggery.
- **#6 (a cancelled request) and #7 (a lot with no line).** Neither exists in nf_devco: every promised request is shipped, none is cancelled, and every lot has a breed. `semen-request.rules.spec.ts` covers both.
- **The company boundary on requests.** nf_devco has semen requests in one company only, so the narrowing cannot show.

## Undo

Every row written was removed. Binlog `binlog.000018` 874831–936670 held only these writes (19 tables, 12:31–12:34, users mul100.entry and tenant.admin). The undo deleted the 59 inserted rows and restored the 9 changed rows in place with UPDATE. `inventory_ledger` and `inventory_application` have insert triggers that number entries, so rows were never deleted and re-inserted. The changed rows were 5 `no_series`, LOT-00054's MUL100 layer, `inventory_entry_counter`, LOT-00054's `semen_batch` and mul100.entry's `last_login_at`. Afterwards all 191 tables of `nf_devco` and `nf_system` matched the snapshot's checksums.

The three logins made before the snapshot were also reversed: 3 `audit_log` LOGIN rows and 3 `user_session` rows deleted, and `last_login_at` restored from the binlog before-images. The restore ran only where the column still held the login's own time.

First pass of the undo: the generated SQL skipped `DEFAULT_GENERATED` columns, so 5 `no_series.updated_at` values kept the API's time. The checksums caught it and the values were restored from the snapshot.

Tests: `pnpm nx test api` 394 suites / 5,047 tests pass. App typecheck (`tsc -p tsconfig.app.json --noEmit`) shows nothing in the files changed. The 17 remaining errors are all in `src/scripts/` and were there before.
