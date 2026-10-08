import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedRequisitionService } from './feed-requisition.service';

function serviceHarness() {
  const db: any = { transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db) };
  const forecast = { withFarmScope: jest.fn((_farm: string, _company: string, work: () => unknown) => work()) };
  const stockTransfers = {
    postShipment: jest.fn().mockResolvedValue({ shipment_id: 'shipment-1' }),
    postReceipt: jest.fn().mockResolvedValue({ receipt_id: 'receipt-1' }),
  };
  const service = new FeedRequisitionService(
    transactionCls(db), forecast as any, { registerDocumentHandler: jest.fn() } as any,
    {} as any, {} as any, {} as any, {} as any, stockTransfers as any,
  );
  jest.spyOn(service as any, 'resolveOwnFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'co-1' });
  jest.spyOn(service as any, 'assertMayShip').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'readView').mockResolvedValue({ requisition_id: 'req-1', fulfilment_status: 'PARTIALLY_SHIPPED' });
  jest.spyOn(service as any, 'linkedTransferForExecution').mockResolvedValue({
    transfer: { transfer_id: 'tr-1', company_id: 'co-1', from_warehouse_id: 'bin-1', to_warehouse_id: 'silo-1', destination_farm_id: 'farm-1', destination_parent_id: 'farm-1' },
    lines: [
      { transfer_line_id: 'tl-1', requisition_line_id: 'rl-1' },
      { transfer_line_id: 'tl-2', requisition_line_id: 'rl-2' },
    ],
  });
  return { service, stockTransfers };
}

describe('FeedRequisitionService transfer execution', () => {
  it('ships only a transfer linked to this requisition and maps requisition lines to its transfer lines', async () => {
    const { service, stockTransfers } = serviceHarness();
    await service.shipment('req-1', {
      transfer_id: 'tr-1', posting_date: '2026-10-11',
      lines: [{ requisition_line_id: 'rl-2', quantity: 1250 }],
    }, 'tenant-1', { userId: 'u-1' });
    expect(stockTransfers.postShipment).toHaveBeenCalledWith('tr-1', {
      posting_date: '2026-10-11', lines: [{ line_id: 'tl-2', quantity: 1250 }],
    }, 'tenant-1', expect.objectContaining({ userId: 'u-1' }), true);
  });

  it('refuses a requisition line that does not belong to the selected linked transfer', async () => {
    const { service, stockTransfers } = serviceHarness();
    await expect(service.shipment('req-1', {
      transfer_id: 'tr-1', posting_date: '2026-10-11',
      lines: [{ requisition_line_id: 'rl-foreign', quantity: 1 }],
    }, 'tenant-1', { userId: 'u-1' })).rejects.toThrow("Requisition line 'rl-foreign' is not part of transfer tr-1");
    expect(stockTransfers.postShipment).not.toHaveBeenCalled();
  });

  it('receives against the selected shipment and maps the same line identities', async () => {
    const { service, stockTransfers } = serviceHarness();
    await service.receipt('req-1', {
      transfer_id: 'tr-1', shipment_id: 'shipment-1', posting_date: '2026-10-12',
      lines: [{ requisition_line_id: 'rl-1', quantity: 500 }],
    }, 'tenant-1', { userId: 'u-2' });
    expect(stockTransfers.postReceipt).toHaveBeenCalledWith('tr-1', {
      shipment_id: 'shipment-1', posting_date: '2026-10-12', lines: [{ line_id: 'tl-1', quantity: 500 }],
    }, 'tenant-1', expect.objectContaining({ userId: 'u-2' }), true);
  });

  it('refuses receipt when the selected transfer destination is outside the requisition farm', async () => {
    const { service, stockTransfers } = serviceHarness();
    jest.spyOn(service as any, 'linkedTransferForExecution').mockResolvedValue({
      transfer: { transfer_id: 'tr-1', company_id: 'co-1', to_warehouse_id: 'silo-2', destination_farm_id: 'farm-2', destination_parent_id: 'farm-2' },
      lines: [{ transfer_line_id: 'tl-1', requisition_line_id: 'rl-1' }],
    });
    await expect(service.receipt('req-1', {
      transfer_id: 'tr-1', shipment_id: 'shipment-1', posting_date: '2026-10-12',
      lines: [{ requisition_line_id: 'rl-1', quantity: 1 }],
    }, 'tenant-1', { userId: 'u-2' })).rejects.toThrow('destination is outside requisition farm farm-1');
    expect(stockTransfers.postReceipt).not.toHaveBeenCalled();
  });

  it('returns independent balances and open shipments for multiple linked transfers', async () => {
    const queues: unknown[][] = [
      [
        { transfer_id: 'tr-1', transfer_no: 'TR-1', status: 'IN_TRANSIT' },
        { transfer_id: 'tr-2', transfer_no: 'TR-2', status: 'DRAFT' },
      ],
      [
        { transfer_line_id: 'tl-1', transfer_id: 'tr-1', requisition_line_id: 'rl-1', item_id: 'feed-1', quantity: '10', uom: 'KG' },
        { transfer_line_id: 'tl-2', transfer_id: 'tr-2', requisition_line_id: 'rl-2', item_id: 'feed-2', quantity: '20', uom: 'KG' },
      ],
      [{ line_id: 'tl-1', quantity: '6' }],
      [{ line_id: 'tl-1', quantity: '2' }],
      [{ shipment_id: 'sh-1', transfer_id: 'tr-1', shipment_no: 'SH-1', shipment_date: '2026-10-11' }],
      [{ shipment_id: 'sh-1', line_id: 'tl-1', quantity: '6' }],
      [{ shipment_id: 'sh-1', line_id: 'tl-1', quantity: '2' }],
    ];
    const db: any = { select: jest.fn(() => {
      const result = queues.shift() ?? [];
      const chain: any = {};
      for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy']) chain[method] = () => chain;
      chain.then = (ok: any, fail: any) => Promise.resolve(result).then(ok, fail);
      return chain;
    }) };
    const service = new FeedRequisitionService(
      transactionCls(db), {} as any, { registerDocumentHandler: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );

    const transfers = await (service as any).readTransferViews('req-1', 'tenant-1');

    expect(transfers[0].lines[0]).toEqual(expect.objectContaining({ qty_shipped: 6, qty_received: 2, balance_to_ship: 4, remaining_to_receive: 4 }));
    expect(transfers[0].open_shipments[0].lines[0]).toEqual(expect.objectContaining({ remaining_to_receive: 4 }));
    expect(transfers[1].lines[0]).toEqual(expect.objectContaining({ qty_shipped: 0, qty_received: 0, balance_to_ship: 20 }));
  });
});
