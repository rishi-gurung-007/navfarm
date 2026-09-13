"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus, Search } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import SchedulerDetailPanel from "@/components/console/production/scheduler-detail-panel";
import CreateSchedulerModal from "./create-scheduler-modal";

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input";
const STATUSES = ["DRAFT", "ACTIVE", "COMPLETED", "SUSPENDED"];

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

export default function SchedulerListPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const viewingRow = rows.find((r) => r.scheduler_id === viewingId) || null;

  const load = () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    params.set("companyId", companyId);
    if (statusFilter) params.set("status", statusFilter);
    if (search) params.set("search", search);
    api.get(`/scheduler-header?${params.toString()}`)
      .then((r) => setRows(unwrap<Row[]>(r) || []))
      .catch((err: any) => setError(err?.message || "Could not load schedulers."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [companyId, statusFilter]);
  useEffect(() => {
    const timeout = setTimeout(load, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("schSearchPlaceholder")}
              className={`${inputCls} pl-8 w-56`}
              style={S.input}
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputCls} nf-select w-auto`} style={S.input}>
            <option value="">{t("schFilterStatus")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {loading && <Loader2 className="h-4 w-4 animate-spin" style={S.muted} />}
        </div>
        <Button
          size="sm"
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Scheduler
        </Button>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {!loading && rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t("schNoResults")} />
      ) : loading && rows.length === 0 ? (
        <LoadingState label={t("schLoading")} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
          <table className="w-full border-collapse text-left text-xs">
            <TableHeader><tr className="border-b border-[var(--row-border)]">
              <TableHead className="h-auto px-3 py-2">{t("schColSchedulerId")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColBatch")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColStage")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColBreed")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColStatus")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColEffectiveFrom")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColEffectiveTo")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColAnimalCount")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColLines")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColLocation")}</TableHead>
              <TableHead className="h-auto px-3 py-2"></TableHead>
            </tr></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.scheduler_id} className="cursor-pointer" onClick={() => setViewingId(r.scheduler_id)}>
                  <TableCell className="px-3 py-2 font-mono text-[11px] font-semibold text-[var(--accent)]" title={r.scheduler_id}>
                    <span className="block max-w-[130px] truncate">{r.scheduler_id}</span>
                  </TableCell>
                  <TableCell className="px-3 py-2 font-medium" style={S.primary}>{r.batch_no || "—"}</TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.stage_name || "—"}</TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.breed_name || "—"}</TableCell>
                  <TableCell className="px-3 py-2"><StatusBadge status={r.scheduler_status} /></TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.effective_from || "—"}</TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.effective_to || "—"}</TableCell>
                  <TableCell className="px-3 py-2" style={S.primary}>{r.animal_count ?? "—"}</TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.line_count ?? 0}</TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.location_name || "—"}</TableCell>
                  <TableCell className="px-3 py-2">
                    <button onClick={(e) => { e.stopPropagation(); setViewingId(r.scheduler_id); }} className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                      {t("schViewDetail")}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}

      <Dialog
        open={!!viewingId}
        onClose={() => setViewingId(null)}
        title={viewingRow ? t("schDetailTitle", { batchNo: viewingRow.batch_no || "" }) : t("schTitle")}
        maxWidth="xl"
      >
        {viewingId && (
          <SchedulerDetailPanel schedulerId={viewingId} onChanged={load} />
        )}
      </Dialog>

      <CreateSchedulerModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(newId) => {
          load();
          setViewingId(newId);
        }}
        companyId={companyId || ""}
      />
    </div>
  );
}
