import { countedRequisitions, requisitionCover } from '../src/components/console/inventory/requisition-cover';

describe('requisition cover in the Calculation (Rishi, 31 Oct)', () => {
  const source = { locationId: 'silo-1', sourceCode: 'MGH6-G2', itemId: 'grower', itemName: 'Grower 2', shortfallKg: 2500, shortageDate: '2026-11-09' };
  const open = { requisition_id: 'r5', req_no: 'REQ-5', destination_location_id: 'silo-1', item_id: 'grower', quantity: 3000, proposed_delivery_date: '2026-11-07' };
  it('matches the API rule: enough, in time, same silo and feed, not already counted', () => {
    expect(requisitionCover(source, [open], countedRequisitions([]))).toEqual({ covered: true, by: ['REQ-5'] });
    expect(requisitionCover(source, [{ ...open, proposed_delivery_date: '2026-11-10' }], countedRequisitions([])).covered).toBe(false);
    expect(requisitionCover(source, [open], countedRequisitions([{ incomingReferences: [{ kind: 'PLANNED_REQUISITION', referenceId: 'r5' }] }])).covered).toBe(false);
  });
});
