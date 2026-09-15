import { UomController } from './uom.controller';

/**
 * The master list contract (common/master-list-query.ts): `data` is the array
 * every existing caller already reads, and total/limit/offset are its siblings
 * in the envelope. The web table unwraps `res.data` and pages on `res.total`,
 * so nesting the whole {data,total} object under `data` renders zero rows.
 */
describe('UomController list envelope', () => {
  it('returns the conversion rows as data with total alongside, not nested under it', async () => {
    const rows = [{ conversion_id: 'c-1', from_uom: 'KG', to_uom: 'G' }];
    const uomService = {
      findAllConversions: jest.fn().mockResolvedValue({ data: rows, total: 7, limit: 50, offset: 0 }),
    } as any;

    const controller = new UomController(uomService);
    const res: any = await controller.findAllConversions({} as any, { user: { tenantId: 'tenant-1' } });

    expect(res.data).toBe(rows);
    expect(res.total).toBe(7);
    expect(res.limit).toBe(50);
    expect(res.offset).toBe(0);
  });
});
