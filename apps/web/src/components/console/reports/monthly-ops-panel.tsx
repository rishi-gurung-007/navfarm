'use client';

import { useEffect, useState } from 'react';
import { Check, FileDown, Loader2, Play, RefreshCw } from 'lucide-react';
import { api } from '@/services/api-client';
import { getActiveCompanyId, getActiveFarmId } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ScrollTable } from '@/components/ui/scroll-table';
import { EmptyState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { NA } from '@/utils/na';
import type { TranslationKeys } from '@/utils/translations';

type Row = Record<string, any>;

interface OpsMetrics {
  empty_days: number;
  empty_sows: number;
  sows_culled: number;
  total_born: number;
  born_alive: number;
  litters_farrowed: number;
  sows_served_one_gestation_earlier: number;
  services_farrowed: number;
  farrowing_rate_pct: number | null;
  avg_wean_weight_kg: number | null;
  total_litter_mass_kg: number | null;
  litters_weaned: number;
  cdm_kg: number;
  kg_sold: number;
  average_sows: number | null;
  kg_sold_per_sow_year: number | null;
  sows_due: number;
  standovers: number;
  standovers_pct: number | null;
  mortality_total: number;
  mortality_by_category: Array<{
    category: string;
    deaths: number;
    share_pct: number;
  }>;
  sows_on_last_day: number;
  parity_distribution: Array<{
    parity: string;
    sows: number;
    share_pct: number;
  }>;
}

export interface MonthlyOpsReport {
  farm: { farm_id: string; farm_code: string; farm_name: string };
  year: string;
  generated_at: string;
  rows: Array<{
    month: string;
    start_date: string;
    end_date: string;
    breed_id: string;
    breed_name: string;
    metrics: OpsMetrics;
  }>;
}

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

const fmt = (v: number | null | undefined, places = 2) =>
  v == null ? NA : v.toLocaleString('en-US', { maximumFractionDigits: places });
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** The report's columns in the client's order (R12 sheet); Farm is the filter, so it is not a column. */
const COLUMNS: Array<{
  key: TranslationKeys;
  num?: boolean;
  cell: (m: OpsMetrics) => string;
  hint?: (m: OpsMetrics) => string;
}> = [
  // Rishi, 2 Nov: two columns. Empty Days is the month's total of days sows were not productive after farrowing.
  {
    key: 'mopEmptyDays',
    num: true,
    cell: (m) => fmt(m.empty_days, 0),
    hint: (m) => `${m.empty_sows} sows`,
  },
  { key: 'mopCull', num: true, cell: (m) => fmt(m.sows_culled, 0) },
  {
    key: 'mopTotalBorn',
    num: true,
    cell: (m) => fmt(m.total_born, 0),
    hint: (m) => `${m.litters_farrowed} litters`,
  },
  { key: 'mopBornAlive', num: true, cell: (m) => fmt(m.born_alive, 0) },
  {
    key: 'mopFarrowingRate',
    num: true,
    cell: (m) =>
      m.farrowing_rate_pct == null ? NA : `${fmt(m.farrowing_rate_pct)}%`,
    hint: (m) =>
      `${m.services_farrowed} / ${m.sows_served_one_gestation_earlier} served`,
  },
  {
    key: 'mopAvgWeanWeight',
    num: true,
    cell: (m) =>
      m.avg_wean_weight_kg == null ? NA : `${fmt(m.avg_wean_weight_kg)} kg`,
  },
  {
    key: 'mopTotalLitterMass',
    num: true,
    cell: (m) =>
      m.total_litter_mass_kg == null ? NA : `${fmt(m.total_litter_mass_kg)} kg`,
    hint: (m) => `${m.litters_weaned} weaned`,
  },
  { key: 'mopCdm', num: true, cell: (m) => `${fmt(m.cdm_kg)} kg` },
  {
    key: 'mopKgSoldSowYear',
    num: true,
    cell: (m) => fmt(m.kg_sold_per_sow_year),
    hint: (m) => `${fmt(m.kg_sold)} kg · ${fmt(m.average_sows)} sows`,
  },
  {
    key: 'mopStandovers',
    num: true,
    cell: (m) => (m.standovers_pct == null ? NA : `${fmt(m.standovers_pct)}%`),
    hint: (m) => `${m.standovers} / ${m.sows_due} due`,
  },
  {
    key: 'mopMortalityByCategory',
    cell: (m) =>
      m.mortality_total
        ? m.mortality_by_category
            .map(
              (c) =>
                `${titleCase(c.category)} ${c.deaths} (${fmt(c.share_pct, 1)}%)`,
            )
            .join('\n')
        : '0',
  },
  {
    key: 'mopParityDistribution',
    cell: (m) =>
      m.sows_on_last_day
        ? m.parity_distribution
            .filter((p) => p.sows)
            .map((p) => `P${p.parity} ${fmt(p.share_pct, 1)}%`)
            .join('\n')
        : NA,
    hint: (m) => `${m.sows_on_last_day} sows`,
  },
];

/** CSV of the generated report, one line per month and breed, with the hints as their own columns. */
function toCsv(
  report: MonthlyOpsReport,
  t: (k: TranslationKeys) => string,
): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const head = [
    t('mopMonth'),
    t('mopFrom'),
    t('mopTo'),
    t('mopBreed'),
    ...COLUMNS.map((c) => t(c.key)),
  ];
  const lines = report.rows.map((r) =>
    [
      r.month,
      r.start_date,
      r.end_date,
      r.breed_name,
      ...COLUMNS.map((c) => c.cell(r.metrics).replace(/\n/g, '; ')),
    ]
      .map(esc)
      .join(','),
  );
  return [head.map(esc).join(','), ...lines].join('\n');
}

