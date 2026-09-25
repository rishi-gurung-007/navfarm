'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Trash2,
  Search,
  Loader2,
  Inbox,
  Eye,
  Pencil,
  CheckCircle2,
  ClipboardCheck,
  QrCode as QrCodeIcon,
  RefreshCw,
  CalendarClock,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import QRCode from 'react-qr-code';
import { api } from '@/services/api-client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/alert';
import { Pagination } from '@/components/ui/pagination';
import {
  getActiveCompanyId,
  getActiveOperationalAreaId,
  getActiveOperationalArea,
  setActiveOperationalArea,
  getActiveWorkspaceScope,
} from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import {
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import BatchPerformanceCurvesPanel from '@/components/console/production/batch-performance-curves-panel';
import { useCompanyCurrency } from '@/hooks/useCompanyCurrency';
import { formatQuantity } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';

const PAGE_SIZE = 25;

type Row = Record<string, any>;

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

const emptyInputLine = () => ({
  item_id: '',
  source_batch_id: '',
  quantity: '',
  uom: '',
  rate: '',
});
const emptyOutputLine = () => ({
  item_id: '',
  output_type: 'MAIN',
  cost_split_pct: '100',
  quantity: '',
  uom: '',
  warehouse_id: '',
});
const emptyStdConsumptionLine = () => ({
  item_id: '',
  std_qty_per_unit_per_day: '',
  std_rate: '',
});

export default function BatchPanel() {
  const router = useRouter();
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [nobs, setNobs] = useState<Row[]>([]);
  const [lobs, setLobs] = useState<Row[]>([]);
  const [breeds, setBreeds] = useState<Row[]>([]);
  const [sheds, setSheds] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [uoms, setUoms] = useState<Row[]>([]);
  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [stages, setStages] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [nobId, setNobId] = useState('');
  const [header, setHeader] = useState<Row>({
    lob_id: '',
    costing_method: 'STANDARD',
    breed_id: '',
    stage_id: '',
    shed_id: '',
    start_date: '',
    expected_end_date: '',
    opening_quantity: '',
    uom: '',
    remarks: '',
  });
  const [trackingMode, setTrackingMode] = useState<
    'BATCH_WISE' | 'ANIMAL_WISE'
  >('BATCH_WISE');
  const [animalCandidates, setAnimalCandidates] = useState<Row[]>([]);
  const [selectedAnimalIds, setSelectedAnimalIds] = useState<Set<string>>(
    new Set(),
  );
  const [animalSearch, setAnimalSearch] = useState('');
  const [animalGenderFilter, setAnimalGenderFilter] = useState('');
  const [animalStageFilter, setAnimalStageFilter] = useState('');
  // Off by default: the picker's job is finding animals to ADD, so hiding
  // ones already spoken for elsewhere is the useful default. Toggling this
  // on is for the "which animals exist at all" question — e.g. confirming
  // why a CSV row didn't come through selected.
  const [showAllAnimals, setShowAllAnimals] = useState(false);
  const [csvImportResult, setCsvImportResult] = useState<{
    matched: number;
    errors: string[];
  } | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const [inputLines, setInputLines] = useState<Row[]>([emptyInputLine()]);

  const isBiologicalAssetItem = (it: any) =>
    it?.is_biological_asset === true ||
    it?.is_biological_asset === 1 ||
    it?.is_biological_asset === '1' ||
    it?.is_biological_asset === 'true' ||
    it?.item_type === 'LIVESTOCK';

  const availableInputItems = useMemo(() => {
    if (trackingMode === 'BATCH_WISE') {
      const bio = items.filter(isBiologicalAssetItem);
      const selectedItemIds = new Set(inputLines.map((l) => l.item_id).filter(Boolean));
      const bioIds = new Set(bio.map((b) => b.item_id));
      const extra = items.filter((it) => selectedItemIds.has(it.item_id) && !bioIds.has(it.item_id));
      return [...bio, ...extra];
    }
    return items;
  }, [items, trackingMode, inputLines]);
  const [stdForm, setStdForm] = useState<Row>({
    std_output_quantity: '',
    std_output_cost_per_unit: '',
    std_overhead_rate_per_unit: '',
  });
  const [stdConsumptionLines, setStdConsumptionLines] = useState<Row[]>([
    emptyStdConsumptionLine(),
  ]);

  // null = the modal below is creating a new batch; a batch_id = it's
  // editing that (necessarily still-DRAFT) one instead.
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);

  const [viewing, setViewing] = useState<Row | null>(null);
  const [acting, setActing] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'curves'>('overview');

  // A batch split out of another can be merged back once the group is ready —
  // every live animal returns to the parent and this child closes.
  const [mergeTarget, setMergeTarget] = useState<any>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState('');

  const confirmMerge = async () => {
    if (!mergeTarget) return;
    setMergeBusy(true);
    setMergeError('');
    try {
      await api.post(`/batch-transfer/merge/${mergeTarget.batch_id}`, {
        transfer_date: new Date().toISOString().slice(0, 10),
      });
      setMergeTarget(null);
      load();
    } catch (err: any) {
      setMergeError(err?.message || 'Could not merge the group back.');
    } finally {
      setMergeBusy(false);
    }
  };
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [closeDate, setCloseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [closeQty, setCloseQty] = useState('');
  const [outputLines, setOutputLines] = useState<Row[]>([emptyOutputLine()]);

  const [bioActionOpen, setBioActionOpen] = useState<
    null | 'mature' | 'amortize' | 'fair-value' | 'dispose'
  >(null);
  const [bioActing, setBioActing] = useState(false);
  const [bioError, setBioError] = useState('');
  const [bioForm, setBioForm] = useState<Row>({});

  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [qcLine, setQcLine] = useState<Row | null>(null);
  const [qcParameters, setQcParameters] = useState<Row[]>([]);
  const [qcForm, setQcForm] = useState<Row>({});
  const [qcResultValues, setQcResultValues] = useState<Record<string, Row>>({});
  const [qcSaving, setQcSaving] = useState(false);
  const [qcError, setQcError] = useState('');
  const [qcSubmitted, setQcSubmitted] = useState<Row | null>(null);

  const [packModalOpen, setPackModalOpen] = useState(false);
  const [packLine, setPackLine] = useState<Row | null>(null);
  const [packForm, setPackForm] = useState<Row>({});
  const [packQcRecords, setPackQcRecords] = useState<Row[]>([]);
  const [packSaving, setPackSaving] = useState(false);
  const [packError, setPackError] = useState('');
  const [generatedPack, setGeneratedPack] = useState<Row | null>(null);

  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [renewForm, setRenewForm] = useState<Row>({});
  const [renewSaving, setRenewSaving] = useState(false);
  const [renewError, setRenewError] = useState('');

  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageForm, setStageForm] = useState<Row>({});
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState('');
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [stageOptionsLoading, setStageOptionsLoading] = useState(false);
  const [stageTransitionInfo, setStageTransitionInfo] = useState<{
    current_stage_id: string | null;
    current_stage_code: string | null;
    current_stage_name: string | null;
    days_in_stage: number;
    min_days_before_move: number;
    can_move_without_remarks: boolean;
    valid_next_stages?: Array<{
      stage_id: string;
      stage_code: string;
      stage_name: string;
      stage_sequence: number;
      min_days_before_move: number;
      typical_duration_days: number | null;
    }>;
  } | null>(null);

  const companyId = getActiveCompanyId();
  const scope =
    typeof window !== 'undefined'
      ? localStorage.getItem('active_workspace_scope')
      : 'COMPANY';
  // Working inside an Operational Area pins NOB/LOB to that area — the create-batch
  // form auto-fills and hides both fields instead of asking the user to repeat a
  // choice their workspace already made. Only a Company-level workspace (no area
  // selected) still needs the manual NOB → LOB pickers.
  const isOperationalScope = getActiveWorkspaceScope() === 'OPERATIONAL';

  const [activeArea, setActiveArea] = useState<any>(() => {
    if (typeof window === 'undefined') return undefined;
    if (getActiveWorkspaceScope() !== 'OPERATIONAL') return undefined;
    return getActiveOperationalArea() || undefined;
  });

  useEffect(() => {
    if (getActiveWorkspaceScope() !== 'OPERATIONAL') {
      setActiveArea(undefined);
      return;
    }

    const cached = getActiveOperationalArea();
    if (cached?.nob_id && cached?.lob_id) {
      setActiveArea(cached);
      setNobId((prev) => prev || cached.nob_id);
      setHeader((h) => ({ ...h, lob_id: h.lob_id || cached.lob_id }));
    }

    const areaId = getActiveOperationalAreaId();
    api
      .get(`/operational-area${companyId ? `?company_id=${companyId}` : ''}`)
      .then((res: any) => {
        const list = Array.isArray(res) ? res : [];
        const matched = areaId
          ? list.find((a: any) => a.area_id === areaId)
          : list[0];
        if (matched) {
          setActiveArea(matched);
          setActiveOperationalArea(matched);
          if (matched.nob_id) setNobId(matched.nob_id);
          if (matched.lob_id) {
            setHeader((h) => ({ ...h, lob_id: matched.lob_id }));
          }
        }
      })
      .catch(() => {});
  }, [companyId]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '200');
      const res = await api.get(`/batch?${params.toString()}`);
      const list = unwrap<Row[]>(res) || [];

      let finalRows = Array.isArray(list) ? list : [];

      if (scope === 'OPERATIONAL') {
        // Scope to the area the user is actually working in. This used to
        // substring-match the batch number for "PIG"/"SOW"/"COW", which only
        // worked while batch codes happened to be named that way — a batch
        // numbered e.g. GSG-BAT-2026-0001 vanished from its own area's list.
        const areaId = getActiveOperationalAreaId();
        if (areaId) {
          finalRows = finalRows.filter(
            (b) => !b.operational_area_id || b.operational_area_id === areaId,
          );
        }
      }

      setRows(finalRows);
    } catch (err: any) {
      setError(err?.message || t('blErrLoadBatches'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    params.set('limit', '500');
    const qs = params.toString();
    api
      .get(`/setup/wizard/nobs?${qs}`)
      .then((r) => setNobs(unwrap<Row[]>(r) || []))
      .catch(() => {});
    api
      .get(`/uom?${qs}`)
      .then((r) => setUoms(unwrap<Row[]>(r) || []))
      .catch(() => {});
    api
      .get(`/warehouse?${qs}`)
      .then((r) => setWarehouses(unwrap<Row[]>(r) || []))
      .catch(() => {});
    api
      .get(`/batch?${qs}`)
      .then((r) => setBatches(unwrap<Row[]>(r) || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyed on activeNobId (declared below) rather than the create-form's own
  // nobId, so the batch-detail modal's QC-gate check (which needs this
  // batch's own LOB, not whatever's left selected in the create form) can
  // find the right LOB entry too.
  const activeNobIdForLobs = viewing?.nob_id || activeArea?.nob_id || nobId;
  useEffect(() => {
    if (!activeNobIdForLobs) {
      setLobs([]);
      return;
    }
    api
      .get(`/setup/wizard/lobs/${activeNobIdForLobs}`)
      .then((r) => setLobs(unwrap<Row[]>(r) || []))
      .catch(() => setLobs([]));
  }, [activeNobIdForLobs]);

  // Breed/Item/Shed/Resource are all scoped by Nature of Business and Line of
  // Business — re-fetched whenever either selection changes, instead of once
  // on mount, so e.g. a Poultry LOB never shows Livestock breeds. The "active"
  // scope prefers whichever batch is currently open for viewing (so labels in
  // the detail modal resolve correctly for that batch's own LOB) and falls
  // back to the create form's current selection otherwise.
  const activeNobId = viewing?.nob_id || activeArea?.nob_id || nobId;
  const activeLobId = viewing?.lob_id || activeArea?.lob_id || header.lob_id;
  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (activeNobId) params.set('nobId', activeNobId);
    if (activeLobId) params.set('lobId', activeLobId);
    params.set('limit', '500');
    const qs = params.toString();
    api
      .get(`/breed?${qs}`)
      .then((r) => setBreeds(unwrap<Row[]>(r) || []))
      .catch(() => setBreeds([]));
    api
      .get(`/shed?${qs}`)
      .then((r) => setSheds(unwrap<Row[]>(r) || []))
      .catch(() => setSheds([]));
    api
      .get(`/item?${qs}`)
      .then((r) => setItems(unwrap<Row[]>(r) || []))
      .catch(() => setItems([]));
    api
      .get(`/location?${qs}`)
      .then((r) => setLocations(unwrap<Row[]>(r) || []))
      .catch(() => setLocations([]));
    if (activeLobId) {
      api
        .get(`/stage?lobId=${activeLobId}&isActive=true&limit=200`)
        .then((r) => setStages(unwrap<Row[]>(r) || []))
        .catch(() => setStages([]));
    } else {
      setStages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNobId, activeLobId]);

  const openCreate = () => {
    const area = activeArea || getActiveOperationalArea();
    const effectiveNobId = isOperationalScope ? (area?.nob_id || '') : (area?.nob_id || nobId);
    const effectiveLobId = isOperationalScope ? (area?.lob_id || '') : (area?.lob_id || header.lob_id);
    setNobId(effectiveNobId);
    setHeader({
      lob_id: effectiveLobId,
      costing_method: 'STANDARD',
      breed_id: '',
      stage_id: '',
      shed_id: '',
      start_date: new Date().toISOString().slice(0, 10),
      expected_end_date: '',
      opening_quantity: '',
      uom: '',
      remarks: '',
    });
    setTrackingMode('BATCH_WISE');
    setSelectedAnimalIds(new Set());
    setAnimalSearch('');
    setAnimalGenderFilter('');
    setAnimalStageFilter('');
    setShowAllAnimals(false);
    setCsvImportResult(null);
    setInputLines([emptyInputLine()]);
    setStdForm({
      std_output_quantity: '',
      std_output_cost_per_unit: '',
      std_overhead_rate_per_unit: '',
    });
    setStdConsumptionLines([emptyStdConsumptionLine()]);
    setFormError('');
    setEditingBatchId(null);
    setModalOpen(true);
  };

  // Opens the same modal pre-filled from an existing DRAFT batch — see
  // BatchService.update() for what stays editable (everything) vs. refused
  // (breed/headcount once individual animal records already exist for a
  // BATCH_WISE batch).
  const openEdit = async (batch: Row) => {
    setNobId(batch.nob_id || activeArea?.nob_id || '');
    setHeader({
      lob_id: batch.lob_id || '',
      costing_method: batch.costing_method || 'STANDARD',
      breed_id: batch.breed_id || '',
      stage_id: batch.stage_id || '',
      shed_id: batch.shed_id || '',
      start_date: batch.start_date || '',
      expected_end_date: batch.expected_end_date || '',
      opening_quantity: batch.opening_quantity || '',
      uom: batch.uom || '',
      remarks: batch.remarks || '',
    });
    const isAnimalWise = batch.tracking_mode === 'ANIMAL_WISE';
    setTrackingMode(isAnimalWise ? 'ANIMAL_WISE' : 'BATCH_WISE');
    setAnimalSearch('');
    setAnimalGenderFilter('');
    setAnimalStageFilter('');
    setShowAllAnimals(false);
    setCsvImportResult(null);
    setInputLines(
      batch.input_lines?.length
        ? batch.input_lines.map((l: Row) => ({
            item_id: l.item_id || '',
            source_batch_id: l.source_batch_id || '',
            quantity: l.quantity || '',
            uom: l.uom || '',
            rate: l.rate || '',
          }))
        : [emptyInputLine()],
    );
    setStdForm({
      std_output_quantity: batch.standard?.std_output_quantity || '',
      std_output_cost_per_unit: batch.standard?.std_output_cost_per_unit || '',
      std_overhead_rate_per_unit:
        batch.standard?.std_overhead_rate_per_unit || '',
    });
    setStdConsumptionLines(
      batch.standard?.consumption_lines?.length
        ? batch.standard.consumption_lines.map((l: Row) => ({
            item_id: l.item_id || '',
            std_qty_per_unit_per_day: l.std_qty_per_unit_per_day || '',
            std_rate: l.std_rate || '',
          }))
        : [emptyStdConsumptionLine()],
    );
    setSelectedAnimalIds(new Set());
    if (isAnimalWise) {
      try {
        const res = await api.get(
          `/animal?companyId=${batch.company_id}&currentBatchId=${batch.batch_id}&limit=500`,
        );
        const roster = unwrap<Row[]>(res) || [];
        setSelectedAnimalIds(new Set(roster.map((a) => a.animal_id)));
      } catch {
        setSelectedAnimalIds(new Set());
      }
    }
    setFormError('');
    setEditingBatchId(batch.batch_id);
    setModalOpen(true);
  };

  // ANIMAL_WISE picker: every currently-unassigned animal company-wide,
  // filtered client-side (same pattern batch-animal-assignment-panel.tsx
  // uses for its own "add animal" candidate list) rather than a new
  // server-side unassigned-only filter.
  useEffect(() => {
    if (!modalOpen || trackingMode !== 'ANIMAL_WISE' || !companyId) return;
    api
      .get(`/animal?companyId=${companyId}&limit=500`)
      .then((res) => setAnimalCandidates(unwrap<Row[]>(res) || []))
      .catch(() => setAnimalCandidates([]));
  }, [modalOpen, trackingMode, companyId]);

  // Editing a DRAFT ANIMAL_WISE batch: its own already-assigned animals must
  // still show up here (already-checked, and uncheckable to remove them) —
  // "unassigned" alone would hide every animal the batch already has.
  // "Show all" widens this further, to every animal in the LOB regardless of
  // assignment — the assigned ones just render clearly marked and
  // unselectable (isAssignedElsewhere below), not silently hidden.
  const isAssignedElsewhere = (a: Row) =>
    !!a.current_batch_id && a.current_batch_id !== editingBatchId;
  const unassignedAnimalCandidates = animalCandidates.filter(
    (a) =>
      (showAllAnimals || !isAssignedElsewhere(a)) &&
      (!header.lob_id || a.lob_id === header.lob_id) &&
      (!header.breed_id || a.breed_id === header.breed_id),
  );
  // Stage options offered in the filter dropdown are only the stages actually
  // present among this LOB's unassigned candidates — no point listing a stage
  // nobody available is currently sitting in.
  const animalStageFilterOptions = [
    ...new Map(
      unassignedAnimalCandidates
        .filter((a) => a.current_stage_id)
        .map((a) => [
          a.current_stage_id as string,
          stages.find((s) => s.stage_id === a.current_stage_id)?.stage_code ||
            a.current_stage_id,
        ]),
    ).entries(),
  ];

  const filteredAnimalCandidates = unassignedAnimalCandidates.filter((a) => {
    if (animalGenderFilter && a.gender !== animalGenderFilter) return false;
    if (animalStageFilter && a.current_stage_id !== animalStageFilter)
      return false;
    if (animalSearch) {
      const q = animalSearch.toLowerCase();
      const matches =
        (a.animal_code || '').toLowerCase().includes(q) ||
        (a.ear_tag || '').toLowerCase().includes(q) ||
        (a.rfid_tag || '').toLowerCase().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const breedLabel = (breedId: string) => {
    const b = breeds.find((x) => x.breed_id === breedId);
    return b ? b.breed_name || b.breed_code : '—';
  };
  const stageLabel = (stageId: string | null) => {
    if (!stageId) return '—';
    const s = stages.find((x) => x.stage_id === stageId);
    return s ? s.stage_code : '—';
  };
  const locationLabel = (locationId: string | null) => {
    if (!locationId) return '—';
    const l = locations.find((x) => x.location_id === locationId);
    return l ? l.location_name : '—';
  };
  const animalAge = (a: Row) => {
    if (!a.dob)
      return a.age_at_entry_weeks != null
        ? `${a.age_at_entry_weeks} wks (at entry)`
        : '—';
    const days = Math.floor(
      (Date.now() - new Date(a.dob).getTime()) / 86400000,
    );
    return days < 60 ? `${days} days` : `${Math.floor(days / 30)} mo`;
  };

  const toggleAnimalSelected = (animalId: string) => {
    setSelectedAnimalIds((prev) => {
      const next = new Set(prev);
      if (next.has(animalId)) next.delete(animalId);
      else next.add(animalId);
      return next;
    });
  };
  // "Select all" only ever acts on rows the user could click one at a time —
  // an animal shown-but-assigned-elsewhere (showAllAnimals view) is display
  // only, never part of the bulk toggle.
  const selectableFilteredCandidates = filteredAnimalCandidates.filter(
    (a) => !isAssignedElsewhere(a),
  );
  const allFilteredSelected =
    selectableFilteredCandidates.length > 0 &&
    selectableFilteredCandidates.every((a) =>
      selectedAnimalIds.has(a.animal_id),
    );
  const toggleSelectAllFiltered = () => {
    setSelectedAnimalIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        selectableFilteredCandidates.forEach((a) => next.delete(a.animal_id));
      } else {
        selectableFilteredCandidates.forEach((a) => next.add(a.animal_id));
      }
      return next;
    });
  };

  // One field per exported column, quoted whenever it might carry a comma —
  // reused by both the export (encode) and import (decode expects the same
  // header names) so the round trip stays honest.
  const csvEscape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const handleExportAnimalsCsv = () => {
    const rows = filteredAnimalCandidates;
    const header = [
      'animal_code',
      'ear_tag',
      'rfid_tag',
      'gender',
      'animal_type',
      'breed',
      'stage',
      'location',
      'assignment_status',
    ];
    const lines = [header.join(',')];
    for (const a of rows) {
      lines.push(
        [
          a.animal_code || '',
          a.ear_tag || '',
          a.rfid_tag || '',
          a.gender || '',
          a.animal_type || '',
          breedLabel(a.breed_id),
          stageLabel(a.current_stage_id),
          locationLabel(a.current_location_id),
          isAssignedElsewhere(a) ? 'ASSIGNED' : 'AVAILABLE',
        ]
          .map((v) => csvEscape(String(v)))
          .join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `animals_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /** Minimal RFC4180 line-splitter — handles quoted fields containing commas
   *  or escaped quotes, which a plain split(',') would mangle. */
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.some((v) => v.trim() !== '')) rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
    }
    return rows;
  };

  const handleImportAnimalsCsv = async (file: File) => {
    setCsvImportResult(null);
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 1) {
      setCsvImportResult({ matched: 0, errors: ['The file is empty.'] });
      return;
    }
    const headerRow = rows[0].map((h) => h.trim().toLowerCase());
    const codeCol = headerRow.indexOf('animal_code');
    const earTagCol = headerRow.indexOf('ear_tag');
    if (codeCol === -1 && earTagCol === -1) {
      setCsvImportResult({
        matched: 0,
        errors: [
          "The file needs an 'animal_code' (or 'ear_tag') column — export the current list to see the expected format.",
        ],
      });
      return;
    }

    const byCode = new Map(
      animalCandidates
        .filter((a) => a.animal_code)
        .map((a) => [String(a.animal_code).trim().toLowerCase(), a]),
    );
    const byEarTag = new Map(
      animalCandidates
        .filter((a) => a.ear_tag)
        .map((a) => [String(a.ear_tag).trim().toLowerCase(), a]),
    );

    const errors: string[] = [];
    const toSelect = new Set<string>();
    const dataRows = rows.slice(1);
    for (let i = 0; i < dataRows.length; i++) {
      const line = i + 2; // 1-based, plus the header row
      const raw =
        (codeCol !== -1 ? dataRows[i][codeCol] : '') ||
        (earTagCol !== -1 ? dataRows[i][earTagCol] : '');
      const key = raw.trim();
      if (!key) {
        errors.push(`Row ${line}: identifier is empty.`);
        continue;
      }
      const animal =
        byCode.get(key.toLowerCase()) || byEarTag.get(key.toLowerCase());
      if (!animal) {
        errors.push(`Row ${line}: '${key}' does not match any animal.`);
        continue;
      }
      if (header.lob_id && animal.lob_id !== header.lob_id) {
        errors.push(
          `Row ${line}: '${key}' is not in the selected Line of Business.`,
        );
        continue;
      }
      if (header.breed_id && animal.breed_id !== header.breed_id) {
        errors.push(
          `Row ${line}: '${key}' does not match the selected breed.`,
        );
        continue;
      }
      if (isAssignedElsewhere(animal)) {
        errors.push(`Row ${line}: '${key}' is already assigned to a batch.`);
        continue;
      }
      toSelect.add(animal.animal_id);
    }

    if (toSelect.size) {
      setSelectedAnimalIds((prev) => new Set([...prev, ...toSelect]));
    }
    setCsvImportResult({ matched: toSelect.size, errors });
  };

  const setInputLineField = (idx: number, key: string, value: any) => {
    setInputLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const updated = { ...l, [key]: value };
        if (key === 'item_id') {
          const itemObj = items.find((it) => it.item_id === value);
          if (itemObj?.uom_primary && !updated.uom) {
            updated.uom = itemObj.uom_primary;
          }
        }
        return updated;
      }),
    );
  };
  const addInputLine = () =>
    setInputLines((prev) => [...prev, emptyInputLine()]);
  const removeInputLine = (idx: number) =>
    setInputLines((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev,
    );

  const setStdConsumptionLineField = (idx: number, key: string, value: any) => {
    setStdConsumptionLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)),
    );
  };
  const addStdConsumptionLine = () =>
    setStdConsumptionLines((prev) => [...prev, emptyStdConsumptionLine()]);
  const removeStdConsumptionLine = (idx: number) =>
    setStdConsumptionLines((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev,
    );

  // `activateAfter` is what tells "Save as Draft" and "Create" apart — both
  // go through the same create call (every batch is born a DRAFT, per
  // BatchService.create()), "Create" just immediately follows it with the
  // same POST /batch/:id/activate a user would otherwise trigger by hand
  // from the batch's detail view.
  const handleSave = async (activateAfter: boolean) => {
    setSaving(true);
    setFormError('');
    try {
      const effectiveLobId = header.lob_id || activeArea?.lob_id;
      if (!effectiveLobId) throw new Error(t('blErrLobRequired'));
      if (!header.start_date) throw new Error(t('blErrStartDateRequired'));
      if (!header.uom)
        throw new Error(
          trackingMode === 'ANIMAL_WISE'
            ? 'UOM is required.'
            : t('blErrOpeningQtyUomRequired'),
        );

      if (trackingMode === 'ANIMAL_WISE') {
        if (selectedAnimalIds.size === 0)
          throw new Error(
            'Select at least one animal for an Animal Wise batch.',
          );
        const animalWisePayload = {
          tracking_mode: 'ANIMAL_WISE',
          animal_ids: [...selectedAnimalIds],
          company_id: companyId,
          lob_id: effectiveLobId,
          operational_area_id: isOperationalScope
            ? activeArea?.area_id || undefined
            : undefined,
          costing_method: header.costing_method,
          breed_id: header.breed_id || undefined,
          shed_id: header.shed_id || undefined,
          start_date: header.start_date,
          expected_end_date: header.expected_end_date || undefined,
          uom: header.uom,
          remarks: header.remarks || undefined,
        };
        const created = unwrap<Row>(
          editingBatchId
            ? await api.put(`/batch/${editingBatchId}`, animalWisePayload)
            : await api.post('/batch', animalWisePayload),
        );
        if (activateAfter)
          await api.post(`/batch/${created.batch_id}/activate`, {});
        setModalOpen(false);
        if (viewing?.batch_id === created.batch_id) await refreshViewing();
        load();
        return;
      }

      if (!header.opening_quantity)
        throw new Error(t('blErrOpeningQtyUomRequired'));
      const cleanLines = inputLines
        .filter((l) => l.item_id && l.quantity && l.uom)
        .map((l) => ({
          item_id: l.item_id,
          source_batch_id: l.source_batch_id || undefined,
          quantity: Number(l.quantity),
          uom: l.uom,
          rate: l.rate ? Number(l.rate) : undefined,
        }));
      if (cleanLines.length === 0) throw new Error(t('blErrAddInputLine'));

      let standard: Row | undefined;
      if (header.costing_method === 'STANDARD') {
        const cleanStdLines = stdConsumptionLines
          .filter((l) => l.item_id && l.std_qty_per_unit_per_day)
          .map((l) => ({
            item_id: l.item_id,
            std_qty_per_unit_per_day: Number(l.std_qty_per_unit_per_day),
            std_rate: l.std_rate ? Number(l.std_rate) : undefined,
          }));
        const hasAnyStdInput =
          stdForm.std_output_quantity ||
          stdForm.std_output_cost_per_unit ||
          stdForm.std_overhead_rate_per_unit ||
          cleanStdLines.length > 0;
        if (hasAnyStdInput) {
          standard = {
            std_output_quantity: stdForm.std_output_quantity
              ? Number(stdForm.std_output_quantity)
              : undefined,
            std_output_cost_per_unit: stdForm.std_output_cost_per_unit
              ? Number(stdForm.std_output_cost_per_unit)
              : undefined,
            std_overhead_rate_per_unit: stdForm.std_overhead_rate_per_unit
              ? Number(stdForm.std_overhead_rate_per_unit)
              : undefined,
            consumption_lines:
              cleanStdLines.length > 0 ? cleanStdLines : undefined,
          };
        }
      }

      const batchWisePayload = {
        company_id: companyId,
        lob_id: effectiveLobId,
        operational_area_id: isOperationalScope
          ? activeArea?.area_id || undefined
          : undefined,
        costing_method: header.costing_method,
        breed_id: header.breed_id || undefined,
        stage_id: header.stage_id || undefined,
        shed_id: header.shed_id || undefined,
        start_date: header.start_date,
        expected_end_date: header.expected_end_date || undefined,
        opening_quantity: Number(header.opening_quantity),
        uom: header.uom,
        remarks: header.remarks || undefined,
        input_lines: cleanLines,
        standard,
      };
      const created = unwrap<Row>(
        editingBatchId
          ? await api.put(`/batch/${editingBatchId}`, batchWisePayload)
          : await api.post('/batch', batchWisePayload),
      );
      if (activateAfter)
        await api.post(`/batch/${created.batch_id}/activate`, {});
      setModalOpen(false);
      if (viewing?.batch_id === created.batch_id) await refreshViewing();
      load();
    } catch (err: any) {
      setFormError(err?.message || t('blErrSaveBatch'));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (row: Row) => {
    try {
      const res = await api.get(`/batch/${row.batch_id}`);
      setViewing(unwrap<Row>(res));
      setDetailTab('overview');
    } catch (err: any) {
      setError(err?.message || t('blErrLoadBatchDetails'));
    }
  };

  const refreshViewing = async () => {
    if (!viewing) return;
    const res = await api.get(`/batch/${viewing.batch_id}`);
    setViewing(unwrap<Row>(res));
  };


  const openClose = () => {
    setCloseDate(new Date().toISOString().slice(0, 10));
    setCloseQty(viewing ? String(viewing.opening_quantity) : '');
    setOutputLines([emptyOutputLine()]);
    setCloseError('');
    setCloseModalOpen(true);
  };

  const setOutputLineField = (idx: number, key: string, value: any) => {
    setOutputLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)),
    );
  };
  const addOutputLine = () =>
    setOutputLines((prev) => [...prev, emptyOutputLine()]);
  const removeOutputLine = (idx: number) =>
    setOutputLines((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev,
    );
  const splitTotal = outputLines.reduce(
    (sum, l) => sum + (Number(l.cost_split_pct) || 0),
    0,
  );

  const handleClose = async () => {
    if (!viewing) return;
    setActing(true);
    setCloseError('');
    try {
      const cleanLines = outputLines
        .filter((l) => l.item_id && l.quantity && l.uom && l.warehouse_id)
        .map((l) => ({
          item_id: l.item_id,
          output_type: l.output_type,
          cost_split_pct: Number(l.cost_split_pct),
          quantity: Number(l.quantity),
          uom: l.uom,
          warehouse_id: l.warehouse_id,
        }));
      if (cleanLines.length === 0) throw new Error(t('blErrAddOutputLine'));
      await api.post(`/batch/${viewing.batch_id}/close`, {
        actual_end_date: closeDate,
        closing_quantity: closeQty ? Number(closeQty) : undefined,
        output_lines: cleanLines,
      });
      setCloseModalOpen(false);
      await refreshViewing();
      load();
    } catch (err: any) {
      setCloseError(err?.message || t('blErrCloseBatch'));
    } finally {
      setActing(false);
    }
  };

  const openBioAction = (
    type: 'mature' | 'amortize' | 'fair-value' | 'dispose',
  ) => {
    setBioForm({
      posting_date: new Date().toISOString().slice(0, 10),
      residual_value_per_unit: '',
      productive_life_months: '',
      fair_value_per_unit: '',
      disposal_type: 'HARVEST',
      quantity: '1',
      output_item_id: '',
      output_uom: '',
      output_quantity: '',
      warehouse_id: '',
      sale_proceeds: '',
    });
    setBioError('');
    setBioActionOpen(type);
  };

  const handleBioAction = async () => {
    if (!viewing || !bioActionOpen) return;
    setBioActing(true);
    setBioError('');
    try {
      let path = '';
      let payload: Row = {};
      if (bioActionOpen === 'mature') {
        if (!bioForm.residual_value_per_unit)
          throw new Error(t('blErrResidualValueRequired'));
        path = `/batch/${viewing.batch_id}/mature`;
        payload = {
          residual_value_per_unit: Number(bioForm.residual_value_per_unit),
          productive_life_months: bioForm.productive_life_months
            ? Number(bioForm.productive_life_months)
            : undefined,
        };
      } else if (bioActionOpen === 'amortize') {
        path = `/batch/${viewing.batch_id}/amortize`;
        payload = { posting_date: bioForm.posting_date };
      } else if (bioActionOpen === 'fair-value') {
        if (!bioForm.fair_value_per_unit)
          throw new Error(t('blErrFairValueRequired'));
        path = `/batch/${viewing.batch_id}/fair-value`;
        payload = {
          posting_date: bioForm.posting_date,
          fair_value_per_unit: Number(bioForm.fair_value_per_unit),
        };
      } else if (bioActionOpen === 'dispose') {
        if (!bioForm.quantity) throw new Error(t('blErrQuantityRequired'));
        path = `/batch/${viewing.batch_id}/dispose`;
        payload = {
          disposal_type: bioForm.disposal_type,
          quantity: Number(bioForm.quantity),
          posting_date: bioForm.posting_date,
        };
        if (bioForm.disposal_type === 'HARVEST') {
          if (
            !bioForm.output_item_id ||
            !bioForm.output_uom ||
            !bioForm.output_quantity ||
            !bioForm.warehouse_id
          ) {
            throw new Error(t('blErrHarvestFieldsRequired'));
          }
          payload.output_item_id = bioForm.output_item_id;
          payload.output_uom = bioForm.output_uom;
          payload.output_quantity = Number(bioForm.output_quantity);
          payload.warehouse_id = bioForm.warehouse_id;
        } else {
          if (!bioForm.sale_proceeds)
            throw new Error(t('blErrSaleProceedsRequired'));
          payload.sale_proceeds = Number(bioForm.sale_proceeds);
        }
      }
      await api.post(path, payload);
      setBioActionOpen(null);
      await refreshViewing();
      load();
    } catch (err: any) {
      setBioError(err?.message || t('blErrActionFailed'));
    } finally {
      setBioActing(false);
    }
  };

  const itemLabel = (id: string) => {
    const it = items.find((i) => i.item_id === id);
    return it ? `${it.item_code} — ${it.item_name}` : '—';
  };
  const batchLabel = (id: string) => {
    const b = batches.find((x) => x.batch_id === id);
    return b ? b.batch_no : '—';
  };

  // This LOB may require a passing QC record before a pack can be generated
  // (mirrors the server-side gate in qr-code.service.ts) — checked against
  // whichever QC record is currently selected in the Generate Pack form.
  const packQcRequired =
    lobs.find((l) => l.lob_id === viewing?.lob_id)?.qc_required === 'YES';
  const packSelectedQc = packQcRecords.find((q) => q.qc_id === packForm.qc_id);
  const packQcGateBlocked =
    packQcRequired && packSelectedQc?.overall_result !== 'PASS';

  // Batch renewal (copy config forward for a new cycle) is only offered for
  // LOBs configured to allow it — matches the server-side gate in renew().
  const renewAllowed =
    lobs.find((l) => l.lob_id === viewing?.lob_id)?.batch_copy_allowed ===
    'YES';

  const openRecordQc = (line: Row) => {
    if (!viewing) return;
    setQcLine(line);
    setQcForm({
      qc_date: new Date().toISOString().slice(0, 10),
      total_qty_received: String(line.quantity ?? ''),
      pass_qty: '',
      fail_qty: '',
      hold_qty: '',
      grade_a_qty: '',
      grade_b_qty: '',
      grade_c_qty: '',
      disposition: 'ACCEPT',
      qc_notes: '',
    });
    setQcResultValues({});
    setQcError('');
    setQcSubmitted(null);
    setQcModalOpen(true);
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    params.set('lobId', viewing.lob_id);
    params.set('limit', '200');
    api
      .get(`/qc-parameter?${params.toString()}`)
      .then((r) => setQcParameters(unwrap<Row[]>(r) || []))
      .catch(() => setQcParameters([]));
  };

  const setQcResultField = (paramId: string, key: string, value: any) => {
    setQcResultValues((prev) => ({
      ...prev,
      [paramId]: { ...prev[paramId], [key]: value },
    }));
  };

  const handleSaveQc = async () => {
    if (!viewing || !qcLine) return;
    setQcSaving(true);
    setQcError('');
    try {
      if (!qcForm.total_qty_received)
        throw new Error(t('blErrTotalQtyReceivedRequired'));
      const results = qcParameters
        .filter(
          (p) =>
            qcResultValues[p.param_id]?.actual_value !== undefined &&
            qcResultValues[p.param_id]?.actual_value !== '',
        )
        .map((p) => ({
          param_id: p.param_id,
          actual_value: String(qcResultValues[p.param_id].actual_value),
          grade_assigned:
            qcResultValues[p.param_id].grade_assigned || undefined,
          notes: qcResultValues[p.param_id].notes || undefined,
        }));
      if (results.length === 0) throw new Error(t('blErrRecordParamResult'));
      const result = await api.post('/qc', {
        company_id: companyId,
        source_batch_id: viewing.batch_id,
        output_line_id: qcLine.line_id,
        qc_date: qcForm.qc_date,
        total_qty_received: Number(qcForm.total_qty_received),
        pass_qty: qcForm.pass_qty ? Number(qcForm.pass_qty) : undefined,
        fail_qty: qcForm.fail_qty ? Number(qcForm.fail_qty) : undefined,
        hold_qty: qcForm.hold_qty ? Number(qcForm.hold_qty) : undefined,
        grade_a_qty: qcForm.grade_a_qty
          ? Number(qcForm.grade_a_qty)
          : undefined,
        grade_b_qty: qcForm.grade_b_qty
          ? Number(qcForm.grade_b_qty)
          : undefined,
        grade_c_qty: qcForm.grade_c_qty
          ? Number(qcForm.grade_c_qty)
          : undefined,
        disposition: qcForm.disposition,
        qc_notes: qcForm.qc_notes || undefined,
        results,
      });
      setQcSubmitted(unwrap<Row>(result));
    } catch (err: any) {
      setQcError(err?.message || t('blErrRecordQc'));
    } finally {
      setQcSaving(false);
    }
  };

  const openGeneratePack = (line: Row) => {
    if (!viewing) return;
    setPackLine(line);
    setPackForm({
      net_weight: String(line.quantity ?? ''),
      gross_weight: '',
      pack_uom: line.uom || '',
      warehouse_id: line.warehouse_id || '',
      lot_no: '',
      qc_id: '',
    });
    setGeneratedPack(null);
    setPackError('');
    setPackModalOpen(true);
    const params = new URLSearchParams();
    params.set('sourceBatchId', viewing.batch_id);
    params.set('outputLineId', line.line_id);
    params.set('limit', '50');
    api
      .get(`/qc?${params.toString()}`)
      .then((r) => setPackQcRecords(unwrap<Row[]>(r) || []))
      .catch(() => setPackQcRecords([]));
  };

  const handleGeneratePack = async () => {
    if (!viewing || !packLine) return;
    setPackSaving(true);
    setPackError('');
    try {
      if (!packForm.net_weight || !packForm.pack_uom)
        throw new Error(t('blErrNetWeightUomRequired'));
      const result = await api.post('/qr-code', {
        company_id: companyId,
        batch_id: viewing.batch_id,
        output_line_id: packLine.line_id,
        qc_id: packForm.qc_id || undefined,
        item_id: packLine.item_id,
        lot_no: packForm.lot_no || undefined,
        production_date:
          viewing.actual_end_date || new Date().toISOString().slice(0, 10),
        net_weight: Number(packForm.net_weight),
        gross_weight: packForm.gross_weight
          ? Number(packForm.gross_weight)
          : undefined,
        pack_uom: packForm.pack_uom,
        warehouse_id: packForm.warehouse_id || undefined,
      });
      setGeneratedPack(unwrap<Row>(result));
    } catch (err: any) {
      setPackError(err?.message || t('blErrGeneratePack'));
    } finally {
      setPackSaving(false);
    }
  };

  const generateAnotherPack = () => {
    setGeneratedPack(null);
    setPackForm((f: Row) => ({ ...f, lot_no: '' }));
  };

  const openRenew = () => {
    if (!viewing) return;
    setRenewForm({
      start_date: new Date().toISOString().slice(0, 10),
      expected_end_date: '',
      opening_quantity: viewing.opening_quantity ?? '',
      uom: viewing.uom || '',
      remarks: '',
      item_id: viewing.input_lines?.[0]?.item_id || '',
      quantity: viewing.opening_quantity ?? '',
      line_uom: viewing.input_lines?.[0]?.uom || '',
      rate: '',
    });
    setRenewError('');
    setRenewModalOpen(true);
  };

  const handleRenew = async () => {
    if (!viewing) return;
    setRenewSaving(true);
    setRenewError('');
    try {
      if (
        !renewForm.start_date ||
        !renewForm.opening_quantity ||
        !renewForm.uom
      )
        throw new Error(t('blErrRenewHeaderFieldsRequired'));
      if (!renewForm.item_id || !renewForm.quantity || !renewForm.line_uom)
        throw new Error(t('blErrRenewInputLineRequired'));
      const result = await api.post(`/batch/${viewing.batch_id}/renew`, {
        start_date: renewForm.start_date,
        expected_end_date: renewForm.expected_end_date || undefined,
        opening_quantity: Number(renewForm.opening_quantity),
        uom: renewForm.uom,
        remarks: renewForm.remarks || undefined,
        input_lines: [
          {
            item_id: renewForm.item_id,
            quantity: Number(renewForm.quantity),
            uom: renewForm.line_uom,
            rate: renewForm.rate ? Number(renewForm.rate) : undefined,
          },
        ],
      });
      setRenewModalOpen(false);
      await load();
      setViewing(unwrap<Row>(result));
    } catch (err: any) {
      setRenewError(err?.message || t('blErrRenewBatch'));
    } finally {
      setRenewSaving(false);
    }
  };

  const openTransferStage = async () => {
    if (!viewing) return;
    setStageForm({ to_stage_code: '', remarks: '' });
    setStageError('');
    setStageOptions([]);
    setStageTransitionInfo(null);
    setStageModalOpen(true);
    // Stages aren't a fixed enum — they're whatever Stage Master defines for
    // this batch's LOB (the same source transferStage() itself validates
    // against server-side), minus the stage the batch is already in.
    if (!viewing.lob_id) return;
    setStageOptionsLoading(true);
    try {
      const dataEntryRes = await api
        .get(`/batch/${viewing.batch_id}/data-entry`)
        .catch(() => null);
      const dataEntryObj = unwrap<Row>(dataEntryRes);
      const stageTrans = dataEntryObj?.stage_transition || null;
      if (stageTrans) {
        setStageTransitionInfo(stageTrans);
      }

      if (
        stageTrans?.valid_next_stages &&
        stageTrans.valid_next_stages.length > 0
      ) {
        const codes = stageTrans.valid_next_stages.map(
          (s: Row) => s.stage_code,
        );
        setStageOptions(codes);
        if (stageTrans.next_stage?.stage_code) {
          setStageForm({
            to_stage_code: stageTrans.next_stage.stage_code,
            remarks: '',
          });
        } else if (codes.length > 0) {
          setStageForm({ to_stage_code: codes[0], remarks: '' });
        }
      } else {
        const stages =
          unwrap<Row[]>(
            await api.get(
              `/stage?lobId=${viewing.lob_id}&isActive=true&limit=200`,
            ),
          ) || [];
        const codes = Array.from(
          new Set(
            stages
              .map((s: Row) => s.stage_code)
              .filter(
                (c: string | null) => !!c && c !== viewing.current_stage_code,
              ),
          ),
        ) as string[];
        setStageOptions(codes.sort());
      }
    } catch {
      setStageOptions([]);
    } finally {
      setStageOptionsLoading(false);
    }
  };

  const handleTransferStage = async () => {
    if (!viewing) return;
    setStageSaving(true);
    setStageError('');
    try {
      if (!stageForm.to_stage_code)
        throw new Error(t('blErrDestStageRequired'));
      if (
        stageTransitionInfo &&
        !stageTransitionInfo.can_move_without_remarks &&
        !stageForm.remarks?.trim()
      ) {
        throw new Error(
          `Minimum duration of ${stageTransitionInfo.min_days_before_move} days is required for '${stageTransitionInfo.current_stage_name || viewing.current_stage_code}' before transition (currently on day ${stageTransitionInfo.days_in_stage}). Justification / Remarks are mandatory to override.`,
        );
      }
      const result = await api.post(
        `/batch/${viewing.batch_id}/transfer-stage`,
        {
          to_stage_code: stageForm.to_stage_code,
          remarks: stageForm.remarks || undefined,
        },
      );
      setStageModalOpen(false);
      setViewing(unwrap<Row>(result));
    } catch (err: any) {
      setStageError(err?.message || t('blErrTransferStage'));
    } finally {
      setStageSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>
            {t('blPageTitle')}
          </h2>
          <p className="mt-0.5 text-xs" style={S.sub}>
            {t('blPageSubtitle')}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="w-44">
            <SearchableSelect
              ariaLabel="Status Filter"
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              options={[
                { value: 'DRAFT', label: t('blStatusDraft') },
                { value: 'ACTIVE', label: t('blStatusActive') },
                { value: 'CLOSED', label: t('blStatusClosed') },
                { value: 'CANCELLED', label: t('blStatusCancelled') },
              ]}
              placeholder={t('blFilterAllStatuses')}
              onClear={statusFilter ? () => setStatusFilter('') : undefined}
            />
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={S.muted}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('blSearchPlaceholder')}
              className="nf-input-sm pl-8"
              style={S.input}
            />
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> {t('blNewBatch')}
          </Button>
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      <div
        className="overflow-hidden rounded-[var(--radius-md)] border"
        style={S.surface}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap">
                  {t('blColBatchNo')}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  {t('blColStartDate')}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  {t('blColMethod')}
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  {t('blColOpeningQty')}
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  {t('blColUnitCost')}
                </TableHead>
                <TableHead className="text-right">{t('blColStatus')}</TableHead>
                <TableHead className="text-right">
                  {t('blColActions')}
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center"
                    style={S.sub}
                  >
                    <Loader2
                      className="mx-auto mb-2 h-5 w-5 animate-spin"
                      style={S.accent}
                    />{' '}
                    {t('blLoading')}
                  </TableCell>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center"
                    style={S.sub}
                  >
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />{' '}
                    {t('blNoBatches')}
                  </TableCell>
                </tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.batch_id}>
                    <TableCell
                      className="whitespace-nowrap font-semibold"
                      style={S.primary}
                    >
                      {row.batch_no}
                      {row.parent_batch_id && (
                        <span
                          className="ml-1.5 text-[10px] font-medium"
                          style={S.muted}
                        >
                          ↳ split group
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>
                      {row.start_date}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>
                      {row.costing_method}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-right"
                      style={S.primary}
                    >
                      {formatQuantity(row.opening_quantity, row.uom)} {row.uom}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-right"
                      style={S.primary}
                    >
                      {row.unit_cost ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {row.parent_batch_id && row.status === 'ACTIVE' && (
                        <button
                          onClick={() => {
                            setMergeTarget(row);
                            setMergeError('');
                          }}
                          title="Merge this group back into the batch it was split from"
                          className="mr-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition hover:bg-(--surface-raised)"
                          style={S.accent}
                        >
                          Merge back
                        </button>
                      )}
                      <button
                        onClick={() => openView(row)}
                        title={t('blViewTitle')}
                        className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)"
                        style={S.sub}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))
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

      {/* Create/Edit modal */}
      <Dialog
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={
          editingBatchId ? `${t('edit')} — ${t('blNewBatch')}` : t('blNewBatch')
        }
        maxWidth="xl"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              {saving ? t('blSaving') : t('blSaveDraft')}
            </Button>
            <Button
              size="sm"
              onClick={() => handleSave(true)}
              disabled={saving}
              className="nf-btn-primary"
            >
              {saving ? t('blSaving') : t('create')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <InlineAlert>{formError}</InlineAlert>}

          {isOperationalScope && activeArea && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs flex items-center justify-between">
              <div>
                <span className="font-semibold" style={S.primary}>
                  Operational Area:
                </span>
                <span className="ml-1.5 font-medium" style={S.primary}>
                  {activeArea.area_name}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!isOperationalScope && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelNob')} <span className="text-(--danger)">*</span>
                  </label>
                  <SearchableSelect
                    ariaLabel={t('blLabelNob')}
                    ariaRequired
                    value={nobId}
                    onChange={(val) => {
                      setNobId(val);
                      setHeader((h) => ({ ...h, lob_id: '' }));
                    }}
                    options={nobs.map((n) => ({
                      value: n.nob_id,
                      label: `${n.nob_code} — ${n.nob_name}`,
                    }))}
                    placeholder={t('blSelectEllipsis')}
                    searchPlaceholder="Search NOBs…"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelLob')} <span className="text-(--danger)">*</span>
                  </label>
                  <SearchableSelect
                    ariaLabel={t('blLabelLob')}
                    ariaRequired
                    value={header.lob_id}
                    onChange={(val) =>
                      setHeader((h) => ({ ...h, lob_id: val }))
                    }
                    disabled={!nobId}
                    options={lobs.map((l) => ({
                      value: l.lob_id,
                      label: `${l.lob_code} — ${l.lob_name}`,
                    }))}
                    placeholder={nobId ? t('blSelectEllipsis') : t('blSelectNobFirst')}
                    searchPlaceholder="Search LOBs…"
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelBatchType')} <span className="text-(--danger)">*</span>
              </label>
              <SearchableSelect
                ariaLabel={t('blLabelBatchType')}
                ariaRequired
                value={trackingMode}
                onChange={(val) => {
                  const mode = val as 'BATCH_WISE' | 'ANIMAL_WISE';
                  setTrackingMode(mode);
                  if (mode === 'ANIMAL_WISE') {
                    setHeader((h) => ({ ...h, uom: 'HEAD' }));
                  } else {
                    setHeader((h) => ({
                      ...h,
                      uom: h.uom === 'HEAD' ? '' : h.uom,
                    }));
                  }
                }}
                options={[
                  { value: 'BATCH_WISE', label: t('blBatchWise') },
                  { value: 'ANIMAL_WISE', label: t('blAnimalWise') },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelCostingMethod')}{' '}
                <span className="text-(--danger)">*</span>
              </label>
              <SearchableSelect
                ariaLabel={t('blLabelCostingMethod')}
                ariaRequired
                value={header.costing_method}
                onChange={(val) =>
                  setHeader((h) => ({ ...h, costing_method: val }))
                }
                options={[
                  { value: 'STANDARD', label: t('blCostingStandard') },
                  { value: 'FIFO', label: t('blCostingFifo') },
                  { value: 'BIO_ASSET', label: t('blCostingBioAsset') },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelBreed')}
              </label>
              <SearchableSelect
                ariaLabel={t('blLabelBreed')}
                value={header.breed_id}
                onChange={(newBreedId) => {
                  setHeader((h) => ({ ...h, breed_id: newBreedId }));
                  if (trackingMode === 'ANIMAL_WISE' && newBreedId) {
                    setSelectedAnimalIds((prev) => {
                      const next = new Set(
                        [...prev].filter((id) => {
                          const animal = animalCandidates.find(
                            (a) => a.animal_id === id,
                          );
                          return !animal || animal.breed_id === newBreedId;
                        }),
                      );
                      return next;
                    });
                  }
                }}
                options={breeds.map((b) => ({
                  value: b.breed_id,
                  label: `${b.breed_code} — ${b.breed_name}`,
                }))}
                placeholder={t('blSelectEllipsis')}
                searchPlaceholder="Search breeds…"
                onClear={header.breed_id ? () => setHeader((h) => ({ ...h, breed_id: '' })) : undefined}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelShed')}
              </label>
              <SearchableSelect
                ariaLabel={t('blLabelShed')}
                value={header.shed_id}
                onChange={(val) =>
                  setHeader((h) => ({ ...h, shed_id: val }))
                }
                options={sheds.map((s) => ({
                  value: s.shed_id,
                  label: `${s.shed_code} — ${s.shed_name}`,
                }))}
                placeholder={t('blSelectEllipsis')}
                searchPlaceholder="Search sheds…"
                onClear={header.shed_id ? () => setHeader((h) => ({ ...h, shed_id: '' })) : undefined}
              />
            </div>
            {trackingMode === 'BATCH_WISE' && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelInitialStage')}{' '}
                  <span className="text-(--danger)">*</span>
                </label>
                <SearchableSelect
                  ariaLabel={t('blLabelInitialStage')}
                  ariaRequired
                  value={header.stage_id}
                  disabled={!header.lob_id}
                  onChange={(sId) => {
                    const st = stages.find((s) => s.stage_id === sId);
                    setHeader((h) => {
                      let end = h.expected_end_date;
                      if (st?.typical_duration_days && h.start_date) {
                        const d = new Date(h.start_date);
                        d.setDate(
                          d.getDate() + Number(st.typical_duration_days),
                        );
                        end = d.toISOString().slice(0, 10);
                      }
                      return { ...h, stage_id: sId, expected_end_date: end };
                    });
                  }}
                  options={stages.map((s) => ({
                    value: s.stage_id,
                    label: `${s.stage_code} — ${s.stage_name} (${s.typical_duration_days ? `${s.typical_duration_days} days` : 'Open duration'})`,
                  }))}
                  placeholder={header.lob_id ? t('blSelectEllipsis') : t('blSelectNobFirst')}
                  searchPlaceholder="Search stages…"
                />
              </div>
            )}
            {header.stage_id && trackingMode === 'BATCH_WISE' && (
              <div className="sm:col-span-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs flex items-start gap-2.5">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-primary">
                    Stage 1 Scheduler Auto-Generation
                  </span>
                  <span style={S.sub}>
                    Creating this batch will automatically generate its{' '}
                    <strong>
                      {
                        stages.find((s) => s.stage_id === header.stage_id)
                          ?.stage_name
                      }
                    </strong>{' '}
                    scheduler with standard SOP activities (daily feed rations,
                    health medications, and KPI limits) based on breed lifecycle
                    standards.
                  </span>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelStartDate')}{' '}
                <span className="text-(--danger)">*</span>
              </label>
              <input
                type="date"
                value={header.start_date}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, start_date: e.target.value }))
                }
                className={inputCls}
                style={S.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelExpectedEndDate')}
              </label>
              <input
                type="date"
                value={header.expected_end_date}
                onChange={(e) =>
                  setHeader((h) => ({
                    ...h,
                    expected_end_date: e.target.value,
                  }))
                }
                className={inputCls}
                style={S.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelOpeningQty')}{' '}
                {trackingMode === 'BATCH_WISE' && (
                  <span className="text-(--danger)">*</span>
                )}
              </label>
              {trackingMode === 'ANIMAL_WISE' ? (
                <input
                  type="number"
                  value={selectedAnimalIds.size}
                  disabled
                  className={inputCls}
                  style={{ ...S.input, opacity: 0.7 }}
                  title="Derived from the number of animals selected below"
                />
              ) : (
                <input
                  type="number"
                  value={header.opening_quantity}
                  onChange={(e) =>
                    setHeader((h) => ({
                      ...h,
                      opening_quantity: e.target.value,
                    }))
                  }
                  placeholder="5000"
                  className={inputCls}
                  style={S.input}
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelUom')} <span className="text-(--danger)">*</span>
              </label>
              {trackingMode === 'ANIMAL_WISE' ? (
                <input
                  value="HEAD"
                  disabled
                  className={inputCls}
                  style={{ ...S.input, opacity: 0.7 }}
                  title="Animal Wise batches are always counted in HEAD"
                />
              ) : (
                <SearchableSelect
                  ariaLabel="UOM"
                  ariaRequired
                  value={header.uom}
                  onChange={(val) =>
                    setHeader((h) => ({ ...h, uom: val }))
                  }
                  options={uoms.map((u) => ({
                    value: u.uom_code,
                    label: u.uom_code,
                  }))}
                  placeholder={t('blSelectEllipsis')}
                  searchPlaceholder="Search UOM…"
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelRemarks')}
              </label>
              <input
                value={header.remarks}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, remarks: e.target.value }))
                }
                className={inputCls}
                style={S.input}
              />
            </div>
          </div>

          {trackingMode === 'BATCH_WISE' && (
            <>
              <div className="flex items-center justify-between pt-2">
                <p
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={S.sub}
                >
                  {t('blInputLinesTitle')}
                </p>
                <button
                  onClick={addInputLine}
                  type="button"
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold"
                  style={S.surface}
                >
                  <Plus className="h-3 w-3" /> {t('blAddLine')}
                </button>
              </div>

              <div
                className="overflow-x-auto rounded-[var(--radius-sm)] border"
                style={S.surface}
              >
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader>
                    <tr className="border-b border-(--row-border)">
                      <TableHead className="h-auto px-3 py-2">
                        {t('blColItem')}
                      </TableHead>
                      <TableHead className="h-auto px-3 py-2">
                        {t('blColSourceBatch')}
                      </TableHead>
                      <TableHead className="h-auto px-3 py-2">
                        {t('blColQty')}
                      </TableHead>
                      <TableHead className="h-auto px-3 py-2">
                        {t('blColUom')}
                      </TableHead>
                      <TableHead className="h-auto px-3 py-2">
                        {t('blColEstRate')}
                      </TableHead>
                      <TableHead className="h-auto px-3 py-2"></TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {inputLines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="px-2 py-1.5">
                          <SearchableSelect
                            ariaLabel="Item"
                            value={line.item_id}
                            onChange={(val) =>
                              setInputLineField(idx, 'item_id', val)
                            }
                            options={availableInputItems.map((it, i) => ({
                              value: it.item_id,
                              label: `${i + 1}. ${it.item_code} — ${it.item_name || it.item_code}`,
                            }))}
                            placeholder={t('blSelectItemOptions', {
                              count: availableInputItems.length,
                            })}
                            searchPlaceholder="Search item…"
                          />
                        </TableCell>
                        <TableCell className="px-2 py-1.5">
                          <SearchableSelect
                            ariaLabel="Source Batch"
                            value={line.source_batch_id}
                            onChange={(val) =>
                              setInputLineField(idx, 'source_batch_id', val)
                            }
                            options={batches
                              .filter((b) => b.status === 'CLOSED')
                              .map((b) => ({
                                value: b.batch_id,
                                label: b.batch_no,
                              }))}
                            placeholder={t('blNone')}
                            searchPlaceholder="Search batch…"
                            onClear={line.source_batch_id ? () => setInputLineField(idx, 'source_batch_id', '') : undefined}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-1.5 w-24">
                          <input
                            type="number"
                            value={line.quantity}
                            onChange={(e) =>
                              setInputLineField(idx, 'quantity', e.target.value)
                            }
                            className={inputCls}
                            style={S.input}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-1.5 w-24">
                          <SearchableSelect
                            ariaLabel="UOM"
                            value={line.uom}
                            onChange={(val) =>
                              setInputLineField(idx, 'uom', val)
                            }
                            options={uoms.map((u) => ({
                              value: u.uom_code,
                              label: u.uom_code,
                            }))}
                            placeholder={t('blSelectEllipsis')}
                            searchPlaceholder="Search UOM…"
                          />
                        </TableCell>
                        <TableCell className="px-2 py-1.5 w-24">
                          <input
                            type="number"
                            value={line.rate}
                            onChange={(e) =>
                              setInputLineField(idx, 'rate', e.target.value)
                            }
                            className={inputCls}
                            style={S.input}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-1.5">
                          <button
                            onClick={() => removeInputLine(idx)}
                            type="button"
                            className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)"
                            style={{ color: 'var(--danger)' }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
              <p className="text-[11px]" style={S.muted}>
                {t('blRateEstimateNote')}
              </p>

              {header.costing_method === 'STANDARD' && (
                <>
                  <div className="pt-2">
                    <p
                      className="text-[11px] font-semibold uppercase tracking-wider"
                      style={S.sub}
                    >
                      {t('blStdCostTitle')}
                    </p>
                    <p className="mt-0.5 text-[11px]" style={S.muted}>
                      {t('blStdCostSubtitle')}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="nf-text-label" style={S.sub}>
                        {t('blLabelStdOutputQty')}
                      </label>
                      <input
                        type="number"
                        value={stdForm.std_output_quantity}
                        onChange={(e) =>
                          setStdForm((f: Row) => ({
                            ...f,
                            std_output_quantity: e.target.value,
                          }))
                        }
                        placeholder={
                          header.breed_id
                            ? t('blPlaceholderAutoFromBreed')
                            : t('blPlaceholderDefaultsOpeningQty')
                        }
                        className={inputCls}
                        style={S.input}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="nf-text-label" style={S.sub}>
                        {t('blLabelStdOutputCost')}
                      </label>
                      <input
                        type="number"
                        value={stdForm.std_output_cost_per_unit}
                        onChange={(e) =>
                          setStdForm((f: Row) => ({
                            ...f,
                            std_output_cost_per_unit: e.target.value,
                          }))
                        }
                        className={inputCls}
                        style={S.input}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="nf-text-label" style={S.sub}>
                        {t('blLabelStdOverheadRate')}
                      </label>
                      <input
                        type="number"
                        value={stdForm.std_overhead_rate_per_unit}
                        onChange={(e) =>
                          setStdForm((f: Row) => ({
                            ...f,
                            std_overhead_rate_per_unit: e.target.value,
                          }))
                        }
                        className={inputCls}
                        style={S.input}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <p
                      className="text-[11px] font-semibold uppercase tracking-wider"
                      style={S.sub}
                    >
                      {t('blConsumptionStandardsTitle')}
                    </p>
                    <button
                      onClick={addStdConsumptionLine}
                      type="button"
                      className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold"
                      style={S.surface}
                    >
                      <Plus className="h-3 w-3" /> {t('blAddLine')}
                    </button>
                  </div>

                  <div
                    className="overflow-x-auto rounded-[var(--radius-sm)] border"
                    style={S.surface}
                  >
                    <table className="w-full border-collapse text-left text-xs">
                      <TableHeader>
                        <tr className="border-b border-[var(--row-border)]">
                          <TableHead className="h-auto px-3 py-2">
                            {t('blColItem')}
                          </TableHead>
                          <TableHead className="h-auto px-3 py-2">
                            {t('blColStdQtyPerUnitDay')}
                          </TableHead>
                          <TableHead className="h-auto px-3 py-2">
                            {t('blColStdRate')}
                          </TableHead>
                          <TableHead className="h-auto px-3 py-2"></TableHead>
                        </tr>
                      </TableHeader>
                      <TableBody>
                        {stdConsumptionLines.map((line, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="px-2 py-1.5">
                              <SearchableSelect
                                ariaLabel="Item"
                                value={line.item_id}
                                onChange={(val) =>
                                  setStdConsumptionLineField(idx, 'item_id', val)
                                }
                                options={items.map((it, i) => ({
                                  value: it.item_id,
                                  label: `${i + 1}. ${it.item_code} — ${it.item_name || it.item_code}`,
                                }))}
                                placeholder={t('blSelectItemOptions', {
                                  count: items.length,
                                })}
                                searchPlaceholder="Search item…"
                              />
                            </TableCell>
                            <TableCell className="px-2 py-1.5 w-32">
                              <input
                                type="number"
                                value={line.std_qty_per_unit_per_day}
                                onChange={(e) =>
                                  setStdConsumptionLineField(
                                    idx,
                                    'std_qty_per_unit_per_day',
                                    e.target.value,
                                  )
                                }
                                className={inputCls}
                                style={S.input}
                              />
                            </TableCell>
                            <TableCell className="px-2 py-1.5 w-28">
                              <input
                                type="number"
                                value={line.std_rate}
                                onChange={(e) =>
                                  setStdConsumptionLineField(
                                    idx,
                                    'std_rate',
                                    e.target.value,
                                  )
                                }
                                placeholder={t('blPlaceholderItemDefault')}
                                className={inputCls}
                                style={S.input}
                              />
                            </TableCell>
                            <TableCell className="px-2 py-1.5">
                              <button
                                onClick={() => removeStdConsumptionLine(idx)}
                                type="button"
                                className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)"
                                style={{ color: 'var(--danger)' }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {trackingMode === 'ANIMAL_WISE' && (
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between gap-3">
                <p
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={S.sub}
                >
                  Select Animals ({selectedAnimalIds.size} of{' '}
                  {selectableFilteredCandidates.length} selected)
                </p>
                <div className="flex items-center gap-2">
                  <div className="w-36">
                    <SearchableSelect
                      ariaLabel="Gender Filter"
                      value={animalGenderFilter}
                      onChange={(val) => setAnimalGenderFilter(val)}
                      options={[
                        { value: 'M', label: 'Male' },
                        { value: 'F', label: 'Female' },
                      ]}
                      placeholder="All genders"
                      onClear={animalGenderFilter ? () => setAnimalGenderFilter('') : undefined}
                    />
                  </div>
                  <div className="w-40">
                    <SearchableSelect
                      ariaLabel="Stage Filter"
                      value={animalStageFilter}
                      onChange={(val) => setAnimalStageFilter(val)}
                      options={animalStageFilterOptions.map(([stageId, code]) => ({
                        value: stageId,
                        label: code,
                      }))}
                      placeholder="All stages"
                      searchPlaceholder="Search stages…"
                      onClear={animalStageFilter ? () => setAnimalStageFilter('') : undefined}
                    />
                  </div>
                  <div className="relative w-64">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                      style={S.muted}
                    />
                    <input
                      value={animalSearch}
                      onChange={(e) => setAnimalSearch(e.target.value)}
                      placeholder="Search code, ear tag, RFID…"
                      className={`${inputCls} pl-7`}
                      style={S.input}
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label
                  className="flex items-center gap-1.5 text-[11px] font-semibold"
                  style={S.sub}
                >
                  <input
                    type="checkbox"
                    checked={showAllAnimals}
                    onChange={(e) => setShowAllAnimals(e.target.checked)}
                  />
                  Show all animals (including already-assigned)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportAnimalsCsv}
                    disabled={filteredAnimalCandidates.length === 0}
                    className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                    style={S.surface}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => csvFileInputRef.current?.click()}
                    className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold"
                    style={S.surface}
                  >
                    Import CSV
                  </button>
                  <input
                    ref={csvFileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImportAnimalsCsv(file);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
              {csvImportResult && (
                <div
                  className="rounded-lg border px-3 py-2 text-[11px]"
                  style={S.surface}
                >
                  <p className="font-semibold" style={S.primary}>
                    {csvImportResult.matched} animal
                    {csvImportResult.matched === 1 ? '' : 's'} selected from
                    file.
                    {csvImportResult.errors.length > 0 &&
                      ` ${csvImportResult.errors.length} row${csvImportResult.errors.length === 1 ? '' : 's'} could not be matched:`}
                  </p>
                  {csvImportResult.errors.length > 0 && (
                    <ul
                      className="mt-1 list-disc pl-4"
                      style={{ color: 'var(--danger)' }}
                    >
                      {csvImportResult.errors.slice(0, 10).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                      {csvImportResult.errors.length > 10 && (
                        <li>
                          +{csvImportResult.errors.length - 10} more row
                          {csvImportResult.errors.length - 10 === 1 ? '' : 's'}…
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
              {!header.lob_id ? (
                <p className="text-xs" style={S.muted}>
                  Select a Line of Business first.
                </p>
              ) : filteredAnimalCandidates.length === 0 ? (
                <p className="text-xs" style={S.muted}>
                  {header.breed_id
                    ? 'No unassigned animals found matching the selected breed.'
                    : 'No unassigned animals found for this Line of Business.'}
                </p>
              ) : (
                <div
                  className="max-h-72 overflow-auto rounded-[var(--radius-sm)] border"
                  style={S.surface}
                >
                  <table className="w-full border-collapse text-left text-xs">
                    <TableHeader>
                      <tr className="border-b border-(--row-border)">
                        <TableHead className="h-auto w-8 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleSelectAllFiltered}
                            aria-label="Select all"
                          />
                        </TableHead>
                        <TableHead className="h-auto px-3 py-2">
                          Animal Code
                        </TableHead>
                        <TableHead className="h-auto px-3 py-2">
                          Ear Tag
                        </TableHead>
                        <TableHead className="h-auto px-3 py-2">
                          Type / Sex
                        </TableHead>
                        <TableHead className="h-auto px-3 py-2">
                          Breed
                        </TableHead>
                        <TableHead className="h-auto px-3 py-2">Age</TableHead>
                        <TableHead className="h-auto px-3 py-2">
                          Stage
                        </TableHead>
                        <TableHead className="h-auto px-3 py-2">
                          Location
                        </TableHead>
                        <TableHead className="h-auto px-3 py-2">
                          Status
                        </TableHead>
                      </tr>
                    </TableHeader>
                    <TableBody>
                      {filteredAnimalCandidates.map((a) => {
                        const selected = selectedAnimalIds.has(a.animal_id);
                        const assignedElsewhere = isAssignedElsewhere(a);
                        return (
                          <TableRow
                            key={a.animal_id}
                            onClick={() =>
                              !assignedElsewhere &&
                              toggleAnimalSelected(a.animal_id)
                            }
                            className={
                              assignedElsewhere
                                ? 'cursor-not-allowed opacity-60'
                                : 'cursor-pointer'
                            }
                            style={
                              selected
                                ? { backgroundColor: 'var(--surface-raised)' }
                                : undefined
                            }
                          >
                            <TableCell className="px-3 py-1.5">
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={assignedElsewhere}
                                onChange={() =>
                                  toggleAnimalSelected(a.animal_id)
                                }
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell className="px-3 py-1.5 font-mono">
                              {a.animal_code}
                            </TableCell>
                            <TableCell
                              className="px-3 py-1.5 font-mono"
                              style={S.sub}
                            >
                              {a.ear_tag || '—'}
                            </TableCell>
                            <TableCell className="px-3 py-1.5" style={S.sub}>
                              {a.animal_type} /{' '}
                              {a.gender === 'F' ? 'Female' : 'Male'}
                            </TableCell>
                            <TableCell className="px-3 py-1.5" style={S.sub}>
                              {breedLabel(a.breed_id)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5" style={S.sub}>
                              {animalAge(a)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5" style={S.sub}>
                              {stageLabel(a.current_stage_id)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5" style={S.sub}>
                              {locationLabel(a.current_location_id)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              {assignedElsewhere ? (
                                <span
                                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                  style={{
                                    backgroundColor:
                                      'var(--danger-subtle, #fee2e2)',
                                    color: 'var(--danger)',
                                  }}
                                >
                                  Assigned
                                </span>
                              ) : (
                                <span style={S.sub}>{a.status || '—'}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </table>
                </div>
              )}
              <p className="text-[11px]" style={S.muted}>
                Each selected animal keeps its own current stage and location —
                a scheduler is created for every distinct stage among them.
              </p>
            </div>
          )}
        </div>
      </Dialog>

      {/* Detail / lifecycle modal */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={
          viewing
            ? t('blDetailTitle', { batchNo: viewing.batch_no })
            : t('blDetailTitleFallback')
        }
        description={viewing?.remarks || t('blDetailDescFallback')}
        maxWidth="xl"
      >
        {viewing && (
          <div className="flex flex-col gap-4 text-xs">
            {/* Top Batch Metadata Card */}
            <div
              className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 p-3.5 rounded-[var(--radius-md)] border shadow-2xs"
              style={{
                backgroundColor: 'var(--surface-raised)',
                borderColor: 'var(--border)',
              }}
            >
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('blLabelStatus')}
                </p>
                <StatusBadge status={viewing.status} className="mt-1" />
              </div>
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('blLabelCostingMethod')}
                </p>
                <p className="font-semibold mt-0.5" style={S.primary}>
                  {viewing.costing_method}
                </p>
              </div>
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('blLabelOpeningHeadQty')}
                </p>
                <p className="font-semibold mt-0.5" style={S.primary}>
                  {formatQuantity(viewing.opening_quantity, viewing.uom || 'HEAD')} {viewing.uom || 'HEAD'}
                </p>
              </div>
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('blLabelBreedVariety')}
                </p>
                <p className="font-semibold mt-0.5" style={S.primary}>
                  {viewing.breed_name || viewing.breed_code || '—'}
                </p>
              </div>
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('blLabelStartDate')}
                </p>
                <p className="font-semibold mt-0.5" style={S.primary}>
                  {viewing.start_date || '—'}
                </p>
              </div>
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('blLabelExpectedEndDate')}
                </p>
                <p className="font-semibold mt-0.5" style={S.primary}>
                  {viewing.expected_end_date || '—'}
                </p>
              </div>
              {viewing.current_stage_code && (
                <div>
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={S.muted}
                  >
                    {t('blLabelCurrentStage')}
                  </p>
                  <Badge variant="accent" className="mt-1">
                    {viewing.current_stage_code}
                  </Badge>
                </div>
              )}
              {viewing.total_cost != null && (
                <div>
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={S.muted}
                  >
                    {t('blLabelTotalCost')}
                  </p>
                  <p className="font-semibold mt-0.5" style={S.primary}>
                    {formatMoney(Number(viewing.total_cost))}
                  </p>
                </div>
              )}
            </div>

            {/* Navigation Tabs */}
            <div
              className="flex items-center gap-2 border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              {(
                [
                  ['overview', t('blTabOverview')],
                  ['curves', t('blTabCurves')],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setDetailTab(key)}
                  className="px-3.5 py-2 text-xs font-semibold transition-colors relative"
                  style={
                    detailTab === key
                      ? {
                          color: 'var(--accent)',
                          borderBottom: '2px solid var(--accent)',
                        }
                      : {
                          color: 'var(--text-secondary)',
                          borderBottom: '2px solid transparent',
                        }
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {detailTab === 'overview' && (
              <>
                {viewing.status === 'DRAFT' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => openEdit(viewing)}
                      size="sm"
                      className="nf-btn-primary self-start gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" /> {t('edit')}
                    </Button>
                  </div>
                )}

                {viewing.status === 'ACTIVE' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={openTransferStage}
                      variant="outline"
                      size="sm"
                      className="self-start gap-1.5"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />{' '}
                      {t('blTransferStage')}
                    </Button>
                    <Button
                      onClick={() =>
                        router.push(
                          `/batches/entry?batchId=${viewing.batch_id}`,
                        )
                      }
                      size="sm"
                      className="nf-btn-primary self-start gap-1.5"
                    >
                      <FileText className="h-3.5 w-3.5" /> Data Entry
                    </Button>
                  </div>
                )}

                {(viewing.stage_log || []).length > 0 && (
                  <div>
                    <p
                      className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={S.sub}
                    >
                      {t('blStageHistoryTitle')}
                    </p>
                    <div
                      className="overflow-x-auto rounded-[var(--radius-sm)] border"
                      style={S.surface}
                    >
                      <table className="w-full border-collapse text-left text-xs">
                        <TableHeader>
                          <tr className="border-b border-[var(--row-border)]">
                            <TableHead className="h-auto px-3 py-2">
                              {t('blColFromStage')}
                            </TableHead>
                            <TableHead className="h-auto px-3 py-2">
                              {t('blColToStage')}
                            </TableHead>
                            <TableHead className="h-auto px-3 py-2">
                              {t('blColTransferredDate')}
                            </TableHead>
                            <TableHead className="h-auto px-3 py-2">
                              {t('blColRemarks')}
                            </TableHead>
                          </tr>
                        </TableHeader>
                        <TableBody>
                          {(viewing.stage_log || []).map((s: Row) => (
                            <TableRow key={s.log_id}>
                              <TableCell className="px-3 py-2" style={S.sub}>
                                {s.from_stage_code || '—'}
                              </TableCell>
                              <TableCell
                                className="px-3 py-2 font-semibold"
                                style={S.primary}
                              >
                                {s.to_stage_code}
                              </TableCell>
                              <TableCell className="px-3 py-2" style={S.sub}>
                                {s.transferred_at}
                              </TableCell>
                              <TableCell className="px-3 py-2" style={S.sub}>
                                {s.remarks || '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </table>
                    </div>
                  </div>
                )}

                <div>
                  <p
                    className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                    style={S.sub}
                  >
                    {t('blInputLinesInitialTitle')}
                  </p>
                  <div
                    className="overflow-x-auto rounded-[var(--radius-sm)] border"
                    style={S.surface}
                  >
                    <table className="w-full border-collapse text-left text-xs">
                      <TableHeader>
                        <tr className="border-b border-[var(--row-border)]">
                          <TableHead className="h-auto px-3 py-2">
                            {t('blColItem')}
                          </TableHead>
                          <TableHead className="h-auto px-3 py-2">
                            {t('blColSourceBatch')}
                          </TableHead>
                          <TableHead className="h-auto px-3 py-2">
                            {t('blColQty')}
                          </TableHead>
                          <TableHead className="h-auto px-3 py-2">
                            {t('blColRate')}
                          </TableHead>
                        </tr>
                      </TableHeader>
                      <TableBody>
                        {(viewing.input_lines || []).map((l: Row) => (
                          <TableRow key={l.line_id}>
                            <TableCell
                              className="px-3 py-2 font-medium"
                              style={S.primary}
                            >
                              {itemLabel(l.item_id)}
                            </TableCell>
                            <TableCell className="px-3 py-2" style={S.sub}>
                              {l.source_batch_id
                                ? batchLabel(l.source_batch_id)
                                : '—'}
                            </TableCell>
                            <TableCell className="px-3 py-2" style={S.primary}>
                              {l.quantity} {l.uom}
                            </TableCell>
                            <TableCell className="px-3 py-2" style={S.primary}>
                              {l.rate
                                ? formatMoney(Number(l.rate).toFixed(2))
                                : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </table>
                  </div>
                </div>
                {viewing.costing_method === 'BIO_ASSET' &&
                  viewing.bio_asset_state && (
                    <div>
                      <p
                        className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style={S.sub}
                      >
                        {t('blBioAssetStateTitle')}
                      </p>
                      <div
                        className="rounded-[var(--radius-sm)] border p-3"
                        style={S.surface}
                      >
                        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                          <div>
                            <p
                              className="font-semibold uppercase tracking-wider"
                              style={S.muted}
                            >
                              {t('blLabelStage')}
                            </p>
                            <Badge
                              variant={
                                viewing.bio_asset_state.stage === 'MATURE'
                                  ? 'success'
                                  : 'accent'
                              }
                              className="mt-1"
                            >
                              {viewing.bio_asset_state.stage}
                            </Badge>
                          </div>
                          <div>
                            <p
                              className="font-semibold uppercase tracking-wider"
                              style={S.muted}
                            >
                              {t('blLabelCurrentQty')}
                            </p>
                            <p style={S.primary}>
                              {formatQuantity(viewing.bio_asset_state.current_quantity, 'HEAD')}
                            </p>
                          </div>
                          <div>
                            <p
                              className="font-semibold uppercase tracking-wider"
                              style={S.muted}
                            >
                              {t('blLabelNcaBookValue')}
                            </p>
                            <p style={S.primary}>
                              {viewing.bio_asset_state.nca_book_value}
                            </p>
                          </div>
                          <div>
                            <p
                              className="font-semibold uppercase tracking-wider"
                              style={S.muted}
                            >
                              {t('blLabelMonthlyAmortRate')}
                            </p>
                            <p style={S.primary}>
                              {viewing.bio_asset_state
                                .monthly_amortization_rate ?? '—'}
                            </p>
                          </div>
                        </div>
                        {viewing.status === 'ACTIVE' && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {viewing.bio_asset_state.stage === 'PREMATURE' && (
                              <Button
                                size="sm"
                                onClick={() => openBioAction('mature')}
                                className="nf-btn-primary"
                              >
                                {t('blMatureHerd')}
                              </Button>
                            )}
                            {viewing.bio_asset_state.stage === 'MATURE' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openBioAction('amortize')}
                                >
                                  {t('blRunAmortization')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openBioAction('fair-value')}
                                >
                                  {t('blRecordFairValue')}
                                </Button>
                              </>
                            )}
                            {Number(viewing.bio_asset_state.current_quantity) >
                              0 && (
                              <Button
                                size="sm"
                                onClick={() => openBioAction('dispose')}
                                style={{
                                  backgroundColor: 'var(--success)',
                                  color: '#fff',
                                }}
                              >
                                {t('blDispose')}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </>
            )}

            {detailTab === 'overview' && (
              <>
                {viewing.costing_method === 'BIO_ASSET' &&
                  (viewing.bio_asset_entries || []).length > 0 && (
                    <div>
                      <p
                        className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style={S.sub}
                      >
                        {t('blBioAssetLedgerTitle')}
                      </p>
                      <div
                        className="overflow-x-auto rounded-[var(--radius-sm)] border"
                        style={S.surface}
                      >
                        <table className="w-full border-collapse text-left text-xs">
                          <TableHeader>
                            <tr className="border-b border-[var(--row-border)]">
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColDate')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColEntryType')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColItem')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColStage')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColQty')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColCostAmount')}
                              </TableHead>
                            </tr>
                          </TableHeader>
                          <TableBody>
                            {(viewing.bio_asset_entries || []).map((e: Row) => (
                              <TableRow key={e.entry_id}>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {e.posting_date}
                                </TableCell>
                                <TableCell className="px-3 py-2" style={S.sub}>
                                  {e.entry_type}
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {itemLabel(e.bio_asset_item_id)}
                                </TableCell>
                                <TableCell className="px-3 py-2" style={S.sub}>
                                  {e.stage ?? '—'}
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {e.quantity ?? '—'}
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2 font-semibold"
                                  style={
                                    Number(e.cost_amount) >= 0
                                      ? { color: 'var(--success)' }
                                      : { color: 'var(--danger)' }
                                  }
                                >
                                  {e.cost_amount}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </table>
                      </div>
                    </div>
                  )}

                {viewing.status === 'ACTIVE' &&
                  viewing.costing_method !== 'BIO_ASSET' && (
                    <Button
                      size="sm"
                      onClick={openClose}
                      style={{
                        backgroundColor: 'var(--success)',
                        color: '#fff',
                      }}
                      className="gap-1.5 self-start"
                    >
                      <CheckCircle2 className="h-4 w-4" /> {t('blCloseBatch')}
                    </Button>
                  )}

                {viewing.status === 'CLOSED' &&
                  (viewing.output_lines || []).length > 0 && (
                    <div>
                      <p
                        className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style={S.sub}
                      >
                        {t('blOutputLinesTitle')}
                      </p>
                      <div
                        className="overflow-x-auto rounded-[var(--radius-sm)] border"
                        style={S.surface}
                      >
                        <table className="w-full border-collapse text-left text-xs">
                          <TableHeader>
                            <tr className="border-b border-[var(--row-border)]">
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColItem')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColType')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColSplitPct')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColQty')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColCostUnitCost')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2 text-right">
                                {t('blColQcPack')}
                              </TableHead>
                            </tr>
                          </TableHeader>
                          <TableBody>
                            {(viewing.output_lines || []).map((l: Row) => (
                              <TableRow key={l.line_id}>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {itemLabel(l.item_id)}
                                </TableCell>
                                <TableCell className="px-3 py-2" style={S.sub}>
                                  {l.output_type}
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {l.cost_split_pct}%
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {l.quantity} {l.uom}
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {l.computed_cost} / {l.unit_cost}
                                </TableCell>
                                <TableCell className="px-3 py-2 text-right">
                                  <div className="flex justify-end gap-1">
                                    <button
                                      onClick={() => openRecordQc(l)}
                                      title={t('blRecordQcTitle')}
                                      className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)"
                                      style={S.sub}
                                    >
                                      <ClipboardCheck className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => openGeneratePack(l)}
                                      title={t('blGeneratePackTitle')}
                                      className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)"
                                      style={S.sub}
                                    >
                                      <QrCodeIcon className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </table>
                      </div>
                    </div>
                  )}

                {viewing.status === 'CLOSED' &&
                  (viewing.variances || []).length > 0 && (
                    <div>
                      <p
                        className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                        style={S.sub}
                      >
                        {t('blCostVarianceTitle')}
                      </p>
                      <div
                        className="overflow-x-auto rounded-[var(--radius-sm)] border"
                        style={S.surface}
                      >
                        <table className="w-full border-collapse text-left text-xs">
                          <TableHeader>
                            <tr className="border-b border-[var(--row-border)]">
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColType')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColItem')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColStdValue')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColActualValue')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2">
                                {t('blColVariance')}
                              </TableHead>
                              <TableHead className="h-auto px-3 py-2"></TableHead>
                            </tr>
                          </TableHeader>
                          <TableBody>
                            {(viewing.variances || []).map((v: Row) => (
                              <TableRow key={v.variance_id}>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {v.variance_type}
                                </TableCell>
                                <TableCell className="px-3 py-2" style={S.sub}>
                                  {v.item_id ? itemLabel(v.item_id) : '—'}
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {Number(v.std_value).toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 4 },
                                  )}
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2"
                                  style={S.primary}
                                >
                                  {Number(v.actual_value).toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 4 },
                                  )}
                                </TableCell>
                                <TableCell
                                  className="px-3 py-2 font-semibold"
                                  style={
                                    v.is_favorable
                                      ? { color: 'var(--success)' }
                                      : { color: 'var(--danger)' }
                                  }
                                >
                                  {v.variance_amount}
                                </TableCell>
                                <TableCell className="px-3 py-2">
                                  <Badge
                                    variant={
                                      v.is_favorable ? 'success' : 'danger'
                                    }
                                  >
                                    {v.is_favorable
                                      ? t('blVarianceFav')
                                      : t('blVarianceUnfav')}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </table>
                      </div>
                    </div>
                  )}

                {viewing.status === 'CLOSED' && renewAllowed && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openRenew}
                    className="gap-1.5 self-start"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> {t('blRenewBatch')}
                  </Button>
                )}
              </>
            )}

            {detailTab === 'curves' && (
              <div className="py-2">
                <BatchPerformanceCurvesPanel
                  batchId={viewing.batch_id}
                  onSchedulerGenerated={() => {
                    load();
                    api
                      .get(`/batch/${viewing.batch_id}`)
                      .then((r) => setViewing(unwrap<Row>(r)));
                  }}
                />
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Transfer stage modal */}
      <Dialog
        open={stageModalOpen}
        onClose={() => !stageSaving && setStageModalOpen(false)}
        title={t('blTransferStage')}
        footer={
          <Button
            size="sm"
            onClick={handleTransferStage}
            disabled={Boolean(
              stageSaving ||
                stageOptions.length === 0 ||
                !stageForm.to_stage_code ||
                (stageTransitionInfo &&
                  !stageTransitionInfo.can_move_without_remarks &&
                  !stageForm.remarks?.trim()),
            )}
            className="nf-btn-primary"
          >
            {stageSaving ? t('blTransferring') : t('blTransferBtn')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {stageError && <InlineAlert>{stageError}</InlineAlert>}
          <p className="text-xs" style={S.sub}>
            {t('blCurrentStagePrefix')}{' '}
            <span className="font-semibold" style={S.primary}>
              {viewing?.current_stage_code || t('blNone')}
            </span>
            . {t('blNoCostGlImpactNote')}
          </p>

          {/* Min Days Before Move Rule Context */}
          {stageTransitionInfo && (
            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle,#f8fafc)] dark:bg-[var(--surface-subtle,#0f172a)] space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">
                  Days in Current Stage:
                </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {stageTransitionInfo.days_in_stage} days
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">
                  Min Days Before Move Rule:
                </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {stageTransitionInfo.min_days_before_move
                    ? `${stageTransitionInfo.min_days_before_move} days`
                    : 'None required'}
                </span>
              </div>
              <div className="pt-1">
                {stageTransitionInfo.can_move_without_remarks ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded p-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Minimum duration satisfied ({stageTransitionInfo.days_in_stage}{' '}
                      of {stageTransitionInfo.min_days_before_move} days).
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded p-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Early move notice: Current stage requires at least{' '}
                      {stageTransitionInfo.min_days_before_move} days before move
                      (currently day {stageTransitionInfo.days_in_stage}). Justification
                      / Remarks are mandatory to proceed.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="nf-text-label" style={S.sub}>
              {t('blLabelNewStage')} *
            </label>
            {stageOptionsLoading ? (
              <div className="flex items-center gap-2 text-xs" style={S.sub}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />{' '}
                {t('blLoadingStages')}
              </div>
            ) : stageOptions.length > 0 ? (
              <SearchableSelect
                ariaLabel={t('blSelectStagePlaceholder')}
                value={stageForm.to_stage_code || ''}
                onChange={(val) =>
                  setStageForm((f: Row) => ({
                    ...f,
                    to_stage_code: val,
                  }))
                }
                options={Array.from(new Set(stageOptions)).map((code) => {
                  const stageDetail = stageTransitionInfo?.valid_next_stages?.find(
                    (s: Row) => s.stage_code === code,
                  );
                  const label = stageDetail
                    ? `${stageDetail.stage_name} (${code}) — Seq ${stageDetail.stage_sequence}`
                    : code;
                  return {
                    value: code,
                    label,
                  };
                })}
                placeholder={t('blSelectStagePlaceholder')}
                searchPlaceholder="Search stage…"
              />
            ) : (
              <p className="text-xs" style={S.muted}>
                {t('blNoStagesConfigured')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="nf-text-label" style={S.sub}>
              {t('blLabelRemarks')}{' '}
              {stageTransitionInfo &&
              !stageTransitionInfo.can_move_without_remarks ? (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  * (Required for early move justification)
                </span>
              ) : (
                <span className="text-[var(--text-muted)] font-normal">
                  (Optional)
                </span>
              )}
            </label>
            <input
              placeholder={
                stageTransitionInfo &&
                !stageTransitionInfo.can_move_without_remarks
                  ? 'Enter reason/justification for early stage transition…'
                  : ''
              }
              value={stageForm.remarks || ''}
              onChange={(e) =>
                setStageForm((f: Row) => ({ ...f, remarks: e.target.value }))
              }
              className={inputCls}
              style={S.input}
            />
          </div>
        </div>
      </Dialog>

      {/* Renew batch modal */}
      <Dialog
        open={renewModalOpen}
        onClose={() => !renewSaving && setRenewModalOpen(false)}
        title={t('blRenewBatch')}
        footer={
          <Button
            size="sm"
            onClick={handleRenew}
            disabled={renewSaving}
            className="nf-btn-primary"
          >
            {renewSaving ? t('blCreating') : t('blCreateNextCycle')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {renewError && <InlineAlert>{renewError}</InlineAlert>}
          <div
            className="rounded-lg border px-3 py-2 text-xs"
            style={S.surface}
          >
            <p
              className="mb-1 font-semibold uppercase tracking-wider"
              style={S.muted}
            >
              {t('blCarriedForwardFrom', { batchNo: viewing?.batch_no })}
            </p>
            <p style={S.sub}>
              {t('blLabelBreedColon')}{' '}
              <span style={S.primary}>
                {viewing?.breed_id
                  ? breeds.find((b) => b.breed_id === viewing.breed_id)
                      ?.breed_name || '—'
                  : '—'}
              </span>
            </p>
            <p style={S.sub}>
              {t('blLabelShedColon')}{' '}
              <span style={S.primary}>
                {viewing?.shed_id
                  ? sheds.find((s) => s.shed_id === viewing.shed_id)
                      ?.shed_name || '—'
                  : '—'}
              </span>
            </p>
            <p style={S.sub}>
              {t('blLabelCostingMethodColon')}{' '}
              <span style={S.primary}>{viewing?.costing_method}</span>
              {viewing?.standard ? t('blStdCostCarriedForwardNote') : ''}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelStartDate')} *
              </label>
              <input
                type="date"
                value={renewForm.start_date || ''}
                onChange={(e) =>
                  setRenewForm((f: Row) => ({
                    ...f,
                    start_date: e.target.value,
                  }))
                }
                className={inputCls}
                style={S.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelExpectedEndDate')}
              </label>
              <input
                type="date"
                value={renewForm.expected_end_date || ''}
                onChange={(e) =>
                  setRenewForm((f: Row) => ({
                    ...f,
                    expected_end_date: e.target.value,
                  }))
                }
                className={inputCls}
                style={S.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelOpeningQty')} *
              </label>
              <input
                type="number"
                value={renewForm.opening_quantity ?? ''}
                onChange={(e) =>
                  setRenewForm((f: Row) => ({
                    ...f,
                    opening_quantity: e.target.value,
                  }))
                }
                className={inputCls}
                style={S.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelUom')} *
              </label>
              <SearchableSelect
                ariaLabel={t('blLabelUom')}
                value={renewForm.uom || ''}
                onChange={(val) =>
                  setRenewForm((f: Row) => ({ ...f, uom: val }))
                }
                options={uoms.map((u) => ({
                  value: u.uom_code,
                  label: u.uom_code,
                }))}
                placeholder={t('blSelectEllipsis')}
                searchPlaceholder="Search UOM…"
              />
            </div>
          </div>
          <div>
            <p
              className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
              style={S.sub}
            >
              {t('blInputLineTitle')}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <SearchableSelect
                  ariaLabel={t('blInputLineTitle')}
                  value={renewForm.item_id || ''}
                  onChange={(val) =>
                    setRenewForm((f: Row) => ({ ...f, item_id: val }))
                  }
                  options={items.map((it, i) => ({
                    value: it.item_id,
                    label: `${i + 1}. ${it.item_code} — ${it.item_name || it.item_code}`,
                  }))}
                  placeholder={t('blSelectItemOptions', { count: items.length })}
                  searchPlaceholder="Search item…"
                />
              </div>
              <input
                type="number"
                placeholder={t('blPlaceholderQty')}
                value={renewForm.quantity ?? ''}
                onChange={(e) =>
                  setRenewForm((f: Row) => ({ ...f, quantity: e.target.value }))
                }
                className={inputCls}
                style={S.input}
              />
              <SearchableSelect
                ariaLabel={t('blSelectUomPlaceholder')}
                value={renewForm.line_uom || ''}
                onChange={(val) =>
                  setRenewForm((f: Row) => ({ ...f, line_uom: val }))
                }
                options={uoms.map((u) => ({
                  value: u.uom_code,
                  label: u.uom_code,
                }))}
                placeholder={t('blSelectUomPlaceholder')}
                searchPlaceholder="Search UOM…"
              />
              <input
                type="number"
                placeholder={t('blPlaceholderEstRate')}
                value={renewForm.rate ?? ''}
                onChange={(e) =>
                  setRenewForm((f: Row) => ({ ...f, rate: e.target.value }))
                }
                className={inputCls + ' sm:col-span-4'}
                style={S.input}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="nf-text-label" style={S.sub}>
              {t('blLabelRemarks')}
            </label>
            <input
              value={renewForm.remarks || ''}
              onChange={(e) =>
                setRenewForm((f: Row) => ({ ...f, remarks: e.target.value }))
              }
              className={inputCls}
              style={S.input}
            />
          </div>
        </div>
      </Dialog>

      {/* Close batch modal */}
      <Dialog
        open={closeModalOpen}
        onClose={() => !acting && setCloseModalOpen(false)}
        title={t('blCloseBatchTitle', { batchNo: viewing?.batch_no || '' })}
        maxWidth="xl"
        footer={
          <Button
            size="sm"
            onClick={handleClose}
            disabled={acting}
            className="nf-btn-primary"
          >
            {acting ? t('blClosing') : t('blCloseBatch')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {closeError && <InlineAlert>{closeError}</InlineAlert>}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelActualEndDate')}
              </label>
              <input
                type="date"
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
                className={inputCls}
                style={S.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelClosingQty')}
              </label>
              <input
                type="number"
                value={closeQty}
                onChange={(e) => setCloseQty(e.target.value)}
                className={inputCls}
                style={S.input}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={S.sub}
            >
              {t('blOutputLinesSplitNote')}
            </p>
            <button
              onClick={addOutputLine}
              type="button"
              className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold"
              style={S.surface}
            >
              <Plus className="h-3 w-3" /> {t('blAddLine')}
            </button>
          </div>

          <div
            className="overflow-x-auto rounded-[var(--radius-sm)] border"
            style={S.surface}
          >
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b border-[var(--row-border)]">
                  <TableHead className="h-auto px-3 py-2">
                    {t('blColItem')}
                  </TableHead>
                  <TableHead className="h-auto px-3 py-2">
                    {t('blColType')}
                  </TableHead>
                  <TableHead className="h-auto px-3 py-2">
                    {t('blColSplitPct')}
                  </TableHead>
                  <TableHead className="h-auto px-3 py-2">
                    {t('blColQty')}
                  </TableHead>
                  <TableHead className="h-auto px-3 py-2">
                    {t('blColUom')}
                  </TableHead>
                  <TableHead className="h-auto px-3 py-2">
                    {t('blColWarehouse')}
                  </TableHead>
                  <TableHead className="h-auto px-3 py-2"></TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {outputLines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="px-2 py-1.5">
                      <SearchableSelect
                        ariaLabel="Item"
                        value={line.item_id}
                        onChange={(val) =>
                          setOutputLineField(idx, 'item_id', val)
                        }
                        options={items.map((it, i) => ({
                          value: it.item_id,
                          label: `${i + 1}. ${it.item_code} — ${it.item_name || it.item_code}`,
                        }))}
                        placeholder={t('blSelectItemOptions', { count: items.length })}
                        searchPlaceholder="Search item…"
                      />
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-32">
                      <SearchableSelect
                        ariaLabel="Type"
                        value={line.output_type}
                        onChange={(val) =>
                          setOutputLineField(idx, 'output_type', val)
                        }
                        options={[
                          { value: 'MAIN', label: t('blOutputTypeMain') },
                          { value: 'BY_PRODUCT', label: t('blOutputTypeByProduct') },
                        ]}
                        placeholder="Type"
                        searchPlaceholder="Search type…"
                      />
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-20">
                      <input
                        type="number"
                        value={line.cost_split_pct}
                        onChange={(e) =>
                          setOutputLineField(
                            idx,
                            'cost_split_pct',
                            e.target.value,
                          )
                        }
                        className={inputCls}
                        style={S.input}
                      />
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-20">
                      <input
                        type="number"
                        value={line.quantity}
                        onChange={(e) =>
                          setOutputLineField(idx, 'quantity', e.target.value)
                        }
                        className={inputCls}
                        style={S.input}
                      />
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-28">
                      <SearchableSelect
                        ariaLabel="UOM"
                        value={line.uom}
                        onChange={(val) =>
                          setOutputLineField(idx, 'uom', val)
                        }
                        options={uoms.map((u) => ({
                          value: u.uom_code,
                          label: u.uom_code,
                        }))}
                        placeholder={t('blSelectEllipsis')}
                        searchPlaceholder="Search UOM…"
                      />
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <SearchableSelect
                        ariaLabel="Warehouse"
                        value={line.warehouse_id}
                        onChange={(val) =>
                          setOutputLineField(idx, 'warehouse_id', val)
                        }
                        options={warehouses.map((w) => ({
                          value: w.warehouse_id,
                          label: w.warehouse_code,
                        }))}
                        placeholder={t('blSelectEllipsis')}
                        searchPlaceholder="Search warehouse…"
                      />
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <button
                        onClick={() => removeOutputLine(idx)}
                        type="button"
                        className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)"
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <tr>
                  <TableCell colSpan={2} className="px-3 py-2" style={S.sub}>
                    {t('blSplitTotal')}
                  </TableCell>
                  <TableCell
                    className="px-3 py-2"
                    style={{
                      color:
                        Math.abs(splitTotal - 100) < 0.01
                          ? 'var(--success)'
                          : 'var(--danger)',
                    }}
                  >
                    {splitTotal.toFixed(2)}%
                  </TableCell>
                  <TableCell colSpan={4}></TableCell>
                </tr>
              </TableFooter>
            </table>
          </div>
        </div>
      </Dialog>

      {/* Bio-asset lifecycle action modal (mature / amortize / fair-value / dispose) */}
      <Dialog
        open={!!bioActionOpen}
        onClose={() => !bioActing && setBioActionOpen(null)}
        title={
          bioActionOpen === 'mature'
            ? t('blMatureHerd')
            : bioActionOpen === 'amortize'
              ? t('blRunAmortization')
              : bioActionOpen === 'fair-value'
                ? t('blRecordFairValue')
                : t('blDispose')
        }
        footer={
          <Button
            size="sm"
            onClick={handleBioAction}
            disabled={bioActing}
            className="nf-btn-primary"
          >
            {bioActing ? t('blSaving') : t('blConfirm')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {bioError && <InlineAlert>{bioError}</InlineAlert>}

          {bioActionOpen === 'mature' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelResidualValue')}{' '}
                  <span className="text-(--danger)">*</span>
                </label>
                <input
                  type="number"
                  value={bioForm.residual_value_per_unit}
                  onChange={(e) =>
                    setBioForm((f: Row) => ({
                      ...f,
                      residual_value_per_unit: e.target.value,
                    }))
                  }
                  className={inputCls}
                  style={S.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelProductiveLife')}
                </label>
                <input
                  type="number"
                  value={bioForm.productive_life_months}
                  onChange={(e) =>
                    setBioForm((f: Row) => ({
                      ...f,
                      productive_life_months: e.target.value,
                    }))
                  }
                  placeholder={t('blPlaceholderFromBreed')}
                  className={inputCls}
                  style={S.input}
                />
              </div>
            </div>
          )}

          {bioActionOpen === 'amortize' && (
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>
                {t('blLabelPostingDate')}
              </label>
              <input
                type="date"
                value={bioForm.posting_date}
                onChange={(e) =>
                  setBioForm((f: Row) => ({
                    ...f,
                    posting_date: e.target.value,
                  }))
                }
                className={inputCls}
                style={S.input}
              />
              <p className="text-[11px]" style={S.muted}>
                {t('blAmortizationNote')}
              </p>
            </div>
          )}

          {bioActionOpen === 'fair-value' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelPostingDate')}
                </label>
                <input
                  type="date"
                  value={bioForm.posting_date}
                  onChange={(e) =>
                    setBioForm((f: Row) => ({
                      ...f,
                      posting_date: e.target.value,
                    }))
                  }
                  className={inputCls}
                  style={S.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelNewFairValue')}{' '}
                  <span className="text-(--danger)">*</span>
                </label>
                <input
                  type="number"
                  value={bioForm.fair_value_per_unit}
                  onChange={(e) =>
                    setBioForm((f: Row) => ({
                      ...f,
                      fair_value_per_unit: e.target.value,
                    }))
                  }
                  className={inputCls}
                  style={S.input}
                />
              </div>
            </div>
          )}

          {bioActionOpen === 'dispose' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelDisposalType')}
                  </label>
                  <SearchableSelect
                    ariaLabel={t('blLabelDisposalType')}
                    value={bioForm.disposal_type}
                    onChange={(val) =>
                      setBioForm((f: Row) => ({
                        ...f,
                        disposal_type: val,
                      }))
                    }
                    options={[
                      { value: 'HARVEST', label: t('blDisposalHarvest') },
                      { value: 'SOLD', label: t('blDisposalSold') },
                    ]}
                    placeholder={t('blLabelDisposalType')}
                    searchPlaceholder="Search type…"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelQuantity')}
                  </label>
                  <input
                    type="number"
                    value={bioForm.quantity}
                    onChange={(e) =>
                      setBioForm((f: Row) => ({
                        ...f,
                        quantity: e.target.value,
                      }))
                    }
                    className={inputCls}
                    style={S.input}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelPostingDate')}
                  </label>
                  <input
                    type="date"
                    value={bioForm.posting_date}
                    onChange={(e) =>
                      setBioForm((f: Row) => ({
                        ...f,
                        posting_date: e.target.value,
                      }))
                    }
                    className={inputCls}
                    style={S.input}
                  />
                </div>
              </div>

              {bioForm.disposal_type === 'HARVEST' ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="nf-text-label" style={S.sub}>
                      {t('blLabelOutputItem', { count: items.length })}
                    </label>
                    <SearchableSelect
                      ariaLabel={t('blLabelOutputItem', { count: items.length })}
                      value={bioForm.output_item_id}
                      onChange={(val) =>
                        setBioForm((f: Row) => ({
                          ...f,
                          output_item_id: val,
                        }))
                      }
                      options={items.map((it, i) => ({
                        value: it.item_id,
                        label: `${i + 1}. ${it.item_code} — ${it.item_name || it.item_code}`,
                      }))}
                      placeholder={t('blSelectItemOptions', { count: items.length })}
                      searchPlaceholder="Search item…"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="nf-text-label" style={S.sub}>
                      {t('blLabelOutputUom')}
                    </label>
                    <SearchableSelect
                      ariaLabel={t('blLabelOutputUom')}
                      value={bioForm.output_uom}
                      onChange={(val) =>
                        setBioForm((f: Row) => ({
                          ...f,
                          output_uom: val,
                        }))
                      }
                      options={uoms.map((u) => ({
                        value: u.uom_code,
                        label: u.uom_code,
                      }))}
                      placeholder={t('blSelectEllipsis')}
                      searchPlaceholder="Search UOM…"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="nf-text-label" style={S.sub}>
                      {t('blLabelOutputQuantity')}
                    </label>
                    <input
                      type="number"
                      value={bioForm.output_quantity}
                      onChange={(e) =>
                        setBioForm((f: Row) => ({
                          ...f,
                          output_quantity: e.target.value,
                        }))
                      }
                      className={inputCls}
                      style={S.input}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="nf-text-label" style={S.sub}>
                      {t('blLabelWarehouse')}
                    </label>
                    <SearchableSelect
                      ariaLabel={t('blLabelWarehouse')}
                      value={bioForm.warehouse_id}
                      onChange={(val) =>
                        setBioForm((f: Row) => ({
                          ...f,
                          warehouse_id: val,
                        }))
                      }
                      options={warehouses.map((w) => ({
                        value: w.warehouse_id,
                        label: w.warehouse_code,
                      }))}
                      placeholder={t('blSelectEllipsis')}
                      searchPlaceholder="Search warehouse…"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelSaleProceeds')}
                  </label>
                  <input
                    type="number"
                    value={bioForm.sale_proceeds}
                    onChange={(e) =>
                      setBioForm((f: Row) => ({
                        ...f,
                        sale_proceeds: e.target.value,
                      }))
                    }
                    className={inputCls}
                    style={S.input}
                  />
                  <p className="text-[11px]" style={S.muted}>
                    {t('blSaleProceedsNote')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </Dialog>

      {/* Record QC modal */}
      <Dialog
        open={qcModalOpen}
        onClose={() => !qcSaving && setQcModalOpen(false)}
        title={
          qcLine
            ? t('blRecordQcTitleFull', { item: itemLabel(qcLine.item_id) })
            : t('blRecordQc')
        }
        maxWidth="lg"
        footer={
          qcSubmitted ? undefined : (
            <Button
              size="sm"
              onClick={handleSaveQc}
              disabled={qcSaving}
              className="nf-btn-primary"
            >
              {qcSaving ? t('blSaving') : t('blSubmitInspection')}
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {qcError && <InlineAlert>{qcError}</InlineAlert>}

          {qcSubmitted ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <span
                className="rounded-full border px-4 py-1.5 text-sm font-semibold"
                style={
                  qcSubmitted.overall_result === 'PASS'
                    ? {
                        color: 'var(--success)',
                        borderColor: 'var(--success)',
                        backgroundColor: 'var(--success-muted)',
                      }
                    : {
                        color: 'var(--danger)',
                        borderColor: 'var(--danger)',
                        backgroundColor: 'var(--surface-raised)',
                      }
                }
              >
                {t('blOverallResult', { result: qcSubmitted.overall_result })}
              </span>
              <p className="text-xs" style={S.sub}>
                {t('blDispositionLabel', {
                  disposition: qcSubmitted.disposition,
                })}
              </p>
              <div
                className="w-full overflow-x-auto rounded-[var(--radius-sm)] border"
                style={S.surface}
              >
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader>
                    <tr className="border-b border-(--row-border)">
                      <TableHead className="h-auto px-3 py-2">
                        {t('blColParameter')}
                      </TableHead>
                      <TableHead className="h-auto px-3 py-2">
                        {t('blColValue')}
                      </TableHead>
                      <TableHead className="h-auto px-3 py-2">
                        {t('blColResult')}
                      </TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {(qcSubmitted.results || []).map((r: Row) => {
                      const param = qcParameters.find(
                        (p) => p.param_id === r.param_id,
                      );
                      return (
                        <TableRow key={r.result_id}>
                          <TableCell className="px-3 py-2" style={S.primary}>
                            {param?.param_name || r.param_id}
                          </TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>
                            {r.actual_value}
                            {r.grade_assigned ? ` (${r.grade_assigned})` : ''}
                          </TableCell>
                          <TableCell
                            className="px-3 py-2 font-semibold"
                            style={
                              r.result_status === 'PASS'
                                ? { color: 'var(--success)' }
                                : { color: 'var(--danger)' }
                            }
                          >
                            {r.result_status}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelQcDate')}
                  </label>
                  <input
                    type="date"
                    value={qcForm.qc_date}
                    onChange={(e) =>
                      setQcForm((f: Row) => ({ ...f, qc_date: e.target.value }))
                    }
                    className={inputCls}
                    style={S.input}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelTotalQtyReceived')}
                  </label>
                  <input
                    type="number"
                    value={qcForm.total_qty_received}
                    onChange={(e) =>
                      setQcForm((f: Row) => ({
                        ...f,
                        total_qty_received: e.target.value,
                      }))
                    }
                    className={inputCls}
                    style={S.input}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelDisposition')}
                  </label>
                  <SearchableSelect
                    ariaLabel={t('blLabelDisposition')}
                    value={qcForm.disposition}
                    onChange={(val) =>
                      setQcForm((f: Row) => ({
                        ...f,
                        disposition: val,
                      }))
                    }
                    options={[
                      'ACCEPT',
                      'REJECT',
                      'REWORK',
                      'QUARANTINE',
                      'CONDITIONAL_ACCEPT',
                    ].map((d) => ({
                      value: d,
                      label: d,
                    }))}
                    placeholder={t('blLabelDisposition')}
                    searchPlaceholder="Search disposition…"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelPassQty')}
                  </label>
                  <input
                    type="number"
                    value={qcForm.pass_qty}
                    onChange={(e) =>
                      setQcForm((f: Row) => ({
                        ...f,
                        pass_qty: e.target.value,
                      }))
                    }
                    className={inputCls}
                    style={S.input}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelFailQty')}
                  </label>
                  <input
                    type="number"
                    value={qcForm.fail_qty}
                    onChange={(e) =>
                      setQcForm((f: Row) => ({
                        ...f,
                        fail_qty: e.target.value,
                      }))
                    }
                    className={inputCls}
                    style={S.input}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    {t('blLabelHoldQty')}
                  </label>
                  <input
                    type="number"
                    value={qcForm.hold_qty}
                    onChange={(e) =>
                      setQcForm((f: Row) => ({
                        ...f,
                        hold_qty: e.target.value,
                      }))
                    }
                    className={inputCls}
                    style={S.input}
                  />
                </div>
              </div>

              <div>
                <p
                  className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                  style={S.sub}
                >
                  {t('blParameterResultsTitle')}
                </p>
                {qcParameters.length === 0 ? (
                  <p
                    className="rounded-[var(--radius-sm)] border p-3 text-xs"
                    style={{ ...S.surface, ...S.sub }}
                  >
                    {t('blNoQcParams')}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {qcParameters.map((p) => (
                      <div
                        key={p.param_id}
                        className="grid grid-cols-3 items-center gap-2 rounded-[var(--radius-sm)] border p-2.5"
                        style={S.surface}
                      >
                        <div>
                          <p
                            className="text-xs font-semibold"
                            style={S.primary}
                          >
                            {p.param_name}
                            {p.is_mandatory && (
                              <span className="text-(--danger)"> *</span>
                            )}
                          </p>
                          <p className="text-[10px]" style={S.muted}>
                            {p.param_type === 'NUMERIC'
                              ? `${p.min_value ?? '—'}–${p.max_value ?? '—'} ${p.uom || ''}`
                              : p.param_type}
                          </p>
                        </div>
                        <div className="col-span-2">
                          {p.param_type === 'NUMERIC' && (
                            <input
                              type="number"
                              placeholder={t('blPlaceholderActualValue')}
                              value={
                                qcResultValues[p.param_id]?.actual_value ?? ''
                              }
                              onChange={(e) =>
                                setQcResultField(
                                  p.param_id,
                                  'actual_value',
                                  e.target.value,
                                )
                              }
                              className={inputCls}
                              style={S.input}
                            />
                          )}
                          {p.param_type === 'BOOLEAN' && (
                            <SearchableSelect
                              ariaLabel={p.param_name || t('blSelectEllipsis')}
                              value={
                                qcResultValues[p.param_id]?.actual_value ?? ''
                              }
                              onChange={(val) =>
                                setQcResultField(
                                  p.param_id,
                                  'actual_value',
                                  val,
                                )
                              }
                              options={[
                                { value: 'true', label: t('blPassTrue') },
                                { value: 'false', label: t('blFailFalse') },
                              ]}
                              placeholder={t('blSelectEllipsis')}
                              searchPlaceholder="Search result…"
                            />
                          )}
                          {p.param_type === 'GRADE' && (
                            <SearchableSelect
                              ariaLabel={p.param_name || t('blSelectGrade')}
                              value={
                                qcResultValues[p.param_id]?.actual_value ?? ''
                              }
                              onChange={(val) => {
                                setQcResultField(
                                  p.param_id,
                                  'actual_value',
                                  val,
                                );
                                setQcResultField(
                                  p.param_id,
                                  'grade_assigned',
                                  val,
                                );
                              }}
                              options={Object.keys(p.grade_scale || {}).map((g) => ({
                                value: g,
                                label: `${g} — ${p.grade_scale[g]}`,
                              }))}
                              placeholder={t('blSelectGrade')}
                              searchPlaceholder="Search grade…"
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelNotes')}
                </label>
                <input
                  value={qcForm.qc_notes}
                  onChange={(e) =>
                    setQcForm((f: Row) => ({ ...f, qc_notes: e.target.value }))
                  }
                  className={inputCls}
                  style={S.input}
                />
              </div>
            </>
          )}
        </div>
      </Dialog>

      {/* Generate Pack modal */}
      <Dialog
        open={packModalOpen}
        onClose={() => !packSaving && setPackModalOpen(false)}
        title={
          packLine
            ? t('blGeneratePackTitleFull', {
                item: itemLabel(packLine.item_id),
              })
            : t('blGeneratePack')
        }
        footer={
          generatedPack ? (
            <Button variant="outline" size="sm" onClick={generateAnotherPack}>
              {t('blGenerateAnotherPack')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleGeneratePack}
              disabled={packSaving || packQcGateBlocked}
              title={packQcGateBlocked ? t('blPackQcGateTooltip') : undefined}
              className="nf-btn-primary"
            >
              {packSaving ? t('blGenerating') : t('blGeneratePack')}
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {packError && <InlineAlert>{packError}</InlineAlert>}

          {!generatedPack && packQcRequired && (
            <InlineAlert variant="warning">
              {t('blPackQcRequiredWarning')}
            </InlineAlert>
          )}

          {generatedPack ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-sm font-semibold" style={S.primary}>
                {generatedPack.pack_no}
              </p>
              <div className="rounded-[var(--radius-sm)] bg-white p-4">
                <QRCode
                  value={JSON.stringify(generatedPack.qr_data)}
                  size={200}
                />
              </div>
              <p className="text-xs" style={S.sub}>
                {generatedPack.net_weight} {generatedPack.pack_uom} —{' '}
                {generatedPack.production_date}
                {generatedPack.expiry_date
                  ? ` → ${generatedPack.expiry_date}`
                  : ''}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelNetWeight')}{' '}
                  <span className="text-(--danger)">*</span>
                </label>
                <input
                  type="number"
                  value={packForm.net_weight}
                  onChange={(e) =>
                    setPackForm((f: Row) => ({
                      ...f,
                      net_weight: e.target.value,
                    }))
                  }
                  className={inputCls}
                  style={S.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelGrossWeight')}
                </label>
                <input
                  type="number"
                  value={packForm.gross_weight}
                  onChange={(e) =>
                    setPackForm((f: Row) => ({
                      ...f,
                      gross_weight: e.target.value,
                    }))
                  }
                  className={inputCls}
                  style={S.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelPackUom')}{' '}
                  <span className="text-(--danger)">*</span>
                </label>
                <SearchableSelect
                  ariaLabel={t('blLabelPackUom')}
                  value={packForm.pack_uom}
                  onChange={(val) =>
                    setPackForm((f: Row) => ({
                      ...f,
                      pack_uom: val,
                    }))
                  }
                  options={uoms.map((u) => ({
                    value: u.uom_code,
                    label: u.uom_code,
                  }))}
                  placeholder={t('blSelectEllipsis')}
                  searchPlaceholder="Search UOM…"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelLotNo')}
                </label>
                <input
                  value={packForm.lot_no}
                  onChange={(e) =>
                    setPackForm((f: Row) => ({ ...f, lot_no: e.target.value }))
                  }
                  className={inputCls}
                  style={S.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelWarehouseFacility')}
                </label>
                <SearchableSelect
                  ariaLabel={t('blLabelWarehouseFacility')}
                  value={packForm.warehouse_id}
                  onChange={(val) =>
                    setPackForm((f: Row) => ({
                      ...f,
                      warehouse_id: val,
                    }))
                  }
                  options={warehouses.map((w) => ({
                    value: w.warehouse_id,
                    label: w.warehouse_code,
                  }))}
                  placeholder={t('blSelectEllipsis')}
                  searchPlaceholder="Search warehouse…"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  {t('blLabelLinkQcRecord')}
                  {packQcRequired
                    ? t('blQcRequiredSuffix')
                    : t('blQcOptionalSuffix')}
                </label>
                <SearchableSelect
                  ariaLabel={t('blLabelLinkQcRecord')}
                  value={packForm.qc_id}
                  onChange={(val) =>
                    setPackForm((f: Row) => ({ ...f, qc_id: val }))
                  }
                  options={packQcRecords.map((q) => ({
                    value: q.qc_id,
                    label: `${q.qc_date} — ${q.overall_result}`,
                  }))}
                  placeholder={t('blNone')}
                  searchPlaceholder="Search QC record…"
                  onClear={packForm.qc_id ? () => setPackForm((f: Row) => ({ ...f, qc_id: '' })) : undefined}
                />
              </div>
            </div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={!!mergeTarget}
        onClose={() => setMergeTarget(null)}
        title={`Merge ${mergeTarget?.batch_no ?? ''} back`}
        maxWidth="sm"
        footer={
          <Button
            size="sm"
            className="nf-btn-primary"
            onClick={confirmMerge}
            disabled={mergeBusy}
          >
            {mergeBusy ? 'Merging…' : 'Merge back'}
          </Button>
        }
      >
        <div className="space-y-2 text-xs">
          {mergeError && <p className="text-[var(--danger)]">{mergeError}</p>}
          <p style={S.sub}>
            Every live animal in this group returns to the batch it was split
            from, and this batch closes. Each animal keeps its own stage history
            — rejoining never rewrites where an animal has been.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
