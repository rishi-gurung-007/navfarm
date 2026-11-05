"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast";
import { getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";

/** One QC check as the form holds it: a code, what it is, whether it is judged by a range or by words, and the range. */
export type QcSpecRow = {
  qc_code: string;
  description: string;
  qc_type: "VALUE" | "DESCRIPTIVE";
  min_value: string;
  max_value: string;
};

const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;
const S = { sub: { color: "var(--text-secondary)" }, muted: { color: "var(--text-muted)" }, line: { borderColor: "var(--border)" } };
const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(Number(v)));
export const blankQcRow = (): QcSpecRow => ({ qc_code: "", description: "", qc_type: "VALUE", min_value: "", max_value: "" });

/** The body the API takes for a row: a Value check carries its range, a Descriptive check only its description. */
export const toApiLines = (rows: QcSpecRow[]) =>
  rows.map((r) => ({
    measurement_code: r.qc_code.trim(),
    measurement_description: r.description.trim() || null,
    sampling_type: r.qc_type,
    min_value: r.qc_type === "VALUE" && r.min_value !== "" ? Number(r.min_value) : null,
    max_value: r.qc_type === "VALUE" && r.max_value !== "" ? Number(r.max_value) : null,
  }));

/**
 * Item card > QC Specification: the checks a received lot of this item is inspected against. Each has a QC Code, a Description and a QC Type.
 * A Value check has a Min and a Max (either may be left open); a Descriptive check has no range, its Description is what the inspector confirms.
 *
 * On a saved item the checks are read and saved through the API. On a new item (`itemId` null) there is nothing to save them against yet, so
 * they are held by the form (`draft`) and saved together with the item.
 */
