/**
 * Feed defaults shared by the demo seed, the demo chapters and the Plan S
 * data migrations, so the three can never disagree (demo-feed-defaults.spec.ts
 * and drizzle/tenant/plan-s-migrations.spec.ts pin them).
 *
 * - Silo levels (D22, Rishi 27 Sep; D27 confirms 20 %): High = 90 % of capacity
 *   (workbook Master Setup §1 row 12), Low = 20 % (ours, confirmed by Rishi).
 * - Stage timings (open question S7): the stages BBP §1.7 gives only as a
 *   range are left empty by the piggery stage seed on purpose; the demo takes
 *   the lengths of its own lifecycle rows (seed-nine-farm-demo.ts), and
 *   migration 0125 fills the same values into existing data only where empty.
 * - Demo silo fill (S10): half of capacity, so a fresh demo sits between the
 *   two levels instead of raising a low-feed alert on every silo.
 */
export const SILO_LOW_LEVEL_PCT = 20;
export const SILO_HIGH_LEVEL_PCT = 90;

export function defaultSiloLevels(capacityKg: number): { lowKg: number; highKg: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    lowKg: round2((capacityKg * SILO_LOW_LEVEL_PCT) / 100),
    highKg: round2((capacityKg * SILO_HIGH_LEVEL_PCT) / 100),
  };
}

export const DEMO_STAGE_DURATIONS: Readonly<Record<string, number>> = { DRY_SOW: 7, FLUSH: 14, FARROWING: 3, WEANING: 1 };
export const DEMO_NEXT_STAGES: Readonly<Record<string, string>> = { WEANER: 'GROWER', GROWER: 'FINISHER' };

export const DEMO_SILO_FILL_PCT = 50;
