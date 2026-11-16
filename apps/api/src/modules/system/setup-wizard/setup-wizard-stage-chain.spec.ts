import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { SQL, getTableName } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { SetupWizardService } from './setup-wizard.service';
import { NumberSeriesService } from '../number-series/number-series.service';
import { StageService } from '../../production/stage/stage.service';

/**
 * The new-tenant chain after the 12 Oct ruling: a company starts BLANK.
 *
 * 1. tenant signup seeds tenant-template Number Series rows (STAGE included)
 *    and a placeholder company — simulated as the store's initial state;
 * 2. the Setup Wizard's step 1 claims that placeholder in place and copies
 *    nothing, so the company owns no number series until it creates one;
 * 3. Stage preview/create at company scope never falls back to the tenant
 *    template: without a company series the code is entered by hand, and once
 *    the company has its own series it counts independently of the template.
 *
 * Everything between is the real code: SetupWizardService, NumberSeriesService
 * and StageService, over one in-memory store. Conditions are evaluated by
 * rendering them with sqlToQuery (the same trick master-data-scope.spec.ts
 * uses), so the scope clauses under test are the real ones, not stubs.
 */

const TENANT = 'tenant-1';
const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

type Row = Record<string, unknown>;

function fakeDb(store: Record<string, Row[]>) {
  const dialect = new MySqlDialect();

  const matches = (row: Row, condition: SQL | undefined): boolean => {
    if (!condition) return true;
    const { sql, params } = dialect.sqlToQuery(condition);
    let paramIndex = 0;
    const nextParam = () => params[paramIndex++];
    const text = sql.replace(/`/g, '');

    const atom = (raw: string): boolean => {
      const t = raw.trim();
      if (!t || t === '1=1') return true;
      let m = /^(?:\w+\.)?(\w+)\s*=\s*\?$/.exec(t);
      if (m) return row[m[1]] === nextParam();
      m = /^(?:\w+\.)?(\w+)\s+is\s+null$/i.exec(t);
      if (m) return row[m[1]] == null;
      if (t.startsWith('(') && t.endsWith(')')) return expr(t.slice(1, -1));
      throw new Error(`Fake DB cannot evaluate condition: ${t}`);
    };

    // Top-level split on and/or, honouring parentheses. MySQL precedence:
    // AND binds tighter than OR, so the or-split runs first. Tokens are
    // whitespace-separated; parentheses attach to tokens and adjust depth.
    const splitTop = (text: string, keyword: 'and' | 'or'): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      for (const token of text.split(/\s+/)) {
        if (depth === 0 && token.toLowerCase() === keyword) {
          parts.push(current);
          current = '';
          continue;
        }
        depth += (token.match(/\(/g) || []).length - (token.match(/\)/g) || []).length;
        current += (current ? ' ' : '') + token;
      }
      parts.push(current);
      return parts;
    };

    const expr = (text: string): boolean => {
      const orParts = splitTop(text, 'or');
      if (orParts.length > 1) return orParts.some((part) => expr(part));
      const andParts = splitTop(text, 'and');
      if (andParts.length > 1) return andParts.every((part) => expr(part));
      return atom(text);
    };

    return expr(text);
  };

  const rowsFor = (table: unknown): Row[] => {
    const name = getTableName(table as any);
    if (!store[name]) store[name] = [];
    return store[name];
  };

  // One thenable builder: every chain position is awaitable and every method
  // is present, so the fake matches whichever terminal the caller uses.
  const build = (rows: Row[]): any => {
    let result = rows;
    const chain: any = {
      orderBy: () => chain,
      limit: (n: number) => {
        result = result.slice(0, n);
        return chain;
      },
      for: async () => result,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };

  const db: any = {
    select: (fields?: any) => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const rows = rowsFor(table).filter((row) => matches(row, condition));
          // The only aggregate these paths select is { n: count() } — drizzle
          // renders it as SQL, so the select is an aggregation, not rows.
          const isCount = fields && typeof fields === 'object'
            && Object.values(fields).some((f: any) => f instanceof SQL);
          return build(isCount ? [{ n: rows.length }] : rows);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (row: Row) => {
        rowsFor(table).push(row);
        return {};
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: async (condition: SQL) => {
          for (const row of rowsFor(table)) {
            if (matches(row, condition)) Object.assign(row, values);
          }
        },
      }),
    }),
    transaction: async (work: (tx: any) => Promise<unknown>) => work(db),
  };
  return db;
}

/** The no_series rows TenantService.signup writes — STAGE among them. */
const tenantStageTemplate = (over: Partial<Row> = {}): Row => ({
  id: 'tpl-stage',
  tenant_id: TENANT,
  company_id: null,
  code: 'STAGE',
  description: 'Stage Code',
  document_type: 'STAGE',
  prefix: 'STG',
  separator: '-',
  seq_length: 3,
  current_seq: 99,
  reset_frequency: 'NEVER',
  manual_nos: true,
  blocked: false,
  deleted_at: null,
  updated_at: new Date().toISOString(),
  ...over,
});

const placeholderCompany = (): Row => ({
  company_id: PLACEHOLDER_ID,
  tenant_id: TENANT,
  company_code: 'PLACEHOLDER',
  company_name: 'Placeholder Company',
  onboarding_status: 'PENDING',
  is_active: true,
});

const auditLog = () => ({ log: jest.fn().mockResolvedValue({}) });

const clsFor = (db: unknown) => ({ get: (key: string) => (key === 'tenantPostingTransaction' ? true : key === 'tenantDb' ? db : undefined) }) as unknown as ClsService;

describe('new tenant -> wizard claims placeholder -> Stage preview/create', () => {
  const profile = {
    tenant_id: TENANT,
    company_code: 'TRIPLEC',
    company_name: 'Triple C Piggery',
    company_type: 'Private Limited',
    industry_type: 'Piggery',
  } as any;

  it('copies no number series on claim; a series the company creates counts independently', async () => {
    const store: Record<string, Row[]> = {
      no_series: [tenantStageTemplate()],
      company_master: [placeholderCompany()],
      // A role already bound to the placeholder skips default-role seeding in step 1.
      role_master: [{ role_id: 'role-1', company_id: PLACEHOLDER_ID }],
    };
    const db = fakeDb(store);

    const wizard = new SetupWizardService({} as any, clsFor(db), auditLog() as any, {} as any);
    const numberSeries = new NumberSeriesService(clsFor(db), auditLog() as any, { resolve: jest.fn() } as any);

    // Step 1 of the wizard, no company_id yet — the placeholder claim.
    const saved = await wizard.saveStep1Profile(profile);
    expect(saved.company_code).toBe('TRIPLEC');

    // Blank company: nothing was copied from the tenant template.
    expect(store.no_series).toHaveLength(1);
    expect(store.no_series.some((row) => row.company_id === PLACEHOLDER_ID)).toBe(false);
    await expect(numberSeries.previewCode({ master: 'STAGE' } as any, TENANT, PLACEHOLDER_ID))
      .resolves.toMatchObject({ generated: false, allowManual: true });

    // The company then creates its own STAGE series (as a user would).
    const companyStage = tenantStageTemplate({ id: 'co-stage', company_id: PLACEHOLDER_ID, current_seq: 0, last_no_used: null });
    store.no_series.push(companyStage);

    const preview = await numberSeries.previewCode({ master: 'STAGE' } as any, TENANT, PLACEHOLDER_ID);
    expect(preview).toMatchObject({ generated: true, seriesCode: 'STAGE', preview: 'STG-001' });
    const locked = await numberSeries.lockSeries('STAGE', TENANT, PLACEHOLDER_ID);
    expect(locked.id).toBe('co-stage');

    await expect(numberSeries.generateNext('STAGE', TENANT, PLACEHOLDER_ID)).resolves.toBe('STG-001');
    expect(companyStage.current_seq).toBe(1);
    expect(store.no_series.find((row) => row.id === 'tpl-stage')!.current_seq).toBe(99);
  });

  it('a company without a snapshot is not offered the tenant template at all', async () => {
    const store: Record<string, Row[]> = {
      no_series: [tenantStageTemplate()],
      company_master: [placeholderCompany()],
    };
    const db = fakeDb(store);
    const numberSeries = new NumberSeriesService(clsFor(db), auditLog() as any, { resolve: jest.fn() } as any);

    // No wizard claim happened — the company holds no snapshot of its own.
    await expect(numberSeries.previewCode({ master: 'STAGE' } as any, TENANT, PLACEHOLDER_ID))
      .resolves.toMatchObject({ generated: false, allowManual: true });
    await expect(numberSeries.lockSeries('STAGE', TENANT, PLACEHOLDER_ID)).rejects.toThrow(/not found/);
  });

  it('Stage create in a blank wizard-onboarded company asks for a code, then consumes its own series', async () => {
    const store: Record<string, Row[]> = {
      no_series: [tenantStageTemplate()],
      company_master: [placeholderCompany()],
      role_master: [{ role_id: 'role-1', company_id: PLACEHOLDER_ID }],
      stage_master: [],
      nob_master: [{ nob_id: 'nob-1', nob_code: 'LIVESTOCK' }],
      lob_master: [{ lob_id: 'lob-1', lob_code: 'LVS_PIGGERY' }],
    };
    const db = fakeDb(store);

    const wizard = new SetupWizardService({} as any, clsFor(db), auditLog() as any, {} as any);
    await wizard.saveStep1Profile(profile);

    const numberSeries = new NumberSeriesService(clsFor(db), auditLog() as any, { resolve: jest.fn() } as any);
    const stage = new StageService(
      clsFor(db),
      auditLog() as any,
      numberSeries,
      { resolve: jest.fn().mockResolvedValue({ nob_id: 'nob-1', lob_id: 'lob-1' }) } as any,
    );
    const dto = {
      stage_name: 'Grower',
      stage_category: 'PRODUCTIVE',
      stage_sequence: 13,
      transition_trigger: 'AUTO_BY_DAY',
      auto_move_on_day: 42,
      typical_duration_days: 42,
      company_id: PLACEHOLDER_ID,
    } as any;

    // Blank company: the tenant template is not used, so a code must be typed.
    await expect(stage.create(dto, TENANT)).rejects.toThrow(/no number series is configured/);

    const companyStage = tenantStageTemplate({ id: 'co-stage', company_id: PLACEHOLDER_ID, current_seq: 0, last_no_used: null });
    store.no_series.push(companyStage);
    const created = await stage.create(dto, TENANT);

    expect(created.stage_code).toBe('STG-001');
    expect(companyStage.current_seq).toBe(1);
    // The tenant template's counter never moved.
    expect(store.no_series.find((row) => row.id === 'tpl-stage')!.current_seq).toBe(99);
  });
});
