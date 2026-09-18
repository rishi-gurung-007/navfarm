"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/services/api-client";
import type { MasterDataField } from "./types";
import { getActiveCompanyId, getActiveWorkspaceScope, getActiveOperationalAreaId } from "@/hooks/useAuth";

/** [series/document key, the master's own code field, the type field driving type-specific series] */
export const CODE_SERIES: Record<string, [string, string, string?]> = {
  reason: ["REASON", "reason_code"],
  animal: ["ANIMAL", "animal_code"],
  species: ["SPECIES", "species_code"],
  "item-attribute": ["ITEM_ATTRIBUTE", "attribute_code"],
  "location-type": ["LOCATION_TYPE", "type_code"],
  item: ["ITEM", "item_code", "item_type"],
  supplier: ["SUPPLIER", "supplier_code"],
  customer: ["CUSTOMER", "customer_code"],
  resource: ["RESOURCE", "resource_code"],
  location: ["LOCATION", "location_code", "location_type"],
  breed: ["BREED", "breed_code", "breed_type"],
  disease: ["DISEASE", "disease_code"],
  "feed-formula": ["FEED_FORMULA", "formula_code"],
  uom: ["UOM", "uom_code", "uom_type"],
  stage: ["STAGE", "stage_code", "stage_category"],
  "item-type": ["ITEM_TYPE", "type_code"],
  "item-category": ["ITEM_CATEGORY", "category_code"],
  "gl-account": ["GL_ACCOUNT", "account_code", "account_type"],
  "cost-center": ["COST_CENTER", "cost_center_code", "cost_center_type"],
  // The last four masters to gain a code. No series is configured for any of them
  // (the client's numbering conventions are still outstanding), so the preview call
  // returns { generated: false, allowManual: true } and the field stays a plain
  // optional text input. Registering them now means that when a series is finally
  // added the serial/manual toggle appears with no further frontend change.
  "uom-conversion": ["UOM_CONVERSION", "conversion_code"],
  "gl-mapping": ["GL_MAPPING", "mapping_code"],
  "breed-lifecycle-stage": ["BREED_LIFECYCLE_STAGE", "lifecycle_code"],
};
const PARENT_FIELDS: Record<string, string> = {
  location: "parent_location_id", breed: "location_id", "item-category": "parent_category_id",
  "gl-account": "parent_account_id", "cost-center": "parent_cost_center_id",
};
interface Settings { generated: boolean; allowManual: boolean; preview?: string }

