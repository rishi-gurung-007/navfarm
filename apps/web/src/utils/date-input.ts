/**
 * The rules behind the app's date field (`components/ui/date-input.tsx`): what is typed in it, how a typed date is read, and
 * the month it offers. The field shows and takes "DD/MM/YY" (the app's one date style) and hands the form the stored
 * "YYYY-MM-DD", exactly as the browser's own date input did.
 */
const pad = (n: number) => String(n).padStart(2, "0");

export const STORED = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-03" -> "03/11/26"; a year outside 2000–2099 keeps its four digits ("03/11/1998") so it is never misread. */
export function isoToTyped(iso: string | null | undefined): string {
  if (!iso || !STORED.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  const year = Number(y) >= 2000 && Number(y) <= 2099 ? y.slice(2) : y;
  return `${d}/${m}/${year}`;
}

/** What is typed, reduced to digits and given its slashes as it goes: "0311" -> "03/11", "031126" -> "03/11/26". At most DD/MM/YYYY. */
export function maskTyped(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Whether the digits typed so far make a whole date: DD/MM/YY (6 digits) or DD/MM/YYYY (8). */
export const isCompleteTyped = (text: string) => /^\d{2}\/\d{2}\/(\d{2}|\d{4})$/.test(text);

/** A real calendar date, or false: 31/02/26 is not one. */
export function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * The stored date a typed text stands for: "" for nothing typed, the "YYYY-MM-DD" for a whole real date, null for anything
 * else. A two-digit year is 20YY.
 */
export function parseTyped(text: string): string | "" | null {
  const t = text.trim();
  if (!t) return "";
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** Inside the field's own min / max (stored dates; either may be absent). */
export const withinRange = (iso: string, min?: string, max?: string) => (!min || iso >= min) && (!max || iso <= max);

/** The month `delta` months from year/month (month 0–11). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + month + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

/** A month as weeks starting on Monday: each cell the stored date, or null for a day of the neighbouring month. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Today as a stored date, in the viewer's zone. */
export const todayStored = () => {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
};
