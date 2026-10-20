# Central bio-asset costing — implementation plan

**Date:** 20 Oct 2026 · **Status:** plan only, no code changed · **Owner of migrations while this runs:** one agent at a time (AGENTS.md §8)

**Phase 0 done (20 Oct, read-only): see `docs/VERIFICATION-2026-10-20-bio-costing-phase-0.md`. Where this plan and that
note disagree, the note wins; the corrections it forced are listed in the box below and applied in the sections.**

**Inputs read:** `AGENTS.md`, `docs/COSTING-DISCUSSION-2026-10-19.md`, the code named below, and — in Phase 0 — the client
workbook `Amortization,Fairvalue & Bio Asset.xlsx` (all four sheets, **including the *amortization & fv -formula* sheet that
the first draft of this plan called unavailable**), the *Bio Asset Structure and Respective GL Entries* workbook, and the
Bio Asset BBP. *Final TDD_V1* is still not re-opened.

> **Corrections from Phase 0** (each is in the verification note with its evidence)
> 1. Start week / life are **by gender**, not an unmapped 33/26/17: female 33 wk / 36 months / residual 307.50; male
>    26 wk / 18 months / no residual; weaners cost to week 17, fair value from week 18 (§1.1).
> 2. The formula sheet's cell evaluates to `Residual × days ÷ total`; the BBP says `(carrying − residual)`. We build the BBP
>    reading and ask (§2.4, D11). Useful life in the worked example counts **from date of birth** (§2.4, D4).
> 3. Fair-value weight is **by farm / week / stage**, not one figure; frequency days are 7 / 30 / 90 / 360 (§2.1, §2.4).
> 4. **Migration 0211 is not needed**: capitalised cost already has `animal_id` on 120 ledger rows (§2.3, §4).
> 5. The batch state **excludes** the animals' acquisition cost today, so "batch = Σ animals" must be defined, not assumed
>    (§2.3, V9). 205.50 of capitalised cost is in the ledger but not in the GL (§1.3).
> 6. `postBatchCostEntry` takes **no explicit accounts**; the engine needs new transaction types or a new entry point (§2.2).
> 7. Chart of accounts has **no accumulated-amortisation or impairment account** (§2.6). Item flag `is_biological_costing_method`
>    is NULL everywhere, so it cannot gate anything yet (§2.1).
> 8. New defect: amortisation can be dated **before** maturity (JE-000014, 12 Aug vs matured 19 Oct) (§3, X2).
> 9. The BBP specifies Business Central posting by API (FA G/L Journal). BC is not connected: keep a separate integration
>    status, post nothing fake (AGENTS.md §8).

**Labelling.** Everything marked **[ours]** is our default, not a client requirement, and is **awaiting the client**.
Everything marked **[inference]** is reasoning from the code and the figures we were given, not from a document.

---

## 1. What the client has said, and what we have built

### 1.1 The client's rules (read from the workbook and BBP in Phase 0)

| Group | Method | Start (weeks of age) | Useful life | Residual |
|---|---|---|---|---|
| GGP / GP / Parent **Imported Female** | Amortisation | 33 | 36 months | 150 kg × 2.05 = 307.50 |
| GGP / GP / Parent **Imported Male** | Amortisation | 26 | 18 months | none |
| GGP / GP / Parent **Local Female** | Fair value | 33 | 36 months | none stated |
| GGP / GP / Parent **Local Male** | Fair value | 26 | 18 months | none stated |
| Piglets / weaners / growers (batch, current asset) | Fair value | cost to week 17, fair value from week 18 | — | — |

Setup is **per item** (ten breeding items plus Piglets), each with its own GL names. Costs (feed, vet, medicine) are
capitalised into the acquisition cost up to the start week. The 150 and 2.05 are the client's working formula
("assumed weight × 2.05"); 2.05 is a price per kg, its currency unstated. The formula tab of the workbook swaps male and
female (B1 in the verification note); the plan follows the FIXED ASSET tab, the GL tab and the BBP, which agree.
Final TDD_V1 has still not been re-opened.

"Fixed assets" in the client's documents means **breeding animals booked as fixed assets**. The 19 Oct discussion
(`COSTING-DISCUSSION-2026-10-19.md` §3 decision 1) used the word for sheds, mills and vehicles. This plan covers animals
only. A register and depreciation for buildings and vehicles is a separate piece of work and is **not planned here**; the
client should confirm which meaning they intend (open decision D9).

### 1.2 Today's code (read from source; the database facts are in the Phase 0 note)

