/**
 * The four-farm feed demo fixture — data, not code paths.
 *
 * The controlled demo topology (docs/decisions.md, 2026-09-30): exactly one
 * tenant, one company, one active Piggery operational area, and four farms
 * that together exercise every supported silo-to-shed relationship:
 *
 *   Farm 1  1:1            — one shed, one silo, linked one-to-one
 *   Farm 2  shared silo    — several sheds supplied by one silo
 *   Farm 3  many-to-many   — several sheds and several silos, cross-linked
 *   Farm 4  mixed          — one exclusive 1:1 pair, one silo serving several
 *                            sheds, and one shed drawing from several silos
 *
 * Silos are farm children. `silo_shed_link` is the only shed-allocation
 * graph. Silos sharing a shed must not hold the same positive-stock feed
 * item — the seeder enforces that at posting time; this fixture enforces
 * everything structural.
 *
 * NOTHING in the farm list below is client data. The four topology shapes are
 * approved; the identities are this repo's own labelled placeholder fixture,
 * to be swapped wholesale for Rishi's approved farm list before any retained
 * database is touched (plan: "Inputs required before applying the fixture").
 */

export interface SiloSeed {
  key: string;
  name: string;
  siloCapacityKg: number;
  siloCapacityUom: 'KG' | 'TON';
  siloReorderDays: number;
  /**
   * Feed item keys (the item catalog's own handles, not item codes) this
   * silo is assigned to in the demo. The same-item rule is checked against
   * these: two silos linked to one shed must never name the same key.
   */
  feedItemKeys: string[];
}

export interface PenSeed {
  key: string;
  name: string;
  capacity: number;
}

export interface ShedSeed {
  key: string;
  name: string;
  capacity: number;
  pens: PenSeed[];
}

export interface FarmSeed {
  key: string;
  name: string;
  address: string | null;
  sheds: ShedSeed[];
  silos: SiloSeed[];
  /** silo key -> shed keys it may feed. Every endpoint must belong to this farm. */
  links: Record<string, string[]>;
}

export interface FourFarmFeedFixture {
  /** Labelled provenance — the seeder prints it and the spec asserts it. */
  provenance: string;
  farms: FarmSeed[];
}

/**
 * Every identity below is ours, illustrative, and labelled as such — the same
 * standing as the feed workbook's example values (decisions.md, 2026-09-30).
 * Counts are the smallest that can express each topology case.
 */
