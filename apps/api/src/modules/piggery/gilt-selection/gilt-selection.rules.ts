/** BBP: a gilt with fewer than this many teats is a hard block on selection, whatever her TSI. */
export const MIN_GILT_TEATS = 15;

export interface BufferRow {
  line_id: string;
  rfid_tag: string;
  no_of_teats: number;
}

/**
 * What the "Create Gilts" buffer must satisfy before anything is created: a row per gilt selected on each line (no more, no fewer),
 * a unique RFID within the buffer, and at least MIN_GILT_TEATS teats on every gilt. Returns the first thing wrong, or null.
 */
export function bufferProblem(lines: Array<{ line_id: string; gilts_selected: number; label: string }>, rows: BufferRow[], rfidKey: (tag: string) => string): string | null {
  const known = new Set(lines.map((l) => l.line_id));
  for (const r of rows) if (!known.has(r.line_id)) return `A gilt names a line (${r.line_id}) that is not on this selection.`;
  for (const l of lines) {
    const n = rows.filter((r) => r.line_id === l.line_id).length;
    if (n !== l.gilts_selected) return `${l.label} selects ${l.gilts_selected} gilt${l.gilts_selected === 1 ? '' : 's'}, but ${n} ${n === 1 ? 'is' : 'are'} in the buffer. Enter each gilt's RFID and teat count.`;
  }
  const seen = new Set<string>();
  for (const r of rows) {
    const key = rfidKey(r.rfid_tag);
    if (!key) return 'Every gilt needs an RFID tag.';
    if (seen.has(key)) return `RFID ${r.rfid_tag} is entered for more than one gilt.`;
    seen.add(key);
  }
  const few = rows.find((r) => r.no_of_teats < MIN_GILT_TEATS);
  if (few) return `Gilt ${few.rfid_tag} has ${few.no_of_teats} teats; a gilt needs at least ${MIN_GILT_TEATS} to be selected, whatever her TSI score.`;
  return null;
}

/** The "GS-2026-00001" after the highest number of the year, or the first. */
export function nextSelectionNo(year: string, lastNo: string | null | undefined): string {
  const last = lastNo ? Number(lastNo.split('-')[2]) || 0 : 0;
  return `GS-${year}-${String(last + 1).padStart(5, '0')}`;
}

/** Production week of the year a date falls in (1-53), the default for a gilt's batch week. */
export function weekOfYear(date: string): number {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86_400_000 / 7) + 1;
}
