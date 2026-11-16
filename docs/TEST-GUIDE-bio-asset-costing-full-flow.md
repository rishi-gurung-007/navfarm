# Test guide — bio-asset costing, full flow from a clean tenant

**For:** manual end-to-end testing of everything built in Phases 1–6 (plan: `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md`).
**Data:** the tenant `nf_devco` as it stands after the Phase 6 restore (9 animals, 0 profiles, 0 runs, 16 journals). Every figure marked
"expected" was observed on this data when the flow was proved (notes in `docs/VERIFICATION-2026-10-20-bio-costing-phase-*.md`).
**Seeded state (already applied to `nf_devco` on 21 Oct 2026 by `pnpm nx run api:db-seed-bio-costing-test-data -- --apply`):** GL account **1065** *Accumulated
Amortisation - Bio Assets*, and two **ACTIVE** profiles — **IMP-F** (imported female, amortisation, week 33, 36 months, residual 150 kg × 2.05 = 307.50) and **LOC-F**
(local female, fair value, week 33, rate 150 kg × 2.05) — both monthly, effective **2026-01-01**, `auto_post` off, with the five GL accounts set.
**Not seeded on purpose, because they are what you are testing:** animal assignment, costing runs, the new-animal receipt, the death. So Parts 2 and 3.1–3.2 below
are **done for you**: read them to know what was created, and use 3.3–3.4 to check it. If the seed was lost, re-run it (it is safe to repeat; the API must be up).
**Rule of the project:** a step passes only when you have *seen the row in MySQL*, not when the screen says "saved".

> **Honest limits.** The costing-profile master has **no screen yet** (API only, Part 3). Mortality is shown through the API in Part 8 because I did
> not re-verify the Batches screen path for it. Sale / cull / transfer entries are **not built**, so Part 9 tests that nothing wrong happens, not that
> the entries exist. Everything else below has a screen.

---

## Part 0 — Prepare (once)

1. **Back up first** (the flow writes journals and ledger rows):
   ```bash
   mysqldump -u root --set-gtid-purged=OFF nf_devco > ~/nf_devco-before-costing-test.sql
   ```
   Restore afterwards with: `mysql -u root -e "drop database nf_devco; create database nf_devco" && mysql -u root nf_devco < ~/nf_devco-before-costing-test.sql`
2. **Start the servers** (API 2877, web 3002 — leave the ports alone):
   ```bash
   pnpm run dev:api
   pnpm run dev:web
   ```
3. **Log in** at <http://localhost:3002> as **`tenant.admin@triplec.local` / `12345678`** (tenant admin, sees every company).
   - Tenant id `dc65eeb1-8b7e-445b-945e-6c9533ba7510`, company id `1ec219d0-1664-4166-bed4-0131663a2dd5`.
4. **Set up a shell helper** for the API steps (Parts 3, 4, 8, 9). Paste once per terminal:
   ```bash
   API=http://127.0.0.1:2877/api/v1
   TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
     -d '{"email":"tenant.admin@triplec.local","password":"12345678"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
   api() { # api METHOD PATH [JSON]
     curl -s -w '\nHTTP %{http_code}\n' -X "$1" "$API$2" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
       -H 'x-tenant-id: dc65eeb1-8b7e-445b-945e-6c9533ba7510' -H 'x-active-company-id: 1ec219d0-1664-4166-bed4-0131663a2dd5' \
       -H 'x-workspace-scope: TENANT' ${3:+-d "$3"}; }
   q() { mysql -u root nf_devco -e "$1" 2>/dev/null; }   # read-back helper
   ```
   If the login response has a different shape on your build, take `access_token` from the browser's network tab instead.
5. **Baseline read-back** (write these numbers down):
   ```bash
   q "select count(*) animals, sum(costing_profile_id is not null) with_profile from animal_register"
   q "select count(*) journals from journal_header"
   q "select count(*) profiles from bio_costing_profile; select count(*) runs from bio_costing_run"
   ```
   Expected on the seeded database: `9, 0` · `16` · **`2` profiles** · `0` runs (and `q "select count(*) from bio_costing_profile_rate"` → 1).

### The nine animals you have (all in `animal_register`)