export const FOUR_FARM_FEED_FIXTURE: FourFarmFeedFixture = {
  provenance:
    'Illustrative fixture (this repo, 2026-09-30): approved topology shapes with placeholder identities. '
    + 'Replace with the four approved Triple C farms before any retained-database transition.',
  farms: [
    {
      key: 'FARM1',
      name: 'Demo Farm One',
      address: null,
      sheds: [{ key: 'F1-SHED1', name: 'Farm One Shed 1', capacity: 300, pens: [{ key: 'F1-SHED1-P1', name: 'Farm One Shed 1 Pen 1', capacity: 300 }] }],
      silos: [{ key: 'F1-SILO1', name: 'Farm One Feed Silo 1', siloCapacityKg: 12000, siloCapacityUom: 'KG', siloReorderDays: 2, feedItemKeys: ['FEED_GROWER'] }],
      links: { 'F1-SILO1': ['F1-SHED1'] },
    },
    {
      key: 'FARM2',
      name: 'Demo Farm Two',
      address: null,
      sheds: [
        { key: 'F2-SHED1', name: 'Farm Two Shed 1', capacity: 300, pens: [{ key: 'F2-SHED1-P1', name: 'Farm Two Shed 1 Pen 1', capacity: 300 }] },
        { key: 'F2-SHED2', name: 'Farm Two Shed 2', capacity: 300, pens: [{ key: 'F2-SHED2-P1', name: 'Farm Two Shed 2 Pen 1', capacity: 300 }] },
      ],
      silos: [{ key: 'F2-SILO1', name: 'Farm Two Feed Silo 1', siloCapacityKg: 20000, siloCapacityUom: 'KG', siloReorderDays: 2, feedItemKeys: ['FEED_GROWER'] }],
      links: { 'F2-SILO1': ['F2-SHED1', 'F2-SHED2'] },
    },
    {
      key: 'FARM3',
      name: 'Demo Farm Three',
      address: null,
      sheds: [
        { key: 'F3-SHED1', name: 'Farm Three Shed 1', capacity: 300, pens: [{ key: 'F3-SHED1-P1', name: 'Farm Three Shed 1 Pen 1', capacity: 300 }] },
        { key: 'F3-SHED2', name: 'Farm Three Shed 2', capacity: 300, pens: [{ key: 'F3-SHED2-P1', name: 'Farm Three Shed 2 Pen 1', capacity: 300 }] },
      ],
      silos: [
        { key: 'F3-SILO1', name: 'Farm Three Feed Silo 1', siloCapacityKg: 15000, siloCapacityUom: 'KG', siloReorderDays: 2, feedItemKeys: ['FEED_GROWER'] },
        { key: 'F3-SILO2', name: 'Farm Three Feed Silo 2', siloCapacityKg: 15000, siloCapacityUom: 'KG', siloReorderDays: 2, feedItemKeys: ['FEED_LACTATION'] },
      ],
      // Deliberate cross-links: each silo reaches both sheds, each shed draws
      // from both silos — the many-to-many case.
      links: {
        'F3-SILO1': ['F3-SHED1', 'F3-SHED2'],
        'F3-SILO2': ['F3-SHED1', 'F3-SHED2'],
      },
    },
    {
      key: 'FARM4',
      name: 'Demo Farm Four',
      address: null,
      sheds: [
        { key: 'F4-SHED1', name: 'Farm Four Shed 1', capacity: 300, pens: [{ key: 'F4-SHED1-P1', name: 'Farm Four Shed 1 Pen 1', capacity: 300 }] },
        { key: 'F4-SHED2', name: 'Farm Four Shed 2', capacity: 300, pens: [{ key: 'F4-SHED2-P1', name: 'Farm Four Shed 2 Pen 1', capacity: 300 }] },
        { key: 'F4-SHED3', name: 'Farm Four Shed 3', capacity: 300, pens: [{ key: 'F4-SHED3-P1', name: 'Farm Four Shed 3 Pen 1', capacity: 300 }] },
      ],
      silos: [
        { key: 'F4-SILO1', name: 'Farm Four Feed Silo 1', siloCapacityKg: 12000, siloCapacityUom: 'KG', siloReorderDays: 2, feedItemKeys: ['FEED_GROWER'] },
        { key: 'F4-SILO2', name: 'Farm Four Feed Silo 2', siloCapacityKg: 12000, siloCapacityUom: 'KG', siloReorderDays: 2, feedItemKeys: ['FEED_LACTATION'] },
        // SILO3 shares SHED3 with SILO2, so it must not repeat SILO2's
        // FEED_LACTATION — the same-item rule the validator enforces.
        { key: 'F4-SILO3', name: 'Farm Four Feed Silo 3', siloCapacityKg: 12000, siloCapacityUom: 'KG', siloReorderDays: 2, feedItemKeys: ['FEED_GROWER'] },
      ],
      links: {
        // The exclusive 1:1 pair...
        'F4-SILO1': ['F4-SHED1'],
        // ...a silo serving several sheds...
        'F4-SILO2': ['F4-SHED2', 'F4-SHED3'],
        // ...and a shed drawing from several silos (SHED3 draws SILO2+SILO3).
        'F4-SILO3': ['F4-SHED3'],
      },
    },
  ],
};

export interface FourFarmFixtureIssue {
  farm?: string;
  message: string;
}

/**
 * Structural validation only — the graph rules the plan lists, plus the
 * same-item rule against the fixture's own feed-item assignments. Identity
 * uniqueness is part of structure; whether a name is Triple C's is not, and
 * is nobody's to check here.
 */
