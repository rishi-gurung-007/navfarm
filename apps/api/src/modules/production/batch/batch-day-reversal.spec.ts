import { classifyPostedRow } from './batch-day-reversal';

describe('which postings of a reopened day can be reversed', () => {
  it('reverses consumption and observations whatever the costing method', () => {
    expect(classifyPostedRow({ line_type: 'CONSUMPTION' }, 'BIO_ASSET')).toEqual({ reversible: true, kind: 'CONSUMPTION' });
    expect(classifyPostedRow({ line_type: 'CONSUMPTION' }, 'STANDARD')).toEqual({ reversible: true, kind: 'CONSUMPTION' });
    expect(classifyPostedRow({ line_type: 'DESCRIPTIVE', kpi_metric: 'BODY_WEIGHT', entered_value: 31 }, 'BIO_ASSET')).toEqual({ reversible: true, kind: 'OBSERVATION' });
  });

  it('reverses output and cost on a batch that is not a bio-asset batch', () => {
    expect(classifyPostedRow({ line_type: 'OUTPUT' }, 'STANDARD')).toEqual({ reversible: true, kind: 'OUTPUT' });
    expect(classifyPostedRow({ line_type: 'OVERHEAD' }, 'FIFO')).toEqual({ reversible: true, kind: 'COST' });
    expect(classifyPostedRow({ line_type: 'RESOURCE' }, 'STANDARD')).toEqual({ reversible: true, kind: 'COST' });
  });

  it('leaves a bio-asset batch’s output and cost posted', () => {
    expect(classifyPostedRow({ line_type: 'OUTPUT' }, 'BIO_ASSET')).toMatchObject({ reversible: false });
    expect(classifyPostedRow({ line_type: 'OVERHEAD' }, 'BIO_ASSET')).toMatchObject({ reversible: false });
    expect(classifyPostedRow({ line_type: 'RESOURCE' }, 'BIO_ASSET')).toMatchObject({ reversible: false });
  });

  it('leaves transfers and recorded deaths posted, and says why', () => {
    expect(classifyPostedRow({ line_type: 'TRANSFER' })).toEqual({ reversible: false, reason: 'it moved animals — use "Reverse transfer" on the transfer' });
    expect(classifyPostedRow({ line_type: 'DESCRIPTIVE', kpi_metric: 'MORTALITY_COUNT', entered_value: '1' })).toEqual({ reversible: false, reason: 'it recorded a death, which is final' });
  });

  it('treats a mortality count of nought as an observation — nothing died, nothing to undo', () => {
    expect(classifyPostedRow({ line_type: 'DESCRIPTIVE', kpi_metric: 'MORTALITY_COUNT', entered_value: 0 })).toEqual({ reversible: true, kind: 'OBSERVATION' });
  });

  it('refuses a line type it does not know', () => {
    expect(classifyPostedRow({ line_type: 'MYSTERY' })).toMatchObject({ reversible: false });
  });
});

// ── the reversing service ─────────────────────────────────────────────────────────────────────────────────────
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BatchDayReversalService } from './batch-day-reversal.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import * as schema from '../../../core/database/schema';

