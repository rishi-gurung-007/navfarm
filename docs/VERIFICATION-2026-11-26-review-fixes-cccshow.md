# Verification — Arun's 26 Nov review fixes, re-driven on nf_cccshow

**What.** Arun's commit `b984d7ad` (branch `arun.singh`), merged to main as `4f4eea97`. His own run is in
`VERIFICATION-2026-11-26-review-fixes.md` (nf_devco). This is an independent run on a different tenant, `nf_cccshow`,
and it covers #4 and #6, which his run proved by tests only.

**Method.**
- Ran `pnpm nx build api` on `4f4eea97`, then started `node dist/main.js` from `apps/api`. Before testing, confirmed
  that `dist/main.js` contains `receiveShipment('from'`, `farmOfLocationLookup`, `SemenQcSource`, `owedDoses` and
  `lineMismatch`.
- Logged in as `tenant.admin@cccshow.local`. To act as one farm, sent `x-active-farm-id`: `resolveFarmScope` then gives
  the admin the same farm scope a farm-bound user has.
- Before the first write: took a `mysqldump` of `nf_cccshow` and `CHECKSUM TABLE` of all 190 tables.
- Every response was read back in MySQL.
- Static checks on the merge: `tsc -p tsconfig.app.json --noEmit` has no errors outside `src/scripts/` (those were
  there before). The 40 affected suites (698 tests) pass, and `pnpm nx test api --skip-nx-cache --maxWorkers=2` passes.

Stores used: MST1 is on farm MUL100, PST1 on farm POR100.

## Results

### #1 — a Direct Transfer to another farm, as a farm-scoped user

Active farm MUL100. TR-000035: MST1 → PST1, 10 KG Grower1, lot LOT-00081.

| Call | Response | MySQL |
|------|----------|-------|
| `POST /stock-transfer` | 201 DRAFT | — |
| `POST /stock-transfer/:id/direct-transfer` | 201 POSTED | entry 303 TRANSFER_SHIPMENT MST1 −10 @ 0.3831; entry 304 TRANSFER_RECEIPT PST1 +10 @ 0.3831 |

**Control: a staged receipt into another farm is still refused.** TR-000036, 5 KG:
- the shipment was posted as MUL100 (201);
- `POST /:id/receipt` as MUL100 got **403**: "TR-000036 goes to PST1: it is received by farm POR100. Switch the active
  farm to POR100 to receive it.";
- the same receipt as POR100 got **201**.

So the farm check is still in force, and only the Direct Transfer's own receipt is authorized on the source farm.

### #4 — semen collection QC settles through `SemenQcSource`

Set-up: switched on Semen item for ITM-0001 (`PUT /items/:id`), then logged two collections at MST1:
- lot A, LOT-00094: 6 doses, feed cost 120, so 20/dose;
- lot B, LOT-00095: 6 doses at 0.

`POST /qc-inspection/:id/complete` on each:

| Inspection | Decision | MySQL |
|------------|----------|-------|
| QC-000001 (A) | 6 accepted | `semen_batch.inventory_posted` = 1. QR pack `qc_inspection.result` "Accepted", 6 of 6. OUTPUT entry 307: 6 @ 20. |
| QC-000002 (B) | 5 accepted, 1 rejected as SCRAP | `doses_collected` 6 → 5; note "QC QC-000002: 5 of 6 doses accepted." QR pack "Partly accepted", 5 of 6, `net_weight` 5. `semen_dose_disposal` SD-000001: 1 dose, source QC, farm MUL100. OUTPUT entry 308: 5 @ 0. |

This exercises both handler hooks (`settled`, `scrapped`). The QC module no longer imports piggery code.

### #3 — a semen write-off is costed from the lot's own layers

Three Direct Transfers from MST1 to PST1, each receipt-QC completed as POR100:

