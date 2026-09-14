/**
 * The canonical currency reference list and the country→currency defaults.
 *
 * Lives here rather than inline in bootstrap-database.ts because two scripts
 * need it: bootstrap seeds a fresh database, sync-currency-master.ts brings an
 * existing one up to date. seed-location.ts's header records what happens when
 * two seed scripts each keep their own copy of the same data — they drift.
 *
 * Deliberately the currencies of the countries bootstrap seeds, not the full
 * ISO 4217 register: a small, real set is what the client asked for
 * (Rishi, 2026-09-11).
 */

export interface CurrencySeedRow {
  currency_id: string;
  iso_code: string;
  currency_name: string;
  symbol: string;
  decimal_places: number;
  /**
   * Countries where this currency is legal tender, as ISO alpha-2 codes.
   *
   * An array because one country id could hold neither fact that matters here:
   * EUR covers all three seeded eurozone countries, and USD lists Zimbabwe
   * alongside the United States because it genuinely circulates there — which
   * is the fact this client most needs recorded.
   */
  country_codes: string[];
}

/**
 * Hand-assigned sentinel ids. country_master.default_currency_id and
 * company_currency_config.currency_id point at these across the master database
 * and every tenant database, so a regenerated id would orphan those rows.
 */
export const currencyId = (n: number) =>
  `20000000-2000-2000-2000-2${String(n).padStart(11, '0')}`;

// [id#, ISO 4217 code, name, symbol, decimal places, countries where legal tender]
const ROWS: Array<[number, string, string, string, number, string[]]> = [
  [1, 'INR', 'Indian Rupee', '₹', 2, ['IN']],
  [2, 'USD', 'US Dollar', '$', 2, ['US', 'ZW']],
  // BBP-1 §1.1 treats ZWL as the foreign currency against a USD base:
  // "Exchange Rate (USD/ZWL) ... Manual entry by Finance." Without the row
  // there is nothing to record a rate against.
  // NOTE for the client: Zimbabwe replaced ZWL with the ZiG (ZWG) in April
  // 2024. The blueprint says ZWL throughout, so both are seeded and the choice
  // is left open — still worth confirming before sign-off.
  [3, 'ZWL', 'Zimbabwe Dollar', 'Z$', 2, ['ZW']],
  [4, 'ZWG', 'Zimbabwe Gold', 'ZiG', 2, ['ZW']],
  [5, 'GBP', 'Pound Sterling', '£', 2, ['GB']],
  [6, 'EUR', 'Euro', '€', 2, ['DE', 'FR', 'NL']],
  [7, 'AED', 'UAE Dirham', 'د.إ', 2, ['AE']],
  [8, 'SGD', 'Singapore Dollar', 'S$', 2, ['SG']],
  [9, 'CNY', 'Chinese Yuan', '¥', 2, ['CN']],
  // JPY and VND have no minor unit. A decimal_places of 2 would render
  // ¥1,000 as ¥1,000.00 and invite a rounding step that does not exist.
  [10, 'JPY', 'Japanese Yen', '¥', 0, ['JP']],
  [11, 'AUD', 'Australian Dollar', 'A$', 2, ['AU']],
  [12, 'ZAR', 'South African Rand', 'R', 2, ['ZA']],
  [13, 'NGN', 'Nigerian Naira', '₦', 2, ['NG']],
  [14, 'CAD', 'Canadian Dollar', 'C$', 2, ['CA']],
  [15, 'BRL', 'Brazilian Real', 'R$', 2, ['BR']],
  [16, 'BDT', 'Bangladeshi Taka', '৳', 2, ['BD']],
  [17, 'THB', 'Thai Baht', '฿', 2, ['TH']],
  [18, 'VND', 'Vietnamese Dong', '₫', 0, ['VN']],
  [19, 'IDR', 'Indonesian Rupiah', 'Rp', 2, ['ID']],
  [20, 'PHP', 'Philippine Peso', '₱', 2, ['PH']],
  [21, 'KES', 'Kenyan Shilling', 'KSh', 2, ['KE']],
  [22, 'EGP', 'Egyptian Pound', 'E£', 2, ['EG']],
  [23, 'LKR', 'Sri Lankan Rupee', 'Rs', 2, ['LK']],
  [24, 'MXN', 'Mexican Peso', 'Mex$', 2, ['MX']],
];

export const CURRENCY_SEED_ROWS: CurrencySeedRow[] = ROWS.map(
  ([n, iso_code, currency_name, symbol, decimal_places, country_codes]) => ({
    currency_id: currencyId(n),
    iso_code,
    currency_name,
    symbol,
    decimal_places,
    country_codes,
  }),
);

export const CURRENCY_ID_BY_ISO = new Map(
  CURRENCY_SEED_ROWS.map((c) => [c.iso_code, c.currency_id]),
);

/**
 * Each seeded country's default currency. Only three were set before — India,
 * the United States and Zimbabwe — which left the other 22 countries pointing
 * at nothing, so a company trading with any of them had no currency to default
 * to.
 *
 * Zimbabwe stays USD rather than ZWL or ZWG: BBP-1 §1.1 prices the operation in
 * USD and treats the local unit as the foreign currency to convert from.
 * Germany, France and the Netherlands all point at the one EUR row.
 */
export const DEFAULT_CURRENCY_BY_COUNTRY: Record<string, string> = {
  IN: 'INR', US: 'USD', ZW: 'USD', GB: 'GBP', AE: 'AED', SG: 'SGD', CN: 'CNY',
  JP: 'JPY', AU: 'AUD', ZA: 'ZAR', NG: 'NGN', DE: 'EUR', FR: 'EUR', NL: 'EUR',
  CA: 'CAD', BR: 'BRL', BD: 'BDT', TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP',
  KE: 'KES', EG: 'EGP', LK: 'LKR', MX: 'MXN',
};

/** The currency id a country should default to, or null when unmapped. */
export function defaultCurrencyIdFor(iso2: string): string | null {
  const iso = DEFAULT_CURRENCY_BY_COUNTRY[iso2];
  return iso ? CURRENCY_ID_BY_ISO.get(iso) ?? null : null;
}
