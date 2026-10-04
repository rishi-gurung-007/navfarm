"use client";

import { useEffect, useMemo, useState } from "react";
import { 
  Tag, 
  Search, 
  Check, 
  X, 
  Sparkles, 
  RotateCcw, 
  CheckCircle2, 
  Lock,
  Package,
  Loader2
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InlineAlert } from "@/components/ui/alert";
import { api } from "@/services/api-client";

type Row = Record<string, any>;

interface SerialOption {
  serial_no: string;
  expiry_date: string | null;
  posting_date: string;
  [key: string]: any;
}

interface AnimalSerialAssignmentModalProps {
  open: boolean;
  onClose: () => void;
  line: Row | null;
  animals: Row[];
  warehouseId?: string;
  currentAssignments: Record<string, string>; // animal_id -> serial_no
  onSaveAssignments: (assignments: Record<string, string>) => void;
  stageName?: string;
}

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
};

export default function AnimalSerialAssignmentModal({
  open,
  onClose,
  line,
  animals,
  warehouseId,
  currentAssignments,
  onSaveAssignments,
  stageName,
}: AnimalSerialAssignmentModalProps) {
  const [availableSerials, setAvailableSerials] = useState<SerialOption[]>([]);
  const [loadingSerials, setLoadingSerials] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [searchFilter, setSearchFilter] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "info" | "warning" } | null>(null);

  // Synchronize state when modal opens
  useEffect(() => {
    if (!open || !line) return;
    setAssignments({ ...currentAssignments });
    setFeedback(null);
    setSearchFilter("");

    if (!line.item_id) {
      setAvailableSerials([]);
      return;
    }

    let active = true;
    setLoadingSerials(true);

    const params = new URLSearchParams();
    params.set("item_id", line.item_id);
    if (warehouseId) params.set("warehouse_id", warehouseId);

    api
      .get(`/inventory-ledger/available-serials?${params.toString()}`)
      .then((res) => {
        if (!active) return;
        const list = unwrap<SerialOption[]>(res) || [];
        setAvailableSerials(list);
      })
      .catch((err) => {
        console.error("Failed to load available serials for animal assignment:", err);
        if (active) setAvailableSerials([]);
      })
      .finally(() => {
        if (active) setLoadingSerials(false);
      });

    return () => {
      active = false;
    };
  }, [open, line, warehouseId, currentAssignments]);

  const pendingAnimals = useMemo(() => {
    return animals.filter((a) => !a.is_posted);
  }, [animals]);

  const filteredAnimals = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return animals;
    return animals.filter(
      (a) =>
        a.animal_code?.toLowerCase().includes(q) ||
        (assignments[a.animal_id] || "").toLowerCase().includes(q)
    );
  }, [animals, searchFilter, assignments]);

  // Set of all currently assigned serials across animals in this modal
  const assignedSerialsSet = useMemo(() => {
    return new Set(Object.values(assignments).filter(Boolean));
  }, [assignments]);

  const assignedCount = useMemo(() => {
    return pendingAnimals.filter((a) => Boolean(assignments[a.animal_id])).length;
  }, [pendingAnimals, assignments]);

  // Auto-Assign (FIFO): Assign available serials sequentially to unassigned pending animals
  const handleAutoAssignFifo = () => {
    if (!availableSerials.length) {
      setFeedback({ message: "No available serial numbers found in stock.", type: "warning" });
      return;
    }

    const newAssignments = { ...assignments };
    let assignedNow = 0;
    let serialIdx = 0;

    // Filter available serials that are not already assigned to another animal
    const unassignedSerials = availableSerials.filter(
      (s) => !Object.values(newAssignments).includes(s.serial_no)
    );

    for (const animal of pendingAnimals) {
      if (newAssignments[animal.animal_id]) continue; // Already assigned
      if (serialIdx >= unassignedSerials.length) break; // Exhausted available serials

      newAssignments[animal.animal_id] = unassignedSerials[serialIdx].serial_no;
      serialIdx++;
      assignedNow++;
    }

    setAssignments(newAssignments);

    if (assignedNow === 0) {
      setFeedback({ message: "All pending animals already have serial numbers assigned.", type: "info" });
    } else if (serialIdx < unassignedSerials.length || assignedCount + assignedNow >= pendingAnimals.length) {
      setFeedback({
        message: `Auto-assigned ${assignedNow} serial number${assignedNow > 1 ? "s" : ""} in FIFO order.`,
        type: "success",
      });
    } else {
      setFeedback({
        message: `Assigned all ${assignedNow} available serials. ${pendingAnimals.length - (assignedCount + assignedNow)} animal(s) still require serials.`,
        type: "warning",
      });
    }
  };

  const handleClearAll = () => {
    const newAssignments = { ...assignments };
    for (const animal of pendingAnimals) {
      delete newAssignments[animal.animal_id];
    }
    setAssignments(newAssignments);
    setFeedback({ message: "Cleared all unposted serial assignments.", type: "info" });
  };

  const handleSelectSerial = (animalId: string, serialNo: string) => {
    setAssignments((prev) => {
      const next = { ...prev };
      if (!serialNo) {
        delete next[animalId];
      } else {
        next[animalId] = serialNo;
      }
      return next;
    });
  };

  const handleSave = () => {
    onSaveAssignments(assignments);
    onClose();
  };

  if (!open || !line) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Assign Serial Numbers to Animals"
      description={`Assign unique serial numbers for each animal receiving "${line.activity_name}".`}
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs" style={S.sub}>
            <span className="font-semibold" style={S.primary}>
              {assignedCount} of {pendingAnimals.length}
            </span>{" "}
            animals assigned ({availableSerials.length} available in stock)
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              className="gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply Serial Assignments</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Item & Stage Info Header */}
        <div
          className="p-3.5 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={S.raised}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                {line.activity_name}
              </span>
              <Badge variant="accent">SERIAL-TRACKED</Badge>
              {stageName && (
                <span className="text-xs font-medium" style={S.sub}>
                  · Stage: <strong>{stageName}</strong>
                </span>
              )}
            </div>
            <div className="text-sm font-semibold flex items-center gap-1.5" style={S.primary}>
              <Package className="w-4 h-4 text-[var(--text-muted)]" />
              <span>{line.item_label || line.item_name || "—"}</span>
              {line.uom && (
                <span className="text-xs font-mono font-normal" style={S.muted}>
                  ({line.uom})
                </span>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAutoAssignFifo}
              disabled={loadingSerials || availableSerials.length === 0}
              className="gap-1.5 text-xs font-medium"
              title="Assign available serial numbers sequentially to all pending animals"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Auto-Assign (FIFO)</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={assignedCount === 0}
              className="gap-1 text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </Button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <InlineAlert variant={feedback.type}>
            {feedback.message}
          </InlineAlert>
        )}

        {/* Search & Stats Filter */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search animal code or assigned serial…"
              className="w-full rounded-[var(--radius-sm)] border py-1.5 pl-8 pr-3 text-xs outline-none focus:border-[var(--accent)]"
              style={{
                backgroundColor: "var(--input-bg)",
                borderColor: "var(--input-border)",
                color: "var(--input-text)",
              }}
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                assignedCount === pendingAnimals.length && pendingAnimals.length > 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : assignedCount > 0
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                  : "bg-[var(--surface-raised)] text-[var(--text-secondary)] border-[var(--border)]"
              }`}
            >
              {assignedCount} / {pendingAnimals.length} Assigned
            </span>
          </div>
        </div>

        {/* Animals Serial Assignment Table */}
        <div
          className="rounded-lg border overflow-hidden max-h-[360px] overflow-y-auto"
          style={S.surface}
        >
          {loadingSerials ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs" style={S.muted}>
              <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
              <span>Loading available stock serial numbers…</span>
            </div>
          ) : filteredAnimals.length === 0 ? (
            <div className="py-10 text-center text-xs" style={S.muted}>
              No animals found matching search.
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead
                className="sticky top-0 z-10 border-b text-[10px] font-bold uppercase tracking-wider select-none"
                style={{
                  backgroundColor: "var(--surface-raised)",
                  borderColor: "var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                <tr>
                  <th className="px-3 py-2 w-12 text-center">#</th>
                  <th className="px-3 py-2 w-48">Animal Code</th>
                  <th className="px-3 py-2 w-28">Status</th>
                  <th className="px-3 py-2">Assigned Serial Number</th>
                  <th className="px-3 py-2 w-28 text-right">Expiry Date</th>
                  <th className="px-3 py-2 w-12 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filteredAnimals.map((animal, idx) => {
                  const isPosted = Boolean(animal.is_posted);
                  const assignedSerial = assignments[animal.animal_id] || "";
                  const selectedOption = availableSerials.find((s) => s.serial_no === assignedSerial);
                  const expiryText = selectedOption?.expiry_date
                    ? String(selectedOption.expiry_date).slice(0, 10)
                    : "—";

                  return (
                    <tr
                      key={animal.animal_id}
                      className="hover:bg-[var(--surface-secondary)] transition-colors"
                      style={isPosted ? { opacity: 0.75 } : undefined}
                    >
                      <td className="px-3 py-2 text-center text-[var(--text-muted)] font-mono text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 font-mono font-semibold" style={S.primary}>
                          <Tag className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          <span>{animal.animal_code}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {isPosted ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Posted
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--text-secondary)]">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isPosted ? (
                          <div className="flex items-center gap-1.5 font-mono text-xs" style={S.sub}>
                            <Lock className="w-3 h-3 text-[var(--text-muted)]" />
                            <span>{assignedSerial || "—"}</span>
                          </div>
                        ) : (
                          <select
                            value={assignedSerial}
                            onChange={(e) => handleSelectSerial(animal.animal_id, e.target.value)}
                            className="nf-input-sm w-full font-mono text-xs rounded border px-2 py-1 outline-none focus:border-[var(--accent)]"
                            style={{
                              backgroundColor: "var(--input-bg)",
                              borderColor: assignedSerial ? "var(--accent)" : "var(--input-border)",
                              color: assignedSerial ? "var(--text-primary)" : "var(--text-muted)",
                            }}
                          >
                            <option value="">-- Select Serial No. --</option>
                            {availableSerials.map((s) => {
                              const isTaken = assignedSerialsSet.has(s.serial_no) && s.serial_no !== assignedSerial;
                              const exp = s.expiry_date ? ` (Exp: ${String(s.expiry_date).slice(0, 10)})` : "";
                              return (
                                <option
                                  key={s.serial_no}
                                  value={s.serial_no}
                                  disabled={isTaken}
                                >
                                  {s.serial_no}
                                  {exp}
                                  {isTaken ? " — [Already Assigned]" : ""}
                                </option>
                              );
                            })}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px]" style={S.sub}>
                        {expiryText}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {!isPosted && assignedSerial && (
                          <button
                            type="button"
                            onClick={() => handleSelectSerial(animal.animal_id, "")}
                            className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--danger)]"
                            title="Remove assignment"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Dialog>
  );
}