| Area | State | Where |
|---|---|---|
| Batch bio-asset lifecycle | `matureBioAsset`, `amortizeBioAsset`, `recordFairValue`, `disposeBioAsset` | `apps/api/src/modules/production/batch/batch.service.ts` ~5785–6049 |
| Amortisation | Manual, per batch, one run per calendar month; rate `(NCA − residual×qty) ÷ life ÷ qty` fixed at maturity | `amortizeBioAsset` |
| Per-animal value | `animal_register.book_value / total_amortised / amortisation_monthly / residual_value` are **plain columns**, set once at registration (`animal.service.ts:746`), editable by DTO (`animal.service.ts:989–992`) | `schema.ts:4126–4130` |
| Ledger | `bio_asset_ledger` has an `animal_id` column; registration writes an `ACQUISITION` row per animal (`animal.service.ts:771`); dispose writes `−book_value` | `schema.ts:3984` |
| Flags with no reader | `costing_method_config.amort_option / fair_value_option / bio_asset_support`, `item_master.is_biological_costing_method`, `company_fiscal.depreciation_method` | `schema.ts:720–728, 971, 109` |
| Scheduler | One `@Cron`: `feed-scheduler` (every 5 min, off unless `FEED_SCHEDULER_ENABLED === 'true'`) | `feed-scheduler.service.ts:117` |
| Period guard | `assertPostingPeriodOpen` exists (`apps/api/src/common/period-close.ts`) and is used by inventory ledger, batch daily data, reports — **not** by any bio-asset path in `batch.service.ts` | |
| GL | `BIO_AMORTIZATION` → Dr 5100 / Cr **1060** (the asset itself; no accumulated-amortisation account). `BIO_FAIR_VALUE` → Dr 1060 / Cr 4020 whatever the stage | `starter-master-data.seed-data.ts:82–94` |

### 1.3 Findings from this read that the 19 Oct note does not have

These change the plan, so they are stated up front.

1. **Registering an animal posts no GL entry.** `animal.service.ts` writes the `animal_register` row and the
   `ACQUISITION` ledger row only; there is no `glPostingService` call in the file. The goods receipt put the animal into
   livestock stock; nothing moves it into the bio-asset account (`decisions.md` F5 note: ~755,786 of book value is also in
   stock and nothing takes it out). A per-animal accumulated-amortisation credit therefore has **no gross asset in the GL
   to be contra to**. This is a client/Finance decision (D8) and a hard dependency of Phase 4's GL posting.
2. **Amortisation and fair value clamp the state but not the journal.** `amortizeBioAsset` sets
   `newNca = max(0, nca − amount)` but journals and ledgers the full `amount`; `recordFairValue` does the same with
   `max(0, nca + gainLoss)`. State, ledger and GL can drift apart silently.
3. **Death can double-write.** The MORTALITY branch of `addTransactionInner` (`batch.service.ts` ~2935) writes a batch ledger row at the batch average (and `animal_id` when
   given); `AnimalService.dispose()` DIED path writes the animal's own `−book_value` as a second `animal_id` row
   (`decisions.md` ~3444, F5). Whether both land for the same death must be checked in MySQL before the ledger is trusted
   to derive a book value. **Phase 0 could not test this**: `nf_devco` has no disposed animal and its four `MORTALITY` rows
   are batch-level. Still unproven; Phase 2 proves it by killing a sow through the API.
4. **The 28 000 is also in seeds and the item catalogue** (`seed-piggery-complete-data.ts`, `seed-item-catalog.ts`).
   Those are demo data. Only `batch.service.ts:2079` is a code default; no batch in `nf_devco` reaches it today.
5. **Confirmed in MySQL (Phase 0):** no journal exists for any animal registration (659 686.80 of animals in no bio-asset
   account); the batch state for animal-wise batches holds only capitalised cost, not acquisition; 205.50 of per-animal
   capitalised cost is in the ledger and batch state but not in GL 1050 (GL 1050 nets 5.00 against 210.50 in batch state);
   an amortisation row is dated before the batch matured.
6. **`reporting_period` already has OPEN/CLOSED** with a guard. "Fiscal period open" is reuse, not new design. Note
   `company_fiscal` defaults are `FY APR MAR` and `IND AS` — Indian placeholders (AGENTS.md §3); do not derive Triple C's
   year or quarters from them without confirmation (D6).

---

## 2. Design

### 2.1 Central costing profile — `bio_costing_profile`

One row says how an animal is costed. Resolution (most specific wins; a tie at the same specificity is a configuration
error, refused on save):

1. `item_id` (a specific item), then
2. `breed_id` + `gender` + `origin`, then `breed_id` + `gender`, then `breed_id`, then
3. `origin` alone (IMPORTED / LOCAL, from `animal_register.entry_type`).

The client's setup is **per item** (GGP-Imp-F, GP-Loc-M, …), so the item rung is the one the seed uses; the group rungs
stay for a farm that wants one profile for several items.

Origin mapping **[ours]**: `PURCHASED_IMPORTED` → IMPORTED; `PURCHASED_LOCAL` → LOCAL. A home-bred gilt is Local, and its
class (GGP / GP / Parent) comes from the **mating line** in the BBP (Z+Z → GGP, Z+L → GP, Z+Tempo → Parent), which the
Breeding Lineage Master decides, not this plan. `TRANSFERRED_IN` is not named by any document (D2). Note `nf_devco` holds
`PURCHASED_LOCAL` animals with a dob and no import flag, so origin cannot be guessed from the data.

**Validation from the BBP (V10):** an IMPORTED item cannot take `FAIR_VALUE`, and a LOCAL item cannot take `AMORTIZATION`.

