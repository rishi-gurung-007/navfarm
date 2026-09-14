import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { SchedulerHeaderService } from './scheduler-header.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { FarmScope } from '../../../common/farm-scope';

describe('SchedulerHeaderService', () => {
  let service: SchedulerHeaderService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbDelete = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  };

  // Unset (undefined) by default so farmScope() falls back to UNRESTRICTED_FARM_SCOPE,
  // matching every request-less/internal caller. Tests that need a bounded farm call
  // useFarmScope() to stub the CLS 'farmScope' key, same pattern as batch.service.spec.
  let farmScopeValue: FarmScope | undefined;
  const useFarmScope = (scope: FarmScope) => { farmScopeValue = scope; };
  const clsGet = jest.fn((key?: string) => {
    if (key === 'tenantDb') return mockDb;
    if (key === 'farmScope') return farmScopeValue;
    return undefined;
  });

  /** findOne()'s scoped batch_id existence check — insert this between the header
   * select and the lines select in every mockDbSelect sequence that reaches findOne. */
  const batchInScopeRow = (batchId: string) => ({
    from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ batch_id: batchId }]) }) }),
  });

  const batch = {
    batch_id: 'batch-1',
    tenant_id: 'tenant-123',
    company_id: 'comp-1',
    breed_id: 'breed-1',
    lob_id: 'lob-1',
    nob_id: 'nob-1',
    location_id: null,
    sub_location_id: 'pen-1',
    shed_id: 'shed-1',
    start_date: '2026-03-06',
    opening_quantity: '15.0000',
    closing_quantity: null,
  };

  const stage = {
    stage_id: 'stage-gest',
    stage_name: 'Gestation',
    typical_duration_days: 114,
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockDbDelete.mockReset();
    farmScopeValue = undefined;
    clsGet.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerHeaderService,
        { provide: ClsService, useValue: { get: clsGet } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<SchedulerHeaderService>(SchedulerHeaderService);
  });

  describe('createForStage', () => {
    it('returns the existing header instead of creating a duplicate for the same (batch, stage)', async () => {
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'sched-existing', batch_id: 'batch-1' }]) }) }) }) // existing header check
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'sched-existing', batch_id: 'batch-1' }]) }) }) }) // findOne: header
        .mockReturnValueOnce(batchInScopeRow('batch-1')) // findOne: farm-scope batch check
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // findOne: lines (no line ids -> custom days skipped)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // findOne: batch_no lookup (no location_id -> silo stock skipped)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }); // findOne: stage_name lookup (no breed_id -> breed lookup skipped)

      const result = await service.createForStage('batch-1', 'stage-gest', 'tenant-123');

      expect(result.scheduler_id).toBe('sched-existing');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('creates a header and a CONSUMPTION line from the breed\'s feed lifecycle standard', async () => {
      const insertedValues: Record<string, any[]> = {};
      mockDbInsert.mockImplementation(() => ({
        values: jest.fn((v: any) => {
          const key = Array.isArray(v) ? 'many' : 'one';
          insertedValues[key] = insertedValues[key] || [];
          insertedValues[key].push(v);
          return Promise.resolve({});
        }),
      }));

      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // no existing header
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([batch]) }) }) }) // batch lookup
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([stage]) }) }) }) // stage lookup
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) }) // priorHeader check — none, so effective_from = batch.start_date and animal_count falls through to opening_quantity
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ liveCount: 0 }]) }) }) // live animal_register count — none tracked, falls back to opening_quantity
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{
          lifecycle_id: 'lc-1', breed_id: 'breed-1', stage_id: 'stage-gest',
          feed_item_id: 'item-feed', feed_qty_per_head_per_day_kg: '2.2000',
          std_mortality_rate_pct: null, output_item_id: null, std_output_qty: null, std_body_weight_kg: null,
          medication_protocol: null, vaccination_protocol: null,
        }]) }) }) }) // breed_lifecycle_stages lookup
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_name: 'Gestation Feed 14%' }]) }) }) }) // feed item name lookup (item_description)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'new-sched', batch_id: 'batch-1', stage_id: 'stage-gest', scheduler_status: 'DRAFT' }]) }) }) }) // findOne: header
        .mockReturnValueOnce(batchInScopeRow('batch-1')) // findOne: farm-scope batch check
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ line_id: 'line-1', line_type: 'CONSUMPTION', item_id: 'item-feed' }]) }) }) // findOne: lines
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // findOne: custom days
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ batch_no: 'BAT-0001' }]) }) }) }) // findOne: batch_no lookup (no location_id -> silo stock skipped)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([stage]) }) }) }) // findOne: stage_name lookup (no breed_id -> breed lookup skipped)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ item_id: 'item-feed', item_name: 'Gestation Feed 14%', uom_primary: 'KG', withdrawal_days: null }]) }) }); // findOne: allItemIds lookup

      const result = await service.createForStage('batch-1', 'stage-gest', 'tenant-123', { userId: 'user-1' });

      const headerInsert = insertedValues.one?.find((v) => v.batch_id === 'batch-1' && v.stage_id === 'stage-gest');
      expect(headerInsert).toBeDefined();
      expect(headerInsert.effective_from).toBe('2026-03-06'); // batch.start_date — first scheduler for this batch
      expect(headerInsert.animal_count).toBe('15'); // no live animal_register rows -> falls back to opening_quantity
      const lineInsert = insertedValues.many?.[0]?.[0];
      expect(lineInsert).toEqual(expect.objectContaining({
        line_type: 'CONSUMPTION', stage_id: 'stage-gest', item_id: 'item-feed',
        item_description: 'Gestation Feed 14%', standard_qty: '2.2000', qty_basis: 'PER_HEAD',
      }));
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].uom).toBe('KG');
    });
  });

  describe('findOne — farm scope', () => {
    it('answers 404 for a scheduler whose batch is outside the farm', async () => {
      useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'sched-1', batch_id: 'batch-on-kintyre' }]) }) }) }) // header
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }); // scoped batch check finds nothing

      await expect(service.findOne('sched-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createManualHeader', () => {
    it('creates a manual scheduler_header with auto_generated=false', async () => {
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // existing check (none)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ ...batch, lob_id: 'lob-1' }]) }) }) }) // batch lookup
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ ...stage, lob_id: 'lob-1' }]) }) }) }) // stage lookup
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // generateLinesFromLifecycle: breed_lifecycle_stages (none)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'new-sched', batch_id: 'batch-1', stage_id: 'stage-gest' }]) }) }) }) // findOne: header
        .mockReturnValueOnce(batchInScopeRow('batch-1')) // findOne: farm-scope batch check
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // findOne: lines
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ batch_no: 'BAT-0001' }]) }) }) }) // findOne: batch
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ breed_name: 'Large White' }]) }) }) }) // findOne: breed
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([stage]) }) }) }); // findOne: stage

      const result = await service.createManualHeader({
        batch_id: 'batch-1',
        stage_id: 'stage-gest',
        data_entry_level: 'SHED',
        effective_from: '2026-03-08',
        animal_count: 20,
      }, 'tenant-123', { userId: 'user-1' });

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('addLine', () => {
    it('rejects a CONSUMPTION line missing item_id/standard_qty/qty_basis', async () => {
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'sched-1', batch_id: 'batch-1', nob_id: 'nob-1', lob_id: 'lob-1' }]) }) }) }) // findOne: header
        .mockReturnValueOnce(batchInScopeRow('batch-1')) // findOne: farm-scope batch check
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // findOne: lines (no line ids -> custom days skipped)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // findOne: batch_no lookup (no location_id -> silo stock skipped)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }); // findOne: stage_name lookup (no breed_id -> breed lookup skipped)

      await expect(
        service.addLine('sched-1', { line_type: 'CONSUMPTION', activity_name: 'Evening Feed' } as any, 'tenant-123'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a line with the same item and overlapping time period', async () => {
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'sched-1', batch_id: 'batch-1', nob_id: 'nob-1', lob_id: 'lob-1' }]) }) }) }) // findOne: header
        .mockReturnValueOnce(batchInScopeRow('batch-1')) // findOne: farm-scope batch check
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([
          {
            line_id: 'line-1',
            line_type: 'CONSUMPTION',
            activity_name: 'Booster Vaccine',
            item_id: 'item-100',
            occurrence: 'DAILY',
            start_day: 1,
            end_day: null,
          }
        ]) }) }) // findOne: lines
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // findOne: customDays
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // findOne: batch
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_name: 'Weaner' }]) }) }) }) // findOne: stage
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ item_id: 'item-100', item_name: 'Booster Premix', uom_primary: 'KG', withdrawal_days: null }]) }) }); // findOne: items

      await expect(
        service.addLine('sched-1', {
          line_type: 'CONSUMPTION',
          activity_name: 'Booster Vaccine',
          item_id: 'item-100',
          occurrence: 'DAILY',
          start_day: 1,
          end_day: null,
          standard_qty: 1.5,
          qty_basis: 'PER_HEAD',
        } as any, 'tenant-123'),
      ).rejects.toThrow('Schedule conflict: Item');
    });
  });
});
