import { allocationPlan, lineMismatch, owedDoses, planRequestProblems, type RequestLine } from './semen-request.rules';

const line = (over: Partial<RequestLine>): RequestLine => ({
  line_id: 'l1', requisition_id: 'r1', req_no: 'RQ-1', breed_id: 'zl', approval_status: 'APPROVED', document_status: 'APPROVED',
  required_date: '2026-11-27', doses: 10, from_location_id: 'store-mul', released: true, lot_no: null, plan_id: null, ...over,
});

describe('planRequestProblems', () => {
  it('plans approved requests of the line', () => {
    expect(planRequestProblems([line({}), line({ line_id: 'l2', req_no: 'RQ-2' })], 'zl', 'Z-LINE')).toEqual([]);
  });
  it('refuses another line, an unapproved, a cancelled or an already planned request', () => {
    const p = planRequestProblems([
      line({ req_no: 'RQ-A', breed_id: 'll' }),
      line({ req_no: 'RQ-B', approval_status: 'OPEN' }),
      line({ req_no: 'RQ-C', document_status: 'CANCELLED' }),
      line({ req_no: 'RQ-D', plan_id: 'p9' }),
    ], 'zl', 'Z-LINE');
    expect(p).toEqual([
      'RQ-A asks for another breeding line, not Z-LINE.',
      'RQ-B is not approved yet.',
      'RQ-C is cancelled.',
      'RQ-D is already planned in another collection.',
    ]);
  });
});

describe('allocationPlan', () => {
  const lot = { lot_no: 'LOT-9', store_id: 'store-mul', doses: 25 };
  it('fills the earliest needed requests first, each whole, while doses last', () => {
    const r = allocationPlan([
      line({ line_id: 'late', req_no: 'RQ-3', required_date: '2026-11-30', doses: 10 }),
      line({ line_id: 'early', req_no: 'RQ-1', required_date: '2026-11-25', doses: 10 }),
      line({ line_id: 'mid', req_no: 'RQ-2', required_date: '2026-11-27', doses: 10 }),
    ], lot);
    expect(r.allocate.map((a) => a.line_id)).toEqual(['early', 'mid']);
    expect(r.skipped).toEqual([{ req_no: 'RQ-3', reason: 'needs 10 doses, 5 left in LOT-9' }]);
    expect(r.left).toBe(5);
  });
  it('lets a smaller later request use what a bigger one could not', () => {
    const r = allocationPlan([line({ line_id: 'big', req_no: 'RQ-1', doses: 30 }), line({ line_id: 'small', req_no: 'RQ-2', required_date: '2026-11-28', doses: 5 })], lot);
    expect(r.allocate.map((a) => a.line_id)).toEqual(['small']);
  });
  it('skips a request not released, from another store, or already given a lot', () => {
    const r = allocationPlan([
      line({ req_no: 'RQ-A', released: false }),
      line({ req_no: 'RQ-B', from_location_id: 'store-other' }),
      line({ req_no: 'RQ-C', lot_no: 'LOT-1' }),
    ], lot);
    expect(r.allocate).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/not released/), expect.stringMatching(/another store/), 'already has lot LOT-1']);
  });
});

describe('allocationPlan and a request that will not ship', () => {
  it('skips a cancelled or a not approved request instead of putting the lot on it', () => {
    const r = allocationPlan([
      line({ req_no: 'RQ-A', document_status: 'CANCELLED' }),
      line({ req_no: 'RQ-B', approval_status: 'REJECTED' }),
      line({ line_id: 'ok', req_no: 'RQ-C' }),
    ], { lot_no: 'LOT-9', store_id: 'store-mul', doses: 25 });
    expect(r.allocate.map((a) => a.line_id)).toEqual(['ok']);
    expect(r.skipped).toEqual([{ req_no: 'RQ-A', reason: 'is cancelled' }, { req_no: 'RQ-B', reason: 'is not approved' }]);
  });
});

describe('lineMismatch', () => {
  it('takes a request of the lot\'s own line', () => {
    expect(lineMismatch('zl', { breed_id: 'zl', breed_code: 'Z-LINE' })).toBeNull();
  });
  it('refuses a request of another line', () => {
    expect(lineMismatch('zl', { breed_id: 'll', breed_code: 'L-LINE' })).toBe("asks for L-LINE, not this lot's line");
  });
  it('refuses every request for a lot with no breeding line (it used to take any)', () => {
    expect(lineMismatch(null, { breed_id: 'zl', breed_code: 'Z-LINE' })).toBe('asks for Z-LINE; this lot has no breeding line');
  });
});

describe('owedDoses', () => {
  const p = (over: object = {}) => ({ doses: 10, shipped: 0, approval_status: 'APPROVED', document_status: 'RELEASED', ...over });
  it('counts what each promised request has not shipped yet', () => {
    expect(owedDoses([p(), p({ doses: 8, shipped: 3 }), p({ shipped: 10 })])).toBe(15);
  });
  it('gives back the doses of a cancelled or rejected request (they used to stay promised for good)', () => {
    expect(owedDoses([p(), p({ document_status: 'CANCELLED' }), p({ approval_status: 'REJECTED' })])).toBe(10);
  });
  it('never counts a request shipped beyond its doses as negative', () => {
    expect(owedDoses([p({ doses: 5, shipped: 6 }), p()])).toBe(10);
  });
});