export default function MonthlyOpsPanel() {
  const { t } = useLanguage();
  const [farms, setFarms] = useState<Row[]>([]);
  const [farmId, setFarmId] = useState<string>(() => getActiveFarmId() || '');
  const [years, setYears] = useState<string[]>([]);
  const [year, setYear] = useState('');
  const [report, setReport] = useState<MonthlyOpsReport | null>(null);
  /** The Year and Farm the shown report was generated for: the button reads Generated while they still match. */
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/reports/monthly-ops/farms')
      .then((res: any) => setFarms(unwrap<Row[]>(res) || []))
      .catch(() => setFarms([]));
  }, []);
  const companyId =
    farms.find((f) => f.farm_id === farmId)?.company_id ?? getActiveCompanyId();

  // The fiscal years of the Accounting Period Master; the one holding today is chosen to begin with.
  useEffect(() => {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    api
      .get(`/reports/monthly-ops/years${qs}`)
      .then((res: any) => {
        const data = unwrap<{ years: string[]; current: string | null }>(res);
        setYears(data?.years ?? []);
        setYear((y) => y || data?.current || data?.years?.[0] || '');
      })
      .catch(() => setYears([]));
  }, [companyId]);

  // Rishi, 2 Nov: a changed Year or Farm keeps the report on screen and offers Regenerate, as the Farrowing Report does.
  const ready = Boolean(farmId && year);
  const filtersKey = JSON.stringify([year, farmId]);
  const upToDate = !!report && generatedKey === filtersKey;
  const generate = async () => {
    if (!ready) return;
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ farmId, year });
      if (companyId) qs.set('companyId', companyId);
      setReport(
        unwrap<MonthlyOpsReport>(
          await api.get(`/reports/monthly-ops?${qs.toString()}`),
        ),
      );
      setGeneratedKey(filtersKey);
    } catch (err: any) {
      setReport(null);
      setGeneratedKey(null);
      setError(err?.message || t('rptLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!report) return;
    const blob = new Blob([toCsv(report, t)], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `monthly-ops_${report.farm.farm_code}_${report.year}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const TH =
    'h-9 whitespace-nowrap border-b px-3 text-[10px] font-semibold uppercase tracking-wider';
  const TD = 'border-b px-3 py-2 align-top text-xs';
  return (
    <div className="flex flex-col gap-4">
      <div
        className="grid grid-cols-1 gap-3 rounded-[var(--radius-md)] border p-4 sm:grid-cols-3"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        <Field label={t('mopYear')} required>
          <SearchableSelect
            ariaLabel={t('mopYear')}
            ariaRequired
            value={year}
            onChange={setYear}
            options={years.map((y) => ({ value: y, label: y }))}
            columnHeaders={false}
            placeholder={years.length ? t('mopSelectYear') : t('mopNoYears')}
            disabled={!years.length}
          />
        </Field>
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
        <div className="flex flex-wrap items-end gap-2">
          {/* Rishi, 2 Nov: Generate; Generated while Year and Farm match the report shown; Regenerate once one changes. */}
          <Button onClick={generate} disabled={!ready || loading || upToDate} size="sm">
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : upToDate ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : report ? (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            ) : (
              <Play className="mr-1.5 h-4 w-4" />
            )}
            {t(upToDate ? 'rptGenerated' : report ? 'rptRegenerate' : 'rptGenerate')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!report || report.rows.length === 0}
          >
            <FileDown className="mr-1.5 h-4 w-4" />
            {t('mopExportCsv')}
          </Button>
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError('')} />

      {!report ? (
        <EmptyState title={t('mopPrompt')} />
      ) : report.rows.length === 0 ? (
        <EmptyState title={t('mopNoRows')} />
      ) : (
        <ScrollTable label={t('rptMonthlyOps')}>
          <thead>
            <tr style={{ color: 'var(--text-secondary)' }}>
              <th
                scope="col"
                data-sticky-col="true"
                style={{ ['--sticky-left' as string]: '0rem' }}
                className={`${TH} w-[8rem] min-w-[8rem]`}
              >
                {t('mopMonth')}
              </th>
              <th
                scope="col"
                data-sticky-col="last"
                style={{ ['--sticky-left' as string]: '8rem' }}
                className={`${TH} w-[9rem] min-w-[9rem]`}
              >
                {t('mopBreed')}
              </th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`${TH} ${c.num ? 'text-right' : ''}`}
                >
                  {t(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr
                key={`${r.start_date}-${r.breed_id}`}
                data-group-alt={
                  Math.floor(
                    i /
                      Math.max(
                        1,
                        new Set(report.rows.map((x) => x.breed_id)).size,
                      ),
                  ) % 2
                    ? 'true'
                    : undefined
                }
              >
                <td
                  data-sticky-col="true"
                  style={{ ['--sticky-left' as string]: '0rem' }}
                  className={`${TD} w-[8rem]`}
                >
                  <div
                    className="font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {r.month}
                  </div>
                  <div
                    className="text-[10px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {r.start_date} – {r.end_date}
                  </div>
                </td>
                <td
                  data-sticky-col="last"
                  style={{ ['--sticky-left' as string]: '8rem' }}
                  className={`${TD} w-[9rem]`}
                >
                  {r.breed_name}
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={`${TD} ${c.num ? 'text-right tabular-nums' : ''}`}
                  >
                    <div
                      className="whitespace-pre-line"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {c.cell(r.metrics)}
                    </div>
                    {c.hint && (
                      <div
                        className="text-[10px]"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {c.hint(r.metrics)}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </div>
  );
}
