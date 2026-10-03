/**
 * Silo and store stock for the forecast, shaped from ledger sums (Plan R,
 * spec D19; open questions Q2 and Q6). Pure — the service reads the rows
 * (InventoryLedgerService.getFeedStockAsOf for posted stock, its own query
 * for DRAFT transfers) and this decides what they mean:
 * - A silo holds one item (D8). Its item is the one with the largest positive
 *   opening balance; an empty silo takes the item of the first transfer or
 *   receipt booked into it, so the shed that will eat it finds its source.
 * - Incoming is every posted non-feeding movement and every DRAFT transfer
 *   from the stock date on, signed. A silo's movements of another item are
 *   dropped — it can only take a different item once empty (D8), and that is
 *   the changeover the requisition flags, not stock the forecast can use.
 * - An opening below zero is carried as it is (follow-up ruling): it is ledger
 *   truth — feed posted before the item's only receipt — and the engine nets
 *   it against that day's inflow before clamping at empty. Zeroing it here
 *   would show a receipt of 40,000 over 4,200 already fed as 40,000 on hand.
 * - Feed is counted in KG only. A silo holding anything in another unit, or a
 *   store holding a *feed* item in one, is refused, as Plan A did: adding bags
 *   to kilograms would move every date the report shows.
 */
import { ConflictException } from '@nestjs/common';
import type { FeedStockMovement, FeedStockRow } from '../inventory-ledger/inventory-ledger.service';
import type { ForecastInput, IncomingFeed } from './feed-forecast.engine';

const EPS = 0.0001;

export function stockAsOf(args: {
  silos: { siloId: string; siloCode: string; lowLevelKg: number | null }[];
  store: { storeId: string; storeCode: string } | null;
  feedItemIds: Set<string>;
  opening: FeedStockRow[];
  movements: FeedStockMovement[];
  drafts: FeedStockMovement[];
}): { silos: ForecastInput['silos']; store: ForecastInput['store']; incoming: IncomingFeed[] } {
  const siloCode = new Map(args.silos.map((s) => [s.siloId, s.siloCode]));
  const isStoreFeed = (r: FeedStockRow) => !!args.store && r.warehouse_id === args.store.storeId && args.feedItemIds.has(r.item_id);

  for (const r of [...args.opening, ...args.movements, ...args.drafts]) {
    if (r.uom === 'KG' || Math.abs(r.qty) < EPS) continue;
    if (siloCode.has(r.warehouse_id)) {
      throw new ConflictException(`Silo '${siloCode.get(r.warehouse_id)}' holds its feed in ${r.uom}, not KG — the forecast cannot add bags to kilograms.`);
    }
    if (isStoreFeed(r)) {
      throw new ConflictException(`Store '${args.store!.storeCode}' holds '${r.item_code}' in ${r.uom}, not KG — the forecast cannot add bags to kilograms.`);
    }
  }

  const openingKg = new Map<string, number>(); // `${location}|${item}`
  for (const r of args.opening) {
    if (r.uom !== 'KG') continue;
    const k = `${r.warehouse_id}|${r.item_id}`;
    openingKg.set(k, (openingKg.get(k) ?? 0) + r.qty);
  }
  const flows = [...args.movements, ...args.drafts]
    .filter((r) => r.uom === 'KG' && Math.abs(r.qty) >= EPS)
    .sort((a, b) => (a.posting_date < b.posting_date ? -1 : a.posting_date > b.posting_date ? 1 : 0));

  const silos = args.silos.map((s) => {
    const held = args.opening
      .filter((r) => r.warehouse_id === s.siloId && r.uom === 'KG')
      .map((r) => ({ itemId: r.item_id, kg: openingKg.get(`${s.siloId}|${r.item_id}`) ?? 0 }))
      .filter((h) => h.kg > EPS)
      .sort((a, b) => b.kg - a.kg);
    const firstIn = flows.find((f) => f.warehouse_id === s.siloId && f.qty > 0);
    const itemId = held[0]?.itemId ?? firstIn?.item_id ?? null;
    // The resident's own opening, negative included — for an item first booked in, what was fed of it before.
    const balanceKg = itemId ? openingKg.get(`${s.siloId}|${itemId}`) ?? 0 : 0;
    return {
      siloId: s.siloId,
      siloCode: s.siloCode,
      itemId,
      balanceKg,
      lowLevelKg: s.lowLevelKg,
    };
  });
  const residentOf = new Map(silos.map((s) => [s.siloId, s.itemId]));

  let store: ForecastInput['store'] = null;
  if (args.store) {
    const balances: Record<string, number> = {};
    for (const [k, kg] of openingKg) {
      const [location, itemId] = k.split('|');
      if (location === args.store.storeId && args.feedItemIds.has(itemId) && Math.abs(kg) >= EPS) balances[itemId] = kg;
    }
    store = { storeId: args.store.storeId, storeCode: args.store.storeCode, balances };
  }

  const incoming: IncomingFeed[] = [];
  for (const f of flows) {
    if (siloCode.has(f.warehouse_id)) {
      if (f.item_id !== residentOf.get(f.warehouse_id)) continue;
    } else if (!isStoreFeed(f)) {
      continue;
    }
    incoming.push({ locationId: f.warehouse_id, itemId: f.item_id, date: f.posting_date, kg: f.qty });
  }
  return { silos, store, incoming };
}
