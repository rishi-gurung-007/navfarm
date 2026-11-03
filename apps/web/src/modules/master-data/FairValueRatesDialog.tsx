"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { formatAmount } from "@/lib/utils";

type Rate = Record<string, any>;

const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;
const day = (v: unknown) => String(v ?? "").slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
const S = { primary: { color: "var(--text-primary)" }, sub: { color: "var(--text-secondary)" }, muted: { color: "var(--text-muted)" }, line: { borderColor: "var(--border)" } };

/** What one rate is worth: expected weight x price per kg, less costs to sell. The API's figure is the one posted; this only shows it. */
export const fairValueOf = (weight: number, price: number, costsPct: number | null) =>
  Math.round(weight * price * (1 - (costsPct ?? 0) / 100) * 1e4) / 1e4;

/**
 * Item card > Fair value rates (TDD Item Card, Fair Value Setup). A dated list of expected weight and price per kg for an item costed by fair value. A rate is
 * never edited: a change is a new row with a later date, so the history a posted run used is kept.
 */
export default function FairValueRatesDialog({ itemId, itemCode, open, onClose }: { itemId: string; itemCode?: string; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const canEdit = hasPermission(getStoredUser(), "MASTER_DATA", "GL_MAPPING", "can_edit");
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ effective_from: todayStr(), age_week_from: "0", expected_weight_kg: "", price_per_kg: "", costs_to_sell_pct: "", cdm_based: false });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRates(unwrap<Rate[]>(await api.get(`/bio-costing/items/${itemId}/rates`)) || []); }
    catch (e: any) { showToast.error(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [itemId]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const weight = Number(form.expected_weight_kg);
  const price = Number(form.price_per_kg);
  const costs = form.costs_to_sell_pct === "" ? null : Number(form.costs_to_sell_pct);
  const valid = weight > 0 && price > 0 && !!form.effective_from && (costs === null || (costs >= 0 && costs < 100));

  const add = async () => {
    setSaving(true);
    try {
      const res = await api.post(`/bio-costing/items/${itemId}/rates`, {
        effective_from: form.effective_from, age_week_from: Number(form.age_week_from) || 0, expected_weight_kg: weight, price_per_kg: price,
        cdm_based: form.cdm_based, ...(costs !== null ? { costs_to_sell_pct: costs } : {}),
      });
      setRates(unwrap<Rate[]>(res) || []);
      setForm((f) => ({ ...f, expected_weight_kg: "", price_per_kg: "", costs_to_sell_pct: "" }));
      showToast.success(t("fvrAdded"));
    } catch (e: any) { showToast.error(e?.message || String(e)); }
    finally { setSaving(false); }
  };

  const field = (key: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-1 text-xs font-semibold" style={S.sub}>
      {label}
      <Input value={String(form[key])} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </label>
  );

  return (
    <Dialog open={open} onClose={onClose} title={`${t("fvrTitle")}${itemCode ? ` - ${itemCode}` : ""}`} maxWidth="xl"
      footer={<div className="flex w-full justify-end"><Button onClick={onClose}>{t("fvrDone")}</Button></div>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={S.sub}>{t("fvrIntro")}</p>

        {canEdit && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-3 lg:grid-cols-6" style={S.line}>
            {field("effective_from", t("fvrFrom"), { type: "date" })}
            {field("age_week_from", t("fvrAge"), { type: "number", min: 0 })}
            {field("expected_weight_kg", t("fvrWeight"), { type: "number", min: 0, step: "any" })}
            {field("price_per_kg", t("fvrPrice"), { type: "number", min: 0, step: "any" })}
            {field("costs_to_sell_pct", t("fvrCosts"), { type: "number", min: 0, max: 99, step: "any" })}
            <div className="flex flex-col justify-end gap-1">
              <label className="flex items-center gap-2 text-xs font-semibold" style={S.sub}>
                <input type="checkbox" checked={form.cdm_based} onChange={(e) => setForm((f) => ({ ...f, cdm_based: e.target.checked }))} />
                {t("fvrCdm")}
              </label>
              <Button onClick={add} disabled={!valid || saving}>{saving ? t("saving") : t("fvrAdd")}</Button>
            </div>
            {valid && (
              <p className="col-span-full text-xs" style={S.muted}>{t("fvrPreview", { value: formatAmount(fairValueOf(weight, price, costs)) })}</p>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" style={S.muted} /></div>
        ) : rates.length === 0 ? (
          <p className="rounded-lg border p-4 text-center text-sm" style={{ ...S.line, ...S.muted }}>{t("fvrEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border" style={S.line}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase" style={S.muted}>
                  <th className="p-2">{t("fvrFrom")}</th><th className="p-2">{t("fvrAge")}</th><th className="p-2 text-right">{t("fvrWeight")}</th>
                  <th className="p-2 text-right">{t("fvrPrice")}</th><th className="p-2 text-right">{t("fvrCosts")}</th><th className="p-2 text-right">{t("fvrFairValue")}</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.rate_id} className="border-t" style={S.line}>
                    <td className="p-2" style={S.primary}>{day(r.effective_from)}</td>
                    <td className="p-2" style={S.sub}>{r.age_week_from}</td>
                    <td className="p-2 text-right" style={S.sub}>{Number(r.expected_weight_kg)}</td>
                    <td className="p-2 text-right" style={S.sub}>{Number(r.price_per_kg)}</td>
                    <td className="p-2 text-right" style={S.sub}>{r.costs_to_sell_pct == null ? "-" : `${Number(r.costs_to_sell_pct)}%`}</td>
                    <td className="p-2 text-right font-semibold" style={S.primary}>{formatAmount(fairValueOf(Number(r.expected_weight_kg), Number(r.price_per_kg), r.costs_to_sell_pct == null ? null : Number(r.costs_to_sell_pct)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
