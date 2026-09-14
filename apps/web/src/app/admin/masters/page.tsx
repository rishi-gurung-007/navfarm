"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw, AlertCircle, CheckCircle, Plus, ChevronDown, ChevronRight, X,
} from "lucide-react";
import { api } from "../../../services/api-client";
import { getStoredToken, getStoredUser } from "../../../hooks/useAuth";
import { Dialog } from "../../../components/ui/dialog";
import { Field } from "../../../components/ui/field";
import { PageHeader } from "../../../components/ui/PageHeader";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../../components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";

// ── Shared style tokens ─────────────────────────────────────────────────────
const S = {
  surface:  { backgroundColor: "var(--surface)",        borderColor: "var(--border)" },
  raised:   { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary:  { color: "var(--text-primary)" },
  sub:      { color: "var(--text-secondary)" },
  muted:    { color: "var(--text-muted)" },
  accent:   { color: "var(--accent)" },
  border:   { borderColor: "var(--border)" },
  input:    { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

// ── Reusable input / select ─────────────────────────────────────────────────
const inputCls = "nf-input";


type MasterTab = "nobs" | "currencies" | "languages" | "timezones" | "countries" | "costingMethods";

export default function AdminMastersPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [activeTab,  setActiveTab]  = useState<MasterTab>("nobs");
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [success,    setSuccess]    = useState("");

  // NOBs
  const [nobs,         setNobs]         = useState<any[]>([]);
  const [expandedNob,  setExpandedNob]  = useState<string | null>(null);
  const [lobs,         setLobs]         = useState<Record<string, any[]>>({});
  const [loadingLobs,  setLoadingLobs]  = useState<Record<string, boolean>>({});
  const [showNobForm,  setShowNobForm]  = useState(false);
  const [nobForm,      setNobForm]      = useState({ nob_code: "", nob_name: "", description: "", default_costing_method: "FIFO" });
  const [showLobForm,  setShowLobForm]  = useState<string | null>(null);
  const [lobForm,      setLobForm]      = useState({ lob_code: "", lob_name: "", costing_method_allowed: "STANDARD,FIFO", qc_required: "NO", qr_required: "NO", batch_copy_allowed: "YES" });
  const [savingNob,    setSavingNob]    = useState(false);
  const [savingLob,    setSavingLob]    = useState(false);

  // Currencies
  const [currencies,   setCurrencies]   = useState<any[]>([]);
  const [showCurrForm, setShowCurrForm] = useState(false);
  const [currForm,     setCurrForm]     = useState({ iso_code: "", currency_name: "", symbol: "", symbol_position: "BEFORE", is_system_default: false });
  const [savingCurr,   setSavingCurr]   = useState(false);

  // Languages
  const [languages,   setLanguages]    = useState<any[]>([]);
  const [showLangForm, setShowLangForm] = useState(false);
  const [langForm,    setLangForm]     = useState({ lang_code: "", lang_name_english: "", lang_name_native: "", script: "LTR", is_system_default: false });
  const [savingLang,  setSavingLang]   = useState(false);

  // Timezones
  const [timezones,    setTimezones]    = useState<any[]>([]);
  const [showTzForm,   setShowTzForm]   = useState(false);
  const [tzForm,       setTzForm]       = useState({ tz_code: "", tz_name: "", utc_offset: "", offset_minutes: 0, is_dst: false });
  const [savingTz,     setSavingTz]     = useState(false);

  // Countries + nested States
  const [countries,       setCountries]       = useState<any[]>([]);
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  const [states,          setStates]          = useState<Record<string, any[]>>({});
  const [loadingStates,   setLoadingStates]   = useState<Record<string, boolean>>({});
  const [showCountryForm, setShowCountryForm] = useState(false);
  const [countryForm,     setCountryForm]     = useState({ iso2: "", iso3: "", country_name: "", phone_code: "", flag_emoji: "" });
  const [showStateForm,   setShowStateForm]   = useState<string | null>(null);
  const [stateForm,       setStateForm]       = useState({ state_code: "", state_name: "" });
  const [savingCountry,   setSavingCountry]   = useState(false);
  const [savingState,     setSavingState]     = useState(false);

  // Costing Methods
  const [costingMethods,   setCostingMethods]   = useState<any[]>([]);
  const [showCostingForm,  setShowCostingForm]  = useState(false);
  const [costingForm,      setCostingForm]      = useState({ method_code: "", method_name: "", variance_auto: "NO", layer_tracking: false, bio_asset_support: false, fair_value_option: false, amort_option: false });
  const [savingCosting,    setSavingCosting]    = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    const user  = getStoredUser();
    if (!token || !user || user.userType !== "SYSTEM_ADMIN") { router.replace("/"); return; }
    loadAll();
  }, [router]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [nobList, currList, langList, tzList, countryList, costingList] = await Promise.all([
        api.get("/setup/wizard/nobs"),
        api.get("/currency"),
        api.get("/language"),
        api.get("/timezone"),
        api.get("/country").then((r: any) => r?.data ?? r),
        api.get("/costing-method"),
      ]);
      setNobs(nobList); setCurrencies(currList); setLanguages(langList);
      setTimezones(tzList); setCountries(countryList); setCostingMethods(costingList);
    } catch (e: any) { setError(e?.message || "Failed to load master data."); }
    finally { setLoading(false); }
  };

  const loadLobs = async (nobId: string) => {
    if (lobs[nobId]) return;
    setLoadingLobs((p) => ({ ...p, [nobId]: true }));
    try {
      const list = await api.get(`/setup/wizard/lobs/${nobId}`);
      setLobs((p) => ({ ...p, [nobId]: list }));
    } catch { setLobs((p) => ({ ...p, [nobId]: [] })); }
    finally { setLoadingLobs((p) => ({ ...p, [nobId]: false })); }
  };

  const handleExpandNob = (nobId: string) => {
    if (expandedNob === nobId) { setExpandedNob(null); return; }
    setExpandedNob(nobId);
    loadLobs(nobId);
  };

  const handleSaveNob = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingNob(true); setError(""); setSuccess("");
    try {
      await api.post("/setup/wizard/nobs", nobForm);
      setSuccess("Nature of Business created.");
      setShowNobForm(false);
      setNobForm({ nob_code: "", nob_name: "", description: "", default_costing_method: "FIFO" });
      setNobs(await api.get("/setup/wizard/nobs"));
    } catch (err: any) { setError(err?.message || "Failed to create NOB."); }
    finally { setSavingNob(false); }
  };

  const handleSaveLob = async (e: React.FormEvent, nobId: string) => {
    e.preventDefault(); setSavingLob(true); setError(""); setSuccess("");
    try {
      await api.post("/setup/wizard/lobs", { ...lobForm, nob_id: nobId });
      setSuccess("Line of Business created.");
      setShowLobForm(null);
      setLobForm({ lob_code: "", lob_name: "", costing_method_allowed: "STANDARD,FIFO", qc_required: "NO", qr_required: "NO", batch_copy_allowed: "YES" });
      setLobs((p) => ({ ...p, [nobId]: [] }));
      loadLobs(nobId);
    } catch (err: any) { setError(err?.message || "Failed to create LOB."); }
    finally { setSavingLob(false); }
  };

  const handleSaveCurrency = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingCurr(true); setError(""); setSuccess("");
    try {
      await api.post("/currency", currForm);
      setSuccess("Currency added.");
      setShowCurrForm(false);
      setCurrForm({ iso_code: "", currency_name: "", symbol: "", symbol_position: "BEFORE", is_system_default: false });
      setCurrencies(await api.get("/currency"));
    } catch (err: any) { setError(err?.message || "Failed to create currency."); }
    finally { setSavingCurr(false); }
  };

  const handleSaveLanguage = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingLang(true); setError(""); setSuccess("");
    try {
      await api.post("/language", langForm);
      setSuccess("Language added.");
      setShowLangForm(false);
      setLangForm({ lang_code: "", lang_name_english: "", lang_name_native: "", script: "LTR", is_system_default: false });
      setLanguages(await api.get("/language"));
    } catch (err: any) { setError(err?.message || "Failed to create language."); }
    finally { setSavingLang(false); }
  };

  const handleSaveTimezone = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingTz(true); setError(""); setSuccess("");
    try {
      await api.post("/timezone", tzForm);
      setSuccess("Timezone added.");
      setShowTzForm(false);
      setTzForm({ tz_code: "", tz_name: "", utc_offset: "", offset_minutes: 0, is_dst: false });
      setTimezones(await api.get("/timezone"));
    } catch (err: any) { setError(err?.message || "Failed to create timezone."); }
    finally { setSavingTz(false); }
  };

  const loadStates = async (countryId: string) => {
    if (states[countryId]) return;
    setLoadingStates((p) => ({ ...p, [countryId]: true }));
    try {
      const list = await api.get(`/country/${countryId}/states`);
      setStates((p) => ({ ...p, [countryId]: list }));
    } catch { setStates((p) => ({ ...p, [countryId]: [] })); }
    finally { setLoadingStates((p) => ({ ...p, [countryId]: false })); }
  };

  const handleExpandCountry = (countryId: string) => {
    if (expandedCountry === countryId) { setExpandedCountry(null); return; }
    setExpandedCountry(countryId);
    loadStates(countryId);
  };

  const handleSaveCountry = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingCountry(true); setError(""); setSuccess("");
    try {
      await api.post("/country", countryForm);
      setSuccess("Country added.");
      setShowCountryForm(false);
      setCountryForm({ iso2: "", iso3: "", country_name: "", phone_code: "", flag_emoji: "" });
      setCountries(await api.get("/country").then((r: any) => r?.data ?? r));
    } catch (err: any) { setError(err?.message || "Failed to create country."); }
    finally { setSavingCountry(false); }
  };

  const handleSaveCostingMethod = async (e: React.FormEvent) => {
    e.preventDefault(); setSavingCosting(true); setError(""); setSuccess("");
    try {
      await api.post("/costing-method", costingForm);
      setSuccess("Costing method added.");
      setShowCostingForm(false);
      setCostingForm({ method_code: "", method_name: "", variance_auto: "NO", layer_tracking: false, bio_asset_support: false, fair_value_option: false, amort_option: false });
      setCostingMethods(await api.get("/costing-method"));
    } catch (err: any) { setError(err?.message || "Failed to create costing method."); }
    finally { setSavingCosting(false); }
  };

  const handleSaveState = async (e: React.FormEvent, countryId: string) => {
    e.preventDefault(); setSavingState(true); setError(""); setSuccess("");
    try {
      await api.post(`/country/${countryId}/states`, stateForm);
      setSuccess("State/province added.");
      setShowStateForm(null);
      setStateForm({ state_code: "", state_name: "" });
      setStates((p) => ({ ...p, [countryId]: [] }));
      loadStates(countryId);
    } catch (err: any) { setError(err?.message || "Failed to create state."); }
    finally { setSavingState(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin w-5 h-5 mr-2" style={S.accent} />
        <span className="text-sm" style={S.sub}>{t("admLoadingMasterData")}</span>
      </div>
    );
  }

  const tabBtn = (t: MasterTab, label: string) => (
    <button
      onClick={() => setActiveTab(t)}
      className="px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap"
      style={activeTab === t
        ? { borderColor: "var(--accent)", color: "var(--accent)" }
        : { borderColor: "transparent", color: "var(--text-secondary)" }
      }
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-4 sm:px-6 sm:pb-6 xl:px-8 xl:pb-8">
      <PageHeader
        title={t("masterData")}
        description={t("admMastersDesc")}
      />

      {error   && <div className="flex items-center gap-2 text-(--danger) bg-(--danger-muted) border border-(--danger) rounded-lg p-4 text-sm"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
      {success && <div className="flex items-center gap-2 text-(--success) bg-(--success-muted) border border-(--success) rounded-lg p-4 text-sm"><CheckCircle className="w-4 h-4 shrink-0" /> {success}</div>}

      {/* Tabs sit directly on the page. Boxing them added a second frame
          around content that already gets its own containment below. */}
      <div>
        <div className="flex overflow-x-auto border-b" style={S.border}>
          {tabBtn("nobs",       `NOBs / LOBs (${nobs.length})`)}
          {tabBtn("currencies", `Currencies (${currencies.length})`)}
          {tabBtn("languages",  `Languages (${languages.length})`)}
          {tabBtn("timezones",  `Timezones (${timezones.length})`)}
          {tabBtn("countries",  `Countries (${countries.length})`)}
          {tabBtn("costingMethods", `Costing Methods (${costingMethods.length})`)}
        </div>

        <div className="pt-6">

          {/* ═══ NOBs TAB ═══════════════════════════════════════════════════ */}
          {activeTab === "nobs" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{t("dashColNob")}</p>
                <button onClick={() => setShowNobForm(!showNobForm)}
                  className="flex items-center gap-1.5 text-xs font-semibold" style={S.accent}>
                  <Plus className="w-3.5 h-3.5" />{t("admAddNob")}</button>
              </div>

              <Dialog open={showNobForm} onClose={() => setShowNobForm(false)} title={t("admAddNobTitle")} description={t("admAddNobDesc")} maxWidth="md">
                <form onSubmit={handleSaveNob} className="grid grid-cols-2 gap-4">
                  {[
                    { k: "nob_code",    l: "NOB Code",    p: "POULTRY"              },
                    { k: "nob_name",    l: "NOB Name",    p: "Poultry Farming"      },
                    { k: "description", l: "Description", p: "Broiler & layer farming" },
                  ].map(({ k, l, p }) => (
                    <div key={k} className={k === "description" ? "col-span-2" : ""}>
                      <Field label={l}>
                        <input required value={(nobForm as any)[k]}
                          onChange={(e) => setNobForm({ ...nobForm, [k]: e.target.value })}
                          placeholder={p} className={inputCls} style={S.input} />
                      </Field>
                    </div>
                  ))}
                  <Field label={t("blLabelCostingMethod")}>
                    <select value={nobForm.default_costing_method}
                      onChange={(e) => setNobForm({ ...nobForm, default_costing_method: e.target.value })}
                      className={`${inputCls} nf-select`} style={S.input}>
                      <option value="FIFO">FIFO</option>
                      <option value="STANDARD">{t("blCostingStandard")}</option>
                      <option value="BIO">{t("admBioAssetIas41")}</option>
                    </select>
                  </Field>
                  <div className="col-span-2 flex flex-col-reverse gap-3 border-t border-(--border) pt-5 sm:flex-row sm:justify-end">
                    <button type="submit" disabled={savingNob}
                      className="h-11 rounded-[var(--radius-sm)] bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                      {savingNob ? "Saving…" : "Save NOB"}
                    </button>
                    <button type="button" onClick={() => setShowNobForm(false)}
                      className="h-11 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface) px-5 text-sm text-(--text-secondary) hover:bg-(--surface-raised)">{t("cancel")}</button>
                  </div>
                </form>
              </Dialog>

              {/* One list of peers separated by hairlines, not a stack of
                  cards — each row is a sibling entry, not its own module. */}
              <div className="border-t" style={S.border}>
                {nobs.length === 0 && <p className="text-sm text-center py-8" style={S.muted}>{t("admNoNobs")}</p>}
                {nobs.map((nob) => {
                  const isExp = expandedNob === nob.nob_id;
                  return (
                    <div key={nob.nob_id} className="border-b" style={S.border}>
                      <button
                        onClick={() => handleExpandNob(nob.nob_id)}
                        aria-expanded={isExp}
                        className="w-full flex min-h-12 items-center justify-between px-1 py-3 text-left transition-colors hover:bg-(--row-hover)">
                        <div className="flex items-center gap-3">
                          {isExp
                            ? <ChevronDown  className="w-4 h-4 shrink-0" style={S.muted} />
                            : <ChevronRight className="w-4 h-4 shrink-0" style={S.muted} />
                          }
                          <span className="font-semibold text-sm" style={S.primary}>{nob.nob_name}</span>
                          <span className="font-mono text-[11px]" style={S.muted}>{nob.nob_code}</span>
                          {/* Costing method is a configured value, not a status —
                              it reads as plain metadata rather than a red chip. */}
                          <span className="text-[11px]" style={S.muted}>{nob.default_costing_method}</span>
                        </div>
                      </button>

                      {isExp && (
                        <div className="px-4 py-3 border-t" style={{ ...S.surface, ...S.border }}>
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{t("admLinesOfBusiness")}</p>
                            <button onClick={() => setShowLobForm(showLobForm === nob.nob_id ? null : nob.nob_id)}
                              className="text-xs font-semibold flex items-center gap-1" style={S.accent}>
                              <Plus className="w-3.5 h-3.5" />{t("admAddLob")}</button>
                          </div>

                          <Dialog open={showLobForm === nob.nob_id} onClose={() => setShowLobForm(null)} title={t("admAddLobTitle")} description={`Add an operating line beneath ${nob.nob_name}.`} maxWidth="md">
                            <form onSubmit={(e) => handleSaveLob(e, nob.nob_id)} className="grid grid-cols-2 gap-4">
                              {[
                                { k: "lob_code", l: "LOB Code", p: "BROILER"           },
                                { k: "lob_name", l: "LOB Name", p: "Broiler Production" },
                              ].map(({ k, l, p }) => (
                                <Field key={k} label={l}>
                                  <input required value={(lobForm as any)[k]}
                                    onChange={(e) => setLobForm({ ...lobForm, [k]: e.target.value })}
                                    placeholder={p} className={inputCls} style={S.input} />
                                </Field>
                              ))}
                              <div className="col-span-2 flex flex-col-reverse gap-3 border-t border-(--border) pt-5 sm:flex-row sm:justify-end">
                                <button type="submit" disabled={savingLob}
                                  className="h-11 rounded-[var(--radius-sm)] bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                                  {savingLob ? "Saving…" : "Save LOB"}
                                </button>
                                <button type="button" onClick={() => setShowLobForm(null)}
                                  className="h-11 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface) px-5 text-sm text-(--text-secondary) hover:bg-(--surface-raised)">{t("cancel")}</button>
                              </div>
                            </form>
                          </Dialog>

                          {loadingLobs[nob.nob_id] ? (
                            <div className="text-xs flex items-center gap-1.5" style={S.muted}>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />{t("loadingEllipsis")}</div>
                          ) : (lobs[nob.nob_id] || []).length === 0 ? (
                            <p className="text-xs" style={S.muted}>{t("admNoLobs")}</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {(lobs[nob.nob_id] || []).map((lob: any) => (
                                <span key={lob.lob_id}
                                  className="text-xs border rounded-lg px-2.5 py-1 font-medium"
                                  style={{ ...S.raised, ...S.primary }}>
                                  {lob.lob_name}
                                  <span className="font-mono ml-1.5 text-[10px]" style={S.muted}>({lob.lob_code})</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ CURRENCIES TAB ═════════════════════════════════════════════ */}
          {activeTab === "currencies" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{t("admSupportedCurrencies")}</p>
                <button onClick={() => setShowCurrForm(!showCurrForm)}
                  className="flex items-center gap-1.5 text-xs font-semibold" style={S.accent}>
                  <Plus className="w-3.5 h-3.5" />{t("admAddCurrency")}</button>
              </div>

              <Dialog open={showCurrForm} onClose={() => setShowCurrForm(false)} title={t("admAddCurrencyTitle")} description={t("admAddCurrencyDesc")} maxWidth="md">
                <form onSubmit={handleSaveCurrency} className="grid grid-cols-2 gap-4">
                  {[
                    { k: "iso_code",       l: "ISO Code", p: "USD"        },
                    { k: "currency_name",  l: "Name",     p: "US Dollar"  },
                    { k: "symbol",         l: "Symbol",   p: "$"          },
                  ].map(({ k, l, p }) => (
                    <Field key={k} label={l}>
                      <input required value={(currForm as any)[k]}
                        onChange={(e) => setCurrForm({ ...currForm, [k]: e.target.value })}
                        placeholder={p} className={inputCls} style={S.input} />
                    </Field>
                  ))}
                  <Field label={t("admSymbolPosition")}>
                    <select value={currForm.symbol_position}
                      onChange={(e) => setCurrForm({ ...currForm, symbol_position: e.target.value })}
                      className={`${inputCls} nf-select`} style={S.input}>
                      <option value="BEFORE">{t("admBeforeAmount")}</option>
                      <option value="AFTER">{t("admAfterAmount")}</option>
                    </select>
                  </Field>
                  <div className="col-span-2 flex flex-col-reverse gap-3 border-t border-(--border) pt-5 sm:flex-row sm:justify-end">
                    <button type="submit" disabled={savingCurr}
                      className="h-11 rounded-[var(--radius-sm)] bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                      {savingCurr ? "Saving…" : "Add Currency"}
                    </button>
                    <button type="button" onClick={() => setShowCurrForm(false)}
                      className="h-11 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface) px-5 text-sm text-(--text-secondary) hover:bg-(--surface-raised)">{t("cancel")}</button>
                  </div>
                </form>
              </Dialog>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {currencies.length === 0 && (
                  <p className="text-sm col-span-full text-center py-4" style={S.muted}>{t("admNoCurrencies")}</p>
                )}
                {currencies.map((curr) => (
                  <div key={curr.iso_code}
                    className="border rounded-lg p-4 text-center"
                    style={S.raised}>
                    <div className="text-2xl font-semibold mb-1" style={S.primary}>{curr.symbol}</div>
                    <div className="text-xs font-semibold" style={S.primary}>{curr.iso_code}</div>
                    <div className="text-[10px] mt-0.5 truncate" style={S.muted}>{curr.currency_name}</div>
                    {curr.is_system_default && (
                      <span className="mt-1.5 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)]"
                        style={{ backgroundColor: "var(--accent-muted)", color: "var(--accent)" }}>{t("admDefault")}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ LANGUAGES TAB ══════════════════════════════════════════════ */}
          {activeTab === "languages" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{t("admSupportedLanguages")}</p>
                <button onClick={() => setShowLangForm(!showLangForm)}
                  className="flex items-center gap-1.5 text-xs font-semibold" style={S.accent}>
                  <Plus className="w-3.5 h-3.5" />{t("admAddLanguage")}</button>
              </div>

              <Dialog open={showLangForm} onClose={() => setShowLangForm(false)} title={t("admAddLanguageTitle")} description={t("admAddLanguageDesc")} maxWidth="md">
                <form onSubmit={handleSaveLanguage} className="grid grid-cols-2 gap-4">
                  {[
                    { k: "lang_code",         l: "Code",          p: "en"      },
                    { k: "lang_name_english",  l: "English Name",  p: "English" },
                    { k: "lang_name_native",   l: "Native Name",   p: "English" },
                  ].map(({ k, l, p }) => (
                    <Field key={k} label={l}>
                      <input required value={(langForm as any)[k]}
                        onChange={(e) => setLangForm({ ...langForm, [k]: e.target.value })}
                        placeholder={p} className={inputCls} style={S.input} />
                    </Field>
                  ))}
                  <Field label={t("admScriptDirection")}>
                    <select value={langForm.script}
                      onChange={(e) => setLangForm({ ...langForm, script: e.target.value })}
                      className={`${inputCls} nf-select`} style={S.input}>
                      <option value="LTR">{t("admLtr")}</option>
                      <option value="RTL">{t("admRtl")}</option>
                    </select>
                  </Field>
                  <div className="col-span-2 flex flex-col-reverse gap-3 border-t border-(--border) pt-5 sm:flex-row sm:justify-end">
                    <button type="submit" disabled={savingLang}
                      className="h-11 rounded-[var(--radius-sm)] bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                      {savingLang ? "Saving…" : "Add Language"}
                    </button>
                    <button type="button" onClick={() => setShowLangForm(false)}
                      className="h-11 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface) px-5 text-sm text-(--text-secondary) hover:bg-(--surface-raised)">{t("cancel")}</button>
                  </div>
                </form>
              </Dialog>

              <div className="rounded-lg border overflow-hidden" style={S.surface}>
                <table className="w-full border-collapse text-sm">
                  <TableHeader>
                    <tr className="border-b border-(--row-border)">
                      {["Code", "English Name", "Native", "Script", "Default"].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {languages.length === 0 && (
                      <tr><TableCell colSpan={5} className="text-center py-8" style={S.muted}>{t("admNoLanguages")}</TableCell></tr>
                    )}
                    {languages.map((lang) => (
                      <TableRow key={lang.lang_code}>
                        <TableCell className="font-mono font-semibold" style={S.accent}>{lang.lang_code}</TableCell>
                        <TableCell className="font-semibold" style={S.primary}>{lang.lang_name_english}</TableCell>
                        <TableCell style={S.sub}>{lang.lang_name_native}</TableCell>
                        <TableCell>
                          <span className="text-[11px] font-semibold border rounded-[var(--radius-xs)] px-2 py-0.5"
                            style={S.raised}>{lang.script}</span>
                        </TableCell>
                        <TableCell>
                          {lang.is_system_default
                            ? <CheckCircle className="w-4 h-4 text-(--success)" />
                            : <X className="w-4 h-4" style={S.muted} />
                          }
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ TIMEZONES TAB ══════════════════════════════════════════════ */}
          {activeTab === "timezones" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{t("admSupportedTimezones")}</p>
                <button onClick={() => setShowTzForm(!showTzForm)}
                  className="flex items-center gap-1.5 text-xs font-semibold" style={S.accent}>
                  <Plus className="w-3.5 h-3.5" />{t("admAddTimezone")}</button>
              </div>

              <Dialog open={showTzForm} onClose={() => setShowTzForm(false)} title={t("admAddTimezoneTitle")} description={t("admAddTimezoneDesc")} maxWidth="md">
                <form onSubmit={handleSaveTimezone} className="grid grid-cols-2 gap-4">
                  <Field label={t("admIanaCode")}>
                    <input required value={tzForm.tz_code}
                      onChange={(e) => setTzForm({ ...tzForm, tz_code: e.target.value })}
                      placeholder="Asia/Kolkata" className={inputCls} style={S.input} />
                  </Field>
                  <Field label={t("wzDisplayName")}>
                    <input required value={tzForm.tz_name}
                      onChange={(e) => setTzForm({ ...tzForm, tz_name: e.target.value })}
                      placeholder={t("admPhIndiaStandardTime")} className={inputCls} style={S.input} />
                  </Field>
                  <Field label={t("admUtcOffset")}>
                    <input required value={tzForm.utc_offset}
                      onChange={(e) => setTzForm({ ...tzForm, utc_offset: e.target.value })}
                      placeholder="+05:30" className={inputCls} style={S.input} />
                  </Field>
                  <Field label={t("admOffsetMinutes")}>
                    <input required type="number" value={tzForm.offset_minutes}
                      onChange={(e) => setTzForm({ ...tzForm, offset_minutes: parseInt(e.target.value) || 0 })}
                      placeholder="330" className={inputCls} style={S.input} />
                  </Field>
                  <div className="col-span-2 flex flex-col-reverse gap-3 border-t border-(--border) pt-5 sm:flex-row sm:justify-end">
                    <button type="submit" disabled={savingTz}
                      className="h-11 rounded-[var(--radius-sm)] bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                      {savingTz ? "Saving…" : "Add Timezone"}
                    </button>
                    <button type="button" onClick={() => setShowTzForm(false)}
                      className="h-11 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface) px-5 text-sm text-(--text-secondary) hover:bg-(--surface-raised)">{t("cancel")}</button>
                  </div>
                </form>
              </Dialog>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {timezones.length === 0 && (
                  <p className="text-sm col-span-full text-center py-4" style={S.muted}>{t("admNoTimezones")}</p>
                )}
                {timezones.map((tz) => (
                  <div key={tz.tz_code} className="border rounded-lg p-4 text-center" style={S.raised}>
                    <div className="text-sm font-semibold mb-1" style={S.primary}>{tz.utc_offset}</div>
                    <div className="text-xs font-mono" style={S.accent}>{tz.tz_code}</div>
                    <div className="text-[10px] mt-0.5 truncate" style={S.muted}>{tz.tz_name}</div>
                    {tz.is_dst && (
                      <span className="mt-1.5 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)]"
                        style={{ backgroundColor: "var(--accent-muted)", color: "var(--accent)" }}>{t("admObservesDst")}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ COUNTRIES TAB (expands to States/Provinces) ═══════════════════ */}
          {activeTab === "countries" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{t("admCountries")}</p>
                <button onClick={() => setShowCountryForm(!showCountryForm)}
                  className="flex items-center gap-1.5 text-xs font-semibold" style={S.accent}>
                  <Plus className="w-3.5 h-3.5" />{t("admAddCountry")}</button>
              </div>

              <Dialog open={showCountryForm} onClose={() => setShowCountryForm(false)} title={t("admAddCountryTitle")} description={t("admAddCountryDesc")} maxWidth="md">
                <form onSubmit={handleSaveCountry} className="grid grid-cols-2 gap-4">
                  {[
                    { k: "iso2",         l: "ISO2 Code",  p: "IN"    },
                    { k: "iso3",         l: "ISO3 Code",  p: "IND"   },
                    { k: "country_name", l: "Name",       p: "India" },
                    { k: "phone_code",   l: "Phone Code", p: "+91"   },
                    { k: "flag_emoji",   l: "Flag Emoji", p: "🇮🇳"   },
                  ].map(({ k, l, p }) => (
                    <Field key={k} label={l}>
                      <input required={k !== "phone_code" && k !== "flag_emoji"} value={(countryForm as any)[k]}
                        onChange={(e) => setCountryForm({ ...countryForm, [k]: e.target.value })}
                        placeholder={p} className={inputCls} style={S.input} />
                    </Field>
                  ))}
                  <div className="col-span-2 flex flex-col-reverse gap-3 border-t border-(--border) pt-5 sm:flex-row sm:justify-end">
                    <button type="submit" disabled={savingCountry}
                      className="h-11 rounded-[var(--radius-sm)] bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                      {savingCountry ? "Saving…" : "Add Country"}
                    </button>
                    <button type="button" onClick={() => setShowCountryForm(false)}
                      className="h-11 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface) px-5 text-sm text-(--text-secondary) hover:bg-(--surface-raised)">{t("cancel")}</button>
                  </div>
                </form>
              </Dialog>

              <div className="border-t" style={S.border}>
                {countries.length === 0 && <p className="text-sm text-center py-8" style={S.muted}>{t("admNoCountries")}</p>}
                {countries.map((country) => {
                  const isExp = expandedCountry === country.country_id;
                  return (
                    <div key={country.country_id} className="border-b" style={S.border}>
                      <button
                        onClick={() => handleExpandCountry(country.country_id)}
                        aria-expanded={isExp}
                        className="w-full flex min-h-12 items-center justify-between px-1 py-3 text-left transition-colors hover:bg-(--row-hover)">
                        <div className="flex items-center gap-3">
                          {isExp
                            ? <ChevronDown  className="w-4 h-4 shrink-0" style={S.muted} />
                            : <ChevronRight className="w-4 h-4 shrink-0" style={S.muted} />
                          }
                          {country.flag_emoji && <span>{country.flag_emoji}</span>}
                          <span className="font-semibold text-sm" style={S.primary}>{country.country_name}</span>
                          <span className="font-mono text-[11px]" style={S.muted}>{country.iso2} / {country.iso3}</span>
                          {country.phone_code && <span className="text-[11px]" style={S.muted}>{country.phone_code}</span>}
                        </div>
                      </button>

                      {isExp && (
                        <div className="px-4 py-3 border-t" style={{ ...S.surface, ...S.border }}>
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{t("admStatesProvinces")}</p>
                            <button onClick={() => setShowStateForm(showStateForm === country.country_id ? null : country.country_id)}
                              className="text-xs font-semibold flex items-center gap-1" style={S.accent}>
                              <Plus className="w-3.5 h-3.5" />{t("admAddState")}</button>
                          </div>

                          <Dialog open={showStateForm === country.country_id} onClose={() => setShowStateForm(null)} title={t("admAddStateTitle")} description={`Add a state/province beneath ${country.country_name}.`} maxWidth="md">
                            <form onSubmit={(e) => handleSaveState(e, country.country_id)} className="grid grid-cols-2 gap-4">
                              <Field label={t("admStateCode")}>
                                <input required value={stateForm.state_code}
                                  onChange={(e) => setStateForm({ ...stateForm, state_code: e.target.value })}
                                  placeholder="MH" className={inputCls} style={S.input} />
                              </Field>
                              <Field label={t("admStateName")}>
                                <input required value={stateForm.state_name}
                                  onChange={(e) => setStateForm({ ...stateForm, state_name: e.target.value })}
                                  placeholder={t("admPhMaharashtra")} className={inputCls} style={S.input} />
                              </Field>
                              <div className="col-span-2 flex flex-col-reverse gap-3 border-t border-(--border) pt-5 sm:flex-row sm:justify-end">
                                <button type="submit" disabled={savingState}
                                  className="h-11 rounded-[var(--radius-sm)] bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                                  {savingState ? "Saving…" : "Save State"}
                                </button>
                                <button type="button" onClick={() => setShowStateForm(null)}
                                  className="h-11 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface) px-5 text-sm text-(--text-secondary) hover:bg-(--surface-raised)">{t("cancel")}</button>
                              </div>
                            </form>
                          </Dialog>

                          {loadingStates[country.country_id] ? (
                            <div className="text-xs flex items-center gap-1.5" style={S.muted}>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />{t("loadingEllipsis")}</div>
                          ) : (states[country.country_id] || []).length === 0 ? (
                            <p className="text-xs" style={S.muted}>{t("admNoStates")}</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {(states[country.country_id] || []).map((state: any) => (
                                <span key={state.state_id}
                                  className="text-xs border rounded-lg px-2.5 py-1 font-medium"
                                  style={{ ...S.raised, ...S.primary }}>
                                  {state.state_name}
                                  <span className="font-mono ml-1.5 text-[10px]" style={S.muted}>({state.state_code})</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ COSTING METHODS TAB ═══════════════════════════════════════════ */}
          {activeTab === "costingMethods" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{t("admCostingMethods")}</p>
                <button onClick={() => setShowCostingForm(!showCostingForm)}
                  className="flex items-center gap-1.5 text-xs font-semibold" style={S.accent}>
                  <Plus className="w-3.5 h-3.5" />{t("admAddCostingMethod")}</button>
              </div>

              <Dialog open={showCostingForm} onClose={() => setShowCostingForm(false)} title={t("admAddCostingTitle")} description={t("admAddCostingDesc")} maxWidth="md">
                <form onSubmit={handleSaveCostingMethod} className="grid grid-cols-2 gap-4">
                  <Field label={t("admMethodCode")}>
                    <input required value={costingForm.method_code}
                      onChange={(e) => setCostingForm({ ...costingForm, method_code: e.target.value.toUpperCase() })}
                      placeholder="WEIGHTED_AVG" className={inputCls} style={S.input} />
                  </Field>
                  <Field label={t("admMethodName")}>
                    <input required value={costingForm.method_name}
                      onChange={(e) => setCostingForm({ ...costingForm, method_name: e.target.value })}
                      placeholder={t("admPhWeightedAverage")} className={inputCls} style={S.input} />
                  </Field>
                  <Field label={t("admAutoPostVariance")}>
                    <select value={costingForm.variance_auto}
                      onChange={(e) => setCostingForm({ ...costingForm, variance_auto: e.target.value })}
                      className={`${inputCls} nf-select`} style={S.input}>
                      <option value="NO">No</option>
                      <option value="YES">Yes</option>
                    </select>
                  </Field>
                  <div />
                  {[
                    { k: "layer_tracking",    l: "FIFO layer tracking" },
                    { k: "bio_asset_support", l: "IAS 41 bio-asset support" },
                    { k: "fair_value_option", l: "Fair value revaluation" },
                    { k: "amort_option",      l: "Amortisation posting" },
                  ].map(({ k, l }) => (
                    <label key={k} className="flex items-center gap-2 text-sm" style={S.primary}>
                      <input type="checkbox" checked={(costingForm as any)[k]}
                        onChange={(e) => setCostingForm({ ...costingForm, [k]: e.target.checked })} />
                      {l}
                    </label>
                  ))}
                  <div className="col-span-2 flex flex-col-reverse gap-3 border-t border-(--border) pt-5 sm:flex-row sm:justify-end">
                    <button type="submit" disabled={savingCosting}
                      className="h-11 rounded-[var(--radius-sm)] bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                      {savingCosting ? "Saving…" : "Add Costing Method"}
                    </button>
                    <button type="button" onClick={() => setShowCostingForm(false)}
                      className="h-11 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface) px-5 text-sm text-(--text-secondary) hover:bg-(--surface-raised)">{t("cancel")}</button>
                  </div>
                </form>
              </Dialog>

              <div className="rounded-lg border overflow-hidden" style={S.surface}>
                <table className="w-full border-collapse text-sm">
                  <TableHeader>
                    <tr className="border-b border-(--row-border)">
                      {["Code", "Name", "Layer Tracking", "Bio-Asset", "Fair Value", "Amortisation"].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {costingMethods.length === 0 && (
                      <tr><TableCell colSpan={6} className="text-center py-8" style={S.muted}>{t("admNoCostingMethods")}</TableCell></tr>
                    )}
                    {costingMethods.map((cm) => (
                      <TableRow key={cm.method_code}>
                        <TableCell className="font-mono font-semibold" style={S.accent}>{cm.method_code}</TableCell>
                        <TableCell className="font-semibold" style={S.primary}>{cm.method_name}</TableCell>
                        {["layer_tracking", "bio_asset_support", "fair_value_option", "amort_option"].map((flag) => (
                          <TableCell key={flag}>
                            {cm[flag]
                              ? <CheckCircle className="w-4 h-4 text-(--success)" />
                              : <X className="w-4 h-4" style={S.muted} />
                            }
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
