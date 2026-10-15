import { Test, TestingModule } from '@nestjs/testing';
import { PiggeryAnalyticsService } from './piggery-analytics.service';
import { ClsService } from 'nestjs-cls';

describe('PiggeryAnalyticsService', () => {
  let service: PiggeryAnalyticsService;

  const mockDb = {
    select: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PiggeryAnalyticsService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockImplementation((key) => {
              if (key === 'tenantDb') return mockDb;
              if (key === 'farmScope') return { tenantId: 'test-tenant' };
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PiggeryAnalyticsService>(PiggeryAnalyticsService);
  });

  it('should compile and compute 100% live Piggery GM Dashboard metrics cleanly', async () => {
    // 1. Company query mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([
            { company_id: 'c-1', company_name: 'Colcom Triple C Piggery' },
          ]),
        }),
      }),
    });

    // 2. Reporting period query mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockResolvedValue([
            {
              period_id: 'p-1',
              period_code: 'P1',
              business_year: '2026',
              start_date: '2026-01-01',
              end_date: '2026-03-31',
              is_active: true,
            },
          ]),
        }),
      }),
    });

    // 3. Animals query mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { animal_id: 'a-1', animal_code: 'DEMO-SOW-01', animal_type: 'SOW', is_active: true, parity_count: 1, current_location_id: 'loc-1' },
          { animal_id: 'a-2', animal_code: 'DEMO-SOW-02', animal_type: 'SOW', is_active: true, parity_count: 2, current_location_id: 'loc-1' },
          { animal_id: 'a-3', animal_code: 'DEMO-GILT-01', animal_type: 'GILT', is_active: true, parity_count: 0, current_location_id: 'loc-1' },
          { animal_id: 'a-4', animal_code: 'DEMO-BOAR-01', animal_type: 'BOAR', is_active: true, parity_count: 0, current_location_id: 'loc-1' },
        ]),
      }),
    });

    // 4. Stages query mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { stage_id: 'st-1', stage_name: 'Gestation' },
          { stage_id: 'st-2', stage_name: 'Lactation' },
        ]),
      }),
    });

    // 5. Farrowing records mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockResolvedValue([
            { farrow_id: 'f-1', sow_animal_id: 'a-1', farrowing_date: '2026-02-10', piglets_born_live: 14, piglets_stillborn: 1, piglets_weaned: 13, weaning_date: '2026-03-03' },
            { farrow_id: 'f-2', sow_animal_id: 'a-2', farrowing_date: '2026-02-12', piglets_born_live: 12, piglets_stillborn: 0, piglets_weaned: 11, weaning_date: '2026-03-05' },
          ]),
        }),
      }),
    });

    // 6. Breeding matings mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { breeding_id: 'b-1', mating_type: 'NATURAL_MATING', conception_result: 'CONFIRMED', pregnancy_confirmed: true },
          { breeding_id: 'b-2', mating_type: 'AI', conception_result: 'CONFIRMED', pregnancy_confirmed: true },
          { breeding_id: 'b-3', mating_type: 'NATURAL_MATING', conception_result: 'FAILED', pregnancy_confirmed: false },
        ]),
      }),
    });

    // 7. Batches query mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { batch_id: 'bt-1', batch_no: 'B-001', current_stage_code: 'GROWER', closing_quantity: '200', total_cost: '12000.00', farm_id: 'loc-1' },
          { batch_id: 'bt-2', batch_no: 'B-002', current_stage_code: 'QUARANTINE', closing_quantity: '10', total_cost: '12331.00', farm_id: 'loc-1' },
        ]),
      }),
    });

    // 8. Batch transactions for WIP mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { batch_id: 'bt-1', amount: '-12000.00' },
          { batch_id: 'bt-2', amount: '-12331.00' },
        ]),
      }),
    });

    // 9. Location farms mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { location_id: 'loc-1', location_code: 'GRA100', location_name: 'Grasmere' },
          { location_id: 'loc-2', location_code: 'POR100', location_name: 'Porta' },
        ]),
      }),
    });

    // 10. All locations hierarchy mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { location_id: 'loc-1', farm_id: null },
          { location_id: 'loc-2', farm_id: null },
        ]),
      }),
    });

    const result = await service.getGmDashboard('test-tenant', {
      companyId: 'c-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
    });

    expect(result).toBeDefined();
    expect(result.metadata.companyName).toBe('Colcom Triple C Piggery');
    expect(result.activeHerdSummary.totalHeadcount).toBe(4);
    expect(result.activeHerdSummary.sowsCount).toBe(2);
    expect(result.activeHerdSummary.giltsCount).toBe(1);
    expect(result.activeHerdSummary.boarsCount).toBe(1);

    expect(result.reproductiveIntelligence.totalLittersRecorded).toBe(2);
    expect(result.reproductiveIntelligence.totalPigletsBornLive).toBe(26);
    expect(result.reproductiveIntelligence.avgBornAlivePerLitter).toBe(13);
    expect(result.reproductiveIntelligence.totalPigletsWeaned).toBe(24);
    expect(result.reproductiveIntelligence.weaningSurvivalRatePct).toBe(92.3);

    expect(result.productionBatchesSummary.activeBatchesCount).toBe(2);
    expect(result.productionBatchesSummary.totalBatchWipValuation).toBe(24331);

    expect(result.facilityLocations.length).toBe(2);
    expect(result.facilityLocations[0].status).toBe('Active Operations');
    expect(result.facilityLocations[1].status).toBe('Standby');
  });
});

