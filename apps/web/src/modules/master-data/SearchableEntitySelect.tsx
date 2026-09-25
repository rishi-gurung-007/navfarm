"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, Check, Plus, List, Loader2, X } from "lucide-react";
import { Popover, usePopoverSurface } from "@/components/ui/popover";

type Row = Record<string, any>;

/**
 * The panel content of a searchable select. Split out from the trigger/anchor
 * so it can call `usePopoverSurface()` — it only exists (and only mounts) while
 * the popover is open, so its own state (the query, the highlighted row) is
 * naturally fresh on every opening without an extra reset effect.
 */
function SearchableEntityPanel({
  options,
  valueKey,
  getLabel,
  getLabelParts,
  value,
  onPick,
  searchPlaceholder,
  noMatchesLabel,
  ariaLabel,
  loading,
  onClear,
  onCreate,
  onViewAll,
}: {
  options: Row[];
  valueKey: string;
  getLabel: (row: Row) => string;
  getLabelParts?: (row: Row) => string[];
  value: string;
  onPick: (row: Row) => void;
  searchPlaceholder: string;
  noMatchesLabel: string;
  ariaLabel: string;
  loading: boolean;
  onClear?: () => void;
  onCreate?: () => void;
  onViewAll?: () => void;
}) {
  const { close } = usePopoverSurface();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // One row's columns. Without `getLabelParts` there is exactly one column and
  // the list looks as it always did.
  const partsOf = (row: Row) => {
    const parts = getLabelParts?.(row);
    return parts && parts.length ? parts : [getLabel(row)];
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Matched against every column as well as the joined label, so typing the
    // farm name still finds a breed whose only match is in the last column.
    return options.filter((o) =>
      [getLabel(o), ...(getLabelParts?.(o) || [])].join(" ").toLowerCase().includes(q),
    );
  }, [options, query, getLabel, getLabelParts]);

  // The widest row decides the column count, so a row missing its last value
  // still lines its first columns up with the rows around it.
  const columnCount = useMemo(
    () => (getLabelParts ? filtered.reduce((widest, o) => Math.max(widest, getLabelParts(o).length), 1) : 1),
    [filtered, getLabelParts],
  );
  // The code column sizes to its content; the prose columns share what is left
  // and truncate. `subgrid` is what keeps the boundary in the same place down
  // the whole list — each option is its own button, so without it every row
  // would size its own columns and nothing would line up.
  const columnar = columnCount > 1;
  const listTemplate = columnar
    ? ["max-content", ...Array(columnCount - 1).fill("minmax(0,1fr)"), "auto"].join(" ")
    : undefined;

  const selectedIdx = useMemo(() => {
    return filtered.findIndex((o) => String(o[valueKey]) === String(value));
  }, [filtered, valueKey, value]);

  const [highlight, setHighlight] = useState(selectedIdx >= 0 ? selectedIdx : 0);

  // The option elements, not every child: the loading and empty-state rows are
  // children of the same list, so indexing children directly can point one row
  // off the highlighted option.
  const optionEl = (idx: number) =>
    listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[idx];

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    if (selectedIdx >= 0 && listRef.current) {
      const activeEl = listRef.current.querySelectorAll<HTMLElement>('[role="option"]')[selectedIdx];
      activeEl?.scrollIntoView({ block: "nearest" });
    }
  }, []);

  useEffect(() => {
    setHighlight(selectedIdx >= 0 ? selectedIdx : 0);
  }, [query, selectedIdx]);

  function pick(row: Row) {
    onPick(row);
    close();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => {
        const next = Math.min(h + 1, Math.max(0, filtered.length - 1));
        optionEl(next)?.scrollIntoView({ block: "nearest" });
        return next;
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => {
        const prev = Math.max(h - 1, 0);
        optionEl(prev)?.scrollIntoView({ block: "nearest" });
        return prev;
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[highlight]) pick(filtered[highlight]);
    }
  }

  return (
    <div className="flex w-full min-h-0 flex-col gap-1.5 p-1">
      <div className="relative shrink-0">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-label={ariaLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={searchPlaceholder}
          className="nf-input-sm w-full"
          style={{
            backgroundColor: "var(--input-bg)",
            color: "var(--input-text)",
            borderColor: "var(--input-border)",
            paddingLeft: "1.75rem",
          }}
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={ariaLabel}
        className={`min-h-0 overflow-y-auto overscroll-contain gap-0.5 pr-0.5 ${columnar ? "grid" : "flex flex-col"}`}
        style={columnar ? { maxHeight: "240px", gridTemplateColumns: listTemplate } : { maxHeight: "240px" }}
      >
        {loading ? (
          <div role="status" aria-live="polite" className="px-2.5 py-3 text-xs" style={{ color: "var(--text-muted)", gridColumn: "1 / -1" }}>
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden />
            Loading records…
          </div>
        ) : filtered.length === 0 && (
          <div className="px-2.5 py-3 text-xs" style={{ color: "var(--text-muted)", gridColumn: "1 / -1" }}>
            {noMatchesLabel}
          </div>
        )}
        {filtered.map((o, idx) => {
          const v = String(o[valueKey]);
          const isSelected = v === String(value);
          const isHighlighted = idx === highlight;
          const cells = partsOf(o);
          return (
            <button
              key={v}
              type="button"
              role="option"
              aria-selected={isSelected}
              // The columns would otherwise be read out as separate words. The
              // option keeps naming itself with the same joined label the
              // trigger shows, so screen readers and specs see no change.
              aria-label={getLabel(o)}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => pick(o)}
              className={`shrink-0 items-center w-full min-h-[34px] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm transition-colors cursor-pointer ${columnar ? "grid gap-x-3" : "flex justify-between"}`}
              style={{
                backgroundColor: isHighlighted ? "var(--surface-secondary)" : "transparent",
                color: "var(--text-primary)",
                fontWeight: isSelected ? 600 : 400,
                ...(columnar ? { gridColumn: "1 / -1", gridTemplateColumns: "subgrid" } : null),
              }}
            >
              {columnar ? (
                <>
                  {Array.from({ length: columnCount }, (_, col) => (
                    <span
                      key={col}
                      className={col === 0 ? "whitespace-nowrap" : "truncate"}
                      style={col === 0 ? undefined : { color: "var(--text-secondary)" }}
                    >
                      {cells[col] ?? ""}
                    </span>
                  ))}
                  <span className="flex w-4 shrink-0 justify-end">
                    {isSelected && <Check className="h-4 w-4" style={{ color: "var(--accent)" }} />}
                  </span>
                </>
              ) : (
                <>
                  <span className="truncate pr-2">{cells[0]}</span>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
      {(onClear || onCreate || onViewAll) && (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--border-subtle) px-1 pt-2">
          {/* The native <select> this replaced carried a blank option, which is
              how an optional field was emptied again after a wrong pick. The
              list has no blank row, so without this an optional field could be
              changed but never un-set. Sits first, away from the actions. */}
          {onClear && (
            <button
              type="button"
              onClick={() => { close(); onClear(); }}
              aria-label={`Clear ${ariaLabel}`}
              className="nf-press me-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) px-2 py-1 text-xs font-semibold text-(--text-primary)"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear
            </button>
          )}
          {onCreate && (
            <button
              type="button"
              onClick={() => { close(); onCreate(); }}
              aria-label={`New ${ariaLabel}`}
              className="nf-press inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) px-2 py-1 text-xs font-semibold text-(--text-primary)"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New
            </button>
          )}
          {onViewAll && (
            <button
              type="button"
              onClick={() => { close(); onViewAll(); }}
              aria-label={`View All ${ariaLabel}`}
              className="nf-press inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) px-2 py-1 text-xs font-semibold text-(--text-primary)"
            >
              <List className="h-3.5 w-3.5" aria-hidden />
              View All
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface SearchableEntitySelectProps {
  id?: string;
  ariaLabel: string;
  ariaRequired?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: Row[];
  valueKey: string;
  getLabel: (row: Row) => string;
  /** One option row's columns, in order — the open list renders them as aligned
   * columns instead of one joined line. Omitted, the list stays single-column
   * on `getLabel`, so every existing call site is unaffected. The trigger always
   * shows `getLabel`. */
  getLabelParts?: (row: Row) => string[];
  disabled?: boolean;
  loading?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  noMatchesLabel: string;
  /** Empties the field. Pass only for an optional field that currently holds a
   * value — a required one has nothing valid to be cleared to. */
  onClear?: () => void;
  onCreate?: () => void;
  onViewAll?: () => void;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}

/** A single-select entity dropdown with an in-panel text filter, for catalogs long enough that
 * scrolling a native `<select>` stops being usable. Built on the shared `Popover` primitive so
 * open/close, outside-click and Escape all match every other overlay in the app. */
export function SearchableEntitySelect({
  id,
  ariaLabel,
  ariaRequired,
  value,
  onChange,
  options,
  valueKey,
  getLabel,
  getLabelParts,
  disabled,
  loading = false,
  placeholder,
  searchPlaceholder,
  noMatchesLabel,
  onClear,
  onCreate,
  onViewAll,
  triggerClassName,
  triggerStyle,
}: SearchableEntitySelectProps) {
  const [open, setOpen] = useState(false);
  const unavailable = disabled || loading;
  // A field can go from enabled to disabled mid-interaction (e.g. its restrictOptionsBy
  // selector changes while this panel is open), or its options can begin loading — force it
  // closed rather than leave an open panel over a now-disabled trigger.
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);

  const selected = options.find((o) => String(o[valueKey]) === String(value));

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      haspopup="listbox"
      className="w-full"
      panelClassName="nf-combobox-panel"
      // Every one of these lives inside the Master create/edit Dialog, whose
      // body scrolls. An anchored panel is clipped by that scroll container —
      // the options below the fold simply could not be reached — so this is
      // the case the floating layer exists for.
      floating
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          id={id}
          aria-label={ariaLabel}
          aria-required={ariaRequired}
          aria-busy={loading || undefined}
          disabled={unavailable}
          className={`nf-input nf-select w-full truncate text-left disabled:cursor-not-allowed disabled:opacity-70 ${triggerClassName || ""}`}
          style={{
            backgroundColor: "var(--input-bg)",
            color: selected ? "var(--input-text)" : "var(--text-muted)",
            borderColor: "var(--input-border)",
            ...triggerStyle,
          }}
        >
          {loading ? "Loading records…" : selected ? getLabel(selected) : placeholder}
        </button>
      )}
    >
      <SearchableEntityPanel
        options={options}
        valueKey={valueKey}
        getLabel={getLabel}
        getLabelParts={getLabelParts}
        value={value}
        onPick={(row) => onChange(String(row[valueKey]))}
        searchPlaceholder={searchPlaceholder}
        noMatchesLabel={noMatchesLabel}
        ariaLabel={ariaLabel}
        loading={loading}
        onClear={onClear}
        onCreate={onCreate}
        onViewAll={onViewAll}
      />
    </Popover>
  );
}
