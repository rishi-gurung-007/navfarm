import { SYSTEM_STAGE_SEED, SYSTEM_BREED_LIFECYCLE_SEED } from './system-master-data-seed';
import { DOCUMENTED_REASONS } from './reason-code-seed';

/**
 * The catalog is named by the TDD tracker (row 24) and timed by BBP-1 §1.7.
 * Both halves are asserted here, because the whole point of the split is that
 * changing a name must not quietly change a duration.
 */
describe('piggery master stage catalog', () => {
  it('contains exactly the 8 piggery stages in sequence', () => {
    expect(SYSTEM_STAGE_SEED.map((s) => s.stage_code)).toEqual([
      'QUARANTINE', 'GILT_REARING', 'INSEMINATION', 'GESTATION', 'FARROWING',
      'LACTATION', 'PRODUCTIVE_SOW', 'FLUSH',
    ]);
  });

  it('keeps the BBP durations even though the names came from the TDD', () => {
    const duration = (code: string) => SYSTEM_STAGE_SEED.find((s) => s.stage_code === code)?.typical_duration_days;
    expect(duration('GESTATION')).toBe(116);
    expect(duration('GILT_REARING')).toBe(210);
    expect(duration('LACTATION')).toBe(28);
    expect(duration('QUARANTINE')).toBe(28);
    for (const code of ['FLUSH', 'FARROWING']) expect(duration(code)).toBeUndefined();
  });

  it('keeps transitions, reason restrictions and seeded profiles inside the catalog', () => {
    const codes = SYSTEM_STAGE_SEED.map((s) => s.stage_code);
    for (const s of SYSTEM_STAGE_SEED) if (s.next_stage_code) expect(codes).toContain(s.next_stage_code);
    for (const r of DOCUMENTED_REASONS) for (const code of r.applicable_stages || []) expect(codes).toContain(code);
    for (const row of SYSTEM_BREED_LIFECYCLE_SEED) expect(codes).toContain(row.stage_code);
    expect(SYSTEM_BREED_LIFECYCLE_SEED.filter((s) => s.stage_code === 'GESTATION').every((s) => s.period_to === 116)).toBe(true);
  });
});