| Animal | Entry | Sex | Born | Entered | Cost | Expected profile |
|---|---|---|---|---|---|---|
| DLNA8228 | PURCHASED_IMPORTED | F | 2023-10-10 | 2024-02-07 | 392.80 | IMP-F (starts 2024-05-28) |
| NB0552 | PURCHASED_IMPORTED | F | 2023-10-10 | 2024-02-07 | 300.00 | IMP-F — will be **skipped**: cost 300 is below the 307.50 residual |
| F-TEMP-01, FL-ZLIN-01, P25003, P26302, P2975, Q-TN70-01 | PURCHASED_LOCAL | F | 2024-05 … 2026-03 | various | 300–350 | LOC-F |
| PIG-2023-0001 | PURCHASED_LOCAL | **M** | 2023-01-31 | 2025-06-13 | 657 124.00 | **none** (no male rule) — stays unassigned |

---

## Part 1 — Look before you change anything (screens)

| Go to | Expect |
|---|---|
| `/master-data/animal` (Master Data → Animal) | 9 animals; open DLNA8228 — **Book Value / Total Amortised / Current Bio-Asset Value are read-only** (Phase 2). Try editing one: it is not offered |
| `/inventory/bio-asset-ledger` | The per-animal ledger (ACQUISITION, CONSUMPTION, …). Open DLNA8228 or P2975: P2975 shows 300.00 acquisition + capitalised feed = **397.50** |
| `/finance/bio-costing-runs` | "No active costing profile" — nothing to run yet |
| `/finance/bio-asset-reconciliation` | The roll-forward; the new "by costing profile" and "tied to the general ledger" sections say no costing run has been posted yet |
| `/finance/trial-balance` | Note 1050 / 1060 / 4020 / 5100 balances; no accumulated-amortisation account |

---

## Part 2 — Master data the profiles need — **DONE BY THE SEED** (read to verify)

The chart has **no accumulated-amortisation account**. Create one (Finance has not given the real one — this is a test account).

**Screen:** `/master-data/gl-account` → *New*.

| Field | Value |
|---|---|
| Code | `1065` |
| Name | `Accumulated Amortisation — Bio Assets` |
| Type | `ASSET` (contra-asset; it will carry credits) |

Read it back and keep the ids for Part 3:
```bash
q "select account_code, account_name, gl_account_id from gl_account_master where account_code in ('1060','5100','4020','5010','1065')"
```
Existing accounts you will use: **1060** Biological Assets — Mature (acquisition cost), **5100** Bio-Asset Amortization Expense, **4020** Fair Value Gain/Loss, **5010** Mortality Loss (write-off).

Check the amortisation switch (BIO_ASSET `amort_option` must be 1, the default):
```bash
q "select * from costing_method_config\G" | grep -i -B2 -A6 "BIO_ASSET"
```

```bash
# set once; replace the ids with what the query above printed
ACQ=<id of 1060>  EXP=<id of 5100>  FV=<id of 4020>  WO=<id of 5010>  ACC=<id of 1065>
```

---

## Part 3 — The two costing profiles (API; there is no screen yet) — 3.1/3.2 **DONE BY THE SEED**

### 3.1 IMP-F (seeded; the payload is kept so you can see what was sent) — imported female, amortisation (the client's rule: week 33, 36 months, residual 150 kg × 2.05)
```bash
api POST /bio-costing/profiles '{
  "profile_code":"IMP-F","name":"Imported female - amortisation",
  "origin":"IMPORTED","gender":"F","costing_method":"AMORTIZATION",
  "start_age_weeks":33,"useful_life_months":36,
  "residual_rule":"WEIGHT_X_PRICE","residual_weight_kg":150,"residual_price_per_kg":2.05,"residual_applies_gender":"F",
  "run_frequency":"MONTHLY","day_basis":"FREQUENCY_DAYS","tracking":"INDIVIDUAL","auto_post":false,
  "acquisition_gl_id":"'$ACQ'","accum_amort_gl_id":"'$ACC'","amort_expense_gl_id":"'$EXP'","fv_gain_loss_gl_id":"'$FV'","writeoff_gl_id":"'$WO'",
  "effective_from":"2024-01-01"}'
```
Expected: `HTTP 201`, status `DRAFT`. Read back: `q "select profile_code,status,costing_method,start_age_weeks,useful_life_months,residual_weight_kg,residual_price_per_kg,active_scope_key from bio_costing_profile"`.

