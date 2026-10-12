import { OperationalAreaService } from './operational-area.service';
import { PreseedSource } from './dto/operational-area.dto';
import * as schema from '../../../core/database/schema';

/**
 * Client ruling, 12 Oct: an operational area never copies master data. It reads
 * its company's, filtered by its line of business. Whatever a client still
 * sends as preseed_source, the area is stored as NONE.
 */
describe('OperationalAreaService.create', () => {
  const dto = {
    company_id: 'company-1',
    nob_id: 'nob-1',
    lob_id: 'lob-1',
    area_code: 'pig1',
    area_name: 'Piggery 1',
  } as any;

  const build = () => {
    const inserted: Array<Record<string, unknown>> = [];
    const select = jest.fn(() => {
      const chain: any = { from: () => chain, where: () => chain, leftJoin: () => chain, limit: async () => [] };
      return chain;
    });
    const insert = jest.fn((table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === schema.operationalAreaMaster) inserted.push(values);
      },
    }));
    const db = { select, insert };
    const cls = { get: (key: string) => (key === 'tenantDb' ? db : key === 'tenantId' ? 'tenant-1' : undefined) } as any;
    const service = new OperationalAreaService(cls);
    // findOne runs after the insert; the stored row is what the test inspects.
    jest.spyOn(service, 'findOne').mockResolvedValue({ area_id: 'a' } as any);
    return { service, inserted };
  };

  it.each([[undefined], [PreseedSource.TENANT], [PreseedSource.COMPANY]])('stores NONE when the client sends %s', async (source) => {
    const { service, inserted } = build();
    await service.create({ ...dto, preseed_source: source }, 'user-1');
    expect(inserted).toHaveLength(1);
    expect(inserted[0].preseed_source).toBe(PreseedSource.NONE);
  });

  it('no longer exposes a tenant-template preseed operation', () => {
    expect((OperationalAreaService.prototype as any).preseedCompanyMasterDataFromTenant).toBeUndefined();
  });
});
