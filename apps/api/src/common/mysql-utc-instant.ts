import { BadRequestException } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';

const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;

/** Parses only whole-second instants whose UTC offset is explicit. */
export function parseOffsetInstant(value: string): { epochSeconds: number; utcIso: string } {
  if (!EXPLICIT_OFFSET.test(value)) {
    throw new BadRequestException('Timestamp must include Z or an explicit UTC offset.');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) {
    throw new BadRequestException('Timestamp must be a valid whole-second instant.');
  }
  return { epochSeconds: milliseconds / 1000, utcIso: new Date(milliseconds).toISOString() };
}

/**
 * MySQL converts an epoch to the current session's wall-clock TIMESTAMP value.
 * The represented instant therefore stays identical even when the session is
 * not UTC, unlike binding a UTC-looking date-time string directly.
 */
export function mysqlTimestampFromEpoch(epochSeconds: number): SQL<string> {
  return sql<string>`FROM_UNIXTIME(${epochSeconds})`;
}
