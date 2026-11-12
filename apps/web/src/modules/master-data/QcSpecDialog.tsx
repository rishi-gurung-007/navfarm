"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast";
import Link from "next/link";
import { getActiveCompanyId, getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * One QC check as the form holds it. It is picked from the QC Parameter Master (`param_id`), which fixes its QC Code and QC Type and fills in the
 * rest; Description, Unit, Min / Max / Target and Mandatory are then this item's own and may be changed. A check saved before the master
 * existed has no `param_id`.
 */
export type QcSpecRow = {
  param_id: string;
  qc_code: string;
  description: string;
  qc_type: "VALUE" | "DESCRIPTIVE";
  uom: string;
  min_value: string;
  max_value: string;
  target_value: string;
  is_mandatory: boolean;
};

type QcParameter = {
  param_id: string; param_code: string; param_name: string; param_type: string; uom: string | null;
  min_value: string | null; max_value: string | null; target_value: string | null; is_mandatory: boolean;
};

const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;
const S = { sub: { color: "var(--text-secondary)" }, muted: { color: "var(--text-muted)" }, line: { borderColor: "var(--border)" } };
const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(Number(v)));
export const blankQcRow = (): QcSpecRow => ({
  param_id: "", qc_code: "", description: "", qc_type: "VALUE", uom: "", min_value: "", max_value: "", target_value: "", is_mandatory: true,
});

/** A QC parameter as a check: Numeric is judged against Min..Max (a Value check), Yes / No is confirmed by the inspector (a Descriptive check). */
const rowFromParameter = (p: QcParameter): QcSpecRow => {
  const value = p.param_type === "NUMERIC";
  return {
    param_id: p.param_id, qc_code: p.param_code, description: p.param_name, qc_type: value ? "VALUE" : "DESCRIPTIVE",
    uom: value ? p.uom || "" : "", min_value: value ? num(p.min_value) : "", max_value: value ? num(p.max_value) : "",
    target_value: value ? num(p.target_value) : "", is_mandatory: !!p.is_mandatory,
  };
};

/** The body the API takes for a row. A `param_id` links it to the master (QC Code and QC Type); the values sent are the item's own, an empty one an open bound. */
export const toApiLines = (rows: QcSpecRow[]) =>
  rows.map((r) => ({
    ...(r.param_id ? { param_id: r.param_id } : {}),
    measurement_code: r.qc_code.trim(),
    measurement_description: r.description.trim() || null,
    sampling_type: r.qc_type,
    uom: r.qc_type === "VALUE" ? r.uom || null : null,
    min_value: r.qc_type === "VALUE" && r.min_value !== "" ? Number(r.min_value) : null,
    max_value: r.qc_type === "VALUE" && r.max_value !== "" ? Number(r.max_value) : null,
    target_value: r.qc_type === "VALUE" && r.target_value !== "" ? Number(r.target_value) : null,
    is_mandatory: r.is_mandatory,
  }));

