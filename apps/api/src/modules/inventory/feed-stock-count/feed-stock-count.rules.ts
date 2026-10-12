import { BadRequestException } from '@nestjs/common';

export type ResolvedRateEvidence = {
  status: 'RESOLVED';
  rateId: string | null;
  rate: number;
  rateDate: string | null;
  createdAt: string | null;
  scope: 'COMPANY' | 'LEGACY' | 'IDENTITY';
};

export type MissingRateEvidence = {
  status: 'MISSING_RATE';
  companyId: string;
  fromCurrencyId: string;
  toCurrencyId: string;
};

export type MissingLocalCurrencyEvidence = {
  status: 'MISSING_LOCAL_CURRENCY';
  companyId: string;
  baseCurrencyId: string;
};

export type RateEvidence = ResolvedRateEvidence | MissingRateEvidence | MissingLocalCurrencyEvidence;

export interface VarianceCurrencyEvidence {
  baseCurrencyId: string;
  localCurrencyId: string | null;
  rate: RateEvidence;
}

export interface VarianceFact {
  systemQty: number;
  countedQty: number;
  varianceQty: number;
  variancePctAbsolute: number;
  reasonRequired: boolean;
  monetary: {
    status: 'RESOLVED' | 'MISSING_COST' | 'MISSING_RATE' | 'MISSING_LOCAL_CURRENCY';
    unitCostBase: number | null;
    varianceValueBase: number | null;
    baseCurrencyId: string;
    localCurrencyId: string | null;
    rateId: string | null;
    rateSnapshot: RateEvidence;
    varianceValueLocal: number | null;
  };
}

const rounded = (value: number): number => Number(value.toFixed(6));
const detached = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function varianceFact(
  systemQty: number,
  countedQty: number,
  unitCostBase: number | null,
  currency: VarianceCurrencyEvidence,
): VarianceFact {
  if (!Number.isFinite(systemQty) || !Number.isFinite(countedQty) || countedQty < 0) {
    throw new BadRequestException('System quantity must be finite and counted quantity must be a finite, non-negative number.');
  }
  if (unitCostBase !== null && (!Number.isFinite(unitCostBase) || unitCostBase < 0)) {
    throw new BadRequestException('Unit cost must be a finite, non-negative number when available.');
  }

  const varianceQty = rounded(countedQty - systemQty);
  const variancePctAbsolute = systemQty === 0
    ? (varianceQty === 0 ? 0 : 100)
    : rounded(Math.abs(varianceQty) / Math.abs(systemQty) * 100);
  const rateSnapshot = detached(currency.rate);
  const varianceValueBase = unitCostBase === null ? null : rounded(varianceQty * unitCostBase);

  let status: VarianceFact['monetary']['status'] = 'RESOLVED';
  let varianceValueLocal: number | null = null;
  if (unitCostBase === null) {
    status = 'MISSING_COST';
  } else if (rateSnapshot.status === 'MISSING_RATE' || rateSnapshot.status === 'MISSING_LOCAL_CURRENCY') {
    status = rateSnapshot.status;
  } else {
    varianceValueLocal = rounded(varianceQty * unitCostBase * rateSnapshot.rate);
  }

  return {
    systemQty,
    countedQty,
    varianceQty,
    variancePctAbsolute,
    reasonRequired: varianceQty !== 0,
    monetary: {
      status,
      unitCostBase,
      varianceValueBase,
      baseCurrencyId: currency.baseCurrencyId,
      localCurrencyId: currency.localCurrencyId,
      rateId: rateSnapshot.status === 'RESOLVED' ? rateSnapshot.rateId : null,
      rateSnapshot,
      varianceValueLocal,
    },
  };
}

export function assertVarianceReason(fact: Pick<VarianceFact, 'reasonRequired'>, reasonId: string | null | undefined): void {
  if (fact.reasonRequired && !reasonId) {
    throw new BadRequestException('A scope-visible Reason Master row is required for every nonzero stock variance.');
  }
}

/** Which authority decides a submitted physical count. */
export type ApprovalRoute = 'FINANCE' | 'FARM_MANAGER';

export interface RouteLineEvidence {
  /** Absolute variance percentage as stored on the count line. */
  variancePctAbsolute: number;
  /** Signed base-currency value, or null when it could not be evaluated. */
  varianceValueBase: number | null;
}

/**
 * D21/Rishi: `variance percentage >= 5.00%` escalates to Finance; the monetary
 * threshold is company configuration and stays null until Triple C supplies it.
 * A null amount threshold is *not* a zero threshold, so it never triggers.
 *
 * When the amount threshold *is* configured, an unvalued line cannot be
 * compared against it. Silently treating that as "below threshold" would let a
 * possibly material variance reach a Farm Manager, so the decision is refused
 * until the cost, exchange rate and local currency are configured.
 */
export function approvalRoute(
  lines: RouteLineEvidence[],
  config: { percentageThreshold: number; amountThreshold: number | null },
): ApprovalRoute {
  const live = lines.filter((line) => Number(line.variancePctAbsolute) !== 0);
  if (live.some((line) => Math.abs(Number(line.variancePctAbsolute)) >= config.percentageThreshold)) {
    return 'FINANCE';
  }
  if (config.amountThreshold !== null) {
    if (live.some((line) => line.varianceValueBase === null || !Number.isFinite(Number(line.varianceValueBase)))) {
      throw new BadRequestException(
        'The company monetary variance threshold is configured but at least one variance has no valuation, '
        + 'so Finance escalation cannot be evaluated. Configure the item cost, exchange rate and local currency '
        + 'before deciding this count.',
      );
    }
    if (live.some((line) => Math.abs(Number(line.varianceValueBase)) >= config.amountThreshold!)) {
      return 'FINANCE';
    }
  }
  return 'FARM_MANAGER';
}
