# Plan — AI Station: boar selection, semen collection by breeding line, and boar body condition scoring

**Date:** 2 Nov 2026 · **Asked by:** Arun · **Status:** All seven phases built and proved on `nf_devco` (2 Nov). Nothing is committed. The questions below are still the client's to answer.

## Phase 7 as built (2 Nov)

- **`pnpm nx run api:db-seed-ai-station-fixture`** (`seed-ai-station-fixture.ts`, data and planner in `ai-station-fixture.lib.ts`, tested): read-only by default, `--apply` writes, safe to repeat. It applies what the documents state and nothing else: the Tempo, L-Line and Z-Line setups (Sunday and Wednesday; L-Line 2 boars a day, `POOLL-{WEEK}`, green; Z-Line on request, never pooled, `{BOAR_TAG}-{WEEK}`, red, reference required, for the Multiplier farm, other uses blocked), the grading the sheets follow, the collectors CM, AW and TA (named by their IDs, since no names were given), and SOP 21's five-point scale. The plan it prints marks every value `[client]` or `[ours]` (the monthly schedule read as 30 days). Farms are passed in by code (`--tempo-farms`, `--multiplier-farm`), never matched by name. **Not seeded, because the documents do not give it:** genetic-level TSI bands, the Tempo label, rest days, a motility floor, collector names, any colorant stock item. It is **not applied on your dev database**: it ran, was proved to be repeatable (12 created, then 0), and was removed.
- **End to end, all three lines** (21 checks through the running API, read back from MySQL): Tempo (Tuesday refused, destination required and limited to its farms, pooled lot of 70 doses with no label, per-boar ranks and grading 1/2); L-Line (Tuesday refused, a third boar for the day refused, `POOLL-45` with the green colorant); Z-Line (no reference refused, collecting without the plan refused, `<tag>-45` with the red colorant, for the Multiplier farm, no overall grading). Three plans COLLECTED, lots with 2, 2 and 1 per-boar results. Stock posting, the colorant issue and the QR were proved with rollback in Phase 5, so this run posted none (it was done on a database someone was using, and cleaned up by tag).
- **A defect the fixture found:** a setup that named `destination_rule: 'ANY'` and no restriction was refused ("Restricting use to the destination needs a destination farm"). In the bundled API every declared DTO field arrives as an own `undefined` key, which overwrote the defaults in my merge (and, on edits, overwrote the stored values being validated). Fixed with `newSetupValues` / `editedSetupValues`, tested with that shape. It never showed in unit tests or in the earlier proofs, which never sent `destination_rule: 'ANY'`.
- **An error of mine:** a rollback that restored whole tables removed a test assessment someone had just made in the app (PIG-2024-0015, score 1, 14:31). It had been re-entered by the time it was noticed. From then on cleanup was by tag only. `AGENTS.md` §10 and `docs/decisions.md` (2 Nov) record the rule.
- **Handover:** `AGENTS.md` §10 and the 2 Nov entry in `docs/decisions.md`.

## Phase 6 as built (2 Nov)

