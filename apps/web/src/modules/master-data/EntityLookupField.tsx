"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Inbox, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type LookupRow = Record<string, unknown>;

interface EntityLookupFieldProps {
  id: string;
  label: string;
  options: LookupRow[];
  value: string | string[];
  valueKey: string;
  labelKeys: string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  loading?: boolean;
  placeholder: string;
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function lookupColumns(labelKeys: string[]): { codeKey?: string; nameKey?: string } {
  const codeKey = labelKeys.find((key) => /(^|_)(code|no|number|key)$/i.test(key)) || labelKeys[0];
  const nameKey = labelKeys.find((key) => key !== codeKey && /(^|_)(name|description|label|title)$/i.test(key))
    || labelKeys.find((key) => key !== codeKey);
  return { codeKey, nameKey };
}

function rowValues(row: LookupRow, labelKeys: string[]): { code: string; name: string } {
  const { codeKey, nameKey } = lookupColumns(labelKeys);
  return {
    code: codeKey ? stringValue(row[codeKey]) : "",
    name: nameKey ? stringValue(row[nameKey]) : "",
  };
}

function rowLabel(row: LookupRow, labelKeys: string[], valueKey: string): string {
  const joined = labelKeys.map((key) => stringValue(row[key])).filter(Boolean).join(" — ");
  return joined || stringValue(row[valueKey]);
}

/**
 * Searchable picker for references to another master.
 *
 * Native selects hid most of the catalog and made similar codes difficult to
 * compare. This keeps the field compact until it is needed, then presents the
 * referenced master as the same code/name table users see elsewhere.
 */
export function EntityLookupField({
  id,
  label,
  options,
  value,
  valueKey,
  labelKeys,
  onChange,
  multiple = false,
  disabled = false,
  loading = false,
  placeholder,
}: EntityLookupFieldProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedValues = multiple
    ? (Array.isArray(value) ? value.map(String) : [])
    : [Array.isArray(value) ? "" : String(value || "")].filter(Boolean);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const selectedRows = selectedValues.map((selectedValue) => ({
    value: selectedValue,
    row: options.find((option) => stringValue(option[valueKey]) === selectedValue),
  }));

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return options;
    return options.filter((option) => {
      const { code, name } = rowValues(option, labelKeys);
      return [code, name, ...labelKeys.map((key) => stringValue(option[key]))]
        .some((part) => part.toLocaleLowerCase().includes(term));
    });
  }, [labelKeys, options, search]);

  const choose = (option: LookupRow) => {
    const nextValue = stringValue(option[valueKey]);
    if (!multiple) {
      onChange(nextValue);
      setOpen(false);
      return;
    }
    onChange(selectedValues.includes(nextValue)
      ? selectedValues.filter((entry) => entry !== nextValue)
      : [...selectedValues, nextValue]);
  };

  const clear = () => onChange(multiple ? [] : "");
  const currentLabel = !multiple && selectedRows[0]
    ? selectedRows[0].row
      ? rowLabel(selectedRows[0].row, labelKeys, valueKey)
      : `${selectedRows[0].value} — unavailable in active catalog`
    : "";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {multiple && selectedRows.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedRows.map((selected) => (
            <span key={selected.value} className="inline-flex items-center gap-1 rounded-full border border-(--border) bg-(--surface-raised) px-2 py-0.5 text-xs text-(--text-primary)">
              {selected.row ? rowLabel(selected.row, labelKeys, valueKey) : `${selected.value} — unavailable in active catalog`}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${selected.value}`}
                  onClick={() => onChange(selectedValues.filter((entry) => entry !== selected.value))}
                  className="font-semibold text-(--danger)"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <button
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="nf-input nf-press flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span className={`min-w-0 flex-1 truncate ${currentLabel ? "text-(--input-text)" : "text-(--input-placeholder)"}`}>
          {multiple ? placeholder : currentLabel || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-(--text-muted)" aria-hidden />
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Select ${label}`}
        description="Search by code or name, then select a row."
        maxWidth="lg"
        footer={(
          <>
            {selectedValues.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                Clear selection{multiple ? "s" : ""}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              {multiple ? "Done" : "Cancel"}
            </Button>
          </>
        )}
      >
        <div className="flex min-h-0 flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--text-muted)" aria-hidden />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${label.toLocaleLowerCase()} by code or name`}
              aria-label={`Search ${label}`}
              className="pl-9"
            />
          </div>

          <Table wrapperClassName="max-h-[min(28rem,55dvh)] overflow-auto">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-10 text-center text-(--text-secondary)">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-(--accent)" aria-hidden />
                    Loading records…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-10 text-center text-(--text-secondary)">
                    <Inbox className="mx-auto mb-2 h-5 w-5 text-(--text-muted)" aria-hidden />
                    {search.trim() ? "No matching records." : "No records available."}
                  </TableCell>
                </TableRow>
              ) : filtered.map((option) => {
                const optionValue = stringValue(option[valueKey]);
                const { code, name } = rowValues(option, labelKeys);
                const selected = selectedValues.includes(optionValue);
                const selectLabel = `${selected && multiple ? "Deselect" : "Select"} ${[code, name].filter(Boolean).join(" — ") || optionValue}`;
                return (
                  <TableRow
                    key={optionValue}
                    aria-selected={selected}
                    onClick={() => choose(option)}
                    className={`cursor-pointer ${selected ? "bg-(--accent-muted)" : ""}`}
                  >
                    <TableCell className="p-0 font-mono">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          choose(option);
                        }}
                        aria-label={selectLabel}
                        className="min-h-11 w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--focus-ring)"
                      >
                        {code || "—"}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-h-5 items-center justify-between gap-3">
                        <span>{name || "—"}</span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-(--accent)" aria-hidden />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Dialog>
    </div>
  );
}
