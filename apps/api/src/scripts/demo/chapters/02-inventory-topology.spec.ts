import { siloTransferDestination, stockedSilos } from './02-inventory';
import type { DemoFarm, DemoShed } from '../farms';

/**
 * Plan Task 4's focused chapter spec: the four-farm matrix replaced the
 * nine-farm shape, and the one-silo (1:1) farm must no longer stop the
 * chapter — only the demonstration that intrinsically needs a second silo is
 * skipped, and only where no legal destination exists.
 */

function shed(key: string, role: DemoShed['role'], siloIds: string[] = []): DemoShed {
  return {
    shedId: `${key}-id`, code: key, name: `${key} name`, role,
    siloIds, siloCodes: siloIds.map((id) => `${id}-code`),
    siloId: siloIds[0] ?? null, siloCode: siloIds[0] ? `${siloIds[0]}-code` : null,
    penIds: [`${key}-pen`],
  };
}

function farm(sheds: DemoShed[], silos: Array<{ id: string; code: string }>): DemoFarm {
  return {
    key: 'f1', code: 'TST100', name: 'Test Farm', farmId: 'farm-id', role: 'FARROW_TO_FINISH',
    sheds,
    storeId: 'store-id',
    sowBreed: null, boarBreed: null,
    volume: { sows: 0, boars: 0, gilts: 0, countOnlyBatches: 0, herdScale: 1, days: 1, breedingSows: 0 },
    __silos: silos,
  } as unknown as DemoFarm & { __silos: Array<{ id: string; code: string }> };
}

describe('02-inventory on the four-farm topology (plan Task 4)', () => {
  describe('siloTransferDestination', () => {
    it('returns null on a 1:1 farm — one stocked silo, nothing else, no self-transfer', () => {
      const stocked = [{ id: 's1', code: 'F/SILO-001', feedHandle: 'FEED_GROWER' }];
      expect(siloTransferDestination(stocked, stocked)).toBeNull();
    });

    it('prefers a free silo even when it will take a different ration', () => {
      const stocked = [{ id: 's1', code: 'S1', feedHandle: 'FEED_GROWER' }];
      const dest = siloTransferDestination(stocked, [stocked[0]!, { id: 's2', code: 'S2' }]);
      expect(dest?.id).toBe('s2');
    });

    it('falls back to a stocked silo already on the same ration (D9), never a different one', () => {
      const stocked = [
        { id: 's1', code: 'S1', feedHandle: 'FEED_GROWER' },
        { id: 's2', code: 'S2', feedHandle: 'FEED_GROWER' },
        { id: 's3', code: 'S3', feedHandle: 'FEED_LACTATION' },
      ];
      expect(siloTransferDestination(stocked, stocked)?.id).toBe('s2');
    });

    it('returns null when every other silo holds a different ration', () => {
      const stocked = [
        { id: 's1', code: 'S1', feedHandle: 'FEED_GROWER' },
        { id: 's2', code: 'S2', feedHandle: 'FEED_LACTATION' },
      ];
      expect(siloTransferDestination(stocked, stocked)).toBeNull();
    });

    it('returns null with nothing stocked at all', () => {
      expect(siloTransferDestination([], [{ id: 's1', code: 'S1' }])).toBeNull();
    });
  });

  describe('stockedSilos resolves rations through silo_shed_link, not per-shed assumptions', () => {
    // stockedSilos reads silosOf(farm), which walks farm.sheds[].siloIds —
    // the link-resolved adjacency farms.ts builds. silosOf is exported from
    // farms.ts and is pure over the resolved farm, so the farm fixture here
    // carries sheds whose siloIds ARE the link table's answer.

    it('one silo feeding several sheds is stocked once, with the first shed-code order ration', () => {
      // SHED-A (WEANER) and SHED-B (FINISHER) both draw SILO-1: a shared-silo
      // farm. The silo takes the first shed in code order that draws it —
      // a silo holds one ration (D9), so it cannot take both.
      const silo = { id: 'silo-1', code: 'F/SILO-001' };
      const f = farm([
        shed('F/SHED-001', 'WEANER', ['silo-1']),
        shed('F/SHED-002', 'FINISHER', ['silo-1']),
      ], [silo]);
      const stocked = stockedSilos(f);
      expect(stocked).toHaveLength(1);
      expect(stocked[0]).toMatchObject({ id: 'silo-1', feedHandle: 'FEED_GROWER' }); // WEANER ration, first shed
    });

    it('one shed drawing from several silos stocks each silo, each mapped to that shed\'s ration', () => {
      // The mixed case: SHED-3 draws SILO-2 and SILO-3, both with the same
      // shed role, so both take that shed's ration — exactly what the link
      // table says the shed can draw.
      const f = farm([
        shed('F/SHED-001', 'WEANER', ['silo-1']),
        shed('F/SHED-002', 'FARROWING', ['silo-2', 'silo-3']),
      ], [
        { id: 'silo-1', code: 'F/SILO-001' },
        { id: 'silo-2', code: 'F/SILO-002' },
        { id: 'silo-3', code: 'F/SILO-003' },
      ]);
      const stocked = stockedSilos(f);
      expect(stocked).toHaveLength(3);
      // Both silos of the multi-silo shed take the FARROWING (lactation) ration.
      expect(stocked.find((s) => s.id === 'silo-2')).toMatchObject({ feedHandle: 'FEED_LACTATION' });
      expect(stocked.find((s) => s.id === 'silo-3')).toMatchObject({ feedHandle: 'FEED_LACTATION' });
      // The other silo keeps its own shed's ration.
      expect(stocked.find((s) => s.id === 'silo-1')).toMatchObject({ feedHandle: 'FEED_GROWER' });
    });

    it('ration falls back to gestation for a shed role the mapping does not name', () => {
      // BOAR maps to gestation; the default only applies where no role matched
      // at all (role: null — a shed the seeder named outside the role map).
      const f = farm([shed('F/SHED-001', 'BOAR', ['silo-1'])], [
        { id: 'silo-1', code: 'F/SILO-001' },
      ]);
      const stocked = stockedSilos(f);
      expect(stocked).toHaveLength(1);
      expect(stocked[0]).toMatchObject({ id: 'silo-1', feedHandle: 'FEED_GESTATION' });
    });
  });
});
