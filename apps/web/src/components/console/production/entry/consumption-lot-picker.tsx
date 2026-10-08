"use client";

import React, { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { LotSerialPicker, type LotOption, type LotSerialPickerProps } from "@/components/ui/lot-serial-picker";
import { lotsToCover, planLotSplit } from "./lot-split";

interface ConsumptionSource {
  warehouse_id: string | null;
  warehouse_code: string | null;
  message: string | null;
}

// One answer per batch line for the life of the page: every animal's row on the same line shares it.
const sources = new Map<string, Promise<ConsumptionSource>>();

function loadSource(batchId: string, lineId: string): Promise<ConsumptionSource> {
  const key = `${batchId}|${lineId}`;
  let pending = sources.get(key);
  if (!pending) {
    pending = api
      .get(`/batch/${batchId}/daily-data/consumption-source?lineId=${lineId}`)
      .then((res: any) => (Array.isArray(res) ? res : res?.data ?? res) as ConsumptionSource)
      .catch(() => ({ warehouse_id: null, warehouse_code: null, message: null }));
    sources.set(key, pending);
    // A failed or changed answer must not stick: forget it after a minute so stock moves are seen.
    setTimeout(() => sources.delete(key), 60_000);
  }
  return pending;
}

/**
 * The lot/serial picker for a scheduled consumption line, scoped to the location the entry will draw
 * from — the silo that holds the item, otherwise the farm store (the same rule posting uses). Without
 * this the list showed lots from every location, with totals the entry could never draw on.
 */
export function ConsumptionLotPicker({
  batchId,
  lineId,
  quantity,
  ...pickerProps
}: { batchId?: string; lineId: string; /** The quantity entered for the line: sizes the lots picked for the user, and the split preview. */ quantity?: number } & LotSerialPickerProps) {
  const [source, setSource] = useState<ConsumptionSource | null>(null);
  const [lots, setLots] = useState<LotOption[]>([]);
  // Once the user ticks or unticks a lot themselves, the lots stop being chosen for them.
  const touched = useRef(false);
  useEffect(() => {
    touched.current = false;
  }, [lineId, pickerProps.itemId]);

  // Lots are chosen for the user from the nearest expiry, as many as the quantity needs, and re-chosen
  // as the quantity changes — until they take the choice over.
  const { onChange, value, trackingType } = pickerProps;
  useEffect(() => {
    if (trackingType !== "LOT" || touched.current || lots.length === 0) return;
    const wanted = lotsToCover(lots, quantity ?? 0);
    if (wanted.length === 0) return;
    const wantedText = wanted.join(", ");
    if (wantedText === (value || "")) return;
    onChange(wantedText, lots.filter((l) => wanted.includes(l.lot_no)));
  }, [lots, quantity, trackingType, value]);

  useEffect(() => {
    if (!batchId) {
      setSource({ warehouse_id: null, warehouse_code: null, message: null });
      return;
    }
    let active = true;
    setSource(null);
    loadSource(batchId, lineId).then((s) => active && setSource(s));
    return () => {
      active = false;
    };
  }, [batchId, lineId]);

  if (!source) {
    return <div className="text-[11px] text-[var(--text-muted)]">Finding the stock location…</div>;
  }
  return (
    <>
      <LotSerialPicker
        {...pickerProps}
        warehouseId={source.warehouse_id ?? pickerProps.warehouseId}
        onChange={(next, rows) => {
          touched.current = true;
          onChange(next, rows);
        }}
        onOptions={(list) => setLots(pickerProps.trackingType === "LOT" ? (list as LotOption[]) : [])}
      />
      {pickerProps.trackingType === "LOT" && (() => {
        const selected = (pickerProps.value || "").split(",").map((s) => s.trim()).filter(Boolean);
        if (!selected.length || !quantity || quantity <= 0 || !lots.length) return null;
        const plan = planLotSplit(lots.map((l) => ({ lot_no: l.lot_no, remaining_quantity: l.remaining_quantity, unit_cost: l.unit_cost })), selected, quantity);
        if (plan.parts.length <= 1 && plan.shortBy <= 0) return null;
        return (
          <div className="mt-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
            {plan.parts.map((p) => (
              <div key={p.lot_no} className="flex justify-between gap-2 font-mono">
                <span>{p.lot_no}</span>
                <span>{p.quantity}{p.unit_cost != null ? ` × ${p.unit_cost.toFixed(2)} = ${(p.cost ?? 0).toFixed(2)}` : ""}</span>
              </div>
            ))}
            {plan.totalCost != null && <div className="mt-0.5 flex justify-between font-mono font-semibold"><span>Total</span><span>{plan.totalCost.toFixed(2)}</span></div>}
            {plan.parts.length > 1 && <div className="mt-0.5" style={{ color: "var(--text-muted)" }}>Cost follows the item's costing method, not the lot.</div>}
            {plan.shortBy > 0 && <div className="mt-0.5 font-semibold" style={{ color: "var(--danger)" }}>Short by {plan.shortBy} — tick another lot or lower the quantity.</div>}
          </div>
        );
      })()}
      <div className="mt-0.5 text-[10px] text-[var(--text-muted)]" title={source.message ?? undefined}>
        {source.warehouse_code ? `Draws from ${source.warehouse_code}` : source.message ? "Stock location not found — posting will say why" : ""}
      </div>
    </>
  );
}
