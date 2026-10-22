import { farmStoreOf } from './farm-store';

/** A select chain that resolves at its last call, whichever that is (.limit after .orderBy). */
function chain(result: unknown[]) {
  const c: any = {};
  for (const m of ['from', 'where', 'groupBy', 'having', 'orderBy']) c[m] = jest.fn(() => c);
  c.limit = jest.fn().mockResolvedValue(result);
  return c;
}

describe('farmStoreOf', () => {
  const stores = [{ location_id: 'PSTORE-AI' }, { location_id: 'PSTORE-FEED' }, { location_id: 'PSTORE-MED' }];

  it('draws an item from the farm store that holds it, not the first store by code', async () => {
    const db: any = { select: jest.fn().mockReturnValueOnce(chain(stores)).mockReturnValueOnce(chain([{ warehouse_id: 'PSTORE-FEED', qty: '1200' }])) };
    await expect(farmStoreOf(db, 'farm-1', 'item-lactation')).resolves.toBe('PSTORE-FEED');
  });

  it('falls back to the first store by code when no store holds the item, or no item is named', async () => {
    const db: any = { select: jest.fn().mockReturnValueOnce(chain(stores)).mockReturnValueOnce(chain([])).mockReturnValueOnce(chain(stores)) };
    await expect(farmStoreOf(db, 'farm-1', 'item-new')).resolves.toBe('PSTORE-AI');
    await expect(farmStoreOf(db, 'farm-1')).resolves.toBe('PSTORE-AI');
  });

  it('reads no stock when the farm has a single store', async () => {
    const db: any = { select: jest.fn().mockReturnValueOnce(chain([{ location_id: 'STORE-1' }])) };
    await expect(farmStoreOf(db, 'farm-1', 'item-feed')).resolves.toBe('STORE-1');
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
