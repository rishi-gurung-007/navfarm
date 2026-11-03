"use client";

/**
 * The custom select (SearchableSelect / SearchableEntitySelect) for picking
 * several: the same trigger, the same `nf-combobox-panel` with its search box,
 * Code / Name columns and ✓, but the list stays open so more can be ticked and
 * an "All" row heads it. `selected` null means every option, so a list that
 * grows later is still fully covered. Used by Mill Planning's Farms and Feed
 * Types filters. The shared single select is left untouched.
 */
import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { useLanguage } from "@/hooks/useLanguage";

export interface MultiPickOption {
  id: string;
  code: string;
  name: string;
}

export interface MultiPickProps {
  label: string;
  options: MultiPickOption[];
  selected: string[] | null;
  onChange: (ids: string[] | null) => void;
}

const optionLabel = (o: MultiPickOption) => `${o.code} — ${o.name}`;

export function MultiPick({ label, options, selected, onChange }: MultiPickProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const isOn = (id: string) => !selected || selected.includes(id);
  const summary = !selected
    ? t("mplAll")
    : selected.length === 1
      ? options.find((o) => o.id === selected[0])?.name ?? t("mplSelected", { count: 1 })
      : t("mplSelected", { count: selected.length });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => optionLabel(o).toLowerCase().includes(q)) : options;
  }, [options, query]);

  function toggle(id: string) {
    const current = selected ?? options.map((o) => o.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onChange(next.length === options.length ? null : next);
  }

  const row = "grid w-full min-h-[34px] shrink-0 cursor-pointer items-center gap-x-3 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-(--surface-secondary)";
  const tick = (on: boolean) => (
    <span className="flex w-4 shrink-0 justify-end">{on && <Check className="h-4 w-4" style={{ color: "var(--accent)" }} />}</span>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      align="start"
      haspopup="listbox"
      className="w-full"
      panelClassName="nf-combobox-panel"
      floating
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          aria-label={`${label}: ${summary}`}
          className="nf-input nf-select w-full min-w-[12rem] truncate text-left"
          style={{ backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" }}
        >
          {summary}
        </button>
      )}
    >
      <div className="flex w-full min-h-0 min-w-[280px] flex-col gap-1.5 p-1">
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            role="combobox"
            aria-expanded
            aria-label={label}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mplSearch")}
            className="nf-input-sm w-full"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)", paddingLeft: "1.75rem" }}
          />
        </div>
        <div
          role="listbox"
          aria-label={label}
          aria-multiselectable
          className="grid min-h-0 gap-0.5 overflow-y-auto overscroll-contain pr-0.5"
          style={{ maxHeight: "240px", gridTemplateColumns: "max-content minmax(0, 1fr) auto" }}
        >
          {!query.trim() && (
            <button type="button" role="option" aria-selected={!selected} aria-label={t("mplAll")} onClick={() => onChange(selected ? null : [])} className={row} style={{ gridColumn: "1 / -1", gridTemplateColumns: "subgrid", color: "var(--text-primary)", fontWeight: 600 }}>
              <span className="whitespace-nowrap">{t("mplAll")}</span>
              <span />
              {tick(!selected)}
            </button>
          )}
          {filtered.length > 0 && (
            <div role="presentation" aria-hidden="true" className="sticky top-0 z-10 grid gap-x-3 border-b px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider select-none" style={{ gridColumn: "1 / -1", gridTemplateColumns: "subgrid", color: "var(--text-muted)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface)" }}>
              <span className="whitespace-nowrap">Code</span>
              <span className="truncate">Name</span>
              <span className="w-4" />
            </div>
          )}
          {filtered.length === 0 && (
            <div className="px-2.5 py-3 text-xs" style={{ color: "var(--text-muted)", gridColumn: "1 / -1" }}>{t("mplNoMatches")}</div>
          )}
          {filtered.map((o) => {
            const on = isOn(o.id);
            return (
              <button key={o.id} type="button" role="option" aria-selected={on} aria-label={optionLabel(o)} onClick={() => toggle(o.id)} className={row} style={{ gridColumn: "1 / -1", gridTemplateColumns: "subgrid", color: "var(--text-primary)", fontWeight: on ? 600 : 400 }}>
                <span className="whitespace-nowrap">{o.code}</span>
                <span className="truncate" style={{ color: "var(--text-secondary)" }}>{o.name}</span>
                {tick(on)}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
