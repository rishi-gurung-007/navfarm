'use client';

import { useCallback, useEffect, useState, use } from 'react';
import {
  Download,
  FileCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Scale,
  Layers,
} from 'lucide-react';
import { ConsolePage } from '@/components/ui/console-page';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { showToast } from '@/components/ui/toast';
import { api } from '@/services/api-client';
import { apiDownload } from '@/lib/api-client';
import { formatQuantity } from '@/lib/utils';
import { formatDate, formatDateTime } from '@/utils/date-short';
import { useCompanyCurrency, formatMoney } from '@/hooks/useCompanyCurrency';

interface DetailData {
  import_id: string;
  tenant_id: string;
  company_id: string;
  company_name?: string;
  farm_id: string;
  farm_name?: string;
  farm_code?: string;
  batch_id: string;
  batch_no?: string;
  report_reference?: string;
  report_batch_reference?: string;
  slaughter_from?: string;
  slaughter_to?: string;
  actual_animal_count?: number;
  actual_warm_mass_kg?: string | number;
  actual_cold_mass_kg?: string | number;
  average_carcass_weight?: number;
  reported_product_value?: string | number;
  expected_animal_count?: number;
  expected_warm_mass_kg?: string | number;
  expected_cold_mass_kg?: string | number;
  reconciliation_status: 'MATCHED' | 'WARNING' | 'INVALID';
  status: 'PREVIEW_READY' | 'IMPORTED';
  override_reason?: string;
  created_at: string;
  confirmed_at?: string;
  created_by?: string;
  confirmed_by?: string;
  individual_file_name?: string;
  individual_sha512?: string;
  summary_file_name?: string;
  summary_sha512?: string;
  validation_json?: Array<{ severity: 'WARNING' | 'ERROR'; message: string }>;
  distributions?: {
    grades?: Array<{
      grade: string;
      count: number;
      percentage: number;
      warm_mass_kg?: number;
      cold_mass_kg?: number;
    }>;
    sexes?: Array<{ sex: string; count: number; percentage: number }>;
    sick_codes?: Array<{ sick_code: string; count: number }>;
  };
}

interface CarcassRecord {
  carcass_id: string;
  serial_number?: string | number;
  ear_tag?: string;
  grade?: string;
  warm_mass_kg?: string | number;
  cold_mass_kg?: string | number;
  sex?: string;
  fat_mm?: string | number;
  meat_mm?: string | number;
  meat_percentage?: string | number;
  sick_code?: string;
  slaughtered_at?: string;
}

interface ProductRecord {
  product_id: string;
  category?: string;
  product_code?: string;
  description?: string;
  quantity?: number;
  warm_mass_kg?: string | number;
  cold_mass_kg?: string | number;
  average_mass_kg?: string | number;
  reported_price?: string | number;
  reported_value?: string | number;
}

