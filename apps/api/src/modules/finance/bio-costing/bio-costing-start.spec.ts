import { recomputeStartsForItem } from './bio-costing-start';

describe('recomputeStartsForItem — the item\'s start period moved, so its animals\' costing start dates move with it', () => {
  const queue: unknown[][] = [];
  const updates: any[] = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db: any = {
    select: jest.fn(() => chain(queue.shift() ?? [])),
    update: jest.fn(() => ({ set: (set: any) => ({ where: () => { updates.push(set); return Promise.resolve(); } }) })),
  };
  const item = { item_id: 'i1', tenant_id: 't', bio_start_age_weeks: 33, bio_start_age_days: 0 };
  const animal = (code: string, start: string | null) => ({ animal_id: code, animal_code: code, dob: '2026-01-05', entry_date: '2026-02-01', age_at_entry_weeks: null, costing_start_date: start });

  beforeEach(() => { queue.length = 0; updates.length = 0; jest.clearAllMocks(); });

  it('moves an animal with nothing booked to birth + the start period, leaves one already on the right date alone, and keeps one with bookings, naming her', async () => {
    queue.push(
      [animal('A1', null), animal('A2', '2026-05-01'), animal('A3', '2026-08-24')],
      [{ n: 0 }], [{ n: 0 }], [{ n: 0 }], // A1: nothing booked
      [{ n: 2 }], [{ n: 0 }], [{ n: 0 }], // A2: a costing run line
    );
    const r = await recomputeStartsForItem(db, item);
    expect(r).toEqual({ moved: 1, kept: [{ animal_code: 'A2' }] });
    expect(updates).toEqual([{ costing_start_date: '2026-08-24' }]);
  });

  it('counts the extra days of the start period', async () => {
    queue.push([animal('A1', null)], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }]);
    await recomputeStartsForItem(db, { ...item, bio_start_age_days: 3 });
    expect(updates).toEqual([{ costing_start_date: '2026-08-27' }]);
  });

  it('does nothing for an item with no animals', async () => {
    queue.push([]);
    expect(await recomputeStartsForItem(db, item)).toEqual({ moved: 0, kept: [] });
    expect(updates).toEqual([]);
  });
});