| Field | Notes |
|---|---|
| `profile_code`, `name`, scope columns above, `effective_from`, `status` | `active_scope_key` unique per company, as `feed_planning_setting` does |
| `costing_method` | `AMORTIZATION` \| `FAIR_VALUE`. Saved only if the `BIO_ASSET` row of `costing_method_config` has `bio_asset_support` and the matching `amort_option` / `fair_value_option` — this is what gives those flags a reader |
| `start_age_weeks` | Weeks of age at which costing begins |
| `useful_life_months` | AMORTIZATION only |
| `residual_rule` | `NONE` \| `FIXED` \| `WEIGHT_X_PRICE`; `residual_fixed_amount`; `residual_weight_kg`, `residual_price_per_kg`; `residual_applies_gender` (`F`, `M`, or null = both). The client's case is `WEIGHT_X_PRICE`, 150 × 2.05, `F` |
| `run_frequency` | `WEEKLY` \| `MONTHLY` \| `QUARTERLY` \| `YEARLY` |
| `day_basis` | `FREQUENCY_DAYS` (7 / 30 / 90 / 360, the sheet's rule, **default**) \| `ACTUAL`. The BBP request page adds a **"No. of Days Enforced"** override, so a run may state its own day count |
| `tracking` | `INDIVIDUAL` (animal / tattoo) \| `BATCH` (weaners, growers) |
| `auto_post` | scheduled runs post without a person; default **off** [ours] |
| GL | `acquisition_gl_id`, `accum_amort_gl_id`, `amort_expense_gl_id`, `fv_gain_loss_gl_id`, `writeoff_gl_id` (mortality / impairment loss) — all `gl_account_master` FKs, required for the method. The client's sheet also names per-item WIP accounts; those belong to capitalisation, not to this profile |
| `bc_posting_type` | `DEPRECIATION` \| `APPRECIATION` — carried so the later Business Central journal is the one the BBP names |
| `locked_at` | Set when the first posted run line or ledger row references the profile |

**Fair-value inputs are dated, not locked.** A price per kg moves; the amortisation terms must not. So FV inputs live in
`bio_costing_profile_rate` (`profile_id`, `effective_from`, `farm_id` nullable, `age_week_from`, `expected_weight_kg`,
`price_per_kg`, `cdm_based`, optional `costs_to_sell_pct`), and the run takes, for the animal's farm and age, the latest row
with `effective_from ≤ period end`. The sheet shows the expected weight depends on **farm, week and stage** (60 kg at week 18,
63 kg at another farm), so a single figure per profile is wrong; one row per age band is the minimum. `expected_weight_kg`
is "expected CDM weight" in the client's wording; **CDM is defined nowhere in the three files**, see D3.

**Where it lives in the UI.** Follow AGENTS.md §4: try a `configs.ts` master-data entry first. If the registry cannot
express "fields lock after use" and dated rates, fall back to a Settings page under *Inventory Setup* (the Silo Feed Setup
pattern). Decide in Phase 3 after reading `apps/web/src/modules/master-data/configs.ts`; do not add a one-off page first.

**Each animal is frozen to its profile.** Add `animal_register.costing_profile_id` and `costing_start_date`, set at first
resolution. Changing the profile for future animals never rewrites an animal already being costed.

`item_master.is_biological_costing_method`: Phase 0 found it **NULL on all 31 items**, and only one item has
`is_biological_asset = 1`. So it cannot gate anything today. **[ours]** The profile resolves the item's method; the item
column is set from the profile on save (so the item card can show it) and nothing refuses on a null.

### 2.2 Run engine — header and per-animal lines

**`bio_costing_run`** (header): `run_id`, `run_no` (company number series `BIO_COSTING_RUN`), `company_id`, `profile_id`,
`method`, `frequency`, `period_key` (`2026-10`, `2026-W42`, `2026-Q4`, `2026`), `period_start`, `period_end`,
`trigger` (`MANUAL` \| `SCHEDULED`), `status` (`CALCULATED` → `POSTED`; `FAILED`; `REVERSED`), `run_key`
(unique, scheduler idempotence, same idea as the feed scheduler's `runKey`), animal count, total charge, `journal_id`,
`requested_by`, `posted_by`, timestamps.

**`bio_costing_run_line`**: `line_id`, `run_id`, `animal_id`, `batch_id`, `days`, `book_value_before`, `charge`
(negative for a fair-value loss), `book_value_after`, `residual`, `remaining_life_months`, `status`
(`CHARGED` \| `SKIPPED`), `skip_reason`, `bio_ledger_entry_id`, `active_key`.

**Idempotence per animal and period:** unique index on `active_key = animal_id|method|period_key`, **nulled when the run
is reversed**, so a reversal frees the period and a second run for a live period fails in the database, not only in code.

**Flow.** *Calculate* reads, writes `CALCULATED` lines, posts nothing and can be repeated (it replaces its own
`CALCULATED` run). *Post*, in one transaction: re-checks the validations, writes one `bio_asset_ledger` row per charged
animal (`AMORTIZATION` or `FAIR_VALUE_ADJMT`, with `animal_id`, `batch_id` and the run id), posts the journal, updates the
batch roll-up and the `animal_register` cache (§2.3), sets `POSTED`. *Reverse*: latest run for the profile and period
only, period open, mirrored ledger rows and a reversal journal (the project's existing reversal pattern), `active_key`
nulled.

**One journal per run per dimension set** (nob, lob, stage), amount = Σ charges of those lines; each line stores the
journal id. Phase 0 read the source: `GlPostingService.postBatchCostEntry` resolves a **mapping** by transaction type and
nob/lob/stage and takes no explicit accounts. Two ways: (a) one transaction type per profile (`BIO_AMORT:<profile_code>`),
a mapping row seeded from the profile's accounts; or (b) a new `postExplicitEntry` that takes the four profile accounts
directly. **Recommendation [ours]: (b)** — the profile is the single source for the accounts, and (a) would duplicate it in
`gl_mapping_master` where it can drift. Cost: one new method beside `postBatchCostEntry`, with the same balance checks.

**Business Central.** The BBP has each charge go to BC as an FA G/L Journal (Posting Date, Main FA No., Child FA No.,
Amount, FA Posting Type, Document No.). BC is not connected (AGENTS.md §8). Each run line carries `integration_status`
(`NOT_APPLICABLE` now, `BC_PENDING` when BC is turned on) separately from the business status; no fake BC call or reference.

**Manual page:** *Finance → Bio-Asset Costing Runs* (beside the existing *Bio-Asset Reconciliation*, so the
`finance-sections` guard spec applies): profile, period, **Calculate**, review lines and skips, **Post**. New routes need
role-permission and nav entries (`role-permissions-coverage`, `nav-scope-consistency`).

**Scheduler:** `BioCostingSchedulerService` in the shape of `feed-scheduler`: `@Cron` on a daily tick, off unless
`BIO_COSTING_SCHEDULER_ENABLED === 'true'` (read at call time, as the feed one is), per active tenant under `cls.run`, a
single-flight guard, stale-run reclaim and a failed-run cap. For each profile it computes completed periods not yet run
and runs them oldest first (bounded catch-up). Default **[ours]**: it *Calculates* and raises an in-app notice; it posts
only if the profile's `auto_post` is on. Naming: keep "costing run" distinct from the existing batch/animal *schedulers*
(`apps/web/src/app/(app)/schedulers`), which are unrelated.

### 2.3 Per-animal cost and book value from the ledger

```
book_value(animal, asOf) =
    Σ cost_amount  over bio_asset_ledger rows for the animal, posting_date ≤ asOf, entry types:
      ACQUISITION           (+)
      capitalised cost      (+)   consumption / overhead capitalised while premature
      AMORTIZATION          (−)   stored negative
      FAIR_VALUE_ADJMT      (±)   stored signed
      MORTALITY / WRITEOFF / TRANSFORMATION-on-exit   (−)
accumulated_amortisation = −Σ AMORTIZATION rows
```

Exactly the formula asked for (`acquisition + capitalised − accumulated amortisation ± fair value`), with exits netting
the balance to zero.

- One `AnimalBookValueService` (single grouped query for a list, one for a card) is the only reader. The animal card, the
  batch roll-up check, disposal and mortality all call it.
- `animal_register.book_value / total_amortised / current_bio_asset_value` stay as a **cache written in the same
  transaction** as the ledger row, with a read-only check that cache = ledger. The DTO fields that let a user type them
  (`animal.dto.ts:305–323`, `animal.service.ts:989–992`) are removed. Removing the cache is a later option, not part of this plan.
- **Capitalised cost per animal: corrected in Phase 2.** Phase 0 read the 120 per-animal `CONSUMPTION` rows in `nf_devco` as
  proof the live path carries `animal_id`; they came from a seed script. The live paths wrote one batch-level row. They now write one
  row per share with the animal (and `document_line_id` to tie it to the issue), so new cost is on the animal; rows written before
  stay batch-level. Ledger-derived values differ from the cache for 4 of 9 animals, by exactly their capitalised feed (205.50 in all).
- **Ledger of record** (D1) **[ours, and the BBP agrees]**: per animal for animal-wise (`animal_tracking = 'REGISTERED'`)
  batches. The BBP's write-off is "the remaining carrying value" of the asset (Dr loss, Dr accumulated amortisation, Cr
  acquisition cost), which only an animal's own value can supply. Count-only batches have no animal to carry a value, so
  they keep the batch average and use the same profile, guards and engine at batch level.
- **What the batch figure means (settled in Phase 2).** An animal-wise batch's `nca_book_value` holds capitalised cost only
  (BATCH-000001: 113.00 beside animals worth 1 912.80 at acquisition), and so does the GL. It is **not** redefined as the sum of the
  animals' values: that would put acquisition cost in a figure the GL cannot match until D8 is built. The invariant that is checked
  (`db-check-bio-asset-reconciliation`) is: *batch figure = its ledger rows other than ACQUISITION, plus the acquisition of animals
  that have left, since their exit row carries it*; a count-only batch equals the sum of all its rows.

### 2.4 Amortisation and fair-value maths

**What the client's sheet says** (formula tab, worked example: DOB, book value 3 000, residual 307.50, start 231 days,
useful life 3 years, run frequency 30 days):

```
start_days          = start_week × 7                           (231)
life_end            = DOB + useful_life_years × 365            (DOB + 1095)
total_period_days   = life_days − start_days                   (1095 − 231 = 864)
pending_days        = age_days − start_days − days_already_run
amount (as typed)   = BV − ( BV − Residual × days / total_period_days )   →  10.677   (Excel precedence)
amount (BBP words)  = ( BV − Residual ) × days / total_period_days        →  93.49
```

The cell and the BBP disagree by a factor of nearly nine (verification note B1). **The plan builds the BBP reading and
asks the client to confirm (D11).** The engine is written so the formula is one function with the worked example as its
first test case.

**What we implement** (BBP reading; our choices marked):

```
costing_start     = dob + start_age_weeks × 7                            [sheet]  — but never before entry_date  [ours, D4]
life_end          = dob + useful_life_months                             [sheet's worked example counts from birth; D4]
residual          = rule(profile, animal): NONE → 0 | FIXED → amount | WEIGHT_X_PRICE → weight_kg × price_per_kg
                    0 if residual_applies_gender is set and ≠ animal.gender        (female 150 × 2.05 = 307.50 ; male 0)
days              = days of the run period inside [costing_start, life_end), counted by the profile's day basis
remaining_days    = days from the period start to life_end
charge            = ( book_value_before − residual ) × days / remaining_days
last period       = book_value_before − residual           (remainder, so the book value lands on residual)
SKIPPED           when book_value_before ≤ residual
```

Taking the charge on the **current** book value over the **remaining** days equals the sheet's constant daily charge when
nothing changes (`(BV − Residual) / total_period_days` per day), and absorbs a capitalised cost or a fair-value change over
what is left with no stored rate to go stale — the fix for `recordFairValue` not recomputing the rate (19 Oct decision 3).
If the sheet means "current book value over the fixed total period", the animal never reaches residual; that is one more
reason to ask (D11). Amounts are held at four decimals; the last line of a run absorbs the rounding so Σ lines = journal.

*Day basis.* Default `FREQUENCY_DAYS` as in the sheet: a weekly run counts 7 days, monthly 30, quarterly 90, yearly 360;
the denominator is real days, so the unit mixes 30/360 with a 365-day year exactly as the sheet does (a full monthly run
of the example charges `2692.50 × 30 / 864 = 93.49`). `ACTUAL` counts calendar days. A run may *enforce* a day count
(BBP "No. of Days Enforced").

*Fair value* (profile method `FAIR_VALUE`, from the start-age week; monthly):

```
fair_value        = expected_weight_kg × price_per_kg  ( × (1 − costs_to_sell_pct) if enabled )   [rate row by farm / age week]
adjustment        = fair_value − book_value_before           gain +, loss −        [BBP: "carrying value immediately before"]
batch (weaners)   = heads × expected_weight_kg × price_per_kg − batch book value     [sheet GL tab: 100 × 60 kg × 2 − 5 000 = 7 000]
```

posted to `fv_gain_loss_gl_id`; a fair-value animal is not amortised. No duplicate valuation for the same asset and date.
The sheet's `150 × 2.05 = 307.50` for a local breeding animal (CDM Based = No) is taken as given and flagged (B6 in the note).

### 2.5 Validation rules

All checks run in Calculate **and again** in Post. A skip is a line with a reason; a refusal is a 400 with nothing written.

| # | Rule | Behaviour | Enforced by |
|---|---|---|---|
| V1 | No run before the start age | animal younger than `start_age_weeks` at period end → `SKIPPED NOT_STARTED`; no `dob` and no `age_at_entry_weeks` → `SKIPPED NO_AGE` (shown, never guessed) | engine |
| V2 | None past useful life or below residual | charge capped at `book_value − residual`; thereafter `SKIPPED FULLY_AMORTISED`; nothing after `life_end_date` | engine |
| V3 | No duplicate period | refused / `SKIPPED ALREADY_RUN` | unique `active_key` + `run_key` |
| V4 | No future date | the period must have ended and `run_date ≤ today`; no partial current period **[ours]** | service |
| V5 | Fiscal period open | `assertPostingPeriodOpen` on the period end date | service (existing helper) |
| V6 | Residual ≤ cost | `residual > book_value_before` → `SKIPPED RESIDUAL_EXCEEDS_COST` | engine |
| V7 | Fair value needs inputs | profile save refuses a `FAIR_VALUE` method without a rate row; the run refuses if none is effective | service |
| V8 | Profile locked once entries exist | after `locked_at`, method, start age, life, residual, frequency, day basis and GL accounts are read-only; a change is a new profile with `effective_from` for animals not yet costing. FV rate rows stay editable | service + `locked_at` |
| V9 | Reconciliation | at Post: Σ line charges = journal amount; for animal-wise batches Σ animal book values = batch `nca_book_value` (after Phase 2 redefines it — today it excludes acquisition); afterwards Σ ledger `AMORTIZATION` = Σ credit to the accumulated-amortisation account. Mismatch aborts the transaction. A standing read-only check feeds *Bio-Asset Reconciliation* and **reports, never repairs,** the existing 205.50 ledger-not-in-GL gap | service + script |
| V10 | Method fits origin | IMPORTED item cannot take `FAIR_VALUE`; LOCAL cannot take `AMORTIZATION` (BBP) | profile save |
| V11 | Not before maturity / not before start | a manual or batch amortisation dated before `matured_at` (or an animal's costing start) is refused — JE-000014 is dated 12 Aug on a batch matured 19 Oct | service |
| V12 | Write-off ≤ carrying value | a death or disposal never writes off more than the animal's derived book value; one write-off per reference (BBP) | mortality / dispose |

### 2.6 GL

- Accounts per the profile, matching the client's GL sheet: acquisition cost, amortisation expense, **amortisation (BS
  account) = accumulated amortisation**, fair-value gain/loss, mortality/impairment loss. Amortisation becomes Dr expense /
  **Cr accumulated amortisation**, not Cr 1060.
- `nf_devco`'s chart has 1050 and 1060 only: **no accumulated-amortisation and no impairment account**. Codes are
  **Finance's to choose**; any code put in a seed is illustrative and labelled so.
- Mortality (BBP): Dr loss, Dr accumulated amortisation, Cr acquisition cost — the net equals the carrying value. Sale or
  transfer to inventory: reverse accumulated amortisation and fair-value adjustments to the transfer date. Both land in
  Phase 4 so the contra account does not accumulate for animals that have gone.
- Fair value on a PREMATURE batch posts to the pre-mature asset account (1050), not 1060: add a premature variant of the
  mapping rather than a hard-wired account.
- Existing `BIO_AMORTIZATION` / `BIO_FAIR_VALUE` mappings remain for legacy batch-level posting until Phase 4 routes the
  batch endpoints through the engine.
- **Dependency (finding 1.3-1, D8):** gross cost must reach the bio-asset account at registration for the contra account
  to make sense. The BBP now answers *what* is wanted: a purchase is Dr Acquisition Cost / Cr Vendor-Cash (BC), and a
  selected home-bred gilt is Dr Local GGP/GP/Parent Acquisition Cost / Cr Piglets Inventory. What it does not say is how
  the 659 686.80 already registered here is brought into the GL (an opening entry?) — that is D8 now. Until it is built,
  Phase 4 can post the charge but the net asset in the GL is not meaningful. The registration posting itself is its own
  piece of work (a **Phase 4b**) and is not folded into the run engine.

---

## 3. Fixes to current code

| # | Fix | Where | Depends on |
|---|---|---|---|
| X1 | Replace `heads × 28000` with a figure derived from the batch's ledger rows (animal-wise: Σ its animals' book values); if there is none, **refuse** with a message naming the missing opening value. Demo seeds that relied on it get an explicit opening value | `batch.service.ts:2079` (`ensureBioState`) | Phase 0 (which seeds hit it) |
| X2 | `amortizeBioAsset`: refuse when life elapsed since `matured_at` ≥ `productive_life_months`; **refuse a posting date before `matured_at`** (Phase 0: JE-000014 dated 12 Aug, matured 19 Oct); cap the charge at `nca − residual_value_per_unit × qty`; journal, ledger and state use the **same** capped figure | `batch.service.ts` ~5893 | none |
| X3 | `recordFairValue`: recompute `monthly_amortization_rate` over remaining life from the new carrying value; premature batch posts to 1050; journal/ledger/state use the same clamped figure; optional `costs_to_sell_pct` | ~5979 | D5 for costs to sell |
| X4 | `assertPostingPeriodOpen` on mature / amortise / fair-value / dispose / mortality dates | `batch.service.ts` bio paths | none |
| X5 | Death in a bio-asset batch writes off **one** figure: the animal's ledger-derived book value; the batch roll-up and the journal move by that same figure; the reverse endpoint mirrors it | `addTransactionInner` MORTALITY branch ~2935; `AnimalService.dispose` | Phase 2 + D1 |
| X6 | Amortisation credits the accumulated-amortisation account | GL mapping + seed | D8, Finance |

