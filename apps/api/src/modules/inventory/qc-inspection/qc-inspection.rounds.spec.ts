import { completionPlan, roundDueDate, roundResult, roundsFor, roundToRecordProblem, type RoundState } from './qc-inspection.rules';

const five = (overrides: Partial<Record<number, Partial<RoundState>>> = {}): RoundState[] =>
  [0, 1, 2, 3, 4].map((n) => ({ round_no: n, due_date: roundDueDate('2026-11-23', n), status: 'PENDING', result: null, ...overrides[n] }));
const done = (result = 'PASS') => ({ status: 'DONE', result });

describe('roundsFor', () => {
  it("takes the item's rounds for the lot's own QC and one for a transfer receipt", () => {
    expect(roundsFor('SEMEN_COLLECTION', 5)).toBe(5);
    expect(roundsFor('GOODS_RECEIPT', 1)).toBe(1);
    expect(roundsFor('TRANSFER_RECEIPT', 5)).toBe(1);
    expect(roundsFor('TRANSFER_EVENT', 5)).toBe(1);
  });
  it('treats a missing or silly setting as one round, and caps it', () => {
    expect(roundsFor('SEMEN_COLLECTION', null)).toBe(1);
    expect(roundsFor('SEMEN_COLLECTION', 0)).toBe(1);
    expect(roundsFor('SEMEN_COLLECTION', 99)).toBe(10);
  });
});

describe('roundDueDate', () => {
  it('is the posting date + round_no days, across a month end', () => {
    expect(roundDueDate('2026-11-23', 0)).toBe('2026-11-23');
    expect(roundDueDate('2026-11-28', 4)).toBe('2026-12-02');
  });
});

describe('roundToRecordProblem', () => {
  it('records the first round on its day', () => {
    expect(roundToRecordProblem(five(), 0, '2026-11-23')).toBeNull();
  });
  it('refuses a round before its due date', () => {
    expect(roundToRecordProblem(five({ 0: done() }), 1, '2026-11-23')).toMatch(/due on 2026-11-24/);
  });
  it('records rounds in order', () => {
    expect(roundToRecordProblem(five({ 0: done() }), 2, '2026-11-30')).toMatch(/day 1 check .*first/);
  });
  it('leaves the last round to the completion', () => {
    expect(roundToRecordProblem(five({ 0: done(), 1: done(), 2: done(), 3: done() }), 4, '2026-11-30')).toMatch(/last/);
  });
  it('refuses a round recorded twice, and anything after a failure', () => {
    expect(roundToRecordProblem(five({ 0: done() }), 0, '2026-11-30')).toMatch(/already recorded/);
    expect(roundToRecordProblem(five({ 0: done(), 1: done('FAIL') }), 2, '2026-11-30')).toMatch(/already failed/);
  });
});

describe('completionPlan', () => {
  it('completes with the last round once every other round is done and the last is due', () => {
    expect(completionPlan(five({ 0: done(), 1: done(), 2: done(), 3: done() }), '2026-11-27')).toEqual({ completing: 4, cancel: [] });
  });
  it('refuses before the last round is due', () => {
    expect(completionPlan(five({ 0: done(), 1: done(), 2: done(), 3: done() }), '2026-11-26')).toEqual({ error: expect.stringMatching(/due on 2026-11-27/) });
  });
  it('refuses while an earlier round is not recorded', () => {
    expect(completionPlan(five({ 0: done() }), '2026-11-30')).toEqual({ error: expect.stringMatching(/day 1 check/) });
    expect(completionPlan(five(), '2026-11-30')).toEqual({ error: expect.stringMatching(/collection-day check/) });
  });
  it('completes at once after a failure and cancels the rounds to come', () => {
    expect(completionPlan(five({ 0: done(), 1: done('FAIL') }), '2026-11-24')).toEqual({ completing: null, cancel: [2, 3, 4] });
  });
});

describe('roundResult', () => {
  it('fails on a mandatory failure only', () => {
    expect(roundResult([{ is_mandatory: true, result: 'PASS' }, { is_mandatory: false, result: 'FAIL' }])).toBe('PASS');
    expect(roundResult([{ is_mandatory: true, result: 'FAIL' }])).toBe('FAIL');
  });
});
