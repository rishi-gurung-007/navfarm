import { buildPlan, MASTER_STEPS, RESET_STEP } from './rebuild-demo';

/**
 * The plan Task 3 ordering rules, asserted so a future edit cannot silently
 * re-order the chain or re-admit the nine-farm stage.
 */
describe('rebuild-demo master chain (four-farm plan Task 3)', () => {
  const scripts = (steps: ReturnType<typeof buildPlan>) => steps.map((s) => s.script);

  it('seeds the dev tenant before anything that depends on company scope', () => {
    const list = scripts(MASTER_STEPS);
    expect(list.indexOf('seed-dev-tenant.ts')).toBe(0);
    expect(list.indexOf('migrate-all-tenants.ts')).toBeGreaterThan(list.indexOf('seed-dev-tenant.ts'));
  });

  it('adopts company master templates after the tenant exists and before farm masters', () => {
    const list = scripts(MASTER_STEPS);
    expect(list.indexOf('seed-company-master-templates.ts'))
      .toBeGreaterThan(list.indexOf('migrate-all-tenants.ts'));
    expect(list.indexOf('seed-company-master-templates.ts'))
      .toBeLessThan(list.indexOf('seed-farm-locations.ts'));
  });

  it('runs the four-farm fixture after company scope exists and before the alignment passes', () => {
    const list = scripts(MASTER_STEPS);
    expect(list).toContain('seed-four-farm-feed-demo.ts');
    expect(list.indexOf('seed-four-farm-feed-demo.ts'))
      .toBeGreaterThan(list.indexOf('seed-farm-masters.ts'));
    expect(list.indexOf('seed-four-farm-feed-demo.ts'))
      .toBeLessThan(list.indexOf('stamp-master-nob-lob.ts'));
  });

  it('has retired seed-nine-farm-demo.ts from the active chain', () => {
    expect(scripts(MASTER_STEPS)).not.toContain('seed-nine-farm-demo.ts');
  });

  it('keeps operational chapters out of the master-only chain', () => {
    const list = scripts(MASTER_STEPS);
    for (const operational of ['demo-chapters.ts', 'seed-piggery-complete-data.ts', 'seed-demo-full-coverage.ts', 'seed-animals.ts']) {
      expect(list).not.toContain(operational);
    }
  });

  it('orders the full plan reset -> masters -> chapters', () => {
    const list = scripts(buildPlan({ chaptersOnly: false, skipReset: false }));
    expect(list[0]).toBe(RESET_STEP.script);
    // The chapters step is the orchestrator's tail, and its one operational step.
    expect(list[list.length - 1]).toBe('demo-chapters.ts');
    expect(list.filter((s) => s === 'demo-chapters.ts')).toHaveLength(1);
  });

  it('passes the volume to the chapters step only', () => {
    const plan = buildPlan({ chaptersOnly: false, skipReset: false, volume: 'light' });
    expect(plan[plan.length - 1].args).toContain('--volume=light');
    expect(plan.slice(0, -1).every((s) => !s.args.some((a) => a.startsWith('--volume')))).toBe(true);
    expect(buildPlan({ chaptersOnly: false, skipReset: false }).pop()!.args.some((a) => a.startsWith('--volume'))).toBe(false);
  });

  it('the small preset swaps the four-farm step for the role-structured one and keeps the order', () => {
    const list = scripts(buildPlan({ chaptersOnly: false, skipReset: false, volume: 'light', preset: 'small' }));
    expect(list).not.toContain('seed-four-farm-feed-demo.ts');
    expect(list.indexOf('seed-nine-farm-demo.ts')).toBeGreaterThan(list.indexOf('seed-farm-masters.ts'));
    expect(list.indexOf('seed-nine-farm-demo.ts')).toBeLessThan(list.indexOf('stamp-master-nob-lob.ts'));
    expect(list[list.length - 1]).toBe('demo-chapters.ts');
  });

  it('the small preset seeds no batches; other runs still do', () => {
    const small = buildPlan({ chaptersOnly: false, skipReset: false, volume: 'light', preset: 'small' }).pop()!;
    expect(small.args).toContain('--no-batches');
    expect(buildPlan({ chaptersOnly: false, skipReset: false }).pop()!.args).not.toContain('--no-batches');
  });
});
