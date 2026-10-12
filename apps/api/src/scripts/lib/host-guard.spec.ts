import { assertLocalHost } from './host-guard';

/**
 * Part E Task 4b fix round 1, Important 3: recompute-transfer-status.ts
 * rewrites document statuses and had no refusal for a non-local host at all
 * — its sibling align-feed-tdd.ts:58 has refused anything but
 * 127.0.0.1/localhost/::1 all along. assertLocalHost is that same guard,
 * shared so a third script never has to retype it.
 */
describe('assertLocalHost', () => {
  it('allows 127.0.0.1, localhost and ::1', () => {
    expect(() => assertLocalHost('127.0.0.1', undefined)).not.toThrow();
    expect(() => assertLocalHost('localhost', undefined)).not.toThrow();
    expect(() => assertLocalHost('::1', undefined)).not.toThrow();
  });

  it('refuses a remote host', () => {
    expect(() => assertLocalHost('gateway01.tidbcloud.com', undefined))
      .toThrow('Refusing to run against non-local host gateway01.tidbcloud.com.');
  });

  it('a remote host is allowed only with an explicit override', () => {
    expect(() => assertLocalHost('gateway01.tidbcloud.com', '1')).not.toThrow();
  });
});
