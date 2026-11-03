/**
 * The one date style of the feed screens, the Alerts page and the
 * Requisitions screen (field specification D16; review A9: the same screens
 * showed DD/MM/YY, dd-MMM-yyyy, ISO and "26/09/2026, 13:17:28").
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" (or a timestamp starting with one) -> "DD/MM/YY"; null/undefined/unparseable -> "—". */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "—";
}

/**
 * A stored MySQL timestamp ("YYYY-MM-DD HH:MM:SS") -> "DD/MM/YY HH:mm" in the
 * viewer's zone. `utc` says the stamp was written in UTC (feed_alert, Plan B's
 * convention); batch alerts are written in server-local time and read as such.
 */
export function formatStampShort(ts: string | null | undefined, utc = false): string {
  if (!ts) return "—";
  const d = new Date(`${ts.replace(" ", "T")}${utc ? "Z" : ""}`);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ZONELESS = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;
const local = (d: Date, withTime: boolean) => {
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
};

/**
 * The one way every screen shows a date: "DD/MM/YY". Takes what the app holds — a "YYYY-MM-DD" date, a stored timestamp
 * (read as written), an ISO timestamp with a zone or a Date (read in the viewer's zone) — and shows "—" for none or
 * anything unreadable. Never the browser's locale: the same date reads the same for every user.
 */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && ZONELESS.test(value.trim())) return formatDateShort(value.trim());
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : local(d, false);
}

/** A moment: "DD/MM/YY HH:mm" in the viewer's zone (a zoneless stored timestamp is read as written, as `formatStampShort` does). */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && ZONELESS.test(value.trim())) return formatStampShort(value.trim());
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : local(d, true);
}

/** A sentence the server wrote ("…already planned for 2026-11-04…"): every date in it shown in the one style. */
export function datesInText(text: string): string {
  return text.replace(/(?<![\w-])(\d{4})-(\d{2})-(\d{2})(?![\w-])/g, (_m, y, mo, d) => `${d}/${mo}/${y.slice(2)}`);
}
