'use client';

import { NA } from '@/utils/na';
import { useEffect, useState } from 'react';
import { Plus, Search, Loader2, Inbox } from 'lucide-react';
import { api } from '@/services/api-client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { Pagination } from '@/components/ui/pagination';
import { getActiveCompanyId, getStoredUser, hasPermission } from '@/hooks/useAuth';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useLanguage } from '@/hooks/useLanguage';
import { formatQuantity } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import type { TranslationKeys } from '@/utils/translations';

const PAGE_SIZE = 25;

type Row = Record<string, any>;

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

const inputCls = 'nf-input';

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

// The client's QC Parameter Master: QC Code, Description, QC Type, Unit of Measurement, Min / Max / Target Value, Mandatory, Active.
const PARAM_TYPES: Array<{ value: string; labelKey: TranslationKeys }> = [
  { value: 'NUMERIC', labelKey: 'qcpTypeNumeric' },
  { value: 'BOOLEAN', labelKey: 'qcpTypeBoolean' },
];

const emptyForm = () => ({
  param_code: '',
  param_name: '',
  param_type: 'NUMERIC',
  uom: '',
  min_value: '',
  max_value: '',
  target_value: '',
  is_mandatory: true,
  is_active: true,
});

const asInput = (v: unknown) =>
  v === null || v === undefined ? '' : String(Number(v));
const asNumber = (v: string) => (v === '' ? null : Number(v));

