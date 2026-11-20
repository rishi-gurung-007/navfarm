import { api } from "@/services/api-client";
import { getActiveWorkspaceScope, getActiveOperationalArea } from "@/hooks/useAuth";
import type { MasterDataConfig, MasterDataField } from "../types";
import { parentKeys, resolveEndpoint, isFieldRequired, isFieldVisible } from "../field-logic";

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

  // Breed Lifecycle Stage (14 Oct): a stage's feed lives in its Feed Consumption lines, so the export writes one row
  // per line — the line's days replace the stage's, and its feed columns follow — in the shape the import reads back
  // (rows of one stage with following days become one stage with several lines again).
  const feedLineExport = config.key === "breed-lifecycle-stage";
  let feedItemCode: (id: unknown) => string = (id) => String(id ?? "");
  if (feedLineExport) {
    headerLabels.push("Feed", "Feed Form", "Daily Feed per Head", "Feed UOM", "Feed Wastage (%)");
    try {
      const list = unwrap<Row[]>(await api.get("/item?itemType=FEED&limit=1000"));
      const byId = new Map((Array.isArray(list) ? list : []).map((it) => [String(it.item_id), String(it.item_code ?? it.item_name ?? "")]));
      feedItemCode = (id) => byId.get(String(id)) ?? String(id ?? "");
    } catch { /* ids stay as they are */ }
  }

  const csvRows: string[] = [];
  // Row 1: Human-readable header labels
  csvRows.push(headerLabels.map(escapeCsvCell).join(","));

  for (const r of rows) {
    const lines: Row[] = feedLineExport && Array.isArray(r.feed_lines) && r.feed_lines.length ? r.feed_lines : [null as unknown as Row];
    for (const line of lines) {
      const source = line ? { ...r, period_from: line.period_from, period_to: line.period_to } : r;
      const lineCells = exportFields.map((f: MasterDataField) => {
        const rawVal = source[f.key];
        const resolved = resolveExportCellValue(f, rawVal, source, lookupMap);
        return escapeCsvCell(resolved);
      });
      if (feedLineExport) {
        lineCells.push(...(line
          ? [feedItemCode(line.feed_item_id), line.feed_form ?? "", line.feed_qty_per_head_per_day_kg ?? "", line.feed_qty_uom ?? "KG", line.feed_wastage_pct ?? ""]
          : ["", "", "", "", ""]).map((v) => escapeCsvCell(String(v))));
      }
      csvRows.push(lineCells.join(","));
    }
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
      "feed_form",
      "feed_qty_per_head_per_day_kg",
      "feed_qty_uom",
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

    // Each row must carry one value per header above — feed_form and feed_qty_uom were
    // missing here (19 Nov), silently shifting every field after feed_item_code by two
    // columns (e.g. Feed Wastage % received the Std ADG value instead).
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
      "", // feed_form
      "2.50", // feed_qty_per_head_per_day_kg
      "", // feed_qty_uom
      "5.00", // feed_wastage_pct
      "45.00", // std_body_weight_kg
      "800.00", // std_adg_gpd
      "2.40", // std_fcr
      "0.50", // std_mortality_rate_pct
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
      "", // feed_form
      "3.00", // feed_qty_per_head_per_day_kg
      "", // feed_qty_uom
      "5.00", // feed_wastage_pct
      "180.00", // std_body_weight_kg
      "0.00", // std_adg_gpd
      "0.00", // std_fcr
      "1.00", // std_mortality_rate_pct
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
  // A select-entity or static-select field needs a real code/name to resolve against, not a
  // placeholder string that would just fail as "not found" — leave those blank rather than guess.
  const sample = fields.map((f: MasterDataField) =>
    f.type === "select-entity" || f.type === "select"
      ? ""
      : f.placeholder
        ? f.placeholder
        : f.type === "number"
          ? "10"
          : f.type === "boolean"
            ? "false"
            : "Sample",
  );
  return [headers.join(","), sample.join(",")].join("\r\n");
}

/**
 * Breed Lifecycle Stage import (14 Oct): the export writes a stage with several Feed Consumption lines as several rows
 * with one code. Rows sharing a code become one stage carrying all their feed lines (in file order); rows without a
 * code, or without a feed line, stay as they are.
 */
export function mergeLifecycleFeedRows<T extends { lifecycle_code?: unknown; feed_lines?: unknown[] }>(items: T[]): T[] {
  const byCode = new Map<string, T>();
  const merged: T[] = [];
  for (const item of items) {
    const code = String(item.lifecycle_code ?? "").trim();
    const first = code ? byCode.get(code) : undefined;
    if (first && Array.isArray(item.feed_lines)) {
      first.feed_lines = [...(first.feed_lines ?? []), ...item.feed_lines];
      continue;
    }
    const copy = { ...item, ...(Array.isArray(item.feed_lines) ? { feed_lines: [...item.feed_lines] } : {}) } as T;
    if (code) byCode.set(code, copy);
    merged.push(copy);
  }
  return merged;
}

