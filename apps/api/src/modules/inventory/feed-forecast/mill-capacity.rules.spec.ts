import { allocateMillCapacity, buildCompareReport, capacityBreaches, capacityStatus, isoWeekDates, MillCapacitySetup, MillDietSchedule } from './mill-capacity.rules';

// Workbook "Feed Forecast" r11 and "Feed Forecast Engine" r42–r43. The mill's
// capacity is the MILL location's (decision 2026-10-05); the diet priority and
// loading BIN are the BIN Diet Assignment for the production date.
const mill: MillCapacitySetup = {
  millId: 'mill-1', millCode: 'MILL-001',
  dailyKg: 238_000, hourlyKg: 9_916.67, bulkKg: 178_000, baggedKg: 60_000,
};
const schedule = (itemId: string, priority: number, feedForm: 'BULK' | 'BAGGED' = 'BULK', binCode = `BIN-${itemId}`): MillDietSchedule => ({
  itemId, millId: 'mill-1', feedForm, priority, binId: `bin-${itemId}`, binCode,
});

describe('capacityStatus (Engine r43)', () => {
  it('is GREEN below 90%, AMBER from 90% to 100% inclusive, RED above capacity', () => {
    expect(capacityStatus(12_000, 20_000)).toBe('GREEN');
    expect(capacityStatus(17_999, 20_000)).toBe('GREEN');
    expect(capacityStatus(18_000, 20_000)).toBe('AMBER');
    expect(capacityStatus(20_000, 20_000)).toBe('AMBER');
    expect(capacityStatus(21_000, 20_000)).toBe('RED');
  });

  it('treats no demand as GREEN and any demand against nothing left as RED', () => {
    expect(capacityStatus(0, 0)).toBe('GREEN');
    expect(capacityStatus(1, 0)).toBe('RED');
  });
});

describe('allocateMillCapacity (Engine r42, Feed Forecast r11)', () => {
  it('gives the highest-priority diet the whole pool and each next diet what is left', () => {
    const result = allocateMillCapacity({
      mills: [mill],
      schedules: [schedule('d1', 1), schedule('d2', 2), schedule('d3', 3)],
      demands: [{ itemId: 'd1', demandKg: 100_000 }, { itemId: 'd2', demandKg: 70_000 }, { itemId: 'd3', demandKg: 20_000 }],
    });
    expect(result.get('d1')).toMatchObject({ state: 'AVAILABLE', availableKg: 178_000, demandKg: 100_000, status: 'GREEN', priority: 1, millCode: 'MILL-001' });
    expect(result.get('d2')).toMatchObject({ availableKg: 78_000, status: 'GREEN' });
    expect(result.get('d3')).toMatchObject({ availableKg: 8_000, status: 'RED' });
  });

  it('allocates bulk and bagged diets from their own daily allocations', () => {
    const result = allocateMillCapacity({
      mills: [mill],
      schedules: [schedule('bulk', 1, 'BULK'), schedule('bag', 1, 'BAGGED')],
      demands: [{ itemId: 'bulk', demandKg: 170_000 }, { itemId: 'bag', demandKg: 55_000 }],
    });
    expect(result.get('bulk')).toMatchObject({ availableKg: 178_000, feedForm: 'BULK', status: 'AMBER' });
    expect(result.get('bag')).toMatchObject({ availableKg: 60_000, feedForm: 'BAGGED', status: 'AMBER' });
  });

  it('produces the highest demand first when two diets share a priority (r11)', () => {
    const result = allocateMillCapacity({
      mills: [{ ...mill, bulkKg: 10_000 }],
      schedules: [schedule('small', 1), schedule('large', 1)],
      demands: [{ itemId: 'small', demandKg: 3_000 }, { itemId: 'large', demandKg: 8_000 }],
    });
    expect(result.get('large')).toMatchObject({ availableKg: 10_000, status: 'GREEN' });
    expect(result.get('small')).toMatchObject({ availableKg: 2_000, status: 'RED' });
  });

  it('uses a diet\'s best priority when it is assigned to more than one BIN that day', () => {
    const result = allocateMillCapacity({
      mills: [{ ...mill, bulkKg: 10_000 }],
      schedules: [schedule('a', 3, 'BULK', 'BIN-A1'), schedule('a', 1, 'BULK', 'BIN-A2'), schedule('b', 2)],
      demands: [{ itemId: 'a', demandKg: 6_000 }, { itemId: 'b', demandKg: 6_000 }],
    });
    expect(result.get('a')).toMatchObject({ availableKg: 10_000, priority: 1, binCode: 'BIN-A2' });
    expect(result.get('b')).toMatchObject({ availableKg: 4_000, status: 'RED' });
  });

  it('sums demand rows for the same diet', () => {
    const result = allocateMillCapacity({
      mills: [{ ...mill, bulkKg: 20_000 }],
      schedules: [schedule('d1', 1)],
      demands: [{ itemId: 'd1', demandKg: 6_000 }, { itemId: 'd1', demandKg: 9_000 }],
    });
    expect(result.get('d1')).toMatchObject({ demandKg: 15_000, availableKg: 20_000, status: 'GREEN' });
  });

  it('reports a diet with demand but no BIN assignment as not scheduled, never as 0 KG', () => {
    const result = allocateMillCapacity({ mills: [mill], schedules: [], demands: [{ itemId: 'd9', demandKg: 5_000 }] });
    expect(result.get('d9')).toEqual(expect.objectContaining({ state: 'NOT_SCHEDULED', availableKg: null, status: null, demandKg: 5_000 }));
  });

  it('reports a scheduled diet whose MILL has no capacity as not configured', () => {
    const result = allocateMillCapacity({
      mills: [{ ...mill, dailyKg: null, bulkKg: null, baggedKg: null }],
      schedules: [schedule('d1', 1)],
      demands: [{ itemId: 'd1', demandKg: 5_000 }],
    });
    expect(result.get('d1')).toEqual(expect.objectContaining({ state: 'NOT_CONFIGURED', availableKg: null, status: null, millCode: 'MILL-001' }));
  });

  it('lists scheduled diets with no demand at their full remaining capacity', () => {
    const result = allocateMillCapacity({
      mills: [{ ...mill, bulkKg: 20_000 }],
      schedules: [schedule('d1', 1), schedule('d2', 2)],
      demands: [{ itemId: 'd1', demandKg: 12_000 }],
    });
    expect(result.get('d2')).toMatchObject({ demandKg: 0, availableKg: 8_000, status: 'GREEN' });
  });

  it('ignores negative or non-numeric demand rather than inventing capacity', () => {
    const result = allocateMillCapacity({
      mills: [{ ...mill, bulkKg: 20_000 }],
      schedules: [schedule('d1', 1), schedule('d2', 2)],
      demands: [{ itemId: 'd1', demandKg: -5_000 }, { itemId: 'd2', demandKg: Number.NaN }],
    });
    expect(result.get('d1')).toMatchObject({ demandKg: 0, availableKg: 20_000 });
    expect(result.get('d2')).toMatchObject({ demandKg: 0, availableKg: 20_000 });
  });
});

