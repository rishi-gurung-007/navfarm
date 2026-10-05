/**
 * Task 8 — common requisition document rules (pure, no database).
 *
 * The field rules here follow Rishi's requisition specification as recorded in
 * docs/decisions.md (1 Oct): type is Item/Fixed Asset/Service, Store applies
 * only to Item while Fixed Asset and Service use Purchase, Department is a
 * Cost Center Master row of type DEPARTMENT (never free text), Direct Transfer
 * needs the explicit permission, and approval/document/fulfilment states are
 * separate. Where a rule has no client document behind it (line-level field
 * shape, quantity defaults) it is ours and says so in requisition.rules.ts.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { usableDepartment } from '../../../common/department-identity';
import {
  assertDirectTransfer,
  assertDirectTransferEligible,
  assertEditable,
  assertPurpose,
  assertPurposeLocations,
  assertQtyToReceive,
  assertQtyToShip,
  assertReceiptQty,
  assertRequisitionLines,
  assertShipmentQty,
  fulfilmentStatusOf,
  isSelfApproval,
  legacyStatusFor,
  lineBalances,
  mapToTransferLines,
  mayDecideAnyRequisition,
  maySelfApprove,
  normalizeCommonDocType,
  projectRequisitionStates,
  transferPlanFor,
} from './requisition.rules';

const itemLine = (over: Record<string, unknown> = {}) => ({ item_id: 'item-1', quantity: 10, uom: 'KG', ...over });

describe('normalizeCommonDocType', () => {
  it('keeps the three common types and falls back to ITEM for anything else, as before', () => {
    expect(normalizeCommonDocType('ITEM')).toBe('ITEM');
    expect(normalizeCommonDocType('FA')).toBe('FA');
    expect(normalizeCommonDocType('SERVICE')).toBe('SERVICE');
    // FEED documents are written by FeedRequisitionService, never by the
    // common service; an unknown value fell back to ITEM before Task 8 and
    // must still do so (compatibility with the existing create contract).
    expect(normalizeCommonDocType('FEED')).toBe('ITEM');
    expect(normalizeCommonDocType(undefined)).toBe('ITEM');
  });
});

describe('Store / Purchase purpose', () => {
  it('requires an explicit purpose on every common requisition', () => {
    expect(() => assertPurpose('ITEM', undefined)).toThrow(BadRequestException);
    expect(() => assertPurpose('ITEM', null)).toThrow('A common requisition needs a purpose: STORE or PURCHASE.');
    expect(() => assertPurpose('ITEM', 'INTERNAL_TRANSFER')).toThrow(BadRequestException);
    expect(assertPurpose('ITEM', 'STORE')).toBe('STORE');
    expect(assertPurpose('FA', 'PURCHASE')).toBe('PURCHASE');
  });

  it('allows Store only on Item requisitions (decisions.md, 1 Oct)', () => {
    expect(() => assertPurpose('FA', 'STORE')).toThrow('Store applies only to Item requisitions; Fixed Asset and Service use Purchase.');
    expect(() => assertPurpose('SERVICE', 'STORE')).toThrow(BadRequestException);
    expect(() => assertPurpose('ITEM', 'STORE')).not.toThrow();
  });

  it('demands a source and a different destination for a Store requisition only', () => {
    expect(() => assertPurposeLocations('STORE', null, 'loc-to')).toThrow('A Store requisition needs a source location.');
    expect(() => assertPurposeLocations('STORE', 'loc-from', null)).toThrow('A Store requisition needs a destination location.');
    expect(() => assertPurposeLocations('STORE', 'loc-1', 'loc-1')).toThrow('The source and destination locations must differ.');
    expect(() => assertPurposeLocations('STORE', 'loc-from', 'loc-to')).not.toThrow();
    expect(() => assertPurposeLocations('PURCHASE', null, null)).not.toThrow();
  });
});

describe('Item / Fixed Asset / Service line fields', () => {
  it('requires an Item Master item on every Item line, and no resource', () => {
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine()])).not.toThrow();
    expect(() => assertRequisitionLines('ITEM', 'STORE', [{ quantity: 1, uom: 'EA' }]))
      .toThrow('Requisition line 1 needs an Item Master item.');
    // A description alone used to satisfy the old validateLines(); an Item
    // requisition is a stock item, so it no longer does.
    expect(() => assertRequisitionLines('ITEM', 'STORE', [{ description: 'Bolts', quantity: 1, uom: 'EA' }]))
      .toThrow(BadRequestException);
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine({ resource_id: 'res-1' })]))
      .toThrow('Requisition line 1: an Item requisition line cannot reference a Resource.');
  });

  it('requires a Fixed Asset description on FA lines, with neither item nor resource', () => {
    expect(() => assertRequisitionLines('FA', 'PURCHASE', [{ description: 'Used tractor', quantity: 1, uom: 'EA' }]))
      .not.toThrow();
    expect(() => assertRequisitionLines('FA', 'PURCHASE', [{ quantity: 1, uom: 'EA' }]))
      .toThrow('Requisition line 1 needs a Fixed Asset description.');
    expect(() => assertRequisitionLines('FA', 'PURCHASE', [itemLine({ description: 'Tractor' })]))
      .toThrow('Requisition line 1: a Fixed Asset line cannot reference an inventory item.');
    expect(() => assertRequisitionLines('FA', 'PURCHASE', [{ description: 'Tractor', resource_id: 'res-1', quantity: 1, uom: 'EA' }]))
      .toThrow('Requisition line 1: a Fixed Asset line cannot reference a Resource.');
  });

  it('accepts a Service line through a Resource or a description, never an item', () => {
    expect(() => assertRequisitionLines('SERVICE', 'PURCHASE', [{ resource_id: 'res-1', quantity: 2, uom: 'HOUR' }]))
      .not.toThrow();
    expect(() => assertRequisitionLines('SERVICE', 'PURCHASE', [{ description: 'Vet call-out', quantity: 1, uom: 'EA' }]))
      .not.toThrow();
    expect(() => assertRequisitionLines('SERVICE', 'PURCHASE', [{ quantity: 1, uom: 'EA' }]))
      .toThrow('Requisition line 1 needs a Resource or a description.');
    expect(() => assertRequisitionLines('SERVICE', 'PURCHASE', [itemLine({ description: 'Consult' })]))
      .toThrow('Requisition line 1: a Service line cannot reference an inventory item.');
  });

  it('refuses a zero/absent quantity and reports which line failed', () => {
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine({ quantity: 0 })]))
      .toThrow('Requisition line 1 needs a quantity greater than zero.');
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine(), { ...itemLine(), quantity: -1 }]))
      .toThrow('Requisition line 2 needs a quantity greater than zero.');
  });

  it('keeps shipment quantities off a Purchase line', () => {
    expect(() => assertRequisitionLines('FA', 'PURCHASE', [{ description: 'Tractor', quantity: 1, uom: 'EA', qty_to_ship: 1 }]))
      .toThrow('Requisition line 1: a Purchase line cannot carry shipment quantities.');
    expect(() => assertRequisitionLines('SERVICE', 'PURCHASE', [{ description: 'Vet', quantity: 1, uom: 'EA', qty_to_receive: 1 }]))
      .toThrow(BadRequestException);
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine({ qty_to_ship: 6, qty_to_receive: 6 })]))
      .not.toThrow();
  });

  it('bounds to-ship and to-receive by the requested quantity', () => {
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine({ qty_to_ship: 20 })]))
      .toThrow('Requisition line 1: to-ship quantity cannot exceed the requested quantity.');
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine({ qty_to_ship: 4, qty_to_receive: 8 })]))
      .toThrow('Requisition line 1: to-receive quantity cannot exceed the to-ship quantity.');
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine({ qty_to_ship: 0 })]))
      .toThrow('Requisition line 1: to-ship quantity must be greater than zero.');
    expect(() => assertRequisitionLines('ITEM', 'STORE', [itemLine({ qty_to_ship: 10, qty_to_receive: 10 })]))
      .not.toThrow();
  });
});

describe('derived balances (never persisted)', () => {
  it('falls back to the requested quantity for an untouched Store line', () => {
    expect(lineBalances({ quantity: '3000.0000' })).toEqual({
      requested_qty: 3000,
      qty_to_ship: 3000,
      qty_shipped: 0,
      qty_to_receive: 3000,
      qty_received: 0,
      balance_to_ship: 3000,
      remaining_to_receive: 3000,
    });
  });

  it('computes Balance to Ship and Remaining to Receive from the stored quantities', () => {
    expect(lineBalances({
      quantity: '10', qty_to_ship: '6', qty_shipped: '4', qty_to_receive: '5', qty_received: '2',
    })).toEqual({
      requested_qty: 10,
      qty_to_ship: 6,
      qty_shipped: 4,
      qty_to_receive: 5,
      qty_received: 2,
      balance_to_ship: 2,
      remaining_to_receive: 3,
    });
  });

  it('falls back to the to-ship quantity for the receive target', () => {
    expect(lineBalances({ quantity: 10, qty_to_ship: 6 })).toMatchObject({ qty_to_receive: 6, balance_to_ship: 6 });
  });

  it('guards the shipment and receipt arithmetic Tasks 9–10 will reuse', () => {
    expect(() => assertQtyToShip(10, 6)).not.toThrow();
    expect(() => assertQtyToShip(10, 10)).not.toThrow();
    expect(() => assertQtyToShip(10, 11)).toThrow('to-ship quantity cannot exceed the requested quantity.');
    expect(() => assertQtyToShip(10, 0)).toThrow('to-ship quantity must be greater than zero.');
    expect(() => assertQtyToReceive(6, 6)).not.toThrow();
    expect(() => assertQtyToReceive(6, 7)).toThrow('to-receive quantity cannot exceed the to-ship quantity.');
    expect(() => assertShipmentQty(2, 2)).not.toThrow();
    expect(() => assertShipmentQty(2, 3)).toThrow('Shipment quantity exceeds the remaining balance to ship.');
    expect(() => assertShipmentQty(2, 0)).toThrow('Shipment quantity must be greater than zero.');
    expect(() => assertReceiptQty(3, 3)).not.toThrow();
    expect(() => assertReceiptQty(3, 4)).toThrow('Receipt quantity exceeds the remaining quantity to receive.');
    expect(() => assertReceiptQty(3, -1)).toThrow('Receipt quantity must be greater than zero.');
  });
});

describe('direct transfer', () => {
  const store = { docType: 'ITEM', purpose: 'STORE', fromLocationId: 'loc-1', toLocationId: 'loc-2' };

  it('is eligible only for a Store Item transfer between two different locations', () => {
    expect(() => assertDirectTransferEligible(store)).not.toThrow();
    expect(() => assertDirectTransferEligible({ ...store, docType: 'FA' }))
      .toThrow('Direct Transfer applies only to Store Item requisitions.');
    expect(() => assertDirectTransferEligible({ ...store, purpose: 'PURCHASE' }))
      .toThrow(BadRequestException);
    expect(() => assertDirectTransferEligible({ ...store, fromLocationId: null }))
      .toThrow('Direct Transfer needs a source and a different destination location.');
    expect(() => assertDirectTransferEligible({ ...store, toLocationId: 'loc-1' }))
      .toThrow(BadRequestException);
  });

  it('refuses the post without the User Setup right, even when eligible', () => {
    expect(() => assertDirectTransfer({ ...store, hasPermission: false }))
      .toThrow(ForbiddenException);
    expect(() => assertDirectTransfer({ ...store, hasPermission: false }))
      .toThrow('Direct Transfer requires the Direct Transfer right (User Setup).');
    expect(() => assertDirectTransfer({ ...store, hasPermission: true })).not.toThrow();
    expect(() => assertDirectTransfer({ ...store, docType: 'SERVICE', purpose: 'PURCHASE', hasPermission: true }))
      .toThrow(BadRequestException);
  });
});

describe('state projection and legacy status compatibility', () => {
  const legacy = (status: string) => ({
    status, approval_status: null, document_status: null, fulfilment_status: null, integration_status: null,
  });

  it('projects every old status response value onto the new dimensions', () => {
    expect(projectRequisitionStates(legacy('DRAFT'))).toEqual({
      approval_status: 'OPEN', document_status: 'OPEN', fulfilment_status: 'NOT_APPLICABLE', integration_status: 'NOT_APPLICABLE',
    });
    expect(projectRequisitionStates(legacy('AUTO_DRAFT'))).toMatchObject({ approval_status: 'OPEN', document_status: 'OPEN' });
    expect(projectRequisitionStates(legacy('PENDING_APPROVAL'))).toMatchObject({
      approval_status: 'PENDING_APPROVAL', document_status: 'OPEN',
    });
    expect(projectRequisitionStates(legacy('APPROVED'))).toMatchObject({
      approval_status: 'APPROVED', document_status: 'APPROVED',
    });
    // A rejected document returns to Open for correction while keeping the
    // decision in its history (decisions.md, 1 Oct).
    expect(projectRequisitionStates(legacy('REJECTED'))).toMatchObject({
      approval_status: 'REJECTED', document_status: 'OPEN',
    });
    expect(projectRequisitionStates(legacy('CANCELLED'))).toMatchObject({
      approval_status: 'OPEN', document_status: 'CANCELLED',
    });
    // An unknown legacy value is not an approval; it projects as editable.
    expect(projectRequisitionStates(legacy('SOMETHING_ELSE'))).toMatchObject({
      approval_status: 'OPEN', document_status: 'OPEN',
    });
  });

  it('lets explicit new states win over the legacy status column', () => {
    expect(projectRequisitionStates({
      status: 'DRAFT', approval_status: 'APPROVED', document_status: 'RELEASED',
      fulfilment_status: 'PARTIALLY_SHIPPED', integration_status: 'BC_PENDING',
    })).toEqual({
      approval_status: 'APPROVED', document_status: 'RELEASED',
      fulfilment_status: 'PARTIALLY_SHIPPED', integration_status: 'BC_PENDING',
    });
  });

  it('writes back a legacy status old callers can still read', () => {
    expect(legacyStatusFor('OPEN', 'OPEN')).toBe('DRAFT');
    expect(legacyStatusFor('PENDING_APPROVAL', 'OPEN')).toBe('PENDING_APPROVAL');
    expect(legacyStatusFor('APPROVED', 'APPROVED')).toBe('APPROVED');
    // Release is additive authority: an old caller sees the approved document.
    expect(legacyStatusFor('APPROVED', 'RELEASED')).toBe('APPROVED');
    expect(legacyStatusFor('REJECTED', 'OPEN')).toBe('REJECTED');
    expect(legacyStatusFor('OPEN', 'CANCELLED')).toBe('CANCELLED');
  });

  it('round-trips the status values a legacy row can hold', () => {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED']) {
      const states = projectRequisitionStates(legacy(status));
      expect(legacyStatusFor(states.approval_status, states.document_status)).toBe(status);
    }
    // AUTO_DRAFT belongs to the feed document's own vocabulary; the common
    // document projects it as an open draft and writes DRAFT back.
    expect(legacyStatusFor(
      projectRequisitionStates(legacy('AUTO_DRAFT')).approval_status,
      projectRequisitionStates(legacy('AUTO_DRAFT')).document_status,
    )).toBe('DRAFT');
  });
});

describe('department identity (Cost Center Master, type DEPARTMENT)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    tenant_id: 'tenant-1', company_id: 'co-1', cost_center_type: 'DEPARTMENT',
    is_active: true, deleted_at: null, ...over,
  });

  it('accepts an active DEPARTMENT row of the tenant and company', () => {
    expect(usableDepartment(row(), 'tenant-1', 'co-1')).toBe(true);
    // A null-company cost center is tenant-shared and usable in any company.
    expect(usableDepartment(row({ company_id: null }), 'tenant-1', 'co-2')).toBe(true);
  });

  it('refuses anything that is not the shared department identity', () => {
    expect(usableDepartment(row({ cost_center_type: 'FARM' }), 'tenant-1', 'co-1')).toBe(false);
    expect(usableDepartment(row({ tenant_id: 'tenant-2' }), 'tenant-1', 'co-1')).toBe(false);
    expect(usableDepartment(row({ company_id: 'co-2' }), 'tenant-1', 'co-1')).toBe(false);
    expect(usableDepartment(row({ is_active: false }), 'tenant-1', 'co-1')).toBe(false);
    expect(usableDepartment(row({ deleted_at: '2026-09-01 00:00:00' }), 'tenant-1', 'co-1')).toBe(false);
    expect(usableDepartment(null, 'tenant-1', 'co-1')).toBe(false);
  });
});

describe('isSelfApproval — decisions 1 Oct: nobody approves a manual requisition they created', () => {
  const row = (over: Partial<{ source: string | null; created_by: string | null; requester_user_id: string | null }> = {}) => ({
    source: 'MANUAL_ENTRY', created_by: 'u1', requester_user_id: 'u1', ...over,
  });
  it('flags the creator on a manual document', () => {
    expect(isSelfApproval(row(), 'u1')).toBe(true);
  });
  it('flags the creator when source was never written (legacy common rows)', () => {
    expect(isSelfApproval(row({ source: null }), 'u1')).toBe(true);
  });
  it('flags the recorded requester even if someone else keyed it', () => {
    expect(isSelfApproval(row({ created_by: 'u9' }), 'u1')).toBe(true);
  });
  it('lets the farm manager approve a system forecast draft', () => {
    expect(isSelfApproval(row({ source: 'AUTO_FORECAST' }), 'u1')).toBe(false);
  });
  it('lets a different user approve', () => {
    expect(isSelfApproval(row(), 'u2')).toBe(false);
  });
  it('has nothing to compare without a user', () => {
    expect(isSelfApproval(row(), undefined)).toBe(false);
  });
});

describe('maySelfApprove — decisions.md 2026-10-04: Tenant/Company admins may approve their own requisitions', () => {
  it('exempts exactly TENANT_ADMIN and COMPANY_ADMIN', () => {
    expect(maySelfApprove('TENANT_ADMIN')).toBe(true);
    expect(maySelfApprove('COMPANY_ADMIN')).toBe(true);
  });
  it('still refuses SYSTEM_ADMIN — the 4 Oct decision names only Tenant and Company admins, and until Rishi ' +
    'confirms System Admin it follows the pre-existing rule', () => {
    expect(maySelfApprove('SYSTEM_ADMIN')).toBe(false);
  });
  it('still refuses every other user type', () => {
    expect(maySelfApprove('OPERATIONAL_ADMIN')).toBe(false);
    expect(maySelfApprove('FARM_MANAGER')).toBe(false);
    expect(maySelfApprove('STANDARD_USER')).toBe(false);
  });
  it('has nothing to exempt without a user type', () => {
    expect(maySelfApprove(null)).toBe(false);
    expect(maySelfApprove(undefined)).toBe(false);
  });
});

describe('mayDecideAnyRequisition — decisions.md 2026-10-04 (second entry): the same two types decide every requisition, not just their own', () => {
  it('agrees with maySelfApprove on exactly the same allow-list', () => {
    for (const t of ['TENANT_ADMIN', 'COMPANY_ADMIN', 'SYSTEM_ADMIN', 'OPERATIONAL_ADMIN', 'FARM_MANAGER', 'STANDARD_USER', null, undefined]) {
      expect(mayDecideAnyRequisition(t)).toBe(maySelfApprove(t));
    }
  });
});

describe('assertEditable — "editable while the document is open" (spec §6a)', () => {
  const row = (over: Record<string, string | null> = {}) => ({ req_no: 'REQ-2026-0001', doc_type: 'ITEM', status: 'DRAFT', approval_status: 'OPEN', document_status: 'OPEN', ...over });
  it('accepts an Open draft', () => expect(() => assertEditable(row())).not.toThrow());
  it('accepts a legacy DRAFT row with null states (projected Open)', () =>
    expect(() => assertEditable(row({ approval_status: null, document_status: null }))).not.toThrow());
  it.each([
    ['pending', { status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL' }],
    ['approved', { status: 'APPROVED', approval_status: 'APPROVED', document_status: 'APPROVED' }],
    ['rejected (reopen first)', { status: 'REJECTED', approval_status: 'REJECTED', document_status: 'OPEN' }],
    ['released', { status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED' }],
  ])('refuses a %s document', (_n, over) => {
    expect(() => assertEditable(row(over))).toThrow('Requisition REQ-2026-0001 can no longer be edited; only an Open requisition can change.');
  });
  it('sends a feed document to its own editor', () => {
    expect(() => assertEditable(row({ doc_type: 'FEED' }))).toThrow('A feed requisition cannot be edited through /requisition; use /feed-requisition.');
  });
});

describe('transferPlanFor — Store release starts one internal transfer (decisions 1 Oct)', () => {
  const header = { from_location_id: 'st', to_location_id: 'sh' };
  const line = (over: Record<string, unknown> = {}) => ({ line_id: 'l1', line_seq: 1, item_id: 'i1', quantity: '10', uom: 'EA', qty_to_ship: '6', from_location_id: 'st', to_location_id: 'sh', ...over });
  it('ships each line its to-ship quantity between the header locations', () => {
    expect(transferPlanFor(header, [line()])).toEqual({ fromLocationId: 'st', toLocationId: 'sh', lines: [{ requisition_line_id: 'l1', item_id: 'i1', quantity: 6, uom: 'EA' }] });
  });
  it('falls back to the requested quantity on a line with no to-ship target', () => {
    expect(transferPlanFor(header, [line({ qty_to_ship: null })]).lines[0].quantity).toBe(10);
  });
  it('refuses a line routed between other locations than the header', () => {
    expect(() => transferPlanFor(header, [line({ line_seq: 2, to_location_id: 'other' })]))
      .toThrow('Line 2 moves between other locations than the header; one transfer has one source and one destination.');
  });
  it('refuses a header with no source or destination', () => {
    expect(() => transferPlanFor({ from_location_id: null, to_location_id: 'sh' }, [line()])).toThrow('A Store requisition needs a source and a destination before release.');
  });
  it('refuses a line without an item', () => {
    expect(() => transferPlanFor(header, [line({ item_id: null })])).toThrow('Line 1 has no item; a Store transfer moves Item Master items only.');
  });
});

describe('fulfilmentStatusOf — partial shipment and receipt are allowed (decisions 1 Oct)', () => {
  const l = (shipped: number, received: number, toShip = 10) => ({ quantity: '10', qty_to_ship: String(toShip), qty_shipped: shipped, qty_to_receive: String(toShip), qty_received: received });
  it.each([
    [[l(0, 0)], 'TRANSFER_OPEN'],
    [[l(6, 0)], 'PARTIALLY_SHIPPED'],
    [[l(10, 0)], 'SHIPPED'],
    [[l(6, 4)], 'PARTIALLY_RECEIVED'],
    [[l(10, 10)], 'RECEIVED'],
    [[l(10, 10), l(0, 0)], 'PARTIALLY_RECEIVED'],
    [[l(10, 0), l(4, 0)], 'PARTIALLY_SHIPPED'],
  ])('%j → %s', (lines, status) => expect(fulfilmentStatusOf(lines)).toBe(status));
});

describe('mapToTransferLines', () => {
  const tl = [{ line_id: 't1', requisition_line_id: 'r1' }, { line_id: 't2', requisition_line_id: 'r2' }];
  it('maps requisition lines to their transfer lines', () => {
    expect(mapToTransferLines([{ line_id: 'r2', quantity: 3 }], tl)).toEqual([{ line_id: 't2', quantity: 3 }]);
  });
  it('refuses a line the linked transfer does not carry', () => {
    expect(() => mapToTransferLines([{ line_id: 'r9', quantity: 1 }], tl)).toThrow('Requisition line r9 is not on the linked transfer.');
  });
});
