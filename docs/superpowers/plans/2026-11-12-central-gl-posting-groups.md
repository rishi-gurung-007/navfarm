# Plan — every GL account comes from the central GL Mapping, keyed by a GL Posting Group

**Date:** 12 Nov 2026 · **Asked by:** Arun · **Status:** design for approval; nothing built.
**Sources:** the code as of `43a1077a` (`gl-posting.service.ts`, `gl-mapping-fields.ts`, `bio-costing-*`, `herd-account.ts`); `docs/decisions.md` 28 Oct (costing terms and five GL accounts move onto the Item) and 11 Nov (a piglet lot is carried in one account); `Final TDD_V1.csv` Item Card customization block and row 8.
**Reverses:** Arun's 28 Oct choice that the Item carries its own GL accounts (decisions.md, "Costing terms move from the costing profile onto the biological Item", default 2 of `2026-10-28-item-level-bio-costing.md`). The costing *terms* stay on the item; only the *accounts* move. Record the reversal in `docs/decisions.md` (done 12 Nov, awaiting Rishi) and get Rishi's or Finance's yes before Phase 1 is merged: the TDD Item Card lists the accounts on the item.
**Rule:** a phase is done when the flows it touches have been posted through the API and the journal lines read back from MySQL, and they name the same accounts as the Phase 0 baseline. A green suite is not evidence. No data is dropped until Phase 6.

## Why

Today an account can come from two places, and which one wins depends on the item:

| Item | Where its accounts come from today |
|---|---|
| Normal item (feed, medicine, packing) | GL Mapping only, matched on transaction type + category, NOB, LOB, stage, valuation method, entry type (most specific wins). `item_master.inventory_gl_account` and `cogs_gl_account` are stored and copied from templates but **no posting reads them**. |
| Biological item (GGP/GP/P × Imp/Loc × F/M, PIGLETS, Finisher) | The item's Bio Asset Costing tab first (`bio_acquisition_gl_id` replaces one side of the mapping in about 20 postings), the mapping as fallback. The costing run and the exit clearing read the item's accounts directly and never touch the mapping. |

Finance has to look in two places to say why a journal hit an account, and a biological item with no acquisition account falls back to the generic pre-mature / mature account without a word. The instruction is one place for every account: the GL Mapping screen.

## What "central" means here

1. **A GL Posting Group** is the "what" of a posting: a class of item that is accounted for in its own accounts. Examples: `BRD-IMP-F`, `BRD-IMP-M`, `BRD-LOC-F`, `PIGLETS`, `FINISHER`, `FEED`, `VET`, `PACKING`. It is the Business Central pattern (Inventory / General Product Posting Group), which Finance already knows.
2. **Every item names one posting group.** It is required for a biological item and for a stocked item.
3. **The GL Mapping gains a `posting_group_id` dimension.** Matching stays most-specific-wins, and a blank posting group is a wildcard, as with the other dimensions.
4. **Every posting passes its posting group.** That includes the batch and animal postings, which today pass only NOB, LOB and stage.
5. **No item-level override is left.** `debitAccountId`, `creditAccountId` and `debitSplit` with item accounts go, and so does the `replaced` notion in `gl-mapping-fields.ts`. A posting with no mapping row is refused, as an inventory posting is today.

### One asset account per posting group

The item's single `bio_acquisition_gl_id` guaranteed that a sow's purchase, capitalised feed, litter, death, sale and amortisation clearing all moved **one** account. In a mapping that account is repeated across about twelve rows (the debit of BIO_ACQUISITION, the credit of BIO_MORTALITY_*, the credit of BIO_SALE_PROCEEDS and so on). If any two of them disagree, an animal's value is split between accounts, which is the defect fixed for piglet lots on 11 Nov.

**Default:** the GL Mapping service refuses to save a row whose asset side differs from the group's other rows. The asset side of each type is already known from `gl-mapping-fields.ts` (`replaced`, which this plan turns into `assetSide`). A read-only report lists any group whose rows disagree, for rows made before the check. The alternative (an asset account held on the posting group itself) is listed under the questions.

## New mapping types

The costing run and the exit clearing post today from the item's accounts. They get their own types so the run can resolve through the mapping:

