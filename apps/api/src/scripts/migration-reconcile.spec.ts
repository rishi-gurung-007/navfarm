import {
  alreadyThere,
  migrationHash,
  missingMigrations,
  statementsOf,
} from './migration-reconcile';

describe('migration reconcile (pure)', () => {
  it('hashes a migration the way drizzle does: sha256 of the file text', () => {
    expect(migrationHash('x')).toBe(
      '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',
    );
    expect(migrationHash('x')).toHaveLength(64);
  });

  it('splits a file into drizzle statements and drops empty ones', () => {
    const sql =
      'ALTER TABLE a ADD b int;\n--> statement-breakpoint\n\nCREATE INDEX i ON a (b);\n--> statement-breakpoint\n';
    expect(statementsOf(sql)).toEqual([
      'ALTER TABLE a ADD b int;',
      'CREATE INDEX i ON a (b);',
    ]);
  });

  it('lists the migrations a database has not recorded, in journal order, whatever their dates', () => {
    const journal = [
      { idx: 0, when: 10, tag: 'a', hash: 'ha' },
      { idx: 1, when: 20, tag: 'b', hash: 'hb' },
      { idx: 2, when: 30, tag: 'c', hash: 'hc' },
    ];
    // The database ran c (the latest) but never b: drizzle's date rule would skip b, this does not.
    expect(missingMigrations(journal, ['ha', 'hc']).map((m) => m.tag)).toEqual([
      'b',
    ]);
    expect(missingMigrations(journal, ['ha', 'hb', 'hc'])).toEqual([]);
    expect(missingMigrations(journal, []).map((m) => m.tag)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('treats the "already exists" MySQL errors as done, and nothing else', () => {
    for (const errno of [1050, 1060, 1061, 1826])
      expect(alreadyThere({ errno })).toBe(true);
    for (const errno of [1064, 1146, 1215, 1451])
      expect(alreadyThere({ errno })).toBe(false);
    expect(alreadyThere(new Error('plain'))).toBe(false);
    expect(alreadyThere(null)).toBe(false);
  });
});
