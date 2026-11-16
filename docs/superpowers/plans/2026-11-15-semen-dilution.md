# Plan — AI Station: semen dilution (Semenmeter reading → doses) on the semen collection

**Date:** 15 Nov 2026 · **Asked by:** Arun · **Status:** Planned. Nothing built. Phase 0's questions are the client's to answer;
Phases 1–2 can start before the answers, because the table and the formula are read straight off the client's documents.

Builds on `2026-11-02-ai-station-semen-collection.md` (line setup, per-boar results, pooling, label, colorant, QR). Nothing
in that plan is redone here.

## Source documents (`OneDrive_1_15-11-2026.zip`, three CamScanner PDFs, images only)

1. **Semen preparation form for dilution** — the station's handwritten sheet, week 44, 25/10/2026, "Colcom t/a Triple C Pig
   Artificial insemination Station". Two batches: L-LINE (2 boars) and TEMPO (8 boars). Columns: Collector, Boar, Boar temp,
   Raw semen (ml) / Dilution, Live score, Mobility score, Semcheck reading, Semcheck conc, Doses, Final volume, Added volume.
   Once per sheet: Conductivity (260), pH (7.03), Comments.
2. **Semenmeter manual and reference table and calculations** — Schippers' MS Semenmeter Plus manual (10 steps) and two
   tables: reading → *ml for a 3 billion dose* and reading → *ml for a 3.5 billion dose*, plus a worked example (100 ml dose).
3. **Current AI station references table** — "Dilution table for 2.5 billion sperm/dose": Semcheck reading 1.40–2.02 →
   "Nr. Dosis" (56 … 15). 29 rows.

## What the documents say (and what we read into them)

**Process (manual, `[client]`):** prepare diluent at 35 °C, ≥30 min dissolved → collect and **weigh** the semen (g = ml) →
pour it all into the diluent → zero the meter on neat diluent (R) → read the mixture (T) twice and **average** → look the
reading up → work out doses → add the extra diluent (warmed to the same temperature).

**Formula — our reading, reproduced exactly on all 10 rows of the form:**

```
mixture_ml    = raw_semen_ml + initial_diluent_ml
ml_per_dose   = station table (reading)          ← the form's "Semcheck conc"; the table's "Nr. Dosis" column
doses         = floor(mixture_ml / ml_per_dose)
final_ml      = doses × dose_volume_ml           ← 80 on every row of the form
added_ml      = final_ml − mixture_ml
```

| Boar | Raw / diluent | Reading | Conc | Mixture | Doses | Final | Added |
|---|---|---|---|---|---|---|---|
| LA14 | 214 / 1000 | 1.80 | 28 | 1214 | 43 | 3440 | 2226 |
| LA49 | 168 / 1000 | 1.64 | 36 | 1168 | 32 | 2560 | 1392 |
| DA44 | 146 / 750 | 1.73 | 31 | 896 | 28 | 2240 | 1344 |
| DA65 | 236 / 1250 | 1.98 | 17 | 1486 | 87 | 6960 | 5474 |
| DA30 | 586 / 1250 | 1.99 | 17 | 1836 | 108 | 8640 | 6804 |
| DA47 | 274 / 1000 | 1.96 | 18 | 1274 | 70 | 5600 | 4326 |
| DA49 | 128 / 750 | 1.95 | 18 | 878 | 48 | 3840 | 2962 |
| DA37 | 212 / 1000 | 1.92 | 19 | 1212 | 63 | 5040 | 3828 |
| DA64 | 478 / 1000 | 1.85 | 25 | 1478 | 59 | 4720 | 3242 |
| CJ11 | 518 / 1000 | 1.96 | 18 | 1518 | 84 | 6720 | 5202 |

Three raw volumes (DA49, DA64, CJ11) are hard to read in the handwriting; the values above are the ones the form's own
Added column confirms. These ten rows are the spec fixture for Phase 2.

**Readings between table rows are not handled consistently on the form.** 1.73, 1.96 and 1.99 took the row *below*
(1.72, 1.95, 1.98); 1.92 took the row *above* (1.93 → 19, not 1.91 → 20). Question 1.

**The station table is not the Schippers table scaled.** 2.5/3 of the 3-billion column would be ~83% of it; the station
column is ~75% (1.80: 28 vs 37; 1.40: 56 vs 75; 2.02: 15 vs 20). We use the station table, because it is what the station
uses and what the form agrees with. Question 3.

## Where it fits in the flow

Plan (exists) → select boars (exists) → **diluent prepared: conductivity, pH (new, per lot)** → per boar: collector, **boar
temp**, raw ml (exists), **live score, mobility score** (new), morphology (exists), accept/reject (exists) → **initial diluent +
Semcheck reading → conc, doses, final, added worked out (new)** → lot = sum of accepted boars' doses (exists) → label,
colorant, QR, stock lot, cost (exists) → plan COLLECTED (exists).