/**
 * The GM dashboard keeps to the caller's farm AND line of business (14/15 Oct).
 *
 * A restricted user may hold a LOB and no farm — OPERATIONAL_ADMIN is in RESTRICTED_USER_TYPES but not in
 * FARM_BOUND_USER_TYPES, so farmScope() returns farmId: null with lobId set. The herd and batch sections get both
 * halves from animalScopeConditions / batchScopeConditions, but the litters, the matings and the farm list are
 * scoped by this service itself; when they were scoped on the farm alone, such a user read the whole company's.
 */
describe('PiggeryAnalyticsService — a restricted user with a LOB and no farm', () => {
  /** Every where() the dashboard runs, as SQL text. */
  async function whereClausesFor(scope: Record<string, unknown>): Promise<string[]> {
    const { MySqlDialect } = await import('drizzle-orm/mysql-core');
    const dialect = new MySqlDialect();
    const captured: string[] = [];
    const chain: any = {};
    for (const key of ['from', 'orderBy', 'limit', 'innerJoin', 'leftJoin', 'groupBy']) chain[key] = jest.fn(() => chain);
    chain.where = jest.fn((condition: any) => {
      if (condition) captured.push(dialect.sqlToQuery(condition).sql);
      return chain;
    });
    chain.then = (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject);
    const db = { select: jest.fn(() => chain) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PiggeryAnalyticsService,
        { provide: ClsService, useValue: { get: jest.fn((key) => (key === 'tenantDb' ? db : key === 'farmScope' ? scope : null)) } },
      ],
    }).compile();
    await module.get(PiggeryAnalyticsService).getGmDashboard('tenant-1', {} as any);
    return captured;
  }

  const RESTRICTED = { farmId: null, restricted: true, companyId: 'company-1', lobId: 'lob-1' };

  it('scopes the litters, the matings and the farm list to the LOB, not just to a farm', async () => {
    const clauses = await whereClausesFor(RESTRICTED);
    const touching = (table: string) => clauses.filter((c) => c.includes(table));

    for (const table of ['farrowing_record', 'breeding_record']) {
      const found = touching(table);
      expect(found.length).toBeGreaterThan(0);
      // The sow is matched against the animals of this LOB.
      expect(found.some((c) => c.includes('animal_register') && c.includes('lob_id'))).toBe(true);
    }
    expect(touching('location_master').some((c) => c.includes('lob_id'))).toBe(true);
  });

  it('leaves the queries unscoped for an unrestricted caller with no farm', async () => {
    const clauses = await whereClausesFor({ farmId: null, restricted: false, companyId: null, lobId: null });
    expect(clauses.filter((c) => c.includes('farrowing_record')).some((c) => c.includes('lob_id'))).toBe(false);
  });
});
