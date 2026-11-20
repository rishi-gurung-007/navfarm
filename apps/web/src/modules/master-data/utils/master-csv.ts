import { api } from "@/services/api-client";
import { getActiveWorkspaceScope, getActiveOperationalArea } from "@/hooks/useAuth";
import type { MasterDataConfig, MasterDataField } from "../types";
import { parentKeys, resolveEndpoint, isFieldRequired, isFieldVisible } from "../field-logic";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

/** Mirrors MasterDataTable.tsx's own save-time fill: in an operational workspace the live form
 * hides nob_id/lob_id and sets them from the active area instead of asking for them, so any CSV
 * import path does the same — overwriting any same-named column the row happened to carry.
 * Shared by the generic reader and Breed Lifecycle Stage's own bespoke one. */
export function applyOperationalNobLob(
  payload: Row,
  configFields: Pick<MasterDataField, "key">[],
): void {
  if (getActiveWorkspaceScope() !== "OPERATIONAL") return;
  const activeArea = getActiveOperationalArea();
  if (!activeArea) return;
  if (configFields.some((f) => f.key === "nob_id") && activeArea.nob_id) {
    payload.nob_id = activeArea.nob_id;
  }
  if (configFields.some((f) => f.key === "lob_id") && activeArea.lob_id) {
    payload.lob_id = activeArea.lob_id;
  }
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

/**
 * Resolves a field value for export: translates internal UUIDs to natural business codes where available.
 */
function resolveExportCellValue(
  f: MasterDataField,
  val: any,
  lookupMap?: Record<string, Row[]>
): string {
  if (val === null || val === undefined) return "";

  // For select-entity fields, resolve against the base-endpoint bucket exportMasterRowsToCsv
  // fetched by id (see there) — the same key regardless of path-mode vs query-mode dependsOn.
  if (f.type === "select-entity" && lookupMap && f.entityEndpoint) {
    const baseEp = f.entityEndpoint.split("?")[0].split("/{")[0];
    const targetList = lookupMap[baseEp];

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
  // Export reflects the edit form, not the list table: a field the form never shows
  // (hideInForm — company_id, a computed bio-asset figure) has no business in the sheet even if
  // it happens to render as a table column, and a filterOnly control isn't a stored column at
  // all. A read-only or edit-only field stays — the form still shows it, just not editable there.
  const exportFields = config.fields.filter(
    (f: MasterDataField) => f.type !== "json" && !f.filterOnly && !f.hideInForm
  );

  // Build a lookup map of base endpoint -> Row[] — keyed by entityEndpoint with any query string
  // or "{value}" placeholder stripped, since resolution below is by record id, not by list page.
  const lookupMap: Record<string, Row[]> = { ...(entityOptions || {}) };

  // Fetching "the first 500 of the collection" silently mis-resolved any field whose true value
  // wasn't in that page — exactly the "shows a UUID instead of the code" bug (a GRN past the
  // 500th by default ordering). Fetching the specific records these rows actually reference,
  // by id, is correct regardless of collection size or how the field depends on another one.
  const selectEntityFields = exportFields.filter(
    (f: MasterDataField) => f.type === "select-entity" && f.entityEndpoint
  );

  for (const f of selectEntityFields) {
    const baseEp = f.entityEndpoint!.split("?")[0].split("/{")[0];
    const valueKey = f.entityValueKey || "id";
    const existing = lookupMap[baseEp] || [];
    const haveIds = new Set(existing.map((r) => String(r[valueKey])));
    const neededIds = Array.from(
      new Set(rows.map((r) => r[f.key]).filter(Boolean).map(String)),
    ).filter((id) => !haveIds.has(id));

    if (neededIds.length) {
      const fetched = await Promise.allSettled(
        neededIds.map((id) => api.get(`${baseEp}/${id}`)),
      );
      const newRows = fetched
        .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
        .map((r) => unwrap<Row>(r.value))
        .filter((row): row is Row => !!row && typeof row === "object");
      lookupMap[baseEp] = [...existing, ...newRows];
    } else if (!lookupMap[baseEp]) {
      lookupMap[baseEp] = [];
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
        const resolved = resolveExportCellValue(f, rawVal, lookupMap);
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

/** A select-entity column is matched against another master's code, not typed freely — the
 * header says so, so the sheet doesn't read like a place to describe the record instead. */
function templateHeaderFor(f: MasterDataField): string {
  return f.type === "select-entity" ? `${f.label} Code` : f.label;
}

/**
 * What the import preview's Code column (and the success/error messaging around it) should show
 * for one staged row — driven by `config.codeField` instead of a master-by-master hardcoded
 * chain, so every generically-imported master gets a real Code column, not just Breed and Breed
 * Lifecycle Stage (the two that used to have their display wired by hand).
 *
 * "uploaded" wins over everything else — the row carries the code it will actually be created
 * with. "invalid" is for a code typed in the sheet that a validation error then dropped from the
 * payload (so it never reached "uploaded"), surfaced so the row doesn't read as blank when
 * something was clearly attempted. "generated" only applies once there is truly nothing to show
 * and the backend would mint one itself; otherwise "none" — nothing uploaded, nothing invalid,
 * nothing to generate.
 */
export function resolveImportCodeDisplay(
  config: MasterDataConfig,
  row: { payload: Record<string, any>; raw: Record<string, string>; errors: string[] },
): { text: string; provenance: "uploaded" | "generated" | "invalid" | "none" } {
  const codeField = config.codeField;
  if (!codeField) return { text: "", provenance: "none" };

  const uploaded = row.payload[codeField];
  if (uploaded !== undefined && uploaded !== null && String(uploaded).trim() !== "") {
    return { text: String(uploaded), provenance: "uploaded" };
  }

  const field = config.fields.find((f) => f.key === codeField);
  const rawAttempt = getRawValue(row.raw, codeField, field?.label, field?.aliases);
  if (rawAttempt && row.errors.some((e) => e.includes(rawAttempt))) {
    return { text: rawAttempt, provenance: "invalid" };
  }

  if (config.codeFieldGenerated) {
    return { text: "Will be generated on import", provenance: "generated" };
  }

  return { text: "", provenance: "none" };
}

/** One real, fillable-looking example per field: every value the valid `select` list holds (so
 * the sheet doubles as its own legend), or the first real row an independent `select-entity`
 * fetched (a dependent one, e.g. Current Stage under Breed, isn't pre-fetched — left blank, same
 * as today). Looks up a label the same way `matchEntityOption` matches one back, so a cell left
 * untouched round-trips on import. */
function templateSampleFor(f: MasterDataField, cache: Record<string, Row[]>): string {
  if (f.type === "select") {
    return (f.options || []).map((o) => o.value).join(" / ");
  }
  if (f.type === "select-entity") {
    if (!f.entityEndpoint) return "";
    const first = (cache[f.entityEndpoint] || [])[0];
    if (!first) return "";
    const valueKey = f.entityValueKey || "id";
    const labelKeys = f.entityLabelKeys?.length ? f.entityLabelKeys : [valueKey];
    for (const lk of labelKeys) {
      if (first[lk] !== undefined && first[lk] !== null && String(first[lk]).trim() !== "") {
        return String(first[lk]);
      }
    }
    return String(first[valueKey] ?? "");
  }
  if (f.placeholder) return f.placeholder;
  if (f.type === "number") return "10";
  if (f.type === "boolean") return "false";
  return "Sample";
}

/**
 * Generates an official CSV template with field headers, constraints description, and sample rows.
 */
export async function generateMasterTemplateCsv(config: MasterDataConfig): Promise<string> {
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

  // Generic fallback for any other master — the same field list genericImportFields reads from,
  // so the template can never ask for a column import would then ignore or reject.
  const fields = genericImportFields(config);
  const headers = fields.map(templateHeaderFor).map(escapeCsvCell);
  const cache = await prefetchGenericEntityOptions(config);
  const sample = fields.map((f) => escapeCsvCell(templateSampleFor(f, cache)));
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
    (f) => !f.filterOnly && (!f.readOnly || f.importable) && !f.hideInForm && !f.editOnly,
  );
}

/** Whether this master can use the generic CSV reader at all — Breed and Breed Lifecycle Stage
 * are excluded because they already have their own; a BC-owned catalog and Number Series are
 * excluded because neither accepts a plain create the way every other master does. Otherwise a
 * master is only disqualified by a *required* field of an unsupported type — an optional one
 * (ear_tag_image_url) is simply left out of the CSV, same as any other skippable field. */
export function supportsGenericImport(config: MasterDataConfig): boolean {
  // Breed Lifecycle Stage keeps its own importer: several CSV rows (one per feed-consumption
  // line) merge into one stage, which the generic one-row-one-record reader can't express. Breed
  // itself has no such need — one row per breed is exactly what the generic path already handles.
  if (config.key === "breed-lifecycle-stage") return false;
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
    // A select-entity column is headed "<label> Code" in the downloaded template
    // (templateHeaderFor) — accepted here as an alias so a row filled in under that exact
    // header, not just one keyed by f.key/f.label, still resolves.
    const rawVal = getRawValue(
      raw,
      f.key,
      f.label,
      [
        ...(f.type === "select-entity" ? [templateHeaderFor(f)] : []),
        ...(f.aliases ?? []),
      ],
    );
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

  applyOperationalNobLob(payload, config.fields);

  return { payload, errors };
}
