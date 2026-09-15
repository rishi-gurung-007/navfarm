"use client";

import { useEffect, useMemo, useState } from "react";
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

const TABS = [
  { key: "data", label: "Animal data" },
  { key: "breeding", label: "Breeding details" },
  { key: "traceability", label: "Traceability" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const fmt = (v: any) => (v === null || v === undefined || v === "" ? "" : String(v));
const asObject = (value: any): Row => {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return {}; }
};

type TimelineEvent = {
  id: string;
  date: string;
  title: string;
  summary: string;
  detail: [string, string][];
};

/**
 * One mating, told from the point of view of the animal whose panel this is.
 *
 * The same record is two different facts depending on which side you are on:
 * for a sow it is her service, so the pregnancy check, its result and the date
 * she is due are what matter; for a boar it is a service he performed, so the
 * sow he covered and whether it took are what matter, and her pregnancy check
 * is her record and not his. Both tabs call this, so a boar cannot be shown a
 * sow's detail on one tab and his own on the other.
 */
function matingTimelineEvent(m: Row, isMale: boolean): TimelineEvent {
  // The API decides this per record — `role` is DAM exactly when this animal
  // is the row's sow (animal.service.ts) — so it outranks the panel's guess
  // from gender/animal_type, which is only a fallback for a record that
  // arrived without one.
  const sire = m.role === "SIRE" ? true : m.role === "DAM" ? false : isMale;
  const partner = sire ? fmt(m.sow_code) : fmt(m.boar_code);
  const parity = fmt(m.parity_number);
  return {
    id: `mating-${m.breeding_id}`,
    date: fmt(m.mating_date),
    title: sire ? `Served ${partner || "a sow"}` : `Served by ${partner || "a boar"}`,
    summary: [
      fmt(m.mating_type),
      parity ? `parity ${parity}` : "",
      fmt(m.conception_result).toLowerCase(),
    ].filter(Boolean).join(" · "),
    detail: sire
      ? [
          ["Sow", fmt(m.sow_code)], ["Mating type", fmt(m.mating_type)],
          ["Mating date", fmt(m.mating_date)], ["Second mating", fmt(m.second_mating_date)],
          ["Semen doses", fmt(m.semen_dose_qty)], ["Service outcome", fmt(m.conception_result)],
          ["Sow parity", parity],
        ]
      : [
          ["Mating type", fmt(m.mating_type)], ["Mating date", fmt(m.mating_date)],
          ["Second mating", fmt(m.second_mating_date)], ["Semen doses", fmt(m.semen_dose_qty)],
          ["Pregnancy check", [fmt(m.preg_check_date), fmt(m.preg_check_method)].filter(Boolean).join(" · ")],
          ["Result", fmt(m.conception_result)], ["Expected farrowing", fmt(m.expected_farrowing_date)],
          ["Parity", parity],
        ],
  };
}

/**
 * One farrowing. A sow farrowed it; a boar is reached through the breeding_id
 * of the service he sired, so for him the same row is a litter he produced.
 * Counts are interpolated only when the column actually came back, otherwise
 * the title reads "Farrowed  live" for a record that has yet to be counted.
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
    summary: [total ? `${total} born` : "", fmt(f.farrowing_status).toLowerCase()]
      .filter(Boolean).join(" · "),
    detail: [
      ["Farrowing date", fmt(f.farrowing_date)], ["Born total", total],
      ["Born live", live], ["Stillborn", fmt(f.piglets_stillborn)],
      ["Mummified", fmt(f.piglets_mummified)], ["Avg birth weight", fmt(f.avg_birth_weight_kg)],
      ["Litter weight", fmt(f.total_litter_weight_kg)], ["Status", fmt(f.farrowing_status)],
      ["Weaning date", fmt(f.weaning_date)], ["Piglets weaned", fmt(f.piglets_weaned)],
      ["Avg weaning weight", fmt(f.avg_weaning_weight_kg)], ["Parity", fmt(f.parity_number)],
    ],
  };
}

// Newest first: the most recent thing that happened is what someone opening
// this panel is usually looking for.
const newestFirst = (a: TimelineEvent, b: TimelineEvent) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : 0;

/**
 * The timeline rail. Breeding and Traceability are the same reading of the
 * same records at two zoom levels, so they are the same component: a fix to
 * the marker, the rail or the expanded detail lands on both.
 */
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

              {open && (
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
 * traceability module required." It reads as a timeline of what actually
 * happened to this animal, newest first, each card opening in place. The two
 * links past the transfer order — DOA at Colcom and the Kill Sheet — have no
 * tables at all, so they are stated as unmodelled below the timeline rather
 * than drawn as empty cards, which would imply the data is merely absent.
 */
export default function AnimalDetailPanel({ row, onClose }: { row: Row; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>("data");
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
  const isMale = row.gender === "M" || row.animal_type === "BOAR";

  const timeline = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];

    if (row.dob) {
      events.push({
        id: "dob", date: fmt(row.dob), title: "Born",
        summary: fmt(row.breed_id) ? "On farm" : "Date of birth recorded",
        detail: [["Date of birth", fmt(row.dob)], ["Animal type", fmt(row.animal_type)], ["Gender", fmt(row.gender)]],
      });
    }
    if (row.entry_date) {
      events.push({
        id: "entry", date: fmt(row.entry_date), title: "Entered the herd",
        summary: fmt(row.entry_type).replaceAll("_", " ").toLowerCase() || "Entry recorded",
        detail: [
          ["Entry type", fmt(row.entry_type)], ["Entry date", fmt(row.entry_date)],
          // source_receipt_id, not source_grn_id: the column was deliberately
          // named after this codebase's goods_receipt table rather than the
          // spec's "GRN", and the timeline was still asking for the spec's name.
          ["Source receipt", fmt(row.source_receipt_id)], ["Born from batch", fmt(row.source_batch_id)],
          ["Acquisition cost", fmt(row.acquisition_cost)],
        ],
      });
    }
    // The same mapping the Breeding tab uses, so the two tabs cannot drift
    // into telling different stories about one record.
    events.push(...matings.map((m) => matingTimelineEvent(m, isMale)));
    events.push(...farrowings.map((f) => farrowingTimelineEvent(f, isMale)));
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
        id: "disposal", date: fmt(row.disposal_date), title: `Disposed — ${fmt(row.disposal_type)}`,
        summary: "Left the herd",
        detail: [
          ["Disposal date", fmt(row.disposal_date)], ["Disposal type", fmt(row.disposal_type)],
          ["Disposal value", fmt(row.disposal_value)], ["Gain / loss", fmt(row.gain_loss_on_disposal)],
        ],
      });
    }

    return events.sort(newestFirst);
  }, [row, matings, farrowings, movements, transfers, labels, isMale]);

  /**
   * The Breeding tab is the same timeline narrowed to what this animal did
   * reproductively — no birth, no stage moves, no disposal. Two cards of
   * matings and farrowings side by side made the reader reconstruct the order
   * of events themselves; a service and the litter it produced are one
   * sequence and read as one.
   */
  const breedingTimeline = useMemo<TimelineEvent[]>(() => {
    const events = [
      ...matings.map((record) => matingTimelineEvent(record, isMale)),
      ...farrowings.map((record) => farrowingTimelineEvent(record, isMale)),
    ];
    return events.sort(newestFirst);
  }, [matings, farrowings, isMale]);

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[var(--radius-md)] border"
      style={S.surface}
      aria-label={`Detail for ${fmt(row.animal_code)}`}
    >
      {/* The code only. Type, gender and status used to sit here too, and all
          three are fields in the Animal data tab a few pixels below — the same
          facts twice in one panel. The code stays because it is the one thing
          that has to be true on every tab: it says whose history you are
          reading while you are on Breeding or Traceability. For the same
          reason the Animal data tab no longer repeats it. */}
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

      <nav className="flex gap-1 border-b px-2 pt-2" style={{ borderColor: "var(--border)" }} aria-label="Animal detail sections">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
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

        {tab === "data" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ReadField label="Type" value={fmt(row.animal_type)} />
            <ReadField label="Gender" value={fmt(row.gender)} />
            <ReadField label="Status" value={fmt(row.status)} />
            <ReadField label="Date of birth" value={fmt(row.dob)} />
            {/* Template column G sits between DOB and Entry type, and it reads
                as a pair with the DOB above it: when that is filled the age is
                computed from it, when it is blank the age is the only record of
                how old the animal was. Suffixed rather than left bare because
                "3" beside a date is ambiguous about its unit. */}
            <ReadField
              label="Age at entry"
              value={row.age_at_entry_weeks === null || row.age_at_entry_weeks === undefined
                ? ""
                : `${row.age_at_entry_weeks} weeks`}
            />
            <ReadField label="Entry type" value={fmt(row.entry_type)} />
            <ReadField label="Entry date" value={fmt(row.entry_date)} />
            <ReadField mono label="RFID tag" value={fmt(row.rfid_tag)} />
            {/* ear_tag, not ear_tag_visual — the latter is not a column and
                never was, so this field read blank for every animal even though
                all of them carry a tag. */}
            <ReadField mono label="Ear tag" value={fmt(row.ear_tag)} />
            <ReadField label="Parity count" value={fmt(row.parity_count)} />
            <ReadField label="Piglets born live" value={fmt(row.total_piglets_born_live)} />
            <ReadField label="Piglets weaned" value={fmt(row.total_piglets_weaned)} />
            {/* Disposal belongs here and nowhere near the registration form: it
                is set by the Dispose action, which checks every administered
                medicine's withdrawal period and posts the gain or loss against
                book value. A form field would let someone type an animal out of
                the herd and skip all of it. Blank until it happens, which is
                itself the useful reading for a live animal. */}
            <ReadField label="Disposal date" value={fmt(row.disposal_date)} />
            <ReadField label="Disposal type" value={fmt(row.disposal_type)} />
          </div>
        )}

        {tab === "breeding" && (
          loading ? (
            <div className="py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" style={S.muted} /></div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* One sequence, not two lists. A service and the litter it
                  produced belong on the same rail in date order; as separate
                  "Services" and "Farrowings" cards the reader had to pair them
                  up by parity number themselves. The wording of each card is
                  already sex-specific, so the headings that used to say it —
                  "Sire services" / "Resulting litters" — no longer have to. */}
              <TimelineList
                events={breedingTimeline}
                emptyText="No breeding record."
                openEvent={openEvent}
                onToggle={(id) => setOpenEvent(openEvent === id ? null : id)}
              />
            </div>
          )
        )}

        {tab === "traceability" && (
          loading ? (
            <div className="py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" style={S.muted} /></div>
          ) : (
            <div className="flex flex-col gap-4">
              <TimelineList
                events={timeline}
                emptyText="Nothing recorded for this animal yet."
                openEvent={openEvent}
                onToggle={(id) => setOpenEvent(openEvent === id ? null : id)}
              />
              {/* This used to list four "not yet in the chain" items, hardcoded
                  and unconditional, so every animal was told no batch carried
                  it and no transfer order had been raised whether or not that
                  was true. Two of the four were also the wrong question: a sow
                  is never carried by a weaner or grower batch. Those batches
                  are her piglets, counted by head and not individually
                  registered, so the link runs from her farrowing to the batch,
                  not from her to a batch she is in. An absent card already says
                  a thing has not happened; only a permanent gap needs stating,
                  and that is the two below. */}
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