| Type | Debit | Credit | Replaces item field |
|---|---|---|---|
| `BIO_AMORT_CHARGE` | Amortisation expense | Accumulated amortisation | `bio_amort_expense_gl_id`, `bio_accum_amort_gl_id` |
| `BIO_AMORT_CLEAR` | Accumulated amortisation | The group's asset | the exit clearing (`bio-costing-exit.service.ts:65`) |
| `BIO_FV_GAIN` | The group's asset | Fair value gain | `bio_fv_gain_loss_gl_id` |
| `BIO_FV_LOSS` | Fair value loss | The group's asset | `bio_fv_loss_gl_id` (falls back to the gain account today; here, a group with no loss row is refused, or Finance points it at the gain account) |

The existing `BIO_AMORTIZATION`, `BIO_FAIR_VALUE` and `BIO_FAIR_VALUE_PREMATURE` stay for the herd postings that use them today. Whether they can be retired in favour of the new types is checked in Phase 2, not assumed.

**Found while planning:** `bio_writeoff_gl_id` is required before a run can post (`bio-costing.rules.ts`, `REQUIRED_GL`), but no posting reads it. A death posts through the BIO_MORTALITY_* mapping's debit. It goes with the other item accounts, and needs no new type.

## Phases

### 0. Baseline (read-only)
- Script `db-report-effective-gl` (read-only): for every item × transaction type, the debit and credit account each posting would use today, and where it came from (item or mapping row). This is the before picture each later phase is compared with.
- Record the decision in `docs/decisions.md` and get Rishi's or Finance's answer to the questions below.

### 1. Posting groups, additive (nothing reads them yet)
- Migration `0250`: `gl_posting_group` master (code, name, kind INVENTORY / BIOLOGICAL, tenant, company, status); `item_master.posting_group_id` (nullable for now); `gl_mapping_master.posting_group_id`, with an FK and as one of the most-specific-wins dimensions.
- `resolveMapping` accepts `postingGroupId`. No caller passes it yet.
- Script `db-build-posting-groups` (read-only / `--verify` / `--apply`, as the other `db-*` scripts):
  - a biological item: one group per distinct set of its six accounts, so items that share accounts share a group;
  - a normal item: one group per item category;
  - mapping rows for each biological group, made from its items' accounts and the new types; the existing wildcard rows stay.
  - It reports any item it cannot place (no category, no accounts) and never overwrites a group already set.
- **Proof:** on a scratch database (a second MySQL server, `DATABASE_PORT`, as AGENTS.md §9), `--apply`, then for every item × type resolve the mapping with the group passed: it gives the baseline account.

### 2. The costing run and the exit clearing read the mapping
- `bio-costing-subject.ts` resolves the group's accounts through the mapping instead of the item's columns. `bio-costing-run.service.ts:369-380` and `bio-costing-exit.service.ts:65` post from it.
- `REQUIRED_GL` becomes "the group has a mapping row for each type the method posts", and is checked when a run is calculated.
- The Bio-Asset Reconciliation report (`financial-reports.service.ts:358`, `:427`) reads the group's accounts.
- **Proof:** calculate and post one amortisation run and one fair-value run (one with a loss) on the scratch database before and after. The journal lines are identical, and the reconciliation report ties out.

### 3. Animal and herd postings pass the posting group
Each call site drops its item-account override and passes the animal's or the herd's posting group:

