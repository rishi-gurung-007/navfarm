'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Save,
  Plus,
  CheckCircle2,
  Scale,
  RefreshCw,
  AlertTriangle,
  Trash2,
  Camera,
  FileText,
  Layers,
  Lock,
  ClipboardList,
  Loader2,
  Wheat,
  Syringe,
  HeartCrack,
  ArrowLeftRight,
  PackageCheck,
  Building2,
  Users,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import PiggeryLifecycleStepper, {
  type PiggeryStage,
} from '../piggery/piggery-lifecycle-stepper';
import { buildLifecycleStages } from '../piggery/build-lifecycle-stages';
import {
  resolvePiggeryStageId,
  computeStageDay,
} from '../piggery/resolve-piggery-stage';
import { api } from '@/services/api-client';
import { API_ORIGIN } from '@/lib/api-client';
import { getActiveCompanyId } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InlineAlert } from '@/components/ui/alert';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useLanguage } from '@/hooks/useLanguage';
import AnimalStageTransitionModal from '@/components/console/piggery/animal-stage-transition-modal';

// file_url from the API is server-relative (e.g. "/uploads/xyz.jpg"). Next.js
// proxies that same-origin path to the API alongside /api/v1.

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

// A row's own presence in batch_daily_data IS its saved draft value — see
// BatchDailyDataService.postEntry()'s `draft` guard. Every save from this
// screen sends draft:true; only the explicit Post action (per-stage for
// ANIMAL_WISE, per-day for BATCH_WISE) re-dispatches those rows for real
// (inventory/GL/animal-count) right before locking.
const entryKey = (lineId: string, animalId?: string) =>
  animalId ? `${animalId}:${lineId}` : lineId;
const isTextCapture = (line: Row) =>
  line.line_type === 'DESCRIPTIVE' &&
  !!line.kpi_uom &&
  line.kpi_uom.includes('/');
// A number the user already saved always wins. Otherwise the Actual field
// starts at the scheduled Expected quantity rather than blank, so the common
// case (the animal ate/received the standard dose) is a single click of
// Save instead of re-typing a number that's already shown one column over.
// Text-capture lines have no numeric "expected" to seed a text box with.
const defaultEntryValue = (line: Row) => {
  if (line.already_entered_qty) return String(line.already_entered_qty);
  if (!isTextCapture(line) && line.expected_qty != null)
    return String(line.expected_qty);
  return '';
};

interface BatchAttachment {
  attachment_id: string;
  file_name: string;
  file_url: string;
  mime_type: string | null;
  attachment_type: string;
  created_at: string;
}

interface BatchMeta {
  id: string;
  /** Set when this batch was split out of another — a group held back while
      the rest of the cohort moved on. Entry is per batch, and a split group
      genuinely eats a different ration, so it is picked here like any other. */
  parentBatchId?: string | null;
  code: string;
  name: string;
  breed: string;
  type: string;
  startDate: string;
  currentStage: string;
  currentStageCode: string | null;
  currentStageId: number;
  stageDay: number;
  stageTotalDays: number;
  stageDates: string;
  assignedCount: number;
  currentCount: number;
  mortalityCount: number;
  transferredCount: number;
  lobId: string | null;
  /** BATCH_WISE (default) or ANIMAL_WISE — ANIMAL_WISE batches have no single
      current stage (animals can sit at different stages at once), so the
      entry screen below groups by stage instead of showing one flat table. */
  trackingMode: string;
}

// No static batch data — all data is fetched live from the database.

