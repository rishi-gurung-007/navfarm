"use client";

/**
 * Inventory -> Feed Forecast, Physical Count tab (Task 7).
 *
 * Three things, all for the farm the page has selected:
 *  - the farm's counts with their status, so a submitted one can be followed
 *    and an approved one posted;
 *  - one count's lines, with the system quantity the server derived from the
 *    ledger beside the counted quantity and the resulting variance;
 *  - count entry, built from GET /feed-stock-count/evidence — the same
 *    evidence `create` derives server-side, so the screen can never offer a
 *    silo/item pair the transaction then rejects, and never invents a system
 *    quantity of its own.
 *
 * The counted-at field is the operator's own wall clock and is sent with an
 * explicit offset, because the API refuses an instant whose offset it cannot
 * read — a bare local string would be stored as a different moment.
 *
 * Approval itself stays in the Approvals inbox (D25); this screen only
 * submits, links to the request, and posts once the decision is in.
 */
import { useCallback, useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, ReadField } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ReasonSelect } from "@/components/ui/reason-select";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { unwrap } from "./feed-format";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { labelOf, REQ_STATUS_LABEL, variantOf } from "./requisition-labels";
import { useFeedFarm } from "./use-feed-farm";
import { RecordLink, itemHref, locationHref } from "./feed-requisition-header";

interface CountRow {
  count_id: string;
  count_no: string;
  counted_at: string;
  schedule_source: string;
  status: string;
  approval_request_id: string | null;
  stock_adjustment_id: string | null;
  count_type?: string;
  stock_take_type?: string | null;
  period_code?: string | null;
  reporting_period_id?: string | null;
  farm_id?: string | null;
}

/** W2D A7 (Engine §1 rows 9–17): what the API adds beside a silo's count line; absent on older responses. */
interface SiloPlanning {
  siloName?: string | null;
  capacityKg?: number | null;
  houses?: Array<{ id: string; code: string; name: string }>;
  projectedShortfallKg?: number | null;
  nextDietItemId?: string | null;
  nextDietItemCode?: string | null;
  nextDietItemName?: string | null;
  nextDietDate?: string | null;
  nextDietInDays?: number | null;
}

/** Engine §1 row 16: a diet change this close is warned. */
const NEXT_DIET_WARN_DAYS = 7;

interface CountLine extends SiloPlanning {
  count_line_id: string;
  silo_id: string;
  item_id: string;
  system_qty_kg: string;
  counted_qty_kg: string;
  variance_qty_kg: string;
  variance_pct_absolute: string;
  reason_id: string | null;
  silo_code: string;
  silo_name?: string | null;
  item_code: string;
  item_name: string;
  reason_name: string | null;
}

interface CountView extends CountRow {
  lines: CountLine[];
  /** Monthly Stock Take reconciliation evidence (workbook r35, r47-r49). */
  stock_take_date?: string | null;
  period_status_after?: string | null;
  production_start_date_next?: string | null;
  gl_entry_refs?: string[] | null;
  farm_code?: string | null;
  cost_center_code?: string | null;
  cost_center_name?: string | null;
}

interface EvidencePair extends SiloPlanning {
  siloId: string;
  siloCode: string | null;
  itemId: string;
  itemCode: string;
  itemName?: string | null;
  uom: string;
  systemQtyKg: number;
  costAvailable: boolean;
}

interface EvidenceResponse {
  countedAt: string;
  /** Null when the forecast could not run: the planning columns then say so. */
  planningDate?: string | null;
  pairs: EvidencePair[];
}

