import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedRequisitionService } from './feed-requisition.service';

function serviceHarness() {
  const db: any = {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const forecast = {
    withFarmScope: jest.fn(
      (_farm: string, _company: string, work: () => unknown) => work(),
    ),
  };
  const stockTransfers = {
    postShipment: jest.fn().mockResolvedValue({ shipment_id: 'shipment-1' }),
    postReceipt: jest.fn().mockResolvedValue({ receipt_id: 'receipt-1' }),
  };
  const feedAlerts = {
    raiseEventSafely: jest.fn().mockResolvedValue(undefined),
  };
  const service = new FeedRequisitionService(
    transactionCls(db),
    forecast as any,
    { registerDocumentHandler: jest.fn() } as any,
    feedAlerts as any,
    {} as any,
    {} as any,
    {} as any,
    stockTransfers as any,
  );
  jest
    .spyOn(service as any, 'resolveOwnFarm')
    .mockResolvedValue({ farmId: 'farm-1', companyId: 'co-1' });
  jest.spyOn(service as any, 'assertMayShip').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'readView').mockResolvedValue({
    requisition_id: 'req-1',
    fulfilment_status: 'PARTIALLY_SHIPPED',
  });
  jest.spyOn(service as any, 'linkedTransferForExecution').mockResolvedValue({
    transfer: {
      transfer_id: 'tr-1',
      company_id: 'co-1',
      from_warehouse_id: 'bin-1',
      to_warehouse_id: 'silo-1',
      destination_farm_id: 'farm-1',
      destination_parent_id: 'farm-1',
    },
    lines: [
      { transfer_line_id: 'tl-1', requisition_line_id: 'rl-1' },
      { transfer_line_id: 'tl-2', requisition_line_id: 'rl-2' },
    ],
  });
  return { service, stockTransfers, feedAlerts };
}

