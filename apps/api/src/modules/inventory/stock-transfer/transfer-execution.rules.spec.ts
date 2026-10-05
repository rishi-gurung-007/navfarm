/**
 * Task 10 — staged transfer execution rules (pure, no database).
 *
 * Decisions under test (decisions.md, 1 Oct; spec "Transfer execution"):
 * shipment and receipt are append-only partial events; over-shipment and
 * over-receipt are rejected; a receipt can never precede its shipment; a
 * tracked item's lot/serial assignment is mandatory before shipment and is
 * copied automatically from shipment to receipt; Direct Transfer is the same
 * shipment then receipt in one transaction, never a second posting
 * implementation; repeated calls are idempotent.
 */
import {
  assertReceiptEvent,
  assertShipmentEvent,
  assertTrackingAssignments,
  assertTrackingForShipment,
  assignmentsFromLine,
  cumulativeAfter,
  nextShipmentState,
  nextReceiptState,
  transferIsFullyReceived,
  transferIsFullyShipped,
  transferStatusFor,
  OPEN_TRANSFER_STATUSES,
} from './transfer-execution.rules';

const line = (over: Record<string, unknown> = {}) => ({
  line_id: 'line-1', item_id: 'item-1', quantity: '10', uom: 'EA', lot_no: null, serial_no: null, ...over,
});

describe('shipment events', () => {
  it('accumulates a partial shipment and reports the remaining balance to ship', () => {
    const state = nextShipmentState({ ordered: 10, previouslyShipped: 0, events: [] }, { lineId: 'line-1', qty: 4 });
    expect(state).toMatchObject({ shipped: 4, balanceToShip: 6 });
    // The next event reads the state the previous one produced.
    const second = nextShipmentState({ ordered: 10, previouslyShipped: state.shipped, events: [] }, { lineId: 'line-1', qty: 3 });
    expect(second).toMatchObject({ shipped: 7, balanceToShip: 3 });
  });

  it('rejects an over-shipment against the ordered quantity', () => {
    expect(() => nextShipmentState({ ordered: 10, previouslyShipped: 7, events: [] }, { lineId: 'line-1', qty: 4 }))
      .toThrow('Shipment quantity exceeds the remaining balance to ship.');
  });

  it('rejects zero and negative shipment quantities', () => {
    expect(() => nextShipmentState({ ordered: 10, previouslyShipped: 0, events: [] }, { lineId: 'line-1', qty: 0 }))
      .toThrow('Shipment quantity must be greater than zero.');
    expect(() => nextShipmentState({ ordered: 10, previouslyShipped: 0, events: [] }, { lineId: 'line-1', qty: -1 }))
      .toThrow('Shipment quantity must be greater than zero.');
  });

  it('reports a fully shipped line and refuses shipping an already-closed one', () => {
    expect(transferIsFullyShipped([{ ordered: 10, shipped: 10 }])).toBe(true);
    expect(() => nextShipmentState({ ordered: 10, previouslyShipped: 10, events: [] }, { lineId: 'line-1', qty: 1 }))
      .toThrow('Shipment quantity exceeds the remaining balance to ship.');
  });
});

