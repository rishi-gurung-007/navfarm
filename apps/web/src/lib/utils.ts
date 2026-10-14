import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/*
 * Numbers on screen. The API returns every DECIMAL column as text at its full stored scale — "5.0000",
 * "150.000000", "65.00000000" — and a screen that prints it as it comes shows all those zeros. Every number a
 * screen shows goes through one of these instead (13 Oct 2026):
 *   formatAmount   money, always 2 decimals            62,695.00
 *   formatQuantity a quantity, at most 2 decimals       12.5 KG · 1,200 KG · HEAD as a whole number
 *   formatRate     a unit cost or per-unit rate         28,000.00 · 0.0458 (2 decimals unless that would hide it)
 *   formatExact    every stored digit, no padding       GPS, UOM conversion factors
 *   toInputNumber  the value for an edit box            150 (never rounded, so saving changes nothing)
 * Grouping is en-US (thousands); the company currency's own grouping stays with useCompanyCurrency.
 */
const NUMBER_LOCALE = 'en-US';

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** A quantity: at most 2 decimals, thousands grouped. HEAD is always whole — half an animal is never real. */
export function formatQuantity(value: unknown, uom?: string | null): string {
  const num = finite(value);
  if (num === null) return value === null || value === undefined ? '' : String(value);
  const head = !!uom && uom.toUpperCase() === 'HEAD';
  return num.toLocaleString(NUMBER_LOCALE, { maximumFractionDigits: head ? 0 : 2 });
}

/** Money without a symbol: always 2 decimals, thousands grouped. */
export function formatAmount(value: unknown): string {
  const num = finite(value);
  if (num === null) return value === null || value === undefined ? '' : String(value);
  return num.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A unit cost or a per-unit rate: 2 decimals like money, unless the value is so small that 2 decimals would show
 * it as 0.00 or misstate it (0.0458 per gram) — then the significant digits are kept, up to 6.
 */
export function formatRate(value: unknown): string {
  const num = finite(value);
  if (num === null) return value === null || value === undefined ? '' : String(value);
  if (num !== 0 && Math.abs(num) < 1 && Number(num.toFixed(2)) !== num) {
    return num.toLocaleString(NUMBER_LOCALE, { maximumFractionDigits: 6 });
  }
  return num.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A number nothing says more about (a generic master column): at most 2 decimals, grouped — unless it is a small
 * fraction 2 decimals would hide (a conversion factor of 0.001), which keeps its digits.
 */
export function formatDecimal(value: unknown): string {
  const num = finite(value);
  if (num === null) return value === null || value === undefined ? '' : String(value);
  if (num !== 0 && Math.abs(num) < 1 && Number(num.toFixed(2)) !== num) {
    return num.toLocaleString(NUMBER_LOCALE, { maximumFractionDigits: 8 });
  }
  return num.toLocaleString(NUMBER_LOCALE, { maximumFractionDigits: 2 });
}

/** Every stored digit, trailing zeros dropped, not grouped: GPS coordinates, UOM conversion factors. */
export function formatExact(value: unknown): string {
  const num = finite(value);
  return num === null ? (value === null || value === undefined ? '' : String(value)) : String(num);
}

/** The value an edit box starts with: the number as stored, without padding zeros and never rounded. */
export function toInputNumber(value: unknown): string {
  const num = finite(value);
  return num === null ? '' : String(num);
}
