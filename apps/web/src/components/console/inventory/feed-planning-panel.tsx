"use client";

/** Silo Feed Setup: farms are collapsible grouping rows; setup values belong to their silos. */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Save } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { ScrollTable } from "@/components/ui/scroll-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { useLanguage } from "@/hooks/useLanguage";

const CELL_PADDING_PX = 12; // px-1.5 either side
const SAVE_PX = 30;

const CODE_PX = 105;
const NAME_PX = 75;
const SHEDS_PX = 130;
const FEED_TYPE_PX = 55;
const ITEM_CODE_PX = 95;
const ITEM_NAME_PX = 105;
const CAPACITY_PX = 55;
const STATUS_PX = 55;
const SILO_INPUTS_PX = [60, 60];
const SILO_PX = [CODE_PX, NAME_PX, SHEDS_PX, FEED_TYPE_PX, ITEM_CODE_PX, ITEM_NAME_PX, CAPACITY_PX, ...SILO_INPUTS_PX, STATUS_PX, SAVE_PX];

export const FEED_PLANNING_LAYOUT = {
  cellPaddingPx: CELL_PADDING_PX,
  savePx: SAVE_PX,
  siloPx: SILO_PX,
  siloTotalPx: SILO_PX.reduce((a, b) => a + b, 0) + SILO_PX.length * CELL_PADDING_PX,
} as const;

/** What a farm may override and the company sets (GET/PUT /feed-settings). */
type LogisticsKey = "safetyStockKg" | "bagSizeKg" | "bulkMultipleKg" | "truckTargetKg" | "productionWeekday";
type LogisticsDraft = Record<LogisticsKey, string>;
type CompanySettings = Record<LogisticsKey, number | null>;

// labelKey is the accessible name of an input ("... for {{name}}"); colKey is the visible caption.
const LOGISTICS_FIELDS: { key: LogisticsKey; labelKey: string; colKey: string; widthPx: number }[] = [
  { key: "safetyStockKg", labelKey: "fsetSafetyStock", colKey: "fsetSafetyStockCol", widthPx: 90 },
  { key: "bagSizeKg", labelKey: "fsetBagSize", colKey: "fsetBagSizeCol", widthPx: 90 },
  { key: "bulkMultipleKg", labelKey: "fsetBulkMultiple", colKey: "fsetBulkMultipleCol", widthPx: 90 },
  { key: "truckTargetKg", labelKey: "fsetTruckTarget", colKey: "fsetTruckTargetCol", widthPx: 90 },
];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const logisticsDraftOf = (values: Partial<Record<LogisticsKey, number | null>> | undefined): LogisticsDraft => ({
  safetyStockKg: values?.safetyStockKg?.toString() ?? "",
  bagSizeKg: values?.bagSizeKg?.toString() ?? "",
  bulkMultipleKg: values?.bulkMultipleKg?.toString() ?? "",
  truckTargetKg: values?.truckTargetKg?.toString() ?? "",
  productionWeekday: values?.productionWeekday?.toString() ?? "",
});
const numberOrNull = (raw: string) => (raw.trim() === "" ? null : Number(raw));

export interface FeedPlanningFarm {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string | null;
  /** The farm's override row in Feed Planning Settings; null = the farm inherits the company value. */
  settings?: Partial<Record<LogisticsKey, number | null>>;
  /** D41: the farm's silos, whose levels are edited here too. */
  silos?: FeedPlanningSilo[];
}

/**
 * D41: one silo under its farm. The feed it holds is read-only.
 *
 * Task 4 (3 Oct ruling): silo_reorder_days left this screen for Location
 * Master, which owns it exclusively now (spec R6) — editable there via
 * master-data/configs.ts's "Refill Lead Time (days)" field. The forecast
 * does not read the column either (engine.ts, Task 3).
 */
export interface FeedPlanningSilo {
  locationId: string;
  code: string;
  name: string;
  linkedSheds: Array<{ locationId: string; code: string; name: string }>;
  feedType: "BULK" | "BAGGED";
  feedItemCode: string | null;
  feedItemName: string | null;
  capacityKg: number | null;
  lowLevelKg: number | null;
  highLevelKg: number | null;
  status: string;
}