export default function KillSheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { currency } = useCompanyCurrency();

  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tabs: 'carcasses' | 'products' | 'distributions'
  const [activeTab, setActiveTab] = useState<'carcasses' | 'products' | 'distributions'>('carcasses');

  // Carcasses state
  const [carcasses, setCarcasses] = useState<CarcassRecord[]>([]);
  const [carcassTotal, setCarcassTotal] = useState(0);
  const [carcassPage, setCarcassPage] = useState(1);
  const [carcassPageSize, setCarcassPageSize] = useState(50);
  const [carcassSearch, setCarcassSearch] = useState('');
  const [carcassesLoading, setCarcassesLoading] = useState(false);

  // Products state
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(50);
  const [productsLoading, setProductsLoading] = useState(false);

  // Confirm state if PREVIEW_READY
  const [overrideReason, setOverrideReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [downloadingIndividual, setDownloadingIndividual] = useState(false);
  const [downloadingSummary, setDownloadingSummary] = useState(false);

  // Fetch detail
  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/kill-sheets/${id}`);
      setDetail(res);
      if (res?.override_reason) {
        setOverrideReason(res.override_reason);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load Kill Sheet details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Fetch carcasses
  const fetchCarcasses = useCallback(async () => {
    if (!detail) return;
    setCarcassesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(carcassPage));
      params.set('limit', String(carcassPageSize));
      if (carcassSearch.trim()) params.set('search', carcassSearch.trim());

      const res = await api.get(`/kill-sheets/${id}/carcasses?${params.toString()}`);
      setCarcasses(res?.data ?? []);
      setCarcassTotal(res?.total ?? (res?.data?.length || 0));
    } catch {
      setCarcasses([]);
    } finally {
      setCarcassesLoading(false);
    }
  }, [id, detail, carcassPage, carcassPageSize, carcassSearch]);

  useEffect(() => {
    if (activeTab === 'carcasses') {
      fetchCarcasses();
    }
  }, [activeTab, fetchCarcasses]);

  // Fetch products
  const fetchProducts = useCallback(async () => {
    if (!detail) return;
    setProductsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(productPage));
      params.set('limit', String(productPageSize));

      const res = await api.get(`/kill-sheets/${id}/products?${params.toString()}`);
      setProducts(res?.data ?? []);
      setProductTotal(res?.total ?? (res?.data?.length || 0));
    } catch {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, [id, detail, productPage, productPageSize]);

  useEffect(() => {
    if (activeTab === 'products') {
      fetchProducts();
    }
  }, [activeTab, fetchProducts]);

  // Download handler
  const handleDownload = async (kind: 'individual' | 'summary') => {
    if (kind === 'individual') setDownloadingIndividual(true);
    else setDownloadingSummary(true);

    try {
      const fallbackName =
        kind === 'individual'
          ? detail?.individual_file_name || 'kill-sheet.xls'
          : detail?.summary_file_name || 'product-summary.xls';

      const { blob, filename } = await apiDownload(
        `/kill-sheets/${id}/file/${kind}`,
        fallbackName
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast.success(`Downloaded ${filename}`);
    } catch (err: any) {
      showToast.error(err?.message || `Failed to download ${kind} file.`);
    } finally {
      if (kind === 'individual') setDownloadingIndividual(false);
      else setDownloadingSummary(false);
    }
  };

  // Confirm handler
  const handleConfirm = async () => {
    if (
      detail?.reconciliation_status === 'WARNING' &&
      !overrideReason.trim()
    ) {
      showToast.error('A reconciliation warning requires an override reason.');
      return;
    }

    setConfirming(true);
    try {
      await api.post(`/kill-sheets/${id}/confirm`, {
        override_reason: overrideReason.trim() || undefined,
      });
      showToast.success('Kill sheet confirmed and imported successfully!');
      fetchDetail();
      fetchCarcasses();
    } catch (err: any) {
      showToast.error(err?.message || 'Failed to confirm kill sheet.');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <ConsolePage>
        <LoadingState label="Loading Kill Sheet details…" />
      </ConsolePage>
    );
  }

  if (error || !detail) {
    return (
      <ConsolePage>
        <ErrorState
          message={error || 'Kill Sheet not found.'}
          onRetry={fetchDetail}
        />
      </ConsolePage>
    );
  }

  const avgWeight =
    detail.average_carcass_weight != null
      ? Number(detail.average_carcass_weight).toFixed(2)
      : detail.actual_animal_count && detail.actual_cold_mass_kg
        ? (
            Number(detail.actual_cold_mass_kg) /
            Number(detail.actual_animal_count)
          ).toFixed(2)
        : '—';

  return (
    <ConsolePage>
      {/* Header */}
      <PageHeader
        title={`Kill Sheet: ${detail.report_reference || detail.farm_name || 'Slaughter Report'}`}
        description={`Batch ${detail.batch_no || '—'} · ${detail.farm_name || 'Farm'} (${detail.company_name || 'Company'})`}
        sticky={false}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {detail.individual_file_name && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleDownload('individual')}
                disabled={downloadingIndividual}
                title="Download original individual kill sheet workbook"
              >
                <Download className="h-4 w-4" />
                {downloadingIndividual ? 'Downloading…' : 'Kill Sheet (.xls)'}
              </Button>
            )}

            {detail.summary_file_name && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleDownload('summary')}
                disabled={downloadingSummary}
                title="Download original product summary workbook"
              >
                <Download className="h-4 w-4" />
                {downloadingSummary ? 'Downloading…' : 'Summary (.xls)'}
              </Button>
            )}
          </div>
        }
      />

      {/* Confirmation Banner if PREVIEW_READY */}
      {detail.status === 'PREVIEW_READY' && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-50/20 p-4 dark:bg-amber-950/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                  Preview Only — Not Yet Imported
                </h3>
              </div>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                This kill sheet has been parsed and reconciled, but is not yet
                committed to inventory and GM analytics.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleConfirm}
                disabled={
                  confirming ||
                  detail.reconciliation_status === 'INVALID' ||
                  (detail.reconciliation_status === 'WARNING' &&
                    !overrideReason.trim())
                }
                className="gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" />
                {confirming ? 'Committing…' : 'Confirm & Import Now'}
              </Button>
            </div>
          </div>

          {detail.reconciliation_status === 'WARNING' && (
            <div className="mt-3">
              <label className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                Override Reason (Required):
              </label>
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Reason for confirming despite reconciliation warning…"
                className="mt-1 text-sm bg-white dark:bg-black/30"
              />
            </div>
          )}
        </div>
      )}

      {/* Override Reason Callout (if already confirmed with warning) */}
      {detail.status === 'IMPORTED' && detail.override_reason && (
        <div className="mb-6 rounded-lg border border-blue-500/20 bg-blue-50/10 p-3 text-xs">
          <span className="font-semibold text-blue-800 dark:text-blue-300">
            Imported with Supervisor Override:
          </span>{' '}
          <span className="text-[var(--text-primary)]">
            {detail.override_reason}
          </span>
        </div>
      )}

      {/* KPI Cards Row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            Slaughtered Heads
          </span>
          <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
            {formatQuantity(detail.actual_animal_count, 'HEAD')}
          </p>
          <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
            Expected: {formatQuantity(detail.expected_animal_count, 'HEAD') || '—'}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            Warm Mass
          </span>
          <p className="mt-1 text-2xl font-bold font-mono text-[var(--text-primary)]">
            {formatQuantity(detail.actual_warm_mass_kg)}{' '}
            <span className="text-xs font-normal">kg</span>
          </p>
          <div className="mt-1 text-[11px] font-mono text-[var(--text-secondary)]">
            Expected:{' '}
            {detail.expected_warm_mass_kg != null
              ? `${formatQuantity(detail.expected_warm_mass_kg)} kg`
              : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            Cold Mass
          </span>
          <p className="mt-1 text-2xl font-bold font-mono text-[var(--text-primary)]">
            {formatQuantity(detail.actual_cold_mass_kg)}{' '}
            <span className="text-xs font-normal">kg</span>
          </p>
          <div className="mt-1 text-[11px] font-mono text-[var(--text-secondary)]">
            Expected:{' '}
            {detail.expected_cold_mass_kg != null
              ? `${formatQuantity(detail.expected_cold_mass_kg)} kg`
              : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            Avg Carcass Weight
          </span>
          <p className="mt-1 text-2xl font-bold font-mono text-[var(--text-primary)]">
            {avgWeight}{' '}
            <span className="text-xs font-normal">kg</span>
          </p>
          <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
            Cold mass / animals
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            Reported Product Value
          </span>
          <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
            {detail.reported_product_value != null
              ? formatMoney(detail.reported_product_value, currency)
              : '—'}
          </p>
          <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
            From product summary
          </div>
        </div>
      </div>

      {/* Metadata & Audit Overview */}
      <Card className="mb-6">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Slaughter & Audit Metadata
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)]">Reconciliation:</span>
              <StatusBadge status={detail.reconciliation_status} />
              <span className="ml-2 text-xs text-[var(--text-secondary)]">Status:</span>
              <StatusBadge status={detail.status} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-4 rounded-lg bg-[var(--surface-raised)] p-4 text-xs sm:grid-cols-4">
            <div>
              <span className="text-[var(--text-secondary)]">Report Reference</span>
              <p className="font-mono font-medium text-[var(--text-primary)]">
                {detail.report_reference || '—'}
              </p>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Report Batch Ref</span>
              <p className="font-mono font-medium text-[var(--text-primary)]">
                {detail.report_batch_reference || '—'}
              </p>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Slaughter Window</span>
              <p className="font-medium text-[var(--text-primary)]">
                {formatDate(detail.slaughter_from)} to {formatDate(detail.slaughter_to)}
              </p>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Confirmed At</span>
              <p className="font-medium text-[var(--text-primary)]">
                {detail.confirmed_at ? formatDateTime(detail.confirmed_at) : 'Pending Confirmation'}
              </p>
            </div>

            <div>
              <span className="text-[var(--text-secondary)]">Individual Workbook</span>
              <p className="truncate font-mono text-[var(--text-primary)]" title={detail.individual_file_name}>
                {detail.individual_file_name || '—'}
              </p>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Individual SHA-512</span>
              <p className="truncate font-mono text-[10px] text-[var(--text-secondary)]" title={detail.individual_sha512}>
                {detail.individual_sha512 ? `${detail.individual_sha512.slice(0, 16)}…` : '—'}
              </p>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Product Summary Workbook</span>
              <p className="truncate font-mono text-[var(--text-primary)]" title={detail.summary_file_name}>
                {detail.summary_file_name || 'None attached'}
              </p>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">Summary SHA-512</span>
              <p className="truncate font-mono text-[10px] text-[var(--text-secondary)]" title={detail.summary_sha512}>
                {detail.summary_sha512 ? `${detail.summary_sha512.slice(0, 16)}…` : '—'}
              </p>
            </div>
          </div>

          {/* Validation issues if any */}
          {detail.validation_json && detail.validation_json.length > 0 && (
            <div className="mt-3 space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-50/10 p-3 text-xs">
              <span className="font-semibold text-amber-800 dark:text-amber-200">
                Reconciliation Variances & Issues:
              </span>
              {detail.validation_json.map((issue, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  {issue.severity === 'ERROR' ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  <span
                    className={
                      issue.severity === 'ERROR'
                        ? 'text-red-600 dark:text-red-400 font-medium'
                        : 'text-amber-700 dark:text-amber-300'
                    }
                  >
                    {issue.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation Tabs */}
      <div className="mb-4 flex items-center gap-1 border-b border-[var(--border)]">
        <button
          onClick={() => setActiveTab('carcasses')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'carcasses'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Layers className="h-4 w-4" />
          Carcass Records ({carcassTotal || detail.actual_animal_count || 0})
        </button>

        <button
          onClick={() => setActiveTab('products')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'products'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <FileCheck className="h-4 w-4" />
          Product Summary {productTotal ? `(${productTotal})` : ''}
        </button>

        <button
          onClick={() => setActiveTab('distributions')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'distributions'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Scale className="h-4 w-4" />
          Distributions & Analysis
        </button>
      </div>

      {/* Tab 1: Carcass Records */}
      {activeTab === 'carcasses' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                value={carcassSearch}
                onChange={(e) => {
                  setCarcassSearch(e.target.value);
                  setCarcassPage(1);
                }}
                placeholder="Search EarTag or Grade…"
                className="pl-8 text-sm"
              />
            </div>
            <span className="text-xs text-[var(--text-secondary)]">
              Showing {carcasses.length} of {carcassTotal} carcasses
            </span>
          </div>

          {carcassesLoading && carcasses.length === 0 ? (
            <LoadingState label="Loading carcass records…" />
          ) : carcasses.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No Carcass Records"
              description={
                detail.status === 'PREVIEW_READY'
                  ? 'Carcass records are committed when the import is confirmed.'
                  : carcassSearch
                    ? 'No carcasses match your search query.'
                    : 'No carcass records were found for this import.'
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">SN</TableHead>
                    <TableHead>EarTag</TableHead>
                    <TableHead className="text-center">Grade</TableHead>
                    <TableHead className="text-right">Warm Mass (kg)</TableHead>
                    <TableHead className="text-right">Cold Mass (kg)</TableHead>
                    <TableHead className="text-center">Sex</TableHead>
                    <TableHead className="text-right">Fat (mm)</TableHead>
                    <TableHead className="text-right">Meat (mm)</TableHead>
                    <TableHead className="text-right">Meat %</TableHead>
                    <TableHead className="text-center">Sick Code</TableHead>
                    <TableHead className="text-right">Slaughtered At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carcasses.map((c) => (
                    <TableRow key={c.carcass_id}>
                      <TableCell className="font-mono text-xs text-[var(--text-secondary)]">
                        {c.serial_number ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono font-medium text-[var(--text-primary)]">
                        {c.ear_tag || '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="inline-block rounded bg-[var(--surface-raised)] px-2 py-0.5 font-mono text-xs font-semibold text-[var(--text-primary)]">
                          {c.grade || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.warm_mass_kg != null ? formatQuantity(c.warm_mass_kg) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium">
                        {c.cold_mass_kg != null ? formatQuantity(c.cold_mass_kg) : '—'}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {c.sex || '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.fat_mm != null ? c.fat_mm : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.meat_mm != null ? c.meat_mm : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.meat_percentage != null ? `${c.meat_percentage}%` : '—'}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">
                        {c.sick_code ? (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600 dark:bg-red-950/30 dark:text-red-400">
                            {c.sick_code}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-[var(--text-secondary)]">
                        {c.slaughtered_at ? formatDateTime(c.slaughtered_at) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Pagination
                page={carcassPage}
                pageSize={carcassPageSize}
                total={carcassTotal}
                onPageChange={setCarcassPage}
                onPageSizeChange={(newSize) => {
                  setCarcassPageSize(newSize);
                  setCarcassPage(1);
                }}
              />
            </>
          )}
        </div>
      )}

      {/* Tab 2: Product Summary */}
      {activeTab === 'products' && (
        <div className="space-y-3">
          {productsLoading && products.length === 0 ? (
            <LoadingState label="Loading product summary…" />
          ) : products.length === 0 ? (
            <EmptyState
              icon={FileCheck}
              title="No Product Summary Records"
              description={
                detail.summary_file_name
                  ? 'Product summary records are committed when the import is confirmed.'
                  : 'No product summary workbook was attached to this kill sheet.'
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Product Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Warm Mass (kg)</TableHead>
                    <TableHead className="text-right">Cold Mass (kg)</TableHead>
                    <TableHead className="text-right">Avg Mass (kg)</TableHead>
                    <TableHead className="text-right">Price / kg</TableHead>
                    <TableHead className="text-right">Reported Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.product_id}>
                      <TableCell className="font-medium text-[var(--text-primary)]">
                        {p.category || '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-[var(--text-secondary)]">
                        {p.product_code || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--text-secondary)]">
                        {p.description || '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {p.quantity != null ? formatQuantity(p.quantity, 'HEAD') : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {p.warm_mass_kg != null ? formatQuantity(p.warm_mass_kg) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium">
                        {p.cold_mass_kg != null ? formatQuantity(p.cold_mass_kg) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {p.average_mass_kg != null ? formatQuantity(p.average_mass_kg) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {p.reported_price != null ? formatMoney(p.reported_price, currency) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-xs">
                        {p.reported_value != null ? formatMoney(p.reported_value, currency) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Pagination
                page={productPage}
                pageSize={productPageSize}
                total={productTotal}
                onPageChange={setProductPage}
                onPageSizeChange={(newSize) => {
                  setProductPageSize(newSize);
                  setProductPage(1);
                }}
              />
            </>
          )}
        </div>
      )}

      {/* Tab 3: Distributions & Analysis */}
      {activeTab === 'distributions' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Grade Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Grade Distribution
              </CardTitle>
              <CardDescription>
                Classification of carcasses by abattoir quality grade
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.distributions?.grades && detail.distributions.grades.length > 0 ? (
                <div className="space-y-3">
                  {detail.distributions.grades.map((g) => (
                    <div key={g.grade} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[var(--text-primary)]">
                          Grade {g.grade}
                        </span>
                        <span className="font-mono text-[var(--text-secondary)]">
                          {g.count} heads ({g.percentage}%) ·{' '}
                          {g.cold_mass_kg != null
                            ? `${formatQuantity(g.cold_mass_kg)} kg`
                            : ''}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-raised)]">
                        <div
                          className="h-full bg-[var(--primary)]"
                          style={{ width: `${Math.min(100, g.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  No grade data available
                </p>
              )}
            </CardContent>
          </Card>

          {/* Sex Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Sex Breakdown
              </CardTitle>
              <CardDescription>
                Proportion of male and female animals slaughtered
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.distributions?.sexes && detail.distributions.sexes.length > 0 ? (
                <div className="space-y-3">
                  {detail.distributions.sexes.map((s) => (
                    <div key={s.sex} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[var(--text-primary)]">
                          {s.sex === 'F' ? 'Female' : s.sex === 'M' ? 'Male' : s.sex}
                        </span>
                        <span className="font-mono text-[var(--text-secondary)]">
                          {s.count} heads ({s.percentage}%)
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-raised)]">
                        <div
                          className="h-full bg-blue-500"
                          style={{ width: `${Math.min(100, s.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  No sex breakdown data available
                </p>
              )}
            </CardContent>
          </Card>

          {/* Sick Code Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Sick & Defect Codes
              </CardTitle>
              <CardDescription>
                Veterinary inspection defect and sickness codes recorded
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.distributions?.sick_codes && detail.distributions.sick_codes.length > 0 ? (
                <div className="space-y-2">
                  {detail.distributions.sick_codes.map((sc) => (
                    <div
                      key={sc.sick_code}
                      className="flex items-center justify-between rounded bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                        Code {sc.sick_code}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {sc.count} {sc.count === 1 ? 'head' : 'heads'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  No sick codes or defects recorded on this kill sheet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ConsolePage>
  );
}
