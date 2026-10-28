import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { SemenLotService } from './semen-lot.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { QrCodeService } from '../../production/qr-code/qr-code.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';

describe('SemenLotService', () => {
  const queue: unknown[][] = [];
  const updates: any[] = [];
  const chain = (result: unknown[]) => {
    const self: any = {};
    for (const m of ['from', 'where', 'limit', 'orderBy']) self[m] = () => self;
    self.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
    return self;
  };
  const db = {
    select: jest.fn(() => ({ from: () => chain(queue.shift() ?? []) })),
    update: jest.fn(() => ({ set: (v: any) => ({ where: () => { updates.push(v); return Promise.resolve(); } }) })),
    insert: jest.fn(() => ({ values: (v: any) => { inserts.push(v); return Promise.resolve(); } })),
  };
  const inserts: any[] = [];
  const bookValue = { refreshCache: jest.fn().mockResolvedValue(undefined) };
  const ledger = { writePositiveEntry: jest.fn(), writeNegativeEntry: jest.fn() };
  const gl = { postInventoryLedgerEntry: jest.fn(), hasMapping: jest.fn(), animalAssetAccountId: jest.fn() };
  const numberSeries = { generateNext: jest.fn() };
  const qr = { createForSemenLot: jest.fn() };
  let service: SemenLotService;

  const boar = { animal_id: 'boar-1', animal_code: 'BOAR-1', company_id: 'co-1', current_location_id: 'pen-1' } as any;
  const item = { item_id: 'item-s', item_name: 'Boar semen dose', is_active: true, uom_primary: 'DOSE', shelf_life_days: 5 };
  const boarBatch = { batch_id: 'b-boar', batch_no: 'BATCH-000001', farm_id: 'farm-1' };
  const collect = (over: object = {}) =>
    service.postCollection({ boar, boarBatchId: 'b-boar', semenBatchId: 'sb-1', collectionDate: '2026-10-09', doses: 40, itemId: 'item-s', ...over }, 'tenant-1', { userId: 'u1' });

  beforeEach(async () => {
    queue.length = 0; updates.length = 0; inserts.length = 0;
    jest.clearAllMocks();
    numberSeries.generateNext.mockResolvedValue('LOT-00011');
    ledger.writePositiveEntry.mockResolvedValue({ ledger_id: 'led-1' });
    ledger.writeNegativeEntry.mockResolvedValue({ ledger_id: 'led-2' });
    qr.createForSemenLot.mockResolvedValue({ qr_id: 'qr-1', pack_no: 'PACK-000007' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        SemenLotService,
        { provide: ClsService, useValue: { get: (key?: string) => (key === 'tenantPostingTransaction' ? true : db) } },
        { provide: InventoryLedgerService, useValue: ledger },
        { provide: GlPostingService, useValue: gl },
        { provide: NumberSeriesService, useValue: numberSeries },
        { provide: QrCodeService, useValue: qr },
        { provide: AnimalBookValueService, useValue: bookValue },
      ],
    }).compile();
    service = moduleRef.get(SemenLotService);
  });

  describe('posting a collection', () => {
    it('puts the doses in the boar’s farm store as a lot of the item, expiring by its shelf life, with a QR for the lot', async () => {
      queue.push([item], [boarBatch], [{ location_id: 'store-1' }]);

      const lot = await collect();

      expect(numberSeries.generateNext).toHaveBeenCalledWith('ITEM_LOT', 'tenant-1', 'co-1');
      expect(ledger.writePositiveEntry).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: 'item-s', quantity: 40, uom: 'DOSE', rate: 0, lotNo: 'LOT-00011', expiryDate: '2026-10-14', warehouseId: 'store-1', batchNo: 'BATCH-000001', postingDate: '2026-10-09' }),
      );
      expect(gl.postInventoryLedgerEntry).toHaveBeenCalledWith({ ledger_id: 'led-1' }, 'u1');
      expect(qr.createForSemenLot).toHaveBeenCalledWith(
        expect.objectContaining({ boar, boarBatch, item, lotNo: 'LOT-00011', doses: 40, expiryDate: '2026-10-14', warehouseId: 'store-1' }),
        'tenant-1',
        { userId: 'u1' },
      );
      expect(lot).toEqual({ lot_no: 'LOT-00011', expiry_date: '2026-10-14', warehouse_id: 'store-1', qr_id: 'qr-1', pack_no: 'PACK-000007' });
    });

    it('has no expiry for an item with no shelf life, and no QR for a boar in no batch', async () => {
      // No batch, so the farm is the one his pen belongs to: item, the pen's farm, that farm's store.
      queue.push([{ ...item, shelf_life_days: null }], [{ location_id: 'pen-1', parent: 'shed-1', farm_id: 'farm-1' }], [{ location_id: 'store-1' }]);
      const lot = await collect({ boarBatchId: null });
      expect(lot.expiry_date).toBeNull();
      expect(lot.qr_id).toBeNull();
      expect(qr.createForSemenLot).not.toHaveBeenCalled();
    });

    it('refuses an unknown or inactive item, an empty collection, and a farm with no store — writing nothing', async () => {
      queue.push([]);
      await expect(collect()).rejects.toThrow(NotFoundException);
      queue.push([{ ...item, is_active: false }]);
      await expect(collect()).rejects.toThrow('is not active');
      await expect(collect({ doses: 0 })).rejects.toThrow('at least one dose');
      queue.push([item], [boarBatch], []);
      await expect(collect()).rejects.toThrow('has no store to hold the semen');
      expect(ledger.writePositiveEntry).not.toHaveBeenCalled();
      expect(qr.createForSemenLot).not.toHaveBeenCalled();
    });
  });

  describe('the value of the doses', () => {
    it('enter stock at the lot\'s cost per dose, so the stock and its journal carry a value', async () => {
      queue.push([item], [boarBatch], [{ location_id: 'store-1' }]);
      await collect({ unitCost: 12.296100123 });
      expect(ledger.writePositiveEntry).toHaveBeenCalledWith(expect.objectContaining({ quantity: 40, rate: 12.2961, transactionType: 'OUTPUT' }));
    });
  });

  describe('using doses at a mating', () => {
    const lot = (over: object = {}) => ({
      semen_batch_id: 'sb-1', company_id: 'co-1', doses_collected: '40', doses_used_internal: '0', doses_sold: '0',
      inventory_posted: true, output_item_id: 'item-s', warehouse_id: 'store-1', lot_no: 'LOT-00011', ...over,
    }) as any;

    it('issues the doses from the lot’s stock and counts them used', async () => {
      queue.push([{ uom_primary: 'DOSE' }]);
      await service.issueDoses(lot(), 2, 'breeding-1', '2026-10-09', 'tenant-1', { userId: 'u1' });
      expect(ledger.writeNegativeEntry).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: 'item-s', quantity: 2, uom: 'DOSE', lotNo: 'LOT-00011', warehouseId: 'store-1', documentNo: 'breeding-1', postingDate: '2026-10-09' }),
      );
      expect(gl.postInventoryLedgerEntry).toHaveBeenCalled();
      expect(updates[0]).toEqual({ doses_used_internal: '2' });
    });

    it('only counts the doses of a lot collected before semen was stock', async () => {
      await service.issueDoses(lot({ inventory_posted: false, lot_no: null }), 3, 'breeding-1', '2026-10-09', 'tenant-1');
      expect(ledger.writeNegativeEntry).not.toHaveBeenCalled();
      expect(updates[0]).toEqual({ doses_used_internal: '3' });
    });

    it('refuses more doses than the lot has left (collected less used less sold)', async () => {
      await expect(
        service.issueDoses(lot({ doses_collected: '10', doses_used_internal: '6', doses_sold: '3' }), 2, 'breeding-1', '2026-10-09', 'tenant-1'),
      ).rejects.toThrow('has 1 dose left; 2 cannot be used');
      expect(ledger.writeNegativeEntry).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
    });

    describe('charged to the sow', () => {
      const sow = { animal_id: 'sow-1', animal_code: 'PIG-2024-0004', item_id: 'item-sow' } as any;
      const batch = { batch_id: 'b-sow', batch_no: 'BATCH-000003', company_id: 'co-1', costing_method: 'BIO_ASSET', nob_id: 'nob-1', lob_id: 'lob-1' };

      it('files the issue under her batch, named for her, and puts its cost on her, on her batch and on the batch as a consumption', async () => {
        queue.push([{ uom_primary: 'DOSE' }], [{ ledger_id: 'rcpt-1', remaining_quantity: '40.0000' }], [batch], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }]);
        gl.hasMapping.mockResolvedValue(true);
        ledger.writeNegativeEntry.mockResolvedValue({ ledger_id: 'led-2', amount: '-24.5922' });

        await service.issueDoses(lot(), 2, 'breeding-1', '2026-10-09', 'tenant-1', { userId: 'u1' }, { sow, batchId: 'b-sow' });

        expect(gl.hasMapping).toHaveBeenCalledWith('tenant-1', 'co-1', 'BIO_SEMEN_USE', { nobId: 'nob-1', lobId: 'lob-1' });
        expect(ledger.writeNegativeEntry).toHaveBeenCalledWith(
          expect.objectContaining({ documentNo: 'AI PIG-2024-0004', documentLineId: 'breeding-1', batchNo: 'BATCH-000003', glMappingType: 'BIO_SEMEN_USE', lotNo: 'LOT-00011', sourceLedgerId: 'rcpt-1' }),
        );
        const [bioRow, batchTx] = inserts;
        expect(bioRow).toMatchObject({
          animal_id: 'sow-1', batch_id: 'b-sow', entry_type: 'OVERHEAD', transaction_type: 'CONSUMPTION', document_type: 'BREEDING_SEMEN',
          cost_amount: '24.5922', quantity: '2', lot_no: 'LOT-00011', posting_date: '2026-10-09',
        });
        expect(batchTx).toMatchObject({ batch_id: 'b-sow', transaction_type: 'CONSUMPTION', animal_id: 'sow-1', quantity: '2', amount: '-24.5922', ledger_id: 'led-2' });
        // her batch's carrying value rises by the same cost: 100 + 24.5922
        expect(updates).toContainEqual({ nca_book_value: '124.5922' });
        expect(bookValue.refreshCache).toHaveBeenCalledWith(['sow-1']);
      });

      it('expenses it once her costing has begun, as her feed is: the BIO_SEMEN_EXPENSE rule, a consumption on her batch against her, nothing added to her value', async () => {
        queue.push([{ uom_primary: 'DOSE' }], [{ ledger_id: 'rcpt-1', remaining_quantity: '40.0000' }], [batch], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }]);
        gl.hasMapping.mockResolvedValue(true);
        ledger.writeNegativeEntry.mockResolvedValue({ ledger_id: 'led-2', amount: '-24.5922' });
        const started = { ...sow, costing_start_date: '2026-05-25' };

        await service.issueDoses(lot(), 2, 'breeding-1', '2026-10-09', 'tenant-1', { userId: 'u1' }, { sow: started, batchId: 'b-sow' });

        expect(gl.hasMapping).toHaveBeenCalledWith('tenant-1', 'co-1', 'BIO_SEMEN_EXPENSE', { nobId: 'nob-1', lobId: 'lob-1' });
        expect(ledger.writeNegativeEntry).toHaveBeenCalledWith(expect.objectContaining({ glMappingType: 'BIO_SEMEN_EXPENSE', batchNo: 'BATCH-000003' }));
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({ transaction_type: 'CONSUMPTION', animal_id: 'sow-1', amount: '-24.5922' });
        expect(updates.some((u) => 'nca_book_value' in u)).toBe(false);
        expect(bookValue.refreshCache).not.toHaveBeenCalled();
      });

      it('capitalises it only while her costing has not begun on the mating date', async () => {
        queue.push([{ uom_primary: 'DOSE' }], [{ ledger_id: 'rcpt-1', remaining_quantity: '40.0000' }], [batch], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }]);
        gl.hasMapping.mockResolvedValue(true);
        ledger.writeNegativeEntry.mockResolvedValue({ ledger_id: 'led-2', amount: '-24.5922' });
        // her costing starts the day after the mating
        await service.issueDoses(lot(), 2, 'breeding-1', '2026-10-09', 'tenant-1', undefined, { sow: { ...sow, costing_start_date: '2026-10-10' }, batchId: 'b-sow' });
        expect(gl.hasMapping).toHaveBeenCalledWith('tenant-1', 'co-1', 'BIO_SEMEN_USE', expect.anything());
        expect(inserts).toHaveLength(2);
      });

      it('leaves the cost off the sow, and posts the issue by the ordinary consumption mapping, when no BIO_SEMEN_USE mapping is set up', async () => {
        queue.push([{ uom_primary: 'DOSE' }], [{ ledger_id: 'rcpt-1', remaining_quantity: '40.0000' }], [batch], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }]);
        gl.hasMapping.mockResolvedValue(false);
        ledger.writeNegativeEntry.mockResolvedValue({ ledger_id: 'led-2', amount: '-24.5922' });

        await service.issueDoses(lot(), 2, 'breeding-1', '2026-10-09', 'tenant-1', { userId: 'u1' }, { sow, batchId: 'b-sow' });

        expect(ledger.writeNegativeEntry).toHaveBeenCalledWith(expect.objectContaining({ glMappingType: undefined, batchNo: 'BATCH-000003' }));
        expect(inserts).toHaveLength(0);
      });

      it('draws the doses the ordinary way (oldest receipt) when the lot\'s own receipt no longer holds them', async () => {
        queue.length = 0;
        queue.push([{ uom_primary: 'DOSE' }], [{ ledger_id: 'rcpt-1', remaining_quantity: '1.0000' }], [batch], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }]);
        gl.hasMapping.mockResolvedValue(true);
        ledger.writeNegativeEntry.mockResolvedValue({ ledger_id: 'led-2', amount: '-24.5922' });
        await service.issueDoses(lot(), 2, 'breeding-1', '2026-10-09', 'tenant-1', undefined, { sow, batchId: 'b-sow' });
        expect(ledger.writeNegativeEntry).toHaveBeenCalledWith(expect.objectContaining({ sourceLedgerId: undefined }));
      });

      it('does not charge a sow whose batch is not a bio-asset batch', async () => {
        queue.push([{ uom_primary: 'DOSE' }], [{ ledger_id: 'rcpt-1', remaining_quantity: '40.0000' }], [{ ...batch, costing_method: 'FIFO' }], []);
        ledger.writeNegativeEntry.mockResolvedValue({ ledger_id: 'led-2', amount: '-24.5922' });
        await service.issueDoses(lot(), 2, 'breeding-1', '2026-10-09', 'tenant-1', undefined, { sow, batchId: 'b-sow' });
        expect(gl.hasMapping).not.toHaveBeenCalled();
        expect(inserts).toHaveLength(0);
      });

      it('charges nothing when the doses are at no value', async () => {
        queue.push([{ uom_primary: 'DOSE' }], [{ ledger_id: 'rcpt-1', remaining_quantity: '40.0000' }], [batch], [{ nca_book_value: '100.0000', stage: 'PREMATURE' }]);
        gl.hasMapping.mockResolvedValue(true);
        ledger.writeNegativeEntry.mockResolvedValue({ ledger_id: 'led-2', amount: '0.0000' });
        await service.issueDoses(lot(), 2, 'breeding-1', '2026-10-09', 'tenant-1', undefined, { sow, batchId: 'b-sow' });
        expect(inserts).toHaveLength(0);
      });
    });

    it('is a BadRequest, so a mating is refused cleanly', async () => {
      await expect(service.issueDoses(lot({ doses_used_internal: '40' }), 1, 'b', '2026-10-09', 'tenant-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
