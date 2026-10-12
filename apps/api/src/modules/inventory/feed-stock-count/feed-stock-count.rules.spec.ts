import { BadRequestException } from '@nestjs/common';
import { assertVarianceReason, varianceFact } from './feed-stock-count.rules';

const currencies = (rate: any = {
  status: 'RESOLVED', rateId: 'rate-1', rate: 2, rateDate: '2026-10-01',
  createdAt: '2026-10-01 08:00:00', scope: 'COMPANY',
}) => ({ baseCurrencyId: 'base', localCurrencyId: 'local', rate });

describe('feed stock-count variance facts', () => {
  it('uses an explicit 100% result when system stock is zero and counted stock is nonzero', () => {
    const fact = varianceFact(0, 25, 4, currencies());
    expect(fact).toMatchObject({ varianceQty: 25, variancePctAbsolute: 100, reasonRequired: true });
  });

  it('uses zero percent when both system and counted stock are zero', () => {
    expect(varianceFact(0, 0, null, currencies())).toMatchObject({
      varianceQty: 0, variancePctAbsolute: 0, reasonRequired: false,
    });
  });

  it('uses the absolute system quantity as denominator when ledger evidence is negative', () => {
    expect(varianceFact(-100, 0, 4, currencies())).toMatchObject({
      varianceQty: 100, variancePctAbsolute: 100,
    });
  });

  it.each([
    { system: 100, counted: 120, qty: 20, pct: 20, base: 80, local: 160 },
    { system: 100, counted: 80, qty: -20, pct: 20, base: -80, local: -160 },
    { system: 100, counted: 95, qty: -5, pct: 5, base: -20, local: -40 },
  ])('keeps the signed quantity/value and absolute percentage for $qty KG', ({ system, counted, qty, pct, base, local }) => {
    const fact = varianceFact(system, counted, 4, currencies());
    expect(fact).toMatchObject({
      varianceQty: qty,
      variancePctAbsolute: pct,
      monetary: { status: 'RESOLVED', varianceValueBase: base, varianceValueLocal: local },
    });
  });

  it('requires a reason for every nonzero variance and not for zero', () => {
    const nonzero = varianceFact(100, 99, 4, currencies());
    expect(() => assertVarianceReason(nonzero, null)).toThrow(BadRequestException);
    expect(() => assertVarianceReason(nonzero, 'reason-1')).not.toThrow();
    expect(() => assertVarianceReason(varianceFact(100, 100, 4, currencies()), null)).not.toThrow();
  });

  it('returns typed missing-cost evidence without manufacturing monetary values', () => {
    expect(varianceFact(100, 95, null, currencies()).monetary).toEqual({
      status: 'MISSING_COST', unitCostBase: null, varianceValueBase: null,
      baseCurrencyId: 'base', localCurrencyId: 'local', rateId: 'rate-1',
      rateSnapshot: {
        status: 'RESOLVED', rateId: 'rate-1', rate: 2, rateDate: '2026-10-01',
        createdAt: '2026-10-01 08:00:00', scope: 'COMPANY',
      },
      varianceValueLocal: null,
    });
  });

  it('returns typed missing-rate evidence while preserving the available base valuation', () => {
    const rate = { status: 'MISSING_RATE', companyId: 'company-1', fromCurrencyId: 'base', toCurrencyId: 'local' };
    expect(varianceFact(100, 95, 4, currencies(rate)).monetary).toEqual({
      status: 'MISSING_RATE', unitCostBase: 4, varianceValueBase: -20,
      baseCurrencyId: 'base', localCurrencyId: 'local', rateId: null,
      rateSnapshot: rate, varianceValueLocal: null,
    });
  });

  it('returns typed missing-local-currency evidence rather than inventing a currency or rate', () => {
    const rate = { status: 'MISSING_LOCAL_CURRENCY', companyId: 'company-1', baseCurrencyId: 'base' } as const;
    expect(varianceFact(100, 95, 4, { baseCurrencyId: 'base', localCurrencyId: null, rate }).monetary).toEqual({
      status: 'MISSING_LOCAL_CURRENCY', unitCostBase: 4, varianceValueBase: -20,
      baseCurrencyId: 'base', localCurrencyId: null, rateId: null,
      rateSnapshot: rate, varianceValueLocal: null,
    });
  });

  it('uses identity rate one without a rate row when base and local currencies are equal', () => {
    const fact = varianceFact(100, 105, 3, {
      baseCurrencyId: 'same', localCurrencyId: 'same',
      rate: { status: 'RESOLVED', rateId: null, rate: 1, rateDate: null, createdAt: null, scope: 'IDENTITY' },
    });
    expect(fact.monetary).toMatchObject({
      status: 'RESOLVED', rateId: null, varianceValueBase: 15, varianceValueLocal: 15,
    });
  });

  it('detaches the selected rate snapshot so later master edits cannot rewrite the fact', () => {
    const selected = {
      status: 'RESOLVED' as const, rateId: 'rate-1', rate: 2, rateDate: '2026-10-01',
      createdAt: '2026-10-01 08:00:00', scope: 'COMPANY' as const,
    };
    const fact = varianceFact(100, 105, 3, currencies(selected));
    selected.rate = 99;
    expect(fact.monetary.rateSnapshot).toMatchObject({ rateId: 'rate-1', rate: 2 });
    expect(fact.monetary.varianceValueLocal).toBe(30);
  });
});