describe('receipt events', () => {
  it('accumulates a partial receipt against what has shipped, not against the order', () => {
    const state = nextReceiptState({ ordered: 10, previouslyShipped: 6, previouslyReceived: 0, events: [] }, { lineId: 'line-1', qty: 4 });
    expect(state).toMatchObject({ received: 4, remainingToReceive: 2 });
    const second = nextReceiptState({ ordered: 10, previouslyShipped: 6, previouslyReceived: 4, events: [] }, { lineId: 'line-1', qty: 2 });
    expect(second).toMatchObject({ received: 6, remainingToReceive: 0 });
  });

  it('rejects receiving more than has shipped (over-receipt) and more than the order', () => {
    expect(() => nextReceiptState({ ordered: 10, previouslyShipped: 6, previouslyReceived: 0, events: [] }, { lineId: 'line-1', qty: 7 }))
      .toThrow('Receipt quantity exceeds the remaining quantity to receive.');
    expect(() => nextReceiptState({ ordered: 4, previouslyShipped: 4, previouslyReceived: 0, events: [] }, { lineId: 'line-1', qty: 5 }))
      .toThrow('Receipt quantity exceeds the remaining quantity to receive.');
  });

  it('never allows a receipt to precede its shipment', () => {
    expect(() => nextReceiptState({ ordered: 10, previouslyShipped: 0, previouslyReceived: 0, events: [] }, { lineId: 'line-1', qty: 1 }))
      .toThrow('A receipt cannot precede its shipment.');
    // Everything shipped has been received: there is nothing left to receive,
    // which the quantity guard reports against the shipped quantity.
    expect(() => nextReceiptState({ ordered: 10, previouslyShipped: 4, previouslyReceived: 4, events: [] }, { lineId: 'line-1', qty: 1 }))
      .toThrow('Receipt quantity exceeds the remaining quantity to receive.');
  });

  it('rejects zero and negative receipt quantities', () => {
    expect(() => nextReceiptState({ ordered: 10, previouslyShipped: 6, previouslyReceived: 0, events: [] }, { lineId: 'line-1', qty: 0 }))
      .toThrow('Receipt quantity must be greater than zero.');
  });
});

describe('lot/serial tracking (decisions: mandatory before shipment for tracked items)', () => {
  it('demands assignments for a lot-tracked line before any shipment', () => {
    expect(() => assertTrackingAssignments({ isLotTracked: true, isSerialTracked: false }, [], 4))
      .toThrow('Item is lot-tracked; assign a lot before shipment.');
    expect(() => assertTrackingAssignments({ isLotTracked: false, isSerialTracked: true }, [], 4))
      .toThrow('Item is serial-tracked; assign a serial number before shipment.');
    expect(() => assertTrackingAssignments({ isLotTracked: true, isSerialTracked: false }, [{ lot_no: 'L-1', serial_no: null, qty: 4 }], 4))
      .not.toThrow();
  });

  it('demands every assigned quantity be covered and serials be unique', () => {
    expect(() => assertTrackingAssignments({ isLotTracked: false, isSerialTracked: true }, [
      { lot_no: null, serial_no: 'S-1', qty: 2 }, { lot_no: null, serial_no: 'S-1', qty: 2 },
    ], 4)).toThrow('Serial numbers must be unique on one transfer line.');
    // Unique serials but zero total: nothing is actually assigned.
    expect(() => assertTrackingAssignments({ isLotTracked: false, isSerialTracked: true }, [
      { lot_no: null, serial_no: 'S-1', qty: 0 }, { lot_no: null, serial_no: 'S-2', qty: 0 },
    ], 0)).toThrow('Assigned quantities must cover the shipped quantity.');
  });

  it('refuses assignments that under-cover the shipped quantity (WP1c: lot/serial quantity = Qty to Ship)', () => {
    // Two serials assigned, three units shipping: one unit would post untracked.
    expect(() => assertTrackingAssignments({ isLotTracked: false, isSerialTracked: true }, [
      { lot_no: null, serial_no: 'S-1', qty: 1 }, { lot_no: null, serial_no: 'S-2', qty: 1 },
    ], 3)).toThrow('do not cover the shipped quantity');
    expect(() => assertTrackingAssignments({ isLotTracked: true, isSerialTracked: false }, [
      { lot_no: 'L-1', serial_no: null, qty: 4 },
    ], 4)).not.toThrow();
  });

  it('splits a line assignment into one row per serial, qty 1 each', () => {
    expect(assignmentsFromLine({ lot_no: null, serial_no: 'S-1, S-2', qty: 2 }))
      .toEqual([{ lot_no: null, serial_no: 'S-1', qty: 1 }, { lot_no: null, serial_no: 'S-2', qty: 1 }]);
    expect(assignmentsFromLine({ lot_no: 'L-1', serial_no: null, qty: 4 }))
      .toEqual([{ lot_no: 'L-1', serial_no: null, qty: 4 }]);
    expect(assignmentsFromLine({ lot_no: 'L-1', serial_no: 'S-1,S-2', qty: 2 }))
      .toEqual([{ lot_no: 'L-1', serial_no: 'S-1', qty: 1 }, { lot_no: 'L-1', serial_no: 'S-2', qty: 1 }]);
    expect(assignmentsFromLine({ lot_no: null, serial_no: null, qty: 3 }))
      .toEqual([{ lot_no: null, serial_no: null, qty: 3 }]);
  });

  it('copies assignments from shipment to receipt (spec: copied automatically)', () => {
    const assignments = [{ lot_no: 'L-1', serial_no: 'S-1', qty: 4 }, { lot_no: 'L-1', serial_no: 'S-2', qty: 2 }];
    expect(cumulativeAfter(assignments)).toEqual(assignments);
  });
});

