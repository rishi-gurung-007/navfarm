import { disposalProblem, disposalStore } from './semen-disposal.rules';

const ok = { lotNo: 'LOT-1', doses: 2, available: 3, where: 'POR100/STORE-001', date: '2026-11-24', collectionDate: '2026-11-16', today: '2026-11-24', reasonType: 'EXPIRED' };

describe('disposalProblem', () => {
  it('accepts doses the store holds, dated between collection and today', () => {
    expect(disposalProblem(ok)).toBeNull();
    expect(disposalProblem({ ...ok, doses: 3 })).toBeNull();
  });
  it('refuses more doses than the store holds, naming it', () => {
    expect(disposalProblem({ ...ok, doses: 4 })).toMatch(/LOT-1 has 3 doses at POR100\/STORE-001; 4 cannot be destroyed/);
  });
  it('refuses nothing to destroy, an unknown reason, and Other without remarks', () => {
    expect(disposalProblem({ ...ok, doses: 0 })).toMatch(/how many/);
    expect(disposalProblem({ ...ok, reasonType: 'LOST' })).toMatch(/Reason must be/);
    expect(disposalProblem({ ...ok, reasonType: 'OTHER' })).toMatch(/Remarks/);
    expect(disposalProblem({ ...ok, reasonType: 'OTHER', remarks: 'Dropped the box' })).toBeNull();
  });
  it('refuses a date in the future or before the collection', () => {
    expect(disposalProblem({ ...ok, date: '2026-11-25' })).toMatch(/future/);
    expect(disposalProblem({ ...ok, date: '2026-11-15' })).toMatch(/collected on 2026-11-16/);
  });
});

describe('disposalStore', () => {
  const two = [{ warehouse_id: 'mul', label: 'MUL100/STORE-001', qty: 2 }, { warehouse_id: 'por', label: 'POR100/STORE-001', qty: 3 }];
  it('takes the store named, or the only one holding the lot', () => {
    expect(disposalStore('por', two)).toEqual({ warehouseId: 'por' });
    expect(disposalStore(undefined, [two[1], { warehouse_id: 'x', label: 'X', qty: 0 }])).toEqual({ warehouseId: 'por' });
  });
  it('asks which store when several hold it, listing them', () => {
    expect(disposalStore(undefined, two)).toEqual({ error: expect.stringMatching(/MUL100\/STORE-001 \(2\), POR100\/STORE-001 \(3\)/) });
  });
  it('says so when no store holds any', () => {
    expect(disposalStore(undefined, [])).toEqual({ error: expect.stringMatching(/No store/) });
  });
});
