"use client";

/**
 * The Feed Forecast's notes (review C): one compact panel, closed by default,
 * that counts each kind of note in its summary and lists the details grouped
 * when opened — instead of a long list of near-identical sentences ("BATCH-…
 * has no shed on record, so its feed is drawn from the farm store." once per
 * batch). Its box scrolls on its own so the page stays fixed-height.
 */
import { formatDateShort } from "./feed-format";
import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";

export type ForecastFlag =
  | { kind: "NO_FEED_ROW"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "OVERLAPPING_FEED_ROWS"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "NO_SILO_HOLDS_ITEM"; shedCode: string; itemName: string }
  | { kind: "STAGE_CHANGE_PROJECTED"; batchNo: string; stageCode: string; date: string }
  | { kind: "HEADS_ASSUMED_FLAT"; batchNo: string }
  | { kind: "BATCH_SHED_UNKNOWN"; batchNo: string }
  | { kind: "AS_OF_PAST"; planningDate: string; today: string };

export interface NoteGroup {
  kind: string;
  title: string;
  items: string[];
}

type Translate = (key: any, vars?: any) => string;
type DayFlag = { batchNo: string; stageCode: string; day: number; date: string };

/** Consecutive days of one batch + stage folded into one "days 30–32" item; exact repeats dropped. */
function dayRanges(flags: DayFlag[], t: Translate): string[] {
  const seen = new Set<string>();
  const sorted = flags
    .filter((f) => {
      const key = `${f.batchNo}|${f.stageCode}|${f.day}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.batchNo.localeCompare(b.batchNo) || a.stageCode.localeCompare(b.stageCode) || a.day - b.day);
  const runs: Array<{ batchNo: string; stageCode: string; from: number; to: number; dateFrom: string; dateTo: string }> = [];
  for (const f of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.batchNo === f.batchNo && last.stageCode === f.stageCode && f.day === last.to + 1) {
      last.to = f.day;
      last.dateTo = f.date;
    } else {
      runs.push({ batchNo: f.batchNo, stageCode: f.stageCode, from: f.day, to: f.day, dateFrom: f.date, dateTo: f.date });
    }
  }
  return runs.map((r) =>
    t("ffNoteDayRange", {
      batchNo: r.batchNo,
      stageCode: r.stageCode,
      days: r.from === r.to ? String(r.from) : `${r.from}–${r.to}`,
      dates: r.from === r.to ? formatDateShort(r.dateFrom) : `${formatDateShort(r.dateFrom)}–${formatDateShort(r.dateTo)}`,
    }),
  );
}

const unique = (values: string[]) => [...new Set(values)];

export function buildNoteGroups(flags: ForecastFlag[], t: Translate): NoteGroup[] {
  const list = Array.isArray(flags) ? flags : [];
  const of = <K extends ForecastFlag["kind"]>(kind: K) => list.filter((f): f is Extract<ForecastFlag, { kind: K }> => f.kind === kind);
  const groups: NoteGroup[] = [];
  const asOf = of("AS_OF_PAST")[0];
  if (asOf) groups.push({ kind: "AS_OF_PAST", title: t("ffNoteAsOf"), items: [t("ffFlagAsOfPast", { date: formatDateShort(asOf.planningDate), today: formatDateShort(asOf.today) })] });
  const noRow = dayRanges(of("NO_FEED_ROW"), t);
  if (noRow.length) groups.push({ kind: "NO_FEED_ROW", title: t("ffNoteNoFeedRow"), items: noRow });
  const overlap = dayRanges(of("OVERLAPPING_FEED_ROWS"), t);
  if (overlap.length) groups.push({ kind: "OVERLAPPING_FEED_ROWS", title: t("ffNoteOverlap"), items: overlap });
  const noSilo = unique(of("NO_SILO_HOLDS_ITEM").map((f) => t("ffNoteShedItem", { shedCode: f.shedCode, itemName: f.itemName })));
  if (noSilo.length) groups.push({ kind: "NO_SILO_HOLDS_ITEM", title: t("ffNoteNoSilo"), items: noSilo });
  const changes = unique(of("STAGE_CHANGE_PROJECTED").map((f) => t("ffNoteStageChangeItem", { batchNo: f.batchNo, stageCode: f.stageCode, date: formatDateShort(f.date) })));
  if (changes.length) groups.push({ kind: "STAGE_CHANGE_PROJECTED", title: t("ffNoteStageChange"), items: changes });
  const noShed = unique(of("BATCH_SHED_UNKNOWN").map((f) => f.batchNo)).sort();
  if (noShed.length) groups.push({ kind: "BATCH_SHED_UNKNOWN", title: t("ffNoteNoShed"), items: noShed });
  // HEADS_ASSUMED_FLAT is raised for every batch (D11): one line covers them all.
  if (of("HEADS_ASSUMED_FLAT").length) groups.push({ kind: "HEADS_ASSUMED_FLAT", title: t("ffNoteHeads"), items: [t("ffFlagHeadsAssumedFlat")] });
  return groups;
}

export function FeedForecastNotes({ flags, t, compact = false }: { flags: ForecastFlag[]; t: Translate; compact?: boolean }) {
  const groups = buildNoteGroups(flags, t);
  if (!groups.length) return null;
  const content = <dl className="max-h-80 space-y-3 overflow-auto border-t border-[var(--border)] px-3 py-3 text-xs">
    {groups.map((g) => <div key={g.kind}><dt className="font-semibold text-[var(--text-primary)]">{g.title} <span className="font-normal text-[var(--text-muted)]">({g.items.length})</span></dt><dd className="text-[var(--text-secondary)]">{g.items.join(g.kind === "BATCH_SHED_UNKNOWN" ? ", " : "; ")}</dd></div>)}
  </dl>;
  if (compact) return <CompactNotesDialog title={t("ffNotesTitle", { count: groups.length })} content={content} />;
  return (
    <details className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs">
        <span className="font-semibold text-[var(--text-primary)]">{t("ffNotesTitle", { count: groups.length })}</span>
        <span className="ml-2 text-[var(--text-muted)]">{groups.map((g) => `${g.title} (${g.items.length})`).join(" · ")}</span>
      </summary>
      <dl className="max-h-40 space-y-2 overflow-auto border-t border-[var(--border)] px-3 py-2 text-xs">
        {groups.map((g) => (
          <div key={g.kind}>
            <dt className="font-semibold text-[var(--text-primary)]">{g.title} <span className="font-normal text-[var(--text-muted)]">({g.items.length})</span></dt>
            <dd className="text-[var(--text-secondary)]">{g.items.join(g.kind === "BATCH_SHED_UNKNOWN" ? ", " : "; ")}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function CompactNotesDialog({ title, content }: { title: string; content: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="nf-button nf-button-secondary text-xs" onClick={() => setOpen(true)}>{title}</button><Dialog open={open} onClose={() => setOpen(false)} title={title} maxWidth="lg">{content}</Dialog></>;
}
