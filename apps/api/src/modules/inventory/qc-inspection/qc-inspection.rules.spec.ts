import {
  decideOutcome, dispositionsFor, judgeLine, lineNumber, resolveDisposition, settleProblem, specLineProblem, specProblems, specRowsToStore,
} from './qc-inspection.rules';

const valueSpec = { measurement_code: 'C', sampling_type: 'VALUE', min_value: '2', max_value: '4', is_mandatory: true };
const textSpec = { measurement_code: 'Radiation', sampling_type: 'DESCRIPTIVE', min_value: null, max_value: null, is_mandatory: true };

describe('specLineProblem', () => {
  it("keeps an item's Target Value inside its own Min..Max", () => {
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: 'M', min_value: 11, max_value: 13, target_value: 12 })).toBeNull();
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: 'M', min_value: 11, max_value: 13, target_value: 14 })).toMatch(/above Max/);
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: 'M', min_value: 11, target_value: 10 })).toMatch(/below Min/);
  });

  it('accepts a Value check with a range and a Descriptive check with its rule', () => {
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: 'C', min_value: 2, max_value: 4 })).toBeNull();
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: 'S', max_value: 0.05 })).toBeNull();
    expect(specLineProblem({ sampling_type: 'DESCRIPTIVE', measurement_code: 'Size', measurement_description: 'Even grain' })).toBeNull();
  });

  it('refuses the 0/0 and empty rows Business Central allowed', () => {
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: 'C' })).toMatch(/Min Value, a Max Value/);
    expect(specLineProblem({ sampling_type: 'DESCRIPTIVE', measurement_code: 'Size' })).toMatch(/Description/);
    expect(specLineProblem({ sampling_type: 'DESCRIPTIVE', measurement_code: 'Size', measurement_description: '  ' })).toMatch(/Description/);
  });

  it('refuses an inverted range and an unknown type', () => {
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: 'C', min_value: 5, max_value: 4 })).toMatch(/cannot be greater/);
    expect(specLineProblem({ sampling_type: 'GRADE', measurement_code: 'C' })).toMatch(/VALUE or DESCRIPTIVE/);
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: ' ', min_value: 1 })).toMatch(/QC Code/);
  });

  it('accepts a range whose lower bound is zero', () => {
    expect(specLineProblem({ sampling_type: 'VALUE', measurement_code: 'P', min_value: 0, max_value: 0.1 })).toBeNull();
  });
});

describe('specProblems and specRowsToStore', () => {
  it('reports every problem and a QC Code used twice, ignoring an inactive duplicate', () => {
    expect(specProblems([
      { sampling_type: 'VALUE', measurement_code: 'C', min_value: 1 },
      { sampling_type: 'VALUE', measurement_code: 'c', max_value: 2 },
      { sampling_type: 'DESCRIPTIVE', measurement_code: 'Size' },
    ])).toEqual([expect.stringMatching(/appears twice/), expect.stringMatching(/Description/)]);
    expect(specProblems([
      { sampling_type: 'VALUE', measurement_code: 'C', min_value: 1 },
      { sampling_type: 'VALUE', measurement_code: 'C', max_value: 2, is_active: false },
    ])).toEqual([]);
  });

  it('stores a Value check with its range and a Descriptive one with its description as the rule', () => {
    let n = 0;
    const rows = specRowsToStore(
      [
        { sampling_type: 'VALUE', measurement_code: ' C ', measurement_description: 'Carbon', min_value: 2, max_value: 4, acceptance_text: 'ignored' },
        { sampling_type: 'DESCRIPTIVE', measurement_code: 'Size', measurement_description: ' Even grain ', min_value: 9 },
      ],
      { tenantId: 't', companyId: 'c', itemId: 'i', userId: 'u', newId: () => `id${++n}` },
    );
    expect(rows[0]).toMatchObject({ spec_line_id: 'id1', line_no: 10000, stage: 'INCOMING', measurement_code: 'C', min_value: '2', max_value: '4', acceptance_text: null, is_mandatory: true });
    expect(rows[1]).toMatchObject({ line_no: 20000, measurement_description: 'Even grain', acceptance_text: 'Even grain', min_value: null, max_value: null });
  });
});

