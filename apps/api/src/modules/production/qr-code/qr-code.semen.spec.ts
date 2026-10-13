import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { QrCodeService } from './qr-code.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import * as schema from '../../../core/database/schema';

describe('QrCodeService.createForSemenLot', () => {
  const queue: unknown[][] = [];
  const inserted: Array<{ table: unknown; values: any }> = [];
  const chain = (result: unknown[]) => {
    const self: any = {};
    for (const m of ['from', 'where', 'limit', 'orderBy']) self[m] = () => self;
    self.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
    return self;
  };
  const db = {
    select: jest.fn(() => ({ from: () => chain(queue.shift() ?? []) })),
    insert: jest.fn((table: unknown) => ({ values: (values: any) => { inserted.push({ table, values }); return Promise.resolve(); } })),
  };
  let service: QrCodeService;

  beforeEach(async () => {
    queue.length = 0; inserted.length = 0;
    const moduleRef = await Test.createTestingModule({
      providers: [
        QrCodeService,
        { provide: ClsService, useValue: { get: () => db } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        // Pack numbers come from the company's QR_PACK series (I3).
        { provide: NumberSeriesService, useValue: { generateNext: jest.fn().mockResolvedValue('PACK-000007') } },
      ],
    }).compile();
    service = moduleRef.get(QrCodeService);
  });

  it('prints the boar, his batch and the lot’s details — and not the cost — as an ordinary pack tied to the boar’s batch', async () => {
    queue.push(
      [{ breed_name: 'Large White' }], // breed
      [{ location_code: 'MUL100/STORE-001' }], // store
      [{ batch_id: 'b-boar', batch_no: 'BATCH-000001' }], // origin chain: the boar's batch
      [], // its input lines
    );

    const result = await service.createForSemenLot(
      {
        boar: { animal_id: 'boar-1', animal_code: 'BOAR-1', rfid_tag: 'RF-9', breed_id: 'br-1' } as any,
        boarBatch: { batch_id: 'b-boar', batch_no: 'BATCH-000001', company_id: 'co-1' } as any,
        item: { item_id: 'item-s', item_code: 'SEM-1', item_name: 'Boar semen dose' } as any,
        lotNo: 'LOT-00011',
        collectionDate: '2026-10-09',
        doses: 40,
        expiryDate: '2026-10-14',
        warehouseId: 'store-1',
      },
      'tenant-1',
      { userId: 'u1' },
    );

    expect(result.pack_no).toBe('PACK-000007');
    const row = inserted.find((i) => i.table === schema.qrCodeMaster)!.values;
    expect(row).toMatchObject({ batch_id: 'b-boar', item_id: 'item-s', lot_no: 'LOT-00011', pack_no: 'PACK-000007', production_date: '2026-10-09', expiry_date: '2026-10-14', net_weight: '40', pack_uom: 'DOSE', warehouse_id: 'store-1', breed: 'Large White' });
    expect(row.qr_data).toEqual({
      type: 'SEMEN_LOT', pack_no: 'PACK-000007', lot_no: 'LOT-00011', item_code: 'SEM-1', item_name: 'Boar semen dose',
      boar: { animal_code: 'BOAR-1', rfid_tag: 'RF-9', breed: 'Large White' }, batch_no: 'BATCH-000001',
      collection_date: '2026-10-09', doses: 40, expiry_date: '2026-10-14', facility_code: 'MUL100/STORE-001',
    });
    expect(JSON.stringify(row.qr_data)).not.toMatch(/cost/i);
  });
});
