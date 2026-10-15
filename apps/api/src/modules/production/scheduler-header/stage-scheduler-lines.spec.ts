import { buildStageSchedulerLines, kpiLineDraft, medicationLineDrafts, resourceLineDrafts } from './stage-scheduler-lines';

/** A database whose every read answers the next queued result, whatever the query's shape. */
function fakeDb(results: unknown[][]) {
  const queue = [...results];
  const chain: any = {};
  for (const k of ['from', 'where', 'orderBy', 'innerJoin', 'leftJoin', 'limit']) chain[k] = jest.fn(() => chain);
  chain.then = (resolve: any, reject: any) => Promise.resolve(queue.shift() ?? []).then(resolve, reject);
  return { select: jest.fn(() => chain) } as any;
}

describe('kpiLineDraft — a stage KPI as a data-entry line (Rishi, 14 Oct)', () => {
  const ctx = { period: 'DAILY', stageEndDay: 114, metricName: 'Body Weight', uom: 'KG', lifecycleId: 'lc-1' };

  it('carries the average, and an Upper tolerance as the upper alert limit only', () => {
    expect(kpiLineDraft({ metric: 'BODY_WEIGHT', average_value: 100, tolerance_pct: 10, tolerance_type: 'UPPER', severity: 'critical', from_day: 8, to_day: 30 }, ctx)).toEqual(expect.objectContaining({
      line_type: 'DESCRIPTIVE', activity_name: 'KPI: Body Weight', kpi_metric: 'BODY_WEIGHT', kpi_uom: 'KG', capture_per: 'AVERAGE',
      occurrence: 'DAILY', start_day: 8, end_day: 30, std_value: 100, upper_alert_limit: 110, lower_alert_limit: null,
      alert_severity: 'CRITICAL', is_mandatory: false, lifecycle_ref_id: 'lc-1',
    }));
  });

  it('a Lower tolerance is the lower limit only; no side given is both', () => {
    expect(kpiLineDraft({ metric: 'ADG', average_value: 600, tolerance_pct: 5, tolerance_type: 'LOWER' }, ctx)).toMatchObject({ lower_alert_limit: 570, upper_alert_limit: null });
    expect(kpiLineDraft({ metric: 'ADG', average_value: 600, tolerance_pct: 5 }, ctx)).toMatchObject({ lower_alert_limit: 570, upper_alert_limit: 630 });
  });

  it('a weekly KPI is entered on Mondays; a whole-stage KPI runs from day 1 to the stage end', () => {
    expect(kpiLineDraft({ metric: 'BCS_SCORE' }, { ...ctx, period: 'WEEKLY' })).toMatchObject({ occurrence: 'WEEKLY', day_of_week: 1, start_day: 1, end_day: 114 });
  });

  it('a counted metric is the day\'s total, and mortality is a mandatory entry', () => {
    expect(kpiLineDraft({ metric: 'MORTALITY_COUNT', average_value: 0 }, ctx)).toMatchObject({ capture_per: 'TOTAL', is_mandatory: true });
  });

  it('keeps limits an older line stored directly, and skips a line with no metric', () => {
    expect(kpiLineDraft({ metric: 'FCR', lower_limit: 2.5, upper_limit: 3.1 }, ctx)).toMatchObject({ lower_alert_limit: 2.5, upper_alert_limit: 3.1, std_value: null });
    expect(kpiLineDraft({ metric: '' }, ctx)).toBeNull();
  });
});

