"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActiveCompanyId, getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { formatAmount } from "@/lib/utils";

type Row = Record<string, any>;
const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
};
const STATUS_VARIANT: Record<string, "neutral" | "success" | "warning" | "danger"> = { ACTIVE: "success", DRAFT: "warning", INACTIVE: "neutral", SUPERSEDED: "neutral" };
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_RESIDUAL = { gender: "F", residual_rule: "WEIGHT_X_PRICE", residual_weight_kg: "", residual_price_per_kg: "", residual_fixed_amount: "", effective_from: today(), note: "" };

/**
 * Finance > Bio-Asset Costing Setup. The company's residual value (what an animal is written down to), set once per sex and from a date,
 * and the costing profiles that say how each kind of animal is costed. The rules and every check are the API's; this screen only reads
 * and sends them. A residual is changed by adding a row with a later date, never by editing, so a past run can always be explained.
 */
export default function BioCostingSetupPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const canEdit = hasPermission(getStoredUser(), "MASTER_DATA", "GL_MAPPING", "can_edit");

  const [settings, setSettings] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [residualOpen, setResidualOpen] = useState(false);
  const [residual, setResidual] = useState({ ...EMPTY_RESIDUAL });
  const [editing, setEditing] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ name: "", auto_post: false });
  const [versioning, setVersioning] = useState<Row | null>(null);
  const [versionForm, setVersionForm] = useState({ effective_from: today(), useful_life_months: "", start_age_weeks: "" });

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const [s, p] = await Promise.all([api.get("/bio-costing/residual-settings"), api.get(`/bio-costing/profiles?companyId=${companyId}`)]);
      setSettings(unwrap<Row[]>(s) || []);
      setProfiles(unwrap<Row[]>(p) || []);
    } catch (e: any) {
      setError(e?.message || t("bcsLoadFailed"));
    }
  }, [companyId, t]);

  useEffect(() => { load(); }, [load]);

  const act = async (work: () => Promise<unknown>, done: string, close: () => void) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setMessage(done);
      close();
      await load();
    } catch (e: any) {
      setError(e?.message || t("bcsSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveResidual = () => act(() => {
    const body: Row = { gender: residual.gender, residual_rule: residual.residual_rule, effective_from: residual.effective_from };
    if (residual.residual_rule === "WEIGHT_X_PRICE") { body.residual_weight_kg = Number(residual.residual_weight_kg); body.residual_price_per_kg = Number(residual.residual_price_per_kg); }
    if (residual.residual_rule === "FIXED") body.residual_fixed_amount = Number(residual.residual_fixed_amount);
    if (residual.note.trim()) body.note = residual.note.trim();
    return api.post("/bio-costing/residual-settings", body);
  }, t("bcsResidualSaved"), () => { setResidualOpen(false); setResidual({ ...EMPTY_RESIDUAL }); });

  const saveEdit = () => editing && act(() => api.put(`/bio-costing/profiles/${editing.profile_id}`, { name: editForm.name.trim(), auto_post: editForm.auto_post }), t("bcsProfileSaved"), () => setEditing(null));

  const saveVersion = () => versioning && act(() => {
    const body: Row = { effective_from: versionForm.effective_from };
    if (versionForm.useful_life_months) body.useful_life_months = Number(versionForm.useful_life_months);
    if (versionForm.start_age_weeks !== "") body.start_age_weeks = Number(versionForm.start_age_weeks);
    return api.post(`/bio-costing/profiles/${versioning.profile_id}/new-version`, body);
  }, t("bcsVersionSaved"), () => setVersioning(null));

  const activate = (p: Row) => act(() => api.post(`/bio-costing/profiles/${p.profile_id}/activate`, {}), t("bcsProfileActivated"), () => undefined);

  const ruleText = (r: Row) => r.residual_rule === "WEIGHT_X_PRICE"
    ? `${Number(r.residual_weight_kg)} kg × ${Number(r.residual_price_per_kg)}`
    : r.residual_rule === "FIXED" ? t("bcsRuleFixed") : t("bcsRuleNone");
  const sexText = (g?: string | null) => (g === "F" ? t("bcsFemale") : g === "M" ? t("bcsMale") : "");
  const scopeText = (p: Row) => [p.origin ? (p.origin === "IMPORTED" ? t("bcsImported") : t("bcsLocal")) : "", sexText(p.gender)].filter(Boolean).join(" · ") || "—";

  return (
    <div className="space-y-8">
      <Toast variant="danger" message={error} onClose={() => setError("")} />
      <Toast variant="success" message={message} onClose={() => setMessage("")} />

      <section className="space-y-3" aria-label={t("bcsResidualTitle")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold" style={S.primary}>{t("bcsResidualTitle")}</h3>
            <p className="mt-1 max-w-3xl text-xs" style={S.muted}>{t("bcsResidualHint")}</p>
          </div>
          {canEdit && <Button size="sm" onClick={() => setResidualOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />{t("bcsResidualAdd")}</Button>}
        </div>
        <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <TableHeader>
                <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                  <TableHead>{t("bcsSex")}</TableHead>
                  <TableHead>{t("bcsRule")}</TableHead>
                  <TableHead className="text-right">{t("bcsResidualValue")}</TableHead>
                  <TableHead>{t("bcsEffectiveFrom")}</TableHead>
                  <TableHead>{t("bcsNote")}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {settings.length === 0 ? (
                  <tr><TableCell colSpan={5} className="py-8 text-center" style={S.sub}>{t("bcsResidualNone")}</TableCell></tr>
                ) : settings.map((r) => (
                  <TableRow key={r.setting_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{sexText(r.gender)}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{ruleText(r)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold" style={S.primary}>{formatAmount(r.residual_value)}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{String(r.effective_from).slice(0, 10)}</TableCell>
                    <TableCell style={S.sub}>{r.note || ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-label={t("bcsProfilesTitle")}>
        <div>
          <h3 className="text-base font-semibold" style={S.primary}>{t("bcsProfilesTitle")}</h3>
          <p className="mt-1 max-w-3xl text-xs" style={S.muted}>{t("bcsProfilesHint")}</p>
        </div>
        <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <TableHeader>
                <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                  <TableHead>{t("bcsCode")}</TableHead>
                  <TableHead>{t("bcsName")}</TableHead>
                  <TableHead>{t("bcsCovers")}</TableHead>
                  <TableHead>{t("bcsMethod")}</TableHead>
                  <TableHead className="text-right">{t("bcsStartWeeks")}</TableHead>
                  <TableHead className="text-right">{t("bcsLifeMonths")}</TableHead>
                  <TableHead>{t("bcsFrequency")}</TableHead>
                  <TableHead>{t("bcsStatus")}</TableHead>
                  <TableHead className="text-right">{t("bcsActions")}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {profiles.length === 0 ? (
                  <tr><TableCell colSpan={9} className="py-8 text-center" style={S.sub}>{t("bcsProfilesNone")}</TableCell></tr>
                ) : profiles.map((p) => (
                  <TableRow key={p.profile_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{p.profile_code}</TableCell>
                    <TableCell style={S.primary}>{p.name}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{scopeText(p)}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{p.costing_method === "AMORTIZATION" ? t("bcrAmortisation") : t("bcrFairValue")}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{p.start_age_weeks}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{p.useful_life_months ?? ""}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{p.run_frequency}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[p.status] || "neutral"}>{p.status}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-1.5">
                          {p.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => activate(p)} disabled={busy}>{t("bcsActivate")}</Button>}
                          {p.status !== "SUPERSEDED" && (
                            <Button size="sm" variant="outline" aria-label={`${t("bcsEdit")} ${p.profile_code}`} onClick={() => { setEditing(p); setEditForm({ name: p.name, auto_post: !!p.auto_post }); }}>
                              <Pencil className="mr-1 h-3 w-3" />{t("bcsEdit")}
                            </Button>
                          )}
                          {p.status === "ACTIVE" && (
                            <Button size="sm" variant="outline" aria-label={`${t("bcsNewVersion")} ${p.profile_code}`} onClick={() => { setVersioning(p); setVersionForm({ effective_from: today(), useful_life_months: p.useful_life_months ? String(p.useful_life_months) : "", start_age_weeks: String(p.start_age_weeks) }); }}>
                              {t("bcsNewVersion")}
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </div>
      </section>

      <Dialog
        open={residualOpen}
        onClose={() => !busy && setResidualOpen(false)}
        title={t("bcsResidualAdd")}
        description={t("bcsResidualDialogHint")}
        maxWidth="sm"
        footer={<Button onClick={saveResidual} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("bcsSave")}</Button>}
      >
        <div className="space-y-3">
          <div>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-sex">{t("bcsSex")}</label>
            <Select id="bcs-sex" value={residual.gender} onChange={(e) => setResidual({ ...residual, gender: e.target.value })} className="h-9 text-[13px]">
              <option value="F">{t("bcsFemale")}</option>
              <option value="M">{t("bcsMale")}</option>
            </Select>
          </div>
          <div>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-rule">{t("bcsRule")}</label>
            <Select id="bcs-rule" value={residual.residual_rule} onChange={(e) => setResidual({ ...residual, residual_rule: e.target.value })} className="h-9 text-[13px]">
              <option value="WEIGHT_X_PRICE">{t("bcsRuleWeightPrice")}</option>
              <option value="FIXED">{t("bcsRuleFixed")}</option>
              <option value="NONE">{t("bcsRuleNone")}</option>
            </Select>
          </div>
          {residual.residual_rule === "WEIGHT_X_PRICE" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-weight">{t("bcsWeight")}</label>
                <Input id="bcs-weight" type="number" min={0} step="0.01" value={residual.residual_weight_kg} onChange={(e) => setResidual({ ...residual, residual_weight_kg: e.target.value })} className="h-9 text-[13px]" />
              </div>
              <div>
                <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-price">{t("bcsPrice")}</label>
                <Input id="bcs-price" type="number" min={0} step="0.01" value={residual.residual_price_per_kg} onChange={(e) => setResidual({ ...residual, residual_price_per_kg: e.target.value })} className="h-9 text-[13px]" />
              </div>
            </div>
          )}
          {residual.residual_rule === "FIXED" && (
            <div>
              <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-fixed">{t("bcsFixedAmount")}</label>
              <Input id="bcs-fixed" type="number" min={0} step="0.01" value={residual.residual_fixed_amount} onChange={(e) => setResidual({ ...residual, residual_fixed_amount: e.target.value })} className="h-9 text-[13px]" />
            </div>
          )}
          <div>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-from">{t("bcsEffectiveFrom")}</label>
            <input id="bcs-from" type="date" className="nf-input text-xs" value={residual.effective_from} onChange={(e) => setResidual({ ...residual, effective_from: e.target.value })} />
          </div>
          <div>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-note">{t("bcsNote")}</label>
            <Input id="bcs-note" value={residual.note} maxLength={300} onChange={(e) => setResidual({ ...residual, note: e.target.value })} className="h-9 text-[13px]" />
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!editing}
        onClose={() => !busy && setEditing(null)}
        title={t("bcsEditTitle", { code: editing?.profile_code || "" })}
        description={t("bcsEditHint")}
        maxWidth="sm"
        footer={<Button onClick={saveEdit} disabled={busy || !editForm.name.trim()}>{t("bcsSave")}</Button>}
      >
        <div className="space-y-3">
          <div>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-edit-name">{t("bcsName")}</label>
            <Input id="bcs-edit-name" value={editForm.name} maxLength={150} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="h-9 text-[13px]" />
          </div>
          <label className="flex items-center gap-2 text-sm" style={S.primary}>
            <input type="checkbox" checked={editForm.auto_post} onChange={(e) => setEditForm({ ...editForm, auto_post: e.target.checked })} />
            {t("bcsAutoPost")}
          </label>
        </div>
      </Dialog>

      <Dialog
        open={!!versioning}
        onClose={() => !busy && setVersioning(null)}
        title={t("bcsVersionTitle", { code: versioning?.profile_code || "" })}
        description={t("bcsVersionHint")}
        maxWidth="sm"
        footer={<Button onClick={saveVersion} disabled={busy}>{t("bcsSave")}</Button>}
      >
        <div className="space-y-3">
          <div>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-ver-from">{t("bcsEffectiveFrom")}</label>
            <input id="bcs-ver-from" type="date" className="nf-input text-xs" value={versionForm.effective_from} onChange={(e) => setVersionForm({ ...versionForm, effective_from: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-ver-life">{t("bcsLifeMonths")}</label>
              <Input id="bcs-ver-life" type="number" min={1} value={versionForm.useful_life_months} onChange={(e) => setVersionForm({ ...versionForm, useful_life_months: e.target.value })} className="h-9 text-[13px]" />
            </div>
            <div>
              <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcs-ver-start">{t("bcsStartWeeks")}</label>
              <Input id="bcs-ver-start" type="number" min={0} value={versionForm.start_age_weeks} onChange={(e) => setVersionForm({ ...versionForm, start_age_weeks: e.target.value })} className="h-9 text-[13px]" />
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