Form steps after the change: Batch → Boar or boars → **Diluent** → What each boar gave (+ dilution) → Collection → When you save.

## Data model

### New master — `semen_dilution_table` + `semen_dilution_table_row` (migration `0256_semen_dilution`, number to be
taken at build time; `0255` is the uncommitted slaughter transfer order on `feat/system-schedulers`)

- `semen_dilution_table`: `dilution_table_id`, `tenant_id`, `company_id`, `name`, `sperm_per_dose_bn` decimal(5,2),
  `dose_volume_ml` decimal(8,2), `between_rows_rule` (`ROW_BELOW` | `NEAREST` | `INTERPOLATE`, see question 1),
  `diluent_item_id` nullable (question 6), `active`, audit columns.
- `semen_dilution_table_row`: `dilution_table_id`, `reading` decimal(4,2), `ml_per_dose` decimal(8,2); PK
  (`dilution_table_id`, `reading`). Readings strictly increasing, ml per dose strictly decreasing — validated on save.
- `breeding_line_setup.dilution_table_id` nullable. A line with none keeps today's behaviour (doses typed).

### `semen_boar_result` — new nullable columns
`boar_temp` decimal(5,2), `live_score` decimal(4,1), `mobility_score` decimal(4,1), `initial_diluent_ml` decimal(10,2),
`semcheck_reading` decimal(4,2), and a **snapshot** of what was used: `dilution_table_id`, `ml_per_dose` decimal(8,2),
`dose_volume_ml` decimal(8,2), `final_volume_ml` decimal(10,2), `added_diluent_ml` decimal(10,2). The snapshot keeps a lot
readable after the table is edited.

### `semen_batch` — new nullable columns
`diluent_conductivity` decimal(8,2), `diluent_ph` decimal(4,2), `diluent_added_ml` decimal(12,2) (sum over accepted boars,
for the diluent issue in Phase 5).

All additive. A lot recorded before this has no figures and reads as "no figure", never zero.

## Phases

### Phase 0 — Decisions
Put the questions below to Rishi and the client; record answers in `docs/decisions.md` with date and reasoning.
Phases 1–2 do not wait. Phase 3 needs 1, 2, 4 and 5. Phase 5 needs 6.

### Phase 1 — Dilution table master
Migration, Drizzle schema, `master-data/semen-dilution-table` module (controller, DTO, service, rules for row
validation), and the link from `breeding_line_setup` (DTO, service, its config entry gets a "Dilution table" picker). One
config entry in `apps/web/src/modules/master-data/configs.ts` with an editable row grid (reading, ml per dose), sperm per
dose, dose volume, between-rows rule. Satisfy `role-permissions-coverage`, `nav-scope-consistency`,
`master-data-singular-label`.

Fixture script `seed-ai-station-dilution.ts`, Nx target `db-seed-ai-station-dilution`, the usual shape (read-only, `--verify`
rolls back, `--apply` commits, repeatable, refuses to overwrite a table with the same name that differs). It seeds the
station's **2.5 billion** table as printed (29 rows, `[client]`), dose volume 80 (`[client]`, read off the form), and the
between-rows rule only once question 1 is answered (until then it prints the rule as `[open]` and seeds `ROW_BELOW`,
which matches 9 of the 10 rows). Lines are linked by `--lines <code,…>`, never by name. The Schippers 3 and 3.5 billion
tables are **not** seeded unless the client asks.

*Done when:* the table is created and edited in the browser, linked to the Tempo line, and the rows read back from MySQL.

### Phase 2 — The rules, pure and tested
`apps/api/src/modules/piggery/breeding/semen-dilution.rules.ts`:
- `lookupMlPerDose(rows, reading, rule)` → ml per dose, or an issue when the reading is outside the table (below 1.40 or
  above 2.02 on the station table): refuse, never extrapolate.
- `dilute({ rawMl, initialDiluentMl, reading, table })` → `{ mixtureMl, mlPerDose, doses, finalMl, addedMl }`, doses
  rounded **down**.
- `averageReading(t1, t2)` for the two T readings (the form records only the average; we keep only the average too).

Spec reproduces all 10 form rows above, plus: reading exactly on a row, between rows under each rule, out of range, zero
or missing raw volume, an `addedMl` below zero (a too-dilute mixture: refuse with a sentence).

*Done when:* the spec passes with the 10 rows typed in from the form, not computed.

