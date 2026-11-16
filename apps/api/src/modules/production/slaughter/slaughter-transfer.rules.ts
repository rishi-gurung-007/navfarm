/**
 * Pure rules of the slaughter Transfer Order (BBP-1 S.10.1: Transfer Order -> Slaughter -> Invoice). No database here: the service loads rows and these decide.
 */
import { BadRequestException } from '@nestjs/common';

export const SLAUGHTER_STATUSES = ['DRAFT', 'CONFIRMED', 'RECEIVED', 'RECONCILED', 'CLOSED', 'CANCELLED'] as const;
export type SlaughterStatus = (typeof SLAUGHTER_STATUSES)[number];
export const SLAUGHTER_CATEGORIES = ['COMMERCIAL', 'CULLED_BREEDING_ASSET'] as const;

/** The GL mappings a Transfer Order posts through; all four must be set up before one is dispatched (db-enable-slaughter-gl). */
export const SLAUGHTER_MAPPINGS = ['BIO_SLAUGHTER_DISPATCH', 'BIO_SLAUGHTER_DOA', 'BIO_SLAUGHTER_SALE', 'BIO_SLAUGHTER_COGS'] as const;

/** BBP: "A Slap Mark / Physical Lot ID ([Farm Code]-[Batch No.]) is auto-printed per line". */
export const slapMark = (farmCode: string, batchNo: string) => `${farmCode}-${batchNo}`;

export function assertSlaughterStatus(to: { to_no: string; status: string }, ...allowed: SlaughterStatus[]) {
  if (!allowed.includes(to.status as SlaughterStatus)) {
    throw new BadRequestException(`Transfer Order ${to.to_no} is ${to.status}; this step needs it ${allowed.join(' or ')}.`);
  }
}

const day = (d: string) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * BBP: "Transfer Order cannot be created if ANY medicine withdrawal period is still active on ANY batch on any TO line." A medicine or vaccine given on a date
 * with N withdrawal days clears N days later; the medicines that have not cleared by `asOf`, each with the day it clears (the latest dose decides).
 */
export function activeWithdrawals(
  doses: Array<{ item_name: string; item_type: string | null; administered_date: string; withdrawal_days: number | null }>,
  asOf: string,
): Array<{ item_name: string; clear_date: string }> {
  const latest = new Map<string, number>();
  for (const d of doses) {
    if (d.withdrawal_days == null || !['MEDICINE', 'VACCINE'].includes(String(d.item_type))) continue;
    const clears = day(d.administered_date) + Number(d.withdrawal_days) * 86_400_000;
    latest.set(d.item_name, Math.max(latest.get(d.item_name) ?? 0, clears));
  }
  return [...latest.entries()].filter(([, clears]) => clears > day(asOf)).map(([item_name, clears]) => ({ item_name, clear_date: iso(clears) }));
}

/** The value one line's head took into transit split between what died on the way and what was delivered (the delivered part takes the rounding). */
export function splitTransitValue(carryingValue: number, headCount: number, doaHead: number): { doa: number; delivered: number } {
  if (!(headCount > 0)) return { doa: 0, delivered: 0 };
  const doa = Math.round(((carryingValue * doaHead) / headCount) * 1e4) / 1e4;
  return { doa, delivered: Math.round((carryingValue - doa) * 1e4) / 1e4 };
}

/** The POD: every line counted, its DOA a whole number from nil to the head sent; delivered is the rest. */
export function podIssues(lines: Array<{ line_no: number; head_count: number }>, given: Map<number, number>): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const doa = given.get(l.line_no);
    if (doa === undefined) out.push(`Line ${l.line_no} has no DOA count (enter 0 if none died).`);
    else if (!Number.isInteger(doa) || doa < 0 || doa > l.head_count) out.push(`Line ${l.line_no}: DOA must be a whole number from 0 to the ${l.head_count} head sent.`);
  }
  return out;
}

/** BBP: "Invoice: Delivered Qty x Avg Carcass Weight x Price/KG". */
export function invoiceLine(delivered: number, avgCarcassKg: number, pricePerKg: number): { carcass_weight_kg: number; amount: number } {
  const carcass = Math.round(delivered * avgCarcassKg * 1e3) / 1e3;
  return { carcass_weight_kg: carcass, amount: Math.round(delivered * avgCarcassKg * pricePerKg * 1e4) / 1e4 };
}

/** BBP alert: "DOA % > 5% of shipped head -> CRITICAL alert to Farm Manager + Finance". */
export const doaOverThreshold = (doa: number, shipped: number) => shipped > 0 && doa / shipped > 0.05;
