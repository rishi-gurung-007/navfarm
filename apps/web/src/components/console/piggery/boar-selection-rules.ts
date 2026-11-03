/**
 * The boar selection tab's small rules (plan 2026-11-02-ai-station-semen-collection, Phase 3): reading a pasted list of boars'
 * TSI, and how a cell of the table is shown.
 */

export interface PastedTsiRow {
  animal_code: string;
  tsi: number;
  published_rank?: number;
}

export interface PastedTsi {
  rows: PastedTsiRow[];
  errors: string[];
}

/**
 * One boar per line: `animal code, TSI` and optionally `, genetic rank` (commas, tabs or semicolons between; what a spreadsheet
 * copies is tab-separated). A first line whose TSI is not a number is a heading and is skipped.
 */
export function parseTsiPaste(text: string): PastedTsi {
  const rows: PastedTsiRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l, i) => ({ text: l.trim(), n: i + 1 })).filter((l) => l.text);
  lines.forEach((line, index) => {
    const [code, tsiText, rankText] = line.text.split(/[\t,;]+/).map((c) => c.trim());
    const tsi = Number(tsiText);
    if (index === 0 && (tsiText === undefined || Number.isNaN(tsi))) return; // a heading
    if (!code) {
      errors.push(`Line ${line.n}: no animal code.`);
      return;
    }
    if (tsiText === undefined || tsiText === '' || Number.isNaN(tsi) || tsi <= 0) {
      errors.push(`Line ${line.n}: ${code} needs a TSI above 0.`);
      return;
    }
    const row: PastedTsiRow = { animal_code: code, tsi };
    if (rankText) {
      const rank = Number(rankText);
      if (!Number.isInteger(rank) || rank < 1) {
        errors.push(`Line ${line.n}: ${code}'s genetic rank must be a whole number, 1 or more.`);
        return;
      }
      row.published_rank = rank;
    }
    rows.push(row);
  });
  const repeated = rows.map((r) => r.animal_code).filter((c, i, all) => all.indexOf(c) !== i);
  if (repeated.length) errors.push(`A boar is listed twice: ${[...new Set(repeated)].join(', ')}.`);
  return { rows, errors };
}

/** What a body condition status reads as, in words (the API gives the code). */
export const CONDITION_STATUS_TEXT: Record<string, string> = {
  NEVER: "Never assessed",
  NOT_SCHEDULED: "No schedule",
  OK: "OK",
  DUE_SOON: "Due soon",
  DUE: "Due",
  OVERDUE: "Overdue",
};

/** What a table cell shows: a dash where there is no figure (never a zero that was not recorded). */
export function cellText(key: string, value: unknown, row?: Record<string, any>): string {
  if (key === "bcs_status") {
    const text = CONDITION_STATUS_TEXT[String(value)] ?? "—";
    return row?.bcs_due && ["OK", "DUE_SOON", "DUE", "OVERDUE"].includes(String(value)) ? `${text} · ${row.bcs_due}` : text;
  }
  if (value === null || value === undefined || value === "") return "—";
  if (key === "overall_grading") return Number(value).toFixed(1).replace(/\.0$/, ".0");
  if (key === "last_volume_ml" || key === "last_morphology" || key === "tsi") return String(Number(value));
  return String(value);
}

export interface PlanDraft {
  date: string;
  boarCount: number;
  reference: string;
  destination: string;
}

export interface PlanDraftRules {
  reference_required?: boolean;
  reference_label?: string | null;
  destination_rule?: string;
}

/**
 * The plain "is it filled in" checks of the planning dialog. The line's own rules (its weekdays, the boars it taps a day) are
 * the API's, which refuses a plan that breaks them and says why in words; they are not copied here to drift from it.
 */
export function planDraftIssues(draft: PlanDraft, rules: PlanDraftRules | null | undefined): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  if (!draft.boarCount) out.push({ field: 'boars', text: 'Choose at least one boar.' });
  if (!draft.date) out.push({ field: 'date', text: 'Choose the collection date.' });
  if (rules?.reference_required && !draft.reference.trim()) out.push({ field: 'reference', text: `Enter the ${rules.reference_label?.trim() || 'reference'}.` });
  if (rules?.destination_rule && rules.destination_rule !== 'ANY' && !draft.destination) out.push({ field: 'destination', text: 'Choose the destination farm.' });
  return out;
}