// ── Generic CSV import (19 Nov) ─────────────────────────────────────────────────────────────
//
// Breed and Breed Lifecycle Stage have their own hand-written import logic above (each master's
// foreign keys and cross-field rules are particular enough to earn that). Every other master's
// fields are declared plainly enough in its MasterDataConfig that one metadata-driven reader can
// parse a CSV row for any of them — reusing the exact field-visibility/required/FK-endpoint rules
// the live create form already enforces (field-logic.ts), so a spreadsheet row is held to the same
// standard as one typed into the dialog.

function normalizeKey(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Reads one field's value off a parsed CSV row, trying its key, its label, then a loose
 * (punctuation/case/space insensitive) match of either — so a file keyed by `breed_code` and one
 * headed "Code" both resolve the same field. */
export function getRawValue(
  raw: Record<string, string>,
  fieldKey: string,
  fieldLabel?: string,
  aliases?: string[],
): string | undefined {
  if (!raw) return undefined;

  if (raw[fieldKey] !== undefined && raw[fieldKey] !== "") return raw[fieldKey].trim();
  if (fieldLabel && raw[fieldLabel] !== undefined && raw[fieldLabel] !== "") return raw[fieldLabel].trim();
  if (aliases && aliases.length > 0) {
    for (const a of aliases) {
      if (raw[a] !== undefined && raw[a] !== "") return raw[a].trim();
    }
  }

  const normKey = normalizeKey(fieldKey);
  const normLabel = fieldLabel ? normalizeKey(fieldLabel) : "";
  const normAliases = (aliases || []).map(normalizeKey);
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === "") continue;
    const nk = normalizeKey(k);
    if (nk === normKey || (normLabel && nk === normLabel) || normAliases.includes(nk)) {
      return v.trim();
    }
  }
  return undefined;
}

/** Field types the generic reader does not attempt: a nested row editor, a map/point picker, or
 * a JSON array have no sane single-cell CSV representation. A master built entirely from plainer
 * fields (text/number/boolean/date/select/select-entity/string-list/image) is eligible — "image"
 * is a plain URL column once it's saved (see `ear_tag_image_url` in Animal Register's DTO), so the
 * CSV just carries that URL like any other text field. */
const GENERIC_IMPORT_UNSUPPORTED_TYPES = new Set<MasterDataField["type"]>([
  "json",
  "field-list",
  "map",
  "latlng",
]);

/** Fields the live create form actually asks for: not a UI-only filter control, not something the
 * API computes itself, not excluded from the create form, and not edit-only. */
function createFormFields(config: MasterDataConfig): MasterDataField[] {
  return config.fields.filter(
    (f) => !f.filterOnly && !f.readOnly && !f.hideInForm && !f.editOnly,
  );
}

/** Whether this master can use the generic CSV reader at all — Breed and Breed Lifecycle Stage
 * are excluded because they already have their own; a BC-owned catalog and Number Series are
 * excluded because neither accepts a plain create the way every other master does. Otherwise a
 * master is only disqualified by a *required* field of an unsupported type — an optional one
 * (ear_tag_image_url) is simply left out of the CSV, same as any other skippable field. */
export function supportsGenericImport(config: MasterDataConfig): boolean {
  if (config.key === "breed" || config.key === "breed-lifecycle-stage") return false;
  if (config.owner === "BC") return false;
  if (config.key === "number-series" || config.key === "no-series") return false;
  return createFormFields(config).every(
    (f) => !f.required || !GENERIC_IMPORT_UNSUPPORTED_TYPES.has(f.type),
  );
}

/** The real, importable fields of a master: createFormFields, further narrowed to what the
 * generic reader can actually represent in one CSV cell, and — when the workspace is scoped to
 * an operational area — without nob_id/lob_id, which the live form also hides there and fills
 * from the active area instead of asking for (see MasterDataTable.tsx). */
function genericImportFields(config: MasterDataConfig): MasterDataField[] {
  const operational = getActiveWorkspaceScope() === "OPERATIONAL";
  return createFormFields(config).filter(
    (f) =>
      !GENERIC_IMPORT_UNSUPPORTED_TYPES.has(f.type) &&
      !(operational && (f.key === "nob_id" || f.key === "lob_id")),
  );
}

async function fetchAndCacheOptions(ep: string, cache: Record<string, Row[]>): Promise<Row[]> {
  if (cache[ep]) return cache[ep];
  try {
    const sep = ep.includes("?") ? "&" : "?";
    const res = await api.get(`${ep}${sep}limit=1000`);
    const list = unwrap<Row[]>(res) || [];
    cache[ep] = list;
    return list;
  } catch {
    cache[ep] = [];
    return [];
  }
}

/** Pre-fetches every select-entity field's option list that does not depend on another field's
 * value, so most FK lookups during parsing are a cache hit rather than a request per row. */
export async function prefetchGenericEntityOptions(config: MasterDataConfig): Promise<Record<string, Row[]>> {
  const cache: Record<string, Row[]> = {};
  const independent = genericImportFields(config).filter(
    (f) => f.type === "select-entity" && f.entityEndpoint && parentKeys(f).length === 0,
  );
  await Promise.all(independent.map((f) => fetchAndCacheOptions(f.entityEndpoint!, cache)));
  return cache;
}

