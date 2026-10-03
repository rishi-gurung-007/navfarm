/**
 * Refuse to run a data-rewriting script against a non-local MySQL host — the
 * guard align-feed-tdd.ts:58 already has, pulled out here (Part E Task 4b fix
 * round 1, Important 3) so recompute-transfer-status.ts does not re-invent
 * it, and so neither one drifts from the other's refusal shape.
 */
export function assertLocalHost(host: string, allowRemote: unknown): void {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !allowRemote) {
    throw new Error(`Refusing to run against non-local host ${host}.`);
  }
}
