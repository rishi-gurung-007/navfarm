"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Users,
  Sliders,
  CheckCircle2,
  Save,
  RefreshCw,
  Warehouse,
  Info,
  Plus,
  Trash2,
  Layers,
} from "lucide-react";
import { getStoredUser, NavUser, getActiveLob, getActiveCompanyId, getActiveOperationalAreaId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/alert";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/services/api-client";
import { resolveLobFamily, type LobFamily } from "@/lib/lob";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

/**
 * Capacity is the one part of an area's configuration that genuinely differs
 * between lines of business — a piggery counts sow places and farrowing
 * crates, a dairy counts milking points, a poultry house counts brooder rings.
 * Rather than hard-code Piggery's four fields into the screen (which is what
 * this page used to do), each LOB declares its own, and they are persisted
 * into `operational_area_settings.lob_config`. Adding a line of business is a
 * new entry here plus its translation keys — no schema migration, no new form.
 */
type CapacityField = { key: string; labelKey: TranslationKeys; hintKey: TranslationKeys };

const CAPACITY_FIELDS: Partial<Record<LobFamily, CapacityField[]>> = {
  PIGGERY: [
    { key: "maxSowCapacity", labelKey: "asCapMaxSowHerd", hintKey: "asCapHeadcountLimit" },
    { key: "activeGestationPens", labelKey: "asCapGestationPens", hintKey: "asCapIndividualCrates" },
    { key: "farrowingCrates", labelKey: "asCapFarrowingCrates", hintKey: "asCapHeatLampEquipped" },
    { key: "weanerPens", labelKey: "asCapWeanerPens", hintKey: "asCapRearingSections" },
  ],
  DAIRY: [
    { key: "maxMilkingHerd", labelKey: "asCapMaxMilkingHerd", hintKey: "asCapHeadcountLimit" },
    { key: "milkingPoints", labelKey: "asCapMilkingPoints", hintKey: "asCapParlourStations" },
    { key: "calfPens", labelKey: "asCapCalfPens", hintKey: "asCapRearingSections" },
    { key: "dryCowPens", labelKey: "asCapDryCowPens", hintKey: "asCapIndividualCrates" },
  ],
  POULTRY: [
    { key: "maxBirdCapacity", labelKey: "asCapMaxBirdCapacity", hintKey: "asCapHeadcountLimit" },
    { key: "brooderRings", labelKey: "asCapBrooderRings", hintKey: "asCapRearingSections" },
    { key: "layerHouses", labelKey: "asCapLayerHouses", hintKey: "asCapHousingUnits" },
  ],
};

/** Any LOB without its own entry still gets a usable, meaningful capacity field. */
const DEFAULT_CAPACITY_FIELDS: CapacityField[] = [
  { key: "maxHerdCapacity", labelKey: "asCapMaxHerdCapacity", hintKey: "asCapHeadcountLimit" },
  { key: "housingUnits", labelKey: "asCapHousingUnits", hintKey: "asCapHousingUnits" },
];

type Settings = {
  costing_method: string;
  default_feed_uom: string;
  mortality_threshold_pct: number | null;
  temp_threshold_min: number | null;
  temp_threshold_max: number | null;
  auto_approve_ration_under_qty: number | null;
  lob_config: Record<string, unknown>;
};

const BLANK_SETTINGS: Settings = {
  costing_method: "STANDARD",
  default_feed_uom: "KG",
  mortality_threshold_pct: null,
  temp_threshold_min: null,
  temp_threshold_max: null,
  auto_approve_ration_under_qty: null,
  lob_config: {},
};

export default function AreaSettingsPage() {
  const router = useRouter();
  const { t, tLob } = useLanguage();

  const [user, setUser] = useState<NavUser | null>(null);
  const [ready, setReady] = useState(false);
  const [activeLob, setActiveLobState] = useState("PIGGERY");

  const [area, setArea] = useState<Row | null>(null);
  const [settings, setSettings] = useState<Settings>(BLANK_SETTINGS);
  const [staff, setStaff] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [preseedLoading, setPreseedLoading] = useState(false);
  const [preseedMsg, setPreseedMsg] = useState("");

  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffError, setStaffError] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);

  const areaId = getActiveOperationalAreaId();

  const load = useCallback(async () => {
    if (!areaId) {
      setLoading(false);
      setLoadError(t("asNoAreaSelected"));
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const res = unwrap<Row>(await api.get(`/operational-area/${areaId}/settings`));
      setArea(res?.area || null);
      setSettings({ ...BLANK_SETTINGS, ...(res?.settings || {}), lob_config: (res?.settings?.lob_config as Record<string, unknown>) || {} });
      setStaff(res?.staff || []);
    } catch (err: any) {
      setLoadError(err?.message || t("asFailedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [areaId, t]);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setUser(stored);
    setActiveLobState(getActiveLob());
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  // The area's own LOB wins over the locally-cached one: the settings we render
  // must match the area we actually loaded, not whatever was last selected.
  const lobFamily = useMemo(
    () => resolveLobFamily(area?.lob_code, area?.lob_name, area?.area_name, activeLob),
    [area, activeLob]
  );
  const capacityFields = useMemo(() => CAPACITY_FIELDS[lobFamily] || DEFAULT_CAPACITY_FIELDS, [lobFamily]);

  const setLobValue = (key: string, value: number) =>
    setSettings((prev) => ({ ...prev, lob_config: { ...prev.lob_config, [key]: value } }));

  const numOrEmpty = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
  const parseNum = (v: string): number | null => (v.trim() === "" ? null : Number(v));

  const handleSaveSettings = async () => {
    if (!areaId) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = unwrap<Row>(
        await api.put(`/operational-area/${areaId}/settings`, {
          costing_method: settings.costing_method,
          default_feed_uom: settings.default_feed_uom,
          mortality_threshold_pct: settings.mortality_threshold_pct,
          temp_threshold_min: settings.temp_threshold_min,
          temp_threshold_max: settings.temp_threshold_max,
          auto_approve_ration_under_qty: settings.auto_approve_ration_under_qty,
          lob_config: settings.lob_config,
        })
      );
      if (res?.settings) setSettings({ ...BLANK_SETTINGS, ...res.settings, lob_config: (res.settings.lob_config as Record<string, unknown>) || {} });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err: any) {
      setSaveError(err?.message || t("asFailedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const handleAddStaff = async () => {
    if (!areaId || !staffEmail.trim()) return;
    setStaffBusy(true);
    setStaffError("");
    try {
      const res = await api.post(`/operational-area/${areaId}/staff`, { email: staffEmail.trim() });
      setStaff(unwrap<Row[]>(res) || []);
      setStaffModalOpen(false);
      setStaffEmail("");
    } catch (err: any) {
      setStaffError(err?.message || t("asFailedToAssign"));
    } finally {
      setStaffBusy(false);
    }
  };

  const handleRemoveStaff = async (userId: string) => {
    if (!areaId) return;
    try {
      const res = await api.delete(`/operational-area/${areaId}/staff/${userId}`);
      setStaff(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setSaveError(err?.message || t("asFailedToRemove"));
    }
  };

  const handleSyncMasterData = async () => {
    const compId = getActiveCompanyId();
    if (!compId) return;
    setPreseedLoading(true);
    setPreseedMsg("");
    try {
      const res = unwrap<Row>(await api.post(`/operational-area/preseed-company/${compId}`, {}));
      // Report what the API actually cloned rather than a fixed claim about
      // "14 datasets" — the old copy said that even when the call failed.
      setPreseedMsg(
        t("asSyncDone", {
          items: String(res?.itemsCloned ?? 0),
          breeds: String(res?.breedsAvailable ?? 0),
        })
      );
    } catch (err: any) {
      setPreseedMsg(err?.message || t("asSyncFailed"));
    } finally {
      setPreseedLoading(false);
      setTimeout(() => setPreseedMsg(""), 5000);
    }
  };

  if (!ready || !user) return null;

  const lobLabel = tLob(lobFamily);

  const readOnlyField = (labelKey: TranslationKeys, value?: string | null, mono = false) => (
    <div>
      <label className="nf-text-label">{t(labelKey)}</label>
      <input
        type="text"
        disabled
        value={value || "—"}
        className={`nf-input w-full cursor-not-allowed bg-[var(--surface-raised)] text-[var(--text-muted)] ${mono ? "font-mono" : ""}`}
      />
    </div>
  );

  return (
    <ConsolePage>
      <PageHeader
        title={t("asTitle", { lob: lobLabel })}
        description={t("asDescription")}
        sticky={false}
        actions={
          <div className="flex items-center gap-2.5">
            <Button variant="outline" size="sm" onClick={handleSyncMasterData} disabled={preseedLoading} className="h-8 gap-1.5 text-xs font-medium">
              <RefreshCw className={`h-3.5 w-3.5 ${preseedLoading ? "animate-spin" : ""}`} />
              {t("asSyncMasterCatalog")}
            </Button>
            <Button size="sm" onClick={handleSaveSettings} disabled={saving || loading || !areaId} className="nf-btn-primary h-8 gap-1.5 text-xs font-medium">
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? t("asSaving") : t("asSaveSettings")}
            </Button>
          </div>
        }
      />

      {saveSuccess && (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{t("asSaved")}</span>
        </div>
      )}
      {saveError && <InlineAlert variant="danger">{saveError}</InlineAlert>}
      {preseedMsg && (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-blue-500/20 bg-blue-500/10 p-3 text-xs font-semibold text-blue-700 dark:text-blue-400">
          <Info className="h-4 w-4 shrink-0" />
          <span>{preseedMsg}</span>
        </div>
      )}

      {loading ? (
        <LoadingState label={t("asLoading")} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Identity — read from operational_area_master, edited there. */}
            <section className="space-y-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xs">
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <Building2 className="h-4 w-4 text-[var(--accent)]" />
                  <span>{t("asIdentityHeader")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/operational-areas")}
                  className="text-[11px] font-medium text-[var(--accent)] hover:underline"
                >
                  {t("asManageInMaster")}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
                {readOnlyField("asAreaName", area?.area_name)}
                {readOnlyField("asAreaCode", area?.area_code, true)}
                {readOnlyField("asParentFarm", area?.farm_name)}
                {readOnlyField("asCompany", area?.company_name)}
                {readOnlyField("asNob", area?.nob_name)}
                {readOnlyField("asLob", area?.lob_name)}
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">{t("asIdentityNote")}</p>
            </section>

            {/* Capacity — fields come from the LOB, values from lob_config. */}
            <section className="space-y-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xs">
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <Warehouse className="h-4 w-4 text-[var(--accent)]" />
                  <span>{t("asCapacityHeader")}</span>
                </div>
                <span className="text-[11px] text-[var(--text-secondary)]">{t("asCapacitySubhead", { lob: lobLabel })}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                {capacityFields.map((f) => (
                  <div key={f.key} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="nf-text-label mb-1 block">{t(f.labelKey)}</span>
                    <input
                      type="number"
                      min={0}
                      value={numOrEmpty(settings.lob_config?.[f.key])}
                      onChange={(e) => setLobValue(f.key, Number(e.target.value))}
                      className="nf-input w-full font-mono text-sm font-bold text-[var(--text-primary)]"
                    />
                    <span className="mt-1 block text-[10px] text-[var(--text-muted)]">{t(f.hintKey)}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Costing and thresholds — identical meaning across every LOB. */}
            <section className="space-y-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xs">
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <Sliders className="h-4 w-4 text-[var(--accent)]" />
                  <span>{t("asCostingHeader")}</span>
                </div>
                <span className="text-[11px] text-[var(--text-secondary)]">{t("asCostingSubhead")}</span>
              </div>

              <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
                <div>
                  <label className="nf-text-label">{t("asCostingMethod")}</label>
                  <select
                    value={settings.costing_method}
                    onChange={(e) => setSettings({ ...settings, costing_method: e.target.value })}
                    className="nf-input w-full font-medium"
                  >
                    <option value="STANDARD">{t("asCostingStandard")}</option>
                    <option value="FIFO">{t("asCostingFifo")}</option>
                    <option value="BIO_ASSET">{t("asCostingBioAsset")}</option>
                  </select>
                </div>

                <div>
                  <label className="nf-text-label">{t("asDefaultFeedUom")}</label>
                  <select
                    value={settings.default_feed_uom}
                    onChange={(e) => setSettings({ ...settings, default_feed_uom: e.target.value })}
                    className="nf-input w-full font-medium"
                  >
                    <option value="KG">KG</option>
                    <option value="TON">TON</option>
                    <option value="BAG">BAG</option>
                    <option value="LTR">LTR</option>
                  </select>
                </div>

                <div>
                  <label className="nf-text-label">{t("asMortalityThreshold")}</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={numOrEmpty(settings.mortality_threshold_pct)}
                      onChange={(e) => setSettings({ ...settings, mortality_threshold_pct: parseNum(e.target.value) })}
                      className="nf-input w-full pr-7 font-mono"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--text-muted)]">%</span>
                  </div>
                </div>

                <div>
                  <label className="nf-text-label">{t("asTempMin")}</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.5"
                      value={numOrEmpty(settings.temp_threshold_min)}
                      onChange={(e) => setSettings({ ...settings, temp_threshold_min: parseNum(e.target.value) })}
                      className="nf-input w-full pr-7 font-mono"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--text-muted)]">°C</span>
                  </div>
                </div>

                <div>
                  <label className="nf-text-label">{t("asTempMax")}</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.5"
                      value={numOrEmpty(settings.temp_threshold_max)}
                      onChange={(e) => setSettings({ ...settings, temp_threshold_max: parseNum(e.target.value) })}
                      className="nf-input w-full pr-7 font-mono"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--text-muted)]">°C</span>
                  </div>
                </div>

                <Field label={t("asAutoApproveUnder")} htmlFor="area-auto-approve-qty" tooltip={t("asAutoApproveHint")}>
                  <div className="relative">
                    <input
                      id="area-auto-approve-qty"
                      type="number"
                      step="1"
                      min={0}
                      value={numOrEmpty(settings.auto_approve_ration_under_qty)}
                      onChange={(e) => setSettings({ ...settings, auto_approve_ration_under_qty: parseNum(e.target.value) })}
                      className="nf-input w-full pr-10 font-mono"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--text-muted)]">
                      {settings.default_feed_uom}
                    </span>
                  </div>
                </Field>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            {/* Staff — the real user_operational_area_assignment rows. */}
            <section className="space-y-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xs">
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <Users className="h-4 w-4 text-[var(--accent)]" />
                  <span>{t("asStaffHeader")}</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setStaffError(""); setStaffModalOpen(true); }} className="h-6 gap-1 px-2 text-[10px]">
                  <Plus className="h-3 w-3" /> {t("asAssign")}
                </Button>
              </div>

              {staff.length === 0 ? (
                <EmptyState icon={Users} title={t("asNoStaff")} description={t("asNoStaffHint")} />
              ) : (
                <div className="space-y-2.5">
                  {staff.map((s) => (
                    <div key={s.user_id} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--text-primary)]">{s.full_name}</p>
                        <p className="truncate font-mono text-[11px] text-[var(--text-secondary)]">{s.email}</p>
                        <span className="mt-1 inline-block rounded-[var(--radius-xs)] border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                          {(s.user_type || "").replace(/_/g, " ")}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveStaff(s.user_id)}
                        className="p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--danger)]"
                        title={t("asRemoveAssignment")}
                        aria-label={t("asRemoveAssignment")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className="border-t pt-2 text-[11px] text-[var(--text-secondary)]" style={{ borderColor: "var(--border)" }}>
                {t("asStaffScopeNote", { lob: lobLabel })}
              </p>
            </section>

            <section className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-xs shadow-2xs">
              <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                <Layers className="h-4 w-4 text-[var(--accent)]" />
                <span>{t("asCatalogHeader")}</span>
              </div>
              <p className="leading-relaxed text-[var(--text-secondary)]">{t("asCatalogNote", { lob: lobLabel })}</p>
              <Button variant="outline" size="sm" onClick={() => router.push("/master-data")} className="mt-1 w-full text-xs font-medium">
                {t("asOpenMasterData")}
              </Button>
            </section>
          </div>
        </div>
      )}

      <Dialog
        open={staffModalOpen}
        onClose={() => setStaffModalOpen(false)}
        title={t("asAssignStaffTitle", { lob: lobLabel })}
        description={t("asAssignStaffDescription")}
        maxWidth="sm"
        footer={
          <Button size="sm" onClick={handleAddStaff} disabled={staffBusy || !staffEmail.trim()} className="nf-btn-primary">
            {t("asAssignToUnit")}
          </Button>
        }
      >
        <div className="space-y-3 pt-1 text-xs">
          {staffError && <InlineAlert variant="danger">{staffError}</InlineAlert>}
          <div>
            <label className="nf-text-label">{t("asStaffEmail")}</label>
            <input
              type="email"
              value={staffEmail}
              onChange={(e) => setStaffEmail(e.target.value)}
              placeholder={t("asStaffEmailPlaceholder")}
              className="nf-input w-full font-mono"
            />
          </div>
          {/* Assigning does not create a user: the previous version invented
              staff from a name and an email, producing people who could never
              sign in. Inviting is User Management's job. */}
          <p className="text-[11px] text-[var(--text-secondary)]">{t("asAssignExistingOnly")}</p>
          <button
            type="button"
            onClick={() => router.push("/users")}
            className="text-[11px] font-medium text-[var(--accent)] hover:underline"
          >
            {t("asInviteInsteadLink")}
          </button>
        </div>
      </Dialog>
    </ConsolePage>
  );
}
