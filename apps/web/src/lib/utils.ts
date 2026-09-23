import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A quantity backed by a DECIMAL(10,4) column comes back from the API as a
 * full-precision string ("58.0000"), which is the right amount of precision
 * for stock measured in KG or LITRE but not for a headcount — half an animal
 * is never a real quantity, so HEAD always rounds to a whole number. Every
 * other unit just gets normal number formatting, which drops the same
 * insignificant trailing zeros ("58.5000" -> "58.5") without touching a real
 * fraction.
 */
export function formatQuantity(value: unknown, uom?: string | null): string {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return String(uom && uom.toUpperCase() === 'HEAD' ? Math.round(num) : num);
}
