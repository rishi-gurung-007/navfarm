import { ConflictException, NotFoundException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedConsolidationService } from './feed-consolidation.service';

// Req r128: REVIEWED is a real step, DRAFT to REVIEWED, then REVIEWED to CONSOLIDATED.
describe('FeedConsolidationService.markReviewed', () => {
  let header: any;
  const set = jest.fn();
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self, where: () => self, limit: () => self, for: () => self,
      then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  const db: any = {
    select: jest.fn(() => chain(header ? [header] : [])),
    update: jest.fn(() => ({ set: (v: unknown) => { set(v); return { where: async () => undefined }; } })),
  };
  const service = new FeedConsolidationService(transactionCls(db), { listFarms: jest.fn(async () => [{ farmId: 'f1', companyId: 'co-1' }]) } as any, {} as any, undefined as any);
  const findOne = jest.spyOn(service, 'findOne').mockResolvedValue({ status: 'REVIEWED' } as any);

  beforeEach(() => { jest.clearAllMocks(); header = { consolidation_id: 'c1', consolidation_no: 'CONS-1', status: 'DRAFT', company_id: 'co-1' }; });

  it('moves a DRAFT sheet to REVIEWED', async () => {
    await service.markReviewed('c1', 't1', {} as any);
    expect(set).toHaveBeenCalledWith({ status: 'REVIEWED' });
    expect(findOne).toHaveBeenCalled();
  });

  it.each(['REVIEWED', 'CONSOLIDATED'])('refuses a %s sheet', async (status) => {
    header.status = status;
    await expect(service.markReviewed('c1', 't1', {} as any)).rejects.toBeInstanceOf(ConflictException);
    expect(set).not.toHaveBeenCalled();
  });

  it('404s a sheet of a company the caller cannot reach, writing nothing', async () => {
    header.company_id = 'co-other';
    await expect(service.markReviewed('c1', 't1', {} as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(set).not.toHaveBeenCalled();
  });

  it('404s an unknown sheet', async () => {
    header = null;
    await expect(service.markReviewed('c1', 't1', {} as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
