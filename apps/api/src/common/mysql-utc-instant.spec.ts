import { BadRequestException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { mysqlTimestampFromEpoch, parseOffsetInstant } from './mysql-utc-instant';

describe('UTC-safe MySQL instant handling', () => {
  it.each([
    ['2026-10-01T08:15:00.000Z', 1790842500],
    ['2026-10-01T10:15:00+02:00', 1790842500],
  ])('normalizes the offset-bearing instant %s to Unix seconds', (value, expected) => {
    expect(parseOffsetInstant(value)).toEqual({ epochSeconds: expected, utcIso: '2026-10-01T08:15:00.000Z' });
  });

  it.each(['2026-10-01T08:15:00', '2026-10-01', '2026-10-01T08:15:00.123Z'])
    ('rejects an ambiguous or sub-second instant %s', (value) => {
      expect(() => parseOffsetInstant(value)).toThrow(BadRequestException);
    });

  it('renders an epoch-based TIMESTAMP expression that is independent of the MySQL session timezone', () => {
    const rendered = new MySqlDialect().sqlToQuery(mysqlTimestampFromEpoch(1790842500));
    expect(rendered.sql.toLowerCase()).toBe('from_unixtime(?)');
    expect(rendered.params).toEqual([1790842500]);
  });
});
