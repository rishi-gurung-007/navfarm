"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "@/services/api-client";
import { Popover, usePopoverSurface } from "@/components/ui/popover";

export interface LotOption {
  [key: string]: any;
  lot_no: string;
  remaining_quantity: string;
  expiry_date: string | null;
  posting_date: string;
}

export interface SerialOption {
  [key: string]: any;
  serial_no: string;
  posting_date: string;
}

export interface LotSerialPickerProps {
  itemId: string;
  warehouseId?: string;
  trackingType: "LOT" | "SERIAL" | "NONE";
  value: string;
  onChange: (value: string, selectedOption?: LotOption | SerialOption) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

/**
 * The panel content — a checkbox per row rather than a checkmark that only
 * appears on the currently-picked one, so every available lot/serial reads as
 * an explicit yes/no choice instead of a plain list you have to already know
 * is selectable. Still single-select: ticking one row clears any other, the
 * same one-lot/serial-per-line rule the ledger enforces server-side.
 */
function LotSerialPanel({
  options,
  valueKey,
  trackingType,
  value,
  onPick,
  onClearValue,
  loading,
}: {
  options: Array<LotOption | SerialOption>;
  valueKey: string;
  trackingType: "LOT" | "SERIAL";
  value: string;
  onPick: (row: any) => void;
  onClearValue?: () => void;
  loading: boolean;
}) {
  const { close } = usePopoverSurface();
  const [query, setQuery] = useState("");

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

  function pick(row: any) {
    onPick(row);
    close();
  }

  const isLot = trackingType === "LOT";
  const gridTemplate = isLot
    ? "20px minmax(110px, 1fr) 70px 95px"
    : "20px minmax(110px, 1fr) 95px 80px";

  return (
    <div className="flex max-h-[360px] w-[380px] sm:w-[420px] flex-col p-1.5 bg-[var(--surface-raised)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-xl">
      <div className="relative shrink-0 px-1 pb-2 pt-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--text-muted)" }} aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${trackingType.toLowerCase()} or expiry…`}
          className="w-full rounded-[var(--radius-sm)] border py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[var(--accent)]"
          style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--input-text)" }}
        />
      </div>

      <div
        role="presentation"
        aria-hidden="true"
        className="grid shrink-0 items-center gap-x-2 border-b px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider select-none"
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
            <span className="text-right">Expiry Date</span>
          </>
        ) : (
          <>
            <span className="text-right">Expiry Date</span>
            <span className="text-right">Received</span>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 space-y-0.5">
        {loading ? (
          <div className="px-2.5 py-3 text-xs" style={{ color: "var(--text-muted)" }}>Loading options…</div>
        ) : filtered.length === 0 ? (
          <div className="px-2.5 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
            {`No available ${trackingType.toLowerCase()}s`}
          </div>
        ) : (
          filtered.map((row: any) => {
            const v = String(row[valueKey]);
            const isSelected = v === String(value);
            const exp = row.expiry_date ? String(row.expiry_date).slice(0, 10) : "—";
            const postDate = row.posting_date ? String(row.posting_date).slice(0, 10) : "—";

            return (
              <label
                key={v}
                className="grid w-full cursor-pointer items-center gap-x-2 rounded-[var(--radius-xs)] px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--surface-secondary)]"
                style={{
                  gridTemplateColumns: gridTemplate,
                  backgroundColor: isSelected ? "var(--accent-muted)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => pick(row)}
                  className="h-3.5 w-3.5 rounded-[var(--radius-xs)] accent-[var(--accent)]"
                />
                <span className="truncate font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                  {isLot ? row.lot_no : row.serial_no}
                </span>
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
                    <span className="text-right text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {postDate}
                    </span>
                  </>
                )}
              </label>
            );
          })
        )}
      </div>

      {onClearValue && value && (
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
}: LotSerialPickerProps) {
  const [options, setOptions] = useState<Array<LotOption | SerialOption>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

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
  }, [itemId, warehouseId, trackingType]);

  const valueKey = trackingType === "LOT" ? "lot_no" : "serial_no";

  const selected = options.find((o: any) => String(o[valueKey]) === String(value));
  const selectedLabel = selected
    ? trackingType === "LOT"
      ? (selected as LotOption).lot_no
      : (selected as SerialOption).serial_no
    : "";

  const unavailable = disabled || !itemId || (options.length === 0 && !loading && !value);
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);

  const defaultPlaceholder = !itemId
    ? "Select item first…"
    : loading
    ? "Loading options…"
    : options.length === 0
    ? `No available ${trackingType.toLowerCase()}s`
    : `Select ${trackingType.toLowerCase()}…`;

  const expirySuffix = selected?.expiry_date
    ? ` (Exp: ${String(selected.expiry_date).slice(0, 10)})`
    : "";
  const displayLabel = value
    ? `${selectedLabel || value}${expirySuffix}`
    : placeholder || defaultPlaceholder;

  if (trackingType === "NONE") return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      haspopup="listbox"
      className="w-full"
      floating
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          aria-label={ariaLabel || `Select ${trackingType}`}
          disabled={unavailable}
          className={`nf-input-sm nf-select w-full truncate text-left text-xs disabled:cursor-not-allowed disabled:opacity-70 ${triggerClassName || ""}`}
          style={{
            backgroundColor: "var(--input-bg)",
            color: value ? "var(--input-text)" : "var(--text-muted)",
            borderColor: "var(--input-border)",
            ...triggerStyle,
          }}
        >
          {displayLabel}
        </button>
      )}
    >
      <LotSerialPanel
        options={options}
        valueKey={valueKey}
        trackingType={trackingType}
        value={value}
        onPick={(row) => onChange(String(row[valueKey]), row)}
        onClearValue={() => onChange("", undefined)}
        loading={loading}
      />
    </Popover>
  );
}
