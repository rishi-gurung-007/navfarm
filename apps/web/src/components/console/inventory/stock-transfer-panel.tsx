"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Trash2,
  Search,
  Loader2,
  Inbox,
  Eye,
  ArrowRight,
  Truck,
  PackageCheck,
  Building2,
  Calendar,
  Layers,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Barcode,
  Save,
  Copy,
  Check,
  History,
} from "lucide-react";
import { api } from "@/services/api-client";
import { useLanguage } from "@/hooks/useLanguage";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId, getActiveFarmId, getStoredUser, hasPermission } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { LotSerialPicker } from "@/components/ui/lot-serial-picker";
import ReceiveStockPanel from "./receive-stock-panel";
import { transferStatusText } from "./stock-transfer-status";

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


function parseRemarksHelper(remarks?: string | null): (Record<string, string> & { raw?: string }) | null {
  if (!remarks) return null;
  const parts = (remarks as string).split(" | ");
  if (parts.length <= 1) return { raw: remarks };
  const meta: Record<string, string> = {};
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx !== -1) {
      let key = part.slice(0, idx).trim();
      if (key === "Exp. Arrival") key = "Expected Delivery";
      meta[key] = part.slice(idx + 1).trim();
    } else {
      meta["Notes"] = part;
    }
  }
  return meta;
}



interface TransferHeaderState {
  from_warehouse_id: string;
  to_warehouse_id: string;
  posting_date: string;
  transfer_purpose: string;
  transport_mode: string;
  vehicle_no: string;
  driver_name: string;
  waybill_ref: string;
  remarks: string;
}

interface TransferLineState {
  line_id?: string;
  item_id: string;
  quantity: string;
  qty_to_ship?: string;
  qty_shipped?: number | string;
  qty_to_receive?: number | string;
  qty_received?: number | string;
  qty_in_transit?: number | string;
  doa_quantity?: number | string;
  doa_remarks?: string;
  uom: string;
  lot_no: string;
  serial_no: string;
  shipment_date: string;
  receipt_date: string;
  maxQty?: number;
  remarks: string;
}

const defaultHeader = (): TransferHeaderState => ({
  from_warehouse_id: "",
  to_warehouse_id: "",
  posting_date: new Date().toISOString().slice(0, 10),
  transfer_purpose: "",
  transport_mode: "INTERNAL_FLEET",
  vehicle_no: "",
  driver_name: "",
  waybill_ref: "",
  remarks: "",
});

const emptyLine = (defaultShipDate?: string, defaultReceiptDate?: string): TransferLineState => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    item_id: "",
    quantity: "",
    qty_to_ship: "",
    qty_shipped: "0",
    qty_to_receive: 0,
    qty_received: 0,
    qty_in_transit: 0,
    doa_quantity: 0,
    doa_remarks: "",
    uom: "",
    lot_no: "",
    serial_no: "",
    shipment_date: defaultShipDate || today,
    receipt_date: defaultReceiptDate || today,
    maxQty: undefined,
    remarks: "",
  };
};

const TRANSPORT_MODE_OPTIONS = [
  { value: "INTERNAL_FLEET", label: "Internal Farm Fleet" },
  { value: "DEDICATED_TRUCK", label: "Dedicated Logistics Truck" },
  { value: "CARRIER_COURIER", label: "Third-Party Logistics / Carrier" },
  { value: "DIRECT_HANDOVER", label: "Direct Handover / Forklift" },
];

