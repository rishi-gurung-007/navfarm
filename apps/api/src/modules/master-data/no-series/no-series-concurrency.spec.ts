import { Test, TestingModule } from '@nestjs/testing';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { ClsService } from 'nestjs-cls';

describe('NoSeries Concurrency', () => {
  let service: NumberSeriesService;

  // Simulate a real database row with concurrency queue simulating row-level lock (SELECT FOR UPDATE)
  let simulatedRow = {
    id: 'series-feed-1',
    code: 'FEED',
    no_series_code: 'FEED-',
    increment_by: 1,
    manual_nos: false,
    last_no_used: null as string | null,
    blocked: false,
  };

  // Mutex simulating database row lock
  let lockPromise = Promise.resolve();

  const mockDb = {
    execute: jest.fn().mockResolvedValue([]),
    transaction: jest.fn(async (callback: any) => {
      // Row-level lock acquisition
      let releaseLock: () => void;
      const acquireLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const previousLock = lockPromise;
      lockPromise = lockPromise.then(() => acquireLock);

      await previousLock;
      try {
        const tx = {
          execute: jest.fn().mockResolvedValue([]),
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  for: jest.fn().mockImplementation(async () => {
                    // Small delay simulating DB latency
                    await new Promise((r) => setTimeout(r, 10));
                    return [{ ...simulatedRow }];
                  }),
                }),
              }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockImplementation((updates: any) => ({
              where: jest.fn().mockImplementation(async () => {
                if (updates.last_no_used) {
                  simulatedRow.last_no_used = updates.last_no_used;
                }
              }),
            })),
          }),
        };

        return await callback(tx);
      } finally {
        releaseLock!();
      }
    }),
  };

  beforeEach(async () => {
    simulatedRow = {
      id: 'series-feed-1',
      code: 'FEED',
      no_series_code: 'FEED-',
      increment_by: 1,
      manual_nos: false,
      last_no_used: null,
      blocked: false,
    };
    lockPromise = Promise.resolve();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NumberSeriesService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue(mockDb),
          },
        },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: NobLobResolutionService, useValue: { resolve: jest.fn() } },
      ],
    }).compile();

    service = module.get<NumberSeriesService>(NumberSeriesService);
  });

  it('should safely generate sequential unique numbers for concurrent requests without collisions', async () => {
    const concurrentRequestsCount = 10;

    // Fire 10 requests simultaneously
    const requests = Array.from({ length: concurrentRequestsCount }, () =>
      service.generateNextNumberById('series-feed-1')
    );

    const results = await Promise.all(requests);
    const generatedNumbers = results.map((r) => r.next_number);

    // Verify all 10 numbers are unique
    const uniqueNumbers = new Set(generatedNumbers);
    expect(uniqueNumbers.size).toBe(concurrentRequestsCount);

    // Verify sequential ordering from FEED-0001 to FEED-0010
    const expected = Array.from({ length: concurrentRequestsCount }, (_, i) =>
      `FEED-${String(i + 1).padStart(4, '0')}`
    );
    expect(generatedNumbers).toEqual(expected);
  });
});
