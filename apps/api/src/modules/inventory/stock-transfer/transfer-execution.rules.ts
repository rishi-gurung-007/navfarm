/**
 * Transfer execution rules — pure, no database (plan Task 10).
 *
 * decisions.md (1 Oct): "Partial shipment and receipt are allowed without
 * over-shipment or over-receipt; Direct Transfer may post a selected partial
 * shipment and its matching receipt together when the user has the explicit
 * Direct Transfer permission." Spec "Transfer execution": shipment and receipt
 * documents are append-only partial events; lot/serial assignment is mandatory
 * before shipment for tracked items and is copied automatically to receipt.
 *
 * The quantity guards re-raise requisition.rules.ts's own assertShipmentQty /
 * assertReceiptQty so the same bounds live in one place — the requisition
 * line's balance and the transfer line's balance are the same arithmetic.
 */
import { BadRequestException } from '@nestjs/common';
import { assertReceiptQty, assertShipmentQty } from '../../procurement/requisition/requisition.rules';

export interface TrackingAssignment {
  lot_no: string | null;
  serial_no: string | null;
  qty: number;
}

export interface ShipmentLineState {
  ordered: number;
  previouslyShipped: number;
  events: TrackingAssignment[];
}

export interface ReceiptLineState {
  ordered: number;
  previouslyShipped: number;
  previouslyReceived: number;
  events: TrackingAssignment[];
}

/** The quantity guards, re-raised under transfer names for the callers here. */
export const assertShipmentEvent = (balanceToShip: number, qty: number): void => assertShipmentQty(balanceToShip, qty);
export const assertReceiptEvent = (remainingToReceive: number, qty: number): void => assertReceiptQty(remainingToReceive, qty);

/** Ship `qty` against a line: append-only accumulation, never beyond the order. */
export function nextShipmentState(
  state: ShipmentLineState,
  event: { lineId: string; qty: number },
): { shipped: number; balanceToShip: number; events: TrackingAssignment[] } {
  const remaining = state.ordered - state.previouslyShipped;
  assertShipmentQty(remaining, event.qty);
  return { shipped: state.previouslyShipped + event.qty, balanceToShip: remaining - event.qty, events: [] };
}

/**
 * Receive `qty` against a line: bounded by what has actually shipped (never
 * the order), and never before any shipment exists — "a receipt cannot
 * precede its shipment".
 */
export function nextReceiptState(
  state: ReceiptLineState,
  event: { lineId: string; qty: number },
): { received: number; remainingToReceive: number; events: TrackingAssignment[] } {
  if (state.previouslyShipped <= 0) {
    throw new BadRequestException('A receipt cannot precede its shipment.');
  }
  const remaining = Math.min(state.previouslyShipped, state.ordered) - state.previouslyReceived;
  assertReceiptQty(remaining, event.qty);
  return { received: state.previouslyReceived + event.qty, remainingToReceive: remaining - event.qty, events: [] };
}

/**
 * Lot/serial identity before shipment. A lot-tracked line must carry at least
 * one lot assignment; a serial-tracked line one serial per unit. Assigned
 * quantities must cover the shipped quantity — under-covering would post an
 * untracked remainder, which is the hole the rule exists to close.
 */
export function assertTrackingAssignments(
  item: { isLotTracked: boolean; isSerialTracked: boolean },
  assignments: TrackingAssignment[],
): void {
  if (item.isLotTracked && !assignments.some((a) => a.lot_no)) {
    throw new BadRequestException('Item is lot-tracked; assign a lot before shipment.');
  }
  if (item.isSerialTracked) {
    if (!assignments.some((a) => a.serial_no)) {
      throw new BadRequestException('Item is serial-tracked; assign a serial number before shipment.');
    }
    const serials = assignments.filter((a) => a.serial_no).map((a) => a.serial_no);
    if (new Set(serials).size !== serials.length) {
      throw new BadRequestException('Serial numbers must be unique on one transfer line.');
    }
  }
  if (item.isLotTracked || item.isSerialTracked) {
    const covered = assignments.reduce((sum, a) => sum + a.qty, 0);
    if (assignments.length === 0 || covered <= 0) {
      throw new BadRequestException('Assigned quantities must cover the shipped quantity.');
    }
  }
}

/** Receipt copies the shipment's assignments verbatim (spec: "copied automatically"). */
export function cumulativeAfter(assignments: TrackingAssignment[]): TrackingAssignment[] {
  return assignments.map((a) => ({ ...a }));
}

export const transferIsFullyShipped = (lines: Array<{ ordered: number; shipped: number }>): boolean =>
  lines.length > 0 && lines.every((l) => l.shipped >= l.ordered);

export const transferIsFullyReceived = (lines: Array<{ ordered: number; received: number }>): boolean =>
  lines.length > 0 && lines.every((l) => l.received >= l.ordered);