const STATUS_FILTER = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "REJECTED"];
const LIST_COLUMNS = ["fscColCountNo", "fscColCountType", "fscColPeriod", "fscColCountedAt", "fscColSource", "fscColStatus"] as const;
// Engine §1 rows 8–17; checkpoint 37: the system quantity is always "System Balance KG".
const SILO_COLUMNS = ["fscColSilo", "fscColSiloName", "fscColHouse", "fscColItem", "fscColDiet", "fscColCapacity"] as const;
// Code and name are two columns (Rishi, 14 Oct).
const PLANNING_COLUMNS = ["fscColShortfall", "fscColNextDietIn", "fscColNextItem", "fscColNextItemName"] as const;
const LINE_COLUMNS = [...SILO_COLUMNS, "fscColSystemBalance", "fscColCounted", "fscColVariance", "fscColVariancePct", ...PLANNING_COLUMNS, "fscColReason"] as const;
const ENTRY_COLUMNS = [...SILO_COLUMNS, "fscColSystemBalance", ...PLANNING_COLUMNS, "fscColCounted", "fscColReason"] as const;
const RIGHT = new Set<string>(["fscColCapacity", "fscColSystemBalance", "fscColCounted", "fscColVariance", "fscColVariancePct", "fscColShortfall", "fscColNextDietIn"]);

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "whitespace-nowrap border-b border-(--border) px-3 py-2 align-top text-sm text-(--text-primary)";
const NUM = "text-right tabular-nums";
const BOX = "mt-4 max-h-[60vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)";
const TABLE = "w-max min-w-full border-separate border-spacing-0 text-left";