function matchEntityOption(list: Row[], rawValue: string, f: MasterDataField): Row | undefined {
  const valueKey = f.entityValueKey || "id";
  const needle = rawValue.trim();
  const needleUpper = needle.toUpperCase();
  const labelKeys = f.entityLabelKeys?.length ? f.entityLabelKeys : [valueKey];
  return list.find(
    (row) =>
      String(row[valueKey]) === needle ||
      labelKeys.some((lk) => row[lk] != null && String(row[lk]).toUpperCase() === needleUpper),
  );
}

const GENERIC_BOOLEAN_TRUE = new Set(["1", "true", "yes", "y"]);
const GENERIC_BOOLEAN_FALSE = new Set(["0", "false", "no", "n"]);

/**
 * Parses one CSV row into a create payload for any master not using its own hand-written logic
 * (Breed, Breed Lifecycle Stage). `entityCache` is shared across the whole file's rows — pass the
 * result of `prefetchGenericEntityOptions` and the same object back in on every call so a
 * dependent field's lookup (fetched lazily, per distinct parent value) is cached too.
 */
export async function parseGenericImportRow(
  config: MasterDataConfig,
  raw: Record<string, string>,
  entityCache: Record<string, Row[]>,
): Promise<{ payload: Row; errors: string[] }> {
  const payload: Row = {};
  const errors: string[] = [];
  const fields = genericImportFields(config);

  for (const f of fields) {
    const rawVal = getRawValue(raw, f.key, f.label);
    if (rawVal === undefined || rawVal === "") continue;

    switch (f.type) {
      case "boolean": {
        const norm = rawVal.trim().toLowerCase();
        if (GENERIC_BOOLEAN_TRUE.has(norm)) payload[f.key] = true;
        else if (GENERIC_BOOLEAN_FALSE.has(norm)) payload[f.key] = false;
        else errors.push(`${f.label} must be true/false, yes/no, or 1/0 (got '${rawVal}').`);
        break;
      }
      case "number": {
        const num = Number(rawVal);
        if (isNaN(num)) {
          errors.push(`${f.label} must be a number (got '${rawVal}').`);
        } else if (f.min !== undefined && num < f.min) {
          errors.push(`${f.label} must be ${f.min} or more.`);
        } else if (f.max !== undefined && num > f.max) {
          errors.push(`${f.label} must be ${f.max} or less.`);
        } else {
          payload[f.key] = num;
        }
        break;
      }
      case "select": {
        const norm = rawVal.trim().toUpperCase();
        const opt = (f.options || []).find(
          (o) => o.value.toUpperCase() === norm || o.label.toUpperCase() === norm,
        );
        if (opt) payload[f.key] = opt.value;
        else
          errors.push(
            `${f.label} '${rawVal}' is invalid. Allowed: ${(f.options || []).map((o) => o.value).join(", ")}`,
          );
        break;
      }
      case "select-entity": {
        if (!f.entityEndpoint) break;
        // Resolved against the payload built so far this row — a dependent field (dependsOn) needs
        // its parent's resolved id, which is why field order in the config matters here the same
        // way it does for the live form (the parent is declared, and so parsed, first).
        const ep = resolveEndpoint(f, payload);
        if (!ep) break; // parent not resolved yet; the required-field pass below will catch it if that matters
        const list = await fetchAndCacheOptions(ep, entityCache);
        const match = matchEntityOption(list, rawVal, f);
        if (match) payload[f.key] = match[f.entityValueKey || "id"];
        else errors.push(`${f.label} '${rawVal}' was not found.`);
        break;
      }
      case "string-list":
        payload[f.key] = rawVal
          .split(/[;|]/)
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      default:
        payload[f.key] = rawVal;
    }
  }

  // Drop values for fields that turned out not to apply, and flag anything still missing that
  // the form would also have required — both read off the payload resolved so far, same as the
  // live form reads off its own live `form` state.
  for (const f of fields) {
    if (!isFieldVisible(f, payload)) {
      delete payload[f.key];
      continue;
    }
    const v = payload[f.key];
    const isEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    if (isEmpty && isFieldRequired(f, payload)) {
      errors.push(`${f.label} is required.`);
    }
  }

  // Mirrors MasterDataTable.tsx's own save-time fill: in an operational workspace the live form
  // hides nob_id/lob_id and sets them from the active area instead of asking for them, so a CSV
  // import does the same — overwriting any same-named column the row happened to carry.
  if (getActiveWorkspaceScope() === "OPERATIONAL") {
    const activeArea = getActiveOperationalArea();
    if (activeArea) {
      if (config.fields.some((f) => f.key === "nob_id") && activeArea.nob_id) {
        payload.nob_id = activeArea.nob_id;
      }
      if (config.fields.some((f) => f.key === "lob_id") && activeArea.lob_id) {
        payload.lob_id = activeArea.lob_id;
      }
    }
  }

  return { payload, errors };
}