describe('medicationLineDrafts — the treatment card as as-needed lines', () => {
  const items = new Map([['ivm', { item_name: 'Ivermectin 1%', tracked: true }]]);

  it('one line per drug, not mandatory, no quantity, with every card it treats', () => {
    const lines = medicationLineDrafts([
      { problem: 'Mange', symptom: 'Scratching', medicine_item_id: 'ivm', dose: '1 ml / 33 kg', repeat: 'after 14 days', withdrawal_days: 18 },
      { problem: 'Worms', symptom: 'Poor condition', medicine_item_id: 'ivm', dose: '1 ml / 33 kg' },
      { problem: 'Unknown drug', medicine_item_id: 'gone' },
    ], { stageEndDay: 28, items, lifecycleId: 'lc-1' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(expect.objectContaining({
      line_type: 'CONSUMPTION', activity_name: 'Medication: Ivermectin 1% — Mange, Worms', is_mandatory: false,
      standard_qty: 0, item_id: 'ivm', lot_required: true, start_day: 1, end_day: 28,
    }));
    expect((lines[0].extension_config as any).as_needed).toBe(true);
    expect((lines[0].extension_config as any).treatments.map((t: any) => t.problem)).toEqual(['Mange', 'Worms']);
  });
});

describe('resourceLineDrafts — Resource Requirements as resource lines', () => {
  it('one line per resource over the stage, quantities added up, notes kept', () => {
    const lines = resourceLineDrafts([
      { resource_id: 'r1', quantity: 2, notes: 'heat lamp' },
      { resource_id: 'r1', quantity: 1 },
      { resource_id: 'missing', quantity: 9 },
    ], { stageEndDay: 21, resources: new Map([['r1', 'Heat Lamp']]), lifecycleId: 'lc-1' });
    expect(lines).toEqual([expect.objectContaining({
      line_type: 'RESOURCE', activity_name: 'Resource: Heat Lamp', resource_id: 'r1', standard_qty: 3, start_day: 1, end_day: 21,
      extension_config: { notes: 'heat lamp' },
    })]);
  });
});

describe('buildStageSchedulerLines — a whole stage', () => {
  const batch = { batch_id: 'b1', breed_id: 'breed-1', company_id: 'co-1' } as any;
  const stage = { stage_id: 'st', stage_name: 'Grower', typical_duration_days: 60 } as any;
  const row = (over: object) => ({
    lifecycle_id: 'lc-1', calc_unit: 'DAY', period_from: 1, period_to: 30, feed_item_id: 'feed-a', feed_qty_per_head_per_day_kg: '1.2000',
    std_mortality_rate_pct: '2', output_item_id: null, std_output_qty: null, std_body_weight_kg: null,
    resource_requirements: null, vaccination_protocol: null, medication_protocol: null,
    kpi_thresholds: [{ metric: 'MORTALITY_COUNT', average_value: 0, severity: 'CRITICAL' }, { metric: 'BODY_WEIGHT', average_value: 45, tolerance_pct: 10 }],
    kpi_alert_period: 'WEEKLY', ...over,
  });

  it('feed lines become daily consumption lines, KPIs become data-entry lines, and a KPI replaces the standard mortality line', async () => {
    const db = fakeDb([
      [row({}), row({ lifecycle_id: 'lc-2', period_from: 31, period_to: 60, feed_item_id: 'feed-b', feed_qty_per_head_per_day_kg: '0.0000' })], // stage rows
      [{ item_id: 'feed-a', item_name: 'Grower Mash', lot: false, serial: false }], // items
      [{ code: 'BODY_WEIGHT', name: 'Body Weight', uom: 'KG' }], // KPI metrics
      [{ dob: null }], // the batch's oldest date of birth (none: no vaccinations by age)
    ]);
    const lines = await buildStageSchedulerLines(db, { batch, stageId: 'st', stage, effectiveFrom: '2026-10-01' });

    // A zero-rate feed row schedules nothing.
    expect(lines.filter((l) => l.line_type === 'CONSUMPTION')).toEqual([expect.objectContaining({
      activity_name: 'Grower Feed — Grower Mash', occurrence: 'DAILY', start_day: 1, end_day: 30, standard_qty: 1.2, is_mandatory: true, lifecycle_ref_id: 'lc-1',
    })]);
    const kpis = lines.filter((l) => l.line_type === 'DESCRIPTIVE');
    expect(kpis.map((l) => [l.activity_name, l.occurrence, l.kpi_metric])).toEqual([
      ['KPI: MORTALITY COUNT', 'WEEKLY', 'MORTALITY_COUNT'],
      ['KPI: Body Weight', 'WEEKLY', 'BODY_WEIGHT'],
    ]);
    // No separate "Grower Mortality" line: the KPI line already captures it.
    expect(lines.some((l) => l.activity_name === 'Grower Mortality')).toBe(false);
  });

  it('a breed with no row for the stage has no activities to fill', async () => {
    expect(await buildStageSchedulerLines(fakeDb([[]]), { batch, stageId: 'st', stage, effectiveFrom: '2026-10-01' })).toEqual([]);
  });
});
