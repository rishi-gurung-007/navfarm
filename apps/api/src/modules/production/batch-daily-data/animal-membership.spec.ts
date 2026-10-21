import { animalsInBatchOn, placementOn, type AnimalNow, type MovementRow } from './animal-membership';

const move = (movement_type: string, event_date: string, p: Partial<MovementRow> = {}): MovementRow => ({
  movement_type,
  event_date,
  created_at: `${event_date} 08:00:00`,
  from_batch_id: null,
  to_batch_id: null,
  from_stage_id: null,
  to_stage_id: null,
  ...p,
});
const live = (batch: string | null, stage: string | null): AnimalNow => ({ current_batch_id: batch, current_stage_id: stage, is_active: true });

describe('placementOn - who was where on a date (Rishi, 21 Oct)', () => {
  // The gilt of BATCH-000132: gestation until farrowing on 14 Aug, then lactation, then flush.
  const gilt = [
    move('STAGE_CHANGE', '2026-04-23', { from_batch_id: 'B', to_batch_id: 'B', from_stage_id: 'SERVICE', to_stage_id: 'GEST' }),
    move('STAGE_CHANGE', '2026-08-11', { from_batch_id: 'B', to_batch_id: 'B', from_stage_id: 'GEST', to_stage_id: 'FARROW' }),
    move('STAGE_CHANGE', '2026-09-15', { from_batch_id: 'B', to_batch_id: 'B', from_stage_id: 'FARROW', to_stage_id: 'LACT' }),
    move('STAGE_CHANGE', '2026-09-19', { from_batch_id: 'B', to_batch_id: 'B', from_stage_id: 'LACT', to_stage_id: 'FLUSH' }),
  ];

  it('reads the stage she was at on the date, not the one she is at now', () => {
    const now = live('B', 'FLUSH');
    expect(placementOn(gilt, now, '2026-08-09')).toEqual({ batch_id: 'B', stage_id: 'GEST' });
    expect(placementOn(gilt, now, '2026-09-01')).toEqual({ batch_id: 'B', stage_id: 'FARROW' });
    expect(placementOn(gilt, now, '2026-10-21')).toEqual({ batch_id: 'B', stage_id: 'FLUSH' });
  });

  it('before her first stage change she was at the stage that change came from', () => {
    expect(placementOn(gilt, live('B', 'FLUSH'), '2026-04-19')).toEqual({ batch_id: 'B', stage_id: 'SERVICE' });
  });

  it('on the day she moves she belongs to the stage and batch she moved into', () => {
    expect(placementOn(gilt, live('B', 'FLUSH'), '2026-08-11').stage_id).toBe('FARROW');
    const moved = [move('TRANSFER', '2026-05-01', { from_batch_id: 'A', to_batch_id: 'B', from_stage_id: 'S', to_stage_id: 'S' })];
    expect(placementOn(moved, live('B', 'S'), '2026-05-01').batch_id).toBe('B');
    expect(placementOn(moved, live('B', 'S'), '2026-04-30').batch_id).toBe('A');
  });

  it('a transfer out ends membership of the old batch and starts the new one', () => {
    const rows = [
      move('ASSIGN', '2026-01-01', { to_batch_id: 'A', to_stage_id: 'S1' }),
      move('TRANSFER', '2026-03-01', { from_batch_id: 'A', to_batch_id: 'B', from_stage_id: 'S1', to_stage_id: 'S2' }),
    ];
    const now = live('B', 'S2');
    expect(placementOn(rows, now, '2025-12-31')).toEqual({ batch_id: null, stage_id: 'S1' });
    expect(placementOn(rows, now, '2026-02-28')).toEqual({ batch_id: 'A', stage_id: 'S1' });
    expect(placementOn(rows, now, '2026-03-01')).toEqual({ batch_id: 'B', stage_id: 'S2' });
  });

  it('a cull, disposal, death or unassignment ends membership from that day', () => {
    for (const type of ['CULL', 'DISPOSAL', 'MORTALITY', 'UNASSIGN']) {
      const rows = [move('ASSIGN', '2026-01-01', { to_batch_id: 'A', to_stage_id: 'S' }), move(type, '2026-02-01', { from_batch_id: 'A', from_stage_id: 'S' })];
      const gone: AnimalNow = { current_batch_id: type === 'UNASSIGN' ? null : 'A', current_stage_id: 'S', is_active: false };
      expect(placementOn(rows, gone, '2026-01-31').batch_id).toBe('A');
      expect(placementOn(rows, gone, '2026-02-01').batch_id).toBeNull();
    }
  });

  it('puts a death back when it is reversed', () => {
    const rows = [
      move('ASSIGN', '2026-01-01', { to_batch_id: 'A', to_stage_id: 'S' }),
      move('MORTALITY', '2026-02-01', { from_batch_id: 'A' }),
      move('MORTALITY_REVERSED', '2026-02-03', { to_batch_id: 'A' }),
    ];
    expect(placementOn(rows, live('A', 'S'), '2026-02-02').batch_id).toBeNull();
    expect(placementOn(rows, live('A', 'S'), '2026-02-03').batch_id).toBe('A');
  });

  it('orders rows of one day by when they were written', () => {
    const rows = [
      move('TRANSFER', '2026-03-01', { from_batch_id: 'B', to_batch_id: 'C', created_at: '2026-03-01 10:00:00' }),
      move('TRANSFER', '2026-03-01', { from_batch_id: 'A', to_batch_id: 'B', created_at: '2026-03-01 09:00:00' }),
    ];
    expect(placementOn(rows, live('C', null), '2026-03-01').batch_id).toBe('C');
  });

  it('a stage change after a transfer out never puts her back in the old batch', () => {
    const rows = [
      move('TRANSFER', '2026-10-04', { from_batch_id: 'A', to_batch_id: 'B', from_stage_id: 'S', to_stage_id: 'S' }),
      move('STAGE_CHANGE', '2026-10-07', { from_batch_id: 'A', to_batch_id: 'A', from_stage_id: 'S', to_stage_id: 'T' }),
    ];
    expect(placementOn(rows, live('B', 'T'), '2026-10-08')).toEqual({ batch_id: 'B', stage_id: 'T' });
  });

  it('an animal the log never mentions is where the register has it, while it is live', () => {
    expect(placementOn([], live('A', 'S'), '2026-01-01')).toEqual({ batch_id: 'A', stage_id: 'S' });
    expect(placementOn([], { current_batch_id: 'A', current_stage_id: 'S', is_active: false }, '2026-01-01').batch_id).toBeNull();
  });
});