---

## 4. Migrations

Tenant migrations, next number **0208** (journal currently ends at `0207_no_series_reset_period`, idx 206). One agent owns
SQL and journal numbering; review generated SQL in full; never edit `dist/drizzle`; take a backup before applying to any
tenant (AGENTS.md §8). Additive, nullable-first, split so each phase can be proved alone.

| Migration | Content | Phase |
|---|---|---|
| 0208 | `bio_costing_profile`, `bio_costing_profile_rate`; unique `active_scope_key`; FKs to `gl_account`, `item_master`, `breed_master` | 3 |
| 0209 | `animal_register.costing_profile_id`, `costing_start_date` (nullable) | 3 |
| 0210 | `bio_costing_run`, `bio_costing_run_line` (+ `active_key` unique), `bio_asset_ledger.run_id` (nullable) | 4 |
| ~~0211~~ | **Dropped by Phase 0**: capitalised cost already has `animal_id` on the ledger. Number 0211 is free for the registration-posting work (Phase 4b) if it needs a column | — |
| data | `BIO_COSTING_RUN` number series; GL transaction types and mappings (premature FV, accumulated amortisation) — in `starter-master-data.seed-data.ts` for new tenants, and a `db-*` script for existing ones (read-only default, `--verify` rolls back, `--apply` commits, refuses a table that already holds rows) | 3–4 |
| script | `db-check-bio-asset-reconciliation` (read-only): ledger-derived value vs the cache columns vs batch roll-up, by animal | 2 |