### 3.2 LOC-F (seeded) — local female, fair value (week 33, rate 150 kg × 2.05)
```bash
api POST /bio-costing/profiles '{
  "profile_code":"LOC-F","name":"Local female - fair value",
  "origin":"LOCAL","gender":"F","costing_method":"FAIR_VALUE",
  "start_age_weeks":33,"useful_life_months":36,
  "run_frequency":"MONTHLY","day_basis":"FREQUENCY_DAYS","tracking":"INDIVIDUAL","auto_post":false,
  "acquisition_gl_id":"'$ACQ'","accum_amort_gl_id":"'$ACC'","amort_expense_gl_id":"'$EXP'","fv_gain_loss_gl_id":"'$FV'","writeoff_gl_id":"'$WO'",
  "effective_from":"2024-01-01"}'
# note the "profile_id" it returns -> LOCID
api POST /bio-costing/profiles/$LOCID/rates '{"effective_from":"2024-01-01","expected_weight_kg":150,"price_per_kg":2.05,"cdm_based":false}'
```

> **Skip 3.1/3.2 unless you are rebuilding.** Just fetch the ids you need: `IMPID=$(mysql -u root nf_devco -N -e "select profile_id from bio_costing_profile where profile_code='IMP-F'" 2>/dev/null)` and the same for `LOCID` / `LOC-F`.
> The refusal tests below need *new* profiles (use other codes, e.g. `TST-1`) because IMP-F/LOC-F already occupy their scopes.

### 3.3 Refusals to try before you activate (each must be a 400/409 and create nothing)

| Try | Expected message |
|---|---|
| Imported + `FAIR_VALUE` | "An imported asset cannot be costed by fair value (BBP)" |
| Local + `AMORTIZATION` | "A local breeding asset cannot be costed by amortisation (BBP)" |
| Amortisation with no `useful_life_months` | life needed |
| No `gender`/`origin`/`item_id`/`breed_id` at all | scope needed |
| Same `profile_code` again | 409 duplicate |
| Activate a fair-value profile that has no rate | "needs at least one rate" |
| Activate with a missing/unknown GL account | names the missing account |

### 3.4 Activate both
```bash
api POST /bio-costing/profiles/$IMPID/activate
api POST /bio-costing/profiles/$LOCID/activate
api GET '/bio-costing/profiles/resolve?gender=F&entry_type=PURCHASED_IMPORTED&on_date=2026-09-01'   # -> IMP-F
api GET '/bio-costing/profiles/resolve?gender=F&entry_type=PURCHASED_LOCAL&on_date=2026-09-01'      # -> LOC-F
api GET '/bio-costing/profiles/resolve?gender=M&entry_type=PURCHASED_LOCAL&on_date=2026-09-01'      # -> no profile
```
Expected: both ACTIVE; `active_scope_key` set; a second active profile for the same scope is refused (409).

---

## Part 4 — Put the animals under their profiles

### 4.1 Dry run, then real
```bash
api POST /bio-costing/assign-animals '{"dry_run":true}'    # 9 considered, 0 written
api POST /bio-costing/assign-animals '{}'                  # 8 assigned
q "select animal_code, costing_start_date, costing_profile_id is not null has_profile from animal_register order by animal_code"
```
Expected `costing_start_date` (birth + 33 weeks = 231 days): DLNA8228 / NB0552 **2024-05-28**, F-TEMP-01 2024-12-18, FL-ZLIN-01 2025-01-18, P25003 2026-06-26, P26302 2026-08-23, P2975 2026-05-06, Q-TN70-01 2026-10-18. **PIG-2023-0001 stays NULL.**

(For a tenant that already holds animals you may instead run the backfill, Part 10: it does this and also refreshes stale caches.)