describe('buildCompareReport (Feed Forecast r11, Checkpoint 34)', () => {
  const diets = new Map([
    ['d1', { itemId: 'd1', itemCode: 'FEED-R1', itemName: 'Diet 1', dietNo: 1 }],
    ['d4', { itemId: 'd4', itemCode: 'FEED-R4', itemName: 'Diet 4', dietNo: 4 }],
    ['other', { itemId: 'other', itemCode: 'FEED-X', itemName: 'Other mill diet', dietNo: 7 }],
  ]);
  const smallMill = { ...mill, dailyKg: 30_000, bulkKg: 20_000, baggedKg: 10_000 };

  it('compares all farms\' requested KG and mill-approved KG with capacity per diet and totals them', () => {
    const report = buildCompareReport({
      mill: smallMill,
      dates: ['2026-09-27'],
      schedulesByDate: new Map([['2026-09-27', [schedule('d1', 1), schedule('d4', 2)]]]),
      demand: [
        { productionDate: '2026-09-27', farmId: 'GRS', itemId: 'd1', requestedKg: 6_000, millApprovedKg: 6_000 },
        { productionDate: '2026-09-27', farmId: 'MUL', itemId: 'd1', requestedKg: 15_000, millApprovedKg: null },
        { productionDate: '2026-09-27', farmId: 'GRS', itemId: 'd4', requestedKg: 9_000, millApprovedKg: 8_000 },
      ],
      diets,
    });
    expect(report.rows).toEqual([
      expect.objectContaining({ itemCode: 'FEED-R1', farmCount: 2, requestedKg: 21_000, millApprovedKg: 6_000, availableKg: 20_000, status: 'RED' }),
      expect.objectContaining({ itemCode: 'FEED-R4', farmCount: 1, requestedKg: 9_000, millApprovedKg: 8_000, availableKg: 0, status: 'RED' }),
    ]);
    expect(report.total).toEqual({ requestedKg: 30_000, millApprovedKg: 14_000, capacityKg: 30_000, status: 'AMBER' });
  });

  it('allocates each day of a week separately and multiplies the daily capacity for the total', () => {
    const dates = isoWeekDates('2026-10-11');
    expect(dates).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    const report = buildCompareReport({
      mill: smallMill, dates,
      schedulesByDate: new Map([['2026-10-10', [schedule('d1', 1)]], ['2026-10-11', [schedule('d1', 1)]]]),
      demand: [{ productionDate: '2026-10-11', farmId: 'MUL', itemId: 'd1', requestedKg: 6_050, millApprovedKg: 6_000 }],
      diets,
    });
    expect(report.rows.map((row) => [row.productionDate, row.requestedKg, row.availableKg])).toEqual([
      ['2026-10-10', 0, 20_000],
      ['2026-10-11', 6_050, 20_000],
    ]);
    expect(report.total.capacityKg).toBe(210_000);
  });

  it('leaves a diet scheduled only on another MILL to that MILL, and shows unscheduled demand as not scheduled', () => {
    const report = buildCompareReport({
      mill: smallMill, dates: ['2026-09-27'],
      schedulesByDate: new Map([['2026-09-27', [{ ...schedule('other', 1), millId: 'mill-2' }]]]),
      demand: [
        { productionDate: '2026-09-27', farmId: 'GRS', itemId: 'other', requestedKg: 1_000, millApprovedKg: null },
        { productionDate: '2026-09-27', farmId: 'GRS', itemId: 'd4', requestedKg: 2_000, millApprovedKg: null },
      ],
      diets,
    });
    expect(report.rows).toEqual([expect.objectContaining({ itemCode: 'FEED-R4', state: 'NOT_SCHEDULED', availableKg: null, status: null })]);
  });
});

describe('capacityBreaches (Checkpoint 42)', () => {
  it('names only the requested diets that are above their available capacity', () => {
    const allocation = allocateMillCapacity({
      mills: [{ ...mill, bulkKg: 10_000 }],
      schedules: [schedule('d1', 1), schedule('d2', 2)],
      demands: [{ itemId: 'd1', demandKg: 8_000 }, { itemId: 'd2', demandKg: 3_000 }, { itemId: 'd3', demandKg: 50_000 }],
    });
    expect(capacityBreaches(allocation, ['d1', 'd2', 'd3']).map((row) => row.itemId)).toEqual(['d2']);
    expect(capacityBreaches(allocation, ['d1'])).toEqual([]);
  });
});
