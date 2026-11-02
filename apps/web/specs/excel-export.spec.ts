import ExcelJS from 'exceljs';
import { downloadExcel, excelValue } from '../src/utils/excel-export';

// Rishi, 2 Nov: reports export to Excel only.
describe('excelValue', () => {
  it('writes a plain number as a number and keeps everything else as shown', () => {
    expect(excelValue('12')).toBe(12);
    expect(excelValue('-3.5')).toBe(-3.5);
    expect(excelValue('12.5%')).toBe('12.5%');
    expect(excelValue('N/A')).toBe('N/A');
    expect(excelValue(null)).toBe('');
  });
});

describe('downloadExcel', () => {
  let saved: Blob | null = null;
  let clicked: string | null = null;
  beforeEach(() => {
    saved = null;
    (URL as any).createObjectURL = jest.fn((b: Blob) => { saved = b; return 'blob:x'; });
    (URL as any).revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked = this.download; });
  });

  const read = async () => {
    const buffer = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(saved as Blob);
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb.worksheets[0];
  };

  it('downloads an .xlsx with the title, filters, grouped header, rows as numbers, bold total and tones', async () => {
    await downloadExcel('farrowing-report_GRS', {
      name: 'Farrowing Report',
      title: 'Farrowing Report',
      info: ['Farm: GRS - Grasmere'],
      lead: ['Sow Batch'],
      groups: [{ label: 'Sows Served', span: 2 }, { label: 'Farrowing Rate', span: 1 }],
      headers: ['Actual', 'Target', 'Actual'],
      rows: [['BATCH-1', '12', 'N/A', '+2.5'], ['Farm Total', '20', '18', '-1']],
      boldRows: new Set([1]),
      tone: (_r, c, v) => (c === 3 ? (String(v).startsWith('+') ? 'good' : 'bad') : null),
      note: 'Prior year note',
    });
    expect(clicked).toBe('farrowing-report_GRS.xlsx');
    const ws = await read();
    expect(ws.name).toBe('Farrowing Report');
    expect(ws.getCell('A1').value).toBe('Farrowing Report');
    expect(ws.getCell('A2').value).toBe('Farm: GRS - Grasmere');
    // Header rows 4 and 5: Sow Batch spans both, Sows Served spans two columns.
    expect(ws.getCell('A4').value).toBe('Sow Batch');
    expect(ws.getCell('A5').isMerged).toBe(true);
    expect(ws.getCell('B4').value).toBe('Sows Served');
    expect(ws.getCell('C4').isMerged).toBe(true);
    expect(ws.getCell('D4').value).toBe('Farrowing Rate');
    expect([ws.getCell('B5').value, ws.getCell('C5').value, ws.getCell('D5').value]).toEqual(['Actual', 'Target', 'Actual']);
    expect(ws.getCell('B6').value).toBe(12);
    expect(ws.getCell('C6').value).toBe('N/A');
    expect(ws.getCell('D6').value).toBe('+2.5');
    expect(ws.getCell('D6').font?.color?.argb).toBe('FF2F7D5B');
    expect(ws.getCell('A7').font?.bold).toBe(true);
    expect(ws.getCell('D7').font?.color?.argb).toBe('FFB7293E');
    expect(ws.getCell('A9').value).toBe('Prior year note');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 5 });
  });

  it('writes one header row when the columns are not grouped', async () => {
    await downloadExcel('monthly-ops.xlsx', {
      name: 'Monthly Ops', title: 'Monthly Ops', headers: ['Month', 'Cull'], rows: [['October', '3']],
    });
    expect(clicked).toBe('monthly-ops.xlsx');
    const ws = await read();
    expect([ws.getCell('A3').value, ws.getCell('B3').value]).toEqual(['Month', 'Cull']);
    expect(ws.getCell('B4').value).toBe(3);
  });
});
