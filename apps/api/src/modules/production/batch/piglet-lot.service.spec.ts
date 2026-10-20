import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PigletLotService } from './piglet-lot.service';
import { BatchService } from './batch.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';

describe('PigletLotService', () => {
  const queue: unknown[][] = [];
  const chain = (result: unknown[]) => {
    const self: any = {};
    for (const m of ['from', 'where', 'limit']) self[m] = () => self;
    self.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
    return self;
  };
  const db = { select: jest.fn(() => ({ from: () => chain(queue.shift() ?? []) })) };
  const batchService = { create: jest.fn(), activate: jest.fn() };
  const numberSeries = { generateNext: jest.fn() };
  let service: PigletLotService;

  const sow = { animal_id: 'sow-1', animal_code: 'SOW-001', company_id: 'co-1', lob_id: 'lob-1', breed_id: 'breed-1', current_batch_id: 'b-sow', current_stage_id: 'st-lact', current_location_id: 'pen-1', operational_area_id: 'area-1' } as any;
  const item = { item_id: 'item-p', item_name: 'Suckling Live Piglet', is_biological_asset: true, uom_primary: 'HEAD' };

  beforeEach(async () => {
    queue.length = 0;
    jest.clearAllMocks();
    numberSeries.generateNext.mockResolvedValue('LOT-00042');
    batchService.create.mockResolvedValue({ batch_id: 'b-new', batch_no: 'BATCH-000099' });
    batchService.activate.mockResolvedValue({});
    const moduleRef = await Test.createTestingModule({
      providers: [
        PigletLotService,
        { provide: ClsService, useValue: { get: (key?: string) => (key === 'tenantPostingTransaction' ? true : db) } },
        { provide: BatchService, useValue: batchService },
        { provide: NumberSeriesService, useValue: numberSeries },
      ],
    }).compile();
    service = moduleRef.get(PigletLotService);
  });

  it('makes a batch-wise bio-asset batch holding the litter as a lot of the piglet item, born where the sow is, and activates it', async () => {
    queue.push([item], [{ shed_id: 'shed-1', location_id: 'pen-9', operational_area_id: 'area-2' }]);

    const lot = await service.createLot({ sow, farrowing_date: '2026-10-09', quantity: 12, item_id: 'item-p' }, 'tenant-1', { userId: 'u1' });

    expect(numberSeries.generateNext).toHaveBeenCalledWith('ITEM_LOT', 'tenant-1', 'co-1');
    const [dto] = batchService.create.mock.calls[0];
    expect(dto).toMatchObject({
      company_id: 'co-1', lob_id: 'lob-1', costing_method: 'BIO_ASSET', tracking_mode: 'BATCH_WISE', breed_id: 'breed-1',
      stage_id: 'st-lact', shed_id: 'shed-1', location_id: 'pen-9', operational_area_id: 'area-2',
      start_date: '2026-10-09', opening_quantity: 12,
    });
    // No value yet: a rate would post a purchase journal for a birth.
    expect(dto.input_lines).toEqual([{ item_id: 'item-p', quantity: 12, uom: 'HEAD', rate: 0, lot_no: 'LOT-00042' }]);
    expect(batchService.activate).toHaveBeenCalledWith('b-new', 'tenant-1', { userId: 'u1' });
    expect(lot).toEqual({ batch_id: 'b-new', batch_no: 'BATCH-000099', lot_no: 'LOT-00042' });
  });

  it('starts the piglets in the stage that was named, not the sow’s', async () => {
    queue.push([item], []);
    await service.createLot({ sow: { ...sow, current_batch_id: null }, farrowing_date: '2026-10-09', quantity: 5, item_id: 'item-p', stage_id: 'st-other' }, 'tenant-1');
    const [dto] = batchService.create.mock.calls[0];
    expect(dto.stage_id).toBe('st-other');
    expect(dto.location_id).toBe('pen-1'); // no batch for the sow: her own pen
  });

  it('refuses an item that is not a bio-asset, an item that does not exist, and an empty litter', async () => {
    queue.push([{ ...item, is_biological_asset: false }]);
    await expect(service.createLot({ sow, farrowing_date: '2026-10-09', quantity: 3, item_id: 'item-p' }, 'tenant-1')).rejects.toThrow(BadRequestException);
    queue.push([]);
    await expect(service.createLot({ sow, farrowing_date: '2026-10-09', quantity: 3, item_id: 'nope' }, 'tenant-1')).rejects.toThrow(NotFoundException);
    await expect(service.createLot({ sow, farrowing_date: '2026-10-09', quantity: 0, item_id: 'item-p' }, 'tenant-1')).rejects.toThrow('at least one piglet');
    expect(batchService.create).not.toHaveBeenCalled();
  });
});
