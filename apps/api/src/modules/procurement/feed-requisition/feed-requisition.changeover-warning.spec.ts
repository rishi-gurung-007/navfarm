import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedRequisitionService } from './feed-requisition.service';

// Workbook checkpoint 5: the detail response carries a per-line silo changeover warning before approval; it never blocks.
function harness(approval: string, warning: string | null | Error) {
  const queues: unknown[][] = [
    [{ req: { requisition_id: 'req-1', company_id: 'co-1', farm_id: 'farm-1', approval_status: approval, status: approval, document_status: 'OPEN', production_date: '2026-10-12' }, farm_code: 'F1' }],
    [],
    [
      { line: { line_id: 'l1', line_seq: 1, item_id: 'feed-b', destination_location_id: 'silo-1', feed_type: 'BULK', quantity: '1000' }, destination_type: 'SILO', destination_code: 'SILO-1' },
      { line: { line_id: 'l2', line_seq: 2, item_id: 'feed-b', destination_location_id: 'store-1', feed_type: 'BAGGED', quantity: '1000' }, destination_type: 'STORE', destination_code: 'STORE-1' },
    ],
    [],
  ];
  const select = jest.fn(() => {
    const result = queues.shift() ?? [];
    const chain: any = {};
    for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy', 'groupBy']) chain[m] = () => chain;
    chain.then = (ok: any, fail: any) => Promise.resolve(result).then(ok, fail);
    return chain;
  });
  const db: any = { select };
  const changeoverWarning = jest.fn(async () => { if (warning instanceof Error) throw warning; return warning; });
  const feedSettings = { resolveForFeedPlanning: jest.fn(async () => ({})) };
  const service = new FeedRequisitionService(
    transactionCls(db), {} as any, {} as any, {} as any, { changeoverWarning } as any, {} as any, feedSettings as any,
  );
  jest.spyOn(service as any, 'readRequesterAndTransfers').mockResolvedValue({ requester_login: null, requester_department_name: null, linked_transfers: [] });
  jest.spyOn(service as any, 'activeBinAssignments').mockResolvedValue([]);
  jest.spyOn(service as any, 'scopeConditions').mockReturnValue([]);
  return { service, changeoverWarning };
}

describe('FeedRequisitionService.readView changeover warning', () => {
  it('puts the warning on a silo line before approval, and only asks for silo lines', async () => {
    const { service, changeoverWarning } = harness('PENDING_APPROVAL', "Silo 'SILO-1' still holds 500 of 'FEED-A'.");
    const view: any = await (service as any).readView('req-1', 't-1');
    expect(view.lines[0].changeover_warning).toMatch(/still holds/);
    expect(view.lines[1].changeover_warning).toBeNull();
    expect(changeoverWarning).toHaveBeenCalledTimes(1);
    expect(changeoverWarning).toHaveBeenCalledWith(expect.objectContaining({ siloId: 'silo-1', nextItemId: 'feed-b', companyId: 'co-1' }));
  });

  it('does not ask once the document is approved', async () => {
    const { service, changeoverWarning } = harness('APPROVED', 'x');
    const view: any = await (service as any).readView('req-1', 't-1');
    expect(changeoverWarning).not.toHaveBeenCalled();
    expect(view.lines[0].changeover_warning).toBeNull();
  });

  it('never fails the view when the warning cannot be computed', async () => {
    const { service } = harness('OPEN', new Error('ledger down'));
    const view: any = await (service as any).readView('req-1', 't-1');
    expect(view.lines[0].changeover_warning).toBeNull();
  });
});
