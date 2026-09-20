"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Hash,
  RefreshCw,
  Search,
  Building2,
  Sliders,
  Plus,
  Save,
  RotateCcw,
  Sparkles,
  CheckSquare,
  Square,
  AlertCircle,
  X,
  Info,
} from "lucide-react";
import { api } from "@/services/api-client";
import { getStoredUser, getActiveCompanyId, setActiveCompanyId } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { Toast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

export interface MasterMeta {
  key: string;
  label: string;
  description: string;
  category: string;
}

export interface NoSeriesRow {
  id: string;
  code: string;
  description: string | null;
  document_type: string | null;
  no_series_code: string | null;
  seq_length: number;
  increment_by: number;
  is_default: boolean;
  manual_nos: boolean;
  last_no_used: string | null;
  blocked: boolean;
}

export interface NumberingConfigItem {
  enabled: boolean;
  default_series_id: string | null;
  series_count: number;
}

export interface GeneralConfig {
  automatic_cost_posting?: boolean;
  expected_cost_posting?: boolean;
  default_costing_method?: string;
  prevent_negative_inventory?: boolean;
  location_mandatory?: boolean;
}

export interface InventorySetupResponse {
  company_id: string;
  setup_id: string | null;
  numbering_config: Record<string, NumberingConfigItem>;
  general_config: GeneralConfig;
  series_by_master: Record<string, NoSeriesRow[]>;
  available_masters: MasterMeta[];
  updated_at: string | null;
}

function unwrap(res: any): any {
  return res?.data ?? res;
}

export default function InventorySetupPage() {
  const user = getStoredUser();
  const companies = user?.companies || [];
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    return getActiveCompanyId() || companies[0]?.company_id || "";
  });

  const [activeTab, setActiveTab] = useState<"numbering" | "general">("numbering");
  const [setupData, setSetupData] = useState<InventorySetupResponse | null>(null);
  const [localNumbering, setLocalNumbering] = useState<Record<string, { enabled: boolean; default_series_id: string | null }>>({});
  const [localGeneral, setLocalGeneral] = useState<GeneralConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Search filter
  const [search, setSearch] = useState("");

  // Quick Add Series Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMasterKey, setModalMasterKey] = useState<string | null>(null);
  const [newSeriesCode, setNewSeriesCode] = useState("");
  const [newSeriesPrefix, setNewSeriesPrefix] = useState("");
  const [newSeriesDigits, setNewSeriesDigits] = useState("4");
  const [newSeriesManual, setNewSeriesManual] = useState(false);
  const [modalCreating, setModalCreating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const activeCompanyName = useMemo(() => {
    return companies.find((c) => c.company_id === selectedCompanyId)?.company_name || "Active Company";
  }, [companies, selectedCompanyId]);

  // Load setup data
  const load = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/inventory-setup?companyId=${selectedCompanyId}`);
      const data = unwrap(res) as InventorySetupResponse;
      setSetupData(data);

      const numMap: Record<string, { enabled: boolean; default_series_id: string | null }> = {};
      for (const [k, v] of Object.entries(data.numbering_config || {})) {
        numMap[k] = {
          enabled: v.enabled,
          default_series_id: v.default_series_id,
        };
      }
      setLocalNumbering(numMap);
      setLocalGeneral(data.general_config || {});
    } catch (err: any) {
      setError(err?.message || "Failed to load Inventory Setup.");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Track if changes are unsaved
  const isDirty = useMemo(() => {
    if (!setupData) return false;
    for (const [k, v] of Object.entries(setupData.numbering_config || {})) {
      const cur = localNumbering[k];
      if (!cur) continue;
      if (cur.enabled !== v.enabled || cur.default_series_id !== v.default_series_id) {
        return true;
      }
    }
    const savedGen = setupData.general_config || {};
    for (const [k, val] of Object.entries(localGeneral)) {
      if ((savedGen as any)[k] !== val) return true;
    }
    return false;
  }, [setupData, localNumbering, localGeneral]);

  // Switch company context
  const handleCompanyChange = (newCompanyId: string) => {
    if (newCompanyId === selectedCompanyId) return;
    if (isDirty && !window.confirm("You have unsaved changes. Discard and switch company?")) {
      return;
    }
    setSelectedCompanyId(newCompanyId);
    setActiveCompanyId(newCompanyId);
  };

  // Toggle "Applies To" dropdown inclusion
  const handleToggleEnabled = (masterKey: string) => {
    setLocalNumbering((prev) => {
      const current = prev[masterKey];
      const seriesList = setupData?.series_by_master[masterKey] || [];
      const newEnabled = !current?.enabled;
      let newDefault = current?.default_series_id;

      if (newEnabled && !newDefault && seriesList.length > 0) {
        const def = seriesList.find((s) => s.is_default) || seriesList[0];
        newDefault = def.id;
      }

      return {
        ...prev,
        [masterKey]: {
          enabled: newEnabled,
          default_series_id: newEnabled ? newDefault : current?.default_series_id || null,
        },
      };
    });
  };

  // Change default series for master
  const handleDefaultSeriesChange = (masterKey: string, seriesId: string) => {
    if (seriesId === "__CREATE_NEW__") {
      handleOpenNewSeriesModal(masterKey);
      return;
    }
    setLocalNumbering((prev) => ({
      ...prev,
      [masterKey]: {
        enabled: true, // auto-select in dropdown if a default series is chosen
        default_series_id: seriesId || null,
      },
    }));
  };

  // Bulk enable / disable
  const handleBulkToggle = (enableAll: boolean) => {
    if (!setupData?.available_masters) return;
    setLocalNumbering((prev) => {
      const next = { ...prev };
      for (const m of setupData.available_masters) {
        const cur = next[m.key];
        const seriesList = setupData.series_by_master[m.key] || [];
        const def = seriesList.find((s) => s.is_default) || seriesList[0];
        next[m.key] = {
          enabled: enableAll,
          default_series_id: enableAll ? (cur?.default_series_id || def?.id || null) : null,
        };
      }
      return next;
    });
  };

  // Discard changes
  const handleDiscard = () => {
    if (!setupData) return;
    const numMap: Record<string, { enabled: boolean; default_series_id: string | null }> = {};
    for (const [k, v] of Object.entries(setupData.numbering_config || {})) {
      numMap[k] = {
        enabled: v.enabled,
        default_series_id: v.default_series_id,
      };
    }
    setLocalNumbering(numMap);
    setLocalGeneral(setupData.general_config || {});
  };

  // Save changes
  const handleSave = async () => {
    if (!selectedCompanyId) return;
    setSaving(true);
    try {
      const payload = {
        company_id: selectedCompanyId,
        numbering_config: localNumbering,
        general_config: localGeneral,
      };
      await api.put("/inventory-setup", payload);
      setToast({ type: "success", message: `Inventory Setup for ${activeCompanyName} saved successfully.` });
      await load();
    } catch (err: any) {
      setToast({ type: "error", message: err?.message || "Failed to save Inventory Setup." });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  // Quick Add Series Modal
  const handleOpenNewSeriesModal = (masterKey: string) => {
    setModalMasterKey(masterKey);
    const cleanKey = masterKey.replace(/_/g, "");
    setNewSeriesCode(`NS-${cleanKey.slice(0, 8)}`);
    setNewSeriesPrefix(`${cleanKey.slice(0, 3)}-`);
    setNewSeriesDigits("4");
    setNewSeriesManual(false);
    setModalError(null);
    setModalOpen(true);
  };

  const handleCreateSeries = async () => {
    if (!modalMasterKey || !newSeriesCode.trim()) {
      setModalError("Series Code is required.");
      return;
    }
    setModalCreating(true);
    setModalError(null);
    try {
      const res: any = await api.post("/no-series", {
        code: newSeriesCode.trim().toUpperCase(),
        document_type: modalMasterKey,
        no_series_code: newSeriesPrefix.trim().toUpperCase(),
        seq_length: parseInt(newSeriesDigits, 10) || 4,
        increment_by: 1,
        is_default: true,
        manual_nos: newSeriesManual,
        company_id: selectedCompanyId,
      });
      const created = unwrap(res);

      // Immediately persist this newly created series as default in inventory_setup
      const updatedNumbering = {
        ...localNumbering,
        [modalMasterKey]: {
          enabled: true,
          default_series_id: created.id,
        },
      };

      await api.put("/inventory-setup", {
        company_id: selectedCompanyId,
        numbering_config: updatedNumbering,
        general_config: localGeneral,
      });

      setLocalNumbering(updatedNumbering);
      setToast({ type: "success", message: `Series ${created.code} created and set as default for ${modalMasterKey}.` });
      setModalOpen(false);
      await load();
    } catch (err: any) {
      setModalError(err?.message || "Failed to create series.");
    } finally {
      setModalCreating(false);
    }
  };

  // Filtered masters list
  const filteredMasters = useMemo(() => {
    if (!setupData?.available_masters) return [];
    if (!search.trim()) return setupData.available_masters;
    const q = search.toLowerCase();
    return setupData.available_masters.filter(
      (m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q)
    );
  }, [setupData, search]);

  // Active in dropdown count
  const activeInDropdownCount = useMemo(() => {
    return Object.values(localNumbering).filter((v) => v.enabled).length;
  }, [localNumbering]);

  return (
    <ConsolePage>
      {/* Top Header */}
      <PageHeader
        title="Inventory Setup"
        description="Manage which masters appear in the 'Applies To (Master)*' dropdown when adding Number Series, and choose default series per company."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading || saving}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={loading || saving || !isDirty}
              className={isDirty ? "ring-2 ring-offset-1 ring-emerald-500 font-semibold" : ""}
            >
              <Save size={14} className={saving ? "animate-spin" : ""} />
              {saving ? "Saving..." : isDirty ? "Save Changes" : "Saved"}
            </Button>
          </div>
        }
      />

      {/* Company Scope & Simple Switcher */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <Building2 size={18} className="text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Active Company:
          </span>
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {activeCompanyName}
          </span>
        </div>

        {companies.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)]">Switch Company:</span>
            <select
              value={selectedCompanyId}
              onChange={(e) => handleCompanyChange(e.target.value)}
              className="nf-input nf-select text-xs py-1.5 px-3 min-w-[200px]"
            >
              {companies.map((c) => (
                <option key={c.company_id} value={c.company_id}>
                  {c.company_name} {c.is_primary ? "(Primary)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Toast feedback */}
      {toast && (
        <Toast
          variant={toast.type === "error" ? "danger" : "success"}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Unsaved Changes Banner */}
      {isDirty && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Unsaved changes for <strong className="text-[var(--text-primary)]">{activeCompanyName}</strong>.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleDiscard}>
              <RotateCcw size={13} />
              Discard
            </Button>
            <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
              <Save size={13} className={saving ? "animate-spin" : ""} />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      )}

      {/* Simple Clean Tabs */}
      <div className="mb-5 flex items-center gap-2 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={() => setActiveTab("numbering")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "numbering"
              ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Hash size={16} />
          Number Series Setup
          <span className="ml-1 rounded-full bg-[var(--surface-secondary)] px-2 py-0.5 text-xs text-[var(--text-primary)] border border-[var(--border)] font-semibold">
            {activeInDropdownCount} in Dropdown
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "general"
              ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Sliders size={16} />
          General Controls
        </button>
      </div>

      {/* TAB 1: NUMBER SERIES SETUP */}
      {activeTab === "numbering" && (
        <div className="space-y-4">
          {/* Helpful Explanation Notice */}
          <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-xs text-[var(--text-secondary)]">
            <Info size={16} className="text-[var(--accent)] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-[var(--text-primary)]">
                Manage "Applies To (Master)*" Dropdown & Default Number Series
              </p>
              <p className="text-[var(--text-secondary)]">
                Only masters marked <strong className="text-[var(--text-primary)]">"Included"</strong> will appear in the <strong className="text-[var(--text-primary)]">Applies To (Master)*</strong> dropdown when adding a new Number Series in Master Data. Select or add a default number series to auto-populate codes when creating records for each master.
              </p>
            </div>
          </div>

          {/* Simple Search, Filters & Bulk Action Toolbar */}
          <div className="flex flex-col gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search master (e.g. Item, Supplier)..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] py-1.5 pl-8 pr-8 text-xs text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] focus:outline-none focus:border-[var(--input-border-focus)] focus:ring-1 focus:ring-[var(--input-border-focus)]"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Bulk Toggle Buttons */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleBulkToggle(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--row-hover)] transition-colors font-medium"
                >
                  <CheckSquare size={14} className="text-emerald-600" />
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkToggle(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--row-hover)] transition-colors font-medium"
                >
                  <Square size={14} className="text-[var(--text-muted)]" />
                  Deselect All
                </button>
                <span className="text-[11px] text-[var(--text-secondary)] ml-2 font-medium">
                  {activeInDropdownCount} of {setupData?.available_masters.length || 0} active
                </span>
              </div>
            </div>
          </div>

          {/* Loading / Error States */}
          {loading && <LoadingState label="Loading Number Series setup..." />}
          {!loading && error && <ErrorState message={error} onRetry={load} />}

          {!loading && !error && filteredMasters.length === 0 && (
            <EmptyState
              title="No master entities found"
              description="Try adjusting your search query."
              action={{
                label: "Clear Search",
                onClick: () => setSearch(""),
              }}
            />
          )}

          {/* Clean, Simple Table */}
          {!loading && !error && filteredMasters.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--row-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)] font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4 w-52">
                      Applies To (Master)*
                    </th>
                    <th className="py-3 px-4">
                      Master Entity
                    </th>
                    <th className="py-3 px-4 w-80">
                      Default Number Series
                    </th>
                    <th className="py-3 px-4 w-40 text-center">
                      Code Preview
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--row-border)]">
                  {filteredMasters.map((master) => {
                    const masterKey = master.key;
                    const cfg = localNumbering[masterKey] || { enabled: false, default_series_id: null };
                    const seriesList = setupData?.series_by_master[masterKey] || [];
                    const selectedSeries = seriesList.find((s) => s.id === cfg.default_series_id);

                    // Preview code calculation
                    let previewCode = "—";
                    if (selectedSeries) {
                      const prefix = selectedSeries.no_series_code || `${selectedSeries.code}-`;
                      const digits = selectedSeries.seq_length || 4;
                      let nextNum = 1;
                      if (selectedSeries.last_no_used) {
                        const match = selectedSeries.last_no_used.match(/(\d+)$/);
                        if (match) nextNum = parseInt(match[1], 10) + (selectedSeries.increment_by || 1);
                      }
                      previewCode = `${prefix}${String(nextNum).padStart(digits, "0")}`;
                    }

                    return (
                      <tr
                        key={masterKey}
                        className={`border-b border-[var(--row-border)] transition-colors hover:bg-[var(--row-hover)] ${
                          cfg.enabled ? "" : "opacity-60 bg-[var(--row-hover)]/40"
                        }`}
                      >
                        {/* 1. Toggle: In "Applies To" Dropdown */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5 select-none">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={cfg.enabled}
                              onClick={() => handleToggleEnabled(masterKey)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                cfg.enabled ? "bg-emerald-600" : "bg-gray-300 dark:bg-gray-700"
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  cfg.enabled ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                            <span
                              onClick={() => handleToggleEnabled(masterKey)}
                              className={`font-medium text-xs cursor-pointer ${
                                cfg.enabled ? "text-emerald-700 dark:text-emerald-400 font-semibold" : "text-[var(--text-muted)]"
                              }`}
                            >
                              {cfg.enabled ? "In Dropdown" : "Hidden"}
                            </span>
                          </div>
                        </td>

                        {/* 2. Master Entity Name & Code */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-[var(--text-primary)]">
                              {master.label}
                            </span>
                            <span className="rounded bg-[var(--surface-secondary)] border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                              {masterKey}
                            </span>
                          </div>
                        </td>

                        {/* 3. Default Series Dropdown & Quick Add */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            {seriesList.length > 0 ? (
                              <select
                                value={cfg.default_series_id || ""}
                                onChange={(e) => handleDefaultSeriesChange(masterKey, e.target.value)}
                                disabled={!cfg.enabled}
                                className="w-full nf-input nf-select text-xs py-1 px-2.5 font-medium disabled:opacity-40"
                              >
                                <option value="">-- No default series --</option>
                                {seriesList.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.code} ({s.no_series_code || s.code} · {s.seq_length} digits)
                                  </option>
                                ))}
                                <option value="__CREATE_NEW__">+ Add New Series for {master.label}...</option>
                              </select>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenNewSeriesModal(masterKey)}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-dashed border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 text-xs font-medium transition-colors"
                              >
                                <Plus size={13} />
                                Add Default Series
                              </button>
                            )}

                            {seriesList.length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleOpenNewSeriesModal(masterKey)}
                                title={`Add new series for ${master.label}`}
                                className="p-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors shrink-0"
                              >
                                <Plus size={13} />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 4. Live Code Preview */}
                        <td className="py-3 px-4 text-center">
                          {cfg.enabled && selectedSeries ? (
                            <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold px-2.5 py-0.5 rounded bg-[var(--surface-secondary)] border border-[var(--border)] text-[var(--accent)]">
                              <Sparkles size={11} />
                              {previewCode}
                            </span>
                          ) : (
                            <span className="text-[11px] text-[var(--text-muted)] font-mono">
                              {cfg.enabled ? "Manual / None" : "Hidden"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: GENERAL CONTROLS */}
      {activeTab === "general" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4 max-w-2xl">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Inventory Control Policies</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              High-level constraints governing inventory transactions for {activeCompanyName}.
            </p>
          </div>

          <div className="divide-y divide-[var(--border)] space-y-3 pt-2">
            <div className="flex items-center justify-between gap-4 pt-3">
              <div>
                <div className="text-xs font-medium text-[var(--text-primary)]">
                  Prevent Negative Inventory
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Disallow transactions that would result in negative on-hand stock.
                </div>
              </div>
              <input
                type="checkbox"
                checked={localGeneral.prevent_negative_inventory ?? true}
                onChange={(e) => setLocalGeneral((prev) => ({ ...prev, prevent_negative_inventory: e.target.checked }))}
                className="rounded border-[var(--input-border)] text-[var(--accent)] h-4 w-4 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-4 pt-3">
              <div>
                <div className="text-xs font-medium text-[var(--text-primary)]">
                  Automatic Cost Posting
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Post inventory cost automatically to General Ledger on transaction save.
                </div>
              </div>
              <input
                type="checkbox"
                checked={localGeneral.automatic_cost_posting ?? true}
                onChange={(e) => setLocalGeneral((prev) => ({ ...prev, automatic_cost_posting: e.target.checked }))}
                className="rounded border-[var(--input-border)] text-[var(--accent)] h-4 w-4 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-4 pt-3">
              <div>
                <div className="text-xs font-medium text-[var(--text-primary)]">
                  Location Mandatory
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Enforce location entry on all goods receipts, issues, and adjustments.
                </div>
              </div>
              <input
                type="checkbox"
                checked={localGeneral.location_mandatory ?? false}
                onChange={(e) => setLocalGeneral((prev) => ({ ...prev, location_mandatory: e.target.checked }))}
                className="rounded border-[var(--input-border)] text-[var(--accent)] h-4 w-4 cursor-pointer"
              />
            </div>

            <div className="pt-3">
              <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">
                Default Valuation Method
              </label>
              <select
                value={localGeneral.default_costing_method || "FIFO"}
                onChange={(e) => setLocalGeneral((prev) => ({ ...prev, default_costing_method: e.target.value }))}
                className="w-full max-w-xs nf-input nf-select text-xs py-1.5"
              >
                <option value="FIFO">FIFO (First In, First Out)</option>
                <option value="AVERAGE">Average Costing</option>
                <option value="STANDARD">Standard Costing</option>
                <option value="LIFO">LIFO (Last In, First Out)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Quick Create Series */}
      {modalOpen && (
        <Dialog
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={`Create Number Series for ${setupData?.available_masters.find((m) => m.key === modalMasterKey)?.label || modalMasterKey}`}
          description={`Add a new sequence for ${modalMasterKey} and set it as the default series for ${activeCompanyName}.`}
          maxWidth="sm"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)} disabled={modalCreating}>
                Cancel
              </Button>
              <Button variant="default" size="sm" onClick={handleCreateSeries} disabled={modalCreating}>
                {modalCreating ? "Creating..." : "Create & Set Default"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5 py-2">
            {modalError && <InlineAlert variant="danger">{modalError}</InlineAlert>}

            <div>
              <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">
                Series Code <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                type="text"
                value={newSeriesCode}
                onChange={(e) => setNewSeriesCode(e.target.value.toUpperCase())}
                placeholder="e.g. NS-ITEM"
                maxLength={20}
                className="w-full nf-input font-mono uppercase text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">
                Prefix Pattern <span className="text-[var(--danger)]">*</span>
              </label>
              <input
                type="text"
                value={newSeriesPrefix}
                onChange={(e) => setNewSeriesPrefix(e.target.value.toUpperCase())}
                placeholder="e.g. ITM-"
                maxLength={20}
                className="w-full nf-input font-mono uppercase text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">
                  Digits (Sequence Length)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={newSeriesDigits}
                  onChange={(e) => setNewSeriesDigits(e.target.value)}
                  className="w-full nf-input text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">
                  Manual Entry
                </label>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newSeriesManual}
                    onChange={(e) => setNewSeriesManual(e.target.checked)}
                    className="rounded border-[var(--input-border)] text-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-primary)]">
                    Allow manual codes
                  </span>
                </label>
              </div>
            </div>

            <div className="rounded-lg bg-[var(--surface-secondary)] border border-[var(--border)] p-2.5 text-xs text-[var(--text-secondary)]">
              <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)] mb-0.5">
                <Sparkles size={13} className="text-[var(--accent)]" /> Sample Preview:
              </div>
              <span className="font-mono text-sm text-[var(--accent)] font-semibold">
                {newSeriesPrefix || "PRE-"}{String(1).padStart(parseInt(newSeriesDigits, 10) || 4, "0")}
              </span>
            </div>
          </div>
        </Dialog>
      )}
    </ConsolePage>
  );
}
