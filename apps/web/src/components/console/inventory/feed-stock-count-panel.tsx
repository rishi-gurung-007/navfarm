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
import { Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, ReadField } from "@/components/ui/field";
import { ReasonSelect } from "@/components/ui/reason-select";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { unwrap } from "./feed-format";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { labelOf, REQ_STATUS_LABEL, variantOf } from "./requisition-labels";
import { useFeedFarm } from "./use-feed-farm";

interface CountRow {
  count_id: string;
  count_no: string;
  counted_at: string;
  schedule_source: string;
  status: string;
  approval_request_id: string | null;
  stock_adjustment_id: string | null;
}

interface CountLine {
  count_line_id: string;
  silo_id: string;
  item_id: string;
  system_qty_kg: string;
  counted_qty_kg: string;
  variance_qty_kg: string;
  variance_pct_absolute: string;
  reason_id: string | null;
  silo_code: string;
  item_code: string;
  item_name: string;
  reason_name: string | null;
}

interface CountView extends CountRow {
  lines: CountLine[];
}

interface EvidencePair {
  siloId: string;
  siloCode: string | null;
  itemId: string;
  itemCode: string;
  uom: string;
  systemQtyKg: number;
  costAvailable: boolean;
}

interface EvidenceResponse {
  countedAt: string;
  pairs: EvidencePair[];
}

const STATUS_FILTER = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "REJECTED"];
const LIST_COLUMNS = ["fscColCountNo", "fscColCountedAt", "fscColSource", "fscColStatus"] as const;
const LINE_COLUMNS = ["fscColSilo", "fscColItem", "fscColItemName", "fscColSystem", "fscColCounted", "fscColVariance", "fscColVariancePct", "fscColReason"] as const;
const RIGHT = new Set<string>(["fscColSystem", "fscColCounted", "fscColVariance", "fscColVariancePct"]);

const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const SMALL_BADGE = "px-1.5 py-0 text-[10px]";
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