The file `schema.ts` and `apps/api/src/drizzle/tenant/meta/_journal.json` are both touched by every migration; the
`schema-migration-drift` spec must stay green.

---

## 5. Phases, and what proves each one

Per AGENTS.md: **a phase is done when the write has been made through the API and read back from MySQL.** A green suite is
not evidence. Run against `nf_devco`, restore it afterwards (the practice in `decisions.md`), write the evidence to
`docs/VERIFICATION-2026-10-XX-bio-costing-phase-N.md`, quote the client document row in commit messages, and append the
decision to `docs/decisions.md`.

### Phase 0 — Evidence, no code — **DONE 20 Oct** (`docs/VERIFICATION-2026-10-20-bio-costing-phase-0.md`)

Outcome: client rules read (workbook incl. formula sheet, GL structure, BBP) and MySQL read. What it settled, and what it did
not: **settled** — group → start/life/residual mapping, capitalised cost per animal, no 0211, no accumulated-amortisation or
impairment account in the chart, `postBatchCostEntry` takes no explicit accounts, the 28 000 is not reached in `nf_devco`,
registration posts nothing, a pre-maturity amortisation date exists. **Not settled** — death double-write (no disposed animal
in the data → Phase 2), Final TDD_V1 (not re-opened), the formula (D11). The queries as run:

