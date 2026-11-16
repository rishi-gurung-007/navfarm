import { JournalService } from '../../finance/journal/journal.service';
import { StockAdjustmentService } from '../../inventory/stock-adjustment/stock-adjustment.service';
import { StockTransferService } from '../../inventory/stock-transfer/stock-transfer.service';
import { MASTER_CODE_COLUMNS } from './master-code-columns';
import { DOCUMENT_TABLES } from './number-series.service';

/**
 * Journal, stock transfer and stock adjustment numbers used to be MAX(number)+1 over their own table, so the Number
 * Series screen could not change them. Each now draws from the company's series for its document type, inside the
 * transaction that inserts the document.
 */
describe('document numbers come from the number series', () => {
  const cases: Array<[string, any, string, string, { seriesCode: string; prefix: string; seqLength: number }]> = [
    ['journal entry', JournalService, 'generateJournalNo', 'JE-000042', { seriesCode: 'JOURNAL', prefix: 'JE', seqLength: 6 }],
    ['stock transfer', StockTransferService, 'generateTransferNo', 'TR-000042', { seriesCode: 'STOCK_TRANSFER', prefix: 'TR', seqLength: 6 }],
    ['stock adjustment', StockAdjustmentService, 'generateAdjustmentNo', 'ADJ-000042', { seriesCode: 'STOCK_ADJUSTMENT', prefix: 'ADJ', seqLength: 6 }],
  ];

  it.each(cases)('%s: asks for the company\'s series, then draws from it inside the transaction', async (_label, Service, method, issued, defaults) => {
    const numberSeriesService = {
      seriesCodeForDocument: jest.fn().mockResolvedValue('NS-CUSTOM'),
      generateNext: jest.fn().mockResolvedValue(issued),
    };
    const service: any = Object.create(Service.prototype);
    service.numberSeriesService = numberSeriesService;
    const tx = { tx: true };

    await expect(service[method]('tenant-1', 'co-1', tx)).resolves.toBe(issued);

    expect(numberSeriesService.seriesCodeForDocument).toHaveBeenCalledWith(
      'tenant-1', 'co-1',
      expect.objectContaining({ seriesCode: defaults.seriesCode, documentType: defaults.seriesCode, prefix: defaults.prefix, separator: '-', seqLength: defaults.seqLength }),
      expect.any(Function),
    );
    // The series configured on the master wins, whatever code it has, and the draw is inside the caller's transaction.
    expect(numberSeriesService.generateNext).toHaveBeenCalledWith('NS-CUSTOM', 'tenant-1', 'co-1', tx);
  });

  it('registers each document type, so the series screen offers it and a taken number is skipped', () => {
    expect(MASTER_CODE_COLUMNS).toMatchObject({ JOURNAL: 'journal_no', STOCK_TRANSFER: 'transfer_no', STOCK_ADJUSTMENT: 'adjustment_no', GOODS_RECEIPT: 'receipt_no', BATCH_TRANSFER: 'transfer_no' });
    expect(Object.keys(DOCUMENT_TABLES)).toEqual(expect.arrayContaining(['journal', 'stock-transfer', 'stock-adjustment', 'goods-receipt', 'batch-transfer']));
  });
});