describe('event guards and completion', () => {
  it('assertShipmentEvent / assertReceiptEvent re-raise the shared quantity guards', () => {
    expect(() => assertShipmentEvent(6, 7)).toThrow('exceeds the remaining balance to ship');
    expect(() => assertShipmentEvent(6, 0)).toThrow('must be greater than zero');
    expect(() => assertReceiptEvent(4, 5)).toThrow('exceeds the remaining quantity to receive');
    expect(() => assertReceiptEvent(4, 0)).toThrow('must be greater than zero');
    expect(() => assertShipmentEvent(6, 6)).not.toThrow();
    expect(() => assertReceiptEvent(4, 4)).not.toThrow();
  });

  it('reports full receipt only when every line has received its ordered quantity', () => {
    expect(transferIsFullyReceived([
      { ordered: 10, received: 10 }, { ordered: 4, received: 4 },
    ])).toBe(true);
    expect(transferIsFullyReceived([
      { ordered: 10, received: 10 }, { ordered: 4, received: 2 },
    ])).toBe(false);
  });

  it('defaults line() to an untracked item so the tracking tests stay explicit', () => {
    expect(line()).toMatchObject({ lot_no: null, serial_no: null });
  });
});

/**
 * Part E Task 4b: a staged transfer's status follows its events. The brief:
 * first shipment -> IN_TRANSIT; any receipt while some shipped/ordered
 * quantity is still unreceived -> PARTIALLY_RECEIVED; every line fully shipped
 * AND fully received -> POSTED.
 */
