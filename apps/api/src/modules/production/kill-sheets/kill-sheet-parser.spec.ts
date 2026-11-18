import * as XLSX from 'xlsx';
import { parseIndividualKillSheet, parseProductSummary, type ImportIssue } from './kill-sheet-parser';

const workbook = (rows: unknown[][], bookType: XLSX.BookType) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Any report title');
  return XLSX.write(book, { type: 'buffer', bookType }) as Buffer;
};

describe('Kill Sheet workbook parser', () => {
  it.each(['xls', 'xlsx'] as XLSX.BookType[])('reads individual records from %s without fixed columns', async (bookType) => {
    const parsed = await parseIndividualKillSheet(workbook([
      ['Printed by test'], [], [' Date / Time ', 'Meat %', 'SN', 'Cold Mass 3%', 'Warm Mass', 'EarTag', 'Sick'],
      ['2026/11/16 11:40:03', 51, '001', 87.397, 90.1, '', 'S1'],
      ['SN', 'Warm Mass', 'Cold Mass 3%'], ['Batch Total', 1, 90.1, 87.397],
    ], bookType));
    expect(parsed.issues.filter((issue: ImportIssue) => issue.severity === 'ERROR')).toEqual([]);
    expect(parsed.records).toEqual([expect.objectContaining({ serial_number: '001', ear_tag: null, warm_mass_kg: '90.1', cold_mass_kg: '87.397' })]);
    expect(parsed.expected).toEqual(expect.objectContaining({ animal_count: '1', warm_mass_kg: '90.1', cold_mass_kg: '87.397' }));
  });

  it('keeps product detail rows separate from category subtotals and shifted grand total cells', async () => {
    const parsed = await parseProductSummary(workbook([
      ['Company: Triple C', 'Summary Carcass Graded Products'],
      ['Product', 'Description', 'Qty', 'Warm Mass', 'CCM', 'Avg Mass', 'Price', 'Value'],
      ['Baconer'], ['PCBA', 'Baconer A', 2, 180, 174, 87, 10, 1740], ['Baconer Total', '', 2, 180, 174, 87, 10, 1740],
      // A category subtotal has no product code or description: its numeric
      // values are shifted left and must never be stored as a product record.
      [2, 180, 174, 87, 10, 1740], ['Grand Total', 2, 180, 174, 87, 10, 1740],
    ], 'xlsx'));
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({ category: 'Baconer', product_code: 'PCBA', quantity: '2', reported_value: '1740' });
    expect(parsed.expected).toEqual(expect.objectContaining({ quantity: '2', warm_mass_kg: '180', cold_mass_kg: '174', value: '1740' }));
  });
});
