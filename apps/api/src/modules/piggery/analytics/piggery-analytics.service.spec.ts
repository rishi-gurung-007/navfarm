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

  it('should compile and compute Piggery GM Dashboard metrics cleanly', async () => {
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
              period_id: 'p-5',
              period_code: 'P5',
              start_date: '2026-03-27',
              end_date: '2026-07-17',
              is_active: true,
              period_status: 'OPEN',
            },
          ]),
        }),
      }),
    });

    // 3. Animals query mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { animal_id: 'a-1', animal_type: 'SOW', is_active: true, parity_count: 1, current_location_id: 'loc-1' },
          { animal_id: 'a-2', animal_type: 'SOW', is_active: true, parity_count: 2, current_location_id: 'loc-1' },
          { animal_id: 'a-3', animal_type: 'GILT', is_active: true, parity_count: 0, current_location_id: 'loc-2' },
        ]),
      }),
    });

    // 4. Location farms mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { location_id: 'loc-1', location_code: 'POR100', location_name: 'Porta' },
          { location_id: 'loc-2', location_code: 'LIO100', location_name: 'Lion' },
        ]),
      }),
    });

    // 5. Farrowing records mock
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          { farrow_id: 'f-1', sow_animal_id: 'a-1', piglets_born_live: 16, piglets_weaned: 15 },
          { farrow_id: 'f-2', sow_animal_id: 'a-2', piglets_born_live: 15, piglets_weaned: 14 },
        ]),
      }),
    });

    const result = await service.getGmDashboard('test-tenant', 'c-1');

    expect(result).toBeDefined();
    expect(result.metadata.companyName).toBe('Colcom Triple C Piggery');
    expect(result.metadata.periodCode).toBe('P5');
    expect(result.impactSummary.divisionLiveBirths).toBeGreaterThan(0);
    expect(result.coreKpis.avgSowsPresent.value).toBeGreaterThan(0);
    expect(result.coreKpis.bornAlivePerLitter.value).toBe(15.5);
    expect(result.farmScorecard.length).toBeGreaterThan(0);
    expect(result.cycleAnatomy.gestationDays).toBe(116);
  });
});
