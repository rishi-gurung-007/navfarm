"use client";

/**
 * Feed Planning (spec D32, Rishi 28 Sep). The six per-farm feed settings used
 * to sit on the Add/Edit Location form, which showed them only because they
 * are columns on the farm's row. They describe how a farm's feed is ordered,
 * not the farm, so they are edited here — one row per farm, each cell blank
 * where the farm has set nothing and showing the client default as a
 * placeholder, and the production day as a weekday name rather than the 0-6
 * the column stores. Saving a row sends all six for that farm, so clearing a
 * cell really clears it.
 *
 * Every column is budgeted to fit the narrowest workspace the shell gives it
 * (FEED_PLANNING_LAYOUT): at 1024 the 260 px sidebar and the page's own
 * padding leave 708 px, and the first cut of this table was 1159 px wide, so
 * the Save button sat off the edge behind a sideways scroll.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";

/** What the client's workbook says a farm gets when it sets nothing (D3, D19, Requisition §1 rows 27-28, checkpoint 27). */
export const FEED_PLANNING_DEFAULTS = {
  // D38 (28 Sep): the refill buffer left this screen — it is per SILO now,
  // the silo's own "Silo Reorder Days" on the Location form. The five below
  // stay per farm: they describe the farm's delivery and order cycle.
  feed_lead_time_days: 2,
  feed_bulk_multiple_kg: 3000,
  feed_bag_size_kg: 50,
  feed_truck_target_kg: 30000,
  feed_production_weekday: 0,
} as const;

export type FeedPlanningKey = keyof typeof FEED_PLANNING_DEFAULTS;

/**
 * The width of every cell, in pixels, so the row fits without a sideways
 * scroll — feed-planning-panel.spec.tsx adds it up against the 708 px the
 * shell leaves at 1024. The component renders from these figures, so a change
 * here is a change on screen and the budget cannot drift away from it.
 */
const CELL_PADDING_PX = 12; // px-1.5 either side
const FARM_PX = 116;
const DAYS_INPUT_PX = 56;
const KG_INPUT_PX = 72;
const SELECT_PX = 104;
const SAVE_PX = 30;
// D38: four number inputs now — lead time, then the three kilogram figures.
const INPUTS_PX = [DAYS_INPUT_PX, KG_INPUT_PX, KG_INPUT_PX, KG_INPUT_PX];

const SILO_CELL_PX = 170;
const HELD_CELL_PX = 130;
const CAPACITY_PX = 72;
const SILO_INPUTS_PX = [76, 76, 56];
const SILO_PX = [SILO_CELL_PX, HELD_CELL_PX, CAPACITY_PX, ...SILO_INPUTS_PX, SAVE_PX];

export const FEED_PLANNING_LAYOUT = {
  cellPaddingPx: CELL_PADDING_PX,
  farmPx: FARM_PX,
  inputsPx: INPUTS_PX,
  selectPx: SELECT_PX,
  savePx: SAVE_PX,
  totalPx: FARM_PX + INPUTS_PX.reduce((a, b) => a + b, 0) + SELECT_PX + SAVE_PX + (1 + INPUTS_PX.length + 2) * CELL_PADDING_PX,
  /** D41: the silo row's own budget — silo, feed held, capacity, three inputs, save. */
  siloPx: SILO_PX,
  siloTotalPx: SILO_PX.reduce((a, b) => a + b, 0) + (SILO_INPUTS_PX.length + 2) * CELL_PADDING_PX,
} as const;

