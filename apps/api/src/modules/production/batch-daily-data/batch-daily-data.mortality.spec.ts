import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getTableName } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { BatchDailyDataService } from './batch-daily-data.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import { SiloFeedService } from '../../inventory/silo-feed/silo-feed.service';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';
import { LifecycleKpiEvaluator } from '../lifecycle/lifecycle-kpi.evaluator';

jest.mock('../../../common/period-close', () => ({ assertPostingPeriodOpen: jest.fn().mockResolvedValue(undefined) }));

/**
 * Rishi, 12 Oct: on a MORTALITY_COUNT line of a batch with registered animals the user names the animals that died,
 * with dead weight and a reason each. The database here is a fake keyed by table, so what is asserted is what was
 * written to which table, not the order of the reads.
 */
describe('BatchDailyDataService - mortality count names the animals that died', () => {
  const A1 = '11111111-1111-4111-8111-111111111111';
  const A2 = '22222222-2222-4222-8222-222222222222';
  const A3 = '33333333-3333-4333-8333-333333333333';
  const R1 = '44444444-4444-4444-8444-444444444444';
  const RCULL = '55555555-5555-4555-8555-555555555555';

  const line = {
    line_id: 'line-mort', scheduler_id: 'sched-1', is_active: true, line_type: 'DESCRIPTIVE', item_id: null,
    lot_required: false, activity_name: 'Mortality', kpi_metric: 'MORTALITY_COUNT', lower_alert_limit: null, upper_alert_limit: null,
  };
  const header = { scheduler_id: 'sched-1', batch_id: 'batch-1', company_id: 'comp-1', lob_id: 'lob-1', stage_id: 'stage-1', animal_count: '10', location_id: 'shed-1' };
  const animal = (id: string, code: string) => ({ animal_id: id, animal_code: code, rfid_tag: null, notes: null });

  let rows: Record<string, any[]>;
  let updates: Array<{ table: string; set: any }>;
  let inserts: Array<{ table: string; values: any }>;
  let deletes: string[];
  let movementLog: { record: jest.Mock };
  let service: BatchDailyDataService;

  const fakeDb: any = {
    select: () => {
      let name = '';
      const result = () => rows[name] ?? [];
      const terminal: any = {
        limit: () => Promise.resolve(result()),
        orderBy: () => ({ limit: () => Promise.resolve(result()), then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej) }),
        then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
      };
      const builder: any = { from: (t: any) => { name = getTableName(t); return builder; }, where: () => terminal, innerJoin: () => builder };
      return builder;
    },
    update: (t: any) => ({ set: (set: any) => ({ where: () => { updates.push({ table: getTableName(t), set }); return Promise.resolve({}); } }) }),
    insert: (t: any) => ({
      values: (values: any) => {
        inserts.push({ table: getTableName(t), values });
        return { onDuplicateKeyUpdate: () => Promise.resolve({}), then: (res: any, rej: any) => Promise.resolve({}).then(res, rej) };
      },
    }),
    delete: (t: any) => ({ where: () => { deletes.push(getTableName(t)); return Promise.resolve({}); } }),
  };

  beforeEach(async () => {
    rows = {
      scheduler_line: [line],
      scheduler_header: [header],
      batch_header: [{ tracking_mode: 'BATCH_WISE', company_id: 'comp-1', batch_no: 'B-1', farm_id: 'farm-1' }],
      batch_data_entry_lock: [],
      batch_daily_data: [],
      animal_register: [animal(A1, 'PIG-1'), animal(A2, 'PIG-2'), animal(A3, 'PIG-3')],
      reason_master: [{ reason_id: R1, reason_name: 'Respiratory disease', category: 'MORTALITY' }],
      batch_mortality_animal: [],
    };
    updates = []; inserts = []; deletes = [];
    movementLog = { record: jest.fn().mockResolvedValue('m-1') };
    const module = await Test.createTestingModule({
      providers: [
        BatchDailyDataService,
        { provide: ClsService, useValue: { get: jest.fn().mockImplementation((k: string) => (k === 'tenantDb' ? fakeDb : undefined)), run: (w: () => unknown) => w(), set: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: BatchService, useValue: { findOne: jest.fn().mockResolvedValue({}) } },
        { provide: BatchTransferService, useValue: {} },
        { provide: GlPostingService, useValue: {} },
        { provide: AnimalMovementLogService, useValue: movementLog },
        { provide: SiloFeedService, useValue: {} },
        { provide: FeedAlertService, useValue: { evaluateLevelsSafely: jest.fn() } },
        { provide: LifecycleKpiEvaluator, useValue: { evaluateSafely: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();
    service = module.get(BatchDailyDataService);
  });

  const post = (dto: Record<string, unknown>) =>
    service.postEntry('batch-1', { line_id: 'line-mort', entry_date: '2026-10-12', ...dto } as any, 'tenant-1');
  const dead = (id: string, extra: Record<string, unknown> = {}) => ({ animal_id: id, dead_weight_kg: 18.5, reason_id: R1, ...extra });
  const animalUpdates = () => updates.filter((u) => u.table === 'animal_register');

  it('refuses a count of 2 with one animal named, and writes nothing', async () => {
    await expect(post({ entered_value: 2, mortality_animals: [dead(A1)] })).rejects.toThrow(/exactly 2 animals/);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('refuses a post that names no animals at all', async () => {
    await expect(post({ entered_value: 1 })).rejects.toThrow(/Choose the 1 animal/);
  });

  it('refuses an animal that is not alive in this batch and stage', async () => {
    await expect(post({ entered_value: 1, mortality_animals: [dead('99999999-9999-4999-8999-999999999999')] })).rejects.toThrow(/not alive in this batch/);
    expect(updates).toHaveLength(0);
  });

  it('refuses the same animal twice, a missing or zero weight, and a missing reason', async () => {
    await expect(post({ entered_value: 2, mortality_animals: [dead(A1), dead(A1)] })).rejects.toThrow(/more than once/);
    await expect(post({ entered_value: 1, mortality_animals: [dead(A1, { dead_weight_kg: 0 })] })).rejects.toThrow(/dead weight/);
    await expect(post({ entered_value: 1, mortality_animals: [{ animal_id: A1, dead_weight_kg: 5 }] })).rejects.toThrow(/Reason Master, or type one/);
  });

  it('takes exactly one of reason_id and reason_text', async () => {
    await expect(post({ entered_value: 1, mortality_animals: [dead(A1, { reason_text: 'Crushed by sow' })] })).rejects.toThrow(/not both, not neither/);
  });

  it('refuses a reason that is not a mortality reason', async () => {
    rows.reason_master = [{ reason_id: RCULL, reason_name: 'Poor growth', category: 'CULL' }];
    await expect(post({ entered_value: 1, mortality_animals: [dead(A1, { reason_id: RCULL })] })).rejects.toThrow(/not MORTALITY/);
  });

  it('marks only the chosen animals DIED, with their reason, and stores weight and reason per animal', async () => {
    await post({
      entered_value: 2,
      mortality_animals: [dead(A1), { animal_id: A3, dead_weight_kg: 22, reason_text: '  Crushed by sow ' }],
    });
    const died = animalUpdates();
    expect(died).toHaveLength(2);
    expect(died.every((u) => u.set.status === 'DEAD' && u.set.disposal_type === 'DIED')).toBe(true);
    expect(died[0].set.disposal_reason_id).toBe(R1);
    expect(died[1].set.disposal_reason_id).toBeNull();
    expect(died[1].set.notes).toBe('Cause of death: Crushed by sow');
    // PIG-2 was never named: it is untouched.
    expect(movementLog.record.mock.calls.map((c) => c[0].animalId).sort()).toEqual([A1, A3].sort());
    expect(movementLog.record.mock.calls.find((c) => c[0].animalId === A1)[0]).toMatchObject({ movementType: 'MORTALITY', reason: 'Respiratory disease', remarks: 'Dead weight 18.5 kg' });
    const detail = inserts.find((i) => i.table === 'batch_mortality_animal')!.values;
    expect(detail.map((d: any) => [d.animal_id, d.dead_weight_kg, d.reason_id, d.reason_text, d.posted])).toEqual([
      [A1, '18.5', R1, null, true],
      [A3, '22', null, 'Crushed by sow', true],
    ]);
    // the header headcount still falls by the count
    expect(updates.find((u) => u.table === 'scheduler_header')!.set.animal_count).toBe('8');
  });

  it('a draft keeps the choice without killing anyone; posting the draft later uses it', async () => {
    await post({ entered_value: 1, draft: true, mortality_animals: [dead(A2)] });
    expect(animalUpdates()).toHaveLength(0);
    expect(inserts.find((i) => i.table === 'batch_mortality_animal')!.values[0]).toMatchObject({ animal_id: A2, posted: false });

    // POST Day re-submits the draft row with the value only; the stored choice is read back.
    rows.batch_daily_data = [{ posted: false, entered_value: '1', entered_text: null, lot_no: null, serial_no: null }];
    rows.batch_mortality_animal = [{ animal_id: A2, dead_weight_kg: '18.500', reason_id: R1, reason_text: null }];
    updates = []; inserts = [];
    await post({ entered_value: 1 });
    expect(animalUpdates().map((u) => u.set.status)).toEqual(['DEAD']);
    expect(inserts.find((i) => i.table === 'batch_mortality_animal')!.values[0]).toMatchObject({ animal_id: A2, posted: true });
    // A draft row carries the typed value but has recorded nothing, so the whole count is the delta.
    expect(updates.find((u) => u.table === 'scheduler_header')!.set.animal_count).toBe('9');
  });

  it('a correction upward names only the extra animals', async () => {
    rows.batch_daily_data = [{ posted: true, entered_value: '1', entered_text: null, lot_no: null, serial_no: null }];
    rows.animal_register = [animal(A2, 'PIG-2'), animal(A3, 'PIG-3')]; // PIG-1 already died
    await expect(post({ entered_value: 3, mortality_animals: [dead(A2)] })).rejects.toThrow(/exactly 2 animals/);
    await post({ entered_value: 2, mortality_animals: [dead(A2)] });
    expect(animalUpdates()).toHaveLength(1);
  });

  it('a correction downward adds no deaths and names none', async () => {
    rows.batch_daily_data = [{ posted: true, entered_value: '2', entered_text: null, lot_no: null, serial_no: null }];
    await post({ entered_value: 1 });
    expect(animalUpdates()).toHaveLength(0);
    await expect(post({ entered_value: 1, mortality_animals: [dead(A1)] })).rejects.toThrow(/exactly 0 animals/);
  });

  it('refuses more deaths than registered animals alive, and writes nothing', async () => {
    await expect(post({ entered_value: 4, mortality_animals: [dead(A1), dead(A2), dead(A3)] })).rejects.toThrow(/only 3 registered animals are alive/);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('a count-only batch asks for a dead weight and reason per death, names no animal, and stores them', async () => {
    rows.animal_register = [];
    await expect(post({ entered_value: 2 })).rejects.toThrow(/dead weight and the reason for each of the 2 dead animals/);
    await expect(post({ entered_value: 2, mortality_animals: [{ dead_weight_kg: 15, reason_id: R1 }] })).rejects.toThrow(/give a dead weight and reason for each \(1 given\)/);
    await expect(post({ entered_value: 1, mortality_animals: [dead(A1)] })).rejects.toThrow(/no animal can be named/);
    await expect(post({ entered_value: 1, mortality_animals: [{ dead_weight_kg: 0, reason_id: R1 }] })).rejects.toThrow(/dead weight .* for dead animal 1/);
    await expect(post({ entered_value: 1, mortality_animals: [{ dead_weight_kg: 15 }] })).rejects.toThrow(/Give dead animal 1 a reason/);
    expect(updates).toHaveLength(0);

    await post({ entered_value: 2, mortality_animals: [{ dead_weight_kg: 15, reason_id: R1 }, { dead_weight_kg: 12.25, reason_text: 'Crushed' }] });
    expect(animalUpdates()).toHaveLength(0);
    expect(movementLog.record).not.toHaveBeenCalled();
    const detail = inserts.find((i) => i.table === 'batch_mortality_animal')!.values;
    expect(detail.map((d: any) => [d.animal_id, d.dead_weight_kg, d.reason_id, d.reason_text, d.posted])).toEqual([
      [null, '15', R1, null, true],
      [null, '12.25', null, 'Crushed', true],
    ]);
    expect(updates.find((u) => u.table === 'scheduler_header')!.set.animal_count).toBe('8');
  });

  it('animal-wise: the death of the entry\'s animal needs its dead weight and reason, and is stored against it', async () => {
    rows.batch_header = [{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', batch_no: 'B-1', farm_id: 'farm-1' }];
    rows.animal_register = [{ ...animal(A1, 'PIG-1'), current_batch_id: 'batch-1', current_stage_id: 'stage-1' }];
    const aw = (dto: Record<string, unknown>) => post({ animal_id: A1, ...dto });
    await expect(aw({ entered_value: 1 })).rejects.toThrow(/dead weight and the reason for the animal that died/);
    await expect(aw({ entered_value: 2, mortality_animals: [{ dead_weight_kg: 9, reason_id: R1 }] })).rejects.toThrow(/records one animal/);
    await expect(aw({ entered_value: 1, mortality_animals: [{ animal_id: A2, dead_weight_kg: 9, reason_id: R1 }] })).rejects.toThrow(/its own animal only/);
    await expect(aw({ entered_value: 1, mortality_animals: [{ dead_weight_kg: 9 }] })).rejects.toThrow(/Give animal 'PIG-1' a reason/);
    expect(updates).toHaveLength(0);

    await aw({ entered_value: 1, mortality_animals: [{ dead_weight_kg: 9.25, reason_text: 'Crushed' }] });
    const died = animalUpdates();
    expect(died).toHaveLength(1);
    expect(died[0].set).toMatchObject({ status: 'DEAD', disposal_reason_id: null, notes: 'Cause of death: Crushed' });
    expect(movementLog.record.mock.calls[0][0]).toMatchObject({ animalId: A1, reason: 'Crushed', remarks: 'Dead weight 9.25 kg' });
    const detail = inserts.find((i) => i.table === 'batch_mortality_animal')!.values;
    expect(detail.map((d: any) => [d.animal_id, d.dead_weight_kg, d.reason_text, d.posted])).toEqual([[A1, '9.25', 'Crushed', true]]);
  });

  it('animal-wise: a zero entry asks for nothing', async () => {
    rows.batch_header = [{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', batch_no: 'B-1', farm_id: 'farm-1' }];
    rows.animal_register = [{ ...animal(A1, 'PIG-1'), current_batch_id: 'batch-1', current_stage_id: 'stage-1' }];
    await post({ animal_id: A1, entered_value: 0 });
    expect(animalUpdates()).toHaveLength(0);
    expect(inserts.some((i) => i.table === 'batch_mortality_animal')).toBe(false);
  });

  it('refuses animals named on a line that is not the mortality count', async () => {
    rows.scheduler_line = [{ ...line, kpi_metric: 'BODY_WEIGHT' }];
    await expect(post({ entered_value: 1, mortality_animals: [dead(A1)] })).rejects.toThrow(BadRequestException);
  });

  it('lists the registered animals still alive for the data-entry picker', async () => {
    rows.batch_daily_data = [{ entered_value: '2' }];
    rows.batch_mortality_animal = [{ animal_id: A1, dead_weight_kg: '18.500', reason_id: R1, reason_text: null }];
    const result = await service.mortalityCandidates('batch-1', 'line-mort', '2026-10-12');
    expect(result.already_posted).toBe(2);
    expect(result.draft_animals).toEqual([{ animal_id: A1, dead_weight_kg: 18.5, reason_id: R1, reason_text: null }]);
    expect(result.animals.map((a) => a.animal_code)).toEqual(['PIG-1', 'PIG-2', 'PIG-3']);
    rows.scheduler_line = [{ ...line, kpi_metric: 'BODY_WEIGHT' }];
    expect((await service.mortalityCandidates('batch-1', 'line-mort')).animals).toEqual([]);
  });
});
