/**
 * P1 follow-up item 8: the self-approval rule exists twice — as isSelfApproval
 * (a row in hand: decide(), release(), the inbox handler) and as SQL (the
 * "Waiting for my approval" list filter, which must leave out the rows the
 * caller could not approve). The SQL used to be re-stated by hand inside
 * findAll(). It is now built by selfApprovalSql, next to isSelfApproval, and
 * this spec proves the two agree on every case.
 *
 * No SQL engine runs inside the unit suite, so the builder's SQL is rendered
 * by drizzle's own MySQL dialect (exactly what the driver receives) and then
 * evaluated with MySQL's three-valued logic by the small evaluator below. It
 * covers only what the builder emits: COALESCE, <>, <=>, AND, OR, NOT,
 * parentheses, string literals, TRUE, FALSE and NULL.
 */
import { sql } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { isSelfApproval, selfApprovalSql } from './requisition.rules';

type V = string | boolean | null;

/** Evaluate one rendered predicate with MySQL semantics (NULL is unknown). */
function evaluate(text: string, params: unknown[]): V {
  const tokens = text.match(/<=>|<>|'(?:[^']|'')*'|\?|[(),]|[A-Za-z_]+/g) ?? [];
  let at = 0;
  let param = 0;
  const peek = () => tokens[at]?.toUpperCase();
  const take = (want?: string) => {
    const t = tokens[at++];
    if (want && t?.toUpperCase() !== want) throw new Error(`expected ${want}, got ${t}`);
    return t;
  };
  const and3 = (a: V, b: V): V => (a === false || b === false ? false : a === null || b === null ? null : true);
  const or3 = (a: V, b: V): V => (a === true || b === true ? true : a === null || b === null ? null : false);
  const atom = (): V => {
    const t = take();
    const u = t.toUpperCase();
    if (t === '?') return params[param++] as V;
    if (t === '(') { const v = or(); take(')'); return v; }
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (u === 'NULL') return null;
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    if (u === 'NOT') { const v = comparison(); return v === null ? null : !v; }
    if (u === 'COALESCE') {
      take('(');
      const args = [or()];
      while (peek() === ',') { take(','); args.push(or()); }
      take(')');
      return args.find((a) => a !== null) ?? null;
    }
    throw new Error(`unexpected token ${t}`);
  };
  const comparison = (): V => {
    const left = atom();
    if (peek() === '<>') { take(); const right = atom(); return left === null || right === null ? null : left !== right; }
    if (peek() === '<=>') { take(); const right = atom(); return left === right; }
    return left;
  };
  const and = (): V => { let v = comparison(); while (peek() === 'AND') { take(); v = and3(v, comparison()); } return v; };
  const or = (): V => { let v = and(); while (peek() === 'OR') { take(); v = or3(v, and()); } return v; };
  const result = or();
  if (at !== tokens.length) throw new Error(`trailing tokens: ${tokens.slice(at).join(' ')}`);
  return result;
}

const dialect = new MySqlDialect();
/** The builder's SQL for one row, its columns bound as parameters. */
function sqlSays(row: { source: string | null; created_by: string | null; requester_user_id: string | null }, userId: string | undefined): V {
  const q = dialect.sqlToQuery(selfApprovalSql(
    { source: sql`${row.source}`, created_by: sql`${row.created_by}`, requester_user_id: sql`${row.requester_user_id}` },
    userId,
  ));
  return evaluate(q.sql, q.params);
}

const SOURCES = ['MANUAL_ENTRY', 'AUTO_FORECAST', null, ''];
const PEOPLE = ['u1', 'u2', null];
const CALLERS = ['u1', 'u2', undefined];
const CASES = SOURCES.flatMap((source) => PEOPLE.flatMap((created_by) => PEOPLE.flatMap((requester_user_id) =>
  CALLERS.map((userId) => ({ row: { source, created_by, requester_user_id }, userId })))));

describe('selfApprovalSql — the SQL form of isSelfApproval', () => {
  it(`agrees with isSelfApproval on all ${CASES.length} cases, and is never NULL (so NOT(...) keeps exactly the rows the caller may approve)`, () => {
    for (const { row, userId } of CASES) {
      const js = isSelfApproval(row, userId);
      const db = sqlSays(row, userId);
      if (db !== js) throw new Error(`disagree on ${JSON.stringify({ row, userId })}: isSelfApproval=${js}, SQL=${db}`);
    }
  });

  it('pins the cases the rule is about', () => {
    const manual = { source: 'MANUAL_ENTRY', created_by: 'u1', requester_user_id: 'u1' };
    expect(sqlSays(manual, 'u1')).toBe(true);
    expect(sqlSays({ ...manual, source: null }, 'u1')).toBe(true); // a legacy row with no source is manual
    expect(sqlSays({ ...manual, created_by: 'u9' }, 'u1')).toBe(true); // the requester alone is enough
    expect(sqlSays({ ...manual, source: 'AUTO_FORECAST' }, 'u1')).toBe(false); // system drafts are exempt
    expect(sqlSays(manual, 'u2')).toBe(false);
    expect(sqlSays(manual, undefined)).toBe(false);
  });

  it('the evaluator itself follows MySQL: NULL <> x is unknown, NULL <=> NULL is true', () => {
    expect(evaluate('? <> ?', [null, 'a'])).toBeNull();
    expect(evaluate('? <=> ?', [null, null])).toBe(true);
    expect(evaluate('NOT (? <> ?)', [null, 'a'])).toBeNull();
    expect(evaluate("COALESCE(?, '') <> 'X'", [null])).toBe(true);
  });
});
