export interface FeedPlanFact {
  farmId: string;
  farmCode: string;
  farmName: string;
  period: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  tentativeKg?: number;
  approvedRequisitionKg?: number;
  shippedKg?: number;
  receivedKg?: number;
  capacityKg?: number | null;
}

export interface FeedPlanRow {
  farm: { id: string; code: string; name: string };
  period: string;
  item: { id: string; code: string; name: string };
  tentativeKg: number;
  approvedRequisitionKg: number;
  shippedKg: number;
  receivedKg: number;
  remainingKg: number;
  varianceKg: number;
  capacityKg: number | null;
}

export function buildFeedPlanRows(facts: FeedPlanFact[]): FeedPlanRow[] {
  const rows = new Map<string, FeedPlanRow>();
  for (const fact of facts) {
    const key = `${fact.period}|${fact.itemId}`;
    const row = rows.get(key) ?? {
      farm: { id: fact.farmId, code: fact.farmCode, name: fact.farmName },
      period: fact.period,
      item: { id: fact.itemId, code: fact.itemCode, name: fact.itemName },
      tentativeKg: 0,
      approvedRequisitionKg: 0,
      shippedKg: 0,
      receivedKg: 0,
      remainingKg: 0,
      varianceKg: 0,
      capacityKg: null,
    };
    row.tentativeKg += Number(fact.tentativeKg ?? 0);
    row.approvedRequisitionKg += Number(fact.approvedRequisitionKg ?? 0);
    row.shippedKg += Number(fact.shippedKg ?? 0);
    row.receivedKg += Number(fact.receivedKg ?? 0);
    if (fact.capacityKg !== null && fact.capacityKg !== undefined) row.capacityKg = (row.capacityKg ?? 0) + Number(fact.capacityKg);
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => ({
    ...row,
    remainingKg: Math.max(0, row.approvedRequisitionKg - row.receivedKg),
    varianceKg: row.approvedRequisitionKg - row.tentativeKg,
  })).sort((a, b) => a.period.localeCompare(b.period) || a.item.code.localeCompare(b.item.code));
}