export default function QcParameterPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [uoms, setUoms] = useState<Row[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const canEdit = hasPermission(getStoredUser(), 'PRODUCTION', 'QC_PARAMETER', 'can_edit');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<Row>(emptyForm());

  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (search) params.set('search', search);
      params.set('limit', '200');
      const res = await api.get(`/qc-parameter?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t('qcpFailedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    params.set('limit', '500');
    api
      .get(`/uom?${params.toString()}`)
      .then((r) => setUoms(unwrap<Row[]>(r) || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditingId(row.param_id);
    setForm({
      param_code: row.param_code,
      param_name: row.param_name,
      param_type: row.param_type,
      uom: row.uom || '',
      min_value: asInput(row.min_value),
      max_value: asInput(row.max_value),
      target_value: asInput(row.target_value),
      is_mandatory: !!row.is_mandatory,
      is_active: !!row.is_active,
    });
    setFormError('');
    setModalOpen(true);
  };

  const isNumeric = form.param_type === 'NUMERIC';

  // The Active switch in the list, as on the other masters: saved at once, without opening the form.
  const toggleActive = async (row: Row) => {
    setTogglingId(row.param_id);
    try {
      await api.put(`/qc-parameter/${row.param_id}`, { is_active: !row.is_active });
      setRows((all) =>
        all.map((r) => (r.param_id === row.param_id ? { ...r, is_active: !row.is_active } : r)),
      );
    } catch (err: any) {
      setError(err?.message || t('qcpFailedToSave'));
    } finally {
      setTogglingId(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (!form.param_code.trim() || !form.param_name.trim())
        throw new Error(t('qcpCodeNameRequired'));
      const min = isNumeric ? asNumber(form.min_value) : null;
      const max = isNumeric ? asNumber(form.max_value) : null;
      const target = isNumeric ? asNumber(form.target_value) : null;
      if (min !== null && max !== null && min > max)
        throw new Error(t('qcpMinAboveMax'));
      if (
        target !== null &&
        ((min !== null && target < min) || (max !== null && target > max))
      )
        throw new Error(t('qcpTargetOutsideRange'));
      const body = {
        param_name: form.param_name.trim(),
        param_type: form.param_type,
        uom: isNumeric ? form.uom || null : null,
        min_value: min,
        max_value: max,
        target_value: target,
        is_mandatory: form.is_mandatory,
        is_active: form.is_active,
      };
      if (editingId) {
        await api.put(`/qc-parameter/${editingId}`, body);
      } else {
        // A create leaves an empty value out rather than sending null.
        const created: Row = {
          company_id: companyId,
          param_code: form.param_code.trim(),
        };
        for (const [k, v] of Object.entries(body)) if (v !== null) created[k] = v;
        await api.post('/qc-parameter', created);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t('qcpFailedToSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>
            {t('qcpTitle')}
          </h2>
          <p className="mt-0.5 text-xs" style={S.sub}>
            {t('qcpDescription')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={S.muted}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('qcpSearchPlaceholder')}
              className="nf-input-sm pl-8 pr-3"
              style={S.input}
            />
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> {t('qcpNewQcParameter')}
          </Button>
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError('')} />

      <div
        className="overflow-hidden rounded-[var(--radius-md)] border"
        style={S.surface}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap">
                  {t('qcpCode')}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  {t('qcpName')}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  {t('qcpType')}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  {t('qcpUom')}
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  {t('qcpMinValue')}
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  {t('qcpMaxValue')}
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  {t('qcpTargetValue')}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  {t('qcpMandatory')}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  {t('qcpActive')}
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center"
                    style={S.sub}
                  >
                    <Loader2
                      className="mx-auto mb-2 h-5 w-5 animate-spin"
                      style={S.accent}
                    />{' '}
                    {t('qcpLoading')}
                  </TableCell>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center"
                    style={S.sub}
                  >
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />{' '}
                    {t('qcpNoParametersYet')}
                  </TableCell>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const typeKey = PARAM_TYPES.find(
                    (tp) => tp.value === row.param_type,
                  )?.labelKey;
                  const num = (v: unknown) =>
                    v != null ? formatQuantity(v as number) : NA;
                  return (
                    <TableRow
                      key={row.param_id}
                      onClick={() => openEdit(row)}
                      className="cursor-pointer"
                    >
                      <TableCell
                        className="whitespace-nowrap font-semibold"
                        style={S.primary}
                      >
                        {row.param_code}
                      </TableCell>
                      <TableCell className="whitespace-nowrap" style={S.primary}>
                        {row.param_name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap" style={S.sub}>
                        {typeKey ? t(typeKey) : row.param_type}
                      </TableCell>
                      <TableCell className="whitespace-nowrap" style={S.sub}>
                        {row.uom || NA}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-right"
                        style={S.sub}
                      >
                        {num(row.min_value)}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-right"
                        style={S.sub}
                      >
                        {num(row.max_value)}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-right"
                        style={S.sub}
                      >
                        {num(row.target_value)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap" style={S.primary}>
                        {row.is_mandatory ? t('qcpYes') : t('qcpNo')}
                      </TableCell>
                      <TableCell className="whitespace-nowrap" style={S.primary}>
                        {canEdit ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!!row.is_active}
                            aria-label={row.param_code}
                            title={row.is_active ? t('deactivate') : t('restore')}
                            disabled={togglingId === row.param_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleActive(row);
                            }}
                            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50"
                            style={{
                              backgroundColor: row.is_active
                                ? 'var(--success)'
                                : 'var(--border)',
                            }}
                          >
                            <span
                              className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                              style={{
                                transform: row.is_active
                                  ? 'translateX(1.15rem)'
                                  : 'translateX(0.2rem)',
                              }}
                            />
                          </button>
                        ) : row.is_active ? (
                          t('qcpYes')
                        ) : (
                          t('qcpNo')
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <div
            className="border-t px-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <Pagination
              page={page}
              pageSize={pageSize}
              total={rows.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>

      <Dialog
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editingId ? t('qcpEditQcParameter') : t('qcpNewQcParameter')}
        footer={
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('qcpSaving') : t('qcpSave')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Toast
            variant="danger"
            message={formError}
            onClose={() => setFormError('')}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('qcpCode')} <span className="text-(--danger)">*</span>
              </label>
              <input
                value={form.param_code}
                onChange={(e) =>
                  setForm((f: Row) => ({ ...f, param_code: e.target.value }))
                }
                placeholder="QC-MOISTURE-001"
                className={inputCls}
                style={S.input}
                disabled={!!editingId}
                maxLength={50}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('qcpName')} <span className="text-(--danger)">*</span>
              </label>
              <input
                value={form.param_name}
                onChange={(e) =>
                  setForm((f: Row) => ({ ...f, param_name: e.target.value }))
                }
                placeholder={t('qcpNamePlaceholder')}
                className={inputCls}
                style={S.input}
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('qcpType')} <span className="text-(--danger)">*</span>
              </label>
              <Select
                value={form.param_type}
                onChange={(e) =>
                  setForm((f: Row) => ({ ...f, param_type: e.target.value }))
                }
                className={`${inputCls} nf-select`}
                style={S.input}
              >
                {!PARAM_TYPES.some((tp) => tp.value === form.param_type) && (
                  <option value={form.param_type}>{form.param_type}</option>
                )}
                {PARAM_TYPES.map((tp) => (
                  <option key={tp.value} value={tp.value}>
                    {t(tp.labelKey)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('qcpUom')}
              </label>
              <Select
                value={isNumeric ? form.uom : ''}
                onChange={(e) =>
                  setForm((f: Row) => ({ ...f, uom: e.target.value }))
                }
                className={`${inputCls} nf-select`}
                style={S.input}
                disabled={!isNumeric}
              >
                <option value="">{t('qcpSelectEllipsis')}</option>
                {uoms.map((u) => (
                  <option key={u.uom_id || u.uom_code} value={u.uom_code}>
                    {u.uom_name ? `${u.uom_code} — ${u.uom_name}` : u.uom_code}
                  </option>
                ))}
              </Select>
            </div>
            {(
              [
                ['min_value', 'qcpMinValue'],
                ['max_value', 'qcpMaxValue'],
                ['target_value', 'qcpTargetValue'],
              ] as const
            ).map(([key, labelKey]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t(labelKey)}
                </label>
                <input
                  type="number"
                  value={isNumeric ? form[key] : ''}
                  onChange={(e) =>
                    setForm((f: Row) => ({ ...f, [key]: e.target.value }))
                  }
                  className={inputCls}
                  style={S.input}
                  disabled={!isNumeric}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('qcpMandatory')}
              </label>
              <Select
                value={form.is_mandatory ? 'yes' : 'no'}
                onChange={(e) =>
                  setForm((f: Row) => ({
                    ...f,
                    is_mandatory: e.target.value === 'yes',
                  }))
                }
                className={`${inputCls} nf-select`}
                style={S.input}
              >
                <option value="yes">{t('qcpMandatoryYesOption')}</option>
                <option value="no">{t('qcpMandatoryNoOption')}</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('qcpActive')}
              </label>
              <Select
                value={form.is_active ? 'yes' : 'no'}
                onChange={(e) =>
                  setForm((f: Row) => ({
                    ...f,
                    is_active: e.target.value === 'yes',
                  }))
                }
                className={`${inputCls} nf-select`}
                style={S.input}
              >
                <option value="yes">{t('qcpYes')}</option>
                <option value="no">{t('qcpNo')}</option>
              </Select>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
