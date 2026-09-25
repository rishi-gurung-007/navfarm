"use client";

import React, { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useReasons, type ReasonRow } from "@/hooks/useReasons";

export interface ReasonSelectProps {
  id?: string;
  ariaLabel?: string;
  ariaRequired?: boolean;
  value?: string | null;
  onChange: (value: string, reasonRow?: ReasonRow) => void;
  onClear?: () => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  category?: string | string[];
  stageCode?: string;
  /**
   * Format of the value emitted to onChange:
   * - 'full': "MRT-001 — Respiratory Disease (PRRS/APP/Pneumonia)" (default, self-describing)
   * - 'name': "Respiratory Disease (PRRS/APP/Pneumonia)"
   * - 'code': "MRT-001"
   * - 'id': Reason Master UUID
   */
  valueFormat?: "full" | "name" | "code" | "id";
  reasons?: ReasonRow[];
  loading?: boolean;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}

export function ReasonSelect({
  id,
  ariaLabel = "Reason",
  ariaRequired,
  value,
  onChange,
  onClear,
  placeholder = "Select reason from master…",
  searchPlaceholder = "Search reason code, description, category…",
  disabled,
  category,
  stageCode,
  valueFormat = "full",
  reasons: propReasons,
  loading: propLoading,
  triggerClassName,
  triggerStyle,
}: ReasonSelectProps) {
  const hookResult = useReasons(propReasons ? undefined : category);
  const rawReasons = propReasons || hookResult.reasons;
  const loading = propLoading !== undefined ? propLoading : (propReasons !== undefined ? false : hookResult.loading);

  const categoryFiltered = useMemo(() => {
    if (!category) return rawReasons;
    return rawReasons.filter((r) => {
      if (Array.isArray(category)) return category.includes(r.category);
      return r.category === category;
    });
  }, [rawReasons, category]);

  // Filter by stageCode if specified and the reason specifies applicable_stages
  const filteredReasons = useMemo(() => {
    if (!stageCode) return categoryFiltered;
    return categoryFiltered.filter((r) => {
      if (!r.applicable_stages || r.applicable_stages.length === 0) return true;
      return r.applicable_stages.includes(stageCode);
    });
  }, [categoryFiltered, stageCode]);

  const options = useMemo(() => {
    const list = filteredReasons.map((r) => {
      let val = `${r.reason_code} — ${r.reason_name}`;
      if (valueFormat === "name") val = r.reason_name;
      else if (valueFormat === "code") val = r.reason_code;
      else if (valueFormat === "id") val = r.reason_id;

      return {
        value: val,
        code: r.reason_code,
        name: r.reason_name,
        category: r.category,
        raw: r,
      };
    });

    // If an existing value is passed that doesn't match any reason (e.g. legacy free-text),
    // retain it as an option so user data is never lost or blanked out
    if (value && value.trim()) {
      const exists = list.some(
        (opt) =>
          opt.value === value ||
          opt.code === value ||
          opt.name === value ||
          opt.raw.reason_id === value ||
          `${opt.code} — ${opt.name}` === value,
      );
      if (!exists) {
        list.unshift({
          value,
          code: "CUSTOM",
          name: value,
          category: "Other",
          raw: {
            reason_id: "custom",
            reason_code: "CUSTOM",
            reason_name: value,
            category: "Other",
          },
        });
      }
    }

    return list;
  }, [filteredReasons, valueFormat, value]);

  const effectiveValue = useMemo(() => {
    if (!value) return "";
    const match = options.find(
      (opt) =>
        opt.value === value ||
        opt.code === value ||
        opt.name === value ||
        opt.raw.reason_id === value ||
        `${opt.code} — ${opt.name}` === value,
    );
    return match ? match.value : value;
  }, [value, options]);

  const handlePick = (pickedVal: string) => {
    const match = options.find((opt) => opt.value === pickedVal);
    onChange(pickedVal, match?.raw);
  };

  const handleClear = onClear ? onClear : () => onChange("");

  return (
    <SearchableSelect
      id={id}
      ariaLabel={ariaLabel}
      ariaRequired={ariaRequired}
      value={effectiveValue}
      onChange={handlePick}
      onClear={handleClear}
      options={options}
      valueKey="value"
      labelKey="name"
      getLabel={(row: Record<string, unknown>) =>
        row.code === "CUSTOM"
          ? String(row.name || row.value || "")
          : `${row.code} — ${row.name}`
      }
      getLabelParts={(row: Record<string, unknown>) => [
        String(row.code ?? ""),
        String(row.name ?? ""),
        String(row.category ?? ""),
      ]}
      columnHeaders={["Code", "Description", "Category"]}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      noMatchesLabel="No matching reasons in Reason Master"
      disabled={disabled}
      loading={loading}
      triggerClassName={triggerClassName}
      triggerStyle={triggerStyle}
    />
  );
}

export default ReasonSelect;
