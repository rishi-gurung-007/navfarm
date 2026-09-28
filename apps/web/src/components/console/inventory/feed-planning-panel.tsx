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
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";

/** What the client's workbook says a farm gets when it sets nothing (D3, D19, Requisition §1 rows 27-28, checkpoint 27). */
export const FEED_PLANNING_DEFAULTS = {
  feed_refill_buffer_days: 2,
  feed_lead_time_days: 2,
  feed_bulk_multiple_kg: 3000,
  feed_bag_size_kg: 50,
  feed_truck_target_kg: 30000,
  feed_production_weekday: 0,
} as const;

export type FeedPlanningKey = keyof typeof FEED_PLANNING_DEFAULTS;

export interface FeedPlanningFarm {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string | null;
  settings: Record<FeedPlanningKey, number | null>;
}

const NUMBER_COLUMNS: { key: Exclude<FeedPlanningKey, "feed_production_weekday">; labelKey: string; min: number; max?: number }[] = [
  { key: "feed_refill_buffer_days", labelKey: "fpBuffer", min: 0, max: 30 },
  { key: "feed_lead_time_days", labelKey: "fpLeadTime", min: 0, max: 30 },
  { key: "feed_bulk_multiple_kg", labelKey: "fpBulkMultiple", min: 1 },
  { key: "feed_bag_size_kg", labelKey: "fpBagSize", min: 1 },
  { key: "feed_truck_target_kg", labelKey: "fpTruckTarget", min: 1 },
];

const WEEKDAY_KEYS = ["fpDaySun", "fpDayMon", "fpDayTue", "fpDayWed", "fpDayThu", "fpDayFri", "fpDaySat"] as const;

const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

/** The form holds strings, because an emptied cell is "" and means "clear it". */
type RowDraft = Record<FeedPlanningKey, string>;

const draftOf = (farm: FeedPlanningFarm): RowDraft => ({
  feed_refill_buffer_days: farm.settings.feed_refill_buffer_days?.toString() ?? "",
  feed_lead_time_days: farm.settings.feed_lead_time_days?.toString() ?? "",
  feed_bulk_multiple_kg: farm.settings.feed_bulk_multiple_kg?.toString() ?? "",
  feed_bag_size_kg: farm.settings.feed_bag_size_kg?.toString() ?? "",
  feed_truck_target_kg: farm.settings.feed_truck_target_kg?.toString() ?? "",
  feed_production_weekday: farm.settings.feed_production_weekday?.toString() ?? "",
});

const payloadOf = (draft: RowDraft): Record<FeedPlanningKey, number | null> => {
  const value = (raw: string) => (raw.trim() === "" ? null : Number(raw));
  return {
    feed_refill_buffer_days: value(draft.feed_refill_buffer_days),
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
      <p className="text-xs text-[var(--text-secondary)]">{t("fpIntro")}</p>
      {rowError && <InlineAlert>{rowError.message}</InlineAlert>}
      {farms.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">{t("fpNoFarms")}</p>
      ) : (
        <ScrollTable label={t("fpTableLabel")}>
          <thead>
            <tr>
              <th scope="col" className={TH}>{t("fpColFarm")}</th>
              {NUMBER_COLUMNS.map((column) => (
                <th key={column.key} scope="col" className={`${TH} text-right`}>{t(`${column.labelKey}Col` as any)}</th>
              ))}
              <th scope="col" className={TH}>{t("fpProductionDayCol")}</th>
              <th scope="col" className={TH} />
            </tr>
          </thead>
          <tbody>
            {farms.map((farm) => {
              const draft = drafts[farm.farmId] ?? draftOf(farm);
              return (
                <tr key={farm.farmId}>
                  <td className={TD}>{farm.code} — {farm.name}</td>
                  {NUMBER_COLUMNS.map((column) => (
                    <td key={column.key} className={`${TD} text-right`}>
                      <input
                        type="number"
                        aria-label={t(column.labelKey as any, { farm: farm.code })}
                        className="nf-input-sm w-24 text-right tabular-nums"
                        style={inputStyle}
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
                      className="nf-input-sm nf-select w-32"
                      style={inputStyle}
                      value={draft.feed_production_weekday}
                      onChange={(e) => setCell(farm.farmId, "feed_production_weekday", e.target.value)}
                    >
                      <option value="">{t("fpDayDefault", { day: t(WEEKDAY_KEYS[FEED_PLANNING_DEFAULTS.feed_production_weekday]) })}</option>
                      {WEEKDAY_KEYS.map((dayKey, index) => (
                        <option key={dayKey} value={String(index)}>{t(dayKey)}</option>
                      ))}
                    </select>
                  </td>
                  <td className={TD}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-[11px]"
                      aria-label={t("fpSave", { farm: farm.code })}
                      disabled={!changed(farm.farmId) || saving === farm.farmId}
                      onClick={() => save(farm)}
                    >
                      <Save className="h-3 w-3" /> {saved === farm.farmId && !changed(farm.farmId) ? t("fpSaved") : t("fpSaveAction")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ScrollTable>
      )}
    </div>
  );
}

export default FeedPlanningPanel;
