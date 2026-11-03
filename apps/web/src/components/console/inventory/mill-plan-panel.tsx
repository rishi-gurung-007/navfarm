"use client";

/**
 * Mill Planning (spec 2026-11-03) — replaces Feed Plan. The mill manager picks
 * the week, farms, feed types and mill, clicks Generate, and sees one week of
 * every selected farm's forecast added up for the mill: capacity used per day,
 * what to make per feed type and day (approved requisitions not yet produced +
 * the forecast's net need), the diet changes, and the farm × shed × day grid
 * with each farm's silos. The API does the arithmetic (mill-plan.rules.ts);
 * nothing is fetched until Generate, and changing a filter does not refetch.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatCard, StatRow } from "@/components/ui/stat-row";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort } from "@/utils/date-short";
import { todayIso, unwrap } from "./feed-format";
import { useFeedForecastContext } from "./feed-forecast-context";
import { loadFeedFarms, type FeedFarm } from "./use-feed-farm";
import { millCapacityText, type MillCapacityState, type MillCapacityStatus } from "./mill-capacity-view";
import { MultiPick } from "./multi-pick";

type DayStatus = "OK" | "WARN" | "OVER" | "NO_CAPACITY";

interface DietCapacity {
  state: MillCapacityState;
  status: MillCapacityStatus | null;
  availableKg: number | null;
}

interface MillPlan {
  dates: string[];
  mill: { millId: string; millCode: string; millName: string; dailyKg: number | null } | null;
  mills: Array<{ millId: string; millCode: string; millName: string; companyId: string }>;
  capacity: Array<{ date: string; productionKg: number; capacityKg: number | null; usedPct: number | null; status: DayStatus }>;
  cards: { totalKg: number; farms: number; sheds: number; silos: number; feedTypes: number; dietChanges: number; daysNearOrOver: number; silosRunningOut: number };
  production: Array<{
    itemId: string; itemCode: string; itemName: string; feedForm: "BULK" | "BAGGED" | null;
    days: Array<{ date: string; approvedKg: number; forecastKg: number; totalKg: number; capacity: DietCapacity | null }>;
    totalKg: number;
  }>;
  dietChanges: Array<{ farmId: string; farmName: string; shedCode: string; batchNo: string; changeDate: string; fromItemName: string; toItemName: string; heads: number }>;
  farms: Array<{
    farmId: string; code: string; name: string; totals: number[];
    sheds: Array<{ key: string; shedCode: string; batchNo: string; heads: number; items: Array<{ itemId: string; itemName: string }>; changeDate: string | null; kg: number[] }>;
    silos: Array<{ sourceCode: string; sourceName: string | null; sourceType: "SILO" | "STORE"; itemName: string; openingKg: number; closingKg: Array<number | null>; runOutDate: string | null }>;
  }>;
  failedFarms: Array<{ farmId: string; code: string; name: string; error: string }>;
}

const tonnes = (kg: number | null | undefined) => (kg === null || kg === undefined ? "—" : (kg / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const STATUS_TONE: Record<DayStatus, string> = {
  OK: "border-(--success) text-(--success)",
  WARN: "border-(--warning) text-(--warning)",
  OVER: "border-(--danger) text-(--danger)",
  NO_CAPACITY: "border-(--border) text-(--text-secondary)",
};
const CARD_TONE: Record<DayStatus, "success" | "warning" | "danger" | "default"> = { OK: "success", WARN: "warning", OVER: "danger", NO_CAPACITY: "default" };
const DOT: Record<MillCapacityStatus, string> = { GREEN: "bg-(--success)", AMBER: "bg-(--warning)", RED: "bg-(--danger)" };

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-1.5 align-top text-xs";
const NUM = "whitespace-nowrap text-right tabular-nums";
const HIGHLIGHT = "bg-[color-mix(in_srgb,var(--warning)_18%,transparent)]";
const RUN_OUT = "bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]";

export default function MillPlanPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const { planningDate } = useFeedForecastContext();
  // The forecast's planning date once it has one; until then the browser's today.
  const [weekOf, setWeekOf] = useState(planningDate || todayIso());
  const [farms, setFarms] = useState<FeedFarm[]>([]);
  const [farmIds, setFarmIds] = useState<string[] | null>(null);
  const [items, setItems] = useState<Array<{ id: string; label: string }>>([]);
  const [itemIds, setItemIds] = useState<string[] | null>(null);
  const [millId, setMillId] = useState("");
  const [plan, setPlan] = useState<MillPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // The filter lists only — the plan itself waits for Generate.
  useEffect(() => {
    let alive = true;
    loadFeedFarms(getStoredUser())
      .then(async (list) => {
        if (!alive) return;
        setFarms(list);
        if (!list[0]) return;
        const options = unwrap<{ items?: Array<{ item_id: string; item_code: string; item_name: string }> }>(
          await api.get(`/feed-requisition/options?${new URLSearchParams({ farmId: list[0].farmId }).toString()}`),
        );
        if (alive) setItems((options?.items ?? []).map((item) => ({ id: item.item_id, label: `${item.item_code} — ${item.item_name}` })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function generate() {
    if (!weekOf) return;
    const params = new URLSearchParams({ weekOf });
    if (farmIds) params.set("farmIds", farmIds.join(","));
    if (itemIds) params.set("itemIds", itemIds.join(","));
    if (millId) params.set("millId", millId);
    setLoading(true);
    try {
      const data = unwrap<MillPlan>(await api.get(`/feed-forecast/mill-plan?${params.toString()}`));
      setPlan(data);
      if (!millId && data?.mill) setMillId(data.mill.millId);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("mplLoadFailed"));
    } finally {
      setLoading(false);
    }
  }

  // A mill belongs to a company, and so do its farms: once a mill is known, only its company's farms are offered.
  const millCompany = plan?.mills.find((mill) => mill.millId === millId)?.companyId ?? null;
  const farmOptions = millCompany ? farms.filter((farm) => farm.companyId === millCompany) : farms;
  function chooseMill(id: string) {
    setMillId(id);
    const company = plan?.mills.find((mill) => mill.millId === id)?.companyId;
    setFarmIds((ids) => (ids && company ? ids.filter((farmId) => farms.find((farm) => farm.farmId === farmId)?.companyId === company) : ids));
  }

  const emptyPick = (farmIds !== null && farmIds.length === 0) || (itemIds !== null && itemIds.length === 0);
  const toggleFarm = (id: string) => setCollapsed((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <div data-fill-body className="min-h-0 overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-end gap-3 [&_.nf-input-sm]:h-11 [&>button]:h-11">
        <Field label={t("mplWeekOf")} htmlFor="mill-plan-week">
          <input id="mill-plan-week" type="date" className="nf-input-sm" value={weekOf} onChange={(event) => setWeekOf(event.target.value)} />
        </Field>
        <Field label={t("mplFarms")}>
          <MultiPick label={t("mplFarms")} options={farmOptions.map((farm) => ({ id: farm.farmId, label: `${farm.code} — ${farm.name}` }))} selected={farmIds} onChange={setFarmIds} />
        </Field>
        <Field label={t("mplFeedTypes")}>
          <MultiPick label={t("mplFeedTypes")} options={items} selected={itemIds} onChange={setItemIds} />
        </Field>
        {(plan?.mills.length ?? 0) > 1 && (
          <Field label={t("mplMill")} htmlFor="mill-plan-mill">
            <SearchableSelect
              id="mill-plan-mill"
              ariaLabel={t("mplMill")}
              value={millId}
              onChange={chooseMill}
              options={plan!.mills.map((mill) => ({ value: mill.millId, code: mill.millCode, name: mill.millName, label: `${mill.millCode} — ${mill.millName}` }))}
              columnHeaders={["Code", "Mill Name"]}
              columns={[{ key: "code", label: "Code" }, { key: "name", label: "Mill Name" }]}
              placeholder="Select mill…"
              searchPlaceholder="Search mill…"
              triggerClassName="nf-input-sm min-w-[12rem] h-11"
            />
          </Field>
        )}
        <Button onClick={generate} disabled={!weekOf || loading || emptyPick}>{t("mplGenerate")}</Button>
        {plan && (
          <>
            <Button variant="outline" onClick={() => setCollapsed(plan.farms.map((farm) => farm.farmId))}>{t("mplCollapseAll")}</Button>
            <Button variant="outline" onClick={() => setCollapsed([])}>{t("mplExpandAll")}</Button>
          </>
        )}
      </div>

      {loading && <LoadingState />}
      {!loading && !plan && <div className="mt-6"><EmptyState title={t("mplBeforeGenerate")} /></div>}

      {!loading && plan && (
        <div className="mt-4 space-y-5">
          <section aria-label={t("mplCapacity")} className="rounded-lg border border-(--border) bg-(--surface-raised) p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-(--text-secondary)">
              <span className="font-semibold uppercase tracking-wider">{t("mplCapacity")}</span>
              <span>{plan.mill ? `${plan.mill.millCode} · ${plan.mill.dailyKg ? t("mplCapacityPerDay", { tonnes: tonnes(plan.mill.dailyKg) }) : t("mplCapacityNotSet")}` : t("mplNoMill")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {plan.capacity.map((day) => (
                <div key={day.date} data-capacity-day={day.date} data-status={day.status} className={`rounded-md border-l-4 bg-(--surface) px-2.5 py-1.5 ${STATUS_TONE[day.status]}`}>
                  <div className="text-[11px] font-semibold">{weekday(day.date)} {formatDateShort(day.date)}</div>
                  <div className="text-xs tabular-nums text-(--text-primary)">{tonnes(day.productionKg)} t</div>
                  <div className="text-[11px]">{day.status === "NO_CAPACITY" ? t("mplCapacityNotSet") : `${day.usedPct}%`}</div>
                </div>
              ))}
            </div>
          </section>

          <StatRow columns={6}>
            <StatCard label={t("mplCardTotal")} value={tonnes(plan.cards.totalKg)} unit="t" />
            <StatCard label={t("mplCardFarms")} value={plan.cards.farms} sub={t("mplCardFarmsSub", { sheds: plan.cards.sheds, silos: plan.cards.silos })} />
            <StatCard label={t("mplCardFeedTypes")} value={plan.cards.feedTypes} />
            <StatCard label={t("mplCardDietChanges")} value={plan.cards.dietChanges} tone={plan.cards.dietChanges ? "warning" : "default"} />
            <StatCard label={t("mplCardDaysNear")} value={plan.cards.daysNearOrOver} tone={plan.capacity.some((d) => d.status === "OVER") ? CARD_TONE.OVER : plan.cards.daysNearOrOver ? CARD_TONE.WARN : "default"} />
            <StatCard label={t("mplCardSilosOut")} value={plan.cards.silosRunningOut} tone={plan.cards.silosRunningOut ? "danger" : "default"} />
          </StatRow>

          {plan.failedFarms.length > 0 && (
            <div role="alert" className="rounded-md border border-(--danger) px-3 py-2 text-xs text-(--danger)">
              {plan.failedFarms.map((farm) => (
                <div key={farm.farmId}>{t("mplFarmFailed", { farm: `${farm.code} — ${farm.name}`, error: farm.error })}</div>
              ))}
            </div>
          )}

          <section aria-label={t("mplProduction")}>
            <h2 className="mb-2 text-sm font-semibold text-(--text-primary)">{t("mplProduction")}</h2>
            {plan.production.length === 0 ? (
              <p className="text-xs text-(--text-secondary)">{t("mplNoProduction")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-(--border)">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={`${TH} min-w-[11rem] text-left`}>{t("mplFeed")}</th>
                      {plan.dates.map((date) => <th key={date} className={`${TH} ${NUM}`}>{weekday(date)} {formatDateShort(date)}</th>)}
                      <th className={`${TH} ${NUM}`}>{t("mplTotal")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.production.map((row) => (
                      <tr key={row.itemId}>
                        <td className={TD}>
                          <div className="font-medium text-(--text-primary)">{row.itemName}</div>
                          <div className="text-[11px] text-(--text-secondary)">{row.itemCode}{row.feedForm ? ` · ${row.feedForm}` : ""}</div>
                        </td>
                        {row.days.map((day) => (
                          <td key={day.date} className={`${TD} ${NUM}`} title={t("mplProductionSplit", { approved: tonnes(day.approvedKg), forecast: tonnes(day.forecastKg) })}>
                            {day.totalKg > 0 ? tonnes(day.totalKg) : "—"}
                            {day.totalKg > 0 && day.capacity && (
                              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-(--text-secondary)">
                                {day.capacity.status && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[day.capacity.status]}`} />}
                                {millCapacityText(day.capacity.state, day.capacity.availableKg, t)}
                              </div>
                            )}
                          </td>
                        ))}
                        <td className={`${TD} ${NUM} font-semibold`}>{tonnes(row.totalKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label={t("mplDietChanges")}>
            <h2 className="mb-2 text-sm font-semibold text-(--text-primary)">{t("mplDietChanges")}</h2>
            {plan.dietChanges.length === 0 ? (
              <p className="text-xs text-(--text-secondary)">{t("mplNoDietChanges")}</p>
            ) : (
              <ul className="space-y-1">
                {plan.dietChanges.map((change) => (
                  <li key={`${change.farmId}|${change.shedCode}|${change.batchNo}|${change.changeDate}`} className={`rounded-md border-l-4 border-(--warning) px-3 py-1.5 text-xs text-(--text-primary) ${HIGHLIGHT}`}>
                    <span className="font-semibold">{change.farmName} / {change.shedCode}</span>
                    {" — "}
                    {t("mplDietChangeLine", { batch: change.batchNo, date: `${weekday(change.changeDate)} ${formatDateShort(change.changeDate)}`, from: change.fromItemName, to: change.toItemName, heads: change.heads })}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label={t("mplGrid")}>
            <h2 className="mb-2 text-sm font-semibold text-(--text-primary)">{t("mplGrid")}</h2>
            <div className="overflow-x-auto rounded-lg border border-(--border)">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${TH} min-w-[14rem] text-left`}>{t("mplFarmShed")}</th>
                    {plan.dates.map((date) => <th key={date} className={`${TH} ${NUM}`}>{weekday(date)} {formatDateShort(date)}</th>)}
                  </tr>
                  <tr>
                    <th className={`${TD} text-left font-semibold text-(--text-secondary)`}>{t("mplMillTotal")}</th>
                    {plan.dates.map((date, i) => (
                      <th key={date} className={`${TD} ${NUM} font-semibold`}>{tonnes(plan.farms.reduce((sum, farm) => sum + farm.totals[i], 0))}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.farms.map((farm) => {
                    const open = !collapsed.includes(farm.farmId);
                    return (
                      <Fragment key={farm.farmId}>
                        <tr className="bg-(--surface-raised)">
                          <td className={TD}>
                            <button type="button" className="flex items-center gap-1.5 text-left font-semibold text-(--text-primary)" aria-expanded={open} onClick={() => toggleFarm(farm.farmId)}>
                              <span aria-hidden>{open ? "▾" : "▸"}</span>
                              {farm.code} — {farm.name}
                            </button>
                            <div className="pl-4 text-[11px] text-(--text-secondary)">{t("mplFarmSub", { sheds: farm.sheds.length, silos: farm.silos.length })}</div>
                          </td>
                          {farm.totals.map((kg, i) => <td key={plan.dates[i]} className={`${TD} ${NUM} font-semibold`}>{tonnes(kg)}</td>)}
                        </tr>
                        {open && farm.sheds.map((shed) => (
                          <tr key={shed.key}>
                            <td className={`${TD} pl-7`}>
                              <div className="text-(--text-primary)">{shed.shedCode} <span className="text-(--text-secondary)">· {shed.batchNo}</span></div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                {shed.items.map((item, i) => (
                                  <Fragment key={item.itemId}>
                                    {i > 0 && <span aria-hidden className="text-[10px] text-(--text-secondary)">→</span>}
                                    <span className="rounded bg-(--surface-raised) px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--text-secondary)">{item.itemName}</span>
                                  </Fragment>
                                ))}
                                {shed.changeDate && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--warning)">{t("mplTypeChange")}</span>}
                              </div>
                              <div className="text-[11px] text-(--text-secondary)">{t("mplHeads", { heads: shed.heads })}</div>
                            </td>
                            {shed.kg.map((kg, i) => {
                              const date = plan.dates[i];
                              const change = shed.changeDate === date;
                              return (
                                <td key={date} className={`${TD} ${NUM} ${change ? HIGHLIGHT : ""}`} {...(change ? { "data-diet-change": "", "data-date": date } : {})}>
                                  {tonnes(kg)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {open && farm.silos.map((silo) => (
                          <tr key={`${farm.farmId}|${silo.sourceCode}`}>
                            <td className={`${TD} pl-7`}>
                              <div className="text-(--text-primary)">{silo.sourceType === "SILO" ? t("mplSilo") : t("mplStore")} {silo.sourceCode}{silo.sourceName ? ` · ${silo.sourceName}` : ""}</div>
                              <div className="text-[11px] text-(--text-secondary)">{silo.itemName} · {t("mplOpening", { tonnes: tonnes(silo.openingKg) })}</div>
                            </td>
                            {silo.closingKg.map((kg, i) => {
                              const date = plan.dates[i];
                              const out = silo.runOutDate === date;
                              return (
                                <td key={date} className={`${TD} ${NUM} text-(--text-secondary) ${out ? RUN_OUT : ""}`} {...(out ? { "data-run-out": "", "data-date": date } : {})}>
                                  {tonnes(kg)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-(--text-secondary)">{t("mplGridNote")}</p>
          </section>
        </div>
      )}
    </div>
  );
}