describe('FeedRequisitionService transfer execution', () => {
  it('ships only a transfer linked to this requisition and maps requisition lines to its transfer lines', async () => {
    const { service, stockTransfers } = serviceHarness();
    await service.shipment(
      'req-1',
      {
        transfer_id: 'tr-1',
        posting_date: '2026-10-11',
        lines: [{ requisition_line_id: 'rl-2', quantity: 1250 }],
      },
      'tenant-1',
      { userId: 'u-1' },
    );
    expect(stockTransfers.postShipment).toHaveBeenCalledWith(
      'tr-1',
      {
        posting_date: '2026-10-11',
        lines: [{ line_id: 'tl-2', quantity: 1250 }],
      },
      'tenant-1',
      expect.objectContaining({ userId: 'u-1' }),
      true,
    );
  });

  it('refuses a requisition line that does not belong to the selected linked transfer', async () => {
    const { service, stockTransfers } = serviceHarness();
    await expect(
      service.shipment(
        'req-1',
        {
          transfer_id: 'tr-1',
          posting_date: '2026-10-11',
          lines: [{ requisition_line_id: 'rl-foreign', quantity: 1 }],
        },
        'tenant-1',
        { userId: 'u-1' },
      ),
    ).rejects.toThrow(
      "Requisition line 'rl-foreign' is not part of transfer tr-1",
    );
    expect(stockTransfers.postShipment).not.toHaveBeenCalled();
  });

  it('receives against the selected shipment and maps the same line identities', async () => {
    const { service, stockTransfers } = serviceHarness();
    const controls = { bagSizeKg: 50, lines: new Map() };
    jest
      .spyOn(service as any, 'feedReceiptControls')
      .mockResolvedValue(controls);
    await service.receipt(
      'req-1',
      {
        transfer_id: 'tr-1',
        shipment_id: 'shipment-1',
        posting_date: '2026-10-12',
        lines: [{ requisition_line_id: 'rl-1', quantity: 500 }],
      },
      'tenant-1',
      { userId: 'u-2' },
    );
    expect(stockTransfers.postReceipt).toHaveBeenCalledWith(
      'tr-1',
      {
        shipment_id: 'shipment-1',
        posting_date: '2026-10-12',
        lines: [{ line_id: 'tl-1', quantity: 500 }],
      },
      'tenant-1',
      expect.objectContaining({ userId: 'u-2' }),
      true,
      controls,
    );
  });

  it('W2T: passes the receipt controls through and returns the receipt no., variance and silo balance after', async () => {
    const { service, stockTransfers } = serviceHarness();
    jest
      .spyOn(service as any, 'feedReceiptControls')
      .mockResolvedValue({ bagSizeKg: 50, lines: new Map() });
    stockTransfers.postReceipt.mockResolvedValue({
      receipt_id: 'receipt-1',
      receipt_no: 'RC-2026-0007',
      transfer_id: 'tr-1',
      lines: [
        {
          line_id: 'tl-1',
          qty_received: 5900,
          qty_shipped: 6000,
          previously_received: 0,
          variance_qty: 100,
          silo_balance_after: 7400,
        },
      ],
    });
    const out: any = await service.receipt(
      'req-1',
      {
        transfer_id: 'tr-1',
        shipment_id: 'shipment-1',
        posting_date: '2026-10-12',
        lines: [
          {
            requisition_line_id: 'rl-1',
            quantity: 5900,
            variance_reason: 'Spillage',
            bag_count: undefined,
            delivery_note_no: 'MILL-DN-0042',
          },
        ],
      },
      'tenant-1',
      { userId: 'u-2' },
    );
    expect(stockTransfers.postReceipt.mock.calls[0][1].lines).toEqual([
      {
        line_id: 'tl-1',
        quantity: 5900,
        variance_reason: 'Spillage',
        delivery_note_no: 'MILL-DN-0042',
      },
    ]);
    expect(out.receipt).toEqual({
      receipt_id: 'receipt-1',
      receipt_no: 'RC-2026-0007',
      transfer_id: 'tr-1',
      shipment_id: 'shipment-1',
      lines: [
        expect.objectContaining({
          requisition_line_id: 'rl-1',
          variance_qty: 100,
          silo_balance_after: 7400,
        }),
      ],
    });
  });

  it('W4G1: a short receipt raises RECEIPT_VARIANCE once; a full one raises nothing', async () => {
    const { service, stockTransfers, feedAlerts } = serviceHarness();
    jest
      .spyOn(service as any, 'feedReceiptControls')
      .mockResolvedValue({ bagSizeKg: 50, lines: new Map() });
    const dto: any = {
      transfer_id: 'tr-1',
      shipment_id: 'shipment-1',
      posting_date: '2026-10-12',
      lines: [{ requisition_line_id: 'rl-1', quantity: 5900 }],
    };
    stockTransfers.postReceipt.mockResolvedValueOnce({
      receipt_id: 'receipt-1',
      receipt_no: 'RC-1',
      transfer_id: 'tr-1',
      lines: [{ line_id: 'tl-1', variance_qty: 100 }],
    });
    await service.receipt('req-1', dto, 'tenant-1', { userId: 'u-2' });
    expect(feedAlerts.raiseEventSafely).toHaveBeenCalledTimes(1);
    expect(feedAlerts.raiseEventSafely.mock.calls[0][0]).toEqual({
      farmId: 'farm-1',
      companyId: 'co-1',
      tenantId: 'tenant-1',
    });
    expect(feedAlerts.raiseEventSafely.mock.calls[0][1]).toMatchObject({
      eventType: 'RECEIPT_VARIANCE',
      subjectType: 'RECEIPT',
      subjectId: 'receipt-1',
      observedValue: 100,
    });
    // Rishi, 11 Oct: any short receipt raises it, so the text must not claim a "final" receipt.
    const message = String(
      (feedAlerts.raiseEventSafely.mock.calls[0][1] as { message: string })
        .message,
    );
    expect(message).toContain('RC-1');
    expect(message).not.toMatch(/final/i);
    feedAlerts.raiseEventSafely.mockClear();
    stockTransfers.postReceipt.mockResolvedValueOnce({
      receipt_id: 'receipt-2',
      receipt_no: 'RC-2',
      transfer_id: 'tr-1',
      lines: [
        { line_id: 'tl-1', variance_qty: 0 },
        { line_id: 'tl-2', variance_qty: null },
      ],
    });
    await service.receipt('req-1', dto, 'tenant-1', { userId: 'u-2' });
    expect(feedAlerts.raiseEventSafely).not.toHaveBeenCalled();
  });

  it('W2T: builds controls from the line feed type, the farm bag size and the loading sheet of this shipment', async () => {
    const queues: unknown[][] = [
      [
        { line_id: 'rl-1', line_seq: 1, feed_type: 'BULK' },
        { line_id: 'rl-2', line_seq: 2, feed_type: 'BAGGED' },
      ],
      [
        {
          requisition_line_id: 'rl-1',
          loading_sheet_id: 'ls-old',
          loading_sheet_no: 'LOAD-OLD',
          shipment_id: 'shipment-0',
        },
        {
          requisition_line_id: 'rl-1',
          loading_sheet_id: 'ls-1',
          loading_sheet_no: 'LOAD-1',
          shipment_id: 'shipment-1',
        },
      ],
    ];
    const db: any = {
      select: jest.fn(() => {
        const result = queues.shift() ?? [];
        const chain: any = {};
        for (const method of [
          'from',
          'innerJoin',
          'leftJoin',
          'where',
          'groupBy',
        ])
          chain[method] = () => chain;
        chain.then = (ok: any, fail: any) =>
          Promise.resolve(result).then(ok, fail);
        return chain;
      }),
    };
    const feedSettings = {
      resolveForFeedPlanning: jest.fn().mockResolvedValue({
        bulkMultipleKg: 3000,
        bagSizeKg: 25,
        truckTargetKg: 30000,
        productionWeekday: 0,
        safetyStockKg: 0,
      }),
    };
    const service = new FeedRequisitionService(
      transactionCls(db),
      {} as any,
      { registerDocumentHandler: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      feedSettings as any,
      {} as any,
    );
    const controls = await (service as any).feedReceiptControls(
      [
        { transfer_line_id: 'tl-1', requisition_line_id: 'rl-1' },
        { transfer_line_id: 'tl-2', requisition_line_id: 'rl-2' },
      ],
      'shipment-1',
      'co-1',
      'farm-1',
    );
    expect(feedSettings.resolveForFeedPlanning).toHaveBeenCalledWith(
      'co-1',
      'farm-1',
    );
    expect(controls.bagSizeKg).toBe(25);
    expect(controls.lines.get('tl-1')).toEqual({
      label: 'Line 1',
      feedType: 'BULK',
      loadingSheetId: 'ls-1',
      loadingSheetNo: 'LOAD-1',
    });
    expect(controls.lines.get('tl-2')).toEqual({
      label: 'Line 2',
      feedType: 'BAGGED',
      loadingSheetId: null,
      loadingSheetNo: null,
    });
  });

  it('refuses receipt when the selected transfer destination is outside the requisition farm', async () => {
    const { service, stockTransfers } = serviceHarness();
    jest.spyOn(service as any, 'linkedTransferForExecution').mockResolvedValue({
      transfer: {
        transfer_id: 'tr-1',
        company_id: 'co-1',
        to_warehouse_id: 'silo-2',
        destination_farm_id: 'farm-2',
        destination_parent_id: 'farm-2',
      },
      lines: [{ transfer_line_id: 'tl-1', requisition_line_id: 'rl-1' }],
    });
    await expect(
      service.receipt(
        'req-1',
        {
          transfer_id: 'tr-1',
          shipment_id: 'shipment-1',
          posting_date: '2026-10-12',
          lines: [{ requisition_line_id: 'rl-1', quantity: 1 }],
        },
        'tenant-1',
        { userId: 'u-2' },
      ),
    ).rejects.toThrow('destination is outside requisition farm farm-1');
    expect(stockTransfers.postReceipt).not.toHaveBeenCalled();
  });

  it('returns independent balances and open shipments for multiple linked transfers', async () => {
    const queues: unknown[][] = [
      [
        { transfer_id: 'tr-1', transfer_no: 'TR-1', status: 'IN_TRANSIT' },
        { transfer_id: 'tr-2', transfer_no: 'TR-2', status: 'DRAFT' },
      ],
      [
        {
          transfer_line_id: 'tl-1',
          transfer_id: 'tr-1',
          requisition_line_id: 'rl-1',
          item_id: 'feed-1',
          quantity: '10',
          uom: 'KG',
        },
        {
          transfer_line_id: 'tl-2',
          transfer_id: 'tr-2',
          requisition_line_id: 'rl-2',
          item_id: 'feed-2',
          quantity: '20',
          uom: 'KG',
        },
      ],
      [{ line_id: 'tl-1', quantity: '6' }],
      [{ line_id: 'tl-1', quantity: '2' }],
      [
        {
          shipment_id: 'sh-1',
          transfer_id: 'tr-1',
          shipment_no: 'SH-1',
          shipment_date: '2026-10-11',
        },
      ],
      [{ shipment_id: 'sh-1', line_id: 'tl-1', quantity: '6' }],
      [{ shipment_id: 'sh-1', line_id: 'tl-1', quantity: '2' }],
      [
        {
          requisition_line_id: 'rl-1',
          loading_sheet_id: 'ls-1',
          loading_sheet_no: 'LOAD-1',
          compartment_no: '1 and 2',
          shipment_id: 'sh-1',
        },
      ],
      [
        {
          loading_sheet_id: 'ls-1',
          compartment_no: 'C1',
          kg_loaded: '3.0000',
          loaded_by: 'loader-1',
          line_no: 10000,
        },
        {
          loading_sheet_id: 'ls-1',
          compartment_no: 'C2',
          kg_loaded: '3.0000',
          loaded_by: 'loader-1',
          line_no: 20000,
        },
      ],
    ];
    const db: any = {
      select: jest.fn(() => {
        const result = queues.shift() ?? [];
        const chain: any = {};
        for (const method of [
          'from',
          'innerJoin',
          'leftJoin',
          'where',
          'groupBy',
        ])
          chain[method] = () => chain;
        chain.then = (ok: any, fail: any) =>
          Promise.resolve(result).then(ok, fail);
        return chain;
      }),
    };
    const service = new FeedRequisitionService(
      transactionCls(db),
      {} as any,
      { registerDocumentHandler: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const transfers = await (service as any).readTransferViews(
      'req-1',
      'tenant-1',
    );

    expect(transfers[0].lines[0]).toEqual(
      expect.objectContaining({
        qty_shipped: 6,
        qty_received: 2,
        balance_to_ship: 4,
        remaining_to_receive: 4,
      }),
    );
    expect(transfers[0].open_shipments[0].lines[0]).toEqual(
      expect.objectContaining({
        requisition_line_id: 'rl-1',
        remaining_to_receive: 4,
        // W2T, Requisition row 148: the compartment from the loading sheet.
        loading_sheet_no: 'LOAD-1',
        compartment_no: '1 and 2',
        compartments: [
          { compartment_no: 'C1', kg_loaded: 3, loaded_by: 'loader-1' },
          { compartment_no: 'C2', kg_loaded: 3, loaded_by: 'loader-1' },
        ],
        loading_total_kg: 6,
      }),
    );
    expect(transfers[1].lines[0]).toEqual(
      expect.objectContaining({
        qty_shipped: 0,
        qty_received: 0,
        balance_to_ship: 20,
      }),
    );
  });
});