- **Migration `0238_boar_body_condition`:** `bcs_scale` (one row per score of a line, or of the company as the default: name, indicators, required action, feed level in kg a day, flag for a health assessment, flag for a medication review, SOP reference), `boar_condition_record` (one assessment of one boar: the score, what the scale said then, the feed level set, the one before it, the override reason, the flags, when the next is due; one per boar per day) and five columns on `breeding_line_setup`.
- **The schedule and the feed override are on the line's setup**, not in a settings table of their own (like the other line rules, with the company default as fallback): score a boar every N days, N days of grace before overdue, N days of notice before due, may the feed level differ from the scale's, and does a different level need a reason. A blank frequency means no schedule: no boar is then due or overdue.
- **Scoring a boar** (`POST /piggery/boar-condition`): the score must be on his line's scale; the scale's feed level becomes his feed level, its action and flags are recorded with the assessment, and the next due date is set. A score that sets no feed level leaves it as it was. A different level is accepted only where the line allows it, and with a reason where the line asks for one. Refused: no scale at all (none is made up), a score not on the scale, a future date, a date before the boar entered or on or before his latest assessment.
- **Where each boar stands** (`GET /piggery/boar-condition`): never assessed, OK, due soon, due, overdue, or no schedule, worked from his last assessment and the line's CURRENT frequency (a change applies to every boar). Boars needing attention are listed first.
- **The selection table** has two more columns, "Condition score" and "Condition check" (both can be hidden or renamed like any other).
- **Web:** a "Boar Condition" tab (counts of overdue / due / never / due soon, the list, "Score" and "History"), a score dialog that shows each score's meaning and, for the one chosen, what it will do (feed level before and after, the action, the flags), and a Body Condition Scale master. The Breeding Line Setup form has a "Body Condition" section.
- **The feed level is recorded and shown only.** The feed forecast does not read it (question 9, still open). A health or medication flag is a flag on the latest assessment, not a task (question 10).
- **Not done:** the score on the boar's own card (`AnimalDetailsModal`; it is on the Boar Condition tab and in the selection table); editing or voiding an assessment (a mistake today can only be corrected by the next assessment); dated versions of the scale (a row is edited in place; each assessment keeps what the scale said when it was made).
- **A defect of mine, caught by running the migration:** the first draft reused the foreign key name `fk_bcr_company`, already held by `bio_costing_run`. MySQL foreign key names are unique across the database, the migration stopped halfway, and MySQL does not roll DDL back, so both tenants were left half-migrated. I removed the half-built tables (empty, mine), renamed the constraints and migrated again. A guard test (`foreign-key-names-unique.spec.ts`) now fails any migration that reuses a held name, and fails on the old name.
- Proof: 34 checks through the running API (33 first run; the one miss was my own miscount of the records), the tab and the score dialog used in the web app, read back from MySQL; everything rolled back from a baseline and every table matched its checksum afterwards.

## Phase 5 as built (2 Nov)

