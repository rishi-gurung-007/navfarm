"use client";

import type { CSSProperties } from "react";
import { Field, inputStyle } from "./breeding-form-parts";
import { boarResultOf, type Issue, type Row, type SemenBoarResultForm } from "./breeding-rules";

const card: CSSProperties = { backgroundColor: "var(--surface)", borderColor: "var(--border)" };
const muted: CSSProperties = { color: "var(--text-muted)" };

/**
 * What each chosen boar gave at this collection (plan 2026-11-02-ai-station-semen-collection, Phase 2): the collector, the raw
 * volume, his doses, morphology, motility and concentration, and whether his ejaculate went into the lot. A rejected ejaculate
 * is recorded with its reason and is in none of the lot's doses, boars or costs. The lot's doses are these doses added up.
 */
export function SemenBoarResults({
  boars,
  results,
  collectors,
  issues,
  onChange,
}: {
  /** The chosen boars, in the order chosen. */
  boars: Row[];
  results: Record<string, Partial<SemenBoarResultForm>>;
  collectors: Row[];
  issues: Issue[];
  onChange: (boarId: string, patch: Partial<SemenBoarResultForm>) => void;
}) {
  if (!boars.length) {
    return (
      <p className="text-xs" style={muted}>
        Choose the boars first; each one's collection is entered here.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {boars.map((b) => {
        const r = boarResultOf({ results }, b.animal_id);
        const at = (k: keyof SemenBoarResultForm) => `results.${b.animal_id}.${k}`;
        const num = (key: keyof SemenBoarResultForm, label: string, step: string, required = false) => (
          <Field label={label} issues={issues} name={at(key)} required={required}>
            <input
              type="number"
              min="0"
              step={step}
              inputMode="decimal"
              className="nf-input w-full text-sm"
              style={inputStyle(issues, at(key))}
              value={r[key] as string}
              onChange={(e) => onChange(b.animal_id, { [key]: e.target.value })}
            />
          </Field>
        );
        return (
          <div key={b.animal_id} className="rounded-lg border p-3 space-y-3" style={card}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {b.animal_code}
              </span>
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={muted}>
                <input
                  type="checkbox"
                  checked={r.accepted}
                  onChange={(e) => onChange(b.animal_id, { accepted: e.target.checked })}
                />
                Ejaculate used in the lot
              </label>
            </div>

            {r.accepted ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Field label="Collector" issues={issues} name={at("collector_id")}>
                    <select
                      className="nf-input w-full text-sm"
                      value={r.collector_id}
                      onChange={(e) => onChange(b.animal_id, { collector_id: e.target.value })}
                    >
                      <option value="">Not recorded</option>
                      {collectors.map((c) => (
                        <option key={c.collector_id} value={c.collector_id}>
                          {c.collector_code} — {c.collector_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {num("volume_ml", "Raw semen (ml)", "0.1")}
                  {num("doses", "Doses", "1", true)}
                  {num("morphology_pct", "Morphology (%)", "0.1")}
                  {num("motility_pct", "Motility (%)", "0.1")}
                  {num("concentration_m_per_ml", "Concentration (M/ml)", "1")}
                </div>
              </>
            ) : (
              <Field label="Why it was rejected" issues={issues} name={at("reject_reason")} required>
                <input
                  type="text"
                  maxLength={200}
                  className="nf-input w-full text-sm"
                  style={inputStyle(issues, at("reject_reason"))}
                  value={r.reject_reason}
                  onChange={(e) => onChange(b.animal_id, { reject_reason: e.target.value })}
                />
              </Field>
            )}
          </div>
        );
      })}
    </div>
  );
}
