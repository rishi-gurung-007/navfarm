/**
 * NAVFarm supplier fields → Business Central Vendor Card (VendorCardApi) fields, for create and update.
 * The reverse of bc-vendor.mapper.ts. BC remains the validator of codes (payment terms, currency, posting groups,
 * country): an unknown code comes back from BC as a 400 with BC's own message, which NAVFarm shows unchanged.
 */

/** NAVFarm field → [BC field, BC max length, upper-case (BC Code field)]. */
export const SUPPLIER_TO_BC: Record<string, [string, number, boolean]> = {
  supplier_name: ['Name', 100, false],
  bc_name_2: ['Name_2', 50, false],
  city: ['City', 30, false],
  state: ['County', 30, false],
  pincode: ['Post_Code', 20, true],
  country: ['Country_Region_Code', 10, true],
  phone: ['Phone_No', 30, false],
  email: ['E_Mail', 80, false],
  tax_number: ['VAT_Registration_No', 20, false],
  registration_number: ['Registration_Number', 50, false],
  payment_terms: ['Payment_Terms_Code', 10, true],
  currency_code: ['Currency_Code', 10, true],
  gen_bus_posting_group: ['Gen_Bus_Posting_Group', 20, true],
  vendor_posting_group: ['Vendor_Posting_Group', 20, true],
  purchaser_code: ['Purchaser_Code', 20, true],
};

/** The NAVFarm fields that live in BC (address_line1 maps to Address + Address_2). */
export const BC_WRITABLE_SUPPLIER_FIELDS = [...Object.keys(SUPPLIER_TO_BC), 'address_line1'] as const;

export class BcVendorInputError extends Error {}

const clean = (v: unknown): string => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim());

/** BC Address (100) + Address 2 (50): split at the last ", " that fits, else hard-cut. */
export function splitAddress(address: string): { Address: string; Address_2: string } {
  const a = clean(address);
  if (a.length <= 100) {
    const comma = a.indexOf(', ');
    // Keep what the sync joined ("street, suburb") as two lines when it came from BC that way.
    return comma > 0 && a.length - comma - 2 <= 50 ? { Address: a.slice(0, comma), Address_2: a.slice(comma + 2) } : { Address: a, Address_2: '' };
  }
  const cut = a.lastIndexOf(', ', 100);
  const first = cut > 0 ? a.slice(0, cut) : a.slice(0, 100);
  const rest = (cut > 0 ? a.slice(cut + 2) : a.slice(100)).trim();
  if (rest.length > 50) throw new BcVendorInputError('Address is longer than Business Central allows (Address 100 + Address 2 50 characters).');
  return { Address: first, Address_2: rest };
}

/**
 * BC payload for the given NAVFarm values. Only keys present in `values` are mapped (so an update sends only what
 * the user changed). Throws BcVendorInputError naming every field that exceeds BC's length.
 */
export function toBcVendorFields(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const tooLong: string[] = [];
  for (const [field, [bcField, max, upper]] of Object.entries(SUPPLIER_TO_BC)) {
    if (!(field in values) || values[field] === undefined) continue;
    let v = clean(values[field]);
    if (upper) v = v.toUpperCase();
    if (v.length > max) tooLong.push(`${field} (max ${max})`);
    out[bcField] = v;
  }
  if ('address_line1' in values && values.address_line1 !== undefined) Object.assign(out, splitAddress(clean(values.address_line1)));
  if (tooLong.length) throw new BcVendorInputError(`Longer than Business Central allows: ${tooLong.join(', ')}.`);
  return out;
}

/** Only the BC fields whose value differs from the supplier's current one. */
export function changedBcFields(current: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const field of BC_WRITABLE_SUPPLIER_FIELDS) {
    if (!(field in values) || values[field] === undefined) continue;
    const upper = SUPPLIER_TO_BC[field]?.[2];
    const norm = (v: unknown) => (upper ? clean(v).toUpperCase() : clean(v));
    if (norm(values[field]) !== norm(current[field])) changed[field] = values[field];
  }
  return changed;
}

/** "VEN0001" or "BUH" looks like a vendor number; anything with a space or lower case is a name search. */
export function looksLikeVendorNo(term: string): boolean {
  return /^[A-Z0-9][A-Z0-9_\-./]*$/.test(term) && /\d/.test(term);
}