export default function StockTransferPanel() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<"transfers" | "receive">("transfers");

  const searchParams = useSearchParams();
  const deepLinkId = searchParams?.get("id") ?? "";
  const deepLinkOpened = useRef("");
  const notAvailable = t("stpNotAvailable") || "Not available";
  const statusLabel = (status: string | null | undefined) => transferStatusText(status, t);
  const STATUS_LABEL: Record<string, string> = {
    DRAFT: statusLabel("DRAFT"),
    IN_TRANSIT: statusLabel("IN_TRANSIT"),
    PARTIALLY_RECEIVED: statusLabel("PARTIALLY_RECEIVED"),
    RECEIVED: "Received",
    POSTED: statusLabel("POSTED"),
    CANCELLED: statusLabel("CANCELLED"),
  };

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const storeWarehouses = useMemo(() => warehouses.filter((w) => w.location_type === "STORE"), [warehouses]);
  const [farms, setFarms] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [uoms, setUoms] = useState<Row[]>([]);

  // Source warehouse live balances: item_id -> { on_hand_qty, on_hand_value, avg_cost, uom }
  const [sourceBalances, setSourceBalances] = useState<
    Record<string, { on_hand_qty: number; on_hand_value: number; avg_cost: number; uom: string }>
  >({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Toggle to filter item picker strictly to available on-hand stock
  const [onlyAvailableStock, setOnlyAvailableStock] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingAndShipping, setSavingAndShipping] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState("");
  const [header, setHeader] = useState<TransferHeaderState>(defaultHeader());
  const [lines, setLines] = useState<TransferLineState[]>([emptyLine()]);

  // Item Tracking Lines Modal state (BC standard tracking action)
  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [trackingLineIdx, setTrackingLineIdx] = useState<number | null>(null);

  // Location prefill and lock state
  const [isFromLocationLocked, setIsFromLocationLocked] = useState(false);

  // Inbound receipt state (used when receiving stock on the document card)
  const [receivePostingDate, setReceivePostingDate] = useState("");
  const [receiveRemarks, setReceiveRemarks] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Item tracking inspection search filter & copy state
  const [trackingSearch, setTrackingSearch] = useState("");
  const [copiedTracking, setCopiedTracking] = useState(false);

  // In-transit discrepancy resolution modal state
  const [discrepancyModalOpen, setDiscrepancyModalOpen] = useState(false);
  const [discrepancyType, setDiscrepancyType] = useState<"WRITE_OFF" | "RETURN">("WRITE_OFF");
  const [discrepancyReason, setDiscrepancyReason] = useState("");
  const [resolvingDiscrepancy, setResolvingDiscrepancy] = useState(false);

  const [users, setUsers] = useState<Row[]>([]);
  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (directionFilter && directionFilter !== "ALL") {
        params.set("direction", directionFilter);
      } else {
        params.set("direction", "ALL");
      }
      params.set("limit", "200");
      const res = await api.get(`/stock-transfer?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("stpFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [search, statusFilter, directionFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, directionFilter, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/warehouse?${qs}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch(() => {
      // ignore
    });
    api.get(`/location?locationType=FARM&rootOnly=true&isActive=true`).then((r) => setFarms(unwrap<Row[]>(r) || [])).catch(() => {
      // ignore
    });
    api.get(`/item?${qs}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => {
      // ignore
    });
    api.get(`/uom?${qs}`).then((r) => setUoms(unwrap<Row[]>(r) || [])).catch(() => {
      // ignore
    });
    api.get(`/user?limit=500`).then((r) => setUsers(unwrap<Row[]>(r) || [])).catch(() => {
      // ignore
    });
  }, []);

  // Fetch live on-hand balance for source warehouse
  const loadSourceBalances = useCallback(
    async (warehouseId: string) => {
      if (!warehouseId || !companyId) {
        setSourceBalances({});
        return;
      }
      setLoadingBalances(true);
      try {
        const res = await api.get(
          `/inventory-ledger/balance?companyId=${companyId}&warehouseId=${warehouseId}`
        );
        const data = unwrap<any[]>(res) || [];
        const map: Record<string, { on_hand_qty: number; on_hand_value: number; avg_cost: number; uom: string }> = {};
        for (const row of data) {
          if (row.item_id) {
            const qty = Number(row.on_hand_qty) || 0;
            const val = Number(row.on_hand_value) || 0;
            map[row.item_id] = {
              on_hand_qty: qty,
              on_hand_value: val,
              avg_cost: qty > 0 ? val / qty : 0,
              uom: row.uom || "",
            };
          }
        }
        setSourceBalances(map);
      } catch {
        setSourceBalances({});
      } finally {
        setLoadingBalances(false);
      }
    },
    [companyId]
  );

  // Load balances whenever modal opens or source warehouse changes
  useEffect(() => {
    if (modalOpen && header.from_warehouse_id) {
      loadSourceBalances(header.from_warehouse_id);
    }
  }, [modalOpen, header.from_warehouse_id, loadSourceBalances]);

  // If storeWarehouses finishes loading while create modal is open with empty source, auto-lock and load
  useEffect(() => {
    if (modalOpen && !editingTransfer && !header.from_warehouse_id && storeWarehouses.length > 0) {
      const activeFarmId = getActiveFarmId();
      const matchingStore = activeFarmId
        ? storeWarehouses.find(
            (w) =>
              w.farm_id === activeFarmId ||
              w.parent_location_id === activeFarmId ||
              w.warehouse_id === activeFarmId ||
              w.location_id === activeFarmId
          )
        : null;
      if (matchingStore) {
        setHeader((prev) => ({ ...prev, from_warehouse_id: matchingStore.warehouse_id }));
        setIsFromLocationLocked(true);
        loadSourceBalances(matchingStore.warehouse_id);
      }
    }
  }, [modalOpen, editingTransfer, header.from_warehouse_id, storeWarehouses, loadSourceBalances]);

  const [selectedLineIdx, setSelectedLineIdx] = useState<number>(0);

  const openCreate = () => {
    setEditingTransfer(null);
    const initHeader = defaultHeader();
    const activeFarmId = getActiveFarmId();
    const matchingStore = activeFarmId
      ? storeWarehouses.find(
          (w) =>
            w.farm_id === activeFarmId ||
            w.parent_location_id === activeFarmId ||
            w.warehouse_id === activeFarmId ||
            w.location_id === activeFarmId
        )
      : null;

    if (matchingStore) {
      initHeader.from_warehouse_id = matchingStore.warehouse_id;
      setIsFromLocationLocked(true);
    } else {
      initHeader.from_warehouse_id = "";
      setIsFromLocationLocked(false);
    }

    setHeader(initHeader);
    setLines([emptyLine(initHeader.posting_date, initHeader.posting_date)]);
    setSelectedLineIdx(0);
    setOnlyAvailableStock(true);
    setFormError("");
    setTrackingModalOpen(false);
    setTrackingLineIdx(null);
    setReceivePostingDate(new Date().toISOString().slice(0, 10));
    setReceiveRemarks("");
    setModalOpen(true);

    if (initHeader.from_warehouse_id) {
      loadSourceBalances(initHeader.from_warehouse_id);
    } else {
      setSourceBalances({});
    }
  };

  const handleOpenItemTracking = (idx: number) => {
    setSelectedLineIdx(idx);
    const line = lines[idx];
    if (!line || !line.item_id) {
      showToast.warn(`Please select an item for Line #${idx + 1} before opening Item Tracking.`);
      return;
    }
    const it = items.find((i) => i.item_id === line.item_id);
    const isTracked = Boolean(it?.is_lot_tracked || it?.is_serial_tracked || line.lot_no || line.serial_no);
    if (!isTracked) {
      showToast.info(
        `Item Tracking is not active for item "${it?.item_code || line.item_id} — ${it?.item_name || ""}". This item is not configured for lot or serial tracking.`
      );
      return;
    }
    setFormError("");
    setTrackingSearch("");
    setTrackingLineIdx(idx);
    setTrackingModalOpen(true);
  };

  const setLineField = (idx: number, key: keyof TransferLineState, value: any) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (key === "item_id") {
          const it = items.find((item) => item.item_id === value);
          const bal = sourceBalances[value];
          const initialQty = it?.is_serial_tracked ? "1" : l.quantity;
          return {
            ...l,
            item_id: value,
            uom: bal?.uom || it?.uom_primary || it?.uom || l.uom,
            lot_no: "",
            serial_no: "",
            maxQty: bal ? bal.on_hand_qty : undefined,
            quantity: initialQty,
            qty_to_ship: initialQty,
            qty_shipped: "0",
          };
        }
        if (key === "quantity") {
          let nextShipped = l.qty_shipped;
          const newOrdered = Number(value) || 0;
          if (nextShipped !== undefined && nextShipped !== "" && !isNaN(Number(nextShipped))) {
            const shippedNum = Number(nextShipped);
            if (shippedNum > newOrdered) {
              nextShipped = value !== "" ? String(newOrdered) : "0";
            }
          }
          return {
            ...l,
            quantity: value,
            qty_to_ship: value,
            qty_shipped: nextShipped,
          };
        }
        if (key === "qty_to_ship") {
          const ordered = Number(l.quantity) || 0;
          const shipped = Number(l.qty_shipped || 0);
          const maxAllowed = editingTransfer ? Math.max(0, ordered - shipped) : ordered;
          let clampedVal = value;
          if (value !== "" && !isNaN(Number(value))) {
            const num = Number(value);
            if (num < 0) {
              clampedVal = "0";
            } else if (maxAllowed > 0 && num > maxAllowed) {
              clampedVal = String(maxAllowed);
            }
          }
          return {
            ...l,
            qty_to_ship: clampedVal,
          };
        }
        if (key === "qty_to_receive") {
          const inTransit = Number(l.qty_in_transit) || 0;
          let clampedVal = value;
          if (value !== "" && !isNaN(Number(value))) {
            const num = Number(value);
            if (num < 0) {
              clampedVal = 0;
            } else if (inTransit > 0 && num > inTransit) {
              clampedVal = inTransit;
            }
          }
          return {
            ...l,
            qty_to_receive: clampedVal,
          };
        }
        if (key === "doa_quantity") {
          const inTransit = Number(l.qty_in_transit) || 0;
          let clampedVal = value;
          if (value !== "" && !isNaN(Number(value))) {
            const num = Number(value);
            if (num < 0) {
              clampedVal = 0;
            } else if (inTransit > 0 && num > inTransit) {
              clampedVal = inTransit;
            }
          }
          return {
            ...l,
            doa_quantity: clampedVal,
          };
        }
        if (key === "qty_shipped") {
          const ordered = Number(l.quantity) || 0;
          let clampedVal = value;
          if (value !== "" && !isNaN(Number(value))) {
            const num = Number(value);
            if (num < 0) {
              clampedVal = "0";
            } else if (num > ordered) {
              clampedVal = String(ordered);
            }
          }
          return {
            ...l,
            qty_shipped: clampedVal,
          };
        }
        return { ...l, [key]: value };
      })
    );
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine(header.posting_date, header.posting_date)]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSave = async (shipImmediately = false) => {
    setSaving(true);
    setSavingAndShipping(shipImmediately);
    setFormError("");
    try {
      if (!header.from_warehouse_id) throw new Error(t("stpSourceWarehouseRequired") || "Transfer-from Location is required.");
      if (!header.to_warehouse_id) throw new Error(t("stpDestinationWarehouseRequired") || "Transfer-to Location is required.");
      if (header.from_warehouse_id === header.to_warehouse_id)
        throw new Error(t("stpSourceDestMustDiffer") || "Transfer-from and Transfer-to locations must be different.");
      if (!header.posting_date) throw new Error(t("stpPostingDateRequired") || "Posting date is required.");

      const cleanLines = lines
        .filter((l) => l.item_id && l.quantity && l.uom)
        .map((l) => {
          const it = items.find((i) => i.item_id === l.item_id);
          if (it?.is_lot_tracked && !l.lot_no) {
            throw new Error(`Item Tracking: Lot number is required for lot-tracked item "${it.item_code} — ${it.item_name}". Click "Assign Lot #" to select a lot.`);
          }
          if (it?.is_serial_tracked) {
            if (!l.serial_no) {
              throw new Error(`Item Tracking: Serial number is required for serial-tracked item "${it.item_code} — ${it.item_name}". Click "Item Tracking Lines" to select serial numbers.`);
            }
            const assignedCount = l.serial_no.split(",").map((s) => s.trim()).filter(Boolean).length;
            if (assignedCount !== Number(l.quantity)) {
              throw new Error(
                `Item Tracking: Line for "${it.item_code}" has quantity ${l.quantity}, but ${assignedCount} serial ${assignedCount === 1 ? "number is" : "numbers are"} selected. Each serial number represents 1 unit.`
              );
            }
          }
          if (l.maxQty !== undefined && Number(l.quantity) > Number(l.maxQty)) {
            throw new Error(
              `Quantity ${l.quantity} for "${it?.item_code || l.item_id}" exceeds available stock (${l.maxQty} ${l.uom}).`
            );
          }
          const noteParts: string[] = [];
          if (l.shipment_date) noteParts.push(`Ship Date: ${l.shipment_date}`);
          if (l.receipt_date) noteParts.push(`Receipt Date: ${l.receipt_date}`);
          if (l.remarks?.trim()) noteParts.push(l.remarks.trim());

          const effectiveShipQty =
            l.qty_to_ship !== undefined && l.qty_to_ship !== ""
              ? Number(l.qty_to_ship)
              : Number(l.quantity);

          const unitRate = sourceBalances[l.item_id]?.avg_cost || 0;
          const lineValue = Number(l.quantity) * unitRate;

          return {
            item_id: l.item_id,
            quantity: Number(l.quantity),
            qty_to_ship: effectiveShipQty,
            maxQty: l.maxQty,
            uom: l.uom,
            lot_no: l.lot_no || undefined,
            serial_no: l.serial_no || undefined,
            shipment_date: l.shipment_date || undefined,
            receipt_date: l.receipt_date || undefined,
            unit_cost: unitRate > 0 ? unitRate : undefined,
            amount: lineValue > 0 ? lineValue : undefined,
            remarks: noteParts.length > 0 ? noteParts.join(" | ") : undefined,
          };
        });

      if (cleanLines.length === 0) throw new Error(t("stpAddAtLeastOneLine") || "Please add at least one line item.");

      if (shipImmediately) {
        const hasValidShipQty = cleanLines.some((l) => l.qty_to_ship > 0);
        if (!hasValidShipQty) {
          throw new Error("Please specify a Quantity to Ship greater than 0 on at least one line.");
        }
        for (const l of cleanLines) {
          if (l.qty_to_ship < 0) {
            throw new Error(`Quantity to Ship cannot be negative.`);
          }
          if (l.qty_to_ship > l.quantity + 0.0001) {
            const it = items.find((i) => i.item_id === l.item_id);
            throw new Error(
              `Quantity to Ship (${l.qty_to_ship}) cannot exceed Ordered Quantity (${l.quantity}) for "${it?.item_code || l.item_id}".`
            );
          }
          if (l.maxQty !== undefined && l.qty_to_ship > Number(l.maxQty) + 0.0001) {
            const it = items.find((i) => i.item_id === l.item_id);
            throw new Error(
              `Quantity to Ship (${l.qty_to_ship}) exceeds available stock (${l.maxQty} ${l.uom}) for "${it?.item_code || l.item_id}".`
            );
          }
        }
      }

      // Encode logistics and standard metadata into structured remarks
      const logisticsParts: string[] = [];
      if (header.transfer_purpose?.trim()) {
        logisticsParts.push(`Purpose: ${header.transfer_purpose.trim()}`);
      }
      if (header.transport_mode) {
        const mMatch = TRANSPORT_MODE_OPTIONS.find((m) => m.value === header.transport_mode);
        logisticsParts.push(`Mode: ${mMatch?.label || header.transport_mode}`);
      }
      if (header.vehicle_no.trim()) logisticsParts.push(`Vehicle: ${header.vehicle_no.trim()}`);
      if (header.driver_name.trim()) logisticsParts.push(`Driver: ${header.driver_name.trim()}`);
      if (header.waybill_ref.trim()) logisticsParts.push(`Waybill: ${header.waybill_ref.trim()}`);
      if (header.remarks.trim()) logisticsParts.push(`Notes: ${header.remarks.trim()}`);
      const finalRemarks = logisticsParts.join(" | ");

      const res = await api.post("/stock-transfer", {
        company_id: companyId,
        from_warehouse_id: header.from_warehouse_id,
        to_warehouse_id: header.to_warehouse_id,
        posting_date: header.posting_date,
        remarks: finalRemarks || undefined,
        lines: cleanLines.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          uom: l.uom,
          lot_no: l.lot_no,
          serial_no: l.serial_no,
          shipment_date: l.shipment_date,
          receipt_date: l.receipt_date,
          unit_cost: l.unit_cost,
          amount: l.amount,
          remarks: l.remarks,
        })),
      });

      const created = unwrap<any>(res);

      if (shipImmediately && created?.transfer_id) {
        const shipLinesPayload = (created.lines || cleanLines)
          .map((createdLine: any, idx: number) => {
            const orig = cleanLines[idx] || cleanLines.find((cl: any) => cl.item_id === createdLine.item_id);
            const shipQty = orig?.qty_to_ship !== undefined ? orig.qty_to_ship : Number(createdLine.quantity);
            let serialToShip = orig?.serial_no || createdLine.serial_no || undefined;
            if (serialToShip && shipQty > 0) {
              const allSerials = serialToShip.split(",").map((s: string) => s.trim()).filter(Boolean);
              if (allSerials.length > shipQty) {
                serialToShip = allSerials.slice(0, shipQty).join(", ");
              }
            }
            return {
              line_id: createdLine.line_id || undefined,
              item_id: createdLine.item_id,
              quantity: shipQty,
              uom: createdLine.uom,
              lot_no: orig?.lot_no || createdLine.lot_no || undefined,
              serial_no: serialToShip,
              shipment_date: orig?.shipment_date || undefined,
              receipt_date: orig?.receipt_date || undefined,
            };
          })
          .filter((l: any) => l.quantity > 0);

        if (shipLinesPayload.length > 0) {
          await api.post(`/stock-transfer/${created.transfer_id}/ship`, {
            posting_date: header.posting_date || undefined,
            vehicle_no: header.vehicle_no.trim() || undefined,
            driver_name: header.driver_name.trim() || undefined,
            waybill_ref: header.waybill_ref.trim() || undefined,
            remarks: header.remarks.trim() || undefined,
            lines: shipLinesPayload,
          });
        }
      }

      const orderNo = created?.transfer_no || (created?.transfer_id ? `TR-${created.transfer_id.slice(0, 8)}` : "");
      const msg = shipImmediately
        ? `Transfer Order ${orderNo} created and dispatched successfully.`
        : `Transfer Order ${orderNo} created successfully.`;
      showToast.success(msg);
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(""), 5000);

      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("stpFailedToSave"));
    } finally {
      setSaving(false);
      setSavingAndShipping(false);
    }
  };

  const openOrder = async (row: Row) => {
    setFormError("");
    setLoading(true);
    try {
      const res = await api.get(`/stock-transfer/${row.transfer_id}`);
      const transfer = unwrap<Row>(res);
      if (!transfer) return;

      setEditingTransfer(transfer);

      // Parse structured remarks if present
      const parsed = parseRemarksHelper(transfer.remarks) || {};
      setHeader({
        from_warehouse_id: transfer.from_warehouse_id || "",
        to_warehouse_id: transfer.to_warehouse_id || "",
        posting_date: transfer.posting_date ? transfer.posting_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
        transfer_purpose: parsed["Purpose"] || "",
        transport_mode: parsed["Mode"] || "INTERNAL_FLEET",
        vehicle_no: parsed["Vehicle"] || "",
        driver_name: parsed["Driver"] || "",
        waybill_ref: parsed["Waybill"] || "",
        remarks: parsed["Notes"] || parsed.raw || "",
      });

      // Load stock balances for source warehouse if available
      const balances: Record<string, { on_hand_qty: number; on_hand_value: number; avg_cost: number; uom: string }> = {};
      if (transfer.from_warehouse_id && companyId) {
        try {
          const balRes = await api.get(
            `/inventory-ledger/balance?companyId=${companyId}&warehouseId=${transfer.from_warehouse_id}`
          );
          const balData = unwrap<any[]>(balRes) || [];
          for (const b of balData) {
            if (b.item_id) {
              balances[b.item_id] = {
                on_hand_qty: Number(b.on_hand_qty) || 0,
                on_hand_value: Number(b.on_hand_value) || 0,
                avg_cost: Number(b.avg_cost) || 0,
                uom: b.uom || "",
              };
            }
          }
        } catch {
          // balances fallback
        }
      }
      setSourceBalances(balances);

      const lns: TransferLineState[] = (transfer.lines || []).map((l: any) => {
        const it = items.find((i) => i.item_id === l.item_id);
        const orderedQty = Number(l.quantity) || 0;
        const shippedQty = Number(l.qty_shipped || 0);
        const receivedQty = Number(l.qty_received || 0);
        const inTransit =
          l.qty_in_transit !== undefined
            ? Number(l.qty_in_transit)
            : transfer.status === "IN_TRANSIT"
            ? Math.max(0, (shippedQty || orderedQty) - receivedQty)
            : 0;
        const remainingToShip = Math.max(0, orderedQty - shippedQty);

        return {
          line_id: l.line_id,
          item_id: l.item_id,
          quantity: String(orderedQty),
          qty_shipped: shippedQty,
          qty_in_transit: inTransit,
          qty_received: receivedQty,
          qty_to_ship: remainingToShip > 0 ? String(remainingToShip) : "0",
          qty_to_receive: inTransit > 0 ? inTransit : 0,
          doa_quantity: Number(l.doa_quantity || l.qty_doa || 0),
          doa_remarks: l.doa_remarks || "",
          uom: l.uom || it?.uom_primary || "",
          lot_no: l.lot_no || "",
          serial_no: l.serial_no || "",
          shipment_date: l.shipment_date ? l.shipment_date.slice(0, 10) : "",
          receipt_date: l.receipt_date ? l.receipt_date.slice(0, 10) : "",
          maxQty: balances[l.item_id]?.on_hand_qty,
          remarks: l.remarks || "",
        };
      });

      setLines(lns.length > 0 ? lns : [emptyLine()]);
      setSelectedLineIdx(0);
      setIsFromLocationLocked(true);
      setOnlyAvailableStock(false);
      setReceivePostingDate(new Date().toISOString().slice(0, 10));
      setReceiveRemarks("");
      setModalOpen(true);
    } catch (err: any) {
      setError(err?.message || "Failed to load transfer order.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!deepLinkId || deepLinkOpened.current === deepLinkId) return;
    deepLinkOpened.current = deepLinkId;
    void openOrder({ transfer_id: deepLinkId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId]);


  const handleShipOrder = async () => {
    if (!editingTransfer) return;
    setShipping(true);
    setFormError("");
    try {
      const shipLinesPayload = lines
        .filter((l) => Number(l.qty_to_ship || 0) > 0)
        .map((l) => {
          const shipQty = Number(l.qty_to_ship);
          const orderedQty = Number(l.quantity) || 0;
          const shippedQty = Number(l.qty_shipped || 0);
          const maxCanShip = Math.max(0, orderedQty - shippedQty);
          if (shipQty <= 0) {
            throw new Error("Quantity to ship must be greater than 0.");
          }
          if (shipQty > maxCanShip + 0.0001) {
            const it = items.find((i) => i.item_id === l.item_id);
            throw new Error(
              `Quantity to ship (${shipQty}) exceeds remaining un-shipped balance (${maxCanShip}) for "${it?.item_code || l.item_id}".`
            );
          }
          if (l.maxQty !== undefined && shipQty > Number(l.maxQty) + 0.0001) {
            const it = items.find((i) => i.item_id === l.item_id);
            throw new Error(
              `Quantity to ship (${shipQty}) exceeds available stock (${l.maxQty} ${l.uom}) for "${it?.item_code || l.item_id}".`
            );
          }
          let serialToShip = l.serial_no || undefined;
          if (serialToShip && shipQty > 0) {
            const allSerials = serialToShip.split(",").map((s) => s.trim()).filter(Boolean);
            if (allSerials.length > shipQty) {
              serialToShip = allSerials.slice(0, shipQty).join(", ");
            }
          }
          return {
            line_id: l.line_id || undefined,
            item_id: l.item_id,
            quantity: shipQty,
            uom: l.uom,
            lot_no: l.lot_no || undefined,
            serial_no: serialToShip,
            shipment_date: l.shipment_date || undefined,
            receipt_date: l.receipt_date || undefined,
            remarks: l.remarks || undefined,
          };
        });

      if (shipLinesPayload.length === 0) {
        throw new Error("Please specify a Quantity to Ship greater than 0 on at least one line.");
      }

      const payload = {
        posting_date: header.posting_date || undefined,
        vehicle_no: header.vehicle_no.trim() || undefined,
        driver_name: header.driver_name.trim() || undefined,
        waybill_ref: header.waybill_ref.trim() || undefined,
        remarks: header.remarks.trim() || undefined,
        lines: shipLinesPayload,
      };

      await api.post(`/stock-transfer/${editingTransfer.transfer_id}/ship`, payload);
      const shipMsg = `Transfer Order ${editingTransfer.transfer_no || ""} dispatched successfully. Goods are now in transit.`;
      showToast.success(shipMsg);
      setSuccessMsg(shipMsg);
      setTimeout(() => setSuccessMsg(""), 5000);
      setModalOpen(false);
      setEditingTransfer(null);
      load();
    } catch (err: any) {
      setFormError(err?.message || "Failed to dispatch shipment.");
    } finally {
      setShipping(false);
    }
  };

  const handleReceiveOrder = async () => {
    if (!editingTransfer) return;
    setReceiving(true);
    setFormError("");
    try {
      const receiveLinesPayload = lines
        .filter((l) => (Number(l.qty_to_receive || 0) + Number(l.doa_quantity || 0)) > 0)
        .map((l) => {
          const toRec = Number(l.qty_to_receive || 0);
          const toDoa = Number(l.doa_quantity || 0);
          const inTransit = Number(l.qty_in_transit || 0);
          if (toRec < 0 || toDoa < 0 || (toRec === 0 && toDoa === 0)) {
            throw new Error("Quantity to receive (Good) or DOA loss must be greater than 0.");
          }
          if (toRec + toDoa > inTransit + 0.0001) {
            const it = items.find((i) => i.item_id === l.item_id);
            throw new Error(
              `Total accounted quantity (${toRec + toDoa}) cannot exceed in-transit quantity (${inTransit}) for "${it?.item_code || l.item_id}".`
            );
          }
          return {
            line_id: l.line_id || undefined,
            received_quantity: toRec,
            doa_quantity: toDoa > 0 ? toDoa : 0,
            doa_remarks: l.doa_remarks || undefined,
            remarks: l.remarks || undefined,
          };
        });

      if (receiveLinesPayload.length === 0) {
        throw new Error("Please enter a quantity to receive or DOA loss greater than 0 for at least one item.");
      }

      const payload = {
        posting_date: receivePostingDate || header.posting_date || undefined,
        remarks: receiveRemarks.trim() || undefined,
        lines: receiveLinesPayload,
      };

      await api.post(`/stock-transfer/${editingTransfer.transfer_id}/receive`, payload);
      const recMsg = `Transfer Order ${editingTransfer.transfer_no || ""} received successfully into destination location.`;
      showToast.success(recMsg);
      setSuccessMsg(recMsg);
      setTimeout(() => setSuccessMsg(""), 5000);
      setModalOpen(false);
      setEditingTransfer(null);
      load();
    } catch (err: any) {
      setFormError(err?.message || "Failed to post transfer receipt.");
    } finally {
      setReceiving(false);
    }
  };

  const handleCloseOrder = async (transferId: string) => {
    if (!window.confirm("Are you sure you want to short-close this Transfer Order? Any remaining un-shipped balance will be cancelled.")) {
      return;
    }
    setClosing(true);
    try {
      await api.post(`/stock-transfer/${transferId}/close`, {});
      setSuccessMsg("Transfer Order closed successfully.");
      setTimeout(() => setSuccessMsg(""), 5000);
      setModalOpen(false);
      setEditingTransfer(null);
      load();
    } catch (err: any) {
      setFormError(err?.message || "Failed to close Transfer Order.");
    } finally {
      setClosing(false);
    }
  };

  const handleResolveDiscrepancy = async () => {
    if (!editingTransfer) return;
    setResolvingDiscrepancy(true);
    setFormError("");
    try {
      await api.post(`/stock-transfer/${editingTransfer.transfer_id}/close`, {
        writeOffInTransit: discrepancyType === "WRITE_OFF",
        returnToSource: discrepancyType === "RETURN",
        reason: discrepancyReason.trim() || undefined,
      });
      setSuccessMsg(
        discrepancyType === "WRITE_OFF"
          ? "In-transit discrepancy written off successfully. Transfer Order closed."
          : "In-transit stock returned to source location successfully. Transfer Order closed."
      );
      setTimeout(() => setSuccessMsg(""), 5000);
      setDiscrepancyModalOpen(false);
      setModalOpen(false);
      setEditingTransfer(null);
      load();
    } catch (err: any) {
      setFormError(err?.message || "Failed to resolve in-transit discrepancy.");
    } finally {
      setResolvingDiscrepancy(false);
    }
  };

  const handleDirectPost = async () => {
    if (!editingTransfer) return;
    setPosting(true);
    setFormError("");
    try {
      await api.post(`/stock-transfer/${editingTransfer.transfer_id}/post`, {});
      setSuccessMsg("Transfer Order posted directly.");
      setTimeout(() => setSuccessMsg(""), 5000);
      setModalOpen(false);
      setEditingTransfer(null);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("stpFailedToPost"));
    } finally {
      setPosting(false);
    }
  };

  const warehouseLabel = (id: string) => {
    const w = warehouses.find((wh) => wh.warehouse_id === id);
    if (!w) return "—";
    return w.warehouse_code ? `${w.warehouse_code} (${w.warehouse_name})` : w.warehouse_name || "—";
  };
  const warehouseCode = (id: string) => {
    const w = warehouses.find((wh) => wh.warehouse_id === id);
    return w?.warehouse_code || notAvailable;
  };
  const warehouseName = (id: string) => {
    const w = warehouses.find((wh) => wh.warehouse_id === id);
    return w?.warehouse_name || "";
  };
  const getUserDisplayName = (idOrName?: string | null) => {
    if (!idOrName) return "System";
    const found = users.find((u) => u.user_id === idOrName || u.userId === idOrName);
    if (found) return found.full_name || found.fullName || found.email || notAvailable;
    return notAvailable;
  };

  // Location & Farm authorization helpers
  const getWarehouseFarm = (warehouseId: string | undefined): { farm_id: string | null; farm_code: string | null } => {
    if (!warehouseId) return { farm_id: null, farm_code: null };
    const wh = warehouses.find((w) => w.warehouse_id === warehouseId || w.location_id === warehouseId);
    const farmId = wh?.farm_id || wh?.parent_location_id || (wh?.location_type === "FARM" ? wh.location_id : null) || null;

    // Find farm in farms list or in warehouses
    const farmObj =
      farms.find((f) => f.location_id === farmId || f.warehouse_id === farmId) ||
      farms.find((f) => f.location_id === warehouseId) ||
      warehouses.find(
        (w) => (w.location_id === farmId || w.warehouse_id === farmId) && (w.location_type === "FARM" || !w.parent_location_id)
      );

    const farmCode =
      farmObj?.location_code ||
      farmObj?.warehouse_code ||
      (wh?.warehouse_code ? wh.warehouse_code.split("/")[0] : null);

    return {
      farm_id: farmId || farmObj?.location_id || null,
      farm_code: farmCode || null,
    };
  };

  const currentUser = getStoredUser();
  const activeFarmId = getActiveFarmId();
  const activeFarmCode = useMemo(() => {
    if (!activeFarmId) return null;
    const f =
      farms.find((farm) => farm.location_id === activeFarmId || farm.warehouse_id === activeFarmId) ||
      warehouses.find((w) => w.location_id === activeFarmId || w.warehouse_id === activeFarmId);
    return f?.location_code || f?.warehouse_code || null;
  }, [activeFarmId, farms, warehouses]);

  const isLocationOnActiveFarm = (locationId: string | undefined): boolean => {
    if (!locationId) return false;
    // If no farm is pinned (unrestricted company/tenant view), all locations are in scope
    if (!activeFarmId) return true;

    const { farm_id, farm_code } = getWarehouseFarm(locationId);

    // 1. Direct UUID match
    if (farm_id && farm_id === activeFarmId) return true;
    if (locationId === activeFarmId) return true;

    // 2. Code match (e.g. MUL100 === MUL100)
    if (activeFarmCode && farm_code && activeFarmCode.toUpperCase() === farm_code.toUpperCase()) {
      return true;
    }

    return false;
  };

  const canEditTransfer = hasPermission(currentUser, "INVENTORY", "STOCK_TRANSFER", "can_edit");

  // Can the current user/farm ship this transfer order?
  const canUserShip = (transfer: Row): boolean => {
    if (!canEditTransfer) return false;
    if (["CANCELLED", "POSTED", "RECEIVED"].includes(transfer.status)) return false;

    // Check remaining to ship balance
    const hasRemainingToShip =
      transfer.status === "DRAFT" ||
      (transfer.lines || []).some((l: any) => {
        const ord = Number(l.quantity) || 0;
        const shp = l.qty_shipped !== undefined ? Number(l.qty_shipped) : 0;
        const rem = l.qty_to_ship !== undefined ? Number(l.qty_to_ship) : Math.max(0, ord - shp);
        return rem > 0;
      });

    if (!hasRemainingToShip) return false;

    // Source warehouse must be on user's active farm (or user is global admin)
    return isLocationOnActiveFarm(transfer.from_warehouse_id);
  };

  // Can the current user/farm receive this transfer order?
  const canUserReceive = (transfer: Row): boolean => {
    if (!canEditTransfer) return false;
    if (["CANCELLED", "POSTED", "DRAFT"].includes(transfer.status)) return false;

    // Check in-transit stock exists
    const hasInTransit =
      transfer.status === "IN_TRANSIT" ||
      (transfer.lines || []).some((l: any) => {
        const ord = Number(l.quantity) || 0;
        const inTransit =
          l.qty_in_transit !== undefined
            ? Number(l.qty_in_transit)
            : transfer.status === "IN_TRANSIT"
            ? ord
            : 0;
        return inTransit > 0;
      });

    if (!hasInTransit) return false;

    // Destination warehouse must be on user's active farm (or user is global admin)
    return isLocationOnActiveFarm(transfer.to_warehouse_id);
  };


  // Warehouse options
  const sourceWarehouseOptions = useMemo(() => {
    return storeWarehouses.map((w) => ({
      value: w.warehouse_id,
      label: `${w.warehouse_code} — ${w.warehouse_name}`, shortLabel: (w.warehouse_name) ?? "",
    }));
  }, [storeWarehouses]);

  const destinationWarehouseOptions = useMemo(() => {
    return storeWarehouses
      .filter((w) => w.warehouse_id !== header.from_warehouse_id)
      .map((w) => ({
        value: w.warehouse_id,
        label: `${w.warehouse_code} — ${w.warehouse_name}`, shortLabel: (w.warehouse_name) ?? "",
      }));
  }, [storeWarehouses, header.from_warehouse_id]);

  // Number of items available at the selected location
  const availableItemsCount = useMemo(() => {
    return Object.values(sourceBalances).filter((b) => b.on_hand_qty > 0).length;
  }, [sourceBalances]);

  // Item options: Includes Code, Name, and Available Stock column
  const itemOptions = useMemo(() => {
    if (!header.from_warehouse_id) return [];

    const list = items.map((it) => {
      const bal = sourceBalances[it.item_id];
      const stockQty = bal?.on_hand_qty || 0;
      const uom = bal?.uom || it.uom_primary || it.uom || "";
      const stockDisplay =
        stockQty > 0
          ? `${stockQty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${uom}`
          : `0 ${uom}`;

      return {
        value: it.item_id,
        label: `${it.item_code} — ${it.item_name} (${stockDisplay})`,
        item_code: it.item_code,
        item_name: it.item_name,
        stock_display: stockDisplay,
        hasStock: stockQty > 0,
        stockQty,
        uom,
      };
    });

    if (onlyAvailableStock) {
      return list.filter((x) => x.hasStock);
    }

    return list.sort((a, b) => {
      if (a.hasStock && !b.hasStock) return -1;
      if (!a.hasStock && b.hasStock) return 1;
      return a.item_code.localeCompare(b.item_code);
    });
  }, [items, sourceBalances, header.from_warehouse_id, onlyAvailableStock]);

  // Totals calculations
  const totalLineCount = lines.filter((l) => l.item_id).length;
  const totalQuantity = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
  const totalShipQuantity = lines.reduce(
    (acc, l) =>
      acc + (l.qty_to_ship !== undefined && l.qty_to_ship !== "" ? Number(l.qty_to_ship) : Number(l.quantity) || 0),
    0
  );
  const totalEstimatedValue = lines.reduce((acc, l) => {
    const bal = sourceBalances[l.item_id];
    const unitRate = bal?.avg_cost || 0;
    return acc + (Number(l.quantity) || 0) * unitRate;
  }, 0);

  const totalInTransitQuantity = lines.reduce(
    (acc, l) => acc + (Number(l.qty_in_transit) || 0),
    0
  );
  const totalReceivedQuantity = lines.reduce(
    (acc, l) => acc + (Number(l.qty_received) || 0),
    0
  );


  return (
    <div className="flex flex-col gap-4">
      {/* Sub-navigation tabs */}
      <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
        <button
          type="button"
          onClick={() => setActiveTab("transfers")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
            activeTab === "transfers"
              ? "bg-(--surface-raised) text-(--text-primary) shadow-xs"
              : "text-(--text-secondary) hover:text-(--text-primary)"
          }`}
        >
          <ArrowRight className="h-3.5 w-3.5" />
          Transfer Orders
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("receive")}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
            activeTab === "receive"
              ? "bg-(--surface-raised) text-(--text-primary) shadow-xs"
              : "text-(--text-secondary) hover:text-(--text-primary)"
          }`}
        >
          <PackageCheck className="h-3.5 w-3.5" />
          Transfer Receipts
        </button>
      </div>

      {activeTab === "receive" ? (
        <ReceiveStockPanel
          onOpenTransferOrder={(transferId) => {
            setActiveTab("transfers");
            openOrder({ transfer_id: transferId });
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold" style={S.primary}>
                {t("stpTitle") || "Transfer Orders"}
              </h2>
              <p className="mt-0.5 text-xs" style={S.sub}>
                {t("stpSubtitle") || "Move inventory between locations and silos with transit and item tracking."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value)}
                className="nf-input-sm px-2 text-xs"
                style={S.input}
                title="Filter transfer flow direction"
              >
                <option value="ALL">All Flows</option>
                <option value="OUTBOUND">Outbound (Ship)</option>
                <option value="INBOUND">Inbound (Receive)</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="nf-input-sm px-2"
                style={S.input}
              >
                <option value="">{t("stpAllStatuses") || "All Statuses"}</option>
                <option value="DRAFT">{STATUS_LABEL.DRAFT}</option>
                <option value="IN_TRANSIT">{STATUS_LABEL.IN_TRANSIT}</option>
                <option value="PARTIALLY_RECEIVED">{STATUS_LABEL.PARTIALLY_RECEIVED}</option>
                <option value="RECEIVED">{STATUS_LABEL.RECEIVED}</option>
                <option value="POSTED">{STATUS_LABEL.POSTED}</option>
                <option value="CANCELLED">{STATUS_LABEL.CANCELLED}</option>
              </select>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                  style={S.muted}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("stpSearchPlaceholder") || "Search transfer order #, notes…"}
                  className="nf-input-sm pl-8 pr-3"
                  style={S.input}
                />
              </div>
              <Button size="sm" onClick={openCreate} className="nf-btn-primary flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> {t("stpNewTransfer") || "New Transfer Order"}
              </Button>
            </div>
          </div>

          {error && <InlineAlert>{error}</InlineAlert>}
          {successMsg && (
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    <TableHead className="whitespace-nowrap">{t("stpColTransferNo") || "Transfer Order No."}</TableHead>
                    <TableHead className="whitespace-nowrap">{t("stpFromWarehouse") || "Transfer-from Location"}</TableHead>
                    <TableHead className="whitespace-nowrap">{t("stpToWarehouse") || "Transfer-to Location"}</TableHead>
                    <TableHead className="whitespace-nowrap">{t("stpColPostingDate") || "Posting Date"}</TableHead>
                    <TableHead className="text-right">{t("stpColStatus") || "Status"}</TableHead>
                    <TableHead className="text-right">{t("stpColActions") || "Actions"}</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <tr>
                      <TableCell colSpan={6} className="py-10 text-center" style={S.sub}>
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} />{" "}
                        {t("stpLoading") || "Loading transfer orders…"}
                      </TableCell>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <TableCell colSpan={6} className="py-10 text-center" style={S.sub}>
                        <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />{" "}
                        {t("stpNoTransfersYet") || "No transfer orders recorded yet."}
                      </TableCell>
                    </tr>
                  ) : (
                    pagedRows.map((row) => (
                      <TableRow
                        key={row.transfer_id}
                        className="hover:bg-(--surface-raised) cursor-pointer"
                        onClick={() => openOrder(row)}
                      >
                        <TableCell className="whitespace-nowrap font-semibold font-mono text-xs" style={S.primary}>
                          {row.transfer_no}
                        </TableCell>
                        <TableCell className="whitespace-nowrap" style={S.primary}>
                          <div className="flex flex-col">
                            <span className="font-semibold text-xs">{warehouseCode(row.from_warehouse_id)}</span>
                            {warehouseName(row.from_warehouse_id) && (
                              <span className="text-[11px] truncate max-w-[220px]" style={S.sub}>
                                {warehouseName(row.from_warehouse_id)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap" style={S.primary}>
                          <div className="flex flex-col">
                            <span className="font-semibold text-xs">{warehouseCode(row.to_warehouse_id)}</span>
                            {warehouseName(row.to_warehouse_id) && (
                              <span className="text-[11px] truncate max-w-[220px]" style={S.sub}>
                                {warehouseName(row.to_warehouse_id)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs font-mono" style={S.sub}>
                          {row.posting_date}
                        </TableCell>
                        <TableCell className="text-right">
                          <StatusBadge status={row.status} label={statusLabel(row.status)} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {canUserShip(row) && (
                              <Button
                                size="sm"
                                onClick={() => openOrder(row)}
                                className="h-7 px-2.5 text-xs font-semibold nf-btn-primary flex items-center gap-1"
                                title="Open Transfer Order to ship"
                              >
                                <Truck className="h-3.5 w-3.5" /> Ship
                              </Button>
                            )}
                            {canUserReceive(row) && (
                              <Button
                                size="sm"
                                onClick={() => openOrder(row)}
                                className="h-7 px-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 shadow-xs"
                                title="Open Transfer Order to receive stock"
                              >
                                <PackageCheck className="h-3.5 w-3.5" /> Receive
                              </Button>
                            )}
                            <button
                              onClick={() => openOrder(row)}
                              title={t("stpView") || "View Details"}
                              className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)"
                              style={S.sub}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </table>
            </div>
            {!loading && rows.length > 0 && (
              <div className="border-t px-2" style={{ borderColor: "var(--border)" }}>
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={rows.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* Create Modal: Enterprise-Grade Standard Transfer Order Form               */}
          {/* ========================================================================= */}
          {/* ========================================================================= */}
          {/* Unified Transfer Order Document Card (Create, View, Ship, Receive)        */}
          {/* ========================================================================= */}
          <Dialog
            open={modalOpen}
            onClose={() => !saving && !shipping && !receiving && setModalOpen(false)}
            title={
              editingTransfer
                ? `Transfer Order — ${editingTransfer.transfer_no || notAvailable}`
                : "New Transfer Order"
            }
            description={
              editingTransfer
                ? "Transfer Order document card — track route, dispatch shipment, and post inbound receipt."
                : "Create a transfer order between locations with quantity lifecycle, shipment dispatch, and item tracking."
            }
            maxWidth="xl"
            footer={
              <div className="flex w-full items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setModalOpen(false)}
                    disabled={saving || shipping || receiving}
                    className="text-xs"
                  >
                    {editingTransfer ? "Close" : "Cancel"}
                  </Button>
                  {editingTransfer && (() => {
                    const hasRemainingToShip = lines.some((l) => {
                      const ord = Number(l.quantity) || 0;
                      const shp = Number(l.qty_shipped || 0);
                      return ord - shp > 0;
                    });
                    const totalInTransit = lines.reduce((acc, l) => acc + Number(l.qty_in_transit || 0), 0);
                    const canClose = hasRemainingToShip && totalInTransit === 0 && !["POSTED", "CANCELLED", "RECEIVED"].includes(editingTransfer.status);
                    const canResolveDiscrepancy = totalInTransit > 0 && !["POSTED", "CANCELLED", "RECEIVED"].includes(editingTransfer.status);

                    return (
                      <div className="flex items-center gap-2">
                        {canClose && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCloseOrder(editingTransfer.transfer_id)}
                            disabled={closing}
                            className="text-xs text-red-500 border-red-500/30 hover:bg-red-500/10"
                            title="Cancel remaining unfulfilled balance and close order"
                          >
                            {closing ? "Closing…" : "Close Order (Cancel Remainder)"}
                          </Button>
                        )}
                        {canResolveDiscrepancy && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setDiscrepancyReason("");
                              setDiscrepancyModalOpen(true);
                            }}
                            disabled={resolvingDiscrepancy}
                            className="text-xs text-amber-500 border-amber-500/30 hover:bg-amber-500/10 flex items-center gap-1.5"
                            title="Resolve lost, damaged, or returned in-transit stock"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Resolve Transit Discrepancy
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-2">
                  {!editingTransfer ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSave(false)}
                        disabled={saving}
                        className="text-xs font-medium"
                        title="Save Transfer Order as Draft (dispatch shipment later)"
                      >
                        {saving && !savingAndShipping ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Save as Draft
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSave(true)}
                        disabled={saving}
                        className="nf-btn-primary flex items-center gap-1.5 text-xs font-semibold"
                        title="Create Transfer Order and immediately dispatch outbound shipment with Qty. to Ship"
                      >
                        {savingAndShipping ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Truck className="h-3.5 w-3.5" />
                        )}
                        {savingAndShipping ? "Creating & Shipping…" : "Create & Ship Outbound"}
                      </Button>
                    </>
                  ) : (
                    <>
                      {/* Draft actions: 1-Step Direct Post or Dispatch Outbound */}
                      {editingTransfer.status === "DRAFT" && canUserShip(editingTransfer) && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleDirectPost}
                            disabled={posting}
                            className="text-xs"
                            title="Direct transfer without transit delay"
                          >
                            {posting ? "Posting…" : "Direct Transfer (1-Step)"}
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleShipOrder}
                            disabled={shipping}
                            className="nf-btn-primary flex items-center gap-1.5 text-xs font-semibold"
                            title="Dispatch outbound shipment with Qty. to Ship"
                          >
                            {shipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                            {shipping ? "Dispatching…" : "Ship Outbound"}
                          </Button>
                        </>
                      )}

                      {/* In Transit actions: Receive Inbound or Ship Remaining */}
                      {editingTransfer.status === "IN_TRANSIT" && (
                        <>
                          {canUserReceive(editingTransfer) && (
                            <Button
                              size="sm"
                              onClick={handleReceiveOrder}
                              disabled={receiving || !lines.some((l) => (Number(l.qty_to_receive || 0) + Number(l.doa_quantity || 0)) > 0)}
                              className={`flex items-center gap-1.5 text-xs font-semibold shadow-xs ${
                                !lines.some((l) => (Number(l.qty_to_receive || 0) + Number(l.doa_quantity || 0)) > 0)
                                  ? "opacity-50 cursor-not-allowed bg-emerald-600/70 text-white"
                                  : "bg-emerald-600 hover:bg-emerald-700 text-white"
                              }`}
                              title="Receive in-transit stock into destination location"
                            >
                              {receiving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <PackageCheck className="h-4 w-4" />
                              )}
                              {receiving ? "Receiving…" : "Confirm & Receive Transfer Order"}
                            </Button>
                          )}
                          {canUserShip(editingTransfer) &&
                            lines.some((l) => Number(l.quantity) > Number(l.qty_shipped || 0)) && (
                              <Button
                                size="sm"
                                onClick={handleShipOrder}
                                disabled={shipping}
                                className="nf-btn-primary flex items-center gap-1.5 text-xs font-semibold"
                                title="Dispatch remaining balance"
                              >
                                {shipping ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Truck className="h-4 w-4" />
                                )}
                                {shipping ? "Dispatching…" : "Ship Remaining Balance"}
                              </Button>
                            )}
                          {!canUserReceive(editingTransfer) && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-md">
                              <Truck className="h-3.5 w-3.5 shrink-0" />
                              <span>In transit to {warehouseCode(editingTransfer.to_warehouse_id)} — Awaiting receipt</span>
                            </span>
                          )}
                        </>
                      )}

                      {/* Received status */}
                      {editingTransfer.status === "RECEIVED" && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Transfer Completed &amp; Stock Received
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            }
          >
            <div className="flex flex-col gap-5">
              {formError && <InlineAlert>{formError}</InlineAlert>}

              {/* Section 1: Route & Planning */}
              <div className="rounded-[var(--radius-md)] border p-4 shadow-2xs" style={S.raised}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={S.primary}>
                      <Building2 className="h-4 w-4" style={S.accent} />
                      Transfer Route &amp; Planning
                    </h3>
                    {editingTransfer && (
                      <StatusBadge
                        status={editingTransfer.status}
                        label={statusLabel(editingTransfer.status)}
                      />
                    )}
                  </div>
                  {loadingBalances && (
                    <span className="flex items-center gap-1 text-[11px] text-(--accent)">
                      <Loader2 className="h-3 w-3 animate-spin" /> Checking available stock at source…
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Transfer-from Location */}
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="nf-text-label flex items-center justify-between" style={S.sub}>
                      <span className="flex items-center gap-1.5">
                        Transfer-from Location (Source) <span className="text-(--danger)">*</span>
                        {(isFromLocationLocked || !!editingTransfer) && (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            🔒 {editingTransfer ? "Order Source" : "Active Location (Locked)"}
                          </span>
                        )}
                      </span>
                      {header.from_warehouse_id && !editingTransfer && (
                        loadingBalances ? (
                          <span className="text-[10px] text-(--text-muted) font-medium animate-pulse">
                            Checking live stock…
                          </span>
                        ) : (
                          <span className="text-[10px] text-emerald-500 font-medium">
                            ✓ {availableItemsCount} item{availableItemsCount === 1 ? "" : "s"} in stock
                          </span>
                        )
                      )}
                    </label>
                    <SearchableSelect
                      ariaLabel="Transfer-from Location"
                      value={header.from_warehouse_id}
                      disabled={isFromLocationLocked || !!editingTransfer}
                      onChange={(val) => {
                        setHeader((h) => ({
                          ...h,
                          from_warehouse_id: val,
                          to_warehouse_id: h.to_warehouse_id === val ? "" : h.to_warehouse_id,
                        }));
                      }}
                      options={sourceWarehouseOptions}
                      placeholder="Select source store…"
                    />
                  </div>

                  {/* Transfer-to Location */}
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="nf-text-label" style={S.sub}>
                      Transfer-to Location (Destination) <span className="text-(--danger)">*</span>
                    </label>
                    <SearchableSelect
                      ariaLabel="Transfer-to Location"
                      value={header.to_warehouse_id}
                      onChange={(val) => setHeader((h) => ({ ...h, to_warehouse_id: val }))}
                      options={destinationWarehouseOptions}
                      placeholder={
                        header.from_warehouse_id ? "Select destination store…" : "Select source location first"
                      }
                      disabled={!header.from_warehouse_id || !!editingTransfer}
                    />
                  </div>

                  {/* Posting Date */}
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="nf-text-label flex items-center gap-1" style={S.sub}>
                      <Calendar className="h-3 w-3" /> Posting Date <span className="text-(--danger)">*</span>
                    </label>
                    <input
                      type="date"
                      value={header.posting_date}
                      disabled={!!editingTransfer && editingTransfer.status !== "DRAFT"}
                      readOnly={!!editingTransfer && editingTransfer.status !== "DRAFT"}
                      onChange={(e) => {
                        const newDate = e.target.value;
                        setHeader((h) => ({ ...h, posting_date: newDate }));
                        setLines((prev) =>
                          prev.map((l) =>
                            !l.shipment_date || l.shipment_date === header.posting_date
                              ? { ...l, shipment_date: newDate }
                              : l
                          )
                        );
                      }}
                      className={`${inputCls} ${editingTransfer && editingTransfer.status !== "DRAFT" ? "opacity-75 cursor-not-allowed" : ""}`}
                      style={S.input}
                    />
                  </div>

                  {/* Transfer Purpose */}
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="nf-text-label" style={S.sub}>
                      Transfer Purpose
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Routine Stock Replenishment"
                      value={header.transfer_purpose}
                      disabled={!!editingTransfer && editingTransfer.status !== "DRAFT"}
                      onChange={(e) => setHeader((h) => ({ ...h, transfer_purpose: e.target.value }))}
                      className={`${inputCls} ${editingTransfer && editingTransfer.status !== "DRAFT" ? "opacity-75 cursor-not-allowed" : ""}`}
                      style={S.input}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Transport & Dispatch Logistics */}
              <div className="rounded-[var(--radius-md)] border p-4 shadow-2xs" style={S.raised}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={S.primary}>
                    <Truck className="h-4 w-4" style={S.accent} />
                    Transport &amp; Dispatch Logistics
                  </h3>
                  <span className="text-[10px]" style={S.muted}>
                    Captured on Waybill &amp; In-Transit Records
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Transport Mode */}
                  <div className="flex flex-col gap-1">
                    <label className="nf-text-label" style={S.sub}>
                      Transport Mode
                    </label>
                    <select
                      value={header.transport_mode}
                      disabled={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      onChange={(e) => setHeader((h) => ({ ...h, transport_mode: e.target.value }))}
                      className={`${inputCls} nf-select ${
                        editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)
                          ? "opacity-75 cursor-not-allowed"
                          : ""
                      }`}
                      style={S.input}
                    >
                      {TRANSPORT_MODE_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Vehicle / Truck No */}
                  <div className="flex flex-col gap-1">
                    <label className="nf-text-label" style={S.sub}>
                      Vehicle / Truck Plate #
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. ABZ-4821"
                      value={header.vehicle_no}
                      disabled={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      readOnly={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      onChange={(e) => setHeader((h) => ({ ...h, vehicle_no: e.target.value }))}
                      className={`${inputCls} ${
                        editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)
                          ? "opacity-75 cursor-not-allowed"
                          : ""
                      }`}
                      style={S.input}
                    />
                  </div>

                  {/* Driver Name */}
                  <div className="flex flex-col gap-1">
                    <label className="nf-text-label" style={S.sub}>
                      Driver Name / Contact
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Tafadzwa Moyo"
                      value={header.driver_name}
                      disabled={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      readOnly={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      onChange={(e) => setHeader((h) => ({ ...h, driver_name: e.target.value }))}
                      className={`${inputCls} ${
                        editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)
                          ? "opacity-75 cursor-not-allowed"
                          : ""
                      }`}
                      style={S.input}
                    />
                  </div>

                  {/* Waybill / Gate Pass Ref */}
                  <div className="flex flex-col gap-1">
                    <label className="nf-text-label" style={S.sub}>
                      Waybill / Dispatch Ref #
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. WB-2026-091"
                      value={header.waybill_ref}
                      disabled={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      readOnly={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      onChange={(e) => setHeader((h) => ({ ...h, waybill_ref: e.target.value }))}
                      className={`${inputCls} ${
                        editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)
                          ? "opacity-75 cursor-not-allowed"
                          : ""
                      }`}
                      style={S.input}
                    />
                  </div>

                  {/* General Dispatch Remarks */}
                  <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
                    <label className="nf-text-label" style={S.sub}>
                      Dispatch Instructions / Remarks
                    </label>
                    <input
                      type="text"
                      placeholder="Special handling instructions, gate pass notes, moisture protection…"
                      value={header.remarks}
                      disabled={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      readOnly={!!editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)}
                      onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
                      className={`${inputCls} ${
                        editingTransfer && editingTransfer.status !== "DRAFT" && !canUserShip(editingTransfer)
                          ? "opacity-75 cursor-not-allowed"
                          : ""
                      }`}
                      style={S.input}
                    />
                  </div>
                </div>
              </div>

              {/* Inbound Receipt Section (Rendered when In-Transit and user is authorized receiver) */}
              {editingTransfer && editingTransfer.status === "IN_TRANSIT" && canUserReceive(editingTransfer) && (
                <div className="rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-2xs">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      <PackageCheck className="h-4 w-4" />
                      Inbound Receipt Posting &amp; Inspection (DOA Loss Auto-Adjustment)
                    </h3>
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      Enter Good received units and any DOA / transit losses in the lines table below
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label className="nf-text-label flex items-center gap-1" style={S.sub}>
                        <Calendar className="h-3 w-3 text-emerald-500" /> Receipt Posting Date <span className="text-(--danger)">*</span>
                      </label>
                      <input
                        type="date"
                        value={receivePostingDate}
                        onChange={(e) => setReceivePostingDate(e.target.value)}
                        className={inputCls}
                        style={S.input}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="nf-text-label" style={S.sub}>
                        Condition / Inspection Remarks
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Received in good order, seals intact, temperature verified"
                        value={receiveRemarks}
                        onChange={(e) => setReceiveRemarks(e.target.value)}
                        className={inputCls}
                        style={S.input}
                      />
                    </div>
                  </div>

                  {/* Real-time Accounted and DOA Loss summary */}
                  {(() => {
                    const totalInTransit = lines.reduce((acc, l) => acc + (Number(l.qty_in_transit) || 0), 0);
                    const totalGood = lines.reduce(
                      (acc, l) => acc + (Number(l.qty_to_receive !== undefined ? l.qty_to_receive : l.qty_in_transit) || 0),
                      0
                    );
                    const totalDoa = lines.reduce((acc, l) => acc + (Number(l.doa_quantity) || 0), 0);
                    const totalAccounted = totalGood + totalDoa;

                    return (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-white/60 dark:bg-black/20 p-2.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                            Accounted: <strong className="font-mono">{totalAccounted}</strong> / <span className="font-mono">{totalInTransit}</span> in-transit
                            {" "}(<span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{totalGood} In Stock</span>
                            {totalDoa > 0 ? (
                              <> + <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{totalDoa} Auto-Adjusted DOA Loss</span></>
                            ) : null})
                          </span>
                        </div>
                        {totalAccounted > totalInTransit ? (
                          <span className="font-semibold text-red-600 dark:text-red-400">
                            ⚠️ Accounted ({totalAccounted}) exceeds in-transit ({totalInTransit})!
                          </span>
                        ) : totalInTransit - totalAccounted > 0 ? (
                          <span className="text-amber-700 dark:text-amber-300 font-medium">
                            Remaining in transit: <strong className="font-mono">{totalInTransit - totalAccounted}</strong> units
                          </span>
                        ) : (
                          <span className="font-medium text-emerald-700 dark:text-emerald-300">
                            ✓ In-transit will be cleared to 0 (Order status ➔ RECEIVED)
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Section 3: Transfer Order Lines */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={S.primary}>
                      <Layers className="h-4 w-4" style={S.accent} />
                      Transfer Order Lines ({lines.length})
                    </h3>
                    <p className="text-[11px]" style={S.muted}>
                      Track ordered quantity, shipment dispatch, in-transit stock, receipt inspection, and valuation.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!editingTransfer && header.from_warehouse_id && (
                      <label className="flex items-center gap-1.5 text-xs text-(--text-secondary) cursor-pointer select-none mr-1">
                        <input
                          type="checkbox"
                          checked={onlyAvailableStock}
                          onChange={(e) => setOnlyAvailableStock(e.target.checked)}
                          className="rounded border-(--border)"
                        />
                        <Filter className="h-3 w-3 text-(--accent)" />
                        <span>Only show items in stock ({availableItemsCount})</span>
                      </label>
                    )}
                    <button
                      onClick={() => {
                        if (lines.length === 0) {
                          showToast.warn("Please add a line item first.");
                          return;
                        }
                        const targetIdx = selectedLineIdx >= 0 && selectedLineIdx < lines.length ? selectedLineIdx : 0;
                        handleOpenItemTracking(targetIdx);
                      }}
                      type="button"
                      disabled={lines.length === 0}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-(--surface-raised) disabled:opacity-50 disabled:cursor-not-allowed"
                      style={S.surface}
                      title="Open Item Tracking Lines (Lot / Serial) for the selected line"
                    >
                      <Barcode className="h-3.5 w-3.5 text-(--accent)" />
                      Item Tracking Lines
                    </button>
                    {!editingTransfer && (
                      <button
                        onClick={addLine}
                        type="button"
                        disabled={!header.from_warehouse_id}
                        className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-(--surface-raised) disabled:opacity-50 disabled:cursor-not-allowed"
                        style={S.surface}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Line
                      </button>
                    )}
                  </div>
                </div>

                {/* Banner when source store is not chosen */}
                {!editingTransfer && !header.from_warehouse_id ? (
                  <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      Please select <strong>Transfer-from Location (Source)</strong> above. The system will load the stock count and available items for that location.
                    </span>
                  </div>
                ) : !editingTransfer && header.from_warehouse_id && availableItemsCount === 0 && !loadingBalances ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>
                        No positive stock balances found at <strong>{warehouseLabel(header.from_warehouse_id)}</strong>.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOnlyAvailableStock(false)}
                      className="underline font-semibold hover:text-amber-400"
                    >
                      Show all catalog items anyway
                    </button>
                  </div>
                ) : null}

                <div className="overflow-x-auto rounded-[var(--radius-md)] border shadow-2xs" style={S.surface}>
                  <table className="w-full border-collapse text-left text-xs min-w-[1400px]">
                    <TableHeader>
                      <tr className="border-b border-(--row-border)">
                        <TableHead className="h-auto w-8 px-2 py-2.5 text-center">#</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-40 min-w-[140px]">Item Code</TableHead>
                        <TableHead className="h-auto px-3 py-2.5 min-w-[220px]">Item Description</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-44 min-w-[160px]">Quantity (Ordered)</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-36 min-w-[130px]">Qty. to Ship</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-24 min-w-[95px] text-right">Quantity Shipped</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-24 min-w-[95px] text-center">In Transit</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-28 min-w-[105px] text-right">
                          {editingTransfer?.status === "IN_TRANSIT" && canUserReceive(editingTransfer)
                            ? "Qty. to Receive (Good)"
                            : "Qty. to Receive"}
                        </TableHead>
                        {editingTransfer && (
                          <TableHead className="h-auto px-2 py-2.5 w-28 min-w-[105px] text-right">
                            DOA / Loss Qty
                          </TableHead>
                        )}
                        <TableHead className="h-auto px-2 py-2.5 w-24 min-w-[95px] text-right">
                          {editingTransfer ? "Qty. Received (Good)" : "Quantity Received"}
                        </TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-20 min-w-[80px]">UOM</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-32 min-w-[120px]">Item Tracking</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-32 min-w-[125px]">Shipment Date</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-32 min-w-[125px]">Receipt Date</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 w-28 min-w-[105px] text-right">Amount</TableHead>
                        <TableHead className="h-auto px-2 py-2.5 min-w-[120px]">Line Notes</TableHead>
                        {!editingTransfer && <TableHead className="h-auto px-2 py-2.5 w-8 text-center"></TableHead>}
                      </tr>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line, idx) => {
                        const it = items.find((i) => i.item_id === line.item_id);
                        const isTracked = Boolean(it?.is_lot_tracked || it?.is_serial_tracked);
                        const trackingType = it?.is_lot_tracked ? "LOT" : it?.is_serial_tracked ? "SERIAL" : "NONE";
                        const isAssigned = trackingType === "LOT" ? Boolean(line.lot_no) : trackingType === "SERIAL" ? Boolean(line.serial_no) : false;
                        const bal = sourceBalances[line.item_id];
                        const availableQty = bal?.on_hand_qty || 0;
                        const unitRate = bal?.avg_cost || 0;
                        const lineValue = (Number(line.quantity) || 0) * unitRate;
                        const isExceeding =
                          Number(line.quantity) > 0 &&
                          line.maxQty !== undefined &&
                          Number(line.quantity) > Number(line.maxQty);

                        return (
                          <TableRow
                            key={idx}
                            onClick={() => setSelectedLineIdx(idx)}
                            className={`cursor-pointer transition-colors ${
                              selectedLineIdx === idx ? "bg-(--accent)/5 border-l-2 border-l-(--accent)" : ""
                            }`}
                          >
                            {/* Row number / selection indicator */}
                            <TableCell className="align-top px-2 py-2 text-center font-mono font-medium" style={S.muted}>
                              <div className="flex h-11 items-center justify-center">
                                <span className={selectedLineIdx === idx ? "font-bold text-(--accent)" : ""}>
                                  {idx + 1}
                                </span>
                              </div>
                            </TableCell>

                            {/* Item Code (SearchableSelect or read-only) */}
                            <TableCell className="align-top px-2 py-2 w-40 min-w-[140px]">
                              {!editingTransfer ? (
                                <SearchableSelect
                                  ariaLabel={`Select Item Code ${idx + 1}`}
                                  value={line.item_id}
                                  onChange={(val) => setLineField(idx, "item_id", val)}
                                  options={itemOptions}
                                  columns={[
                                    { key: "item_code", label: "Item Code" },
                                    { key: "item_name", label: "Description" },
                                    { key: "stock_display", label: "Available Stock" },
                                  ]}
                                  columnHeaders={["Item Code", "Description", "Available Stock"]}
                                  getLabel={(row: any) => row.item_code || ""}
                                  placeholder={
                                    !header.from_warehouse_id
                                      ? "Select source…"
                                      : loadingBalances
                                      ? "Loading…"
                                      : itemOptions.length === 0
                                      ? "No items"
                                      : "Select code…"
                                  }
                                  disabled={!header.from_warehouse_id || loadingBalances}
                                />
                              ) : (
                                <div className="flex h-11 items-center px-1 font-mono text-xs opacity-75">
                                  {it?.item_code || "—"}
                                </div>
                              )}
                            </TableCell>

                            {/* Item Description: Multi-column SearchableSelect with Stock Count or Display */}
                            <TableCell className="align-top px-3 py-2 min-w-[220px]">
                              <div className="flex flex-col gap-1">
                                {!editingTransfer ? (
                                  <SearchableSelect
                                    ariaLabel={`Select Item Description ${idx + 1}`}
                                    value={line.item_id}
                                    onChange={(val) => setLineField(idx, "item_id", val)}
                                    options={itemOptions}
                                    columns={[
                                      { key: "item_code", label: "Item Code" },
                                      { key: "item_name", label: "Description" },
                                      { key: "stock_display", label: "Available Stock" },
                                    ]}
                                    columnHeaders={["Item Code", "Description", "Available Stock"]}
                                    getLabel={(row: any) =>
                                      row.item_name
                                        ? `${row.item_name}`
                                        : ""
                                    }
                                    placeholder={
                                      !header.from_warehouse_id
                                        ? "Select source store first…"
                                        : loadingBalances
                                        ? "Loading stock balances…"
                                        : itemOptions.length === 0
                                        ? "No items in stock at this location"
                                        : "Search item description or code…"
                                    }
                                    disabled={!header.from_warehouse_id || loadingBalances}
                                  />
                                ) : (
                                  <span className="font-semibold text-xs py-2 block" style={S.primary}>
                                    {it?.item_name || notAvailable}
                                  </span>
                                )}
                                {line.item_id && (
                                  <div className="flex flex-col gap-0.5 text-[10px]">
                                    {!editingTransfer && (() => {
                                      const enteredQty = Number(line.quantity || 0);
                                      const remainingStock = Math.max(0, availableQty - enteredQty);
                                      const uomStr = line.uom || it?.uom_primary || "";
                                      const isOver = enteredQty > availableQty;

                                      if (availableQty <= 0) {
                                        return (
                                          <div className="flex items-center gap-1.5">
                                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-500 font-medium">
                                              <AlertTriangle className="h-3 w-3" />
                                              0 in stock at source store
                                            </span>
                                          </div>
                                        );
                                      }

                                      if (isOver) {
                                        return (
                                          <div className="flex items-center gap-1.5">
                                            <span className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-500 font-medium">
                                              <AlertTriangle className="h-3 w-3" />
                                              Exceeds in-hand stock by {(enteredQty - availableQty).toLocaleString()} {uomStr} (Available: {availableQty.toLocaleString()} {uomStr})
                                            </span>
                                          </div>
                                        );
                                      }

                                      if (enteredQty > 0) {
                                        return (
                                          <div className="flex items-center gap-1.5">
                                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                                              <CheckCircle2 className="h-3 w-3" />
                                              Remaining In-Hand: <strong className="font-semibold">{remainingStock.toLocaleString()} {uomStr}</strong>
                                              <span className="opacity-75">({enteredQty.toLocaleString()} of {availableQty.toLocaleString()} {uomStr})</span>
                                            </span>
                                          </div>
                                        );
                                      }

                                      return (
                                        <div className="flex items-center gap-1.5">
                                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                                            <CheckCircle2 className="h-3 w-3" />
                                            In Stock: {availableQty.toLocaleString()} {uomStr}
                                          </span>
                                        </div>
                                      );
                                    })()}
                                    {!editingTransfer && isTracked && !isAssigned && (
                                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                                        <AlertTriangle className="h-3 w-3" />
                                        Tracking required (click Item Tracking Lines above)
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </TableCell>

                            {/* Quantity (Ordered) */}
                            <TableCell className="align-top px-2 py-2 w-44 min-w-[160px]">
                              {!editingTransfer ? (
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="number"
                                      min="0"
                                      step="any"
                                      placeholder="0"
                                      value={line.quantity}
                                      disabled={!line.item_id}
                                      onChange={(e) => setLineField(idx, "quantity", e.target.value)}
                                      className={`${inputCls} flex-1 min-w-[75px] px-2.5 font-mono text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                                        isExceeding ? "border-amber-500 bg-amber-500/5 text-amber-500" : ""
                                      }`}
                                      style={isExceeding ? undefined : S.input}
                                    />
                                    {availableQty > 0 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const fillQty = line.maxQty !== undefined ? line.maxQty : availableQty;
                                          setLineField(idx, "quantity", fillQty.toString());
                                        }}
                                        title="Fill maximum available stock"
                                        className="shrink-0 h-11 rounded bg-(--surface-raised) border px-2.5 text-[11px] font-semibold text-(--accent) transition hover:bg-(--accent) hover:text-white"
                                      >
                                        Max
                                      </button>
                                    )}
                                  </div>
                                  {isExceeding && (
                                    <span className="text-[10px] text-amber-500 font-medium">
                                      Exceeds available ({line.maxQty} {line.uom})
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex h-11 items-center justify-end px-2 font-mono font-semibold text-xs" style={S.primary}>
                                  {line.quantity}
                                </div>
                              )}
                            </TableCell>

                            {/* Qty. to Ship (Business Central transfer line field - disabled to automatically ship all entered quantity) */}
                            <TableCell className="align-top px-2 py-2 w-36 min-w-[130px]">
                              {(() => {
                                const ordered = Number(line.quantity) || 0;
                                const shipped = Number(line.qty_shipped || 0);
                                const remainingToShip = Math.max(0, ordered - shipped);
                                const shipVal = !editingTransfer
                                  ? (line.quantity || "0")
                                  : (line.qty_to_ship !== undefined ? line.qty_to_ship : String(remainingToShip));

                                return (
                                  <div className="flex flex-col gap-1">
                                    <input
                                      type="number"
                                      readOnly
                                      disabled
                                      placeholder="0"
                                      value={shipVal}
                                      title="Disabled: all entered quantity is automatically shipped"
                                      className={`${inputCls} w-full px-2.5 font-mono text-xs text-right opacity-75 cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                                      style={S.surface}
                                    />
                                  </div>
                                );
                              })()}
                            </TableCell>

                            {/* Quantity Shipped */}
                            <TableCell className="align-top px-2 py-2 w-24 min-w-[95px]">
                              <div className="flex h-11 items-center justify-end font-mono text-xs" style={S.primary}>
                                {Number(line.qty_shipped || 0)}
                              </div>
                            </TableCell>

                            {/* In Transit */}
                            <TableCell className="align-top px-2 py-2 w-24 min-w-[95px]">
                              <div className="flex h-11 items-center justify-center font-mono text-xs">
                                {Number(line.qty_in_transit || 0) > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-500">
                                    <Truck className="h-3 w-3" />
                                    {Number(line.qty_in_transit).toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="opacity-40">0</span>
                                )}
                              </div>
                            </TableCell>

                            {/* Qty. to Receive / Qty. Received (Good) */}
                            <TableCell className="align-top px-2 py-2 w-28 min-w-[105px]">
                              {(() => {
                                const inTransit = Number(line.qty_in_transit || 0);
                                const canEditReceive = editingTransfer && canUserReceive(editingTransfer) && inTransit > 0;

                                if (!canEditReceive) {
                                  return (
                                    <div className="flex h-11 items-center justify-end px-1 font-mono text-xs opacity-60">
                                      {line.qty_to_receive ?? 0}
                                    </div>
                                  );
                                }

                                const recVal = line.qty_to_receive !== undefined ? line.qty_to_receive : inTransit;
                                const doaVal = Number(line.doa_quantity || 0);
                                const totalAccounted = Number(recVal || 0) + doaVal;
                                const isExceedingRec = totalAccounted > inTransit + 0.0001;

                                return (
                                  <div className="flex flex-col gap-1">
                                    <input
                                      type="number"
                                      min="0"
                                      max={inTransit}
                                      step="any"
                                      placeholder="0"
                                      value={recVal}
                                      onChange={(e) => {
                                        setLineField(idx, "qty_to_receive", e.target.value);
                                      }}
                                      className={`${inputCls} font-mono text-xs text-right border-emerald-500/60 bg-emerald-500/5 text-emerald-600 font-semibold focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                                        isExceedingRec ? "border-red-500 text-red-500" : ""
                                      }`}
                                    />
                                    <span className="text-[10px] text-(--text-muted) text-right">Good Qty</span>
                                  </div>
                                );
                              })()}
                            </TableCell>

                            {/* DOA / Waste Qty (In Transit Receiving or Audit View) */}
                            {editingTransfer && (
                              <TableCell className="align-top px-2 py-2 w-28 min-w-[105px]">
                                {(() => {
                                  const inTransit = Number(line.qty_in_transit || 0);
                                  const canEditReceive = editingTransfer && canUserReceive(editingTransfer) && inTransit > 0;

                                  if (!canEditReceive) {
                                    const doaVal = Number(line.doa_quantity || 0);
                                    return (
                                      <div className="flex h-11 items-center justify-end px-1 font-mono text-xs">
                                        {doaVal > 0 ? (
                                          <div className="flex flex-col items-end">
                                            <span className="font-bold text-amber-500">
                                              {doaVal.toLocaleString()}
                                            </span>
                                            <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">
                                              DOA (MRT-017)
                                            </span>
                                          </div>
                                        ) : (
                                          <span className="opacity-60">0</span>
                                        )}
                                      </div>
                                    );
                                  }

                                  const recVal = Number(line.qty_to_receive !== undefined ? line.qty_to_receive : inTransit);
                                  const doaVal = line.doa_quantity !== undefined ? line.doa_quantity : 0;
                                  const totalAccounted = recVal + Number(doaVal || 0);
                                  const isExceeding = totalAccounted > inTransit + 0.0001;

                                  return (
                                    <div className="flex flex-col gap-1">
                                      <input
                                        type="number"
                                        min="0"
                                        max={inTransit}
                                        step="any"
                                        placeholder="0"
                                        value={doaVal}
                                        onChange={(e) => {
                                          setLineField(idx, "doa_quantity", e.target.value);
                                        }}
                                        className={`${inputCls} font-mono text-xs text-right border-amber-500/60 bg-amber-500/5 text-amber-600 font-semibold focus:border-amber-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                                          isExceeding ? "border-red-500 text-red-500" : ""
                                        }`}
                                      />
                                      {Number(doaVal) > 0 ? (
                                        <span className="text-[9px] text-amber-500 font-medium text-right">
                                          Auto MRT-017
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-(--text-muted) text-right">DOA / Loss</span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </TableCell>
                            )}

                            {/* Quantity Received */}
                            <TableCell className="align-top px-2 py-2 w-24 min-w-[95px]">
                              <div
                                className={`flex h-11 items-center justify-end font-mono text-xs ${
                                  Number(line.qty_received || 0) > 0 ? "font-bold text-emerald-500" : "opacity-60"
                                }`}
                              >
                                {Number(line.qty_received || 0)}
                              </div>
                            </TableCell>

                            {/* UOM */}
                            <TableCell className="align-top px-2 py-2 w-24 min-w-[95px]">
                              {!editingTransfer ? (
                                <select
                                  value={line.uom}
                                  onChange={(e) => setLineField(idx, "uom", e.target.value)}
                                  className={`${inputCls} nf-select text-xs pl-2.5 pr-6`}
                                  style={S.input}
                                  disabled={!line.item_id}
                                >
                                  <option value="">Select</option>
                                  {uoms.map((u) => (
                                    <option key={u.uom_code} value={u.uom_code}>
                                      {u.uom_code}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="flex h-11 items-center font-mono text-xs opacity-75">
                                  {line.uom}
                                </div>
                              )}
                            </TableCell>

                            {/* Item Tracking */}
                            <TableCell className="align-top px-2 py-2 w-32 min-w-[120px]">
                              <div className="flex h-11 items-center">
                                {(() => {
                                  const serials = line.serial_no
                                    ? line.serial_no.split(",").map((s: string) => s.trim()).filter(Boolean)
                                    : [];
                                  if (serials.length > 0) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenItemTracking(idx);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 font-mono text-xs border border-sky-500/30 transition-colors"
                                        title="View Item Tracking Serial Numbers"
                                      >
                                        <Barcode className="h-3.5 w-3.5 shrink-0" />
                                        <span>{serials.length} {serials.length === 1 ? "Serial" : "Serials"}</span>
                                      </button>
                                    );
                                  }
                                  if (line.lot_no) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenItemTracking(idx);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 font-mono text-xs border border-amber-500/30 transition-colors"
                                        title="View Lot Tracking Specification"
                                      >
                                        <Barcode className="h-3.5 w-3.5 shrink-0" />
                                        <span className="truncate max-w-[90px]">Lot: {line.lot_no}</span>
                                      </button>
                                    );
                                  }
                                  if (isTracked && !editingTransfer) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenItemTracking(idx);
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs border border-amber-500/30 transition-colors"
                                      >
                                        <span>Assign</span>
                                      </button>
                                    );
                                  }
                                  return <span className="text-muted-foreground text-xs opacity-50">—</span>;
                                })()}
                              </div>
                            </TableCell>

                            {/* Shipment Date */}
                            <TableCell className="align-top px-2 py-2 w-32 min-w-[125px]">
                              {editingTransfer && editingTransfer.status !== "DRAFT" ? (
                                <div className="flex h-11 items-center font-mono text-xs opacity-75">
                                  {line.shipment_date || "—"}
                                </div>
                              ) : (
                                <input
                                  type="date"
                                  value={line.shipment_date}
                                  onChange={(e) => setLineField(idx, "shipment_date", e.target.value)}
                                  className={`${inputCls} text-xs`}
                                  style={S.input}
                                />
                              )}
                            </TableCell>

                            {/* Receipt Date */}
                            <TableCell className="align-top px-2 py-2 w-32 min-w-[125px]">
                              {editingTransfer && editingTransfer.status === "RECEIVED" ? (
                                <div className="flex h-11 items-center font-mono text-xs opacity-75">
                                  {line.receipt_date || "—"}
                                </div>
                              ) : (
                                <input
                                  type="date"
                                  value={line.receipt_date}
                                  onChange={(e) => setLineField(idx, "receipt_date", e.target.value)}
                                  className={`${inputCls} text-xs`}
                                  style={S.input}
                                />
                              )}
                            </TableCell>

                            {/* Valuation: Amount & Unit Rate */}
                            <TableCell className="align-top px-2 py-2 w-28 min-w-[105px] text-right font-mono">
                              <div className="flex h-11 flex-col items-end justify-center">
                                <span className="font-bold text-xs leading-tight text-(--accent)">
                                  ${lineValue.toFixed(2)}
                                </span>
                                <span className="text-[10px] leading-tight" style={S.muted}>
                                  @ ${unitRate.toFixed(2)} / {line.uom || "u"}
                                </span>
                              </div>
                            </TableCell>

                            {/* Line Remarks */}
                            <TableCell className="align-top px-2 py-2 min-w-[130px]">
                              <input
                                type="text"
                                placeholder="e.g. Sacks #1-100"
                                value={line.remarks}
                                onChange={(e) => setLineField(idx, "remarks", e.target.value)}
                                className={`${inputCls} text-xs`}
                                style={S.input}
                                disabled={Boolean(editingTransfer && editingTransfer.status === "RECEIVED")}
                              />
                            </TableCell>

                            {/* Delete line */}
                            {!editingTransfer && (
                              <TableCell className="align-top px-2 py-2 text-center">
                                <div className="flex h-11 items-center justify-center">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeLine(idx);
                                    }}
                                    type="button"
                                    title="Remove line"
                                    className="rounded-[var(--radius-xs)] p-1.5 transition hover:bg-(--danger-muted)"
                                    style={{ color: "var(--danger)" }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </table>
                </div>
              </div>

              {/* Summary Bar */}
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border p-3.5 shadow-2xs"
                style={S.raised}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-(--surface) border px-2.5 py-1 text-xs font-semibold" style={S.primary}>
                    <Building2 className="h-3.5 w-3.5" style={S.accent} />
                    {warehouseLabel(header.from_warehouse_id) || "Source Store"}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" style={S.muted} />
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500 font-semibold">
                    <Truck className="h-3 w-3" /> In-Transit
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" style={S.muted} />
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-(--surface) border px-2.5 py-1 text-xs font-semibold" style={S.primary}>
                    <Building2 className="h-3.5 w-3.5 text-emerald-500" />
                    {warehouseLabel(header.to_warehouse_id) || "Destination Store"}
                  </span>
                </div>

                <div className="flex items-center gap-6">
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>
                      Total Items
                    </span>
                    <span className="text-xs font-semibold" style={S.primary}>
                      {totalLineCount} SKUs
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>
                      Total Ordered
                    </span>
                    <span className="text-xs font-semibold font-mono" style={S.primary}>
                      {totalQuantity.toLocaleString()} Units
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>
                      {editingTransfer ? "Total In Transit" : "Total to Ship"}
                    </span>
                    <span className="text-xs font-semibold font-mono text-amber-500">
                      {(editingTransfer ? totalInTransitQuantity : totalShipQuantity).toLocaleString()} Units
                    </span>
                  </div>
                  {editingTransfer && (
                    <div className="flex flex-col text-right">
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>
                        Total Received
                      </span>
                      <span className="text-xs font-semibold font-mono text-emerald-500">
                        {totalReceivedQuantity.toLocaleString()} Units
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>
                      Est. Total Value
                    </span>
                    <span className="text-sm font-bold font-mono text-(--accent)">
                      ${totalEstimatedValue.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 4: Dedicated Transaction History (Shipment Dispatches & Receipt GRNs) */}
              {editingTransfer && editingTransfer.status !== "DRAFT" && (
                <div className="rounded-[var(--radius-md)] border p-4 shadow-2xs" style={S.raised}>
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4" style={S.accent} />
                      <h3 className="text-xs font-semibold uppercase tracking-wider" style={S.primary}>
                        Transaction History (Shipments &amp; Receipts)
                      </h3>
                    </div>
                    <span className="text-[11px]" style={S.muted}>
                      {(editingTransfer.ledgerEntries || []).length} Ledger Entry(ies)
                    </span>
                  </div>

                  {(() => {
                    const entries: any[] = editingTransfer.ledgerEntries || [];
                    const shipments = entries.filter((e) => e.transaction_type === "TRANSFER_SHIPMENT");
                    const receipts = entries.filter((e) => e.transaction_type === "TRANSFER_RECEIPT");

                    if (shipments.length === 0 && receipts.length === 0) {
                      return (
                        <div className="rounded-lg border border-dashed p-4 text-center text-xs" style={S.muted}>
                          No shipment dispatches or inbound receipts recorded yet.
                        </div>
                      );
                    }

                    return (
                      <div className="flex flex-col gap-4">
                        {/* Dispatches */}
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                            <Truck className="h-3.5 w-3.5" />
                            <span>Outbound Dispatches (Shipments) — {shipments.length}</span>
                          </div>
                          {shipments.length === 0 ? (
                            <p className="text-[11px] italic" style={S.muted}>No dispatch shipments recorded.</p>
                          ) : (
                            <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                              <table className="w-full border-collapse text-left text-xs">
                                <TableHeader>
                                  <tr className="border-b border-(--row-border)">
                                    <TableHead className="px-3 py-2">Posting Date</TableHead>
                                    <TableHead className="px-3 py-2">Item</TableHead>
                                    <TableHead className="px-3 py-2 text-right">Shipped Qty</TableHead>
                                    <TableHead className="px-3 py-2">UOM</TableHead>
                                    <TableHead className="px-3 py-2">Vehicle / Driver</TableHead>
                                    <TableHead className="px-3 py-2">Serials / Lots</TableHead>
                                    <TableHead className="px-3 py-2">Shipped By</TableHead>
                                  </tr>
                                </TableHeader>
                                <TableBody>
                                  {shipments.map((s, sIdx) => {
                                    const it = items.find((i) => i.item_id === s.item_id);
                                    const parsedRem = parseRemarksHelper(s.remarks || editingTransfer.remarks);
                                    const vehicle = parsedRem?.["Vehicle"] || header.vehicle_no || "—";
                                    const driver = parsedRem?.["Driver"] || header.driver_name || "—";
                                    const tracking = s.serial_no || s.lot_no || "—";

                                    return (
                                      <TableRow key={s.ledger_id || sIdx} className="border-b border-(--row-border)">
                                        <TableCell className="px-3 py-2 font-mono text-xs">{s.posting_date}</TableCell>
                                        <TableCell className="px-3 py-2 font-medium" style={S.primary}>
                                          {it?.item_code || notAvailable} {it?.item_name ? `— ${it.item_name}` : ""}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                                          {Math.abs(Number(s.quantity)).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="px-3 py-2">{s.uom}</TableCell>
                                        <TableCell className="px-3 py-2">
                                          {vehicle !== "—" || driver !== "—" ? `${vehicle} (${driver})` : "—"}
                                        </TableCell>
                                        <TableCell className="px-3 py-2 font-mono text-[11px] max-w-[200px] truncate" title={tracking}>
                                          {tracking}
                                        </TableCell>
                                        <TableCell className="px-3 py-2" style={S.sub}>
                                          {s.created_by_name || getUserDisplayName(s.created_by)}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </table>
                            </div>
                          )}
                        </div>

                        {/* Receipts */}
                        <div>
                          {(() => {
                            const rawReceipts = entries.filter((e) => e.transaction_type === "TRANSFER_RECEIPT");

                            // Deduplicate twin DOA entries: if a primary receipt already accounts for the DOA qty, skip the secondary DOA receipt entry
                            const primaryDoaKeys = new Set(
                              rawReceipts
                                .filter((r) => (r.external_reference_no || "").startsWith("DOA:"))
                                .map((r) => `${r.document_line_id || r.item_id}_${r.posting_date}`)
                            );

                            const receipts = rawReceipts.filter((r) => {
                              const isDoaTwin = r.external_reference_no === "DOA_IN_TRANSIT";
                              if (isDoaTwin && primaryDoaKeys.has(`${r.document_line_id || r.item_id}_${r.posting_date}`)) {
                                return false;
                              }
                              return true;
                            });

                            return (
                              <>
                                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                  <PackageCheck className="h-3.5 w-3.5" />
                                  <span>Inbound Receipts &amp; GRNs — {receipts.length}</span>
                                </div>
                                {receipts.length === 0 ? (
                                  <p className="text-[11px] italic" style={S.muted}>No receipt transactions posted yet.</p>
                                ) : (
                                  <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                                    <table className="w-full border-collapse text-left text-xs">
                                      <TableHeader>
                                        <tr className="border-b border-(--row-border)">
                                          <TableHead className="px-3 py-2">Posting Date</TableHead>
                                          <TableHead className="px-3 py-2">Item</TableHead>
                                          <TableHead className="px-3 py-2 text-right">Good Qty</TableHead>
                                          <TableHead className="px-3 py-2 text-right">DOA / Loss</TableHead>
                                          <TableHead className="px-3 py-2">UOM</TableHead>
                                          <TableHead className="px-3 py-2">Serials / Lots</TableHead>
                                          <TableHead className="px-3 py-2">Received By</TableHead>
                                          <TableHead className="px-3 py-2">Remarks</TableHead>
                                        </tr>
                                      </TableHeader>
                                      <TableBody>
                                        {receipts.map((r, rIdx) => {
                                          const it = items.find((i) => i.item_id === r.item_id);
                                          let doaVal = 0;
                                          if (r.external_reference_no?.startsWith("DOA:")) {
                                            const parsed = Number(r.external_reference_no.split(":")[1]);
                                            if (!isNaN(parsed) && parsed > 0) doaVal = parsed;
                                          } else if (r.doa_quantity) {
                                            doaVal = Number(r.doa_quantity);
                                          } else if (r.remarks) {
                                            const doaMatch = (r.remarks || "").match(/(\d+(?:\.\d+)?)\s*DOA/i);
                                            if (doaMatch) doaVal = Number(doaMatch[1]);
                                          }

                                          const isDoaOnlyTwin = r.external_reference_no === "DOA_IN_TRANSIT";
                                          const goodVal = isDoaOnlyTwin ? 0 : Number(r.quantity);
                                          const tracking = r.serial_no || r.lot_no || "—";
                                          const author = r.created_by_name || getUserDisplayName(r.created_by);
                                          const displayRemarks = doaVal > 0
                                            ? (r.remarks || `DOA in-transit loss auto-adjusted (${doaVal.toLocaleString()} ${r.uom || "units"}) [MRT-017]`)
                                            : (r.remarks || "—");

                                          return (
                                            <TableRow key={r.ledger_id || rIdx} className="border-b border-(--row-border)">
                                              <TableCell className="px-3 py-2 font-mono text-xs">{r.posting_date}</TableCell>
                                              <TableCell className="px-3 py-2 font-medium" style={S.primary}>
                                                {it?.item_code || notAvailable} {it?.item_name ? `— ${it.item_name}` : ""}
                                              </TableCell>
                                              <TableCell className="px-3 py-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                +{goodVal.toLocaleString()}
                                              </TableCell>
                                              <TableCell className="px-3 py-2 text-right font-mono">
                                                {doaVal > 0 ? (
                                                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                                    {doaVal.toLocaleString()} (DOA)
                                                  </span>
                                                ) : (
                                                  <span style={S.muted}>0</span>
                                                )}
                                              </TableCell>
                                              <TableCell className="px-3 py-2">{r.uom}</TableCell>
                                              <TableCell className="px-3 py-2 font-mono text-[11px] max-w-[200px] truncate" title={tracking}>
                                                {tracking}
                                              </TableCell>
                                              <TableCell className="px-3 py-2" style={S.sub}>{author}</TableCell>
                                              <TableCell className="px-3 py-2 text-[11px]" style={S.muted}>{displayRemarks}</TableCell>
                                            </TableRow>
                                          );
                                        })}
                                      </TableBody>
                                    </table>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </Dialog>

          {/* ========================================================================= */}
          {/* Item Tracking Lines Modal (Business Central Parity)                      */}
          {/* ========================================================================= */}
          {/* ========================================================================= */}
          {/* Item Tracking Lines Modal (Business Central Parity)                      */}
          {/* ========================================================================= */}
          <Dialog
            open={trackingModalOpen && trackingLineIdx !== null}
            onClose={() => setTrackingModalOpen(false)}
            title={
              editingTransfer
                ? `Item Tracking Specification — ${
                    items.find((i) => i.item_id === (trackingLineIdx !== null ? lines[trackingLineIdx]?.item_id : ""))
                      ?.item_code || "Line Tracking"
                  }`
                : `Item Tracking Lines — ${
                    items.find((i) => i.item_id === (trackingLineIdx !== null ? lines[trackingLineIdx]?.item_id : ""))
                      ?.item_code || "Select Item"
                  }`
            }
            description={
              editingTransfer
                ? `Inspection view of locked item tracking specification for transfer line #${(trackingLineIdx ?? 0) + 1}.`
                : "Assign lot or serial tracking specification to this transfer order line as per Business Central Item Tracking rules."
            }
            maxWidth="md"
            footer={
              editingTransfer ? (
                <div className="flex w-full items-center justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTrackingModalOpen(false)}
                    className="text-xs"
                  >
                    Close
                  </Button>
                </div>
              ) : (
                <div className="flex w-full items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTrackingModalOpen(false)}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (trackingLineIdx !== null && lines[trackingLineIdx]) {
                        const curLine = lines[trackingLineIdx];
                        const it = items.find((i) => i.item_id === curLine.item_id);
                        if (it?.is_serial_tracked && curLine.serial_no) {
                          const count = curLine.serial_no.split(",").map((s) => s.trim()).filter(Boolean).length;
                          if (count > 0 && curLine.quantity !== String(count)) {
                            setLines((prev) =>
                              prev.map((l, i) =>
                                i === trackingLineIdx
                                  ? {
                                      ...l,
                                      quantity: String(count),
                                      qty_to_ship: String(count),
                                      qty_shipped:
                                        l.qty_shipped !== undefined && Number(l.qty_shipped) > count
                                          ? String(count)
                                          : l.qty_shipped,
                                    }
                                  : l
                              )
                            );
                          }
                        }
                      }
                      setTrackingModalOpen(false);
                    }}
                    className="nf-btn-primary flex items-center gap-1.5 text-xs font-semibold"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Apply Tracking
                  </Button>
                </div>
              )
            }
          >
            {trackingLineIdx !== null && lines[trackingLineIdx] && (() => {
              const line = lines[trackingLineIdx];
              const it = items.find((i) => i.item_id === line.item_id);
              const trackingType = it?.is_lot_tracked ? "LOT" : it?.is_serial_tracked ? "SERIAL" : line.lot_no ? "LOT" : line.serial_no ? "SERIAL" : "NONE";
              const bal = sourceBalances[line.item_id];
              const availableQty = bal?.on_hand_qty || 0;

              if (editingTransfer) {
                const allSerials = (line.serial_no || "")
                  .split(",")
                  .map((s: string) => s.trim())
                  .filter(Boolean);
                const filteredSerials = trackingSearch
                  ? allSerials.filter((s: string) => s.toLowerCase().includes(trackingSearch.toLowerCase()))
                  : allSerials;
                const receivedCount = Number(line.qty_received || 0);

                return (
                  <div className="flex flex-col gap-4 text-xs">
                    {/* Summary Card */}
                    <div className="rounded-[var(--radius-md)] border p-3 grid grid-cols-2 sm:grid-cols-4 gap-2" style={S.raised}>
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Item</span>
                        <span className="font-semibold text-(--text-primary)">{it?.item_code || notAvailable}</span>
                        <p className="text-[11px] text-(--text-secondary) truncate">{it?.item_name || "—"}</p>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Route</span>
                        <span className="font-medium text-(--text-primary) text-[11px]">
                          {warehouseLabel(header.from_warehouse_id)} → {warehouseLabel(header.to_warehouse_id)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Lifecycle Quantities</span>
                        <div className="flex flex-col font-mono text-[11px]">
                          <span>Shipped: {Number(line.qty_shipped || line.quantity || 0)}</span>
                          <span className="text-emerald-500 font-semibold">Received (Good): {receivedCount}</span>
                          {Number(line.doa_quantity || 0) > 0 && (
                            <span className="text-amber-500 font-semibold">DOA / Loss: {Number(line.doa_quantity)}</span>
                          )}
                          <span className="text-amber-500 font-semibold">In Transit: {Number(line.qty_in_transit || 0)}</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Tracking Mode</span>
                        <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold">
                          <CheckCircle2 className="h-3 w-3" />
                          {trackingType === "LOT" ? "Lot Tracked" : trackingType === "SERIAL" ? "Serial Tracked" : "Untracked"}
                        </span>
                      </div>
                    </div>

                    {/* Inspection Content */}
                    {trackingType === "SERIAL" ? (
                      <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4" style={S.surface}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-(--text-primary)">
                              Assigned Serial Numbers ({allSerials.length})
                            </span>
                            <span className="text-[11px] text-(--text-muted)">
                              ({receivedCount} Received, {Math.max(0, allSerials.length - receivedCount)} In Transit)
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="Filter serials…"
                                value={trackingSearch}
                                onChange={(e) => setTrackingSearch(e.target.value)}
                                className="nf-input h-7 pl-7 pr-2 text-xs w-48"
                                style={S.input}
                              />
                              <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(allSerials.join(", "));
                                setCopiedTracking(true);
                                setTimeout(() => setCopiedTracking(false), 2000);
                              }}
                              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded border text-xs font-medium hover:bg-(--surface-raised) transition-colors"
                              style={S.surface}
                              title="Copy all serial numbers to clipboard"
                            >
                              {copiedTracking ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-500" />
                                  <span className="text-emerald-500">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3 text-(--accent)" />
                                  <span>Copy All</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {filteredSerials.length === 0 ? (
                          <div className="py-6 text-center text-xs text-(--text-muted)">
                            {allSerials.length === 0
                              ? "No serial numbers were captured for this line."
                              : `No serials matching "${trackingSearch}"`}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1">
                            {filteredSerials.map((s: string) => {
                              const originalIndex = allSerials.indexOf(s);
                              const isReceived = originalIndex >= 0 && originalIndex < receivedCount;

                              return (
                                <div
                                  key={s}
                                  className={`flex items-center justify-between rounded px-2.5 py-1.5 font-mono text-xs border ${
                                    isReceived
                                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                      : "bg-sky-500/10 border-sky-500/30 text-sky-400"
                                  }`}
                                >
                                  <span className="truncate">{s}</span>
                                  {isReceived ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-sans font-semibold shrink-0">
                                      <CheckCircle2 className="h-3 w-3" /> Received
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-sky-400 font-sans font-semibold shrink-0">
                                      <Truck className="h-3 w-3" /> In-Transit
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="flex items-center gap-2 rounded border border-sky-500/30 bg-sky-500/10 p-2 text-[11px] text-sky-400">
                          <Barcode className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Tracking specifications are locked after shipment posting to maintain audit trail integrity.
                          </span>
                        </div>
                      </div>
                    ) : trackingType === "LOT" ? (
                      <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4" style={S.surface}>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Assigned Lot #</span>
                            <span className="font-mono font-bold text-sm text-(--text-primary)">{line.lot_no || "—"}</span>
                          </div>
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-500 border border-amber-500/30">
                            <Barcode className="h-3.5 w-3.5" /> Lot Tracked
                          </span>
                        </div>
                        <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-500">
                          <Barcode className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Lot tracking specification is locked after shipment posting.
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 rounded border text-center text-xs text-(--text-muted)" style={S.surface}>
                        No item tracking numbers assigned to this line.
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div className="flex flex-col gap-4 text-xs">
                  {/* Summary Card */}
                  <div className="rounded-[var(--radius-md)] border p-3 grid grid-cols-2 sm:grid-cols-4 gap-2" style={S.raised}>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Item</span>
                      <span className="font-semibold text-(--text-primary)">{it?.item_code || "—"}</span>
                      <p className="text-[11px] text-(--text-secondary) truncate">{it?.item_name || "—"}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Transfer-from Location</span>
                      <span className="font-medium text-(--text-primary)">{warehouseLabel(header.from_warehouse_id)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Quantity to Track</span>
                      <span className="font-semibold font-mono text-(--text-primary)">{line.quantity || 0} {line.uom || it?.uom_primary || ""}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Tracking Specification</span>
                      <span className="inline-flex items-center gap-1 text-emerald-500 font-semibold">
                        <CheckCircle2 className="h-3 w-3" />
                        {trackingType === "LOT" ? "Lot Tracking" : "Serial Tracking"}
                      </span>
                    </div>
                  </div>

                  {/* Lot / Serial Picker Box */}
                  <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border p-4" style={S.surface}>
                    <label className="font-semibold text-(--text-primary) flex items-center justify-between">
                      <span>Select {trackingType === "LOT" ? "Lot Number" : "Serial Number"}</span>
                      {line.maxQty !== undefined && trackingType === "LOT" && (
                        <span className="text-[11px] text-emerald-500 font-medium">
                          Available in this Lot: {line.maxQty.toLocaleString()} {line.uom}
                        </span>
                      )}
                    </label>

                    <LotSerialPicker
                      itemId={line.item_id}
                      warehouseId={header.from_warehouse_id}
                      trackingType={trackingType}
                      value={trackingType === "LOT" ? line.lot_no : line.serial_no}
                      fullWidth
                      targetQuantity={Number(line.quantity) || undefined}
                      onChange={(val, opt: any) => {
                        if (trackingType === "LOT") {
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === trackingLineIdx
                                ? {
                                    ...l,
                                    lot_no: val,
                                    maxQty: opt?.remaining_quantity
                                      ? Number(opt.remaining_quantity)
                                      : availableQty,
                                  }
                                : l
                            )
                          );
                        } else {
                          const count = val ? val.split(",").map((s) => s.trim()).filter(Boolean).length : 0;
                          const newQty = count > 0 ? String(count) : "1";
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === trackingLineIdx
                                ? {
                                    ...l,
                                    serial_no: val,
                                    quantity: newQty,
                                    qty_to_ship: newQty,
                                    qty_shipped:
                                      l.qty_shipped !== undefined && Number(l.qty_shipped) > Number(newQty)
                                        ? newQty
                                        : l.qty_shipped,
                                    maxQty: count > 0 ? count : 1,
                                  }
                                : l
                            )
                          );
                        }
                      }}
                      disabled={!header.from_warehouse_id || !line.item_id}
                      placeholder={trackingType === "LOT" ? "Search or select Lot #…" : "Search or select Serial #…"}
                    />

                    {/* Current Selection Summary */}
                    <div className="mt-2 pt-2 border-t flex items-center justify-between text-[11px]" style={{ borderColor: "var(--border)" }}>
                      <span className="text-(--text-secondary)">
                        Assigned {trackingType === "LOT" ? "Lot" : "Serial"}:
                      </span>
                      <span className="font-mono font-bold text-(--text-primary)">
                        {(trackingType === "LOT" ? line.lot_no : line.serial_no) || "None (Click above to assign)"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </Dialog>

          {/* ========================================================================= */}
          {/* In-Transit Discrepancy Resolution Modal                                   */}
          {/* ========================================================================= */}
          <Dialog
            open={discrepancyModalOpen && !!editingTransfer}
            onClose={() => !resolvingDiscrepancy && setDiscrepancyModalOpen(false)}
            title="Resolve In-Transit Stock Discrepancy"
            description="Manage stranded, damaged, or unreceived in-transit inventory to balance the transit account and close the transfer order."
            maxWidth="md"
            footer={
              <div className="flex w-full items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDiscrepancyModalOpen(false)}
                  disabled={resolvingDiscrepancy}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleResolveDiscrepancy}
                  disabled={resolvingDiscrepancy}
                  className="bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 text-xs font-semibold"
                >
                  {resolvingDiscrepancy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {resolvingDiscrepancy ? "Resolving…" : "Confirm & Close Order"}
                </Button>
              </div>
            }
          >
            <div className="flex flex-col gap-4 text-xs">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-400">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-xs">
                      Remaining In-Transit Inventory: {totalInTransitQuantity.toLocaleString()} Units
                    </span>
                    <p className="text-[11px] opacity-90">
                      This order currently holds inventory in transit between{" "}
                      <strong>{warehouseLabel(header.from_warehouse_id)}</strong> and{" "}
                      <strong>{warehouseLabel(header.to_warehouse_id)}</strong>. To close the order, you must specify how the in-transit balance is settled.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action selection */}
              <div className="flex flex-col gap-2">
                <label className="font-semibold text-(--text-primary)">
                  Select Resolution Method:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label
                    className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                      discrepancyType === "WRITE_OFF"
                        ? "border-red-500/50 bg-red-500/10 text-red-400"
                        : "border-(--border) hover:bg-(--surface-raised) text-(--text-secondary)"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <input
                        type="radio"
                        name="discrepancyType"
                        checked={discrepancyType === "WRITE_OFF"}
                        onChange={() => setDiscrepancyType("WRITE_OFF")}
                        className="text-red-500"
                      />
                      <span>Write Off In-Transit Loss</span>
                    </div>
                    <p className="text-[11px] opacity-80 pl-5">
                      Account for lost, stolen, or damaged goods. Posts an inventory write-off (negative adjustment) at destination and closes order.
                    </p>
                  </label>

                  <label
                    className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                      discrepancyType === "RETURN"
                        ? "border-sky-500/50 bg-sky-500/10 text-sky-400"
                        : "border-(--border) hover:bg-(--surface-raised) text-(--text-secondary)"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <input
                        type="radio"
                        name="discrepancyType"
                        checked={discrepancyType === "RETURN"}
                        onChange={() => setDiscrepancyType("RETURN")}
                        className="text-sky-500"
                      />
                      <span>Return In-Transit to Source</span>
                    </div>
                    <p className="text-[11px] opacity-80 pl-5">
                      Driver returned remaining stock to source location. Restores stock at source warehouse and closes order.
                    </p>
                  </label>
                </div>
              </div>

              {/* Reason note */}
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-(--text-primary)">
                  Discrepancy Reason / Audit Note:
                </label>
                <textarea
                  rows={2}
                  value={discrepancyReason}
                  onChange={(e) => setDiscrepancyReason(e.target.value)}
                  placeholder="e.g. 40 units damaged in transit / verified by logistics supervisor"
                  className={`${inputCls} py-2`}
                  style={S.input}
                />
              </div>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}