```sql
-- which entry types carry an animal_id, and do batch and animal rows double-count a death?
SELECT entry_type, animal_id IS NOT NULL AS has_animal, COUNT(*), SUM(cost_amount)
  FROM bio_asset_ledger GROUP BY entry_type, has_animal;
SELECT a.animal_id, a.book_value, SUM(l.cost_amount) AS ledger_value
  FROM animal_register a LEFT JOIN bio_asset_ledger l ON l.animal_id = a.animal_id
 GROUP BY a.animal_id, a.book_value HAVING ABS(a.book_value - COALESCE(ledger_value,0)) > 0.005;
SELECT b.batch_id, s.nca_book_value, SUM(a.book_value) FROM batch_bio_asset_state s ...   -- batch vs animals
SELECT method_code, bio_asset_support, fair_value_option, amort_option FROM costing_method_config;
SELECT is_biological_costing_method, COUNT(*) FROM item_master WHERE is_biological_asset GROUP BY 1;
```

Also run: every journal whose document is an animal code (none); `journal_line` net by bio-asset account; the 13 `BIO_*`
mappings; `gl_account_master` for accumulated/impairment accounts (none).

### Phase 1 — Safe code fixes (X1, X2, X4, and X3 without costs-to-sell) — **DONE 20 Oct, uncommitted** (`docs/VERIFICATION-2026-10-20-bio-costing-phase-1.md`)

