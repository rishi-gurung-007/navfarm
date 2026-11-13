'use client';

import { NA } from '@/utils/na';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/hooks/useLanguage';
import { formatAmount } from '@/lib/utils';

type Row = Record<string, any>;

const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : (res?.data ?? res)) as T;

/**
 * A journal entry, read-only, in a window: its header and every line with the account's code and name. For the screens that name a journal
 * (a ledger posting, a costing run) and let the person open it where they stand, without leaving for the Journal Entries page.
 */
export function JournalEntryDialog({ journalId, onClose }: { journalId: string | null; onClose: () => void }) {
  const { t } = useLanguage();
  const [journal, setJournal] = useState<Row | null>(null);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!journalId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setJournal(null);
    Promise.all([api.get(`/journal/${journalId}`), api.get('/gl-account?limit=500').catch(() => null)])
      .then(([j, a]) => {
        if (cancelled) return;
        setJournal(unwrap<Row>(j));
        setAccounts(a ? unwrap<Row[]>(a) || [] : []);
      })
      .catch((err: any) => { if (!cancelled) setError(err?.message || t('jpFailedToLoadJournalEntryDetails')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalId]);

  const account = (id: string) => accounts.find((a) => a.gl_account_id === id);
  const lines: Row[] = journal?.lines ?? [];
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit_amount || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit_amount || 0), 0);
  const field = (label: string, value: React.ReactNode) => (
    <div>
      <p className="font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <div className="text-[var(--text-primary)]">{value || NA}</div>
    </div>
  );

  return (
    <Dialog open={!!journalId} onClose={onClose} title={journal ? t('jpJournalEntryTitle', { journalNo: journal.journal_no }) : t('jpJournalEntries')} maxWidth="xl">
      {loading && (
        <div className="py-8 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-muted)]" />
        </div>
      )}
      {error && <p className="py-4 text-center text-sm text-[var(--danger,#dc2626)]">{error}</p>}
      {journal && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            {field(t('jpStatus'), <Badge variant={journal.status === 'POSTED' ? 'success' : 'neutral'}>{journal.status}</Badge>)}
            {field(t('jpPostingDate'), String(journal.posting_date ?? '').slice(0, 10))}
            {field(t('jpSource'), journal.source)}
            {field(t('jpSourceDocument'), journal.source_document_no)}
          </div>
          {journal.description && <p className="text-xs text-[var(--text-secondary)]">{journal.description}</p>}
          <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[10px] font-bold uppercase text-[var(--text-muted)]">
                  <th className="px-3 py-2">Account Code</th>
                  <th className="px-3 py-2">Account Name</th>
                  <th className="px-3 py-2 text-right">{t('jpDebit')}</th>
                  <th className="px-3 py-2 text-right">{t('jpCredit')}</th>
                  <th className="px-3 py-2">{t('jpDescription')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {lines.map((l) => (
                  <tr key={l.line_id}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[var(--text-primary)]">{account(l.gl_account_id)?.account_code || NA}</td>
                    <td className="px-3 py-2 text-[var(--text-primary)]">{account(l.gl_account_id)?.account_name || NA}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(l.debit_amount) > 0 ? formatAmount(l.debit_amount) : NA}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(l.credit_amount) > 0 ? formatAmount(l.credit_amount) : NA}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{l.description || NA}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)] font-bold">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right font-mono">{formatAmount(totalDebit)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatAmount(totalCredit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}
