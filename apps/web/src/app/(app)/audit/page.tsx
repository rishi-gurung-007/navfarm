"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../../../services/api-client";
import { getStoredToken, getStoredUser } from "../../../hooks/useAuth";
import { LoadingState, ErrorState } from "../../../components/ui/states";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ConsolePage } from "../../../components/ui/console-page";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../../components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "../../../utils/translations";

type Translate = (key: TranslationKeys) => string;

/**
 * Bookkeeping columns carry no meaning for someone reading the ledger — the
 * row already shows who acted and when, so repeating updated_by/updated_at as
 * "changed fields" buries the one field that actually changed.
 */
const NOISE_FIELDS = new Set([
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "tenant_id",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/;

/** snake_case column -> the words an admin reads. */
function fieldLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function isDateLike(key: string, value: unknown) {
  if (value instanceof Date) return true;
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return /_at$|_date$|date$/i.test(key) || value.includes("T");
}

function sameValue(a: unknown, b: unknown) {
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v);
  const x = norm(a);
  const y = norm(b);
  // Decimal columns come back from the row as a string ("10.000") and from the
  // DTO as a number (10). Comparing their JSON would report every one of them
  // as changed, which is how a real edit gets lost in the noise.
  const numeric = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
  const nx = numeric(x);
  const ny = numeric(y);
  if (nx !== null && ny !== null) return nx === ny;
  // Same for booleans stored as 0/1 in MySQL and sent as true/false by the DTO.
  if (typeof x === "boolean" || typeof y === "boolean") {
    const bool = (v: unknown) => (typeof v === "boolean" ? v : v === 1 || v === "1" ? true : v === 0 || v === "0" ? false : v);
    return bool(x) === bool(y);
  }
  try {
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return x === y;
  }
}

/** One value, rendered so a JSON blob or a timestamp is readable rather than raw. */
function AuditValue({ fieldKey, value }: { fieldKey: string; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  if (typeof value === "boolean") {
    return <span style={{ color: "var(--text-primary)" }}>{value ? "Yes" : "No"}</span>;
  }
  if (isDateLike(fieldKey, value)) {
    const d = new Date(value as string);
    if (!Number.isNaN(d.getTime())) {
      return (
        <span className="font-mono" style={{ color: "var(--text-primary)" }}>
          {d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </span>
      );
    }
  }
  if (typeof value === "object") {
    return (
      <pre
        className="overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] p-2 font-mono text-[10px] leading-relaxed"
        style={{ backgroundColor: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return (
    <span className="break-words" style={{ color: "var(--text-primary)" }}>
      {String(value)}
    </span>
  );
}

/** A before/after pair for one column. Stacks under 640px, side by side above it. */
function DiffRow({ fieldKey, before, after, changed, t }: {
  fieldKey: string;
  before: unknown;
  after: unknown;
  changed: boolean;
  t: Translate;
}) {
  return (
    <div className="border-t py-2.5 first:border-t-0" style={{ borderColor: "var(--row-border)" }}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {fieldLabel(fieldKey)}
        </span>
        <span className="font-mono text-[9px]" style={{ color: "var(--text-muted)" }}>{fieldKey}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div
          className="rounded-[var(--radius-sm)] px-2.5 py-1.5"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            {t("auditBefore")}
          </div>
          <div className="text-[11px]"><AuditValue fieldKey={fieldKey} value={before} /></div>
        </div>
        <div
          className="rounded-[var(--radius-sm)] px-2.5 py-1.5"
          style={{
            backgroundColor: changed ? "var(--warning-muted)" : "var(--surface)",
            border: `1px solid ${changed ? "var(--warning)" : "var(--border)"}`,
          }}
        >
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            {t("auditAfter")}
          </div>
          <div className="text-[11px]"><AuditValue fieldKey={fieldKey} value={after} /></div>
        </div>
      </div>
    </div>
  );
}

function MetaBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{children}</div>
    </div>
  );
}

/**
 * What the entry changed, as Rishi asked for it: the before and the after side
 * by side, the acting user's identity beside them, and the columns nothing
 * touched kept out of the way until asked for.
 */
function AuditDetail({ log, t }: { log: any; t: Translate }) {
  const [showAll, setShowAll] = useState(false);

  const before = (log.old_values && typeof log.old_values === "object" && !Array.isArray(log.old_values))
    ? (log.old_values as Record<string, unknown>) : {};
  const after = (log.new_values && typeof log.new_values === "object" && !Array.isArray(log.new_values))
    ? (log.new_values as Record<string, unknown>) : {};

  const { changed, unchanged } = useMemo(() => {
    // An UPDATE records the whole row as it was and only the columns the write
    // set as the new state, so a key missing from `after` means "left alone",
    // not "cleared".
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !NOISE_FIELDS.has(k));
    const isCreate = Object.keys(before).length === 0;
    const c: string[] = [];
    const u: string[] = [];
    for (const key of keys.sort()) {
      const hasAfter = key in after;
      const nextValue = hasAfter ? after[key] : before[key];
      if (isCreate || (hasAfter && !sameValue(before[key], nextValue))) c.push(key);
      else u.push(key);
    }
    return { changed: c, unchanged: u };
  }, [log.audit_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueAfter = (key: string) => (key in after ? after[key] : before[key]);
  const roles: string[] = Array.isArray(log.user_roles) ? log.user_roles : [];

  return (
    <div className="space-y-4 px-4 py-4 sm:px-5" style={{ backgroundColor: "var(--surface-raised)" }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <MetaBlock label={t("auditPerformedBy")}>
          <div className="font-medium" style={{ color: "var(--text-primary)" }}>
            {log.user_name || t("auditSystemActor")}
          </div>
          {log.user_email && <div className="break-all">{log.user_email}</div>}
          <div>{roles.length > 0 ? roles.join(", ") : (log.user_type || t("auditNoRoleAssigned"))}</div>
        </MetaBlock>
        <MetaBlock label={t("auditRecord")}>
          <div className="font-medium" style={{ color: "var(--text-primary)" }}>
            {log.entity_label || log.entity_name}
          </div>
          {log.entity_code && <div className="font-mono">{log.entity_code}</div>}
          <div className="break-all font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
            {log.entity_name} · {log.entity_id}
          </div>
        </MetaBlock>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("auditChangedFields")} ({changed.length})
          </span>
          {unchanged.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-[10px] font-semibold"
              style={{ color: "var(--accent)", backgroundColor: "var(--accent-muted)" }}
            >
              {showAll ? t("auditHideUnchangedFields") : `${t("auditShowAllFields")} (${unchanged.length})`}
            </button>
          )}
        </div>

        {changed.length === 0 && unchanged.length === 0 ? (
          <div className="py-2 text-[11px]" style={{ color: "var(--text-muted)" }}>{t("auditNoFieldChanges")}</div>
        ) : (
          <>
            {changed.map((key) => (
              <DiffRow key={key} fieldKey={key} before={before[key]} after={valueAfter(key)} changed t={t} />
            ))}
            {showAll && unchanged.length > 0 && (
              <>
                <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  {t("auditUnchangedFields")}
                </div>
                {unchanged.map((key) => (
                  <DiffRow key={key} fieldKey={key} before={before[key]} after={valueAfter(key)} changed={false} t={t} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[10px]" style={{ borderColor: "var(--row-border)", color: "var(--text-muted)" }}>
        <span>{t("auditIpAddress")}: <span className="font-mono">{log.ip_address || "—"}</span></span>
        <span className="break-all">{t("auditUserAgent")}: <span className="font-mono">{log.user_agent || "—"}</span></span>
      </div>
    </div>
  );
}

export default function AuditPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    if (!token || !storedUser) { router.replace("/"); return; }
    loadAuditLogs();
  }, [router]);

  useEffect(() => {
    if (!search.trim()) { setFiltered(auditLogs); return; }
    const q = search.toLowerCase();
    setFiltered(auditLogs.filter((l) =>
      l.action?.toLowerCase().includes(q) ||
      l.entity_name?.toLowerCase().includes(q) ||
      l.entity_code?.toLowerCase().includes(q) ||
      l.entity_label?.toLowerCase().includes(q) ||
      l.user_name?.toLowerCase().includes(q) ||
      l.user_email?.toLowerCase().includes(q)
    ));
  }, [search, auditLogs]);

  const loadAuditLogs = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await api.get("/audit-log");
      setAuditLogs(list);
      setFiltered(list);
    } catch (e: any) {
      setError(e?.message || "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  };

  const actionBadge = (action: string) => {
    const act = action?.toUpperCase() || "";
    let variant: "success" | "warning" | "danger" | "info" = "info";
    if (act.includes("CREATE") || act.includes("REGISTER") || act.includes("ONBOARD") || act.includes("RESTORE")) {
      variant = "success";
    } else if (act.includes("UPDATE") || act.includes("EDIT") || act.includes("ASSIGN")) {
      variant = "warning";
    } else if (act.includes("DELETE") || act.includes("REMOVE") || act.includes("REVOKE")) {
      variant = "danger";
    }
    return (
      <Badge variant={variant} className="font-mono uppercase">
        {action}
      </Badge>
    );
  };

  if (loading) {
    return <LoadingState label={t("loadingAuditLogs")} />;
  }

  return (
    <ConsolePage>
      <PageHeader
        title={t("auditLedger")}
        description={`${auditLogs.length} events recorded`}
        actions={
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchLogs")}
              className="pl-9 sm:w-64"
            />
          </div>
        }
      />

      {error && <ErrorState message={error} />}

      {/* Table */}
      <div className="rounded-[var(--radius-md)] border overflow-x-auto" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <table className="w-full border-collapse text-sm">
          <TableHeader>
            <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
              <TableHead className="w-8 px-2" />
              {["#", "Timestamp", "Action", "Entity", "User"].map((h) => (
                <TableHead key={h} className="px-5">{h}</TableHead>
              ))}
            </tr>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <tr>
                <TableCell colSpan={6} className="px-5 text-center py-10" style={{ color: "var(--text-muted)" }}>
                  {search ? t("noResultsMatch") : t("noAuditEntriesFound")}
                </TableCell>
              </tr>
            ) : (
              filtered.map((log, idx) => {
                const key = log.audit_id || String(idx);
                const isOpen = expanded === key;
                return (
                  <React.Fragment key={key}>
                    <TableRow
                      className="cursor-pointer align-top"
                      onClick={() => setExpanded(isOpen ? null : key)}
                    >
                      <TableCell className="px-2">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? t("auditCollapseRow") : t("auditExpandRow")}
                          onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : key); }}
                          className="flex items-center justify-center rounded-[var(--radius-sm)] p-1"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </TableCell>
                      <TableCell className="px-5 font-mono" style={{ color: "var(--text-muted)" }}>{idx + 1}</TableCell>
                      <TableCell className="px-5 font-mono whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {log.created_at ? new Date(log.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                      </TableCell>
                      <TableCell className="px-5">{actionBadge(log.action)}</TableCell>
                      <TableCell className="px-5 font-medium" style={{ color: "var(--text-primary)" }}>
                        {log.entity_label || log.entity_name}
                        {log.entity_code && (
                          <span className="ml-1 font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {log.entity_code}
                          </span>
                        )}
                        <div className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {log.entity_name} ({log.entity_id?.substring(0, 8)}…)
                        </div>
                      </TableCell>
                      <TableCell className="px-5" style={{ color: "var(--text-secondary)" }}>
                        {log.user_name || t("auditSystemActor")}
                        {log.user_email && (
                          <div className="text-[10px] break-all" style={{ color: "var(--text-muted)" }}>{log.user_email}</div>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                        <td colSpan={6} className="p-0">
                          <AuditDetail log={log} t={t} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </table>
      </div>
    </ConsolePage>
  );
}
