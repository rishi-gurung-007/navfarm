import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { LitterCostService } from './litter-cost.service';

describe('LitterCostService', () => {
  let service: LitterCostService;
  const rows = new Map<unknown, unknown[]>();
  const inserted: any[] = [];
  const sets: any[] = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: () => self, orderBy: () => self, groupBy: () => self, innerJoin: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = {
    select: jest.fn(() => ({ from: (t: unknown) => chain(rows.get(t) ?? []) })),
    insert: jest.fn(() => ({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) })),
    update: jest.fn(() => ({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) })),
  };
  const refresh = jest.fn();
  const gl = { postBatchCostEntry: jest.fn(), animalAssetAccountId: jest.fn().mockResolvedValue(undefined) };
  const farrow: any = { farrow_id: 'f1', batch_id: 'b-sows', piglet_batch_id: 'b-lot', farrowing_date: '2026-10-05', piglet_lot_no: 'LOT-1' };
  const sow: any = { animal_id: 'sow-1', animal_code: 'SOW-1', item_id: 'item-sow' };

  beforeEach(async () => {
    rows.clear(); inserted.length = 0; sets.length = 0; refresh.mockClear(); gl.postBatchCostEntry.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [LitterCostService, { provide: ClsService, useValue: transactionCls(db) }, { provide: AnimalBookValueService, useValue: { refreshCache: refresh } }, { provide: GlPostingService, useValue: gl }],
    }).compile();
    service = moduleRef.get(LitterCostService);
    rows.set(schema.batchBioAssetState, [{ nca_book_value: '100', stage: 'PREMATURE' }]);
    rows.set(schema.batchHeader, [{ batch_id: 'b', batch_no: 'BATCH-1', company_id: 'co', nob_id: 'n', lob_id: 'l' }]);
    jest.spyOn(service, 'capitalisedLactationCost').mockResolvedValue({ own: 60, shared: 0 });
  });

  const already = (n: number) => jest.spyOn(service, 'alreadyAllocated').mockImplementation(async (_lot, _t, kind) => (kind === 'BIRTH' ? 0 : n));
  const lotEntry = () => rows.set(schema.bioAssetLedger, [{ item_id: 'item-piglet' }]);

  it('moves only what the sow has still to hand over: the first move takes it all', async () => {
    already(0); lotEntry();
    const r = await service.allocate(farrow, sow, { asOf: '2026-10-12', divisor: 10 }, 't');
    expect(r.moved).toBe(60);
    expect(inserted[0].map((e: any) => [e.animal_id, Number(e.cost_amount)])).toEqual([['sow-1', -60], [null, 60]]);
    expect(refresh).toHaveBeenCalledWith(['sow-1']);
  });

  it('a later move (the weaning, after gilts were picked) takes only the part not moved before, and spreads the litter\'s whole cost over the piglets', async () => {
    already(36); lotEntry(); // 36 went with the gilts picked earlier; she has now handed 60 in all
    const r = await service.allocate(farrow, sow, { asOf: '2026-11-02', divisor: 12 }, 't');
    expect(r.moved).toBe(24);
    expect(Number(r.perPiglet)).toBeCloseTo(5, 6); // (36 + 24) / 12
    expect(inserted[0].map((e: any) => Number(e.cost_amount))).toEqual([-24, 24]);
  });

  it('moves nothing when it has all been moved already, or there are no piglets to spread it over', async () => {
    already(60); lotEntry();
    expect((await service.allocate(farrow, sow, { asOf: '2026-11-02', divisor: 12 }, 't')).moved).toBe(0);
    already(0);
    expect((await service.allocate(farrow, sow, { asOf: '2026-11-02', divisor: 0 }, 't')).moved).toBe(0);
    expect(inserted).toEqual([]);
  });

  it('previews what is pending without writing, capped by what her batch carries', async () => {
    already(10);
    expect(await service.pending(farrow, sow, '2026-10-12', 't')).toBe(50);
    rows.set(schema.batchBioAssetState, [{ nca_book_value: '20', stage: 'PREMATURE' }]);
    expect(await service.pending(farrow, sow, '2026-10-12', 't')).toBe(20);
    expect(inserted).toEqual([]);
  });

  describe('the litter\'s cost at birth', () => {
    const born: any = { ...farrow, company_id: 'co', breeding_id: 'br-1', farrowing_date: '2026-10-05' };
    beforeEach(() => {
      rows.set(schema.breedingRecord, [{ d: '2026-06-11' }]);
      already(0); lotEntry();
    });

    it('moves the sow\'s cost from her mating to the day before the farrowing into the new lot, per piglet born alive, and posts the journal', async () => {
      const cap = jest.spyOn(service, 'capitalisedLactationCost').mockResolvedValue({ own: 90, shared: 0 });
      gl.postBatchCostEntry.mockResolvedValue({ journal_no: 'JE-000150' });
      const r = await service.allocateAtBirth(born, sow, 10, 't');
      expect(cap).toHaveBeenCalledWith(sow, 'b-sows', '2026-06-11', '2026-10-04', 't');
      expect(r).toMatchObject({ moved: 90, journal: 'JE-000150' });
      expect(Number(r.perPiglet)).toBeCloseTo(9, 6);
      expect(inserted[0].map((e: any) => [e.animal_id, Number(e.cost_amount), e.document_type])).toEqual([['sow-1', -90, 'LITTER_BIRTH_COST'], [null, 90, 'LITTER_BIRTH_COST']]);
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_LITTER_BIRTH', amount: 90, postingDate: '2026-10-05', creditAccountId: undefined }));
      // The credit is the account the sow's cost is carried in, when she has a profile.
      gl.postBatchCostEntry.mockClear();
      gl.animalAssetAccountId.mockResolvedValue('acct-1060');
      await service.allocateAtBirth(born, sow, 10, 't');
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_LITTER_BIRTH', creditAccountId: 'acct-1060' }));
      gl.animalAssetAccountId.mockResolvedValue(undefined);
    });

    it('still moves the value, with no journal, when no GL mapping for it is set up', async () => {
      jest.spyOn(service, 'capitalisedLactationCost').mockResolvedValue({ own: 90, shared: 0 });
      gl.postBatchCostEntry.mockRejectedValue(new BadRequestException("No GL mapping is set up for the 'BIO_LITTER_BIRTH' transaction type."));
      const r = await service.allocateAtBirth(born, sow, 10, 't');
      expect(r.moved).toBe(90);
      expect(r.journal).toBeNull();
    });

    it('opens the litter at nil when the sow has no capitalised cost in the window (her feed was expensed)', async () => {
      jest.spyOn(service, 'capitalisedLactationCost').mockResolvedValue({ own: 0, shared: 0 });
      const r = await service.allocateAtBirth(born, sow, 10, 't');
      expect(r.moved).toBe(0);
      expect(gl.postBatchCostEntry).not.toHaveBeenCalled();
    });

    it('says so when the litter opens at nil, naming the window, and says nothing of the kind when value moves', async () => {
      jest.spyOn(service, 'capitalisedLactationCost').mockResolvedValue({ own: 0, shared: 0 });
      const nil = await service.allocateAtBirth(born, sow, 10, 't');
      expect(nil.zeroCost).toBe(true);
      expect(nil.note).toContain('The litter opens at 0.00');
      expect(nil.note).toContain(`${sow.animal_code} had no feed, drug or overhead capitalised between`);

      jest.spyOn(service, 'capitalisedLactationCost').mockResolvedValue({ own: 40, shared: 0 });
      const priced = await service.allocateAtBirth(born, sow, 10, 't');
      expect(priced.zeroCost).toBe(false);
      expect(priced.note).not.toContain('opens at 0.00');
    });

    it('the weaning\'s cost per piglet counts the birth cost too, and the birth cost is not taken again as lactation cost', async () => {
      jest.spyOn(service, 'capitalisedLactationCost').mockResolvedValue({ own: 30, shared: 0 });
      jest.spyOn(service, 'alreadyAllocated').mockImplementation(async (_lot, _t, kind) => (kind === 'BIRTH' ? 90 : 0));
      const r = await service.allocate(born, sow, { asOf: '2026-10-26', divisor: 12 }, 't');
      expect(r.moved).toBe(30);
      expect(Number(r.perPiglet)).toBeCloseTo(10, 6); // (90 at birth + 30 since) / 12
    });
  });
});
