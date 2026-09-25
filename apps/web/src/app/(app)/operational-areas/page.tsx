"use client";

import React, { useState, useEffect } from "react";
import {
  Plus,
  ArrowRight,
  Layers,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import {
  getStoredUser,
  updateStoredUser,
  getActiveCompanyId,
  setActiveCompanyId,
  setActiveOperationalAreaId,
  setActiveWorkspaceScope,
  setActiveLob,
  NavUser
} from "@/hooks/useAuth";
import { api } from "@/lib/api-client";
import { resolveLobFamily } from "@/lib/lob";
import { useLanguage } from "@/hooks/useLanguage";

interface OperationalArea {
  area_id: string;
  area_code: string;
  area_name: string;
  company_id: string;
  nob_id: string;
  lob_id: string;
  farm_id?: string;
  description?: string;
  preseed_source: string;
  is_active: boolean;
  created_at?: string;
}

export default function OperationalAreasPage() {
  const { t } = useLanguage();
  const [user, setUser] = useState<NavUser | null>(null);
  const [areas, setAreas] = useState<OperationalArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [nobs, setNobs] = useState<any[]>([]);
  const [lobs, setLobs] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Modal Form State
  const [form, setForm] = useState({
    area_code: "",
    area_name: "",
    nob_id: "",
    lob_id: "",
    description: "",
    preseed_source: "TENANT", // TENANT, COMPANY, NONE
  });

  const activeCompanyId = getActiveCompanyId();

  /**
   * The LOBs of one NOB. GET /setup/wizard/nobs returns nob_master rows with
   * no nested lobs array — this screen used to read `nob.lobs`, which was
   * always undefined, so the LOB picker was permanently empty and the form
   * could never be submitted. Every other screen calls this endpoint; so does
   * this one now.
   */
  const loadLobs = async (nobId: string) => {
    if (!nobId) {
      setLobs([]);
      setForm((prev) => ({ ...prev, lob_id: "" }));
      return;
    }
    const res = await api.get(`/setup/wizard/lobs/${nobId}`).catch(() => []);
    // Piggery-only for now — see step8-modules.tsx for the matching
    // restriction at company onboarding. Remove both once another LOB's
    // operational workflow is ready.
    const list = (Array.isArray(res) ? (res as any[]) : []).filter((l) =>
      (l.lob_name || l.lob_code || "").toLowerCase().includes("piggery"),
    );
    setLobs(list);
    setForm((prev) => ({ ...prev, lob_id: list[0]?.lob_id || "" }));
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const storedUser = getStoredUser();
      setUser(storedUser);

      const [areasRes, nobsRes] = await Promise.all([
        api.get(`/operational-area${activeCompanyId ? `?company_id=${activeCompanyId}` : ""}`).catch(() => []),
        api.get(`/setup/wizard/nobs`).catch(() => []),
      ]);

      if (Array.isArray(areasRes)) setAreas(areasRes as OperationalArea[]);
      // Piggery-only for now — see step8-modules.tsx for the matching
      // restriction at company onboarding. Remove both once another LOB's
      // operational workflow is ready.
      const rawNobs = Array.isArray(nobsRes) ? (nobsRes as any[]) : [];
      const nobsList = rawNobs.filter((n) =>
        (n.nob_name || n.nob_code || "").toLowerCase().includes("livestock"),
      );
      setNobs(nobsList);

      // Default NOB, then its LOBs — /setup/wizard/nobs answers with flat
      // nob_master rows, so the LOBs have to be fetched for the chosen NOB.
      if (nobsList.length > 0) {
        setForm((prev) => ({
          ...prev,
          nob_id: nobsList[0].nob_id,
        }));
        await loadLobs(nobsList[0].nob_id);
      } else {
        setLobs([]);
        setForm((prev) => ({ ...prev, lob_id: "" }));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleNobChange = (nobId: string) => {
    setForm((prev) => ({ ...prev, nob_id: nobId, lob_id: "" }));
    void loadLobs(nobId);
  };

  const handleCreateArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.area_code || !form.area_name || !form.nob_id || !form.lob_id) {
      alert("Please fill all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        company_id: activeCompanyId || user?.companyId || user?.company_id,
      };

      const created = await api.post("/operational-area", payload) as any;
      setShowModal(false);
      await loadData();

      // Enter the new area directly
      if (created?.area_id) {
        handleEnterArea(created as OperationalArea);
      }
    } catch (err: any) {
      alert(err?.message || "Failed to create operational area");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnterArea = (area: OperationalArea) => {
    setActiveCompanyId(area.company_id);
    setActiveOperationalAreaId(area.area_id);
    setActiveWorkspaceScope("OPERATIONAL");

    // Was matching "DAIRY"/"POULTRY" against area.lob_id — a UUID, so every
    // area resolved to Piggery regardless of its actual line of business.
    setActiveLob(resolveLobFamily((area as { lob_code?: string }).lob_code, (area as { lob_name?: string }).lob_name, area.area_name));

    updateStoredUser({
      operationalAreaId: area.area_id,
      operational_area_id: area.area_id,
    });

    window.location.href = "/batches/entry";
  };

  return (
    <ConsolePage className="text-(--text-primary)">
      <PageHeader
        title={t("operationalAreas")}
        description={t("oaPageDescription")}
      />

      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-(--text-secondary)">
          <span className="font-semibold text-(--text-primary)">{areas.length}</span>{t("oaActiveAreas")}</div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] bg-(--accent) hover:opacity-90 text-xs font-bold text-white shadow-xs transition-all"
        >
          <Plus className="w-4 h-4" />{t("oaCreateArea")}</button>
      </div>

      {/* ── Operational Areas Cards Grid ── */}
      {loading ? (
        <div className="p-8 text-center text-xs text-(--text-muted) flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-(--accent)" />{t("oaLoadingAreas")}</div>
      ) : areas.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-(--border) bg-(--surface) p-10 text-center">
          <Layers className="w-10 h-10 text-(--text-muted) mx-auto mb-3" />
          <h3 className="text-sm font-bold text-(--text-primary)">{t("oaNoAreasTitle")}</h3>
          <p className="text-xs text-(--text-secondary) mt-1 max-w-md mx-auto">{t("oaNoAreasDesc")}</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] bg-(--accent) text-xs font-bold text-white shadow-xs"
          >
            <Plus className="w-4 h-4" />{t("oaCreateFirstArea")}</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {areas.map((area) => {
            const isPig = area.area_name.toLowerCase().includes("pig") || area.area_code.toLowerCase().includes("pig");
            const isDairy = area.area_name.toLowerCase().includes("dairy") || area.area_code.toLowerCase().includes("dairy");

            return (
              <div
                key={area.area_id}
                className="rounded-[var(--radius-md)] border p-5 flex flex-col justify-between transition-all hover:bg-[var(--surface-raised)] shadow-xs group"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border"
                        style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}
                      >
                        <Layers className="h-4 w-4" style={{ color: "var(--accent)" }} />
                      </span>
                      <div>
                        <span className="font-mono text-[11px] font-bold" style={{ color: "var(--accent)" }}>
                          {area.area_code}
                        </span>
                        <p className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>
                          {isPig ? "Livestock · Piggery" : isDairy ? "Livestock · Dairy" : "Agricultural Unit"}
                        </p>
                      </div>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium border"
                      style={{ backgroundColor: "var(--success-muted)", borderColor: "var(--success)", color: "var(--success)" }}
                    >{t("statusActive")}</span>
                  </div>

                  <h4 className="text-sm font-semibold tracking-tight mb-1" style={{ color: "var(--text-primary)" }}>
                    {area.area_name}
                  </h4>
                  <p className="text-xs line-clamp-2 mb-4" style={{ color: "var(--text-secondary)" }}>
                    {area.description || "Operational unit for livestock production, daily feeding logs, animal identification, and QC inspections."}
                  </p>

                  <div
                    className="space-y-1.5 text-xs p-3 rounded-[var(--radius-sm)] border"
                    style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-secondary)" }}
                  >
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-muted)" }}>{t("oaMasterDataSource")}</span>
                      <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                        {area.preseed_source === "COMPANY" ? "Company Master Data" : "Tenant Master Templates"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--text-muted)" }}>{t("oaOperationalStatus")}</span>
                      <span className="font-medium" style={{ color: "var(--success)" }}>{t("oaActiveUnit")}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    Created: {area.created_at ? new Date(area.created_at).toLocaleDateString() : "Active"}
                  </span>
                  <button
                    onClick={() => handleEnterArea(area)}
                    className="flex items-center gap-1 text-xs font-semibold hover:underline"
                    style={{ color: "var(--accent)" }}
                  >{t("oaOpenWorkspace")}<ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal: Create Operational Area ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-(--border) bg-(--surface) shadow-2xl overflow-hidden text-(--text-primary) animate-scale-in">
            <div className="px-5 py-4 border-b border-(--border) bg-(--surface-raised) flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-(--text-primary)">{t("oaCreateArea")}</h3>
                <p className="text-xs text-(--text-secondary) mt-0.5">{t("oaCreateAreaDesc")}</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-(--text-muted) hover:text-(--text-primary) text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateArea} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="nf-text-label mb-1 block text-(--text-muted)">{t("oaAreaCodeRequired")}</label>
                  <input
                    type="text"
                    required
                    placeholder={t("oaPhAreaCode")}
                    value={form.area_code}
                    onChange={(e) => setForm({ ...form, area_code: e.target.value })}
                    className="w-full rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-2 text-xs font-semibold text-(--text-primary)"
                  />
                </div>
                <div>
                  <label className="nf-text-label mb-1 block text-(--text-muted)">{t("oaAreaNameRequired")}</label>
                  <input
                    type="text"
                    required
                    placeholder={t("oaPhAreaName")}
                    value={form.area_name}
                    onChange={(e) => setForm({ ...form, area_name: e.target.value })}
                    className="w-full rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-2 text-xs font-semibold text-(--text-primary)"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="nf-text-label mb-1 block text-(--text-muted)">{t("oaNobRequired")}</label>
                  <select
                    value={form.nob_id}
                    onChange={(e) => handleNobChange(e.target.value)}
                    className="w-full rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-2 text-xs text-(--text-primary)"
                  >
                    {nobs.map((n) => (
                      <option key={n.nob_id} value={n.nob_id}>
                        {n.nob_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="nf-text-label mb-1 block text-(--text-muted)">{t("oaLobRequired")}</label>
                  <select
                    value={form.lob_id}
                    onChange={(e) => setForm({ ...form, lob_id: e.target.value })}
                    className="w-full rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-2 text-xs text-(--text-primary)"
                  >
                    {lobs.map((l) => (
                      <option key={l.lob_id} value={l.lob_id}>
                        {l.lob_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Pre-Seeding Source Option */}
              <div>
                <label className="nf-text-label mb-1.5 block text-(--text-muted)">{t("oaPreseedFromRequired")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "TENANT", label: t("oaSrcTenantMaster"), desc: "Global catalog templates" },
                    { id: "COMPANY", label: t("oaSrcCompanyMaster"), desc: "Existing company items" },
                    { id: "NONE", label: t("oaSrcBlankSetup"), desc: "No pre-seeding" },
                  ].map((src) => (
                    <div
                      key={src.id}
                      onClick={() => setForm({ ...form, preseed_source: src.id })}
                      className={`cursor-pointer rounded-[var(--radius-sm)] border p-2.5 text-left transition-all ${
                        form.preseed_source === src.id
                          ? "border-(--accent) bg-(--accent-muted) ring-1 ring-(--accent)/30"
                          : "border-(--border) bg-(--surface-raised) hover:bg-(--surface)"
                      }`}
                    >
                      <p className="text-xs font-bold text-(--text-primary)">{src.label}</p>
                      <p className="text-[10px] text-(--text-muted) mt-0.5">{src.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="nf-text-label mb-1 block text-(--text-muted)">{t("oaDescriptionNotes")}</label>
                <textarea
                  rows={2}
                  placeholder={t("oaPhDescription")}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-2 text-xs text-(--text-primary)"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-[var(--radius-sm)] bg-(--accent) hover:opacity-90 text-xs font-bold text-white shadow-xs disabled:opacity-50"
                >
                  {submitting ? "Creating & Pre-seeding..." : "Create & Enter Area"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ConsolePage>
  );
}
