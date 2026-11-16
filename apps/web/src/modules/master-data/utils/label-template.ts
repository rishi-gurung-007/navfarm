/**
 * The lot label template on Breeding Line Setup, made easy to get right: the parts a label may hold, a few ready formats, the
 * same checks the API makes when it is saved (breeding-line.rules.ts `lineSetupIssues`), and a preview of what a sachet will
 * read. The template itself is filled in by the API when a lot is posted (semen-lot-label.rules.ts `renderLotLabel`).
 */

export interface LabelPart {
  token: string;
  label: string;
  hint: string;
}

/** Every token the API accepts, in the order a user would usually want them. */
export const LABEL_PARTS: LabelPart[] = [
  { token: 'BOAR_TAG', label: 'Boar tag', hint: "The boar's ear tag, else his animal code. A pooled lot joins its boars with +." },
  { token: 'BOAR_CODE', label: 'Boar code', hint: "The boar's animal code. A pooled lot joins its boars with +." },
  { token: 'LINE', label: 'Line', hint: "The breeding line's code." },
  { token: 'WEEK', label: 'Week', hint: 'The ISO week number of the collection date.' },
  { token: 'YEAR', label: 'Year', hint: 'The year that week belongs to.' },
  { token: 'DATE', label: 'Date', hint: 'The collection date, yyyy-mm-dd.' },
  { token: 'SEQ', label: 'Lot no. in week', hint: "1 for the line's first lot of the week, 2 for the second: tells two lots of a week apart." },
];

const KNOWN = new Set(LABEL_PARTS.map((p) => p.token));

/** Ready formats a user can start from. Generic: no client figure. */
export const LABEL_PRESETS: { label: string; template: string }[] = [
  { label: 'Boar tag – Week', template: '{BOAR_TAG}-{WEEK}' },
  { label: 'Line – Week', template: '{LINE}-{WEEK}' },
  { label: 'Line – Week – Lot no.', template: '{LINE}-{WEEK}-{SEQ}' },
  { label: 'Boar tag – Date', template: '{BOAR_TAG}-{DATE}' },
];

/**
 * Tidies what was typed so a near miss is not refused: a token typed in lower case or with spaces (`{ week }`, `{boar tag}`) is
 * the token (`{WEEK}`, `{BOAR_TAG}`). Anything that is still not a known token is left as typed, for `labelTemplateIssues`.
 */
export function normaliseLabelTemplate(text: string): string {
  return text.replace(/{([^{}]*)}/g, (whole, inner: string) => {
    const token = inner.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return KNOWN.has(token) ? `{${token}}` : whole;
  });
}

/** What is wrong with a template, as the API will say it. An empty list means it can be saved. */
export function labelTemplateIssues(text: string | null | undefined): string[] {
  const template = String(text ?? '');
  if (!template.trim()) return [];
  const out: string[] = [];
  const opened = (template.match(/{/g) ?? []).length;
  const closed = (template.match(/}/g) ?? []).length;
  const tokens = [...template.matchAll(/{([^{}]*)}/g)].map((m) => m[1]);
  if (opened !== closed || tokens.length !== opened) out.push('A { has no matching } (or the other way round).');
  const unknown = [...new Set(tokens.filter((t) => !KNOWN.has(t)))];
  if (unknown.length) out.push(`Not a label part: ${unknown.map((t) => `{${t}}`).join(', ')}. Use the buttons to add a part.`);
  if (template.length > 100) out.push('A template is at most 100 characters.');
  return out;
}

/** The text with `insert` put where the cursor is (or replacing what is selected), and where the cursor goes after it. */
export function insertAt(text: string, insert: string, start: number, end = start): { text: string; cursor: number } {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return { text: text.slice(0, s) + insert + text.slice(e), cursor: s + insert.length };
}

const isoWeek = (d: Date): { week: number; year: number } => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const start = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { week: Math.ceil(((t.getTime() - start) / 86_400_000 + 1) / 7), year: t.getUTCFullYear() };
};

export interface PreviewSample {
  line: string;
  boarTags: string[];
  boarCodes: string[];
  date: Date;
  seq: number;
}

/** What a sachet would read, filled in the way the API fills it. Null for an empty template. */
export function previewLabel(template: string | null | undefined, sample: PreviewSample): string | null {
  if (!template?.trim()) return null;
  const { week, year } = isoWeek(sample.date);
  const iso = `${sample.date.getFullYear()}-${String(sample.date.getMonth() + 1).padStart(2, '0')}-${String(sample.date.getDate()).padStart(2, '0')}`;
  const values: Record<string, string> = {
    LINE: sample.line,
    BOAR_TAG: sample.boarTags.join('+'),
    BOAR_CODE: sample.boarCodes.join('+'),
    WEEK: String(week),
    YEAR: String(year),
    DATE: iso,
    SEQ: String(sample.seq),
  };
  return template.replace(/{([A-Z_]+)}/g, (whole, token: string) => (token in values ? values[token] : whole)).trim() || null;
}
