import { CONSOLIDATION_NEXT_ACTION_LABEL, CONSOLIDATION_STATUS_LABEL, LOADING_STATUS_LABEL, PRIORITY_LABEL, REQ_STATUS_LABEL, humanizeCode, labelOf, variantOf, requisitionOrigin } from '../src/components/console/inventory/requisition-labels';
import { translations } from '../src/utils/translations';

const t = (key: string) => `T:${key}`;

describe('requisition labels — no raw codes on screen (review A8)', () => {
  it('labels known codes through t() and humanizes unknown ones', () => {
    expect(labelOf(REQ_STATUS_LABEL, 'PENDING_APPROVAL', t)).toBe('T:reqStatusPending');
    expect(labelOf(PRIORITY_LABEL, 'CRITICAL_FIRST_PRIORITY', t)).toBe('T:prioUrgent');
    expect(labelOf(REQ_STATUS_LABEL, 'ON_HOLD_BY_MILL', t)).toBe('On Hold By Mill');
    expect(labelOf(REQ_STATUS_LABEL, null, t)).toBe('T:labelNotSet');
    expect(humanizeCode('FEED_FORECAST')).toBe('Feed Forecast');
  });
  it('colours status and priority badges', () => {
    expect(variantOf(REQ_STATUS_LABEL, 'APPROVED')).toBe('success');
    expect(variantOf(REQ_STATUS_LABEL, 'REJECTED')).toBe('danger');
    expect(variantOf(PRIORITY_LABEL, 'WARNING')).toBe('warning');
    expect(variantOf(PRIORITY_LABEL, 'SOMETHING')).toBe('neutral');
  });
});

describe('F5 — the requisition header says where it came from once', () => {
  const t = (key: string) => ({
    reqTypeForecast: 'From forecast', reqTypeManual: 'Manual',
    reqSourceForecast: 'Forecast', reqSourceManual: 'Manual entry',
    reqSourceStockTake: 'Stock take', reqSourceDietChange: 'Diet change',
  } as Record<string, string>)[key] ?? key;

  it('drops the source when it only repeats the type', () => {
    expect(requisitionOrigin('FEED_FORECAST', 'AUTO_FORECAST', t as any)).toBe('From forecast');
    expect(requisitionOrigin('MANUAL', 'MANUAL_ENTRY', t as any)).toBe('Manual');
  });

  it('keeps a source that says something the type does not', () => {
    expect(requisitionOrigin('FEED_FORECAST', 'STOCK_TAKE_TRIGGERED', t as any)).toBe('From forecast · Stock take');
    expect(requisitionOrigin('FEED_FORECAST', 'DIET_CHANGE_UPCOMING', t as any)).toBe('From forecast · Diet change');
  });

  it('falls back to the type alone when there is no source', () => {
    expect(requisitionOrigin('MANUAL', null, t as any)).toBe('Manual');
  });
});

describe('W3 — consolidation and loading status maps', () => {
  it('labels the in-consolidation requisition status', () => {
    expect(labelOf(REQ_STATUS_LABEL, 'IN_CONSOLIDATION', t)).toBe('T:reqStatusInConsolidation');
    expect(variantOf(REQ_STATUS_LABEL, 'IN_CONSOLIDATION')).toBe('info');
  });
  it('labels every consolidation status', () => {
    for (const c of ['DRAFT', 'REVIEWED', 'CONSOLIDATED', 'CANCELLED']) expect(labelOf(CONSOLIDATION_STATUS_LABEL, c, t)).not.toBe(humanizeCode(c));
    expect(variantOf(CONSOLIDATION_STATUS_LABEL, 'CONSOLIDATED')).toBe('success');
    expect(variantOf(CONSOLIDATION_STATUS_LABEL, 'REVIEWED')).toBe('info');
  });
  it('uses one translation key per consolidation word (no duplicates)', () => {
    expect(labelOf(CONSOLIDATION_STATUS_LABEL, 'DRAFT', t)).toBe('T:fcsStatusDraft');
    expect(labelOf(CONSOLIDATION_STATUS_LABEL, 'CONSOLIDATED', t)).toBe('T:fcsStatusConsolidated');
    expect(labelOf(CONSOLIDATION_STATUS_LABEL, 'REVIEWED', t)).toBe('T:consolStatusReviewed');
    expect(labelOf(CONSOLIDATION_NEXT_ACTION_LABEL, 'TRANSFER_SHIPMENT', t)).toBe('T:rqdNextActionShipment');
    const en = translations.en as Record<string, string>;
    for (const k of ['rqdConsolStatusReviewed', 'consolStatusDraft', 'consolStatusConsolidated', 'rqTypeItem']) expect(en[k]).toBeUndefined();
  });
  it('labels every loading status', () => {
    for (const c of ['DRAFT', 'LOADED', 'DISPATCHED', 'RECEIVED']) expect(labelOf(LOADING_STATUS_LABEL, c, t)).toMatch(/^T:/);
    expect(variantOf(LOADING_STATUS_LABEL, 'DISPATCHED')).toBe('warning');
    expect(variantOf(LOADING_STATUS_LABEL, 'RECEIVED')).toBe('success');
  });
});
