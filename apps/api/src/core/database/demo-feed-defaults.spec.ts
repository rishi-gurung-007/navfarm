import { DEMO_NEXT_STAGES, DEMO_SILO_FILL_PCT, DEMO_STAGE_DURATIONS, SILO_HIGH_LEVEL_PCT, SILO_LOW_LEVEL_PCT, defaultSiloLevels, siloFillKg } from './demo-feed-defaults';
import { BBP_STAGE_SEED } from './piggery-bbp-stage-seed';

describe('demo feed defaults (D22, D27, S7, S10)', () => {
  it('sets a silo at 20 % low and 90 % high of its capacity', () => {
    expect([SILO_LOW_LEVEL_PCT, SILO_HIGH_LEVEL_PCT]).toEqual([20, 90]);
    expect(defaultSiloLevels(12000)).toEqual({ lowKg: 2400, highKg: 10800 });
    expect(defaultSiloLevels(6000)).toEqual({ lowKg: 1200, highKg: 5400 });
    expect(defaultSiloLevels(5.8)).toEqual({ lowKg: 1.16, highKg: 5.22 });
  });

  /**
   * The piggery stage seed is the one the demo's stage_master rows come from,
   * and it leaves exactly these four without a duration on purpose ("no single
   * typical day has been specified" — BBP §1.7 gives them as ranges). The demo
   * fills only those, so the seed stays range-honest and its own test is
   * untouched.
   */
  it('times only stages the BBP seed leaves open, and chains the grow-out stages', () => {
    const seeded = (code: string) => BBP_STAGE_SEED.find((s) => s.stage_code === code) as { typical_duration_days?: number } | undefined;
    for (const code of Object.keys(DEMO_STAGE_DURATIONS)) {
      expect(seeded(code)).toBeDefined();
      expect(seeded(code)?.typical_duration_days).toBeUndefined();
    }
    // D36 (Rishi, 28 Sep): FLUSH's latest day is 5 — BBP §1.7 gives 3–5 and the
    // stage master's typical_duration_days is the range's latest day (S7's 14 superseded).
    expect(DEMO_STAGE_DURATIONS).toEqual({ DRY_SOW: 7, FLUSH: 5, FARROWING: 3, WEANING: 1 });
    expect(DEMO_NEXT_STAGES).toEqual({ WEANER: 'GROWER', GROWER: 'FINISHER' });
    expect(DEMO_SILO_FILL_PCT).toBe(50);
  });
});

describe('siloFillKg (S10)', () => {
  it('fills a silo to half its capacity, or the fallback when the capacity is unknown', () => {
    expect(siloFillKg(15000, 2000)).toBe(7500);
    expect(siloFillKg(null, 2000)).toBe(2000);
    expect(siloFillKg(0, 2000)).toBe(2000);
  });
});
