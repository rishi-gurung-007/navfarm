import { planFarmOverrides, planLineRenumber, FeedLogisticsDefaults } from './align-feed-tdd.lib';

const farm = (over: Partial<Parameters<typeof planFarmOverrides>[0][number]> = {}) => ({
  farmId: 'f1', companyId: 'c1', code: 'F1', bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0, ...over,
});
const company = (over = {}) => ({ bulkMultipleKg: null, bagSizeKg: null, truckTargetKg: null, productionWeekday: null, ...over });

describe('planFarmOverrides — copy a farm\'s legacy logistics to its feed_planning_setting row only where it differs', () => {
  it('has the client defaults 3000 / 50 / 30000 / Sunday', () => {
    expect(FeedLogisticsDefaults).toEqual({ bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 });
  });

  it('copies nothing for a farm on the defaults when its company has no row', () => {
    expect(planFarmOverrides([farm()], new Map(), new Map())).toEqual([
      { farmId: 'f1', code: 'F1', action: 'none', values: {}, keptExisting: [] },
    ]);
  });

  it('copies only the differing fields, as a new override row', () => {
    const [p] = planFarmOverrides([farm({ bulkMultipleKg: 6000, truckTargetKg: 28000 })], new Map(), new Map());
    expect(p).toMatchObject({ action: 'insert', values: { bulkMultipleKg: 6000, truckTargetKg: 28000 } });
    expect(Object.keys(p.values).sort()).toEqual(['bulkMultipleKg', 'truckTargetKg']);
  });

  it('compares against the company row value, not the default, when the company has one', () => {
    const companies = new Map([['c1', company({ bulkMultipleKg: 6000 })]]);
    const [equal] = planFarmOverrides([farm({ bulkMultipleKg: 6000 })], companies, new Map());
    expect(equal.action).toBe('none');
    const [differs] = planFarmOverrides([farm({ bulkMultipleKg: 3000 })], companies, new Map());
    expect(differs).toMatchObject({ action: 'insert', values: { bulkMultipleKg: 3000 } });
  });

  it('treats an unset company weekday as Sunday (0), and never copies a null farm value', () => {
    expect(planFarmOverrides([farm({ productionWeekday: 0 })], new Map(), new Map())[0].action).toBe('none');
    expect(planFarmOverrides([farm({ productionWeekday: 3 })], new Map(), new Map())[0].values).toEqual({ productionWeekday: 3 });
    expect(planFarmOverrides([farm({ productionWeekday: null, bagSizeKg: null })], new Map(), new Map())[0].action).toBe('none');
  });

  it('updates an existing override row, filling only fields it leaves null and never overwriting one it sets', () => {
    const existing = new Map([['f1', { bulkMultipleKg: 9000, bagSizeKg: null, truckTargetKg: null, productionWeekday: null }]]);
    const [p] = planFarmOverrides([farm({ bulkMultipleKg: 6000, bagSizeKg: 25 })], new Map(), existing);
    expect(p).toMatchObject({ action: 'update', values: { bagSizeKg: 25 }, keptExisting: ['bulkMultipleKg'] });
  });

  it('is a no-op for an existing row when every differing field is already overridden', () => {
    const existing = new Map([['f1', { bulkMultipleKg: 9000, bagSizeKg: null, truckTargetKg: null, productionWeekday: null }]]);
    const [p] = planFarmOverrides([farm({ bulkMultipleKg: 6000 })], new Map(), existing);
    expect(p).toMatchObject({ action: 'none', values: {}, keptExisting: ['bulkMultipleKg'] });
  });

  it('keys each farm to its own company', () => {
    const companies = new Map([['c2', company({ bagSizeKg: 25 })]]);
    const plans = planFarmOverrides([farm({ farmId: 'a', companyId: 'c1', bagSizeKg: 25 }), farm({ farmId: 'b', companyId: 'c2', bagSizeKg: 25 })], companies, new Map());
    expect(plans.map((p) => p.action)).toEqual(['insert', 'none']);
  });
});

describe('planLineRenumber — FEED requisition lines get 10000-steps in their existing order', () => {
  it('renumbers 1,2,3 to 10000,20000,30000 and leaves lines already on step alone', () => {
    const changes = planLineRenumber([
      { requisitionId: 'r1', lineId: 'a', lineSeq: 1 },
      { requisitionId: 'r1', lineId: 'b', lineSeq: 2 },
      { requisitionId: 'r2', lineId: 'c', lineSeq: 10000 },
      { requisitionId: 'r2', lineId: 'd', lineSeq: 20000 },
    ]);
    expect(changes).toEqual([
      { lineId: 'a', from: 1, to: 10000 },
      { lineId: 'b', from: 2, to: 20000 },
    ]);
  });

  it('keeps the existing order whatever order the rows arrive in, with line id breaking ties', () => {
    const changes = planLineRenumber([
      { requisitionId: 'r1', lineId: 'z', lineSeq: 5 },
      { requisitionId: 'r1', lineId: 'a', lineSeq: 5 },
      { requisitionId: 'r1', lineId: 'm', lineSeq: 2 },
    ]);
    expect(changes).toEqual([
      { lineId: 'm', from: 2, to: 10000 },
      { lineId: 'a', from: 5, to: 20000 },
      { lineId: 'z', from: 5, to: 30000 },
    ]);
  });

  it('returns nothing when there are no lines', () => {
    expect(planLineRenumber([])).toEqual([]);
  });
});
