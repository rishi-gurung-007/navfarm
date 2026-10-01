/**
 * Graph-aware location seeding for the four-farm feed demo (plan Task 2).
 *
 * Wraps scripts/lib/seed-location.ts, which already creates every row through
 * the LOCATION series — never a hand-written code — and derives depth from
 * the parent. This layer adds what the fixture needs and the helper does not:
 *
 *   - silo fixture inputs (capacity KG/TON, reorder days) per the 2026-09-24
 *     decision, without weakening seedLocation's own handling;
 *   - silo_shed_link written separately, after every location exists, because
 *     the link table is the allocation graph and must never depend on tree
 *     insertion order;
 *   - a planned node + adjacency printout for read-only and --verify runs,
 *     so a review shows the exact graph before --apply commits it.
 *
 * Nothing here assumes one silo per shed or two per farm — the plan's
 * whole complaint about the nine-farm seed. Topology comes from the fixture
 * alone. Codes are never composed here; they are read back from the rows the
 * series created.
 */
import * as schema from '../../core/database/schema';
import { seedLocation, type SeedLocationInput } from '../lib/seed-location';
import {
  assertFourFarmFixture,
  fixtureTopologyReport,
  type FourFarmFeedFixture,
} from './four-farm-feed-fixture';

export type Executor = { select: any; insert: any; update: any };

export interface FourFarmLocationResult {
  /** fixture key -> seeded location (id + the code the series issued). */
  locations: Map<string, { id: string; code: string }>;
  /** inserted silo_shed_link pairs, as fixture keys. */
  links: Array<{ siloKey: string; shedKey: string }>;
  plan: {
    topology: Array<{ farm: string; topology: string }>;
    nodes: Array<{ key: string; type: string; parent: string | null }>;
    adjacency: Array<{ silo: string; sheds: string[] }>;
  };
}

interface SeedContext {
  tenantId: string;
  companyId: string;
  nobId?: string | null;
  lobId?: string | null;
}

/**
 * Seeds the fixture's whole location graph. Idempotent per location name and
 * per link pair — a re-run updates in place rather than duplicating, the same
 * convention seedLocation already follows.
 */
export async function seedFourFarmLocations(
  executor: Executor,
  ctx: SeedContext,
  fixture: FourFarmFeedFixture,
): Promise<FourFarmLocationResult> {
  // Structure first: a fixture that fails validation never reaches the database.
  assertFourFarmFixture(fixture);

  const locations = new Map<string, { id: string; code: string }>();
  const nodes: Array<{ key: string; type: string; parent: string | null }> = [];

  const place = async (
    key: string,
    name: string,
    type: 'FARM' | 'SHED' | 'PEN' | 'SILO',
    parentKey: string | null,
    extras: Omit<SeedLocationInput, 'key' | 'name' | 'type'> = {},
  ) => {
    const parent = parentKey ? locations.get(parentKey)! : null;
    const seeded = await seedLocation(executor as any, ctx as any, {
      ...extras,
      key,
      name,
      type,
      parent: parent ? { ...parent, level: levelOf(type, parentKey, locations, nodes) } as any : null,
    });
    locations.set(key, { id: seeded.id, code: seeded.code });
    nodes.push({ key, type, parent: parentKey });
    return seeded;
  };

  for (const farm of fixture.farms) {
    await place(farm.key, farm.name, 'FARM', null);
    for (const shed of farm.sheds) {
      await place(shed.key, shed.name, 'SHED', farm.key, { capacity: shed.capacity });
      for (const pen of shed.pens) {
        await place(pen.key, pen.name, 'PEN', shed.key, { capacity: pen.capacity });
      }
    }
    for (const silo of farm.silos) {
      await place(silo.key, silo.name, 'SILO', farm.key, {
        storageType: 'SILO',
        siloCapacityKg: silo.siloCapacityKg,
        siloCapacityUom: silo.siloCapacityUom,
        siloReorderDays: silo.siloReorderDays,
      });
    }
  }

  // Links go in last, after every endpoint exists — the plan's ordering rule.
  const links: Array<{ siloKey: string; shedKey: string }> = [];
  for (const farm of fixture.farms) {
    for (const [siloKey, shedKeys] of Object.entries(farm.links)) {
      const silo = locations.get(siloKey)!;
      for (const shedKey of shedKeys) {
        const shed = locations.get(shedKey)!;
        await executor
          .insert(schema.siloShedLink)
          .values({
            link_id: crypto.randomUUID(),
            tenant_id: ctx.tenantId,
            company_id: ctx.companyId,
            silo_id: silo.id,
            shed_id: shed.id,
          })
          .onDuplicateKeyUpdate({ set: { silo_id: silo.id } });
        links.push({ siloKey, shedKey });
      }
    }
  }

  const adjacency = fixture.farms.flatMap((farm) =>
    Object.entries(farm.links).map(([siloKey, shedKeys]) => ({
      silo: `${farm.key}/${siloKey}`,
      sheds: shedKeys,
    })));

  return {
    locations,
    links,
    plan: {
      topology: fixtureTopologyReport(fixture) as Array<{ farm: string; topology: string }>,
      nodes,
      adjacency,
    },
  };
}