### 4.2 Locking (V8)
With animals now costed by IMP-F, each of these must be **refused** ("… animal(s) are costed by this profile, so its terms are locked"), row unchanged:
```bash
api PUT /bio-costing/profiles/$IMPID '{"useful_life_months":18}'
api PUT /bio-costing/profiles/$IMPID '{"start_age_weeks":30}'
```
These must be **accepted**: rename (`{"name":"..."}`), `auto_post`, and a new price on LOC-F:
`api POST /bio-costing/profiles/$LOCID/rates '{"effective_from":"2026-11-01","expected_weight_kg":150,"price_per_kg":2.20}'`.
A change of terms is done with `POST /profiles/:id/new-version` (needs a later `effective_from`).

---

## Part 5 — Register a brand-new animal through the normal flow (optional but it is the real project flow)

Registering an animal goes: item flagged as a biological asset → goods receipt → animal created with her profile.

1. **Flag the item:** `/master-data/item` → open **LVS_SOW** → tick *Biological asset* → save. (Only `Piglets` is flagged now.)
2. **Receive her:** `/inventory/goods-receipt` → new receipt: company, warehouse `4a36baeb-7505-4bbd-ab9f-edf15d386bfe`, posting date today, line item **LVS_SOW**, quantity **1**, UoM **HEAD**, rate **500** → *Post*.
   (API equivalent: `api POST /goods-receipt '{"company_id":"…","warehouse_id":"4a36baeb-…","posting_date":"2026-10-21","lines":[{"item_id":"bbdd338e-ea54-4c6b-935b-3e8295d9e01e","quantity":1,"uom":"HEAD","rate":500}]}'` then `api POST /goods-receipt/<receipt_id>/post`.)
3. **Check:** a new `PIG-2026-000N` appears in `/master-data/animal`; `q "select animal_code, costing_profile_id is not null, costing_start_date from animal_register order by created_at desc limit 1"` → she already **has a profile and a start date** (the registration hook).
4. **Know the limit:** registration writes the animal's ledger row but **no journal** (open question D8 — the GL does not get her purchase price).

---

## Part 6 — Run the costing (the main test; screen: `/finance/bio-costing-runs`)

Periods are monthly (30-day basis). Only a **finished** period can be run, and a period **cannot be run behind a later posted one**.

### 6.1 Calculate (preview) — IMP-F, August 2026
1. Choose *Costing profile* **IMP-F** · *Any date in the period* **2026-08-15** · leave *Days enforced* empty · **Calculate**.
2. Expect run **BCR-2026-00001**, period **2026-08**, status **CALCULATED**, 2 animals, total **37.0870**: **DLNA8228 CHARGED** (30 days, book value 392.80 → 355.7130, residual 307.50) and **NB0552 SKIPPED** (`RESIDUAL_EXCEEDS_COST`: her 300.00 is below the 307.50 residual).
3. Expect the line to show days, days left, book value before, residual 307.50, charge, book value after, and the banner *"This is a preview. Nothing has been posted"*.
4. **Read back — nothing posted yet:** `q "select run_no, period_key, status from bio_costing_run"` → CALCULATED; `q "select count(*) from journal_header"` → still 16.

### 6.2 Post
1. **Post** → confirm. Expect *"Run BCR-2026-00001 posted."* and status **POSTED**.
2. Read back:
   ```bash
   q "select run_no, period_key, status from bio_costing_run"
   q "select entry_type, round(cost_amount,4) amt, run_id is not null from bio_asset_ledger where entry_type='AMORTIZATION'"
   q "select j.journal_no, j.source_document_type, l.gl_account_id, l.debit_amount, l.credit_amount from journal_header j join journal_line l on l.journal_id=j.journal_id where j.source_document_type='BIO_COSTING_RUN'"
   ```
   Expected (observed on this data): one AMORTIZATION ledger row **−37.0870** for DLNA8228 carrying the run id; journal **Dr 5100 37.0870 / Cr 1065 37.0870**. *Ledger = journal = run total*; if they differ, that is a defect.

### 6.3 Reverse and re-run
1. Open the run → **Reverse** → give a reason → expect *"Run … reversed."*, status **REVERSED**, ledger rows negated, journal reversed; the period is free again.
2. Calculate + Post August again (it gets a new run number).
3. **Order rule:** try to calculate **July 2026** after August is posted → refused (cannot run behind a later posted period).

