/**
 * The GRN line the next animal registered from a GRN comes from (Rishi, 14 Oct): the GRN's lines of that item, in
 * order, each holding as many animals as it received; `registered` animals have already been taken. Undefined when
 * every animal the GRN received is registered.
 */
export function receiptLineFor<T extends { quantity: number }>(lines: T[], registered: number): T | undefined {
  let taken = registered;
  for (const line of lines) {
    const held = Math.floor(Number(line.quantity));
    if (taken < held) return line;
    taken -= held;
  }
  return undefined;
}
