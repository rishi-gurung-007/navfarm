"use client";

import React, { useMemo } from "react";
import { SearchableEntitySelect } from "@/modules/master-data/SearchableEntitySelect";

type Row = Record<string, unknown>;

export interface SearchableSelectProps {
  id?: string;
  ariaLabel?: string;
  ariaRequired?: boolean;
  value?: string | null;
  onChange: (value: string) => void;
  options: readonly (Row | string)[] | Array<Row | string>;
  valueKey?: string;
  labelKey?: string;
  getLabel?: (row: Row) => string;
  getLabelParts?: (row: Row) => string[];
  placeholder?: string;
  searchPlaceholder?: string;
  noMatchesLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  onClear?: () => void;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}

/**
 * Universal Master-styled searchable select dropdown.
 * Uses the exact same popover, floating panel, styling, search filter,
 * and keyboard navigation as the Master Data module.
 */
export function SearchableSelect({
  id,
  ariaLabel,
  ariaRequired,
  value,
  onChange,
  options,
  valueKey = "value",
  labelKey = "label",
  getLabel,
  getLabelParts,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  noMatchesLabel = "No matches found",
  disabled,
  loading,
  onClear,
  triggerClassName,
  triggerStyle,
}: SearchableSelectProps) {
  // Normalize options array so strings and objects both work seamlessly
  const normalizedOptions: Row[] = useMemo(() => {
    return (options || []).map((opt) => {
      if (typeof opt === "string") {
        return { [valueKey]: opt, [labelKey]: opt };
      }
      return opt;
    });
  }, [options, valueKey, labelKey]);

  const defaultGetLabel = (row: Row): string => {
    if (getLabel) return getLabel(row);
    if (row[labelKey] != null) return String(row[labelKey]);
    if (row.name != null) return String(row.name);
    if (row.title != null) return String(row.title);
    if (row[valueKey] != null) return String(row[valueKey]);
    return "";
  };

  return (
    <SearchableEntitySelect
      id={id}
      ariaLabel={ariaLabel || placeholder}
      ariaRequired={ariaRequired}
      value={value != null ? String(value) : ""}
      onChange={onChange}
      options={normalizedOptions}
      valueKey={valueKey}
      getLabel={defaultGetLabel}
      getLabelParts={getLabelParts}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      noMatchesLabel={noMatchesLabel}
      disabled={disabled}
      loading={loading}
      onClear={onClear}
      triggerClassName={triggerClassName}
      triggerStyle={triggerStyle}
    />
  );
}

export default SearchableSelect;