export interface FeedPlanningFarm {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string | null;
  settings: Record<FeedPlanningKey, number | null>;
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

const NUMBER_COLUMNS: { key: Exclude<FeedPlanningKey, "feed_production_weekday">; labelKey: string; unitKey: string; min: number; max?: number; widthPx: number }[] = [
  { key: "feed_lead_time_days", labelKey: "fpLeadTime", unitKey: "fpUnitDays", min: 0, max: 30, widthPx: DAYS_INPUT_PX },
  { key: "feed_bulk_multiple_kg", labelKey: "fpBulkMultiple", unitKey: "fpUnitKg", min: 1, widthPx: KG_INPUT_PX },
  { key: "feed_bag_size_kg", labelKey: "fpBagSize", unitKey: "fpUnitKg", min: 1, widthPx: KG_INPUT_PX },
  { key: "feed_truck_target_kg", labelKey: "fpTruckTarget", unitKey: "fpUnitKg", min: 1, widthPx: KG_INPUT_PX },
];

const WEEKDAY_KEYS = ["fpDaySun", "fpDayMon", "fpDayTue", "fpDayWed", "fpDayThu", "fpDayFri", "fpDaySat"] as const;

// The header wraps on purpose: a nowrap header was what made the columns
// wider than their inputs, and so the table wider than its box.
const TH = "px-1.5 py-1.5 align-bottom text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "px-1.5 py-1.5 text-xs text-[var(--text-primary)]";
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

/** The form holds strings, because an emptied cell is "" and means "clear it". */
type RowDraft = Record<FeedPlanningKey, string>;

const draftOf = (farm: FeedPlanningFarm): RowDraft => ({
  feed_lead_time_days: farm.settings.feed_lead_time_days?.toString() ?? "",
  feed_bulk_multiple_kg: farm.settings.feed_bulk_multiple_kg?.toString() ?? "",
  feed_bag_size_kg: farm.settings.feed_bag_size_kg?.toString() ?? "",
  feed_truck_target_kg: farm.settings.feed_truck_target_kg?.toString() ?? "",
  feed_production_weekday: farm.settings.feed_production_weekday?.toString() ?? "",
});

const payloadOf = (draft: RowDraft): Record<FeedPlanningKey, number | null> => {
  const value = (raw: string) => (raw.trim() === "" ? null : Number(raw));
  return {
    feed_lead_time_days: value(draft.feed_lead_time_days),
    feed_bulk_multiple_kg: value(draft.feed_bulk_multiple_kg),
    feed_bag_size_kg: value(draft.feed_bag_size_kg),
    feed_truck_target_kg: value(draft.feed_truck_target_kg),
    feed_production_weekday: value(draft.feed_production_weekday),
  };
};

export function FeedPlanningPanel() {
  const { t } = useLanguage();
  const [farms, setFarms] = useState<FeedPlanningFarm[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ farmId: string; message: string } | null>(null);
  // D41: one draft per silo, keyed by its location id.
  const [siloDrafts, setSiloDrafts] = useState<Record<string, SiloDraft>>({});
  const [siloSaving, setSiloSaving] = useState<string | null>(null);
  const [siloSaved, setSiloSaved] = useState<string | null>(null);
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
        setDrafts(Object.fromEntries(list.map((farm) => [farm.farmId, draftOf(farm)])));
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

  const pristine = useMemo(
    () => Object.fromEntries(farms.map((farm) => [farm.farmId, JSON.stringify(draftOf(farm))])),
    [farms],
  );
  const changed = (farmId: string) => JSON.stringify(drafts[farmId]) !== pristine[farmId];

  const setCell = (farmId: string, key: FeedPlanningKey, raw: string) =>
    setDrafts((cur) => ({ ...cur, [farmId]: { ...cur[farmId], [key]: raw } }));

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

  const save = useCallback(async (farm: FeedPlanningFarm) => {
    setSaving(farm.farmId);
    setRowError(null);
    setSaved(null);
    try {
      const settings = payloadOf(drafts[farm.farmId]);
      await api.put(`/feed-forecast/farm-settings/${farm.farmId}`, settings);
      setFarms((cur) => cur.map((f) => (f.farmId === farm.farmId ? { ...f, settings } : f)));
      setSaved(farm.farmId);
    } catch (err: any) {
      setRowError({ farmId: farm.farmId, message: err?.message || t("fpSaveFailed") });
    } finally {
      setSaving(null);
    }
  }, [drafts, t]);

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
      <p className="text-xs text-[var(--text-secondary)]">{t("fpIntro", { day: t(WEEKDAY_KEYS[FEED_PLANNING_DEFAULTS.feed_production_weekday]) })}</p>
      {rowError && <InlineAlert>{rowError.message}</InlineAlert>}
      {farms.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">{t("fpNoFarms")}</p>
      ) : (
        <ScrollTable label={t("fpTableLabel")}>
          <thead>
            <tr>
              <th scope="col" className={TH} style={{ width: FARM_PX + CELL_PADDING_PX }}>{t("fpColFarm")}</th>
              {NUMBER_COLUMNS.map((column) => (
                <th key={column.key} scope="col" className={`${TH} text-right`} style={{ width: column.widthPx + CELL_PADDING_PX }}>
                  {t(`${column.labelKey}Col` as any)}
                  <span className="block font-normal normal-case tracking-normal">{t(column.unitKey as any)}</span>
                </th>
              ))}
              <th scope="col" className={TH} style={{ width: SELECT_PX + CELL_PADDING_PX }}>{t("fpProductionDayCol")}</th>
              <th scope="col" className={TH} style={{ width: SAVE_PX + CELL_PADDING_PX }} />
            </tr>
          </thead>
          <tbody>
            {farms.map((farm) => {
              const draft = drafts[farm.farmId] ?? draftOf(farm);
              return (
                <tr key={farm.farmId}>
                  <td className={TD} style={{ width: FARM_PX + CELL_PADDING_PX }}>
                    <span className="font-medium">{farm.code} — {farm.name}</span>
                  </td>
                  {NUMBER_COLUMNS.map((column) => (
                    <td key={column.key} className={`${TD} text-right`}>
                      <input
                        type="number"
                        aria-label={t(column.labelKey as any, { farm: farm.code })}
                        className="nf-input-sm text-right tabular-nums"
                        style={{ ...inputStyle, width: column.widthPx }}
                        min={column.min}
                        max={column.max}
                        step="1"
                        placeholder={String(FEED_PLANNING_DEFAULTS[column.key])}
                        value={draft[column.key]}
                        onChange={(e) => setCell(farm.farmId, column.key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className={TD}>
                    <select
                      aria-label={t("fpProductionDay", { farm: farm.code })}
                      className="nf-input-sm nf-select"
                      style={{ ...inputStyle, width: SELECT_PX }}
                      value={draft.feed_production_weekday}
                      onChange={(e) => setCell(farm.farmId, "feed_production_weekday", e.target.value)}
                    >
                      {/* The standard day is named once, in the intro — a "Sunday (standard)" option here was wider than the whole column. */}
                      <option value="">—</option>
                      {WEEKDAY_KEYS.map((dayKey, index) => (
                        <option key={dayKey} value={String(index)}>{t(dayKey)}</option>
                      ))}
                    </select>
                  </td>
                  <td className={TD} style={{ width: SAVE_PX + CELL_PADDING_PX }}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-0"
                      style={{ width: SAVE_PX }}
                      aria-label={t("fpSave", { farm: farm.code })}
                      title={saved === farm.farmId && !changed(farm.farmId) ? t("fpSaved") : t("fpSaveAction")}
                      disabled={!changed(farm.farmId) || saving === farm.farmId}
                      onClick={() => save(farm)}
                    >
                      {saved === farm.farmId && !changed(farm.farmId) ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ScrollTable>
      )}

      {/* D41: each farm's silos, beneath the delivery settings above. The feed
          held is read-only; the levels and the reorder days save per silo, with
          the silo form's own rules applied by the API. */}
      {farms.map((farm) => (
        <section key={`silos-${farm.farmId}`} aria-label={t("fpSiloSection", { farm: farm.code })} className="space-y-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {t("fpSiloHeading", { farm: `${farm.code} — ${farm.name}` })}
          </h4>
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
                  const draft = siloDrafts[silo.locationId] ?? siloDraftOf(silo);
                  return (
                    <tr key={silo.locationId}>
                      <td className={TD} style={{ width: SILO_CELL_PX + CELL_PADDING_PX }}>
                        <span className="font-medium">{silo.code} — {silo.name}</span>
                      </td>
                      <td className={TD} style={{ width: HELD_CELL_PX + CELL_PADDING_PX }}>
                        <span className="text-[var(--text-secondary)]">{silo.feedItemName || silo.feedItemCode || t("fpSiloEmpty")}</span>
                      </td>
                      <td className={`${TD} text-right tabular-nums`} style={{ width: CAPACITY_PX + CELL_PADDING_PX }}>
                        {silo.capacityKg == null ? "—" : silo.capacityKg.toLocaleString("en-US")}
                      </td>
                      {SILO_COLUMNS.map((column) => (
                        <td key={column.key} className={`${TD} text-right`}>
                          <input
                            type="number"
                            aria-label={t(column.labelKey as any, { silo: silo.code })}
                            className="nf-input-sm text-right tabular-nums"
                            style={{ ...inputStyle, width: column.widthPx }}
                            min={0}
                            step="1"
                            value={draft[column.key]}
                            onChange={(e) => setSiloCell(silo.locationId, column.key, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className={TD} style={{ width: SAVE_PX + CELL_PADDING_PX }}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-0"
                          style={{ width: SAVE_PX }}
                          aria-label={t("fpSiloSave", { silo: silo.code })}
                          title={siloSaved === silo.locationId && !siloChanged(silo.locationId) ? t("fpSaved") : t("fpSaveAction")}
                          disabled={!siloChanged(silo.locationId) || siloSaving === silo.locationId}
                          onClick={() => saveSilo(farm, silo)}
                        >
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
      ))}
    </div>
  );
}

export default FeedPlanningPanel;
