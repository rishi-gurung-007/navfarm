"use client";

import React, { useEffect, useState, useMemo } from "react";
import { api } from "@/services/api-client";
import { SearchableSelect } from "@/components/ui/searchable-select";

export interface LotOption {
  [key: string]: any;
  lot_no: string;
  remaining_quantity: string;
  expiry_date: string | null;
  posting_date: string;
}

export interface SerialOption {
  [key: string]: any;
  serial_no: string;
  posting_date: string;
}

export interface LotSerialPickerProps {
  itemId: string;
  warehouseId?: string;
  trackingType: "LOT" | "SERIAL" | "NONE";
  value: string;
  onChange: (value: string, selectedOption?: LotOption | SerialOption) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

export function LotSerialPicker({
  itemId,
  warehouseId,
  trackingType,
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  triggerClassName,
  triggerStyle,
}: LotSerialPickerProps) {
  const [options, setOptions] = useState<Array<LotOption | SerialOption>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!itemId || trackingType === "NONE") {
      setOptions([]);
      return;
    }

    let active = true;
    setLoading(true);

    const endpoint =
      trackingType === "LOT"
        ? "/inventory-ledger/available-lots"
        : "/inventory-ledger/available-serials";

    const params = new URLSearchParams();
    params.set("item_id", itemId);
    if (warehouseId) {
      params.set("warehouse_id", warehouseId);
    }

    api
      .get(`${endpoint}?${params.toString()}`)
      .then((res) => {
        if (!active) return;
        const list = unwrap<any[]>(res) || [];
        setOptions(list);
      })
      .catch((err) => {
        console.error("Failed to load available lots/serials:", err);
        if (active) setOptions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [itemId, warehouseId, trackingType]);

  const valueKey = trackingType === "LOT" ? "lot_no" : "serial_no";

  const columnHeaders = useMemo(() => {
    if (trackingType === "LOT") {
      return ["Lot No.", "Available", "Expiry"];
    }
    return ["Serial No.", "Date"];
  }, [trackingType]);

  const getLabel = (row: any) => {
    if (trackingType === "LOT") {
      return row.lot_no || "";
    }
    return row.serial_no || "";
  };

  const getLabelParts = (row: any) => {
    if (trackingType === "LOT") {
      const exp = row.expiry_date ? String(row.expiry_date).slice(0, 10) : "—";
      return [row.lot_no || "", `${row.remaining_quantity ?? "0"}`, exp];
    }
    const d = row.posting_date ? String(row.posting_date).slice(0, 10) : "—";
    return [row.serial_no || "", d];
  };

  const defaultPlaceholder = !itemId
    ? "Select item first…"
    : loading
    ? "Loading options…"
    : options.length === 0
    ? `No available ${trackingType.toLowerCase()}s`
    : `Select ${trackingType.toLowerCase()}…`;

  return (
    <SearchableSelect
      ariaLabel={ariaLabel || `Select ${trackingType}`}
      value={value}
      onChange={(val) => {
        const match = options.find(
          (o: any) => (trackingType === "LOT" ? o.lot_no : o.serial_no) === val
        );
        onChange(val, match);
      }}
      options={options}
      valueKey={valueKey}
      getLabel={getLabel}
      getLabelParts={getLabelParts}
      columnHeaders={columnHeaders}
      placeholder={placeholder || defaultPlaceholder}
      searchPlaceholder={`Search ${trackingType.toLowerCase()}…`}
      noMatchesLabel={`No matching ${trackingType.toLowerCase()}s`}
      disabled={disabled || !itemId || (options.length === 0 && !loading && !value)}
      loading={loading}
      onClear={() => onChange("", undefined)}
      triggerClassName={triggerClassName}
      triggerStyle={triggerStyle}
    />
  );
}
