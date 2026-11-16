# Verification — bio-asset costing, Phase 3 (central costing profile)

**Date:** 20 Oct 2026 · **Plan:** `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md` §2.1, V7, V8, V10 · **Earlier:** Phases 0–2 in `docs/`
**Method:** migrations 0208–0209 applied with `db-migrate-all-tenants` (full backups of `nf_devco` and `nf_system` taken first); API rebuilt and
driven with the seed tenant admin through `POST /api/v1/auth/login`; every write made through the API and read back from `nf_devco`.
Afterwards `nf_devco` was restored from the pre-migration backup and migrated again, so it holds the new empty tables and none of the test
data. Nothing is committed.

## 1. What was built

| Piece | What it does | Where |
|---|---|---|
| Tables (0208) | `bio_costing_profile` (terms, scope, GL accounts, status, unique `active_scope_key`) and `bio_costing_profile_rate` (dated fair-value inputs) | `drizzle/tenant/0208_*.sql`, `schema.ts` |
| Animal columns (0209) | `animal_register.costing_profile_id`, `costing_start_date` | `0209_*.sql` |
| Rules (pure) | `validateTerms`, `validateActivation`, `resolveProfile`, `costingStartDate`, `residualFor`, `changedLockedFields`, `originOf` | `finance/bio-costing/bio-costing.rules.ts` |
| Service + API | `/api/v1/bio-costing/…`: list, one, create, update, activate, deactivate, new-version, add rate, resolve, assign-animals (dry run) | `bio-costing-profile.{service,controller,dto}.ts`, `bio-costing.module.ts` |
| Registration hook | A newly registered animal is frozen to the profile that fits her and gets her costing start date; no match is not an error, an ambiguous setup is logged and does not stop the registration | `animal.service.ts` |
| Seed | `db-seed-bio-costing-profiles`: the client's four breeding rules as **DRAFT** profiles. Read-only by default; **not applied** to any database | `scripts/seed-bio-costing-profiles*.ts` |

Permission: whoever may edit GL mappings (`MASTER_DATA / GL_MAPPING`). The controller is listed as exempt in `farm-scope-coverage.spec` with its reason.

## 2. Proof, API then MySQL

| # | Call | Result |
|---|---|---|
| 1 | `POST /bio-costing/profiles` the client's imported female: week 33, 36 months, 150 kg × 2.05, females only | row stored as DRAFT: `AMORTIZATION, 33, 36, WEIGHT_X_PRICE, 150.000, 2.050000, F, MONTHLY, FREQUENCY_DAYS` |
| 2 | Imported + fair value · local + amortisation · amortisation with no life · no scope · duplicate code | 400 "An imported asset cannot be costed by fair value (BBP)" · 400 "A local breeding asset cannot be costed by amortisation (BBP)" · 400 life needed · 400 scope needed · 409 duplicate; only the one profile exists afterwards |
| 3 | `costing_method_config` BIO_ASSET `amort_option` set to 0, then an amortisation profile | 400 "Amortisation is not enabled for biological assets (costing method BIO_ASSET)"; restored to 1. **This is the flag's first reader** |
| 4 | Activate with no GL accounts, then with three, then with a non-existent account | 400 listing the four missing accounts · 400 naming the one missing · 400 "not an active account of this company"; stays DRAFT |
| 5 | Activate with all four | ACTIVE, `active_scope_key = <company>\|-\|-\|F\|IMPORTED` |
| 6 | A second IMPORTED/F profile, activated | 409 "Another profile is already active for this scope" (the unique index, not only code) |
| 7 | Local fair-value profile, activate with no rate · add the sheet's 150 kg × 2.05 (CDM based: No) · activate · a rate on an amortisation profile | 400 "needs at least one rate" · stored · ACTIVE · 400 "Only a fair-value profile takes rates" |
| 8 | `GET /profiles/resolve` for imported F / imported M / local F / local M | IMP-F / IMP-M / LOC-F / LOC-M |
| 9 | Resolve a born-on-farm animal; resolve dated before the profiles take effect | "no profile" in both cases |
| 10 | `POST /assign-animals {dry_run:true}` then `{}` | dry run: 9 considered, 0 written; real: 9 assigned. `costing_start_date` = date of birth + start weeks for all, e.g. DLNA8228 born 2023-10-10 → 2024-05-28 (231 days). **PIG-2023-0001** (male, born 2023-01-31, bought 2025-06-13): birth + 26 weeks is 2023-08-01, but he starts **2025-06-13**, his entry date (D4, no charge for days before he was owned) |
| 11 | Lock (V8) with 2 animals on IMP-F: change life 36→18 · start age 33→30 · a GL account | each 400 "2 animal(s) are costed by this profile, so its terms are locked (…)", row unchanged |
| 12 | Same profile: rename + auto-post · re-send the identical life, 36 · add a new price (2.20 from 1 Nov) to LOC-F, which 6 animals use | all accepted; a re-sent unchanged term is not a change; rates are never locked |
| 13 | `POST /profiles/:id/new-version` effective 2027-01-01, life 24 · effective 2026-10-20 | new version ACTIVE with its predecessor linked; IMP-F becomes SUPERSEDED, keeps its 2 animals · the earlier date is refused. Resolution: 20 Oct and 31 Dec 2026 → IMP-F (36 months); 1 Jan 2027 → the new one (24). Editing or activating the superseded one is refused |
| 14 | Register a new imported sow (500.00) from a freshly posted GRN | `PIG-2026-0001` created with **`IMP-F`** assigned and `costing_start_date` 2027-01-18 (born 2026-06-01 + 231 days) |
| 15 | A breed + gender profile active beside IMP-F, resolve an imported female of that breed · of another breed · with an item-level profile added | 400 "More than one costing profile fits equally (BRD-F, IMP-F)" · IMP-F · the item profile wins |

