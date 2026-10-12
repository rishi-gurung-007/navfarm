/**
 * P1 follow-up fix round 1, I1. A transfer created by a requisition's Release
 * is posted from the requisition only. Its Transfer Receipt is the
 * requester's, and its Transfer Shipment belongs to the From department
 * (Rishi, 4 and 5 Oct). The four generic stock-transfer posting routes need
 * only INVENTORY/STOCK_TRANSFER edit, so on such a transfer they were a second
 * door around both rules.
 *
 * The guard runs in the controller handlers, not inside postShipment or
 * postReceipt, because RequisitionService.ship and receive call those methods
 * after making their own checks. A transfer is linked when any of its lines
 * carries a requisition_line_id, the same test update() already uses.
 */
import { BadRequestException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { StockTransferController } from './stock-transfer.controller';
import { StockTransferService } from './stock-transfer.service';

/** One queued select result: the linked-line lookup. */
function serviceWith(linkedRows: unknown[]) {
  const db: any = {
    select: jest.fn(() => {
      const chain: any = {};
      for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy']) chain[m] = () => chain;
      chain.then = (ok: any, err: any) => Promise.resolve(linkedRows).then(ok, err);
      return chain;
    }),
  };
  const service = new StockTransferService(transactionCls(db), {} as any, {} as any, {} as any, {} as any, {} as any);
  const posted = {
    post: jest.spyOn(service, 'post').mockResolvedValue({ ok: true } as any),
    postShipment: jest.spyOn(service, 'postShipment').mockResolvedValue({ ok: true } as any),
    postReceipt: jest.spyOn(service, 'postReceipt').mockResolvedValue({ ok: true } as any),
    postDirectTransfer: jest.spyOn(service, 'postDirectTransfer').mockResolvedValue({ ok: true } as any),
    update: jest.spyOn(service, 'update').mockResolvedValue({ ok: true } as any),
    remove: jest.spyOn(service, 'remove').mockResolvedValue({ ok: true } as any),
  };
  return { controller: new StockTransferController(service), posted };
}

const REQ = { user: { tenantId: 'tenant-1', userId: 'u-1' } };
const LINKED = [{ requisition_line_id: 'rl-1', transfer_no: 'TR-000040', req_no: 'RQ-00035' }];
const ROUTES: Array<[string, keyof ReturnType<typeof serviceWith>['posted'], (c: StockTransferController) => Promise<unknown>]> = [
  ['POST /stock-transfer/:id/post', 'post', (c) => c.post('tr-1', REQ)],
  ['POST /stock-transfer/:id/shipment', 'postShipment', (c) => c.shipment('tr-1', { lines: [] } as any, REQ)],
  ['POST /stock-transfer/:id/receipt', 'postReceipt', (c) => c.receipt('tr-1', { lines: [] } as any, REQ)],
  ['POST /stock-transfer/:id/direct-transfer', 'postDirectTransfer', (c) => c.directTransfer('tr-1', { lines: [] } as any, REQ)],
  // Phase 1 close: editing or cancelling a requisition's transfer would change
  // what the requisition ships and receives behind its back.
  ['PUT /stock-transfer/:id', 'update', (c) => c.update('tr-1', { remarks: 'x' } as any, REQ)],
  ['DELETE /stock-transfer/:id', 'remove', (c) => c.remove('tr-1', REQ)],
];

describe('generic stock-transfer posting, edit and cancel routes refuse a requisition\'s transfer', () => {
  it.each(ROUTES)('%s refuses a transfer linked to a requisition, and posts nothing', async (_route, method, call) => {
    const { controller, posted } = serviceWith(LINKED);
    await expect(call(controller)).rejects.toThrow(new BadRequestException(
      'Stock Transfer TR-000040 belongs to requisition RQ-00035; post its shipment and receipt from the requisition.',
    ));
    expect(posted[method]).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('%s still posts an ordinary transfer with no requisition lines', async (_route, method, call) => {
    const { controller, posted } = serviceWith([]);
    await call(controller);
    expect(posted[method]).toHaveBeenCalledTimes(1);
  });
});
