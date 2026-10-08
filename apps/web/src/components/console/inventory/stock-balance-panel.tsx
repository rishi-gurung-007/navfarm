"use client";

import { useEffect, useState } from "react";
import { Loader2, Inbox, AlertTriangle } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { Dialog } from "@/components/ui/dialog";
import ItemLedgerHistoryCard from "./item-ledger-history-card";
import InventoryLedgerDetail from "./inventory-ledger-detail";

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  danger: { color: "var(--danger)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input-sm";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function StockBalancePanel() {
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [belowReorderOnly, setBelowReorderOnly] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Row | null>(null);
  const [viewingLedgerEntry, setViewingLedgerEntry] = useState<Row | null>(null);

  const companyId = getActiveCompanyId();

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("companyId", companyId);
      if (itemId) params.set("itemId", itemId);
      if (warehouseId) params.set("warehouseId", warehouseId);
      if (belowReorderOnly) params.set("belowReorderOnly", "true");
      const res = await api.get(`/inventory-ledger/balance?${params.toString()}`);
      const apiRows = unwrap<Row[]>(res) || [];
      setRows(apiRows);
    } catch (err: any) {
      setError(err?.message || t("sbpFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [itemId, warehouseId, belowReorderOnly]);

  useEffect(() => {
    if (!companyId) return;
    const params = new URLSearchParams({ companyId, limit: "500" });
    api.get(`/item?${params.toString()}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => undefined);
    api.get(`/warehouse?companyId=${companyId}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch(() => undefined);
  }, [companyId]);

  const totalValue = rows.reduce((sum, r) => sum + Number(r.on_hand_value || 0), 0);
  const belowReorderCount = rows.filter((r) => r.reorder_level != null && r.on_hand_qty <= r.reorder_level).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold" style={S.primary}>{t("sbpTitle")}</h2>
        <p className="mt-0.5 text-xs" style={S.sub}>{t("sbpDescription")}</p>
      </div>

      {/* Summary figures read as a single line of related numbers; three
          bordered boxes would imply they are independent modules. */}
      <dl className="flex flex-wrap gap-x-10 gap-y-4 border-y py-4" style={{ borderColor: "var(--border)" }}>
        <div>
          <dt className="nf-text-caption">{t("sbpItemWarehouseLines")}</dt>
          <dd className="mt-0.5 text-xl font-semibold" style={S.primary}>{rows.length}</dd>
        </div>
        <div>
          <dt className="nf-text-caption">{t("sbpTotalOnHandValue")}</dt>
          <dd className="mt-0.5 text-xl font-semibold" style={S.primary}>{formatMoney(fmt(totalValue))}</dd>
        </div>
        <div>
          <dt className="nf-text-caption">{t("sbpAtBelowReorderLevel")}</dt>
          <dd className="mt-0.5 text-xl font-semibold" style={belowReorderCount > 0 ? S.danger : S.primary}>{belowReorderCount}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
          <option value="">{t("sbpAllItemsWithCount", { count: items.length })}</option>
          {items.map((it, idx) => (
            <option key={it.item_id} value={it.item_id}>
              {idx + 1}. {it.item_code} — {it.item_name}
            </option>
          ))}
        </select>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
          <option value="">{t("sbpAllWarehouses")}</option>
          {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code} — {w.warehouse_name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs font-medium" style={S.sub}>
          <input type="checkbox" checked={belowReorderOnly} onChange={(e) => setBelowReorderOnly(e.target.checked)} />
          {t("sbpAtBelowReorderLevelOnly")}
        </label>
      </div>

      {error && (
        <InlineAlert>{error}</InlineAlert>
      )}

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap">{t("sbpColItem")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sbpColWarehouse")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("sbpColOnHand")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sbpColUom")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("sbpColValue")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("sbpColReorderLevel")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sbpColStatus")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={7} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("sbpLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={7} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("sbpNoStockOnHand")}</TableCell></tr>
              ) : (
                rows.map((row) => {
                  const belowReorder = row.reorder_level != null && row.on_hand_qty <= row.reorder_level;
                  return (
                    <TableRow 
                      key={`${row.item_id}-${row.warehouse_id}`}
                      onClick={() => setSelectedItem(row)}
                      className="cursor-pointer hover:bg-[var(--surface-raised)] transition"
                      title="Click to view purchase and consumption ledger history"
                    >
                      <TableCell className="whitespace-nowrap font-medium" style={S.primary}>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-bold text-[var(--accent)] hover:underline">
                            {row.item_code}
                          </span>
                          <span className="truncate max-w-[280px] text-xs" style={S.sub} title={row.item_description}>
                            {row.item_description}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs" style={S.sub}>
                        {row.warehouse_code ? `${row.warehouse_code} — ${row.warehouse_name}` : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono font-semibold" style={S.primary}>
                        {fmt(row.on_hand_qty)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs" style={S.sub}>{row.uom}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs font-semibold" style={S.primary}>
                        {formatMoney(fmt(row.on_hand_value))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs" style={S.sub}>
                        {row.reorder_level != null ? fmt(row.reorder_level) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {belowReorder ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "var(--danger-muted, #fee2e2)", color: "var(--danger)" }}>
                            <AlertTriangle className="h-3 w-3" /> {t("sbpReorder")}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium" style={S.muted}>{t("sbpOk")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </table>
        </div>
      </div>

      {/* Item Stock & Purchase/Consumption Ledger History Card Dialog */}
      <Dialog
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        title={selectedItem ? `Item Stock & Ledger History — ${selectedItem.item_code}` : ""}
        maxWidth="xl"
      >
        {selectedItem && (
          <div className="py-1">
            <ItemLedgerHistoryCard
              itemId={selectedItem.item_id}
              companyId={companyId}
              onClose={() => setSelectedItem(null)}
              onViewLedgerEntry={(entry) => setViewingLedgerEntry(entry)}
            />
          </div>
        )}
      </Dialog>

      {/* Single Ledger Entry Detail Dialog */}
      <Dialog
        open={Boolean(viewingLedgerEntry)}
        onClose={() => setViewingLedgerEntry(null)}
        title={viewingLedgerEntry ? `Inventory Ledger Entry — ${viewingLedgerEntry.document_no}` : ""}
        maxWidth="xl"
      >
        {viewingLedgerEntry && (
          <div className="py-1">
            <InventoryLedgerDetail
              ledgerId={viewingLedgerEntry.ledger_id}
              initialData={viewingLedgerEntry}
              onClose={() => setViewingLedgerEntry(null)}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
