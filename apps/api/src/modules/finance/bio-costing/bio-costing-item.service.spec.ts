import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BioCostingItemService } from './bio-costing-item.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';

describe('BioCostingItemService — the fair-value rates of a biological item', () => {
  const queue: unknown[][] = [];
  const inserts: any[] = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: () => self, orderBy: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = { select: jest.fn(() => chain(queue.shift() ?? [])), insert: jest.fn(() => ({ values: (v: any) => { inserts.push(v); return Promise.resolve(); } })) };
  let service: BioCostingItemService;
  const fairValueItem = { item_id: 'i1', item_code: 'GP-Loc-F', company_id: 'c', is_biological_asset: true, bio_costing_method: 'FAIR_VALUE' };
  const rate = { effective_from: '2026-01-01', expected_weight_kg: 150, price_per_kg: 2.05 } as any;

  beforeEach(async () => {
    queue.length = 0; inserts.length = 0; jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BioCostingItemService,
        { provide: ClsService, useValue: { get: (k: string) => (k === 'tenantDb' ? db : undefined) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();
    service = moduleRef.get(BioCostingItemService);
  });

  it('adds a dated rate to an item costed by fair value, as numbers stored in the columns, and returns the item\'s rates', async () => {
    queue.push([fairValueItem], [fairValueItem], [{ rate_id: 'r1' }]); // the item, then listRates loads the item again and reads the rows
    const rows = await service.addRate('i1', { ...rate, age_week_from: 17, cdm_based: true, costs_to_sell_pct: 2 }, 't', 'u1');
    expect(inserts[0]).toMatchObject({ item_id: 'i1', farm_id: null, age_week_from: 17, effective_from: '2026-01-01', expected_weight_kg: '150', price_per_kg: '2.05', cdm_based: true, costs_to_sell_pct: '2', created_by: 'u1' });
    expect(rows).toEqual([{ rate_id: 'r1' }]);
  });

  it('refuses a rate for an item that is not costed by fair value, writing nothing', async () => {
    queue.push([{ ...fairValueItem, bio_costing_method: 'AMORTIZATION' }]);
    await expect(service.addRate('i1', rate, 't')).rejects.toThrow(/not costed by fair value/);
    queue.push([{ ...fairValueItem, is_biological_asset: false, bio_costing_method: null }]);
    await expect(service.addRate('i1', rate, 't')).rejects.toThrow(BadRequestException);
    expect(inserts).toEqual([]);
  });

  it('refuses a farm that is not a farm of the item\'s company', async () => {
    queue.push([fairValueItem], []);
    await expect(service.addRate('i1', { ...rate, farm_id: 'f-other' }, 't')).rejects.toThrow(/not a farm of this company/);
    expect(inserts).toEqual([]);
  });

  it('says so when the item does not exist', async () => {
    queue.push([]);
    await expect(service.listRates('nope', 't')).rejects.toThrow(NotFoundException);
  });
});
