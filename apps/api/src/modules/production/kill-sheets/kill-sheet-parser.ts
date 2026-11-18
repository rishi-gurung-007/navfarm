import * as XLSX from 'xlsx';

export type ImportIssue = { row?: number; field?: string; severity: 'ERROR' | 'WARNING'; message: string };
export type CarcassRecord = {
  serial_number: string; ear_tag: string | null; grade: string | null; warm_mass_kg: string;
  cold_mass_kg: string; sex: string | null; fat_mm: string | null; meat_mm: string | null;
  meat_percentage: string | null; sick_code: string | null; slaughtered_at: string | null;
};
export type ProductRecord = {
  category: string | null; product_code: string; description: string | null; quantity: string | null;
  warm_mass_kg: string | null; cold_mass_kg: string | null; average_mass_kg: string | null;
  reported_price: string | null; reported_value: string | null;
};
export type ParsedKillSheet = {
  records: CarcassRecord[]; issues: ImportIssue[]; metadata: Record<string, string>;
  expected: { animal_count?: string; warm_mass_kg?: string; cold_mass_kg?: string };
};
export type ParsedProductSummary = {
  records: ProductRecord[]; issues: ImportIssue[]; metadata: Record<string, string>;
  expected: { quantity?: string; warm_mass_kg?: string; cold_mass_kg?: string; value?: string };
};

