import * as ExcelJS from 'exceljs';
import { LEDGER_EXPORT_COLUMNS, LedgerExportRow, ledgerRowsToCsv, ledgerRowsToXlsx } from './inventory-ledger-export';

const row = (over: Partial<LedgerExportRow> = {}): LedgerExportRow => ({
  ledger_id: 'led-1',
  posting_date: '2026-09-30',
  document_type: 'GOODS_RECEIPT',
  document_no: 'GRN-000001',
  external_reference_no: null,
  entry_type: 'POSITIVE',
  transaction_type: 'PURCHASE',
  item_code: 'ITM-0001',
  item_description: 'Grower feed, "premium" 50kg',
  category_code: 'FEED',
  category_name: 'Feed',
  quantity: '1500.0000',
  remaining_quantity: '900.0000',
  uom: 'KG',
  uom_conversion_factor: '1.0000',
  alternate_quantity: null,
  rate: '0.8500',
  amount: '1275.0000',
  lot_no: 'LOT-7',
  serial_no: null,
  expiry_date: '2027-03-01',
  batch_no: null,
  location_code: null,
  location_name: null,
  warehouse_code: 'SILO-001',
  warehouse_name: 'Silo One',
  created_by: 'user-1',
  created_at: '2026-09-30 08:15:00',
  ...over,
});

describe('inventory ledger export', () => {
  it('writes a header row with every column and one line per entry, quoted for Excel', () => {
    const csv = ledgerRowsToCsv([row(), row({ document_no: 'GRN-000002', quantity: '-20' })]);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[0].split(',')).toHaveLength(LEDGER_EXPORT_COLUMNS.length);
    expect(lines[1]).toContain('"Grower feed, ""premium"" 50kg"');
    expect(lines[1]).toContain('2026-09-30');
    expect(lines[2]).toContain(',-20,');
  });

  it('does not let a text cell start a spreadsheet formula', () => {
    const csv = ledgerRowsToCsv([row({ item_description: '=HYPERLINK("http://x")' })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('produces a real workbook with typed numbers and dates and a frozen header', async () => {
    const buffer = await ledgerRowsToXlsx([row()]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet('Inventory Ledger Entries')!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(1).getCell(1).value).toBe('Posting Date');
    const quantityCol = LEDGER_EXPORT_COLUMNS.findIndex((c) => c.key === 'quantity') + 1;
    const dateCol = LEDGER_EXPORT_COLUMNS.findIndex((c) => c.key === 'posting_date') + 1;
    expect(sheet.getRow(2).getCell(quantityCol).value).toBe(1500);
    expect((sheet.getRow(2).getCell(dateCol).value as Date).toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('exports an empty result as just the header', async () => {
    expect(ledgerRowsToCsv([]).trim().split('\r\n')).toHaveLength(1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await ledgerRowsToXlsx([])) as any);
    expect(workbook.getWorksheet('Inventory Ledger Entries')!.rowCount).toBe(1);
  });
});
