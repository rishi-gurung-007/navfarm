import { ForbiddenException } from '@nestjs/common';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';
import { transactionCls } from '../../../test-utils/transaction-cls';

const updateDto = { rate: 2 };

describe('CurrencyController exchange-rate write scope', () => {
  it('passes the active company scope to update and delete routes', async () => {
    const service = {
      updateRate: jest.fn().mockResolvedValue({ rate_id: 'rate-1' }),
      deleteRate: jest.fn().mockResolvedValue({ rate_id: 'rate-1' }),
    };
    const controller = new CurrencyController(service as any);
    const request = {
      headers: { 'x-workspace-scope': 'COMPANY', 'x-active-company-id': 'co-1' },
      user: { userType: 'COMPANY_ADMIN', companyId: 'co-1' },
    };

    await (controller as any).updateRate('rate-1', updateDto, request);
    await (controller as any).deleteRate('rate-1', request);

    expect(service.updateRate).toHaveBeenCalledWith('rate-1', updateDto, { companyId: 'co-1', allowLegacyWrite: false });
    expect(service.deleteRate).toHaveBeenCalledWith('rate-1', { companyId: 'co-1', allowLegacyWrite: false });
  });

  it('rejects a non-administrator trying to mutate a legacy rate through tenant scope', async () => {
    const controller = new CurrencyController({ updateRate: jest.fn() } as any);
    await expect((controller as any).updateRate('legacy-rate', updateDto, {
      headers: { 'x-workspace-scope': 'TENANT' },
      user: { userType: 'OPERATIONAL_ADMIN', companyId: 'co-1' },
    })).rejects.toThrow(ForbiddenException);
  });
});

describe('CurrencyService exchange-rate write scope', () => {
  function databaseWithRate(rate: Record<string, unknown>) {
    const update = jest.fn(() => ({ set: () => ({ where: async () => undefined }) }));
    const remove = jest.fn(() => ({ where: async () => undefined }));
    const select = jest.fn(() => {
      const chain: any = { from: () => chain, where: () => chain, limit: async () => [rate] };
      return chain;
    });
    return { db: { select, update, delete: remove }, update, remove };
  }

  it('does not update or delete a rate owned by another company', async () => {
    const { db, update, remove } = databaseWithRate({ rate_id: 'rate-other', company_id: 'co-other', from_currency_id: 'base', to_currency_id: 'local' });
    const service = new CurrencyService(transactionCls(db));
    const scope = { companyId: 'co-1', allowLegacyWrite: false };

    await expect((service as any).updateRate('rate-other', updateDto, scope)).rejects.toThrow(ForbiddenException);
    await expect((service as any).deleteRate('rate-other', scope)).rejects.toThrow(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps legacy null-company rows read-only in company scope', async () => {
    const { db, update } = databaseWithRate({ rate_id: 'legacy', company_id: null, from_currency_id: 'base', to_currency_id: 'local' });
    const service = new CurrencyService(transactionCls(db));
    await expect((service as any).updateRate('legacy', updateDto, { companyId: 'co-1', allowLegacyWrite: false })).rejects.toThrow(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('allows a legacy row only under the explicit tenant-administration scope', async () => {
    const { db, update } = databaseWithRate({ rate_id: 'legacy', company_id: null, from_currency_id: 'base', to_currency_id: 'local' });
    const service = new CurrencyService(transactionCls(db));
    await expect((service as any).updateRate('legacy', updateDto, { companyId: null, allowLegacyWrite: true })).resolves.toEqual(expect.objectContaining({ rate_id: 'legacy' }));
    expect(update).toHaveBeenCalledTimes(1);
  });
});