| Entry | Store | Lot | Remaining | Rate |
|------:|-------|-----|----------:|-----:|
| 312 | PST1 | LOT-00095 (B) | 5 | 0 |
| 313 | PST1 | LOT-00094 (A) | 3 | 20 |
| 314 | PST1 | LOT-00094 (A) | 3 | 20 |

The semen shipments (309–311) went out at each lot's own rate: B at 0, A at 20.

Then `POST /piggery/semen-disposal/<lot A>`: 5 doses, DAMAGED, PST1, as POR100. Response 201, SD-000002, amount
**100.0000**.
- Ledger entry 315: VARIANCE_NEGATIVE −5 @ 20.
- Remaining quantities afterwards: entry 313 → 0, entry 314 → 1, entry 312 (lot B) still 5.
- `semen_dose_disposal.farm_id` = POR100. `semen_batch.doses_destroyed` = 5.

No single layer of A held 5 doses. In that case the old code fell back to the oldest layer in the store, which was B's,
so the write-off would have been costed at 0.

### #5 — semen request sources

`GET /piggery/semen-requests/sources` returned 200 with:
- farms MUL100 and POR100;
- stores MST1 and PST1;
- lines L-LINE (5 boars), TEMPO (14), Z-LINE (4).

MySQL has 2 active farms, 2 active stores, and the same boar counts per line.

### #6 — allocation skips unapproved requests; a cancelled request gives back its doses

Set-up:
- lot C, LOT-00096 (Z-LINE): 6 doses at MST1, QC passed;
- three Z-LINE semen requests from POR100, MST1 → PST1, all submitted:
  - REQ-00003 (R1, 4 doses): approved and released;
  - REQ-00004 (R2, 4 doses): approved and released;
  - REQ-00005 (R3, 2 doses): left pending approval.

Release had to be sent with no active farm: "Source location is not on your active farm" as POR100.

| `POST /piggery/semen-requests/allocate` | Result |
|------------------------------------------|--------|
| lot C → R1, R3 | `free_before` 6. R1 allocated 4. R3 skipped: "is not approved". |
| lot C → R2, with R1 live | `free_before` 2. R2 skipped: "needs 4 doses, 2 left in LOT-00096". |
| lot C → R2, after R1 set to `CANCELLED` | `free_before` 6. R2 allocated 4. |

The API has no route that cancels a requisition, so R1's `document_status`/`status` was set to CANCELLED directly in
MySQL. That simulation stands in for legacy data; it was not done through the app.

### Company boundary on requests

- `GET /piggery/semen-requests?status=ALL` returned 200: REQ-00003/4/5, each with farm POR100 and MST1 → PST1.
- The same call with an unknown `x-active-company-id` returned **403** "Not authorized for this company."

## Not proven live

- **#2, a mating's dose issue.** Not driven, because it writes sow and breeding records. It makes the same
  `costFromLot: true` ledger call that #3 proved; `semen-lot.service.spec.ts` covers it.
- **#7, a lot with no breeding line.** Every boar in nf_cccshow has a breed, so no such lot can be made.
  `semen-request.rules.spec.ts` covers it.
- **#8, farm lookup caching.** A performance change. It ran under the request list and #6 above without error.

## Undo

1. Stopped the API.
2. Restored the pre-write dump of `nf_cccshow`. The first attempt stopped on the dump's
   `SET @@GLOBAL.GTID_PURGED` line before changing anything, so that line was stripped and the restore was run again.
3. Compared checksums: **all 190 tables match the snapshot.**
4. Spot checks: 1 semen batch, ITM-0001 `is_semen` = 0, highest ledger entry 302, both inventory triggers present.

## Notes on the commit itself

- **GL Mapping DTOs.** `nob_id` and `lob_id` changed from `@IsUUID()` to `@IsString()`, because seeded ids such as
  `50000000-5000-…` are not RFC 4122 UUIDs. The change is sound, but it is outside the review and its commit message
  does not mention it.
- **`apps/web/next-env.d.ts`** now imports `.next/dev/types/routes.d.ts`. That is the dev-server path; Next.js
  rewrites the file on build.