const sourceLabel = (source: string, t: (key: any) => string): string =>
  source === "SCHEDULED" ? t("fscSourceScheduled") : t("fscSourceOnDemand");

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
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reasonIds, setReasonIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    if (!farmId || !companyId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ companyId, farmId });
      if (status) params.set("status", status);
      const list = unwrap<CountRow[]>(await api.get(`/feed-stock-count?${params.toString()}`));
      setRows(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || t("fscLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [farmId, companyId, status, t]);

  useEffect(() => {
    setSelected(null);
    setEntry(null);
    loadList();
  }, [loadList]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err: any) {
      setError(err?.message || t("fscActionFailed"));
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
      if (!farmId || !companyId) return;
      const params = new URLSearchParams({ companyId, farmId, countedAt: inputToInstant(entryAt) });
      setEntry(unwrap<EvidenceResponse>(await api.get(`/feed-stock-count/evidence?${params.toString()}`)));
      setCounted({});
      setReasonIds({});
    });

  const createCount = () =>
    run(async () => {
      if (!entry || !farmId || !companyId) return;
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
          farmId,
          countedAt: inputToInstant(entryAt),
          scheduleSource: entryScheduled ? "SCHEDULED" : "ON_DEMAND",
          lines,
        }),
      );
      setNotice(t("fscCreated", { no: created.count_no }));
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
      setNotice(t("fscSubmitted"));
      await reloadCount(id);
    });

  const post = (id: string) =>
    run(async () => {
      await api.post(`/feed-stock-count/${id}/post`, {});
      setNotice(t("fscPosted"));
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
    setError("");
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
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {farmPicker}
          <Field label={t("fscShow")} htmlFor="sc-status">
            <select
              id="sc-status"
              className="nf-input-sm nf-select"
              style={inputStyle}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t("rqShowAll")}</option>
              {STATUS_FILTER.map((value) => (
                <option key={value} value={value}>
                  {labelOf(REQ_STATUS_LABEL, value, t)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void loadEvidence()} disabled={!farmId || busy}>
            {t("fscNew")}
          </Button>
        </div>
      </div>

      {!dialogOpen && error && <InlineAlert>{error}</InlineAlert>}
      {!dialogOpen && notice && <InlineAlert variant="success">{notice}</InlineAlert>}

      {farm.failed ? (
        <InlineAlert>
          <span className="mr-3">{t("ffFarmsLoadFailed")}</span>
          <Button size="sm" variant="outline" onClick={farm.retry}>
            {t("ffRetry")}
          </Button>
        </InlineAlert>
      ) : !farm.loaded ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("fscLoading")}
        </div>
      ) : noFarms || !farmId || !companyId ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}>{t("ffNoFarms")}</div>
      ) : loading ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("fscLoading")}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
          <Inbox className="mx-auto mb-2 h-6 w-6" /> {t("fscNone")}
        </div>
      ) : (
        <ScrollTable label={t("fscListLabel")}>
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
              <tr key={row.count_id} className="cursor-pointer" onClick={() => void openCount(row.count_id)}>
                <td className={cn(TD, "font-medium")}>{row.count_no}</td>
                <td className={TD}>{shortTimestamp(row.counted_at, unavailable)}</td>
                <td className={TD}>{sourceLabel(row.schedule_source, t)}</td>
                <td className={TD}>
                  <Badge variant={variantOf(REQ_STATUS_LABEL, row.status)} className={SMALL_BADGE}>
                    {labelOf(REQ_STATUS_LABEL, row.status, t)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={entry ? t("fscNew") : selected?.count_no ?? t("fftTabPhysicalCount")}
        presentation="page"
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
          {error && <InlineAlert>{error}</InlineAlert>}
          {notice && <InlineAlert variant="success">{notice}</InlineAlert>}
          {entry ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ReadField label={t("ffFarm")} value={dialogFarmLabel} appearance="control" />
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
                <Field label={t("fscSource")} htmlFor="sc-source">
                  <select
                    id="sc-source"
                    className="nf-input-sm nf-select"
                    style={inputStyle}
                    value={entryScheduled ? "SCHEDULED" : "ON_DEMAND"}
                    onChange={(e) => setEntryScheduled(e.target.value === "SCHEDULED")}
                  >
                    <option value="ON_DEMAND">{t("fscSourceOnDemand")}</option>
                    <option value="SCHEDULED">{t("fscSourceScheduled")}</option>
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscCountedAtHelp")}</p>
                <Button size="sm" variant="outline" onClick={() => void loadEvidence()} disabled={busy}>
                  {t("ffRetry")}
                </Button>
              </div>
              {entry.pairs.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscEntryEmpty")}</p>
              ) : (
                <ScrollTable label={t("fscEntryLabel")}>
                  <thead><tr>
                    <th scope="col" className={TH}>{t("fscColSilo")}</th>
                    <th scope="col" className={TH}>{t("fscColItem")}</th>
                    <th scope="col" className={cn(TH, NUM)}>{t("fscColSystem")}</th>
                    <th scope="col" className={cn(TH, NUM)}>{t("fscColCounted")}</th>
                    <th scope="col" className={TH}>{t("fscColReason")}</th>
                  </tr></thead>
                  <tbody>
                    {entry.pairs.map((pair) => {
                      const key = `${pair.siloId}:${pair.itemId}`;
                      const value = counted[key] ?? "";
                      const differs = value !== "" && Number.isFinite(Number(value)) && Number(value) !== pair.systemQtyKg;
                      return <tr key={key}>
                        <td className={TD}>{pair.siloCode ?? pair.siloId}</td>
                        <td className={TD}>{pair.itemCode}</td>
                        <td className={cn(TD, NUM)}>{kg(pair.systemQtyKg, unavailable)}</td>
                        <td className={cn(TD, NUM)}>
                          <input type="number" min={0} step="any" className="nf-input-sm w-28 px-2 text-right" style={inputStyle}
                            aria-label={t("fscCountedLabel", { silo: pair.siloCode ?? pair.siloId, item: pair.itemCode })}
                            value={value} onChange={(e) => setCounted((current) => ({ ...current, [key]: e.target.value }))} />
                        </td>
                        <td className={TD}>{differs ? (
                          <ReasonSelect id={`sc-reason-${key}`} ariaLabel={t("fscReasonLabel", { silo: pair.siloCode ?? pair.siloId, item: pair.itemCode })}
                            valueFormat="id" value={reasonIds[key] ?? null}
                            onChange={(next) => setReasonIds((current) => ({ ...current, [key]: next }))} />
                        ) : <span style={{ color: "var(--text-secondary)" }}>{t("fscNoReason")}</span>}</td>
                      </tr>;
                    })}
                  </tbody>
                </ScrollTable>
              )}
            </>
          ) : selected ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge variant={variantOf(REQ_STATUS_LABEL, selected.status)}>{labelOf(REQ_STATUS_LABEL, selected.status, t)}</Badge>
                <Badge variant="neutral">{sourceLabel(selected.schedule_source, t)}</Badge>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscColCountedAt")}: {shortTimestamp(selected.counted_at, unavailable)}</span>
                {selected.status === "PENDING_APPROVAL" && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("fscWaiting")}</span>}
                {href && <a href={href} className="text-xs font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("fscOpenApproval")}</a>}
              </div>
              <ScrollTable label={t("fscLinesLabel")}>
                <thead><tr>{LINE_COLUMNS.map((column) => (
                  <th key={column} scope="col" className={cn(TH, RIGHT.has(column) && "text-right")}>{t(column)}</th>
                ))}</tr></thead>
                <tbody>{lines.map((line) => (
                  <tr key={line.count_line_id}>
                    <td className={TD}>{line.silo_code}</td><td className={TD}>{line.item_code}</td><td className={TD}>{line.item_name}</td>
                    <td className={cn(TD, NUM)}>{kg(line.system_qty_kg, unavailable)}</td><td className={cn(TD, NUM)}>{kg(line.counted_qty_kg, unavailable)}</td>
                    <td className={cn(TD, NUM)}>{kg(line.variance_qty_kg, unavailable)}</td><td className={cn(TD, NUM)}>{kg(line.variance_pct_absolute, unavailable)}</td>
                    <td className={TD}>{line.reason_name ?? t("fscNoReason")}</td>
                  </tr>
                ))}</tbody>
              </ScrollTable>
            </>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