**Proof:** (a) call `/batch/:id/amortize` on a batch past its life and on one at residual → refused, no ledger/journal
row (count rows before and after); (b) a normal run → `batch_bio_asset_state.nca_book_value`, ledger `AMORTIZATION`
row and journal amount are the **same number**; (c) fair value on a premature batch → journal debits 1050; the
stored rate equals `(new nca − residual×qty) ÷ remaining months ÷ qty`; (d) a closed `reporting_period` refuses each bio
action; (e) a Mature batch with no state and no ledger → refused, no `batch_bio_asset_state` row created.

### Phase 2 — Ledger-derived book value; one death write-off — **DONE 20 Oct, uncommitted** (`docs/VERIFICATION-2026-10-20-bio-costing-phase-2.md`)

> **Deviations from this plan, with reasons (see the note §5):** (1) the batch carrying value is **not** redefined as the sum of its animals' values — the batch and the GL hold capitalised cost only (D8), so the checked invariant is *batch figure = its non-acquisition ledger rows + the acquisition of departed animals*; (2) capitalised cost per animal was **not** already on the live ledger (only seed data had it), so the consumption/overhead writers now carry `animal_id`; (3) the mortality-reverse endpoint does not exist in this branch. The death was reproduced first: two rows, a dead animal left at +48.75, and the dead animal's feed left in the herd.

`AnimalBookValueService`; animal card and disposal read it; cache written with the ledger row; manual editing removed; the
reconciliation script; then X5.
**Proof:** register an animal (cost C) → card shows C and the cache equals it; post a manual amortisation row → card drops
and the cache follows; `PATCH` of `book_value` is refused; kill one sow in a bio-asset batch → exactly **one**
write-off figure in the journal, the animal's ledger and the batch roll-up (query all three, and `mortality/:id/reverse`
restores all three); the reconciliation script reports zero differences.

### Phase 3 — Profile master, resolution, animal assignment, lock — **DONE 20 Oct, uncommitted** (`docs/VERIFICATION-2026-10-20-bio-costing-phase-3.md`)

> **Departures, with reasons (note §4):** no `locked_at` column (a profile is in use when animals are costed by it; Phase 4 adds posted run lines); API only, the page waits for Phase 4; a fair-value profile may carry the stated useful life; a superseded profile stays in force until its successor takes effect; `item_master.is_biological_costing_method` not yet written; `bc_posting_type` omitted (follows from the method). **Seeds are DRAFT and not applied.** Home-bred animals (`BORN_ON_FARM`, `TRANSFERRED_IN`) get no profile until D2 names their origin.

Migrations 0208–0209, seed profiles from the CSV (labelled as client figures once re-read), V7/V8, flag gating.
**Proof:** create the imported-female profile → `bio_costing_profile` row correct; save a `FAIR_VALUE` profile without a
rate → 400; save an `AMORTIZATION` profile when `amort_option` is false → 400; resolve profiles for an imported female, an
imported male and a local female via the API → expected profile each; post one run line (Phase 4) then edit life months →
refused, edit FV price → accepted.

### Phase 4 — Run engine, GL, manual page, reversal

Migration 0210; Calculate / Post / Reverse; V1–V6, V9; accumulated-amortisation posting; Finance page; X3 costs-to-sell and
X6; batch endpoints become wrappers over a one-batch run.
**Proof (write through the API, read MySQL):**
1. An imported female with a known cost, `dob` and entry date: hand-compute the first charge from §2.4, `POST` a
   Calculate then Post for the month, and compare `bio_costing_run_line.charge`, the `bio_asset_ledger` `AMORTIZATION` row,
   the journal lines (Dr expense / Cr accumulated amortisation) and `AnimalBookValueService` — one number, four places.
