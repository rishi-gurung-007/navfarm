"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2, MoveRight, PackageCheck, Scale, Users } from "lucide-react";
import { api } from "@/services/api-client";
import { getActiveCompanyId, getActiveOperationalAreaId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { InlineAlert } from "@/components/ui/alert";
import { StatRow, StatCard } from "@/components/ui/stat-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { AnimalMultiSelect, type AnimalOption } from "./animal-multi-select";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const today = () => new Date().toISOString().slice(0, 10);

const money = (v: unknown) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * Animals moving from one batch to another — the movement that happens when a
 * cycle ends, or when a few head are pulled out early.
 *
 * Deliberately separate from the "Stage & Pen Transfers" log on the stage-wise
 * panel: that one shows a single batch walking its own lifecycle, this one
 * shows animals changing batch. A transferred animal stays operable under its
 * new batch, so it keeps appearing in data entry, health and breeding screens.
 */
export default function BatchTransferPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const areaId = getActiveOperationalAreaId();

  const [rows, setRows] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Draft state for the "new transfer" dialog.
  const [open, setOpen] = useState(false);
  const [fromBatchId, setFromBatchId] = useState("");
  const [toBatchId, setToBatchId] = useState("");
  const [transferDate, setTransferDate] = useState(today);
  const [wholeBatch, setWholeBatch] = useState(true);
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [pool, setPool] = useState<Row[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("company_id", companyId);
      if (areaId) params.set("operational_area_id", areaId);
      const res = await api.get(`/batch-transfer?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("btFailedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [companyId, areaId, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!companyId) return;
    api
      .get(`/batch?companyId=${companyId}&limit=200`)
      .then((r) => setBatches(unwrap<Row[]>(r) || []))
      .catch(() => setBatches([]));
  }, [companyId]);

  // The transferable pool is per-source-batch and always refetched — a batch's
  // membership changes with every mortality, sale or earlier transfer, so a
  // cached list would offer animals the API will reject.
  useEffect(() => {
    if (!fromBatchId) {
      setPool([]);
      setSelected(new Set());
      return;
    }
    setPoolLoading(true);
    api
      .get(`/batch-transfer/transferable/${fromBatchId}`)
      .then((r) => setPool(unwrap<Row[]>(r) || []))
      .catch(() => setPool([]))
      .finally(() => setPoolLoading(false));
    setSelected(new Set());
  }, [fromBatchId]);

  const areaBatches = useMemo(
    () => (areaId ? batches.filter((b) => b.operational_area_id === areaId) : batches),
    [batches, areaId]
  );
  const sourceBatches = useMemo(() => areaBatches.filter((b) => b.status === "ACTIVE"), [areaBatches]);
  const destinationBatches = useMemo(
    () => areaBatches.filter((b) => b.batch_id !== fromBatchId && ["ACTIVE", "DRAFT"].includes(b.status)),
    [areaBatches, fromBatchId]
  );

  const animalOptions: AnimalOption[] = useMemo(
    () => pool.map((a) => ({ animal_id: a.animal_id, label: a.ear_tag || a.animal_code })),
    [pool]
  );

  const totals = useMemo(() => {
    const posted = rows.filter((r) => r.status === "POSTED");
    return {
      count: rows.length,
      head: posted.reduce((s, r) => s + Number(r.head_count || 0), 0),
      value: posted.reduce((s, r) => s + Number(r.transfer_value || 0), 0),
      latest: rows[0]?.transfer_date || "—",
    };
  }, [rows]);

  const resetForm = () => {
    setFromBatchId("");
    setToBatchId("");
    setTransferDate(today());
    setWholeBatch(true);
    setReason("");
    setRemarks("");
    setSelected(new Set());
    setSearch("");
    setFormError("");
  };

  const toggleAnimal = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setFormError("");
    if (!fromBatchId) return setFormError(t("btErrorNoSource"));
    if (!toBatchId) return setFormError(t("btErrorNoDestination"));
    if (!wholeBatch && selected.size === 0) return setFormError(t("btErrorNoAnimals"));

    setSaving(true);
    try {
      const res = await api.post(`/batch-transfer/from/${fromBatchId}`, {
        company_id: companyId,
        to_batch_id: toBatchId,
        transfer_date: transferDate,
        transfer_type: wholeBatch ? "FULL_BATCH" : "PARTIAL",
        ...(wholeBatch ? {} : { animal_ids: [...selected] }),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      const saved = unwrap<Row>(res);
      setNotice(
        t("btSuccess", { no: saved?.transfer_no || "", n: String(Math.round(Number(saved?.head_count || 0))) })
      );
      setOpen(false);
      resetForm();
      await load();
    } catch (err: any) {
      setFormError(err?.message || t("btFailedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const batchNo = (id: string) => batches.find((b) => b.batch_id === id)?.batch_no || "—";
  const poolCount = pool.length;

  return (
    <div className="space-y-6">
      {notice && <InlineAlert variant="success">{notice}</InlineAlert>}

      <StatRow columns={4}>
        <StatCard label={t("btStatTransfers")} value={totals.count} icon={MoveRight} />
        <StatCard label={t("btStatHeadMoved")} value={Math.round(totals.head)} icon={Users} />
        <StatCard label={t("btStatValueMoved")} value={money(totals.value)} icon={Scale} />
        <StatCard label={t("btStatLatest")} value={totals.latest} icon={PackageCheck} />
      </StatRow>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--text-secondary)]">{t("btIntro")}</p>
        <Button onClick={() => { setNotice(""); resetForm(); setOpen(true); }}>{t("btNewTransfer")}</Button>
      </div>

      {loading ? (
        <LoadingState label={t("btLoading")} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState icon={MoveRight} title={t("btNoTransfers")} description={t("btNoTransfersHint")} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-3 font-semibold">{t("btColTransferNo")}</th>
                <th className="px-4 py-3 font-semibold">{t("btColDate")}</th>
                <th className="px-4 py-3 font-semibold">{t("btColMovement")}</th>
                <th className="px-4 py-3 font-semibold">{t("btColType")}</th>
                <th className="px-4 py-3 text-right font-semibold">{t("btColHead")}</th>
                <th className="px-4 py-3 text-right font-semibold">{t("btColValue")}</th>
                <th className="px-4 py-3 font-semibold">{t("btColStatus")}</th>
                <th className="px-4 py-3 font-semibold">{t("btColReason")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.transfer_id}
                  onClick={() => setViewing(r)}
                  className="cursor-pointer border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-hover)]"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-[var(--accent)]">{r.transfer_no}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">{r.transfer_date}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="font-medium text-[var(--text-primary)]">{r.from_batch_no || batchNo(r.from_batch_id)}</span>
                      <ArrowRight size={14} className="text-[var(--text-muted)]" />
                      <span className="font-medium text-[var(--text-primary)]">{r.to_batch_no || batchNo(r.to_batch_id)}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">
                    {r.transfer_type === "FULL_BATCH" ? t("btWholeBatch") : t("btSelectedAnimals")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--text-primary)]">
                    {Math.round(Number(r.head_count || 0))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--text-primary)]">
                    {money(r.transfer_value)}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{r.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("btNewTransfer")}
        description={t("btDialogDescription")}
        maxWidth="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={submit} disabled={saving}>
              {saving ? <><Loader2 size={14} className="mr-2 animate-spin" />{t("btSubmitting")}</> : t("btSubmit")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && <InlineAlert variant="danger">{formError}</InlineAlert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="nf-text-label">{t("btFromBatch")}</span>
              <SearchableSelect
                ariaLabel={t("btFromBatch")}
                value={fromBatchId}
                onChange={(val) => setFromBatchId(val)}
                options={sourceBatches.map((b) => ({
                  value: b.batch_id,
                  label: b.batch_no,
                }))}
                placeholder={t("btSelectSource")}
                searchPlaceholder="Search source batch…"
              />
            </label>
            <label className="block">
              <span className="nf-text-label">{t("btToBatch")}</span>
              <SearchableSelect
                ariaLabel={t("btToBatch")}
                value={toBatchId}
                onChange={(val) => setToBatchId(val)}
                options={destinationBatches.map((b) => ({
                  value: b.batch_id,
                  label: b.batch_no,
                }))}
                placeholder={t("btSelectDestination")}
                searchPlaceholder="Search destination batch…"
                disabled={!fromBatchId}
              />
            </label>
            <label className="block">
              <span className="nf-text-label">{t("btTransferDate")}</span>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="nf-input w-full text-sm"
              />
            </label>
            <label className="block">
              <span className="nf-text-label">{t("btReason")}</span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("btReasonPlaceholder")}
                className="nf-input w-full text-sm"
              />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="nf-text-label">{t("btScope")}</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-primary)]">
                <input type="radio" checked={wholeBatch} onChange={() => setWholeBatch(true)} className="accent-(--accent)" />
                {t("btWholeBatch")}
                {fromBatchId && <span className="text-[var(--text-muted)]">({poolCount})</span>}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-primary)]">
                <input type="radio" checked={!wholeBatch} onChange={() => setWholeBatch(false)} className="accent-(--accent)" />
                {t("btSelectedAnimals")}
              </label>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {wholeBatch ? t("btWholeBatchHint") : t("btSelectedAnimalsHint")}
            </p>
          </fieldset>

          {!wholeBatch && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="nf-text-label">{t("btTransferableAnimals")}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(animalOptions.map((a) => a.animal_id)))}
                    className="text-xs font-medium text-[var(--accent)] hover:underline"
                  >
                    {t("btSelectAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-xs font-medium text-[var(--text-secondary)] hover:underline"
                  >
                    {t("btClearSelection")}
                  </button>
                </div>
              </div>
              <AnimalMultiSelect
                options={animalOptions}
                loading={poolLoading}
                selected={selected}
                onToggle={toggleAnimal}
                search={search}
                onSearchChange={setSearch}
                selectionNote={t("btAnimalsSelected", { n: String(selected.size), total: String(poolCount) })}
              />
            </div>
          )}

          <label className="block">
            <span className="nf-text-label">{t("btRemarks")}</span>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--input-text)]"
            />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.transfer_no || ""}
        description={
          viewing
            ? t("btDetailDescription", {
                from: viewing.from_batch_no || batchNo(viewing.from_batch_id),
                to: viewing.to_batch_no || batchNo(viewing.to_batch_id),
                date: viewing.transfer_date,
              })
            : ""
        }
        maxWidth="md"
      >
        {viewing && <TransferLines transferId={viewing.transfer_id} />}
      </Dialog>
    </div>
  );
}

/** The animals on one transfer, fetched on open rather than carried in the list payload. */
function TransferLines({ transferId }: { transferId: string }) {
  const { t } = useLanguage();
  const [lines, setLines] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLines(null);
    setFailed(false);
    api
      .get(`/batch-transfer/${transferId}`)
      .then((r) => setLines(unwrap<Row>(r)?.lines || []))
      .catch(() => setFailed(true));
  }, [transferId]);

  if (failed) return <ErrorState message={t("btFailedToLoad")} />;
  if (!lines) return <LoadingState label={t("btLoading")} />;
  if (lines.length === 0) return <EmptyState title={t("btNoLines")} />;

  return (
    <div className="max-h-80 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            <th className="px-3 py-2 font-semibold">{t("btColAnimal")}</th>
            <th className="px-3 py-2 font-semibold">{t("btColAnimalType")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("btColBookValue")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_id} className="border-b border-[var(--border)] last:border-b-0">
              <td className="px-3 py-2 font-mono font-semibold text-[var(--accent)]">{l.ear_tag || l.animal_code}</td>
              <td className="px-3 py-2 text-[var(--text-secondary)]">{l.animal_type || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[var(--text-primary)]">{money(l.book_value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
