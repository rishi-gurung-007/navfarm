# Testing the batch, animal and output linkage — walk-through

What this checks: the work in `docs/superpowers/plans/2026-10-09-batch-animal-output-linkage.md` (Phases 1–8):
one mortality path and its reversal, parity at weaning, schedulers that follow the animals, transfers, exits and
culling, reopen, piglets and semen taken out of a batch from data entry with the item you choose, litters linked to
their matings, semen quality and cost, the Breeding screen, and the animal card.

Every step below was run through the API against this exact test data on 9 Oct 2026 and gave the result written
here. The screens themselves have not been clicked through before — that is what this walk-through is for. Anything
that does not match, note the step number and what you saw.

---

## 1. Set up (once)

1. **Back up first** — this is the way back:
   `mysqldump -u root --single-transaction --set-gtid-purged=OFF nf_devco > ~/nf_devco_before_test.sql`
2. **Migrations** up to `0151` on the tenant: `pnpm nx run api:db-migrate-all-tenants` (look for `FAILED`).
3. **Demo stage sex** (sow stages female, Boar AI male; the demo boars moved out of Gestation):
   `pnpm nx run api:db-align-demo-stage-sex` (plan), then `-- --verify`, then `-- --apply`.
4. **Test data** (read-only plan, then a rolled-back trial, then for real):
   ```
   pnpm nx run api:db-seed-output-linkage-test
   pnpm nx run api:db-seed-output-linkage-test -- --verify
   pnpm nx run api:db-seed-output-linkage-test -- --apply
   ```
   It is for **today** by default. To test on another day, add `--date=YYYY-MM-DD` (not later than today). It
   refuses to run twice for one date.
5. Start the API and web (`pnpm nx serve api`, `pnpm nx dev web`), log in as `tenant.admin@triplec.local`, company
   **Triple C**, farm **MUL100**. In every Data Entry step, pick **the test date**.

> Already seeded on 9 Oct 2026 in the local `nf_devco`: the numbers below are from that run. A new run gives new
> numbers — the script prints them; use those.

## 2. The test data

| Batch | Kind | What is in it |
|---|---|---|
| **BATCH-000005** TEST sow herd | Animal-wise | the seven animals S1–S7 below |
| **BATCH-000006** TEST gilt pool | Animal-wise | PIG-0028 (G1, gilt, Gilt Grower) — no Flush scheduler yet |
| **BATCH-000007** TEST boar stud | Animal-wise | PIG-0029 (B1, boar, Boar AI) |
| **BATCH-000008** TEST weaners A | Batch-wise (head count) | 20 head, Weaner |
| **BATCH-000009** TEST weaners B | Batch-wise (head count) | 12 head, Weaner |
| **BATCH-000010** | Piglet lot **LOT-00006** | 11 piglets of PIG-0022, farrowed 21 days before the test date |
| **BATCH-000011** | Piglet lot **LOT-00007** | 10 piglets of PIG-0023 |
| Semen lot **LOT-00008** | 20 doses of *BOAR semen*, 250 ml, 85 % motile, 300 M/ml | from PIG-0029; QR **PACK-000001** |

| Animal | Stage | Use it for |
|---|---|---|
| **PIG-0021** (S1) | Farrowing, mated, no litter yet | farrow her from Data Entry |
| **PIG-0022** (S2) | Farrowing, litter LOT-00006 not weaned | wean her from Data Entry |
| **PIG-0023** (S3) | Lactation, litter LOT-00007 not weaned | wean her on the Breeding screen |
| **PIG-0024** (S4) | Gestation | record her death — then reverse it |
| **PIG-0025** (S5) | Gestation, never mated | AI-mate her from the semen lot; a farrowing for her is refused |
| **PIG-0026** (S6) | Flush (gilt) | send her to the gilt pool from a Data Entry transfer line |
| **PIG-0027** (S7) | Gestation, out of production since 20 days before | post her day (alert), then cull her |
| **PIG-0028** (G1) | Gilt Grower | sell her (the gilt pool follows) |
| **PIG-0029** (B1) | Boar AI | collect semen from Data Entry |

The script added four lines named **"TEST — …"** where the generated scheduler had none (piglet output on Farrowing,
a transfer on Flush, semen on Boar AI, weaner output on Weaner). They are test fixtures, not client set-up. Each stage
also has mandatory lines (feed, mortality check) — fill them too; a day posts only when they are entered.

