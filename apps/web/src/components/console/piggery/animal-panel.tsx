'use client';

import { NA } from '@/utils/na';
import { useEffect, useState } from 'react';
import {
  Search,
  Loader2,
  Inbox,
  Eye,
  AlertCircle,
  ChevronRight,
  Scan,
} from 'lucide-react';
import { api } from '@/services/api-client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { Pagination } from '@/components/ui/pagination';
import { getActiveCompanyId } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import type { TranslationKeys } from '@/utils/translations';
import { StatusBadge } from '@/components/ui/status-badge';
import RfidScannerModal from '@/components/console/piggery/rfid-scanner-modal';
import AnimalStageTransitionModal from '@/components/console/piggery/animal-stage-transition-modal';
import AnimalDetailsModal from '@/components/console/piggery/animal-details-modal';
import { ReasonSelect } from '@/components/ui/reason-select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  raised: {
    backgroundColor: 'var(--surface-raised)',
    borderColor: 'var(--border)',
  },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  accent: { color: 'var(--accent)' },
  danger: {
    color: 'var(--danger)',
    borderColor: 'var(--danger)',
    backgroundColor: 'var(--danger-muted)',
  },
  warning: {
    color: 'var(--warning)',
    borderColor: 'var(--warning)',
    backgroundColor: 'var(--warning-muted)',
  },
  success: {
    color: 'var(--success)',
    borderColor: 'var(--success)',
    backgroundColor: 'var(--success-muted)',
  },
};

const inputCls = 'nf-input';

const STATUS_LABEL_KEY: Record<string, TranslationKeys> = {
  ACTIVE: 'anpStatusActive',
  QUARANTINE: 'anpStatusQuarantine',
  SICK: 'anpStatusSick',
  PREGNANT: 'anpStatusPregnant',
  LACTATING: 'anpStatusLactating',
  DRY: 'anpStatusDry',
  CULLED: 'anpStatusCulled',
  DEAD: 'anpStatusDead',
  SOLD: 'anpStatusSold',
  SLAUGHTERED: 'anpStatusSlaughtered',
};

const ANIMAL_TYPE_LABEL_KEY: Record<string, TranslationKeys> = {
  SOW: 'anpTypeSow',
  BOAR: 'anpTypeBoar',
  GILT: 'anpTypeGilt',
  PIGLET: 'anpTypePiglet',
  COMMERCIAL_PIG: 'anpTypeCommercialPig',
};

const DISPOSAL_TYPES = [
  'SOLD',
  'SLAUGHTERED',
  'DIED',
  'TRANSFERRED',
  'CULLED',
] as const;
const DISPOSAL_TYPE_LABEL_KEY: Record<string, TranslationKeys> = {
  SOLD: 'anpDisposalSold',
  SLAUGHTERED: 'anpDisposalSlaughtered',
  DIED: 'anpDisposalDied',
  TRANSFERRED: 'anpDisposalTransferred',
  CULLED: 'anpDisposalCulled',
};

