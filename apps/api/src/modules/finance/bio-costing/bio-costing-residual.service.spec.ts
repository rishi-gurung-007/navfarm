import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BioCostingResidualService } from './bio-costing-residual.service';
import { BioCostingSubjectService } from './bio-costing-subject.service';

describe('BioCostingResidualService — an animal\'s residual is her item\'s', () => {
  const queue: unknown[][] = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, innerJoin: () => self, where: () => self, limit: () => self, orderBy: () => self, groupBy: () => self, having: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = { select: jest.fn(() => chain(queue.shift() ?? [])) };
  const subjects = { forAnimal: jest.fn() };
  let service: BioCostingResidualService;

  const animal = { animal_id: 'a1', tenant_id: 't', company_id: 'c', gender: 'F', item_id: 'i', residual_value: null };
  const sowTerms = { costing_method: 'AMORTIZATION', start_age_weeks: 33, residual_rule: 'WEIGHT_X_PRICE', residual_weight_kg: 150, residual_price_per_kg: 2.05 };

  beforeEach(async () => {
    queue.length = 0; jest.clearAllMocks();
    subjects.forAnimal.mockResolvedValue({ terms: sowTerms });
    const moduleRef = await Test.createTestingModule({
      providers: [
        BioCostingResidualService,
        { provide: ClsService, useValue: { get: (k: string) => (k === 'tenantDb' ? db : undefined) } },
        { provide: BioCostingSubjectService, useValue: subjects },
      ],
    }).compile();
    service = moduleRef.get(BioCostingResidualService);
  });

  it('is her item\'s residual: 150 kg x 2.05 = 307.50', async () => {
    queue.push([animal], [], [{ end: null }]);
    expect(await service.forAnimal('a1', 't')).toMatchObject({ residual: 307.5, source: 'ITEM', latest_amortisation: null, costing_method: 'AMORTIZATION' });
  });

  it('is her item\'s even when a figure was once stored on her: the item is the only source', async () => {
    queue.push([{ ...animal, residual_value: '400.0000' }], [], [{ end: null }]);
    expect(await service.forAnimal('a1', 't')).toMatchObject({ residual: 307.5, source: 'ITEM' });
  });

  it('says NONE where no item costs her', async () => {
    subjects.forAnimal.mockResolvedValue(null);
    queue.push([animal], [], [{ end: null }]);
    expect(await service.forAnimal('a1', 't')).toMatchObject({ residual: 0, source: 'NONE' });
  });

  it('reports her latest month\'s charge as a positive figure', async () => {
    queue.push([animal], [{ date: '2026-09-30', total: '-82.1447' }], [{ end: null }]);
    expect(await service.forAnimal('a1', 't')).toMatchObject({ latest_amortisation: 82.1447, latest_amortisation_date: '2026-09-30' });
  });

  it('says when she was last costed and when her next period falls due (TDD row 8: Last Run, Due Date)', async () => {
    subjects.forAnimal.mockResolvedValue({ terms: sowTerms, run_frequency: 'MONTHLY' });
    queue.push([animal], [], [{ end: '2026-09-30' }]);
    expect(await service.forAnimal('a1', 't')).toMatchObject({ last_run_date: '2026-09-30', next_due_date: '2026-10-31' });
    subjects.forAnimal.mockResolvedValue({ terms: sowTerms, run_frequency: 'QUARTERLY' });
    queue.push([animal], [], [{ end: '2026-09-30' }]);
    expect(await service.forAnimal('a1', 't')).toMatchObject({ last_run_date: '2026-09-30', next_due_date: '2026-12-31' });
  });

  it('has neither date before she has been costed', async () => {
    queue.push([animal], [], [{ end: null }]);
    expect(await service.forAnimal('a1', 't')).toMatchObject({ last_run_date: null, next_due_date: null });
  });

  it('says so when the animal does not exist', async () => {
    queue.push([]);
    await expect(service.forAnimal('nope', 't')).rejects.toThrow(NotFoundException);
  });
});
