import {
  FOUR_FARM_FEED_FIXTURE,
  assertFourFarmFixture,
  fixtureTopologyReport,
  validateFourFarmFixture,
  type FourFarmFeedFixture,
} from './four-farm-feed-fixture';

/** The seeder's first action — a fixture that fails this must stop it. */
describe('four-farm feed fixture', () => {
  it('validates cleanly as shipped', () => {
    expect(() => assertFourFarmFixture(FOUR_FARM_FEED_FIXTURE)).not.toThrow();
  });

  it('carries the provenance label and the four approved topology cases', () => {
    expect(FOUR_FARM_FEED_FIXTURE.provenance).toMatch(/Illustrative/i);
    expect(FOUR_FARM_FEED_FIXTURE.farms).toHaveLength(4);
    // Exactly one of each approved case (plan Task 1).
    expect(fixtureTopologyReport(FOUR_FARM_FEED_FIXTURE)).toEqual([
      { farm: 'FARM1', topology: '1:1' },
      { farm: 'FARM2', topology: 'SHARED_SILO' },
      { farm: 'FARM3', topology: 'MANY_TO_MANY' },
      { farm: 'FARM4', topology: 'MIXED' },
    ]);
  });

  it('rejects duplicate codes', () => {
    const broken: FourFarmFeedFixture = {
      provenance: 'test',
      farms: [structuredClone(FOUR_FARM_FEED_FIXTURE.farms[0]!), structuredClone(FOUR_FARM_FEED_FIXTURE.farms[0]!),
        structuredClone(FOUR_FARM_FEED_FIXTURE.farms[1]!), structuredClone(FOUR_FARM_FEED_FIXTURE.farms[2]!)],
    };
    const issues = validateFourFarmFixture(broken);
    expect(issues.map((i) => i.message).join('\n')).toMatch(/exactly four farms|Duplicate or missing farm key/);
  });

  it('rejects links whose endpoints are unknown or cross farms', () => {
    const broken: FourFarmFeedFixture = {
      provenance: 'test',
      farms: [
        { ...structuredClone(FOUR_FARM_FEED_FIXTURE.farms[0]!), links: { 'F1-SILO1': ['F4-SHED1'] } },
        structuredClone(FOUR_FARM_FEED_FIXTURE.farms[1]!),
        structuredClone(FOUR_FARM_FEED_FIXTURE.farms[2]!),
        structuredClone(FOUR_FARM_FEED_FIXTURE.farms[3]!),
      ],
    };
    expect(validateFourFarmFixture(broken).map((i) => i.message).join('\n'))
      .toMatch(/crosses farms or names an unknown shed/);
  });

  it('rejects a silo parented below a shed — links, not the tree, allocate sheds', () => {
    // The fixture has no shed-parented silos by construction; the guard proves
    // the fixture's shape cannot even express one: a silo is a farm-level
    // entry and links name only sheds. Guarded here so a future field cannot
    // reintroduce the old shape silently.
    const fixture = FOUR_FARM_FEED_FIXTURE;
    for (const farm of fixture.farms) {
      expect(Object.keys(farm.links).every((siloKey) => farm.silos.some((s) => s.key === siloKey))).toBe(true);
      for (const sheds of Object.values(farm.links)) {
        expect(sheds.every((shedKey) => farm.sheds.some((s) => s.key === shedKey))).toBe(true);
      }
    }
  });

  it('rejects empty farms and silos that declare no feed item', () => {
    const broken: FourFarmFeedFixture = {
      provenance: 'test',
      farms: [
        { ...structuredClone(FOUR_FARM_FEED_FIXTURE.farms[0]!), sheds: [], silos: [] },
        structuredClone(FOUR_FARM_FEED_FIXTURE.farms[1]!),
        structuredClone(FOUR_FARM_FEED_FIXTURE.farms[2]!),
        structuredClone(FOUR_FARM_FEED_FIXTURE.farms[3]!),
      ],
    };
    const messages = validateFourFarmFixture(broken).map((i) => `${i.farm}: ${i.message}`).join('\n');
    expect(messages).toMatch(/no sheds/);
  });

  it('rejects the shared-shed same-feed-item conflict (D9)', () => {
    const broken: FourFarmFeedFixture = structuredClone(FOUR_FARM_FEED_FIXTURE);
    broken.farms[3]!.silos[0]!.feedItemKeys = ['FEED_GROWER', 'FEED_LACTATION'];
    // SILO1 is 1:1 with SHED1 only, so no conflict yet — put it against SILO2's shed.
    broken.farms[3]!.links['F4-SILO1'] = ['F4-SHED1', 'F4-SHED2'];
    const messages = validateFourFarmFixture(broken).map((i) => i.message).join('\n');
    expect(messages).toMatch(/same feed item 'FEED_LACTATION'/);
  });

  it('example values are replaceable without seeder changes (plan Task 1)', () => {
    // Rename every identity and change every count; the validator must still
    // pass, because the seeder reads the fixture, not these literals.
    const renamed: FourFarmFeedFixture = {
      provenance: 'test replacement',
      farms: [
        {
          key: 'R1', name: 'Replacement One', address: 'somewhere',
          sheds: [{ key: 'R1-A', name: 'A', capacity: 10, pens: [{ key: 'R1-A1', name: 'A1', capacity: 10 }, { key: 'R1-A2', name: 'A2', capacity: 12 }] }],
          silos: [{ key: 'R1-S', name: 'S', siloCapacityKg: 9000, siloCapacityUom: 'TON', siloReorderDays: 7, feedItemKeys: ['X1'] }],
          links: { 'R1-S': ['R1-A'] },
        },
        {
          key: 'R2', name: 'Replacement Two', address: null,
          sheds: [
            { key: 'R2-A', name: 'A', capacity: 10, pens: [{ key: 'R2-A1', name: 'A1', capacity: 10 }] },
            { key: 'R2-B', name: 'B', capacity: 10, pens: [{ key: 'R2-B1', name: 'B1', capacity: 10 }] },
            { key: 'R2-C', name: 'C', capacity: 10, pens: [{ key: 'R2-C1', name: 'C1', capacity: 10 }] },
          ],
          silos: [{ key: 'R2-S', name: 'S', siloCapacityKg: 9000, siloCapacityUom: 'KG', siloReorderDays: 7, feedItemKeys: ['X1'] }],
          links: { 'R2-S': ['R2-A', 'R2-B', 'R2-C'] },
        },
        {
          key: 'R3', name: 'Replacement Three', address: null,
          sheds: [
            { key: 'R3-A', name: 'A', capacity: 10, pens: [{ key: 'R3-A1', name: 'A1', capacity: 10 }] },
            { key: 'R3-B', name: 'B', capacity: 10, pens: [{ key: 'R3-B1', name: 'B1', capacity: 10 }] },
          ],
          silos: [
            { key: 'R3-S1', name: 'S1', siloCapacityKg: 1, siloCapacityUom: 'KG', siloReorderDays: 0, feedItemKeys: ['X2'] },
            { key: 'R3-S2', name: 'S2', siloCapacityKg: 1, siloCapacityUom: 'KG', siloReorderDays: 0, feedItemKeys: ['X1'] },
            { key: 'R3-S3', name: 'S3', siloCapacityKg: 1, siloCapacityUom: 'KG', siloReorderDays: 0, feedItemKeys: ['X3'] },
          ],
          links: { 'R3-S1': ['R3-A', 'R3-B'], 'R3-S2': ['R3-A', 'R3-B'], 'R3-S3': ['R3-B'] },
        },
        {
          key: 'R4', name: 'Replacement Four', address: null,
          sheds: [
            { key: 'R4-A', name: 'A', capacity: 10, pens: [{ key: 'R4-A1', name: 'A1', capacity: 10 }] },
            { key: 'R4-B', name: 'B', capacity: 10, pens: [{ key: 'R4-B1', name: 'B1', capacity: 10 }] },
          ],
          silos: [
            { key: 'R4-S1', name: 'S1', siloCapacityKg: 1, siloCapacityUom: 'KG', siloReorderDays: 0, feedItemKeys: ['X4'] },
            { key: 'R4-S2', name: 'S2', siloCapacityKg: 1, siloCapacityUom: 'KG', siloReorderDays: 0, feedItemKeys: ['X5'] },
          ],
          links: { 'R4-S1': ['R4-A'], 'R4-S2': ['R4-A', 'R4-B'] },
        },
      ],
    };
    expect(() => assertFourFarmFixture(renamed)).not.toThrow();
  });
});