---

## 3. Output from Data Entry (Batches → Data Entry, `/batches/entry`)

### 3.1 Farrow a sow — choose the piglet item; the mating is found
BATCH-000005, the test date, stage **Farrowing**, animal **PIG-0021**. *TEST — Piglet output* says **"Posts as a
farrowing"**; the **Item** column is a picker (any active item). Enter **12**, feed and mortality 0, **Save to Draft**,
**Post Data (PIG-0021)**.
**Expect:** *"Farrowing recorded: 12 live piglets born (litter 1)… held as lot LOT-000xx in batch BATCH-0000xx."* The
litter is linked to her mating (Breeding screen shows it). PIG-0021 LACTATING, parity still 0.

### 3.2 Wean a sow — piglets to another batch, sow to Dry Sow
Same stage, **PIG-0022**. The line says **"Posts as the weaning of litter 1, lot LOT-00006 — 11 on hand"**. Pick
**BATCH-000008** in *"Keep in their lot, or move to…"*, enter **10**, post.
**Expect:** 1 lost recorded as mortality on BATCH-000010; TEST weaners A 20 → 30; PIG-0022 parity 1, stage **Dry Sow**
(Movement tab: *Weaned litter 1*); BATCH-000005 gains a Dry Sow scheduler.

### 3.3 Semen from a boar — lot, stock, QR, quality, cost
BATCH-000007, stage **Boar AI**, **PIG-0029**. Enter **15** in *TEST — Semen collection*, post.
**Expect:** a new lot in MUL100/STORE-001 with QR **PACK-000002** (the next number of the series). The cost per dose
is worked out from what was posted for him since his last collection (nothing yet → 0). Add a SEMEN_MOTILITY
reading line to his scheduler and enter it the same day, and the motility is carried onto the lot and its QR.

### 3.4 A transfer line saved as a draft keeps its destination
BATCH-000005, stage **Flush**, **PIG-0026**: *TEST — Move to gilt pool* = 1, destination **BATCH-000006**, feed and
mortality, **Save to Draft**, leave and come back (still chosen), post.
**Expect:** PIG-0026 in BATCH-000006 at Flush; BATCH-000006 gains a Flush scheduler (count 1).

### 3.5 The out-of-production alert
BATCH-000005, stage **Gestation**, **PIG-0027**: feed and mortality 0, post.
**Expect:** Alerts: *"PIG-0027 out of production for over 14 days — not culled"* (INFO, 20 days). Only once.

### 3.6 Refused on purpose
- Head-count output before maturity: BATCH-000008 *TEST — Weaner output* → *"…once the bio-asset batch has matured."*
  (decision 7).

## 4. Breeding screen (Livestock → Breeding, `/livestock/breeding`)

- **4.1 Wean** PIG-0023's litter: 9 weaned, move to **BATCH-000009** → 1 lost as mortality; weaners B 12 → 21;
  PIG-0023 parity 1, Dry Sow. Again → *"already weaned"*.
- **4.2 AI mating** PIG-0025 from **LOT-00008** (picker shows doses left), 2 doses → 18 left; 100 doses → refused.
- **4.3 No mating, no farrowing:** a farrowing for PIG-0025 dated before her mating, or for any sow never mated →
  *"No open mating is recorded for … Record her mating before her farrowing."*
- **4.4 Semen collection** for **PIG-0010** (the demo boar, BATCH-000002), item *BOAR semen*, 20 doses, volume and
  motility filled, the period cost fields **left empty**.
  **Expect:** *"… computed unit cost of 20.0000/dose (worked out from his posted costs 2026-09-30 to 2026-10-09)"* —
  his posted feed (400) over the period; quality on the lot and its QR.