| File | What |
|---|---|
| `goods-receipt.service.ts:762-767` | Animals received (BIO_ACQUISITION) |
| `animal.service.ts:1999-2012`, `:2085-2095`, `:2837` | Registration, death and exit of an animal |
| `litter-cost.service.ts:134-139` | Litter birth (BIO_LITTER_BIRTH, the sow's side) |
| `semen-lot.service.ts:139-146`, `:194-204`, `:317-329` | Semen issued, collected, used on a sow |
| `fa-conversion.service.ts:174` | Cull to inventory (BIO_FA_CONVERSION) |
| `batch.service.ts` `:2308`, `:2645`, `:2799-2816`, `:3274-3285`, `:3887-3896`, `:4013`, `:4180`, `:4278-4342`, `:7805-7863` | Acquisition, feed (shared between classes), sale and disposal, consumption, output, mortality, the pre-mature asset |
| `herd-account.ts`, `batch-transfer.service.ts:777` | Where a herd's value sits; head-count transfers |

- Feed shared between animals of different classes splits by posting group, as `debitSplit` splits by account today.
- A herd with no registered animals (batch-wise: PIGLETS, Finisher) takes the posting group of the batch's item. **To check before building:** that every such batch names one item. Where it does not, the batch is refused rather than posted to a wildcard.
- The 11 Nov rule (a piglet lot is carried in one account) is kept, now as "the PIGLETS group's asset account".
- **Proof:** post receipt, registration, feed (one class and mixed classes), mortality, litter birth, semen use, sale, cull conversion and a head-count transfer through the API. Each journal names the baseline accounts.

### 4. Normal items
- A new item takes its category's posting group by default, and the user can change it. `postInventoryLedgerEntry` passes the item's group.
- `inventory_gl_account` and `cogs_gl_account` leave the Item form and the Item Template (they were never read).
- **Proof:** post a GRN, an issue, a transfer (both legs), a positive and a negative adjustment, and a standard-cost receipt with a price variance. Each journal names the baseline accounts.

### 5. Screens
- **Item form:** a Posting Group field. The Bio Asset Costing tab keeps the costing terms, and its six account pickers become a read-only "GL accounts (from GL Mapping)" panel resolved for the item's group, with a link to the mapping. The Item Card still shows the accounts the TDD lists, but no longer owns them.
- **GL Mapping form:** a Posting Group field on every type; the new types; the "replaced by the animal's own account" hints go; a warning where a group's asset side disagrees.
- **Posting Group master** under Finance, permissioned as GL Mapping (MASTER_DATA / GL_MAPPING).
- **Proof:** in the browser, change a group's amortisation expense account on the mapping screen, run a period, and read the new account in `journal_line`.

### 6. Drop and tidy (separate migration, after a backup)
- The migration refuses to run while any biological item has no posting group, or any biological group lacks a row for a type its method posts.
- Drop `item_master.bio_acquisition_gl_id`, `bio_accum_amort_gl_id`, `bio_amort_expense_gl_id`, `bio_fv_gain_loss_gl_id`, `bio_fv_loss_gl_id`, `bio_writeoff_gl_id`, `inventory_gl_account`, `cogs_gl_account`, and the template's two columns. Make `item_master.posting_group_id` required for stocked and biological items.
- Seeds and scripts move to groups: the starter seed (`starter-master-data.seed-data.ts`), `seed-litter-birth-gl.ts`, `db-apply-sheet-accounts`, `fixed-asset-items.lib.ts`, `project-coa.lib.ts` / `seed:project`, `verify:project`, `seed:costing-test`, `copy-master-templates.ts`.
- **Proof:** `seed:costing-test` and `verify:project` pass, then the Phase 3 and 4 flows are posted once more on a freshly seeded database.

## Not done by this plan
- No account codes are chosen. The groups' accounts are the ones the items carry today, and the client's chart is still `NAVFarm_Dummy_COA.xlsx` until Finance gives the real one.
- Business Central is not connected, and posting groups are not synced to it.
- The open items of 28 Oct are unchanged: PIGLETS and Finisher are not run, and sale / cull / slaughter treatments and D5 / D8 / D11 are open.

## Defaults to confirm (Arun)
1. A new **Posting Group master**, not item category. Animal classes do not map one-to-one to categories, and one class can need its own accounts within a category.
2. Posting groups are **company-wide**. NOB, LOB and stage stay separate mapping dimensions, so a group never has to be duplicated per farm.
3. Item category stays a mapping dimension until Phase 6. Phase 6 then asks whether to convert category rows to group rows and drop it, so Finance has one "what" dimension, not two.
4. **One asset account per biological group**, enforced when a mapping row is saved.
5. **Strict:** a posting with no row is refused. No silent fallback to the generic 1050 / 1060.
6. The costing **terms** stay on the item (28 Oct is otherwise unchanged).

## Questions for Rishi / Finance
1. The TDD Item Card lists GL accounts on the Bio Asset Costing tab (row 8). Is it acceptable for the card to *show* them, read-only from the GL Mapping, rather than own them?
2. Should a group's asset account be one field on the group itself, which is simpler to enter, or be enforced across its mapping rows (the default above)?
3. Should a fair value loss always have its own account, or may a group post losses to the gain account (today's fallback)?
4. Which posting groups does Finance want for normal stock: one per category, or fewer (FEED, VET, CONSUMABLES)?

## Risk
High. Phases 2 and 3 touch every biological posting and the costing run, which were proved on 28 Oct and 11 Nov. That is why each phase compares its journals with the Phase 0 baseline, and why the old columns stay readable until Phase 6.