describe('judgeLine', () => {
  it('judges a Value reading against the range, edges included', () => {
    expect(judgeLine(valueSpec, { actual_value: 2 })?.result).toBe('PASS');
    expect(judgeLine(valueSpec, { actual_value: 4 })?.result).toBe('PASS');
    expect(judgeLine(valueSpec, { actual_value: 1.99 })?.result).toBe('FAIL');
    expect(judgeLine(valueSpec, { actual_value: 4.01 })?.result).toBe('FAIL');
  });

  it('ignores a verdict typed against a Value check: the reading decides', () => {
    expect(judgeLine(valueSpec, { actual_value: 9, result: 'PASS' })?.result).toBe('FAIL');
  });

  it('judges one-sided ranges', () => {
    const maxOnly = { ...valueSpec, min_value: null, max_value: '0.05' };
    expect(judgeLine(maxOnly, { actual_value: 0 })?.result).toBe('PASS');
    expect(judgeLine(maxOnly, { actual_value: 0.06 })?.result).toBe('FAIL');
  });

  it('takes the inspector verdict for a Descriptive check', () => {
    expect(judgeLine(textSpec, { result: 'PASS', actual_text: 'Below limit' })).toEqual({ result: 'PASS', actual_value: null, actual_text: 'Below limit' });
    expect(judgeLine(textSpec, { result: 'FAIL' })?.result).toBe('FAIL');
  });

  it('returns null where nothing usable was entered', () => {
    expect(judgeLine(valueSpec, undefined)).toBeNull();
    expect(judgeLine(valueSpec, {})).toBeNull();
    expect(judgeLine(textSpec, { actual_text: 'looks fine' })).toBeNull();
    expect(judgeLine(textSpec, { result: 'MAYBE' })).toBeNull();
  });
});

describe('decideOutcome', () => {
  const pass = [{ code: 'C', is_mandatory: true, result: 'PASS' as const }];
  const fail = [{ code: 'C', is_mandatory: true, result: 'FAIL' as const }];
  const base = { quantity: 100, acceptedQty: 100, rejectedQty: 0, deviation: false, hasReason: false };

  it('passes and posts the accepted quantity', () => {
    expect(decideOutcome({ ...base, lines: pass })).toEqual({ outcome: { result: 'PASS', status: 'CLOSED', postNow: 100, postOnApproval: 0 } });
  });

  it('posts only the accepted part of a passing inspection and wants a reason for the rest', () => {
    expect(decideOutcome({ ...base, acceptedQty: 90, rejectedQty: 10, lines: pass })).toEqual({ error: expect.stringMatching(/Reason Code/) });
    expect(decideOutcome({ ...base, acceptedQty: 90, rejectedQty: 10, hasReason: true, lines: pass })).toEqual({
      outcome: { result: 'PASS', status: 'CLOSED', postNow: 90, postOnApproval: 0 },
    });
  });

  it('refuses quantities that do not add up to what was received', () => {
    expect(decideOutcome({ ...base, acceptedQty: 90, lines: pass })).toEqual({ error: expect.stringMatching(/must equal the quantity received/) });
    expect(decideOutcome({ ...base, acceptedQty: 110, rejectedQty: -10, lines: pass })).toEqual({ error: expect.stringMatching(/negative/) });
  });

  it('refuses a sample larger than the lot', () => {
    expect(decideOutcome({ ...base, sampleQty: 101, lines: pass })).toEqual({ error: expect.stringMatching(/Sample Qty/) });
  });

  it('will not complete while a mandatory check has no result, but ignores an optional one', () => {
    const lines = [...pass, { code: 'Ni', is_mandatory: true, result: null }];
    expect(decideOutcome({ ...base, lines })).toEqual({ error: expect.stringMatching(/Missing: Ni/) });
    expect(decideOutcome({ ...base, lines: [...pass, { code: 'Si', is_mandatory: false, result: null }] })).toHaveProperty('outcome');
  });

  it('a failed optional check does not fail the lot', () => {
    expect(decideOutcome({ ...base, lines: [...pass, { code: 'Si', is_mandatory: false, result: 'FAIL' }] })).toHaveProperty('outcome.result', 'PASS');
  });

  it('a failure rejects everything and posts nothing', () => {
    expect(decideOutcome({ ...base, acceptedQty: 0, rejectedQty: 100, hasReason: true, lines: fail })).toEqual({
      outcome: { result: 'FAIL', status: 'CLOSED', postNow: 0, postOnApproval: 0 },
    });
  });

  it('a failure cannot accept stock without a deviation, and needs a reason', () => {
    expect(decideOutcome({ ...base, lines: fail })).toEqual({ error: expect.stringMatching(/cannot accept stock/) });
    expect(decideOutcome({ ...base, acceptedQty: 0, rejectedQty: 100, lines: fail })).toEqual({ error: expect.stringMatching(/Reason Code/) });
  });

  it('a deviation waits for approval and posts nothing yet', () => {
    expect(decideOutcome({ ...base, acceptedQty: 60, rejectedQty: 40, deviation: true, hasReason: true, lines: fail })).toEqual({
      outcome: { result: 'DEVIATION', status: 'PENDING_APPROVAL', postNow: 0, postOnApproval: 60 },
    });
  });

  it('a deviation needs a reason and something to accept', () => {
    expect(decideOutcome({ ...base, deviation: true, lines: fail })).toEqual({ error: expect.stringMatching(/Reason Code/) });
    expect(decideOutcome({ ...base, acceptedQty: 0, rejectedQty: 100, deviation: true, hasReason: true, lines: fail })).toEqual({ error: expect.stringMatching(/Accepted Qty/) });
  });

  it('a deviation flag on a passing inspection changes nothing', () => {
    expect(decideOutcome({ ...base, deviation: true, lines: pass })).toHaveProperty('outcome.status', 'CLOSED');
  });
});

