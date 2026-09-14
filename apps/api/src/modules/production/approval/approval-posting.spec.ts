import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { ApprovalService } from './approval.service';
import { transactionCls } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';

describe('approval posting', () => {
  let request: any;
  let items: any[];
  let service: ApprovalService;
  let db: any;
  let batchService: any;
  let audit: any;
  let events: string[];
  let queries: any[];

  beforeEach(() => {
    request = { request_id: 'req', tenant_id: 'tenant', company_id: 'company',
      batch_id: 'batch', doc_type: 'UNSCHEDULED_HEALTH', doc_no: 'health', status: 'PENDING',
      item_or_stage: 'medicine', requested_qty: '12', uom: 'ML', justification: 'Date: 2026-09-14',
      submitted_at: '2026-09-14 08:00:00' };
    items = [{ item_id: 'medicine-id', uom: 'ML' }];
    events = [];
    queries = [];
    db = {
      transaction: jest.fn(async (work) => {
        const before = { ...request };
        try { return await work(db); }
        catch (error) { request = before; throw error; }
      }),
      select: () => ({ from: (table: unknown) => ({ where: (condition: any) => {
        queries.push({ table, ...new MySqlDialect().sqlToQuery(condition) });
        return {
          for: async () => {
            events.push(table === schema.approvalRequest ? 'lock-request' : 'lock-batch');
            return table === schema.approvalRequest ? [request] : [{ batch_id: 'batch', company_id: 'company' }];
          },
          limit: async () => items,
        };
      } }) }),
      update: jest.fn(() => ({ set: (values: any) => ({ where: async () => {
        events.push('decision');
        Object.assign(request, values);
      } }) })),
    };
    const cls = transactionCls(db);
    batchService = { addTransaction: jest.fn(async () => {
      expect(cls.get('tenantPostingTransaction')).toBe(true);
      events.push('post');
    }) };
    audit = { log: jest.fn(async () => { events.push('audit'); }) };
    service = new ApprovalService(cls, audit, batchService);
    jest.spyOn(service, 'findOne').mockImplementation(async () => ({ ...request }));
  });

  it('posts generic health approval inside the decision transaction after locking request and batch', async () => {
    await service.approve('req', 'tenant', { userId: 'user' });
    expect(events).toEqual(['lock-request', 'lock-batch', 'post', 'decision', 'audit']);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(batchService.addTransaction).toHaveBeenCalledWith('batch', expect.objectContaining({
      transaction_type: 'CONSUMPTION', item_id: 'medicine-id', quantity: 12,
      uom: 'ML', transaction_date: '2026-09-14',
    }), 'tenant', { userId: 'user' });
    const query = queries.find(q => q.table === schema.itemMaster);
    expect(query.sql).toContain('`company_id` = ?');
    expect(query.params).toContain('company');
    expect(query.params).toEqual(expect.arrayContaining(['MEDICINE', 'VACCINE']));
    expect(request.status).toBe('APPROVED');
  });

  it('uses the same posting path for batch-specific approval', async () => {
    await service.approveUnscheduledHealth('batch', 'req', 'tenant');
    expect(batchService.addTransaction).toHaveBeenCalledTimes(1);
    expect(request.status).toBe('APPROVED');
  });

  it('refuses the wrong batch without posting or recording a decision', async () => {
    await expect(service.approveUnscheduledHealth('other', 'req', 'tenant')).rejects.toThrow(/this batch/);
    expect(batchService.addTransaction).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not issue a second treatment on repeated approval', async () => {
    await service.approve('req', 'tenant');
    await expect(service.approve('req', 'tenant')).rejects.toThrow(/already approved/);
    expect(batchService.addTransaction).toHaveBeenCalledTimes(1);
  });

  it('keeps the request pending when stock posting fails', async () => {
    batchService.addTransaction.mockRejectedValue(new Error('Insufficient stock'));
    await expect(service.approve('req', 'tenant')).rejects.toThrow('Insufficient stock');
    expect(request.status).toBe('PENDING');
    expect(db.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it.each([{ matches: [] }, { matches: [{ item_id: 'one' }, { item_id: 'two' }] }])('refuses a missing or ambiguous company medicine: %j', async ({ matches }) => {
    items = matches;
    await expect(service.approve('req', 'tenant')).rejects.toThrow(/exactly one active item/);
    expect(batchService.addTransaction).not.toHaveBeenCalled();
    expect(request.status).toBe('PENDING');
  });

  it('approves an observation without issuing medicine', async () => {
    request.requested_qty = null;
    await service.approve('req', 'tenant');
    expect(batchService.addTransaction).not.toHaveBeenCalled();
    expect(request.status).toBe('APPROVED');
  });

  it.each(['VIAL', null])('refuses a changed or missing primary stock UOM: %s', async (uom) => {
    items = [{ item_id: 'medicine-id', uom }];
    await expect(service.approve('req', 'tenant')).rejects.toThrow(/must match the medicine stock unit/);
    expect(request.status).toBe('PENDING');
    expect(batchService.addTransaction).not.toHaveBeenCalled();
  });

  it('refuses a treatment request without its original stock UOM', async () => {
    request.uom = null;
    await expect(service.approve('req', 'tenant')).rejects.toThrow(/must match the medicine stock unit/);
    expect(batchService.addTransaction).not.toHaveBeenCalled();
  });

  it('preserves status-only approval for other document types', async () => {
    request.doc_type = 'FEED_RATION';
    await service.approve('req', 'tenant');
    expect(events).toEqual(['lock-request', 'decision', 'audit']);
    expect(batchService.addTransaction).not.toHaveBeenCalled();
  });

  it('locks rejection and refuses to approve the rejected request', async () => {
    await service.reject('req', { rejection_reason: 'Declined' }, 'tenant');
    expect(events).toEqual(['lock-request', 'decision', 'audit']);
    await expect(service.approve('req', 'tenant')).rejects.toThrow(/already rejected/);
    expect(batchService.addTransaction).not.toHaveBeenCalled();
  });

  it('rolls back the decision if the audit fails', async () => {
    audit.log.mockRejectedValue(new Error('audit failed'));
    await expect(service.approve('req', 'tenant')).rejects.toThrow('audit failed');
    expect(request.status).toBe('PENDING');
  });

  it('locks withdrawal and refuses to withdraw an approved request', async () => {
    await service.approve('req', 'tenant');
    const updatesBeforeWithdrawal = db.update.mock.calls.length;
    await expect(service.remove('req', 'tenant')).rejects.toThrow(/Only a pending request/);
    expect(events.at(-1)).toBe('lock-request');
    expect(db.update).toHaveBeenCalledTimes(updatesBeforeWithdrawal);
  });

  it('withdraws a pending request and audits it in one transaction', async () => {
    await expect(service.remove('req', 'tenant')).resolves.toEqual({ request_id: 'req', withdrawn: true });
    expect(events).toEqual(['lock-request', 'decision', 'audit']);
    expect(request.deleted_at).toBeDefined();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