export function useCodeSeries(key: string, form: Record<string, unknown>, enabled = true) {
  const [revision, setRevision] = useState(0);
  const definition = CODE_SERIES[key];
  const canGenerate = !!definition;
  const type = definition?.[2] ? String(form[definition[2]] || "") : "";
  const parentId = String(form[PARENT_FIELDS[key]] || "");
  const lobId = key === "animal" ? String(form.lob_id || "") : "";
  // The whole in-progress record goes to the preview, so a series configured
  // with code_segments / prefix_field previews the code it will actually
  // allocate. Without it the form showed the prefix-only shape while the save
  // wrote the composed one — a preview that disagrees with the result is worse
  // than none. Only scalars are sent; a nested value can never be a segment.
  const record = useMemo(() => JSON.stringify(
    Object.fromEntries(
      Object.entries(form)
        // The code field itself is never a segment, and while it is being typed
        // it would re-request the preview that is about to replace it.
        .filter(([k]) => k !== definition?.[1])
        .filter(([, v]) =>
          v !== "" && v !== null && v !== undefined && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    )
  ), [form, definition]);
  // A segment can come from a field being typed into, so the record changes on
  // every keystroke. Debounced, or the preview fires a request per character.
  const [settledRecord, setSettledRecord] = useState(record);
  useEffect(() => {
    const timer = setTimeout(() => setSettledRecord(record), 300);
    return () => clearTimeout(timer);
  }, [record]);
  const scopeKey = `${getActiveWorkspaceScope()}:${getActiveCompanyId()}:${getActiveOperationalAreaId()}`;
  const requestKey = `${scopeKey}:${key}:${type}:${parentId}:${lobId}:${settledRecord}:${revision}`;
  const [result, setResult] = useState<{ key: string; settings?: Settings; error?: string }>();
  useEffect(() => {
    if (!enabled) { setResult(undefined); return; }
    if (!definition || !canGenerate) return;
    let cancelled = false;
    const params = new URLSearchParams({ master: definition[0] });
    if (type) params.set("type", type);
    if (parentId) params.set("parentId", parentId);
    if (lobId) params.set("lobId", lobId);
    // 4000 is the DTO's cap; past it the preview asks without the record rather
    // than being rejected, and falls back to the prefix-only shape.
    const masterType = definition[0];
    const compId = getActiveCompanyId();
    const previewUrl = `/no-series/preview-by-master?masterType=${masterType}${compId ? `&companyId=${compId}` : ''}`;
    api.get(previewUrl)
      .then((modernRes: any) => {
        const modernData = modernRes?.data || modernRes;
        if (modernData?.generated) {
          if (!cancelled) {
            setResult({
              key: requestKey,
              settings: {
                generated: true,
                allowManual: modernData.allowManual !== false,
                preview: modernData.preview || modernData.next_number,
              },
            });
          }
          return;
        }
        return api.get(`/number-series/preview?${params}`).then((res) => {
          const data = res?.data || res;
          if (!cancelled) setResult({ key: requestKey, settings: { generated: data.generated === true, allowManual: data.allowManual !== false, preview: data.preview } });
        });
      })
      .catch(() => {
        return api.get(`/number-series/preview?${params}`).then((res) => {
          const data = res?.data || res;
          if (!cancelled) setResult({ key: requestKey, settings: { generated: data.generated === true, allowManual: data.allowManual !== false, preview: data.preview } });
        }).catch((err: Error) => { if (!cancelled) setResult({ key: requestKey, error: err.message || "Could not check code numbering." }); });
      });
    return () => { cancelled = true; };
  }, [key, type, parentId, lobId, settledRecord, scopeKey, enabled, canGenerate, requestKey]);
  const current = result?.key === requestKey ? result : undefined;
  // Locations use type-specific series.
  const awaitingLocationType = key === "location" && !type;
  const managedCode = awaitingLocationType || current?.settings?.generated;
  /**
   * allowManual reflects the Number Series's own `manual_nos` flag.
   * When true the user types the code themselves; when false it is auto-generated
   * and read-only. There is no user-facing dropdown — this is purely driven by
   * how the Number Series is configured.
   */
  const allowManual = awaitingLocationType || current?.settings?.allowManual;
  // serial = true means show a preview and lock the field; false means the field
  // is editable because manual_nos is set on the linked series.
  const serial = enabled && managedCode && !allowManual;
  return {
    refresh: () => setRevision((value) => value + 1),
    value: (fieldKey: string, value: unknown) => {
      if (!managedCode || fieldKey !== definition?.[1]) return value;
      // Auto-generated (manual_nos = false): always show the live preview
      if (serial) return current?.settings?.preview || "";
      // Manual (manual_nos = true): pre-fill with preview when the field is blank
      // so the user sees the next number as a suggestion. Once they type their
      // own code, their value takes over and the preview no longer replaces it.
      const raw = typeof value === "string" ? value : "";
      if (!raw) return current?.settings?.preview || "";
      return value;
    },
    loading: canGenerate && enabled && !current,
    error: canGenerate && enabled ? current?.error : undefined,
    /** The config field this hook drives, so a caller can tell whether a failed
     * preview actually prevents saving. */
    codeKey: definition?.[1],
    field: (field: MasterDataField): MasterDataField => {
      if (!enabled || !canGenerate || field.key !== definition?.[1] || !managedCode) return field;
      // allowManual (manual_nos = true on the series) → editable, pre-filled with preview
      // !allowManual (manual_nos = false)             → read-only, shows live preview
      const manual = !!allowManual;
      return { ...field, required: manual, readOnly: !manual,
        placeholder: manual ? "Enter a unique code or keep the suggestion" : awaitingLocationType ? "Select Location Type to preview code" : "Calculating code…",
        helpText: manual ? "Pre-filled with the next series number. Edit if you need a different code." : awaitingLocationType ? "The selected Location Type determines the numbering series." : "Live preview — allocated when saved. Another user's save may change the final number." };
    },
  };
}

/** The field holding a master's own code, so a code cannot be built out of itself. */
export function codeFieldOf(masterKey: string): string | undefined {
  return CODE_SERIES[masterKey]?.[1];
}
