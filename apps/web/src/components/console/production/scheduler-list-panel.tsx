"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, Plus, Search } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import SchedulerDetailPanel from "@/components/console/production/scheduler-detail-panel";
import CreateSchedulerModal from "./create-scheduler-modal";
import { formatQuantity } from "@/lib/utils";
import { SearchableSelect } from "@/components/ui/searchable-select";

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

  // One plain list, newest scheduler first, paged like every other list screen.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const sorted = useMemo(
    () => [...rows].sort((a, b) => String(b.scheduler_no || "").localeCompare(String(a.scheduler_no || ""))),
    [rows],
  );
  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize]);
  const pagedRows = sorted.slice((page - 1) * pageSize, page * pageSize);

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
          <div className="w-44">
            <SearchableSelect
              ariaLabel="Status Filter"
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              options={STATUSES}
              placeholder={t("schFilterStatus")}
              onClear={statusFilter ? () => setStatusFilter("") : undefined}
            />
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin" style={S.muted} />}
        </div>
        <Button
          size="sm"
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("schCreate")}
        </Button>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      {!loading && rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t("schNoResults")} />
      ) : loading && rows.length === 0 ? (
        <LoadingState label={t("schLoading")} />
      ) : (
        <div className="flex flex-col gap-2">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">{t("schColSchedulerId")}</TableHead>
                  <TableHead>{t("schColBatch")}</TableHead>
                  <TableHead>{t("schColStage")}</TableHead>
                  <TableHead>{t("schColStatus")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("schColEffectiveFrom")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("schColEffectiveTo")}</TableHead>
                  <TableHead className="text-right">{t("schColAnimalCount")}</TableHead>
                  <TableHead className="text-right">{t("schColLines")}</TableHead>
                  <TableHead>{t("schColLocation")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map((r) => (
                  <TableRow key={r.scheduler_id} className="cursor-pointer" onClick={() => setViewingId(r.scheduler_id)}>
                    <TableCell className="whitespace-nowrap font-mono font-semibold text-[var(--accent)]">{r.scheduler_no || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>
                      <span className="font-medium">{r.batch_no || "—"}</span>
                      {r.breed_name && <span className="block text-[11px]" style={S.muted}>{r.breed_name}</span>}
                    </TableCell>
                    <TableCell style={S.primary}>
                      <span className="font-medium">{r.stage_name || "—"}</span>
                      {r.system_scheduler_name && (
                        <span className="block text-[11px]" style={S.muted}>{t("schFromSystem", { name: r.system_scheduler_name })}</span>
                      )}
                    </TableCell>
                    <TableCell><StatusBadge status={r.scheduler_status} /></TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{r.effective_from || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{r.effective_to || "—"}</TableCell>
                    <TableCell className="text-right" style={S.primary}>{r.animal_count != null ? formatQuantity(r.animal_count, "HEAD") : "—"}</TableCell>
                    <TableCell className="text-right" style={S.sub}>{r.line_count ?? 0}</TableCell>
                    <TableCell style={S.sub}>{r.location_name || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setViewingId(r.scheduler_id); }}
                        className="h-7 text-xs font-semibold text-[var(--accent)]"
                      >
                        {t("schViewDetail")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          <Pagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}

      <Dialog
        open={!!viewingId}
        onClose={() => setViewingId(null)}
        title={viewingRow ? t("schDetailTitle", { schedulerNo: viewingRow.scheduler_no || "", batchNo: viewingRow.batch_no || "" }) : t("schTitle")}
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
