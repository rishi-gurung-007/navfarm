"use client";

/**
 * The shed a batch stands in, changeable after the batch is active (D21,
 * review A12). The feed forecast draws a batch's feed from the silos of its
 * shed; a batch with no shed is fed from the farm store. Offers only the
 * sheds of the batch's own farm, since the API refuses any other.
 */
import { useState } from "react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/useLanguage";

interface ShedOption { shed_id: string; shed_code: string; shed_name: string; farm_id: string | null; is_active?: boolean }

export function BatchShedField({
  batch,
  sheds,
  onSaved,
}: {
  batch: { batch_id: string; status: string; shed_id: string | null; farm_id: string | null };
  sheds: ShedOption[];
  onSaved: (shedId: string | null) => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(batch.shed_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = (Array.isArray(sheds) ? sheds : [])
    .filter((s) => s.is_active !== false && (!batch.farm_id || s.farm_id === batch.farm_id))
    .sort((a, b) => a.shed_code.localeCompare(b.shed_code));
  const label = (id: string | null) => {
    const s = options.find((o) => o.shed_id === id) ?? sheds.find((o) => o.shed_id === id);
    return s ? `${s.shed_code} — ${s.shed_name}` : t("blNoShed");
  };
  const closed = batch.status === "CLOSED" || batch.status === "CANCELLED";

  if (closed) {
    return (
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("blShed")}</p>
        <p className="mt-0.5 font-semibold" style={{ color: "var(--text-primary)" }}>{label(batch.shed_id)}</p>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.patch(`/batch/${batch.batch_id}/shed`, { shed_id: value || null });
      onSaved(value || null);
    } catch (err: any) {
      setError(err?.message || t("blShedSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label htmlFor={`shed-${batch.batch_id}`} className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        {t("blShed")}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <select
          id={`shed-${batch.batch_id}`}
          className="nf-input-sm nf-select min-w-0 flex-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" }}
        >
          <option value="">{t("blNoShed")}</option>
          {options.map((s) => (
            <option key={s.shed_id} value={s.shed_id}>{`${s.shed_code} — ${s.shed_name}`}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={save} disabled={saving || value === (batch.shed_id ?? "")}>
          {t("blSaveShed")}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
