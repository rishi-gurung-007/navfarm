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