const normal = (value: unknown) => String(value ?? '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
const raw = (value: unknown) => value == null ? '' : typeof value === 'object' && 'text' in (value as any) ? String((value as any).text ?? '') : String(value).trim();
const decimal = (value: unknown): string | null => {
  const source = raw(value).replace(/,/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!source) return null;
  const n = Number(source);
  return Number.isFinite(n) ? source : null;
};
const dateTime = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 19).replace('T', ' ');
  const text = raw(value);
  if (!text) return null;
  const parsed = new Date(text.replace(/\//g, '-'));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 19).replace('T', ' ');
};
const rowsOf = (sheet: XLSX.WorkSheet): unknown[][] => XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
const empty = (row: unknown[]) => row.every((cell) => !raw(cell));
const keyed = (row: unknown[]) => new Map(row.map((cell, index) => [normal(cell), index]));
const first = (row: unknown[], ...keys: string[]) => {
  const map = keyed(row);
  for (const key of keys) if (map.has(key)) return row[map.get(key)!];
  return undefined;
};

const individualHeaders: Record<keyof Omit<CarcassRecord, 'slaughtered_at'> | 'slaughtered_at', string[]> = {
  serial_number: ['sn', 'serialnumber', 'serialno'], ear_tag: ['eartag', 'eartagno'], grade: ['grade'],
  warm_mass_kg: ['warmmass', 'warmmasskg'], cold_mass_kg: ['coldmass3', 'coldmass3kg', 'coldmass'],
  sex: ['sex'], fat_mm: ['fatmm'], meat_mm: ['meatmm'], meat_percentage: ['meat', 'meatpercentage'],
  sick_code: ['sick', 'sickcode'], slaughtered_at: ['datetime', 'slaughteredat', 'dateandtime'],
};

function headerIndexes(row: unknown[], headers: Record<string, string[]>): Record<string, number> | null {
  const normalized = row.map(normal);
  const indexes: Record<string, number> = {};
  for (const [field, names] of Object.entries(headers)) {
    const index = normalized.findIndex((value) => names.includes(value));
    if (index < 0 && ['serial_number', 'warm_mass_kg', 'cold_mass_kg'].includes(field)) return null;
    if (index >= 0) indexes[field] = index;
  }
  return indexes;
}

/** Reads verified legacy XLS and OOXML XLSX workbooks on the server. */
export async function parseIndividualKillSheet(buffer: Buffer): Promise<ParsedKillSheet> {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  const result: ParsedKillSheet = { records: [], issues: [], metadata: {}, expected: {} };
  const serials = new Set<string>();
  for (const sheet of Object.values(book.Sheets)) {
    let headers: Record<string, number> | null = null;
    for (const [index, row] of rowsOf(sheet).entries()) {
      const number = index + 1;
      const firstCell = raw(row[0]).toLowerCase();
      if (!headers) { headers = headerIndexes(row, individualHeaders); if (headers) continue; }
      if (!headers || empty(row)) continue;
      if (headerIndexes(row, individualHeaders)) continue;
      if (/batch\s*total|sick\s*codes?|sign\s*of|^\s*(printed|date)\s*:|page\s+\d|report\s*(id|identifier)/i.test(row.map(raw).join(' '))) {
        const text = row.map(raw).join(' ');
        if (/batch\s*total/i.test(text)) {
          // The source footer begins with its label then count, warm mass and
          // cold mass; unlike an animal row, it does not keep header columns.
          const totals = row.slice(1).map(decimal).filter((value): value is string => value != null);
          result.expected.animal_count ??= totals[0] ?? decimal(first(row, 'animalcount', 'qty', 'quantity')) ?? undefined;
          result.expected.warm_mass_kg ??= totals[1] ?? decimal(first(row, 'warmmass')) ?? undefined;
          result.expected.cold_mass_kg ??= totals[2] ?? decimal(first(row, 'coldmass3', 'coldmass')) ?? undefined;
        }
        continue;
      }
      const get = (field: string) => headers![field] == null ? undefined : row[headers![field]];
      const serial = raw(get('serial_number'));
      const warm = decimal(get('warm_mass_kg')); const cold = decimal(get('cold_mass_kg'));
      // A non-data row after a data section is metadata, not a silently discarded animal.
      if (!serial && !warm && !cold) continue;
      if (!serial || !warm || !cold) { result.issues.push({ row: number, severity: 'ERROR', message: 'SN, Warm Mass and Cold Mass 3% are required for a carcass record.' }); continue; }
      if (serials.has(serial)) result.issues.push({ row: number, field: 'SN', severity: 'ERROR', message: `Duplicate source serial number ${serial}.` });
      serials.add(serial);
      const killedAt = dateTime(get('slaughtered_at'));
      if (get('slaughtered_at') && !killedAt) result.issues.push({ row: number, field: 'Date/Time', severity: 'WARNING', message: 'Date/Time could not be parsed and will be stored as null.' });
      result.records.push({ serial_number: serial, ear_tag: raw(get('ear_tag')) || null, grade: raw(get('grade')) || null, warm_mass_kg: warm, cold_mass_kg: cold, sex: raw(get('sex')) || null, fat_mm: decimal(get('fat_mm')), meat_mm: decimal(get('meat_mm')), meat_percentage: decimal(get('meat_percentage')), sick_code: raw(get('sick_code')) || null, slaughtered_at: killedAt });
    }
  }
  if (!result.records.length && !result.issues.some((issue) => issue.severity === 'ERROR')) result.issues.push({ severity: 'ERROR', message: 'No individual carcass rows were found.' });
  return result;
}

const summaryHeaders = { product_code: ['product'], description: ['description'], quantity: ['qty', 'quantity'], warm_mass_kg: ['warmmass'], cold_mass_kg: ['ccm'], average_mass_kg: ['avgmass'], reported_price: ['price'], reported_value: ['value'] };
export async function parseProductSummary(buffer: Buffer): Promise<ParsedProductSummary> {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  const result: ParsedProductSummary = { records: [], issues: [], metadata: {}, expected: {} };
  for (const sheet of Object.values(book.Sheets)) {
    let headers: Record<string, number> | null = null; let category: string | null = null;
    for (const [index, row] of rowsOf(sheet).entries()) {
      const number = index + 1; const joined = row.map(raw).join(' ').trim();
      if (!headers) { headers = headerIndexes(row, summaryHeaders); if (headers) continue; if (joined) result.metadata[`row_${number}`] = joined; continue; }
      if (empty(row) || headerIndexes(row, summaryHeaders)) continue;
      if (/^\s*printed\s*:/i.test(joined)) { result.metadata[`printed_${number}`] = joined; continue; }
      if (/^(grand\s*)?total\b/i.test(joined)) {
        if (/grand\s*total/i.test(joined)) {
          // Totals omit product/description, shifting numeric cells one or two columns left in the source report.
          const numeric = row.slice((headers.product_code ?? 0) + 1).map(decimal).filter((v): v is string => v != null);
          result.expected.quantity = numeric[0] ?? decimal(row[headers.quantity]) ?? undefined;
          result.expected.warm_mass_kg = numeric[1] ?? decimal(row[headers.warm_mass_kg]) ?? undefined;
          result.expected.cold_mass_kg = numeric[2] ?? decimal(row[headers.cold_mass_kg]) ?? undefined;
          result.expected.value = numeric.at(-1) ?? decimal(row[headers.reported_value]) ?? undefined;
        }
        continue;
      }
      const code = raw(row[headers.product_code]); const description = raw(row[headers.description]);
      const populated = row.map(raw).filter(Boolean);
      if ((!description && populated.length === 1 && code) || (!code && !description && joined)) { category = joined; continue; }
      // Category subtotal layouts begin with Qty rather than a code and shift each numeric fact left.
      if (!/[a-z]/i.test(code) || !/[a-z]/i.test(description)) continue;
      // Product code is deliberately required: subtotal layouts have no code and must never become products.
      if (!/^[A-Z0-9][A-Z0-9._/-]*$/i.test(code) || !description) { result.issues.push({ row: number, severity: 'WARNING', message: 'Skipped non-product report row.' }); continue; }
      result.records.push({ category, product_code: code, description, quantity: decimal(row[headers.quantity]), warm_mass_kg: decimal(row[headers.warm_mass_kg]), cold_mass_kg: decimal(row[headers.cold_mass_kg]), average_mass_kg: decimal(row[headers.average_mass_kg]), reported_price: decimal(row[headers.reported_price]), reported_value: decimal(row[headers.reported_value]) });
    }
  }
  if (!result.records.length) result.issues.push({ severity: 'ERROR', message: 'No product detail rows were found.' });
  return result;
}
