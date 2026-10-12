'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  /** The question, short — "Delete system scheduler?". Defaults to "Please confirm". */
  title?: string;
  /** What will happen, in a sentence or two. */
  message: string;
  /** Defaults to "Yes". */
  confirmLabel?: string;
  /** Defaults to "No". */
  cancelLabel?: string;
  /** `danger` (delete, void, discard, short-close) colours the icon and the Yes button red. */
  tone?: 'danger' | 'default';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

let enqueue: ((request: PendingConfirm) => void) | null = null;
// Asked before the host mounted (a click during the first render) — shown once it does.
const early: PendingConfirm[] = [];

/**
 * The app's replacement for `window.confirm`: resolves true for Yes, false for
 * No, Escape, the close button or a click outside. Rendered by <ConfirmHost />,
 * which Providers mounts once for the whole app, so any handler can await it:
 *
 *   if (!(await confirmAction({ title: t('…'), message: t('…'), tone: 'danger' }))) return;
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const request = { ...options, resolve };
    if (enqueue) enqueue(request);
    else early.push(request);
  });
}

/** Shows one confirmation at a time, in the order they were asked. */
export function ConfirmHost() {
  const { t } = useLanguage();
  const [queue, setQueue] = useState<PendingConfirm[]>([]);

  useEffect(() => {
    enqueue = (request) => setQueue((q) => [...q, request]);
    if (early.length) setQueue((q) => [...q, ...early.splice(0)]);
    return () => {
      enqueue = null;
    };
  }, []);

  const current = queue[0];
  const settle = (confirmed: boolean) => {
    current?.resolve(confirmed);
    setQueue((q) => q.slice(1));
  };

  if (!current) return null;
  const danger = current.tone === 'danger';
  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <Dialog
      open
      onClose={() => settle(false)}
      title={current.title || t('cfTitle')}
      presentation="compact"
      maxWidth="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => settle(false)} className="min-w-[6rem]">
            {current.cancelLabel || t('cfNo')}
          </Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={() => settle(true)} className="min-w-[6rem]">
            {current.confirmLabel || t('cfYes')}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4" data-confirm-dialog>
        <span
          aria-hidden
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
            danger ? 'bg-[var(--danger)]/12 text-[var(--danger)]' : 'bg-[var(--accent)]/12 text-[var(--accent)]',
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        <p className="pt-2.5 text-[15px] leading-6 text-[var(--text-secondary)]">{current.message}</p>
      </div>
    </Dialog>
  );
}
