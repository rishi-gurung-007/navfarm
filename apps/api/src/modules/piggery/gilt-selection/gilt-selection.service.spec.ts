import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { BatchService } from '../../production/batch/batch.service';
import { AnimalService } from '../animal/animal.service';
import { LitterCostService } from '../litter-cost/litter-cost.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { GiltSelectionService } from './gilt-selection.service';

describe('GiltSelectionService.createGilts', () => {
  let service: GiltSelectionService;
  const rows = new Map<unknown, unknown[]>();
  const inserted: Array<{ table: unknown; values: any }> = [];
  const updated: Array<{ table: unknown; set: any }> = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: () => self, orderBy: () => self, innerJoin: () => self, leftJoin: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = {
    // animal_register is read for each tag (is it taken?) and then for each gilt's sow: the queue answers them in that order.
    select: jest.fn(() => ({ from: (table: unknown) => chain(table === schema.animalRegister ? (animalReads.shift() ?? []) : rows.get(table) ?? []) })),
    insert: jest.fn((table: unknown) => ({ values: jest.fn((values: any) => { inserted.push({ table, values }); return Promise.resolve({}); }) })),
    update: jest.fn((table: unknown) => ({ set: jest.fn((set: any) => { updated.push({ table, set }); return { where: jest.fn().mockResolvedValue({}) }; }) })),
  };
  let animalReads: unknown[][] = [];
  const batchService = { releaseHeadToAnimals: jest.fn() };
  const animals = { create: jest.fn() };
  const audit = { log: jest.fn() };
  const litterCost = { allocate: jest.fn(), pending: jest.fn() };

  const selection = (over: object = {}) => ({
    selection_id: 'gs-1', selection_no: 'GS-2026-00001', company_id: 'co-1', batch_id: 'b-wean', status: 'DRAFT', selection_date: '2026-10-20', production_week: 43,
    gilt_item_id: null, animal_batch_id: null,
    lines: [{ line_id: 'l1', line_no: 1, farrow_id: 'f1', gilts_selected: 2, lot_no: 'LOT-1', source_batch_id: 'b-lot', piglet_item_id: 'item-piglet', sow_animal_id: 'sow-1', boar_animal_id: 'boar-1' }],
    gilts: [], ...over,
  });
  const buffer = (teats = [16, 17]) => ({ gilts: teats.map((t, i) => ({ line_id: 'l1', rfid_tag: `RF-${i + 1}`, no_of_teats: t })) });

  beforeEach(async () => {
    rows.clear(); inserted.length = 0; updated.length = 0; animalReads = [];
    jest.clearAllMocks();
    rows.set(schema.farrowingRecord, [{ farrow_id: 'f1', farrowing_date: '2026-08-01' }]);
    const cls = transactionCls(db);
    const moduleRef = await Test.createTestingModule({
      providers: [
        GiltSelectionService,
        { provide: ClsService, useValue: cls },
        { provide: BatchService, useValue: batchService },
        { provide: AnimalService, useValue: animals },
        { provide: AuditLogService, useValue: audit },
        { provide: LitterCostService, useValue: litterCost },
      ],
    }).compile();
    service = moduleRef.get(GiltSelectionService);
    jest.spyOn(service as any, 'scopedBatch').mockResolvedValue({ batch_id: 'b-wean', location_id: 'loc-1', tracking_mode: 'BATCH_WISE' });
    jest.spyOn(service as any, 'settleCost').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getProducedPiglets').mockResolvedValue({ head: 20, litters: [{ farrow_id: 'f1', available: 10 }] });
    batchService.releaseHeadToAnimals.mockResolvedValue({ per_head: 1.8334, total: 3.6668, remaining: 18 });
    let n = 0;
    animals.create.mockImplementation(async () => ({ animal_id: `a${++n}`, animal_code: `PIG-${n}` }));
  });

  const spyOnSelection = (s: object) => jest.spyOn(service, 'findOne').mockResolvedValue(s as any);
  const sow = { animal_id: 'sow-1', animal_code: 'SOW-1', breed_id: 'br-1' };
  const sowRows = () => { animalReads = [[], [], [sow], [sow]]; };

  it('refuses a gilt under 15 teats before the batch is touched', async () => {
    spyOnSelection(selection());
    await expect(service.createGilts('gs-1', buffer([16, 14]) as any, 't')).rejects.toThrow(/14 teats/);
    expect(batchService.releaseHeadToAnimals).not.toHaveBeenCalled();
    expect(animals.create).not.toHaveBeenCalled();
  });

  it('refuses a selection that is not a draft', async () => {
    spyOnSelection(selection({ status: 'POSTED' }));
    await expect(service.createGilts('gs-1', buffer() as any, 't')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('takes the head out once, registers each gilt born on farm from her litter with the cost per head, and posts the selection', async () => {
    const find = spyOnSelection(selection());
    sowRows();
    const result: any = await service.createGilts('gs-1', buffer() as any, 't', { userId: 'u1' });

    expect(batchService.releaseHeadToAnimals).toHaveBeenCalledTimes(1);
    expect(batchService.releaseHeadToAnimals).toHaveBeenCalledWith('b-wean', expect.objectContaining({ quantity: 2, date: '2026-10-20', reference: 'GS-2026-00001' }), 't', { userId: 'u1' });
    expect(animals.create).toHaveBeenCalledTimes(2);
    expect(animals.create.mock.calls[0][0]).toMatchObject({
      animal_type: 'GILT', gender: 'F', entry_type: 'BORN_ON_FARM', entry_date: '2026-10-20', dob: '2026-08-01', source_batch_id: 'b-lot', item_id: 'item-piglet',
      rfid_tag: 'RF-1', dam_animal_id: 'sow-1', sire_animal_id: 'boar-1', acquisition_cost: 1.8334, no_of_teats: 16, breed_id: 'br-1', current_location_id: 'loc-1',
    });
    const gilts = inserted.filter((i) => i.table === schema.giltSelectionGilt).map((i) => i.values);
    expect(gilts.map((g) => [g.rfid_tag, g.animal_code, g.acquisition_cost])).toEqual([['RF-1', 'PIG-1', '1.8334'], ['RF-2', 'PIG-2', '1.8334']]);
    expect(updated.find((u) => u.table === schema.giltSelection)?.set).toMatchObject({ status: 'POSTED', head_released: '2', value_released: '3.6668' });
    expect(result.created.map((c: any) => c.animal_code)).toEqual(['PIG-1', 'PIG-2']);
    expect(find).toHaveBeenCalled();
  });

  it('refuses when a litter has fewer piglets left than the line selects', async () => {
    spyOnSelection(selection());
    (service as any).getProducedPiglets.mockResolvedValue({ head: 20, litters: [{ farrow_id: 'f1', available: 1 }] });
    await expect(service.createGilts('gs-1', buffer() as any, 't')).rejects.toThrow(/no longer has 2 piglets left/);
    expect(batchService.releaseHeadToAnimals).not.toHaveBeenCalled();
  });

  describe('one selection per litter, before it is weaned (BBP)', () => {
    it('refuses a litter that has been weaned', async () => {
      rows.set(schema.farrowingRecord, [{ weaned: 12 }]);
      await expect(service.assertLitterOpen(['f1'])).rejects.toThrow(/already been weaned/);
    });

    it('refuses a litter that already has a selection', async () => {
      rows.set(schema.farrowingRecord, [{ weaned: 0 }]);
      rows.set(schema.giltSelectionLine, [{ no: 'GS-2026-00003' }]);
      await expect(service.assertLitterOpen(['f1'])).rejects.toThrow(/already selected from this litter \(GS-2026-00003\)/);
    });

    it('lets an unweaned litter with no selection through', async () => {
      rows.set(schema.farrowingRecord, [{ weaned: 0 }]);
      rows.set(schema.giltSelectionLine, []);
      await expect(service.assertLitterOpen(['f1'])).resolves.toBeUndefined();
    });
  });

  describe('batchOfLitter (opened from the Breeding page after weaning)', () => {
    it('is the litter\'s own lot while it still holds piglets', async () => {
      rows.set(schema.farrowingRecord, [{ lot: 'b-lot' }]);
      rows.set(schema.batchHeader, [{ batch_id: 'b-lot', batch_no: 'BATCH-000007', status: 'ACTIVE' }]);
      jest.spyOn(service as any, 'holding').mockResolvedValue({ head: 9 });
      await expect(service.batchOfLitter('f1', 't')).resolves.toEqual({ batch_id: 'b-lot', batch_no: 'BATCH-000007' });
    });

    it('is the batch the piglets were weaned into once the lot is empty', async () => {
      rows.set(schema.farrowingRecord, [{ lot: 'b-lot' }]);
      rows.set(schema.batchHeader, [{ batch_id: 'b-wean', batch_no: 'BATCH-000003', status: 'ACTIVE' }]);
      rows.set(schema.batchTransfer, [{ to: 'b-wean' }]);
      jest.spyOn(service as any, 'holding').mockResolvedValueOnce({ head: 0 }).mockResolvedValue({ head: 13 });
      await expect(service.batchOfLitter('f1', 't')).resolves.toEqual({ batch_id: 'b-wean', batch_no: 'BATCH-000003' });
    });

    it('is nothing for a litter recorded without a lot', async () => {
      rows.set(schema.farrowingRecord, [{ lot: null }]);
      await expect(service.batchOfLitter('f1', 't')).resolves.toBeNull();
    });
  });

  describe('registerGilt (one by one, through the full animal register form)', () => {
    const twoLines = (registered: number) => selection({
      lines: [{ line_id: 'l1', line_no: 1, farrow_id: 'f1', gilts_selected: 2, lot_no: 'LOT-1', source_batch_id: 'b-lot', piglet_item_id: 'item-piglet', sow_animal_id: 'sow-1', boar_animal_id: 'boar-1' }],
      gilts: Array.from({ length: registered }, (_, i) => ({ gilt_id: `g${i}`, line_id: 'l1' })),
      head_released: String(registered), value_released: String(registered * 1.8334),
    });
    const form = { rfid_tag: 'R1', no_of_teats: 16, tsi: 120, grading: 88, notes: 'typed in the full form', breed_id: 'br-1', item_id: 'item-x', current_location_id: 'pen-1' };

    beforeEach(() => {
      batchService.releaseHeadToAnimals.mockResolvedValue({ per_head: 1.8334, total: 1.8334, remaining: 8 });
      animals.create.mockImplementation(async (d: any) => ({ animal_id: 'a1', animal_code: 'PIG-1', dob: d.dob }));
    });

    it('keeps everything typed in the form, forces the lineage, and takes one head at the batch\'s value per head', async () => {
      spyOnSelection(twoLines(0));
      const r: any = await service.registerGilt('gs-1', 'l1', form, 't', { userId: 'u1' });
      expect(batchService.releaseHeadToAnimals).toHaveBeenCalledWith('b-wean', expect.objectContaining({ quantity: 1, reference: 'GS-2026-00001' }), 't', { userId: 'u1' });
      expect(animals.create.mock.calls[0][0]).toMatchObject({
        tsi: 120, grading: 88, notes: 'typed in the full form', rfid_tag: 'R1', no_of_teats: 16, current_location_id: 'pen-1',
        animal_type: 'GILT', gender: 'F', entry_type: 'BORN_ON_FARM', dam_animal_id: 'sow-1', sire_animal_id: 'boar-1', source_batch_id: 'b-lot', acquisition_cost: 1.8334,
      });
      expect(r.selection_complete).toBe(false); // one of two
      expect(updated.find((u) => u.table === schema.giltSelection)?.set).toMatchObject({ head_released: '1', value_released: '1.8334' });
    });

    it('posts the selection when its last gilt is registered', async () => {
      spyOnSelection(twoLines(1));
      const r: any = await service.registerGilt('gs-1', 'l1', form, 't');
      expect(r.selection_complete).toBe(true);
      expect(updated.find((u) => u.table === schema.giltSelection)?.set).toMatchObject({ status: 'POSTED', head_released: '2' });
    });

    it('refuses under 15 teats, no RFID and a line already fully registered, before the batch is touched', async () => {
      spyOnSelection(twoLines(0));
      await expect(service.registerGilt('gs-1', 'l1', { ...form, no_of_teats: 14 }, 't')).rejects.toThrow(/14 teats.*at least 15/);
      await expect(service.registerGilt('gs-1', 'l1', { ...form, rfid_tag: ' ' }, 't')).rejects.toThrow(/RFID/);
      spyOnSelection(twoLines(2));
      await expect(service.registerGilt('gs-1', 'l1', form, 't')).rejects.toThrow(/already registered/);
      expect(batchService.releaseHeadToAnimals).not.toHaveBeenCalled();
    });
  });

  describe('where gilts stand when they join an animal-wise batch', () => {
    it('registers them at Gilt Rearing when the batch has no stage of its own (the "no stage" refusal)', async () => {
      jest.spyOn(service as any, 'scopedBatch').mockResolvedValue({ batch_id: 'b-reg', batch_no: 'BATCH-000002', tracking_mode: 'ANIMAL_WISE', stage_id: null, company_id: 'co-1', nob_id: 'n1', lob_id: 'l1' });
      rows.set(schema.stageMaster, [{ stage_id: 'st-gilt' }]);
      const placement = await (service as any).placementOf({ animal_batch_id: 'b-reg', location_id: null, batch_id: 'b-wean' }, 't');
      expect(placement).toEqual({ current_batch_id: 'b-reg', current_stage_id: 'st-gilt' });
    });

    it('says so when there is neither a Gilt Rearing stage nor one on the batch', async () => {
      jest.spyOn(service as any, 'scopedBatch').mockResolvedValue({ batch_id: 'b-reg', batch_no: 'BATCH-000002', tracking_mode: 'ANIMAL_WISE', stage_id: null, company_id: 'co-1', nob_id: 'n1', lob_id: 'l1' });
      rows.set(schema.stageMaster, []);
      await expect((service as any).placementOf({ animal_batch_id: 'b-reg', location_id: null, batch_id: 'b-wean' }, 't')).rejects.toThrow(/no stage to register the gilts in/);
    });
  });

  describe('the cost one gilt carries, per sow', () => {
    // settleCost and costPerPigOf are real here.
    const farrowRow = (over: object = {}) => ({ farrow_id: 'f1', sow_animal_id: 'sow-1', piglet_batch_id: 'b-lot', piglets_weaned: 0, cost_per_piglet: null, ...over });

    beforeEach(() => {
      (service as any).settleCost.mockRestore();
      rows.set(schema.farrowingRecord, [farrowRow()]);
      animalReads = [[sow]];
    });
    const sow = { animal_id: 'sow-1', animal_code: 'SOW-1' };

    it('before the weaning, moves the sow\'s cost to that day into the lot first and releases at the lot\'s own average', async () => {
      jest.spyOn(service as any, 'holding').mockResolvedValue({ head: 10, value: 0, per_head: 0 });
      litterCost.allocate.mockResolvedValue({ moved: 18, perPiglet: '1.8', note: '' });
      const own = await (service as any).settleCost('f1', 'b-lot', '2026-10-12', 't');
      expect(litterCost.allocate).toHaveBeenCalledWith(expect.objectContaining({ farrow_id: 'f1' }), sow, { asOf: '2026-10-12', divisor: 10 }, 't', undefined);
      expect(own).toBeUndefined();
    });

    it('after the weaning, a litter sitting in a batch with others carries ITS cost per piglet, not that batch\'s average', async () => {
      rows.set(schema.farrowingRecord, [farrowRow({ piglets_weaned: 13, cost_per_piglet: '1.8334' })]);
      jest.spyOn(service as any, 'holding').mockResolvedValue({ head: 98, value: 6189.47, per_head: 63.16 });
      expect(await (service as any).settleCost('f1', 'b-mixed', '2026-10-20', 't')).toBe(1.8334);
      expect(litterCost.allocate).not.toHaveBeenCalled();
      const farrow: any = farrowRow({ piglets_weaned: 13, cost_per_piglet: '1.8334' });
      expect(await (service as any).costPerPigOf(farrow, sow, 'b-mixed', '2026-10-20', 't')).toEqual({ per_pig: 1.8334, own: 1.8334 });
    });

    it('a litter with no cost recorded, in a batch with others, carries nothing: the sow handed it none, and the batch\'s average is not hers', async () => {
      jest.spyOn(service as any, 'holding').mockResolvedValue({ head: 104, value: 6204, per_head: 59.65 });
      const farrow: any = farrowRow({ piglets_weaned: 13, cost_per_piglet: null });
      expect(await (service as any).costPerPigOf(farrow, sow, 'b-mixed', '2026-10-22', 't')).toEqual({ per_pig: 0, own: 0 });
    });

    it('previews a litter still on its sow as (the lot\'s value + what she has still to hand over) over its head', async () => {
      jest.spyOn(service as any, 'holding').mockResolvedValue({ head: 10, value: 4, per_head: 0.4 });
      litterCost.pending.mockResolvedValue(14);
      const farrow: any = farrowRow();
      expect(await (service as any).costPerPigOf(farrow, sow, 'b-lot', '2026-10-12', 't')).toEqual({ per_pig: 1.8 });
    });

    it('a litter alone in its weaned lot carries the lot\'s average', async () => {
      jest.spyOn(service as any, 'holding').mockResolvedValue({ head: 9, value: 11, per_head: 1.2222 });
      const farrow: any = farrowRow({ piglets_weaned: 9, cost_per_piglet: '1.8334' });
      expect(await (service as any).costPerPigOf(farrow, sow, 'b-lot', '2026-10-20', 't')).toEqual({ per_pig: 1.2222 });
    });
  });

  describe('placement when the selection batch has no location', () => {
    it('falls back to the litter\'s lot, then to the dam, so a gilt always stands somewhere', async () => {
      jest.spyOn(service as any, 'scopedBatch').mockResolvedValue({ batch_id: 'b-mixed', location_id: null });
      rows.set(schema.batchHeader, [{ location_id: 'loc-lot' }]);
      expect(await (service as any).placementOf({ animal_batch_id: null, location_id: null, batch_id: 'b-mixed' }, 't', { source_batch_id: 'b-lot', sow_animal_id: 'sow-1' })).toEqual({ current_location_id: 'loc-lot' });
      rows.set(schema.batchHeader, [{ location_id: null }]);
      animalReads = [[{ location_id: 'pen-sow' }]];
      expect(await (service as any).placementOf({ animal_batch_id: null, location_id: null, batch_id: 'b-mixed' }, 't', { source_batch_id: 'b-lot', sow_animal_id: 'sow-1' })).toEqual({ current_location_id: 'pen-sow' });
    });
  });
});
