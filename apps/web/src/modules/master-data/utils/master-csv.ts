import { api } from "@/services/api-client";
import type { MasterDataConfig, MasterDataField } from "../types";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

/**
 * Escapes a cell value according to RFC 4180.
 * Wraps in quotes if the string contains a comma, double-quote, or newline.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Triggers a client-side download of a CSV file.
 */
export function downloadCsvFile(filename: string, csvContent: string): void {
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Parses raw CSV string into rows of key-value pairs based on header row.
 * Correctly handles RFC 4180 quoted cells with commas, newlines, and escaped quotes.
 */
export function parseCsvText(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = csvText.replace(/^\uFEFF/, "").trim();
  if (!clean) return { headers: [], rows: [] };

  // Detect delimiter (\t or ,) by inspecting the first line
  const firstLineEnd = clean.search(/[\r\n]/);
  const firstLine = firstLineEnd !== -1 ? clean.slice(0, firstLineEnd) : clean;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  const parsedLines: string[][] = [];
  let currentLine: string[] = [];
  let currentField = "";
  let insideQuotes = false;
  let i = 0;

  while (i < clean.length) {
    const char = clean[i];

    if (insideQuotes) {
      if (char === '"') {
        if (i + 1 < clean.length && clean[i + 1] === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        currentLine.push(currentField.trim());
        currentField = "";
        i++;
        continue;
      } else if (char === "\r") {
        if (i + 1 < clean.length && clean[i + 1] === "\n") i++;
        currentLine.push(currentField.trim());
        parsedLines.push(currentLine);
        currentLine = [];
        currentField = "";
        i++;
        continue;
      } else if (char === "\n") {
        currentLine.push(currentField.trim());
        parsedLines.push(currentLine);
        currentLine = [];
        currentField = "";
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    parsedLines.push(currentLine);
  }

  if (parsedLines.length === 0) return { headers: [], rows: [] };

  // Filter out any purely empty lines
  const nonEmptyLines = parsedLines.filter((line) => line.some((cell) => cell.length > 0));
  if (nonEmptyLines.length === 0) return { headers: [], rows: [] };

  const rawHeaders = nonEmptyLines[0].map((h) => h.trim());
  const headerCounts: Record<string, number> = {};
  const indexedHeaders: string[] = [];

  for (const h of rawHeaders) {
    headerCounts[h] = (headerCounts[h] || 0) + 1;
    if (headerCounts[h] === 1) {
      indexedHeaders.push(h);
    } else {
      indexedHeaders.push(`${h}_${headerCounts[h]}`);
    }
  }

  const rows: Record<string, string>[] = [];

  for (let r = 1; r < nonEmptyLines.length; r++) {
    const line = nonEmptyLines[r];
    // Skip comment lines or sample guidance rows if marked with '#'
    if (line[0]?.startsWith("#")) continue;

    const rowObj: Record<string, string> = {};
    for (let c = 0; c < rawHeaders.length; c++) {
      const rawHeader = rawHeaders[c];
      const indexedHeader = indexedHeaders[c];
      const val = line[c] !== undefined ? line[c].trim() : "";
      if (rawHeader) {
        // First occurrence preserves the un-suffixed key
        if (rowObj[rawHeader] === undefined) {
          rowObj[rawHeader] = val;
        }
        // Always store under indexed key
        rowObj[indexedHeader] = val;

        // Disambiguate duplicate "Productive Life (months)"
        if (rawHeader.toLowerCase().includes("productive life") && indexedHeader.endsWith("_2")) {
          rowObj["boar_productive_life_months"] = val;
          rowObj["Boar Productive Life (months)"] = val;
        }
      }
    }
    // Only push if at least one cell has content
    if (Object.values(rowObj).some((v) => v.length > 0)) {
      rows.push(rowObj);
    }
  }

  return { headers: rawHeaders, rows };
}

function parentKey(f: MasterDataField): string | undefined {
  if (!f.dependsOn) return undefined;
  return Array.isArray(f.dependsOn) ? f.dependsOn[0] : f.dependsOn;
}

/**
 * Resolves a field value for export: translates internal UUIDs to natural business codes where available.
 */
function resolveExportCellValue(
  f: MasterDataField,
  val: any,
  row: Row,
  lookupMap?: Record<string, Row[]>
): string {
  if (val === null || val === undefined) return "";

  // For select-entity fields, resolve ONLY against this field's entity endpoint
  if (f.type === "select-entity" && lookupMap && f.entityEndpoint) {
    let targetList: Row[] | undefined;

    const pKey = parentKey(f);
    if (pKey && row[pKey]) {
      const ep = f.entityEndpoint.replace("{value}", String(row[pKey]));
      targetList = lookupMap[ep];
    }

    if (!targetList) {
      targetList = lookupMap[f.entityEndpoint];
    }

    if (!targetList) {
      const base = f.entityEndpoint.split("?")[0].split("/{")[0];
      const entry = Object.entries(lookupMap).find(([k]) => k.startsWith(base));
      if (entry) targetList = entry[1];
    }

    if (targetList && Array.isArray(targetList)) {
      const valueKey = f.entityValueKey || "id";
      const match = targetList.find(
        (item) => String(item[valueKey]) === String(val)
      );
      if (match) {
        // Look up using declared entityLabelKeys first (e.g. lob_code, lob_name, breed_code, etc.)
        if (f.entityLabelKeys && f.entityLabelKeys.length > 0) {
          for (const lk of f.entityLabelKeys) {
            if (match[lk] !== undefined && match[lk] !== null && String(match[lk]).trim() !== "") {
              return String(match[lk]);
            }
          }
        }
        return String(match.code || match.name || val);
      }
    }
    // If not matched, do NOT search unrelated endpoints; return val as-is
    return String(val);
  }

  if (typeof val === "object") {
    return JSON.stringify(val);
  }
  return String(val);
}

/**
 * Exports master rows to CSV.
 */
export async function exportMasterRowsToCsv(
  config: MasterDataConfig,
  rows: Row[],
  entityOptions?: Record<string, Row[]>
): Promise<void> {
  // Select fields to export: non-json, non-hidden unless identifier
  const exportFields = config.fields.filter(
    (f: MasterDataField) =>
      f.type !== "json" &&
      !f.hideInTable &&
      f.key !== "company_id" &&
      f.key !== "created_at" &&
      f.key !== "updated_at" &&
      f.key !== "deleted_at"
  );

  // Build a lookup map of endpoint -> Row[]
  const lookupMap: Record<string, Row[]> = { ...(entityOptions || {}) };

  // Pre-fetch any entity endpoints needed for exportFields that are missing
  const selectEntityFields = exportFields.filter(
    (f: MasterDataField) => f.type === "select-entity" && f.entityEndpoint
  );

  for (const f of selectEntityFields) {
    const pKey = parentKey(f);
    if (pKey) {
      // Find distinct parent values across rows
      const parentVals = Array.from(new Set(rows.map((r) => r[pKey]).filter(Boolean)));
      for (const pVal of parentVals) {
        const ep = f.entityEndpoint!.replace("{value}", String(pVal));
        if (!lookupMap[ep]) {
          try {
            const res = await api.get(`${ep}${ep.includes("?") ? "&" : "?"}limit=500`);
            const list = unwrap<Row[]>(res);
            if (Array.isArray(list)) lookupMap[ep] = list;
          } catch {
            lookupMap[ep] = [];
          }
        }
      }
    } else {
      const ep = f.entityEndpoint!;
      if (!lookupMap[ep]) {
        try {
          const res = await api.get(`${ep}${ep.includes("?") ? "&" : "?"}limit=500`);
          const list = unwrap<Row[]>(res);
          if (Array.isArray(list)) lookupMap[ep] = list;
        } catch {
          lookupMap[ep] = [];
        }
      }
    }
  }

  const seenLabels: Record<string, number> = {};
  const headerLabels = exportFields.map((f: MasterDataField) => {
    let lbl = f.label || f.key;
    seenLabels[lbl] = (seenLabels[lbl] || 0) + 1;
    if (seenLabels[lbl] > 1) {
      lbl = `${lbl} (${f.key})`;
    }
    return lbl;
  });

  const csvRows: string[] = [];
  // Row 1: Human-readable header labels
  csvRows.push(headerLabels.map(escapeCsvCell).join(","));

  for (const r of rows) {
    const lineCells = exportFields.map((f: MasterDataField) => {
      const rawVal = r[f.key];
      const resolved = resolveExportCellValue(f, rawVal, r, lookupMap);
      return escapeCsvCell(resolved);
    });
    csvRows.push(lineCells.join(","));
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${config.key}_export_${dateStr}.csv`;
  downloadCsvFile(filename, csvRows.join("\r\n"));
}

/**
 * Generates an official CSV template with field headers, constraints description, and sample rows.
 */
export function generateMasterTemplateCsv(config: MasterDataConfig): string {
  if (config.key === "breed") {
    const headers = [
      "breed_code",
      "breed_name",
      "breed_type",
      "species_code",
      "gestation_days",
      "lactation_days",
      "productive_life_months",
      "residual_value_pct",
      "productive_life_cycles",
      "avg_litter_size_born",
      "avg_litter_size_weaned",
      "avg_weaning_weight_kg",
      "farrowing_rate_pct",
      "boar_doses_per_week",
      "boar_productive_life_months",
      "is_blocked",
    ];

    const sampleRow = [
      "LARGE_WHITE",
      "Large White",
      "MEAT",
      "PIG",
      "114",
      "28",
      "36",
      "10.00",
      "7",
      "11.50",
      "10.00",
      "7.00",
      "85.00",
      "4.00",
      "18",
      "0",
    ];

    const sampleRow2 = [
      "LANDRACE",
      "Landrace",
      "MEAT",
      "PIG",
      "114",
      "28",
      "36",
      "10.00",
      "7",
      "11.00",
      "9.80",
      "7.20",
      "86.00",
      "4.00",
      "18",
      "0",
    ];

    return [headers.join(","), sampleRow.join(","), sampleRow2.join(",")].join("\r\n");
  }

  if (config.key === "breed-lifecycle-stage") {
    const headers = [
      "lifecycle_code",
      "breed_code",
      "stage_code",
      "category",
      "calc_unit",
      "period_from",
      "period_to",
      "std_teats",
      "season_type",
      "feed_item_code",
      "feed_qty_per_head_per_day_kg",
      "feed_wastage_pct",
      "std_body_weight_kg",
      "std_adg_gpd",
      "std_fcr",
      "std_mortality_rate_pct",
      "output_item_code",
      "output_uom",
      "std_output_qty",
      "notes",
    ];

    const sampleRow1 = [
      "YORKSHIRE-GESTATION-001",
      "YORKSHIRE",
      "GESTATION",
      "SOW",
      "DAY",
      "1",
      "116",
      "15",
      "ALL",
      "ICAT-001-ITM-0001",
      "2.50",
      "5.00",
      "45.00",
      "800.00",
      "2.40",
      "0.50",
      "",
      "",
      "",
      "Ensure BCS 3.0-3.5 throughout gestation",
    ];

    const sampleRow2 = [
      "YORKSHIRE-FARROWING-001",
      "YORKSHIRE",
      "FARROWING",
      "SOW",
      "DAY",
      "1",
      "3",
      "15",
      "ALL",
      "ICAT-001-ITM-0001",
      "3.00",
      "5.00",
      "180.00",
      "0.00",
      "0.00",
      "1.00",
      "",
      "",
      "",
      "Supervised farrowing and warmth control",
    ];

    return [headers.join(","), sampleRow1.join(","), sampleRow2.join(",")].join("\r\n");
  }

  // Generic fallback for any other master
  const fields = config.fields.filter(
    (f: MasterDataField) =>
      f.type !== "json" &&
      !f.hideInForm &&
      f.key !== "company_id" &&
      f.key !== "created_at" &&
      f.key !== "updated_at" &&
      f.key !== "deleted_at"
  );
  const headers = fields.map((f: MasterDataField) => f.key);
  const sample = fields.map((f: MasterDataField) => (f.placeholder ? f.placeholder : f.type === "number" ? "10" : "Sample"));
  return [headers.join(","), sample.join(",")].join("\r\n");
}
