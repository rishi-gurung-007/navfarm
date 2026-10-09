"use client";

import { useState, useRef } from "react";
import {
  Upload,
  Download,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { showToast } from "@/components/ui/toast";
import { getActiveCompanyId } from "@/hooks/useAuth";
import type { MasterDataConfig } from "./types";
import {
  parseCsvText,
  downloadCsvFile,
  generateMasterTemplateCsv,
} from "./utils/master-csv";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

function normalizeKey(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getRawValue(
  raw: Record<string, string>,
  fieldKey: string,
  fieldLabel?: string,
  aliases?: string[]
): string | undefined {
  if (!raw) return undefined;

  // 1. Direct key match
  if (raw[fieldKey] !== undefined && raw[fieldKey] !== "") return raw[fieldKey].trim();

  // 2. Direct label match
  if (fieldLabel && raw[fieldLabel] !== undefined && raw[fieldLabel] !== "") return raw[fieldLabel].trim();

  // 3. Direct aliases match
  if (aliases && aliases.length > 0) {
    for (const a of aliases) {
      if (raw[a] !== undefined && raw[a] !== "") return raw[a].trim();
    }
  }

  // 4. Normalized match (strip all punctuation, spaces, parens, symbols, lowercase)
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

interface MasterDataImportModalProps {
  config: MasterDataConfig;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ParsedStagedRow {
  index: number;
  raw: Record<string, string>;
  payload: Record<string, any>;
  isValid: boolean;
  errors: string[];
}

export default function MasterDataImportModal({
  config,
  isOpen,
  onClose,
  onSuccess,
}: MasterDataImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState("");
  const [stagedRows, setStagedRows] = useState<ParsedStagedRow[]>([]);
  const [viewFilter, setViewFilter] = useState<"all" | "errors" | "valid">("all");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDownloadTemplate = () => {
    const csvContent = generateMasterTemplateCsv(config);
    const filename = `${config.key}_template.csv`;
    downloadCsvFile(filename, csvContent);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    processFile(selected);
  };

  const processFile = async (selected: File) => {
    setFile(selected);
    setParsing(true);
    setGeneralError("");
    setStagedRows([]);

    try {
      const text = await selected.text();
      const { rows } = parseCsvText(text);

      if (rows.length === 0) {
        throw new Error("The selected CSV file contains no data rows.");
      }

      // Pre-fetch reference entity catalogs for foreign-key resolution
      const [speciesRes, breedRes, stageRes, itemRes, nobsRes] = await Promise.allSettled([
        config.key === "breed" ? api.get(`/species?limit=500`) : Promise.resolve([]),
        config.key === "breed-lifecycle-stage" ? api.get(`/breed?limit=500`) : Promise.resolve([]),
        config.key === "breed-lifecycle-stage" ? api.get(`/stage?limit=500`) : Promise.resolve([]),
        config.key === "breed-lifecycle-stage" ? api.get(`/item?limit=500`) : Promise.resolve([]),
        config.key === "breed" ? api.get(`/setup/wizard/nobs`) : Promise.resolve([]),
      ]);

      const speciesList: any[] = speciesRes.status === "fulfilled" ? unwrap(speciesRes.value) || [] : [];
      const breedList: any[] = breedRes.status === "fulfilled" ? unwrap(breedRes.value) || [] : [];
      const stageList: any[] = stageRes.status === "fulfilled" ? unwrap(stageRes.value) || [] : [];
      const itemList: any[] = itemRes.status === "fulfilled" ? unwrap(itemRes.value) || [] : [];
      const nobsList: any[] = nobsRes.status === "fulfilled" ? unwrap(nobsRes.value) || [] : [];

      let lobsList: any[] = [];
      if (nobsList.length > 0) {
        const lobResults = await Promise.allSettled(
          nobsList.map((n) => api.get(`/setup/wizard/lobs/${n.nob_id}`))
        );
        lobsList = lobResults.flatMap((r) => (r.status === "fulfilled" ? unwrap(r.value) || [] : []));
      }

      // Validate & stage rows
      const staged: ParsedStagedRow[] = [];

      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const errors: string[] = [];
        const payload: Record<string, any> = {};

        if (config.key === "breed") {
          const code = (
            getRawValue(raw, "breed_code", "Code", ["code", "breedcode", "Breed Code"]) || ""
          ).trim().toUpperCase();
          const name = (
            getRawValue(raw, "breed_name", "Name", ["name", "breedname", "Breed Name"]) || ""
          ).trim();
          const type = (
            getRawValue(raw, "breed_type", "Breed Type", ["type", "Type", "breedtype"]) || "MEAT"
          ).trim().toUpperCase();

          if (!code) errors.push("Breed Code is required.");
          if (!name) errors.push("Breed Name is required.");

          const validTypes = ["MEAT", "BREEDER", "DUAL_PURPOSE"];
          if (!validTypes.includes(type)) {
            errors.push(`Breed Type '${type}' is invalid. Allowed: ${validTypes.join(", ")}`);
          }

          const activeCompanyId = getActiveCompanyId();
          if (activeCompanyId) payload.company_id = activeCompanyId;

          // Resolve NOB
          const nobVal = (
            getRawValue(raw, "nob_id", "Nature of Business", ["nob_code", "nob_name", "nob", "Nature Of Business"]) || ""
          ).trim();
          if (nobVal) {
            const matchedNob = nobsList.find(
              (n) => n.nob_code?.toUpperCase() === nobVal.toUpperCase() || n.nob_name?.toUpperCase() === nobVal.toUpperCase() || n.nob_id === nobVal
            );
            if (matchedNob) payload.nob_id = matchedNob.nob_id;
          }

          // Resolve LOB
          const lobVal = (
            getRawValue(raw, "lob_id", "Line of Business", ["lob_code", "lob_name", "lob", "Line Of Business"]) || ""
          ).trim();
          if (lobVal) {
            const matchedLob = lobsList.find(
              (l) => l.lob_code?.toUpperCase() === lobVal.toUpperCase() || l.lob_name?.toUpperCase() === lobVal.toUpperCase() || l.lob_id === lobVal
            );
            if (matchedLob) payload.lob_id = matchedLob.lob_id;
          }

          // Resolve species if provided
          const speciesCode = (
            getRawValue(raw, "species_code", "Species", ["species", "species_name", "species_id"]) || "PIG"
          ).trim().toUpperCase();
          const matchedSpecies = speciesList.find(
            (s) =>
              s.species_code?.toUpperCase() === speciesCode ||
              s.species_name?.toUpperCase() === speciesCode
          );

          payload.breed_code = code;
          payload.breed_name = name;
          payload.breed_type = type;
          if (matchedSpecies) {
            payload.species_id = matchedSpecies.species_id;
            payload.species = matchedSpecies.species_name;
          }

          // Description
          const desc = getRawValue(raw, "description", "Description", ["breed_description", "desc", "notes"]);
          if (desc) payload.description = desc;

          // Blocked
          const blockedVal = getRawValue(raw, "is_blocked", "Blocked", ["blocked", "status", "isblocked"]);
          if (blockedVal !== undefined && blockedVal !== "") {
            payload.is_blocked = blockedVal === "1" || blockedVal.toLowerCase() === "true";
          }

          // Integer Numbers
          const intFields: { key: string; label: string; aliases?: string[] }[] = [
            { key: "gestation_days", label: "Gestation Days", aliases: ["gestation", "gestationdays"] },
            { key: "lactation_days", label: "Lactation Days", aliases: ["lactation", "lactationdays"] },
            { key: "productive_life_months", label: "Productive Life (months)", aliases: ["Productive Life (months)_1", "sow_productive_life_months", "productivelifemonths"] },
            { key: "productive_life_cycles", label: "Productive Life Cycles", aliases: ["productivelifecycles", "cycles", "parities"] },
            { key: "boar_productive_life_months", label: "Boar Productive Life (months)", aliases: ["Productive Life (months)_2", "boar_productive_life", "boarproductivelifemonths"] },
            { key: "mature_age_months", label: "Mature Age (months)", aliases: ["matureagemonths", "mature_age"] },
          ];
          for (const { key, label, aliases } of intFields) {
            const rawVal = getRawValue(raw, key, label, aliases);
            if (rawVal !== undefined && rawVal !== "") {
              const val = parseInt(rawVal, 10);
              if (isNaN(val) || val < 0) errors.push(`${label} must be a non-negative integer.`);
              else payload[key] = val;
            }
          }

          // Decimals
          const decFields: { key: string; label: string; aliases?: string[] }[] = [
            { key: "avg_growth_rate_g_day", label: "Avg Growth Rate (g/day)", aliases: ["growth_rate", "avggrowthrategday"] },
            { key: "avg_fcr", label: "Avg FCR", aliases: ["fcr", "avgfcr"] },
            { key: "avg_mortality_pct", label: "Avg Mortality %", aliases: ["mortality", "avgmortality", "avgmortalitypct"] },
            { key: "avg_yield_per_unit", label: "Avg Yield per Unit", aliases: ["yield", "avgyieldperunit"] },
            { key: "avg_litter_size_born", label: "Avg Litter Size Born", aliases: ["litter_size_born", "avglittersizeborn"] },
            { key: "avg_litter_size_weaned", label: "Avg Litter Size Weaned", aliases: ["litter_size_weaned", "avglittersizeweaned"] },
            { key: "avg_weaning_weight_kg", label: "Avg Weaning Weight (KG)", aliases: ["weaning_weight", "avgweaningweightkg"] },
            { key: "farrowing_rate_pct", label: "Farrowing Rate %", aliases: ["farrowing_rate", "farrowingratepct", "farrowingrate"] },
            { key: "boar_doses_per_week", label: "Doses per Week", aliases: ["doses_per_week", "boardosesperweek"] },
            { key: "residual_value_pct", label: "Residual Value %", aliases: ["residual_value", "residualvaluepct", "residualvalue"] },
          ];
          for (const { key, label, aliases } of decFields) {
            const rawVal = getRawValue(raw, key, label, aliases);
            if (rawVal !== undefined && rawVal !== "") {
              const val = parseFloat(rawVal);
              if (isNaN(val) || val < 0) errors.push(`${label} must be a valid non-negative number.`);
              else payload[key] = val;
            }
          }
        } else if (config.key === "breed-lifecycle-stage") {
          const breedCode = (
            getRawValue(raw, "breed_code", "Breed", ["breed", "breedcode", "Breed Code", "breed_name"]) || ""
          ).trim().toUpperCase();
          const stageCode = (
            getRawValue(raw, "stage_code", "Stage", ["stage", "stagecode", "Stage Code", "stage_name"]) || ""
          ).trim().toUpperCase();
          const category = (
            getRawValue(raw, "category", "Category", ["cat", "animal_category"]) || "SOW"
          ).trim().toUpperCase();
          const calcUnit = (
            getRawValue(raw, "calc_unit", "Period Unit", ["Calculation Unit", "unit", "period_unit"]) || "DAY"
          ).trim().toUpperCase();

          if (!breedCode) errors.push("Breed Code is required.");
          if (!stageCode) errors.push("Stage Code is required.");

          const matchedBreed = breedList.find(
            (b) =>
              b.breed_code?.toUpperCase() === breedCode ||
              b.breed_name?.toUpperCase() === breedCode
          );
          if (!matchedBreed && breedCode) {
            errors.push(`Breed '${breedCode}' not found in Breed Master.`);
          } else if (matchedBreed) {
            payload.breed_id = matchedBreed.breed_id;
          }

          const matchedStage = stageList.find(
            (st) =>
              st.stage_code?.toUpperCase() === stageCode ||
              st.stage_name?.toUpperCase() === stageCode
          );
          if (!matchedStage && stageCode) {
            errors.push(`Stage '${stageCode}' not found in Stage Master.`);
          } else if (matchedStage) {
            payload.stage_id = matchedStage.stage_id;
          }

          const validCategories = ["SOW", "GILT", "BOAR", "PIGLET", "COMMERCIAL_PIG"];
          if (!validCategories.includes(category)) {
            errors.push(`Category '${category}' invalid. Allowed: ${validCategories.join(", ")}`);
          } else {
            payload.category = category;
          }

          const validUnits = ["DAY", "WEEK", "MONTH"];
          if (!validUnits.includes(calcUnit)) {
            errors.push(`Period Unit '${calcUnit}' invalid. Allowed: ${validUnits.join(", ")}`);
          } else {
            payload.calc_unit = calcUnit;
          }

          // Periods
          const pFromRaw = getRawValue(raw, "period_from", "Period From", ["from", "periodfrom"]) || "0";
          const pToRaw = getRawValue(raw, "period_to", "Period To", ["to", "periodto"]) || "0";
          const pFrom = parseInt(pFromRaw, 10);
          const pTo = parseInt(pToRaw, 10);
          if (isNaN(pFrom) || pFrom < 0) errors.push("Period From must be a non-negative integer.");
          if (isNaN(pTo) || pTo < 0) errors.push("Period To must be a non-negative integer.");
          if (pFrom > pTo) errors.push(`Period From (${pFrom}) cannot be greater than Period To (${pTo}).`);

          payload.period_from = pFrom;
          payload.period_to = pTo;

          const lifecycleCode = getRawValue(raw, "lifecycle_code", "Code", ["lifecyclecode", "stage_lifecycle_code"]);
          if (lifecycleCode) payload.lifecycle_code = lifecycleCode.trim();

          const seasonRaw = getRawValue(raw, "season_type", "Season", ["season", "seasontype", "Season Type"]);
          if (seasonRaw) {
            const season = seasonRaw.trim().toUpperCase();
            if (["ALL", "SUMMER", "WINTER"].includes(season)) payload.season_type = season;
          }

          // Teat standard
          const teatsRaw = getRawValue(raw, "std_teats", "Standard Teat Count", ["Teats", "stdteats", "teats"]);
          if (teatsRaw) {
            const teats = parseInt(teatsRaw, 10);
            if (!isNaN(teats) && teats >= 0) {
              if (category === "SOW" && teats < 15) {
                errors.push(`SOW standard teats must be at least 15 (found ${teats}).`);
              }
              payload.std_teats = teats;
            }
          }

          // Feed item
          const feedItemCode = (
            getRawValue(raw, "feed_item_code", "Feed", ["feed_item_id", "feed_item", "Feed Item", "feed"]) || ""
          ).trim().toUpperCase();
          if (feedItemCode) {
            const matchedItem = itemList.find(
              (it) => it.item_code?.toUpperCase() === feedItemCode || it.item_name?.toUpperCase() === feedItemCode
            );
            if (matchedItem) payload.feed_item_id = matchedItem.item_id;
            else errors.push(`Feed item '${feedItemCode}' not found in Item Master.`);
          }

          // Output item
          const outputItemCode = (
            getRawValue(raw, "output_item_code", "Output Item", ["output_item_id", "output_item", "output"]) || ""
          ).trim().toUpperCase();
          if (outputItemCode) {
            const matchedItem = itemList.find(
              (it) => it.item_code?.toUpperCase() === outputItemCode || it.item_name?.toUpperCase() === outputItemCode
            );
            if (matchedItem) payload.output_item_id = matchedItem.item_id;
            else errors.push(`Output item '${outputItemCode}' not found in Item Master.`);
          }

          // Numeric standards
          const stageStandards: { key: string; label: string; aliases?: string[] }[] = [
            { key: "feed_qty_per_head_per_day_kg", label: "Daily Feed per Head (kg)", aliases: ["Feed Qty", "Daily Feed", "feed_qty"] },
            { key: "feed_wastage_pct", label: "Feed Wastage (%)", aliases: ["Feed Wastage %", "wastage", "feed_wastage"] },
            { key: "std_body_weight_kg", label: "Std Body Weight (KG)", aliases: ["Body Weight", "Std Body Weight (kg)", "body_weight"] },
            { key: "std_adg_gpd", label: "Std ADG (g/day)", aliases: ["ADG", "std_adg", "Std ADG"] },
            { key: "std_fcr", label: "Std FCR", aliases: ["FCR", "fcr", "std_fcr"] },
            { key: "std_mortality_rate_pct", label: "Std Mortality Rate %", aliases: ["Mortality Rate %", "mortality_rate", "std_mortality"] },
            { key: "std_output_qty", label: "Std Output Qty", aliases: ["Output Qty", "output_qty", "Std Output Quantity"] },
          ];
          for (const { key, label, aliases } of stageStandards) {
            const rawVal = getRawValue(raw, key, label, aliases);
            if (rawVal !== undefined && rawVal !== "") {
              const val = parseFloat(rawVal);
              if (isNaN(val) || val < 0) errors.push(`${label} must be a non-negative number.`);
              else payload[key] = val;
            }
          }

          const outputUom = getRawValue(raw, "output_uom", "Output UOM", ["uom", "outputuom"]);
          if (outputUom) payload.output_uom = outputUom.trim();

          const notes = getRawValue(raw, "notes", "Notes", ["remark", "remarks", "notes"]);
          if (notes) payload.notes = notes.trim();
        } else {
          // Generic master fallback
          for (const f of config.fields) {
            const rawVal = getRawValue(raw, f.key, f.label);
            if (rawVal !== undefined && rawVal !== "") {
              payload[f.key] = rawVal;
            } else if (f.required) {
              errors.push(`${f.label || f.key} is required.`);
            }
          }
        }

        staged.push({
          index: i + 1,
          raw,
          payload,
          isValid: errors.length === 0,
          errors,
        });
      }

      setStagedRows(staged);
    } catch (err: any) {
      setGeneralError(err?.message || "Failed to parse CSV file.");
    } finally {
      setParsing(false);
    }
  };

  const handleCommitImport = async () => {
    const validRows = stagedRows.filter((r) => r.isValid);
    const validItems = validRows.map((r) => r.payload);
    if (validItems.length === 0) return;

    setSubmitting(true);
    setGeneralError("");

    try {
      let bulkRes: any;
      if (config.key === "breed") {
        bulkRes = await api.post("/breed/bulk", { items: validItems });
      } else if (config.key === "breed-lifecycle-stage") {
        bulkRes = await api.post("/breed-lifecycle-stage/bulk", { items: validItems });
      } else {
        // Fallback: sequential inserts
        for (const item of validItems) {
          await api.post(config.apiBase, item);
        }
      }

      const resData = unwrap(bulkRes);
      const backendErrors: any[] = resData?.errors || [];

      if (backendErrors.length > 0) {
        setStagedRows((prev) =>
          prev.map((r, idx) => {
            const be = backendErrors.find(
              (e: any) =>
                e.index === idx ||
                (e.code && (e.code === r.payload.breed_code || e.code === r.payload.lifecycle_code))
            );
            if (be) {
              const errMsg = be.error || be.reason || "Backend validation failed";
              return {
                ...r,
                isValid: false,
                errors: [...r.errors, errMsg],
              };
            }
            return r;
          })
        );
        setViewFilter("errors");
        setGeneralError(`Backend validation failed for ${backendErrors.length} item(s). Review the alert list below.`);
        return;
      }

      const importedCodes = validItems
        .map((it) => it.breed_code || it.lifecycle_code)
        .filter(Boolean);

      if (importedCodes.length > 0) {
        showToast.success(`Successfully imported ${importedCodes.length} ${config.key === "breed" ? "breed" : "record"}(s): ${importedCodes.join(", ")}`);
      } else {
        showToast.success(`Successfully imported ${validItems.length} record(s).`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      const respData = err?.response?.data || err?.data || err;
      const backendErrors: { index?: number; code?: string; error?: string; reason?: string }[] =
        respData?.errors || respData?.error?.errors || err?.errors || [];

      if (backendErrors.length > 0) {
        setStagedRows((prev) =>
          prev.map((r, idx) => {
            const be = backendErrors.find(
              (e) =>
                e.index === idx ||
                (e.code && (e.code === r.payload.breed_code || e.code === r.payload.lifecycle_code))
            );
            if (be) {
              const errMsg = be.error || be.reason || "Validation failed";
              return {
                ...r,
                isValid: false,
                errors: [...r.errors, errMsg],
              };
            }
            return r;
          })
        );
        setViewFilter("errors");
        setGeneralError(`Validation failed for ${backendErrors.length} breed(s). Review the alert list below.`);
      } else {
        const msg = respData?.message || err?.message || "Failed to commit bulk upload.";
        setGeneralError(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const validRows = stagedRows.filter((r) => r.isValid);
  const invalidRows = stagedRows.filter((r) => !r.isValid);
  const validCount = validRows.length;
  const errorCount = invalidRows.length;

  const displayedRows = stagedRows.filter((r) => {
    if (viewFilter === "errors") return !r.isValid;
    if (viewFilter === "valid") return r.isValid;
    return true;
  });

  return (
    <Dialog
      open={isOpen}
      onClose={() => !submitting && onClose()}
      title={`Bulk Import — ${config.label}`}
      maxWidth="xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-(--text-muted)">
            {stagedRows.length > 0 && (
              <span>
                Total Rows: <strong>{stagedRows.length}</strong> | Valid:{" "}
                <strong className="text-emerald-600 dark:text-emerald-400">{validCount}</strong> | Errors:{" "}
                <strong className="text-rose-600 dark:text-rose-400">{errorCount}</strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCommitImport}
              disabled={validCount === 0 || submitting}
              className="nf-btn-primary flex items-center gap-1.5"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {submitting
                ? "Importing Records…"
                : errorCount > 0
                ? `Import ${validCount} Valid Records (${errorCount} Skipped)`
                : `Import All ${validCount} Records`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-xs">
        {generalError && <InlineAlert variant="danger">{generalError}</InlineAlert>}

        {/* Step 1: Template Download Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-(--border) bg-(--surface-raised) p-3">
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-(--accent)" />
            <div>
              <p className="font-semibold text-(--text-primary)">Download Official Template</p>
              <p className="text-[11px] text-(--text-secondary)">
                Contains pre-formatted columns, required field guides, and sample data.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5 text-(--accent)" /> Download CSV Template
          </Button>
        </div>

        {/* Step 2: Upload Dropzone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-(--border) bg-(--surface) p-6 transition hover:border-(--accent) hover:bg-(--surface-raised)/50"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
          {parsing ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-(--accent)" />
              <p className="font-medium text-(--text-primary)">Validating and parsing records…</p>
            </div>
          ) : file ? (
            <div className="flex flex-col items-center gap-1 text-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              <p className="font-semibold text-(--text-primary)">{file.name}</p>
              <p className="text-[11px] text-(--text-muted)">
                {(file.size / 1024).toFixed(1)} KB — Click to choose a different CSV file
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 text-center">
              <Upload className="h-7 w-7 text-(--text-muted)" />
              <p className="font-semibold text-(--text-primary)">
                Click to browse or drop your CSV file here
              </p>
              <p className="text-[11px] text-(--text-muted)">Supports .csv files formatted per template</p>
            </div>
          )}
        </div>

        {/* Validation Errors Alert listing affected Breed / Record Codes */}
        {errorCount > 0 && (
          <InlineAlert variant="danger">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-rose-800 dark:text-rose-200">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>
                    Validation Alert: {errorCount} {config.key === "breed" ? "Breed" : "Record"}
                    {errorCount > 1 ? "s" : ""} Failed Validation
                  </span>
                </div>
                {viewFilter !== "errors" && (
                  <button
                    type="button"
                    onClick={() => setViewFilter("errors")}
                    className="text-[11px] font-medium text-rose-700 underline hover:opacity-80 dark:text-rose-300"
                  >
                    Filter to show failed rows ({errorCount})
                  </button>
                )}
              </div>

              <p className="text-[11px] text-rose-700 dark:text-rose-300">
                The following imported {config.key === "breed" ? "breed codes" : "records"} have validation errors and cannot be saved:
              </p>

              <div className="max-h-44 overflow-y-auto space-y-1.5 rounded border border-rose-200 bg-white/80 p-2.5 text-[11px] dark:border-rose-900/60 dark:bg-black/40">
                {invalidRows.map((r) => {
                  const itemCode =
                    r.payload.breed_code ||
                    r.raw.breed_code ||
                    r.raw.Code ||
                    r.payload.lifecycle_code ||
                    r.raw.lifecycle_code ||
                    `Row #${r.index}`;
                  const itemName =
                    r.payload.breed_name || r.raw.breed_name || r.raw.Name;

                  return (
                    <div
                      key={r.index}
                      className="flex flex-col gap-0.5 border-b border-rose-100 pb-1.5 last:border-b-0 last:pb-0 dark:border-rose-900/40"
                    >
                      <div className="flex items-center gap-2 font-medium">
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose-900 dark:bg-rose-950 dark:text-rose-200">
                          {itemCode}
                        </span>
                        {itemName && (
                          <span className="text-(--text-secondary)">— {itemName}</span>
                        )}
                        <span className="text-[10px] text-(--text-muted)">(File Row #{r.index})</span>
                      </div>
                      <ul className="list-disc pl-5 text-rose-700 dark:text-rose-300">
                        {r.errors.map((err, errIdx) => (
                          <li key={errIdx}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </InlineAlert>
        )}

        {/* Success Alert when all rows pass validation */}
        {stagedRows.length > 0 && errorCount === 0 && (
          <InlineAlert variant="success">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  All {stagedRows.length} {config.key === "breed" ? "breed" : "record"}
                  {stagedRows.length > 1 ? "s" : ""} validated successfully and ready to import.
                </span>
              </div>
              <div className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                Codes: {stagedRows.map((r) => r.payload.breed_code || r.raw.breed_code || r.raw.Code).filter(Boolean).join(", ")}
              </div>
            </div>
          </InlineAlert>
        )}

        {/* Step 3: Staged Dry-Run Preview Table */}
        {stagedRows.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold uppercase tracking-wider text-[11px] text-(--text-secondary)">
                  Pre-flight Dry Run Staging Preview
                </span>
                <span className="rounded-full bg-(--surface-raised) border px-2 py-0.5 text-[10px] font-bold">
                  {stagedRows.length} Rows
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setViewFilter("all")}
                  className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                    viewFilter === "all" ? "bg-(--surface-raised) text-(--text-primary) shadow-xs" : "text-(--text-muted)"
                  }`}
                >
                  All ({stagedRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setViewFilter("errors")}
                  className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                    viewFilter === "errors" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "text-(--text-muted)"
                  }`}
                >
                  Errors ({errorCount})
                </button>
                <button
                  type="button"
                  onClick={() => setViewFilter("valid")}
                  className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                    viewFilter === "valid" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "text-(--text-muted)"
                  }`}
                >
                  Valid ({validCount})
                </button>
              </div>
            </div>

            <div className="max-h-60 overflow-x-auto overflow-y-auto rounded-[var(--radius-md)] border border-(--border) bg-(--surface)">
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader className="sticky top-0 z-10 bg-(--surface-raised)">
                  <tr className="border-b border-(--row-border)">
                    <TableHead className="w-12 px-3 py-2">Row</TableHead>
                    <TableHead className="px-3 py-2">Status</TableHead>
                    <TableHead className="px-3 py-2">Code</TableHead>
                    <TableHead className="px-3 py-2">Details</TableHead>
                    <TableHead className="px-3 py-2">Validation Remarks</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {displayedRows.map((r) => (
                    <TableRow key={r.index} className="border-b border-(--row-border) hover:bg-(--surface-raised)/50">
                      <TableCell className="px-3 py-2 font-mono text-(--text-muted)">#{r.index}</TableCell>
                      <TableCell className="px-3 py-2">
                        {r.isValid ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" /> Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                            <AlertCircle className="h-3 w-3" /> Error
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono font-semibold text-(--text-primary)">
                        {r.payload.breed_code || r.payload.lifecycle_code || r.raw.breed_code || r.raw.lifecycle_code || "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-(--text-secondary)">
                        {config.key === "breed" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-(--text-primary)">
                              {r.payload.breed_name || r.payload.breed_code} ({r.payload.breed_type || "MEAT"})
                            </span>
                            <span className="text-[11px] text-(--text-muted)">
                              {[
                                r.payload.gestation_days != null ? `Gest: ${r.payload.gestation_days}d` : null,
                                r.payload.lactation_days != null ? `Lact: ${r.payload.lactation_days}d` : null,
                                r.payload.avg_litter_size_born != null ? `Born: ${r.payload.avg_litter_size_born}` : null,
                                r.payload.avg_litter_size_weaned != null ? `Weaned: ${r.payload.avg_litter_size_weaned}` : null,
                                r.payload.productive_life_months != null ? `Sow Life: ${r.payload.productive_life_months}m` : null,
                                r.payload.boar_productive_life_months != null ? `Boar Life: ${r.payload.boar_productive_life_months}m` : null,
                                r.payload.description ? `Desc: "${r.payload.description.slice(0, 30)}…"` : null,
                              ]
                                .filter(Boolean)
                                .join(" • ") || "No benchmarks specified"}
                            </span>
                          </div>
                        ) : config.key === "breed-lifecycle-stage" ? (
                          <span>
                            {r.payload.breed_code || r.raw.breed_code} ➔ {r.payload.stage_code || r.raw.stage_code} ({r.payload.category || "—"}, {r.payload.period_from}-{r.payload.period_to} {r.payload.calc_unit})
                          </span>
                        ) : (
                          <span>{Object.values(r.payload).slice(0, 3).join(", ")}</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        {r.isValid ? (
                          <span className="text-emerald-600 dark:text-emerald-400">All checks passed</span>
                        ) : (
                          <span className="font-medium text-rose-600 dark:text-rose-400">
                            {r.errors.join("; ")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
