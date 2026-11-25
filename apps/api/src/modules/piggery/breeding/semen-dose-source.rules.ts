/**
 * Where an AI mating's doses come from (D1, 24 Nov 2026). Semen is used on the farm the sow is on: the doses are issued from a store on her
 * farm that holds the lot. A lot sent to another farm is used there only once that farm's receipt QC has accepted it (the receipt holds the
 * stock until then, stock-transfer.service.ts); before, the mating is refused and names the inspection. A sow with no farm keeps the old
 * rule: the lot's collection store.
 */

export interface LotStock {
  warehouse_id: string;
  farm_id: string | null;
  qty: number;
}

export interface FarmReceiptInspection {
  inspection_no: string;
  status: string; // OPEN, PENDING_APPROVAL, CLOSED
  posted: boolean; // accepted into stock
  farm_id: string | null;
}

export interface DoseSourceInput {
  lotNo: string;
  quantity: number;
  sowFarmId: string | null;
  sowFarmLabel: string;
  collectionStoreId: string;
  stock: LotStock[];
  farmReceipts: FarmReceiptInspection[];
}

const TOLERANCE = 1e-9;

export function doseSource(input: DoseSourceInput): { warehouseId: string } | { error: string } {
  const { lotNo, quantity, sowFarmId, sowFarmLabel } = input;
  if (!sowFarmId) return { warehouseId: input.collectionStoreId };

  const onFarm = input.stock.filter((s) => s.farm_id === sowFarmId && s.qty > TOLERANCE);
  // The collection store first when it is on her farm (the lot's own layer is there), then the store holding most.
  const enough = onFarm
    .filter((s) => s.qty >= quantity - TOLERANCE)
    .sort((a, b) => Number(b.warehouse_id === input.collectionStoreId) - Number(a.warehouse_id === input.collectionStoreId) || b.qty - a.qty);
  if (enough.length) return { warehouseId: enough[0].warehouse_id };

  const receipts = input.farmReceipts.filter((r) => r.farm_id === sowFarmId);
  const waiting = receipts.find((r) => r.status !== 'CLOSED');
  if (waiting) {
    return { error: `Semen lot ${lotNo} is waiting for its QC inspection at ${sowFarmLabel} (${waiting.inspection_no}); it cannot be used there until it is completed and accepted.` };
  }
  const held = onFarm.reduce((sum, s) => sum + s.qty, 0);
  if (held > TOLERANCE) {
    return { error: `Semen lot ${lotNo} has ${round(held)} dose${held === 1 ? '' : 's'} at ${sowFarmLabel}; ${quantity} cannot be used.` };
  }
  const failed = receipts.find((r) => r.status === 'CLOSED' && !r.posted);
  if (failed) return { error: `Semen lot ${lotNo} did not pass its QC at ${sowFarmLabel} (${failed.inspection_no}); it cannot be used there.` };
  return { error: `Semen lot ${lotNo} has no doses at ${sowFarmLabel}. Send it there by stock transfer first.` };
}

const round = (n: number) => Math.round(n * 100) / 100;
