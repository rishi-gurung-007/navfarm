/** The preview and the allocator must use the same clock/reset/format rules. */
export interface CodeSeriesFormat {
  prefix: string | null;
  no_series_code?: string | null;
  separator: string | null;
  seq_length: number;
  current_seq: number;
  reset_frequency: string;
  updated_at: string | Date;
  /**
   * The ordered parts of the code, before the sequence. Each entry is either a
   * field of the master being coded, or the literal token PREFIX standing for
   * this series' own `prefix`. Empty means prefix-then-sequence, which is what
   * every series did before segments existed.
   */
  code_segments?: unknown;
  /** START or END — where the prefix sits relative to the segments. */
  prefix_position?: string | null;
  /**
   * The separator before the number, when it differs from the one joining the
   * segments. A location is FARM-001/SHED-001/PEN-001: "/" between the levels of
   * the path, "-" before the sequence. One separator cannot say both, and with
   * only "/" a root location reads FARM/001.
   */
  seq_separator?: string | null;
}

/** Thrown when a composed code will not fit its master's code column. */
export class CodeTooLongError extends Error {
  constructor(readonly code: string, readonly maxLength: number) {
    super(
      `Generated code "${code}" is ${code.length} characters, and this master's code column holds ${maxLength}. ` +
      `Shorten the prefix, drop a segment, or use a shorter source field on the number series.`
    );
    this.name = 'CodeTooLongError';
  }
}

/**
 * A field's value as it appears inside a code: upper case, letters, digits and
 * the underscore that separates words.
 *
 *   "Large White"        -> LARGE_WHITE     (matches the breed codes already in use)
 *   "Crude Protein (%)"  -> CRUDE_PROTEIN   (matches the attribute code already in use)
 *   "RAW MATERIAL"       -> RAW_MATERIAL    (matches the item type code already in use)
 *   "FARM-002"           -> FARM002         (a referenced code loses its own separator)
 *
 * A space becomes an underscore because that is where a word ends; a hyphen does
 * not, because a hyphen inside a referenced code is that code's separator, not
 * this one's, and FARM-002-SHED-001 could not be told apart from its own parts.
 * Runs collapse and edges are trimmed, so no code starts or ends on a separator.
 *
 * Deliberately not truncated. Codes are identity, and a silent cut turns
 * GROWER_FINISHER and GROWER_FINISHING into the same code; an over-long code is
 * rejected outright instead, at the moment it is generated.
 */
export function normalizeSegment(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '_')
    // Letters, digits and the three separators a code is built from. A referenced
    // code keeps its own shape — FARM-001/SHED-001 stays intact instead of
    // collapsing to FARM001SHED001 — while punctuation a name happens to carry
    // (%, brackets, commas) still goes.
    .replace(/[^A-Z0-9_/-]/g, '')
    // "Flush and Service / AI" would otherwise leave _/_ where the slash was.
    .replace(/_*([/-])_*/g, '$1')
    .replace(/_+/g, '_')
    .replace(/^[_/-]+|[_/-]+$/g, '');
}

/**
 * A date segment carries how much of the date it contributes, as `field:YEAR`
 * or `field:DATE`. The animal code takes the year of birth, not of the moment
 * the record happened to be typed, which is what the old `date_format` column
 * stamped and why it was wrong for anything entered late.
 */
export const DATE_PART = { YEAR: 'YEAR', DATE: 'DATE' } as const;

/** Splits `date_of_birth:YEAR` into its field and its part. */
export function parseSegment(entry: string): { field: string; part?: string } {
  const [field, part] = entry.split(':');
  return { field, part };
}

