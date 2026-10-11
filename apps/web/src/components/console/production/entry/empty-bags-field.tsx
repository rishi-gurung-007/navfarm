"use client";

import React from "react";

/**
 * Workbook checkpoint 28: the empty bags counted for a bagged-feed consumption
 * entry. The server compares bags x bag size with the quantity posted and, on a
 * mismatch, flags the entry (alert_note) instead of refusing it — the note is
 * shown here, beside the count it is about.
 */
export function EmptyBagsField({
  label,
  value,
  onChange,
  disabled,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  note?: string | null;
}) {
  return (
    <div className="mt-1">
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={label}
        aria-label={label}
        className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
      />
      {note && (
        <p role="note" data-testid="empty-bags-note" className="mt-1 text-[11px]" style={{ color: "var(--warning)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

export default EmptyBagsField;
