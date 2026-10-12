/**
 * Pure planning for split-comma-serial-layers.ts (P1 follow-up item 6).
 *
 * Before 6165c348 (transfer-receipt-serials.spec.ts), a transfer receipt of
 * several serials wrote ONE positive ledger layer with serial_no
 * "SN00001,SN00002". A serial is one physical unit and every consumer matches
 * a serial exactly, so the serial picker offered "SN00001,SN00002" as one
 * serial and none of its units could be issued one by one. This plans the
 * repair: one layer per serial, quantity 1 each, the value split exactly
 * (splitAmount — the receipt's own rule — so the parts sum to the original).
 *
 * The original row keeps the first serial, so anything that points at its
 * ledger_id (journal_header.source_ledger_id) still points at a row of the
 * same document. Only an unconsumed layer is split: remaining equals
 * quantity, and no inventory_application row draws on it. NEGATIVE rows
 * with a comma are history, not layers. The picker reads only positive
 * layers with something remaining, so they are counted and left as they are.
 */
import { splitAmount } from '../modules/inventory/stock-transfer/transfer-execution.rules';

export interface LedgerLayerRow {
  ledger_id: string;
  document_no: string | null;
  entry_type: string | null;
  quantity: string | number;
  remaining_quantity: string | number | null;
  amount: string | number | null;
  alternate_quantity: string | number | null;
  serial_no: string;
}

export interface LayerPart { serial_no: string; quantity: 1; remaining_quantity: 1; amount: number; alternate_quantity: number | null }

export interface SerialLayerPlan {
  split: Array<{ ledger_id: string; document_no: string | null; serial_no: string; keep: LayerPart; add: LayerPart[] }>;
  skipped: Array<{ ledger_id: string; document_no: string | null; serial_no: string; reason: string }>;
  historyRows: number;
}

const EPS = 1e-9;

export function planSerialLayerSplits(rows: LedgerLayerRow[], appliedInboundIds: Set<string>): SerialLayerPlan {
  const plan: SerialLayerPlan = { split: [], skipped: [], historyRows: 0 };
  for (const r of rows) {
    if (!r.serial_no.includes(',')) continue;
    if (r.entry_type !== 'POSITIVE') { plan.historyRows++; continue; }
    const skip = (reason: string) => plan.skipped.push({ ledger_id: r.ledger_id, document_no: r.document_no, serial_no: r.serial_no, reason });
    const qty = Number(r.quantity);
    const remaining = Number(r.remaining_quantity ?? 0);
    if (Math.abs(remaining - qty) > EPS) { skip(`consumed (remaining ${remaining} of ${qty})`); continue; }
    if (appliedInboundIds.has(r.ledger_id)) { skip('consumed (an inventory_application row draws on it)'); continue; }
    const serials = r.serial_no.split(',').map((s) => s.trim()).filter(Boolean);
    if (new Set(serials).size !== serials.length) { skip('a serial is named twice'); continue; }
    if (!Number.isInteger(qty) || serials.length !== qty) { skip(`${serials.length} serials for quantity ${qty}`); continue; }
    const amounts = splitAmount(Number(r.amount ?? 0), serials.length);
    const alternates = r.alternate_quantity === null ? null : splitAmount(Number(r.alternate_quantity), serials.length);
    const parts: LayerPart[] = serials.map((serial_no, i) => ({
      serial_no, quantity: 1, remaining_quantity: 1, amount: amounts[i], alternate_quantity: alternates ? alternates[i] : null,
    }));
    plan.split.push({ ledger_id: r.ledger_id, document_no: r.document_no, serial_no: r.serial_no, keep: parts[0], add: parts.slice(1) });
  }
  return plan;
}