type SiloKey = "low_level_kg" | "high_level_kg";
type SiloDraft = Record<SiloKey, string> & { feedType: "BULK" | "BAGGED" };

const SILO_COLUMNS: { key: SiloKey; labelKey: string; from: (s: FeedPlanningSilo) => number | null; widthPx: number }[] = [
  { key: "low_level_kg", labelKey: "fpSiloLow", from: (s) => s.lowLevelKg, widthPx: SILO_INPUTS_PX[0] },
  { key: "high_level_kg", labelKey: "fpSiloHigh", from: (s) => s.highLevelKg, widthPx: SILO_INPUTS_PX[1] },
];

const siloDraftOf = (silo: FeedPlanningSilo): SiloDraft => ({
  low_level_kg: silo.lowLevelKg?.toString() ?? "",
  high_level_kg: silo.highLevelKg?.toString() ?? "",
  feedType: silo.feedType,
});

const siloPayloadOf = (draft: SiloDraft): Record<SiloKey, number | null> & { feedType: "BULK" | "BAGGED" } => {
  const value = (raw: string) => (raw.trim() === "" ? null : Number(raw));
  return {
    low_level_kg: value(draft.low_level_kg),
    high_level_kg: value(draft.high_level_kg),
    feedType: draft.feedType,
  };
};

