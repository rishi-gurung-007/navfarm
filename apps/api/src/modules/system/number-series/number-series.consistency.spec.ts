import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { NumberSeriesService } from './number-series.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';

/**
 * One number, whichever door it is asked through. The Batch form and the master forms preview through
 * previewByMaster, a GRN previews its lots and serials through previewNextNumbersById, an item template through
 * previewNextNumberById, and the save issues through generateNext or generateNextNumberById. Each used to format
 * and count for itself, so a form showed BATCH000008 and the save issued BATCH-000008. They must all agree.
 */
describe('number series: every preview and every issue agree', () => {
  let service: NumberSeriesService;

  const series = (over: Record<string, unknown> = {}): any => ({
    id: 's1', tenant_id: 't', company_id: 'c', code: 'NS-TST', document_type: 'ZZ', master_type: 'ZZ',
    prefix: 'TST', no_series_code: 'TST', separator: '-', seq_separator: null, seq_length: 4,
    current_seq: 5, last_no_used: 'TST-0005', increment_by: 1, reset_frequency: 'NEVER', blocked: false,
    code_segments: null, prefix_position: 'END', starting_no: null, is_default: true, manual_nos: false,
    updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '), ...over,
  });

  /** A transaction handle that hands back the series row and records what is written to it. */
  const executorFor = (row: any) => {
    const writes: any[] = [];
    const chain: any = { from: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, for: async () => [row] };
    return { writes, exec: { select: () => chain, update: () => ({ set: (v: any) => { writes.push(v); return { where: async () => undefined }; } }) } as any };
  };

  const everyDoor = async (row: any) => {
    jest.spyOn(service, 'findOneById').mockResolvedValue(row);
    jest.spyOn(service, 'findDefaultSeriesByMaster').mockResolvedValue(row);
    const byMaster = (await service.previewByMaster('ZZ', 't', 'c')) as any;
    const byId = (await service.previewNextNumberById('s1')).next_number;
    const byIdMany = (await service.previewNextNumbersById('s1', 3)).numbers;
    const issued = await service.generateNext('NS-TST', 't', 'c', executorFor(row).exec);
    const byIdIssued = (await service.generateNextNumberById('s1', 't', 'c', executorFor(row).exec)).next_number;
    return { byMaster: byMaster.preview, byId, byIdMany, issued, byIdIssued };
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NumberSeriesService,
        { provide: ClsService, useValue: { get: jest.fn(() => ({ select: () => ({ from: () => ({ where: async () => [] }) }) })) } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: NobLobResolutionService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(NumberSeriesService);
  });

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['a prefix with no hyphen', { prefix: 'TST', no_series_code: 'TST' }, 'TST-0006'],
    ['a prefix typed with its hyphen (the form hint)', { prefix: 'TST-', no_series_code: 'TST-' }, 'TST-0006'],
    ['a lower-case prefix', { prefix: 'tst', no_series_code: 'tst' }, 'TST-0006'],
    ['a prefix with a space', { prefix: 'G R', no_series_code: 'G R' }, 'G_R-0006'],
    ['a prefix ending in a slash', { prefix: 'GR/', no_series_code: 'GR/' }, 'GR-0006'],
    ['a slash separator', { separator: '/' }, 'TST/0006'],
    ['an increment of 5', { increment_by: 5 }, 'TST-0010'],
    ['a last number ahead of the counter (set before the series ran)', { current_seq: 0, last_no_used: 'TST-0100' }, 'TST-0101'],
    ['a series that has issued nothing', { current_seq: 0, last_no_used: null }, 'TST-0001'],
    ['a starting number on a series that has issued nothing', { current_seq: 0, last_no_used: null, starting_no: 'TST-0500' }, 'TST-0500'],
  ];

  it.each(cases)('%s', async (_label, over, expected) => {
    const door = await everyDoor(series(over));
    expect(door.issued).toBe(expected);
    expect(door.byMaster).toBe(expected);
    expect(door.byId).toBe(expected);
    expect(door.byIdMany[0]).toBe(expected);
    expect(door.byIdIssued).toBe(expected);
  });

  it('previews a run of numbers one increment apart', async () => {
    jest.spyOn(service, 'findOneById').mockResolvedValue(series({ increment_by: 5 }));
    expect((await service.previewNextNumbersById('s1', 3)).numbers).toEqual(['TST-0010', 'TST-0015', 'TST-0020']);
  });

  it('moves the counter, not just the last number, when a lot or serial is issued by id', async () => {
    const row = series();
    const { exec, writes } = executorFor(row);
    await service.generateNextNumberById('s1', 't', 'c', exec);
    expect(writes[0]).toMatchObject({ current_seq: 6, last_no_used: 'TST-0006' });
  });

  it('skips a code already taken on the master, in the preview as in the issue', async () => {
    // BATCH is a master with a table behind it; this stands in for one whose next code is taken.
    const row = series({ document_type: 'BATCH', master_type: 'BATCH', prefix: 'BATCH', no_series_code: 'BATCH', seq_length: 6, current_seq: 7, last_no_used: 'BATCH-000007' });
    // Each candidate is asked about on its own: BATCH-000008 is taken, BATCH-000009 is free.
    const takenCodes = new Set(['BATCH-000008']);
    let asked = 0;
    const db: any = { select: () => ({ from: () => ({ where: () => ({ limit: async () => (takenCodes.has(`BATCH-${String(8 + asked++).padStart(6, '0')}`) ? [{ code: 'x' }] : []) }) }) }) };
    jest.spyOn(service as any, 'db', 'get').mockReturnValue(db);
    jest.spyOn(service, 'findDefaultSeriesByMaster').mockResolvedValue(row);
    expect(((await service.previewByMaster('BATCH', 't', 'c')) as any).preview).toBe('BATCH-000009');
  });

  it('only moves forward when a number is recorded as used', async () => {
    const row = series({ current_seq: 14, last_no_used: 'TST-0014' });
    jest.spyOn(service, 'findOneById').mockResolvedValue(row);
    const set = jest.fn(() => ({ where: async () => undefined }));
    jest.spyOn(service as any, 'db', 'get').mockReturnValue({ update: () => ({ set }) });

    await service.recordNumberUsedById('s1', 'TST-0013');
    expect(set).not.toHaveBeenCalled();

    await service.recordNumberUsedById('s1', 'TST-0020');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ current_seq: 20, last_no_used: 'TST-0020' }));
  });
});

