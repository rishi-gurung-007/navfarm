import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { AnimalService } from './animal.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { AnimalMovementLogService } from '../animal-movement-log/animal-movement-log.service';
import { transactionCls } from '../../../test-utils/transaction-cls';

/**
 * Checklist item 6 (28 Sep check): a stage move through the screen changed
 * animal_register.current_stage_id and wrote nothing else, so "which animals
 * were in which stage, from–to" had no source at all — animal_movement_log was
 * empty across the whole demo database and batch_stage_log with it. The
 * batch-level cascade already records STAGE_CHANGE rows (batch.service.ts);
 * the per-animal path did not. transitionStage is the single path — bulk loops
 * over it — so one record() there covers both.
 */
describe('AnimalService.transitionStage writes stage history (checklist 6)', () => {
  const found = (row: any) => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) });
  const mockDbSelect = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDb = {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    insert: jest.fn(() => ({ values: async () => undefined })),
  };
  const movementLog = { record: jest.fn().mockResolvedValue(undefined) };
  let service: AnimalService;
  let cls: ClsService;

  const ANIMAL = {
    animal_id: 'a-1', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-pig', breed_id: 'breed-1',
    animal_code: 'PIG-2026-0001', is_active: true, gender: 'F', parity_count: 0,
    current_stage_id: 'stage-gilt', current_batch_id: 'batch-1', current_location_id: 'pen-1',
    entry_date: '2026-01-01', created_at: '2026-01-01 00:00:00',
  };

  /** findOne, destination stage, current stage, batch, location, then findOne again. */
  const happyPath = () => {
    mockDbSelect
      .mockReturnValueOnce(found(ANIMAL))
      .mockReturnValueOnce(found({ stage_id: 'stage-flush', stage_code: 'FLUSH', stage_name: 'Flush', tenant_id: 'tenant-123', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-pig', is_active: true }))
      .mockReturnValueOnce(found({ stage_id: 'stage-gilt', stage_code: 'GILT_GROWER', stage_name: 'Gilt Grower', min_days_before_move: 0, tenant_id: 'tenant-123', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-pig', is_active: true }))
      .mockReturnValueOnce(found({ batch_id: 'batch-1', tenant_id: 'tenant-123', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-pig', farm_id: 'farm-1', breed_id: 'breed-1', animal_tracking: 'REGISTERED' }))
      .mockReturnValueOnce(found({ location_id: 'pen-1', tenant_id: 'tenant-123', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-pig', farm_id: 'farm-1', parent_location_id: 'shed-1', location_type: 'PEN' }))
      .mockReturnValue(found(ANIMAL));
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDbUpdate.mockReturnValue({ set: () => ({ where: async () => undefined }) });
    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnimalService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: { generateNext: jest.fn() } },
        { provide: NobLobResolutionService, useValue: { resolve: jest.fn(async () => ({ nob_id: 'nob-1', lob_id: 'lob-pig' })) } },
        { provide: AnimalMovementLogService, useValue: movementLog },
      ],
    }).compile();
    service = module.get<AnimalService>(AnimalService);
  });

  it('records one STAGE_CHANGE row with the stage it came from and the stage it went to', async () => {
    happyPath();
    await service.transitionStage('a-1', { to_stage_id: 'stage-flush', transition_date: '2026-09-28', remarks: 'moved on plan' } as any, 'tenant-123', { userId: 'u-1' });
    expect(movementLog.record).toHaveBeenCalledTimes(1);
    expect(movementLog.record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-123',
      companyId: 'comp-1',
      animalId: 'a-1',
      movementType: 'STAGE_CHANGE',
      eventDate: '2026-09-28',
      fromStageId: 'stage-gilt',
      toStageId: 'stage-flush',
      fromBatchId: 'batch-1',
      toBatchId: 'batch-1',
      fromLocationId: 'pen-1',
      toLocationId: 'pen-1',
      userId: 'u-1',
    }));
  });

  it('dates the row by the transition date the caller gave, not by today', async () => {
    happyPath();
    await service.transitionStage('a-1', { to_stage_id: 'stage-flush', transition_date: '2026-08-01' } as any, 'tenant-123', { userId: 'u-1' });
    expect(movementLog.record.mock.calls[0][0].eventDate).toBe('2026-08-01');
  });

  it('carries the reason through, so an overridden minimum duration is on the record', async () => {
    happyPath();
    await service.transitionStage('a-1', { to_stage_id: 'stage-flush', transition_date: '2026-09-28', reason: 'vet advice' } as any, 'tenant-123', { userId: 'u-1' });
    expect(movementLog.record.mock.calls[0][0].reason).toBe('vet advice');
  });

  it('writes no history when the transition is refused', async () => {
    mockDbSelect.mockReturnValueOnce(found({ ...ANIMAL, current_batch_id: null }));
    await expect(service.transitionStage('a-1', { to_stage_id: 'stage-flush', transition_date: '2026-09-28' } as any, 'tenant-123'))
      .rejects.toThrow(/Registered Animals Batch/i);
    expect(movementLog.record).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('records one row per animal a bulk move succeeds on, and none for the ones it fails', async () => {
    happyPath();
    // The second animal is unplaced, so its transition throws and is collected.
    mockDbSelect.mockReturnValueOnce(found({ ...ANIMAL, animal_id: 'a-2', current_batch_id: null }));
    const res = await service.bulkTransitionStage(
      { animal_ids: ['a-1', 'a-2'], to_stage_id: 'stage-flush', transition_date: '2026-09-28' } as any,
      'tenant-123',
      { userId: 'u-1' },
    );
    expect(res.moved).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(movementLog.record).toHaveBeenCalledTimes(1);
    expect(movementLog.record.mock.calls[0][0].animalId).toBe('a-1');
  });
});
