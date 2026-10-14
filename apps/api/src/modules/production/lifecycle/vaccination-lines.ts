/**
 * Vaccinations of a breed lifecycle stage as scheduler days (Rishi, 14 Oct).
 *
 * The stage's Vaccination Protocol rows are { vaccine_item_id, trigger_type, trigger_value, dose_ml, route, ... }.
 * AGE_WEEKS means the animal's age in weeks, from its date of birth (Rishi: "from the date of birth to the current
 * date how many weeks"), so a vaccination at age W weeks falls on date of birth + W x 7 days. A batch scheduler counts
 * stage days from the stage entry date (day 1), so that date becomes one stage day. A batch's date of birth is its
 * oldest registered animal's; a batch with none (count only) has no age to count from and gets no AGE_WEEKS line.
 * WEEKS_PREGNANT and PER_CYCLE hang on each sow's own mating, not on the batch, and are not scheduled here.
 */

const DAY_MS = 86_400_000;
const utc = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export interface WantedVaccination {
  itemId: string;
  /** Stage day (1 = the stage entry date). */
  day: number;
  doseMl: number | null;
  weeks: number;
}

/** The AGE_WEEKS vaccinations that fall inside this stage for a batch born on `dob`, as stage days. */
export function wantedVaccinations(
  protocol: unknown,
  dob: string | null | undefined,
  stageEntry: string,
  durationDays?: number | null,
): WantedVaccination[] {
  if (!Array.isArray(protocol) || !dob || !stageEntry) return [];
  const out: WantedVaccination[] = [];
  for (const row of protocol) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (r.trigger_type !== 'AGE_WEEKS' || typeof r.vaccine_item_id !== 'string' || !r.vaccine_item_id) continue;
    const weeks = Number(r.trigger_value);
    if (!Number.isFinite(weeks) || weeks < 0) continue;
    const dueMs = utc(dob) + Math.round(weeks * 7) * DAY_MS;
    const day = Math.round((dueMs - utc(stageEntry)) / DAY_MS) + 1;
    if (day < 1 || (durationDays && day > durationDays)) continue;
    const dose = r.dose_ml === '' || r.dose_ml == null ? null : Number(r.dose_ml);
    out.push({ itemId: r.vaccine_item_id, day, doseMl: Number.isFinite(dose as number) ? (dose as number) : null, weeks });
  }
  return out.sort((a, b) => a.day - b.day);
}
