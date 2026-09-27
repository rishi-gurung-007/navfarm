import { formatDateShort } from "@/utils/date-short";
import { humanizeCode } from "@/components/console/inventory/requisition-labels";

/**
 * A list cell's text for the column formats Plan S added (review A8: raw
 * codes such as CRITICAL_FIRST_PRIORITY in the Alert Rules list; A9: ISO
 * dates in the Reporting Periods list), or undefined when the column asks for
 * no formatting and the table's usual display applies.
 */
export function formatColumnValue(value: unknown, col?: { format?: "date" | "codes"; labels?: Record<string, string> }): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (col?.format === "date") return formatDateShort(String(value));
  if (!col?.labels && col?.format !== "codes") return undefined;
  const one = (v: unknown) => {
    const code = String(v);
    return col?.labels?.[code] ?? (col?.format === "codes" ? humanizeCode(code) : code);
  };
  if (Array.isArray(value)) return value.length ? value.map(one).join(", ") : "—";
  return one(value);
}
