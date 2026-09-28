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
  columnHeaders?: string[] | false;
  columns?: Array<{ key: string; label: string }>;
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
 * Supports table-like multi-column layout with headers ("Code", "Name").
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
  columnHeaders,
  columns,
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
    if (row.code != null && row.name != null) return `${row.code} — ${row.name}`;
    if (row.name != null) return String(row.name);
    if (row.title != null) return String(row.title);
    if (row.code != null) return String(row.code);
    if (row[valueKey] != null) return String(row[valueKey]);
    return "";
  };

  const effectiveColumnHeaders = useMemo(() => {
    // If explicitly provided as false or empty array, disable headers
    if (columnHeaders === false || (Array.isArray(columnHeaders) && columnHeaders.length === 0)) {
      return undefined;
    }
    if (Array.isArray(columnHeaders) && columnHeaders.length > 0) return columnHeaders;
    if (columns && columns.length > 0) return columns.map((c) => c.label);

    if (normalizedOptions.length === 0) return undefined;

    const nonEmptyOptions = normalizedOptions.filter((opt) => {
      const val = opt[valueKey];
      return val !== "" && val != null;
    });

    if (nonEmptyOptions.length === 0) return undefined;

    // Check if ALL non-empty options have explicit code and name/description
    const allHaveExplicitCodeAndName = nonEmptyOptions.every(
      (opt) =>
        opt.code != null &&
        String(opt.code).trim().length > 0 &&
        String(opt.code).trim().length <= 25 &&
        (opt.name != null || opt.description != null || opt.title != null)
    );
    if (allHaveExplicitCodeAndName) {
      return ["Code", "Name"];
    }

    // Check if ALL non-empty options have genuine delimited "CODE — NAME" or "CODE - NAME"
    const allHaveDelimitedCodeAndName = nonEmptyOptions.every((opt) => {
      const lbl = defaultGetLabel(opt);
      if (!lbl) return false;
      const match = lbl.split(/\s+[—–-]\s+/);
      if (match.length >= 2) {
        const codePart = match[0].trim();
        const namePart = match.slice(1).join(" — ").trim();
        // A genuine code is concise (<= 25 chars), not a sentence, and not starting with "All"
        const isCodeLike =
          codePart.length > 0 &&
          codePart.length <= 25 &&
          !/^all\b/i.test(codePart) &&
          codePart.split(/\s+/).length <= 3;
        return isCodeLike && namePart.length > 0;
      }
      return false;
    });

    if (allHaveDelimitedCodeAndName) {
      return ["Code", "Name"];
    }

    return undefined;
  }, [columnHeaders, columns, normalizedOptions, valueKey]);

  const effectiveGetLabelParts = useMemo(() => {
    if (getLabelParts) return getLabelParts;

    if (columns && columns.length > 0) {
      return (row: Row) =>
        columns.map((c) => (row[c.key] != null ? String(row[c.key]) : ""));
    }

    if (effectiveColumnHeaders && effectiveColumnHeaders.length > 0) {
      return (row: Row) => {
        if (
          row.code != null &&
          (row.name != null || row.description != null || row.title != null)
        ) {
          return [
            String(row.code ?? ""),
            String(row.name ?? row.description ?? row.title ?? ""),
          ];
        }

        const lbl = defaultGetLabel(row);
        const match = lbl.split(/\s+[—–-]\s+/);
        if (match.length >= 2) {
          return [match[0].trim(), match.slice(1).join(" — ").trim()];
        }

        return [lbl, ""];
      };
    }

    return undefined;
  }, [getLabelParts, columns, effectiveColumnHeaders]);

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
      getLabelParts={effectiveGetLabelParts}
      columnHeaders={effectiveColumnHeaders}
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