describe('dispositionsFor', () => {
  it('offers a return to the supplier only on a goods receipt, and a transfer only its return to the sender', () => {
    expect(dispositionsFor('GOODS_RECEIPT')).toEqual(['RETURN_TO_SUPPLIER', 'SCRAP', 'HOLD']);
    expect(dispositionsFor('SEMEN_COLLECTION')).toEqual(['SCRAP', 'HOLD']);
    expect(dispositionsFor('TRANSFER_RECEIPT')).toEqual(['RETURN_TO_SOURCE']);
    expect(dispositionsFor('TRANSFER_EVENT')).toEqual(['RETURN_TO_SOURCE']);
  });
});

describe('resolveDisposition', () => {
  it('stores nothing when nothing is rejected, whatever was sent', () => {
    expect(resolveDisposition({ sourceDocType: 'GOODS_RECEIPT', rejectedQty: 0, disposition: 'SCRAP', ref: 'DN-1' })).toEqual({ disposition: null, ref: null });
  });

  it('needs a disposition for a rejected quantity on a receipt or a collection', () => {
    expect(resolveDisposition({ sourceDocType: 'GOODS_RECEIPT', rejectedQty: 10 })).toEqual({ error: expect.stringMatching(/Return to supplier or Scrap or Hold/) });
    expect(resolveDisposition({ sourceDocType: 'SEMEN_COLLECTION', rejectedQty: 2, disposition: '' })).toEqual({ error: expect.stringMatching(/Scrap or Hold/) });
  });

  it('keeps the chosen disposition and a trimmed reference', () => {
    expect(resolveDisposition({ sourceDocType: 'GOODS_RECEIPT', rejectedQty: 10, disposition: 'RETURN_TO_SUPPLIER', ref: '  DN-0042 ' })).toEqual({ disposition: 'RETURN_TO_SUPPLIER', ref: 'DN-0042' });
    expect(resolveDisposition({ sourceDocType: 'SEMEN_COLLECTION', rejectedQty: 2, disposition: 'HOLD', ref: ' ' })).toEqual({ disposition: 'HOLD', ref: null });
  });

  it('refuses a return to a supplier where there is none, and RETURN_TO_SOURCE outside a transfer', () => {
    expect(resolveDisposition({ sourceDocType: 'SEMEN_COLLECTION', rejectedQty: 2, disposition: 'RETURN_TO_SUPPLIER' })).toEqual({ error: expect.stringMatching(/Return to supplier is not open/) });
    expect(resolveDisposition({ sourceDocType: 'GOODS_RECEIPT', rejectedQty: 2, disposition: 'RETURN_TO_SOURCE' })).toEqual({ error: expect.stringMatching(/not open/) });
    expect(resolveDisposition({ sourceDocType: 'GOODS_RECEIPT', rejectedQty: 2, disposition: 'BURN' })).toEqual({ error: expect.stringMatching(/BURN is not open/) });
  });

  it('records a transfer as returned to its sender, and refuses any other choice for it', () => {
    expect(resolveDisposition({ sourceDocType: 'TRANSFER_EVENT', rejectedQty: 5 })).toEqual({ disposition: 'RETURN_TO_SOURCE', ref: null });
    expect(resolveDisposition({ sourceDocType: 'TRANSFER_RECEIPT', rejectedQty: 5, disposition: 'SCRAP' })).toEqual({ error: expect.stringMatching(/location it was sent from/) });
  });
});

describe('settleProblem', () => {
  const held = { status: 'CLOSED', sourceDocType: 'GOODS_RECEIPT', rejectedQty: 10, current: 'HOLD', next: 'SCRAP' };

  it('settles a held rejection to a return or a scrap', () => {
    expect(settleProblem(held)).toBeNull();
    expect(settleProblem({ ...held, next: 'RETURN_TO_SUPPLIER' })).toBeNull();
  });

  it('settles a rejection closed before dispositions were recorded', () => {
    expect(settleProblem({ ...held, current: null })).toBeNull();
  });

  it('refuses holding it again, a settled one, an open inspection and one with nothing rejected', () => {
    expect(settleProblem({ ...held, next: 'HOLD' })).toMatch(/Return to supplier or Scrap/);
    expect(settleProblem({ ...held, current: 'SCRAP', next: 'RETURN_TO_SUPPLIER' })).toMatch(/already settled: Scrap/);
    expect(settleProblem({ ...held, status: 'PENDING_APPROVAL' })).toMatch(/closed inspection/);
    expect(settleProblem({ ...held, rejectedQty: 0 })).toMatch(/Nothing was rejected/);
  });

  it('offers a held collection only a scrap', () => {
    expect(settleProblem({ ...held, sourceDocType: 'SEMEN_COLLECTION', next: 'RETURN_TO_SUPPLIER' })).toMatch(/Choose Scrap\./);
  });
});

describe('lineNumber', () => {
  it('steps by 10000', () => {
    expect([0, 1, 2].map(lineNumber)).toEqual([10000, 20000, 30000]);
  });
});
