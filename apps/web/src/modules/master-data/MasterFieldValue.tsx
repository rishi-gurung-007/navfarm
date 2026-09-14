"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import type { MasterDataField } from "./types";

export function formatMasterValue(value: unknown, field?: MasterDataField): string {
  if (field?.multiple && (value == null || (Array.isArray(value) && !value.length))) {
    return field.emptyMultipleLabel ?? "All (no restriction)";
  }
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value) && !value.length) return field?.multiple ? "All stages" : "—";
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value.join(", ");
  if (field?.type === "number" && Number.isFinite(Number(value))) return String(Number(value));
  // TDD row 102 asks for DD/MM/YYYY. Read the parts off the raw string rather
  // than through Date's local timezone, which shifts a bare "2026-09-08" back a
  // day for anyone west of UTC and would misdate a record on its own detail page.
  if (field?.type === "date" && typeof value === "string") {
    const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})/.exec(value) || [];
    if (d) return `${d}/${m}/${y}`;
  }
  if (Array.isArray(value) && value.every((entry) => entry?.attribute_name && "attribute_value" in entry)) {
    return value.map((entry) => `${entry.attribute_name}: ${entry.attribute_value ?? "—"}`).join("\n");
  }
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

/** Resolve UUID references through the same scoped, authorized APIs as the
 * master form. Do not guess labels or widen the workspace on a missing lookup. */
export function MasterFieldValue({ field, value, record }: {
  field?: MasterDataField; value: unknown; record: Record<string, unknown>;
}) {
  const [resolved, setResolved] = useState<{ request: string; label: string }>();
  const uuid = typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
  const entity = field?.type === "select-entity" && field.entityEndpoint && uuid;
  const dependency = typeof field?.dependsOn === "string" ? String(record[field.dependsOn] || "") : "";
  const endpoint = field?.entityEndpoint?.replace("{value}", encodeURIComponent(dependency));
  const usesList = endpoint?.startsWith("/setup/");
  const request = entity && (!field?.entityEndpoint?.includes("{value}") || dependency)
    ? usesList ? endpoint! : `${endpoint!.split("?")[0]}/${encodeURIComponent(String(value))}` : "";
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    api.get(request).then((result) => {
      const data = result?.data ?? result;
      const row = usesList && Array.isArray(data) ? data.find((entry) => String(entry[field!.entityValueKey!]) === value) : data;
      const label = row && !Array.isArray(row) ? field?.entityLabelKeys?.map((key) => row[key]).filter((part) => part !== null && part !== undefined && part !== "").join(" — ") : "";
      if (!cancelled) setResolved({ request, label: label || "Reference unavailable" });
    }).catch(() => { if (!cancelled) setResolved({ request, label: "Reference unavailable" }); });
    return () => { cancelled = true; };
  }, [request, usesList, field, value]);
  if (entity) return <>{!request ? "Reference unavailable" : resolved?.request === request ? resolved.label : "Loading reference…"}</>;
  return <>{formatMasterValue(value, field)}</>;
}
