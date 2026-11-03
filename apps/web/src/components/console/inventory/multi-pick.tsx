"use client";

/**
 * A filter that picks several of a list: a button that opens a checkbox list.
 * `selected` null means every option (the button says "All"), so a list that
 * grows later is still fully covered; unticking one turns it into a list.
 * Used by Mill Planning's Farms and Feed Types filters.
 */
import { useState } from "react";
import { Popover } from "@/components/ui/popover";
import { useLanguage } from "@/hooks/useLanguage";

export interface MultiPickProps {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[] | null;
  onChange: (ids: string[] | null) => void;
}

export function MultiPick({ label, options, selected, onChange }: MultiPickProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const isOn = (id: string) => !selected || selected.includes(id);
  const summary = !selected
    ? t("mplAll")
    : selected.length === 1
      ? options.find((o) => o.id === selected[0])?.label ?? t("mplSelected", { count: 1 })
      : t("mplSelected", { count: selected.length });

  function toggle(id: string) {
    const current = selected ?? options.map((o) => o.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onChange(next.length === options.length ? null : next);
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      haspopup="dialog"
      panelRole="dialog"
      label={label}
      floating
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          aria-label={`${label}: ${summary}`}
          className="nf-input-sm nf-select min-w-[10rem] truncate text-left text-xs"
          style={{ backgroundColor: "var(--input-bg)" }}
        >
          {summary}
        </button>
      )}
    >
      <div className="max-h-72 min-w-[14rem] overflow-y-auto p-2">
        <label className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-(--text-primary) hover:bg-(--surface-hover)">
          <input type="checkbox" checked={!selected} onChange={() => onChange(selected ? null : [])} />
          {t("mplAll")}
        </label>
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-(--text-primary) hover:bg-(--surface-hover)">
            <input type="checkbox" checked={isOn(option.id)} onChange={() => toggle(option.id)} aria-label={option.label} />
            {option.label}
          </label>
        ))}
      </div>
    </Popover>
  );
}
