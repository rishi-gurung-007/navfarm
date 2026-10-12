import { plannedIncomingFromRequisitions, type PlannedFeedRequisitionRow } from './feed-forecast.service';

const approved = (over: Partial<PlannedFeedRequisitionRow> = {}): PlannedFeedRequisitionRow => ({
  requisition_id: 'req-1',
  req_no: 'REQ-GRA100-2026-00001',
  status: 'APPROVED',
  approval_status: 'APPROVED',
  document_status: 'OPEN',
  required_date: '2026-10-10',
  item_id: 'feed-1',
  destination_location_id: 'silo-1',
  quantity: '3000.0000',
  proposed_delivery_date: null,
  recommended_delivery_date: null,
  transfer_link_id: null,
  ...over,
});

describe('planned incoming feed requisitions', () => {
  it('maps approved, open, unlinked feed demand to its destination, item and delivery date', () => {
    expect(plannedIncomingFromRequisitions([approved()], '2026-10-08', '2026-10-20')).toEqual([{
      locationId: 'silo-1', itemId: 'feed-1', date: '2026-10-10', kg: 3000,
      kind: 'PLANNED_REQUISITION', referenceId: 'req-1', referenceNo: 'REQ-GRA100-2026-00001',
      expectedDate: '2026-10-10', overdue: false,
    }]);
  });

  it('clamps an overdue approved delivery to the stock date and retains its reference', () => {
    expect(plannedIncomingFromRequisitions([
      approved({ proposed_delivery_date: '2026-10-05' }),
    ], '2026-10-08', '2026-10-20')[0]).toMatchObject({
      date: '2026-10-08', overdue: true, referenceNo: 'REQ-GRA100-2026-00001',
    });
  });

  it('accepts legacy approved rows whose approval_status was left OPEN', () => {
    expect(plannedIncomingFromRequisitions([
      approved({ approval_status: 'OPEN' }),
    ], '2026-10-08', '2026-10-20')).toHaveLength(1);
  });

  it('excludes pending, rejected, cancelled, out-of-horizon and already-linked requisitions', () => {
    const rows = [
      approved({ approval_status: 'PENDING_APPROVAL' }),
      approved({ requisition_id: 'req-2', approval_status: 'REJECTED' }),
      approved({ requisition_id: 'req-3', document_status: 'CANCELLED' }),
      approved({ requisition_id: 'req-4', required_date: '2026-11-01' }),
      approved({ requisition_id: 'req-5', transfer_link_id: 'link-1' }),
    ];
    expect(plannedIncomingFromRequisitions(rows, '2026-10-08', '2026-10-20')).toEqual([]);
  });

  it('gives explicit transfer linkage precedence even before shipment or receipt', () => {
    expect(plannedIncomingFromRequisitions([
      approved({ transfer_link_id: 'link-created-for-this-requisition' }),
    ], '2026-10-08', '2026-10-20')).toEqual([]);
  });
});
