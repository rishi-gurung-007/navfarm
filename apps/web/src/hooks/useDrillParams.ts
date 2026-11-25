'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

/** The filters a GM Dashboard link arrives with (built by gm-drill-links); a bad or absent value is left empty. */
export interface DrillParams {
  farmId: string;
  from: string;
  to: string;
  status: string;
  salesOnly: boolean;
  accounts: string[];
}

const FARM_ID = /^[A-Za-z0-9-]{1,36}$/;
const STATUS = /^[A-Z_]+$/;
const ACCOUNT = /^\d{3,10}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const matching = (value: string | null, pattern: RegExp) =>
  value && pattern.test(value) ? value : '';

/** A real YYYY-MM-DD day: 30 February would roll over into March, so it must survive the round trip. */
const day = (value: string | null) => {
  const text = matching(value, DATE);
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(text)
    ? text
    : '';
};

export function parseDrillParams(q: {
  get(name: string): string | null;
}): DrillParams {
  return {
    farmId: matching(q.get('farmId'), FARM_ID),
    from: day(q.get('from')),
    to: day(q.get('to')),
    status: matching(q.get('status'), STATUS),
    salesOnly: q.get('salesOnly') === 'true',
    accounts: (q.get('accounts') ?? '').split(',').filter((a) => ACCOUNT.test(a)),
  };
}

/** The values the page was opened with. Frozen, so they only seed the page's own filters, which stay editable. */
export function useDrillParams(): DrillParams {
  const searchParams = useSearchParams();
  const [params] = useState(() => parseDrillParams(searchParams));
  return params;
}
