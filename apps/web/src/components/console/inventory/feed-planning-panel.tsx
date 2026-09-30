"use client";

/** Feed Planning: farms are collapsible grouping rows; planning values belong to their silos. */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Save } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";

const CELL_PADDING_PX = 12; // px-1.5 either side
const SAVE_PX = 30;

const SILO_CELL_PX = 170;
const HELD_CELL_PX = 130;
const CAPACITY_PX = 72;
const SILO_INPUTS_PX = [76, 76, 56];
const SILO_PX = [SILO_CELL_PX, HELD_CELL_PX, CAPACITY_PX, ...SILO_INPUTS_PX, SAVE_PX];

export const FEED_PLANNING_LAYOUT = {
  cellPaddingPx: CELL_PADDING_PX,
  savePx: SAVE_PX,
  siloPx: SILO_PX,
  siloTotalPx: SILO_PX.reduce((a, b) => a + b, 0) + (SILO_INPUTS_PX.length + 2) * CELL_PADDING_PX,
} as const;

export interface FeedPlanningFarm {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string | null;
  /** Retained for API response compatibility; these values are not edited here. */
  settings: Record<string, number | null>;
  /** D41: the farm's silos, whose levels and reorder days are edited here too. */
  silos?: FeedPlanningSilo[];
}

/** D41: one silo under its farm. The feed it holds is read-only. */
export interface FeedPlanningSilo {
  locationId: string;
  code: string;
  name: string;
  feedItemCode: string | null;
  feedItemName: string | null;
  capacityKg: number | null;
  lowLevelKg: number | null;
  highLevelKg: number | null;
  reorderDays: number | null;
}

type SiloKey = "low_level_kg" | "high_level_kg" | "silo_reorder_days";
type SiloDraft = Record<SiloKey, string>;

const SILO_COLUMNS: { key: SiloKey; labelKey: string; from: (s: FeedPlanningSilo) => number | null; widthPx: number }[] = [
  { key: "low_level_kg", labelKey: "fpSiloLow", from: (s) => s.lowLevelKg, widthPx: 76 },
  { key: "high_level_kg", labelKey: "fpSiloHigh", from: (s) => s.highLevelKg, widthPx: 76 },
  { key: "silo_reorder_days", labelKey: "fpSiloReorder", from: (s) => s.reorderDays, widthPx: 56 },
];

const siloDraftOf = (silo: FeedPlanningSilo): SiloDraft => ({
  low_level_kg: silo.lowLevelKg?.toString() ?? "",
  high_level_kg: silo.highLevelKg?.toString() ?? "",
  silo_reorder_days: silo.reorderDays?.toString() ?? "",
});

const siloPayloadOf = (draft: SiloDraft): Record<SiloKey, number | null> => {
  const value = (raw: string) => (raw.trim() === "" ? null : Number(raw));
  return {
    low_level_kg: value(draft.low_level_kg),
    high_level_kg: value(draft.high_level_kg),
    silo_reorder_days: value(draft.silo_reorder_days),
  };
};

// The header wraps on purpose: a nowrap header was what made the columns
// wider than their inputs, and so the table wider than its box.
const TH = "px-1.5 py-1.5 align-bottom text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "px-1.5 py-1.5 text-xs text-[var(--text-primary)]";
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

  /** D41: one silo's levels and reorder days, through the silo endpoint. */
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
          reorderDays: settings.silo_reorder_days,
        })),
      })));
      setSiloSaved(silo.locationId);
    } catch (err: any) {
      setRowError({ farmId: farm.farmId, message: err?.message || t("fpSaveFailed") });
    } finally {
      setSiloSaving(null);
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
                        <section aria-label={t("fpSiloSection", { farm: farm.code })} className="space-y-1.5">
                          {(farm.silos ?? []).length === 0 ? (
                            <p className="text-xs text-[var(--text-secondary)]">{t("fpNoSilos", { farm: farm.code })}</p>
                          ) : (
                            <ScrollTable label={t("fpSiloTableLabel", { farm: farm.code })}>
                              <thead>
                                <tr>
                                  <th scope="col" className={TH} style={{ width: SILO_CELL_PX + CELL_PADDING_PX }}>{t("fpSiloColSilo")}</th>
                                  <th scope="col" className={TH} style={{ width: HELD_CELL_PX + CELL_PADDING_PX }}>{t("fpSiloColHeld")}</th>
                                  <th scope="col" className={`${TH} text-right`} style={{ width: CAPACITY_PX + CELL_PADDING_PX }}>
                                    {t("fpSiloColCapacity")}
                                    <span className="block font-normal normal-case tracking-normal">{t("fpUnitKg")}</span>
                                  </th>
                                  {SILO_COLUMNS.map((column) => (
                                    <th key={column.key} scope="col" className={`${TH} text-right`} style={{ width: column.widthPx + CELL_PADDING_PX }}>
                                      {t(`${column.labelKey}Col` as any)}
                                      <span className="block font-normal normal-case tracking-normal">
                                        {t(column.key === "silo_reorder_days" ? "fpUnitDays" : "fpUnitKg")}
                                      </span>
                                    </th>
                                  ))}
                                  <th scope="col" className={TH} style={{ width: SAVE_PX + CELL_PADDING_PX }} />
                                </tr>
                              </thead>
                              <tbody>
                                {(farm.silos ?? []).map((silo) => {
                                  const siloDraft = siloDrafts[silo.locationId] ?? siloDraftOf(silo);
                                  return (
                                    <tr key={silo.locationId}>
                                      <td className={TD} style={{ width: SILO_CELL_PX + CELL_PADDING_PX }}><span className="font-medium">{silo.code} — {silo.name}</span></td>
                                      <td className={TD} style={{ width: HELD_CELL_PX + CELL_PADDING_PX }}><span className="text-[var(--text-secondary)]">{silo.feedItemName || silo.feedItemCode || t("fpSiloEmpty")}</span></td>
                                      <td className={`${TD} text-right tabular-nums`} style={{ width: CAPACITY_PX + CELL_PADDING_PX }}>{silo.capacityKg == null ? "—" : silo.capacityKg.toLocaleString("en-US")}</td>
                                      {SILO_COLUMNS.map((column) => (
                                        <td key={column.key} className={`${TD} text-right`}>
                                          <input type="number" aria-label={t(column.labelKey as any, { silo: silo.code })} className="nf-input-sm text-right tabular-nums" style={{ ...inputStyle, width: column.widthPx }} min={0} step="1" value={siloDraft[column.key]} onChange={(e) => setSiloCell(silo.locationId, column.key, e.target.value)} />
                                        </td>
                                      ))}
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