describe('transferStatusFor — status follows the shipment and receipt events', () => {
  it('no shipment on any line is still DRAFT', () => {
    expect(transferStatusFor([{ ordered: 10, shipped: 0, received: 0 }])).toBe('DRAFT');
  });

  it('a first shipment, nothing received, is IN_TRANSIT — partial or full', () => {
    expect(transferStatusFor([{ ordered: 10, shipped: 6, received: 0 }])).toBe('IN_TRANSIT');
    expect(transferStatusFor([{ ordered: 10, shipped: 10, received: 0 }])).toBe('IN_TRANSIT');
    expect(transferStatusFor([{ ordered: 10, shipped: 4, received: 0 }, { ordered: 5, shipped: 0, received: 0 }])).toBe('IN_TRANSIT');
  });

  it('any receipt while something ordered is unreceived is PARTIALLY_RECEIVED', () => {
    // ordered 10, shipped 6, received 4: 2 still in transit, 4 not yet shipped.
    expect(transferStatusFor([{ ordered: 10, shipped: 6, received: 4 }])).toBe('PARTIALLY_RECEIVED');
    // everything shipped so far has arrived, but the order is not all shipped.
    expect(transferStatusFor([{ ordered: 10, shipped: 6, received: 6 }])).toBe('PARTIALLY_RECEIVED');
    // one line complete, the other only shipped.
    expect(transferStatusFor([{ ordered: 10, shipped: 10, received: 10 }, { ordered: 5, shipped: 5, received: 0 }])).toBe('PARTIALLY_RECEIVED');
  });

  // M5 (fix round 1): one line complete, the other never touched at all —
  // distinct from the "only shipped" case above, since a line with shipped 0
  // exercises the DRAFT short-circuit's interaction with a sibling line that
  // already has a receipt.
  it('one line complete and a sibling line completely untouched is still PARTIALLY_RECEIVED', () => {
    expect(transferStatusFor([{ ordered: 10, shipped: 10, received: 10 }, { ordered: 5, shipped: 0, received: 0 }])).toBe('PARTIALLY_RECEIVED');
  });

  it('every line fully shipped and fully received is POSTED', () => {
    expect(transferStatusFor([{ ordered: 10, shipped: 10, received: 10 }, { ordered: 5, shipped: 5, received: 5 }])).toBe('POSTED');
  });

  it('the open statuses are the three an event may still be posted against', () => {
    expect([...OPEN_TRANSFER_STATUSES]).toEqual(['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED']);
  });

  // Fix round 1, Important 1: shippedQuantities/receivedQuantities sum
  // Number(qty) in JS float arithmetic. Ordered 1.3, shipped as two events
  // 0.6 + 0.7, sums to 1.2999999999999998 in IEEE754 — short of 1.3 by 2e-16.
  // The old >= comparison, with no tolerance, left the transfer stuck in
  // PARTIALLY_RECEIVED forever: "fully shipped" never became true, so further
  // shipment, edit and cancel were all refused. The fix uses the same 1e-9
  // tolerance assertShipment already uses (stock-transfer.service.ts).
  it('a float-summed partial shipment and receipt that lands fractionally short of the order still completes (ordered 1.3, shipped 0.6+0.7, received 0.6+0.7)', () => {
    const shipped = 0.6 + 0.7; // 1.2999999999999998
    const received = 0.6 + 0.7;
    expect(shipped).toBeLessThan(1.3); // the trap: a plain >= comparison would never see this as "fully shipped"
    expect(transferStatusFor([{ ordered: 1.3, shipped, received }])).toBe('POSTED');
  });
});

describe('assertTrackingForShipment — WP4a fix round 1: the ONE tracking rule, for the shipment and the Item Tracking route', () => {
  const LOT = { isLotTracked: true, isSerialTracked: false };
  const SERIAL = { isLotTracked: false, isSerialTracked: true };

  it('is the shipment rule: a lot item needs its lot, serials must be unique and cover the quantity', () => {
    expect(() => assertTrackingForShipment(LOT, { lot_no: null, serial_no: null }, 4, 4)).toThrow('Item is lot-tracked; assign a lot before shipment.');
    expect(() => assertTrackingForShipment(LOT, { lot_no: 'L-1', serial_no: null }, 2, 4)).not.toThrow();
    expect(() => assertTrackingForShipment(SERIAL, { lot_no: null, serial_no: 'S-1,S-1' }, 2, 2)).toThrow('Serial numbers must be unique on one transfer line.');
    expect(() => assertTrackingForShipment(SERIAL, { lot_no: null, serial_no: 'S-1' }, 2, 2)).toThrow('do not cover the shipped quantity (2)');
  });

  it('refuses a partial shipment of a serial-tracked line (the shipped serials would be a guess)', () => {
    expect(() => assertTrackingForShipment(SERIAL, { lot_no: null, serial_no: 'S-1,S-2,S-3,S-4' }, 2, 4))
      .toThrow('A serial-tracked line ships its whole balance (4) in one shipment; partial shipments of serial-tracked lines are not supported yet.');
  });

  it('wants exactly one serial per unit shipped, no spares', () => {
    expect(() => assertTrackingForShipment(SERIAL, { lot_no: null, serial_no: 'S-1,S-2,S-3' }, 2, 2))
      .toThrow('Assign exactly 2 serial number(s) to ship 2; 3 are assigned.');
    expect(() => assertTrackingForShipment(SERIAL, { lot_no: null, serial_no: 'S-1, S-2' }, 2, 2)).not.toThrow();
  });
});
