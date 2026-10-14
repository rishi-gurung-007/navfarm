/**
 * What a field shows of a record that has a code and a name (Rishi, 14 Oct): a field that is a code shows the code,
 * a UOM or currency shows its code (that is the unit itself), and every other field shows the name. A table that
 * needs both gives them two columns; a dropdown list keeps both as its Code and Name columns.
 */

/** The name, or the code when there is no name. */
export function nameOrCode(code?: string | null, name?: string | null): string {
  const n = name == null ? "" : String(name).trim();
  return n || (code == null ? "" : String(code));
}

const CODE_IS_THE_THING = /(^|_)(uom|currency|iso|iso2)(_|$)/i;

/**
 * The text an entity field shows for one record, from the field's label keys (["item_code", "item_name"] ...):
 * the code for a UOM / currency, the name / description otherwise, and a lone key as it is.
 */
export function entityDisplayText(row: Record<string, unknown>, labelKeys: string[] = [], valueKey?: string): string {
  const present = labelKeys.filter((k) => row[k] !== null && row[k] !== undefined && row[k] !== "");
  if (!present.length) return "";
  if (present.length === 1) return String(row[present[0]]);
  const codeKey = present.find((k) => /(^|_)(code|no|iso2?)$/i.test(k));
  if (codeKey && (CODE_IS_THE_THING.test(codeKey) || (valueKey && CODE_IS_THE_THING.test(valueKey)))) return String(row[codeKey]);
  // No name beside the code (an animal's code and tag): the code is the thing.
  const nameKey = present.find((k) => /(^|_)(name|description|title)$/i.test(k));
  return String(row[nameKey ?? codeKey ?? present[0]]);
}
