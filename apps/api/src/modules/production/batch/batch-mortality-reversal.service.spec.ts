import { transactionCls } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { BatchMortalityReversalService } from './batch-mortality-reversal.service';

/** C7: a death recorded in error is reversed — the animal named comes back and everything the death posted goes back. */
describe('BatchMortalityReversalService', () => {
  const rows = new Map<unknown, unknown[]>();
  const inserted: Array<{ table: unknown; values: any }> = [];
  const updated: Array<{ table: unknown; set: any }> = [];
  const chain = (result: unknown[]) => {
    const self: any = {
      from: (table: unknown) => chain(rows.get(table) ?? []),
      where: () => self, limit: () => self, orderBy: () => self, for: () => self, innerJoin: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };
  const db: any = {
    select: () => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }),
    insert: (table: unknown) => ({ values: (values: any) => { inserted.push({ table, values }); return Promise.resolve(); } }),
    update: (table: unknown) => ({ set: (set: any) => { updated.push({ table, set }); return { where: () => Promise.resolve() }; } }),
  };
  const gl = { findBatchCostJournal: jest.fn(), reverseJournal: jest.fn() };
  const schedulers = { syncAnimalWiseCounts: jest.fn() };
  const movement = { record: jest.fn() };
  const audit = { log: jest.fn() };
  let service: BatchMortalityReversalService;

  const batch = { batch_id: 'b-1', batch_no: 'BATCH-000005', company_id: 'co', status: 'ACTIVE', costing_method: 'BIO_ASSET', tracking_mode: 'ANIMAL_WISE', stage_id: null };
  const death = { transaction_id: 't-1', batch_id: 'b-1', transaction_type: 'MORTALITY', quantity: '1.0000', amount: '-943.0000', transaction_date: '2026-10-09', animal_id: 'a-1', reversed_at: null };
  const deadSow = { animal_id: 'a-1', animal_code: 'PIG-0024', is_active: false, disposal_type: 'DIED', current_batch_id: 'b-1', current_stage_id: 'st-gest', current_location_id: 'pen-1' };
  const ownRow = { entry_id: 'e-own', animal_id: 'a-1', batch_id: null, entry_type: 'MORTALITY', quantity: '-1.0000', cost_amount: '-28000.0000', status: 'DEAD' };

  beforeEach(() => {
    rows.clear(); inserted.length = 0; updated.length = 0;
    gl.findBatchCostJournal.mockReset().mockResolvedValue({ journal_id: 'j-1' });
    gl.reverseJournal.mockReset().mockResolvedValue({});
    schedulers.syncAnimalWiseCounts.mockReset();
    movement.record.mockReset();
    audit.log.mockReset();
    rows.set(schema.batchHeader, [batch]);
    rows.set(schema.batchTransaction, [death]);
    rows.set(schema.animalRegister, [deadSow]);
    rows.set(schema.bioAssetLedger, [ownRow]);
    rows.set(schema.batchBioAssetState, [{ current_quantity: '3', nca_book_value: '2829' }]);
    service = new BatchMortalityReversalService(transactionCls(db), gl as any, schedulers as any, movement as any, audit as any);
  });

  it('brings the animal back and puts back everything the death posted', async () => {
    const result = await service.reverse('b-1', 't-1', 'Recorded against the wrong sow', 'tenant', 'u-1');

    expect(result).toMatchObject({ animal_code: 'PIG-0024', quantity: 1, write_off_reversed: 943 });
    expect(updated.find((u) => u.table === schema.animalRegister)?.set).toMatchObject({ is_active: true, status: 'ACTIVE', disposal_type: null, disposal_date: null });
    // Her own value back into her ledger, and the batch's share back into the batch.
    const opposites = inserted.filter((i) => i.table === schema.bioAssetLedger).map((i) => i.values);
    expect(opposites).toEqual(expect.arrayContaining([expect.objectContaining({ quantity: '1', cost_amount: '28000' })]));
    expect(gl.findBatchCostJournal).toHaveBeenCalledWith(expect.objectContaining({ documentNo: 'BATCH-000005', postingDate: '2026-10-09', amount: 943, description: 'Mortality — BATCH-000005' }));
    expect(gl.reverseJournal).toHaveBeenCalledWith('j-1', '2026-10-09', 'Mortality — BATCH-000005', 'u-1');
    expect(updated.find((u) => u.table === schema.batchBioAssetState)?.set).toMatchObject({ current_quantity: '4', nca_book_value: '3772' });
    expect(movement.record).toHaveBeenCalledWith(expect.objectContaining({ animalId: 'a-1', movementType: 'MORTALITY_REVERSED', toBatchId: 'b-1' }));
    expect(schedulers.syncAnimalWiseCounts).toHaveBeenCalledWith('b-1');
    expect(updated.find((u) => u.table === schema.batchTransaction)?.set).toMatchObject({ reversed_by: 'u-1' });
  });

  it('asks for a reason, and will not reverse a death twice', async () => {
    await expect(service.reverse('b-1', 't-1', '  ', 'tenant')).rejects.toThrow('Give the reason');
    rows.set(schema.batchTransaction, [{ ...death, reversed_at: '2026-10-09 10:00:00' }]);
    await expect(service.reverse('b-1', 't-1', 'again', 'tenant')).rejects.toThrow('already been reversed');
    expect(updated).toHaveLength(0);
  });

  it('refuses when the animal is not recorded as dead in this batch', async () => {
    rows.set(schema.animalRegister, [{ ...deadSow, is_active: true, disposal_type: null }]);
    await expect(service.reverse('b-1', 't-1', 'mistake', 'tenant')).rejects.toThrow('is not recorded as having died');
    expect(gl.reverseJournal).not.toHaveBeenCalled();
  });

  it('changes nothing when the write-off journal cannot be found', async () => {
    gl.findBatchCostJournal.mockResolvedValue(null);
    await expect(service.reverse('b-1', 't-1', 'mistake', 'tenant')).rejects.toThrow('could not be found');
    // The whole reversal is one transaction: the caller's rollback takes the animal's update back with it.
    expect(updated.find((u) => u.table === schema.batchTransaction)).toBeUndefined();
  });

  it('gives a head-count batch its head back at its stage', async () => {
    rows.set(schema.batchHeader, [{ ...batch, tracking_mode: 'BATCH_WISE', costing_method: 'STANDARD', stage_id: 'st-w' }]);
    rows.set(schema.batchTransaction, [{ ...death, animal_id: null, quantity: '2.0000', amount: '-80.0000' }]);
    rows.set(schema.stageMaster, [{ stage_code: 'WEANER' }]);
    rows.set(schema.schedulerHeader, [{ scheduler_id: 's-w' }]);

    const result = await service.reverse('b-1', 't-1', 'counted twice', 'tenant');

    expect(result).toMatchObject({ animal_code: null, quantity: 2 });
    expect(updated.find((u) => u.table === schema.animalRegister)).toBeUndefined();
    expect(updated.find((u) => u.table === schema.schedulerHeader)).toBeDefined();
    expect(updated.find((u) => u.table === schema.batchHeader)).toBeDefined();
    expect(schedulers.syncAnimalWiseCounts).not.toHaveBeenCalled();
  });
});