## 5. Mortality (Livestock → Health, `/livestock/health`)
1. Record **PIG-0024** dead with a reason.
   **Expect:** DEAD/DIED; her own 28,000 leaves her bio-asset ledger (plus the batch's share of its costs); Gestation
   count −1; the card shows the death.
2. On that row, **Reverse** → give a reason → confirm.
   **Expect:** PIG-0024 live (ACTIVE) again; batch head and Gestation count back; both ledger rows mirrored; the
   write-off journal reversed (a batch with costs posts *"Reversal of JE-…"*); movement log *MORTALITY_REVERSED* with
   your reason; the row leaves the list; reversing again → *"already been reversed"*.
3. Head count on BATCH-000008: 2 → 20 → 18 (or 30 → 28 after 3.2).
4. An animal-wise batch with only a head count → *"choose the animal(s) that died."*

## 6. Exits and culling (Livestock → Register, open an animal)
- **6.1 Sell** PIG-0028 (G1): Dispose → Sold, value, weight, destination.
  **Expect:** gilt pool head 1 → 0 and its stage count 0; movement log *DISPOSAL*.
- **6.2 Cull** PIG-0027 (S7): Dispose → **Culled** — the reason picker offers CULL reasons; the out-of-production
  date is filled from her record.
  - Cull date before the out-of-production date → refused; no weight or destination → refused.
  - Cull with reason, 230 kg, destination → **CULLED**, both dates kept, weight and destination kept, gain/loss
    against her 28,000; her value leaves her ledger; sow herd head −1; movement log *CULL*.
- **6.3 Out of production** (button on an active animal): sets the date a cull will need; posting her days after 14
  days raises the alert (3.5).

## 7. Transfers (Batches → Transfers, `/batches/transfers`)
1. BATCH-000008 → BATCH-000009, head count 5 → A −5, B +5. More than A holds → refused.
2. **Reverse transfer** → both back.

## 8. Reopen a posted day (Data Entry)
After 3.1 and 3.2 the Farrowing day locks when all its animals are posted. **Reopen** it with a reason: feed and
mortality go back to drafts, their stock returns; the two piglet outputs stay posted (listed as kept).

## 9. Animal card (open an animal)
- **PIG-0022**: Breeding — *Progeny: litters* shows litter 1, LOT-00006 · BATCH-000010, head now; parity 1; Movement —
  *Weaned litter 1*.
- **PIG-0029 / PIG-0010**: semen lots with lot, doses, **quality** and cost per dose.
- **PIG-0024**: after 5.2, no death record.
- **PIG-0027**: after 6.2, CULLED with both dates.

## 10. Inventory
- Inventory → Ledger / Balance: *BOAR semen* lots in MUL100/STORE-001.
- **Stock transfer** of 5 doses of LOT-00008 to POR100/STORE-001 (create, ship, receive) → the lot arrives under the
  same lot number.
- An item's stock card never shows a day's observation or overhead rows (they stay in the transaction ledger).

## 11. Optional checks in MySQL
```sql
SELECT a.animal_code, a.status, a.parity_count, s.stage_code, a.out_of_production_date, a.cull_date
FROM animal_register a JOIN stage_master s ON s.stage_id = a.current_stage_id
WHERE a.rfid_tag LIKE 'TST-%' ORDER BY a.animal_code;
SELECT batch_no, closing_quantity, remarks FROM batch_header WHERE batch_no >= 'BATCH-000005';
SELECT h.batch_no, s.stage_code, sh.animal_count FROM scheduler_header sh
JOIN stage_master s ON s.stage_id = sh.stage_id JOIN batch_header h ON h.batch_id = sh.batch_id
WHERE h.remarks LIKE 'TEST-OUTPUT%' ORDER BY 1, 2;
SELECT lot_no, doses_collected, doses_used_internal, motility_pct, unit_cost_per_dose FROM semen_batch ORDER BY created_at DESC LIMIT 5;
SELECT alert_type, title FROM notification_alert_log WHERE alert_type = 'CULL_HOLD';
```

## 12. Known limits (not bugs in this round)
- Head-count bio-asset batches cannot post output until matured (decision 7). Births and doses enter at nil value
  (decision 6).
- A registered animal's own value stays in livestock stock after registration; nothing takes it out at death, sale or
  cull (decision — see decisions.md, Phase 8).
- When an animal leaves by sale or cull, the costs her batch has accumulated stay with the animals still in it.
- A piglet lot at 0 head stays ACTIVE; an empty semen lot stays open. A posted farrowing, weaning or semen collection
  cannot be undone yet.
- Entering an output for "All animals" gives every animal the same figure — enter outputs one animal at a time.

## 13. Reset
`mysql -u root nf_devco < ~/nf_devco_before_test.sql`, or seed a fresh set for another date with `--date=`.
