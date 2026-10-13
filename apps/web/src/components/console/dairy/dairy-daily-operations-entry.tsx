"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, Layers, Milk, Save, Activity, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/services/api-client";
import { getActiveCompanyId, getActiveOperationalAreaId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { StatRow, StatCard } from "@/components/ui/stat-row";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Daily milking entry for a dairy herd.
 *
 * What this screen used to be: a fixed day — 1,180 L morning, 1,100 L evening,
 * 4.15% fat, 80 lactating cows, four feed lines with hardcoded prices, and a
 * weather reading — none of it from the database. Worse, "Save Daily Milking"
 * posted `batch_id: "COW-LAC-2025-001"` (not a UUID) in a body the API does not
 * accept, and swallowed the rejection with `.catch(() => null)`, so it always
 * reported success while storing nothing.
 *
 * Now: the batch is chosen from real ACTIVE batches, the sessions read and
 * write `milk_production_log`, the head count is the live count of lactating
 * animals, and costs are the day's actual `batch_transaction` rows. A failed
 * save shows the error instead of a tick.
 */
export default function DairyDailyOperationsEntry() {
  const { formatMoney } = useCompanyCurrency();
  const money = (v: unknown) => formatMoney(Number(v || 0));
  const { t } = useLanguage();
  const router = useRouter();
  const companyId = getActiveCompanyId();
  const areaId = getActiveOperationalAreaId();

  const [batches, setBatches] = useState<Row[]>([]);
  const [batchId, setBatchId] = useState("");
  const [selectedDate, setSelectedDate] = useState(today);

  const [summary, setSummary] = useState<Row | null>(null);
  const [costs, setCosts] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Session inputs. Empty string means "not recorded" — distinct from zero,
  // which is a real reading of no milk.
  const [morning, setMorning] = useState("");
  const [evening, setEvening] = useState("");
  const [fatPct, setFatPct] = useState("");
  const [snfPct, setSnfPct] = useState("");
  const [scc, setScc] = useState("");
  const [bmcTemp, setBmcTemp] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      setLoadError(t("dyNoCompany"));
      return;
    }
    api
      .get(`/batch?companyId=${companyId}&status=ACTIVE&limit=100`)
      .then((r) => {
        const rows = unwrap<Row[]>(r) || [];
        const scoped = areaId ? rows.filter((b) => b.operational_area_id === areaId) : rows;
        setBatches(scoped);
        if (scoped.length) setBatchId((prev) => prev || scoped[0].batch_id);
        else setLoading(false);
      })
      .catch((err: any) => {
        setLoadError(err?.message || t("dyFailedToLoadBatches"));
        setLoading(false);
      });
  }, [companyId, areaId, t]);

  const load = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    setLoadError("");
    try {
      const [sumRes, costRes] = await Promise.all([
        api.get(`/milk-production/daily-summary?batch_id=${batchId}&log_date=${selectedDate}`),
        api.get(`/milk-production/daily-costs?batch_id=${batchId}&log_date=${selectedDate}`).catch(() => null),
      ]);
      const s = unwrap<Row>(sumRes);
      setSummary(s);
      setCosts(costRes ? unwrap<Row>(costRes) : null);
      // Seed the form from what is already recorded, so opening a day that has
      // entries shows them rather than blank boxes.
      setMorning(s?.morning ? String(Number(s.morning.quantity_litres)) : "");
      setEvening(s?.evening ? String(Number(s.evening.quantity_litres)) : "");
      setFatPct(s?.fat_pct !== null && s?.fat_pct !== undefined ? String(s.fat_pct) : "");
      setSnfPct(s?.snf_pct !== null && s?.snf_pct !== undefined ? String(s.snf_pct) : "");
      setScc(s?.scc_count !== null && s?.scc_count !== undefined ? String(s.scc_count) : "");
      setBmcTemp(s?.bmc_temperature_c !== null && s?.bmc_temperature_c !== undefined ? String(s.bmc_temperature_c) : "");
      setNotes(s?.remarks || "");
    } catch (err: any) {
      setLoadError(err?.message || t("dyFailedToLoadDay"));
    } finally {
      setLoading(false);
    }
  }, [batchId, selectedDate, t]);

  useEffect(() => {
    load();
  }, [load]);

  const batch = useMemo(() => batches.find((b) => b.batch_id === batchId), [batches, batchId]);

  const totalLitres = useMemo(() => {
    const m = morning.trim() === "" ? 0 : Number(morning);
    const e = evening.trim() === "" ? 0 : Number(evening);
    return m + e;
  }, [morning, evening]);

  const milkingHead = Number(summary?.milking_head || 0);
  const avgPerCow = milkingHead > 0 ? (totalLitres / milkingHead).toFixed(2) : null;
  const totalCost = Number(costs?.total_cost || 0);
  const costPerLitre = totalLitres > 0 && totalCost > 0 ? (totalCost / totalLitres).toFixed(2) : null;

  const handleSave = async () => {
    setSaveError("");
    if (!batchId || !companyId) return setSaveError(t("dyNoBatchSelected"));
    if (morning.trim() === "" && evening.trim() === "") {
      return setSaveError(t("dyNeedOneSession"));
    }

    setSaving(true);
    try {
      const base = {
        company_id: companyId,
        batch_id: batchId,
        log_date: selectedDate,
        ...(areaId ? { operational_area_id: areaId } : {}),
        ...(fatPct.trim() ? { fat_pct: Number(fatPct) } : {}),
        ...(snfPct.trim() ? { snf_pct: Number(snfPct) } : {}),
        ...(scc.trim() ? { scc_count: Number(scc) } : {}),
        ...(bmcTemp.trim() ? { bmc_temperature_c: Number(bmcTemp) } : {}),
        ...(notes.trim() ? { remarks: notes.trim() } : {}),
      };
      // Each session is its own record, so a day's total is always the sum of
      // what was actually milked.
      if (morning.trim() !== "") {
        await api.post(`/milk-production`, { ...base, session: "MORNING", quantity_litres: Number(morning) });
      }
      if (evening.trim() !== "") {
        await api.post(`/milk-production`, { ...base, session: "EVENING", quantity_litres: Number(evening) });
      }
      await load();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err: any) {
      // Deliberately surfaced. The previous version caught and discarded this,
      // then showed a success tick regardless.
      setSaveError(err?.message || t("dyFailedToSaveMilk"));
    } finally {
      setSaving(false);
    }
  };

  if (!loading && !loadError && batches.length === 0) {
    return (
      <EmptyState
        icon={Milk}
        title={t("dyNoActiveBatches")}
        description={t("dyNoActiveBatchesHint")}
        action={{ label: t("batchList"), onClick: () => router.push("/batches") }}
      />
    );
  }

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      <Toast variant="danger" message={saveError} onClose={() => setSaveError("")} />
      <Toast variant="success" message={saveSuccess ? t("dyMilkSaved") : ""} onClose={() => setSaveSuccess(false)} />

      {/* Batch, date and the save action */}
      <div
        className="rounded-[var(--radius-lg)] border p-5 shadow-xs"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="flex flex-wrap items-end gap-4">
            <div
              className="hidden h-12 w-12 items-center justify-center rounded-[var(--radius-md)] text-[var(--accent)] sm:flex"
              style={{ backgroundColor: "var(--accent-muted)" }}
            >
              <Layers className="h-6 w-6" />
            </div>
            <label className="block">
              <span className="nf-text-label">{t("btFromBatch")}</span>
              <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="min-w-[220px]">
                {batches.map((b) => (
                  <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="nf-text-label">{t("dyLogDate")}</span>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[var(--accent)]" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="nf-input text-sm"
                />
              </div>
            </label>
          </div>

          <Button onClick={handleSave} disabled={saving || loading} className="gap-2">
            {saving ? <Activity className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? t("asSaving") : t("dySaveMilking")}
          </Button>
        </div>

        {batch && (
          <p className="mt-3 text-xs text-[var(--text-secondary)]">
            {batch.batch_no}
            {batch.current_stage_code ? ` • ${batch.current_stage_code}` : ""}
            {batch.start_date ? ` • ${t("bdeStartLabel")} ${batch.start_date}` : ""}
          </p>
        )}
      </div>

      {loading ? (
        <LoadingState label={t("dyLoadingDay")} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : (
        <>
          <StatRow columns={4}>
            <StatCard label={t("dyLactatingCows")} value={milkingHead} unit={t("btColHead")} />
            <StatCard label={t("dyTodaysTotalMilk")} value={totalLitres ? totalLitres.toLocaleString() : "—"} unit={t("dyLitres")}  />
            <StatCard label={t("dyAvgYieldPerCow")} value={avgPerCow ?? "—"} unit={avgPerCow ? t("dyLitres") : undefined} />
            <StatCard
              label={t("dyUnitCostOfMilk")}
              value={costPerLitre ? money(costPerLitre) : "—"}
              sub={costPerLitre ? t("dyPerLitre") : t("dyNoCostsRecorded")}
            />
          </StatRow>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {/* Milking sessions */}
              <section
                className="space-y-4 rounded-[var(--radius-lg)] border p-5"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <Milk className="h-4 w-4 text-[var(--accent)]" />
                    <h3 className="text-sm font-semibold">{t("dyMilkingYieldHeader")}</h3>
                  </div>
                  <span className="text-xs font-semibold text-[var(--accent)]">
                    {totalLitres ? `${totalLitres.toLocaleString()} ${t("dyLitres")}` : "—"}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="nf-text-label">{t("dyMorningSession")}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={morning}
                      onChange={(e) => setMorning(e.target.value)}
                      placeholder={t("dyNotRecorded")}
                      className="nf-input w-full font-mono text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="nf-text-label">{t("dyEveningSession")}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={evening}
                      onChange={(e) => setEvening(e.target.value)}
                      placeholder={t("dyNotRecorded")}
                      className="nf-input w-full font-mono text-sm"
                    />
                  </label>
                </div>
              </section>

              {/* Quality composition */}
              <section
                className="space-y-4 rounded-[var(--radius-lg)] border p-5"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-sm font-semibold">{t("dyQualityComposition")}</h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <label className="block">
                    <span className="nf-text-label">{t("dyFatPct")}</span>
                    <input type="number" step="0.01" min={0} value={fatPct} onChange={(e) => setFatPct(e.target.value)} className="nf-input w-full font-mono text-sm" />
                  </label>
                  <label className="block">
                    <span className="nf-text-label">SNF %</span>
                    <input type="number" step="0.01" min={0} value={snfPct} onChange={(e) => setSnfPct(e.target.value)} className="nf-input w-full font-mono text-sm" />
                  </label>
                  <label className="block">
                    <span className="nf-text-label">{t("dySccCount")}</span>
                    <input type="number" min={0} value={scc} onChange={(e) => setScc(e.target.value)} className="nf-input w-full font-mono text-sm" />
                  </label>
                  <label className="block">
                    <span className="nf-text-label">{t("dyBmcTemp")}</span>
                    <input type="number" step="0.1" value={bmcTemp} onChange={(e) => setBmcTemp(e.target.value)} className="nf-input w-full font-mono text-sm" />
                  </label>
                </div>
              </section>

              {/* Notes */}
              <section
                className="space-y-3 rounded-[var(--radius-lg)] border p-5"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <h3 className="text-sm font-semibold">{t("dyClinicalFacilityNotes")}</h3>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("dyNotesPlaceholder")}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
                />
              </section>
            </div>

            {/* The day's real cost lines */}
            <div className="space-y-6">
              <section
                className="space-y-3 rounded-[var(--radius-lg)] border p-5 text-xs"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-sm font-semibold">{t("dyTodaysProdSummary")}</h3>
                </div>

                {!costs || costs.recorded_lines === 0 ? (
                  <div className="space-y-3">
                    <p className="text-[var(--text-secondary)]">{t("dyNoCostLines")}</p>
                    {/* Feed, medicine, labour and overheads are recorded on the
                        shared Data Entry screen for every LOB — this panel does
                        not duplicate that form, it links to it. */}
                    <Button variant="outline" size="sm" onClick={() => router.push("/batches/entry")} className="w-full gap-1.5">
                      {t("navBatchEntry")} <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <CostLine label={t("dyTotalFeedCost")} value={costs.feed?.total} />
                    <CostLine label={t("dyVeterinaryHealth")} value={costs.medicine?.total} />
                    <CostLine label={t("dyLabourMachinery")} value={costs.labour?.total} />
                    <CostLine label={t("dyOverheadsUtilities")} value={costs.utilities?.total} />
                    {Number(costs.other_consumption?.total) > 0 && (
                      <CostLine label={t("swCostElementBreakdown")} value={costs.other_consumption?.total} />
                    )}
                    <div className="flex items-center justify-between border-t pt-2 font-semibold" style={{ borderColor: "var(--border)" }}>
                      <span>{t("swTotalStageWip")}</span>
                      <span className="font-mono text-[var(--accent)]">{money(costs.total_cost)}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => router.push("/batches/entry")} className="mt-2 w-full gap-1.5">
                      {t("navBatchEntry")} <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </section>

              {summary && summary.recorded_sessions > 0 && (
                <section
                  className="space-y-2 rounded-[var(--radius-lg)] border p-5 text-xs"
                  style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-2 font-semibold text-[var(--success)]">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{t("dySessionsRecorded", { n: String(summary.recorded_sessions) })}</span>
                  </div>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CostLine({ label, value }: { label: string; value: unknown }) {
  const { formatMoney } = useCompanyCurrency();
  const money = (v: unknown) => formatMoney(Number(v || 0));
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="font-mono">{money(value)}</span>
    </div>
  );
}
