'use client';

import { NA } from '@/utils/na';
import { useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { api } from '@/services/api-client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';

type Row = Record<string, any>;

/** What the API's batch create / stage transfer take as `scheduler_source`. */
export type SchedulerSource = 'SYSTEM' | 'EMPTY';

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

/**
 * "Copy activities from the system scheduler?" — asked before a batch is
 * created or moved into a stage, and only when a system scheduler matches.
 * `ask()` resolves to the answer to send as scheduler_source, `undefined`
 * when there was nothing to ask (the server then fills the stage from the
 * breed lifecycle), or `null` when the user closed the dialog — the caller
 * then stops instead of creating anything.
 */
export function useSystemSchedulerPrompt() {
  const { t } = useLanguage();
  const [matches, setMatches] = useState<Row[] | null>(null);
  const resolveRef = useRef<((answer: SchedulerSource | null) => void) | null>(
    null,
  );

  /** Name the stage by id (batch create) or, with lobId, by code (stage transfer). */
  const ask = async (opts: {
    companyId?: string | null;
    stageIds?: Array<string | null | undefined>;
    lobId?: string | null;
    stageCodes?: Array<string | null | undefined>;
    breedId?: string | null;
  }): Promise<SchedulerSource | null | undefined> => {
    const stageIds = [
      ...new Set((opts.stageIds || []).filter((id): id is string => !!id)),
    ];
    const stageCodes = opts.lobId
      ? [...new Set((opts.stageCodes || []).filter((c): c is string => !!c))]
      : [];
    if (!opts.companyId || (!stageIds.length && !stageCodes.length))
      return undefined;
    const params = new URLSearchParams({ companyId: opts.companyId });
    if (stageIds.length) params.set('stageIds', stageIds.join(','));
    if (stageCodes.length) {
      params.set('lobId', opts.lobId as string);
      params.set('stageCodes', stageCodes.join(','));
    }
    if (opts.breedId) params.set('breedId', opts.breedId);
    let found: Row[] = [];
    try {
      found =
        unwrap<Row[]>(
          await api.get(`/system-scheduler/match?${params.toString()}`),
        ) || [];
    } catch {
      // Could not tell — let the server apply its own rule rather than block the save.
      return undefined;
    }
    if (!found.length) return undefined;
    return new Promise<SchedulerSource | null>((resolve) => {
      resolveRef.current = resolve;
      setMatches(found);
    });
  };

  const finish = (answer: SchedulerSource | null) => {
    resolveRef.current?.(answer);
    resolveRef.current = null;
    setMatches(null);
  };

  const element = (
    <Dialog
      open={!!matches}
      onClose={() => finish(null)}
      title={t('sysSchPromptTitle')}
      description={t('sysSchPromptBody')}
      presentation="compact"
      maxWidth="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => finish('EMPTY')}>
            {t('sysSchPromptNo')}
          </Button>
          <Button onClick={() => finish('SYSTEM')}>
            {t('sysSchPromptYes')}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2">
        {(matches || []).map((m) => (
          <li
            key={m.stage_id}
            className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5"
          >
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-[var(--text-primary)]">
                {m.stage_name || NA}
              </p>
              <p className="text-[var(--text-secondary)]">
                {m.scheduler_name} ·{' '}
                {t('sysSchPromptActivities', { n: m.line_count })}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );

  return { ask, element };
}
