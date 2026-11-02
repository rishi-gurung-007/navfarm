/**
 * Reports export to Excel only (Rishi, 2 Nov). One sheet: the report's title, its filters, the header (two rows when
 * the columns are grouped), and the rows exactly as the screen shows them — a plain number is written as a number so
 * Excel can sum it. ExcelJS is loaded only when someone exports.
 */

export type ExcelCell = string | number | null;
export type ExcelTone = 'good' | 'bad' | null;

export interface ExcelSheet {
  /** Sheet tab name; Excel allows 31 characters. */
  name: string;
  title: string;
  /** Lines under the title: the filters and when it was generated. */
  info?: string[];
  /** Leading columns whose heading spans both header rows (e.g. Sow Batch). */
  lead?: string[];
  /** Groups over the remaining columns, in order; their spans add up to `headers.length`. */
  groups?: Array<{ label: string; span: number }>;
  headers: string[];
  rows: ExcelCell[][];
  /** Rows to print bold (e.g. the farm total). */
  boldRows?: Set<number>;
  /** Good-news green and bad-news red, as on the screen. */
  tone?: (row: number, column: number, value: ExcelCell) => ExcelTone;
  /** A line after the table. */
  note?: string;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** A plain number becomes a number; anything else (N/A, 12.5%, text) stays as shown. */
export function excelValue(value: ExcelCell): ExcelCell {
  if (typeof value === 'string' && NUMBER.test(value.trim())) return Number(value);
  return value ?? '';
}

const safeName = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

export async function downloadExcel(fileName: string, sheet: ExcelSheet): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(safeName(sheet.name));
  const lead = sheet.lead ?? [];
  const width = lead.length + sheet.headers.length;
  const headFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEBEEF2' } };
  const thin = { style: 'thin' as const, color: { argb: 'FFBEC2CA' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  ws.addRow([sheet.title]).font = { bold: true, size: 14 };
  for (const line of sheet.info ?? []) ws.addRow([line]).font = { size: 9, color: { argb: 'FF555555' } };
  ws.addRow([]);

  const styleHead = (rowNo: number) => {
    const row = ws.getRow(rowNo);
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true };
      cell.fill = headFill;
      cell.border = border;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
  };

  let headerRows = 1;
  if (sheet.groups?.length) {
    headerRows = 2;
    const top = ws.addRow([...lead, ...sheet.groups.flatMap((g) => [g.label, ...Array(g.span - 1).fill(null)])]);
    const sub = ws.addRow([...lead.map(() => null), ...sheet.headers]);
    lead.forEach((_, i) => ws.mergeCells(top.number, i + 1, sub.number, i + 1));
    let col = lead.length + 1;
    for (const g of sheet.groups) {
      if (g.span > 1) ws.mergeCells(top.number, col, top.number, col + g.span - 1);
      col += g.span;
    }
    styleHead(top.number);
    styleHead(sub.number);
  } else {
    styleHead(ws.addRow([...lead, ...sheet.headers]).number);
  }
  const lastHead = ws.rowCount;
  ws.views = [{ state: 'frozen', xSplit: lead.length || 0, ySplit: lastHead }];

  sheet.rows.forEach((values, r) => {
    const row = ws.addRow(values.map(excelValue));
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      if (c > width) return;
      cell.border = border;
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: typeof cell.value === 'number' ? 'right' : 'left' };
      const tone = sheet.tone?.(r, c - 1, values[c - 1] ?? null);
      cell.font = {
        bold: sheet.boldRows?.has(r) || undefined,
        color: tone ? { argb: tone === 'good' ? 'FF2F7D5B' : 'FFB7293E' } : undefined,
      };
    });
  });

  if (sheet.note) {
    ws.addRow([]);
    ws.addRow([sheet.note]).font = { italic: true, size: 9 };
  }

  // Width from the longest line in each column (headers and values), within reason.
  for (let c = 1; c <= width; c++) {
    let longest = 8;
    for (let r = lastHead - headerRows + 1; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).getCell(c).value;
      const text = v == null ? '' : String(v);
      for (const line of text.split('\n')) longest = Math.max(longest, line.length);
    }
    ws.getColumn(c).width = Math.min(longest + 2, 40);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
