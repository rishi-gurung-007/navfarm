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

  // Rishi, 12 Oct: Std FCR 100 crashed the save (column decimal(5,3)); it is now a clear 400.
  it('refuses a Std FCR above 99.999 with a clear message instead of a database error', async () => {
    await expect(pipe.transform({ ...base, std_fcr: 100 }, { type: 'body', metatype: CreateBreedLifecycleStageDto }))
      .rejects.toMatchObject({ response: { message: expect.arrayContaining([expect.stringContaining('Std FCR cannot be more than 99.999')]) } });
    await expect(pipe.transform({ ...base, std_fcr: 3.2 }, { type: 'body', metatype: CreateBreedLifecycleStageDto })).resolves.toBeDefined();
  });

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

  it('rejects a period outside DAILY/WEEKLY (Monthly was removed)', async () => {
    await expect(pipe.transform({ ...base, kpi_alert_period: 'YEARLY' }, { type: 'body', metatype: CreateBreedLifecycleStageDto })).rejects.toThrow();
    await expect(pipe.transform({ ...base, kpi_alert_period: 'MONTHLY' }, { type: 'body', metatype: CreateBreedLifecycleStageDto })).rejects.toThrow();
  });

  it('accepts a per-line kpi_period and tolerance, and keeps them', async () => {
    const out: any = await pipe.transform({ ...base, kpi_thresholds: [{ ...line, kpi_period: 'WEEKLY', tolerance_pct: 5, tolerance_type: 'UPPER' }] }, { type: 'body', metatype: CreateBreedLifecycleStageDto });
    expect(out.kpi_thresholds[0]).toMatchObject({ kpi_period: 'WEEKLY', tolerance_pct: 5, tolerance_type: 'UPPER' });
  });

  it('treats blank line period and tolerance as absent', async () => {
    const out: any = await pipe.transform({ ...base, kpi_thresholds: [{ ...line, kpi_period: '', tolerance_pct: '', tolerance_type: '' }] }, { type: 'body', metatype: CreateBreedLifecycleStageDto });
    expect(out.kpi_thresholds[0]).toMatchObject({ kpi_period: null, tolerance_pct: null, tolerance_type: null });
  });

  it.each([
    [{ kpi_period: 'YEARLY' }],
    [{ kpi_period: 'MONTHLY' }],
    [{ from_day: 0 }],
    [{ from_day: 1.5 }],
    [{ to_day: 0 }],
    [{ from_day: 5, to_day: 4 }],
    [{ tolerance_pct: -1, tolerance_type: 'UPPER' }],
    [{ tolerance_pct: 101, tolerance_type: 'UPPER' }],
    [{ tolerance_pct: 5, tolerance_type: 'MIDDLE' }],
  ])('rejects %j', async (extra) => {
    await expect(pipe.transform({ ...base, kpi_thresholds: [{ ...line, ...extra }] }, { type: 'body', metatype: CreateBreedLifecycleStageDto })).rejects.toThrow();
  });

  it('accepts from_day/to_day stage days, either or both optional, and keeps them', async () => {
    const pass = async (extra: object) => (await pipe.transform({ ...base, kpi_thresholds: [{ ...line, ...extra }] }, { type: 'body', metatype: CreateBreedLifecycleStageDto }) as any).kpi_thresholds[0];
    expect(await pass({ from_day: 3, to_day: 9 })).toMatchObject({ from_day: 3, to_day: 9 });
    expect(await pass({ from_day: 4, to_day: 4 })).toMatchObject({ from_day: 4, to_day: 4 });
    expect(await pass({ from_day: 3 })).toMatchObject({ from_day: 3 });
    expect(await pass({ to_day: 9 })).toMatchObject({ to_day: 9 });
    expect(await pass({ from_day: '', to_day: '' })).toMatchObject({ from_day: null, to_day: null });
  });
});
