import { SHED_ROLES_BY_STAGE, shedForStage } from './batch-helpers';
import type { DemoFarm, DemoShed, ShedRole } from './farms';

function shed(code: string, role: ShedRole | null, siloId: string | null): DemoShed {
  return {
    shedId: `id-${code}`,
    code,
    name: code,
    role,
    siloIds: siloId ? [siloId] : [],
    siloCodes: siloId ? [`${siloId}-code`] : [],
    siloId,
    siloCode: siloId ? `${siloId}-code` : null,
    penIds: [],
  };
}

function farm(sheds: DemoShed[]): DemoFarm {
  return { code: 'TST100', sheds } as unknown as DemoFarm;
}

describe('shedForStage', () => {
  it('stands a stage in a shed of its role that has a silo', () => {
    const f = farm([
      shed('TST100/SHED-001', 'GILT', 'silo-1'),
      shed('TST100/SHED-002', 'DRY_SOW', 'silo-2'),
      shed('TST100/SHED-003', 'FARROWING', 'silo-3'),
    ]);
    expect(shedForStage(f, 'GESTATION')?.code).toBe('TST100/SHED-002');
    expect(shedForStage(f, 'LACTATION')?.code).toBe('TST100/SHED-003');
    expect(shedForStage(f, 'GILT_GROWER')?.code).toBe('TST100/SHED-001');
  });

  it('prefers a matching shed with a silo over an earlier one without', () => {
    const f = farm([
      shed('TST100/SHED-001', 'WEANER', null),
      shed('TST100/SHED-002', 'WEANER', 'silo-2'),
    ]);
    expect(shedForStage(f, 'WEANER')?.code).toBe('TST100/SHED-002');
  });

  it('falls back to a matching shed without a silo (the forecast then draws on the store, D6)', () => {
    const f = farm([shed('TST100/SHED-001', 'BOAR', null)]);
    expect(shedForStage(f, 'QUARANTINE')?.code).toBe('TST100/SHED-001');
  });

  it('returns null when no shed carries the stage role', () => {
    const f = farm([shed('TST100/SHED-001', 'WEANER', 'silo-1'), shed('TST100/SHED-002', 'GROWER', 'silo-2')]);
    expect(shedForStage(f, 'FINISHER')).toBeNull();
    expect(shedForStage(f, 'BOAR_AI')).toBeNull();
  });

  it('returns null for a stage with no shed role at all', () => {
    const f = farm([shed('TST100/SHED-001', 'DRY_SOW', 'silo-1')]);
    expect(shedForStage(f, 'SOLD')).toBeNull();
  });

  it('picks the first matching shed in code order, every time', () => {
    const f = farm([
      shed('TST100/SHED-001', 'GILT_REARING', 'silo-1'),
      shed('TST100/SHED-002', 'GILT', 'silo-2'),
    ]);
    expect(shedForStage(f, 'GILT_GROWER')?.code).toBe('TST100/SHED-001');
    expect(shedForStage(f, 'GILT_GROWER')?.code).toBe('TST100/SHED-001');
  });

  it('maps every stage the demo creates a batch at', () => {
    for (const code of ['GESTATION', 'WEANER', 'GROWER', 'FINISHER', 'LACTATION', 'QUARANTINE', 'GILT_GROWER', 'FLUSH', 'INSEMINATION', 'FARROWING', 'BOAR_AI']) {
      expect(SHED_ROLES_BY_STAGE[code]?.length).toBeGreaterThan(0);
    }
  });
});
