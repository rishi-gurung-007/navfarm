/**
 * W9: what the transfer screens show for an item, warehouse or user the client
 * list does not hold. The row usually carries its own code or name (ledger rows
 * carry item_code), so that comes before "Not available" — and a raw id never shows.
 */
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function itemCodeOf(
  items: ReadonlyArray<Record<string, any>>,
  itemId: string | null | undefined,
  rowCode: string | null | undefined,
  notAvailable: string,
): string {
  const it = itemId ? items.find((i) => i.item_id === itemId) : undefined;
  return text(it?.item_code) || text(rowCode) || notAvailable;
}

export function warehouseCodeOf(
  warehouses: ReadonlyArray<Record<string, any>>,
  id: string | null | undefined,
  rowCodeOrName: string | null | undefined,
  notAvailable: string,
): string {
  const w = id ? warehouses.find((wh) => wh.warehouse_id === id) : undefined;
  return text(w?.warehouse_code) || text(rowCodeOrName) || notAvailable;
}

export function userDisplayNameOf(
  users: ReadonlyArray<Record<string, any>>,
  idOrName: string | null | undefined,
  rowName: string | null | undefined,
  notAvailable: string,
): string {
  if (!idOrName) return "System";
  const found = users.find((u) => u.user_id === idOrName || u.userId === idOrName);
  return text(found?.full_name) || text(found?.fullName) || text(found?.email) || text(rowName) || notAvailable;
}
