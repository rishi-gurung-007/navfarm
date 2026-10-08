"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Check, Sparkles, RotateCcw, ChevronDown, Layers, Hash } from "lucide-react";
import { api } from "@/services/api-client";
import { Popover, usePopoverSurface } from "@/components/ui/popover";

export interface LotOption {
  [key: string]: any;
  lot_no: string;
  remaining_quantity: string;
  expiry_date: string | null;
  posting_date: string;
  /** What a draw on this lot costs per unit (what is left of it, valued layer by layer). */
  unit_cost?: number;
  expired?: boolean;
  /** The lot to use unless the user chooses otherwise: earliest expiry, then oldest receipt, never expired. */
  suggested?: boolean;
}

export interface SerialOption {
  [key: string]: any;
  serial_no: string;
  expiry_date?: string | null;
  posting_date: string;
  remaining_quantity?: number | string;
  unit_cost?: number;
}

export interface LotSerialPickerProps {
  itemId: string;
  warehouseId?: string;
  trackingType: "LOT" | "SERIAL" | "NONE";
  value: string;
  onChange: (value: string, selectedOption?: LotOption | SerialOption | Array<LotOption | SerialOption>) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  align?: "start" | "end";
  excludedValues?: string[];
  multiSelect?: boolean;
  targetQuantity?: number;
  fullWidth?: boolean;
  /** Lots only: once the list loads and nothing is chosen, choose the suggested lot. The user can change it. */
  autoSelectSuggested?: boolean;
  /** Called with the loaded options, so a caller can preview what a selection will draw. */
  onOptions?: (options: Array<LotOption | SerialOption>) => void;
  /** Change it to reload the list — stock moves when entries post, so a list loaded earlier is out of date. */
  refreshKey?: string | number;
}

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

/**
 * The panel content — supports single-select (LOT) and multi-select (SERIAL)
 * with search, quick actions (FIFO, Select All), and clean column alignment.
 */
