import { assertCanonicalLineage, isMissingTableError } from './migration-lineage';

describe('migration lineage preflight', () => {
  it('recognises only a missing-table error', () => {
    expect(isMissingTableError({ code: 'ER_NO_SUCH_TABLE', errno: 1146 })).toBe(true);
    expect(isMissingTableError({ errno: 1146 })).toBe(true);
    expect(isMissingTableError({ code: 'ER_ACCESS_DENIED_ERROR', errno: 1045 })).toBe(false);
    expect(isMissingTableError(new Error('boom'))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });

  it('accepts journal 0 (empty database), baseline and complete lineages', () => {
    expect(() => assertCanonicalLineage(0, false)).not.toThrow();
    expect(() => assertCanonicalLineage(142, false)).not.toThrow();
    expect(() => assertCanonicalLineage(164, true)).not.toThrow();
  });

  it('refuses the in-between and older-feed lineages', () => {
    expect(() => assertCanonicalLineage(143, false)).toThrow(/Unsupported tenant migration lineage/);
    expect(() => assertCanonicalLineage(150, true)).toThrow(/Unsupported/);
    expect(() => assertCanonicalLineage(100, true)).toThrow(/Unsupported/);
  });
});
