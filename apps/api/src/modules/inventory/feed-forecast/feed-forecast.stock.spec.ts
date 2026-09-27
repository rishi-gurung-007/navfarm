import { ConflictException } from '@nestjs/common';
import { stockAsOf } from './feed-forecast.stock';

const silos = [
  { siloId: 's1', siloCode: 'GRS/SILO-001', lowLevelKg: 1000 },
  { siloId: 's2', siloCode: 'GRS/SILO-002', lowLevelKg: null },
];
const base = { silos, store: { storeId: 'st', storeCode: 'GRS/STORE-001' }, feedItemIds: new Set(['r1', 'r2']), opening: [], movements: [], drafts: [] };

describe('stockAsOf — silo and store stock for the forecast (Q2, Q6)', () => {
  it('takes each silo\'s resident item and opening balance, and carries its low level', () => {
    const out = stockAsOf({
      ...base,
      opening: [
        { warehouse_id: 's1', item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', qty: 1500 },
        { warehouse_id: 's1', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', qty: 0 }, // emptied before the changeover
        { warehouse_id: 'st', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', qty: 800 },
        { warehouse_id: 'st', item_id: 'med', item_code: 'MED-1', uom: 'PCS', qty: 40 }, // not feed: ignored
      ],
    });
    expect(out.silos).toEqual([
      { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500, lowLevelKg: 1000 },
      { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: null, balanceKg: 0, lowLevelKg: null },
    ]);
    expect(out.store).toEqual({ storeId: 'st', storeCode: 'GRS/STORE-001', balances: { r2: 800 } });
    expect(out.incoming).toEqual([]);
  });

  it('an empty silo with a booked transfer holds that transfer\'s item from its date', () => {
    const out = stockAsOf({
      ...base,
      drafts: [{ warehouse_id: 's2', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', posting_date: '2026-09-28', qty: 6000 }],
    });
    expect(out.silos[1]).toMatchObject({ itemId: 'r2', balanceKg: 0 });
    expect(out.incoming).toEqual([{ locationId: 's2', itemId: 'r2', date: '2026-09-28', kg: 6000 }]);
  });

  it('keeps posted movements and drafts, signed, and drops a silo movement of another item', () => {
    const out = stockAsOf({
      ...base,
      opening: [{ warehouse_id: 's1', item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', qty: 1500 }],
      movements: [
        { warehouse_id: 's1', item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-26', qty: 3000 },
        { warehouse_id: 's1', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', posting_date: '2026-09-27', qty: 500 },
        { warehouse_id: 'st', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', posting_date: '2026-09-27', qty: -200 },
      ],
      drafts: [{ warehouse_id: 'st', item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-29', qty: -1000 }],
    });
    expect(out.incoming).toEqual([
      { locationId: 's1', itemId: 'r1', date: '2026-09-26', kg: 3000 },
      { locationId: 'st', itemId: 'r2', date: '2026-09-27', kg: -200 },
      { locationId: 'st', itemId: 'r1', date: '2026-09-29', kg: -1000 },
    ]);
  });

  it('refuses feed held in anything but KG, naming the silo or the store item', () => {
    expect(() => stockAsOf({ ...base, opening: [{ warehouse_id: 's1', item_id: 'r1', item_code: 'FEED-R1', uom: 'BAG', qty: 10 }] }))
      .toThrow(new ConflictException("Silo 'GRS/SILO-001' holds its feed in BAG, not KG — the forecast cannot add bags to kilograms."));
    expect(() => stockAsOf({ ...base, opening: [{ warehouse_id: 'st', item_id: 'r2', item_code: 'FEED-R2', uom: 'BAG', qty: 10 }] }))
      .toThrow(new ConflictException("Store 'GRS/STORE-001' holds 'FEED-R2' in BAG, not KG — the forecast cannot add bags to kilograms."));
  });
});