export function validateFourFarmFixture(fixture: FourFarmFeedFixture): FourFarmFixtureIssue[] {
  const issues: FourFarmFixtureIssue[] = [];
  const push = (message: string, farm?: string) => issues.push(farm ? { farm, message } : { message });

  if (fixture.farms.length !== 4) {
    push(`The approved demo matrix is exactly four farms, got ${fixture.farms.length}.`);
  }

  const farmKeys = new Set<string>();
  const shedKeys = new Set<string>();
  const siloKeys = new Set<string>();
  const penKeys = new Set<string>();

  for (const farm of fixture.farms) {
    if (!farm.key || farmKeys.has(farm.key)) push(`Duplicate or missing farm key '${farm.key}'.`, farm.key);
    farmKeys.add(farm.key);
    if (fixture.farms.filter((f) => f.key === farm.key).length > 1) continue;
    if (!farm.sheds.length) push(`Farm '${farm.key}' has no sheds — empty farms are rejected.`, farm.key);
    if (!farm.silos.length) push(`Farm '${farm.key}' has no silos.`, farm.key);

    for (const shed of farm.sheds) {
      if (!shed.key || shedKeys.has(shed.key)) push(`Duplicate or missing shed key '${shed.key}'.`, farm.key);
      if (shedKeys.has(shed.key)) continue;
      shedKeys.add(shed.key);
      if (!shed.pens.length) push(`Shed '${shed.key}' has no pens.`, farm.key);
      for (const pen of shed.pens) {
        if (!pen.key || penKeys.has(pen.key)) push(`Duplicate or missing pen key '${pen.key}'.`, farm.key);
        penKeys.add(pen.key);
      }
    }

    for (const silo of farm.silos) {
      if (!silo.key || siloKeys.has(silo.key)) push(`Duplicate or missing silo key '${silo.key}'.`, farm.key);
      siloKeys.add(silo.key);
      if (silo.siloCapacityKg == null || silo.siloCapacityKg <= 0) push(`Silo '${silo.key}' needs a positive siloCapacityKg.`, farm.key);
      if (!['KG', 'TON'].includes(silo.siloCapacityUom)) push(`Silo '${silo.key}' capacity UOM must be KG or TON.`, farm.key);
      if (!silo.feedItemKeys.length) push(`Silo '${silo.key}' names no feed items — the same-item rule cannot be evaluated.`, farm.key);
    }

    // Links: both endpoints belong to this farm; no duplicate pair.
    const seenPairs = new Set<string>();
    for (const [siloKey, shedKeyList] of Object.entries(farm.links)) {
      if (!farm.silos.some((s) => s.key === siloKey)) {
        push(`Link names unknown silo '${siloKey}' on farm '${farm.key}'.`, farm.key);
        continue;
      }
      if (!shedKeyList.length) push(`Link for silo '${siloKey}' names no sheds.`, farm.key);
      for (const shedKey of shedKeyList) {
        if (!farm.sheds.some((s) => s.key === shedKey)) {
          push(`Link '${siloKey}' -> '${shedKey}' crosses farms or names an unknown shed.`, farm.key);
          continue;
        }
        const pair = `${siloKey}->${shedKey}`;
        if (seenPairs.has(pair)) push(`Duplicate link '${pair}'.`, farm.key);
        seenPairs.add(pair);
      }
    }
    for (const silo of farm.silos) {
      if (!(silo.key in farm.links)) push(`Silo '${silo.key}' has no link entry — every silo must declare its sheds.`, farm.key);
    }
  }

  // Same-item rule (D9): silos sharing a shed must not carry the same feed item.
  const itemByShed = new Map<string, Map<string, Set<string>>>();
  for (const farm of fixture.farms) {
    for (const [siloKey, shedKeyList] of Object.entries(farm.links)) {
      const silo = farm.silos.find((s) => s.key === siloKey);
      if (!silo) continue;
      for (const shedKey of shedKeyList) {
        if (!farm.sheds.some((s) => s.key === shedKey)) continue;
        if (!itemByShed.has(shedKey)) itemByShed.set(shedKey, new Map());
        for (const itemKey of silo.feedItemKeys) {
          const items = itemByShed.get(shedKey)!.get(itemKey) ?? new Set<string>();
          items.add(siloKey);
          itemByShed.get(shedKey)!.set(itemKey, items);
        }
      }
    }
  }
  for (const [shedKey, items] of itemByShed) {
    for (const [itemKey, silos] of items) {
      if (silos.size > 1) {
        push(`Shed '${shedKey}' is served by ${silos.size} silos holding the same feed item '${itemKey}' (${[...silos].join(', ')}).`, shedKey);
      }
    }
  }

  return issues;
}

/** Throws when the fixture is structurally invalid — the seeder calls this first. */
export function assertFourFarmFixture(fixture: FourFarmFeedFixture): void {
  const issues = validateFourFarmFixture(fixture);
  if (issues.length) {
    throw new Error(`Four-farm fixture is invalid:\n${issues.map((i) => ` - ${i.farm ? `[${i.farm}] ` : ''}${i.message}`).join('\n')}`);
  }
}

/** The four approved topology cases, asserted by name. */
export function fixtureTopologyReport(fixture: FourFarmFeedFixture): Array<{ farm: string; topology: '1:1' | 'SHARED_SILO' | 'MANY_TO_MANY' | 'MIXED' }> {
  // Classification, most specific first. A fully cross-linked farm (every
  // shed drawing more than one silo) is MANY_TO_MANY; a farm where every
  // shed still draws exactly one silo but a silo serves several is
  // SHARED_SILO; anything combining exclusive pairs with shared ones is MIXED.
  return fixture.farms.map((farm) => {
    const siloShedCounts = Object.values(farm.links).map((sheds) => sheds.length);
    const shedSiloCounts = farm.sheds.map((shed) => Object.entries(farm.links).filter(([, sheds]) => sheds.includes(shed.key)).length);
    const everyShedExclusive = shedSiloCounts.every((n) => n === 1);
    const someSiloShared = siloShedCounts.some((n) => n > 1);
    if (!someSiloShared && everyShedExclusive) return { farm: farm.key, topology: '1:1' as const };
    if (everyShedExclusive) return { farm: farm.key, topology: 'SHARED_SILO' as const };
    if (shedSiloCounts.every((n) => n > 1)) return { farm: farm.key, topology: 'MANY_TO_MANY' as const };
    return { farm: farm.key, topology: 'MIXED' as const };
  });
}
