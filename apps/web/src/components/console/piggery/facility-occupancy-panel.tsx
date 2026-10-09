"use client";

import { useEffect, useState } from "react";
import {
  Loader2, Building2, AlertTriangle, ShieldCheck,
  ShieldAlert, CheckCircle2, Users,
} from "lucide-react";

import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { StatRow, StatCard } from "@/components/ui/stat-row";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised:  { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub:     { color: "var(--text-secondary)" },
  muted:   { color: "var(--text-muted)" },
  accent:  { color: "var(--accent)" },
  danger:  { color: "var(--danger)", borderColor: "var(--danger)", backgroundColor: "var(--danger-muted)" },
  warning: { color: "var(--warning)", borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)" },
  success: { color: "var(--success)", borderColor: "var(--success)", backgroundColor: "var(--success-muted)" },
};

export default function FacilityOccupancyPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [locations, setLocations] = useState<Row[]>([]);

  const [viewingLocation, setViewingLocation] = useState<Row | null>(null);
  const [locationAnimals, setLocationAnimals] = useState<Row[]>([]);
  const [locationAnimalsLoading, setLocationAnimalsLoading] = useState(false);

  const openLocationAnimals = async (loc: Row) => {
    setViewingLocation(loc);
    setLocationAnimalsLoading(true);
    try {
      const res = await api.get(`/animal?companyId=${companyId}&currentLocationId=${loc.location_id}&limit=500`);
      setLocationAnimals(unwrap<Row[]>(res) || []);
    } catch {
      setLocationAnimals([]);
    } finally {
      setLocationAnimalsLoading(false);
    }
  };

  const loadOccupancy = async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/location/occupancy?companyId=${companyId}`);
      setLocations(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("fopFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOccupancy();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCapacity = locations.reduce((sum, l) => sum + (l.max_capacity || 0), 0);
  const totalOccupied = locations.reduce((sum, l) => sum + (l.current_occupancy || 0), 0);
  const totalQuarantinePens = locations.filter((l) => l.biosecurity_status === "QUARANTINE_ACTIVE").length;
  const totalOverCapacity = locations.filter((l) => l.is_over_capacity).length;

  return (
    <div className="space-y-6">
      {/* ── Top Header Bar ── */}
      <div className="rounded-[var(--radius-lg)] border p-4" style={S.surface}>
        <h3 className="text-base font-semibold" style={S.primary}>{t("fopTitle")}</h3>
        <p className="text-xs" style={S.muted}>{t("fopSubtitle")}</p>
      </div>

      {error && <InlineAlert variant="danger">{error}</InlineAlert>}

      {/* ── Top Executive KPI Cards ── */}
      <StatRow>
        <StatCard
          icon={Building2}
          label={t("fopTotalCapacity")}
          value={totalCapacity > 0 ? totalCapacity.toLocaleString() : "—"}
          unit={t("fopHead")}
          sub={t("fopConfiguredLocationsPens", { count: locations.length })}
        />
        <StatCard
          icon={Users}
          label={t("fopCurrentOccupancy")}
          value={totalOccupied.toLocaleString()}
          unit={t("fopHead")}
          sub={totalCapacity > 0 ? t("fopOverallUtilization", { pct: Math.round((totalOccupied / totalCapacity) * 100) }) : t("fopHeadcountActive")}
        />
        <StatCard
          icon={totalQuarantinePens > 0 ? ShieldAlert : ShieldCheck}
          tone={totalQuarantinePens > 0 ? "warning" : "default"}
          emphasis
          label={t("fopBiosecurityAlert")}
          value={totalQuarantinePens}
          unit={t("fopPens")}
          sub={totalQuarantinePens > 0 ? t("fopActiveQuarantine") : t("fopAllPensNormal")}
        />
        <StatCard
          icon={AlertTriangle}
          tone={totalOverCapacity > 0 ? "danger" : "default"}
          emphasis
          label={t("fopOverCapacityPens")}
          value={totalOverCapacity}
          unit={t("fopPens")}
          sub={totalOverCapacity > 0 ? t("fopRequiresRebalancing") : t("fopOptimalDensity")}
        />
      </StatRow>

      {loading && (
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" style={S.accent} />
          <p className="mt-3 text-sm" style={S.sub}>{t("fopLoadingMetrics")}</p>
        </div>
      )}

      {/* ── Grid of Location / Pen Cards ── */}
      {!loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((loc) => {
            const isQuarantine = loc.biosecurity_status === "QUARANTINE_ACTIVE";
            const isOver = loc.is_over_capacity;
            const pct = loc.utilization_pct || 0;

            return (
              <div
                key={loc.location_id}
                className="rounded-[var(--radius-lg)] border p-4 shadow-sm transition-all"
                style={isOver ? S.danger : isQuarantine ? S.warning : S.surface}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold font-mono text-sm" style={S.primary}>
                        {loc.location_code}
                      </span>
                      <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase" style={S.surface}>
                        {loc.location_type || "PEN"}
                      </span>
                    </div>
                    <p className="text-xs font-medium mt-1" style={S.primary}>
                      {loc.location_name}
                    </p>
                    <p className="text-[11px]" style={S.muted}>
                      {t("fopUnderParent", { parent: loc.parent_name })}
                    </p>
                  </div>

                  {isQuarantine ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase rounded-[var(--radius-xs)] border px-2 py-0.5" style={S.warning}>
                      <ShieldAlert className="h-3 w-3" /> {t("fopSickCount", { count: loc.sick_animal_count })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase rounded-[var(--radius-xs)] border px-2 py-0.5" style={S.surface}>
                      <CheckCircle2 className="h-3 w-3" style={S.accent} /> {t("fopClean")}
                    </span>
                  )}
                </div>

                {/* Progress Bar */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span style={S.sub}>{t("fopOccupancy")}</span>
                    <span className="font-mono font-bold" style={S.primary}>
                      {loc.current_occupancy} / {loc.max_capacity != null ? `${loc.max_capacity} ${loc.capacity_uom}` : "∞"}
                    </span>
                  </div>

                  <div className="h-3 w-full rounded-full overflow-hidden" style={S.raised}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(pct, 100)}%`,
                        backgroundColor: isOver ? "var(--danger)" : pct >= 90 ? "var(--warning)" : "var(--accent)",
                      }}
                    />
                  </div>

                  <div className="flex justify-between text-[11px]" style={S.muted}>
                    <button
                      type="button"
                      onClick={() => openLocationAnimals(loc)}
                      className="underline decoration-dotted hover:opacity-80"
                      style={S.accent}
                    >
                      {t("fopAnimalsBatches", { animals: loc.animal_count, batches: loc.batch_count })}
                    </button>
                    <span>{loc.max_capacity ? `${pct}%` : t("fopNoLimitSet")}</span>
                  </div>

                  {(loc.last_cleaned_date || loc.last_disinfected_date) && (
                    <div className="pt-2 border-t border-slate-800/40 text-[10px] text-slate-400 flex justify-between">
                      <span>{t("fopCleaned", { date: loc.last_cleaned_date || "--" })}</span>
                      <span>{t("fopDisinfected", { date: loc.last_disinfected_date || "--" })}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {locations.length === 0 && (
            <div className="col-span-3 py-12 text-center rounded-[var(--radius-lg)] border" style={S.surface}>
              <p className="text-sm" style={S.sub}>{t("fopNoLocationsConfigured")}</p>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: Animals at this location ── */}
      {viewingLocation && (
        <Dialog
          open={!!viewingLocation}
          onClose={() => setViewingLocation(null)}
          title={t("fopAnimalsAtLocationTitle", { code: viewingLocation.location_code })}
          maxWidth="md"
        >
          {locationAnimalsLoading ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.accent} />
            </div>
          ) : locationAnimals.length === 0 ? (
            <p className="py-8 text-center text-sm" style={S.sub}>{t("fopNoAnimalsAtLocation")}</p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-[var(--radius-sm)] border" style={S.surface}>
              {locationAnimals.map((a) => (
                <div key={a.animal_id} className="flex items-center justify-between border-b px-3 py-2 text-xs last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <span className="font-mono font-semibold" style={S.accent}>{a.rfid_tag || a.animal_code}</span>
                  <span style={S.muted}>{a.animal_type}</span>
                  <span style={S.muted}>{a.status}</span>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