const DOT: Record<string, string> = { success: "bg-(--success)", warning: "bg-(--warning)", danger: "bg-(--danger)", info: "bg-(--accent)", accent: "bg-(--accent)", neutral: "bg-(--text-muted)" };
/** A small colour dot plus plain text instead of a badge. */
function StatusDot({ variant, children }: { variant?: string | null; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)">
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[variant ?? "neutral"] ?? DOT.neutral}`} />
      {children}
    </span>
  );
}
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

const kg = (value: string | number | null | undefined, unavailable: string): string => {
  if (value === null || value === undefined || value === "") return unavailable;
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : unavailable;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The operator's wall clock as `datetime-local` wants it. */
function localNowInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` in the browser's zone -> an instant with an explicit offset. */
function inputToInstant(local: string): string {
  const parsed = new Date(local);
  if (Number.isNaN(parsed.getTime())) return `${local}:00Z`;
  const offset = -parsed.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${local}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** MySQL holds UTC; read the stored string as UTC and show it locally. */
function shortTimestamp(value: string | null | undefined, unavailable: string): string {
  if (!value) return unavailable;
  const parsed = new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return formatDateShort(value);
  return `${formatDateShort(parsed.toISOString().slice(0, 10))} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

const countTypeLabel = (row: { count_type?: string; stock_take_type?: string | null }, t: (key: any) => string): string =>
  row.count_type === "MONTHLY"
    ? `${t("fscCountTypeMonthly")}${row.stock_take_type === "FEED_MILL" ? ` (${t("fscCountAtMill")})` : ""}`
    : t("fscCountTypeWeekly");

const sourceLabel = (source: string, t: (key: any) => string): string =>
  source === "SCHEDULED" ? t("fscSourceScheduled") : t("fscSourceOnDemand");

type T = (key: any, vars?: any) => string;

/** W5B (Silo r36): a Reporting Period opens in its master record. */
const periodHref = (id: string) => `/master-data/reporting-period?recordId=${encodeURIComponent(id)}`;
/** W5B (Silo r47): the journals the posting created are listed in the Finance journal. */
const JOURNAL_ROUTE = "/finance/journal";

/** W5B (Silo r45): Positive / Negative Adjustment, derived from the sign of each line's variance; null when nothing varies. */
function adjustmentTypeKey(lines: Array<{ variance_qty_kg: string }>): "fscAdjPositive" | "fscAdjNegative" | "fscAdjBoth" | null {
  const up = lines.some((line) => Number(line.variance_qty_kg) > 0);
  const down = lines.some((line) => Number(line.variance_qty_kg) < 0);
  return up && down ? "fscAdjBoth" : up ? "fscAdjPositive" : down ? "fscAdjNegative" : null;
}

/** Silo code, name, house(s), item and diet description, capacity — linked, never an id. */
function SiloCells({ siloId, siloCode, siloName, houses, itemId, itemCode, itemName, capacityKg, t, unavailable }: SiloPlanning & {
  siloId: string; siloCode: string | null | undefined; itemId: string; itemCode: string; itemName?: string | null; t: T; unavailable: string;
}) {
  return <>
    <td className={TD}>{siloCode ? <RecordLink code={siloCode} href={locationHref(siloId)} /> : t("fscSiloCodeMissing")}</td>
    <td className={TD}>{siloName || unavailable}</td>
    <td className={TD}>{houses && houses.length
      ? houses.map((house, index) => <span key={house.id}>{index > 0 && ", "}<RecordLink code={house.name || house.code} href={locationHref(house.id)} /></span>)
      : t("fscNoHouse")}</td>
    <td className={TD}><RecordLink code={itemCode} href={itemHref(itemId)} /></td>
    <td className={`${TD} min-w-48 whitespace-normal break-words`}>{itemName || unavailable}</td>
    <td className={cn(TD, NUM)}>{kg(capacityKg, unavailable)}</td>
  </>;
}

/** Projected shortfall, next diet in X days (warned at ≤ 7) and the next item. */
function PlanningCells({ siloId, projectedShortfallKg, nextDietInDays, nextDietItemId, nextDietItemCode, nextDietItemName, t, unavailable }: SiloPlanning & {
  siloId: string; t: T; unavailable: string;
}) {
  const warn = nextDietInDays !== null && nextDietInDays !== undefined && nextDietInDays <= NEXT_DIET_WARN_DAYS;
  return <>
    <td className={cn(TD, NUM)}>{kg(projectedShortfallKg, unavailable)}</td>
    <td className={cn(TD, NUM, warn && "font-semibold text-(--warning)")} data-testid={`next-diet-in-${siloId}`} data-warning={warn ? "true" : "false"}
      title={warn ? t("fscNextDietSoon") : undefined}>
      {nextDietInDays === null || nextDietInDays === undefined ? t("fscNoNextDiet") : `${nextDietInDays} ${t("fsdDaysUnit")}`}
    </td>
    <td className={TD}>{nextDietItemCode
      ? <RecordLink code={nextDietItemCode} href={nextDietItemId ? itemHref(nextDietItemId) : null} />
      : t("fscNoNextDiet")}</td>
    <td className={`${TD} min-w-48 whitespace-normal break-words`}>{nextDietItemCode ? nextDietItemName || unavailable : ""}</td>
  </>;
}

export default function FeedStockCountPanel() {
  const { t } = useLanguage();
  const unavailable = t("fsdNotAvailable");
  const farm = useFeedFarm();
  const farmId = farm.farmId;
  const companyId = farm.farms.find((entry) => entry.farmId === farmId)?.companyId ?? null;

  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<CountRow[]>([]);
  const [selected, setSelected] = useState<CountView | null>(null);
  const [entry, setEntry] = useState<EvidenceResponse | null>(null);
  const [entryAt, setEntryAt] = useState(localNowInput);
  const [entryScheduled, setEntryScheduled] = useState(false);
  // Monthly Stock Take (Brief C): the same count, typed MONTHLY and tied to a Reporting Period.
  const [countType, setCountType] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  // A feed mill is counted monthly only; picking one switches the whole screen to that mill's bins.
  const [millId, setMillId] = useState("");
  const [mills, setMills] = useState<Array<{ location_id: string; location_code: string; location_name?: string | null }>>([]);
  const isMill = Boolean(millId);
  const placeId = millId || farmId;
  const effCountType: "WEEKLY" | "MONTHLY" = isMill ? "MONTHLY" : countType;
  const [periodId, setPeriodId] = useState("");
  const [periods, setPeriods] = useState<Array<{ period_id: string; period_code: string; stock_take_date: string; period_status?: string }>>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reasonIds, setReasonIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    if (!placeId || !companyId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ companyId, farmId: placeId });
      if (status) params.set("status", status);
      const list = unwrap<CountRow[]>(await api.get(`/feed-stock-count?${params.toString()}`));
      setRows(Array.isArray(list) ? list : []);
    } catch (err: any) {
      showToast.error(err?.message || t("fscLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [placeId, companyId, status, t]);

  useEffect(() => {
    setSelected(null);
    setEntry(null);
    loadList();
  }, [loadList]);

  useEffect(() => {
    setMillId("");
    setMills([]);
    if (!companyId) return;
    api.get(`/location?locationType=MILL&rootOnly=true&isActive=true&companyId=${companyId}`)
      .then((res) => {
        const list = unwrap<Array<{ location_id: string; location_code: string; location_name?: string | null }>>(res);
        setMills(Array.isArray(list) ? list : []);
      })
      .catch(() => setMills([]));
  }, [companyId]);

  useEffect(() => {
    if (effCountType !== "MONTHLY" || periods.length) return;
    api.get("/reporting-period")
      .then((res) => {
        const list = unwrap<Array<{ period_id: string; period_code: string; stock_take_date: string; period_status?: string; status?: string }>>(res);
        setPeriods((Array.isArray(list) ? list : []).filter((p) => p.status === "ACTIVE" && p.period_status !== "CLOSED"));
      })
      .catch((err: any) => showToast.error(err?.message || t("fscLoadFailed")));
  }, [effCountType, periods.length, t]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err: any) {
      showToast.error(err?.message || t("fscActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const openCount = (id: string) =>
    run(async () => {
      setSelected(unwrap<CountView>(await api.get(`/feed-stock-count/${id}`)));
    });

  const loadEvidence = () =>
    run(async () => {
      if (!placeId || !companyId) return;
      const params = new URLSearchParams({ companyId, farmId: placeId, countedAt: inputToInstant(entryAt) });
      if (isMill) params.set("stockTakeType", "FEED_MILL");
      setEntry(unwrap<EvidenceResponse>(await api.get(`/feed-stock-count/evidence?${params.toString()}`)));
      setCounted({});
      setReasonIds({});
    });

  const createCount = () =>
    run(async () => {
      if (!entry || !placeId || !companyId) return;
      const lines = entry.pairs.map((pair) => {
        const value = counted[`${pair.siloId}:${pair.itemId}`];
        if (value === undefined || value === "") throw new Error(t("fscCountedMissing"));
        return {
          siloId: pair.siloId,
          itemId: pair.itemId,
          countedQtyKg: Number(value),
          reasonId: reasonIds[`${pair.siloId}:${pair.itemId}`] || undefined,
        };
      });
      const created = unwrap<{ count_id: string; count_no: string }>(
        await api.post("/feed-stock-count", {
          companyId,
          farmId: placeId,
          countedAt: inputToInstant(entryAt),
          scheduleSource: effCountType === "MONTHLY" ? "ON_DEMAND" : entryScheduled ? "SCHEDULED" : "ON_DEMAND",
          ...(effCountType === "MONTHLY" ? { countType: effCountType, reportingPeriodId: periodId || undefined } : {}),
          ...(isMill ? { stockTakeType: "FEED_MILL" } : {}),
          lines,
        }),
      );
      showToast.success(t("fscCreated", { no: created.count_no }));
      setEntry(null);
      await loadList();
      setSelected(unwrap<CountView>(await api.get(`/feed-stock-count/${created.count_id}`)));
    });

  const reloadCount = async (id: string) => {
    setSelected(unwrap<CountView>(await api.get(`/feed-stock-count/${id}`)));
    await loadList();
  };

  const submit = (id: string) =>
    run(async () => {
      await api.post(`/feed-stock-count/${id}/submit`, {});
      showToast.success(t("fscSubmitted"));
      await reloadCount(id);
    });

  const post = (id: string) =>
    run(async () => {
      await api.post(`/feed-stock-count/${id}/post`, {});
      showToast.success(t("fscPosted"));
      await reloadCount(id);
    });

  const approvalHref = (row: { approval_request_id: string | null; status: string }): string | null => {
    if (!row.approval_request_id) return null;
    const tab = row.status === "APPROVED" ? "approved" : row.status === "REJECTED" ? "rejected" : "pending";
    return `/approvals/${tab}?request=${row.approval_request_id}`;
  };

  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : null
    : undefined;
  const noFarms = !farm.isFixed && farm.loaded && farm.farms.length === 0;
  const lines = Array.isArray(selected?.lines) ? selected!.lines : [];
  const canSubmit = selected?.status === "DRAFT" || selected?.status === "REJECTED";
  const canPost = selected?.status === "APPROVED";
  const href = selected ? approvalHref(selected) : null;
  const dialogOpen = Boolean(selected || entry);
  const selectedFarm = farm.farms.find((candidate) => candidate.farmId === farmId);
  const dialogFarmLabel = fixedLabel ?? (selectedFarm ? feedFarmLabel({ code: selectedFarm.code, name: selectedFarm.name }) : "");

  const closeDialog = () => {
    setEntry(null);
    setSelected(null);
  };

  const farmPicker = (
    <FeedFarmSelect
      id="sc-farm"
      label={t("ffFarm")}
      farms={farm.farms}
      farmId={farmId}
      fixedLabel={fixedLabel}
      onChange={(id) => {
        farm.setFarmId(id);
        setSelected(null);
        setEntry(null);
      }}
    />
  );

  return (
    <div data-fill-body className="min-h-0 overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 [&_.nf-input-sm]:h-9 [&>div>button]:h-9">
        <div className="flex flex-wrap items-end gap-3">
          {farmPicker}
          {mills.length > 0 && (
            <Field label={t("fscCountAt")} htmlFor="sc-place">
              <div className="relative min-w-[12rem]">
                <SearchableSelect
                  value={millId}
                  onChange={(val) => { setMillId(val); setSelected(null); setEntry(null); }}
                  options={[
                    { value: "", label: t("fscCountAtFarm") },
                    ...mills.map((m) => ({
                      value: m.location_id,
                      code: m.location_code,
                      name: m.location_name || "",
                      label: `${m.location_code}${m.location_name ? ` — ${m.location_name}` : ""}`,
                    })),
                  ]}
                  columnHeaders={["Code", "Mill Name"]}
                  triggerClassName="nf-input-sm min-w-[12rem] h-9"
                />
                <select
                  id="sc-place"
                  value={millId}
                  onChange={(e) => { setMillId(e.target.value); setSelected(null); setEntry(null); }}
                  tabIndex={-1}
                  className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
                >
                  <option value="">{t("fscCountAtFarm")}</option>
                  {mills.map((m) => (
                    <option key={m.location_id} value={m.location_id}>{m.location_name || m.location_code}</option>
                  ))}
                </select>
              </div>
            </Field>
          )}
          <Field label={t("fscShow")} htmlFor="sc-status">
            <div className="relative min-w-[10rem]">
              <SearchableSelect
                value={status}
                onChange={setStatus}
                options={[
                  { value: "", label: t("rqShowAll") },
                  ...STATUS_FILTER.map((value) => ({
                    value,
                    label: labelOf(REQ_STATUS_LABEL, value, t),
                  })),
                ]}
                columnHeaders={false}
                triggerClassName="nf-input-sm min-w-[10rem] h-9"
              />
              <select
                id="sc-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                tabIndex={-1}
                className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
              >
                <option value="">{t("rqShowAll")}</option>
                {STATUS_FILTER.map((value) => (
                  <option key={value} value={value}>
                    {labelOf(REQ_STATUS_LABEL, value, t)}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void loadEvidence()} disabled={!placeId || busy}>
            {t("fscNew")}
          </Button>
        </div>
      </div>


      {farm.failed ? (
        <InlineAlert>
          <span className="mr-3">{t("ffFarmsLoadFailed")}</span>
          <Button size="sm" variant="outline" onClick={farm.retry}>
            {t("ffRetry")}
          </Button>
        </InlineAlert>
      ) : !farm.loaded ? (
        <LoadingState label={t("fscLoading")} />
      ) : noFarms || !placeId || !companyId ? (
        <EmptyState icon={Inbox} title={t("ffNoFarms")} />
      ) : loading ? (
        <LoadingState label={t("fscLoading")} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title={t("fscNone")} />
      ) : (
        <div className={BOX}><table aria-label={t("fscListLabel")} className={TABLE}>
          <thead>
            <tr>
              {LIST_COLUMNS.map((column) => (
                <th key={column} scope="col" className={TH}>
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.count_id} className="cursor-pointer hover:bg-(--surface-raised)" onClick={() => void openCount(row.count_id)}>
                <td className={cn(TD, "font-medium")}>{row.count_no}</td>
                <td className={TD}>{countTypeLabel(row, t)}</td>
                <td className={TD}>{row.period_code ? <RecordLink code={row.period_code} href={row.reporting_period_id ? periodHref(row.reporting_period_id) : null} /> : unavailable}</td>
                <td className={TD}>{shortTimestamp(row.counted_at, unavailable)}</td>
                <td className={TD}>{sourceLabel(row.schedule_source, t)}</td>
                <td className={TD}>
                  <StatusDot variant={variantOf(REQ_STATUS_LABEL, row.status)}>{labelOf(REQ_STATUS_LABEL, row.status, t)}</StatusDot>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={entry ? t("fscNew") : selected?.count_no ?? t("fftTabPhysicalCount")}
        presentation="compact"
        maxWidth="xl"
        className="w-[95vw] max-h-[85vh]"
        footer={entry ? (
          <>
            <Button size="sm" variant="outline" onClick={closeDialog} disabled={busy}>{t("cancel")}</Button>
            <Button size="sm" onClick={() => void createCount()} disabled={busy || entry.pairs.length === 0}>{t("fscSave")}</Button>
          </>
        ) : selected ? (
          <>
            <Button size="sm" variant="outline" onClick={closeDialog} disabled={busy}>{t("close")}</Button>
            {canSubmit && <Button size="sm" onClick={() => void submit(selected.count_id)} disabled={busy}>{t("fscSubmit")}</Button>}
            {canPost && <Button size="sm" onClick={() => void post(selected.count_id)} disabled={busy}>{t("fscPost")}</Button>}
          </>
        ) : null}
      >
        <div className="flex flex-col gap-4">
          {entry ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ReadField
                  label={isMill ? t("fscCountAtMill") : t("ffFarm")}
                  value={isMill ? mills.find((m) => m.location_id === millId)?.location_code ?? "" : dialogFarmLabel}
                  appearance="control"
                />
                <Field label={t("fscCountedAt")} htmlFor="sc-counted-at">
                  <input
                    id="sc-counted-at"
                    type="datetime-local"
                    className="nf-input-sm"
                    style={inputStyle}
                    value={entryAt}
                    onChange={(e) => setEntryAt(e.target.value || localNowInput())}
                  />
                </Field>
                <Field label={t("fscCountType")} htmlFor="sc-count-type">
                  <SearchableSelect
                    id="sc-count-type"
                    ariaLabel={t("fscCountType")}
                    value={effCountType}
                    disabled={isMill}
                    onChange={(val) => setCountType(val === "MONTHLY" ? "MONTHLY" : "WEEKLY")}
                    options={[
                      { value: "WEEKLY", label: t("fscCountTypeWeekly") },
                      { value: "MONTHLY", label: t("fscCountTypeMonthly") },
                    ]}
                    columnHeaders={false}
                    triggerClassName="nf-input-sm min-w-[9rem] h-9"
                  />
                </Field>
                {effCountType === "MONTHLY" && (
                  <Field label={t("fscReportingPeriod")} htmlFor="sc-period">
                    <SearchableSelect
                      id="sc-period"
                      ariaLabel={t("fscReportingPeriod")}
                      value={periodId}
                      onChange={setPeriodId}
                      options={periods.map((p) => ({
                        value: p.period_id,
                        label: `${p.period_code} (${String(p.stock_take_date).slice(0, 10)})`,
                      }))}
                      placeholder={t("fscReportingPeriodPick")}
                      columnHeaders={false}
                      triggerClassName="nf-input-sm min-w-[12rem] h-9"
                    />
                  </Field>
                )}
                <Field label={t("fscSource")} htmlFor="sc-source">
                  <SearchableSelect
                    id="sc-source"
                    ariaLabel={t("fscSource")}
                    value={entryScheduled ? "SCHEDULED" : "ON_DEMAND"}
                    onChange={(val) => setEntryScheduled(val === "SCHEDULED")}
                    options={[
                      { value: "ON_DEMAND", label: t("fscSourceOnDemand") },
                      { value: "SCHEDULED", label: t("fscSourceScheduled") },
                    ]}
                    columnHeaders={false}
                    triggerClassName="nf-input-sm min-w-[9rem] h-9"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscCountedAtHelp")}</p>
                <Button size="sm" variant="outline" onClick={() => void loadEvidence()} disabled={busy}>
                  {t("ffRetry")}
                </Button>
              </div>
              {entry.planningDate === null && entry.pairs.length > 0 && (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscPlanningUnavailable")}</p>
              )}
              {entry.pairs.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscEntryEmpty")}</p>
              ) : (
                <div className={cn(BOX, "mt-0")}><table aria-label={t("fscEntryLabel")} className={TABLE}>
                  <thead><tr>
                    {ENTRY_COLUMNS.map((column) => (
                      <th key={column} scope="col" className={cn(TH, RIGHT.has(column) && "text-right")}>{t(column)}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {entry.pairs.map((pair) => {
                      const key = `${pair.siloId}:${pair.itemId}`;
                      const value = counted[key] ?? "";
                      const differs = value !== "" && Number.isFinite(Number(value)) && Number(value) !== pair.systemQtyKg;
                      const siloLabel = pair.siloCode ?? pair.siloName ?? t("fscSiloCodeMissing");
                      return <tr key={key}>
                        <SiloCells {...pair} t={t} unavailable={unavailable} />
                        <td className={cn(TD, NUM)}>{kg(pair.systemQtyKg, unavailable)}</td>
                        <PlanningCells {...pair} t={t} unavailable={unavailable} />
                        <td className={cn(TD, NUM)}>
                          <input type="number" min={0} step="any" className="nf-input-sm h-9 w-28 px-2 text-right tabular-nums" style={inputStyle}
                            aria-label={t("fscCountedLabel", { silo: siloLabel, item: pair.itemCode })}
                            value={value} onChange={(e) => setCounted((current) => ({ ...current, [key]: e.target.value }))} />
                        </td>
                        <td className={TD}>{differs ? (
                          <ReasonSelect id={`sc-reason-${key}`} ariaLabel={t("fscReasonLabel", { silo: siloLabel, item: pair.itemCode })}
                            valueFormat="id" value={reasonIds[key] ?? null}
                            onChange={(next) => setReasonIds((current) => ({ ...current, [key]: next }))} />
                        ) : <span style={{ color: "var(--text-secondary)" }}>{t("fscNoReason")}</span>}</td>
                      </tr>;
                    })}
                  </tbody>
                </table></div>
              )}
            </>
          ) : selected ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <StatusDot variant={variantOf(REQ_STATUS_LABEL, selected.status)}>{labelOf(REQ_STATUS_LABEL, selected.status, t)}</StatusDot>
                <span className="text-xs text-(--text-secondary)">{sourceLabel(selected.schedule_source, t)}</span>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscColCountedAt")}: {shortTimestamp(selected.counted_at, unavailable)}</span>
                {selected.status === "PENDING_APPROVAL" && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscWaiting")}</span>}
                {href && <a href={href} className="text-xs font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("fscOpenApproval")}</a>}
              </div>
              {selected.count_type === "MONTHLY" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="stock-take-reconciliation">
                  <ReadField label={t("fscFarmOrMillCode")} value={selected.farm_code ? <RecordLink code={selected.farm_code} href={selected.farm_id ? locationHref(selected.farm_id) : null} /> : unavailable} appearance="control" />
                  <ReadField label={t("fscColPeriod")} value={selected.period_code ? <RecordLink code={selected.period_code} href={selected.reporting_period_id ? periodHref(selected.reporting_period_id) : null} /> : unavailable} appearance="control" />
                  <ReadField label={t("fscStockTakeDate")} value={selected.stock_take_date ? formatDateShort(String(selected.stock_take_date).slice(0, 10)) : unavailable} appearance="control" />
                  <ReadField label={t("fscAdjustmentType")} value={adjustmentTypeKey(lines) ? t(adjustmentTypeKey(lines)!) : t("fscAdjNone")} appearance="control" />
                  <ReadField label={t("fscGlEntry")} value={selected.gl_entry_refs?.length
                    ? selected.gl_entry_refs.map((ref, index) => <span key={ref}>{index > 0 && ", "}<RecordLink code={ref} href={`${JOURNAL_ROUTE}?no=${encodeURIComponent(ref)}`} /></span>)
                    : unavailable} appearance="control" />
                  <ReadField label={t("fscCostCentre")} value={selected.cost_center_code ? `${selected.cost_center_code}${selected.cost_center_name ? ` · ${selected.cost_center_name}` : ""}` : unavailable} appearance="control" />
                  <ReadField label={t("fscPeriodStatusAfter")} value={selected.period_status_after
                    ? (selected.period_status_after === "CLOSED" ? t("fscPeriodClosed") : selected.period_status_after === "OPEN" ? t("fscPeriodOpen") : selected.period_status_after)
                    : unavailable} appearance="control" />
                  <ReadField label={t("fscNextProductionStart")} value={selected.production_start_date_next ? formatDateShort(String(selected.production_start_date_next).slice(0, 10)) : unavailable} appearance="control" />
                </div>
              )}
              <div className={cn(BOX, "mt-0")}><table aria-label={t("fscLinesLabel")} className={TABLE}>
                <thead><tr>{LINE_COLUMNS.map((column) => (
                  <th key={column} scope="col" className={cn(TH, RIGHT.has(column) && "text-right")}>{t(column)}</th>
                ))}</tr></thead>
                <tbody>{lines.map((line) => (
                  <tr key={line.count_line_id}>
                    <SiloCells {...line} siloId={line.silo_id} siloCode={line.silo_code} siloName={line.silo_name ?? line.siloName}
                      itemId={line.item_id} itemCode={line.item_code} itemName={line.item_name} t={t} unavailable={unavailable} />
                    <td className={cn(TD, NUM)}>{kg(line.system_qty_kg, unavailable)}</td><td className={cn(TD, NUM)}>{kg(line.counted_qty_kg, unavailable)}</td>
                    <td className={cn(TD, NUM)}>{kg(line.variance_qty_kg, unavailable)}</td><td className={cn(TD, NUM)}>{kg(line.variance_pct_absolute, unavailable)}</td>
                    <PlanningCells {...line} siloId={line.silo_id} t={t} unavailable={unavailable} />
                    <td className={TD}>{line.reason_name ?? t("fscNoReason")}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