export default function QcSpecDialog({ itemId, itemCode, open, onClose, draft, onDraftChange }: {
  itemId: string | null;
  itemCode?: string;
  open: boolean;
  onClose: () => void;
  draft?: QcSpecRow[];
  onDraftChange?: (rows: QcSpecRow[]) => void;
}) {
  const { tLabel } = useLanguage();
  const canEdit = hasPermission(getStoredUser(), "MASTER_DATA", "ITEM", "can_edit") || hasPermission(getStoredUser(), "MASTER_DATA", "ITEM", "can_create");
  const [rows, setRows] = useState<QcSpecRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    if (!itemId) { setRows(draft && draft.length ? draft : [blankQcRow()]); return; }
    setLoading(true);
    try {
      const lines = unwrap<any[]>(await api.get(`/item-qc-spec?item_id=${encodeURIComponent(itemId)}`)) || [];
      setRows(lines.length
        ? lines.map((l) => ({
            qc_code: l.measurement_code || "", description: l.measurement_description || l.acceptance_text || "",
            qc_type: l.sampling_type === "DESCRIPTIVE" ? "DESCRIPTIVE" : "VALUE", min_value: num(l.min_value), max_value: num(l.max_value),
          }))
        : [blankQcRow()]);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const set = (i: number, patch: Partial<QcSpecRow>) => setRows((all) => all.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  // A blank row left at the bottom is not a check.
  const filled = () => rows.filter((r) => r.qc_code.trim() || r.description.trim() || r.min_value !== "" || r.max_value !== "");

  const problem = (): string => {
    const seen = new Set<string>();
    for (const r of filled()) {
      const code = r.qc_code.trim();
      if (!code) return tLabel("Every check needs a QC Code.");
      if (seen.has(code.toUpperCase())) return `${tLabel("QC Code used twice:")} ${code}`;
      seen.add(code.toUpperCase());
      if (r.qc_type === "VALUE") {
        if (r.min_value === "" && r.max_value === "") return `${code}: ${tLabel("a Value check needs a Min Value, a Max Value, or both.")}`;
        if (r.min_value !== "" && r.max_value !== "" && Number(r.min_value) > Number(r.max_value)) return `${code}: ${tLabel("Min Value cannot be greater than Max Value.")}`;
      } else if (!r.description.trim()) return `${code}: ${tLabel("a Descriptive check needs a Description.")}`;
    }
    return "";
  };

  const save = async () => {
    const bad = problem();
    if (bad) { setError(bad); return; }
    setSaving(true);
    setError("");
    try {
      if (!itemId) {
        onDraftChange?.(filled());
        onClose();
        return;
      }
      await api.put(`/item-qc-spec/item/${itemId}`, { lines: toApiLines(filled()) });
      showToast.success(tLabel("QC specification saved."));
      onClose();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setSaving(false); }
  };

  const cell = "nf-input-sm h-9 w-full";
  const head = "px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-semibold";

  return (
    <Dialog open={open} onClose={onClose} title={`${tLabel("QC Specification")}${itemCode ? ` - ${itemCode}` : ""}`} maxWidth="xl"
      footer={
        <div className="flex w-full items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>{tLabel("Cancel")}</Button>
          {canEdit && <Button onClick={save} disabled={saving || loading}>{saving ? tLabel("Saving...") : itemId ? tLabel("Save specification") : tLabel("Done")}</Button>}
        </div>
      }>
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={S.sub}>
          {tLabel("Each received lot of this item is checked against these before it goes into stock. Value: a Min and a Max. Descriptive: the Description is what the inspector confirms.")}
          {!itemId && ` ${tLabel("They are saved with the item.")}`}
        </p>
        {error && <p className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</p>}
        {loading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" style={S.muted} /></div>
        ) : (
          <div className="overflow-x-auto rounded-lg border" style={S.line}>
            <table className="w-full min-w-[760px] table-fixed text-sm">
              <thead>
                <tr style={{ ...S.muted, backgroundColor: "var(--surface-raised)" }}>
                  <th className={`${head} w-[18%]`}>{tLabel("QC Code")}</th>
                  <th className={`${head} w-[34%]`}>{tLabel("Description")}</th>
                  <th className={`${head} w-[16%]`}>{tLabel("QC Type")}</th>
                  <th className={`${head} w-[14%]`}>{tLabel("Min Value")}</th>
                  <th className={`${head} w-[14%]`}>{tLabel("Max Value")}</th>
                  <th className={`${head} w-[4%]`} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isValue = r.qc_type === "VALUE";
                  return (
                    <tr key={i} className="border-t align-middle" style={S.line}>
                      <td className="px-3 py-2"><input className={cell} value={r.qc_code} disabled={!canEdit} onChange={(e) => set(i, { qc_code: e.target.value })} aria-label={tLabel("QC Code")} /></td>
                      <td className="px-3 py-2"><input className={cell} value={r.description} disabled={!canEdit} placeholder={isValue ? "" : tLabel("What the inspector confirms")} onChange={(e) => set(i, { description: e.target.value })} aria-label={tLabel("Description")} /></td>
                      <td className="px-3 py-2">
                        <select className={cell} value={r.qc_type} disabled={!canEdit} onChange={(e) => set(i, { qc_type: e.target.value as QcSpecRow["qc_type"] })} aria-label={tLabel("QC Type")}>
                          <option value="VALUE">{tLabel("Value")}</option>
                          <option value="DESCRIPTIVE">{tLabel("Descriptive")}</option>
                        </select>
                      </td>
                      <td className="px-3 py-2"><input type="number" step="any" className={`${cell} text-right font-mono`} value={isValue ? r.min_value : ""} disabled={!canEdit || !isValue} onChange={(e) => set(i, { min_value: e.target.value })} aria-label={tLabel("Min Value")} /></td>
                      <td className="px-3 py-2"><input type="number" step="any" className={`${cell} text-right font-mono`} value={isValue ? r.max_value : ""} disabled={!canEdit || !isValue} onChange={(e) => set(i, { max_value: e.target.value })} aria-label={tLabel("Max Value")} /></td>
                      <td className="px-3 py-2">
                        {canEdit && (
                          <button type="button" className="cursor-pointer rounded p-2" style={S.muted} onClick={() => setRows((all) => all.filter((_, at) => at !== i))} aria-label={tLabel("Remove check")}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && !loading && (
          <div>
            <Button variant="outline" size="sm" onClick={() => setRows((all) => [...all, blankQcRow()])}><Plus className="h-4 w-4" />{tLabel("Add check")}</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
