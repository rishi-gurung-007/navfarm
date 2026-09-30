import { MASTER_DATA_CONFIGS, MASTER_DATA_NAV_ORDER, getConfig } from '../src/modules/master-data/configs';
import { formatColumnValue } from '../src/modules/master-data/column-format';

describe('Reporting Period configuration and Alert Rules navigation', () => {
  it('keeps Alert Rules in Farm Masters', () => {
    const config = getConfig('alert-rule')!;
    expect(config.isPrimary).toBe(true);
    expect(config.group).toBe('Farm Operations');
    expect(config.businessAdminOnly).toBe(true);
    expect(MASTER_DATA_NAV_ORDER).toContain('alert-rule');
  });

  it('places Reporting Periods in Settings, not Farm Masters', () => {
    const config = getConfig('reporting-period')!;
    expect(config.isPrimary).toBe(false);
    expect(config.group).toBe('Settings');
    expect(config.businessAdminOnly).toBe(true);
    expect(MASTER_DATA_NAV_ORDER).not.toContain('reporting-period');
    expect(config.draftLifecycle).toEqual({ activatePath: 'activate' });
  });

  it('shows draft status and keeps generated reporting periods reviewable before activation', () => {
    const config = getConfig('reporting-period')!;
    expect(config.columns).toContainEqual({ key: 'status', label: 'Status' });
    expect(config.draftLifecycle).toEqual({ activatePath: 'activate' });
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
    expect(touched.sort()).toEqual(['alert-rule', 'reporting-period']);
    for (const key of ['location', 'item', 'breed', 'stage', 'number-series']) {
      const cols = getConfig(key)?.columns ?? [];
      expect(cols.every((col) => !col.format && !col.labels)).toBe(true);
      for (const col of cols) expect(formatColumnValue('ANY_VALUE', col)).toBeUndefined();
    }
  });
});
