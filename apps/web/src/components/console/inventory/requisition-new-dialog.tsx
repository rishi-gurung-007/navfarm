"use client";

/**
 * A feed requisition entered by hand (D26; Requisition §1 row 7, type
 * MANUAL). One line per silo or store and feed item; the API refuses the
 * same pair twice and anything that is not an active silo or store of the
 * farm, and its message is shown as it comes. Its two lists come from the
 * feed module's own GET /feed-requisition/options (F3, review I3), read only
 * when the dialog opens: the Master Data routes it used before answer with
 * the tenant templates in a tenant-wide workspace and refuse a farm login
 * outright, on a screen that lists the farm quite happily.
 */
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Wheat } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { unwrap } from "./feed-format";
import type { RequisitionView } from "./requisitions-panel";

interface Destination { location_id: string; location_code: string; location_type: string }
interface FeedItem { item_id: string; item_code: string; item_name: string }
interface Options { destinations: Destination[]; items: FeedItem[] }
interface Draft { dest: string; item: string; kg: string; date: string }

const EMPTY: Draft = { dest: "", item: "", kg: "", date: "" };
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

export function RequisitionNewDialog({
  open,
  farmId,
  onClose,
  onCreated,
}: {
  open: boolean;
  farmId: string;
  onClose: () => void;
  onCreated: (view: RequisitionView) => void;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [lines, setLines] = useState<Draft[]>([{ ...EMPTY }]);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [purpose, setPurpose] = useState<"FEED" | null>(null);

  useEffect(() => {
    if (!open || purpose !== "FEED") return;
    let alive = true;
    setLines([{ ...EMPTY }]);
    setRemarks("");
    setError("");
    api
      .get(`/feed-requisition/options?${new URLSearchParams({ farmId }).toString()}`)
      .then((res: any) => {
        if (!alive) return;
        const options = unwrap<Options>(res);
        setDestinations(Array.isArray(options?.destinations) ? options.destinations : []);
        setItems(Array.isArray(options?.items) ? options.items : []);
      })
      .catch((err: any) => {
        if (alive) setError(err?.message || tRef.current("rqLoadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [open, farmId, purpose]);

  useEffect(() => {
    if (open) setPurpose(null);
  }, [open]);

  const setLine = (i: number, patch: Partial<Draft>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const complete = lines.every((l) => l.dest && l.item && Number(l.kg) > 0 && l.date);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        farmId,
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        lines: lines.map((l) => ({ destination_location_id: l.dest, item_id: l.item, quantity_kg: Number(l.kg), proposed_delivery_date: l.date })),
      };
      onCreated(unwrap<RequisitionView>(await api.post("/feed-requisition", body)));
    } catch (err: any) {
      setError(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(purpose === null ? "rqNew" : "rqNewTitle")}
      maxWidth="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>{t("rqNewCancel")}</Button>
          {purpose === "FEED" && <Button size="sm" onClick={create} disabled={busy || !complete}>{t("rqNewCreate")}</Button>}
        </div>
      }
    >
      {purpose === null ? (
        <div className="flex flex-col gap-4 text-xs">
          <p className="text-sm text-[var(--text-secondary)]">{t("rqNewPurposePrompt")}</p>
          <button
            type="button"
            aria-label={t("rqNewPurposeFeed")}
            onClick={() => setPurpose("FEED")}
            className="nf-press flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:bg-[var(--surface-raised)]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <Wheat className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-[var(--text-primary)]">{t("rqNewPurposeFeed")}</span>
              <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{t("rqNewPurposeFeedHint")}</span>
            </span>
          </button>
        </div>
      ) : (
      <div className="flex flex-col gap-3 text-xs">
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_7rem_9rem_auto] sm:items-end">
            <Field label={t("rqNewDestination", { line: i + 1 })} htmlFor={`rqn-dest-${i}`}>
              <select id={`rqn-dest-${i}`} className="nf-input-sm nf-select" style={inputStyle} value={line.dest} onChange={(e) => setLine(i, { dest: e.target.value })}>
                <option value="">{t("rqNewChoose")}</option>
                {destinations.map((d) => <option key={d.location_id} value={d.location_id}>{d.location_code}</option>)}
              </select>
            </Field>
            <Field label={t("rqNewItem", { line: i + 1 })} htmlFor={`rqn-item-${i}`}>
              <select id={`rqn-item-${i}`} className="nf-input-sm nf-select" style={inputStyle} value={line.item} onChange={(e) => setLine(i, { item: e.target.value })}>
                <option value="">{t("rqNewChoose")}</option>
                {items.map((it) => <option key={it.item_id} value={it.item_id}>{it.item_code} — {it.item_name}</option>)}
              </select>
            </Field>
            <Field label={t("rqNewKg", { line: i + 1 })} htmlFor={`rqn-kg-${i}`}>
              <input id={`rqn-kg-${i}`} type="number" min={0} step="any" className="nf-input-sm text-right" style={inputStyle} value={line.kg} onChange={(e) => setLine(i, { kg: e.target.value })} />
            </Field>
            <Field label={t("rqNewDate", { line: i + 1 })} htmlFor={`rqn-date-${i}`}>
              <input id={`rqn-date-${i}`} type="date" className="nf-input-sm" style={inputStyle} value={line.date} onChange={(e) => setLine(i, { date: e.target.value })} />
            </Field>
            <Button variant="ghost" size="sm" aria-label={t("rqNewRemoveLine", { line: i + 1 })} disabled={lines.length === 1}
              onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div>
          <Button variant="outline" size="sm" onClick={() => setLines((cur) => [...cur, { ...EMPTY }])}><Plus className="h-3.5 w-3.5" /> {t("rqNewAddLine")}</Button>
        </div>
        <Field label={t("rqRemarks")} htmlFor="rqn-remarks">
          <textarea id="rqn-remarks" className="nf-input w-full px-2 py-1" style={inputStyle} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
      )}
    </Dialog>
  );
}
