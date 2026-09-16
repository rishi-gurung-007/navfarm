"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";

/**
 * The single place the app turns a money amount into text.
 *
 * Screens used to print `₹ ${n.toLocaleString("en-IN")}` inline, which bakes
 * one tenant's home currency into the UI. The currency is company
 * configuration: `company_master.base_currency_id` points at a row of
 * `currency_master`, which carries the symbol, whether it leads or trails the
 * number, and how many decimals it is quoted to. Read it, don't assume it.
 */
export interface CompanyCurrency {
  currency_id:      string;
  iso_code:         string;
  currency_name:    string;
  symbol:           string;
  symbol_position:  string;
  decimal_places:   number;
}

/**
 * Digit grouping is a property of the number's *audience*, and the only signal
 * the schema gives us is the currency itself — `currency_master` has no locale
 * column. India groups in lakhs/crores (1,00,000), the rest of the world in
 * thousands (100,000), so amounts keep rendering exactly as they do today for
 * an INR company and stop borrowing Indian grouping for anyone else.
 */
function groupingLocale(isoCode?: string): string {
  return isoCode === "INR" ? "en-IN" : "en-US";
}

/**
 * Format `amount` in the given currency. With no currency (not loaded yet, or
 * the company has none configured) the amount is still rendered — grouped,
 * unadorned — rather than guessing at a symbol that would then change under
 * the reader.
 */
export function formatMoney(amount: number | string | null | undefined, currency?: CompanyCurrency | null): string {
  const n = Number(amount) || 0;

  if (!currency?.symbol) {
    return n.toLocaleString(groupingLocale(), { maximumFractionDigits: 2 });
  }

  const decimals = Number.isFinite(Number(currency.decimal_places)) ? Number(currency.decimal_places) : 2;
  const text = n.toLocaleString(groupingLocale(currency.iso_code), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return currency.symbol_position === "SUFFIX" ? `${text} ${currency.symbol}` : `${currency.symbol} ${text}`;
}

/**
 * Resolves the active company's configured currency and hands back a bound
 * formatter. Both endpoints are the ones the console already uses for this
 * data — `/setup/wizard/company-details/:companyId` for the company record and
 * `/currency` for the master list — and both are tenant-scoped only, so this
 * works for every role, not just the ones that can read company settings.
 */
export function useCompanyCurrency(companyId?: string) {
  const [currency, setCurrency] = useState<CompanyCurrency | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const compId = companyId || getActiveCompanyId();
    if (!compId) { setReady(true); return; }

    (async () => {
      const [details, currencies] = await Promise.all([
        api.get(`/setup/wizard/company-details/${compId}`).catch(() => null),
        api.get("/currency").catch(() => []),
      ]);
      if (cancelled) return;

      const baseId = details?.company?.base_currency_id;
      const list: CompanyCurrency[] = Array.isArray(currencies)
        ? currencies
        : Array.isArray((currencies as any)?.data)
          ? (currencies as any).data
          : [];
      setCurrency(list.find((c) => c.currency_id === baseId) || null);
      setReady(true);
    })();

    return () => { cancelled = true; };
  }, [companyId]);

  const format = useCallback(
    (amount: number | string | null | undefined) => formatMoney(amount, currency),
    [currency],
  );

  return { currency, ready, formatMoney: format };
}