function LotSerialPanel({
  options,
  valueKey,
  trackingType,
  value,
  multiSelect,
  targetQuantity,
  onPickSingle,
  onPickMulti,
  onClearValue,
  loading,
  excludedValues = [],
  fullWidth = false,
}: {
  options: Array<LotOption | SerialOption>;
  valueKey: string;
  trackingType: "LOT" | "SERIAL";
  value: string;
  multiSelect: boolean;
  targetQuantity?: number;
  onPickSingle: (row: any) => void;
  onPickMulti: (newVal: string, rows: any[]) => void;
  onClearValue?: () => void;
  loading: boolean;
  excludedValues?: string[];
  fullWidth?: boolean;
}) {
  const { close } = usePopoverSurface();
  const [query, setQuery] = useState("");

  const excludedSet = useMemo(() => new Set(excludedValues), [excludedValues]);

  // Selected values set for multi-select
  const selectedSet = useMemo(() => {
    if (!value) return new Set<string>();
    return new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o: any) => {
      const main = String(o[valueKey] || "").toLowerCase();
      const exp = o.expiry_date ? String(o.expiry_date).toLowerCase() : "";
      const date = o.posting_date ? String(o.posting_date).toLowerCase() : "";
      return main.includes(q) || exp.includes(q) || date.includes(q);
    });
  }, [options, query, valueKey]);

  const availableUnexcluded = useMemo(() => {
    return options.filter((o: any) => !excludedSet.has(String(o[valueKey])));
  }, [options, excludedSet, valueKey]);

  // Multi-select toggle
  function handleToggleRow(row: any) {
    const v = String(row[valueKey]);
    const next = new Set(selectedSet);
    if (next.has(v)) {
      next.delete(v);
    } else {
      next.add(v);
    }
    const nextArr = Array.from(next);
    const nextStr = nextArr.join(", ");
    const pickedRows = options.filter((o: any) => next.has(String(o[valueKey])));
    onPickMulti(nextStr, pickedRows);
  }

  // Multi-select Select All / Deselect All
  function handleToggleAll() {
    const allSelected = availableUnexcluded.length > 0 && availableUnexcluded.every((o: any) => selectedSet.has(String(o[valueKey])));
    if (allSelected) {
      onPickMulti("", []);
    } else {
      const nextArr = availableUnexcluded.map((o: any) => String(o[valueKey]));
      onPickMulti(nextArr.join(", "), availableUnexcluded);
    }
  }

  // Auto-select FIFO based on targetQuantity
  function handleAutoFifo() {
    if (!targetQuantity || targetQuantity <= 0) return;
    const targetCount = Math.min(targetQuantity, availableUnexcluded.length);
    const picked = availableUnexcluded.slice(0, targetCount);
    const nextArr = picked.map((o: any) => String(o[valueKey]));
    onPickMulti(nextArr.join(", "), picked);
  }

  function handleSinglePick(row: any) {
    onPickSingle(row);
    close();
  }

  const isLot = trackingType === "LOT";
  const gridTemplate = isLot
    ? "24px minmax(130px, 1fr) 100px 105px"
    : "24px minmax(160px, 1fr) 125px 115px";

  const selectedCount = selectedSet.size;

  return (
    <div
      className={`flex max-h-[420px] ${
        fullWidth ? "w-full max-w-full" : "w-[340px] sm:w-[380px] max-w-[calc(100vw-24px)]"
      } flex-col p-2 bg-[var(--surface-raised)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-2xl backdrop-blur-md`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-1.5 pb-2 border-b border-[var(--border-subtle)] shrink-0 gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-bold tracking-wider uppercase text-[var(--accent)] flex items-center gap-1 shrink-0">
            {multiSelect ? <Hash className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
            {isLot ? "Lot Tracking" : "Serials"}
          </span>
          {multiSelect && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border shrink-0 ${
                selectedCount > 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-[var(--surface-muted)] text-[var(--text-muted)] border-[var(--border-subtle)]"
              }`}
            >
              {selectedCount}
            </span>
          )}
        </div>

        {multiSelect && (
          <div className="flex items-center gap-1 shrink-0">
            {!isLot && targetQuantity && targetQuantity > 0 && availableUnexcluded.length > 0 && (
              <button
                type="button"
                onClick={handleAutoFifo}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
                title={`Auto-select first ${targetQuantity} serials in FIFO order`}
              >
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span>Auto ({targetQuantity})</span>
              </button>
            )}
            {!isLot && <button
              type="button"
              onClick={handleToggleAll}
              disabled={availableUnexcluded.length === 0}
              className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors disabled:opacity-50"
            >
              {selectedCount === availableUnexcluded.length && availableUnexcluded.length > 0 ? "Deselect" : "All"}
            </button>}
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() => onPickMulti("", [])}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-secondary)] transition-colors"
                title="Clear selection"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Search Input */}
      <div className="relative shrink-0 px-1 py-1.5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${trackingType.toLowerCase()} number, expiry…`}
          className="w-full rounded-[var(--radius-sm)] border py-1.5 pl-8 pr-7 text-xs outline-none focus:border-[var(--accent)]"
          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--input-text)" }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Table Column Headers */}
      <div
        role="presentation"
        aria-hidden="true"
        className="grid shrink-0 items-center gap-x-2 border-b px-2 py-1 text-[10px] font-bold uppercase tracking-wider select-none"
        style={{
          gridTemplateColumns: gridTemplate,
          color: "var(--text-muted)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <span />
        <span>{isLot ? "Lot No." : "Serial No."}</span>
        {isLot ? (
          <>
            <span className="text-right">Available</span>
            <span className="text-right">Expiry</span>
          </>
        ) : (
          <>
            <span className="text-right">Expiry</span>
            <span className="text-right">Received</span>
          </>
        )}
      </div>

      {/* Options List */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 space-y-0.5">
        {loading ? (
          <div className="px-2.5 py-4 text-center text-xs text-[var(--text-muted)]">Loading stock options…</div>
        ) : filtered.length === 0 ? (
          <div className="px-2.5 py-4 text-center text-xs text-[var(--text-muted)]">
            {`No available ${trackingType.toLowerCase()}s found`}
          </div>
        ) : (
          filtered.map((row: any) => {
            const v = String(row[valueKey]);
            const isSelected = multiSelect ? selectedSet.has(v) : v === String(value);
            const isExcluded = !isSelected && excludedSet.has(v);
            const exp = row.expiry_date ? String(row.expiry_date).slice(0, 10) : "—";
            const postDate = row.posting_date ? String(row.posting_date).slice(0, 10) : "—";

            return (
              <button
                type="button"
                key={v}
                disabled={isExcluded}
                onClick={() => {
                  if (isExcluded) return;
                  if (multiSelect) handleToggleRow(row);
                  else handleSinglePick(row);
                }}
                className={`grid w-full items-center gap-x-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-xs text-left transition-colors ${
                  isExcluded
                    ? "opacity-40 cursor-not-allowed bg-[var(--surface-muted)]"
                    : isSelected
                    ? "bg-[var(--accent-muted)] font-medium"
                    : "hover:bg-[var(--surface-secondary)] cursor-pointer"
                }`}
                style={{
                  gridTemplateColumns: gridTemplate,
                }}
              >
                {/* Checkbox or Radio Icon */}
                <div className="flex h-4 w-4 items-center justify-center shrink-0">
                  {multiSelect ? (
                    isSelected ? (
                      <div className="h-4 w-4 rounded-[3px] bg-[var(--accent)] flex items-center justify-center text-white shadow-xs">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="h-4 w-4 rounded-[3px] border border-[var(--border)] hover:border-[var(--accent)] transition-colors" />
                    )
                  ) : (
                    isSelected ? (
                      <div className="h-3.5 w-3.5 rounded-full bg-[var(--accent)] flex items-center justify-center text-white">
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border border-[var(--border)]" />
                    )
                  )}
                </div>

                {/* Primary Identifer (Lot or Serial) */}
                <div className="min-w-0">
                  <div className="truncate font-mono font-medium flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                    <span className="truncate">{isLot ? row.lot_no : row.serial_no}</span>
                    {isExcluded && (
                      <span className="text-[9px] text-[var(--danger)] font-normal shrink-0">
                        (Assigned)
                      </span>
                    )}
                  </div>
                  {(row.suggested || row.expired || row.unit_cost != null) && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
                      {row.suggested && (
                        <span className="rounded px-1 font-semibold" style={{ background: "var(--accent-muted)", color: "var(--accent)" }}>Suggested</span>
                      )}
                      {row.expired && (
                        <span className="rounded px-1 font-semibold" style={{ color: "var(--danger)" }}>Expired</span>
                      )}
                      {row.unit_cost != null && <span className="font-mono">cost {Number(row.unit_cost).toFixed(2)}</span>}
                    </div>
                  )}
                </div>

                {isLot ? (
                  <>
                    <span className="text-right font-mono" style={{ color: "var(--text-secondary)" }}>
                      {row.remaining_quantity ?? "0"}
                    </span>
                    <span
                      className={`text-right font-mono text-[11px] ${row.expiry_date ? "font-semibold" : ""}`}
                      style={{ color: row.expiry_date ? "var(--text-primary)" : "var(--text-muted)" }}
                    >
                      {exp}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className={`text-right font-mono text-[11px] ${row.expiry_date ? "font-semibold" : ""}`}
                      style={{ color: row.expiry_date ? "var(--text-primary)" : "var(--text-muted)" }}
                    >
                      {exp}
                    </span>
                    <span className="text-right font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {postDate}
                    </span>
                  </>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Footer Bar */}
      {multiSelect ? (
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-2 pt-2 pb-0.5">
          <div className="text-xs text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)] font-mono">{selectedCount}</strong> {isLot ? (selectedCount === 1 ? "lot" : "lots") : selectedCount === 1 ? "serial" : "serials"} selected
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => close()}
              className="px-3 py-1 rounded-[var(--radius-sm)] text-xs font-semibold bg-[var(--accent)] text-white hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Done</span>
            </button>
          </div>
        </div>
      ) : (
        onClearValue && value && (
          <div className="flex shrink-0 justify-end border-t px-1 pt-2" style={{ borderColor: "var(--border-subtle)" }}>
            <button
              type="button"
              onClick={() => { close(); onClearValue(); }}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs font-semibold"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)", color: "var(--text-primary)" }}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear
            </button>
          </div>
        )
      )}
    </div>
  );
}

export function LotSerialPicker({
  itemId,
  warehouseId,
  trackingType,
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  triggerClassName,
  triggerStyle,
  align = "end",
  excludedValues = [],
  multiSelect,
  targetQuantity,
  fullWidth,
  autoSelectSuggested,
  onOptions,
  refreshKey,
}: LotSerialPickerProps) {
  const [options, setOptions] = useState<Array<LotOption | SerialOption>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Opening the list reloads it, so what the user picks from is what the location holds now.
  const [openedCount, setOpenedCount] = useState(0);
  useEffect(() => {
    if (open) setOpenedCount((n) => n + 1);
  }, [open]);

  const isMulti = multiSelect ?? (trackingType === "SERIAL");

  useEffect(() => {
    if (!itemId || trackingType === "NONE") {
      setOptions([]);
      return;
    }

    let active = true;
    setLoading(true);

    const endpoint =
      trackingType === "LOT"
        ? "/inventory-ledger/available-lots"
        : "/inventory-ledger/available-serials";

    const params = new URLSearchParams();
    params.set("item_id", itemId);
    if (warehouseId) {
      params.set("warehouse_id", warehouseId);
    }

    api
      .get(`${endpoint}?${params.toString()}`)
      .then((res) => {
        if (!active) return;
        const list = unwrap<any[]>(res) || [];
        setOptions(list);
        onOptions?.(list);
      })
      .catch((err) => {
        console.error("Failed to load available lots/serials:", err);
        if (active) setOptions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [itemId, warehouseId, trackingType, refreshKey, openedCount]);

  const valueKey = trackingType === "LOT" ? "lot_no" : "serial_no";

  // Choose the suggested lot once the list is in, when the user has chosen nothing — so entering
  // today's feed is one step, and picking a different lot is a deliberate one.
  const autoPicked = useRef<string>("");
  useEffect(() => {
    if (!autoSelectSuggested || trackingType !== "LOT" || loading || disabled || value) return;
    const suggested = (options as LotOption[]).find((o) => o.suggested);
    const stamp = `${itemId}|${warehouseId ?? ""}`;
    if (!suggested || autoPicked.current === stamp) return;
    autoPicked.current = stamp;
    onChange(String(suggested.lot_no), suggested);
  }, [autoSelectSuggested, trackingType, loading, disabled, value, options, itemId, warehouseId]);

  const selectedList = useMemo(() => {
    if (!value) return [];
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }, [value]);

  const unavailable = disabled || !itemId || (options.length === 0 && !loading && !value);
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);

  const defaultPlaceholder = !itemId
    ? "Select item first…"
    : loading
    ? "Loading options…"
    : options.length === 0
    ? `No available ${trackingType.toLowerCase()}s`
    : `Select ${trackingType.toLowerCase()}…`;

  // Render Trigger Button content
  let displayNode: React.ReactNode;
  if (!value) {
    displayNode = (
      <div className="flex items-center justify-between w-full">
        <span className="truncate text-[var(--text-muted)]">{placeholder || defaultPlaceholder}</span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-70 shrink-0 ml-1" />
      </div>
    );
  } else if (isMulti) {
    const count = selectedList.length;
    displayNode = (
      <div className="flex items-center justify-between w-full gap-1.5" title={value}>
        <div className="flex items-center gap-1.5 truncate">
          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--accent)] text-white shrink-0">
            {count}
          </span>
          <span className="truncate font-mono text-xs font-medium text-[var(--input-text)]">
            {selectedList.slice(0, 2).join(", ")}{count > 2 ? ` +${count - 2} more` : ""}
          </span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-70 shrink-0 ml-1" />
      </div>
    );
  } else {
    const selected = options.find((o: any) => String(o[valueKey]) === String(value));
    const hasSuggestion = (options as LotOption[]).some((o) => o.suggested);
    const expirySuffix =
      (selected?.expiry_date ? ` (Exp: ${String(selected.expiry_date).slice(0, 10)})` : "") +
      (selected && hasSuggestion && !(selected as LotOption).suggested ? " · not the suggested lot" : "");
    displayNode = (
      <div className="flex items-center justify-between w-full gap-1.5" title={`${value}${expirySuffix}`}>
        <span className="truncate text-[var(--input-text)]">
          {value}{expirySuffix}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-70 shrink-0 ml-1" />
      </div>
    );
  }

  if (trackingType === "NONE") return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align={fullWidth ? "start" : align}
      haspopup="listbox"
      className="w-full"
      panelClassName="nf-tracking-popover-panel"
      floating
      matchTriggerWidth={fullWidth}
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          aria-label={ariaLabel || `Select ${trackingType}`}
          disabled={unavailable}
          className={`nf-input-sm nf-select w-full truncate text-left text-xs disabled:cursor-not-allowed disabled:opacity-70 ${triggerClassName || ""}`}
          style={{
            backgroundColor: "var(--input-bg)",
            color: value ? "var(--input-text)" : "var(--text-muted)",
            borderColor: value ? "var(--accent)" : "var(--input-border)",
            ...triggerStyle,
          }}
        >
          {displayNode}
        </button>
      )}
    >
      <LotSerialPanel
        options={options}
        valueKey={valueKey}
        trackingType={trackingType}
        value={value}
        multiSelect={isMulti}
        targetQuantity={targetQuantity}
        fullWidth={fullWidth}
        onPickSingle={(row) => onChange(String(row[valueKey]), row)}
        onPickMulti={(newVal, rows) => onChange(newVal, rows)}
        onClearValue={() => onChange("", undefined)}
        loading={loading}
        excludedValues={excludedValues}
      />
    </Popover>
  );
}

export default LotSerialPicker;
