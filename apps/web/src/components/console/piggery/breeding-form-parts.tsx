"use client";

import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, Layers, X, XCircle } from "lucide-react";
import type { RemoteOptions } from "@/modules/master-data/SearchableEntitySelect";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { errorsOf, issueFor, type Issue, type Row } from "./breeding-rules";

const surface: CSSProperties = { backgroundColor: "var(--surface)", borderColor: "var(--border)" };
const raised: CSSProperties = { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" };

/**
 * A fresh form is empty, so every required field is "wrong" — showing that in red before anyone has touched anything is
 * noise. Errors appear inline once the user has started (or tried to save); Save stays disabled throughout.
 */
const EngagedContext = createContext(true);

/** The dialog every breeding entry sits in: a title, the form on the left and the live checks on the right. */
export function EntryModal({
  title,
  icon,
  onClose,
  onSubmit,
  submitting,
  submitLabel,
  savingLabel,
  issues,
  summary,
  children,
}: {
  title: string;
  icon: ReactNode;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  submitLabel: string;
  savingLabel: string;
  issues: Issue[];
  /** What this entry will do once saved — stock moved, status changed — shown beside the checks. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const blocking = errorsOf(issues);
  const [engaged, setEngaged] = useState(false);
  return (
    <EngagedContext.Provider value={engaged}>
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <form
        onSubmit={onSubmit}
        onClickCapture={() => setEngaged(true)}
        onInputCapture={() => setEngaged(true)}
        noValidate
        className="rounded-[var(--radius-lg)] border w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl"
        style={{ ...surface, ["--field-error" as string]: engaged ? "var(--danger)" : "var(--border)", ["--field-warn" as string]: "var(--warning)" } as CSSProperties}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {icon} {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-5 min-w-0">{children}</div>
          <aside className="space-y-3 lg:sticky lg:top-0 self-start">
            {summary}
            <ChecksPanel issues={issues} />
          </aside>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs" style={{ color: blocking.length && engaged ? "var(--danger)" : "var(--text-muted)" }}>
            {blocking.length
              ? engaged
                ? `${blocking.length} thing${blocking.length === 1 ? "" : "s"} to fix before saving`
                : "Work down the steps — Save unlocks when they are complete."
              : "Everything the system checks is in order."}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting || blocking.length > 0}>
              {submitting ? savingLabel : submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>
    </EngagedContext.Provider>
  );
}

/** A numbered section of a form. `done` ticks it once its answer is in, so the order to fill it in reads at a glance. */
export function Step({ n, title, hint, done, children }: { n: number; title: string; hint?: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0"
          style={done ? { backgroundColor: "var(--success)", color: "#fff" } : { backgroundColor: "var(--surface-secondary)", color: "var(--text-secondary)" }}
        >
          {done ? <CheckCircle2 className="w-4 h-4" /> : n}
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{title}</h4>
          {hint && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{hint}</p>}
        </div>
      </div>
      <div className="space-y-3 pl-0 sm:pl-8">{children}</div>
    </section>
  );
}

/** A label, its control and the first problem with it — an error stops the save, a warning only asks for a second look. */
export function Field({
  label,
  htmlFor,
  issues,
  name,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  issues: Issue[];
  name: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  const engaged = useContext(EngagedContext);
  const found = issueFor(issues, name);
  const issue = found && (engaged || found.level === "warn") ? found : undefined;
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }} htmlFor={htmlFor}>
        {label}
        {required && <span style={{ color: "var(--danger)" }}> *</span>}
      </label>
      {children}
      {issue ? (
        <p className="text-[11px] mt-1 flex items-start gap-1" style={{ color: issue.level === "error" ? "var(--danger)" : "var(--warning)" }} role={issue.level === "error" ? "alert" : undefined}>
          {issue.level === "error" ? <XCircle className="w-3 h-3 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />}
          <span>{issue.text}</span>
        </p>
      ) : (
        hint && <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{hint}</p>
      )}
    </div>
  );
}

/** Red border on an input whose field currently has an error. */
export function inputStyle(issues: Issue[], name: string): CSSProperties {
  const issue = issueFor(issues, name);
  // --field-error / --field-warn are set by EntryModal: an error stays quiet until the user has started the form.
  return {
    backgroundColor: "var(--surface)",
    borderColor: issue ? (issue.level === "error" ? "var(--field-error, var(--danger))" : "var(--field-warn, var(--warning))") : "var(--border)",
    color: "var(--text-primary)",
  };
}

/** Every rule that applies, ticked or not — the user never has to guess why Save is greyed out. */
export function ChecksPanel({ issues }: { issues: Issue[] }) {
  const engaged = useContext(EngagedContext);
  const errors = engaged ? issues.filter((i) => i.level === "error") : [];
  const warns = issues.filter((i) => i.level === "warn");
  return (
    <div className="rounded-[var(--radius-md)] border p-3 space-y-2" style={raised} aria-live="polite">
      <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>Checks</p>
      {!engaged && issues.some((i) => i.level === "error") && (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Rules show here as you fill the form in.</p>
      )}
      {!errors.length && !warns.length && !issues.some((i) => i.level === "error") && (
        <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--success)" }}>
          <CheckCircle2 className="w-3.5 h-3.5" /> All clear
        </p>
      )}
      {errors.map((i, k) => (
        <p key={`e${k}`} className="text-[11px] flex items-start gap-1.5" style={{ color: "var(--danger)" }}>
          <XCircle className="w-3.5 h-3.5 mt-px shrink-0" /> <span>{i.text}</span>
        </p>
      ))}
      {warns.map((i, k) => (
        <p key={`w${k}`} className="text-[11px] flex items-start gap-1.5" style={{ color: "var(--warning)" }}>
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> <span>{i.text}</span>
        </p>
      ))}
    </div>
  );
}

/** A small card: what saving this will do, as plain facts. */
export function ImpactCard({ title, rows, note }: { title: string; rows: Array<[string, ReactNode]>; note?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border p-3 space-y-1.5" style={raised}>
      <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{title}</p>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 text-[11px]">
          <span style={{ color: "var(--text-muted)" }}>{k}</span>
          <span className="font-semibold text-right" style={{ color: "var(--text-primary)" }}>{v}</span>
        </div>
      ))}
      {note && <p className="text-[11px] pt-1 border-t" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>{note}</p>}
    </div>
  );
}