describe('number series: finding the series a document draws from, and failing loudly', () => {
  let service: NumberSeriesService;
  const defaults = { seriesCode: 'GOODS_RECEIPT', seriesName: 'Goods Receipt Number', documentType: 'GOODS_RECEIPT', prefix: 'GR', separator: '-', seqLength: 6 };
  const loadCodes = async () => ['GR-000005'];

  const build = async (db: any) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NumberSeriesService,
        { provide: ClsService, useValue: { get: jest.fn(() => db) } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: NobLobResolutionService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(NumberSeriesService);
  };
  const rowsDb = (rows: any[]) => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) });

  it('uses the series configured on the master, whatever its code, and makes nothing', async () => {
    await build(rowsDb([]));
    jest.spyOn(service, 'resolveSeriesFor').mockResolvedValue('NS-GRN');
    const ensure = jest.spyOn(service, 'ensureCompanySeries').mockResolvedValue(undefined);
    await expect(service.seriesCodeForDocument('t', 'c', defaults, loadCodes)).resolves.toBe('NS-GRN');
    expect(ensure).not.toHaveBeenCalled();
  });

  it('returns a blocked series as it is, so the draw fails as inactive rather than a second series appearing', async () => {
    await build(rowsDb([{ code: 'NS-GRN' }]));
    jest.spyOn(service, 'resolveSeriesFor').mockResolvedValue(null);
    const ensure = jest.spyOn(service, 'ensureCompanySeries').mockResolvedValue(undefined);
    await expect(service.seriesCodeForDocument('t', 'c', defaults, loadCodes)).resolves.toBe('NS-GRN');
    expect(ensure).not.toHaveBeenCalled();
  });

  it('makes the built-in series when the company has none', async () => {
    await build(rowsDb([]));
    jest.spyOn(service, 'resolveSeriesFor').mockResolvedValue(null);
    const ensure = jest.spyOn(service, 'ensureCompanySeries').mockResolvedValue(undefined);
    await expect(service.seriesCodeForDocument('t', 'c', defaults, loadCodes)).resolves.toBe('GOODS_RECEIPT');
    expect(ensure).toHaveBeenCalledWith('t', 'c', defaults, loadCodes);
  });

  it('reports a database failure while drawing a number as that, not as a missing series', async () => {
    const lockTimeout = Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
    const chain: any = { from: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, for: async () => { throw lockTimeout; } };
    await build({ select: () => chain });
    await expect(service.generateNext('GOODS_RECEIPT', 't', 'c', { select: () => chain } as any)).rejects.toBe(lockTimeout);
  });

  it('reports a database failure while looking for a series as that, not as "no series configured"', async () => {
    const down = new Error('connection lost');
    const chain: any = { from: () => chain, where: () => chain, limit: async () => { throw down; } };
    await build({ select: () => chain });
    await expect(service.resolveSeriesFor('GOODS_RECEIPT', null, 't', 'c')).rejects.toBe(down);
  });

  it('logs, rather than hides, a last number it could not record', async () => {
    await build(rowsDb([]));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(service, 'findOneById').mockRejectedValue(new Error('gone'));
    await service.recordLastNoUsed('s1', 'LOT-00007');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('LOT-00007'));
  });
});

