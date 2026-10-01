import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { getTableConfig, MySqlDialect } from 'drizzle-orm/mysql-core';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedStockCountService } from './feed-stock-count.service';

type Log = { op: string; table: unknown; values?: any; set?: any; lock?: string };

function setup(queues: Map<unknown, unknown[][]>, scope: FarmScope = {
  farmId: 'farm-1', companyId: 'company-1', lobId: 'lob-piggery', restricted: true,
}) {
  const log: Log[] = [];
  const db: any = {
    select: jest.fn(() => {
      const entry: Log = { op: 'select', table: undefined };
      log.push(entry);
      const chain: any = {
        from: (table: unknown) => { entry.table = table; return chain; },
        innerJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        for: (lock: string) => { entry.lock = lock; return chain; },
        then: (ok: any, fail: any) => Promise.resolve(queues.get(entry.table)?.shift() ?? []).then(ok, fail),
      };
      return chain;
    }),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (values: unknown) => { log.push({ op: 'insert', table, values }); }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((set: unknown) => ({ where: jest.fn(async () => { log.push({ op: 'update', table, set }); }) })),
    })),
  };
  const cls = transactionCls(db);
  const originalGet = cls.get.bind(cls);
  cls.get = ((key?: string) => key === FARM_SCOPE_KEY ? scope : originalGet(key as any)) as typeof cls.get;
  const ledger = {
    getSiloStockEvidenceAsOf: jest.fn(async (): Promise<Array<{
      warehouse_id: string; item_id: string; item_code: string; uom: string; system_qty_kg: number; unit_cost_base: number | null;
    }>> => [{
      warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG', system_qty_kg: 100, unit_cost_base: 4,
    }]),
  };
  const settings = { resolve: jest.fn(async () => ({
    timezoneId: 'Africa/Harare', physicalCountWeekday: 1, physicalCountTime: '09:30',
    financeVariancePct: 5, financeVarianceAmount: null,
  })) };
  const currency = { currentRate: jest.fn(async () => ({
    status: 'RESOLVED', rateId: 'rate-1', rate: 2, rateDate: '2026-10-01', createdAt: '2026-10-01 08:00:00', scope: 'COMPANY',
  })) };
  const reasons = {
    findOne: jest.fn(async (id: string) => ({ reason_id: id, is_active: true })),
    findActiveForOperationalScope: jest.fn(async (id: string) => ({ reason_id: id, is_active: true, status: 'ACTIVE', deleted_at: null })),
  };
  const approvals = {
    registerDocumentHandler: jest.fn(),
    submitFarmDocument: jest.fn(async () => 'request-1'),
  };
  const adjustments = { create: jest.fn(), post: jest.fn() };
  const feedAlerts = { evaluateFarmSafely: jest.fn() };
  const service = new FeedStockCountService(
    cls, ledger as any, settings as any, currency as any, reasons as any,
    approvals as any, adjustments as any, feedAlerts as any,
  );
  return { service, ledger, settings, currency, reasons, approvals, adjustments, feedAlerts, log, db };
}

const farm = { location_id: 'farm-1', company_id: 'company-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery', location_code: 'FARM-001' };
const silo = {
  location_id: 'silo-1', company_id: 'company-1', lob_id: 'lob-piggery', farm_id: 'farm-1',
  parent_location_id: 'farm-1', location_type: 'SILO', is_active: true, deleted_at: null, location_code: 'SILO-001',
};
const company = { base_currency_id: 'base' };
const local = { currency_id: 'local' };
const createDto = {
  companyId: 'company-1', farmId: 'farm-1', countedAt: '2026-10-05T07:30:00.000Z', scheduleSource: 'SCHEDULED' as const,
  lines: [{ siloId: 'silo-1', itemId: 'item-1', countedQtyKg: 95, reasonId: 'reason-1' }],
};