/**
 * Batch first. Breeding is recorded for the animals of a batch, so the form asks for the batch before anything else and
 * offers only active animal-wise batches that hold at least one animal it could use (`count`), with how many.
 */
export function BatchPicker({
  id,
  batches,
  value,
  onChange,
  countOf,
  noun,
  issues,
  remote,
}: {
  id: string;
  batches: Row[];
  remote?: RemoteOptions;
  value: string;
  onChange: (batchId: string) => void;
  countOf: (batchId: string) => number;
  noun: string;
  issues: Issue[];
}) {
  const usable = batches.filter((b) => countOf(b.batch_id) > 0);
  const chosen = batches.find((b) => b.batch_id === value);
  return (
    <Field label="Batch" htmlFor={id} issues={issues} name="batch_id" required>
      <SearchableSelect
        id={id}
        value={value}
        onChange={(v) => onChange(String(v))}
        placeholder={usable.length ? "Choose the batch" : `No animal-wise batch holds a ${noun}`}
        options={usable.map((b) => ({
          value: b.batch_id,
          label: `${b.batch_no} · ${countOf(b.batch_id)} ${noun}${countOf(b.batch_id) === 1 ? "" : "s"}`,
          batch_no: b.batch_no,
          head: `${countOf(b.batch_id)} ${noun}${countOf(b.batch_id) === 1 ? "" : "s"}`,
        }))}
        columns={[{ key: "batch_no", label: "Batch" }, { key: "head", label: "Held" }]}
        disabled={!usable.length}
        remote={remote}
      />
      {!usable.length && (
        <p className="text-[11px] mt-1 flex items-start gap-1" style={{ color: "var(--warning)" }}>
          <Layers className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Breeding is recorded batch by batch, in an active animal-wise batch. Put a {noun} into one first (Batches → the batch → add animals, or move the {noun} in).
          </span>
        </p>
      )}
      {chosen && (
        <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
          <Circle className="w-2 h-2 fill-current" /> Showing only the {noun}s of {chosen.batch_no}.
        </p>
      )}
    </Field>
  );
}
