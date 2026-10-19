"use client";

import { NA } from "@/utils/na";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, AlertCircle, Search } from "lucide-react";
import { api } from "../../../services/api-client";
import { getStoredToken, getStoredUser } from "../../../hooks/useAuth";
import { useLanguage } from "../../../hooks/useLanguage";
import { PageHeader } from "../../../components/ui/PageHeader";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../../components/ui/table";

export default function AdminAuditPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const token = getStoredToken();
    const user = getStoredUser();
    if (!token || !user || user.userType !== "SYSTEM_ADMIN") { router.replace("/"); return; }
    loadLogs();
  }, [router]);

  useEffect(() => {
    if (!search.trim()) { setFiltered(auditLogs); return; }
    const q = search.toLowerCase();
    setFiltered(auditLogs.filter((log) =>
      log.action?.toLowerCase().includes(q) ||
      log.entity_name?.toLowerCase().includes(q) ||
      log.user_name?.toLowerCase().includes(q)
    ));
  }, [search, auditLogs]);

  const loadLogs = async () => {
    setLoading(true); setError("");
    try {
      const list = await api.get("/audit-log");
      setAuditLogs(list); setFiltered(list);
    } catch (e: any) { setError(e?.message || t("failedToLoadAuditLogs")); }
    finally { setLoading(false); }
  };

  const actionBadge = (action: string) => {
    const act = action?.toUpperCase() || "";
    let bg = "#EFF6FF", color = "#1D4ED8", border = "#BFDBFE";
    if (act.includes("CREATE") || act.includes("REGISTER")) { bg = "#F0FDF4"; color = "#15803D"; border = "#BBF7D0"; }
    else if (act.includes("UPDATE") || act.includes("EDIT") || act.includes("ASSIGN")) { bg = "#FFFBEB"; color = "#B45309"; border = "#FDE68A"; }
    else if (act.includes("DELETE") || act.includes("REMOVE") || act.includes("REVOKE")) { bg = "#FEF2F2"; color = "#B91C1C"; border = "#FECACA"; }
    return (
      <span className="text-[11px] font-semibold uppercase font-mono px-2 py-0.5 rounded-[var(--radius-xs)] border"
        style={{ backgroundColor: bg, color, borderColor: border }}>{action}</span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin w-5 h-5 mr-2" style={{ color: "var(--accent)" }} />
        <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("loadingAuditLogs")}</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-4 sm:px-6 sm:pb-6 xl:px-8 xl:pb-8">
      <PageHeader
        title={t("systemAuditLogs")}
        description={`${auditLogs.length} ${t("platformWideEventsRecorded")}`}
        actions={
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchLogs")}
              className="w-full rounded-lg border py-2 pl-9 pr-4 text-sm sm:w-64"
              style={{ borderColor: "var(--input-border)", backgroundColor: "var(--input-bg)", color: "var(--input-text)" }} />
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 text-(--danger) bg-(--danger-muted) border border-(--danger) rounded-lg p-4 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="rounded-lg border overflow-hidden" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <table className="w-full border-collapse text-sm">
          <TableHeader>
            <tr className="border-b border-(--row-border)">
              {["#", t("timestamp"), t("action"), t("entity"), t("user")].map((h, idx) => (
                <TableHead key={idx} className="px-5">{h}</TableHead>
              ))}
            </tr>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <tr><TableCell colSpan={5} className="px-5 text-center" style={{ color: "var(--text-muted)" }}>
                {search ? t("noResultsMatch") : t("noAuditEntriesFound")}
              </TableCell></tr>
            ) : (
              filtered.map((log, idx) => (
                <TableRow key={log.audit_id || idx}>
                  <TableCell className="px-5 font-mono" style={{ color: "var(--text-muted)" }}>{idx + 1}</TableCell>
                  <TableCell className="px-5 font-mono whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    {log.created_at ? new Date(log.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : NA}
                  </TableCell>
                  <TableCell className="px-5">{actionBadge(log.action)}</TableCell>
                  <TableCell className="px-5 font-medium" style={{ color: "var(--text-primary)" }}>
                    {log.entity_name} <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>({log.entity_id?.substring(0, 8)}…)</span>
                  </TableCell>
                  <TableCell className="px-5" style={{ color: "var(--text-secondary)" }}>{log.user_name || t("system")}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
