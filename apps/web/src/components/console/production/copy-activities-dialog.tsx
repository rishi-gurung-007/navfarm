"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Search } from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";

type Row = Record<string, any>;

export type CopySourceType = "SYSTEM" | "BATCH";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

interface CopyActivitiesDialogProps {
  open: boolean;
  onClose: () => void;
  companyId: string | null | undefined;
  /** The scheduler being filled — left out of the list. */
  targetId: string;
  /** Its stage, so the schedulers for the same stage are listed first. */
  stageName?: string | null;
  /** Does the copy; a rejection is shown in the dialog, and resolving false keeps it open. */
  onCopy: (sourceType: CopySourceType, sourceId: string) => Promise<void | boolean>;
}

/**
 * Picks the scheduler an empty one copies its activities from — the system
 * schedulers (Draft tab) and every batch's scheduler (Active tab) that has
 * activities, same stage first.
 */
export default function CopyActivitiesDialog({ open, onClose, companyId, targetId, stageName, onCopy }: CopyActivitiesDialogProps) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !companyId) return;
    setSearch("");
    setError("");
    setLoading(true);
    Promise.all([
      api.get(`/system-scheduler?companyId=${companyId}`).catch(() => []),
      api.get(`/scheduler-header?companyId=${companyId}&limit=200`).catch(() => []),
    ])
      .then(([systemRes, batchRes]) => {
        const system = (unwrap<Row[]>(systemRes) || [])
          .filter((r) => r.is_active && r.line_count > 0 && r.system_scheduler_id !== targetId)
          .map((r) => ({ ...r, __type: "SYSTEM" as CopySourceType, __id: r.system_scheduler_id, __label: r.scheduler_name }));
        const batch = (unwrap<Row[]>(batchRes) || [])
          .filter((r) => r.line_count > 0 && r.scheduler_id !== targetId)
          .map((r) => ({ ...r, __type: "BATCH" as CopySourceType, __id: r.scheduler_id, __label: r.batch_no }));
        setRows([...system, ...batch]);
      })
      .finally(() => setLoading(false));
  }, [open, companyId, targetId]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => !q || [r.__label, r.stage_name, r.breed_name].some((v) => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => Number(b.stage_name === stageName) - Number(a.stage_name === stageName));
  }, [rows, search, stageName]);

  const copy = async (row: Row) => {
    setCopyingId(row.__id);
    setError("");
    try {
      if ((await onCopy(row.__type, row.__id)) !== false) onClose();
    } catch (err: any) {
      setError(err?.message || "Could not copy the activities.");
    } finally {
      setCopyingId(null);
    }
  };

  const section = (type: CopySourceType, title: string) => {
    const list = visible.filter((r) => r.__type === type);
    if (!list.length) return null;
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{title}</p>
        <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-left text-xs">
            <TableHeader><tr className="border-b border-[var(--row-border)]">
              <TableHead className="h-auto px-3 py-2">{type === "SYSTEM" ? t("sysSchColName") : t("schColBatch")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColStage")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColBreed")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("sysSchColActivities")}</TableHead>
              <TableHead className="h-auto px-3 py-2"></TableHead>
            </tr></TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={`${r.__type}-${r.__id}`}>
                  <TableCell className="px-3 py-2 font-semibold text-[var(--text-primary)]">{r.__label || "—"}</TableCell>
                  <TableCell className="px-3 py-2 text-[var(--text-secondary)]">
                    {r.stage_name || r.stage_code || "—"}
                    {stageName && r.stage_name === stageName && (
                      <span className="ml-1.5 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">{t("scCopySameStage")}</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-[var(--text-secondary)]">{r.breed_name || (type === "SYSTEM" ? t("sysSchAllBreeds") : "—")}</TableCell>
                  <TableCell className="px-3 py-2 font-mono text-[var(--text-primary)]">{r.line_count}</TableCell>
                  <TableCell className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" disabled={!!copyingId} onClick={() => copy(r)} className="h-7 gap-1 text-[11px]">
                      {copyingId === r.__id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
                      {t("scCopyAction")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("scCopyTitle")} description={t("scCopyHint")} presentation="compact" maxWidth="lg">
      <div className="flex flex-col gap-4">
        <Toast variant="danger" message={error} onClose={() => setError("")} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("scCopySearch")}
            className="nf-input w-full pl-8"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" }}
          />
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" /></div>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-secondary)]">{t("scCopyNone")}</p>
        ) : (
          <>
            {section("SYSTEM", t("schTabSystem"))}
            {section("BATCH", t("scCopyBatchSection"))}
          </>
        )}
      </div>
    </Dialog>
  );
}
