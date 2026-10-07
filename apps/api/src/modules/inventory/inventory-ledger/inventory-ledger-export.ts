import * as ExcelJS from 'exceljs';

/**
 * One row of the Inventory Ledger export: every ledger column, with the codes
 * and names the screen shows instead of raw ids, so the file reads the same as
 * the Inventory Ledger Entries list.
 */
export interface LedgerExportRow {
  ledger_id: string;
  posting_date: string | null;
  document_type: string | null;
  document_no: string | null;
  external_reference_no: string | null;
  entry_type: string | null;
  transaction_type: string | null;
  item_code: string | null;
  item_description: string | null;
  category_code: string | null;
  category_name: string | null;
  quantity: string | number | null;
  remaining_quantity: string | number | null;
  uom: string | null;
  uom_conversion_factor: string | number | null;
  alternate_quantity: string | number | null;
  rate: string | number | null;
  amount: string | number | null;
  lot_no: string | null;
  serial_no: string | null;
  expiry_date: string | null;
  batch_no: string | null;
  location_code: string | null;
  location_name: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  created_by: string | null;
  created_at: string | Date | null;
}

type ColumnKind = 'text' | 'number' | 'date' | 'datetime';

export interface LedgerExportColumn {
  key: keyof LedgerExportRow;
  header: string;
  kind: ColumnKind;
  width: number;
}

export const LEDGER_EXPORT_COLUMNS: LedgerExportColumn[] = [
  { key: 'posting_date', header: 'Posting Date', kind: 'date', width: 14 },
  { key: 'document_type', header: 'Document Type', kind: 'text', width: 18 },
  { key: 'document_no', header: 'Document No.', kind: 'text', width: 20 },
  { key: 'external_reference_no', header: 'External Reference No.', kind: 'text', width: 22 },
  { key: 'entry_type', header: 'Entry Type', kind: 'text', width: 12 },
  { key: 'transaction_type', header: 'Transaction Type', kind: 'text', width: 18 },
  { key: 'item_code', header: 'Item Code', kind: 'text', width: 16 },
  { key: 'item_description', header: 'Item Description', kind: 'text', width: 32 },
  { key: 'category_code', header: 'Category Code', kind: 'text', width: 16 },
  { key: 'category_name', header: 'Category', kind: 'text', width: 22 },
  { key: 'quantity', header: 'Quantity', kind: 'number', width: 14 },
  { key: 'remaining_quantity', header: 'Remaining Quantity', kind: 'number', width: 18 },
  { key: 'uom', header: 'UOM', kind: 'text', width: 10 },
  { key: 'uom_conversion_factor', header: 'UOM Conversion Factor', kind: 'number', width: 22 },
  { key: 'alternate_quantity', header: 'Alternate Quantity', kind: 'number', width: 18 },
  { key: 'rate', header: 'Rate', kind: 'number', width: 12 },
  { key: 'amount', header: 'Amount', kind: 'number', width: 14 },
  { key: 'lot_no', header: 'Lot No.', kind: 'text', width: 18 },
  { key: 'serial_no', header: 'Serial No.', kind: 'text', width: 24 },
  { key: 'expiry_date', header: 'Expiry Date', kind: 'date', width: 14 },
  { key: 'batch_no', header: 'Batch No.', kind: 'text', width: 16 },
  { key: 'warehouse_code', header: 'Location Code', kind: 'text', width: 18 },
  { key: 'warehouse_name', header: 'Location', kind: 'text', width: 26 },
  { key: 'location_code', header: 'Batch Location Code', kind: 'text', width: 20 },
  { key: 'location_name', header: 'Batch Location', kind: 'text', width: 26 },
  { key: 'created_by', header: 'Created By', kind: 'text', width: 38 },
  { key: 'created_at', header: 'Created At', kind: 'datetime', width: 20 },
  { key: 'ledger_id', header: 'Ledger Entry ID', kind: 'text', width: 38 },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** A MySQL DATE arrives as 'YYYY-MM-DD'; a TIMESTAMP as a string or a Date. Returned as a plain date, never shifted by the server's zone. */
function toDateParts(value: string | Date | null | undefined): { y: number; m: number; d: number; hh: number; mm: number; ss: number } | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate(), hh: value.getHours(), mm: value.getMinutes(), ss: value.getSeconds() };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/.exec(String(value));
  if (!match) return null;
  return { y: +match[1], m: +match[2], d: +match[3], hh: +(match[4] ?? 0), mm: +(match[5] ?? 0), ss: +(match[6] ?? 0) };
}

function asDateText(value: string | Date | null | undefined, withTime: boolean): string {
  const p = toDateParts(value);
  if (!p) return value ? String(value) : '';
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return withTime ? `${date} ${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}` : date;
}

function asNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** RFC 4180 quoting, plus a guard that stops text starting with = + - or @ being run as a spreadsheet formula. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV with a UTF-8 byte-order mark so Excel opens names and symbols correctly. */
export function ledgerRowsToCsv(rows: LedgerExportRow[]): string {
  const lines = [LEDGER_EXPORT_COLUMNS.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(
      LEDGER_EXPORT_COLUMNS.map((c) => {
        const raw = row[c.key];
        if (c.kind === 'date') return csvCell(asDateText(raw as string | Date | null, false));
        if (c.kind === 'datetime') return csvCell(asDateText(raw as string | Date | null, true));
        if (c.kind === 'number') return csvCell(asNumber(raw as string | number | null));
        return csvCell(raw);
      }).join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** A real .xlsx: typed numbers and dates, a frozen filterable header, sized columns. */
export async function ledgerRowsToXlsx(rows: LedgerExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NAVFarm';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Inventory Ledger Entries', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = LEDGER_EXPORT_COLUMNS.map((c) => ({ header: c.header, key: String(c.key), width: c.width }));

  for (const row of rows) {
    const values: Record<string, unknown> = {};
    for (const c of LEDGER_EXPORT_COLUMNS) {
      const raw = row[c.key];
      if (c.kind === 'number') values[String(c.key)] = asNumber(raw as string | number | null);
      else if (c.kind === 'date' || c.kind === 'datetime') {
        const p = toDateParts(raw as string | Date | null);
        values[String(c.key)] = p ? new Date(Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss)) : null;
      } else values[String(c.key)] = raw ?? null;
    }
    sheet.addRow(values);
  }

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF9AA7B4' } } };
  });
  LEDGER_EXPORT_COLUMNS.forEach((c, index) => {
    const column = sheet.getColumn(index + 1);
    if (c.kind === 'number') column.numFmt = '#,##0.0000';
    else if (c.kind === 'date') column.numFmt = 'yyyy-mm-dd';
    else if (c.kind === 'datetime') column.numFmt = 'yyyy-mm-dd hh:mm:ss';
    if (c.kind === 'number') column.alignment = { horizontal: 'right' };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: LEDGER_EXPORT_COLUMNS.length } };

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export const LEDGER_EXPORT_MAX_ROWS = 100000;
