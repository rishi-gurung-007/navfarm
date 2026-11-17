'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileSpreadsheet,
  Plus,
  Search,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { ConsolePage } from '@/components/ui/console-page';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/states';
import { api } from '@/services/api-client';
import { formatQuantity } from '@/lib/utils';
import { formatDate } from '@/utils/date-short';
import { useCompanyCurrency, formatMoney } from '@/hooks/useCompanyCurrency';
import { getStoredUser, getActiveCompanyId } from '@/hooks/useAuth';

interface KillSheetRow {
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
  reconciliation_status: 'MATCHED' | 'WARNING' | 'INVALID';
  status: 'PREVIEW_READY' | 'IMPORTED';
  created_at: string;
}

export default function KillSheetsPage() {
  const router = useRouter();
  const { currency } = useCompanyCurrency();
  const user = getStoredUser();

  const [rows, setRows] = useState<KillSheetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(
    getActiveCompanyId() || ''
  );
  const [selectedFarmId, setSelectedFarmId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Options
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [farms, setFarms] = useState<Array<{ id: string; name: string; code: string }>>([]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load companies
  useEffect(() => {
    if (user?.companies && user.companies.length > 0) {
      setCompanies(
        user.companies.map((c) => ({
          id: c.company_id,
          name: c.company_name,
        }))
      );
    } else {
      api
        .get('/company/tenant/' + (user?.tenantId || ''))
        .then((res: any) => {
          if (Array.isArray(res)) {
            setCompanies(
              res.map((c: any) => ({
                id: c.company_id,
                name: c.company_name,
              }))
            );
          }
        })
        .catch(() => void 0);
    }
  }, [user?.tenantId]);

  // Load farms when company changes
  useEffect(() => {
    api
      .get('/location?locationType=FARM&rootOnly=true&isActive=true&limit=100')
      .then((res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        setFarms(
          items.map((loc: any) => ({
            id: loc.location_id,
            name: loc.location_name,
            code: loc.location_code,
          }))
        );
      })
      .catch(() => void 0);
  }, [selectedCompanyId]);

  const fetchKillSheets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      if (selectedCompanyId) params.set('company_id', selectedCompanyId);
      if (selectedFarmId) params.set('farm_id', selectedFarmId);
      if (selectedStatus && selectedStatus !== 'ALL')
        params.set('status', selectedStatus);

      const res = await api.get(`/kill-sheets?${params.toString()}`);
      setRows(res?.data ?? []);
      setTotal(res?.total ?? (res?.data?.length || 0));
    } catch (err: any) {
      setError(err?.message || 'Failed to load Kill Sheets.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch, selectedCompanyId, selectedFarmId, selectedStatus]);

  useEffect(() => {
    fetchKillSheets();
  }, [fetchKillSheets]);

  const handleCompanyChange = (compId: string) => {
    setSelectedCompanyId(compId);
    setSelectedFarmId('');
    setPage(1);
  };

  const handleFarmChange = (farmId: string) => {
    setSelectedFarmId(farmId);
    setPage(1);
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    setPage(1);
  };

  return (
    <ConsolePage>
      <PageHeader
        title="Kill Sheets"
        description="Abattoir slaughter reports, carcass classifications, product summaries, and reconciliation."
        sticky={false}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchKillSheets()}
              disabled={loading}
              title="Refresh list"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Link href="/batches/kill-sheets/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Upload Kill Sheet
              </Button>
            </Link>
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <div className="mb-4 flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search box */}
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search farm, batch, ref, or EarTag…"
              className="pl-8 text-sm"
            />
          </div>

          {/* Company filter */}
          {companies.length > 1 && (
            <div className="w-[180px]">
              <Select
                value={selectedCompanyId}
                onChange={(e) => handleCompanyChange(e.target.value)}
                className="text-sm"
              >
                <option value="">All Companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Farm filter */}
          <div className="w-[180px]">
            <Select
              value={selectedFarmId}
              onChange={(e) => handleFarmChange(e.target.value)}
              className="text-sm"
            >
              <option value="">All Farms</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.code})
                </option>
              ))}
            </Select>
          </div>

          {/* Status filter */}
          <div className="w-[150px]">
            <Select
              value={selectedStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="text-sm"
            >
              <option value="ALL">All Statuses</option>
              <option value="IMPORTED">Confirmed (Imported)</option>
              <option value="PREVIEW_READY">Preview Ready</option>
            </Select>
          </div>
        </div>

        {(search || selectedCompanyId || selectedFarmId || selectedStatus !== 'ALL') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setSelectedCompanyId('');
              setSelectedFarmId('');
              setSelectedStatus('ALL');
              setPage(1);
            }}
            className="text-xs text-[var(--text-secondary)]"
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Main Table / States */}
      {loading && rows.length === 0 ? (
        <LoadingState label="Loading Kill Sheets…" />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchKillSheets} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No Kill Sheets Found"
          description={
            debouncedSearch || selectedFarmId || selectedStatus !== 'ALL'
              ? 'No kill sheets match your active filter criteria. Try adjusting your search or filters.'
              : 'Upload an individual slaughter sheet (.xls or .xlsx) and optional product summary to get started.'
          }
          action={{
            label: 'Upload Kill Sheet',
            onClick: () => router.push('/batches/kill-sheets/new'),
          }}
        />
      ) : (
        <div className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Farm & Company</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Report Ref</TableHead>
                <TableHead className="text-right">Heads</TableHead>
                <TableHead className="text-right">Warm Mass (kg)</TableHead>
                <TableHead className="text-right">Cold Mass (kg)</TableHead>
                <TableHead className="text-right">Avg Carcass (kg)</TableHead>
                <TableHead className="text-right">Reported Value</TableHead>
                <TableHead className="text-center">Reconciliation</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const avgWeight =
                  r.average_carcass_weight != null
                    ? Number(r.average_carcass_weight).toFixed(2)
                    : r.actual_animal_count && r.actual_cold_mass_kg
                      ? (
                          Number(r.actual_cold_mass_kg) /
                          Number(r.actual_animal_count)
                        ).toFixed(2)
                      : '—';

                return (
                  <TableRow
                    key={r.import_id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/batches/kill-sheets/${r.import_id}`)
                    }
                  >
                    <TableCell>
                      <div className="font-medium text-[var(--text-primary)]">
                        {r.farm_name || 'Farm'}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)]">
                        {r.company_name || r.farm_code || '—'}
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className="font-mono font-medium text-[var(--text-primary)]">
                        {r.batch_no || '—'}
                      </span>
                    </TableCell>

                    <TableCell>
                      <div className="text-xs font-mono text-[var(--text-primary)]">
                        {r.report_reference || '—'}
                      </div>
                      {r.slaughter_from && (
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {formatDate(r.slaughter_from)}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="text-right font-medium">
                      {r.actual_animal_count != null
                        ? formatQuantity(r.actual_animal_count, 'HEAD')
                        : '—'}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs">
                      {r.actual_warm_mass_kg != null
                        ? formatQuantity(r.actual_warm_mass_kg)
                        : '—'}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs font-medium">
                      {r.actual_cold_mass_kg != null
                        ? formatQuantity(r.actual_cold_mass_kg)
                        : '—'}
                    </TableCell>

                    <TableCell className="text-right font-mono text-xs">
                      {avgWeight !== '—' ? `${avgWeight} kg` : '—'}
                    </TableCell>

                    <TableCell className="text-right font-medium text-xs">
                      {r.reported_product_value != null
                        ? formatMoney(r.reported_product_value, currency)
                        : '—'}
                    </TableCell>

                    <TableCell className="text-center">
                      <StatusBadge status={r.reconciliation_status} />
                    </TableCell>

                    <TableCell className="text-center">
                      <StatusBadge status={r.status} />
                    </TableCell>

                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Pagination */}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setPage(1);
            }}
          />
        </div>
      )}
    </ConsolePage>
  );
}
