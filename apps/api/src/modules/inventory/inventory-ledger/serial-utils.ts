/**
 * A ledger row's `serial_no` is free text: one serial, or many separated by commas or new lines
 * (a goods receipt line receives its serials in one row). Matching must be on whole serials —
 * a substring search lets SN1 match SN10 and consume the wrong unit.
 */
export function parseSerials(text?: string | null): string[] {
  return text ? text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : [];
}

/** True when `serial` is one of the whole serials in `text`. */
export function hasSerial(text: string | null | undefined, serial: string): boolean {
  return parseSerials(text).includes(serial.trim());
}