describe('animalsInBatchOn', () => {
  const chain = (rows: unknown[]) => {
    const c: any = {};
    for (const m of ['from', 'where', 'orderBy']) c[m] = jest.fn(() => c);
    c.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, fail);
    return c;
  };

  it('lists the animals of the batch on the date with the stage each was at, including ones that have left since', async () => {
    const moves = [
      { animal_id: 'x', ...move('ASSIGN', '2026-01-01', { to_batch_id: 'B', to_stage_id: 'S1' }) },
      { animal_id: 'x', ...move('TRANSFER', '2026-03-01', { from_batch_id: 'B', to_batch_id: 'C', from_stage_id: 'S1', to_stage_id: 'S1' }) },
      { animal_id: 'y', ...move('ASSIGN', '2026-02-01', { to_batch_id: 'B', to_stage_id: 'S1' }) },
      { animal_id: 'y', ...move('STAGE_CHANGE', '2026-04-01', { from_batch_id: 'B', to_batch_id: 'B', from_stage_id: 'S1', to_stage_id: 'S2' }) },
    ];
    const db: any = {
      selectDistinct: jest.fn(() => chain([{ animal_id: 'x' }, { animal_id: 'y' }])),
      select: jest
        .fn()
        .mockReturnValueOnce(chain([{ animal_id: 'y' }])) // held by the register now
        .mockReturnValueOnce(
          chain([
            { animal_id: 'x', current_batch_id: 'C', current_stage_id: 'S1', is_active: true },
            { animal_id: 'y', current_batch_id: 'B', current_stage_id: 'S2', is_active: true },
          ]),
        )
        .mockReturnValueOnce(chain(moves)),
    };
    const on = async (date: string) => (await animalsInBatchOn(db, 'B', date)).sort((a, b) => a.animal_id.localeCompare(b.animal_id));
    // each call reloads; re-arm the select mocks per call
    const arm = () =>
      db.select
        .mockReturnValueOnce(chain([{ animal_id: 'y' }]))
        .mockReturnValueOnce(
          chain([
            { animal_id: 'x', current_batch_id: 'C', current_stage_id: 'S1', is_active: true },
            { animal_id: 'y', current_batch_id: 'B', current_stage_id: 'S2', is_active: true },
          ]),
        )
        .mockReturnValueOnce(chain(moves));
    expect(await on('2026-02-15')).toEqual([
      { animal_id: 'x', stage_id: 'S1' },
      { animal_id: 'y', stage_id: 'S1' },
    ]);
    arm();
    expect(await on('2026-03-01')).toEqual([{ animal_id: 'y', stage_id: 'S1' }]);
    arm();
    expect(await on('2025-12-01')).toEqual([]);
  });
});