function createQueues(overrides: Partial<{ farm: unknown[]; duplicate: unknown[]; company: unknown[]; local: unknown[]; silo: unknown[] }> = {}) {
  return new Map<unknown, unknown[][]>([
    [schema.locationMaster, [overrides.farm ?? [farm], overrides.silo ?? [silo]]],
    [schema.feedStockCount, [overrides.duplicate ?? []]],
    [schema.companyMaster, [overrides.company ?? [company]]],
    [schema.companyCurrencyConfig, [overrides.local ?? [local]]],
  ]);
}

describe('FeedStockCountService', () => {
  it('declares the count lifecycle, occurrence uniqueness, line uniqueness and detached evidence columns', () => {
    const header = getTableConfig(schema.feedStockCount);
    const line = getTableConfig(schema.feedStockCountLine);
    expect(header.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'uq_feed_stock_count_occurrence', 'uq_feed_stock_count_company_no',
    ]));
    expect(header.indexes.find((index) => index.config.name === 'uq_feed_stock_count_occurrence')?.config.columns
      .map((column: any) => column.name)).toEqual(['farm_id', 'counted_at']);
    expect(line.indexes.map((index) => index.config.name)).toContain('uq_feed_stock_count_line_silo_item');
    expect(header.columns.find((column) => column.name === 'approval_request_id')).toBeDefined();
    expect(header.columns.find((column) => column.name === 'stock_adjustment_id')).toBeDefined();
    expect(line.columns.find((column) => column.name === 'system_qty_kg')?.notNull).toBe(true);
    expect(line.columns.find((column) => column.name === 'rate_snapshot')).toBeDefined();
    expect(line.columns.find((column) => column.name === 'monetary_status')?.notNull).toBe(true);
    expect(line.columns.find((column) => column.name === 'local_currency_id')?.notNull).toBe(false);
  });

  it('captures only exact active-farm SILO ledger evidence at counted_at, inside one transaction', async () => {
    const { service, ledger, log } = setup(createQueues());
    await expect(service.create(createDto as any, 'tenant-1', { userId: 'worker-1', userType: 'STANDARD_USER' }))
      .resolves.toMatchObject({ status: 'DRAFT', count_no: expect.stringMatching(/^FSC-/) });
    expect(ledger.getSiloStockEvidenceAsOf).toHaveBeenCalledWith({
      companyId: 'company-1', siloIds: ['silo-1'], postingDate: '2026-10-05', countedAtEpochSeconds: 1791185400,
    }, 'tenant-1');
    const headerInsert = log.find((entry) => entry.op === 'insert' && entry.table === schema.feedStockCount);
    const countedAt = (headerInsert?.values as any).counted_at;
    const rendered = new MySqlDialect().sqlToQuery(countedAt);
    expect(rendered.sql.toLowerCase()).toBe('from_unixtime(?)');
    expect(rendered.params).toEqual([1791185400]);
    const lineInsert = log.find((entry) => entry.op === 'insert' && entry.table === schema.feedStockCountLine);
    expect(lineInsert?.values).toEqual([expect.objectContaining({
      silo_id: 'silo-1', item_id: 'item-1', system_qty_kg: '100', counted_qty_kg: '95',
      variance_qty_kg: '-5', variance_pct_absolute: '5', reason_id: 'reason-1',
      rate_id: 'rate-1', monetary_status: 'RESOLVED', variance_value_base: '-20', variance_value_local: '-40',
    })]);
    expect(log.filter((entry) => entry.op === 'insert').length).toBe(2);
  });

  it('accepts the configured scheduled occurrence and does not hardcode Sunday 08:00', async () => {
    const { service, settings } = setup(createQueues());
    await service.create(createDto as any, 'tenant-1', { userId: 'worker-1' });
    expect(settings.resolve).toHaveBeenCalledWith('company-1', 'farm-1');
  });

  it('allows an on-demand count without matching the configured schedule', async () => {
    const { service } = setup(createQueues());
    await expect(service.create({ ...createDto, countedAt: '2026-10-01T06:13:00.000Z', scheduleSource: 'ON_DEMAND' } as any, 'tenant-1', { userId: 'worker-1' }))
      .resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('rejects a scheduled count whose local weekday/time does not match effective settings', async () => {
    const { service, log } = setup(createQueues());
    await expect(service.create({ ...createDto, countedAt: '2026-10-05T08:30:00.000Z' } as any, 'tenant-1', { userId: 'worker-1' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(log.some((entry) => entry.op === 'insert')).toBe(false);
  });

  it('rejects second-level drift so one configured scheduled occurrence cannot be duplicated', async () => {
    const { service, log } = setup(createQueues());
    await expect(service.create({ ...createDto, countedAt: '2026-10-05T07:30:30.000Z' } as any, 'tenant-1', { userId: 'worker-1' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(log.some((entry) => entry.op === 'insert')).toBe(false);
  });

  it.each([
    ['shed', { ...silo, location_type: 'SHED' }],
    ['inactive silo', { ...silo, is_active: false }],
    ['cross-farm silo', { ...silo, farm_id: 'farm-2', parent_location_id: 'farm-2' }],
    ['inconsistent silo farm marker', { ...silo, farm_id: 'farm-2' }],
    ['cross-company silo', { ...silo, company_id: 'company-2' }],
    ['cross-LOB silo', { ...silo, lob_id: 'lob-other' }],
  ])('rejects %s instead of recording it as count evidence', async (_label, invalidSilo) => {
    const { service, log } = setup(createQueues({ silo: [invalidSilo] }));
    await expect(service.create(createDto as any, 'tenant-1', { userId: 'worker-1' })).rejects.toThrow();
    expect(log.some((entry) => entry.op === 'insert')).toBe(false);
  });

  it('rejects a fixed-farm caller requesting another farm before reading ledger evidence', async () => {
    const { service, ledger } = setup(new Map(), { farmId: 'farm-1', companyId: 'company-1', lobId: 'lob-piggery', restricted: true });
    await expect(service.create({ ...createDto, farmId: 'farm-2' } as any, 'tenant-1', { userId: 'worker-1' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(ledger.getSiloStockEvidenceAsOf).not.toHaveBeenCalled();
  });

  it('rejects a farm outside an operational administrator LOB', async () => {
    const { service, ledger } = setup(createQueues({ farm: [] }), { farmId: null, companyId: 'company-1', lobId: 'lob-piggery', restricted: true });
    await expect(service.create(createDto as any, 'tenant-1', { userId: 'head-1', userType: 'OPERATIONAL_ADMIN' })).rejects.toThrow();
    expect(ledger.getSiloStockEvidenceAsOf).not.toHaveBeenCalled();
  });

  it('rejects an arbitrary client item or system quantity not present in the silo ledger snapshot', async () => {
    const { service, ledger, log } = setup(createQueues());
    ledger.getSiloStockEvidenceAsOf.mockResolvedValueOnce([{
      warehouse_id: 'silo-1', item_id: 'different-item', item_code: 'FEED-2', uom: 'KG',
      system_qty_kg: 100, unit_cost_base: 4,
    }] as any);
    await expect(service.create({
      ...createDto,
      lines: [{ ...createDto.lines[0], itemId: 'fabricated-item', systemQtyKg: 999999 }],
    } as any, 'tenant-1', { userId: 'worker-1' })).rejects.toThrow(BadRequestException);
    expect(log.some((entry) => entry.op === 'insert')).toBe(false);
  });

  it('rejects an occurrence that omits a server-derived silo/item pair', async () => {
    const { service, ledger, log } = setup(createQueues());
    ledger.getSiloStockEvidenceAsOf.mockResolvedValueOnce([
      { warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG', system_qty_kg: 100, unit_cost_base: 4 },
      { warehouse_id: 'silo-1', item_id: 'item-2', item_code: 'FEED-2', uom: 'KG', system_qty_kg: 50, unit_cost_base: 5 },
    ]);
    await expect(service.create(createDto as any, 'tenant-1', { userId: 'worker-1' }))
      .rejects.toThrow('every active silo/item');
    expect(log.some((entry) => entry.op === 'insert')).toBe(false);
  });

  it('loads count evidence once for the complete active-silo set instead of once per client line', async () => {
    const { service, ledger } = setup(createQueues());
    ledger.getSiloStockEvidenceAsOf.mockResolvedValue([
      { warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG', system_qty_kg: 100, unit_cost_base: 4 },
      { warehouse_id: 'silo-1', item_id: 'item-2', item_code: 'FEED-2', uom: 'KG', system_qty_kg: 50, unit_cost_base: 5 },
    ]);
    await service.create({
      ...createDto,
      lines: [...createDto.lines, { siloId: 'silo-1', itemId: 'item-2', countedQtyKg: 50 }],
    } as any, 'tenant-1', { userId: 'worker-1' });
    expect(ledger.getSiloStockEvidenceAsOf).toHaveBeenCalledTimes(1);
    expect(ledger.getSiloStockEvidenceAsOf).toHaveBeenCalledWith({
      companyId: 'company-1', siloIds: ['silo-1'], postingDate: '2026-10-05', countedAtEpochSeconds: 1791185400,
    }, 'tenant-1');
  });

  it('maps a concurrent unique-occurrence insert collision to ConflictException', async () => {
    const { service, db } = setup(createQueues());
    db.insert.mockImplementationOnce(() => ({
      values: jest.fn(async () => { throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }); }),
    }));
    await expect(service.create(createDto as any, 'tenant-1', { userId: 'worker-1' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('requires an active scope-visible Reason Master row for nonzero variance', async () => {
    const { service, reasons, log } = setup(createQueues());
    reasons.findActiveForOperationalScope.mockRejectedValueOnce(new Error('not visible'));
    await expect(service.create(createDto as any, 'tenant-1', { userId: 'worker-1' })).rejects.toThrow('not visible');
    expect(log.some((entry) => entry.op === 'insert')).toBe(false);
  });

  it('validates a variance reason against the count company and farm NOB/LOB', async () => {
    const { service, reasons } = setup(createQueues());
    await service.create(createDto as any, 'tenant-1', { userId: 'worker-1' });
    expect(reasons.findActiveForOperationalScope).toHaveBeenCalledWith('reason-1', 'tenant-1', {
      companyId: 'company-1', nobId: 'nob-livestock', lobId: 'lob-piggery',
    });
  });

  it('does not require or persist a reason for zero variance', async () => {
    const { service, reasons, log } = setup(createQueues());
    await service.create({ ...createDto, lines: [{ ...createDto.lines[0], countedQtyKg: 100, reasonId: undefined }] } as any, 'tenant-1', { userId: 'worker-1' });
    expect(reasons.findActiveForOperationalScope).not.toHaveBeenCalled();
    const line = log.find((entry) => entry.table === schema.feedStockCountLine)?.values[0];
    expect(line).toMatchObject({ variance_qty_kg: '0', reason_id: null });
  });

  it('persists typed unavailable monetary evidence when local currency is not configured', async () => {
    const { service, currency, log } = setup(createQueues({ local: [] }));
    await expect(service.create(createDto as any, 'tenant-1', { userId: 'worker-1' })).resolves.toMatchObject({ status: 'DRAFT' });
    expect(currency.currentRate).not.toHaveBeenCalled();
    const line = log.find((entry) => entry.table === schema.feedStockCountLine)?.values[0];
    expect(line).toMatchObject({
      base_currency_id: 'base', local_currency_id: null, rate_id: null,
      monetary_status: 'MISSING_LOCAL_CURRENCY', variance_value_base: '-20', variance_value_local: null,
      rate_snapshot: { status: 'MISSING_LOCAL_CURRENCY', companyId: 'company-1', baseCurrencyId: 'base' },
    });
  });

  it('rejects duplicate farm/count occurrences and duplicate silo/item lines', async () => {
    const duplicate = setup(createQueues({ duplicate: [{ count_id: 'existing' }] }));
    await expect(duplicate.service.create(createDto as any, 'tenant-1', { userId: 'worker-1' })).rejects.toBeInstanceOf(ConflictException);
    const lineDuplicate = setup(createQueues());
    await expect(lineDuplicate.service.create({ ...createDto, lines: [createDto.lines[0], { ...createDto.lines[0] }] } as any, 'tenant-1', { userId: 'worker-1' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('enumerates exactly the countable silo/item ledger pairs for an instant', async () => {
    const { service, ledger } = setup(createQueues());
    ledger.getSiloStockEvidenceAsOf.mockResolvedValue([
      { warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG', system_qty_kg: 100, unit_cost_base: 4 },
      { warehouse_id: 'silo-1', item_id: 'item-2', item_code: 'FEED-2', uom: 'KG', system_qty_kg: 50, unit_cost_base: null },
    ]);
    await expect(service.evidence({ companyId: 'company-1', farmId: 'farm-1', countedAt: '2026-10-05T07:30:00.000Z' }, 'tenant-1'))
      .resolves.toEqual({
        farmId: 'farm-1', companyId: 'company-1', countedAt: '2026-10-05T07:30:00.000Z', postingDate: '2026-10-05',
        silos: [{ siloId: 'silo-1', siloCode: 'SILO-001' }],
        pairs: [
          { siloId: 'silo-1', siloCode: 'SILO-001', itemId: 'item-1', itemCode: 'FEED-1', uom: 'KG', systemQtyKg: 100, costAvailable: true },
          { siloId: 'silo-1', siloCode: 'SILO-001', itemId: 'item-2', itemCode: 'FEED-2', uom: 'KG', systemQtyKg: 50, costAvailable: false },
        ],
      });
    // The same cutoff create() will use, so the preview cannot promise a pair
    // the transaction then rejects.
    expect(ledger.getSiloStockEvidenceAsOf).toHaveBeenCalledWith({
      companyId: 'company-1', siloIds: ['silo-1'], postingDate: '2026-10-05', countedAtEpochSeconds: 1791185400,
    }, 'tenant-1');
  });

  it('defaults the evidence instant to now for an on-demand count', async () => {
    const { service, ledger } = setup(createQueues());
    const before = Math.floor(Date.now() / 1000);
    const result = await service.evidence({ companyId: 'company-1', farmId: 'farm-1' }, 'tenant-1');
    expect(result.countedAt).toMatch(/Z$/);
    expect(Math.floor(Date.parse(result.countedAt) / 1000)).toBeGreaterThanOrEqual(before);
    expect(ledger.getSiloStockEvidenceAsOf).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', siloIds: ['silo-1'] }), 'tenant-1',
    );
  });

  it('refuses count evidence for a farm outside the caller scope', async () => {
    const { service, ledger } = setup(new Map(), { farmId: 'farm-1', companyId: 'company-1', lobId: 'lob-piggery', restricted: true });
    await expect(service.evidence({ companyId: 'company-1', farmId: 'farm-2' }, 'tenant-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(ledger.getSiloStockEvidenceAsOf).not.toHaveBeenCalled();
  });

  it('edits only draft counted evidence from its stored system/cost/rate snapshot', async () => {
    const existing = {
      count_id: 'count-1', tenant_id: 'tenant-1', company_id: 'company-1', farm_id: 'farm-1', status: 'DRAFT',
    };
    const storedLine = {
      count_line_id: 'line-1', count_id: 'count-1', system_qty_kg: '100', counted_qty_kg: '95', reason_id: 'reason-1',
      unit_cost_base: '4', base_currency_id: 'base', local_currency_id: 'local', rate_id: 'rate-1',
      rate_snapshot: { status: 'RESOLVED', rateId: 'rate-1', rate: 2, rateDate: '2026-10-01', createdAt: '2026-10-01 08:00:00', scope: 'COMPANY' },
    };
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedStockCount, [[existing]]], [schema.locationMaster, [[farm]]], [schema.feedStockCountLine, [[storedLine]]],
    ]);
    const { service, ledger, currency, reasons, log } = setup(queues);
    await service.update('count-1', { lines: [{ countLineId: 'line-1', countedQtyKg: 90, reasonId: 'reason-2' }] } as any, 'tenant-1', { userId: 'worker-1' });
    expect(ledger.getSiloStockEvidenceAsOf).not.toHaveBeenCalled();
    expect(currency.currentRate).not.toHaveBeenCalled();
    expect(reasons.findActiveForOperationalScope).toHaveBeenCalledWith('reason-2', 'tenant-1', {
      companyId: 'company-1', nobId: 'nob-livestock', lobId: 'lob-piggery',
    });
    expect(log.find((entry) => entry.op === 'update' && entry.table === schema.feedStockCountLine)?.set).toMatchObject({
      counted_qty_kg: '90', variance_qty_kg: '-10', variance_pct_absolute: '10', reason_id: 'reason-2',
      rate_snapshot: expect.objectContaining({ rate: 2 }), variance_value_local: '-80', updated_at: expect.any(String),
    });
  });

  it('blocks ordinary edits once submitted', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedStockCount, [[{ count_id: 'count-1', tenant_id: 'tenant-1', company_id: 'company-1', farm_id: 'farm-1', status: 'PENDING_APPROVAL' }]]],
      [schema.locationMaster, [[farm]]],
    ]);
    const { service, log } = setup(queues);
    await expect(service.update('count-1', { lines: [] } as any, 'tenant-1', { userId: 'worker-1' })).rejects.toThrow(BadRequestException);
    expect(log.some((entry) => entry.op === 'update')).toBe(false);
  });

  it('submits a complete draft to PENDING_APPROVAL without approval, adjustment or ledger posting', async () => {
    const existing = { count_id: 'count-1', tenant_id: 'tenant-1', company_id: 'company-1', farm_id: 'farm-1', status: 'DRAFT' };
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedStockCount, [[existing]]], [schema.locationMaster, [[farm]]],
      [schema.feedStockCountLine, [[{ count_line_id: 'line-1', variance_qty_kg: '-5', reason_id: 'reason-1' }]]],
    ]);
    const { service, ledger, reasons, approvals, log } = setup(queues);
    await expect(service.submit('count-1', 'tenant-1', { userId: 'worker-1' })).resolves.toMatchObject({ status: 'PENDING_APPROVAL' });
    const submitted = log.find((entry) => entry.op === 'update' && entry.table === schema.feedStockCount)?.set;
    expect(submitted).toMatchObject({
      status: 'PENDING_APPROVAL', approval_request_id: 'request-1', submitted_by: 'worker-1', updated_at: expect.any(String),
    });
    expect(approvals.submitFarmDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: 'FEED_STOCK_VARIANCE', documentId: 'count-1', farmId: 'farm-1', companyId: 'company-1',
    }), 'tenant-1', expect.objectContaining({ userId: 'worker-1' }));
    expect(submitted).not.toHaveProperty('stock_adjustment_id');
    expect(ledger.getSiloStockEvidenceAsOf).not.toHaveBeenCalled();
    expect(reasons.findActiveForOperationalScope).toHaveBeenCalledWith('reason-1', 'tenant-1', {
      companyId: 'company-1', nobId: 'nob-livestock', lobId: 'lob-piggery',
    });
    expect(log.some((entry) => entry.table === schema.inventoryLedger || entry.table === schema.stockAdjustment)).toBe(false);
  });

  it('rejects submission when a zero-variance line still carries a reason', async () => {
    const existing = { count_id: 'count-1', tenant_id: 'tenant-1', company_id: 'company-1', farm_id: 'farm-1', status: 'DRAFT' };
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedStockCount, [[existing]]], [schema.locationMaster, [[farm]]],
      [schema.feedStockCountLine, [[{ count_line_id: 'line-1', variance_qty_kg: '0', reason_id: 'reason-1' }]]],
    ]);
    const { service, log } = setup(queues);
    await expect(service.submit('count-1', 'tenant-1', { userId: 'worker-1' }))
      .rejects.toThrow('Zero variance must not carry a reason');
    expect(log.some((entry) => entry.op === 'update')).toBe(false);
  });
});