// The header wraps on purpose: a nowrap header was what made the columns
// wider than their inputs, and so the table wider than its box.
const TH = "px-1.5 py-1.5 align-bottom text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "px-1.5 py-1.5 text-xs text-[var(--text-primary)]";
const weekdayName = (day: number) => new Date(Date.UTC(2024, 0, 7 + day)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

export function FeedPlanningPanel() {
  const { t } = useLanguage();
  const [farms, setFarms] = useState<FeedPlanningFarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [rowError, setRowError] = useState<{ farmId: string; message: string } | null>(null);
  // D41: one draft per silo, keyed by its location id.
  const [siloDrafts, setSiloDrafts] = useState<Record<string, SiloDraft>>({});
  const [siloSaving, setSiloSaving] = useState<string | null>(null);
  const [siloSaved, setSiloSaved] = useState<string | null>(null);
  const [expandedFarms, setExpandedFarms] = useState<Record<string, boolean>>({});
  const [attempt, setAttempt] = useState(0);
  // Feed Planning Settings: the company's effective values, and one draft per company / farm override.
  const [companySettings, setCompanySettings] = useState<Record<string, CompanySettings>>({});
  const [companyDrafts, setCompanyDrafts] = useState<Record<string, LogisticsDraft>>({});
  const [farmDrafts, setFarmDrafts] = useState<Record<string, LogisticsDraft>>({});
  const [settingsSaving, setSettingsSaving] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    api
      .get("/feed-forecast/farm-settings")
      .then((res: any) => {
        if (!alive) return;
        const raw = res?.data ?? res;
        const list: FeedPlanningFarm[] = Array.isArray(raw) ? raw : [];
        setFarms(list);
        setSiloDrafts(Object.fromEntries(list.flatMap((farm) => (farm.silos ?? []).map((silo) => [silo.locationId, siloDraftOf(silo)]))));
        setFarmDrafts(Object.fromEntries(list.map((farm) => [farm.farmId, logisticsDraftOf(farm.settings)])));
        // One read of the company's effective settings per company the farms belong to.
        const companyIds = Array.from(new Set(list.map((farm) => farm.companyId).filter(Boolean)));
        companyIds.forEach((companyId) => {
          api
            .get(`/feed-settings?companyId=${companyId}`)
            .then((settingsRes: any) => {
              if (!alive) return;
              const data = settingsRes?.data ?? settingsRes;
              const values: CompanySettings = {
                safetyStockKg: data?.safetyStockKg ?? 0,
                bagSizeKg: data?.bagSizeKg ?? null,
                bulkMultipleKg: data?.bulkMultipleKg ?? null,
                truckTargetKg: data?.truckTargetKg ?? null,
                productionWeekday: data?.productionWeekday ?? null,
              };
              setCompanySettings((cur) => ({ ...cur, [companyId]: values }));
              setCompanyDrafts((cur) => ({ ...cur, [companyId]: logisticsDraftOf(values) }));
            })
            .catch(() => {
              if (alive) setRowError({ farmId: companyId, message: t("fpLoadFailed") });
            });
        });
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const allSilos = useMemo(() => farms.flatMap((farm) => (farm.silos ?? []).map((silo) => ({ farm, silo }))), [farms]);
  const siloPristine = useMemo(
    () => Object.fromEntries(allSilos.map(({ silo }) => [silo.locationId, JSON.stringify(siloDraftOf(silo))])),
    [allSilos],
  );
  const siloChanged = (siloId: string) => JSON.stringify(siloDrafts[siloId]) !== siloPristine[siloId];
  const setSiloCell = (siloId: string, key: SiloKey, raw: string) =>
    setSiloDrafts((cur) => ({ ...cur, [siloId]: { ...cur[siloId], [key]: raw } }));
  const setSiloFeedType = (siloId: string, feedType: "BULK" | "BAGGED") =>
    setSiloDrafts((cur) => ({ ...cur, [siloId]: { ...cur[siloId], feedType } }));

  /** D41: one silo's levels, through the silo endpoint. */
  const saveSilo = async (farm: FeedPlanningFarm, silo: FeedPlanningSilo) => {
    setSiloSaving(silo.locationId);
    setRowError(null);
    setSiloSaved(null);
    try {
      const settings = siloPayloadOf(siloDrafts[silo.locationId]);
      await api.put(`/feed-forecast/farm-settings/${farm.farmId}/silos/${silo.locationId}`, settings);
      setFarms((cur) => cur.map((f) => (f.farmId !== farm.farmId ? f : {
        ...f,
        silos: (f.silos ?? []).map((x) => (x.locationId !== silo.locationId ? x : {
          ...x,
          lowLevelKg: settings.low_level_kg,
          highLevelKg: settings.high_level_kg,
          feedType: settings.feedType,
        })),
      })));
      setSiloSaved(silo.locationId);
    } catch (err: any) {
      setRowError({ farmId: farm.farmId, message: err?.message || t("fpSaveFailed") });
    } finally {
      setSiloSaving(null);
    }
  };

  const companies = useMemo(() => {
    const seen = new Map<string, string>();
    farms.forEach((farm) => { if (farm.companyId && !seen.has(farm.companyId)) seen.set(farm.companyId, farm.companyName ?? farm.companyId); });
    return Array.from(seen, ([companyId, name]) => ({ companyId, name }));
  }, [farms]);

  const companyChanged = (companyId: string) => {
    const draft = companyDrafts[companyId];
    const current = companySettings[companyId];
    return !!draft && !!current && (draft.safetyStockKg !== (current.safetyStockKg?.toString() ?? "") || draft.bagSizeKg !== (current.bagSizeKg?.toString() ?? ""));
  };
  const farmChanged = (farm: FeedPlanningFarm) => JSON.stringify(farmDrafts[farm.farmId]) !== JSON.stringify(logisticsDraftOf(farm.settings));

  /** Company Safety Stock KG and Bag Size KG, through PUT /feed-settings (a blank safety stock is 0). */
  const saveCompany = async (companyId: string) => {
    const draft = companyDrafts[companyId];
    setSettingsSaving(companyId);
    setRowError(null);
    setSettingsSaved(null);
    try {
      const body = { companyId, safetyStockKg: numberOrNull(draft.safetyStockKg) ?? 0, bagSizeKg: numberOrNull(draft.bagSizeKg) };
      await api.put("/feed-settings", body);
      const next = { ...companySettings[companyId], safetyStockKg: body.safetyStockKg, bagSizeKg: body.bagSizeKg };
      setCompanySettings((cur) => ({ ...cur, [companyId]: next }));
      setCompanyDrafts((cur) => ({ ...cur, [companyId]: logisticsDraftOf(next) }));
      setSettingsSaved(companyId);
    } catch (err: any) {
      setRowError({ farmId: companyId, message: err?.message || t("fpSaveFailed") });
    } finally {
      setSettingsSaving(null);
    }
  };

  /** A farm's override row, through PUT /feed-settings/farm: a blank field is sent as null, which clears the override. */
  const saveFarmOverride = async (farm: FeedPlanningFarm) => {
    const draft = farmDrafts[farm.farmId];
    setSettingsSaving(farm.farmId);
    setRowError(null);
    setSettingsSaved(null);
    try {
      const body = {
        companyId: farm.companyId,
        farmId: farm.farmId,
        safetyStockKg: numberOrNull(draft.safetyStockKg),
        bagSizeKg: numberOrNull(draft.bagSizeKg),
        bulkMultipleKg: numberOrNull(draft.bulkMultipleKg),
        truckTargetKg: numberOrNull(draft.truckTargetKg),
        productionWeekday: numberOrNull(draft.productionWeekday),
      };
      await api.put("/feed-settings/farm", body);
      setFarms((cur) => cur.map((f) => (f.farmId !== farm.farmId ? f : {
        ...f,
        settings: { safetyStockKg: body.safetyStockKg, bagSizeKg: body.bagSizeKg, bulkMultipleKg: body.bulkMultipleKg, truckTargetKg: body.truckTargetKg, productionWeekday: body.productionWeekday },
      })));
      setSettingsSaved(farm.farmId);
    } catch (err: any) {
      setRowError({ farmId: farm.farmId, message: err?.message || t("fpSaveFailed") });
    } finally {
      setSettingsSaving(null);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("fpLoading")}
      </p>
    );
  }

  if (failed) {
    return (
      <InlineAlert>
        <span className="mr-3">{t("fpLoadFailed")}</span>
        <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t("fpRetry")}</Button>
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-3">
      {rowError && <InlineAlert>{rowError.message}</InlineAlert>}
      {companies.map(({ companyId, name }) => {
        const draft = companyDrafts[companyId];
        if (!draft) return null;
        return (
          <section key={companyId} aria-label={t("fsetCompanySection", { name })} className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--border)] p-2">
            <h3 className="w-full text-xs font-semibold text-[var(--text-primary)]">{t("fsetCompanyHeading", { name })}</h3>
            {(["safetyStockKg", "bagSizeKg"] as const).map((key) => {
              const field = LOGISTICS_FIELDS.find((f) => f.key === key)!;
              return (
                <label key={key} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  <span className="block">{t(field.colKey as any)}</span>
                  <input type="number" aria-label={t(field.labelKey as any, { name })} className="nf-input-sm mt-1 text-right tabular-nums" style={{ ...inputStyle, width: field.widthPx }} min={0} step="1" value={draft[key]} onChange={(e) => setCompanyDrafts((cur) => ({ ...cur, [companyId]: { ...cur[companyId], [key]: e.target.value } }))} />
                </label>
              );
            })}
            <Button size="sm" variant="outline" className="h-7" aria-label={t("fsetSave", { name })} disabled={!companyChanged(companyId) || settingsSaving === companyId} onClick={() => saveCompany(companyId)}>
              {settingsSaved === companyId && !companyChanged(companyId) ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            </Button>
          </section>
        );
      })}
      {farms.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">{t("fpNoFarms")}</p>
      ) : (
        <ScrollTable label={t("fpTableLabel")}>
          <thead>
            <tr>
              <th scope="col" className={TH}>{t("fpColFarm")}</th>
            </tr>
          </thead>
          <tbody>
            {farms.map((farm) => {
              const expanded = expandedFarms[farm.farmId] ?? false;
              const detailId = `feed-planning-silos-${farm.farmId}`;
              return (
                <Fragment key={farm.farmId}>
                  <tr>
                    <td className={TD}>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left font-medium"
                        aria-expanded={expanded}
                        aria-controls={detailId}
                        aria-label={t("fpSiloHeading", { farm: `${farm.code} — ${farm.name}` })}
                        onClick={() => setExpandedFarms((current) => ({ ...current, [farm.farmId]: !expanded }))}
                      >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        <span>{farm.code} — {farm.name}</span>
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr id={detailId}>
                      <td className="bg-[var(--surface-subtle)] p-2 pl-6">
                        <section aria-label={t("fsetFarmSection", { name: farm.code })} className="mb-2 flex flex-wrap items-end gap-3">
                          <h4 className="w-full text-xs font-semibold text-[var(--text-primary)]">{t("fsetFarmHeading", { name: farm.code })}</h4>
                          {LOGISTICS_FIELDS.map((field) => (
                            <label key={field.key} className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                              <span className="block">{t(field.colKey as any)}</span>
                              <input
                                type="number"
                                aria-label={t(field.labelKey as any, { name: farm.code })}
                                className="nf-input-sm mt-1 text-right tabular-nums"
                                style={{ ...inputStyle, width: field.widthPx }}
                                min={0}
                                step="1"
                                placeholder={companySettings[farm.companyId]?.[field.key]?.toString() ?? ""}
                                value={farmDrafts[farm.farmId]?.[field.key] ?? ""}
                                onChange={(e) => setFarmDrafts((cur) => ({ ...cur, [farm.farmId]: { ...cur[farm.farmId], [field.key]: e.target.value } }))}
                              />
                            </label>
                          ))}
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                            <span className="block">{t("fsetProductionWeekdayCol")}</span>
                            <select
                              aria-label={t("fsetProductionWeekday", { name: farm.code })}
                              className="nf-input-sm mt-1"
                              style={{ ...inputStyle, width: 110 }}
                              value={farmDrafts[farm.farmId]?.productionWeekday ?? ""}
                              onChange={(e) => setFarmDrafts((cur) => ({ ...cur, [farm.farmId]: { ...cur[farm.farmId], productionWeekday: e.target.value } }))}
                            >
                              <option value="">{t("fsetInheritCompany")}</option>
                              {WEEKDAYS.map((day) => <option key={day} value={day}>{weekdayName(day)}</option>)}
                            </select>
                          </label>
                          <Button size="sm" variant="outline" className="h-7" aria-label={t("fsetSave", { name: farm.code })} disabled={!farmChanged(farm) || settingsSaving === farm.farmId} onClick={() => saveFarmOverride(farm)}>
                            {settingsSaved === farm.farmId && !farmChanged(farm) ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                          </Button>
                        </section>
                        <section aria-label={t("fpSiloSection", { farm: farm.code })} className="space-y-1.5">
                          {(farm.silos ?? []).length === 0 ? (
                            <p className="text-xs text-[var(--text-secondary)]">{t("fpNoSilos", { farm: farm.code })}</p>
                          ) : (
                            <ScrollTable label={t("fpSiloTableLabel", { farm: farm.code })}>
                              <thead>
                                <tr>
                                  <th scope="col" className={TH} style={{ width: CODE_PX + CELL_PADDING_PX }}>{t("fpSiloColCode")}</th>
                                  <th scope="col" className={TH} style={{ width: NAME_PX + CELL_PADDING_PX }}>{t("fpSiloColName")}</th>
                                  <th scope="col" className={TH} style={{ width: SHEDS_PX + CELL_PADDING_PX }}>{t("fpSiloColSheds")}</th>
                                  <th scope="col" className={TH} style={{ width: FEED_TYPE_PX + CELL_PADDING_PX }}>{t("fpSiloColFeedType")}</th>
                                  <th scope="col" className={TH} style={{ width: ITEM_CODE_PX + CELL_PADDING_PX }}>{t("fpSiloColFeedItemCode")}</th>
                                  <th scope="col" className={TH} style={{ width: ITEM_NAME_PX + CELL_PADDING_PX }}>{t("fpSiloColFeedItemName")}</th>
                                  <th scope="col" className={`${TH} text-right`} style={{ width: CAPACITY_PX + CELL_PADDING_PX }}>
                                    {t("fpSiloColCapacity")}
                                    <span className="block font-normal normal-case tracking-normal">{t("fpUnitKg")}</span>
                                  </th>
                                  {SILO_COLUMNS.map((column) => (
                                    <th key={column.key} scope="col" className={`${TH} text-right`} style={{ width: column.widthPx + CELL_PADDING_PX }}>
                                      {t(`${column.labelKey}Col` as any)}
                                      <span className="block font-normal normal-case tracking-normal">
                                        {t("fpUnitKg")}
                                      </span>
                                    </th>
                                  ))}
                                  <th scope="col" className={TH} style={{ width: STATUS_PX + CELL_PADDING_PX }}>{t("fpSiloColStatus")}</th>
                                  <th scope="col" className={TH} style={{ width: SAVE_PX + CELL_PADDING_PX }} />
                                </tr>
                              </thead>
                              <tbody>
                                {(farm.silos ?? []).map((silo) => {
                                  const siloDraft = siloDrafts[silo.locationId] ?? siloDraftOf(silo);
                                  return (
                                    <tr key={silo.locationId}>
                                      <td className={TD} style={{ width: CODE_PX + CELL_PADDING_PX }}><span className="font-medium">{silo.code}</span></td>
                                      <td className={TD} style={{ width: NAME_PX + CELL_PADDING_PX }}>{silo.name}</td>
                                      <td className={TD} style={{ width: SHEDS_PX + CELL_PADDING_PX }}>
                                        {(silo.linkedSheds ?? []).length
                                          ? silo.linkedSheds.map((shed) => `${shed.code} — ${shed.name}`).join(", ")
                                          : "—"}
                                      </td>
                                      <td className={TD} style={{ width: FEED_TYPE_PX + CELL_PADDING_PX }}>
                                        <select aria-label={t("fpSiloFeedType", { silo: silo.code })} className="nf-input-sm" style={{ ...inputStyle, width: FEED_TYPE_PX }} value={siloDraft.feedType} onChange={(e) => setSiloFeedType(silo.locationId, e.target.value as "BULK" | "BAGGED")}>
                                          <option value="BULK">BULK</option>
                                          <option value="BAGGED">BAGGED</option>
                                        </select>
                                      </td>
                                      <td className={TD} style={{ width: ITEM_CODE_PX + CELL_PADDING_PX }}>{silo.feedItemCode ?? "—"}</td>
                                      <td className={TD} style={{ width: ITEM_NAME_PX + CELL_PADDING_PX }}>{silo.feedItemName ?? "—"}</td>
                                      <td className={`${TD} text-right tabular-nums`} style={{ width: CAPACITY_PX + CELL_PADDING_PX }}>{silo.capacityKg == null ? "—" : silo.capacityKg.toLocaleString("en-US")}</td>
                                      {SILO_COLUMNS.map((column) => (
                                        <td key={column.key} className={`${TD} text-right`}>
                                          <input type="number" aria-label={t(column.labelKey as any, { silo: silo.code })} className="nf-input-sm text-right tabular-nums" style={{ ...inputStyle, width: column.widthPx }} min={0} step="1" value={siloDraft[column.key]} onChange={(e) => setSiloCell(silo.locationId, column.key, e.target.value)} />
                                        </td>
                                      ))}
                                      <td className={TD} style={{ width: STATUS_PX + CELL_PADDING_PX }}><StatusBadge status={silo.status} /></td>
                                      <td className={TD} style={{ width: SAVE_PX + CELL_PADDING_PX }}>
                                        <Button size="sm" variant="outline" className="h-7 px-0" style={{ width: SAVE_PX }} aria-label={t("fpSiloSave", { silo: silo.code })} title={siloSaved === silo.locationId && !siloChanged(silo.locationId) ? t("fpSaved") : t("fpSaveAction")} disabled={!siloChanged(silo.locationId) || siloSaving === silo.locationId} onClick={() => saveSilo(farm, silo)}>
                                          {siloSaved === silo.locationId && !siloChanged(silo.locationId) ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                                        </Button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </ScrollTable>
                          )}
                        </section>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </ScrollTable>
      )}

    </div>
  );
}

export default FeedPlanningPanel;
