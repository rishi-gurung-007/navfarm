import { farmRows, miniReport, requestRows, totalsOf, type RequestFact } from './ai-station-report.rules';

const req = (over: Partial<RequestFact>): RequestFact => ({
  line_id: 'l1', req_no: 'RQ-1', farm_id: 'por', farm_code: 'POR100', breed_id: 'zl', breed_code: 'Z', required_date: '2026-11-26',
  lot_no: 'LOT-1', to_store_id: 'store-por', status: 'RECEIVED', requested: 100, received: 90, pending_qc: 0, rejected: 0, ...over,
});

describe('requestRows', () => {
  it("gives the client's example: requested 100, received 90, used 70, destroyed 20", () => {
    const [row] = requestRows([req({})], [{ lot_no: 'LOT-1', store_id: 'store-por', used: 70, destroyed: 20 }]);
    expect(row).toMatchObject({ requested: 100, received: 90, used: 70, destroyed: 20, on_hand: 0, short: 10 });
    expect(miniReport(row)).toBe('Requested: 100, Received: 90, Used: 70, Destroyed: 20');
  });

  it('shares one lot at one store between requests, earliest needed first, each up to what it received', () => {
    const rows = requestRows(
      [req({ line_id: 'late', req_no: 'RQ-2', required_date: '2026-11-30', requested: 10, received: 10 }), req({ line_id: 'early', req_no: 'RQ-1', requested: 10, received: 10 })],
      [{ lot_no: 'LOT-1', store_id: 'store-por', used: 14, destroyed: 3 }],
    );
    expect(rows.map((r) => r.line_id)).toEqual(['late', 'early']);
    expect(rows[1]).toMatchObject({ used: 10, destroyed: 0, on_hand: 0 });
    expect(rows[0]).toMatchObject({ used: 4, destroyed: 3, on_hand: 3 });
  });

  it('counts doses held by the farm QC or refused by it apart from the short', () => {
    const [row] = requestRows([req({ received: 0, pending_qc: 60, rejected: 30 })], []);
    expect(row).toMatchObject({ received: 0, used: 0, on_hand: 0, short: 10 });
  });

  it('ignores use at another store, and a request with no lot yet', () => {
    const rows = requestRows([req({}), req({ line_id: 'l2', req_no: 'RQ-2', lot_no: null, received: 0 })], [{ lot_no: 'LOT-1', store_id: 'store-mul', used: 50, destroyed: 0 }]);
    expect(rows[0]).toMatchObject({ used: 0, on_hand: 90 });
    expect(rows[1]).toMatchObject({ used: 0, short: 100 });
  });
});

describe('totals and farms', () => {
  it('sums rows, and by farm', () => {
    const rows = requestRows([req({}), req({ line_id: 'l2', req_no: 'RQ-2', farm_id: 'gra', farm_code: 'GRA100', lot_no: null, received: 0, requested: 20 })], [{ lot_no: 'LOT-1', store_id: 'store-por', used: 70, destroyed: 20 }]);
    expect(totalsOf(rows)).toMatchObject({ requested: 120, received: 90, used: 70, destroyed: 20, short: 30 });
    expect(farmRows(rows).map((f) => [f.farm_code, f.requests, f.requested])).toEqual([['GRA100', 1, 20], ['POR100', 1, 100]]);
  });
});
