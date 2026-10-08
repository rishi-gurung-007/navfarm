"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/alert";
import { useLanguage } from "@/hooks/useLanguage";

type OverrideKey = "truckTargetKg" | "bulkMultipleKg";
type Draft = Record<OverrideKey, string>;

interface FarmSettingRow {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  settings?: Partial<Record<OverrideKey, number | null>>;
}

const draftOf = (farm: FarmSettingRow): Draft => ({
  truckTargetKg: farm.settings?.truckTargetKg?.toString() ?? "",
  bulkMultipleKg: farm.settings?.bulkMultipleKg?.toString() ?? "",
});
const numberOrNull = (raw: string) => raw.trim() === "" ? null : Number(raw);
const valid = (raw: string) => raw.trim() === "" || (Number.isFinite(Number(raw)) && Number(raw) > 0);
const format = (value: number | null | undefined) => value == null
  ? ""
  : value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function FeedFarmOverrides({ companyId }: { companyId: string }) {
  const { t } = useLanguage();
  const [farms, setFarms] = useState<FarmSettingRow[]>([]);
  const [company, setCompany] = useState<Record<OverrideKey, number | null>>({ truckTargetKg: null, bulkMultipleKg: null });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      api.get("/feed-forecast/farm-settings"),
      api.get(`/feed-settings?companyId=${encodeURIComponent(companyId)}`),
    ]).then(([farmResponse, companyResponse]: any[]) => {
      if (!active) return;
      const rows = (farmResponse?.data ?? farmResponse ?? []) as FarmSettingRow[];
      const scoped = rows.filter((farm) => farm.companyId === companyId);
      const settings = companyResponse?.data ?? companyResponse ?? {};
      setFarms(scoped);
      setDrafts(Object.fromEntries(scoped.map((farm) => [farm.farmId, draftOf(farm)])));
      setCompany({
        truckTargetKg: settings.truckTargetKg ?? null,
        bulkMultipleKg: settings.bulkMultipleKg ?? null,
      });
    }).catch((failure: any) => {
      if (active) setError(failure?.message || t("fsetOverridesLoadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [companyId]);

  const pristine = useMemo(() => Object.fromEntries(farms.map((farm) => [farm.farmId, draftOf(farm)])), [farms]);
  const changed = (farmId: string) => JSON.stringify(drafts[farmId]) !== JSON.stringify(pristine[farmId]);
  const isValid = (farmId: string) => !!drafts[farmId]
    && valid(drafts[farmId].truckTargetKg)
    && valid(drafts[farmId].bulkMultipleKg);

  const save = async (farm: FarmSettingRow) => {
    if (!isValid(farm.farmId)) return;
    setSaving(farm.farmId);
    setSaved(null);
    setError("");
    const draft = drafts[farm.farmId];
    const values = {
      truckTargetKg: numberOrNull(draft.truckTargetKg),
      bulkMultipleKg: numberOrNull(draft.bulkMultipleKg),
    };
    try {
      await api.put("/feed-settings/farm", { companyId, farmId: farm.farmId, ...values });
      setFarms((current) => current.map((row) => row.farmId === farm.farmId
        ? { ...row, settings: { ...row.settings, ...values } }
        : row));
      setSaved(farm.farmId);
    } catch (failure: any) {
      setError(failure?.message || t("fpSaveFailed"));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" />{t("fpLoading")}</p>;

  return (
    <section className="space-y-3" aria-label={t("fsetFarmOverrides")}>
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("fsetFarmOverrides")}</h3>
        <p className="text-xs text-[var(--text-secondary)]">{t("fsetFarmOverridesHint")}</p>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {farms.length === 0 && <p className="text-xs text-[var(--text-secondary)]">{t("fpNoFarms")}</p>}
      {farms.map((farm) => {
        const draft = drafts[farm.farmId];
        if (!draft) return null;
        const positive = isValid(farm.farmId);
        return (
          <div key={farm.farmId} className="rounded-lg border border-[var(--border)] p-4">
            <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{farm.code} — {farm.name}</div>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              {([
                ["truckTargetKg", "fsetTruckTarget"],
                ["bulkMultipleKg", "fsetBulkMultiple"],
              ] as const).map(([key, label]) => {
                const override = farm.settings?.[key] ?? null;
                const effective = override ?? company[key];
                return (
                  <Field key={key} label={t(label, { name: farm.code })} htmlFor={`feed-override-${key}-${farm.farmId}`}>
                    <input id={`feed-override-${key}-${farm.farmId}`} type="number" min="0.01" step="0.01" className="nf-input-sm"
                      placeholder={company[key]?.toString() ?? ""} value={draft[key]}
                      onChange={(event) => setDrafts((current) => ({ ...current, [farm.farmId]: { ...current[farm.farmId], [key]: event.target.value } }))} />
                    <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                      {override == null
                        ? t("fsetInheritedValue", { value: format(effective) })
                        : t("fsetFarmValue", { value: format(effective) })}
                    </span>
                  </Field>
                );
              })}
              <Button type="button" size="sm" variant="outline" aria-label={t("fsetSave", { name: farm.code })}
                disabled={!changed(farm.farmId) || !positive || saving === farm.farmId} onClick={() => save(farm)}>
                {saved === farm.farmId && !changed(farm.farmId) ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {t("saveChanges")}
              </Button>
            </div>
            {!positive && <p className="mt-2 text-xs text-[var(--danger)]">{t("fsetPositiveOnly")}</p>}
          </div>
        );
      })}
    </section>
  );
}

export default FeedFarmOverrides;
