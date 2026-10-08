/**
 * One activity's consumption is posted as one ledger entry per location it drew from, but every animal
 * keeps its own share. When the stock comes from one location that is simple; when a silo ran short and the
 * farm store gave the rest, the animals' shares are laid end to end across the locations in order, so the
 * first animals take the silo's stock and the last take the store's — and an animal whose share straddles
 * the two is split between them.
 */
export interface Share {
  animal_id?: string;
  quantity: number;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** `parts` are the locations' quantities, in the order they are used; they should add up to the shares. */
export function allocateSharesToParts(shares: Share[], parts: Array<{ quantity: number }>): Share[][] {
  const result: Share[][] = parts.map(() => []);
  let partIndex = 0;
  let partLeft = parts.length ? parts[0].quantity : 0;
  for (const share of shares) {
    let need = share.quantity;
    while (need > 0.00005 && partIndex < parts.length) {
      const last = partIndex === parts.length - 1;
      const take = last ? need : round4(Math.min(need, partLeft));
      if (take > 0) result[partIndex].push({ animal_id: share.animal_id, quantity: take });
      need = round4(need - take);
      partLeft = round4(partLeft - take);
      if (partLeft <= 0.00005 && !last) {
        partIndex += 1;
        partLeft = parts[partIndex].quantity;
      }
      if (last) break;
    }
  }
  return result;
}
