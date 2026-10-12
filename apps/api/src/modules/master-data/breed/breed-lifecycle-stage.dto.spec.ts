import { ValidationPipe } from '@nestjs/common';
import { CreateBreedLifecycleStageDto, QueryBreedLifecycleStageDto, UpdateBreedLifecycleStageDto } from './dto/breed.dto';

/**
 * main.ts configures the global pipe with forbidNonWhitelisted, so any query
 * param a DTO does not declare becomes a 400. MasterDataTable sends companyId
 * on every master-data list request, which made this page unusable.
 */
describe('QueryBreedLifecycleStageDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const meta = { type: 'query' as const, metatype: QueryBreedLifecycleStageDto };

  it('accepts the companyId scope param the master-data table always sends', async () => {
    await expect(
      pipe.transform({ companyId: '7f9d3d0e-1c2b-4a5e-9f11-2b3c4d5e6f70', limit: 5 }, meta),
    ).resolves.toBeDefined();
  });

  it('still rejects a genuinely unknown param', async () => {
    await expect(pipe.transform({ bogusParam: 'x' }, meta)).rejects.toThrow();
  });
});

describe('KPI alert period and the extra KPI line keys', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const base = { breed_id: '7f9d3d0e-1c2b-4a5e-9f11-2b3c4d5e6f70', stage_id: '7f9d3d0e-1c2b-4a5e-9f11-2b3c4d5e6f71', calc_unit: 'WEEK', period_from: 1, period_to: 4 };
  const line = { metric: 'ADG', uom: 'G', lower_limit: 400, upper_limit: 600, average_value: 500, severity: 'WARNING' };

  it('accepts kpi_alert_period and average_value/uom on a line, and keeps them', async () => {
    const out: any = await pipe.transform({ ...base, kpi_alert_period: 'WEEKLY', kpi_thresholds: [line] }, { type: 'body', metatype: CreateBreedLifecycleStageDto });
    expect(out.kpi_alert_period).toBe('WEEKLY');
    expect(out.kpi_thresholds[0]).toMatchObject({ uom: 'G', average_value: 500 });
  });

  it('still accepts an old line without the new keys, and a blank period on update', async () => {
    await expect(pipe.transform({ ...base, kpi_thresholds: [{ metric: 'ADG', severity: 'INFO' }] }, { type: 'body', metatype: CreateBreedLifecycleStageDto })).resolves.toBeDefined();
    const out: any = await pipe.transform({ kpi_alert_period: '' }, { type: 'body', metatype: UpdateBreedLifecycleStageDto });
    expect(out.kpi_alert_period).toBeNull();
  });

  it('rejects a period outside DAILY/WEEKLY/MONTHLY', async () => {
    await expect(pipe.transform({ ...base, kpi_alert_period: 'YEARLY' }, { type: 'body', metatype: CreateBreedLifecycleStageDto })).rejects.toThrow();
  });
});