### Phase 3 — The collection takes the dilution
- `SemenBoarResultDto`: the new per-boar fields. `CreateSemenCollectionDto`: `diluent_conductivity`, `diluent_ph`.
- `breeding.service.ts` `recordSemenCollection`: when the line has a dilution table and a result carries a reading, the
  server runs `dilute` and **writes the doses itself**. A typed `doses` that disagrees is refused with the worked figure in
  the message. A line without a table works exactly as today.
- `semen-boar-result.rules.ts` `boarResultIssues`: accepted boars on a dilution line need raw ml, initial diluent and a
  reading.
- Limits (question 5): score floor, temperature range, pH/conductivity range — added to `breeding_line_setup` only if the
  client gives them, and enforced through the line's existing enforcement choice (block or warn). No invented defaults.
- `GET semen-collection/:id`, `semen-lot-details.tsx`, `semen-boar-results.tsx`: show the new figures. QR: add doses' sperm
  per dose and dose volume (the rest stays on the lot screen).

*Done when:* the L-Line pair from the form (LA14, LA49) posts through the running API as one pooled lot and MySQL shows two
result rows with conc 28/36, doses 43/32, final 3440/2560, added 2226/1392, and a stock lot of **75** doses in the ledger;
a typed doses of 44 for LA14 is refused; a reading of 2.10 is refused.

### Phase 4 — The form
`breeding-panel.tsx` collection form:
- New **Diluent** step (lot level): conductivity, pH. Shown only when the line has a dilution table.
- **What each boar gave**: boar temp, live score, mobility score, initial diluent, Semcheck reading. Conc, doses, final
  volume and **added diluent** shown live as `ReadField`s by the same rules file (imported into web, or mirrored with a
  shared spec — pick at build time, the web already mirrors `breeding-rules.ts`). Doses becomes read-only on a dilution line.
- "Record collection" from a plan still pre-fills as today; the diluent volume is not pre-filled (no document says it
  repeats).
- Use `Field`, `ReadField`, `FieldGroup` (`apple.design.md` §19).

*Done when:* the Tempo sheet's eight boars are entered in the browser and every computed cell matches the form.

### Phase 5 — Diluent from stock (only if question 6 says yes)
When the dilution table names a diluent item, the lot's diluent (initial + added, accepted boars only) is **issued from the
boar's farm store as a consumption** in the same transaction, and its cost is added to the lot's running cost — the same
path the colorant uses (`breeding.service.ts`, colorant issue around the Phase 5 block). Out of stock or inactive refuses the
whole collection and writes nothing. UoM conversion (ml → the item's UoM) through the item's UoM, never assumed.

*Done when:* a collection posts, the inventory ledger shows the diluent issue, the lot's cost per dose includes it, and the
journals balance — read from MySQL; then an out-of-stock diluent refuses the collection with nothing written.

### Phase 6 — The preparation sheet (only if the client wants it)
A printable view of a collection day per line that reproduces the paper form (week, date, batch, the ten columns,
conductivity, pH, comments), so the station can stop keeping the paper. Read-only; built from the lots and their results.

### Phase 7 — Proof and handover
Through the running API and the browser on `nf_devco`: the whole form (10 boars, two lines) entered, every cell compared
with the paper, lots, results, ledger and QR read from MySQL; proof rows removed by tag afterwards. Update `AGENTS.md` and
`docs/decisions.md`; add a `docs/VERIFICATION-…` note with the queries and their output.

## Not in this plan
- Reading the Semenmeter directly (device integration). The reading is typed.
- Storing both T readings; the form keeps only the average.
- The Schippers 3 / 3.5 billion tables, unless the client wants them as alternatives.
- Mobile (Flutter), on request only.

## Questions for Triple C (do not answer these ourselves)

1. A reading between two table rows (e.g. 1.73, 1.92): take the row below, the nearest row, or interpolate? The form took
   the row below three times and the row above once.
2. Is the dose always **80 ml**? Does it differ by line? (The manual's example uses 100 ml.)
3. The station's "2.5 billion" table is ~75% of Schippers' 3-billion table, where 2.5/3 would give ~83%. Is the station table
   calibrated to their own meter, and is it the one the system should use? One table for all lines, or per line?
4. "Boar temp" ~99–103: is it the boar's temperature or the semen's, and in °F?
5. Live and mobility score: out of 10? Is there a minimum, a temperature range, or a pH / conductivity range that should
   **reject** an ejaculate or a batch, and should it block or warn? (The line setup already has a motility floor in %;
   should the score replace it?)
6. Should the diluent be **issued from stock and costed** per lot (like the colorant)? If so, which item and UoM?
7. Initial diluent: always one of 750 / 1000 / 1250 ml, or any volume?
8. Conductivity and pH: of the diluent (water) for the day, once per sheet as on the form — or per line batch?
9. Should the system print the preparation sheet (Phase 6), so the paper form is retired?
