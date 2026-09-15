"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { X, Loader2, ChevronRight } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { ReadField } from "@/components/ui/field";

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
};

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

// Exactly three, decided 15 Sep (correction 3). The earlier plan for separate
// History and Location traceability tabs is folded into Traceability: every
// batch, stage and pen move is a card on the one lifetime timeline, so the
// same move is never told twice in two places.
const TABS = [
  { key: "details", label: "Details" },
  { key: "breeding", label: "Breeding record history" },
  { key: "traceability", label: "Traceability" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const fmt = (v: any) => (v === null || v === undefined || v === "" ? "" : String(v));
const asObject = (value: any): Row => {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return {}; }
};
const human = (v: any) => fmt(v).replaceAll("_", " ").toLowerCase();

type TimelineEvent = {
  id: string;
  date: string;
  title: string;
  summary: string;
  detail: [string, string][];
};

/**
 * Which side of a mating this animal is on. The API decides it per record —
 * `role` is DAM exactly when this animal is the row's sow (animal.service.ts) —
 * so it outranks the panel's guess from gender, which is only a fallback for a
 * record that arrived without one.
 */
const isSireOn = (m: Row, isMale: boolean) => (m.role === "SIRE" ? true : m.role === "DAM" ? false : isMale);

/**
 * One mating on the lifetime timeline, told from this animal's side. For a sow
 * it is her service; for a boar it is a service he performed on the sow named.
 * The pregnancy check is its own card (below), dated when it happened.
 */
function matingTimelineEvent(m: Row, isMale: boolean): TimelineEvent {
  const sire = isSireOn(m, isMale);
  const partner = sire ? fmt(m.sow_code) : fmt(m.boar_code);
  return {
    id: `mating-${m.breeding_id}`,
    date: fmt(m.mating_date),
    title: sire ? `Served ${partner || "a sow"}` : `Served by ${partner || "a boar"}`,
    summary: [human(m.mating_type), fmt(m.batch_no), fmt(m.parity_number) ? `parity ${m.parity_number}` : ""]
      .filter(Boolean).join(" · "),
    detail: [
      ["Mating type", fmt(m.mating_type)], [sire ? "Sow" : "Boar", partner],
      ["Batch", fmt(m.batch_no)], ["Second mating", fmt(m.second_mating_date)],
      ["Semen doses", fmt(m.semen_dose_qty)], ["Sow parity", fmt(m.parity_number)],
      ["Boar parity", fmt(m.boar_parity_number)], ["Expected farrowing", fmt(m.expected_farrowing_date)],
    ],
  };
}

/** A pregnancy check is an event only once it has a result; a PENDING row is a plan. */
function pregCheckTimelineEvent(m: Row, isMale: boolean): TimelineEvent | null {
  if (!m.conception_result || m.conception_result === "PENDING") return null;
  const sire = isSireOn(m, isMale);
  return {
    id: `pregcheck-${m.breeding_id}`,
    date: fmt(m.preg_check_date) || fmt(m.mating_date),
    title: sire
      ? `Service on ${fmt(m.sow_code) || "a sow"} — ${human(m.conception_result)}`
      : `Pregnancy check — ${human(m.conception_result)}`,
    summary: [human(m.preg_check_method), fmt(m.expected_farrowing_date) ? `due ${m.expected_farrowing_date}` : ""]
      .filter(Boolean).join(" · "),
    detail: [
      ["Result", fmt(m.conception_result)], ["Check date", fmt(m.preg_check_date)],
      ["Method", fmt(m.preg_check_method)], ["Expected farrowing", fmt(m.expected_farrowing_date)],
    ],
  };
}

/**
 * One farrowing. A sow farrowed it; a boar is reached through the breeding_id
 * of the service he sired, so for him the same row is a litter he produced.
 * Counts are interpolated only when the column actually came back.
 */
function farrowingTimelineEvent(f: Row, isMale: boolean): TimelineEvent {
  const live = fmt(f.piglets_born_live);
  const total = fmt(f.piglets_born_total);
  return {
    id: `farrow-${f.farrow_id}`,
    date: fmt(f.farrowing_date),
    title: isMale
      ? (live ? `Sired a litter — ${live} live` : "Sired a litter")
      : (live ? `Farrowed ${live} live` : "Farrowed"),
    summary: [total ? `${total} born` : "", human(f.farrowing_status)].filter(Boolean).join(" · "),
    detail: [
      ["Farrowing date", fmt(f.farrowing_date)], ["Born total", total],
      ["Born live", live], ["Stillborn", fmt(f.piglets_stillborn)],
      ["Mummified", fmt(f.piglets_mummified)], ["Avg birth weight", fmt(f.avg_birth_weight_kg)],
      ["Litter weight", fmt(f.total_litter_weight_kg)], ["Status", fmt(f.farrowing_status)],
      ["Parity", fmt(f.parity_number)],
    ],
  };
}

/**
 * Weaning is written onto the farrowing row. Its weaning_date is filled with
 * the planned date when the farrowing is recorded and piglets_weaned stays 0
 * until it happens, so only a counted weaning is an event.
 */
function weaningTimelineEvent(f: Row, isMale: boolean): TimelineEvent | null {
  if (!(Number(f.piglets_weaned) > 0)) return null;
  return {
    id: `wean-${f.farrow_id}`,
    date: fmt(f.weaning_date),
    title: isMale ? `Litter weaned — ${f.piglets_weaned}` : `Weaned ${f.piglets_weaned}`,
    summary: fmt(f.avg_weaning_weight_kg) ? `avg ${f.avg_weaning_weight_kg} kg` : "",
    detail: [
      ["Weaning date", fmt(f.weaning_date)], ["Piglets weaned", fmt(f.piglets_weaned)],
      ["Avg weaning weight", fmt(f.avg_weaning_weight_kg)], ["Cost per piglet", fmt(f.cost_per_piglet)],
    ],
  };
}

// Oldest first: Traceability is the animal's life from registration onwards
// (15 Sep, "one chronological lifetime timeline"). Same-day events keep the
// order they were pushed in, which is the order they happen in a life.
const oldestFirst = (a: TimelineEvent, b: TimelineEvent) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/** The timeline rail: a card per event, each opening in place. */
function TimelineList({
  events, emptyText, openEvent, onToggle,
}: {
  events: TimelineEvent[];
  emptyText: string;
  openEvent: string | null;
  onToggle: (id: string) => void;
}) {
  if (!events.length) return <p className="text-xs" style={S.muted}>{emptyText}</p>;
  return (
    <ol className="relative flex flex-col gap-2 ps-5">
      {/* The rail. Sits behind the markers rather than between the cards, so
          it does not break where a card is expanded. */}
      <span
        aria-hidden="true"
        className="absolute bottom-2 start-[5px] top-2 w-px"
        style={{ backgroundColor: "var(--border)" }}
      />
      {events.map((ev) => {
        const open = openEvent === ev.id;
        const rows = ev.detail.filter(([, v]) => v);
        return (
          <li key={ev.id} className="relative">
            <span
              aria-hidden="true"
              className="absolute -start-5 top-4 h-[9px] w-[9px] translate-x-[1px] rounded-full border-2"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--accent)" }}
            />
            <button
              type="button"
              onClick={() => onToggle(ev.id)}
              aria-expanded={open}
              className="w-full rounded-[var(--radius-sm)] border p-3 text-left transition"
              style={S.raised}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium" style={S.primary}>{ev.title}</span>
                <span className="shrink-0 font-mono text-xs" style={S.sub}>{ev.date}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs" style={S.sub}>{ev.summary}</span>
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 transition-transform"
                  style={{ color: "var(--text-muted)", transform: open ? "rotate(90deg)" : undefined }}
                />
              </div>

              {open && rows.length > 0 && (
                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 border-t pt-3 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>
                  {rows.map(([label, value]) => (
                    <div key={label} className="flex min-w-0 flex-col">
                      <dt className="text-[10px] uppercase tracking-wide" style={S.muted}>{label}</dt>
                      <dd className="truncate text-xs" style={S.primary}>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function DetailGrid({ rows }: { rows: [string, string][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {shown.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col">
          <dt className="text-[10px] uppercase tracking-wide" style={S.muted}>{label}</dt>
          <dd className="truncate text-xs" style={S.primary}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One row per breeding record, sex-specific (15 Sep). A sow's row reads her
 * service through to its outcome: boar, batch, parity, pregnancy check and
 * result, expected farrowing, and the farrowing and weaning linked to it. A
 * boar's row is a service he performed: the sow, both parities, the result,
 * and the litter it produced. Clicking a row opens the rest of the record.
 */
function BreedingRecordTable({
  matings, farrowings, isMale, openRow, onToggle,
}: {
  matings: Row[];
  farrowings: Row[];
  isMale: boolean;
  openRow: string | null;
  onToggle: (id: string) => void;
}) {
  const farrowByBreeding = new Map<string, Row>();
  for (const f of farrowings) if (f.breeding_id) farrowByBreeding.set(f.breeding_id, f);
  // A farrowing recorded without its service still belongs in a sow's history;
  // listed under the table rather than dropped.
  const unlinked = isMale ? [] : farrowings.filter((f) => !f.breeding_id || !matings.some((m) => m.breeding_id === f.breeding_id));

  const headers = isMale
    ? ["Date", "Type", "Sow", "Batch", "Sow parity", "Boar parity", "Result", "Litter (live / total)", "Weaned"]
    : ["Date", "Type", "Boar", "Batch", "Parity", "Preg check", "Result", "Expected farrowing", "Farrowed (live / total)", "Weaned"];

  if (!matings.length && !unlinked.length) {
    return <p className="text-xs" style={S.muted}>No breeding record.</p>;
  }

  const litters = isMale ? [...farrowByBreeding.values()] : [];
  const cell = "px-2 py-2 whitespace-nowrap";

  return (
    <div className="flex flex-col gap-4">
      {isMale && litters.length > 0 && (
        <p className="text-xs" style={S.sub}>
          {matings.length} service{matings.length === 1 ? "" : "s"} · {litters.length} litter{litters.length === 1 ? "" : "s"} ·{" "}
          {litters.reduce((sum, f) => sum + (Number(f.piglets_born_live) || 0), 0)} born live ·{" "}
          {litters.reduce((sum, f) => sum + (Number(f.piglets_weaned) || 0), 0)} weaned
        </p>
      )}

      {matings.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
          <table className="w-full border-collapse text-left text-xs">
            <thead className="border-b" style={{ ...S.raised, color: "var(--text-secondary)" }}>
              <tr>{headers.map((h) => <th key={h} className={`${cell} font-semibold`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {matings.map((m) => {
                const f = farrowByBreeding.get(m.breeding_id);
                const open = openRow === m.breeding_id;
                const litter = f ? `${fmt(f.piglets_born_live)} / ${fmt(f.piglets_born_total)}` : "";
                const weaned = f && Number(f.piglets_weaned) > 0 ? fmt(f.piglets_weaned) : "";
                const values = isMale
                  ? [m.mating_date, human(m.mating_type), m.sow_code, m.batch_no, m.parity_number, m.boar_parity_number, m.conception_result, litter, weaned]
                  : [m.mating_date, human(m.mating_type), m.boar_code, m.batch_no, m.parity_number, m.preg_check_date, m.conception_result, m.expected_farrowing_date, litter, weaned];
                return (
                  <Fragment key={m.breeding_id}>
                    <tr
                      className="cursor-pointer border-b transition hover:bg-[var(--surface-raised)]"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => onToggle(m.breeding_id)}
                      aria-expanded={open}
                    >
                      {values.map((v, i) => (
                        <td key={headers[i]} className={`${cell} ${i === 0 ? "font-mono" : ""}`} style={fmt(v) ? S.primary : S.muted}>
                          {fmt(v) || "—"}
                        </td>
                      ))}
                    </tr>
                    {open && (
                      <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                        <td colSpan={headers.length} className="p-3" style={S.raised}>
                          <div className="flex flex-col gap-3">
                            <DetailGrid rows={[
                              ["Second mating", fmt(m.second_mating_date)], ["Semen doses", fmt(m.semen_dose_qty)],
                              ["Check method", fmt(m.preg_check_method)], ["Pregnancy check date", fmt(m.preg_check_date)],
                              ["Expected farrowing", fmt(m.expected_farrowing_date)], ["Boar parity", fmt(m.boar_parity_number)],
                              ["Notes", fmt(m.notes)],
                            ]} />
                            {f && (
                              <DetailGrid rows={[
                                ["Farrowing date", fmt(f.farrowing_date)], ["Farrowing status", fmt(f.farrowing_status)],
                                ["Born live", fmt(f.piglets_born_live)], ["Stillborn", fmt(f.piglets_stillborn)],
                                ["Mummified", fmt(f.piglets_mummified)], ["Avg birth weight", fmt(f.avg_birth_weight_kg)],
                                [Number(f.piglets_weaned) > 0 ? "Weaning date" : "Planned weaning", fmt(f.weaning_date)],
                                ["Avg weaning weight", fmt(f.avg_weaning_weight_kg)],
                              ]} />
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {unlinked.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={S.muted}>Farrowings not linked to a service</p>
          {unlinked.map((f) => (
            <div key={f.farrow_id} className="rounded-[var(--radius-sm)] border p-3" style={S.raised}>
              <DetailGrid rows={[
                ["Farrowing date", fmt(f.farrowing_date)], ["Parity", fmt(f.parity_number)],
                ["Born live / total", `${fmt(f.piglets_born_live)} / ${fmt(f.piglets_born_total)}`],
                ["Weaned", Number(f.piglets_weaned) > 0 ? fmt(f.piglets_weaned) : ""],
                ["Weaning date", Number(f.piglets_weaned) > 0 ? fmt(f.weaning_date) : ""],
              ]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The right-hand detail for one animal.
 *
 * Breeding and traceability come from `/animal/:id/breeding`, which returns
 * matings from either side — a boar appears on a mating as the sire and never
 * as the sow, so a screen that filtered one column would show both boars an
 * empty history.
 *
 * Traceability is assembled here rather than fetched, because BBP-1 says so:
 * "The traceability chain uses existing production records - no separate
 * traceability module required." The two links past the transfer order — DOA
 * at Colcom and the Kill Sheet — have no tables at all, so they are stated as
 * unmodelled below the timeline rather than drawn as empty cards.
 */
export default function AnimalDetailPanel({ row, onClose }: { row: Row; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>("details");
  const [breeding, setBreeding] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openEvent, setOpenEvent] = useState<string | null>(null);

  const animalId = row.animal_id;

  useEffect(() => {
    let cancelled = false;
    setBreeding(null);
    setError("");
    setOpenEvent(null);
    if (!animalId) return;
    setLoading(true);
    api.get(`/animal/${animalId}/breeding`)
      .then((res) => { if (!cancelled) setBreeding(unwrap<Row>(res)); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || "Could not load breeding history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [animalId]);

  const matings: Row[] = breeding?.matings ?? [];
  const farrowings: Row[] = breeding?.farrowings ?? [];
  const movements: Row[] = breeding?.movements ?? [];
  const transfers: Row[] = breeding?.transfers ?? [];
  const labels = breeding?.traceability_labels ?? { stages: {}, batches: {}, locations: {} };
  const lineage: Row = breeding?.lineage ?? { offspring: [] };
  const current: Row = breeding?.current_labels ?? {};
  const isMale = row.gender === "M" || row.animal_type === "BOAR";

  const timeline = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];
    const created = movements.find((m) => m.action === "CREATE");
    const createdValues = asObject(created?.new_values);

    if (row.dob) {
      events.push({
        id: "dob", date: fmt(row.dob), title: "Born",
        summary: [fmt(lineage.dam_code) && `dam ${lineage.dam_code}`, fmt(lineage.sire_code) && `sire ${lineage.sire_code}`]
          .filter(Boolean).join(" · ") || "Date of birth recorded",
        detail: [["Date of birth", fmt(row.dob)], ["Dam", fmt(lineage.dam_code)], ["Sire", fmt(lineage.sire_code)]],
      });
    }
    if (row.entry_date) {
      // Registration, with the placement it was registered into as the audit
      // row recorded it — the first link of the batch/stage/pen chain.
      events.push({
        id: "entry", date: fmt(row.entry_date), title: "Registered",
        summary: [human(row.entry_type), labels.batches?.[createdValues.current_batch_id], labels.locations?.[createdValues.current_location_id]]
          .filter(Boolean).join(" · ") || "Entry recorded",
        detail: [
          ["Entry type", fmt(row.entry_type)], ["Entry date", fmt(row.entry_date)],
          ["Stage", labels.stages?.[createdValues.current_stage_id] || ""],
          ["Batch", labels.batches?.[createdValues.current_batch_id] || ""],
          ["Pen", labels.locations?.[createdValues.current_location_id] || ""],
          ["Dam", fmt(lineage.dam_code)], ["Sire", fmt(lineage.sire_code)],
          // source_receipt_id, not source_grn_id: the column is named after
          // this codebase's goods_receipt table rather than the spec's "GRN".
          ["Source receipt", fmt(row.source_receipt_id)], ["Born from batch", fmt(row.source_batch_id)],
          ["Acquisition cost", fmt(row.acquisition_cost)],
        ],
      });
    }
    for (const m of matings) {
      events.push(matingTimelineEvent(m, isMale));
      const check = pregCheckTimelineEvent(m, isMale);
      if (check) events.push(check);
    }
    for (const f of farrowings) {
      events.push(farrowingTimelineEvent(f, isMale));
      const wean = weaningTimelineEvent(f, isMale);
      if (wean) events.push(wean);
    }
    // Offspring registered with this animal as a parent, one card per day of
    // registration so a litter reads as one event, not twelve.
    const offspringByDay = new Map<string, Row[]>();
    for (const o of lineage.offspring ?? []) {
      const day = fmt(o.dob) || fmt(o.entry_date);
      offspringByDay.set(day, [...(offspringByDay.get(day) ?? []), o]);
    }
    for (const [day, group] of offspringByDay) {
      events.push({
        id: `offspring-${day}`, date: day,
        title: `${group.length} offspring registered`,
        summary: group.map((o) => fmt(o.animal_code)).join(", "),
        detail: group.map((o) => [fmt(o.animal_code), [fmt(o.gender), fmt(o.dob)].filter(Boolean).join(" · ")] as [string, string]),
      });
    }
    for (const movement of movements) {
      if (movement.action !== "TRANSITION_STAGE") continue;
      const oldValues = asObject(movement.old_values);
      const newValues = asObject(movement.new_values);
      const fromStage = labels.stages?.[oldValues.current_stage_id] || "Previous stage";
      const toStage = labels.stages?.[newValues.current_stage_id] || "New stage";
      events.push({
        id: `movement-${movement.occurred_at}-${toStage}`,
        date: fmt(newValues.transition_date || movement.occurred_at).slice(0, 10),
        title: `Stage moved to ${toStage}`,
        summary: `${fromStage} → ${toStage}`,
        detail: [
          ["From stage", fromStage], ["To stage", toStage],
          ["Batch", labels.batches?.[newValues.current_batch_id] || ""],
          ["Pen", labels.locations?.[newValues.current_location_id] || ""],
          ["Reason", fmt(newValues.reason)], ["Remarks", fmt(newValues.remarks)],
        ],
      });
    }
    for (const transfer of transfers) {
      events.push({
        id: `transfer-${transfer.transfer_id}`,
        date: fmt(transfer.transfer_date),
        title: `Transferred — ${fmt(transfer.transfer_no)}`,
        summary: `${fmt(transfer.from_batch_no) || "Previous batch"} → ${fmt(transfer.to_batch_no) || "New batch"}`,
        detail: [
          ["Transfer", fmt(transfer.transfer_no)],
          ["From batch", fmt(transfer.from_batch_no)], ["To batch", fmt(transfer.to_batch_no)],
          ["From pen", fmt(transfer.from_pen_code)], ["To pen", fmt(transfer.to_pen_code)],
          ["Reason", fmt(transfer.reason)], ["Remarks", fmt(transfer.remarks)],
        ],
      });
    }
    if (row.disposal_date) {
      events.push({
        id: "disposal", date: fmt(row.disposal_date), title: `Disposed — ${human(row.disposal_type)}`,
        summary: "Left the herd",
        detail: [
          ["Disposal date", fmt(row.disposal_date)], ["Disposal type", fmt(row.disposal_type)],
          ["Disposal value", fmt(row.disposal_value)], ["Gain / loss", fmt(row.gain_loss_on_disposal)],
        ],
      });
    }

    return events.sort(oldestFirst);
  }, [row, matings, farrowings, movements, transfers, labels, lineage, isMale]);

  const spinner = (
    <div className="py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" style={S.muted} /></div>
  );

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[var(--radius-md)] border"
      style={S.surface}
      aria-label={`Detail for ${fmt(row.animal_code)}`}
    >
      {/* The code only: it is the one fact that has to hold on every tab, so
          it says whose history you are reading on Breeding or Traceability. */}
      <header className="flex items-center justify-between gap-3 border-b p-4" style={{ borderColor: "var(--border)" }}>
        <p className="truncate font-mono text-sm font-semibold" style={S.primary}>{fmt(row.animal_code)}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="shrink-0 rounded-lg p-1.5 transition hover:bg-[var(--surface-raised)]"
          style={S.sub}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b px-2 pt-2" style={{ borderColor: "var(--border)" }} aria-label="Animal detail sections">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => { setTab(tb.key); setOpenEvent(null); }}
            aria-current={tab === tb.key ? "page" : undefined}
            className="whitespace-nowrap px-3 py-2 text-xs font-semibold"
            style={tab === tb.key
              ? { color: "var(--accent)", borderBottom: "2px solid var(--accent)" }
              : { color: "var(--text-secondary)", borderBottom: "2px solid transparent" }}
          >
            {tb.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <InlineAlert>{error}</InlineAlert>}

        {tab === "details" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ReadField label="Type" value={fmt(row.animal_type)} />
            <ReadField label="Gender" value={fmt(row.gender)} />
            <ReadField label="Status" value={fmt(row.status)} />
            <ReadField label="Breed" value={fmt(current.breed)} />
            <ReadField label="Current stage" value={fmt(current.stage)} />
            <ReadField label="Current batch" value={fmt(current.batch)} />
            <ReadField label="Current pen" value={fmt(current.location)} />
            <ReadField label="Date of birth" value={fmt(row.dob)} />
            {/* Template column G reads as a pair with the DOB above it: when
                that is filled the age is computed from it, when it is blank the
                age is the only record of how old the animal was. */}
            <ReadField
              label="Age at entry"
              value={row.age_at_entry_weeks === null || row.age_at_entry_weeks === undefined
                ? ""
                : `${row.age_at_entry_weeks} weeks`}
            />
            <ReadField label="Entry type" value={fmt(row.entry_type)} />
            <ReadField label="Entry date" value={fmt(row.entry_date)} />
            <ReadField label="Sire" value={fmt(lineage.sire_code)} mono />
            <ReadField label="Dam" value={fmt(lineage.dam_code)} mono />
            <ReadField mono label="RFID tag" value={fmt(row.rfid_tag)} />
            <ReadField mono label="Ear tag number" value={fmt(row.ear_tag)} />
            <ReadField
              label="Ear tag image"
              value={row.ear_tag_image_url
                ? <a href={row.ear_tag_image_url} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>Open image</a>
                : ""}
            />
            {!isMale && <ReadField label="No. of teats" value={fmt(row.no_of_teats)} />}
            {!isMale && <ReadField label="Parity count" value={fmt(row.parity_count)} />}
            {!isMale && <ReadField label="Piglets born live" value={fmt(row.total_piglets_born_live)} />}
            {!isMale && <ReadField label="Piglets weaned" value={fmt(row.total_piglets_weaned)} />}
            <ReadField label="Book value" value={fmt(row.book_value)} />
            <ReadField label="Expected cull date" value={fmt(row.expected_cull_date)} />
            {/* Disposal is set by the Dispose action, which checks withdrawal
                periods and posts the gain or loss — never by a form field.
                Blank until it happens. */}
            <ReadField label="Disposal date" value={fmt(row.disposal_date)} />
            <ReadField label="Disposal type" value={fmt(row.disposal_type)} />
          </div>
        )}

        {tab === "breeding" && (
          loading ? spinner : (
            <BreedingRecordTable
              matings={matings}
              farrowings={farrowings}
              isMale={isMale}
              openRow={openEvent}
              onToggle={(id) => setOpenEvent(openEvent === id ? null : id)}
            />
          )
        )}

        {tab === "traceability" && (
          loading ? spinner : (
            <div className="flex flex-col gap-4">
              <TimelineList
                events={timeline}
                emptyText="Nothing recorded for this animal yet."
                openEvent={openEvent}
                onToggle={(id) => setOpenEvent(openEvent === id ? null : id)}
              />
              {/* Only a permanent gap needs stating; an absent card already says
                  a thing has not happened. */}
              <p className="text-[11px] leading-5" style={S.muted}>
                The chain ends at the transfer order. DOA at Colcom and the kill sheet have no tables in
                the schema — BBP-1 describes the kill sheet as a process, attached to the transfer order
                with carcass weights per line, without a field specification.
              </p>
            </div>
          )
        )}
      </div>
    </aside>
  );
}