### 6.4 September, both profiles
- IMP-F **2026-09** → Calculate → Post. Expected: DLNA8228 charge **52.8655** (book value after 321.5975); NB0552 skipped again. Total **52.8655**.
- LOC-F **2026-08** → Calculate → Post. Each local female is revalued to 150 kg × 2.05 = **307.50**; the adjustment is the difference to her book value as of the period end. Expected (run total **−32.50**, 5 charged, 1 skipped):

  | Animal | Before | Adjustment | After |
  |---|---|---|---|
  | F-TEMP-01 | 350.00 | −42.50 | 307.50 |
  | FL-ZLIN-01 | 320.00 | −12.50 | 307.50 |
  | P25003 / P26302 / P2975 | 300.00 | +7.50 each | 307.50 |
  | Q-TN70-01 | 300.00 | skipped `NOT_STARTED` (her costing starts 2026-10-18) | 300.00 |

  *(P25003, P2975, P26302 show 300.00 before, not their card value of 333.00 / 397.50 / 337.50: their feed was capitalised **after** 31 Aug, and a run values an animal as of the period end.)*
- LOC-F **2026-09** → Calculate → Post. Expected run total **−84.00**: P25003 −16.50, P26302 −18.75, P2975 −48.75 (all to 307.50); F-TEMP-01 and FL-ZLIN-01 `NO_CHANGE`; Q-TN70-01 `NOT_STARTED`. Net across the two LOC-F runs: **−116.50**.
- A fair-value run needs the animal to have started (`costing_start_date` on or before the period end); that is why Q-TN70-01 does not appear in a charge until October.

### 6.5 What you must *not* be able to do
- Post a run twice, or calculate a period that already has a live run → refused (one live run per profile per period).
- Use the batch screen's amortise / fair-value on a herd whose animals are costed by profile → refused ("costed per animal").

---

## Part 7 — Check the books agree

1. **`/finance/bio-asset-reconciliation`** (date from **2026-08-01**, to **2026-10-20**):
   - *Roll-forward by costing profile*: rows IMP-F, LOC-F, *No profile* (PIG-2023-0001's 657 124.00), *Batch-level*.
     The four lines add up to the report's closing carrying value.
   - *Costing runs tied to the general ledger*: one row per account, **Ledger = General ledger, Difference 0.00, reconciled**:
     amortisation expense 5100 (**89.9525** = 37.0870 + 52.8655), accumulated amortisation 1065 (**89.9525** before the death in Part 8), fair-value gain/loss 4020 (**−116.50**).
2. **`/finance/trial-balance`** (as of 2026-10-20): 5100 shows the run charges; 1065 shows the credit; the trial balance is balanced.
   - 5100 may also carry older **batch-level** amortisation (18.0714 here) — the reconciliation screen lists it on the *Batch-level* line, not as a variance.
3. **`/finance/journal`**: journals with source **BIO_COSTING_RUN**, one per run.
4. **`/inventory/bio-asset-ledger`**: the animal's rows now include AMORTIZATION / FAIR_VALUE_ADJMT; her book value on `/master-data/animal` = sum of her ledger rows.
5. **Break it on purpose** (proves the tie-out can fail): raise one `BIO_COSTING_RUN` journal line by 5.00 in SQL → the reconciliation screen must show **Difference 5.00 / not reconciled**; put it back.
   ```bash
   q "update journal_line l join journal_header j on j.journal_id=l.journal_id set l.debit_amount=l.debit_amount+5 where j.journal_no='<JE of the 5100 debit>' and l.debit_amount>0"
   # ... look at the screen ... then undo with -5
   ```

---

## Part 8 — A costed animal dies (exit clearing)

The BBP death entry clears the animal's accumulated amortisation. Use the animal that was charged: **DLNA8228** (batch **BATCH-000001**).

```bash
q "select animal_id from animal_register where animal_code='DLNA8228'"        # -> AID
q "select batch_id from batch_header where batch_no='BATCH-000001'"            # -> BID
api POST /batch/$BID/mortality '{"transaction_date":"2026-10-20","animal_ids":["'$AID'"]}'
```
(Screen route for the same action: *Batches → the batch → record mortality*; I proved it through the API, so use the API if the screen differs.)

Expected, observed on this data:

| Check | Expected |
|---|---|
| Ledger | **one** MORTALITY row = her derived book value after amortisation (**−340.3475**); her ledger sums to 0 |
| Register | status **DEAD**, book value 0 |
| Exit journal | source **BIO_ASSET_EXIT**: **Dr 1065 (accumulated amortisation) / Cr 1060 = 89.9525** (her whole accumulated amortisation) |
| Mortality journal | her own capitalised feed Dr 5010 / Cr 1050 (37.50 here) |
| Reconciliation screen | accumulated-amortisation row ledger = GL (she is excluded once dead); amortisation expense row unchanged |
| Refusal (not re-proved, check it) | a second mortality for the same animal should be refused (a recorded death is final) |

---

## Part 9 — Things that are deliberately *not* built (confirm nothing wrong happens)

- **Sell / cull / slaughter / transfer** an animal (`PATCH /animal/<code>/dispose`): her ledger row and gain/loss use the derived value, but **no journal is posted** (three client treatments are undecided). Confirm there is no half-posted journal.
- **PIG-2023-0001** (male, 657 124.00): shows as *No profile*; no run touches him.
- **Home-bred animals** (`BORN_ON_FARM`, `TRANSFERRED_IN`): get no profile (origin undefined, D2).
- **Costs to sell** (D5) are not deducted from fair value.

---

## Part 10 — Scheduler (due runs)

1. `/finance/bio-costing-runs` shows **"Due for costing"** — periods since each profile's effective date that have no run. Because the profiles start **2024-01-01**, a catch-up lists a long run of old periods; **a pass does at most 3**. (Real use: set the profile's effective date to the date costing should start.)
2. Press **Run due now** → the oldest due period of each profile is calculated and **waits to be posted** (a calculated run blocks its profile); only an `auto_post` profile posts and goes on, up to 3 periods a pass. Post or reverse the waiting run, press again: the next period is made. Re-pressing never duplicates a period (same period key). Tip: set `auto_post` true on a test profile to see the catch-up.
3. **The timer** is off unless you start the API with `BIO_COSTING_SCHEDULER_ENABLED=true` (and optionally `BIO_COSTING_SCHEDULER_CRON='*/2 * * * *'` to see it fire). Without the flag, nothing runs by itself.
4. A calculated-but-unposted run **blocks its profile** until posted or reversed; a profile whose period fails 3 times is skipped by the timer (the manual button ignores the cap).

