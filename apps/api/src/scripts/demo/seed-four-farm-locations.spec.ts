import {
  sameItemConflict,
  seedFourFarmLocations,
} from './seed-four-farm-locations';
import { FOUR_FARM_FEED_FIXTURE } from './four-farm-feed-fixture';

/**
 * Drives the real seedFourFarmLocations over an in-memory executor. The
 * interesting assertions are the graph's own: ancestry, link endpoints and
 * the D9 same-item rule — the ones the nine-farm seed got wrong.
 */

type Row = Record<string, unknown>;

function fakeDb() {
  const store: Record<string, Row[]> = {
    location_master: [],
    location_type_master: [],
    no_series: [],
    silo_shed_link: [],
  };
  const db: any = { __store: store };
  db.select = (fields?: any) => ({
    from: (table: unknown) => {
      const chain: any = {
        where: () => chain,
        orderBy: () => chain,
        limit: async (n?: number) => {
          const rows = store[(table as any) as string] ?? [];
          return n != null ? rows.slice(0, n) : rows;
        },
        then: (resolve: any, reject: any) => Promise.resolve(store[(table as any) as string] ?? []).then(resolve, reject),
      };
      return chain;
    },
  });
  db.insert = (table: unknown) => ({
    values: (row: Row) => ({
      onDuplicateKeyUpdate: async () => {
        const name = typeof table === 'string' ? table : (table as any)?.[Symbol.for('drizzle:Name')] ?? String(table);
        (store[name] ??= []).push(row);
        return {};
      },
      then: (resolve: any, reject: any) => {
        const name = typeof table === 'string' ? table : (table as any)?.[Symbol.for('drizzle:Name')] ?? String(table);
        (store[name] ??= []).push(row);
        return Promise.resolve({}).then(resolve, reject);
      },
    }),
  });
  db.update = () => ({ set: () => ({ where: async () => ({}) }) });
  return db;
}

describe('seed-four-farm-locations', () => {
  const ctx = { tenantId: 'tenant-1', companyId: 'company-1', nobId: 'nob-1', lobId: 'lob-1' };

  it('materializes the fixture graph: nodes, ancestry, links and adjacency plan', async () => {
    const db = fakeDb();
    const result = await seedFourFarmLocations(db, ctx, FOUR_FARM_FEED_FIXTURE);

    const store = db.__store as Record<string, Row[]>;
    // Every fixture node became exactly one location row.
    expect(store.location_master.length).toBe(
      FOUR_FARM_FEED_FIXTURE.farms.reduce((n, f) => n + 1 + f.sheds.length + f.sheds.reduce((m, s) => m + s.pens.length, 0) + f.silos.length, 0),
    );
    // The four approved topology cases, classified from the links themselves.
    expect(result.plan.topology).toEqual([
      { farm: 'FARM1', topology: '1:1' },
      { farm: 'FARM2', topology: 'SHARED_SILO' },
      { farm: 'FARM3', topology: 'MANY_TO_MANY' },
      { farm: 'FARM4', topology: 'MIXED' },
    ]);
    // 1 + 2 + 4 + 4 pairs across the four farms.
    expect(result.links).toHaveLength(11);
    const siloLinkRows = store.silo_shed_link as Row[];
    expect(siloLinkRows).toHaveLength(11);
    // Every link endpoint is a seeded location id.
    const ids = new Set(store.location_master.map((r) => r.location_id));
    for (const row of siloLinkRows) {
      expect(ids.has(row.silo_id as string)).toBe(true);
      expect(ids.has(row.shed_id as string)).toBe(true);
    }
  });

  it('resolves silos through silo_shed_link, never by assuming one per shed', async () => {
    const db = fakeDb();
    const result = await seedFourFarmLocations(db, ctx, FOUR_FARM_FEED_FIXTURE);
    // Farm 2: one silo, two sheds — the adjacency plan must say so.
    const farm2Adjacency = result.plan.adjacency.filter((a) => a.silo.startsWith('FARM2/'));
    expect(farm2Adjacency).toHaveLength(1);
    expect(farm2Adjacency[0]!.sheds).toEqual(['F2-SHED1', 'F2-SHED2']);
    // Farm 4 SHED3 draws from two silos.
    const farm4Shed3 = result.plan.adjacency.filter((a) => a.sheds.includes('F4-SHED3'));
    expect(farm4Shed3).toHaveLength(2);
  });

  it('flags the D9 same-item conflict for shared sheds', () => {
    expect(sameItemConflict(
      { S1: ['SHED-A'], S2: ['SHED-A', 'SHED-B'] },
      { S1: ['GROWER'], S2: ['LACTATION'] },
    )).toEqual([]);
    expect(sameItemConflict(
      { S1: ['SHED-A'], S2: ['SHED-A'] },
      { S1: ['GROWER'], S2: ['GROWER'] },
    )).toEqual(['SHED-A: GROWER held by 2 linked silos']);
  });

  it('refuses an invalid fixture before touching the database', async () => {
    const db = fakeDb();
    const broken = structuredClone(FOUR_FARM_FEED_FIXTURE);
    broken.farms[0]!.links = {};
    await expect(seedFourFarmLocations(db, ctx, broken)).rejects.toThrow(/invalid/);
    expect((db.__store as Record<string, Row[]>).location_master).toHaveLength(0);
  });
});