2. The same request again → 400; `SELECT COUNT(*)` on lines/ledger/journals unchanged.
3. A male → residual 0, charge `(cost) ÷ life`; a female → floor at 307.50 (reach it by running to the last period).
4. An animal under the start age → `SKIPPED NOT_STARTED`; a period past `life_end_date` → `SKIPPED FULLY_AMORTISED`.
5. Future date → 400; closed reporting period → 400; a profile with residual above cost → `SKIPPED RESIDUAL_EXCEEDS_COST`.
6. A local animal on `FAIR_VALUE`: adjustment equals `expected_weight × price − book_value_before`; a loss posts the
   reverse direction; change the price rate row and run the next period.
7. Reverse the run → ledger and journal mirrored, `active_key` null, the period can be re-run.
8. Open the page in the browser: Calculate, read the skips, Post.

### Phase 5 — Scheduler

**Proof:** with the flag on and a profile whose period has ended, run the tick (call `tick()` as the feed scheduler's
tests do **and** observe the process once with the cron firing); a `CALCULATED` run appears with an in-app notice;
run the tick twice → one run, same `run_key`; leave the app off for two periods → catch-up creates both, oldest first;
flag off → nothing; with `auto_post` on → `POSTED` and the journal exists.

### Phase 6 — Existing tenants, reports, records

Backfill script (`--verify` rolls back): assign `costing_profile_id` to existing animals, report ledger vs cache
differences **without altering history**, never run charges for past periods unless the client asks. Roll-forward by
profile in *Bio-Asset Reconciliation*. Add decisions to `docs/decisions.md`; add a "Bio-asset costing" section to
`AGENTS.md` §8-style when it is built.
**Proof:** `--verify` output reviewed; after `--apply` on a restored copy, the reconciliation script is clean and the
roll-forward ties to the trial balance for the bio-asset accounts.

**Order and gates:** 0 (done) → 1 → 2 → 3 → 4 (4b = registration GL posting, after D8) → 5 → 6. Phase 1 can start now.
Phase 4's calculation does not wait on D8 or D11 (the formula is one function); its **posting** waits on D8 and on a Finance
account list. Phase 3 profile seeds use the table in §1.1 and are labelled as the client's.

---

## 6. Open client decisions

All defaults below are **ours, awaiting the client**.

| # | Question | Default (ours) |
|---|---|---|
| D1 | **Ledger of record:** per animal, or per batch? | Per animal for animal-wise batches; the batch is a roll-up. Count-only batches stay at batch average |
| D2 | Which animals are IMPORTED vs LOCAL — in particular `TRANSFERRED_IN`, and `PURCHASED_LOCAL` animals in `nf_devco`? The mating-line classes (Z+Z, Z+L, Z+Tempo) need the Breeding Lineage Master | Imported = `PURCHASED_IMPORTED`; everything else Local. *(The start / life / residual mapping is no longer open — §1.1.)* |
| D3 | **Residual as a per-kg rule** (the BBP, 150 × 2.05, females only) or our percentage column `residual_value_pct`? What does **CDM** mean (no file defines it)? Is the expected weight by farm / week / stage (the sheet's example says yes)? | Per-kg rule on the profile, as the BBP says; `breed_master.residual_value_pct` unused by this engine. CDM left **undefined** — the field is named "expected CDM weight" and treated as a weight in kg. Rate rows by farm and age week |
| D4 | Does useful life count from **date of birth** (the formula sheet's worked example), from the start week, or from purchase? Is an animal bought older than its start week charged for days before it was owned (the sheet's pending-days rule would)? | Life from date of birth, as the sheet; **no charge for days before the entry date** |
| D5 | Fair value less costs to sell (IAS 41)? | Optional `costs_to_sell_pct` on the rate row, off |
| D6 | Period boundaries: the sheet fixes frequency days at 7 / 30 / 90 / 360 — are quarterly/yearly runs calendar periods or 90/360-day blocks? Which fiscal year does Triple C use (the `company_fiscal` defaults are Indian)? Is a partial current period ever run? | Day count from the profile's frequency; periods are calendar for dating and open-period checks; completed periods only |
| D7 | Scheduled runs: calculate-and-notify, or post automatically? (The BBP wants alerts "amortization due; batch not run".) | Calculate and notify; `auto_post` off |
| D8 | Registration posts no GL (659 686.80 of animals in no account). The BBP wants Dr Acquisition / Cr Vendor-Cash on purchase and Dr Local Acquisition / Cr Piglets Inventory on selection. How is the existing balance brought in (opening entry)? Which accumulated-amortisation and impairment accounts? | Not built until decided; account codes Finance's |
| D11 | **The amortisation formula**: as typed it gives 10.68 for the sheet's example; the BBP's words give 93.49. Which? Is the base the original capitalised amount over the fixed total period, or the current book value over what remains? | BBP words; current book value over remaining days (equal while nothing changes) |
| D12 | The formula tab swaps male and female against the FIXED ASSET tab and the BBP. Confirm 33 wk / 36 mo / residual for **female**, 26 wk / 18 mo / none for **male**. And is a Local animal's fair value a flat 150 × 2.05 = 307.50? | As the FIXED ASSET tab and BBP; flat figure as the sheet shows |
| D9 | "Fixed assets" = breeding animals only, or also buildings/vehicles (a different build)? | Animals only |
| D10 | Reporting currency (ZWL / USD / ZiG) | Not hard-coded anywhere in this plan |

---

## 7. Not in this plan

Buildings, mills and vehicles (D9). Poultry/dairy/aqua. Changing `company_fiscal.depreciation_method` (the profile owns the
method). Removing the `animal_register` cache columns. Business Central integration. Anything that rewrites posted history.
