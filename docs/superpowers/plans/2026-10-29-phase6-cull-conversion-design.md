# Phase 6 design: culled breeding animal, FA to Inventory conversion with Finance approval

Date: 2026-10-29. Source: TDD row 11 "Sale of Fixed Asset (Cull)", read against the code. Nothing is built yet. Decisions below were taken on 29 Oct 2026.

## What the TDD asks for (row 11)
1. Farm Manager records the **Out-of-Production Date** on the Animal Register (separate from the disposal date).
2. Farm Manager raises an **FA to Inventory Conversion Request**.
3. **Finance approves** in NAVFarm. Mandatory before anything posts.
4. NAVFarm posts the FA disposal and an inventory receipt (positive adjustment, qty 1, cost = market value or NBV, lot no.). Pushing these to BC is the BC phase.
5. Animal status becomes **CONVERTED_INV**.
6. The animal goes on a Transfer Order as a **CULLED_BREEDING_ASSET** line.
7. Kill Sheet, then Sales Invoice (customer Colcom, dimension = supplying farm cost centre), pushed to BC.

Conversion record fields: animal no., FA no., out-of-production date, conversion date, NBV at conversion, market value, approved by (Finance), BC FA ledger entry no., BC item ledger entry no.

Journals: FA disposal Dr accumulated amortisation, Dr/Cr gain or loss, Cr FA acquisition cost. Inventory receipt Dr inventory, Cr disposal account. Sales invoice Dr COGS / Cr inventory and Dr receivable / Cr revenue.

## What exists today
| Step | State |
|---|---|
| 1 Out-of-production date | Built: `markOutOfProduction`, with checks (not in future, not before entry). |
| 2-3 Request and Finance approval | Not built. |
| 4 FA disposal + inventory receipt | Not built as one step. Today `dispose(CULLED)` in `animal.service.ts` does a one-step exit: it needs a CULL reason, the out-of-production date, exit weight and destination, writes a bio-asset ledger exit row, clears accumulated amortisation, and posts the sale, gain/loss journals from a disposal value. No inventory receipt is made. |
| 5 CONVERTED_INV status | Not built. Statuses today: SOLD, SLAUGHTERED, DEAD, CULLED. |
| 6 Transfer order line | Not built. A stock-transfer module exists; it has no CULLED_BREEDING_ASSET line type. |
| 7 Kill sheet, sales invoice | Not built. No kill sheet exists anywhere. |
| BC entry numbers | No BC integration; the two fields would stay empty. |

## Proposed build (what I recommend, pending your answers)
**New table `fa_inventory_conversion`**, one row per request: animal, item, out-of-production date, requested by and on, status `REQUESTED / APPROVED / REJECTED / POSTED / CANCELLED`, market value, NBV at conversion (frozen at posting), conversion date, approved by and on, rejection reason, the ledger/journal ids it posted, and the two nullable BC entry numbers.

**Flow**
1. Request: only for an active, costed breeding animal with an out-of-production date. One open request per animal.
2. Approve or reject: needs a Finance permission, and the approver cannot be the requester. Without approval, Post is refused.
3. Post (one transaction): NBV is read from her ledger on the conversion date; the FA disposal writes her ledger exit row, clears accumulated amortisation and posts the gain/loss journal; the inventory receipt is a positive adjustment of the conversion item, qty 1, with a lot number; the animal becomes CONVERTED_INV and leaves the herd counts.
4. Reversal of a posted conversion is out of scope unless you want it.

**Proved the same way as the other phases:** a seed chapter that registers an animal, costs her, runs the whole request, approval and post through the services, and a verify script that reads MySQL and recomputes NBV, gain or loss, the journals and the inventory row. Plus the refusals: post without approval, approve your own request, request without an out-of-production date.

## Open questions (the answers change what I build)
1. **Inventory cost: market value or NBV?** The TDD says "Market Value or NBV". Market value puts the gain or loss on the conversion; NBV makes it zero there and moves it to the sale.
2. **One-step cull today: replace or keep?** Should a costed breeding animal be refused a direct CULLED disposal and forced through conversion, or should both exist?
3. **How much of row 11 now?** Conversion, approval, inventory receipt and the new status only, or also the transfer order line, kill sheet and sales invoice?
4. **Who approves?** Which role is "Finance" for this (an existing role, or a new permission)?
5. (not asked yet) **Which inventory item** receives the culled animal (one new "Culled Breeding Asset" item, or one per animal item), and the **GL accounts**: inventory account and the "Disposal Account" the TDD names. Finance has to name them.
6. (not asked yet) **Market value:** who enters it, and is it per animal or per kg of exit weight?

## Decisions taken (29 Oct 2026)
1. **Inventory cost = market value**, entered by Finance. The gain or loss against her book value lands on the conversion.
2. **Conversion is forced** for a costed breeding animal: a direct `dispose(CULLED)` is refused for her. Other disposals are unchanged.
3. **Scope = conversion only**: request, Finance approval, FA disposal journal, inventory receipt, CONVERTED_INV. Transfer order line, kill sheet and sales invoice are a later phase.
4. **Approver = the existing finance permission** that allows posting journals (FINANCE / JOURNAL / can_create), and the approver must not be the requester.

## How it will be built (from reading the code)
- **Journal:** reuse the cull's own legs. Dr Inventory / Cr Biological Assets for the market value (a new GL mapping type `BIO_FA_CONVERSION`, default Dr 1030 Finished Goods / Cr 1060, asset side overridden to her class account as `postExitJournals` does), then the gain or loss through the existing `BIO_DISPOSAL_SOLD` (reversed direction for a loss). Accumulated amortisation is cleared first by the existing `clearOnExit`.
- **Ledger exit row** written exactly as `dispose` does (bio-asset ledger, quantity -1, book value out), so her book value reaches nil.
- **Inventory receipt** through the inventory ledger's positive entry, qty 1, cost = market value, lot no. = her animal code. To check at build time: whether the inventory ledger posts its own GL journal, so the receipt is not journalled twice.
- **Status:** CONVERTED_INV, `is_active` false, disposal type CONVERTED, disposal date = conversion date; `out_of_production_date` stays separate (it already is).
- **New GL mapping** also needs seeding for tenants that already exist (the starter data only seeds new companies): the seed chapter creates it if missing, like chapter 02b does for account 1065.
- **Not in this build:** the web screens (request, approval inbox). The API and the seed come first and are proved on MySQL; screens follow as 6b.

## Still open (asked next)
- The inventory item that receives the culled animal, and the inventory and disposal accounts.
- How Finance enters the market value.
