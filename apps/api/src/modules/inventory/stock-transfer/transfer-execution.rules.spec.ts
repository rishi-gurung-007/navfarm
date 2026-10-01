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
  cumulativeAfter,
  nextShipmentState,
  nextReceiptState,
  transferIsFullyReceived,
  transferIsFullyShipped,
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
    expect(() => assertTrackingAssignments({ isLotTracked: true, isSerialTracked: false }, []))
      .toThrow('Item is lot-tracked; assign a lot before shipment.');
    expect(() => assertTrackingAssignments({ isLotTracked: false, isSerialTracked: true }, []))
      .toThrow('Item is serial-tracked; assign a serial number before shipment.');
    expect(() => assertTrackingAssignments({ isLotTracked: true, isSerialTracked: false }, [{ lot_no: 'L-1', serial_no: null, qty: 4 }]))
      .not.toThrow();
  });

  it('demands every assigned quantity be covered and serials be unique', () => {
    expect(() => assertTrackingAssignments({ isLotTracked: false, isSerialTracked: true }, [
      { lot_no: null, serial_no: 'S-1', qty: 2 }, { lot_no: null, serial_no: 'S-1', qty: 2 },
    ])).toThrow('Serial numbers must be unique on one transfer line.');
    // Unique serials but zero total: nothing is actually assigned.
    expect(() => assertTrackingAssignments({ isLotTracked: false, isSerialTracked: true }, [
      { lot_no: null, serial_no: 'S-1', qty: 0 }, { lot_no: null, serial_no: 'S-2', qty: 0 },
    ])).toThrow('Assigned quantities must cover the shipped quantity.');
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