/** A date rendered into a code: 2026 for YEAR, 20260908 for DATE. */
export function formatDateSegment(value: unknown, part: string | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  // A DATE column comes back from mysql2 as a Date, not a string, and
  // String(date) is "Fri Apr 18 2025 00:00:00 GMT+0530 (India Standard Time)".
  // That failed the ISO match and fell through to normalizeSegment, which put
  // the whole thing in the code: PIG-FRI_APR_18_2025_000000_GMT0530-0001.
  if (value instanceof Date) {
    // An unreadable Date contributes nothing. Falling through below would put
    // normalizeSegment("Invalid Date") — INVALID_DATE — into the code.
    if (Number.isNaN(value.getTime())) return '';
    const iso = value.toISOString();
    return part === DATE_PART.DATE ? iso.slice(0, 10).replace(/-/g, '') : iso.slice(0, 4);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  // Not a date at all — a text field wrongly configured as one. Its own value is
  // still better in the code than a date parsed out of nothing.
  if (!match) return normalizeSegment(value);
  const [, y, m, d] = match;
  return part === DATE_PART.DATE ? `${y}${m}${d}` : y;
}

/** The ordered parts a series composes its code from. */
export function segmentFields(series: Pick<CodeSeriesFormat, 'code_segments'>): string[] {
  const raw = series.code_segments;
  const list = typeof raw === 'string' ? safeParse(raw) : raw;
  return Array.isArray(list) ? list.map((entry) => String(entry)).filter(Boolean) : [];
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

export function nextSequence(series: CodeSeriesFormat, now: Date): number {
  const previous = new Date(series.updated_at);
  const newYear = now.getFullYear() !== previous.getFullYear();
  const reset = (series.reset_frequency === 'YEARLY' && newYear) ||
    (series.reset_frequency === 'MONTHLY' && (newYear || now.getMonth() !== previous.getMonth()));
  return (reset ? 0 : series.current_seq) + 1;
}

/**
 * `segmentValues` carries the record being created, keyed by the field names the
 * series names in `code_segments` / `prefix_field`. A key that is absent or
 * empty contributes nothing rather than an empty segment, so a code never grows
 * a stray separator.
 *
 * Order: leading segments, then the prefix (or the field standing in for it),
 * then the date, then the sequence — which is the shape Location has always
 * produced, now reachable by configuration rather than by its own code path.
 */
export function formatSeriesCode(
  series: CodeSeriesFormat,
  sequence: number,
  now: Date,
  segmentValues: Record<string, unknown> = {},
): string {
  const stem = formatSeriesStem(series, now, segmentValues);
  // Sequence Digits 0 means no number at all: the Breed code IS the breed name,
  // and LARGEWHITE-001 would be a counter on something already unique. Only
  // legal when the stem is not empty — a code that is nothing would collide with
  // the next one, so the sequence stays as the thing that separates them.
  if (series.seq_length <= 0 && stem) return stem;
  const tail = String(sequence).padStart(Math.max(series.seq_length, 1), '0');
  return stem ? `${stem}${series.seq_separator || series.separator || '-'}${tail}` : tail;
}

/**
 * Everything before the sequence — the part that repeats for every record
 * sharing the same segments. `FARM002-SHED` is the stem of `FARM002-SHED-001`.
 *
 * Split out because it is what per-combination numbering counts within: a shed
 * under farm 2 is FARM002-SHED-001 even when farm 1 already has three, so the
 * next number comes from the siblings sharing this stem, not from a counter
 * shared across the whole series.
 */
export function formatSeriesStem(
  series: CodeSeriesFormat,
  now: Date,
  segmentValues: Record<string, unknown> = {},
): string {
  const parts: string[] = [];
  const configured = segmentFields(series);

  const prefix = normalizeSegment(series.prefix || series.no_series_code);
  if (prefix && series.prefix_position === 'START' && !parts.includes(prefix)) parts.push(prefix);

  for (const entry of configured) {
    const { field, part } = parseSegment(entry);
    const raw = segmentValues[field];
    const segment = part ? formatDateSegment(raw, part) : normalizeSegment(raw);
    if (segment && !parts.includes(segment)) parts.push(segment);
  }

  // END is the default, and with no segments configured it is also the only
  // position there is — which is what every series did before any of this.
  if (prefix && series.prefix_position !== 'START' && !parts.includes(prefix)) parts.push(prefix);

  return parts.join(series.separator || '-');
}

/**
 * The next number within a stem: MAX of the numeric suffix across existing
 * codes that share it, plus one — never a count, so deleting a sibling cannot
 * hand its number to the next record. Lifted from composite-code.util, which
 * location.service has used since it was written.
 */
export function nextSequenceInStem(stem: string, separator: string, existingCodes: Iterable<string>): number {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escape(stem)}${escape(separator)}(\\d+)$`, 'i');
  let max = 0;
  for (const code of existingCodes) {
    const match = code.match(pattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/** Rejects rather than truncates — Option C, Rishi's call 2026-09-08. */
export function assertCodeFits(code: string, maxLength: number | undefined): string {
  if (maxLength && code.length > maxLength) throw new CodeTooLongError(code, maxLength);
  return code;
}