export default function OperationalBatchDataEntry() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  // ── Live data state ──
  const [batches, setBatches] = useState<BatchMeta[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState('');
  const [dataEntryLoading, setDataEntryLoading] = useState(false);
  const [dataEntryError, setDataEntryError] = useState('');
  const [noScheduler, setNoScheduler] = useState(false);

  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  // True once the user has deliberately picked a date via the picker (as
  // opposed to it moving because we auto-skipped a locked default). Reset
  // whenever the batch changes, so re-selecting a batch re-defaults to "the
  // first open day" instead of wherever the picker was left.
  const userPickedDateRef = React.useRef(false);
  // Floor for the date picker: the day after the most recent locked date
  // we've actually observed this session.
  const [minSelectableDate, setMinSelectableDate] = useState<string | null>(
    null,
  );

  // Real lifecycle for the selected batch, built from stage_master + this
  // batch's stage_log — BATCH_WISE only (ANIMAL_WISE has no single stage).
  const [lifecycle, setLifecycle] = useState<{
    stages: PiggeryStage[];
    currentStageId: number;
  }>({ stages: [], currentStageId: 0 });

  const currentBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) || batches[0],
    [batches, selectedBatchId],
  );

  // ── Scheduler-driven entry state — every activity comes from GET
  // /batch/:id/data-entry (the scheduler's due lines for this date), never
  // hardcoded or hand-typed. BATCH_WISE gets a flat due-lines list;
  // ANIMAL_WISE gets one section per stage its live animals are actually in. ──
  const [dataEntryLines, setDataEntryLines] = useState<Row[]>([]);
  const [dataEntryStages, setDataEntryStages] = useState<Row[]>([]);
  // Every stage in this batch's own LOB pipeline (not just the ones with
  // animals right now), each carrying its own live headcount — drives the
  // stage-tab strip for ANIMAL_WISE, separate from dataEntryStages (which
  // only holds stages that currently have animals in them).
  const [dataEntryProgress, setDataEntryProgress] = useState<Row[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  // "ALL" enters one value that broadcasts to every animal currently in the
  // selected stage; any other value is that one animal's own animal_id — the
  // same table either way, just scoped to one row (broadcast) or many.
  const [entryScope, setEntryScope] = useState<string>('ALL');
  const [dataEntryValues, setDataEntryValues] = useState<
    Record<string, string>
  >({});
  const [dataEntryTexts, setDataEntryTexts] = useState<Record<string, string>>(
    {},
  );
  const [dataEntryLotNos, setDataEntryLotNos] = useState<
    Record<string, string>
  >({});
  const [dataEntryDestBatches, setDataEntryDestBatches] = useState<
    Record<string, string>
  >({});
  const [dataEntrySavingId, setDataEntrySavingId] = useState<string | null>(
    null,
  );
  const [stageActionBusy, setStageActionBusy] = useState(false);
  const [stageActionError, setStageActionError] = useState('');
  const [reopenBoxOpen, setReopenBoxOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  // BATCH_WISE "Post Entry" lock, sourced from GET /batch/:id/data-entry's
  // lock_status/locked_by/locked_at (batch_data_entry_lock, shared with the
  // ANIMAL_WISE per-stage lock). Posting is final for BATCH_WISE — no reopen
  // here, matching BatchService.postBatchDay()'s own comment.
  const [posting, setPosting] = useState(false);
  const [lockInfo, setLockInfo] = useState<{
    status: string | null;
    lockedBy?: string | null;
    lockedAt?: string | null;
  }>({ status: null });
  const locked = lockInfo.status === 'LOCKED';

  // ── Weight/BCS and general-notes quick capture — OBSERVATION transactions,
  // confirmed to never touch inventory_ledger/GL, so they post immediately
  // rather than going through the draft/post cycle the scheduled table uses. ──
  const [avgWeight, setAvgWeight] = useState(0);
  const [weightGain, setWeightGain] = useState(0);
  const [bcsScore, setBcsScore] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [savingWeight, setSavingWeight] = useState(false);
  const [generalNotes, setGeneralNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const [postedDates, setPostedDates] = useState<Row[]>([]);

  // Which activity-type boxes (Feed, Medicine, Mortality, …) are collapsed —
  // keyed by bucket key, not scoped per animal/date, so a stage with a lot
  // of activity types stays collapsed the way the user left it while they
  // move between animals or dates.
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(
    new Set(),
  );
  const toggleBucketCollapsed = (key: string) =>
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [attachments, setAttachments] = useState<BatchAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [newAttachmentType, setNewAttachmentType] = useState('IMAGE');

  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [saveErrorMsg, setSaveErrorMsg] = useState('');

  // Top-level tab: Data Entry (the day-by-day screen) vs. a read-only
  // Overview summarizing the batch itself, independent of any one day.
  const [activeTab, setActiveTab] = useState<'entry' | 'overview'>('entry');

  // ── Master data used by the animal-list popup and the stage-change modals ──
  const [breeds, setBreeds] = useState<Row[]>([]);
  const [stageMasterList, setStageMasterList] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [batchAnimalRoster, setBatchAnimalRoster] = useState<Row[]>([]);
  const [batchAnimalRosterLoading, setBatchAnimalRosterLoading] =
    useState(false);

  // Animal-count popup: which stage's roster is currently shown, separate
  // from selectedStageId (clicking the pill still just selects the stage for
  // data entry — this is the count badge's own click target).
  const [animalListStageId, setAnimalListStageId] = useState<string | null>(
    null,
  );

  // Per-animal manual stage change (ANIMAL_WISE) — reuses the same modal the
  // Animal Register screen already uses.
  const [stageTransitionAnimal, setStageTransitionAnimal] =
    useState<Row | null>(null);

  // Bulk manual stage change for every animal currently in the selected
  // stage (ANIMAL_WISE, "All animals" entry scope) — same
  // POST /animal/bulk-transition-stage the Batch Animals screen's own
  // multi-select "Move" action uses, since there's no per-animal picker to
  // fill in here (the whole stage's roster is already the selection).
  const [bulkStageTransitionOpen, setBulkStageTransitionOpen] = useState(false);
  const [bulkStageTransitionForm, setBulkStageTransitionForm] = useState<{
    to_stage_id: string;
    to_location_id: string;
    reason: string;
  }>({ to_stage_id: '', to_location_id: '', reason: '' });
  const [bulkStageTransitionSaving, setBulkStageTransitionSaving] =
    useState(false);
  const [bulkStageTransitionError, setBulkStageTransitionError] = useState('');

  // Whole-batch manual stage change (BATCH_WISE) — mirrors batch-panel.tsx's
  // own Transfer Stage action, surfaced here too so it's reachable without
  // leaving the data-entry page.
  const [changeStageOpen, setChangeStageOpen] = useState(false);
  const [changeStageForm, setChangeStageForm] = useState<{
    to_stage_code: string;
    remarks: string;
  }>({ to_stage_code: '', remarks: '' });
  const [changeStageOptions, setChangeStageOptions] = useState<string[]>([]);
  const [changeStageOptionsLoading, setChangeStageOptionsLoading] =
    useState(false);
  const [changeStageSaving, setChangeStageSaving] = useState(false);
  const [changeStageError, setChangeStageError] = useState('');

  const breedLabel = (breedId: string | null) => {
    if (!breedId) return null;
    const b = breeds.find((x) => x.breed_id === breedId);
    return b ? b.breed_name || b.breed_code : null;
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

  const LINE_TYPE_LABELS: Record<string, string> = {
    CONSUMPTION: 'Consumption',
    OUTPUT: 'Output',
    OVERHEAD: 'Overhead',
    RESOURCE: 'Labour',
    DESCRIPTIVE: 'Descriptive',
    TRANSFER: 'Transfer',
  };
  // What the table below is actually asking for, not which stage it's in —
  // the stage is already shown by the selected circle in the stepper above,
  // so repeating "FLUSH — Flush" here just restated that for no reason.
  const stageActivityLabel = (stage: Row) => {
    const lines: Row[] = (stage.animals || [])[0]?.lines || [];
    const types = [...new Set(lines.map((l: Row) => l.line_type))];
    if (types.length === 0) return 'Scheduled Activity';
    if (types.length === 1)
      return `${LINE_TYPE_LABELS[types[0]] || types[0]} Activity`;
    return `${types.map((tp) => LINE_TYPE_LABELS[tp] || tp).join(' & ')} Activities`;
  };

  // Splits a stage's scheduled lines into the same activity-shaped cards
  // batch-wise's manual entry form already uses (Feed, Medicine, Mortality,
  // …) instead of one flat table repeating "CONSUMPTION" down a column —
  // Feed vs Medicine (both CONSUMPTION) is read off the item's own
  // item_type; Weight vs Mortality vs everything else (all DESCRIPTIVE) off
  // kpi_metric. Order matches the reference layout's own numbering.
  type ActivityBucketKey =
    | 'FEED'
    | 'MEDICINE'
    | 'WEIGHT'
    | 'MORTALITY'
    | 'TRANSFER'
    | 'OUTPUT'
    | 'RESOURCE'
    | 'OVERHEAD'
    | 'OBSERVATION';
  const ACTIVITY_BUCKETS: Record<
    ActivityBucketKey,
    { title: string; icon: typeof Wheat; color: string }
  > = {
    FEED: { title: 'Feed Consumption', icon: Wheat, color: '#16a34a' },
    MEDICINE: {
      title: 'Medicine / Vaccine Consumption',
      icon: Syringe,
      color: '#2563eb',
    },
    WEIGHT: { title: 'Weight & Body Condition', icon: Scale, color: '#7c3aed' },
    MORTALITY: { title: 'Mortality', icon: HeartCrack, color: '#dc2626' },
    TRANSFER: {
      title: 'Transfer In / Out',
      icon: ArrowLeftRight,
      color: '#ea580c',
    },
    OUTPUT: { title: 'Output', icon: PackageCheck, color: '#0d9488' },
    RESOURCE: { title: 'Labour / Resource', icon: Users, color: '#4f46e5' },
    OVERHEAD: { title: 'Overheads', icon: Building2, color: '#b45309' },
    OBSERVATION: {
      title: 'Observations',
      icon: ClipboardList,
      color: '#475569',
    },
  };
  const ACTIVITY_BUCKET_ORDER: ActivityBucketKey[] = [
    'FEED',
    'MEDICINE',
    'WEIGHT',
    'MORTALITY',
    'TRANSFER',
    'OUTPUT',
    'RESOURCE',
    'OVERHEAD',
    'OBSERVATION',
  ];
  const bucketOfLine = (line: Row): ActivityBucketKey => {
    if (line.line_type === 'CONSUMPTION')
      return line.item_type === 'MEDICINE' ? 'MEDICINE' : 'FEED';
    if (line.line_type === 'DESCRIPTIVE') {
      if (line.kpi_metric === 'BODY_WEIGHT' || line.kpi_metric === 'BCS_SCORE')
        return 'WEIGHT';
      if (line.kpi_metric === 'MORTALITY_COUNT') return 'MORTALITY';
      return 'OBSERVATION';
    }
    if (line.line_type === 'OUTPUT') return 'OUTPUT';
    if (line.line_type === 'OVERHEAD') return 'OVERHEAD';
    if (line.line_type === 'RESOURCE') return 'RESOURCE';
    if (line.line_type === 'TRANSFER') return 'TRANSFER';
    return 'OBSERVATION';
  };
  const groupLinesByBucket = (lines: Row[]) => {
    const groups = new Map<ActivityBucketKey, Row[]>();
    for (const line of lines) {
      const key = bucketOfLine(line);
      const group = groups.get(key) || [];
      group.push(line);
      groups.set(key, group);
    }
    return ACTIVITY_BUCKET_ORDER.filter((key) => groups.has(key)).map(
      (key) => ({ key, ...ACTIVITY_BUCKETS[key], lines: groups.get(key)! }),
    );
  };

  // Helper to map a batch to a specific lifecycle stage (BATCH_WISE only)
  const resolvePiggeryStage = (b: any) => {
    const resolved = resolvePiggeryStageId(
      b.current_stage_code || b.stage_code || b.stage_name,
    );
    const log: any[] = Array.isArray(b.stage_log) ? b.stage_log : [];
    const enteredCurrentStage = log
      .filter((l) => l.to_stage_code === (b.current_stage_code || ''))
      .map((l) => String(l.transferred_at || ''))
      .sort()
      .pop();
    return {
      id: resolved.id,
      name: resolved.name,
      day: computeStageDay(
        enteredCurrentStage || b.start_date,
        resolved.standardDays,
      ),
      totalDays: resolved.standardDays,
    };
  };

  // ── Step 1: Fetch active batch list from DB ──
  useEffect(() => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setBatchesLoading(false);
      setBatchesError(
        'No active company — please select a company workspace first.',
      );
      return;
    }
    setBatchesLoading(true);
    setBatchesError('');
    api
      .get(`/batch?companyId=${companyId}&status=ACTIVE&limit=50`)
      .then(async (res) => {
        let list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        if (list.length === 0) {
          const fallbackRes = await api
            .get(`/batch?companyId=${companyId}&limit=50`)
            .catch(() => []);
          list = Array.isArray(fallbackRes)
            ? fallbackRes
            : (fallbackRes?.data ?? []);
        }
        // /batch returns breed_id but not breed_name, so resolve it here.
        const breedRes = await api
          .get(`/breed?companyId=${companyId}&limit=500`)
          .catch(() => []);
        const breedList: any[] = Array.isArray(breedRes)
          ? breedRes
          : (breedRes?.data ?? []);
        setBreeds(breedList);
        const breedNameById = new Map<string, string>(
          breedList.map((br: any) => [br.breed_id, br.breed_name]),
        );
        const mapped: BatchMeta[] = list.map((b: any) => {
          const st = resolvePiggeryStage(b);
          return {
            id: b.batch_id,
            parentBatchId: b.parent_batch_id ?? null,
            code: b.batch_no,
            name: b.remarks || b.batch_no,
            breed:
              b.breed_name ||
              breedNameById.get(b.breed_id) ||
              b.breed_code ||
              '—',
            type: b.lob_name || b.nob_name || 'Piggery Production Batch',
            startDate: b.start_date || '',
            currentStage: st.name,
            currentStageCode: b.current_stage_code ?? null,
            currentStageId: st.id,
            stageDay: st.day,
            stageTotalDays: st.totalDays,
            stageDates: b.start_date
              ? `${b.start_date} – ${b.expected_end_date || 'ongoing'}`
              : '',
            assignedCount: Number(b.opening_quantity) || 80,
            currentCount:
              Number(b.closing_quantity ?? b.opening_quantity ?? 0) || 0,
            mortalityCount: 0,
            transferredCount: 0,
            lobId: b.lob_id ?? null,
            trackingMode: b.tracking_mode || 'BATCH_WISE',
          };
        });
        setBatches(mapped);
        if (mapped.length > 0) {
          // A deep link from Batches → Data Entry ("Batches → Data Entry"
          // single-page path) pre-selects that specific batch when present
          // and still in this ACTIVE list.
          const linkedId = searchParams.get('batchId');
          const preselect =
            linkedId && mapped.some((b) => b.id === linkedId)
              ? linkedId
              : mapped[0].id;
          setSelectedBatchId(preselect);
        }
        setBatchesLoading(false);
      })
      .catch((err) => {
        setBatchesLoading(false);
        setBatchesError(
          `Failed to load batches: ${err?.message || 'API unavailable'}`,
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 2: Fetch scheduled entry lines (or stage groups) + batch/stage
  // master data for the selected batch + date ──
  const loadDataEntry = () => {
    if (!selectedBatchId) return;
    setDataEntryLoading(true);
    setNoScheduler(false);
    setDataEntryError('');

    Promise.all([
      api
        .get(`/batch/${selectedBatchId}/data-entry?date=${selectedDate}`)
        .catch(() => ({ lines: [] })),
      api.get(`/batch/${selectedBatchId}`).catch(() => null),
      api.get(`/stage`).catch(() => []),
      api
        .get(`/location?companyId=${getActiveCompanyId()}&limit=200`)
        .catch(() => []),
    ])
      .then(([schedRes, batchRes, stageRes, locationRes]) => {
        const schedData = schedRes?.data ?? schedRes;
        const batchData = batchRes?.data ?? batchRes;
        const isAnimalWise =
          batchData?.tracking_mode === 'ANIMAL_WISE' ||
          Array.isArray(schedData?.stages);

        const stageMaster: any[] = (stageRes as any)?.data ?? stageRes ?? [];
        setStageMasterList(Array.isArray(stageMaster) ? stageMaster : []);
        setLocations(unwrap<Row[]>(locationRes) || []);

        const values: Record<string, string> = {};

        if (isAnimalWise) {
          const stages: Row[] = schedData?.stages || [];
          const progress: Row[] = schedData?.progress || [];
          setDataEntryStages(stages);
          setDataEntryProgress(progress);
          setDataEntryLines([]);
          setNoScheduler(false);
          setLockInfo({ status: null }); // meaningless for ANIMAL_WISE — locking is per-stage below

          for (const stage of stages) {
            (stage.animals || []).forEach((animal: Row, animalIdx: number) => {
              for (const line of animal.lines || []) {
                const enteredStr = defaultEntryValue(line);
                values[entryKey(line.line_id, animal.animal_id)] = enteredStr;
                // The "All animals in this stage" broadcast view has no real
                // animal of its own to read an already-entered value from —
                // without this, a value saved via broadcast reappeared blank
                // the moment the page reloaded, even though it was saved for
                // every animal. The first animal in the stage stands in as
                // the template both here and in the broadcast row renderer.
                if (animalIdx === 0)
                  values[entryKey(line.line_id, '__ALL__')] = enteredStr;
              }
            });
          }

          // Prefer keeping the current selection if it still has animals AND
          // is not yet locked; otherwise auto-advance to the next active
          // stage that still needs data — this is what makes "Post Stage
          // Data" jump straight to the next stage instead of sitting on the
          // one that was just posted. Falls back to any active stage (even a
          // locked one) so a fully-posted day still shows something.
          //
          // None of that applies once the user has picked a date on purpose
          // (native picker or the History dropdown) — they are browsing a
          // specific day, most likely because it's locked, and jumping them
          // to a different stage because THIS one is locked is exactly
          // backwards. Keep whatever stage they had selected; only fall back
          // if that stage genuinely isn't part of this date at all.
          setSelectedStageId((prev) => {
            const prevStage = prev
              ? stages.find((s) => s.stage_id === prev)
              : undefined;
            if (userPickedDateRef.current)
              return prevStage ? prev : stages[0]?.stage_id || null;
            if (prevStage && prevStage.lock_status !== 'LOCKED') return prev;
            const nextOpen = progress.find(
              (p: Row) =>
                p.animal_count > 0 &&
                stages.find((s) => s.stage_id === p.stage_id)?.lock_status !==
                  'LOCKED',
            );
            if (nextOpen) return nextOpen.stage_id;
            const anyActive = progress.find((p: Row) => p.animal_count > 0);
            return anyActive?.stage_id || null;
          });

          // Once every active stage for this date is LOCKED, the day is done
          // — move on to the next date automatically, same idea as the
          // BATCH_WISE auto-skip below.
          const activeStages = progress.filter((p: Row) => p.animal_count > 0);
          const allLocked =
            activeStages.length > 0 &&
            activeStages.every(
              (p: Row) =>
                stages.find((s) => s.stage_id === p.stage_id)?.lock_status ===
                'LOCKED',
            );
          if (allLocked && !userPickedDateRef.current) {
            const [ly, lm, ld] = selectedDate.split('-').map(Number);
            const dayAfter = new Date(Date.UTC(ly, lm - 1, ld + 1))
              .toISOString()
              .slice(0, 10);
            setSelectedDate(dayAfter);
            setDataEntryValues(values);
            setDataEntryLoading(false);
            return;
          }
        } else {
          const lines: any[] = schedData?.lines ?? [];
          setDataEntryLines(lines);
          setDataEntryStages([]);
          setDataEntryProgress([]);
          setNoScheduler(lines.length === 0);
          for (const l of lines)
            values[entryKey(l.line_id)] = defaultEntryValue(l);

          const dayStatus: string | null = schedData?.lock_status || null;
          setLockInfo({
            status: dayStatus,
            lockedBy: schedData?.locked_by || null,
            lockedAt: schedData?.locked_at || null,
          });

          if (dayStatus === 'LOCKED') {
            const [ly, lm, ld] = selectedDate.split('-').map(Number);
            const dayAfter = new Date(Date.UTC(ly, lm - 1, ld + 1))
              .toISOString()
              .slice(0, 10);
            setMinSelectableDate((prev) =>
              !prev || dayAfter > prev ? dayAfter : prev,
            );
            if (!userPickedDateRef.current) {
              setSelectedDate(dayAfter);
              setDataEntryValues(values);
              setDataEntryLoading(false);
              return;
            }
          }
        }

        setDataEntryValues(values);
        setDataEntryTexts({});
        setDataEntryLotNos({});
        setDataEntryDestBatches({});

        // Dynamically update the batch stage from latest database record
        if (batchData?.batch_id) {
          const st = resolvePiggeryStage(batchData);
          setBatches((prev) =>
            prev.map((b) =>
              b.id === batchData.batch_id
                ? {
                    ...b,
                    currentStage: st.name,
                    currentStageCode: batchData.current_stage_code ?? null,
                    currentStageId: st.id,
                    stageDay: st.day,
                    stageTotalDays: st.totalDays,
                    currentCount:
                      Number(
                        batchData.closing_quantity ??
                          batchData.opening_quantity ??
                          b.currentCount,
                      ) || b.currentCount,
                  }
                : b,
            ),
          );
        }

        if (batchData?.batch_id && Array.isArray(stageMaster)) {
          setLifecycle(
            buildLifecycleStages({
              stageMaster,
              stageLog: Array.isArray(batchData.stage_log)
                ? batchData.stage_log
                : [],
              batchStartDate: batchData.start_date,
              currentStageCode: batchData.current_stage_code ?? null,
            }),
          );
        }

        const txs: any[] = batchData?.transactions ?? [];
        const cumulativeMortality = txs
          .filter((tx: any) => tx.transaction_type === 'MORTALITY')
          .reduce((sum: number, tx: any) => sum + Number(tx.quantity || 0), 0);
        const stageMoves = Array.isArray(batchData?.stage_log)
          ? batchData.stage_log.length
          : 0;
        setBatches((prev) =>
          prev.map((bm) =>
            bm.id === selectedBatchId
              ? {
                  ...bm,
                  mortalityCount: cumulativeMortality,
                  transferredCount: stageMoves,
                }
              : bm,
          ),
        );

        // DESCRIPTIVE body-weight lines (BATCH_WISE) seed the weight quick-capture field.
        const weightLine = (schedData?.lines ?? []).find(
          (ln: any) =>
            ln.line_type === 'DESCRIPTIVE' && ln.kpi_metric === 'BODY_WEIGHT',
        );
        if (weightLine)
          setAvgWeight(
            weightLine.already_entered_qty > 0
              ? weightLine.already_entered_qty
              : 0,
          );

        setDataEntryLoading(false);
      })
      .catch(() => {
        setDataEntryLoading(false);
      });
  };

  useEffect(() => {
    loadDataEntry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId, selectedDate]);

  useEffect(() => {
    setReopenBoxOpen(false);
    setReopenReason('');
    setStageActionError('');
    setEntryScope('ALL');
  }, [selectedStageId]);

  // History dropdown: dates that already have a real posting on record,
  // scoped to the selected stage for ANIMAL_WISE (locks are per stage there)
  // and to the whole batch for BATCH_WISE (one stage at a time anyway).
  const loadPostedDates = () => {
    if (!selectedBatchId) return;
    const qs = selectedStageId ? `?stageId=${selectedStageId}` : '';
    api
      .get(`/batch/${selectedBatchId}/posted-dates${qs}`)
      .then((res: any) => setPostedDates(unwrap<Row[]>(res) || []))
      .catch(() => setPostedDates([]));
  };

  useEffect(() => {
    loadPostedDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId, selectedStageId]);

  const loadAttachments = () => {
    if (!selectedBatchId) return;
    api
      .get(`/batch/${selectedBatchId}/attachment?date=${selectedDate}`)
      .then((res: any) => setAttachments(res?.data ?? res ?? []))
      .catch(() => setAttachments([]));
  };

  useEffect(() => {
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId, selectedDate]);

  // Full animal roster for the current batch — backs the stage animal-count
  // popup and supplies the `animal` object AnimalStageTransitionModal needs.
  useEffect(() => {
    if (!currentBatch?.id) {
      setBatchAnimalRoster([]);
      return;
    }
    const companyId = getActiveCompanyId();
    setBatchAnimalRosterLoading(true);
    api
      .get(
        `/animal?companyId=${companyId}&currentBatchId=${currentBatch.id}&limit=500`,
      )
      .then((res) => {
        const list = unwrap<Row[]>(res) || [];
        setBatchAnimalRoster(
          list.map((a) => ({
            ...a,
            breed_name: a.breed_name || breedLabel(a.breed_id),
          })),
        );
      })
      .catch(() => setBatchAnimalRoster([]))
      .finally(() => setBatchAnimalRosterLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBatch?.id]);

  // Calculated Dynamic Metrics
  const batchMortality = currentBatch?.mortalityCount ?? 0;
  const currentHeadCount = currentBatch
    ? Math.max(0, currentBatch.currentCount - batchMortality)
    : 0;

  const dataEntryCanSave = (line: Row, animalId?: string) => {
    const key = entryKey(line.line_id, animalId);
    if (isTextCapture(line)) return !!dataEntryTexts[key];
    const rawValue = dataEntryValues[key];
    if (rawValue === undefined || rawValue === '') return false;
    if (line.lot_required && !dataEntryLotNos[key]) return false;
    if (line.line_type === 'TRANSFER' && !dataEntryDestBatches[key])
      return false;
    return true;
  };

  // Every save from this screen carries draft:true — the backend records the
  // value in batch_daily_data but does NOT touch inventory/GL/animal-count
  // until the explicit Post action re-dispatches it for real. This is the
  // fix for the bug that used to post to the ledger on every keystroke-save.
  const handleDataEntrySave = async (line: Row, animalId?: string) => {
    if (!currentBatch) return;
    if (!dataEntryCanSave(line, animalId)) return;
    const key = entryKey(line.line_id, animalId);
    setDataEntrySavingId(key);
    setDataEntryError('');
    try {
      const payload: Row = {
        line_id: line.line_id,
        entry_date: selectedDate,
        draft: true,
      };
      if (animalId) payload.animal_id = animalId;
      if (isTextCapture(line)) {
        payload.entered_text = dataEntryTexts[key];
      } else {
        payload.entered_value = Number(dataEntryValues[key]);
      }
      if (line.lot_required) payload.lot_no = dataEntryLotNos[key];
      if (line.line_type === 'TRANSFER')
        payload.destination_batch_id = dataEntryDestBatches[key];
      await api.post(`/batch/${currentBatch.id}/daily-data`, payload);
      loadDataEntry();
    } catch (err: any) {
      setDataEntryError(err?.message || t('blErrRecordEntry'));
    } finally {
      setDataEntrySavingId(null);
    }
  };

  // "All animals in this stage" mode — one entered value, posted as its own
  // draft row for every animal currently in the stage (each animal still
  // gets its own batch_daily_data row; this just saves typing it N times
  // when the whole cohort genuinely got the same treatment).
  const handleDataEntrySaveAllAnimals = async (line: Row) => {
    if (!currentBatch || !selectedStage) return;
    if (!dataEntryCanSave(line, '__ALL__')) return;
    const key = entryKey(line.line_id, '__ALL__');
    setDataEntrySavingId(key);
    setDataEntryError('');
    try {
      const animalIds = (selectedStage.animals || []).map(
        (a: Row) => a.animal_id,
      );
      await Promise.all(
        animalIds.map((animalId: string) => {
          const payload: Row = {
            line_id: line.line_id,
            entry_date: selectedDate,
            draft: true,
            animal_id: animalId,
          };
          if (isTextCapture(line)) {
            payload.entered_text = dataEntryTexts[key];
          } else {
            payload.entered_value = Number(dataEntryValues[key]);
          }
          if (line.lot_required) payload.lot_no = dataEntryLotNos[key];
          if (line.line_type === 'TRANSFER')
            payload.destination_batch_id = dataEntryDestBatches[key];
          return api.post(`/batch/${currentBatch.id}/daily-data`, payload);
        }),
      );
      loadDataEntry();
    } catch (err: any) {
      setDataEntryError(err?.message || t('blErrRecordEntry'));
    } finally {
      setDataEntrySavingId(null);
    }
  };

  const handlePostStageDay = async () => {
    if (!currentBatch || !selectedStageId) return;
    setStageActionBusy(true);
    setStageActionError('');
    try {
      await api.post(
        `/batch/${currentBatch.id}/stage/${selectedStageId}/post-day?date=${selectedDate}`,
        {},
      );
      loadDataEntry();
      loadPostedDates();
    } catch (err: any) {
      setStageActionError(err?.message || 'Could not post stage data.');
    } finally {
      setStageActionBusy(false);
    }
  };

  const handleReopenStageDay = async () => {
    if (!currentBatch || !selectedStageId || !reopenReason.trim()) return;
    setStageActionBusy(true);
    setStageActionError('');
    try {
      await api.post(
        `/batch/${currentBatch.id}/stage/${selectedStageId}/reopen?date=${selectedDate}`,
        { reason: reopenReason },
      );
      setReopenBoxOpen(false);
      setReopenReason('');
      loadDataEntry();
      loadPostedDates();
    } catch (err: any) {
      setStageActionError(err?.message || 'Could not reopen stage data.');
    } finally {
      setStageActionBusy(false);
    }
  };

  const handleBulkStageTransition = async (animalIds: string[]) => {
    if (!animalIds.length || !bulkStageTransitionForm.to_stage_id) return;
    setBulkStageTransitionSaving(true);
    setBulkStageTransitionError('');
    try {
      const res: any = await api.post('/animal/bulk-transition-stage', {
        animal_ids: animalIds,
        to_stage_id: bulkStageTransitionForm.to_stage_id,
        to_location_id: bulkStageTransitionForm.to_location_id || undefined,
        transition_date: selectedDate,
        reason: bulkStageTransitionForm.reason || undefined,
      });
      const failed = res?.failed || res?.data?.failed || [];
      if (failed.length) {
        setBulkStageTransitionError(
          `Moved ${animalIds.length - failed.length} of ${animalIds.length}. Could not move: ${failed.map((f: Row) => f.reason).join('; ')}`,
        );
      } else {
        setBulkStageTransitionOpen(false);
        setBulkStageTransitionForm({
          to_stage_id: '',
          to_location_id: '',
          reason: '',
        });
      }
      loadDataEntry();
      setBatchAnimalRoster((prev) => [...prev]);
    } catch (err: any) {
      setBulkStageTransitionError(
        err?.message || 'Could not move these animals.',
      );
    } finally {
      setBulkStageTransitionSaving(false);
    }
  };

  // "POST ENTRY" (BATCH_WISE) — every due line was already saved as a draft
  // via handleDataEntrySave above, so this just finalizes them for real and
  // locks the day (POST /batch/:id/post-day, refused unless every mandatory
  // scheduled activity has an entry — see BatchService.postBatchDay()). On
  // success, advances selectedDate to the next calendar day. Posting is
  // final on this path — no reopen action, matching the backend.
  const handlePostEntry = async () => {
    if (!currentBatch) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    if (selectedDate > todayStr) {
      const proceed = window.confirm(
        `${selectedDate} is a future date — today is ${todayStr}. Post & lock it anyway?`,
      );
      if (!proceed) return;
    }
    setPosting(true);
    setSaveErrorMsg('');
    try {
      await api.post(`/batch/${currentBatch.id}/post-day?date=${selectedDate}`);
      const [y, m, d] = selectedDate.split('-').map(Number);
      const nextDate = new Date(Date.UTC(y, m - 1, d + 1))
        .toISOString()
        .slice(0, 10);
      setSaveSuccessMsg(
        `✓ ${selectedDate} posted and locked for batch ${currentBatch.code}. Moved to ${nextDate} for the next entry.`,
      );
      setSelectedDate(nextDate);
      loadPostedDates();
      setTimeout(() => setSaveSuccessMsg(''), 5000);
    } catch (err: any) {
      const errMsg =
        err?.message || err?.error || 'Failed to post & lock the daily entry.';
      setSaveErrorMsg(
        typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
      );
    } finally {
      setPosting(false);
    }
  };

  // Weight/BCS and general-notes quick capture — plain OBSERVATION
  // transactions (no cost, no GL, no inventory ledger — see addTransaction()'s
  // own comment), so they post immediately rather than joining the
  // draft/post cycle above.
  const handleSaveWeightSample = async () => {
    if (!currentBatch || avgWeight <= 0) return;
    setSavingWeight(true);
    setSaveErrorMsg('');
    try {
      await api.post(`/batch/${currentBatch.id}/transaction`, {
        transaction_date: selectedDate,
        transaction_type: 'OBSERVATION',
        quantity: avgWeight,
        uom: 'KG',
        adg: weightGain || undefined,
        bcs_score: bcsScore ? Number(bcsScore) || undefined : undefined,
        remarks: `Weight Sample: ${avgWeight} kg (ADG: +${weightGain} kg/day, BCS: ${bcsScore || '3.0'})${weightNotes ? ` — ${weightNotes}` : ''}`,
      });
      setSaveSuccessMsg('✓ Weight sample recorded.');
      setTimeout(() => setSaveSuccessMsg(''), 3500);
    } catch (err: any) {
      setSaveErrorMsg(err?.message || 'Failed to record weight sample.');
    } finally {
      setSavingWeight(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!currentBatch || !generalNotes.trim()) return;
    setSavingNotes(true);
    setSaveErrorMsg('');
    try {
      await api.post(`/batch/${currentBatch.id}/transaction`, {
        transaction_date: selectedDate,
        transaction_type: 'OBSERVATION',
        quantity: 1,
        uom: 'LOG',
        remarks: `Daily Observation: ${generalNotes}`,
      });
      setSaveSuccessMsg('✓ Note recorded.');
      setGeneralNotes('');
      setTimeout(() => setSaveSuccessMsg(''), 3500);
    } catch (err: any) {
      setSaveErrorMsg(err?.message || 'Failed to record note.');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleAddAttachment = async () => {
    if (!uploadingFile || !currentBatch) return;
    setUploadError('');
    const formData = new FormData();
    formData.append('file', uploadingFile);
    formData.append('log_date', selectedDate);
    formData.append('attachment_type', newAttachmentType);
    try {
      await api.post(`/batch/${currentBatch.id}/attachment`, formData);
      setUploadModalOpen(false);
      setUploadingFile(null);
      loadAttachments();
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to upload attachment.');
    }
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (!currentBatch) return;
    await api
      .delete(`/batch/${currentBatch.id}/attachment/${attachmentId}`)
      .catch(() => void 0);
    loadAttachments();
  };

  // Whole-batch manual stage change (BATCH_WISE) — same endpoint and stage-
  // option source as batch-panel.tsx's own Transfer Stage action.
  const openChangeStage = async () => {
    if (!currentBatch) return;
    setChangeStageForm({ to_stage_code: '', remarks: '' });
    setChangeStageError('');
    setChangeStageOptions([]);
    setChangeStageOpen(true);
    if (!currentBatch.lobId) return;
    setChangeStageOptionsLoading(true);
    try {
      const stageRows =
        unwrap<Row[]>(
          await api.get(
            `/stage?lobId=${currentBatch.lobId}&isActive=true&limit=200`,
          ),
        ) || [];
      const codes = Array.from(
        new Set(
          stageRows
            .map((s: Row) => s.stage_code)
            .filter(
              (c: string | null) => !!c && c !== currentBatch.currentStageCode,
            ),
        ),
      ) as string[];
      setChangeStageOptions(codes.sort());
    } catch {
      setChangeStageOptions([]);
    } finally {
      setChangeStageOptionsLoading(false);
    }
  };

  const handleChangeStage = async () => {
    if (!currentBatch) return;
    setChangeStageSaving(true);
    setChangeStageError('');
    try {
      if (!changeStageForm.to_stage_code)
        throw new Error(t('blErrDestStageRequired'));
      await api.post(`/batch/${currentBatch.id}/transfer-stage`, {
        to_stage_code: changeStageForm.to_stage_code,
        remarks: changeStageForm.remarks || undefined,
      });
      setChangeStageOpen(false);
      loadDataEntry();
    } catch (err: any) {
      setChangeStageError(err?.message || t('blErrTransferStage'));
    } finally {
      setChangeStageSaving(false);
    }
  };

  if (batchesLoading) {
    return (
      <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3 text-[var(--accent)]" />
          <p className="text-sm font-medium text-[var(--text-muted)]">
            {t('bdeLoadingBatches')}
          </p>
        </div>
      </div>
    );
  }

  if (batchesError) {
    return (
      <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
        <div
          className="rounded-[var(--radius-lg)] border p-6 text-center"
          style={{
            backgroundColor: 'var(--danger-muted)',
            borderColor: 'rgba(194, 67, 50, 0.2)',
          }}
        >
          <AlertTriangle
            className="h-6 w-6 mx-auto mb-2"
            style={{ color: 'var(--danger)' }}
          />
          <p
            className="text-sm font-semibold"
            style={{ color: 'var(--danger)' }}
          >
            {batchesError}
          </p>
        </div>
      </div>
    );
  }

  // Per-box header — no Parameter/Activity Type column any more, since the
  // box's own title (Feed Consumption, Mortality, …) already says that.
  const dataEntryTableHeader = (
    <TableHeader>
      <tr className="border-b border-[var(--row-border)]">
        <TableHead className="h-auto px-3 py-2">
          {t('blColDataEntryType')}
        </TableHead>
        <TableHead className="h-auto px-3 py-2">{t('blColItem')}</TableHead>
        <TableHead className="h-auto px-3 py-2">{t('blColUom')}</TableHead>
        <TableHead className="h-auto px-3 py-2">
          {t('blColOccurrence')}
        </TableHead>
        <TableHead className="h-auto px-3 py-2">{t('blColExpected')}</TableHead>
        <TableHead className="h-auto px-3 py-2">{t('blColActual')}</TableHead>
        <TableHead className="h-auto px-3 py-2"></TableHead>
      </tr>
    </TableHeader>
  );

  const renderDataEntryRow = (
    line: Row,
    animalId?: string,
    rowLocked?: boolean,
    broadcast?: boolean,
  ) => {
    const key = entryKey(line.line_id, animalId);
    return (
      <TableRow key={key}>
        <TableCell className="px-3 py-2" style={S.primary}>
          {line.activity_name}
        </TableCell>
        <TableCell className="px-3 py-2" style={S.sub}>
          {line.item_label || '—'}
        </TableCell>
        <TableCell className="px-3 py-2" style={S.sub}>
          {line.uom || '—'}
        </TableCell>
        <TableCell className="px-3 py-2" style={S.sub}>
          {line.occurrence
            ? line.occurrence.charAt(0) + line.occurrence.slice(1).toLowerCase()
            : '—'}
        </TableCell>
        <TableCell className="px-3 py-2" style={S.primary}>
          {Number(line.expected_qty).toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })}
        </TableCell>
        <TableCell className="px-2 py-1.5 w-28">
          {isTextCapture(line) ? (
            <input
              type="text"
              value={dataEntryTexts[key] ?? ''}
              onChange={(e) =>
                setDataEntryTexts((v) => ({ ...v, [key]: e.target.value }))
              }
              placeholder={line.kpi_uom}
              className={inputCls}
              style={S.input}
              disabled={rowLocked}
            />
          ) : (
            <input
              type="number"
              value={dataEntryValues[key] ?? ''}
              onChange={(e) =>
                setDataEntryValues((v) => ({ ...v, [key]: e.target.value }))
              }
              className={inputCls}
              style={S.input}
              disabled={rowLocked}
            />
          )}
          {line.lot_required && (
            <input
              type="text"
              value={dataEntryLotNos[key] ?? ''}
              onChange={(e) =>
                setDataEntryLotNos((v) => ({ ...v, [key]: e.target.value }))
              }
              placeholder={t('blPlaceholderLotNo')}
              className={inputCls + ' mt-1'}
              style={S.input}
              disabled={rowLocked}
            />
          )}
          {line.line_type === 'TRANSFER' && (
            <select
              value={dataEntryDestBatches[key] ?? ''}
              onChange={(e) =>
                setDataEntryDestBatches((v) => ({
                  ...v,
                  [key]: e.target.value,
                }))
              }
              className={`${inputCls} nf-select mt-1`}
              style={S.input}
              disabled={rowLocked}
            >
              <option value="">{t('blPlaceholderDestBatch')}</option>
              {batches
                .filter((b) => b.id !== currentBatch?.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
            </select>
          )}
        </TableCell>
        <TableCell className="px-2 py-1.5">
          <button
            onClick={() =>
              broadcast
                ? handleDataEntrySaveAllAnimals(line)
                : handleDataEntrySave(line, animalId)
            }
            disabled={
              rowLocked ||
              dataEntrySavingId === key ||
              !dataEntryCanSave(line, animalId)
            }
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {dataEntrySavingId === key ? t('blSaving') : t('blSave')}
          </button>
        </TableCell>
      </TableRow>
    );
  };

  // A stage's scheduled lines, split into the activity-shaped cards — one
  // table per bucket instead of one flat table with the type repeated down
  // a column. A box gets a running "Total" footer only when every line in
  // it shares one uom and takes a number (not free text), so it never sums
  // across incompatible units.
  const renderActivityBoxes = (
    lines: Row[],
    animalId: string | undefined,
    rowLocked: boolean | undefined,
    broadcast?: boolean,
  ) => {
    const boxes = groupLinesByBucket(lines);
    if (!boxes.length)
      return (
        <p className="text-xs" style={S.muted}>
          {t('blNoParamsScheduled')}
        </p>
      );
    const allCollapsed = boxes.every((box) => collapsedBuckets.has(box.key));
    return (
      <div className="flex flex-col gap-3">
        {boxes.length > 1 && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() =>
                setCollapsedBuckets(
                  allCollapsed ? new Set() : new Set(boxes.map((b) => b.key)),
                )
              }
              className="text-[10px] font-semibold hover:underline"
              style={S.accent}
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          </div>
        )}
        {boxes.map((box) => {
          const Icon = box.icon;
          const collapsed = collapsedBuckets.has(box.key);
          const uoms = new Set(box.lines.map((l) => l.uom).filter(Boolean));
          const canTotal =
            uoms.size === 1 && box.lines.every((l) => !isTextCapture(l));
          const total = canTotal
            ? box.lines.reduce((sum, l) => {
                const v = Number(
                  dataEntryValues[entryKey(l.line_id, animalId)],
                );
                return sum + (Number.isFinite(v) ? v : 0);
              }, 0)
            : null;
          return (
            <div
              key={box.key}
              className="rounded-lg border overflow-hidden"
              style={S.surface}
            >
              <button
                type="button"
                onClick={() => toggleBucketCollapsed(box.key)}
                aria-expanded={!collapsed}
                className="flex w-full items-center gap-2 px-3 py-2 border-b text-left"
                style={{ borderColor: 'var(--border)' }}
              >
                {collapsed ? (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0"
                    style={S.muted}
                  />
                ) : (
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0"
                    style={S.muted}
                  />
                )}
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: box.color }}
                />
                <span
                  className="text-xs font-bold"
                  style={{ color: box.color }}
                >
                  {box.title}
                </span>
                <span className="text-[10px] font-semibold" style={S.muted}>
                  ({box.lines.length})
                </span>
              </button>
              {!collapsed && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      {dataEntryTableHeader}
                      <TableBody>
                        {box.lines.map((line) =>
                          renderDataEntryRow(
                            line,
                            animalId,
                            rowLocked,
                            broadcast,
                          ),
                        )}
                      </TableBody>
                    </table>
                  </div>
                  {total != null && (
                    <div
                      className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-t text-[11px]"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <span style={S.muted}>Total:</span>
                      <span className="font-bold" style={S.primary}>
                        {total.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}{' '}
                        {[...uoms][0]}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const isAnimalWise = currentBatch?.trackingMode === 'ANIMAL_WISE';
  const selectedStage = dataEntryStages.find(
    (s) => s.stage_id === selectedStageId,
  );
  const selectedProgress = dataEntryProgress.find(
    (p) => p.stage_id === selectedStageId,
  );
  const animalListStage = animalListStageId
    ? dataEntryProgress.find((p) => p.stage_id === animalListStageId)
    : null;
  const animalListRows = animalListStageId
    ? batchAnimalRoster.filter((a) => a.current_stage_id === animalListStageId)
    : [];

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
      {/* ── Top Batch Selector & Header Strip ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border"
              style={{
                backgroundColor: 'var(--surface-raised)',
                borderColor: 'var(--border)',
              }}
            >
              <Layers className="h-5 w-5" style={{ color: 'var(--accent)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={S.muted}
              >
                {t('activeProductionBatch')}
              </span>

              <div className="mt-1.5 flex items-center gap-2.5 flex-wrap">
                <select
                  value={selectedBatchId}
                  onChange={(e) => {
                    userPickedDateRef.current = false;
                    setMinSelectableDate(null);
                    setSelectedBatchId(e.target.value);
                  }}
                  className="max-w-[280px] sm:max-w-[360px] truncate rounded-[var(--radius-xs)] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] focus:outline-none"
                >
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}
                      {b.parentBatchId ? ' ↳ split group' : ''} — {b.name} (
                      {b.breed})
                    </option>
                  ))}
                </select>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0"
                  style={{
                    backgroundColor: 'var(--success-muted)',
                    color: 'var(--success)',
                    borderColor: 'rgba(47, 125, 91, 0.2)',
                  }}
                >
                  {t('liveActive')}
                </span>

                {!isAnimalWise && currentBatch?.lobId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openChangeStage}
                    className="h-7 text-[11px] gap-1.5 font-semibold shrink-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> {t('blTransferStage')}
                  </Button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
                <div className="whitespace-nowrap">
                  <span style={S.muted}>{t('bdeBreed')} </span>
                  <span className="font-semibold" style={S.primary}>
                    {currentBatch?.breed || '—'}
                  </span>
                </div>
                <div className="whitespace-nowrap">
                  <span style={S.muted}>{t('bdeType')} </span>
                  <span className="font-semibold" style={S.primary}>
                    {currentBatch?.type || '—'}
                  </span>
                </div>
                <div className="whitespace-nowrap">
                  <span style={S.muted}>{t('bdeStartDate')} </span>
                  <span className="font-semibold" style={S.primary}>
                    {currentBatch?.startDate || '—'}
                  </span>
                </div>
                <div className="whitespace-nowrap">
                  <span style={S.muted}>
                    {isAnimalWise
                      ? 'Tracking Mode:'
                      : t('bdeCurrentStage')}{' '}
                  </span>
                  {isAnimalWise ? (
                    <span className="font-semibold" style={S.accent}>
                      Animal Wise
                    </span>
                  ) : (
                    <>
                      <span className="font-semibold" style={S.accent}>
                        {currentBatch?.currentStage || '—'}
                      </span>
                      {currentBatch?.stageTotalDays ? (
                        <span className="text-[11px] ml-1" style={S.muted}>
                          {t('bdeDayOf', {
                            day: currentBatch.stageDay,
                            total: currentBatch.stageTotalDays,
                          })}
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Animal Summary KPI Strip — equal-width cells with hairline
              dividers (gap-px over the border color) rather than border-r,
              so the grid stays pixel-even instead of drifting when a cell
              wraps. */}
          <div
            className="grid grid-cols-4 gap-px rounded-[var(--radius-md)] border overflow-hidden shrink-0"
            style={{
              borderColor: 'var(--border)',
              backgroundColor: 'var(--border)',
            }}
          >
            {[
              {
                label: t('bdeAssigned'),
                value: currentBatch?.assignedCount ?? 0,
                color: 'var(--text-primary)',
              },
              {
                label: t('bdeCurrent'),
                value: currentHeadCount,
                color: 'var(--success)',
              },
              {
                label: t('bdeMortality'),
                value: batchMortality,
                color: 'var(--danger)',
              },
              {
                label: t('bdeTransferred'),
                value: currentBatch?.transferredCount ?? 0,
                color: 'var(--text-primary)',
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="flex min-w-[82px] flex-col items-center justify-center gap-0.5 px-4 py-2.5"
                style={{ backgroundColor: 'var(--surface-raised)' }}
              >
                <p
                  className="text-[10px] uppercase font-bold tracking-wide"
                  style={S.muted}
                >
                  {kpi.label}
                </p>
                <p className="text-lg font-bold" style={{ color: kpi.color }}>
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tabs: Data Entry (the day-by-day screen below) vs. a read-only
          Overview of the batch itself, independent of any one day. ── */}
      <div className="flex items-center gap-1 border-b border-[var(--border)]">
        {[
          { key: 'entry' as const, label: 'Data Entry', icon: FileText },
          { key: 'overview' as const, label: 'Overview', icon: ClipboardList },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold border-b-2 -mb-px transition-colors"
            style={
              activeTab === tab.key
                ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                : { borderColor: 'transparent', color: 'var(--text-muted)' }
            }
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xs space-y-5">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] mb-3">
              Batch Summary
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-xs">
              <div>
                <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                  {t('bdeBreed')}
                </p>
                <p className="font-semibold text-[var(--text-primary)]">
                  {currentBatch?.breed || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                  {t('bdeType')}
                </p>
                <p className="font-semibold text-[var(--text-primary)]">
                  {currentBatch?.type || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                  {t('bdeStartDate')}
                </p>
                <p className="font-semibold text-[var(--text-primary)]">
                  {currentBatch?.startDate || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                  {isAnimalWise ? 'Tracking Mode' : t('bdeCurrentStage')}
                </p>
                {isAnimalWise ? (
                  <p className="font-semibold text-[var(--accent)]">
                    Animal Wise
                  </p>
                ) : (
                  <p className="font-semibold text-[var(--accent)]">
                    {currentBatch?.currentStage || '—'}
                    {currentBatch?.stageTotalDays ? (
                      <span className="text-[11px] text-[var(--text-muted)] ml-1">
                        {t('bdeDayOf', {
                          day: currentBatch.stageDay,
                          total: currentBatch.stageTotalDays,
                        })}
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[var(--surface-raised)] p-4 rounded-[var(--radius-md)] border border-[var(--border)]">
            <div className="text-center">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                {t('bdeAssigned')}
              </p>
              <p className="text-lg font-bold text-[var(--text-primary)]">
                {currentBatch?.assignedCount ?? 0}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                {t('bdeCurrent')}
              </p>
              <p
                className="text-lg font-bold"
                style={{ color: 'var(--success)' }}
              >
                {currentHeadCount}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                {t('bdeMortality')}
              </p>
              <p
                className="text-lg font-bold"
                style={{ color: 'var(--danger)' }}
              >
                {batchMortality}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                {t('bdeTransferred')}
              </p>
              <p className="text-lg font-bold text-[var(--text-primary)]">
                {currentBatch?.transferredCount ?? 0}
              </p>
            </div>
          </div>

          {!isAnimalWise && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] mb-3">
                Selected Day — {selectedDate}
              </h3>
              <div className="flex flex-wrap items-center gap-4 text-xs bg-[var(--surface-raised)] p-4 rounded-[var(--radius-md)] border border-[var(--border)]">
                <div>
                  <span className="text-[var(--text-muted)]">Status: </span>
                  {locked ? (
                    <span
                      className="font-bold inline-flex items-center gap-1"
                      style={{ color: 'var(--accent)' }}
                    >
                      <Lock className="h-3.5 w-3.5" /> Posted & Locked
                    </span>
                  ) : (
                    <span className="font-bold text-[var(--text-primary)]">
                      Draft — not yet posted
                    </span>
                  )}
                  {locked && lockInfo.lockedAt && (
                    <span className="text-[11px] text-[var(--text-muted)] ml-2">
                      since{' '}
                      {String(lockInfo.lockedAt).slice(0, 16).replace('T', ' ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'entry' && (
        <>
          {!isAnimalWise && (
            <>
              {/* ── 8-Stage Lifecycle Stepper — read-only, reflecting the batch's
              real current stage. Advancing it is the deliberate "Change
              Stage" action above (real POST /batch/:id/transfer-stage call),
              not something clicking a stage while logging daily data does. ── */}
              {lifecycle.stages.length > 0 ? (
                <PiggeryLifecycleStepper
                  stages={lifecycle.stages}
                  currentStageId={lifecycle.currentStageId}
                />
              ) : (
                <PiggeryLifecycleStepper
                  currentStageId={currentBatch?.currentStageId || 0}
                />
              )}
            </>
          )}

          {/* ── Date & Weather Bar ── */}
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                  {t('logEntryDate')}
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  min={minSelectableDate || undefined}
                  disabled={posting}
                  onChange={(e) => {
                    userPickedDateRef.current = true;
                    setSelectedDate(e.target.value);
                  }}
                  className="rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none disabled:opacity-60"
                />
              </div>

              {postedDates.length > 0 && (
                <div>
                  <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                    History
                  </label>
                  <select
                    value=""
                    disabled={posting}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      userPickedDateRef.current = true;
                      setSelectedDate(e.target.value);
                      e.target.value = '';
                    }}
                    className="nf-select rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none disabled:opacity-60"
                  >
                    <option value="">
                      {postedDates.length} posted date
                      {postedDates.length === 1 ? '' : 's'} — view…
                    </option>
                    {postedDates.map((d: Row, idx: number) => (
                      <option
                        key={`${d.entry_date}-${d.stage_id}-${idx}`}
                        value={String(d.entry_date)}
                      >
                        {String(d.entry_date)}
                        {d.stage_name ? ` — ${d.stage_name}` : ''}
                        {d.status === 'REOPENED' ? ' (reopened)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {dataEntryLoading && (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  style={S.accent}
                />
              )}
            </div>

            {!isAnimalWise && (
              <Button
                size="sm"
                onClick={handlePostEntry}
                disabled={posting || locked}
                className="nf-btn-primary text-xs h-8 gap-1.5 font-semibold"
              >
                {posting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Lock className="w-3.5 h-3.5" />
                )}
                {locked
                  ? 'Posted & Locked'
                  : posting
                    ? 'Posting…'
                    : 'Post Entry'}
              </Button>
            )}

            {isAnimalWise && selectedStage && (
              <div className="flex items-center gap-2 flex-wrap">
                {(selectedStage.animals || []).length > 0 && (
                  <select
                    value={entryScope}
                    onChange={(e) => setEntryScope(e.target.value)}
                    className={`${inputCls} nf-select w-auto`}
                    style={S.input}
                  >
                    <option value="ALL">
                      All animals in this stage ({selectedStage.animal_count})
                    </option>
                    {selectedStage.animals.map((a: Row) => (
                      <option key={a.animal_id} value={a.animal_id}>
                        {a.animal_code}
                      </option>
                    ))}
                  </select>
                )}
                {selectedStage.lock_status === 'LOCKED' ? (
                  <span
                    className="text-xs font-semibold inline-flex items-center gap-1.5 px-3 py-1.5"
                    style={{ color: 'var(--success, #16a34a)' }}
                  >
                    <Lock className="h-3.5 w-3.5" /> Posted & Locked
                  </span>
                ) : (
                  <Button
                    size="sm"
                    onClick={handlePostStageDay}
                    disabled={stageActionBusy}
                    className="nf-btn-primary text-xs h-8 gap-1.5 font-semibold"
                  >
                    {stageActionBusy ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Lock className="w-3.5 h-3.5" />
                    )}
                    {stageActionBusy ? t('blSaving') : 'Post Stage Data'}
                  </Button>
                )}
              </div>
            )}
          </div>

          {locked && !isAnimalWise && (
            <div
              className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] border flex items-center gap-2"
              style={{
                backgroundColor: 'var(--surface-raised)',
                color: 'var(--accent)',
                borderColor: 'var(--border)',
              }}
            >
              <Lock className="h-4 w-4 shrink-0" />
              <span>
                {selectedDate} has been posted and locked
                {lockInfo.lockedAt
                  ? ` (${String(lockInfo.lockedAt).slice(0, 16).replace('T', ' ')})`
                  : ''}
                . Fields below are read-only — pick a different date to enter
                new data.
              </span>
            </div>
          )}

          {saveSuccessMsg && (
            <div className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}

          {saveErrorMsg && (
            <div className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 flex items-center gap-2 animate-in fade-in">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{saveErrorMsg}</span>
            </div>
          )}

          {/* ── Scheduled Activities — every row comes from the scheduler
          (GET /batch/:id/data-entry); there is no ad hoc "add activity" path
          here any more. ── */}
          {isAnimalWise ? (
            <div className="flex flex-col gap-4">
              {/* Stage progress — the full LOB pipeline, styled like the
              BATCH_WISE lifecycle stepper (connected circles) so both
              tracking modes read the same way. A circle shows its live
              headcount instead of a fixed step number when animals are
              actually there. Clicking a circle/label selects that stage for
              data entry; clicking the headcount specifically opens the
              animal-list popup instead. */}
              {dataEntryProgress.length > 0 && (
                <div className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 overflow-x-auto shadow-2xs">
                  <div
                    className="relative"
                    style={{
                      minWidth: `${Math.max(780, dataEntryProgress.length * 108)}px`,
                    }}
                  >
                    <div className="absolute top-4 left-6 right-6 h-[3px] bg-[var(--border)] z-0 rounded-full" />
                    <div className="flex items-start justify-between relative z-10">
                      {dataEntryProgress.map((p) => {
                        const selected = p.stage_id === selectedStageId;
                        const hasAnimals = p.animal_count > 0;
                        const stageLocked =
                          dataEntryStages.find((s) => s.stage_id === p.stage_id)
                            ?.lock_status === 'LOCKED';
                        return (
                          <div
                            key={p.stage_id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedStageId(p.stage_id)}
                            className="flex min-w-0 flex-col items-center group flex-1 cursor-pointer"
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hasAnimals)
                                  setAnimalListStageId(p.stage_id);
                              }}
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-200 ${
                                stageLocked
                                  ? 'bg-[var(--success)] text-white ring-4 ring-[var(--success-muted)] shadow-xs'
                                  : selected
                                    ? 'bg-[var(--accent)] text-white ring-4 ring-[var(--accent-muted)] shadow-md scale-110'
                                    : 'bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text-muted)] group-hover:border-[var(--text-secondary)]'
                              }`}
                              title={
                                hasAnimals ? 'View animal list' : undefined
                              }
                            >
                              {hasAnimals ? p.animal_count : '•'}
                            </button>
                            <div className="mt-2.5 text-center flex flex-col items-center w-full px-0.5">
                              <p
                                className={`text-xs tracking-tight truncate w-full ${
                                  selected
                                    ? 'text-[var(--accent)] font-bold'
                                    : stageLocked
                                      ? 'text-[var(--text-primary)] font-semibold'
                                      : 'text-[var(--text-secondary)] font-medium'
                                }`}
                                title={p.stage_name}
                              >
                                {p.stage_code}
                              </p>
                              <div className="h-5 mt-1.5 flex items-center justify-center">
                                {stageLocked ? (
                                  <span className="px-1.5 py-0.5 rounded-full bg-[var(--success-muted)] text-[var(--success)] border border-[var(--success)]/20 text-[9px] font-semibold">
                                    POSTED
                                  </span>
                                ) : hasAnimals ? (
                                  <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold uppercase tracking-wider shadow-2xs">
                                    ACTIVE
                                  </span>
                                ) : (
                                  <span className="text-[9px]" style={S.muted}>
                                    —
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {dataEntryError && <InlineAlert>{dataEntryError}</InlineAlert>}

              {!dataEntryLoading && !selectedStageId ? (
                <InlineAlert variant="info">
                  {t('blNoParamsScheduled')}
                </InlineAlert>
              ) : selectedProgress && !selectedStage ? (
                <InlineAlert variant="info">
                  No animals are currently in {selectedProgress.stage_code}.
                </InlineAlert>
              ) : selectedStage ? (
                <div className="rounded-lg border p-3" style={S.surface}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold" style={S.primary}>
                      {stageActivityLabel(selectedStage)}
                    </span>
                    <span className="text-[11px]" style={S.muted}>
                      {selectedStage.animal_count} animal(s) · Day{' '}
                      {selectedStage.day_of_stage ?? '—'} of stage
                    </span>
                  </div>

                  {stageActionError && (
                    <div className="mb-2">
                      <InlineAlert>{stageActionError}</InlineAlert>
                    </div>
                  )}

                  <div
                    className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    style={S.surface}
                  >
                    {selectedStage.lock_status === 'LOCKED' ? (
                      <>
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="text-xs font-semibold"
                            style={{ color: 'var(--success, #16a34a)' }}
                          >
                            ✓ POSTED — 🔒 LOCKED
                          </span>
                          <span className="text-[11px]" style={S.muted}>
                            Posted{' '}
                            {selectedStage.locked_at
                              ? new Date(
                                  selectedStage.locked_at,
                                ).toLocaleString()
                              : ''}
                          </span>
                        </div>
                        {!reopenBoxOpen ? (
                          <button
                            type="button"
                            onClick={() => setReopenBoxOpen(true)}
                            className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                            style={S.surface}
                          >
                            Request Reopen
                          </button>
                        ) : (
                          <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center">
                            <input
                              value={reopenReason}
                              onChange={(e) => setReopenReason(e.target.value)}
                              placeholder="Reason for reopening (required)"
                              className={inputCls + ' sm:w-64'}
                              style={S.input}
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={handleReopenStageDay}
                                disabled={
                                  stageActionBusy || !reopenReason.trim()
                                }
                                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                style={{ backgroundColor: 'var(--danger)' }}
                              >
                                {stageActionBusy
                                  ? t('blSaving')
                                  : 'Confirm Reopen'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setReopenBoxOpen(false)}
                                className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                                style={S.surface}
                              >
                                {t('blCancel')}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-col gap-0.5">
                          {selectedStage.lock_status === 'REOPENED' ? (
                            <>
                              <span
                                className="text-xs font-semibold"
                                style={{ color: 'var(--danger)' }}
                              >
                                REOPENED for correction
                              </span>
                              <span className="text-[11px]" style={S.muted}>
                                Reason: {selectedStage.reopen_reason}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs" style={S.muted}>
                              Not yet posted for this date.
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {entryScope === 'ALL'
                    ? (() => {
                        const templateAnimal = (selectedStage.animals || [])[0];
                        if (!templateAnimal) return null;
                        const stageAnimals: Row[] = selectedStage.animals || [];
                        return (
                          <div>
                            {selectedStage.lock_status !== 'LOCKED' &&
                              stageAnimals.length > 0 && (
                                <div className="mb-2 flex items-center justify-end">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBulkStageTransitionError('');
                                      setBulkStageTransitionOpen(true);
                                    }}
                                    className="text-[10px] font-semibold hover:underline"
                                    style={S.accent}
                                  >
                                    Change Stage (all {stageAnimals.length})
                                  </button>
                                </div>
                              )}
                            {renderActivityBoxes(
                              templateAnimal.lines || [],
                              '__ALL__',
                              selectedStage.lock_status === 'LOCKED',
                              true,
                            )}
                          </div>
                        );
                      })()
                    : (() => {
                        const animal = (selectedStage.animals || []).find(
                          (a: Row) => a.animal_id === entryScope,
                        );
                        if (!animal) return null;
                        const rosterAnimal = batchAnimalRoster.find(
                          (a) => a.animal_id === animal.animal_id,
                        );
                        return (
                          <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p
                                className="font-mono text-[11px] font-semibold"
                                style={S.sub}
                              >
                                {animal.animal_code}
                              </p>
                              {rosterAnimal &&
                                selectedStage.lock_status !== 'LOCKED' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setStageTransitionAnimal(rosterAnimal)
                                    }
                                    className="text-[10px] font-semibold hover:underline"
                                    style={S.accent}
                                  >
                                    Change Stage
                                  </button>
                                )}
                            </div>
                            {renderActivityBoxes(
                              animal.lines || [],
                              animal.animal_id,
                              selectedStage.lock_status === 'LOCKED',
                            )}
                          </div>
                        );
                      })()}
                </div>
              ) : null}
            </div>
          ) : noScheduler ? (
            <InlineAlert variant="info">
              No scheduler is linked to this batch&apos;s current stage —
              activities will appear here once one is created in the Scheduler
              module.
            </InlineAlert>
          ) : dataEntryLoading ? null : (
            renderActivityBoxes(dataEntryLines, undefined, locked)
          )}

          {/* ── Weight/BCS, Notes & Attachments — quick, non-scheduled captures,
          kept visually separate from the scheduled-activity table above. ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>{t('bdeSecWeightBcs')}</span>
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                    {t('bdeAvgWeightKg')}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={avgWeight}
                    onChange={(e) => setAvgWeight(Number(e.target.value))}
                    className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs font-bold text-[var(--text-primary)] font-mono"
                  />
                </div>
                <div>
                  <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                    {t('bdeAdg')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={weightGain}
                    onChange={(e) => setWeightGain(Number(e.target.value))}
                    className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs font-bold text-[var(--text-primary)] font-mono"
                  />
                </div>
                <div>
                  <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                    {t('bdeBcsRange')}
                  </label>
                  <input
                    type="text"
                    value={bcsScore}
                    onChange={(e) => setBcsScore(e.target.value)}
                    className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs font-bold text-[var(--text-primary)] font-mono"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={weightNotes}
                  onChange={(e) => setWeightNotes(e.target.value)}
                  placeholder={t('bdeConditionObs')}
                  className="flex-1 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
                />
                <Button
                  size="sm"
                  onClick={handleSaveWeightSample}
                  disabled={savingWeight || avgWeight <= 0}
                  className="nf-btn-primary text-xs h-8 gap-1.5"
                >
                  {savingWeight ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {t('blSave')}
                </Button>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>{t('bdeSecNotes')}</span>
              </h3>
              <textarea
                rows={3}
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
                className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-xs text-[var(--text-primary)] focus:outline-none"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveNotes}
                  disabled={savingNotes || !generalNotes.trim()}
                  className="nf-btn-primary text-xs h-8 gap-1.5"
                >
                  {savingNotes ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {t('blSave')}
                </Button>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span>{t('bdeSecPhotosDocs')}</span>
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUploadError('');
                    setUploadingFile(null);
                    setUploadModalOpen(true);
                  }}
                  className="h-6 text-[10px] px-2 gap-1 font-medium"
                >
                  <Plus className="w-3 h-3" /> {t('bdeUploadMedia')}
                </Button>
              </div>

              <div className="space-y-2">
                {attachments.length === 0 ? (
                  <p className="py-3 text-center text-xs text-[var(--text-muted)] italic">
                    {t('obNoInspectionMedia')}
                  </p>
                ) : (
                  attachments.map((att) => (
                    <div
                      key={att.attachment_id}
                      className="p-2 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex items-center justify-between gap-2"
                    >
                      <a
                        href={`${API_ORIGIN}${att.file_url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-[var(--text-primary)] flex items-center gap-1.5 hover:underline truncate"
                      >
                        <Camera className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                        <span className="truncate">{att.file_name}</span>
                      </a>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          {new Date(att.created_at).toLocaleDateString()}
                        </span>
                        <button
                          onClick={() =>
                            handleRemoveAttachment(att.attachment_id)
                          }
                          className="text-[var(--text-muted)] hover:text-rose-500 p-1"
                          title={t('obRemoveAttachment')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── MODAL: Animal list for a stage's count badge ── */}
      {animalListStageId && (
        <Dialog
          open={!!animalListStageId}
          onClose={() => setAnimalListStageId(null)}
          title={`${animalListStage?.stage_code || ''} — Animals`}
          maxWidth="md"
        >
          {batchAnimalRosterLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" style={S.accent} />
            </div>
          ) : animalListRows.length === 0 ? (
            <p className="text-xs py-4 text-center" style={S.muted}>
              No animals found for this stage.
            </p>
          ) : (
            <div
              className="max-h-96 overflow-auto rounded-[var(--radius-sm)] border"
              style={S.surface}
            >
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    <TableHead className="h-auto px-3 py-2">
                      Animal Code
                    </TableHead>
                    <TableHead className="h-auto px-3 py-2">Ear Tag</TableHead>
                    <TableHead className="h-auto px-3 py-2">Sex</TableHead>
                    <TableHead className="h-auto px-3 py-2">Breed</TableHead>
                    <TableHead className="h-auto px-3 py-2">Age</TableHead>
                    <TableHead className="h-auto px-3 py-2">Location</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {animalListRows.map((a) => (
                    <TableRow key={a.animal_id}>
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
                        {a.gender === 'F' ? 'Female' : 'Male'}
                      </TableCell>
                      <TableCell className="px-3 py-1.5" style={S.sub}>
                        {a.breed_name || '—'}
                      </TableCell>
                      <TableCell className="px-3 py-1.5" style={S.sub}>
                        {animalAge(a)}
                      </TableCell>
                      <TableCell className="px-3 py-1.5" style={S.sub}>
                        {locationLabel(a.current_location_id)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </Dialog>
      )}

      {/* ── MODAL: Per-animal manual stage change (ANIMAL_WISE) ── */}
      <AnimalStageTransitionModal
        open={!!stageTransitionAnimal}
        onClose={() => setStageTransitionAnimal(null)}
        animal={stageTransitionAnimal}
        onSuccess={() => {
          loadDataEntry();
          setBatchAnimalRoster((prev) => [...prev]);
        }}
        stages={stageMasterList}
        locations={locations}
        batches={batches.map((b) => ({ batch_id: b.id, batch_no: b.code }))}
      />

      {/* ── MODAL: Bulk manual stage change for every animal in the selected
          stage (ANIMAL_WISE, "All animals" entry scope) — same shared
          destination/reason shape as Batch Animals' own multi-select move. */}
      {bulkStageTransitionOpen && selectedStage && (
        <Dialog
          open={bulkStageTransitionOpen}
          onClose={() => setBulkStageTransitionOpen(false)}
          title={`Move ${(selectedStage.animals || []).length} animal(s) to a stage`}
          maxWidth="sm"
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkStageTransitionOpen(false)}
              >
                {t('blCancel')}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  handleBulkStageTransition(
                    (selectedStage.animals || []).map((a: Row) => a.animal_id),
                  )
                }
                disabled={
                  bulkStageTransitionSaving ||
                  !bulkStageTransitionForm.to_stage_id
                }
                className="nf-btn-primary"
              >
                {bulkStageTransitionSaving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  'Move'
                )}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            {bulkStageTransitionError && (
              <InlineAlert>{bulkStageTransitionError}</InlineAlert>
            )}
            <div>
              <label className="font-semibold block mb-1">
                Destination Stage
              </label>
              <select
                value={bulkStageTransitionForm.to_stage_id}
                onChange={(e) =>
                  setBulkStageTransitionForm((f) => ({
                    ...f,
                    to_stage_id: e.target.value,
                  }))
                }
                className={`${inputCls} nf-select w-full`}
              >
                <option value="">Select a stage…</option>
                {stageMasterList.map((s: Row) => (
                  <option key={s.stage_id} value={s.stage_id}>
                    {s.stage_code} — {s.stage_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Destination Location (optional)
              </label>
              <select
                value={bulkStageTransitionForm.to_location_id}
                onChange={(e) =>
                  setBulkStageTransitionForm((f) => ({
                    ...f,
                    to_location_id: e.target.value,
                  }))
                }
                className={`${inputCls} nf-select w-full`}
              >
                <option value="">Keep current location</option>
                {locations.map((l: Row) => (
                  <option key={l.location_id} value={l.location_id}>
                    {l.location_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Reason (required to override a minimum-duration hold)
              </label>
              <input
                type="text"
                value={bulkStageTransitionForm.reason}
                onChange={(e) =>
                  setBulkStageTransitionForm((f) => ({
                    ...f,
                    reason: e.target.value,
                  }))
                }
                className="nf-input w-full"
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: Whole-batch manual stage change (BATCH_WISE) ── */}
      {changeStageOpen && (
        <Dialog
          open={changeStageOpen}
          onClose={() => setChangeStageOpen(false)}
          title={t('blTransferStage')}
          maxWidth="sm"
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChangeStageOpen(false)}
              >
                {t('blCancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleChangeStage}
                disabled={
                  changeStageSaving ||
                  changeStageOptions.length === 0 ||
                  !changeStageForm.to_stage_code
                }
                className="nf-btn-primary"
              >
                {changeStageSaving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  t('blTransferStage')
                )}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            {changeStageError && <InlineAlert>{changeStageError}</InlineAlert>}
            <div>
              <label className="font-semibold block mb-1">
                Destination Stage
              </label>
              {changeStageOptionsLoading ? (
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
                  stages…
                </div>
              ) : (
                <select
                  value={changeStageForm.to_stage_code}
                  onChange={(e) =>
                    setChangeStageForm((f) => ({
                      ...f,
                      to_stage_code: e.target.value,
                    }))
                  }
                  className={`${inputCls} nf-select w-full`}
                >
                  <option value="">Select a stage…</option>
                  {changeStageOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Remarks (required to override a minimum-duration hold)
              </label>
              <input
                type="text"
                value={changeStageForm.remarks}
                onChange={(e) =>
                  setChangeStageForm((f) => ({ ...f, remarks: e.target.value }))
                }
                className="nf-input w-full"
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: UPLOAD INSPECTION MEDIA ── */}
      {uploadModalOpen && (
        <Dialog
          open={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          title={t('obUploadInspectionMedia')}
          maxWidth="sm"
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUploadModalOpen(false);
                  setUploadingFile(null);
                  setUploadError('');
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleAddAttachment}
                disabled={!uploadingFile}
                className="nf-btn-primary"
              >
                {t('obAttachToDailyLog')}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">
                {t('obFileRequired')}
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
                onChange={(e) => setUploadingFile(e.target.files?.[0] || null)}
                className="nf-input w-full"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1">
                {t('obMediaType')}
              </label>
              <select
                value={newAttachmentType}
                onChange={(e) => setNewAttachmentType(e.target.value)}
                className="nf-input w-full"
              >
                <option value="IMAGE">{t('obMediaSiteImage')}</option>
                <option value="PDF">{t('obMediaVetReport')}</option>
              </select>
            </div>

            {uploadError && (
              <p className="text-rose-500 font-medium">{uploadError}</p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
