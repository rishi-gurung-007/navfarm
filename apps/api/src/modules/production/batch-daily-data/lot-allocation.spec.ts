import { allocateAcrossLots, orderLots, parseLotList, type LotStock } from './lot-allocation';

const lot = (lot_no: string, remaining: number, expiry_date: string | null, receipt_date: string): LotStock => ({ lot_no, remaining, expiry_date, receipt_date });
const TODAY = '2026-10-08';

describe('lot allocation', () => {
  it('takes 12 from lots of 10 and 6 as 10 then 2, in expiry order', () => {
    const lots = [lot('B', 6, '2027-08-01', '2026-10-02'), lot('A', 10, '2027-06-01', '2026-10-01')];
    expect(allocateAcrossLots(lots, 12, TODAY)).toEqual({ allocations: [{ lot_no: 'A', quantity: 10 }, { lot_no: 'B', quantity: 2 }], shortBy: 0 });
  });

  it('uses only the first lot when it covers the quantity, and leaves the others untouched', () => {
    const lots = [lot('A', 10, '2027-06-01', '2026-10-01'), lot('B', 6, '2027-08-01', '2026-10-02')];
    expect(allocateAcrossLots(lots, 4, TODAY).allocations).toEqual([{ lot_no: 'A', quantity: 4 }]);
  });

  it('reports what the ticked lots cannot cover', () => {
    const lots = [lot('A', 10, null, '2026-10-01'), lot('B', 6, null, '2026-10-02')];
    expect(allocateAcrossLots(lots, 18, TODAY)).toEqual({ allocations: [{ lot_no: 'A', quantity: 10 }, { lot_no: 'B', quantity: 6 }], shortBy: 2 });
  });

  it('orders usable lots by expiry, then receipt, and expired lots last', () => {
    const lots = [
      lot('EXPIRED', 5, '2026-01-01', '2025-01-01'),
      lot('NOEXP', 5, null, '2026-09-01'),
      lot('LATE', 5, '2027-12-01', '2026-01-01'),
      lot('SOON-OLD', 5, '2027-01-01', '2026-02-01'),
      lot('SOON-NEW', 5, '2027-01-01', '2026-03-01'),
    ];
    expect(orderLots(lots, TODAY).map((l) => l.lot_no)).toEqual(['SOON-OLD', 'SOON-NEW', 'LATE', 'NOEXP', 'EXPIRED']);
  });

  it('never over-draws a lot and ignores empty ones', () => {
    const lots = [lot('A', 0, null, '2026-10-01'), lot('B', 3.5, null, '2026-10-02')];
    expect(allocateAcrossLots(lots, 3.5, TODAY).allocations).toEqual([{ lot_no: 'B', quantity: 3.5 }]);
  });

  it('parses one lot or a comma list, without duplicates', () => {
    expect(parseLotList('LOT1')).toEqual(['LOT1']);
    expect(parseLotList(' LOT1, LOT2 ,LOT1')).toEqual(['LOT1', 'LOT2']);
    expect(parseLotList(undefined)).toEqual([]);
  });
});
