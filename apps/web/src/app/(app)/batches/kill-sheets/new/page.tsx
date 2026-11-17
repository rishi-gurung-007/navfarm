'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCheck,
  Trash2,
} from 'lucide-react';
import { ConsolePage } from '@/components/ui/console-page';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/status-badge';
import { InlineAlert } from '@/components/ui/alert';
import { showToast } from '@/components/ui/toast';
import { api } from '@/services/api-client';
import { formatQuantity } from '@/lib/utils';
import { formatDate } from '@/utils/date-short';
import { useCompanyCurrency, formatMoney } from '@/hooks/useCompanyCurrency';
import { getStoredUser, getActiveCompanyId } from '@/hooks/useAuth';

interface CompanyOption {
  id: string;
  name: string;
}

interface FarmOption {
  id: string;
  name: string;
  code: string;
  company_id?: string;
}

interface BatchOption {
  batch_id: string;
  batch_no: string;
  farm_id?: string;
  company_id?: string;
  status?: string;
}

interface PreviewResult {
  import_id?: string;
  farm_name?: string;
  company_name?: string;
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
  reconciliation_status: 'MATCHED' | 'WARNING' | 'INVALID';
  validation_json?: Array<{ severity: 'WARNING' | 'ERROR'; message: string }>;
  individual_file_name?: string;
  summary_file_name?: string;
  distributions?: {
    grades?: Array<{ grade: string; count: number; percentage: number; cold_mass_kg?: number }>;
    sexes?: Array<{ sex: string; count: number; percentage: number }>;
    sick_codes?: Array<{ sick_code: string; count: number }>;
  };
  individual?: any;
  summary?: any;
  persisted?: boolean;
}

