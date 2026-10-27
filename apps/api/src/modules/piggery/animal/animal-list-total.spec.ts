import { AnimalController } from './animal.controller';

/**
 * The Animal Register's pager showed "Showing 1–25 of 26, Page 1 of 2" against
 * a register holding 65 animals.
 *
 * MasterDataTable falls back to `rows + 1` when a list reports no total, so a
 * full page of 25 always reads as 26 — the fallback exists only to keep Next
 * reachable. Every other master returns `total` alongside `data`; the animal
 * list returned a bare array, so the fallback was all the table ever had.
 */
describe('GET /animal reports the register total, not just the page', () => {
  const controllerWith = (result: unknown) =>
    new AnimalController({ findAll: jest.fn().mockResolvedValue(result) } as never);

  it('passes total, limit and offset through to the list screen', async () => {
    const page = Array.from({ length: 25 }, (_, i) => ({ animal_id: `a-${i}`, animal_code: `PIG-${i}` }));
    const controller = controllerWith({ data: page, total: 65, limit: 25, offset: 0 });

    const response: any = await controller.findAll({} as never, { user: { tenantId: 't-1' } });

    expect(response.data).toHaveLength(25);
    expect(response.total).toBe(65);
    expect(response.limit).toBe(25);
    expect(response.offset).toBe(0);
  });

  it('keeps data an array, so every existing caller of the endpoint is unaffected', async () => {
    const controller = controllerWith({ data: [{ animal_id: 'a-1', animal_code: 'PIG-1' }], total: 1, limit: 50, offset: 0 });

    const response: any = await controller.findAll({} as never, { user: { tenantId: 't-1' } });

    expect(Array.isArray(response.data)).toBe(true);
  });
});
