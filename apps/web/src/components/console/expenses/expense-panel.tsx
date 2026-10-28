'use client';

import { NA } from '@/utils/na';
import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Loader2,
  Inbox,
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { api } from '@/services/api-client';
import { Dialog } from '@/components/ui/dialog';
import { Toast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Pagination } from '@/components/ui/pagination';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { formatAmount } from '@/lib/utils';

type Row = Record<string, any>;
const ROUTE: Record<string, string> = {
  EXPENSE_VOUCHER: 'expense-voucher',
  EXPENSE: 'expense',
};
const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  accent: { color: 'var(--accent)' },
  input: {
    backgroundColor: 'var(--input-bg)',
    color: 'var(--input-text)',
    borderColor: 'var(--input-border)',
  },
};
const unwrap = (res: any): any =>
  Array.isArray(res) ? res : (res?.data ?? res);
const accountParts = (a: Row) => [
  String(a.account_code),
  String(a.account_name),
];

type ExpenseSortKey =
  | 'document_no'
  | 'posting_date'
  | 'location'
  | 'sub_location'
  | 'description'
  | 'bal_acc_no'
  | 'amount'
  | 'status'
  | 'journal_no';

/** A column header button that sorts the list with directional indicators. */
function SortButton({
  label,
  active,
  dir,
  onClick,
  alignEnd = false,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  alignEnd?: boolean;
}) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase ${alignEnd ? 'ml-auto' : ''}`}
      style={active ? { color: 'var(--text-primary)' } : undefined}
    >
      <span>{label}</span>
      <Icon className="h-3 w-3" style={{ opacity: active ? 1 : 0.45 }} />
    </button>
  );
}

/**
 * The manager's voucher entry format (15 Oct): Posting Date, Transaction Type, Voucher Type (GL), Voucher No.,
 * Description, Location (the farm), Sub-Location (a shed of it), Amount (negative = payment, positive = receipt),
 * Balance Account Type (GL), Balance Account No., Remarks. "Paid from" is the one field the format does not name —
 * posting needs the other side of the entry.
 */
export default function ExpensePanel({
  docType,
  posts,
  mayCreate,
}: {
  docType: string;
  posts: boolean;
  mayCreate: boolean;
}) {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const [rows, setRows] = useState<Row[]>([]);
  const [glAccounts, setGlAccounts] = useState<Row[]>([]);
  const [farms, setFarms] = useState<Row[]>([]);
  const [sheds, setSheds] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{
    key: ExpenseSortKey;
    dir: 'asc' | 'desc';
  }>({ key: 'document_no', dir: 'desc' });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const blank = (): Row => ({
    posting_date: new Date().toISOString().slice(0, 10),
    description: '',
    location_id: farms[0]?.location_id ?? '',
    sub_location_id: '',
    amount: '',
    expense_gl_account_id: '',
    payment_gl_account_id: '',
  });
  const [form, setForm] = useState<Row>(blank());
  const [viewingEntry, setViewingEntry] = useState<Row | null>(null);
  const [journalDetails, setJournalDetails] = useState<Row | null>(null);
  const [loadingJournal, setLoadingJournal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (search) params.set('search', search);
      setRows(
        unwrap(
          await api.get(
            `/expense-documents/${ROUTE[docType]}?${params.toString()}`,
          ),
        ) || [],
      );
    } catch (err: any) {
      setError(err?.message || t('expFailedToLoad'));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [search, docType]);
  useEffect(() => {
    setPage(1);
  }, [search, pageSize, docType, sort]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    params.set('limit', '500');
    api
      .get(`/gl-account?${params.toString()}`)
      .then((r) => setGlAccounts(unwrap(r) || []))
      .catch(() => {});
    api
      .get(`/expense-documents/locations?companyId=${companyId ?? ''}`)
      .then((r) => {
        const d = unwrap(r) || {};
        setFarms(d.farms || []);
        setSheds(d.sheds || []);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const shedsOfFarm = useMemo(
    () => sheds.filter((s) => s.parent_location_id === form.location_id),
    [sheds, form.location_id],
  );
  const accountOptions = useMemo(
    () =>
      glAccounts.map((a) => ({
        value: a.gl_account_id,
        account_code: a.account_code,
        account_name: a.account_name,
      })),
    [glAccounts],
  );
  const accountName = (id: string) =>
    glAccounts.find((a) => a.gl_account_id === id)?.account_name || NA;
  const accountCode = (id: string) =>
    glAccounts.find((a) => a.gl_account_id === id)?.account_code || NA;
  const locName = (id: string) =>
    [...farms, ...sheds].find((l) => l.location_id === id)?.location_name || NA;

  const toggleSort = (key: ExpenseSortKey) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : {
            key,
            dir:
              key === 'document_no' || key === 'posting_date' ? 'desc' : 'asc',
          },
    );

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'document_no':
          cmp = String(a.document_no ?? '').localeCompare(
            String(b.document_no ?? ''),
            undefined,
            { numeric: true },
          );
          break;
        case 'posting_date':
          cmp =
            String(a.posting_date ?? '').localeCompare(
              String(b.posting_date ?? ''),
            ) ||
            String(a.document_no ?? '').localeCompare(
              String(b.document_no ?? ''),
              undefined,
              { numeric: true },
            );
          break;
        case 'location':
          cmp = locName(a.location_id).localeCompare(locName(b.location_id));
          break;
        case 'sub_location':
          cmp = locName(a.sub_location_id).localeCompare(
            locName(b.sub_location_id),
          );
          break;
        case 'description':
          cmp = String(a.description ?? '').localeCompare(
            String(b.description ?? ''),
          );
          break;
        case 'bal_acc_no': {
          const codeA = accountCode(a.expense_gl_account_id);
          const codeB = accountCode(b.expense_gl_account_id);
          cmp =
            codeA.localeCompare(codeB, undefined, { numeric: true }) ||
            accountName(a.expense_gl_account_id).localeCompare(
              accountName(b.expense_gl_account_id),
            );
          break;
        }
        case 'amount':
          cmp = (Number(a.amount) || 0) - (Number(b.amount) || 0);
          break;
        case 'status':
          cmp = String(a.status ?? '').localeCompare(String(b.status ?? ''));
          break;
        case 'journal_no':
          cmp = String(a.journal_no ?? '').localeCompare(
            String(b.journal_no ?? ''),
            undefined,
            { numeric: true },
          );
          break;
        default:
          cmp = 0;
      }
      return sort.dir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [rows, sort, glAccounts, farms, sheds]);

  const openAccountingPreview = async (row: Row) => {
    setViewingEntry(row);
    setJournalDetails(null);
    if (row.journal_id) {
      setLoadingJournal(true);
      try {
        const res = unwrap(await api.get(`/journal/${row.journal_id}`));
        setJournalDetails(res);
      } catch {
        // Fallback gracefully to synthesising entry from document itself
      } finally {
        setLoadingJournal(false);
      }
    }
  };

  const pickBalanceAccount = (id: string) =>
    // Description is auto-populated from the selected GL account, and stays editable.
    setForm((f) => ({
      ...f,
      expense_gl_account_id: id,
      description:
        f.description && f.description !== accountName(f.expense_gl_account_id)
          ? f.description
          : accountName(id) === NA
            ? ''
            : accountName(id),
    }));

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (!form.posting_date) throw new Error(t('jpPostingDateRequired'));
      if (!Number(form.amount)) throw new Error(t('expAmountRequired'));
      if (posts && (!form.expense_gl_account_id || !form.payment_gl_account_id))
        throw new Error(t('expAccountsRequired'));
      await api.post(`/expense-documents/${ROUTE[docType]}`, {
        company_id: companyId,
        posting_date: form.posting_date,
        description: form.description || undefined,
        amount: Number(form.amount),
        location_id: form.location_id || undefined,
        sub_location_id: form.sub_location_id || undefined,
        expense_gl_account_id: form.expense_gl_account_id || undefined,
        ...(posts ? { payment_gl_account_id: form.payment_gl_account_id } : {}),
      });
      setOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t('expFailedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const paged = sortedRows.slice((page - 1) * pageSize, page * pageSize);
  const cols = posts ? 10 : 9;
  const readOnly = (value: string) => (
    <input
      value={value}
      readOnly
      disabled
      className="nf-input"
      style={S.input}
    />
  );
  const accountSelect = (
    key: string,
    label: string,
    onPick: (id: string) => void,
    required = false,
  ) => (
    <Field label={label} required={required}>
      <SearchableSelect
        ariaLabel={label}
        value={form[key]}
        options={accountOptions}
        valueKey="value"
        getLabel={(r) => `${r.account_code} — ${r.account_name}`}
        getSelectedLabel={(r) => String(r.account_name)}
        getLabelParts={accountParts}
        columnHeaders={[t('expAccountCode'), t('expAccountName')]}
        placeholder={t('jpSelectPlaceholder')}
        searchPlaceholder={t('expSearchDropdown')}
        onChange={(v) => onPick(v || '')}
        onClear={form[key] ? () => onPick('') : undefined}
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('expSearchPlaceholder')}
          aria-label={t('expSearchPlaceholder')}
          className="h-9 w-full text-[13px] sm:w-56"
        />
        {mayCreate && (
          <Button
            onClick={() => {
              setForm(blank());
              setFormError('');
              setOpen(true);
            }}
            size="sm"
          >
            <Plus className="h-3.5 w-3.5" /> {t('expNew')}
          </Button>
        )}
      </div>
      <Toast variant="danger" message={error} onClose={() => setError('')} />
      <div
        className="overflow-hidden rounded-[var(--radius-md)] border"
        style={S.surface}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr
                className="border-b"
                style={{ borderColor: 'var(--row-border)' }}
              >
                <TableHead className="whitespace-nowrap">
                  <SortButton
                    label={t('expDocNo')}
                    active={sort.key === 'document_no'}
                    dir={sort.dir}
                    onClick={() => toggleSort('document_no')}
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  <SortButton
                    label={t('jpPostingDate')}
                    active={sort.key === 'posting_date'}
                    dir={sort.dir}
                    onClick={() => toggleSort('posting_date')}
                  />
                </TableHead>
                <TableHead>
                  <SortButton
                    label={t('expLocation')}
                    active={sort.key === 'location'}
                    dir={sort.dir}
                    onClick={() => toggleSort('location')}
                  />
                </TableHead>
                <TableHead>
                  <SortButton
                    label={t('expSubLocation')}
                    active={sort.key === 'sub_location'}
                    dir={sort.dir}
                    onClick={() => toggleSort('sub_location')}
                  />
                </TableHead>
                <TableHead>
                  <SortButton
                    label={t('jpDescription')}
                    active={sort.key === 'description'}
                    dir={sort.dir}
                    onClick={() => toggleSort('description')}
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  <SortButton
                    label={t('expBalAccNo')}
                    active={sort.key === 'bal_acc_no'}
                    dir={sort.dir}
                    onClick={() => toggleSort('bal_acc_no')}
                  />
                </TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <SortButton
                    label={t('expAmount')}
                    active={sort.key === 'amount'}
                    dir={sort.dir}
                    onClick={() => toggleSort('amount')}
                    alignEnd
                  />
                </TableHead>
                <TableHead>{t('expRemarks')}</TableHead>
                <TableHead className="text-right whitespace-nowrap">
                  <SortButton
                    label={t('jpStatus')}
                    active={sort.key === 'status'}
                    dir={sort.dir}
                    onClick={() => toggleSort('status')}
                    alignEnd
                  />
                </TableHead>
                {posts && (
                  <TableHead className="whitespace-nowrap">
                    <SortButton
                      label={t('jpJournalNo')}
                      active={sort.key === 'journal_no'}
                      dir={sort.dir}
                      onClick={() => toggleSort('journal_no')}
                    />
                  </TableHead>
                )}
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr>
                  <TableCell
                    colSpan={cols}
                    className="py-10 text-center"
                    style={S.sub}
                  >
                    <Loader2
                      className="mx-auto mb-2 h-5 w-5 animate-spin"
                      style={S.accent}
                    />{' '}
                    {t('jpLoading')}
                  </TableCell>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <TableCell
                    colSpan={cols}
                    className="py-10 text-center"
                    style={S.sub}
                  >
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />{' '}
                    {t('expNoneYet')}
                  </TableCell>
                </tr>
              ) : (
                paged.map((r) => (
                  <TableRow key={r.expense_id}>
                    <TableCell
                      className="whitespace-nowrap font-semibold"
                      style={S.primary}
                    >
                      <button
                        type="button"
                        onClick={() => openAccountingPreview(r)}
                        className="font-semibold hover:underline text-left cursor-pointer inline-flex items-center gap-1"
                        style={S.primary}
                        title={t('expViewAccountingEntry')}
                      >
                        {r.document_no}
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>
                      {r.posting_date}
                    </TableCell>
                    <TableCell style={S.primary}>
                      {r.location_id ? locName(r.location_id) : NA}
                    </TableCell>
                    <TableCell style={S.primary}>
                      {r.sub_location_id ? locName(r.sub_location_id) : NA}
                    </TableCell>
                    <TableCell style={S.sub}>{r.description || NA}</TableCell>
                    <TableCell style={S.primary}>
                      {r.expense_gl_account_id ? (
                        accountCode(r.expense_gl_account_id) !== NA ? (
                          <div className="flex flex-col">
                            <span className="font-semibold">
                              {accountCode(r.expense_gl_account_id)}
                            </span>
                            {accountName(r.expense_gl_account_id) !== NA && (
                              <span className="text-xs" style={S.sub}>
                                {accountName(r.expense_gl_account_id)}
                              </span>
                            )}
                          </div>
                        ) : (
                          accountName(r.expense_gl_account_id)
                        )
                      ) : (
                        NA
                      )}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-right font-medium"
                      style={{
                        color:
                          Number(r.amount) < 0
                            ? 'var(--danger)'
                            : Number(r.amount) > 0
                              ? 'var(--success)'
                              : S.primary.color,
                      }}
                    >
                      {formatAmount(r.amount)}
                    </TableCell>
                    <TableCell style={S.sub}>{r.remarks || NA}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={r.status === 'POSTED' ? 'success' : 'neutral'}
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    {posts && (
                      <TableCell className="whitespace-nowrap" style={S.sub}>
                        {r.journal_no ? (
                          <button
                            type="button"
                            onClick={() => openAccountingPreview(r)}
                            className="font-medium hover:underline text-left cursor-pointer inline-flex items-center gap-1.5"
                            style={S.accent}
                            title={t('expViewAccountingEntry')}
                          >
                            <span>{r.journal_no}</span>
                            <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                          </button>
                        ) : (
                          NA
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>
        {!loading && sortedRows.length > 0 && (
          <div
            className="border-t px-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <Pagination
              page={page}
              pageSize={pageSize}
              total={sortedRows.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>

      <Dialog
        open={open}
        onClose={() => !saving && setOpen(false)}
        title={t('expDialogTitle')}
        maxWidth="lg"
        footer={
          <Button onClick={save} disabled={saving}>
            {saving ? t('jpSaving') : t('expSaveAndPost')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Toast
            variant="danger"
            message={formError}
            onClose={() => setFormError('')}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t('jpPostingDate')} required>
              <input
                type="date"
                value={form.posting_date}
                onChange={(e) => set('posting_date', e.target.value)}
                className="nf-input"
                style={S.input}
              />
            </Field>
            <Field label={t('expTransactionType')}>
              {readOnly(t('expExpense'))}
            </Field>
            <Field label={t('expVoucherNo')}>
              {readOnly(t('expAutoGenerated'))}
            </Field>
            <Field label={t('expLocation')}>
              <SearchableSelect
                ariaLabel={t('expLocation')}
                value={form.location_id}
                options={farms.map((f) => ({
                  value: f.location_id,
                  code: f.location_code,
                  name: f.location_name,
                }))}
                valueKey="value"
                getLabel={(r) => `${r.code} — ${r.name}`}
                getSelectedLabel={(r) => String(r.name)}
                getLabelParts={(r) => [String(r.code), String(r.name)]}
                columnHeaders={[t('expAccountCode'), t('expAccountName')]}
                placeholder={t('jpSelectPlaceholder')}
                searchPlaceholder={t('expSearchDropdown')}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    location_id: v || '',
                    sub_location_id: '',
                  }))
                }
              />
            </Field>
            <Field label={t('expSubLocation')}>
              <SearchableSelect
                ariaLabel={t('expSubLocation')}
                value={form.sub_location_id}
                options={shedsOfFarm.map((s) => ({
                  value: s.location_id,
                  code: s.location_code,
                  name: s.location_name,
                }))}
                valueKey="value"
                getLabel={(r) => `${r.code} — ${r.name}`}
                getSelectedLabel={(r) => String(r.name)}
                getLabelParts={(r) => [String(r.code), String(r.name)]}
                columnHeaders={[t('expAccountCode'), t('expAccountName')]}
                placeholder={t('jpSelectPlaceholder')}
                searchPlaceholder={t('expSearchDropdown')}
                disabled={!form.location_id}
                onChange={(v) => set('sub_location_id', v || '')}
                onClear={
                  form.sub_location_id
                    ? () => set('sub_location_id', '')
                    : undefined
                }
              />
            </Field>
            <Field label={t('expAmount')} required hint={t('expAmountHint')}>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="e.g. -500.00"
                className="nf-input font-medium"
                style={{
                  ...S.input,
                  color:
                    Number(form.amount) < 0
                      ? 'var(--danger)'
                      : Number(form.amount) > 0
                        ? 'var(--success)'
                        : undefined,
                }}
              />
            </Field>
            <Field label={t('expBalanceAccountType')}>{readOnly('GL')}</Field>
            {/* A payment debits the balance account and credits paid-from; a receipt the reverse (expense.service.ts). */}
            {accountSelect(
              'expense_gl_account_id',
              Number(form.amount) > 0 ? t('expCrAccount') : t('expDrAccount'),
              pickBalanceAccount,
              true,
            )}
            {accountSelect(
              'payment_gl_account_id',
              Number(form.amount) > 0 ? t('expDrAccount') : t('expCrAccount'),
              (id) => set('payment_gl_account_id', id),
              true,
            )}
            <Field label={t('jpDescription')} className="sm:col-span-3">
              <input
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                className="nf-input"
                style={S.input}
              />
            </Field>

            {Number(form.amount) !== 0 && !isNaN(Number(form.amount)) && (
              <div
                className="sm:col-span-3 rounded-[var(--radius-md)] border p-3 text-xs"
                style={{
                  borderColor: 'var(--border)',
                  backgroundColor:
                    'var(--surface-muted, rgba(125,125,125,0.06))',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="font-semibold uppercase tracking-wider text-[11px]"
                    style={S.sub}
                  >
                    {t('expAccountingEntry')}
                  </span>
                  <span
                    className="font-medium px-2 py-0.5 rounded text-[11px]"
                    style={{
                      backgroundColor:
                        Number(form.amount) < 0
                          ? 'var(--danger-muted)'
                          : 'rgba(47, 125, 91, 0.12)',
                      color:
                        Number(form.amount) < 0
                          ? 'var(--danger)'
                          : 'var(--success)',
                    }}
                  >
                    {Number(form.amount) < 0
                      ? t('expPaymentOutflow')
                      : t('expReceiptInflow')}
                  </span>
                </div>
                {Number(form.amount) < 0 ? (
                  <div className="flex flex-col gap-1.5 font-mono text-[12px]">
                    <div className="flex items-center justify-between">
                      <span style={S.primary}>
                        <strong style={{ color: 'var(--danger)' }}>Dr.</strong>{' '}
                        {form.expense_gl_account_id
                          ? accountName(form.expense_gl_account_id)
                          : t('expDrAccount')}{' '}
                        <span style={S.muted}>({t('expExpenseAccount')})</span>
                      </span>
                      <span
                        className="font-semibold"
                        style={{ color: 'var(--danger)' }}
                      >
                        {formatAmount(Math.abs(Number(form.amount)))}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pl-4">
                      <span style={S.primary}>
                        <strong style={{ color: 'var(--text-secondary)' }}>
                          Cr.
                        </strong>{' '}
                        {form.payment_gl_account_id
                          ? accountName(form.payment_gl_account_id)
                          : t('expCrAccount')}{' '}
                        <span style={S.muted}>({t('expPaymentAccount')})</span>
                      </span>
                      <span className="font-semibold" style={S.sub}>
                        {formatAmount(Math.abs(Number(form.amount)))}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 font-mono text-[12px]">
                    <div className="flex items-center justify-between">
                      <span style={S.primary}>
                        <strong style={{ color: 'var(--success)' }}>Dr.</strong>{' '}
                        {form.payment_gl_account_id
                          ? accountName(form.payment_gl_account_id)
                          : t('expDrAccount')}{' '}
                        <span style={S.muted}>({t('expPaymentAccount')})</span>
                      </span>
                      <span
                        className="font-semibold"
                        style={{ color: 'var(--success)' }}
                      >
                        {formatAmount(Number(form.amount))}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pl-4">
                      <span style={S.primary}>
                        <strong style={{ color: 'var(--text-secondary)' }}>
                          Cr.
                        </strong>{' '}
                        {form.expense_gl_account_id
                          ? accountName(form.expense_gl_account_id)
                          : t('expCrAccount')}{' '}
                        <span style={S.muted}>({t('expExpenseAccount')})</span>
                      </span>
                      <span className="font-semibold" style={S.sub}>
                        {formatAmount(Number(form.amount))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      {/* Live Accounting Entry Preview Dialog (popup on the same page, no navigation to finance) */}
      <Dialog
        open={!!viewingEntry}
        onClose={() => setViewingEntry(null)}
        title={
          viewingEntry
            ? `${t('expAccountingEntry')} — ${viewingEntry.document_no}`
            : ''
        }
        maxWidth="lg"
      >
        {viewingEntry &&
          (() => {
            const amountNum = Number(viewingEntry.amount) || 0;
            const isPayment = amountNum < 0;
            const absAmount = Math.abs(amountNum);
            const hasFetchedLines =
              journalDetails?.lines &&
              Array.isArray(journalDetails.lines) &&
              journalDetails.lines.length > 0;

            const lines = hasFetchedLines
              ? journalDetails.lines
              : [
                  {
                    line_id: 'expense-line',
                    gl_account_id: viewingEntry.expense_gl_account_id,
                    debit_amount: isPayment ? absAmount : 0,
                    credit_amount: isPayment ? 0 : absAmount,
                    description:
                      viewingEntry.remarks ||
                      viewingEntry.description ||
                      t('expExpenseAccount'),
                  },
                  {
                    line_id: 'payment-line',
                    gl_account_id: viewingEntry.payment_gl_account_id,
                    debit_amount: isPayment ? 0 : absAmount,
                    credit_amount: isPayment ? absAmount : 0,
                    description:
                      viewingEntry.remarks ||
                      viewingEntry.description ||
                      t('expPaymentAccount'),
                  },
                ];

            const totalDebit = lines.reduce(
              (sum: number, l: any) => sum + (Number(l.debit_amount) || 0),
              0,
            );
            const totalCredit = lines.reduce(
              (sum: number, l: any) => sum + (Number(l.credit_amount) || 0),
              0,
            );

            return (
              <div className="flex flex-col gap-4 text-xs">
                {/* Summary Card */}
                <div
                  className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-[var(--radius-md)] border p-3.5"
                  style={S.surface}
                >
                  <div>
                    <p
                      className="font-semibold uppercase tracking-wider text-[10px]"
                      style={S.muted}
                    >
                      {t('expDocumentNo')}
                    </p>
                    <p
                      className="font-semibold text-sm mt-0.5"
                      style={S.primary}
                    >
                      {viewingEntry.document_no}
                    </p>
                  </div>
                  <div>
                    <p
                      className="font-semibold uppercase tracking-wider text-[10px]"
                      style={S.muted}
                    >
                      {t('jpJournalNo')}
                    </p>
                    <p
                      className="font-semibold text-sm mt-0.5"
                      style={S.accent}
                    >
                      {viewingEntry.journal_no || NA}
                    </p>
                  </div>
                  <div>
                    <p
                      className="font-semibold uppercase tracking-wider text-[10px]"
                      style={S.muted}
                    >
                      {t('jpPostingDate')}
                    </p>
                    <p
                      className="font-semibold text-sm mt-0.5"
                      style={S.primary}
                    >
                      {viewingEntry.posting_date}
                    </p>
                  </div>
                  <div>
                    <p
                      className="font-semibold uppercase tracking-wider text-[10px]"
                      style={S.muted}
                    >
                      {t('jpStatus')}
                    </p>
                    <div className="mt-0.5">
                      <Badge
                        variant={
                          viewingEntry.status === 'POSTED'
                            ? 'success'
                            : 'neutral'
                        }
                      >
                        {viewingEntry.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Description & Location details */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 px-1">
                  <div>
                    <span className="font-medium" style={S.muted}>
                      {t('jpDescription')}:{' '}
                    </span>
                    <span className="font-medium" style={S.primary}>
                      {viewingEntry.description || NA}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium" style={S.muted}>
                      {t('expLocation')}:{' '}
                    </span>
                    <span className="font-medium" style={S.primary}>
                      {viewingEntry.location_id
                        ? locName(viewingEntry.location_id)
                        : NA}
                      {viewingEntry.sub_location_id
                        ? ` / ${locName(viewingEntry.sub_location_id)}`
                        : ''}
                    </span>
                  </div>
                  {viewingEntry.remarks && (
                    <div className="sm:col-span-2">
                      <span className="font-medium" style={S.muted}>
                        {t('expRemarks')}:{' '}
                      </span>
                      <span style={S.sub}>{viewingEntry.remarks}</span>
                    </div>
                  )}
                </div>

                {/* Live Accounting Entry Table */}
                <div
                  className="overflow-hidden rounded-[var(--radius-md)] border"
                  style={S.surface}
                >
                  <div
                    className="border-b px-3.5 py-2.5 flex items-center justify-between"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span
                      className="font-semibold text-[11px] uppercase tracking-wider"
                      style={S.sub}
                    >
                      {t('expAccountingEntry')}
                    </span>
                    <span
                      className="font-medium px-2 py-0.5 rounded text-[11px]"
                      style={{
                        backgroundColor: isPayment
                          ? 'var(--danger-muted)'
                          : 'rgba(47, 125, 91, 0.12)',
                        color: isPayment ? 'var(--danger)' : 'var(--success)',
                      }}
                    >
                      {isPayment
                        ? t('expPaymentOutflow')
                        : t('expReceiptInflow')}
                    </span>
                  </div>

                  {loadingJournal ? (
                    <div className="py-8 text-center" style={S.sub}>
                      <Loader2
                        className="mx-auto mb-2 h-5 w-5 animate-spin"
                        style={S.accent}
                      />
                      {t('jpLoading')}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-xs">
                        <TableHeader>
                          <tr
                            className="border-b"
                            style={{ borderColor: 'var(--row-border)' }}
                          >
                            <TableHead className="px-3.5 py-2 whitespace-nowrap">
                              {t('expAccountCode')}
                            </TableHead>
                            <TableHead className="px-3.5 py-2">
                              {t('expAccountName')}
                            </TableHead>
                            <TableHead className="px-3.5 py-2">
                              {t('jpDescription')}
                            </TableHead>
                            <TableHead className="px-3.5 py-2 text-right whitespace-nowrap">
                              {t('jpDebit')}
                            </TableHead>
                            <TableHead className="px-3.5 py-2 text-right whitespace-nowrap">
                              {t('jpCredit')}
                            </TableHead>
                          </tr>
                        </TableHeader>
                        <TableBody>
                          {lines.map((l: any, i: number) => {
                            const deb = Number(l.debit_amount) || 0;
                            const cred = Number(l.credit_amount) || 0;
                            return (
                              <TableRow key={l.line_id || i}>
                                <TableCell
                                  className="px-3.5 py-2.5 font-mono whitespace-nowrap"
                                  style={S.primary}
                                >
                                  {accountCode(l.gl_account_id)}
                                </TableCell>
                                <TableCell
                                  className="px-3.5 py-2.5 font-medium"
                                  style={S.primary}
                                >
                                  {accountName(l.gl_account_id)}
                                </TableCell>
                                <TableCell
                                  className="px-3.5 py-2.5"
                                  style={S.sub}
                                >
                                  {l.description || NA}
                                </TableCell>
                                <TableCell
                                  className="px-3.5 py-2.5 text-right font-medium whitespace-nowrap"
                                  style={{
                                    color:
                                      deb > 0
                                        ? isPayment
                                          ? 'var(--danger)'
                                          : 'var(--success)'
                                        : S.muted.color,
                                  }}
                                >
                                  {deb > 0 ? formatAmount(deb) : NA}
                                </TableCell>
                                <TableCell
                                  className="px-3.5 py-2.5 text-right font-medium whitespace-nowrap"
                                  style={{
                                    color:
                                      cred > 0
                                        ? S.primary.color
                                        : S.muted.color,
                                  }}
                                >
                                  {cred > 0 ? formatAmount(cred) : NA}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {/* Totals Row */}
                          <TableRow
                            className="border-t font-semibold"
                            style={{
                              borderColor: 'var(--border)',
                              backgroundColor:
                                'var(--surface-muted, rgba(125,125,125,0.04))',
                            }}
                          >
                            <TableCell
                              colSpan={3}
                              className="px-3.5 py-2.5 text-right uppercase tracking-wider text-[11px]"
                              style={S.sub}
                            >
                              Total
                            </TableCell>
                            <TableCell
                              className="px-3.5 py-2.5 text-right whitespace-nowrap font-bold"
                              style={S.primary}
                            >
                              {formatAmount(totalDebit)}
                            </TableCell>
                            <TableCell
                              className="px-3.5 py-2.5 text-right whitespace-nowrap font-bold"
                              style={S.primary}
                            >
                              {formatAmount(totalCredit)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
      </Dialog>
    </div>
  );
}
