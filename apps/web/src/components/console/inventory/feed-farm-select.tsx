"use client";

/**
 * The farm picker of the feed screens (A5, S3): "CODE — Name" in code order,
 * grouped by company when the tenant-wide workspace lists more than one. A
 * farm login's farm is shown, not offered (D13).
 */
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import type { FeedFarm } from "./use-feed-farm";

export function feedFarmLabel(f: { code: string; name: string }): string {
  return `${f.code} — ${f.name}`;
}

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

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
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className="nf-input-sm nf-select w-full min-w-[11rem]" style={inputStyle} value={farmId ?? ""} onChange={(e) => onChange(e.target.value)}>
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {byCompany.size > 1
          ? [...byCompany].map(([company, farmsOf]) => (
              <optgroup key={company} label={company || unavailable}>{farmsOf.map(option)}</optgroup>
            ))
          : list.map(option)}
      </select>
    </Field>
  );
}
