import { transactionCls } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { GoodsReceiptService } from './goods-receipt.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { BadRequestException } from '@nestjs/common';

describe('GoodsReceiptService', () => {
  let service: GoodsReceiptService;

  const mockDbSelect = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    update: mockDbUpdate,
  };

  const draftReceipt = {
    receipt_id: 'gr-1',
    company_id: 'comp-1',
    status: 'DRAFT',
    lines: [{ line_id: 'line-1', item_id: 'item-1', quantity: '10', uom: 'KG' }],
  };

  const found = (row: any) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([row]) }) }) });

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoodsReceiptService,
        { provide: ClsService, useValue: transactionCls(mockDb) },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: { writePositiveEntry: jest.fn().mockResolvedValue({ entry_no: 1 }) } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<GoodsReceiptService>(GoodsReceiptService);
  });

  describe('post', () => {
    it('rejects posting when the ANIMAL_SUPPLIER vendor has no health_cert_url on file', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1' } as any);
      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-1', vendor_type: 'ANIMAL_SUPPLIER', health_cert_url: null, supplier_name: 'Animal Farm Co' }));

      await expect(service.post('gr-1', 'tenant-123')).rejects.toThrow(BadRequestException);
    });

    it('allows posting when the ANIMAL_SUPPLIER vendor has a health_cert_url on file', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1' } as any) // initial load
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1', status: 'POSTED' } as any); // final return

      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-1', vendor_type: 'ANIMAL_SUPPLIER', health_cert_url: 'https://certs.example.com/farm.pdf' }));
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-1', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
    });

    it('allows posting for a non-ANIMAL_SUPPLIER vendor regardless of health_cert_url', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-2' } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-2', status: 'POSTED' } as any);

      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-2', vendor_type: 'FEED_SUPPLIER', health_cert_url: null }));
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-2', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
    });

    it('allows posting when the receipt has no supplier_id at all', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(mockDbSelect).not.toHaveBeenCalled(); // no supplier lookup needed
      expect(result.status).toBe('POSTED');
    });
  });
});
