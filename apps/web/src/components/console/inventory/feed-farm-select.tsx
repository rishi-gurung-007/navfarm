"use client";

/**
 * The farm picker of the feed screens (A5, S3): "CODE — Name" in code order,
 * grouped by company when the tenant-wide workspace lists more than one. A
 * farm login's farm is shown, not offered (D13).
 */
import { useMemo } from "react";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { FeedFarm } from "./use-feed-farm";

export function feedFarmLabel(f: { code: string; name: string }): string {
  return `${f.code} — ${f.name}`;
}

export function FeedFarmSelect({
  id,
  label,
  farms,
  farmId,
  onChange,
  fixedLabel,
  allLabel,
}: {
  id: string;
  label: string;
  farms: FeedFarm[];
  farmId: string | null;
  onChange: (farmId: string) => void;
  fixedLabel?: string | null;
  allLabel?: string;
}) {
  const { t } = useLanguage();
  const unavailable = t("fsdNotAvailable");
  if (fixedLabel !== undefined) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="nf-text-label text-(--text-secondary)">{label}</span>
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{fixedLabel || unavailable}</p>
      </div>
    );
  }
  const list = Array.isArray(farms) ? farms : [];
  const byCompany = new Map<string, FeedFarm[]>();
  for (const f of list) {
    const key = f.companyName ?? "";
    byCompany.set(key, [...(byCompany.get(key) ?? []), f]);
  }
  const option = (f: FeedFarm) => <option key={f.farmId} value={f.farmId}>{feedFarmLabel(f)}</option>;

  const farmOptions = useMemo(() => {
    const opts: Array<{ farmId: string; code: string; name: string; label: string }> = [];
    if (allLabel !== undefined) {
      opts.push({ farmId: "", code: "ALL", name: allLabel, label: allLabel });
    }
    for (const f of list) {
      opts.push({
        farmId: f.farmId,
        code: f.code,
        name: f.companyName ? `${f.name} (${f.companyName})` : f.name,
        label: feedFarmLabel(f),
      });
    }
    return opts;
  }, [allLabel, list]);

  return (
    <Field label={label} htmlFor={id}>
      <div className="relative min-w-[12rem]">
        {/* Visual dropdown: Farm Master searchable popover dropdown UI */}
        <SearchableSelect
          value={farmId ?? ""}
          onChange={onChange}
          options={farmOptions}
          valueKey="farmId"
          labelKey="label"
          columnHeaders={["Code", "Farm Name"]}
          columns={[
            { key: "code", label: "Code" },
            { key: "name", label: "Farm Name" },
          ]}
          placeholder={allLabel || "Select farm…"}
          searchPlaceholder="Search farm…"
          triggerClassName="nf-input-sm min-w-[12rem] h-9"
        />
        {/* Synchronized select keeps HTML forms, access keys and test specs in sync */}
        <select
          id={id}
          value={farmId ?? ""}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
          className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
        >
          {allLabel !== undefined && <option value="">{allLabel}</option>}
          {byCompany.size > 1
            ? [...byCompany].map(([company, farmsOf]) => (
                <optgroup key={company} label={company || unavailable}>{farmsOf.map(option)}</optgroup>
              ))
            : list.map(option)}
        </select>
      </div>
    </Field>
  );
}