**Fixtures and restore.** One extra GL account (`P3-ACCUM`) stood in for the accumulated-amortisation account that the chart lacks; BIO_ASSET `amort_option`
was switched off and back on; the sow item was flagged a biological asset so a receipt could register an animal; two receipts were posted (the first
posted as plain stock because the item was not yet flagged). All of it went with the restore. Read back after restore and re-migration: 209 migrations,
9 animals, none with a profile, 0 profiles, 0 rates, ledger max 158, journals 16, 5 receipts, `P3-ACCUM` gone, the sow item unflagged, `amort_option` 1,
and the Phase 1 mapping GLMAP-031 still present. Backups: `nf_devco-full-before-0208.sql`, `nf_system-full-before-0208.sql` (session scratchpad).

## 3. Tests

`pnpm nx test api`: **280 suites, 3 582 tests, all passing** (new: 24 rule cases, 11 service cases, summariser from Phase 2). The migration-drift and
route-coverage guard specs pass with the new tables and controller. **`ts-jest` does not type-check, and `api:typecheck` found five real errors in the
new service** (an unsafe cast, an untyped result list); they are fixed. After rebuilding declarations the documented way
(`rm -rf apps/api/out-tsc && npx tsc --build apps/api/tsconfig.json --emitDeclarationOnly --force`) the count is the same 23 as before, all in other
people's spec files. `web` untouched this phase.

## 4. Departures from the plan, with reasons

1. **No `locked_at` column.** "In use" is *animals costed by the profile*. Phase 4 adds posted run lines to the same test. A column that nothing sets would only drift.
2. **No profile page yet.** The API is complete and permission-gated; the Settings/master-data page waits for Phase 4, which needs the Calculate page anyway. The master-data registry (`configs.ts`) would have needed a new master controller path, so I did not pretend it was a config entry.
3. **A fair-value profile may carry a useful life.** The client's sheet and BBP list 36 / 18 months for local fair-value assets too. The fair-value run will not use it. (My first rule forbade it; the documents contradicted that.)
4. **A superseded profile stays in force until its successor takes effect** (resolution added after I saw a gap between supersede and the new date).
5. **`item_master.is_biological_costing_method` is not written from the profile.** Left for Phase 4, where an item-scoped profile first matters.
6. **`bc_posting_type` omitted**: it follows from the method (amortisation = Depreciation, fair value = Appreciation).

## 5. Open items this phase surfaced

- **Home-bred animals get no profile.** `BORN_ON_FARM` and `TRANSFERRED_IN` have no origin in any document (D2). The BBP says a selected gilt becomes a *Local* asset, classed by the mating line (Z+Z, Z+L, Z+Tempo). Until the Breeding Lineage Master or the client settles origin, those animals are registered uncosted.
- **The seed profiles cannot go live without Finance.** The chart has no accumulated-amortisation and no impairment account; the draft profiles carry no GL accounts and activation refuses them. The seed's effective date (the day it is applied) and monthly frequency are ours.
- **Weaners/growers** (cost to week 17, fair value from week 18, batch tracking) are not seeded: they need the piglet item and the Phase 4 batch engine.
- **`PURCHASED_LOCAL` animals in `nf_devco`** all resolve to the local fair-value profiles. Whether a bought local animal is the client's "Local" (fair value) rather than home-bred is D2.
- **D11 and D12** are still the client's. This phase did not need them (they affect the engine and the seeds' source rows); Phase 4 needs D11.
