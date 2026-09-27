import { PRIORITY_LABEL, REQ_STATUS_LABEL, humanizeCode, labelOf, variantOf } from '../src/components/console/inventory/requisition-labels';

const t = (key: string) => `T:${key}`;

describe('requisition labels — no raw codes on screen (review A8)', () => {
  it('labels known codes through t() and humanizes unknown ones', () => {
    expect(labelOf(REQ_STATUS_LABEL, 'PENDING_APPROVAL', t)).toBe('T:reqStatusPending');
    expect(labelOf(PRIORITY_LABEL, 'CRITICAL_FIRST_PRIORITY', t)).toBe('T:prioUrgent');
    expect(labelOf(REQ_STATUS_LABEL, 'ON_HOLD_BY_MILL', t)).toBe('On Hold By Mill');
    expect(labelOf(REQ_STATUS_LABEL, null, t)).toBe('—');
    expect(humanizeCode('FEED_FORECAST')).toBe('Feed Forecast');
  });
  it('colours status and priority badges', () => {
    expect(variantOf(REQ_STATUS_LABEL, 'APPROVED')).toBe('success');
    expect(variantOf(REQ_STATUS_LABEL, 'REJECTED')).toBe('danger');
    expect(variantOf(PRIORITY_LABEL, 'WARNING')).toBe('warning');
    expect(variantOf(PRIORITY_LABEL, 'SOMETHING')).toBe('neutral');
  });
});
