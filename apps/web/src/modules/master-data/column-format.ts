import { NA } from '@/utils/na';
import { formatDate, formatDateTime, formatDateShort } from '@/utils/date-short';
import { humanizeCode } from '@/components/console/inventory/requisition-labels';

const STORED_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A list cell's text for the column formats Plan S added (review A8: raw
 * codes such as CRITICAL_FIRST_PRIORITY in the Alert Rules list; A9: ISO
 * dates in the Reporting Periods list), or undefined when the column asks for
 * no formatting and the table's usual display applies.
 */
export function formatColumnValue(
  value: unknown,
  col?: { format?: 'date' | 'codes'; labels?: Record<string, string> },
  key?: string,
): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (col?.format === 'date') return formatDateShort(String(value));
  // A column named like a date and holding one is shown in the app's one date style, whether or not the config says so.
  if (key && typeof value === 'string' && STORED_DATE.test(value)) {
    if (/_(at)$/.test(key)) return formatDateTime(value);
    if (/(_date|_on)$|^date$/.test(key)) return formatDate(value);
  }
  if (!col?.labels && col?.format !== 'codes') return undefined;
  const one = (v: unknown) => {
    const code = String(v);
    return (
      col?.labels?.[code] ??
      (col?.format === 'codes' ? humanizeCode(code) : code)
    );
  };
  if (Array.isArray(value))
    return value.length ? value.map(one).join(', ') : NA;
  return one(value);
}