function formatDate(d?: string | null) {
  if (!d) return NA;
  return new Date(d).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Withdrawal warning banner ─────────────────────────────────────────────────
// The API returns a 400 with a message like:
//   "Cannot slaughter — withdrawal period not elapsed for: Ivermectin (3 day(s) remaining, last dose 2026-08-15); Oxytetracycline (1 day(s) remaining, last dose 2026-08-18)"
// We parse and render that as structured rows rather than a raw toast.

function WithdrawalWarning({
  message,
  t,
}: {
  message: string;
  t: (key: TranslationKeys, vars?: any) => string;
}) {
  // Strip the prefix up to the colon after "for:", then split on ";"
  const afterColon = message.replace(/^Cannot slaughter[^:]*:\s*/, '');
  const items = afterColon
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div
      className="rounded-[var(--radius-md)] border p-4"
      style={S.danger}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {t('anpCannotSlaughterHeading')}
          </p>
          {items.length > 0 && (
            <ul className="mt-2 space-y-1">
              {items.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnimalPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();

  const genderLabel = (g?: string) =>
    g === 'F' ? t('anpGenderFemale') : g === 'M' ? t('anpGenderMale') : g || '';
  const statusLabel = (s?: string) =>
    s && STATUS_LABEL_KEY[s]
      ? t(STATUS_LABEL_KEY[s])
      : (s || '').replace(/_/g, ' ');
  const animalTypeLabel = (v?: string) =>
    v && ANIMAL_TYPE_LABEL_KEY[v]
      ? t(ANIMAL_TYPE_LABEL_KEY[v])
      : (v || '').replace(/_/g, ' ');
  const disposalTypeLabel = (v?: string) =>
    v && DISPOSAL_TYPE_LABEL_KEY[v] ? t(DISPOSAL_TYPE_LABEL_KEY[v]) : v || '';

  // ── List state ──────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [breedFilter, setBreedFilter] = useState('');
  const [includeDisposed, setIncludeDisposed] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(PAGE_SIZE);

  // ── Reference data ──────────────────────────────────────────────────────────
  // Company-wide breed lookup for the list table, loaded once on mount.
  const [breedLookup, setBreedLookup] = useState<Record<string, string>>({});
  const breedName = (id?: string | null) => (id && breedLookup[id]) || id || NA;
  const [medItems, setMedItems] = useState<Row[]>([]); // MEDICINE + VACCINE filtered
  const [batches, setBatches] = useState<Row[]>([]);
  const [stages, setStages] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [reasons, setReasons] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);

  // ── Fast Scanner Modal ──────────────────────────────────────────────────
  const [scannerOpen, setScannerOpen] = useState(false);

  // ── Stage Transition Modal ──────────────────────────────────────────────
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionAnimal, setTransitionAnimal] = useState<Row | null>(null);

  // ── Detail modal ────────────────────────────────────────────────────────────
  const [detailsAnimalId, setDetailsAnimalId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);

  // ── Out of production (BBP-1: before a cull) ──────────────────────────────────
  const [oopOpen, setOopOpen] = useState(false);
  const [oopDate, setOopDate] = useState('');
  const [oopError, setOopError] = useState('');
  const [oopSaving, setOopSaving] = useState(false);
  const handleOutOfProduction = async () => {
    if (!viewing || oopSaving) return;
    setOopSaving(true);
    setOopError('');
    try {
      const res: any = await api.patch(
        `/animal/${viewing.animal_id}/out-of-production`,
        { out_of_production_date: oopDate },
      );
      setViewing(res?.data ?? res ?? viewing);
      setOopOpen(false);
      load();
    } catch (err: any) {
      setOopError(
        err?.message || 'Could not record the out-of-production date.',
      );
    } finally {
      setOopSaving(false);
    }
  };

  // ── Dispose modal ───────────────────────────────────────────────────────────
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposeSaving, setDisposeSaving] = useState(false);
  const [disposeError, setDisposeError] = useState('');
  const [disposeIsWithdrawal, setDisposeIsWithdrawal] = useState(false);
  const [disposeForm, setDisposeForm] = useState<Row>({
    disposal_type: 'SOLD',
    disposal_date: new Date().toISOString().slice(0, 10),
    disposal_value: '',
    disposal_reason_id: '',
    notes: '',
  });

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (breedFilter) params.set('breedId', breedFilter);
      if (includeDisposed) params.set('includeDisposed', 'true');
      params.set('limit', '200');
      const res = await api.get(`/animal?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
      setPage(1);
    } catch (err: any) {
      setError(err?.message || t('anpErrLoadAnimals'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [search, statusFilter, breedFilter, includeDisposed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reference data — loaded once on mount
  useEffect(() => {
    const qs = companyId ? `?companyId=${companyId}&limit=500` : '?limit=500';
    api
      .get(`/batch${qs}`)
      .then((r) => setBatches(unwrap<Row[]>(r) || []))
      .catch(() => {});
    api
      .get(`/stage?limit=100`)
      .then((r) => setStages(unwrap<Row[]>(r) || []))
      .catch(() => {});
    api
      .get(`/location${qs}`)
      .then((r) => setLocations(unwrap<Row[]>(r) || []))
      .catch(() => {});
    api
      .get(`/reason${qs.replace(/^\?/, '?isActive=true&')}`)
      .then((r) => setReasons(unwrap<Row[]>(r) || []))
      .catch(() => {});
    api
      .get(`/customer${qs}`)
      .then((r) =>
        setCustomers(
          (unwrap<Row[]>(r) || []).filter((c: Row) => c.is_active !== false),
        ),
      )
      .catch(() => setCustomers([]));
    api
      .get(`/item${qs.replace(/^\?/, '?isActive=true&isBlocked=false&')}`)
      .then((r) => {
        const all = unwrap<Row[]>(r) || [];
        setMedItems(
          all.filter(
            (i: Row) =>
              !i.is_blocked &&
              i.is_active !== false &&
              ['MEDICINE', 'VACCINE'].includes(i.item_type),
          ),
        );
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Company-wide breed names for the list table (see breedLookup above).
  useEffect(() => {
    const qs = new URLSearchParams();
    if (companyId) qs.set('companyId', companyId);
    qs.set('limit', '500');
    api
      .get(`/breed?${qs.toString()}`)
      .then((r) => {
        const list = unwrap<Row[]>(r) || [];
        setBreedLookup(
          Object.fromEntries(list.map((b) => [b.breed_id, b.breed_name])),
        );
      })
      .catch(() => setBreedLookup({}));
  }, [companyId]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openView = (row: Row) => {
    setDetailsAnimalId(row.animal_id);
  };

  const handleDispose = async () => {
    if (!viewing) return;
    setDisposeSaving(true);
    setDisposeError('');
    setDisposeIsWithdrawal(false);
    try {
      if (!disposeForm.disposal_type)
        throw new Error(t('anpErrDisposalTypeRequired'));
      if (!disposeForm.disposal_date)
        throw new Error(t('anpErrDisposalDateRequired'));
      await api.patch(`/animal/${viewing.animal_id}/dispose`, {
        disposal_type: disposeForm.disposal_type,
        disposal_date: disposeForm.disposal_date,
        disposal_reason_id: disposeForm.disposal_reason_id || undefined,
        disposal_value: disposeForm.disposal_value
          ? Number(disposeForm.disposal_value)
          : undefined,
        exit_weight_kg: disposeForm.exit_weight_kg
          ? Number(disposeForm.exit_weight_kg)
          : undefined,
        disposal_destination:
          disposeForm.disposal_destination?.trim() || undefined,
        customer_id:
          disposeForm.disposal_type === 'SOLD'
            ? disposeForm.customer_id || undefined
            : undefined,
        out_of_production_date:
          disposeForm.disposal_type === 'CULLED'
            ? disposeForm.out_of_production_date || undefined
            : undefined,
        notes: disposeForm.notes || undefined,
      });
      setDisposeOpen(false);
      setViewing(null);
      load();
    } catch (err: any) {
      const msg: string = err?.message || t('anpErrDisposeAnimal');
      // Withdrawal-period errors have a specific prefix — surface them structured
      if (msg.includes('Cannot slaughter')) {
        setDisposeIsWithdrawal(true);
      }
      setDisposeError(msg);
    } finally {
      setDisposeSaving(false);
    }
  };

  // ── Pagination ───────────────────────────────────────────────────────────────
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={S.muted}
          />
          <input
            id="animal-search"
            className={inputCls}
            style={{ paddingLeft: '2rem' }}
            placeholder={t('anpSearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="min-w-[12rem]">
          <SearchableSelect
            id="animal-status-filter"
            ariaLabel={t('anpAllStatuses')}
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
            options={[
              { value: '', label: t('anpAllStatuses') },
              ...Object.keys(STATUS_LABEL_KEY).map((s) => ({
                value: s,
                label: statusLabel(s),
              })),
            ]}
            columnHeaders={false}
            placeholder={t('anpAllStatuses')}
            triggerClassName="nf-input-sm min-w-[12rem] h-9"
          />
        </div>

        <div className="min-w-[12rem]">
          <SearchableSelect
            id="animal-breed-filter"
            ariaLabel={t('anpAllBreeds')}
            value={breedFilter}
            onChange={(val) => setBreedFilter(val)}
            options={[
              { value: '', label: t('anpAllBreeds') },
              ...Object.entries(breedLookup)
                .sort(([, a], [, b]) => a.localeCompare(b))
                .map(([id, name]) => ({ value: id, label: name })),
            ]}
            columnHeaders={false}
            placeholder={t('anpAllBreeds')}
            triggerClassName="nf-input-sm min-w-[12rem] h-9"
          />
        </div>

        <label
          className="flex items-center gap-2 text-sm cursor-pointer"
          style={S.sub}
        >
          <input
            type="checkbox"
            checked={includeDisposed}
            onChange={(e) => setIncludeDisposed(e.target.checked)}
            className="rounded-[var(--radius-xs)]"
          />
          {t('anpIncludeDisposed')}
        </label>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setScannerOpen(true)}
        >
          <Scan className="mr-1.5 h-3.5 w-3.5" /> {t('anpRfidFastScanner')}
        </Button>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError('')} />

      {/* ── List table ── */}
      <div
        className="overflow-hidden rounded-[var(--radius-md)] border"
        style={S.surface}
      >
        <table className="w-full text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="text-left">{t('anpColCode')}</TableHead>
              <TableHead className="text-left">{t('anpColType')}</TableHead>
              <TableHead className="text-left">{t('anpColGender')}</TableHead>
              <TableHead className="text-left">{t('anpColBreed')}</TableHead>
              <TableHead className="text-left">{t('anpColStatus')}</TableHead>
              <TableHead className="text-left">
                {t('anpColEntryDate')}
              </TableHead>
              <TableHead className="text-left">{t('anpRfidTag')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <Loader2
                    className="mx-auto h-5 w-5 animate-spin"
                    style={S.muted}
                  />
                </TableCell>
              </TableRow>
            )}
            {!loading && pagedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-16 text-center">
                  <Inbox className="mx-auto h-8 w-8 mb-3" style={S.muted} />
                  <p className="text-sm" style={S.sub}>
                    {t('anpNoAnimalsFound')}
                  </p>
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              pagedRows.map((row) => (
                <TableRow
                  key={row.animal_id}
                  className="cursor-pointer hover:bg-[var(--surface-raised)]"
                  onClick={() => openView(row)}
                >
                  <TableCell
                    className="font-mono text-xs font-semibold"
                    style={S.accent}
                  >
                    {row.animal_code}
                  </TableCell>
                  <TableCell style={S.sub}>
                    {animalTypeLabel(row.animal_type)}
                  </TableCell>
                  <TableCell style={S.sub}>{genderLabel(row.gender)}</TableCell>
                  <TableCell style={S.sub}>{breedName(row.breed_id)}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.status || 'ACTIVE'}
                      label={statusLabel(row.status || 'ACTIVE')}
                    />
                  </TableCell>
                  <TableCell style={S.muted}>
                    {formatDate(row.entry_date)}
                  </TableCell>
                  <TableCell style={S.muted}>{row.rfid_tag || NA}</TableCell>
                  <TableCell>
                    <button
                      aria-label={t('anpViewAnimal')}
                      className="p-1 rounded-[var(--radius-xs)] hover:bg-[var(--surface-secondary)]"
                      style={S.muted}
                      onClick={(e) => {
                        e.stopPropagation();
                        openView(row);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </table>
      </div>

      {rows.length > pageSize && (
        <div className="mt-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={setPage}
          />
        </div>
      )}

      {/* ═══ Animal Details Modal (7-Tab Card: Overview, Lineage, Health, Weight, Breeding [Farrowing & Insemination], Movement, Costing) ═══ */}
      <AnimalDetailsModal
        animalId={detailsAnimalId}
        onClose={() => setDetailsAnimalId(null)}
        onOpenStageTransition={(anim) => {
          setTransitionAnimal(anim);
          setTransitionOpen(true);
        }}
        onOpenDispose={(anim) => {
          setViewing(anim);
          setDisposeForm({
            disposal_type: 'SOLD',
            disposal_date: new Date().toISOString().slice(0, 10),
            disposal_value: '',
            disposal_reason_id: '',
            exit_weight_kg: '',
            disposal_destination: '',
            out_of_production_date: anim.out_of_production_date
              ? String(anim.out_of_production_date).slice(0, 10)
              : '',
            notes: '',
          });
          setDisposeError('');
          setDisposeIsWithdrawal(false);
          setDisposeOpen(true);
        }}
        onOpenOutOfProduction={(anim) => {
          setViewing(anim);
          setOopDate(
            anim.out_of_production_date
              ? String(anim.out_of_production_date).slice(0, 10)
              : new Date().toISOString().slice(0, 10),
          );
          setOopError('');
          setOopOpen(true);
        }}
      />

      {/* ═══ Dispose Modal ═════════════════════════════════════════════════════ */}
      <Dialog
        open={disposeOpen}
        onClose={() => setDisposeOpen(false)}
        title={
          viewing
            ? t('anpDisposeAnimalTitleWithCode', { code: viewing.animal_code })
            : t('anpDisposeAnimalTitle')
        }
        description={t('anpDisposeAnimalDesc')}
        maxWidth="sm"
        footer={
          <Button
            id="animal-dispose-confirm-btn"
            variant="destructive"
            onClick={handleDispose}
            disabled={disposeSaving}
          >
            {disposeSaving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t('anpSaving')}
              </>
            ) : (
              t('anpConfirmDisposal')
            )}
          </Button>
        }
      >
        {/* Structured withdrawal warning — shown instead of generic error when it's that specific error */}
        {disposeError && disposeIsWithdrawal && (
          <WithdrawalWarning message={disposeError} t={t} />
        )}
        <Toast
          variant="danger"
          message={disposeIsWithdrawal ? '' : disposeError}
          onClose={() => setDisposeError('')}
        />

        {/* Show a proactive hint when slaughter is selected, before the user submits */}
        {disposeForm.disposal_type === 'SLAUGHTERED' && !disposeError && (
          <div
            className="mb-4 rounded-[var(--radius-md)] border p-3 text-xs"
            style={S.warning}
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('anpSlaughterWithdrawalHint')}</span>
            </div>
          </div>
        )}

        <div className="space-y-4 mt-1">
          <div>
            <label className="nf-label" htmlFor="dispose-type">
              {t('anpDisposalType')}
            </label>
            <SearchableSelect
              id="dispose-type"
              ariaLabel={t('anpDisposalType')}
              value={disposeForm.disposal_type}
              onChange={(val) => {
                setDisposeForm((f) => ({
                  ...f,
                  disposal_type: val,
                  disposal_reason_id: '',
                }));
                setDisposeError('');
                setDisposeIsWithdrawal(false);
              }}
              options={DISPOSAL_TYPES.map((tp) => ({
                value: tp,
                label: disposalTypeLabel(tp),
              }))}
              placeholder={t('anpSelectPlaceholder')}
              columnHeaders={false}
            />
          </div>

          <div>
            <label className="nf-label" htmlFor="dispose-date">
              {t('anpDate')}
            </label>
            <input
              id="dispose-date"
              type="date"
              className={inputCls}
              value={disposeForm.disposal_date}
              onChange={(e) =>
                setDisposeForm((f) => ({ ...f, disposal_date: e.target.value }))
              }
            />
          </div>

          {/* Reason Master Template (Master Templates/, 2026-09-21): a DIED
              disposal must pick a MORTALITY reason (enforced server-side);
              other disposal types offer the DISPOSAL/TRANSFER destinations
              the template gives for them (e.g. "Colcom Abattoir"). Optional —
              SOLD/TRANSFERRED commonly has no catalog reason behind it. */}
          <div>
            <label className="nf-label" htmlFor="dispose-reason">
              {t('anpDisposalReason')}
            </label>
            <ReasonSelect
              id="dispose-reason"
              ariaLabel={t('anpDisposalReason')}
              value={disposeForm.disposal_reason_id}
              valueFormat="id"
              onChange={(val) =>
                setDisposeForm((f) => ({ ...f, disposal_reason_id: val }))
              }
              onClear={() =>
                setDisposeForm((f) => ({ ...f, disposal_reason_id: '' }))
              }
              category={
                disposeForm.disposal_type === 'DIED'
                  ? 'MORTALITY'
                  : disposeForm.disposal_type === 'CULLED'
                    ? 'CULL'
                    : ['DISPOSAL', 'TRANSFER']
              }
              placeholder={
                t('anpDisposalReasonNone') || 'Select disposal reason…'
              }
              reasons={reasons as any}
            />
          </div>

          {disposeForm.disposal_type === 'CULLED' && (
            <>
              <p className="text-xs text-[var(--text-secondary)]">
                {t('anpCullNeeds')}
              </p>
              <div>
                <label className="nf-label" htmlFor="dispose-oop">
                  {t('anpOutOfProductionDate')}
                </label>
                <input
                  id="dispose-oop"
                  type="date"
                  className={inputCls}
                  value={disposeForm.out_of_production_date || ''}
                  onChange={(e) =>
                    setDisposeForm((f) => ({
                      ...f,
                      out_of_production_date: e.target.value,
                    }))
                  }
                />
              </div>
            </>
          )}

          {disposeForm.disposal_type === 'SOLD' && (
            <div>
              <label className="nf-label">{t('blLabelCustomer')}</label>
              <SearchableSelect
                ariaLabel={t('blLabelCustomer')}
                value={disposeForm.customer_id || ''}
                onChange={(v) =>
                  setDisposeForm((f) => ({ ...f, customer_id: v }))
                }
                options={customers}
                valueKey="customer_id"
                getLabel={(c) =>
                  `${c.customer_code ?? ''} ${c.customer_name ?? ''}`.trim()
                }
                placeholder={t('blSelectEllipsis')}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="nf-label" htmlFor="dispose-weight">
                {t('anpExitWeightKg')}
              </label>
              <input
                id="dispose-weight"
                type="number"
                min="0"
                step="0.1"
                className={inputCls}
                value={disposeForm.exit_weight_kg || ''}
                onChange={(e) =>
                  setDisposeForm((f) => ({
                    ...f,
                    exit_weight_kg: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label className="nf-label" htmlFor="dispose-destination">
                {t('anpDisposalDestination')}
              </label>
              <input
                id="dispose-destination"
                type="text"
                className={inputCls}
                value={disposeForm.disposal_destination || ''}
                onChange={(e) =>
                  setDisposeForm((f) => ({
                    ...f,
                    disposal_destination: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div>
            <label className="nf-label" htmlFor="dispose-value">
              {t('anpDisposalValue')}
            </label>
            <input
              id="dispose-value"
              type="number"
              min="0"
              step="0.01"
              className={inputCls}
              placeholder="0.00"
              value={disposeForm.disposal_value}
              onChange={(e) =>
                setDisposeForm((f) => ({
                  ...f,
                  disposal_value: e.target.value,
                }))
              }
            />
          </div>

          <div>
            <label className="nf-label" htmlFor="dispose-notes">
              {t('anpNotes')}
            </label>
            <textarea
              id="dispose-notes"
              className={inputCls}
              rows={2}
              value={disposeForm.notes}
              onChange={(e) =>
                setDisposeForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </div>
        </div>
      </Dialog>

      <Dialog
        open={oopOpen}
        onClose={() => setOopOpen(false)}
        title={t('anpOutOfProduction')}
        description={t('anpOutOfProductionDesc')}
        maxWidth="sm"
        footer={
          <Button
            onClick={handleOutOfProduction}
            disabled={oopSaving || !oopDate}
          >
            {oopSaving ? t('anpSaving') : t('anpOutOfProduction')}
          </Button>
        }
      >
        <Toast
          variant="danger"
          message={oopError}
          onClose={() => setOopError('')}
        />
        <label className="nf-label" htmlFor="oop-date">
          {t('anpOutOfProductionDate')}
        </label>
        <input
          id="oop-date"
          type="date"
          className={inputCls}
          value={oopDate}
          onChange={(e) => setOopDate(e.target.value)}
        />
      </Dialog>

      {/* ── RFID / Barcode Fast Scanner Modal ── */}
      <RfidScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onAnimalUpdated={load}
        medItems={medItems}
        onOpenAnimalDetails={(animalId) => setDetailsAnimalId(animalId)}
      />

      {/* ── Animal Stage & Pen Transition Modal ── */}
      <AnimalStageTransitionModal
        open={transitionOpen}
        onClose={() => setTransitionOpen(false)}
        animal={transitionAnimal}
        onSuccess={() => {
          load();
          setViewing(null);
          setDetailsAnimalId(null);
        }}
        stages={stages}
        locations={locations}
        batches={batches}
        reasons={reasons as any}
      />
    </div>
  );
}