- **Migration `0237_semen_lot_label`:** on `semen_batch`: the line (`breed_id`), `label`, `week_no`, `week_year`, `colorant_name`, `colorant_item_id`, `colorant_qty`, `colorant_cost` and `destination_farm_id`, with an index on line + week for `{SEQ}`.
- **The label** is the line's template filled in when the lot is posted (`semen-lot-label.rules.ts`, pure, tested): `{LINE}` `{BOAR_TAG}` `{BOAR_CODE}` `{WEEK}` `{YEAR}` `{DATE}` `{SEQ}`; any other text is printed as typed, so `POOLL-{WEEK}` gives `POOLL-45` and `{BOAR_TAG}-{WEEK}` gives `<tag>-45`. The week is the ISO week as a plain number. "Add the year" appends `-2026` unless the template uses `{YEAR}`. The `{PREFIX}` token planned earlier is gone (a prefix is just text). **The stock lot number (`ITEM_LOT` series) is unchanged**; the label is what is printed on the sachets and shown in the lots list and on the QR.
- **The colorant** is recorded by name on every lot. When the setup also names a stock item and a quantity, that quantity is **issued from the boar's farm store as a consumption** and its cost is added to the lot's cost, so to every dose's (the lot's journals stayed balanced). A colorant out of stock, inactive or unknown refuses the whole collection and writes nothing. With only a name, nothing is issued and nothing is costed.
- **The destination** is the plan's, else the line's single destination farm, stored on the lot. The restriction (`restrict_to_destination`: NONE / WARN / BLOCK) is read at the **AI mating** (the sow's farm against the lot's) and when a **stock transfer** names a semen lot (the destination store's farm), on create and on edit. BLOCK refuses with both farms named; WARN lets it through and returns the warning with the response.
- **The QR** of a semen lot now carries the label, ISO week and year, colorant and destination farm. The collection's cost per dose shown to the user includes the colorant.
- **Proof, with real stock posting, rolled back afterwards:** 24 checks through the running API, among them a Z-Line collection with two boars refused, a Z-Line lot labelled with the boar tag and week, an L-Line lot reading `POOLL-45`, the colorant leaving the store (40 to 38) at a cost folded into the lot, the ledger and balanced journals read back from MySQL, and the QR read back from `qr_code_master`. A colorant item stood in for this (a vial item), since the client has not named theirs. Everything the proof wrote was rolled back from a baseline dump, table by table; every table then matched its baseline checksum (the two login tables, which only record my API login, were left alone).
- **Not done:** the restriction is not applied to other movements of doses (a sale, a disposal, a stock adjustment); no printable label document (the label is on the lot and in its QR); colorant stock is judged only at posting (no reorder or alert).

### New questions from Phase 5

13a. **The "boar tag" on the Z-Line label** (`BLXA9988`): is it the ear tag (`rfid_tag` here), the animal code, or something else? `{BOAR_TAG}` uses the tag and falls back to the animal code; `{BOAR_CODE}` is always the animal code.
14. The L-Line label `POOLL-<week>` is the same for the Sunday and the Wednesday collection of a week. Is that intended, or should the two be told apart (`{SEQ}`)? Should a single-digit week be padded (`POOLL-05`)?
15. What is the colorant: a stock item that should leave the store (and at what quantity per lot), or only a note on the lot? (Same as question 4; the build supports both.)

## Phase 4 as built (2 Nov)

- **Migration `0236_semen_collection_plan`:** `semen_collection_plan` (plan number `CP-<yyyymmdd>-<nn>`, line, date, weekday, ISO week and year, status PLANNED / COLLECTED / CANCELLED, requested by, outside reference, destination farm, notes), `semen_collection_plan_line` (one row per boar: collector, status PLANNED / COLLECTED / SKIPPED, the lot he was tapped in, and a snapshot of his TSI, level and ranks when chosen) and `semen_batch.plan_id`.
- **A plan is checked against the line's setup when made** (`collection-plan.rules.ts`, pure and tested): a scheduled line only on its weekdays (the message names them); no more boars a day than the line taps, counting the boars already in other standing plans that day; the outside reference when the line requires one, named by the label the setup gives it; a destination farm when the line restricts one (a line with a single destination fills it in); a day not already past; a boar not planned twice for the same day. "Exactly N a day" is a **warning**, not a refusal (fewer boars than the line taps). A line with no setup and no company default is not checked beyond that: no rule is made up.
- **A collection can carry out a plan** (`plan_id` on `POST .../semen-collection`): every boar tapped, whether his ejaculate was used or rejected, must be one the plan still has to collect; those boars are marked collected with the lot, in the same transaction, and the plan is COLLECTED once none is left. A collection dated other than the plan's day is allowed with a warning. A line that requires an outside reference **can only be collected against a plan** (this was not in the Phase 4 plan; it follows from the reference living on the plan).
- **Cancelling a plan or skipping a boar needs a reason.** A plan whose boars are all skipped is cancelled by itself. A cancelled plan's boars no longer count towards the day's limit.
- **Selection table:** a "Planned day" column (the boar's next standing plan, e.g. `WED 2026-11-04`), and the response carries the line's plan rules (weekdays, boars a day, reference label, destination farms, pooling, next collection date).
- **Web:** on the Boar Selection tab, tick boars, "Plan collection" (the dialog shows only what the line asks for), a "Planned collections" list with Record collection (opens the collection form pre-filled with the plan's batch, boars and date; a never-pooled line takes one boar at a time), Cancel plan and Skip.
- **Not done:** colouring boars by collection day (shown as text; the sheets' colours differ by sheet, so they would need their own setting); the rest-days rule at planning time (it is checked when the boar is collected); editing a plan (cancel and re-plan); a default collector on the boar; the destination and reference are stored on the plan but the **lot label and the restriction on using a lot outside its destination are Phase 5**.
- Proof: 36 checks through the running API (both "done when" cases: a third boar for a day is refused, and a Z-Line style plan without its reference is refused), read back from MySQL; the plan dialog, the pre-filled collection form and the cancel prompt used in the web app. All proof rows removed.

## Phase 3 as built (2 Nov)

- **The ranking is a pure function, tested against the client's own sheets.** `boar-ranking.rules.ts` reproduces all 14 Tempo rows and the L-Line rows (genetic level, dose rank, morphology rank, overall grading, overall rank) exactly. What the sheets turned out to say:
  - **Genetic rank is the herd-wide rank published with the TSI, used as given.** It has gaps (10 then 13) on a sheet that lists part of the herd, and re-ranking the 14 shown would change DA2568's grading from 8.0 to 7.0. Where no rank is published for every boar, it is worked out from TSI. (Answers question 6, as far as the sheets go.)
  - **Overall grading is a weighted average of the ranks the line uses**: the sheets' is genetic and morphology rank equally, dose rank unused. Lower is better.
  - **Ties go to the better genetic rank**, so every rank is a distinct number (the sheets do this). A line can instead let tied boars share a rank. The sheet's L-Line "overall rank" shows #N/A where this gives 1 and 2 for the 1.5 tie.
  - A boar never collected has no collection figures, ranks or grading (N/A), but keeps his TSI, level and genetic rank.
- **Migration `0235_boar_ranking`:** `genetic_level_band` (per line, TSI from/to, both inclusive, open ends allowed, overlap refused), `boar_tsi_history` (TSI over time with the published rank; `animal_register.tsi` keeps the newest), and five columns on `breeding_line_setup`: the three rank weights, `rank_tie_break` (default: the better genetic rank wins) and `selection_columns` (which columns the table shows, in order, with the heading each carries).
- **API:** `GET /piggery/boar-selection/lines`, `GET /piggery/boar-selection?breed_id=&as_of=`, `POST .../tsi`, `POST .../tsi/import` (all or nothing). The table is read as of a date: a boar's TSI then, his last accepted collection on or before it. A rejected ejaculate is never a "last collection".
- **Web:** a "Boar Selection" tab on the Breeding page (line filter, as-of date, the configured columns, Record TSI, and Import TSI by pasting rows), and two masters: Genetic Level Bands, and a "Selection Table" section on Breeding Line Setup (weights, tie rule, column layout).
- **Defects the live check found, which unit tests did not:**
  1. **`isActive=false` returned active rows.** The API's global validation turns text into booleans before a transform sees it (`Boolean('false')` is true). Fixed on the new masters with a transform that reads the raw value. **The same fault is in existing masters (the `reason` master returns 115 active rows for `isActive=false`): not touched here.**
  2. **Editing a line setup's column layout was refused** by the live API (the nested column type is lost through the derived update DTO once webpack bundles it; unit tests passed). Fixed by declaring the property on the update class itself.
  3. `semen_boar_result` (Phase 2) was missing from the seed script's composite-key list, failing `seed-operational.lib.spec`. A test run of mine in Phase 2 skipped `src/scripts` and missed it.
- **Not done:** TSI on the boar's own card (it is on the selection table), choosing boars from the table into a collection (Phase 4's plan), the Sunday/Wednesday colouring (Phase 4), and the genetic-level thresholds, rank weights and column headings themselves: all are the client's to enter. Nothing is seeded.
- Proof: 30 checks through the running API (27 first run, then the three that failed re-checked after the fixes), the table and the Record TSI dialog opened in the web app, MySQL checked; all proof rows removed and the six boars' TSI restored to what it was.

## Phase 2 as built (2 Nov)

- **`semen_boar_result`** (migration `0234_semen_boar_result`): one row per boar per collection, single-boar lots included. It is a new table; `semen_batch_boar` (pooled lots, cost shares) is unchanged. Columns: collector, raw volume (ml), doses, morphology %, motility %, concentration, accepted, reject reason.
- **`POST /piggery/breeding/semen-collection` takes `boar_results`.** The lot's doses are the accepted boars' doses added up, and its volume is their volumes added up (only when every accepted boar gave one). `doses_collected` is optional with results; if sent, it must agree. Without results the call works as before and a single-boar lot still gets a result of its own.
- **A rejected ejaculate** is a result with `accepted: false` and a reason, for a boar outside the lot's boars. It is in none of the lot's doses, boars, cost shares or pooling counts, but it **does count for the boar's rest days**, since he was tapped.
- **Per-boar motility** is judged against the line's floor (Phase 1 rules), and the collector is checked as an active collector of the boar's company.
- **The lot list** (`GET .../semen-collection`) returns each lot's `results`, with the collector's code.
- **Web:** the collection form has a "What each boar gave" step (collector, raw semen, doses, morphology, motility, concentration, and an accepted switch with a reason). The lot's doses are read-only and worked out. The old hidden lot-level Quality step is gone; the period-costs step stays hidden behind its own switch.
- **Lot-level motility and concentration** are still stored on `semen_batch` (blank when results are given). Phase 3 reads the per-boar rows.
- Collection date only, no time of day: the plan listed "date and time", but nothing reads a time yet. Say if the AI Station needs it.
- Proof: 16 API checks through the running server, covering six refusals, a lot with a rejected boar, a rejected boar's rest counting, a pooled lot (70 doses, 350.75 ml) and the legacy shape, read back from MySQL; the form was opened in the web app. The proof rows were then removed.

## Phase 1 as built (2 Nov) — differs from the data model below

- **One table holds the line rules, not six.** `breeding_line_setup` (migration `0233_breeding_line_setup`) carries collection mode and weekdays (JSON), boars per day, pooling and min/max boars per lot, colorant (name, optional item and quantity), label template, week basis, destination rule and farms (JSON), outside-reference requirement, restriction on use outside the destination, rest days, motility floor and an enforcement choice. There are no separate schedule, destination, label-template or settings tables; they can be split later if a screen needs them.
- **The company default is a row with no breed.** A boar's line is his breed; the row for that breed is read, else the default row, else nothing is checked. This replaces the planned `collection_rule_setting` table.
- **Rest and motility stop or warn as the line says** (`rule_enforcement` WARN or BLOCK). Pooling and boar-count limits always stop.
- **Enforced in the API**, in `recordSemenCollection`. The web form reads the same row (`GET /breeding-line-setup/effective`); the hardcoded 3-day rest and 70% motility are gone from `checkSemen`. A tenant with no setup row now gets **no** rest or motility check.
- **`semen_collector`** is a plain master (code, name, optional user).
- Not yet read by anything: colorant, label template, destination, restriction, outside reference, boars per day, weekdays. They are stored and validated (Phases 4 and 5 act on them).
- **Open finding:** the boars in `nf_devco` carry the breed `Z-Line-Sow`, not `Z-Line`, so a line's own setup would not reach them: they read the company default. Whether a boar's line is his breed needs the client's answer (question 13).
- Proof: 30 API checks through the running server (creates, edits, refusals, and collections that were refused, recorded, or recorded with a warning), read back from MySQL; the proof rows were then removed. The two new screens were opened in the web app.
**Sources (client, received by email from the AI Station manager session):**
- `AI Station .pdf` — the email: columns A–F to show when selecting boars to pool; the Tempo sheet; Stock / Other Stock Items; Expense Voucher (to be discussed).
- `Breeding Boars and Selection Process.pdf` — Functional Requirements Specification: Tempo, L-Line and Z-Line rules, labels, colorants, sheets.
- `21. Boar Body Condition Scoring.pdf` — SOP Doc 21, Issue 01, effective 01/04/26, prepared by Terrence D. Burekeni, approved by the General Manager. Farm scope: AI Station.

**Rule (project):** a phase is done when it has been exercised through the API and the UI and the rows read back from MySQL. A green suite is not proof. Examples in the client's sheets are **illustrative**: they go into a named seed fixture an admin can edit, never in code as defaults.

## The instruction

Everything below is **dynamic**: line rules, schedule, pooling, colorant, label format, genetic-level bands, grading formula, displayed columns, rest days, motility floor, the body condition scale and its feed levels, and the assessment frequency are master data or settings. No client figure is a constant in code. This follows the existing master-data pattern: one registry (`apps/web/src/modules/master-data/configs.ts`) and the single `/master-data/[key]` route. **Add config entries; do not add pages** for the masters.

## What the client documents say

**Lines**

| | Tempo | L-Line | Z-Line |
|---|---|---|---|
| Tapped | Sunday and Wednesday | Sunday and Wednesday | As needed, asked by the Multiplier Unit, guided by Breeding Web |
| Boars | many (14 on the sheet) | 4 active; exactly 2 per collection day | 4 active |
| Pooling | pooled into dedicated batches | pooled | never pooled; one boar per batch; sachets belong to one boar |
| Colorant | none stated | green, before packing | red, per boar, before packing |
| Label | none stated | `POOLL-<week number>` | `<boar tag>-<week number>` (`BLXA9988-<week>`) |
| Destination | Grasmere, Porta, Richlands, LionHead, Villa Franca | none stated | the Multiplier Farm only |

**Selection UI:** first filter by breeding line, then list that line's boars with their parameters. The email asks for six columns, A to F, highlighted on the Tempo sheet (our reading, to confirm): **A** Boar, **B** TSI, **C** Genetic level, **D** last raw semen (ml), **E** last doses, **F** Morphology Rank.

**Sheet columns:** Collector ID, Boar, DoB, Age, TSI, Genetic level, Genetic Rank, Last recorded raw semen (ml), Last recorded doses, Dose rank, Last recorded morphology, Morphology rank, Overall grading, Overall rank. A boar's cell is coloured for his collection day (Tempo: green Sunday, red Wednesday; L-Line: blue Sunday, green Wednesday; white means not tapped). Z-Line carries only TSI, DoB, age, last volume, last doses, morphology and the dose and morphology ranks.

**Observed from the sheets (verify with the client):**
- Overall grading = (genetic rank + morphology rank) / 2, dose rank not used. Holds on all 14 Tempo rows and all 4 L-Line rows.
- Dose rank and morphology rank: higher value is the better rank; ties go by list order.
- Genetic rank skips 11 and 12 on Tempo while the other ranks are contiguous, so it is probably taken from a wider list than the one shown.
- Genetic-level bands differ by line (TSI 97 is "Low" on Tempo, "Below average" on L-Line).
- A boar with no collection history (LA0946) shows N/A in the last-recorded columns and the ranks.

**Body condition SOP:** monthly, visual, score 1 to 5, record the inspection date, set the feed level.

| Score | Indicators | Action | Feed |
|---|---|---|---|
| 1 | very thin; hips, ribs, backbone prominent | assess health; possible medication | 4 kg/day |
| 2 | below normal; inadequate fat cover | assess health | 3.5 kg/day |
| 3 | normal/ideal | — | 3 kg/day |
| 4 | overfat | — | 2.5 kg/day |
| 5 | obese; poor balance | — | 2.3 kg/day |

## What exists today (verified in the code, 2 Nov)

- Breeds **Tempo, L-Line, Z-Line** exist in the breed master seed. A line can be read from `animal_register.breed_id`. `animal_register` already has `tsi`, `grading`, `dob`.
- `semen_batch` holds one collection: boar (primary), batch, date, `doses_collected`, `volume_ml`, `motility_pct`, `concentration_m_per_ml`, costs, `output_item_id`, `lot_no`, `qr_id`. `semen_batch_boar` lists the boars of a pooled lot with only a **cost share**.
- `POST /piggery/breeding/semen-collection` records a collection, posts the doses to the farm store as a lot (number from the `ITEM_LOT` series) with a QR, and charges costs. Pooling is "choose several boars", with no limit and no line rule.
- The web form (`breeding-panel.tsx`) offers batch → boars (code, tag, "collected N days ago") → date and doses → item. The quality and cost steps are **hidden** by `SHOW_SEMEN_QUALITY_AND_COSTS = false`.
- `breeding-rules.ts` `checkSemen` holds two hardcoded rules, a 3-day rest and a 70% motility floor, **only in the web**; the API does not enforce them.
- `batch_input_line.bcs_score` and a `BCS_SCORE` data-entry metric exist, per animal. There is no scale, no due date, no feed link.
- Feed per head is set on the breed + stage lifecycle row (BOAR_AI), not per animal.

## Gaps this plan closes

1. No breeding-line rules (schedule, pooling, colorant, label, destination).
2. **A pooled collection stores only whole-lot totals**, so "last raw semen, doses, morphology" per boar cannot be derived. **Morphology is stored nowhere.**
3. No TSI history, genetic-level bands, ranks or grading.
4. No collection plan, no Sunday/Wednesday assignment, no Z-Line request.
5. Lot labels cannot follow `POOLL-<week>` or `<boar tag>-<week>`; no colorant record; no destination.
6. Rest days and motility floor are hardcoded and web-only.
7. No body condition scale, schedule, record, feed level or health flag.

## Data model (additive; all tenant migrations)

New migration numbers are taken from the next free number at build time. One agent owns migration SQL and the journal at a time; review generated SQL completely; never edit `dist/drizzle`.

**Masters**
- `breeding_line_setup` — line (breed), collection mode (`SCHEDULED` | `ON_REQUEST`), pooling allowed, min and max boars per lot, boars per collection day, colorant required, colorant item or name and colour, quantity per lot, label template id, destination rule (`ANY` | `LIST` | `ONE`), external reference required and its label, restrict use to destination (`BLOCK` | `WARN` | `NONE`), active.
- `breeding_line_destination` — line, farm.
- `collection_schedule` — line, weekday, slot name, active.
- `label_template` — template text, tokens (prefix, line, boar tag, week, year, date, sequence), week basis, include year, digits.
- `genetic_level_band` — line, level name, TSI from, TSI to, sort, colour.
- `grading_component` — line, component (`GENETIC_RANK` | `DOSE_RANK` | `MORPHOLOGY_RANK`), weight, direction, plus a tie-break and no-history rule on the line.
- `selection_column` — line, column key, label, visible, order.
- `semen_collector` — code, user or employee, active.
- `collection_rule_setting` — minimum rest days, minimum motility %, minimum morphology % (nullable), whether a rejected ejaculate may be pooled; company row with optional per-line override.
- `bcs_scale` — applies to (animal type or stage), score, name, indicators, required action, feed kg per day, health assessment required, medication review, SOP reference, effective from, active.
- `bcs_setting` — frequency days, grace days, reminder lead days, valid range, allow feed override, reason required.

**Records**
- `boar_tsi_history` — boar, TSI, effective date, source (`MANUAL` | `IMPORT`), optional genetic rank as published.
- `animal_register` additions — default collector, AI status (`ACTIVE` | `RESTING` | `RETIRED`), current feed allowance kg/day.
- `semen_collection_plan` and `semen_collection_plan_line` — plan number, line, date, weekday, week and year, status, requested by, external reference, destination farm, notes; lines carry boar, collector, planned day, and a snapshot of ranks and grading at selection.
- Per-boar result — extend `semen_batch_boar` (or a sibling table): collector, collected at, raw volume ml, doses from this boar, morphology %, motility %, concentration, accepted or rejected with reason.
- `semen_batch` additions — line, generated label, week, year, pooled, colorant used and quantity, destination farm, plan id.
- `boar_condition_record` — boar, date, score, assessed by, feed set, previous feed, override feed and reason, health flag, next due, notes.

**Derived, not stored:** age, genetic level, last volume / doses / morphology (from the boar's latest accepted result), the three ranks, overall grading and rank, day colour, latest score and due or overdue.

## Phases

### Phase 0 — Decisions, before any migration
Put the questions below to Rishi and the client. Record each answer in `docs/decisions.md` with the date and reasoning. Phases 1 to 5 can start once questions 1 to 8 are answered; Phase 6 needs 9 to 11.

### Phase 1 — Line masters and collection rules
Migration for `breeding_line_setup`, destination, schedule, `label_template`, `semen_collector`, `collection_rule_setting`. Master-data config entries and API for each. Move the 3-day rest and 70% motility out of `checkSemen` into the settings and **enforce them in the API**, with the web reading the same values. Guard specs to satisfy: `role-permissions-coverage`, `nav-scope-consistency`, `master-data-singular-label`.
*Done when:* an admin edits a line's rules in the browser and the next collection reads the change; read back from MySQL.

### Phase 2 — Per-boar collection results
Migration for the per-boar result and the new `semen_batch` columns. The collection form takes **one result row per boar** (volume, doses, morphology, motility, concentration, collector, accepted); the lot total is the sum of accepted doses. Un-hide the quality step (remove the `SHOW_SEMEN_QUALITY_AND_COSTS` switch). Old lots have no per-boar rows and read as N/A, never zero.
*Done when:* a pooled collection of three boars posts through the API and MySQL shows three result rows whose doses add up to the lot's doses and the inventory ledger quantity.

### Phase 3 — Ranking and the boar table
`boar_tsi_history`, `genetic_level_band`, `grading_component`, `selection_column`. A selection endpoint (line in, boars out) returns the configured columns with ranks, grading, overall rank and day colour computed by pure functions with their own tests (ties, N/A boars, weights, direction). The web gets the line filter and the table. TSI entry on the boar card and a bulk import for the Breeding Web figures.
*Done when:* the Tempo and L-Line sheets are loaded as a fixture and the screen reproduces their ranks and overall grading row for row.

### Phase 4 — Collection plan and schedule
Plan header and lines. Sunday/Wednesday assignment from `collection_schedule`, the per-day boar limit, and the Z-Line request (requester, destination, external reference). The selection table writes a plan; a plan becomes a collection.
*Done when:* an L-Line plan with a third boar for the same day is refused by the API, and a Z-Line plan cannot be saved without its reference.

### Phase 5 — Line rules at collection
At posting: pooling allowed or not and boar count limits; colorant recorded (and issued from stock if question 4 says so); the label from the template (week, year, boar tag) printed on the lot and its QR; destination stored and the restricted-use rule applied when the doses are issued or transferred.
*Done when:* a Z-Line collection with two boars is refused; a Z-Line lot is labelled with the boar tag and week; an L-Line lot reads `POOLL-<week>`; each read back from MySQL and from the QR.

### Phase 6 — Boar body condition scoring
`bcs_scale`, `bcs_setting`, `boar_condition_record`. Recording a score copies the scale's feed level, raises the health flag for a scale row that requires it, and sets the next due date. A "due / overdue" list for the AI Station manager. Latest score and date on the boar card. Show the latest score on the selection table only if the client wants it.
**Gate:** per-boar feed allowance changing the feed **forecast** touches the forecast engine and is a separate decision (question 9). Until it is made, the allowance is recorded and shown but not read by the forecast.
*Done when:* a score of 2 recorded through the API leaves a record with the scale's feed level, a health flag and a next due date, read back from MySQL.

### Phase 7 — Fixtures, proof and handover
Named seed fixtures (never defaults): the three lines, the Sunday/Wednesday schedule, the Tempo and L-Line sheets' boars, the label formats, the five-row scale. Exercise every line end to end in the browser; check lot, ledger, QR and per-boar rows in MySQL. Update `AGENTS.md` and `docs/decisions.md`.

## Not in this plan
- **Stock / Other Stock Items** (farm-level feed issue and costing mapping; bolts, welding rods) and the **Expense Voucher mapping**: the email says the voucher needs a 10-minute call first. Plan separately after that call; the existing requisition, store release and farm-store issue paths may already cover part of it.
- A **live Breeding Web integration** and its insemination matrix (warnings against a boar on a given sow). Phase 4 records the recommendation as a reference only.
- Mobile app screens (Flutter), on request only.

## Questions for Triple C (do not answer these ourselves)

1. Are columns A–F as read above: Boar, TSI, Genetic level, last raw semen, last doses, Morphology Rank?
2. Tempo: pooled-batch label format, and any colorant?
3. TSI thresholds for each genetic level, per line. Are they per line?
4. Colorant: a stock item to issue and cost, or a note on the lot?
5. Grading: confirm (genetic rank + morphology rank) / 2 with dose rank excluded; the tie-break; and how a boar with no history ranks.
6. Genetic rank: taken from the wider herd or from the listed boars? Is TSI typed or imported from Breeding Web?
7. Collector ID: the boar's assigned technician, or whoever collected that day?
8. Week number: ISO, and is the year in the label? L-Line: does it have a destination farm? Z-Line: must use outside the Multiplier Farm be blocked or only warned?
9. Should a boar's feed level from his score drive the feed forecast for the AI Station batch, replacing the breed + stage figure?
10. Does the 1–5 scale's "possible medication requirement" (score 1) create a health task, or only a flag?
11. Is the SOP's monthly cadence per calendar month or every 30 days, and who may override the feed level?
12. Does the station count doses per boar before pooling, or only the lot's total? (Phase 2 assumes per boar, as the sheets imply.)
13. Is a boar's breeding line his breed (Tempo, L-Line, Z-Line), or something else? The AI Station boars in the dev data carry the breed `Z-Line-Sow`. If the line is not the breed, it needs a field of its own on the boar.
