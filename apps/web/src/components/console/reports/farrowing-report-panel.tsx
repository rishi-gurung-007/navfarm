'use client';

import { useEffect, useState } from 'react';
import { Check, FileSpreadsheet, Loader2, Play, RefreshCw } from 'lucide-react';
import { api } from '@/services/api-client';
import { getActiveCompanyId, getActiveFarmId } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ScrollTable } from '@/components/ui/scroll-table';
import { EmptyState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import {
  changeTone,
  columnGroups,
  FARROWING_COLUMNS,
  groupStarts,
  NA,
  type FarrowingReport,
} from './farrowing-report-columns';
import { exportFarrowingExcel } from './farrowing-report-excel';

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

const S = {
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  input: {
    backgroundColor: 'var(--input-bg)',
    color: 'var(--input-text)',
    borderColor: 'var(--input-border)',
  },
  // A tinted header: --surface-raised is the rows' white in the light theme, so the header did not stand apart.
  head: {
    backgroundColor: 'var(--surface-secondary)',
    color: 'var(--text-secondary)',
    borderColor: 'var(--border)',
  },
  cell: { borderColor: 'var(--border)' },
  // Each group of columns (Actual · Target · Prior YR · Change · YoY %) is set off from the next by a light, wider line.
  groupEdge: { borderLeft: '2px solid var(--border-strong)' },
  // The header's last line, a shade darker than the row lines, so the header reads apart from the rows under it.
  headEnd: { borderBottom: '1px solid var(--border-strong)' },
  up: { color: 'var(--success)' },
  down: { color: 'var(--danger)' },
};

// The first column of every group after the first.
const STARTS = groupStarts(FARROWING_COLUMNS);

// Both header rows stay in view. Every header cell sticks at top 0 by default (global.css), which left the sub-header
// row lying over the group row; the group row has a fixed height and the sub-header row sticks just below it.
const GROUP_ROW_PX = 34;

const PARITIES = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

export default function FarrowingReportPanel() {
  const { t } = useLanguage();
  const [farms, setFarms] = useState<Row[]>([]);
  const [farmId, setFarmId] = useState<string>(() => getActiveFarmId() || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [batchId, setBatchId] = useState('');
  // Rishi, 2 Nov: Batch Type — All, Active or Closed batches.
  const [batchStatus, setBatchStatus] = useState<'ALL' | 'ACTIVE' | 'CLOSED'>(
    'ALL',
  );
  const [parity, setParity] = useState('');
  const [sowId, setSowId] = useState('');
  const [options, setOptions] = useState<{ batches: Row[]; sows: Row[] }>({
    batches: [],
    sows: [],
  });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [report, setReport] = useState<FarrowingReport | null>(null);
  /** The filters the shown report was generated with: the button reads Generated while they still match. */
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  // The report's own farm list: in the tenant-wide workspace the location master holds no company farms.
  useEffect(() => {
    api
      .get(`/reports/farrowing/farms`)
      .then((res: any) => setFarms(unwrap<Row[]>(res) || []))
      .catch(() => setFarms([]));
  }, []);
  // The chosen farm's company: a tenant administrator may pick a farm of any company.
  const companyId =
    farms.find((f) => f.farm_id === farmId)?.company_id ?? getActiveCompanyId();

  // A farm's own batches and sows feed the two pickers below it; a new farm starts the other filters over.
  useEffect(() => {
    setBatchId('');
    setSowId('');
    setReport(null);
    if (!farmId) {
      setOptions({ batches: [], sows: [] });
      return;
    }
    setOptionsLoading(true);
    const qs = new URLSearchParams({ farmId });
    if (companyId) qs.set('companyId', companyId);
    api
      .get(`/reports/farrowing/filters?${qs.toString()}`)
      .then((res: any) => setOptions(unwrap(res) || { batches: [], sows: [] }))
      .catch(() => setOptions({ batches: [], sows: [] }))
      .finally(() => setOptionsLoading(false));
  }, [farmId, companyId]);

  const ready = Boolean(farmId && dateFrom && dateTo);
  const filtersKey = JSON.stringify([
    farmId,
    dateFrom,
    dateTo,
    batchStatus,
    batchId,
    parity,
    sowId,
  ]);
  const upToDate = !!report && generatedKey === filtersKey;
  // The batch picker offers only batches of the chosen type; a chosen batch of the other type is cleared.
  const batchOptions =
    batchStatus === 'ALL'
      ? options.batches
      : options.batches.filter((b) => b.status === batchStatus);
  const chooseBatchStatus = (value: string) => {
    const next = (value || 'ALL') as 'ALL' | 'ACTIVE' | 'CLOSED';
    setBatchStatus(next);
    if (
      next !== 'ALL' &&
      batchId &&
      options.batches.find((b) => b.batch_id === batchId)?.status !== next
    )
      setBatchId('');
  };

  const generate = async () => {
    if (!ready) return;
    if (dateFrom > dateTo) {
      setError(t('rptDatesInvalid'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ farmId, dateFrom, dateTo });
      if (companyId) qs.set('companyId', companyId);
      if (batchId) qs.set('batchId', batchId);
      if (batchStatus !== 'ALL') qs.set('batchStatus', batchStatus);
      if (parity) qs.set('parity', parity);
      if (sowId) qs.set('sowId', sowId);
      const res = await api.get(`/reports/farrowing?${qs.toString()}`);
      setReport(unwrap<FarrowingReport>(res));
      setGeneratedKey(filtersKey);
    } catch (err: any) {
      setReport(null);
      setGeneratedKey(null);
      setError(err?.message || t('rptLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = async () => {
    if (!report) return;
    setExporting(true);
    try {
      await exportFarrowingExcel(report, t);
    } catch (err: any) {
      setError(err?.message || t('rptLoadFailed'));
    } finally {
      setExporting(false);
    }
  };

  const groups = columnGroups(FARROWING_COLUMNS);

  return (
    <div className="flex flex-col gap-4">
      <div
        className="grid grid-cols-1 gap-3 rounded-[var(--radius-md)] border p-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        <Field label={t('rptFarm')} required>
          <SearchableSelect
            ariaLabel={t('rptFarm')}
            ariaRequired
            value={farmId}
            onChange={setFarmId}
            options={farms}
            valueKey="farm_id"
            getLabel={(r) => String(r.farm_name ?? '')}
            placeholder={t('rptSelectFarm')}
          />
        </Field>
        <Field label={t('rptDateFrom')} htmlFor="rpt-date-from" required>
          <input
            id="rpt-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="nf-input w-full"
            style={S.input}
          />
        </Field>
        <Field label={t('rptDateTo')} htmlFor="rpt-date-to" required>
          <input
            id="rpt-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="nf-input w-full"
            style={S.input}
          />
        </Field>
        <Field label={t('rptBatchType')}>
          <SearchableSelect
            ariaLabel={t('rptBatchType')}
            value={batchStatus}
            onChange={chooseBatchStatus}
            options={[
              { value: 'ALL', label: t('rptAll') },
              { value: 'ACTIVE', label: t('rptBatchTypeActive') },
              { value: 'CLOSED', label: t('rptBatchTypeClosed') },
            ]}
            valueKey="value"
            labelKey="label"
          />
        </Field>
        <Field label={t('rptBatch')}>
          <SearchableSelect
            ariaLabel={t('rptBatch')}
            value={batchId}
            onChange={setBatchId}
            onClear={() => setBatchId('')}
            options={batchOptions}
            valueKey="batch_id"
            getLabel={(r) => String(r.batch_no ?? '')}
            placeholder={t('rptAll')}
            loading={optionsLoading}
            disabled={!farmId}
          />
        </Field>
        <Field label={t('rptParity')} hint={t('rptParityHint')}>
          <SearchableSelect
            ariaLabel={t('rptParity')}
            value={parity}
            onChange={setParity}
            onClear={() => setParity('')}
            options={PARITIES}
            valueKey="value"
            labelKey="label"
            placeholder={t('rptAll')}
          />
        </Field>
        <Field label={t('rptSow')}>
          <SearchableSelect
            ariaLabel={t('rptSow')}
            value={sowId}
            onChange={setSowId}
            onClear={() => setSowId('')}
            options={options.sows}
            valueKey="animal_id"
            getLabel={(r) => String(r.animal_code ?? '')}
            placeholder={t('rptAll')}
            loading={optionsLoading}
            disabled={!farmId}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4 2xl:col-span-7">
          {/* Rishi, 2 Nov: Generate; Generated while the filters match the report shown; Regenerate once one changes. */}
          <Button onClick={generate} disabled={!ready || loading || upToDate}>
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : upToDate ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : report ? (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            ) : (
              <Play className="mr-1.5 h-4 w-4" />
            )}
            {t(
              upToDate
                ? 'rptGenerated'
                : report
                  ? 'rptRegenerate'
                  : 'rptGenerate',
            )}
          </Button>
          <Button
            variant="outline"

            onClick={exportExcel}
            disabled={!report || report.rows.length === 0 || exporting}
          >
            {exporting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            )}
            {t('rptExportExcel')}
          </Button>
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError('')} />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: 'var(--accent)' }}
          />
        </div>
      ) : !report ? (
        <EmptyState
          title={t('rptFarrowingReport')}
          description={t('rptEmptyPrompt')}
        />
      ) : report.rows.length === 0 ? (
        <EmptyState title={t('rptNoRecords')} />
      ) : (
        <div className="flex flex-col gap-2">
          <div
            className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
            style={S.sub}
          >
            <span>
              <strong style={S.primary}>{report.farm.farm_name}</strong> ·{' '}
              {report.filters.date_from} – {report.filters.date_to}
              {report.filters.batch_status
                ? ` · ${t(report.filters.batch_status === 'ACTIVE' ? 'rptBatchTypeActive' : 'rptBatchTypeClosed')}`
                : ''}
              {report.filters.batch_no
                ? ` · ${t('rptBatch')} ${report.filters.batch_no}`
                : ''}
              {report.filters.parity
                ? ` · ${t('rptParity')} ${report.filters.parity}`
                : ''}
              {report.filters.sow_code
                ? ` · ${t('rptSow')} ${report.filters.sow_code}`
                : ''}
            </span>
            <span style={S.muted}>
              {t('rptGeneratedAt', {
                at: new Date(report.generated_at).toLocaleString(),
              })}
            </span>
          </div>
          <ScrollTable label={t('rptFarrowingReport')}>
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  data-sticky-col
                  className="border-b border-r px-3 py-2 font-semibold"
                  style={{
                    ...S.head,
                    ...S.headEnd,
                    color: 'var(--text-primary)',
                  }}
                >
                  {t('rptSowBatch')}
                </th>
                {groups.map((g, i) => (
                  <th
                    key={`${g.group}-${i}`}
                    colSpan={g.span}
                    className="border-b border-r px-3 text-center font-semibold whitespace-nowrap"
                    style={{
                      ...S.head,
                      color: 'var(--text-primary)',
                      height: GROUP_ROW_PX,
                      ...(i > 0 ? S.groupEdge : {}),
                    }}
                  >
                    {t(g.group)}
                  </th>
                ))}
              </tr>
              <tr>
                {FARROWING_COLUMNS.map((c, i) => (
                  <th
                    key={i}
                    className="border-b border-r px-3 py-1.5 text-center text-[11px] font-medium whitespace-nowrap"
                    style={{
                      ...S.head,
                      ...S.headEnd,
                      top: GROUP_ROW_PX,
                      ...(STARTS.has(i) ? S.groupEdge : {}),
                    }}
                  >
                    {t(c.sub)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr
                  key={row.batch_id ?? 'total'}
                  style={
                    row.is_total
                      ? {
                          backgroundColor: 'var(--surface-raised)',
                          fontWeight: 600,
                        }
                      : undefined
                  }
                >
                  <td
                    data-sticky-col
                    className="border-b border-r px-3 py-2 whitespace-nowrap"
                    style={{
                      ...S.cell,
                      ...S.primary,
                      backgroundColor: row.is_total
                        ? 'var(--surface-raised)'
                        : 'var(--surface)',
                    }}
                  >
                    {/* Rishi, 2 Nov: the prior year's batch number is not shown; its figures stay in the Prior YR columns. */}
                    {row.is_total ? t('rptFarmTotal') : row.batch_no}
                  </td>
                  {FARROWING_COLUMNS.map((c, i) => {
                    const text = c.cell(row, t);
                    const faint = text === t('rptNotAvailable') || text === NA;
                    const change = changeTone(c, text);
                    const tone = faint
                      ? S.muted
                      : change === 'good'
                        ? S.up
                        : change === 'bad'
                          ? S.down
                          : S.primary;
                    return (
                      <td
                        key={i}
                        className="border-b border-r px-3 py-2 text-right whitespace-nowrap tabular-nums"
                        style={{
                          ...S.cell,
                          ...tone,
                          ...(STARTS.has(i) ? S.groupEdge : {}),
                        }}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <p className="text-[11px]" style={S.muted}>
            {t('rptPriorYearNote')}
          </p>
        </div>
      )}
    </div>
  );
}
