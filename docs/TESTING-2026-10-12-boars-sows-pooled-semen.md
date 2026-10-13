# Boars, sows, semen output and pooled semen — how to test it

Seed: `pnpm nx run api:db-seed-boars-sows-batches` (plan), then `-- --verify` (rolls back), then `-- --apply`.
It refuses to run twice for one date. Migration `0190_semen_pool` must be applied first
(`pnpm nx run api:db-migrate-all-tenants`). Log in as `tenant.admin@triplec.local` (password `12345678`), open the
**Triple C** company, then **Operational Areas → Piggery → Open Workspace**.

## What the seed makes

| Thing | What |
|---|---|
| Output items | **AI Semen Dose - Fresh (single boar)** and **AI Semen Dose - Pooled (multi-boar)** — UOM DOSE, lot-tracked, 5-day shelf life |
| Store | Semen lots are kept in the farm's store, **MUL100/STORE-001** |
| Boar Stud batch (animal-wise, 2 head) | **PIG-0001**, **PIG-0002** — breed *Teaser Boar*, stage Boar AI, **Boar House** pens |
| Sow Herd batch (animal-wise, 2 head) | **PIG-0003**, **PIG-0004** — breed *Z-Line-Sow*, stage Insemination, **Dry Sow House** pens |
| Day 1 (2 days ago) | PIG-0001 collects 25 doses alone → **LOT-00003** (QR PACK-000002) |
| Day 2 (yesterday) | PIG-0001 + PIG-0002 **pooled**, 40 doses → **LOT-00004** (QR PACK-000003) |
| AI on day 2 | PIG-0003 from LOT-00003 (sire PIG-0001); PIG-0004 from pooled LOT-00004 (no single sire) |

Today is left open for your own entries.

## Collect output from the batch (Data Entry)

1. **Batches → Data Entry**, pick **BATCH-000004** (Boar Stud), date = today, click the **BOAR_AI** stage.
2. In the animal box choose **PIG-0001** (output is entered one animal at a time).
3. Under **Output → Boar Semen Collection**: pick the **Output item** (single or pooled), type the **doses**.
4. *Pooled?* Under the activity name tick **Pool with other boars → PIG-0002**. The doses you type are the whole mix.
   A boar who already has his own value on that line is greyed out (his doses would be counted twice).
5. Fill the feed and mortality lines, **Save to Draft** (the pool tick is kept), then **Post Data (PIG-0001)**.
6. Result: a lot in **Inventory** (MUL100/STORE-001), a QR on **Traceability**, and a row on **Livestock → Breeding →
   Boar Semen AI Station** — pooled lots show both boars. The lot's cost is what every boar in it cost.

The same thing is on **Livestock → Breeding → Boar Semen AI Station → Log Semen Collection**: pick a boar, tick
**Mix with other boars**, enter doses and the item.

## AI insemination

**Livestock → Breeding → Mating & Insemination → Record Mating / AI**: sow, type AI, pick the **semen lot** (it shows
the boars, e.g. `PIG-0001 + PIG-0002 · pooled`, and the doses left), set doses, save. Doses come out of the lot.
A service from a pooled lot records **no single sire**. Later: pregnancy check, then farrowing (needs the mating) and
weaning, both also from Data Entry.

## Where to look afterwards

- **Animal card** (Batches → Batch Animals → click the animal): the boar's *Breeding & Lifecycle* tab lists his lots
  (pooled ones say *Pooled: PIG-0001 + PIG-0002*) and his services; services from pooled lots are counted apart
  (*+ n from pooled lots*) and are **not** counted as litters he sired. The sow shows *pooled lot* as her boar.
- **Farm Master → Animal Register → animal → Traceability**: the same, on one timeline.

## Reset

`mysql -u root nf_devco < <your backup>.sql` (take one before seeding: `mysqldump -u root --single-transaction
--set-gtid-purged=OFF nf_devco > ~/nf_devco_before.sql`).

## Known limits

- A posted semen collection, farrowing or weaning cannot be undone yet.
- Doses and costs of a pooled lot are one total; the per-boar share is only kept for cost (`semen_batch_boar.cost_share`).
- Doses enter stock at nil value (decision 6); cost per dose is information on the lot.
