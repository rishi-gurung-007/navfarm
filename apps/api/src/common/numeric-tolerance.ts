/**
 * Shared floating-point tolerance for quantity comparisons that sum real event
 * rows in JS float arithmetic. Part E Task 4b found this stranding a transfer
 * short of POSTED in two separate places: ordered 1.3, shipped as 0.6 + 0.7,
 * sums to 1.2999999999999998 in IEEE754 — short of 1.3 by 2e-16 — so a bare
 * `>=` never saw it as fully covered.
 *
 * Before this file existed, the same 1e-9 literal had already been hand-rolled
 * six times: transfer-execution.rules.ts's own `FULLY_COVERED_TOLERANCE`
 * constant, and five bare `1e-9` literals inline in stock-transfer.service.ts
 * (the Task 4b fix round 1 bounds). That proliferation is exactly how the
 * second instance of the Task 4b defect was missed the first time — it was
 * its own unguarded comparison, not reusing the first fix. Import this rather
 * than adding another.
 */
export const FLOAT_SUM_TOLERANCE = 1e-9;
