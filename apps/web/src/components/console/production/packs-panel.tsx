"use client";

import { NA } from "@/utils/na";
import { useEffect, useState } from "react";
import { Search, Loader2, Inbox, Ban } from "lucide-react";
import QRCode from "react-qr-code";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/useLanguage";
import { Badge } from "@/components/ui/badge";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { formatQuantity } from "@/lib/utils";

const PAGE_SIZE = 25;

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

export default function PacksPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      params.set("limit", "200");
      const res = await api.get(`/qr-code?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("pkFailedToLoadPacks"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/item?${qs}&isActive=true&isBlocked=false`).then((r) => setItems((unwrap<Row[]>(r) || []).filter((i) => !i.is_blocked && i.is_active !== false))).catch(() => { });
    api.get(`/batch?${qs}`).then((r) => setBatches(unwrap<Row[]>(r) || [])).catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itemLabel = (id: string) => items.find((i) => i.item_id === id)?.item_code || NA;
  const batchLabel = (id: string) => batches.find((b) => b.batch_id === id)?.batch_no || NA;

  const filtered = search
    ? rows.filter((r) => (r.pack_no || "").toLowerCase().includes(search.toLowerCase()) || (r.lot_no || "").toLowerCase().includes(search.toLowerCase()))
    : rows;

  useEffect(() => { setPage(1); }, [search, pageSize]);
  const pagedFiltered = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleVoid = async (row: Row) => {
    if (!(await confirmAction({ title: t("cfVoidPackTitle"), message: t("pkVoidPackConfirm", { packNo: row.pack_no }), tone: "danger" }))) return;
    setVoidingId(row.qr_id);
    setError("");
    try {
      await api.post(`/qr-code/${row.qr_id}/void`, {});
      await load();
      if (viewing?.qr_id === row.qr_id) setViewing((v) => (v ? { ...v, is_voided: true } : v));
    } catch (err: any) {
      setError(err?.message || t("pkFailedToVoidPack"));
    } finally {
      setVoidingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("pkPacks")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("pkPacksDescription")}</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pkSearchPackLotPlaceholder")} className="nf-input-sm pl-8 pr-3" style={S.input} />
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      {loading ? (
        <div className="rounded-[var(--radius-md)] border py-10 text-center text-xs" style={S.surface}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("pkLoading")}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border py-10 text-center text-xs" style={{ ...S.surface, ...S.sub }}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("pkNoPacksGeneratedYet")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pagedFiltered.map((row) => (
            <button
              key={row.qr_id}
              onClick={() => setViewing(row)}
              className="flex flex-col items-start gap-2 rounded-[var(--radius-md)] border p-3 text-left transition hover:bg-(--surface-raised)"
              style={{ ...S.surface, opacity: row.is_voided ? 0.5 : 1 }}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-xs font-semibold" style={S.primary}>{row.pack_no}</span>
                {row.is_voided && <Badge variant="danger">{t("pkVoided")}</Badge>}
                {row.grade && !row.is_voided && <Badge variant="accent">{t("pkGrade", { grade: row.grade })}</Badge>}
              </div>
              <div className="flex w-full justify-center rounded-lg bg-white p-2">
                <QRCode value={JSON.stringify(row.qr_data)} size={96} />
              </div>
              <div className="w-full text-[11px]" style={S.sub}>
                <p style={S.primary}>{itemLabel(row.item_id)}</p>
                <p>{t("pkBatchLabel", { batch: batchLabel(row.batch_id) })}</p>
                <p>{formatQuantity(row.net_weight)} {row.pack_uom}{row.gross_weight ? ` ${t("pkGrossWeightSuffix", { gross: formatQuantity(row.gross_weight) })}` : ""}</p>
                <p>{row.production_date}{row.expiry_date ? ` → ${row.expiry_date}` : ""}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? t("pkPackTitle", { packNo: viewing.pack_no }) : ""}
        footer={
          viewing && !viewing.is_voided ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => viewing && handleVoid(viewing)}
              disabled={voidingId === viewing.qr_id}
              className="gap-1.5"
              style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
            >
              <Ban className="h-4 w-4" /> {voidingId === viewing.qr_id ? t("pkVoidingEllipsis") : t("pkVoidPack")}
            </Button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-[var(--radius-sm)] bg-white p-4">
              <QRCode value={JSON.stringify(viewing.qr_data)} size={200} />
            </div>
            <div className="grid w-full grid-cols-2 gap-3 text-xs">
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("pkItem")}</p><p style={S.primary}>{itemLabel(viewing.item_id)}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("pkBatch")}</p><p style={S.primary}>{batchLabel(viewing.batch_id)}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("pkLotNo")}</p><p style={S.primary}>{viewing.lot_no || NA}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("pkGradeLabel")}</p><p style={S.primary}>{viewing.grade || NA}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("pkNetGrossWeight")}</p><p style={S.primary}>{formatQuantity(viewing.net_weight)} / {viewing.gross_weight != null ? formatQuantity(viewing.gross_weight) : NA} {viewing.pack_uom}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("pkProductionExpiry")}</p><p style={S.primary}>{viewing.production_date} {viewing.expiry_date ? `→ ${viewing.expiry_date}` : ""}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("pkQcLink")}</p><p style={S.primary}>{viewing.qc_id ? t("pkLinkedResult", { result: viewing.qr_data?.qc?.overall_result || NA }) : t("pkNotLinked")}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("pkStatus")}</p><p style={viewing.is_voided ? { color: "var(--danger)" } : { color: "var(--success)" }}>{viewing.is_voided ? t("pkVoided2") : t("pkActive")}</p></div>
            </div>
            {viewing.origin_batch_chain && (
              <div className="w-full">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("pkOriginChain")}</p>
                <pre className="overflow-x-auto rounded-[var(--radius-sm)] border p-3 text-[10px]" style={S.surface}>{JSON.stringify(viewing.origin_batch_chain, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
