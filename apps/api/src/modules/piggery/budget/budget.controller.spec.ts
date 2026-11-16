import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { BudgetListQueryDto } from './budget.controller';

/**
 * The Budget list query under the global pipe's settings (main.ts: whitelist + forbidNonWhitelisted). The master
 * table (MasterDataTable.tsx load()) always sends companyId when a company is active, and search, sort/dir,
 * filter[col], limit and offset when used; any of them undeclared 400s the whole list.
 */
describe('BudgetListQueryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const meta: ArgumentMetadata = { type: 'query', metatype: BudgetListQueryDto };

  it('accepts every parameter the master table can send', async () => {
    const query = {
      companyId: '11111111-1111-4111-8111-111111111111',
      search: 'farm',
      sort: 'period_code',
      dir: 'desc',
      limit: '25',
      offset: '50',
      isActive: 'true',
      // Express parses filter[col]=value into an object.
      filter: { period_code: '2026-P01', farm_name: 'Farm*', metric_label: 'Pigs to Slaughter' },
      periodId: 'p-1',
      farmId: 'farm-1',
      metricCode: 'PIGS_TO_SLAUGHTER',
    };
    // Rethrown with the pipe's messages so a failure names the refused property.
    const out = await pipe.transform(query, meta).catch((e) => { throw new Error(JSON.stringify(e.getResponse())); });
    expect(out).toMatchObject({ companyId: query.companyId, search: 'farm', sort: 'period_code', dir: 'desc', limit: 25, offset: 50 });
    expect(out.filter).toEqual(query.filter);
  });

  it('accepts the all-zero company a fresh signup keeps as its active company', async () => {
    const out = await pipe.transform({ companyId: '00000000-0000-0000-0000-000000000000' }, meta)
      .catch((e) => { throw new Error(JSON.stringify(e.getResponse())); });
    expect(out.companyId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('still refuses a parameter nobody sends', async () => {
    await expect(pipe.transform({ bogus: '1' }, meta)).rejects.toThrow();
  });
});
