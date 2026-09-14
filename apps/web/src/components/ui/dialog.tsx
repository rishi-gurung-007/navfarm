'use client';

import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '../../hooks/useLanguage';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useOverlayFocus, useTopmostEscape } from '../../hooks/useOverlayFocus';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Forms share one stable desktop frame, independent of field count.
   * `page` is retained as an alias for existing callers. Only short, non-form
   * confirmations opt into `compact`; maxWidth applies to those only.
   */
  presentation?: 'modal' | 'page' | 'compact';
  className?: string;
}

const widths = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
  presentation = 'modal',
  className,
}: DialogProps) {
  const { t } = useLanguage();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  closeRef.current = onClose;

  useScrollLock(open);
  // Focus entry, trap and restoration are shared with Drawer and
  // FullPageOverlay — see `hooks/useOverlayFocus`. Escape stays here: which
  // overlay a key closes is a per-overlay decision.
  useOverlayFocus(panelRef, open);
  useTopmostEscape(open, () => closeRef.current());

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[100] grid h-[100dvh] w-screen place-items-center overflow-y-auto',
        presentation === 'compact' ? 'p-4 sm:p-6' : 'p-0 sm:p-6',
      )}
      role="presentation"
      data-dialog-root
    >
      <button type="button" aria-label={t("closeDialog")} onClick={onClose} className="absolute inset-0 cursor-default bg-[rgba(46,49,63,0.5)]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-dialog-panel
        data-presentation={presentation}
        className={cn(
          'relative my-auto flex w-full flex-col overflow-hidden border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-md)] outline-none',
          presentation === 'compact'
            ? cn('max-h-[calc(100dvh-2rem)] rounded-[var(--radius-lg)] sm:max-h-[calc(100dvh-3rem)]', widths[maxWidth])
            : 'h-[100dvh] max-h-[100dvh] max-w-none rounded-none border-0 sm:h-[min(48rem,calc(100dvh-3rem))] sm:max-w-[70rem] sm:rounded-[var(--radius-lg)] sm:border',
          className,
        )}
      >
        <header className="flex shrink-0 items-start gap-4 border-b border-[var(--border-subtle)] px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="nf-text-body-strong text-lg text-[var(--text-primary)]">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={t("close")} className="nf-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </header>
        <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] px-5 py-4 sm:px-6">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