/**
 * Item card > QC Specification: the checks a received lot of this item is inspected against, each one a parameter picked from the QC Parameter
 * Master (client, 9 Nov). Picking fills in the master's values; the QC Code and QC Type stay the master's, the rest may be changed for this item.
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
  const [params, setParams] = useState<QcParameter[]>([]);
  const [uoms, setUoms] = useState<{ uom_code: string; uom_name?: string }[]>([]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const qs = new URLSearchParams({ isActive: "true", limit: "200" });
      const companyId = getActiveCompanyId();
      if (companyId) qs.set("companyId", companyId);
      const [paramList, uomList] = await Promise.all([
        api.get(`/qc-parameter?${qs.toString()}`),
        api.get(`/uom?${new URLSearchParams({ ...(companyId ? { companyId } : {}), limit: "500" }).toString()}`).catch(() => []),
      ]);
      setParams(unwrap<QcParameter[]>(paramList) || []);
      setUoms(unwrap<any[]>(uomList) || []);
      if (!itemId) { setRows(draft && draft.length ? draft : [blankQcRow()]); return; }
      const lines = unwrap<any[]>(await api.get(`/item-qc-spec?item_id=${encodeURIComponent(itemId)}`)) || [];
      setRows(lines.length
        ? lines.map((l) => ({
            param_id: l.param_id || "", qc_code: l.measurement_code || "", description: l.measurement_description || l.acceptance_text || "",
            qc_type: l.sampling_type === "DESCRIPTIVE" ? "DESCRIPTIVE" : "VALUE", uom: l.uom || "", min_value: num(l.min_value),
            max_value: num(l.max_value), target_value: num(l.target_value), is_mandatory: l.is_mandatory !== false,
          }))
        : [blankQcRow()]);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const pick = (i: number, paramId: string) => {
    const p = params.find((x) => x.param_id === paramId);
    setRows((all) => all.map((r, at) => (at === i ? (p ? rowFromParameter(p) : blankQcRow()) : r)));
  };
  const set = (i: number, patch: Partial<QcSpecRow>) => setRows((all) => all.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  // A blank row left at the bottom is not a check.
  const filled = () => rows.filter((r) => r.param_id || r.qc_code.trim());

  const problem = (): string => {
    const seen = new Set<string>();
    for (const r of filled()) {
      const code = r.qc_code.trim();
      if (seen.has(code.toUpperCase())) return `${tLabel("QC Code used twice:")} ${code}`;
      seen.add(code.toUpperCase());
      if (r.qc_type !== "VALUE") {
        if (!r.description.trim()) return `${code}: ${tLabel("a Yes / No check needs a Description: what the inspector confirms.")}`;
        continue;
      }
      const [min, max, target] = [r.min_value, r.max_value, r.target_value].map((v) => (v === "" ? null : Number(v)));
      if (min === null && max === null) return `${code}: ${tLabel("a Numeric check needs a Min Value, a Max Value, or both.")}`;
      if (min !== null && max !== null && min > max) return `${code}: ${tLabel("Min Value cannot be greater than Max Value.")}`;
      if (target !== null && ((min !== null && target < min) || (max !== null && target > max)))
        return `${code}: ${tLabel("Target Value must be between Min Value and Max Value.")}`;
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
          {tLabel("Each received lot of this item is checked against these before it goes into stock. Pick each check from the QC Parameter Master; its values are filled in and can be changed for this item. Numeric is judged against Min and Max, Yes / No is confirmed by the inspector.")}
          {!itemId && ` ${tLabel("They are saved with the item.")}`}
        </p>
        {!loading && params.length === 0 && (
          <p className="rounded-lg border p-3 text-sm" style={{ ...S.line, ...S.sub }}>
            {tLabel("There are no active QC parameters yet.")}{" "}
            <Link href="/master-data/qc-parameter" className="font-semibold underline" style={{ color: "var(--accent)" }}>{tLabel("Add them in Master Data > QC Parameters.")}</Link>
          </p>
        )}
        {error && <p className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</p>}
        {loading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" style={S.muted} /></div>
        ) : (
          <div className="overflow-x-auto rounded-lg border" style={S.line}>
            <table className="w-full min-w-[1080px] table-fixed text-sm">
              <thead>
                <tr style={{ ...S.muted, backgroundColor: "var(--surface-raised)" }}>
                  <th className={`${head} w-[19%]`}>{tLabel("QC Code")}</th>
                  <th className={`${head} w-[19%]`}>{tLabel("Description")}</th>
                  <th className={`${head} w-[8%]`}>{tLabel("QC Type")}</th>
                  <th className={`${head} w-[12%]`}>{tLabel("Unit of Measurement")}</th>
                  <th className={`${head} w-[9%] text-right`}>{tLabel("Min Value")}</th>
                  <th className={`${head} w-[9%] text-right`}>{tLabel("Max Value")}</th>
                  <th className={`${head} w-[9%] text-right`}>{tLabel("Target Value")}</th>
                  <th className={`${head} w-[11%]`}>{tLabel("Mandatory")}</th>
                  <th className={`${head} w-[4%]`} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const linked = !!(r.param_id || r.qc_code);
                  const isValue = r.qc_type === "VALUE";
                  const editable = canEdit && linked;
                  // An empty Description falls back to the master's, so it is shown faintly; an empty Min / Max / Target is an open bound, so it is not.
                  const master = params.find((p) => p.param_id === r.param_id);
                  const numberCell = (key: "min_value" | "max_value" | "target_value") => (
                    <input type="number" step="any" className={`${cell} text-right font-mono`} value={isValue ? r[key] : ""}
                      disabled={!editable || !isValue}
                      onChange={(e) => set(i, { [key]: e.target.value })} aria-label={tLabel(key === "min_value" ? "Min Value" : key === "max_value" ? "Max Value" : "Target Value")} />
                  );
                  const taken = new Set(rows.filter((_, at) => at !== i).map((x) => x.param_id).filter(Boolean));
                  return (
                    <tr key={i} className="border-t align-middle" style={S.line}>
                      <td className="px-3 py-2">
                        <select className={cell} value={r.param_id} disabled={!canEdit} onChange={(e) => pick(i, e.target.value)} aria-label={tLabel("QC Code")}>
                          <option value="">{r.param_id || !r.qc_code ? tLabel("Select QC parameter…") : `${r.qc_code} (${tLabel("not in master")})`}</option>
                          {r.param_id && !params.some((p) => p.param_id === r.param_id) && <option value={r.param_id}>{r.qc_code}</option>}
                          {params.filter((p) => !taken.has(p.param_id)).map((p) => (
                            <option key={p.param_id} value={p.param_id}>{p.param_code} — {p.param_name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input className={cell} value={r.description} disabled={!editable} placeholder={master?.param_name || ""}
                          onChange={(e) => set(i, { description: e.target.value })} aria-label={tLabel("Description")} />
                      </td>
                      <td className="px-3 py-2">{linked ? tLabel(isValue ? "Numeric" : "Yes / No") : "—"}</td>
                      <td className="px-3 py-2">
                        <select className={cell} value={isValue ? r.uom : ""} disabled={!editable || !isValue} onChange={(e) => set(i, { uom: e.target.value })} aria-label={tLabel("Unit of Measurement")}>
                          <option value="">{isValue ? tLabel("Select…") : "—"}</option>
                          {isValue && r.uom && !uoms.some((u) => u.uom_code === r.uom) && <option value={r.uom}>{r.uom}</option>}
                          {[...new Map(uoms.map((u) => [u.uom_code, u])).values()].map((u) => (
                            <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">{numberCell("min_value")}</td>
                      <td className="px-3 py-2">{numberCell("max_value")}</td>
                      <td className="px-3 py-2">{numberCell("target_value")}</td>
                      <td className="px-3 py-2">
                        <select className={cell} value={r.is_mandatory ? "yes" : "no"} disabled={!editable} onChange={(e) => set(i, { is_mandatory: e.target.value === "yes" })} aria-label={tLabel("Mandatory")}>
                          <option value="yes">{tLabel("Yes")}</option>
                          <option value="no">{tLabel("No")}</option>
                        </select>
                      </td>
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
            <Button variant="outline" size="sm" onClick={() => setRows((all) => [...all, blankQcRow()])}><Plus className="h-4 w-4" />{tLabel("Add QC parameter")}</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
