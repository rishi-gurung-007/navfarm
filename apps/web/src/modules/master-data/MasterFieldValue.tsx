"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { API_ORIGIN } from "@/lib/api-client";
import type { MasterDataField } from "./types";

export function formatMasterValue(value: unknown, field?: MasterDataField): string {
  if (field?.multiple && (value == null || (Array.isArray(value) && !value.length))) {
    return field.emptyMultipleLabel ?? "All (no restriction)";
  }
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value) && !value.length) return field?.multiple ? "All stages" : "—";
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value.join(", ");
  if (field?.type === "number" && Number.isFinite(Number(value))) {
    const num = Number(value);
    if (field?.key === "gps_latitude" || field?.key === "gps_longitude") {
      return String(num);
    }
    const isInt = field?.step === "1" || (!field?.step && Number.isInteger(num));
    if (isInt) return String(num);
    return Number.isInteger(num) ? String(num) : num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
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

  // If pre-loaded details exist on record for attached_sheds
  if (field?.key === "attached_sheds" && Array.isArray((record as any)?.attached_shed_details)) {
    const details = (record as any).attached_shed_details as Array<{ location_code?: string; location_name?: string }>;
    if (details.length === 0) return <>{field?.emptyMultipleLabel ?? "None attached"}</>;
    return <>{details.map((d) => [d.location_code, d.location_name].filter(Boolean).join(" — ")).join(", ")}</>;
  }

  const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(val);

  const rawIds: string[] = Array.isArray(value)
    ? value
        .map((v) => (typeof v === "object" && v ? String((v as any)[field?.entityValueKey || "id"] || (v as any).id || "") : String(v ?? "")))
        .map((s) => s.trim())
        .filter(Boolean)
    : typeof value === "string" && (value.includes(",") || field?.multiple)
    ? value.split(",").map((s) => s.trim()).filter(Boolean)
    : typeof value === "string" && value.trim()
    ? [value.trim()]
    : [];

  const isEntity = field?.type === "select-entity" && !!field.entityEndpoint && rawIds.length > 0 && rawIds.every(isUuid);
  const dependency = typeof field?.dependsOn === "string" ? String(record[field.dependsOn] || "") : "";
  const endpoint = field?.entityEndpoint?.replace("{value}", encodeURIComponent(dependency));
  const usesList = endpoint?.startsWith("/setup/") || (endpoint?.includes("?") && !endpoint?.includes("{value}"));
  const canFetch = isEntity && (!field?.entityEndpoint?.includes("{value}") || dependency);
  const rawIdsStr = rawIds.join(",");
  const cacheKey = `${endpoint}:${rawIdsStr}`;

  useEffect(() => {
    if (!canFetch || !endpoint || !rawIdsStr) return;
    let cancelled = false;

    const ids = rawIdsStr.split(",").filter(Boolean);

    const extractLabel = (row: any): string => {
      if (!row || typeof row !== "object") return "";
      const keys = field?.entityLabelKeys || [];
      const parts = keys.map((k) => row[k]).filter((p) => p !== null && p !== undefined && p !== "");
      if (parts.length > 0) return parts.join(" — ");
      return row.code || row.name || row.title || row.label || "";
    };

    if (usesList) {
      api
        .get(endpoint)
        .then((result) => {
          if (cancelled) return;
          const data = result?.data ?? result;
          const list = Array.isArray(data) ? data : [];
          const valKey = field?.entityValueKey || "id";
          const labels = ids.map((id) => {
            const match = list.find((item: any) => String(item[valKey]) === id);
            return match ? extractLabel(match) : "";
          });
          const missing = ids.filter((id, i) => !labels[i]);
          if (missing.length === 0) {
            setResolved({ request: cacheKey, label: labels.join(", ") });
          } else {
            const base = endpoint.split("?")[0];
            Promise.all(
              ids.map((id, i) => {
                if (labels[i]) return Promise.resolve(labels[i]);
                return api
                  .get(`${base}/${encodeURIComponent(id)}`)
                  .then((res) => {
                    const rowData = res?.data ?? res;
                    return extractLabel(rowData) || id;
                  })
                  .catch(() => id);
              }),
            ).then((allLabels) => {
              if (!cancelled) {
                setResolved({ request: cacheKey, label: allLabels.join(", ") });
              }
            });
          }
        })
        .catch(() => {
          const base = endpoint.split("?")[0];
          Promise.all(
            ids.map((id) =>
              api
                .get(`${base}/${encodeURIComponent(id)}`)
                .then((res) => {
                  const rowData = res?.data ?? res;
                  return extractLabel(rowData) || id;
                })
                .catch(() => id),
            ),
          ).then((allLabels) => {
            if (!cancelled) {
              setResolved({ request: cacheKey, label: allLabels.join(", ") });
            }
          });
        });
    } else {
      const base = endpoint.split("?")[0];
      Promise.all(
        ids.map((id) =>
          api
            .get(`${base}/${encodeURIComponent(id)}`)
            .then((res) => {
              const rowData = res?.data ?? res;
              return extractLabel(rowData) || id;
            })
            .catch(() => id),
        ),
      ).then((allLabels) => {
        if (!cancelled) {
          setResolved({ request: cacheKey, label: allLabels.join(", ") });
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [canFetch, endpoint, usesList, cacheKey, rawIdsStr, field]);

  if (isEntity) {
    if (!canFetch) return <>{rawIds.join(", ")}</>;
    if (resolved?.request === cacheKey) {
      return <>{resolved.label || "Reference unavailable"}</>;
    }
    return <>Loading reference…</>;
  }

  if (field?.type === "image" && typeof value === "string" && value) {
    const src = value.startsWith("http") ? value : `${API_ORIGIN}${value}`;
    return (
      <div className="flex items-center gap-3">
        <img
          src={src}
          alt={field.label || "Image"}
          className="h-14 w-14 rounded border object-cover cursor-pointer"
          onClick={() => window.open(src, "_blank")}
        />
        <a href={src} target="_blank" rel="noreferrer" className="underline text-xs" style={{ color: "var(--accent)" }}>
          View full image
        </a>
      </div>
    );
  }
  return <>{formatMasterValue(value, field)}</>;
}