export default function NewKillSheetPage() {
  const router = useRouter();
  const { currency } = useCompanyCurrency();
  const user = getStoredUser();

  // Selection states
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(
    getActiveCompanyId() || ''
  );

  const [farms, setFarms] = useState<FarmOption[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string>('');

  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');

  // Files
  const [individualFile, setIndividualFile] = useState<File | null>(null);
  const [summaryFile, setSummaryFile] = useState<File | null>(null);

  // Drag states
  const [individualDragging, setIndividualDragging] = useState(false);
  const [summaryDragging, setSummaryDragging] = useState(false);

  // Workflow states
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [overrideReason, setOverrideReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const individualInputRef = useRef<HTMLInputElement>(null);
  const summaryInputRef = useRef<HTMLInputElement>(null);

  // Load companies
  useEffect(() => {
    if (user?.companies && user.companies.length > 0) {
      const list = user.companies.map((c) => ({
        id: c.company_id,
        name: c.company_name,
      }));
      setCompanies(list);
      if (!selectedCompanyId && list.length > 0) {
        setSelectedCompanyId(list[0].id);
      }
    } else {
      api
        .get('/company/tenant/' + (user?.tenantId || ''))
        .then((res: any) => {
          if (Array.isArray(res) && res.length > 0) {
            const list = res.map((c: any) => ({
              id: c.company_id,
              name: c.company_name,
            }));
            setCompanies(list);
            if (!selectedCompanyId) {
              setSelectedCompanyId(list[0].id);
            }
          }
        })
        .catch(() => void 0);
    }
  }, [user?.tenantId]);

  // Load farms when company changes
  useEffect(() => {
    if (!selectedCompanyId) {
      setFarms([]);
      setSelectedFarmId('');
      return;
    }

    api
      .get(`/location?locationType=FARM&rootOnly=true&isActive=true&limit=100`)
      .then((res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        setFarms(
          items.map((loc: any) => ({
            id: loc.location_id,
            name: loc.location_name,
            code: loc.location_code,
            company_id: loc.company_id,
          }))
        );
      })
      .catch(() => void 0);
  }, [selectedCompanyId]);

  // Load batches when farm changes
  useEffect(() => {
    if (!selectedFarmId) {
      setBatches([]);
      setSelectedBatchId('');
      return;
    }

    api
      .get(`/batch?farmId=${selectedFarmId}&limit=100`)
      .then((res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        setBatches(items);
        if (items.length > 0) {
          setSelectedBatchId(items[0].batch_id);
        } else {
          setSelectedBatchId('');
        }
      })
      .catch(() => void 0);
  }, [selectedFarmId]);

  // Handle individual file selection
  const handleIndividualDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIndividualDragging(false);
    if (e.dataTransfer.files?.[0]) {
      const f = e.dataTransfer.files[0];
      if (f.name.endsWith('.xls') || f.name.endsWith('.xlsx')) {
        setIndividualFile(f);
      } else {
        setPreviewError('Only .xls and .xlsx files are accepted for Kill Sheets.');
      }
    }
  };

  const handleSummaryDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setSummaryDragging(false);
    if (e.dataTransfer.files?.[0]) {
      const f = e.dataTransfer.files[0];
      if (f.name.endsWith('.xls') || f.name.endsWith('.xlsx')) {
        setSummaryFile(f);
      } else {
        setPreviewError('Only .xls and .xlsx files are accepted for Product Summaries.');
      }
    }
  };

  const handlePreview = async () => {
    if (!selectedFarmId) {
      setPreviewError('Please select a Farm.');
      return;
    }
    if (!selectedBatchId) {
      setPreviewError('Please select a Batch.');
      return;
    }
    if (!individualFile) {
      setPreviewError('Please select an individual Kill Sheet file (.xls or .xlsx).');
      return;
    }

    setPreviewing(true);
    setPreviewError(null);
    setPreviewResult(null);
    setConfirmError(null);

    try {
      const formData = new FormData();
      formData.append('farm_id', selectedFarmId);
      formData.append('batch_id', selectedBatchId);
      formData.append('individual', individualFile);
      if (summaryFile) {
        formData.append('summary', summaryFile);
      }

      const res = await api.upload('/kill-sheets/preview', formData);
      setPreviewResult(res);
      showToast.success('Kill sheet preview and reconciliation completed.');
    } catch (err: any) {
      const msg = err?.message || 'Failed to parse and reconcile kill sheet.';
      setPreviewError(msg);
      showToast.error(msg);
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirm = async () => {
    if (!previewResult?.import_id) {
      setConfirmError('No active preview session to confirm.');
      return;
    }

    if (
      previewResult.reconciliation_status === 'WARNING' &&
      !overrideReason.trim()
    ) {
      setConfirmError(
        'A reconciliation warning requires an override reason before confirmation.'
      );
      return;
    }

    setConfirming(true);
    setConfirmError(null);

    try {
      await api.post(
        `/kill-sheets/${previewResult.import_id}/confirm`,
        {
          override_reason: overrideReason.trim() || undefined,
        }
      );

      showToast.success('Kill sheet successfully confirmed and imported!');
      router.push(`/batches/kill-sheets/${previewResult.import_id}`);
    } catch (err: any) {
      const msg = err?.message || 'Failed to confirm kill sheet.';
      setConfirmError(msg);
      showToast.error(msg);
    } finally {
      setConfirming(false);
    }
  };

  const resetWorkflow = () => {
    setPreviewResult(null);
    setPreviewError(null);
    setIndividualFile(null);
    setSummaryFile(null);
    setOverrideReason('');
    setConfirmError(null);
  };

  return (
    <ConsolePage>
      <PageHeader
        title="Upload Kill Sheet"
        description="Upload abattoir slaughter returns, validate carcass weights, reconcile product summaries, and commit to inventory."
        sticky={false}
        actions={
          <Link href="/batches/kill-sheets">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Back to List
            </Button>
          </Link>
        }
      />

      <div className="mx-auto max-w-4xl space-y-6">
        {/* Step 1: Scoped Scope & File Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              1. Scoped Target & Workbooks
            </CardTitle>
            <CardDescription>
              Select the operational company, farm, and batch against which this
              slaughter took place, then attach the abattoir workbooks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Scoped selectors */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Company" required>
                <Select
                  value={selectedCompanyId}
                  onChange={(e) => {
                    setSelectedCompanyId(e.target.value);
                    setSelectedFarmId('');
                    setSelectedBatchId('');
                  }}
                  disabled={previewResult != null || companies.length <= 1}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Farm" required>
                <Select
                  value={selectedFarmId}
                  onChange={(e) => {
                    setSelectedFarmId(e.target.value);
                    setSelectedBatchId('');
                  }}
                  disabled={previewResult != null || farms.length === 0}
                >
                  <option value="">
                    {farms.length === 0 ? 'Loading farms…' : 'Select Farm'}
                  </option>
                  {farms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Batch" required>
                <Select
                  value={selectedBatchId}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  disabled={previewResult != null || batches.length === 0}
                >
                  <option value="">
                    {batches.length === 0
                      ? selectedFarmId
                        ? 'No batches for this farm'
                        : 'Select Farm first'
                      : 'Select Batch'}
                  </option>
                  {batches.map((b) => (
                    <option key={b.batch_id} value={b.batch_id}>
                      {b.batch_no} {b.status ? `(${b.status})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Upload Zone: Individual Kill Sheet */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[var(--text-primary)]">
                  Individual Kill Sheet (.xls or .xlsx){' '}
                  <span className="text-red-500">*</span>
                </label>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  Required: Carcass weights, grades, sex, fat/meat, sick codes
                </span>
              </div>

              <div
                className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                  individualDragging
                    ? 'border-[var(--primary)] bg-[var(--surface-raised)]'
                    : individualFile
                      ? 'border-green-500/40 bg-green-50/20 dark:bg-green-950/10'
                      : 'border-[var(--border)] hover:bg-[var(--surface-raised)]'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIndividualDragging(true);
                }}
                onDragLeave={() => setIndividualDragging(false)}
                onDrop={handleIndividualDrop}
              >
                <input
                  ref={individualInputRef}
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      setIndividualFile(e.target.files[0]);
                    }
                  }}
                  disabled={previewResult != null}
                />

                {individualFile ? (
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-8 w-8 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {individualFile.name}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {(individualFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    {previewResult == null && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIndividualFile(null)}
                        className="ml-2 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center">
                    <UploadCloud className="mb-2 h-8 w-8 text-[var(--text-muted)]" />
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Drag & drop individual kill sheet here, or{' '}
                      <button
                        type="button"
                        onClick={() => individualInputRef.current?.click()}
                        className="text-[var(--primary)] underline hover:opacity-80"
                      >
                        browse
                      </button>
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      e.g. Porta Farm Batch 3647102.xls
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Upload Zone: Product Summary (Optional) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[var(--text-primary)]">
                  Product Summary (.xls or .xlsx){' '}
                  <span className="text-[var(--text-secondary)]">(Optional)</span>
                </label>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  Reconciliation: Product category quantities, masses, and reported product value
                </span>
              </div>

              <div
                className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                  summaryDragging
                    ? 'border-[var(--primary)] bg-[var(--surface-raised)]'
                    : summaryFile
                      ? 'border-green-500/40 bg-green-50/20 dark:bg-green-950/10'
                      : 'border-[var(--border)] hover:bg-[var(--surface-raised)]'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setSummaryDragging(true);
                }}
                onDragLeave={() => setSummaryDragging(false)}
                onDrop={handleSummaryDrop}
              >
                <input
                  ref={summaryInputRef}
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      setSummaryFile(e.target.files[0]);
                    }
                  }}
                  disabled={previewResult != null}
                />

                {summaryFile ? (
                  <div className="flex items-center gap-3">
                    <FileCheck className="h-8 w-8 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {summaryFile.name}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {(summaryFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    {previewResult == null && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSummaryFile(null)}
                        className="ml-2 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center">
                    <UploadCloud className="mb-2 h-8 w-8 text-[var(--text-muted)]" />
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Drag & drop product summary workbook here, or{' '}
                      <button
                        type="button"
                        onClick={() => summaryInputRef.current?.click()}
                        className="text-[var(--primary)] underline hover:opacity-80"
                      >
                        browse
                      </button>
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      e.g. Porta Farm Summary Batch 3647102.xls
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Error display */}
            {previewError && (
              <InlineAlert variant="danger">{previewError}</InlineAlert>
            )}

            {/* Preview Action Button */}
            {previewResult == null && (
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handlePreview}
                  disabled={
                    previewing ||
                    !selectedFarmId ||
                    !selectedBatchId ||
                    !individualFile
                  }
                  className="min-w-[180px] gap-2"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {previewing ? 'Parsing & Reconciling…' : 'Preview & Reconcile'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Preview & Reconciliation Results */}
        {previewResult && (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">
                    2. Parsed Metadata & Reconciliation
                  </CardTitle>
                  <CardDescription>
                    Review parsed slaughter totals, carcass distributions, and
                    workbook reconciliation before confirmation.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={previewResult.reconciliation_status} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetWorkflow}
                    className="text-xs"
                  >
                    Change Files
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Meta Header */}
                <div className="grid grid-cols-2 gap-4 rounded-lg bg-[var(--surface-raised)] p-4 text-xs sm:grid-cols-4">
                  <div>
                    <span className="text-[var(--text-secondary)]">Report Ref:</span>
                    <p className="font-mono font-medium text-[var(--text-primary)]">
                      {previewResult.report_reference || '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--text-secondary)]">Report Batch Ref:</span>
                    <p className="font-mono font-medium text-[var(--text-primary)]">
                      {previewResult.report_batch_reference || '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--text-secondary)]">Slaughter From:</span>
                    <p className="font-medium text-[var(--text-primary)]">
                      {formatDate(previewResult.slaughter_from)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--text-secondary)]">Slaughter To:</span>
                    <p className="font-medium text-[var(--text-primary)]">
                      {formatDate(previewResult.slaughter_to)}
                    </p>
                  </div>
                </div>

                {/* KPI Stat Cards */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Slaughtered Heads
                    </span>
                    <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                      {formatQuantity(previewResult.actual_animal_count, 'HEAD')}
                    </p>
                  </div>

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Warm Mass
                    </span>
                    <p className="mt-1 text-xl font-bold font-mono text-[var(--text-primary)]">
                      {formatQuantity(previewResult.actual_warm_mass_kg)} <span className="text-xs font-normal">kg</span>
                    </p>
                  </div>

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Cold Mass
                    </span>
                    <p className="mt-1 text-xl font-bold font-mono text-[var(--text-primary)]">
                      {formatQuantity(previewResult.actual_cold_mass_kg)} <span className="text-xs font-normal">kg</span>
                    </p>
                  </div>

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Avg Carcass Weight
                    </span>
                    <p className="mt-1 text-xl font-bold font-mono text-[var(--text-primary)]">
                      {previewResult.average_carcass_weight != null
                        ? Number(previewResult.average_carcass_weight).toFixed(2)
                        : (
                            Number(previewResult.actual_cold_mass_kg) /
                            Number(previewResult.actual_animal_count)
                          ).toFixed(2)}{' '}
                      <span className="text-xs font-normal">kg</span>
                    </p>
                  </div>

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Reported Product Value
                    </span>
                    <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                      {previewResult.reported_product_value != null
                        ? formatMoney(previewResult.reported_product_value, currency)
                        : '—'}
                    </p>
                  </div>
                </div>

                {/* Validation / Issues alert */}
                {previewResult.validation_json && previewResult.validation_json.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-[var(--text-primary)]">
                      Reconciliation Details & Issues:
                    </h4>
                    <div className="space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-50/10 p-3 text-xs">
                      {previewResult.validation_json.map((issue, idx) => (
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
                  </div>
                )}

                {/* Distributions Preview */}
                {previewResult.distributions && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {/* Grades */}
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <h4 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">
                        Grade Classification
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        {previewResult.distributions.grades?.map((g) => (
                          <div
                            key={g.grade}
                            className="flex items-center justify-between"
                          >
                            <span className="font-medium">Grade {g.grade}</span>
                            <span className="font-mono text-[var(--text-secondary)]">
                              {g.count} ({g.percentage}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Sex */}
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <h4 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">
                        Sex Breakdown
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        {previewResult.distributions.sexes?.map((s) => (
                          <div
                            key={s.sex}
                            className="flex items-center justify-between"
                          >
                            <span className="font-medium">
                              {s.sex === 'F' ? 'Female' : s.sex === 'M' ? 'Male' : s.sex}
                            </span>
                            <span className="font-mono text-[var(--text-secondary)]">
                              {s.count} ({s.percentage}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Sick codes */}
                    <div className="rounded-lg border border-[var(--border)] p-3">
                      <h4 className="mb-2 text-xs font-semibold text-[var(--text-primary)]">
                        Sick / Defect Codes
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        {previewResult.distributions.sick_codes &&
                        previewResult.distributions.sick_codes.length > 0 ? (
                          previewResult.distributions.sick_codes.map((sc) => (
                            <div
                              key={sc.sick_code}
                              className="flex items-center justify-between"
                            >
                              <span className="font-mono font-medium">
                                Code {sc.sick_code}
                              </span>
                              <span className="font-mono text-[var(--text-secondary)]">
                                {sc.count} heads
                              </span>
                            </div>
                          ))
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            No sick codes recorded
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Step 3: Confirmation Form */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  3. Commit & Confirm Import
                </CardTitle>
                <CardDescription>
                  Confirming commits the parsed carcass records and product summary
                  into the database and updates production metrics.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {previewResult.reconciliation_status === 'WARNING' && (
                  <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-50/10 p-4">
                    <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                      <span>
                        Reconciliation produced warnings. An explicit override reason is
                        required to confirm this import.
                      </span>
                    </div>
                    <Field label="Override Reason" required>
                      <textarea
                        rows={3}
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="Explain reason for accepting reconciliation variances (e.g. Trimming variance accepted by abattoir supervisor)…"
                        className="w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] p-2 text-sm text-[var(--input-text)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                      />
                    </Field>
                  </div>
                )}

                {previewResult.reconciliation_status === 'INVALID' && (
                  <InlineAlert variant="danger">
                    This workbook contains critical validation errors and cannot be
                    confirmed. Please resolve errors in the source workbook and
                    upload again.
                  </InlineAlert>
                )}

                {confirmError && (
                  <InlineAlert variant="danger">{confirmError}</InlineAlert>
                )}

                <div className="flex items-center justify-between pt-2">
                  <Button variant="outline" onClick={resetWorkflow}>
                    Discard & Start Over
                  </Button>

                  <Button
                    onClick={handleConfirm}
                    disabled={
                      confirming ||
                      previewResult.reconciliation_status === 'INVALID' ||
                      (previewResult.reconciliation_status === 'WARNING' &&
                        !overrideReason.trim())
                    }
                    className="min-w-[200px] gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {confirming ? 'Committing Import…' : 'Confirm & Import Kill Sheet'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </ConsolePage>
  );
}
