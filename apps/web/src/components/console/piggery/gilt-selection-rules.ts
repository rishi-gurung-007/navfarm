/** BBP: a gilt with fewer than this many teats cannot be selected, whatever her TSI. Mirrors the API's rule; the API is what enforces it. */
export const MIN_GILT_TEATS = 15;

export interface GiltLitter {
  farrow_id: string;
  available: number;
  farrowing_date: string;
}

export interface GiltBufferRow {
  key: string;
  farrow_id: string;
  rfid_tag: string;
  no_of_teats: string;
  dob: string;
}

/** The gilts asked for, per litter: whole numbers, none above what is left in the litter, none negative. */
export function giltsAsked(litters: GiltLitter[], asked: Record<string, string>): Array<{ farrow_id: string; gilts_selected: number }> {
  const out: Array<{ farrow_id: string; gilts_selected: number }> = [];
  for (const l of litters) {
    const n = Math.floor(Number(asked[l.farrow_id] || 0));
    if (n > 0) out.push({ farrow_id: l.farrow_id, gilts_selected: Math.min(n, l.available) });
  }
  return out;
}

/** One empty buffer row per gilt asked for, birth date defaulting to the litter's farrowing date. */
export function bufferFor(litters: GiltLitter[], asked: Array<{ farrow_id: string; gilts_selected: number }>): GiltBufferRow[] {
  const rows: GiltBufferRow[] = [];
  for (const a of asked) {
    const litter = litters.find((l) => l.farrow_id === a.farrow_id);
    for (let i = 0; i < a.gilts_selected; i++) {
      rows.push({ key: `${a.farrow_id}:${i}`, farrow_id: a.farrow_id, rfid_tag: '', no_of_teats: '', dob: litter?.farrowing_date ?? '' });
    }
  }
  return rows;
}

/** What is still wrong with the buffer on screen, row by row: a missing tag, a repeated tag, a teat count under the minimum. */
export function bufferErrors(rows: GiltBufferRow[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const r of rows) {
    const tag = r.rfid_tag.trim().toUpperCase();
    const teats = Number(r.no_of_teats);
    if (!tag) errors[r.key] = 'RFID';
    else if (seen.has(tag)) errors[r.key] = 'DUPLICATE';
    else seen.set(tag, r.key);
    if (!errors[r.key]) {
      if (!r.no_of_teats.trim() || !Number.isFinite(teats)) errors[r.key] = 'TEATS';
      else if (teats < MIN_GILT_TEATS) errors[r.key] = 'MIN_TEATS';
    }
  }
  return errors;
}

/** The buffer resized to `count` rows for one litter, keeping what has been typed in the rows that stay. */
export function resizeBuffer(rows: GiltBufferRow[], count: number, farrowId: string, dob: string): GiltBufferRow[] {
  const n = Math.max(0, Math.floor(count) || 0);
  const kept = rows.slice(0, n);
  for (let i = kept.length; i < n; i++) kept.push({ key: `${farrowId}:${i}`, farrow_id: farrowId, rfid_tag: '', no_of_teats: '', dob });
  return kept;
}
