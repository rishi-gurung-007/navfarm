import { MASTER_DATA_CONFIGS, MASTER_DATA_NAV_ORDER, getConfig } from '../src/modules/master-data/configs';
import { formatColumnValue } from '../src/modules/master-data/column-format';

describe('Reporting Period configuration and Alert Rules navigation', () => {
  it('no longer defines Production Slots (not in the client workbook)', () => {
    expect(getConfig('production-slot')).toBeUndefined();
    expect(MASTER_DATA_CONFIGS.filter((candidate) => candidate.key === 'production-slot')).toHaveLength(0);
  });

  it('exposes exact-date BIN Diet Assignments beside Location without inventing a standalone page', () => {
    const config = getConfig('bin-diet-assignment')!;
    expect(config).toEqual(expect.objectContaining({
      apiBase: '/bin-diet-assignment', idKey: 'assignment_id', tabOf: 'location',
      group: 'Inventory', businessAdminOnly: true,
    }));
    expect(config.fields.map((field) => field.key)).toEqual([
      'company_id', 'bin_location_id', 'feed_item_id', 'production_date', 'diet_priority',
    ]);
    expect(config.columns?.map((column) => column.key)).toEqual([
      'bin_code', 'bin_name', 'feed_item_no', 'feed_item_description', 'production_date', 'diet_priority', 'status',
    ]);
    expect(MASTER_DATA_NAV_ORDER).not.toContain('bin-diet-assignment');
  });

  it('keeps Alert Rules in Farm Masters', () => {
    const config = getConfig('alert-rule')!;
    expect(config.isPrimary).toBe(true);
    expect(config.group).toBe('Farm Operations');
    expect(config.businessAdminOnly).toBe(true);
    expect(MASTER_DATA_NAV_ORDER).toContain('alert-rule');
  });

  it('places Reporting Periods in Farm Operations master navigation', () => {
    const config = getConfig('reporting-period')!;
    expect(config.isPrimary).toBe(true);
    expect(config.group).toBe('Farm Operations');
    expect(config.businessAdminOnly).toBe(true);
    expect(MASTER_DATA_NAV_ORDER).toContain('reporting-period');
    expect(config.draftLifecycle).toEqual({
      activatePath: 'activate',
      approvePermission: { moduleCode: 'MASTER_DATA', resource: 'REPORTING_PERIOD' },
    });
  });

  it('shows draft status and keeps generated reporting periods reviewable before activation', () => {
    const config = getConfig('reporting-period')!;
    expect(config.columns).toContainEqual({ key: 'status', label: 'Status' });
    expect(config.draftLifecycle).toEqual({
      activatePath: 'activate',
      approvePermission: { moduleCode: 'MASTER_DATA', resource: 'REPORTING_PERIOD' },
    });
    expect(config.statusActiveValues).toEqual(['ACTIVE']);
  });

  it('shows the reporting period dates as DD/MM/YY (A9)', () => {
    const cols = getConfig('reporting-period')!.columns!;
    for (const key of ['start_date', 'end_date', 'stock_take_date', 'production_start_date']) {
      expect(cols.find((c) => c.key === key)!.format).toBe('date');
    }
  });

  it('shows alert rule codes as words (A8)', () => {
    const cols = getConfig('alert-rule')!.columns!;
    const col = (key: string) => cols.find((c) => c.key === key)!;
    expect(formatColumnValue('FEED_BELOW_L1', col('event_type'))).toBe('Feed at or below low level');
    expect(formatColumnValue('CRITICAL_FIRST_PRIORITY', col('priority_level'))).toBe('Urgent');
    expect(formatColumnValue('ON_EACH_OCCURRENCE', col('frequency'))).toBe('Each time the value changes');
    expect(formatColumnValue(['FARM_MANAGER', 'HEAD_OF_FARM'], col('recipient_roles'))).toBe('Farm Manager, Head Of Farm');
    const eventField = getConfig('alert-rule')!.fields.find((f) => f.key === 'event_type')!;
    expect(eventField.options!.map((o) => o.label)).not.toContain('FEED_BELOW_L1');
  });

  it('W4G1: offers the six new alert events and their trigger entities, as words', () => {
    const config = getConfig('alert-rule')!;
    const event = config.fields.find((f) => f.key === 'event_type')!;
    const trigger = config.fields.find((f) => f.key === 'trigger_entity')!;
    const values = event.options!.map((o) => o.value);
    for (const e of ['MILL_DISPATCH', 'MILL_ADJUSTED', 'RECEIPT_VARIANCE', 'NO_NEXT_FEED_ROW', 'NEXT_DIET_NO_SILO', 'CAPACITY_EXCEEDED', 'SHORTFALL', 'NOT_DRAFTED', 'TRUCK_TARGET', 'AUTO_DRAFTED', 'STOCK_TAKE_DUE', 'CHANGEOVER']) expect(values).toContain(e);
    for (const t of ['LOADING_SHEET', 'CONSOLIDATION', 'RECEIPT', 'BATCH']) expect(trigger.options!.map((o) => o.value)).toContain(t);
    expect(formatColumnValue('CAPACITY_EXCEEDED', config.columns!.find((c) => c.key === 'event_type')!)).toBe('Mill capacity exceeded');
    expect(event.options!.every((o) => o.label !== o.value)).toBe(true);
  });

  it('leaves every other column as it was', () => {
    expect(formatColumnValue('2026-09-26', { format: 'date' })).toBe('26/09/26');
    expect(formatColumnValue('X', undefined)).toBeUndefined();
    expect(formatColumnValue(null, { format: 'date' })).toBeUndefined();
    expect(MASTER_DATA_CONFIGS.filter((c) => c.isPrimary).length).toBeGreaterThan(2);
  });

  // Rishi's limit on this task (via the plan owner): the shared master files may
  // change only opt-in per config, so every other master must render exactly as
  // before. No config but these two asks for the new formatting, and a column
  // that asks for none is left to the table's usual display.
  it('asks for no new formatting on any other master, so their lists are unchanged', () => {
    const touched = MASTER_DATA_CONFIGS.filter((c) => (c.columns ?? []).some((col) => col.format || col.labels)).map((c) => c.key);
    expect(touched.sort()).toEqual(['alert-rule', 'bin-diet-assignment', 'reporting-period']);
    for (const key of ['location', 'item', 'breed', 'stage', 'number-series']) {
      const cols = getConfig(key)?.columns ?? [];
      expect(cols.every((col) => !col.format && !col.labels)).toBe(true);
      for (const col of cols) expect(formatColumnValue('ANY_VALUE', col)).toBeUndefined();
    }
  });
});
