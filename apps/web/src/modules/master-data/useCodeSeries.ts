"use client";
import { useEffect, useState } from "react";
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
  "kpi-metric": ["KPI_METRIC", "metric_code"],
};
const PARENT_FIELDS: Record<string, string> = {
  location: "parent_location_id", "item-category": "parent_category_id",
  "gl-account": "parent_account_id", "cost-center": "parent_cost_center_id",
};
interface Settings { generated: boolean; allowManual: boolean; preview?: string }

// Module-level cache so reopening a form or switching between records preserves the preview instantly
const PREVIEW_CACHE = new Map<string, Settings>();

export function useCodeSeries(key: string, form: Record<string, unknown>, enabled = true) {
  const [revision, setRevision] = useState(0);
  const definition = CODE_SERIES[key];
  const canGenerate = !!definition;
  const type = definition?.[2] ? String(form[definition[2]] || "") : "";
  const parentId = String(form[PARENT_FIELDS[key]] || "");
  const lobId = key === "animal" ? String(form.lob_id || "") : "";

  const scopeKey = `${getActiveWorkspaceScope()}:${getActiveCompanyId()}:${getActiveOperationalAreaId()}`;
  const cacheKey = `${scopeKey}:${key}:${type}:${parentId}:${lobId}`;
  const requestKey = `${cacheKey}:${revision}`;

  const cached = PREVIEW_CACHE.get(cacheKey);
  const [result, setResult] = useState<{ key: string; settings?: Settings; error?: string } | undefined>(() =>
    cached ? { key: requestKey, settings: cached } : undefined
  );

  useEffect(() => {
    if (!enabled) return;
    if (!definition || !canGenerate) return;
    let cancelled = false;

    const masterType = definition[0];
    const compId = getActiveCompanyId();
    const typeParam = type ? `&type=${encodeURIComponent(type)}` : '';
    const previewUrl = `/no-series/preview-by-master?masterType=${masterType}${typeParam}${compId ? `&companyId=${compId}` : ''}`;

    api.get(previewUrl)
      .then((modernRes: any) => {
        const modernData = modernRes?.data || modernRes;
        if (modernData?.generated) {
          const settings: Settings = {
            generated: true,
            allowManual: modernData.allowManual !== false,
            preview: modernData.preview || modernData.next_number,
          };
          PREVIEW_CACHE.set(cacheKey, settings);
          if (!cancelled) {
            setResult({
              key: requestKey,
              settings,
            });
          }
          return;
        }
        const params = new URLSearchParams({ master: definition[0] });
        if (type) params.set("type", type);
        if (parentId) params.set("parentId", parentId);
        if (lobId) params.set("lobId", lobId);

        return api.get(`/number-series/preview?${params}`).then((res) => {
          const data = res?.data || res;
          const settings: Settings = {
            generated: data.generated === true,
            allowManual: data.allowManual !== false,
            preview: data.preview,
          };
          if (settings.generated) PREVIEW_CACHE.set(cacheKey, settings);
          if (!cancelled) setResult({ key: requestKey, settings });
        });
      })
      .catch(() => {
        const params = new URLSearchParams({ master: definition[0] });
        if (type) params.set("type", type);
        if (parentId) params.set("parentId", parentId);
        if (lobId) params.set("lobId", lobId);

        return api.get(`/number-series/preview?${params}`).then((res) => {
          const data = res?.data || res;
          const settings: Settings = {
            generated: data.generated === true,
            allowManual: data.allowManual !== false,
            preview: data.preview,
          };
          if (settings.generated) PREVIEW_CACHE.set(cacheKey, settings);
          if (!cancelled) setResult({ key: requestKey, settings });
        }).catch((err: Error) => {
          // If we already have a cached preview, do NOT wipe it with an error
          if (!cancelled && !cached) {
            setResult({ key: requestKey, error: err.message || "Could not check code numbering." });
          }
        });
      });

    return () => { cancelled = true; };
  }, [key, type, parentId, lobId, scopeKey, enabled, canGenerate, requestKey, cacheKey]);

  // Always use the most accurate settings available: exact request match, current state result, or module cache
  const activeSettings = (result?.key === requestKey ? result?.settings : undefined) || result?.settings || cached;

  // Locations use type-specific series.
  const awaitingLocationType = key === "location" && !type;
  // The very first preview for a given key/type/parent combo in this session —
  // before its request has resolved and before anything is cached — leaves
  // activeSettings undefined. Falling through to the field's static config
  // then meant every code field briefly (and for a slow request, not so
  // briefly) went read-only the instant a Location Type was picked, even
  // though the series behind it allows manual entry: a field cannot know it's
  // locked until it's been told so, so the honest default while waiting is
  // "editable", the same treatment awaitingLocationType already gets.
  const awaitingPreview = canGenerate && enabled && !awaitingLocationType && activeSettings === undefined && !result?.error;
  const managedCode = awaitingLocationType || awaitingPreview || activeSettings?.generated;

  /**
   * allowManual reflects the Number Series's own `manual_nos` flag.
   * When true the user types the code themselves; when false it is auto-generated
   * and read-only. Optimistically true while awaiting the first answer, for the
   * same reason as above.
   */
  const allowManual = awaitingLocationType || awaitingPreview || activeSettings?.allowManual;
  const serial = enabled && managedCode && !allowManual;

  const preview = activeSettings?.preview || "";

  return {
    preview,
    allowManual: !!allowManual,
    // Whether an actual number series backs this field (vs. no series configured
    // at all, where the field is just a plain optional text input). Only when a
    // series is managing the field does leaving it unedited mean "take the next
    // series number" rather than "the user has no code convention to follow".
    managed: !!managedCode,
    serial: !!serial,
    refresh: () => {
      PREVIEW_CACHE.delete(cacheKey);
      setRevision((value) => value + 1);
    },
    value: (fieldKey: string, value: unknown) => {
      if (fieldKey !== definition?.[1]) return value;
      if (!managedCode && !preview) return value;
      // Auto-generated (manual_nos = false): always show the live preview
      if (serial || (!allowManual && preview)) return preview;
      // Manual (manual_nos = true): user value is authoritative; do not override user-cleared empty input
      return value;
    },
    // Loading means "no answer yet", not "no preview yet". A tenant with no
    // number series gets { generated: false } and never a preview, so keying
    // this on the preview kept Create disabled forever on a fresh tenant's
    // first Add Location.
    loading: awaitingPreview,
    error: canGenerate && enabled ? result?.error : undefined,
    /** The config field this hook drives, so a caller can tell whether a failed
     * preview actually prevents saving. */
    codeKey: definition?.[1],
    field: (field: MasterDataField): MasterDataField => {
      if (!enabled || !canGenerate || field.key !== definition?.[1] || !managedCode) return field;
      const manual = !!allowManual;
      return {
        ...field,
        required: manual,
        readOnly: !manual,
        placeholder: manual
          ? "Enter a unique code or keep the suggestion"
          : awaitingLocationType
          ? "Select Location Type to preview code"
          : "Calculating code…",
        helpText: manual
          ? "Pre-filled with the next series number. Edit if you need a different code."
          : awaitingLocationType
          ? "The selected Location Type determines the numbering series."
          : "Live preview — allocated when saved. Another user's save may change the final number.",
      };
    },
  };
}

/** The field holding a master's own code, so a code cannot be built out of itself. */
export function codeFieldOf(masterKey: string): string | undefined {
  return CODE_SERIES[masterKey]?.[1];
}