function levelOf(
  type: string,
  parentKey: string | null,
  locations: Map<string, { id: string; code: string }>,
  nodes: Array<{ key: string; type: string; parent: string | null }>,
): number {
  if (!parentKey) return 1;
  const parentIndex = nodes.findIndex((n) => n.key === parentKey);
  void type;
  return parentIndex >= 0 ? parentIndex + 2 : 2;
}

/** SQL assertions the seeder's --verify runs after writing (plan Task 2). */
export function locationGraphAssertions() {
  return [
    'SELECT COUNT(*) AS farms FROM location_master WHERE location_type = \'FARM\' AND company_id = ?',
    'SELECT COUNT(*) AS sheds FROM location_master WHERE location_type = \'SHED\' AND company_id = ?',
    'SELECT COUNT(*) AS pens FROM location_master WHERE location_type = \'PEN\' AND company_id = ?',
    'SELECT COUNT(*) AS silos FROM location_master WHERE location_type = \'SILO\' AND company_id = ?',
    // Every silo's parent is a farm, never a shed (2026-09-24 decision).
    'SELECT COUNT(*) AS silos_under_shed FROM location_master s JOIN location_master p ON p.location_id = s.parent_location_id WHERE s.location_type = \'SILO\' AND p.location_type <> \'FARM\' AND s.company_id = ?',
    // No cross-farm links: both endpoints share the silo's farm.
    'SELECT COUNT(*) AS cross_farm_links FROM silo_shed_link l JOIN location_master s ON s.location_id = l.silo_id JOIN location_master d ON d.location_id = l.shed_id WHERE l.company_id = ? AND (d.farm_id IS NULL OR d.farm_id <> s.farm_id)',
    // Duplicate pairs are impossible (uq_silo_shed_link) but count anyway.
    'SELECT COUNT(*) AS total_links FROM silo_shed_link WHERE company_id = ?',
  ];
}

/** Shared-shed silos must not hold the same positive-stock feed item (D9). */
export function sameItemConflict(farmLinks: Record<string, string[]>, siloItems: Record<string, string[]>): string[] {
  const byShed = new Map<string, Map<string, number>>();
  for (const [siloKey, items] of Object.entries(siloItems)) {
    for (const shedKey of farmLinks[siloKey] ?? []) {
      if (!byShed.has(shedKey)) byShed.set(shedKey, new Map());
      for (const item of items) {
        byShed.get(shedKey)!.set(item, (byShed.get(shedKey)!.get(item) ?? 0) + 1);
      }
    }
  }
  const conflicts: string[] = [];
  for (const [shedKey, items] of byShed) {
    for (const [item, count] of items) {
      if (count > 1) conflicts.push(`${shedKey}: ${item} held by ${count} linked silos`);
    }
  }
  return conflicts;
}
