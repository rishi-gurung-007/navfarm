"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Search, Loader2, Inbox, Eye, CheckCircle2 } from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";

const PAGE_SIZE = 25;

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const emptyLine = () => ({ gl_account_id: "", debit_amount: "", credit_amount: "", description: "" });

const STATUS_VARIANT: Record<string, "neutral" | "success" | "danger"> = {
  DRAFT: "neutral",
  POSTED: "success",
  CANCELLED: "danger",
};

export default function JournalPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [glAccounts, setGlAccounts] = useState<Row[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [header, setHeader] = useState<Row>({ posting_date: "", description: "" });
  const [lines, setLines] = useState<Row[]>([emptyLine(), emptyLine()]);

  const [viewing, setViewing] = useState<Row | null>(null);
  const [posting, setPosting] = useState(false);

  const companyId = getActiveCompanyId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "200");
      const res = await api.get(`/journal?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("jpFailedToLoadJournalEntries"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    api.get(`/gl-account?${params.toString()}`).then((r) => setGlAccounts(unwrap<Row[]>(r) || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setHeader({ posting_date: new Date().toISOString().slice(0, 10), description: "" });
    setLines([emptyLine(), emptyLine()]);
    setFormError("");
    setModalOpen(true);
  };

  const setLineField = (idx: number, key: string, value: any) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const lineTotals = lines.reduce(
    (acc, l) => ({ debit: acc.debit + (Number(l.debit_amount) || 0), credit: acc.credit + (Number(l.credit_amount) || 0) }),
    { debit: 0, credit: 0 }
  );
  const isBalanced = Math.abs(lineTotals.debit - lineTotals.credit) < 0.0001 && lineTotals.debit > 0;

  const handleSave = async () => {
    setSaving(true);
    setFormError("");
    try {
      if (!header.posting_date) throw new Error(t("jpPostingDateRequired"));
      const cleanLines = lines
        .filter((l) => l.gl_account_id && (Number(l.debit_amount) || Number(l.credit_amount)))
        .map((l) => ({
          gl_account_id: l.gl_account_id,
          debit_amount: Number(l.debit_amount) || 0,
          credit_amount: Number(l.credit_amount) || 0,
          description: l.description || undefined,
        }));
      if (cleanLines.length < 2) throw new Error(t("jpAddAtLeastTwoLines"));

      await api.post("/journal", {
        company_id: companyId,
        posting_date: header.posting_date,
        description: header.description || undefined,
        lines: cleanLines,
      });
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("jpFailedToSaveJournalEntry"));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (row: Row) => {
    try {
      const res = await api.get(`/journal/${row.journal_id}`);
      setViewing(unwrap<Row>(res));
    } catch (err: any) {
      setError(err?.message || t("jpFailedToLoadJournalEntryDetails"));
    }
  };

  const handlePost = async () => {
    if (!viewing) return;
    setPosting(true);
    try {
      const res = await api.post(`/journal/${viewing.journal_id}/post`, {});
      setViewing(unwrap<Row>(res));
      load();
    } catch (err: any) {
      setError(err?.message || t("jpFailedToPostJournalEntry"));
    } finally {
      setPosting(false);
    }
  };

  const accountLabel = (id: string) => {
    const acc = glAccounts.find((a) => a.gl_account_id === id);
    return acc ? `${acc.account_code} — ${acc.account_name}` : "—";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("jpJournalEntries")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("jpJournalEntriesDescription")}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t("jpFilterByStatus")}
            className="h-9 w-full min-w-0 text-[13px] sm:w-auto sm:min-w-[9.5rem]"
          >
            <option value="">{t("jpAllStatuses")}</option>
            <option value="DRAFT">{t("jpDraft")}</option>
            <option value="POSTED">{t("jpPosted")}</option>
            <option value="CANCELLED">{t("jpCancelled")}</option>
          </Select>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("jpSearchPlaceholder")}
              aria-label={t("jpSearchJournalEntries")}
              className="h-9 w-full pl-8 text-[13px] sm:w-44"
            />
          </div>
          <Button onClick={openCreate} size="sm" className="shrink-0">
            <Plus className="h-3.5 w-3.5" /> {t("jpNewJournalEntry")}
          </Button>
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                <TableHead className="whitespace-nowrap">{t("jpJournalNo")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("jpPostingDate")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("jpSource")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("jpDebit")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("jpCredit")}</TableHead>
                <TableHead className="text-right">{t("jpStatus")}</TableHead>
                <TableHead className="text-right">{t("jpActions")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={7} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("jpLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={7} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("jpNoJournalEntriesYet")}</TableCell></tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.journal_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{row.journal_no}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{row.posting_date}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.source}{row.source_document_no ? ` · ${row.source_document_no}` : ""}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{row.total_debit}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{row.total_credit}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={STATUS_VARIANT[row.status] || "neutral"}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <button onClick={() => openView(row)} title={t("jpView")} className="rounded-lg p-1.5 transition hover:bg-[var(--surface-raised)]" style={S.sub}>
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <div className="border-t px-2" style={{ borderColor: "var(--border)" }}>
            <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </div>

      {/* Create modal */}
      <Dialog
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={t("jpNewJournalEntry")}
        maxWidth="xl"
        footer={
          <Button onClick={handleSave} disabled={saving} >
            {saving ? t("jpSaving") : t("jpSaveDraft")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <InlineAlert>{formError}</InlineAlert>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("jpPostingDate")} <span style={{ color: "var(--danger)" }}>*</span></label>
              <input type="date" value={header.posting_date} onChange={(e) => setHeader((h) => ({ ...h, posting_date: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("jpDescription")}</label>
              <input value={header.description} onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))} className={inputCls} style={S.input} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("jpLines")}</p>
            <button onClick={addLine} type="button" className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={S.surface}>
              <Plus className="h-3 w-3" /> {t("jpAddLine")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                  <TableHead className="h-auto px-3 py-2">{t("jpGlAccount")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("jpDebit")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("jpCredit")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("jpDescription")}</TableHead>
                  <TableHead className="h-auto px-3 py-2"></TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {lines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="px-2 py-1.5">
                      <select value={line.gl_account_id} onChange={(e) => setLineField(idx, "gl_account_id", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("jpSelectPlaceholder")}</option>
                        {glAccounts.map((a) => <option key={a.gl_account_id} value={a.gl_account_id}>{a.account_code} — {a.account_name}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-28"><input type="number" value={line.debit_amount} onChange={(e) => setLineField(idx, "debit_amount", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                    <TableCell className="px-2 py-1.5 w-28"><input type="number" value={line.credit_amount} onChange={(e) => setLineField(idx, "credit_amount", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                    <TableCell className="px-2 py-1.5"><input value={line.description} onChange={(e) => setLineField(idx, "description", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                    <TableCell className="px-2 py-1.5">
                      <button onClick={() => removeLine(idx)} type="button" className="rounded-[var(--radius-xs)] p-1 transition hover:bg-[var(--danger-muted)]" style={{ color: "var(--danger)" }}><Trash2 className="h-3.5 w-3.5" /></button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <tr>
                  <TableCell className="px-3 py-2" style={S.sub}>{t("jpTotal")}</TableCell>
                  <TableCell className="px-3 py-2" style={S.primary}>{lineTotals.debit.toFixed(2)}</TableCell>
                  <TableCell className="px-3 py-2" style={S.primary}>{lineTotals.credit.toFixed(2)}</TableCell>
                  <TableCell colSpan={2} className="px-3 py-2">
                    <span className="text-[11px] font-semibold" style={{ color: isBalanced ? "var(--success)" : "var(--danger)" }}>
                      {isBalanced ? t("jpBalanced") : t("jpNotBalanced")}
                    </span>
                  </TableCell>
                </tr>
              </TableFooter>
            </table>
          </div>
        </div>
      </Dialog>

      {/* View / Post modal */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? t("jpJournalEntryTitle", { journalNo: viewing.journal_no }) : ""}
        maxWidth="xl"
        footer={
          viewing?.status === "DRAFT" ? (
            <button onClick={handlePost} disabled={posting} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--success)" }}>
              <CheckCircle2 className="h-4 w-4" /> {posting ? t("jpPosting") : t("jpPost")}
            </button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("jpStatus")}</p><Badge variant={STATUS_VARIANT[viewing.status] || "neutral"} className="mt-1">{viewing.status}</Badge></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("jpPostingDate")}</p><p style={S.primary}>{viewing.posting_date}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("jpSource")}</p><p style={S.primary}>{viewing.source}</p></div>
              {viewing.source_document_no && <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("jpSourceDocument")}</p><p style={S.primary}>{viewing.source_document_no}</p></div>}
            </div>

            <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader>
                  <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                    <TableHead className="h-auto px-3 py-2">{t("jpGlAccount")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("jpDebit")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("jpCredit")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("jpDescription")}</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {(viewing.lines || []).map((l: Row) => (
                    <TableRow key={l.line_id}>
                      <TableCell className="px-3 py-2" style={S.primary}>{accountLabel(l.gl_account_id)}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{Number(l.debit_amount) > 0 ? l.debit_amount : "—"}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{Number(l.credit_amount) > 0 ? l.credit_amount : "—"}</TableCell>
                      <TableCell className="px-3 py-2" style={S.sub}>{l.description || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
