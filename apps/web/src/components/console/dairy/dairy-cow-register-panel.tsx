"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { InlineAlert } from "@/components/ui/alert";
import { StatRow, StatCard } from "@/components/ui/stat-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { getActiveCompanyId, getActiveOperationalAreaId } from "@/hooks/useAuth";
import { api } from "@/services/api-client";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Animal statuses that mean "currently producing milk". */
const MILKING_STATUSES = ["LACTATING", "ACTIVE"];

/**
 * The dairy herd register.
 *
 * This panel used to be entirely fictional: eight cows named Bella, Daisy and
 * Rosie hardcoded in component state, with a "Register Dairy Cow" form that
 * appended a ninth to that array and lost it on refresh. Every row now comes
 * from `animal_register` through /animal, and registering a cow writes a real
 * row — the same registry the Piggery screens read.
 *
 * Yield and composition come from `milk_production_log`; a cow with no per-cow
 * milk record shows "—" rather than an invented litre count.
 */
export default function DairyCowRegisterPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const areaId = getActiveOperationalAreaId();

  const [cows, setCows] = useState<Row[]>([]);
  const [breeds, setBreeds] = useState<Row[]>([]);
  const [milkByAnimal, setMilkByAnimal] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [breedFilter, setBreedFilter] = useState("ALL");

  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    ear_tag: "",
    rfid_tag: "",
    breed_id: "",
    animal_type: "COW",
    gender: "F",
    dob: "",
    entry_type: "PURCHASED_LOCAL",
    entry_date: today(),
    parity_count: 0,
    acquisition_cost: "",
  });

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      setLoadError(t("dyNoCompany"));
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ companyId, limit: "500" });
      const [animalRes, breedRes, milkRes] = await Promise.all([
        api.get(`/animal?${params.toString()}`),
        api.get(`/breed?companyId=${companyId}&limit=200`).catch(() => []),
        api.get(`/milk-production?company_id=${companyId}&log_date=${today()}`).catch(() => []),
      ]);
      const allAnimals = unwrap<Row[]>(animalRes) || [];
      // The register is area-scoped when an operational area is active, so a
      // dairy unit never shows another unit's herd.
      setCows(areaId ? allAnimals.filter((a) => !a.operational_area_id || a.operational_area_id === areaId) : allAnimals);
      setBreeds(unwrap<Row[]>(breedRes) || []);
      const perAnimal: Record<string, Row> = {};
      for (const m of unwrap<Row[]>(milkRes) || []) {
        if (m.animal_id) perAnimal[m.animal_id] = m;
      }
      setMilkByAnimal(perAnimal);
    } catch (err: any) {
      setLoadError(err?.message || t("dyFailedToLoadHerd"));
    } finally {
      setLoading(false);
    }
  }, [companyId, areaId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const breedName = (id?: string | null) =>
    breeds.find((b) => b.breed_id === id)?.breed_name || "—";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cows.filter((c) => {
      const matchesSearch =
        !q ||
        (c.animal_code || "").toLowerCase().includes(q) ||
        (c.rfid_tag || "").toLowerCase().includes(q) ||
        (c.ear_tag || "").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
      const matchesBreed = breedFilter === "ALL" || c.breed_id === breedFilter;
      return matchesSearch && matchesStatus && matchesBreed;
    });
  }, [cows, search, statusFilter, breedFilter]);

  const stats = useMemo(() => {
    const total = cows.length;
    const milking = cows.filter((c) => MILKING_STATUSES.includes(c.status)).length;
    const dry = cows.filter((c) => c.status === "DRY").length;
    const pregnant = cows.filter((c) => c.status === "PREGNANT").length;
    const yields = Object.values(milkByAnimal).map((m) => Number(m.quantity_litres || 0));
    const avg = yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : null;
    const tagged = cows.filter((c) => c.rfid_tag).length;
    return { total, milking, dry, pregnant, avg, tagged };
  }, [cows, milkByAnimal]);

  /**
   * Days in milk. `productive_life_start` is when the animal entered
   * production, which for a dairy cow is its lactation start — the closest
   * real column to DIM. Shown as "—" when it was never recorded, rather than
   * filled with a plausible-looking number.
   */
  const daysInMilk = (cow: Row): number | null => {
    if (!cow.productive_life_start) return null;
    const start = new Date(cow.productive_life_start);
    if (Number.isNaN(start.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86_400_000));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!companyId) return setFormError(t("dyNoCompany"));
    if (!form.breed_id) return setFormError(t("dyBreedRequired"));

    const breed = breeds.find((b) => b.breed_id === form.breed_id);
    if (!breed?.nob_id || !breed?.lob_id) {
      return setFormError(t("dyBreedMissingLob"));
    }

    setSaving(true);
    try {
      const res = await api.post(`/animal`, {
        company_id: companyId,
        nob_id: breed.nob_id,
        lob_id: breed.lob_id,
        animal_type: form.animal_type,
        breed_id: form.breed_id,
        gender: form.gender,
        entry_type: form.entry_type,
        entry_date: form.entry_date,
        ...(form.dob ? { dob: form.dob } : {}),
        ...(form.ear_tag.trim() ? { ear_tag: form.ear_tag.trim() } : {}),
        ...(form.rfid_tag.trim() ? { rfid_tag: form.rfid_tag.trim() } : {}),
        ...(areaId ? { operational_area_id: areaId } : {}),
        ...(form.parity_count ? { parity_count: Number(form.parity_count) } : {}),
        ...(form.acquisition_cost ? { acquisition_cost: Number(form.acquisition_cost) } : {}),
      });
      const created = unwrap<Row>(res);
      setShowAddModal(false);
      setForm({ ...form, ear_tag: "", rfid_tag: "", dob: "", parity_count: 0, acquisition_cost: "" });
      await load();
      setNotice(t("dyCowRegistered", { code: created?.animal_code || "" }));
      setTimeout(() => setNotice(""), 4000);
    } catch (err: any) {
      setFormError(err?.message || t("dyFailedToRegister"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      {notice && <InlineAlert variant="success">{notice}</InlineAlert>}

      <StatRow columns={4}>
        <StatCard
          label={t("dashTotalDairyHerd")}
          value={stats.total}
          unit={t("btColHead")}
          sub={stats.total ? t("dyRfidTagged", { pct: String(Math.round((stats.tagged / stats.total) * 100)) }) : undefined}
        />
        <StatCard
          label={t("dyMilkingCows")}
          value={stats.milking}
          sub={t("dyActiveLactationStages")}
        />
        <StatCard
          label={t("dyAvgYieldPerCow")}
          value={stats.avg === null ? "—" : `${stats.avg.toFixed(1)} L`}
          sub={stats.avg === null ? t("dyNoYieldToday") : t("dyDailyParlorAverage")}
          
        />
        <StatCard
          label={t("dyDryAndHeifers")}
          value={stats.dry + stats.pregnant}
          unit={t("btColHead")}
          sub={t("dyDryPregnantSplit", { dry: String(stats.dry), pregnant: String(stats.pregnant) })}
        />
      </StatRow>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <Search className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <input
              type="text"
              placeholder={t("dyPhSearchCow")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-44 bg-transparent text-xs font-medium outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-xs font-semibold"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <option value="ALL">{t("baapAllStatuses")}</option>
            <option value="LACTATING">{t("dyMilking")}</option>
            <option value="DRY">{t("ctDryStatus")}</option>
            <option value="PREGNANT">{t("dyPregnantHeifer")}</option>
            <option value="QUARANTINE">{t("anpStatusQuarantine")}</option>
          </select>

          {/* Breeds come from breed_master, so this list matches what the
              company can actually register — it used to offer three fixed
              breed names regardless of the tenant's catalogue. */}
          <select
            value={breedFilter}
            onChange={(e) => setBreedFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-xs font-semibold"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <option value="ALL">{t("dyAllBreeds")}</option>
            {breeds.map((b) => (
              <option key={b.breed_id} value={b.breed_id}>{b.breed_name}</option>
            ))}
          </select>
        </div>

        <Button onClick={() => { setFormError(""); setShowAddModal(true); }} className="gap-1.5">
          <Plus className="h-4 w-4" />{t("dyRegisterDairyCow")}
        </Button>
      </div>

      {loading ? (
        <LoadingState label={t("dyLoadingHerd")} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState title={t("dyNoCows")} description={t("dyNoCowsHint")} />
      ) : (
        <div
          className="overflow-hidden rounded-[var(--radius-lg)] border"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead>
                <tr
                  className="border-b text-[11px] font-semibold uppercase text-[var(--text-secondary)]"
                  style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}
                >
                  <th className="p-3">{t("dyEarTagAndName")}</th>
                  <th className="p-3">{t("rfmRfidTag")}</th>
                  <th className="p-3">{t("dashBreedLabel")}</th>
                  <th className="p-3 text-center">{t("dyLactNo")}</th>
                  <th className="p-3 text-center">{t("dyDim")}</th>
                  <th className="p-3 text-right">{t("dyDailyMilkL")}</th>
                  <th className="p-3 text-right">{t("dyFatSnf")}</th>
                  <th className="p-3 text-right">{t("btColStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {filtered.map((cow) => {
                  const milk = milkByAnimal[cow.animal_id];
                  const dim = daysInMilk(cow);
                  return (
                    <tr key={cow.animal_id} className="transition-colors hover:bg-[var(--surface-raised)]">
                      <td className="p-3 font-semibold">
                        <span className="font-mono text-xs font-bold text-[var(--accent)]">{cow.animal_code}</span>
                        {/* Many herds use the animal code as the ear tag; only
                            show the second line when it adds information. */}
                        {cow.ear_tag && cow.ear_tag !== cow.animal_code && (
                          <p className="text-[10px] font-normal text-[var(--text-secondary)]">{cow.ear_tag}</p>
                        )}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-[var(--text-secondary)]">{cow.rfid_tag || "—"}</td>
                      <td className="p-3">{cow.breed_name || breedName(cow.breed_id)}</td>
                      <td className="p-3 text-center font-mono font-bold">{cow.parity_count || "—"}</td>
                      <td className="p-3 text-center font-mono">{dim === null ? "—" : t("dyDaysShort", { n: String(dim) })}</td>
                      <td className="p-3 text-right font-mono font-bold text-[var(--accent)]">
                        {milk ? `${Number(milk.quantity_litres).toFixed(1)} L` : "—"}
                      </td>
                      <td className="p-3 text-right font-mono text-[11px]">
                        {milk?.fat_pct ? `${Number(milk.fat_pct).toFixed(2)}% / ${Number(milk.snf_pct || 0).toFixed(2)}%` : "—"}
                      </td>
                      <td className="p-3 text-right"><StatusBadge status={cow.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t("dyRegisterIndividualCow")}
        description={t("dyRegisterCowDesc")}
        maxWidth="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={submit as any} disabled={saving}>{saving ? t("asSaving") : t("dySaveDairyCow")}</Button>
          </div>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          {formError && <InlineAlert variant="danger">{formError}</InlineAlert>}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* animal_code is issued by the number series on the server — the
                old form let the user type one, which would collide. */}
            <label className="block">
              <span className="nf-text-label">{t("dyEarTagIdRequired")}</span>
              <input
                type="text"
                value={form.ear_tag}
                onChange={(e) => setForm({ ...form, ear_tag: e.target.value })}
                className="nf-input w-full font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="nf-text-label">{t("dyRfidTag")}</span>
              <input
                type="text"
                value={form.rfid_tag}
                onChange={(e) => setForm({ ...form, rfid_tag: e.target.value })}
                className="nf-input w-full font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="nf-text-label">{t("dashBreedLabel")}</span>
              <Select value={form.breed_id} onChange={(e) => setForm({ ...form, breed_id: e.target.value })}>
                <option value="">{t("dySelectBreed")}</option>
                {breeds.map((b) => (
                  <option key={b.breed_id} value={b.breed_id}>{b.breed_name}</option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="nf-text-label">{t("dyAnimalType")}</span>
              <Select value={form.animal_type} onChange={(e) => setForm({ ...form, animal_type: e.target.value })}>
                <option value="COW">{t("dyTypeCow")}</option>
                <option value="HEIFER">{t("dyTypeHeifer")}</option>
                <option value="CALF">{t("dyTypeCalf")}</option>
                <option value="BULL">{t("dyTypeBull")}</option>
              </Select>
            </label>
            <label className="block">
              <span className="nf-text-label">{t("anpDateOfBirth")}</span>
              <input
                type="date"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
                className="nf-input w-full text-sm"
              />
            </label>
            <label className="block">
              <span className="nf-text-label">{t("dyLactationNo")}</span>
              <input
                type="number"
                min={0}
                value={form.parity_count}
                onChange={(e) => setForm({ ...form, parity_count: Number(e.target.value) })}
                className="nf-input w-full font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="nf-text-label">{t("anpEntryDate")}</span>
              <input
                type="date"
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                className="nf-input w-full text-sm"
              />
            </label>
            <label className="block">
              <span className="nf-text-label">{t("dyAcquisitionCost")}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.acquisition_cost}
                onChange={(e) => setForm({ ...form, acquisition_cost: e.target.value })}
                className="nf-input w-full font-mono text-sm"
              />
            </label>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)]">{t("dyCodeAutoAssigned")}</p>
        </form>
      </Dialog>
    </div>
  );
}