describe('BatchDayReversalService', () => {
  let service: BatchDayReversalService;
  const queue: unknown[][] = [];
  const updates: Array<{ table: unknown; set: any }> = [];
  const inserts: Array<{ table: unknown; values: any }> = [];
  const deletes: unknown[] = [];
  const ledger = { reverseIssue: jest.fn(), reverseReceipt: jest.fn() };
  const gl = { reverseInventoryJournal: jest.fn(), reverseJournal: jest.fn(), findBatchCostJournal: jest.fn() };

  // Each select takes the next queued result; every builder method returns the same awaitable.
  const chain = (result: unknown[]) => {
    const self: any = {};
    for (const m of ['from', 'where', 'limit', 'innerJoin', 'leftJoin', 'orderBy', 'for']) self[m] = () => self;
    self.then = (ok: any, err: any) => Promise.resolve(result).then(ok, err);
    return self;
  };
  const db = {
    select: jest.fn(() => ({ from: () => chain(queue.shift() ?? []) })),
    update: jest.fn((table: unknown) => ({ set: (set: any) => ({ where: () => { updates.push({ table, set }); return Promise.resolve(); } }) })),
    insert: jest.fn((table: unknown) => ({ values: (values: any) => { inserts.push({ table, values }); return Promise.resolve(); } })),
    delete: jest.fn((table: unknown) => ({ where: () => { deletes.push(table); return Promise.resolve(); } })),
  };
  const batch = { batch_id: 'b1', batch_no: 'BATCH-1', company_id: 'c1', nob_id: 'n1', lob_id: 'l1', costing_method: 'STANDARD' };
  const row = (over: object) => ({ entry_id: 'e', line_id: 'l', animal_id: null, posting_reference: null, entered_value: '1', line_type: 'CONSUMPTION', kpi_metric: null, activity_name: 'Feed', ...over });

  beforeEach(async () => {
    queue.length = 0; updates.length = 0; inserts.length = 0; deletes.length = 0;
    jest.clearAllMocks();
    ledger.reverseIssue.mockResolvedValue({ ledger_id: 'rev' });
    ledger.reverseReceipt.mockResolvedValue({ ledger_id: 'rev' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        BatchDayReversalService,
        { provide: ClsService, useValue: { get: (k: string) => (k === 'tenantPostingTransaction' ? true : db) } },
        { provide: AnimalBookValueService, useValue: { valueOf: jest.fn().mockResolvedValue({ acquisition: 0, capitalised: 0, amortised: 0, fairValue: 0, exits: 0, bookValue: 0, hasRows: false }), valuesFor: jest.fn().mockResolvedValue(new Map()), refreshCache: jest.fn().mockResolvedValue(undefined) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: ledger },
        { provide: GlPostingService, useValue: gl },
      ],
    }).compile();
    service = moduleRef.get(BatchDayReversalService);
  });

  // Bio-asset costing Phase 2: a pre-mature herd's capitalised cost is on the ledger one row per animal, tied to the issue by
  // document_line_id. Taking the day back must take each animal's own cost back out, not one row for the herd.
  it('mirrors each animal\'s capitalised ledger row when a pre-mature bio-asset issue is reversed, and refreshes their cache', async () => {
    queue.push(
      [{ ...batch, costing_method: 'BIO_ASSET' }],
      [{ stage_code: 'GESTATION' }],
      [row({ entry_id: 'e1', animal_id: 'a1', posting_reference: 't1' }), row({ entry_id: 'e2', animal_id: 'a2', posting_reference: 't2' })],
      [{ animal_id: 'a1', animal_code: 'P-a1', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }, { animal_id: 'a2', animal_code: 'P-a2', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }],
      [{ transaction_id: 't1', ledger_id: 'L1' }, { transaction_id: 't2', ledger_id: 'L1' }],
      [{ ledger_id: 'L1', transaction_type: 'CONSUMPTION', gl_mapping_type: 'BIO_CONSUMPTION_PREMATURE', amount: '-6', quantity: '-30', rate: '0.2', item_id: 'feed', document_line_id: 'G1', posting_date: '2026-10-01' }],
      [{ nca_book_value: '10' }], // the herd's state
      [ // the rows the issue wrote, one per animal
        { entry_id: 'r1', animal_id: 'a1', bio_asset_item_id: 'feed', quantity: '10', cost_amount: '2.0000', cost_amount_each_unit: '0.2', posting_date: '2026-10-01' },
        { entry_id: 'r2', animal_id: 'a2', bio_asset_item_id: 'feed', quantity: '20', cost_amount: '4.0000', cost_amount_each_unit: '0.2', posting_date: '2026-10-01' },
      ],
      [{ transaction_id: 't1' }, { transaction_id: 't2' }],
    );

    await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');

    const mirrors = inserts.filter((i) => i.table === schema.bioAssetLedger).map((i) => i.values);
    expect(mirrors).toHaveLength(2);
    expect(mirrors[0]).toMatchObject({ animal_id: 'a1', entry_type: 'OVERHEAD', transaction_type: 'CONSUMPTION', document_type: 'BATCH', cost_amount: '-2', quantity: '-10', source_entry_id: 'r1' });
    expect(mirrors[1]).toMatchObject({ animal_id: 'a2', entry_type: 'OVERHEAD', transaction_type: 'CONSUMPTION', document_type: 'BATCH', cost_amount: '-4', quantity: '-20', source_entry_id: 'r2' });
    expect(updates.find((u) => u.table === schema.batchBioAssetState)!.set.nca_book_value).toBe('4'); // 10 - 6
    expect((service as any).animalBookValue.refreshCache).toHaveBeenCalledWith(['a1', 'a2']);
  });

  it('still mirrors an older issue (one batch-level row, no tie) as a single row', async () => {
    queue.push(
      [{ ...batch, costing_method: 'BIO_ASSET' }],
      [{ stage_code: 'GESTATION' }],
      [row({ entry_id: 'e1', animal_id: 'a1', posting_reference: 't1' })],
      [{ animal_id: 'a1', animal_code: 'P-a1', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }],
      [{ transaction_id: 't1', ledger_id: 'L1' }],
      [{ ledger_id: 'L1', transaction_type: 'CONSUMPTION', gl_mapping_type: 'BIO_CONSUMPTION_PREMATURE', amount: '-6', quantity: '-30', rate: '0.2', item_id: 'feed', document_line_id: null, posting_date: '2026-10-01' }],
      [{ nca_book_value: '10' }],
      [{ transaction_id: 't1' }],
    );
    await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');
    const mirrors = inserts.filter((i) => i.table === schema.bioAssetLedger).map((i) => i.values);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatchObject({ entry_type: 'OVERHEAD', transaction_type: 'CONSUMPTION', document_type: 'BATCH', cost_amount: '-6' });
    expect(mirrors[0].animal_id).toBeUndefined();
  });

  it('reverses a consumption shared by two animals once, marks both transactions and puts both entries back to drafts', async () => {
    queue.push(
      [batch], // batch
      [{ stage_code: 'GESTATION' }], // stage
      [row({ entry_id: 'e1', animal_id: 'a1', posting_reference: 't1' }), row({ entry_id: 'e2', animal_id: 'a2', posting_reference: 't2' })], // posted rows
      [{ animal_id: 'a1', animal_code: 'P-a1', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }, { animal_id: 'a2', animal_code: 'P-a2', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }], // where the animals are now: still at this stage
      [{ transaction_id: 't1', ledger_id: 'L1' }, { transaction_id: 't2', ledger_id: 'L1' }], // their transactions
      [{ ledger_id: 'L1', transaction_type: 'CONSUMPTION', amount: '-50' }], // original ledger entry
      [{ transaction_id: 't1' }, { transaction_id: 't2' }], // every transaction on that ledger entry
    );

    const result = await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');

    expect(ledger.reverseIssue).toHaveBeenCalledTimes(1);
    expect(ledger.reverseIssue).toHaveBeenCalledWith('L1', 't', 'u1');
    expect(gl.reverseInventoryJournal).toHaveBeenCalledWith('L1', { ledger_id: 'rev' }, 'u1');
    expect(result).toMatchObject({ unposted: 2, kept: [], consumption_reversed: true });
    expect(updates.find((u) => u.table === schema.batchTransaction)!.set.reversed_at).toBeTruthy();
    expect(updates.find((u) => u.table === schema.batchDailyData)!.set).toMatchObject({ posted: false, posting_reference: null });
  });

  it('takes a premature bio-asset batch’s capitalised cost back out of its carrying value', async () => {
    queue.push(
      [{ ...batch, costing_method: 'BIO_ASSET' }], [{ stage_code: 'GESTATION' }],
      [row({ entry_id: 'e1', animal_id: 'a1', posting_reference: 't1' })],
      [{ animal_id: 'a1', animal_code: 'P-a1', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }], // where the animals are now: still at this stage
      [{ transaction_id: 't1', ledger_id: 'L1' }],
      [{ ledger_id: 'L1', transaction_type: 'CONSUMPTION', gl_mapping_type: 'BIO_CONSUMPTION_PREMATURE', amount: '-120', quantity: '-4', item_id: 'i1', rate: '30', posting_date: '2026-10-01' }],
      [{ state_id: 's', nca_book_value: '1000' }], // bio state
      [{ transaction_id: 't1' }],
    );

    await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');

    expect(updates.find((u) => u.table === schema.batchBioAssetState)!.set.nca_book_value).toBe('880');
    expect(inserts.find((i) => i.table === schema.bioAssetLedger)!.values).toMatchObject({ entry_type: 'OVERHEAD', transaction_type: 'CONSUMPTION', document_type: 'BATCH', cost_amount: '-120', stage: 'PREMATURE' });
  });

  it('leaves a transfer and a recorded death posted, reverses nothing for them, and says why', async () => {
    queue.push(
      [batch], [{ stage_code: 'GESTATION' }],
      [
        row({ entry_id: 'e1', line_type: 'TRANSFER', activity_name: 'Move to growers', animal_id: 'a1', posting_reference: 'tr' }),
        row({ entry_id: 'e2', line_type: 'DESCRIPTIVE', kpi_metric: 'MORTALITY_COUNT', entered_value: '1', activity_name: 'Daily Mortality Check', animal_id: 'a2', posting_reference: null }),
      ],
      [{ animal_id: 'a1', animal_code: 'P-a1', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }, { animal_id: 'a2', animal_code: 'P-a2', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }], // where the animals are now: still at this stage
    );

    const result = await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');

    expect(result.unposted).toBe(0);
    expect(result.kept.map((k) => k.activity_name)).toEqual(['Move to growers', 'Daily Mortality Check']);
    expect(ledger.reverseIssue).not.toHaveBeenCalled();
    expect(updates.find((u) => u.table === schema.batchDailyData)).toBeUndefined();
  });

  it('leaves a farrowing posted from data entry alone — the litter has its own record', async () => {
    queue.push(
      [{ ...batch, costing_method: 'STANDARD' }], [{ stage_code: 'FARROWING' }],
      [row({ entry_id: 'e1', line_type: 'OUTPUT', activity_name: 'Piglet Output (Live Born)', animal_id: 'a1', posting_reference: 'farrow-1' })],
      [{ id: 'farrow-1' }], // the reference is a farrowing record
      [], // not a semen collection
    );
    const result = await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');
    expect(result.unposted).toBe(0);
    expect(result.kept[0]).toMatchObject({ activity_name: 'Piglet Output (Live Born)', reason: expect.stringContaining('farrowing or weaning') });
    expect(ledger.reverseReceipt).not.toHaveBeenCalled();
  });

  it('leaves a posting with no transaction behind it posted rather than guessing', async () => {
    queue.push([batch], [{ stage_code: 'GESTATION' }], [row({ entry_id: 'e1', posting_reference: null })], []);
    const result = await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');
    expect(result.unposted).toBe(0);
    expect(result.kept[0].reason).toMatch(/nothing to reverse from/);
  });

  // An animal that has left the stage since (weaned to Dry Sow, moved away) could not have her day posted here again:
  // reversing her entries would strand them as drafts and lose her feed. They stay posted, and the result says why.
  it('keeps posted the entries of an animal that has since left the stage', async () => {
    queue.push(
      [batch], [{ stage_code: 'FARROWING' }],
      [row({ entry_id: 'e1', animal_id: 'a1', posting_reference: 't1' })],
      [{ animal_id: 'a1', animal_code: 'PIG-0022', is_active: true, batch_id: 'b1', stage_code: 'DRY_SOW', stage_name: 'Dry Sow' }],
    );

    const result = await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');

    expect(result.unposted).toBe(0);
    expect(result.kept[0].reason).toContain('PIG-0022 has since left this stage (now at Dry Sow)');
    expect(ledger.reverseIssue).not.toHaveBeenCalled();
  });

  it('takes a main output back out of stock and removes its output line', async () => {
    queue.push(
      [batch], [{ stage_code: 'GESTATION' }],
      [row({ entry_id: 'e1', line_type: 'OUTPUT', activity_name: 'Piglet Output', posting_reference: 't1', animal_id: 'a1' })],
      [], // none of the postings is a litter
      [], // nor a semen collection
      [{ animal_id: 'a1', animal_code: 'P-a1', is_active: true, batch_id: 'b1', stage_code: 'GESTATION' }], // still at this stage
      [{ transaction_id: 't1', ledger_id: 'L9' }],
      [], // no QR pack
      [], // no QC result
      [{ id: 'j1' }], // the output's journal
    );

    const result = await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');

    expect(ledger.reverseReceipt).toHaveBeenCalledWith('L9', 't', 'u1');
    expect(gl.reverseInventoryJournal).toHaveBeenCalledWith('L9', { ledger_id: 'rev' }, 'u1');
    expect(deletes).toContain(schema.batchOutputLine);
    expect(result.unposted).toBe(1);
  });

  it('refuses to take back an output a QR pack was generated from', async () => {
    queue.push(
      [batch], [{ stage_code: 'GESTATION' }],
      [row({ entry_id: 'e1', line_type: 'OUTPUT', posting_reference: 't1' })],
      [], // not a litter
      [], // nor a semen collection
      [{ transaction_id: 't1', ledger_id: 'L9' }],
      [{ id: 'qr1' }],
    );
    await expect(service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1')).rejects.toThrow(BadRequestException);
    expect(ledger.reverseReceipt).not.toHaveBeenCalled();
  });

  it('mirrors an overhead’s journal, found by what it recorded, and refuses if it cannot be found', async () => {
    const overhead = row({ entry_id: 'e1', line_type: 'OVERHEAD', activity_name: 'Labour', posting_reference: 't1' });
    const tx = { transaction_id: 't1', ledger_id: null, amount: '-300', remarks: 'Labour — scheduled entry', transaction_date: '2026-10-01' };
    queue.push([batch], [{ stage_code: 'GESTATION' }], [overhead], [tx], []);
    gl.findBatchCostJournal.mockResolvedValueOnce({ journal_id: 'J1' });

    const result = await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');

    expect(gl.findBatchCostJournal).toHaveBeenCalledWith(expect.objectContaining({ documentNo: 'BATCH-1', amount: 300, description: 'Labour — scheduled entry' }));
    expect(gl.reverseJournal).toHaveBeenCalledWith('J1', '2026-10-01', 'Labour — scheduled entry', 'u1');
    expect(result.unposted).toBe(1);

    queue.push([batch], [{ stage_code: 'GESTATION' }], [overhead], [tx]);
    gl.findBatchCostJournal.mockResolvedValueOnce(null);
    await expect(service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1')).rejects.toThrow('could not be found');
  });

  it('leaves a bio-asset batch’s overhead posted', async () => {
    queue.push([{ ...batch, costing_method: 'BIO_ASSET' }], [{ stage_code: 'GESTATION' }], [row({ line_type: 'OVERHEAD', activity_name: 'Labour', posting_reference: 't1' })]);
    const result = await service.unpostDay('b1', 's1', '2026-10-01', 'typo', 't', 'u1');
    expect(result.kept[0].reason).toMatch(/bio-asset batch/);
    expect(gl.reverseJournal).not.toHaveBeenCalled();
  });
});
