/**
 * What Finance is told about bio-asset costing (bio-asset costing, Phase 4). Pure: the scheduler's due report goes in, the notices that should exist come out; the
 * scheduler writes them as in-app alerts, once for each item, set of periods and reason (a notice that was already raised is not raised again, read or not).
 *
 *  - periods are due and nothing has been run: WARNING when a person must run them, INFO when the item posts by itself;
 *  - a calculated run waits to be posted: WARNING (the item is paused behind it);
 *  - a period keeps failing: CRITICAL (the scheduler has stopped retrying it).
 * An item with no Costing From date or no dated animal is a setup matter, not a due run: no notice [ours].
 */
export const BIO_COSTING_ALERT_TYPE = 'BIO_COSTING_DUE';

export interface DueLineFacts {
  item_id: string;
  item_code: string;
  auto_post: boolean;
  due_periods: string[];
  blocked: { reason: 'WAITING_TO_POST'; run_no: string | null; period_key: string } | { reason: 'TOO_MANY_FAILURES'; period_key: string; attempts: number; error: string | null } | null;
}

export interface DueNotice {
  item_id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
}

const WHERE = 'Finance > Bio-Asset Costing Runs';

export function dueNotices(lines: DueLineFacts[]): DueNotice[] {
  const out: DueNotice[] = [];
  for (const l of lines) {
    if (l.blocked?.reason === 'WAITING_TO_POST') {
      out.push({
        item_id: l.item_id, severity: 'WARNING', title: `Costing run waiting to be posted: ${l.item_code} ${l.blocked.period_key}`.slice(0, 200),
        message: `Run ${l.blocked.run_no ?? ''} for ${l.item_code}, period ${l.blocked.period_key}, is calculated and waiting to be posted. Open ${WHERE}, check it and post it. Costing for ${l.item_code} is paused until then.`.replace('Run  for', 'The run for'),
      });
    } else if (l.blocked?.reason === 'TOO_MANY_FAILURES') {
      out.push({
        item_id: l.item_id, severity: 'CRITICAL', title: `Costing run keeps failing: ${l.item_code} ${l.blocked.period_key}`.slice(0, 200),
        message: `The run for ${l.item_code}, period ${l.blocked.period_key}, failed ${l.blocked.attempts} times and is no longer retried automatically${l.blocked.error ? `: ${l.blocked.error}` : ''}. Open ${WHERE}, fix the cause and use Run due now.`,
      });
    } else if (!l.blocked && l.due_periods.length) {
      const first = l.due_periods[0];
      const last = l.due_periods[l.due_periods.length - 1];
      const periods = first === last ? first : `${first} to ${last}`;
      out.push({
        item_id: l.item_id, severity: l.auto_post ? 'INFO' : 'WARNING', title: `Costing run due: ${l.item_code} ${periods}`.slice(0, 200),
        message: l.auto_post
          ? `${l.item_code} is due for costing for ${l.due_periods.join(', ')}. It posts automatically when the scheduler next runs; you can follow it in ${WHERE}.`
          : `${l.item_code} is due for costing for ${l.due_periods.join(', ')}. Open ${WHERE}, calculate it, check it and post it.`,
      });
    }
  }
  return out;
}