---

## Part 11 — Existing tenants: the backfill script

Run **after** profiles are active, on a tenant whose animals have none.
```bash
pnpm nx run api:db-backfill-bio-costing                 # read-only plan (JSON): assign / not_assigned / refresh_cache / report_only
pnpm nx run api:db-backfill-bio-costing -- --verify     # does it in a transaction and rolls back
pnpm nx run api:db-backfill-bio-costing -- --apply      # commits
pnpm nx run api:db-backfill-bio-costing                 # again: assign 0, refresh 0  (idempotent)
```
Pass `--database=<name>` for another tenant. Expected on `nf_devco` before Part 4: assign 8 (IMP-F 2, LOC-F 6), not assigned 1 (the male), cache refresh 4, `costing_runs_made: 0`.
It never runs a period, never edits a ledger row or journal. Other read-only checks:
`pnpm nx run api:db-check-bio-asset-reconciliation`.

---

## Part 12 — Wrap-up and reset
```bash
mysql -u root -e "drop database nf_devco; create database nf_devco" && mysql -u root nf_devco < ~/nf_devco-before-costing-test.sql
```
Stop the servers by the PID that `lsof -ti :2877` / `lsof -ti :3002` prints (never `pkill`).

### Pass / fail summary
| Part | Pass means |
|---|---|
| 2–3 | account created; two profiles ACTIVE; every refusal in 3.3 fired and wrote nothing |
| 4 | 8 animals assigned with the dates above; the male unassigned; locked terms refused |
| 6 | preview writes nothing; Post writes ledger rows = journal = run total; Reverse undoes it; order rule refuses |
| 7 | tie-out rows all reconciled; trial balance balanced; the 5.00 tamper shows a difference |
| 8 | one MORTALITY row, accumulated amortisation cleared by a BIO_ASSET_EXIT journal |
| 10–11 | due list correct; re-running changes nothing |
