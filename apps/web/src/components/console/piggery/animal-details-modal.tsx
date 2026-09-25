'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Calendar,
  Tag,
  Dna,
  HeartPulse,
  Scale,
  Layers,
  ArrowRightLeft,
  DollarSign,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api-client';

type Row = Record<string, any>;

interface AnimalDetailsModalProps {
  animalId: string | null;
  onClose: () => void;
  onOpenStageTransition?: (animal: Row) => void;
}

type TabKey =
  | 'overview'
  | 'lineage'
  | 'health'
  | 'weight'
  | 'breeding'
  | 'movement'
  | 'costing';

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'overview', label: 'Overview / Profile', icon: Tag },
  { key: 'lineage', label: 'Lineage / Pedigree', icon: Dna },
  { key: 'health', label: 'Health & Treatments', icon: HeartPulse },
  { key: 'weight', label: 'Weight History', icon: Scale },
  { key: 'breeding', label: 'Breeding & Lifecycle', icon: Layers },
  { key: 'movement', label: 'Movement / Transfers', icon: ArrowRightLeft },
  { key: 'costing', label: 'Costing & Valuation', icon: DollarSign },
];

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

function fmt(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  try {
    const s = String(d).trim();
    if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

function formatMoney(amount?: number | string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = Number(amount);
  if (isNaN(num)) return '—';
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const asObject = (value: any): Row => {
  if (!value) return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const human = (v: any) =>
  fmt(v).replaceAll('_', ' ').toLowerCase();

type TimelineEvent = {
  id: string;
  date: string;
  title: string;
  summary: string;
  badge?: string;
  detail: [string, string][];
};

export default function AnimalDetailsModal({
  animalId,
  onClose,
  onOpenStageTransition,
}: AnimalDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Animal Register record
  const [animal, setAnimal] = useState<Row | null>(null);
  const [loadingAnimal, setLoadingAnimal] = useState(false);

  // Breeding record & lineage & movements & sow summary
  const [breeding, setBreeding] = useState<Row | null>(null);
  const [loadingBreeding, setLoadingBreeding] = useState(false);

  // Health / Medication logs
  const [medications, setMedications] = useState<Row[]>([]);
  const [loadingMedications, setLoadingMedications] = useState(false);

  // IAS 41 Bio-Asset Ledger
  const [ledgerEntries, setLedgerEntries] = useState<Row[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [openEventId, setOpenEventId] = useState<string | null>(null);

  // Load all animal datasets when animalId changes
  useEffect(() => {
    if (!animalId) {
      setAnimal(null);
      setBreeding(null);
      setMedications([]);
      setLedgerEntries([]);
      setActiveTab('overview');
      return;
    }

    let isCancelled = false;

    // 1. Core Animal Record
    setLoadingAnimal(true);
    api.get(`/animal/${animalId}`)
      .then((res) => {
        if (!isCancelled) setAnimal(unwrap<Row>(res));
      })
      .catch(() => {
        if (!isCancelled) setAnimal(null);
      })
      .finally(() => {
        if (!isCancelled) setLoadingAnimal(false);
      });

    // 2. Breeding & Traceability & Offspring
    setLoadingBreeding(true);
    api.get(`/animal/${animalId}/breeding`)
      .then((res) => {
        if (!isCancelled) setBreeding(unwrap<Row>(res));
      })
      .catch(() => {
        if (!isCancelled) setBreeding(null);
      })
      .finally(() => {
        if (!isCancelled) setLoadingBreeding(false);
      });

    // 3. Medications & Treatments
    setLoadingMedications(true);
    api.get(`/animal/${animalId}/medications`)
      .then((res) => {
        if (!isCancelled) setMedications(unwrap<Row[]>(res) || []);
      })
      .catch(() => {
        if (!isCancelled) setMedications([]);
      })
      .finally(() => {
        if (!isCancelled) setLoadingMedications(false);
      });

    // 4. Bio-Asset Ledger
    setLoadingLedger(true);
    api.get(`/animal/${animalId}/bio-asset-ledger`)
      .then((res) => {
        if (!isCancelled) setLedgerEntries(unwrap<Row[]>(res) || []);
      })
      .catch(() => {
        if (!isCancelled) setLedgerEntries([]);
      })
      .finally(() => {
        if (!isCancelled) setLoadingLedger(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [animalId]);

  const matings: Row[] = breeding?.matings ?? [];
  const farrowings: Row[] = breeding?.farrowings ?? [];
  const movements: Row[] = breeding?.movements ?? [];
  const transfers: Row[] = breeding?.transfers ?? [];
  const labels = breeding?.traceability_labels ?? { stages: {}, batches: {}, locations: {} };
  const lineage: Row = breeding?.lineage ?? { offspring: [] };
  const current: Row = breeding?.current_labels ?? {};

  const isMale =
    animal?.gender === 'M' || animal?.animal_type === 'BOAR';

  // Age calculations
  const ageDays = useMemo(() => {
    if (!animal?.dob) return null;
    const diff = Date.now() - new Date(animal.dob).getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }, [animal?.dob]);

  const ageWeeks = useMemo(() => {
    if (ageDays !== null) return Math.floor(ageDays / 7);
    if (animal?.age_at_entry_weeks != null) return Number(animal.age_at_entry_weeks);
    return null;
  }, [ageDays, animal?.age_at_entry_weeks]);

  // Check if animal is currently under medication withdrawal
  const activeWithdrawal = useMemo(() => {
    const now = Date.now();
    for (const m of medications) {
      if (m.administered_date && m.withdrawal_days && Number(m.withdrawal_days) > 0) {
        const adminTime = new Date(m.administered_date).getTime();
        const expiryTime = adminTime + Number(m.withdrawal_days) * 86400000;
        if (expiryTime > now) {
          const daysRemaining = Math.ceil((expiryTime - now) / 86400000);
          return {
            isUnderWithdrawal: true,
            daysRemaining,
            expiryDate: new Date(expiryTime).toISOString().slice(0, 10),
            medicationName: m.item_name || m.item_code || 'Medication',
          };
        }
      }
    }
    return null;
  }, [medications]);

  // Sow Lifetime Reproductive KPIs
  const sowStats = useMemo(() => {
    if (isMale) return null;

    if (breeding?.sow_summary) {
      const s = breeding.sow_summary;
      return {
        totalBornLive: s.total_born_live ?? (animal?.total_piglets_born_live ? Number(animal.total_piglets_born_live) : 0),
        totalWeaned: s.total_weaned ?? (animal?.total_piglets_weaned ? Number(animal.total_piglets_weaned) : 0),
        totalBornDead: s.born_dead_count ?? 0,
        totalMummified: s.mummified_count ?? 0,
        mortalityPct:
          s.mortality_pct !== null && s.mortality_pct !== undefined
            ? `${s.mortality_pct}%`
            : '0.0%',
        totalLitterMassWeanedKg:
          s.total_litter_mass_weaned_kg !== null && s.total_litter_mass_weaned_kg !== undefined
            ? `${s.total_litter_mass_weaned_kg} kg`
            : '—',
      };
    }

    const bornLive = farrowings.reduce(
      (sum, f) => sum + (Number(f.piglets_born_live) || 0),
      0
    ) || Number(animal?.total_piglets_born_live) || 0;

    const weaned = farrowings.reduce(
      (sum, f) => sum + (Number(f.piglets_weaned) || 0),
      0
    ) || Number(animal?.total_piglets_weaned) || 0;

    const stillborn = farrowings.reduce(
      (sum, f) => sum + (Number(f.piglets_stillborn) || 0),
      0
    );
    const mummified = farrowings.reduce(
      (sum, f) => sum + (Number(f.piglets_mummified) || 0),
      0
    );

    let mortPct = '0.0%';
    if (bornLive > 0) {
      const deaths = Math.max(0, bornLive - weaned);
      mortPct = `${((deaths / bornLive) * 100).toFixed(1)}%`;
    }

    let massWeaned = 0;
    let hasMass = false;
    for (const f of farrowings) {
      const w = Number(f.piglets_weaned) || 0;
      const avg = Number(f.avg_weaning_weight_kg) || 0;
      if (w > 0 && avg > 0) {
        massWeaned += w * avg;
        hasMass = true;
      }
    }

    return {
      totalBornLive: bornLive,
      totalWeaned: weaned,
      totalBornDead: stillborn,
      totalMummified: mummified,
      mortalityPct: mortPct,
      totalLitterMassWeanedKg: hasMass ? `${massWeaned.toFixed(1)} kg` : '—',
    };
  }, [isMale, breeding?.sow_summary, farrowings, animal]);

  // Chronological timeline for Movement / Traceability tab
  const timelineEvents = useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];
    if (!animal) return list;

    // 1. Birth
    if (animal.dob) {
      list.push({
        id: 'event-dob',
        date: formatDate(animal.dob),
        title: 'Birth Recorded',
        badge: 'Birth',
        summary: `Born on farm · Dam: ${fmt(lineage.dam_code)} · Sire: ${fmt(lineage.sire_code)}`,
        detail: [
          ['Date of birth', formatDate(animal.dob)],
          ['Dam (Mother)', fmt(lineage.dam_code)],
          ['Sire (Father)', fmt(lineage.sire_code)],
        ],
      });
    }

    // 2. Entry / Registration
    if (animal.entry_date) {
      const initialBatch = current.batch || labels.batches?.[animal.current_batch_id] || animal.current_batch_id;
      const initialPen = current.location || labels.locations?.[animal.current_location_id] || animal.current_location_id;
      list.push({
        id: 'event-entry',
        date: formatDate(animal.entry_date),
        title: 'Herd Registration',
        badge: 'Registration',
        summary: `${human(animal.entry_type)} · Assigned to Batch ${fmt(initialBatch)} · Pen ${fmt(initialPen)}`,
        detail: [
          ['Entry Date', formatDate(animal.entry_date)],
          ['Entry Type', fmt(animal.entry_type)],
          ['Batch', fmt(initialBatch)],
          ['Pen', fmt(initialPen)],
          ['Stage', fmt(current.stage || labels.stages?.[animal.current_stage_id])],
          ['Acquisition Cost', formatMoney(animal.acquisition_cost)],
        ],
      });
    }

    // 3. Stage Transitions
    for (const mov of movements) {
      if (mov.action === 'TRANSITION_STAGE') {
        const oldVal = asObject(mov.old_values);
        const newVal = asObject(mov.new_values);
        const fromStage = labels.stages?.[oldVal.current_stage_id] || 'Previous Stage';
        const toStage = labels.stages?.[newVal.current_stage_id] || 'New Stage';
        list.push({
          id: `mov-${mov.movement_id || mov.occurred_at}-${toStage}`,
          date: formatDate(newVal.transition_date || mov.occurred_at),
          title: `Stage Transition: ${toStage}`,
          badge: 'Stage Transition',
          summary: `${fromStage} → ${toStage} · Pen: ${labels.locations?.[newVal.current_location_id] || '—'}`,
          detail: [
            ['From Stage', fromStage],
            ['To Stage', toStage],
            ['Batch', labels.batches?.[newVal.current_batch_id] || '—'],
            ['Pen / Location', labels.locations?.[newVal.current_location_id] || '—'],
            ['Reason', fmt(newVal.reason)],
            ['Remarks', fmt(newVal.remarks)],
          ],
        });
      }
    }

    // 4. Batch / Pen Transfers
    for (const tr of transfers) {
      list.push({
        id: `trans-${tr.transfer_id}`,
        date: formatDate(tr.transfer_date),
        title: `Batch/Pen Transfer (${fmt(tr.transfer_no)})`,
        badge: 'Transfer',
        summary: `Batch: ${fmt(tr.from_batch_no)} → ${fmt(tr.to_batch_no)} | Pen: ${fmt(tr.from_pen_code)} → ${fmt(tr.to_pen_code)}`,
        detail: [
          ['Transfer No.', fmt(tr.transfer_no)],
          ['Transfer Date', formatDate(tr.transfer_date)],
          ['From Batch', fmt(tr.from_batch_no)],
          ['To Batch', fmt(tr.to_batch_no)],
          ['From Pen', fmt(tr.from_pen_code)],
          ['To Pen', fmt(tr.to_pen_code)],
          ['Reason', fmt(tr.reason)],
          ['Remarks', fmt(tr.remarks)],
        ],
      });
    }

    // 5. Disposal (if applicable)
    if (animal.disposal_date) {
      list.push({
        id: 'event-disposal',
        date: formatDate(animal.disposal_date),
        title: `Herd Exit: ${human(animal.disposal_type)}`,
        badge: 'Disposal',
        summary: `Exited herd · Disposal Value: ${formatMoney(animal.disposal_value)} · Gain/Loss: ${formatMoney(animal.gain_loss_on_disposal)}`,
        detail: [
          ['Disposal Date', formatDate(animal.disposal_date)],
          ['Disposal Type', fmt(animal.disposal_type)],
          ['Disposal Value', formatMoney(animal.disposal_value)],
          ['Gain / Loss', formatMoney(animal.gain_loss_on_disposal)],
        ],
      });
    }

    return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [animal, movements, transfers, labels, lineage, current]);

  if (!animalId) return null;

  return (
    <Dialog
      open={!!animalId}
      onClose={onClose}
      title=""
      presentation="page"
      className="max-h-[92vh] overflow-hidden"
    >
      {/* ── Top Custom Header ── */}
      <div className="-mx-5 -mt-5 mb-4 border-b border-[var(--border)] bg-[var(--surface-raised)] p-5 sm:-mx-6 sm:-mt-6 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-xl font-bold tracking-tight text-[var(--accent)]">
                {animal?.ear_tag || animal?.animal_code || 'Loading…'}
              </span>
              {animal?.animal_code && animal.animal_code !== animal.ear_tag && (
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  ({animal.animal_code})
                </span>
              )}
              {/* Status Badge */}
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                  animal?.status === 'ACTIVE'
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : animal?.status === 'ISOLATED' || animal?.status === 'QUARANTINE' || animal?.status === 'SICK'
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : animal?.status === 'DEAD' || animal?.status === 'CULLED'
                    ? 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
                }`}
              >
                {animal?.status === 'ACTIVE' && <CheckCircle2 className="h-3 w-3" />}
                {animal?.status || 'Active'}
              </span>

              {/* Sex & Type Pill */}
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                {isMale ? 'Male (Boar)' : 'Female (Sow)'}
              </span>
            </div>

            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span>Breed: <strong className="text-[var(--text-primary)]">{current.breed || animal?.breed_name || '—'}</strong></span>
              <span>·</span>
              <span>Stage: <strong className="text-[var(--accent)]">{current.stage || animal?.current_stage_code || '—'}</strong></span>
              <span>·</span>
              <span>Batch: <strong className="text-[var(--text-primary)]">{current.batch || animal?.current_batch_no || '—'}</strong></span>
              <span>·</span>
              <span>Pen: <strong className="text-[var(--text-primary)]">{current.location || '—'}</strong></span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {onOpenStageTransition && animal && animal.is_active && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenStageTransition(animal);
                }}
                className="gap-1.5 text-xs font-semibold"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Change Stage / Pen
              </Button>
            )}
          </div>
        </div>

        {/* Withdrawal warning banner if applicable */}
        {activeWithdrawal && (
          <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-sm)] border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Active Withdrawal Alert:</strong> Administered with{' '}
              <strong>{activeWithdrawal.medicationName}</strong>. Withdrawal period active for{' '}
              <strong>{activeWithdrawal.daysRemaining} more day(s)</strong> (until {activeWithdrawal.expiryDate}).
              Slaughter or sale is restricted.
            </span>
          </div>
        )}

        {/* ── Tabs Navigation Bar ── */}
        <nav
          className="no-scrollbar -mb-5 mt-4 flex gap-1 overflow-x-auto border-t border-[var(--border)] pt-2 text-xs font-semibold sm:-mb-6"
          aria-label="Animal Detail Tabs"
        >
          {TABS.map((tb) => {
            const Icon = tb.icon;
            const active = activeTab === tb.key;
            return (
              <button
                key={tb.key}
                type="button"
                onClick={() => setActiveTab(tb.key)}
                className={`flex shrink-0 items-center gap-1.5 px-3 py-2.5 border-b-2 transition-all ${
                  active
                    ? 'border-[var(--accent)] text-[var(--accent)] font-bold'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tb.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Tab Content Body ── */}
      <div className="py-2">
        {loadingAnimal && !animal ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--text-muted)]" />
            <p className="mt-2 text-xs text-[var(--text-muted)]">Loading animal profile details…</p>
          </div>
        ) : (
          <>
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* TAB 1: OVERVIEW / GENERAL PROFILE */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'overview' && (
              <div className="space-y-6 animate-fade-in text-xs">
                {/* Highlight KPI row */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Age</span>
                    <span className="text-base font-bold font-mono text-[var(--text-primary)] mt-0.5 block">
                      {ageDays != null ? `${ageDays} Days` : '—'}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      {ageWeeks != null ? `~${ageWeeks} weeks` : ''}
                    </span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Current Weight</span>
                    <span className="text-base font-bold font-mono text-[var(--text-primary)] mt-0.5 block">
                      {animal?.current_weight_kg ? `${Number(animal.current_weight_kg).toFixed(1)} kg` : '—'}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">Live weight</span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Book Value (NBV)</span>
                    <span className="text-base font-bold font-mono text-[var(--text-primary)] mt-0.5 block">
                      {formatMoney(animal?.book_value || animal?.acquisition_cost)}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">IAS 41 Bio-Asset</span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Entry Type</span>
                    <span className="text-sm font-bold text-[var(--text-primary)] mt-0.5 block truncate">
                      {human(animal?.entry_type) || '—'}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      {formatDate(animal?.entry_date)}
                    </span>
                  </div>
                </div>

                {/* Section: Core Identification */}
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                  <h4 className="mb-3 font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] flex items-center gap-1.5 border-b border-[var(--border)] pb-2">
                    <Tag className="h-3.5 w-3.5 text-[var(--accent)]" /> Identification & Asset Data
                  </h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Animal Code</span>
                      <span className="font-mono font-bold text-[var(--text-primary)]">{fmt(animal?.animal_code)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Ear Tag</span>
                      <span className="font-mono font-bold text-[var(--accent)]">{fmt(animal?.ear_tag)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">RFID Tag</span>
                      <span className="font-mono text-[var(--text-primary)]">{fmt(animal?.rfid_tag)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Serial / Asset Tag</span>
                      <span className="font-mono text-[var(--text-primary)]">{fmt(animal?.serial_number)}</span>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Type</span>
                      <span className="font-medium text-[var(--text-primary)]">{fmt(animal?.animal_type)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Gender</span>
                      <span className="font-medium text-[var(--text-primary)]">{animal?.gender === 'M' ? 'Male' : 'Female'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Breed</span>
                      <span className="font-medium text-[var(--text-primary)]">{fmt(current.breed || animal?.breed_name)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Date of Birth</span>
                      <span className="font-mono text-[var(--text-primary)]">{formatDate(animal?.dob)}</span>
                    </div>
                  </div>
                </div>

                {/* Section: Placement & Location */}
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                  <h4 className="mb-3 font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] flex items-center gap-1.5 border-b border-[var(--border)] pb-2">
                    <Layers className="h-3.5 w-3.5 text-[var(--accent)]" /> Current Placement & Herd Assignment
                  </h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Current Batch</span>
                      <span className="font-medium text-[var(--text-primary)]">{fmt(current.batch || animal?.current_batch_no)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Current Stage</span>
                      <span className="font-bold text-[var(--accent)] font-mono">{fmt(current.stage || animal?.current_stage_code)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Current Pen</span>
                      <span className="font-medium text-[var(--text-primary)]">{fmt(current.location)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Age at Entry</span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {animal?.age_at_entry_weeks != null ? `${animal.age_at_entry_weeks} weeks` : '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Entry Type</span>
                      <span className="font-medium text-[var(--text-primary)]">{fmt(animal?.entry_type)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Entry Date</span>
                      <span className="font-mono text-[var(--text-primary)]">{formatDate(animal?.entry_date)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Source Batch / Receipt</span>
                      <span className="font-mono text-[var(--text-primary)]">
                        {fmt(animal?.source_batch_id || animal?.source_receipt_id)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Disposal Date</span>
                      <span className="font-mono text-[var(--text-primary)]">{formatDate(animal?.disposal_date)}</span>
                    </div>
                  </div>
                </div>

                {/* Section: Physical & Phenotype Traits */}
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                  <h4 className="mb-3 font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] flex items-center gap-1.5 border-b border-[var(--border)] pb-2">
                    <Scale className="h-3.5 w-3.5 text-[var(--accent)]" /> Physical Traits & Scoring
                  </h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                    {!isMale && (
                      <div>
                        <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">No. of Teats</span>
                        <span className="font-bold text-[var(--text-primary)]">{fmt(animal?.no_of_teats)}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Total Sow Index (TSI)</span>
                      <span className="font-bold text-[var(--text-primary)]">{fmt(animal?.tsi)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Grading</span>
                      <span className="font-bold text-[var(--text-primary)]">{fmt(animal?.grading)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Ear Tag Photo</span>
                      {animal?.ear_tag_image_url ? (
                        <a
                          href={animal.ear_tag_image_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--accent)] underline font-medium"
                        >
                          View Image <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-[var(--text-muted)]">No image uploaded</span>
                      )}
                    </div>
                  </div>

                  {animal?.notes && (
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Notes & Remarks</span>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">{animal.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* TAB 2: LINEAGE / PEDIGREE */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'lineage' && (
              <div className="space-y-5 animate-fade-in text-xs">
                {/* Parentage Cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Sire Card */}
                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-wider block">
                      Sire (Father)
                    </span>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-base font-bold text-[var(--accent)]">
                        {fmt(lineage.sire_code || animal?.sire_animal_id)}
                      </span>
                      <span className="rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                        Male Boar
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                      Primary paternal genetic contributor.
                    </p>
                  </div>

                  {/* Dam Card */}
                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-wider block">
                      Dam (Mother)
                    </span>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-base font-bold text-[var(--accent)]">
                        {fmt(lineage.dam_code || animal?.dam_animal_id)}
                      </span>
                      <span className="rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                        Female Sow
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                      Maternal dam line and farrowing source.
                    </p>
                  </div>
                </div>

                {/* Progeny / Offspring List */}
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                  <div className="mb-3 flex items-center justify-between border-b border-[var(--border)] pb-2">
                    <h4 className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Dna className="h-3.5 w-3.5 text-[var(--accent)]" /> Progeny & Registered Offspring
                    </h4>
                    <span className="rounded-full bg-[var(--accent-muted)] px-2 py-0.5 text-[10px] font-bold font-mono text-[var(--accent)]">
                      {(lineage.offspring || []).length} Offspring
                    </span>
                  </div>

                  {(lineage.offspring || []).length === 0 ? (
                    <div className="py-8 text-center text-[var(--text-muted)]">
                      <p>No registered offspring for this animal.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-[10px] uppercase font-bold text-[var(--text-muted)] bg-[var(--surface-raised)]">
                            <th className="px-3 py-2">Animal Code</th>
                            <th className="px-3 py-2">Gender</th>
                            <th className="px-3 py-2">Date of Birth</th>
                            <th className="px-3 py-2">Entry Date</th>
                            <th className="px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {(lineage.offspring as Row[]).map((off, idx) => (
                            <tr key={off.animal_id || idx} className="hover:bg-[var(--surface-raised)]/60">
                              <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">
                                {off.animal_code}
                              </td>
                              <td className="px-3 py-2 text-[var(--text-primary)]">
                                {off.gender === 'M' ? 'Male' : off.gender === 'F' ? 'Female' : '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">
                                {formatDate(off.dob)}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">
                                {formatDate(off.entry_date)}
                              </td>
                              <td className="px-3 py-2">
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                  {off.status || 'Active'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* TAB 3: HEALTH & TREATMENTS / VACCINATIONS */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'health' && (
              <div className="space-y-4 animate-fade-in text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HeartPulse className="h-4 w-4 text-[var(--accent)]" />
                    <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px]">
                      Medical Treatment & Vaccination History
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                    {medications.length} Record{medications.length === 1 ? '' : 's'}
                  </span>
                </div>

                {loadingMedications ? (
                  <div className="py-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-muted)]" />
                    <p className="mt-2 text-xs text-[var(--text-muted)]">Loading medication history…</p>
                  </div>
                ) : medications.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)]">
                    <p>No medications, vaccinations, or clinical treatments recorded for this animal.</p>
                  </div>
                ) : (
                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-2xs">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-[10px] uppercase font-bold text-[var(--text-muted)] bg-[var(--surface-raised)]">
                            <th className="px-3 py-2.5">Date</th>
                            <th className="px-3 py-2.5">Medicine / Vaccine</th>
                            <th className="px-3 py-2.5">Dosage</th>
                            <th className="px-3 py-2.5">Withdrawal</th>
                            <th className="px-3 py-2.5">Administered By</th>
                            <th className="px-3 py-2.5">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {medications.map((m, idx) => (
                            <tr key={m.log_id || idx} className="hover:bg-[var(--surface-raised)]/60">
                              <td className="px-3 py-2.5 font-mono text-[var(--text-primary)] whitespace-nowrap">
                                {formatDate(m.administered_date)}
                              </td>
                              <td className="px-3 py-2.5 font-semibold text-[var(--text-primary)]">
                                {m.item_name || m.item_code || 'Standard Dose'}
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[var(--text-secondary)] whitespace-nowrap">
                                {m.dose_qty ? `${m.dose_qty} ${m.uom || 'dose'}` : '—'}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                {m.withdrawal_days ? (
                                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                    {m.withdrawal_days} days
                                  </span>
                                ) : (
                                  <span className="text-[var(--text-muted)]">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                                {m.administered_by || 'Staff'}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text-muted)] max-w-xs truncate">
                                {m.notes || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* TAB 4: WEIGHT HISTORY */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'weight' && (
              <div className="space-y-4 animate-fade-in text-xs">
                {/* Weight Overview Cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] block">Current Live Weight</span>
                    <span className="font-mono text-2xl font-bold text-[var(--accent)] block mt-1">
                      {animal?.current_weight_kg ? `${Number(animal.current_weight_kg).toFixed(1)} kg` : '—'}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                      Recorded on current stage
                    </span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] block">Estimated Daily Gain</span>
                    <span className="font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400 block mt-1">
                      {ageDays && animal?.current_weight_kg && Number(animal.current_weight_kg) > 0
                        ? `${((Number(animal.current_weight_kg) / ageDays) * 1000).toFixed(0)} g/d`
                        : '—'}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                      Lifetime ADG average
                    </span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] block">Target Weight by Stage</span>
                    <span className="font-mono text-2xl font-bold text-[var(--text-primary)] block mt-1">
                      {animal?.animal_type === 'BOAR' ? '220–280 kg' : animal?.animal_type === 'SOW' ? '180–240 kg' : '95–115 kg'}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                      Breed standard for {current.breed || 'Commercial Pig'}
                    </span>
                  </div>
                </div>

                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                  <h4 className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] mb-2 flex items-center gap-1.5 border-b border-[var(--border)] pb-2">
                    <Scale className="h-3.5 w-3.5 text-[var(--accent)]" /> Weight Milestones & Checkpoints
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-[10px] uppercase font-bold text-[var(--text-muted)] bg-[var(--surface-raised)]">
                          <th className="px-3 py-2">Milestone / Stage</th>
                          <th className="px-3 py-2">Recorded Weight</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Benchmark</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        <tr>
                          <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">Current Live Weight</td>
                          <td className="px-3 py-2.5 font-mono font-bold text-[var(--accent)]">
                            {animal?.current_weight_kg ? `${Number(animal.current_weight_kg).toFixed(1)} kg` : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                              Active
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-[var(--text-muted)]">Within Expected Curve</td>
                        </tr>
                        {animal?.entry_type === 'BORN_ON_FARM' && (
                          <tr>
                            <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">Birth Weight</td>
                            <td className="px-3 py-2.5 font-mono text-[var(--text-secondary)]">~1.40 kg</td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">Recorded at Farrowing</td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">Standard: 1.3–1.6 kg</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* TAB 5: BREEDING & LIFECYCLE EVENTS */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'breeding' && (
              <div className="space-y-5 animate-fade-in text-xs">
                {loadingBreeding ? (
                  <div className="py-12 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-muted)]" />
                    <p className="mt-2 text-xs text-[var(--text-muted)]">Loading breeding and reproduction data…</p>
                  </div>
                ) : (
                  <>
                    {/* Female Sow Reproductive KPIs */}
                    {!isMale && (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Parity</span>
                          <span className="font-mono text-base font-bold text-[var(--text-primary)] mt-0.5 block">
                            {fmt(animal?.parity_count || farrowings.length)}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Born Live</span>
                          <span className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                            {sowStats?.totalBornLive ?? 0}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Stillborn</span>
                          <span className="font-mono text-base font-bold text-amber-600 dark:text-amber-400 mt-0.5 block">
                            {sowStats?.totalBornDead ?? 0}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Mummified</span>
                          <span className="font-mono text-base font-bold text-[var(--text-secondary)] mt-0.5 block">
                            {sowStats?.totalMummified ?? 0}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Weaned</span>
                          <span className="font-mono text-base font-bold text-[var(--accent)] mt-0.5 block">
                            {sowStats?.totalWeaned ?? 0}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Pre-Wean Mort %</span>
                          <span className="font-mono text-base font-bold text-red-500 mt-0.5 block">
                            {sowStats?.mortalityPct ?? '0.0%'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Male Boar Service KPIs */}
                    {isMale && (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Services Performed</span>
                          <span className="font-mono text-xl font-bold text-[var(--accent)] block mt-0.5">
                            {matings.length}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Litters Sired</span>
                          <span className="font-mono text-xl font-bold text-[var(--text-primary)] block mt-0.5">
                            {farrowings.length}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Piglets Sired Live</span>
                          <span className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400 block mt-0.5">
                            {farrowings.reduce((sum, f) => sum + (Number(f.piglets_born_live) || 0), 0)}
                          </span>
                        </div>
                        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-center">
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Piglets Weaned</span>
                          <span className="font-mono text-xl font-bold text-[var(--text-primary)] block mt-0.5">
                            {farrowings.reduce((sum, f) => sum + (Number(f.piglets_weaned) || 0), 0)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Matings & Services Table */}
                    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                      <h4 className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] mb-3 flex items-center gap-1.5 border-b border-[var(--border)] pb-2">
                        <Layers className="h-3.5 w-3.5 text-[var(--accent)]" /> Services & Matings
                      </h4>

                      {matings.length === 0 ? (
                        <p className="py-4 text-center text-[var(--text-muted)]">No mating services recorded.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-[var(--border)] text-[10px] uppercase font-bold text-[var(--text-muted)] bg-[var(--surface-raised)]">
                                <th className="px-3 py-2">Date</th>
                                <th className="px-3 py-2">Type</th>
                                <th className="px-3 py-2">{isMale ? 'Sow' : 'Boar'}</th>
                                <th className="px-3 py-2">Batch</th>
                                <th className="px-3 py-2">Preg Check</th>
                                <th className="px-3 py-2">Result</th>
                                <th className="px-3 py-2">Due Date</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                              {matings.map((m) => (
                                <tr key={m.breeding_id} className="hover:bg-[var(--surface-raised)]/60">
                                  <td className="px-3 py-2 font-mono text-[var(--text-primary)]">
                                    {formatDate(m.mating_date)}
                                  </td>
                                  <td className="px-3 py-2 text-[var(--text-secondary)]">{human(m.mating_type)}</td>
                                  <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">
                                    {isMale ? m.sow_code || '—' : m.boar_code || '—'}
                                  </td>
                                  <td className="px-3 py-2 text-[var(--text-secondary)]">{m.batch_no || '—'}</td>
                                  <td className="px-3 py-2 font-mono text-[var(--text-muted)]">
                                    {formatDate(m.preg_check_date)}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                        m.conception_result === 'PREGNANT'
                                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                          : m.conception_result === 'OPEN'
                                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                          : 'bg-slate-500/10 text-[var(--text-muted)]'
                                      }`}
                                    >
                                      {m.conception_result || 'PENDING'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">
                                    {formatDate(m.expected_farrowing_date)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Farrowing & Litters Table */}
                    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                      <h4 className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] mb-3 flex items-center gap-1.5 border-b border-[var(--border)] pb-2">
                        <Calendar className="h-3.5 w-3.5 text-[var(--accent)]" /> Farrowings & Weanings
                      </h4>

                      {farrowings.length === 0 ? (
                        <p className="py-4 text-center text-[var(--text-muted)]">No farrowing litters recorded.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-[var(--border)] text-[10px] uppercase font-bold text-[var(--text-muted)] bg-[var(--surface-raised)]">
                                <th className="px-3 py-2">Farrow Date</th>
                                <th className="px-3 py-2">Parity</th>
                                <th className="px-3 py-2">Live Born</th>
                                <th className="px-3 py-2">Stillborn</th>
                                <th className="px-3 py-2">Weaned</th>
                                <th className="px-3 py-2">Avg Wean Wt</th>
                                <th className="px-3 py-2">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                              {farrowings.map((f) => (
                                <tr key={f.farrow_id} className="hover:bg-[var(--surface-raised)]/60">
                                  <td className="px-3 py-2 font-mono text-[var(--text-primary)]">
                                    {formatDate(f.farrowing_date)}
                                  </td>
                                  <td className="px-3 py-2 font-mono font-bold text-[var(--text-primary)]">
                                    #{f.parity_number || '1'}
                                  </td>
                                  <td className="px-3 py-2 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                    {f.piglets_born_live || '0'}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-amber-600 dark:text-amber-400">
                                    {f.piglets_stillborn || '0'}
                                  </td>
                                  <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">
                                    {f.piglets_weaned || '0'}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">
                                    {f.avg_weaning_weight_kg ? `${f.avg_weaning_weight_kg} kg` : '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
                                      {f.farrowing_status || 'Completed'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* TAB 6: MOVEMENT & TRANSFER HISTORY */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'movement' && (
              <div className="space-y-4 animate-fade-in text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4 text-[var(--accent)]" />
                    <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px]">
                      Lifetime Movement & Transition Rail
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                    {timelineEvents.length} Event{timelineEvents.length === 1 ? '' : 's'}
                  </span>
                </div>

                {timelineEvents.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)]">
                    <p>No movement or stage transition events recorded yet.</p>
                  </div>
                ) : (
                  <ol className="relative flex flex-col gap-3 ps-6">
                    {/* The timeline rail line */}
                    <span
                      aria-hidden="true"
                      className="absolute bottom-2 start-[9px] top-2 w-px bg-[var(--border)]"
                    />

                    {timelineEvents.map((ev) => {
                      const open = openEventId === ev.id;
                      const rows = ev.detail.filter(([, v]) => v && v !== '—');
                      return (
                        <li key={ev.id} className="relative">
                          {/* Rail marker dot */}
                          <span
                            aria-hidden="true"
                            className="absolute -start-6 top-3 h-2.5 w-2.5 rounded-full border-2 border-[var(--accent)] bg-[var(--surface)]"
                          />

                          <div
                            onClick={() => setOpenEventId(open ? null : ev.id)}
                            className="cursor-pointer rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5 transition-colors hover:bg-[var(--surface-raised)]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-[var(--text-primary)]">
                                  {ev.title}
                                </span>
                                {ev.badge && (
                                  <span className="rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                                    {ev.badge}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-xs text-[var(--text-muted)]">
                                {ev.date}
                              </span>
                            </div>

                            <div className="mt-1 flex items-center justify-between gap-2">
                              <p className="text-xs text-[var(--text-secondary)]">{ev.summary}</p>
                              <ChevronRight
                                className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${
                                  open ? 'rotate-90' : ''
                                }`}
                              />
                            </div>

                            {open && rows.length > 0 && (
                              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
                                {rows.map(([label, val]) => (
                                  <div key={label}>
                                    <dt className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                                      {label}
                                    </dt>
                                    <dd className="font-medium text-xs text-[var(--text-primary)] mt-0.5">
                                      {val}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════ */}
            {/* TAB 7: COSTING / VALUATION */}
            {/* ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'costing' && (
              <div className="space-y-5 animate-fade-in text-xs">
                {/* Financial Summary KPIs */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Acquisition Cost</span>
                    <span className="text-base font-bold font-mono text-[var(--text-primary)] mt-0.5 block">
                      {formatMoney(animal?.acquisition_cost)}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">Base purchase / birth cost</span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Landing Cost</span>
                    <span className="text-base font-bold font-mono text-[var(--text-primary)] mt-0.5 block">
                      {formatMoney(animal?.landing_cost)}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">Import & freight charges</span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Book Value (NBV)</span>
                    <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                      {formatMoney(animal?.book_value || animal?.acquisition_cost)}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">Net carrying value</span>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Monthly Amortisation</span>
                    <span className="text-base font-bold font-mono text-[var(--text-primary)] mt-0.5 block">
                      {formatMoney(animal?.amortisation_monthly)}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">IAS 41 depreciation</span>
                  </div>
                </div>

                {/* IAS 41 Bio-Asset Parameters */}
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                  <h4 className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] mb-3 flex items-center gap-1.5 border-b border-[var(--border)] pb-2">
                    <DollarSign className="h-3.5 w-3.5 text-[var(--accent)]" /> IAS 41 Valuation Parameters
                  </h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Total Opening Value</span>
                      <span className="font-mono font-bold text-[var(--text-primary)]">
                        {formatMoney(animal?.total_opening_asset_value || animal?.acquisition_cost)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Total Amortised</span>
                      <span className="font-mono text-[var(--text-primary)]">{formatMoney(animal?.total_amortised)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Residual Value</span>
                      <span className="font-mono text-[var(--text-primary)]">{formatMoney(animal?.residual_value)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Expected Cull Date</span>
                      <span className="font-mono text-[var(--text-primary)]">{formatDate(animal?.expected_cull_date)}</span>
                    </div>

                    {animal?.disposal_date && (
                      <>
                        <div>
                          <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Disposal Date</span>
                          <span className="font-mono text-[var(--text-primary)]">{formatDate(animal.disposal_date)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Disposal Type</span>
                          <span className="font-medium text-[var(--text-primary)]">{fmt(animal.disposal_type)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Disposal Value</span>
                          <span className="font-mono text-[var(--text-primary)]">{formatMoney(animal.disposal_value)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase text-[var(--text-muted)] block font-semibold">Gain / Loss</span>
                          <span className="font-mono font-bold text-[var(--accent)]">{formatMoney(animal.gain_loss_on_disposal)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Bio-Asset Ledger Table */}
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
                  <div className="mb-3 flex items-center justify-between border-b border-[var(--border)] pb-2">
                    <h4 className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-[var(--accent)]" /> Bio-Asset Ledger Postings
                    </h4>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      {ledgerEntries.length} Posting{ledgerEntries.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {loadingLedger ? (
                    <div className="py-8 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-muted)]" />
                      <p className="mt-2 text-xs text-[var(--text-muted)]">Loading ledger entries…</p>
                    </div>
                  ) : ledgerEntries.length === 0 ? (
                    <p className="py-4 text-center text-[var(--text-muted)]">
                      No standalone bio-asset ledger entries posted yet. Valuation reflects registered acquisition cost.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-[10px] uppercase font-bold text-[var(--text-muted)] bg-[var(--surface-raised)]">
                            <th className="px-3 py-2">Posting Date</th>
                            <th className="px-3 py-2">Entry Type</th>
                            <th className="px-3 py-2">Unit Cost / Rate</th>
                            <th className="px-3 py-2">Quantity</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                            <th className="px-3 py-2">Reference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {ledgerEntries.map((le, idx) => (
                            <tr key={le.ledger_id || idx} className="hover:bg-[var(--surface-raised)]/60">
                              <td className="px-3 py-2 font-mono text-[var(--text-primary)]">
                                {formatDate(le.posting_date)}
                              </td>
                              <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">
                                {le.entry_type}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">
                                {formatMoney(le.unit_cost)}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">
                                {le.quantity ?? 1}
                              </td>
                              <td className="px-3 py-2 font-mono font-bold text-right text-[var(--text-primary)]">
                                {formatMoney(le.computed_cost || le.amount)}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--text-muted)]">
                                {le.posting_reference || le.reference || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