describe('number series: taking several numbers under one lock', () => {
  let service: NumberSeriesService;
  const row = (over: Record<string, unknown> = {}): any => ({
    id: 's1', tenant_id: 't', company_id: 'c', code: 'ITEM_SERIAL', document_type: 'SERIAL', master_type: 'SERIAL',
    prefix: 'SN', no_series_code: 'SN', separator: '-', seq_separator: null, seq_length: 5,
    current_seq: 20, last_no_used: 'SN-00020', increment_by: 1, reset_frequency: 'NEVER', last_reset_period: null,
    blocked: false, code_segments: null, prefix_position: 'END', starting_no: null,
    updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '), ...over,
  });
  const executorFor = (series: any) => {
    const writes: any[] = [];
    const chain: any = { from: () => chain, where: () => chain, limit: () => chain, for: async () => [series] };
    return { writes, exec: { select: () => chain, update: () => ({ set: (v: any) => { writes.push(v); return { where: async () => undefined }; } }) } as any };
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NumberSeriesService,
        { provide: ClsService, useValue: { get: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: NobLobResolutionService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(NumberSeriesService);
  });

  it('allocates a run of numbers with a single write that leaves the counter on the last one', async () => {
    const { exec, writes } = executorFor(row());
    const out = await service.generateNextNumbersById('s1', 3, 't', 'c', exec);
    expect(out.numbers).toEqual(['SN-00021', 'SN-00022', 'SN-00023']);
    expect(out.next_number).toBe('SN-00021');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ current_seq: 23, last_no_used: 'SN-00023' });
  });

  it('steps by the increment', async () => {
    const { exec, writes } = executorFor(row({ increment_by: 5 }));
    const out = await service.generateNextNumbersById('s1', 3, 't', 'c', exec);
    expect(out.numbers).toEqual(['SN-00025', 'SN-00030', 'SN-00035']);
    expect(writes[0]).toMatchObject({ current_seq: 35 });
  });

  it('records the reset period it issued in, so an edit can no longer swallow a reset', async () => {
    const { exec, writes } = executorFor(row({ reset_frequency: 'YEARLY', last_reset_period: String(new Date().getFullYear() - 1) }));
    const out = await service.generateNextNumbersById('s1', 2, 't', 'c', exec);
    expect(out.numbers).toEqual(['SN-00001', 'SN-00002']);
    expect(writes[0]).toMatchObject({ current_seq: 2, last_reset_period: String(new Date().getFullYear()) });
  });

  it('refuses a blocked series', async () => {
    const { exec } = executorFor(row({ blocked: true }));
    await expect(service.generateNextNumbersById('s1', 2, 't', 'c', exec)).rejects.toThrow(/blocked/);
  });

  it('is the same as taking one number', async () => {
    const one = await service.generateNextNumberById('s1', 't', 'c', executorFor(row()).exec);
    const many = await service.generateNextNumbersById('s1', 1, 't', 'c', executorFor(row()).exec);
    expect(one.next_number).toBe(many.next_number);
  });
});
