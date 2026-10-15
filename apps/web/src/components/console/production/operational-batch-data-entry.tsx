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
  ArrowRightCircle,
  Sparkles,
  ExternalLink,
  Inbox,
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
import { useSystemSchedulerPrompt } from './system-scheduler-prompt';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InlineAlert } from '@/components/ui/alert';
import { Toast } from "@/components/ui/toast";
import { ConsumptionLotPicker } from './entry/consumption-lot-picker';
import { asStageTotalLine, isTotalBatch, round4, splitTotal } from './entry/stage-total';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useLanguage } from '@/hooks/useLanguage';
import AnimalStageTransitionModal from '@/components/console/piggery/animal-stage-transition-modal';
import AnimalDetailsModal from '@/components/console/piggery/animal-details-modal';
import { EntityLookupField } from '@/modules/master-data/EntityLookupField';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ReasonSelect } from '@/components/ui/reason-select';
import { MortalityAnimalsField, draftPicks, useMortalityCandidates } from './entry/mortality-animals-field';
import { countOnlyPicks, mortalityPayload, mortalityPicksComplete, requiredMortalityAnimals, type MortalityPick } from './entry/mortality-animals';
import AnimalSerialAssignmentModal from './animal-serial-assignment-modal';

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
/** What an output entered for this animal will post as, in words. A sow's litter is a lot of a bio-asset item; any
 *  other item she yields is ordinary output. */
const outputEventLabel = (event: Row, bioItemChosen?: boolean): string => {
  if (event.kind === 'SEMEN')
    return 'Posts as a semen collection: doses into a lot, with its QR. Pool with other boars below to mix their semen into the same lot.';
  if (!bioItemChosen)
    return 'Choose a bio-asset (piglet) item for this to post as her litter; any other item is ordinary output.';
  if (event.kind === 'FARROWING')
    return 'Posts as a farrowing: the live-born piglets become a piglet lot.';
  const lot = event.piglet_lot_no ? `, lot ${event.piglet_lot_no}` : '';
  const onHand = event.piglets_on_hand != null ? ` — ${event.piglets_on_hand} on hand` : '';
  return `Posts as the weaning of litter ${event.litter}${lot}${onHand}: losses are recorded as mortality.`;
};
/** A line that issues stock names the lot or serial it draws from. An output does not: its lot is made when it posts,
 *  so it is never asked for one (a lot-tracked output item used to show the issue picker and send an old lot). */
const drawsFromLots = (line: Row) =>
  line.line_type !== 'OUTPUT' && Boolean(line.lot_required || line.is_lot_tracked || line.is_serial_tracked);
const isTextCapture = (line: Row) =>
  line.line_type === 'DESCRIPTIVE' &&
  !!line.kpi_uom &&
  line.kpi_uom.includes('/');
// A number the user already saved always wins. Otherwise the Actual field
// starts at the scheduled Expected quantity rather than blank, so the common
// case (the animal ate/received the standard dose) is a single click of
// Save instead of re-typing a number that's already shown one column over.
// Text-capture lines have no numeric "expected" to seed a text box with.
/** A death is entered against the animal that died: in the "All animals" view this line is a picker, not a number. */
const isMortalityLine = (line: Row) => line.kpi_metric === 'MORTALITY_COUNT';

const defaultEntryValue = (line: Row) => {
  if (line.allow_qty_edit === false) {
    return line.expected_qty != null ? String(line.expected_qty) : '';
  }
  if (line.already_entered_qty != null && line.already_entered_qty !== '') {
    return String(line.already_entered_qty);
  }
  // A death is an event, not a standard: it starts at none, never at the line's expected figure.
  if (isMortalityLine(line)) return '0';
  // An output is what actually came out — a litter, the doses collected — never the line's standard. Prefilled, saving
  // a stage's drafts would have recorded an output of the standard for every animal (a 1-piglet farrowing per sow).
  if (line.line_type === 'OUTPUT') return '';
  if (!isTextCapture(line) && line.expected_qty != null) {
    return String(line.expected_qty);
  }
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
  /** True when currentCount is the batch's own closing quantity, which every death already lowers (13 Oct). */
  closingKept?: boolean;
  mortalityCount: number;
  transferredCount: number;
  lobId: string | null;
  breedId: string | null;
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
  const schedulerPrompt = useSystemSchedulerPrompt();
  /** Asks whether to copy the destination stage's system scheduler; null = the user backed out. */
  const askSchedulerSource = (toStageCode: string) =>
    schedulerPrompt.ask({
      companyId: getActiveCompanyId(),
      lobId: currentBatch?.lobId,
      stageCodes: [toStageCode],
      breedId: currentBatch?.breedId,
    });

  // ── Scheduler-driven entry state — every activity comes from GET
  // /batch/:id/data-entry (the scheduler's due lines for this date), never
  // hardcoded or hand-typed. BATCH_WISE gets a flat due-lines list;
  // ANIMAL_WISE gets one section per stage its live animals are actually in. ──
  const [dataEntryLines, setDataEntryLines] = useState<Row[]>([]);
  // Bumped whenever the day's entries reload, so lot and serial lists reload with them: stock moved.
  const [stockVersion, setStockVersion] = useState(0);
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
  // Checkpoint 28: empty bags counted for a bagged-feed consumption line, keyed like the values.
  const [dataEntryEmptyBags, setDataEntryEmptyBags] = useState<
    Record<string, string>
  >({});
  const [dataEntryDestBatches, setDataEntryDestBatches] = useState<
    Record<string, string>
  >({});
  // Mortality count on a batch with registered animals: the animals chosen as dead, keyed like the values.
  const [dataEntryMortality, setDataEntryMortality] = useState<
    Record<string, MortalityPick[]>
  >({});
  // A boar's semen collection can be pooled with other boars: the other boars chosen on that row (animal ids), kept on
  // the draft like the item and destination.
  const [dataEntryPoolBoars, setDataEntryPoolBoars] = useState<
    Record<string, string[]>
  >({});
  // The item each OUTPUT entry takes out of the batch: the line's own unless the user picks another (any item —
  // piglets of a sow, semen of a boar, whatever a batch-wise batch yields).
  const [dataEntryOutputItems, setDataEntryOutputItems] = useState<
    Record<string, string>
  >({});
  const [outputItemOptions, setOutputItemOptions] = useState<
    Array<{ value: string; label: string; bio: boolean }>
  >([]);
  useEffect(() => {
    api
      .get('/item?isActive=true&isBlocked=false&limit=500')
      .then((res: any) =>
        setOutputItemOptions(
          (unwrap<Row[]>(res) || [])
            .filter((i: Row) => !i.is_blocked && i.is_active !== false)
            .map((i: Row) => ({
              value: i.item_id,
              label: i.item_code ? `${i.item_code} — ${i.item_name}` : i.item_name,
              bio: Boolean(i.is_biological_asset),
            })),
        ),
      )
      .catch(() => setOutputItemOptions([]));
  }, []);

  const isAnimalWise =
    (currentBatch as any)?.trackingMode === 'ANIMAL_WISE' ||
    (currentBatch as any)?.tracking_mode === 'ANIMAL_WISE';
  // Whole-batch mortality lines ask which registered animals died; a line with no registered animal alive is count-only.
  useEffect(() => {
    setDataEntryMortality({});
  }, [selectedBatchId, selectedDate]);
  // Animal-wise: the selected stage's lines, so its dead animals can be shown greyed in the All-animals picker.
  const mortalityLineIds = (isAnimalWise
    ? (dataEntryStages.find((s) => s.stage_id === selectedStageId)?.animals?.[0]?.lines ?? [])
    : dataEntryLines)
    .filter((l: Row) => l.line_type === 'DESCRIPTIVE' && l.kpi_metric === 'MORTALITY_COUNT')
    .map((l: Row) => l.line_id as string);
  const mortalityInfo = useMortalityCandidates(currentBatch?.id, selectedDate, mortalityLineIds, true, isAnimalWise ? dataEntryStages : dataEntryLines);
  /**
   * The deaths this line adds for the value typed and what is entered for them so far. A batch with registered
   * animals names each animal; a count-only batch gives one weight-and-reason row per death.
   */
  const mortalityNeed = (line: Row, animalId?: string) => {
    if (isAnimalWise) {
      // Animal-wise (Rishi, 13 Oct): the entry names its animal, whose death needs a weight and reason too. The
      // "All animals" view would post the same count to every animal, so a death is entered on its own animal only.
      if (!animalId || line.line_type !== 'DESCRIPTIVE' || line.kpi_metric !== 'MORTALITY_COUNT') return null;
      const key = entryKey(line.line_id, animalId);
      const raw = dataEntryValues[key];
      const required = requiredMortalityAnimals(raw === undefined || raw === '' ? 0 : Number(raw), 0);
      if (animalId === '__ALL__') {
        // "All animals": several can die together (Rishi, 13 Oct) - pick which of the stage's pending animals died.
        const animals = (selectedStage?.animals || [])
          .filter((a: Row) => !a.is_posted)
          .map((a: Row) => ({ animal_id: a.animal_id as string, animal_code: (a.animal_code ?? a.animal_id) as string, rfid_tag: (a.rfid_tag ?? null) as string | null }));
        return { kind: 'ALL' as const, key, required, picks: dataEntryMortality[key] ?? [], animals, label: '', dead: mortalityInfo[line.line_id]?.dead_animals ?? [] };
      }
      const label = (selectedStage?.animals || []).find((a: Row) => a.animal_id === animalId)?.animal_code ?? '';
      return { kind: 'ANIMAL' as const, key, required, picks: countOnlyPicks(dataEntryMortality[key] ?? [], Math.min(required, 1)), animals: [], label, dead: [] };
    }
    const info = mortalityInfo[line.line_id];
    if (!info) return null;
    const key = entryKey(line.line_id, undefined);
    const raw = dataEntryValues[key];
    const required = requiredMortalityAnimals(raw === undefined || raw === '' ? 0 : Number(raw), info.already_posted);
    const picks = dataEntryMortality[key] ?? draftPicks(info);
    return { kind: 'BATCH' as const, key, required, picks: info.animals.length === 0 ? countOnlyPicks(picks, required) : picks, animals: info.animals, label: '', dead: info.dead_animals ?? [] };
  };
  /** True when the line needs nothing more for its deaths (or is not a mortality line). */
  const mortalityOk = (need: ReturnType<typeof mortalityNeed>) => {
    if (!need || need.required <= 0) return true;
    if (need.kind === 'ANIMAL' && need.required > 1) return false;
    return mortalityPicksComplete(need.picks, need.required);
  };
  const mortalityIncomplete = dataEntryLines.some((line) => !mortalityOk(mortalityNeed(line)));
  const selectedStage = dataEntryStages.find(
    (s) => s.stage_id === selectedStageId,
  );
  // Animal-wise: Post would drop a mortality line that cannot be saved, so it waits until the death is complete.
  const awScopeLines: Row[] = isAnimalWise && selectedStage
    ? (entryScope === 'ALL'
        ? selectedStage.animals?.[0]?.lines
        : selectedStage.animals?.find((a: Row) => a.animal_id === entryScope)?.lines) ?? []
    : [];
  const awMortalityIncomplete = awScopeLines.some(
    (line) => !mortalityOk(mortalityNeed(line, entryScope === 'ALL' ? '__ALL__' : entryScope)),
  );
  const [serialModalLine, setSerialModalLine] = useState<Row | null>(null);

  const [stageActionBusy, setStageActionBusy] = useState(false);
  const [stageActionError, setStageActionError] = useState('');
  // What a reopen did: how many entries went back to drafts, and what it had to leave posted and why.
  const [reopenNotice, setReopenNotice] = useState<{ unposted: number; kept: Array<{ activity_name: string; reason: string }> } | null>(null);
  const [reopenBoxOpen, setReopenBoxOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  // BATCH_WISE "Post Entry" lock, sourced from GET /batch/:id/data-entry's
  // lock_status/locked_by/locked_at (batch_data_entry_lock, shared with the
  // ANIMAL_WISE per-stage lock). Posting is final for BATCH_WISE — no reopen
  // here, matching BatchService.postBatchDay()'s own comment.
  const [posting, setPosting] = useState(false);
  const [savingAllDraft, setSavingAllDraft] = useState(false);
  const [lockInfo, setLockInfo] = useState<{
    status: string | null;
    lockedBy?: string | null;
    lockedAt?: string | null;
  }>({ status: null });
  const locked = lockInfo.status === 'LOCKED';

  // Compute local today string (YYYY-MM-DD) and check whether selectedDate is in the future
  const todayStr = (() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  })();
  const pendingStageAnimalCount = (selectedStage?.animals || []).filter((a: Row) => !a.is_posted).length || (selectedStage?.animals || []).length || 1;
  const isFutureDate = selectedDate > todayStr;

  // ── General-notes quick capture — OBSERVATION transactions,
  // confirmed to never touch inventory_ledger/GL, so they post immediately
  // rather than going through the draft/post cycle the scheduled table uses. ──
  const [generalNotes, setGeneralNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const [postedDates, setPostedDates] = useState<Row[]>([]);
  // One History entry per day: an animal-wise day has one lock per stage, and listing each made 14 days read
  // "42 posted dates" (13 Oct). The day's stages are named in its label.
  const postedDays = useMemo(() => {
    const byDate = new Map<string, { date: string; stages: string[]; reopened: boolean }>();
    for (const d of postedDates) {
      const date = String(d.entry_date).slice(0, 10);
      const day = byDate.get(date) ?? { date, stages: [], reopened: false };
      if (d.stage_name && !day.stages.includes(d.stage_name)) day.stages.push(d.stage_name);
      if (d.status === 'REOPENED') day.reopened = true;
      byDate.set(date, day);
    }
    return [...byDate.values()];
  }, [postedDates]);

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

  // Animal detail modal popup from clicking an animal row in the dialog
  const [selectedAnimalIdForDetails, setSelectedAnimalIdForDetails] =
    useState<string | null>(null);

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

  // Daily data entry mandatory date progression
  const [nextPendingDate, setNextPendingDate] = useState<string>('');

  // Stage transition & Min Days Before Move validation from backend
  const [stageTransition, setStageTransition] = useState<{
    current_stage_id: string | null;
    current_stage_code: string | null;
    current_stage_name: string | null;
    days_in_stage: number;
    min_days_before_move: number;
    can_move_without_remarks: boolean;
    transition_trigger: string;
    auto_move_on_day: number | null;
    typical_duration_days: number | null;
    auto_transition_due: boolean;
    next_stage: {
      stage_id: string;
      stage_code: string;
      stage_name: string;
      stage_sequence: number;
      typical_duration_days: number | null;
    } | null;
    valid_next_stages: Array<{
      stage_id: string;
      stage_code: string;
      stage_name: string;
      stage_sequence: number;
      min_days_before_move: number;
      typical_duration_days: number | null;
    }>;
  } | null>(null);

  // Automatic stage transition prompt popup
  const [autoTransitionModalOpen, setAutoTransitionModalOpen] = useState(false);
  const [autoTransitionDismissedBatchId, setAutoTransitionDismissedBatchId] =
    useState<string | null>(null);
  const [autoTransitionSaving, setAutoTransitionSaving] = useState(false);
  const [autoTransitionError, setAutoTransitionError] = useState('');

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
  const getAnimalAgeBreakdown = (a: Row): { weeks: string; days: string } => {
    if (a.dob) {
      const bornTime = new Date(a.dob).getTime();
      if (!Number.isNaN(bornTime)) {
        const days = Math.max(0, Math.floor((Date.now() - bornTime) / 86400000));
        const weeks = Math.floor(days / 7);
        return {
          weeks: `${weeks} wks`,
          days: `${days} days`,
        };
      }
    }
    if (a.age_at_entry_weeks != null) {
      const weeks = Number(a.age_at_entry_weeks);
      if (!Number.isNaN(weeks)) {
        return {
          weeks: `${weeks} wks`,
          days: `${weeks * 7} days`,
        };
      }
    }
    return {
      weeks: '—',
      days: '—',
    };
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
            assignedCount: Number(b.opening_quantity) || 0,
            currentCount:
              Number(b.closing_quantity ?? b.opening_quantity ?? 0) || 0,
            closingKept: b.closing_quantity != null,
            mortalityCount: 0,
            transferredCount: 0,
            lobId: b.lob_id ?? null,
            breedId: b.breed_id ?? null,
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
  const loadDataEntry = (overrideStageId?: string) => {
    if (!selectedBatchId) return;
    setDataEntryLoading(true);
    setNoScheduler(false);
    setDataEntryError('');

    const b = batches.find((x) => x.id === selectedBatchId);
    const targetStage =
      overrideStageId !== undefined
        ? overrideStageId
        : b?.trackingMode === 'BATCH_WISE'
          ? undefined
          : selectedStageId;
    const stageParam = targetStage ? `&stageId=${targetStage}` : '';

    Promise.all([
      api
        .get(
          `/batch/${selectedBatchId}/data-entry?date=${selectedDate}${stageParam}`,
        )
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
        const isAnimalWise = batchData?.tracking_mode === 'ANIMAL_WISE';

        const npd = schedData?.next_pending_date || '';
        if (npd) {
          setNextPendingDate(npd);
          if (!userPickedDateRef.current && selectedDate !== npd) {
            setSelectedDate(npd);
          }
        }

        if (schedData?.stage_transition) {
          setStageTransition(schedData.stage_transition);
          if (
            schedData.stage_transition.auto_transition_due &&
            autoTransitionDismissedBatchId !== selectedBatchId
          ) {
            setAutoTransitionModalOpen(true);
          }
        } else {
          setStageTransition(null);
        }

        const stageMaster: any[] = (stageRes as any)?.data ?? stageRes ?? [];
        setStageMasterList(Array.isArray(stageMaster) ? stageMaster : []);
        setLocations(unwrap<Row[]>(locationRes) || []);

        const values: Record<string, string> = {};
        // What the saved drafts chose: an output's item, a transfer's (or weaning's) destination.
        const initialItems: Record<string, string> = {};
        const initialDests: Record<string, string> = {};
        const initialPools: Record<string, string[]> = {};
        const rememberChoices = (line: Row, k: string) => {
          if (Array.isArray(line.already_entered_pool) && line.already_entered_pool.length)
            initialPools[k] = line.already_entered_pool;
          if (line.line_type === 'OUTPUT')
            initialItems[k] = line.already_entered_item_id || line.item_id || '';
          if (line.already_entered_destination)
            initialDests[k] = line.already_entered_destination;
        };

        if (isAnimalWise) {
          const stages: Row[] = schedData?.stages || [];
          const progress: Row[] = schedData?.progress || [];
          setDataEntryStages(stages);
          setDataEntryProgress(progress);
          setDataEntryLines([]);
          setNoScheduler(false);
          setLockInfo({ status: null }); // meaningless for ANIMAL_WISE — locking is per-stage below

          const initialLots: Record<string, string> = {};
          const initialBags: Record<string, string> = {};
          for (const stage of stages) {
            (stage.animals || []).forEach((animal: Row, animalIdx: number) => {
              for (const line of animal.lines || []) {
                const enteredStr = defaultEntryValue(line);
                const k = entryKey(line.line_id, animal.animal_id);
                values[k] = enteredStr;
                rememberChoices(line, k);
                if (line.already_entered_lot) {
                  initialLots[k] = line.already_entered_lot;
                }
                if (line.already_entered_empty_bags != null) initialBags[k] = String(line.already_entered_empty_bags);
                // The "All animals in this stage" broadcast view has no real
                // animal of its own to read an already-entered value from —
                // without this, a value saved via broadcast reappeared blank
                // the moment the page reloaded, even though it was saved for
                // every animal. The first animal in the stage stands in as
                // the template both here and in the broadcast row renderer.
                if (animalIdx === 0) {
                  rememberChoices(line, entryKey(line.line_id, '__ALL__'));
                  const pendingForAll = (stage.animals || []).filter((a: Row) => !a.is_posted).length || (stage.animals || []).length;
                  values[entryKey(line.line_id, '__ALL__')] =
                    enteredStr !== '' && isTotalBatch(line) && pendingForAll > 1
                      ? String(round4(Number(enteredStr) * pendingForAll))
                      : enteredStr;
                  if (line.already_entered_lot) {
                    initialLots[entryKey(line.line_id, '__ALL__')] =
                      line.already_entered_lot;
                  }
                  if (isMortalityLine(line)) {
                    // Deaths already saved for the stage's pending animals: the All-animals count is how many died.
                    values[entryKey(line.line_id, '__ALL__')] = String(
                      (stage.animals || []).filter((a: Row) =>
                        !a.is_posted && (a.lines || []).some((l: Row) => l.line_id === line.line_id && Number(l.already_entered_qty) >= 1),
                      ).length,
                    );
                  }
                  if (line.already_entered_empty_bags != null) initialBags[entryKey(line.line_id, '__ALL__')] = String(line.already_entered_empty_bags);
                }
              }
            });
          }
          setDataEntryLotNos(initialLots);
          setDataEntryEmptyBags(initialBags);

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
            return anyActive?.stage_id || stages[0]?.stage_id || null;
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
          const stages: Row[] = schedData?.stages ?? [];
          const progress: Row[] = schedData?.progress ?? [];
          setDataEntryLines(lines);
          setDataEntryStages(stages);
          setDataEntryProgress(progress);
          setNoScheduler(lines.length === 0);
          if (schedData?.selected_stage_id) {
            setSelectedStageId(schedData.selected_stage_id);
          } else if (stages.length > 0 && !selectedStageId) {
            setSelectedStageId(stages[0].stage_id);
          }
          const initialLots: Record<string, string> = {};
          const initialBags: Record<string, string> = {};
          for (const l of lines) {
            values[entryKey(l.line_id)] = defaultEntryValue(l);
            rememberChoices(l, entryKey(l.line_id));
            if (l.already_entered_empty_bags != null) initialBags[entryKey(l.line_id)] = String(l.already_entered_empty_bags);
            if (l.already_entered_lot) {
              initialLots[entryKey(l.line_id)] = l.already_entered_lot;
            }
          }

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

            if (!userPickedDateRef.current) {
              setSelectedDate(dayAfter);
              setDataEntryValues(values);
              setDataEntryLoading(false);
              return;
            }
          }
          setDataEntryLotNos(initialLots);
          setDataEntryEmptyBags(initialBags);
        }

        setDataEntryValues(values);
        setDataEntryTexts({});
        setDataEntryDestBatches(initialDests);
        setDataEntryPoolBoars(initialPools);
        setDataEntryOutputItems(initialItems);

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
                    closingKept: batchData.closing_quantity != null,
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

        setDataEntryLoading(false);
        setStockVersion((v) => v + 1);
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
  }, [selectedStageId, selectedDate]);

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
  const loadBatchAnimalRoster = () => {
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
  };

  useEffect(loadBatchAnimalRoster, [currentBatch?.id]);

  // Calculated Dynamic Metrics
  const batchMortality = currentBatch?.mortalityCount ?? 0;
  // The closing quantity already falls with every death (a mortality posting lowers it), so subtracting the deaths
  // again counted them twice. Only a batch without one is opening less deaths.
  const currentHeadCount = currentBatch
    ? currentBatch.closingKept
      ? currentBatch.currentCount
      : Math.max(0, currentBatch.currentCount - batchMortality)
    : 0;

  const dataEntryCanSave = (line: Row, animalId?: string) => {
    const key = entryKey(line.line_id, animalId);
    if (isTextCapture(line)) return !!dataEntryTexts[key];
    const rawValue = dataEntryValues[key];
    if (rawValue === undefined || rawValue === '') return false;
    if (!mortalityOk(mortalityNeed(line, animalId))) return false;
    const isTracked = drawsFromLots(line);
    if (isTracked) {
      if (line.is_serial_tracked && animalId === '__ALL__') {
        const pending = (selectedStage?.animals || []).filter((a: Row) => !a.is_posted);
        if (pending.length === 0) return false;
        const allAssigned = pending.every((a: Row) => Boolean(dataEntryLotNos[entryKey(line.line_id, a.animal_id)]));
        if (!allAssigned) return false;
      } else if (!dataEntryLotNos[key]) {
        return false;
      }
    }
    if (line.line_type === 'TRANSFER' && !dataEntryDestBatches[key])
      return false;
    // An output posts the item chosen for it — it cannot post without one.
    if (line.line_type === 'OUTPUT' && !(dataEntryOutputItems[key] || line.item_id))
      return false;
    return true;
  };



  // Collect and save all filled input fields as draft entries so they exist in batch_daily_data
  const saveDraftEntries = async (): Promise<number> => {
    if (!currentBatch) return 0;
    const buildPayload = (line: Row, key: string, animalId?: string): Row => {
      const payload: Row = {
        line_id: line.line_id,
        entry_date: selectedDate,
        draft: true,
      };
      if (animalId) payload.animal_id = animalId;
      if (isTextCapture(line)) payload.entered_text = dataEntryTexts[key];
      else payload.entered_value = Number(dataEntryValues[key]);
      const isTracked = drawsFromLots(line);
      if (isTracked) {
        if (line.is_serial_tracked) {
          const serialKey = animalId ? entryKey(line.line_id, animalId) : key;
          payload.serial_no = dataEntryLotNos[serialKey] || dataEntryLotNos[key];
          if (payload.serial_no) {
            const count = payload.serial_no.split(',').map((s: string) => s.trim()).filter(Boolean).length;
            if (count > 0) {
              payload.entered_value = count;
            }
          }
        } else {
          payload.lot_no = dataEntryLotNos[key];
        }
      }
      if (line.line_type === 'TRANSFER')
        payload.destination_batch_id = dataEntryDestBatches[key];
      const need = mortalityNeed(line, animalId);
      if (need && need.kind !== 'ALL' && need.required > 0) payload.mortality_animals = mortalityPayload(need.picks);
      if (line.line_type === 'OUTPUT') {
        const chosen = dataEntryOutputItems[key];
        if (chosen && chosen !== line.item_id) payload.item_id = chosen;
        // A weaning entered as output may send the weaned piglets on to a batch.
        if (dataEntryDestBatches[key]) payload.destination_batch_id = dataEntryDestBatches[key];
        // A boar's collection pooled with other boars: one lot is mixed from all of them.
        if (dataEntryPoolBoars[key]?.length) payload.pool_animal_ids = dataEntryPoolBoars[key];
      }
      const bags = dataEntryEmptyBags[key];
      if (line.is_bagged_feed && bags !== undefined && bags !== '' && Number.isInteger(Number(bags)) && Number(bags) >= 0) {
        payload.empty_bags = Number(bags);
      }
      return payload;
    };
    const tasks: Promise<any>[] = [];

    if (isAnimalWise) {
      if (!selectedStage) return 0;
      if (entryScope === 'ALL') {
        const templateAnimal = (selectedStage.animals || [])[0];
        const lines: Row[] = templateAnimal?.lines || [];
        // Only save draft entries for animals that are NOT yet posted
        const pendingAnimals = (selectedStage.animals || []).filter(
          (a: Row) => !a.is_posted,
        );
        const animalIds = pendingAnimals.map((a: Row) => a.animal_id);
        for (const line of lines) {
          // Each animal's output is its own event (a litter, a collection): it is entered per animal, never broadcast.
          if (line.line_type === 'OUTPUT') continue;
          if (!dataEntryCanSave(line, '__ALL__')) continue;
          const key = entryKey(line.line_id, '__ALL__');
          // A per-batch line holds the stage total here: each animal gets its share of it.
          const shares = isTotalBatch(line) && !isTextCapture(line) ? splitTotal(Number(dataEntryValues[key]), animalIds.length) : null;
          // Mortality for all animals: each chosen animal records its own death with its weight and reason, the rest 0.
          const mortAll = mortalityNeed(line, '__ALL__');
          animalIds.forEach((animalId: string, i: number) => {
            const payload = buildPayload(line, key, animalId);
            if (shares) payload.entered_value = shares[i];
            if (mortAll?.kind === 'ALL') {
              const pick = mortAll.picks.find((p) => p.animal_id === animalId);
              payload.entered_value = pick ? 1 : 0;
              if (pick) payload.mortality_animals = mortalityPayload([{ ...pick, animal_id: '' }]);
              else delete payload.mortality_animals;
            }
            tasks.push(api.post(`/batch/${currentBatch.id}/daily-data`, payload));
          });
        }
      } else {
        const animal = (selectedStage.animals || []).find(
          (a: Row) => a.animal_id === entryScope,
        );
        if (animal?.is_posted) {
          // Animal already posted on this date — do not overwrite posted entries with drafts
          return 0;
        }
        const lines: Row[] = animal?.lines || [];
        for (const line of lines) {
          if (!dataEntryCanSave(line, entryScope)) continue;
          const key = entryKey(line.line_id, entryScope);
          tasks.push(
            api.post(
              `/batch/${currentBatch.id}/daily-data`,
              buildPayload(line, key, entryScope),
            ),
          );
        }
      }
    } else {
      for (const line of dataEntryLines) {
        if (!dataEntryCanSave(line, undefined)) continue;
        const key = entryKey(line.line_id, undefined);
        tasks.push(
          api.post(
            `/batch/${currentBatch.id}/daily-data`,
            buildPayload(line, key, undefined),
          ),
        );
      }
    }

    if (!tasks.length) return 0;
    const results = await Promise.allSettled(tasks);
    return results.filter((r) => r.status === 'fulfilled').length;
  };

  const handleSaveAllToDraft = async () => {
    if (!currentBatch) return;
    if (selectedDate > todayStr) {
      setSaveErrorMsg(
        `Cannot save draft for future date (${selectedDate}). Today is ${todayStr}.`,
      );
      return;
    }
    setSavingAllDraft(true);
    setSaveErrorMsg('');
    try {
      const savedCount = await saveDraftEntries();
      if (!savedCount) {
        setSaveErrorMsg('Nothing to save — enter at least one value first.');
        return;
      }
      setSaveSuccessMsg(
        `✓ Saved ${savedCount} ${savedCount === 1 ? 'entry' : 'entries'} to draft.`,
      );
      setTimeout(() => setSaveSuccessMsg(''), 3500);
      loadDataEntry();
    } catch (err: any) {
      setSaveErrorMsg(err?.message || 'Failed to save drafts.');
    } finally {
      setSavingAllDraft(false);
    }
  };

  const handlePostStageDay = async () => {
    if (!currentBatch || !selectedStageId) return;
    if (selectedDate > todayStr) {
      setStageActionError(
        `Cannot post data entry for future date (${selectedDate}). Today is ${todayStr}.`,
      );
      setSaveErrorMsg(
        `Cannot post data entry for future date (${selectedDate}). Today is ${todayStr}.`,
      );
      return;
    }

    const stageAnimals: Row[] = selectedStage?.animals || [];
    if (entryScope !== 'ALL') {
      const match = stageAnimals.find((a: Row) => a.animal_id === entryScope);
      if (match?.is_posted) {
        const msg = `Data entry for animal ${match.animal_code} has already been posted on ${selectedDate}.`;
        setStageActionError(msg);
        setSaveErrorMsg(msg);
        return;
      }
    } else {
      const pendingCount = stageAnimals.filter((a: Row) => !a.is_posted).length;
      // Every animal posted but the stage never locked: posting locks it, so the date can move on (13 Oct).
      if (stageAnimals.length > 0 && pendingCount === 0 && selectedStage?.lock_status === 'LOCKED') {
        const msg = `All animals in this stage have already been posted on ${selectedDate}.`;
        setStageActionError(msg);
        setSaveErrorMsg(msg);
        return;
      }
    }

    setStageActionBusy(true);
    setStageActionError('');
    try {
      // Auto-save any entered values as draft before posting so backend receives complete data
      await saveDraftEntries();

      const isSingleAnimal = entryScope !== 'ALL';
      const animalObj = isSingleAnimal
        ? selectedStage?.animals?.find((a: Row) => a.animal_id === entryScope)
        : null;
      const animalCode = animalObj?.animal_code || 'animal';

      const postUrl = isSingleAnimal
        ? `/batch/${currentBatch.id}/stage/${selectedStageId}/post-day?date=${selectedDate}&animalId=${entryScope}`
        : `/batch/${currentBatch.id}/stage/${selectedStageId}/post-day?date=${selectedDate}`;

      const res: any = await api.post(postUrl, {});
      const isStageLocked = res?.data?.stage_locked ?? !isSingleAnimal;

      if (isSingleAnimal && !isStageLocked) {
        setSaveSuccessMsg(`✓ Data posted for ${animalCode}.`);
        setTimeout(() => setSaveSuccessMsg(''), 4000);
        loadDataEntry();
        loadPostedDates();
        return;
      }

      // Check remaining unposted stages with animals for this date
      const activeStages = dataEntryStages.filter(
        (s) => (s.animal_count ?? 0) > 0,
      );
      const remainingUnposted = activeStages.filter(
        (s) => s.stage_id !== selectedStageId && s.lock_status !== 'LOCKED',
      );

      if (remainingUnposted.length > 0) {
        // More stages still need data entry on this date: switch to next stage, stay on date
        const nextStage = remainingUnposted[0];
        setSelectedStageId(nextStage.stage_id);
        setSaveSuccessMsg(
          `✓ Stage posted. Switched to ${nextStage.stage_name || 'next stage'} to complete entry for ${selectedDate}.`,
        );
        setTimeout(() => setSaveSuccessMsg(''), 5000);
        loadDataEntry();
        loadPostedDates();
      } else {
        // ALL stages for this date are completed and posted! Automatically advance posting date
        const [y, m, d] = selectedDate.split('-').map(Number);
        const nextDate = new Date(Date.UTC(y, m - 1, d + 1))
          .toISOString()
          .slice(0, 10);
        userPickedDateRef.current = false;

        setSaveSuccessMsg(
          `✓ All stages posted for ${selectedDate}. Moved to ${nextDate} for the next entry.`,
        );
        setTimeout(() => setSaveSuccessMsg(''), 5000);
        // Clear previous entries so stale inputs don't linger on new date
        setDataEntryValues({});
        setDataEntryTexts({});
        setDataEntryLotNos({});
        setDataEntryEmptyBags({});
        setDataEntryDestBatches({});
        setDataEntryPoolBoars({});
        setSelectedDate(nextDate);
        loadPostedDates();
      }
    } catch (err: any) {
      const errMsg =
        err?.message || err?.error || 'Could not post stage data.';
      setStageActionError(
        typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
      );
    } finally {
      setStageActionBusy(false);
    }
  };

  const handleReopenStageDay = async () => {
    if (!currentBatch || !selectedStageId || !reopenReason.trim()) return;
    setStageActionBusy(true);
    setStageActionError('');
    try {
      const res: any = await api.post(
        `/batch/${currentBatch.id}/stage/${selectedStageId}/reopen?date=${selectedDate}`,
        { reason: reopenReason },
      );
      const done = res?.data ?? res;
      setReopenNotice({ unposted: Number(done?.unposted ?? 0), kept: done?.kept_posted ?? [] });
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

  // A reopen's result belongs to the stage and day it was made on.
  useEffect(() => {
    setReopenNotice(null);
  }, [currentBatch?.id, selectedStageId, selectedDate]);

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
      loadBatchAnimalRoster();
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
    if (selectedDate > todayStr) {
      setSaveErrorMsg(
        `Cannot post data entry for future date (${selectedDate}). Today is ${todayStr}.`,
      );
      return;
    }
    setPosting(true);
    setSaveErrorMsg('');
    try {
      // Auto-save any entered values as draft before posting
      await saveDraftEntries();

      await api.post(`/batch/${currentBatch.id}/post-day?date=${selectedDate}`);
      const [y, m, d] = selectedDate.split('-').map(Number);
      const nextDate = new Date(Date.UTC(y, m - 1, d + 1))
        .toISOString()
        .slice(0, 10);
      userPickedDateRef.current = false;

      setSaveSuccessMsg(
        `✓ ${selectedDate} posted and locked for batch ${currentBatch.code}. Moved to ${nextDate} for the next entry.`,
      );
      setDataEntryValues({});
      setDataEntryTexts({});
      setDataEntryLotNos({});
      setDataEntryEmptyBags({});
      setDataEntryDestBatches({});
      setDataEntryMortality({});
      setDataEntryPoolBoars({});
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

  // General-notes quick capture — plain OBSERVATION
  // transactions (no cost, no GL, no inventory ledger — see addTransaction()'s
  // own comment), so they post immediately rather than joining the
  // draft/post cycle above.
  const handleSaveNotes = async () => {
    if (!currentBatch || !generalNotes.trim()) return;
    if (selectedDate > todayStr) {
      setSaveErrorMsg(
        `Cannot record note for future date (${selectedDate}). Today is ${todayStr}.`,
      );
      return;
    }
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

  // Whole-batch manual stage change (BATCH_WISE) — filters to valid next stage(s)
  // in the pipeline and validates against Min Days Before Move rule.
  const openChangeStage = async () => {
    if (!currentBatch) return;
    const defaultDest =
      stageTransition?.next_stage?.stage_code ||
      stageTransition?.valid_next_stages?.[0]?.stage_code ||
      '';
    setChangeStageForm({ to_stage_code: defaultDest, remarks: '' });
    setChangeStageError('');
    setChangeStageOpen(true);

    if (
      stageTransition?.valid_next_stages &&
      stageTransition.valid_next_stages.length > 0
    ) {
      setChangeStageOptions(
        Array.from(
          new Set(stageTransition.valid_next_stages.map((s) => s.stage_code)),
        ),
      );
      return;
    }

    if (!currentBatch.lobId) return;
    setChangeStageOptionsLoading(true);
    try {
      const stageRows =
        unwrap<Row[]>(
          await api.get(
            `/stage?lobId=${currentBatch.lobId}&isActive=true&limit=200`,
          ),
        ) || [];
      const currentSeq = stageMasterList.find(
        (s) => s.stage_code === currentBatch.currentStageCode,
      )?.stage_sequence;
      const filtered = stageRows.filter((s: Row) => {
        if (!s.stage_code || s.stage_code === currentBatch.currentStageCode)
          return false;
        if (currentSeq !== undefined && s.stage_sequence !== undefined) {
          return s.stage_sequence > currentSeq;
        }
        return true;
      });
      const codes = Array.from(
        new Set(filtered.map((s: Row) => s.stage_code)),
      ) as string[];
      setChangeStageOptions(codes);
      if (!defaultDest && codes.length > 0) {
        setChangeStageForm((f) => ({ ...f, to_stage_code: codes[0] }));
      }
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

      if (
        stageTransition &&
        !stageTransition.can_move_without_remarks &&
        !changeStageForm.remarks?.trim()
      ) {
        throw new Error(
          `Minimum duration of ${stageTransition.min_days_before_move} days is required for '${stageTransition.current_stage_name}' before transition (currently on day ${stageTransition.days_in_stage}). Justification / Remarks are mandatory to override.`,
        );
      }

      const schedulerSource = await askSchedulerSource(changeStageForm.to_stage_code);
      if (schedulerSource === null) return;
      await api.post(`/batch/${currentBatch.id}/transfer-stage`, {
        to_stage_code: changeStageForm.to_stage_code,
        remarks: changeStageForm.remarks || undefined,
        scheduler_source: schedulerSource,
      });
      setChangeStageOpen(false);
      setSaveSuccessMsg(
        `Batch successfully transferred to stage ${changeStageForm.to_stage_code}.`,
      );
      loadDataEntry();
    } catch (err: any) {
      setChangeStageError(err?.message || t('blErrTransferStage'));
    } finally {
      setChangeStageSaving(false);
    }
  };

  const handleAutoTransitionNow = async () => {
    if (!currentBatch || !stageTransition?.next_stage) return;
    setAutoTransitionSaving(true);
    setAutoTransitionError('');
    try {
      const schedulerSource = await askSchedulerSource(stageTransition.next_stage.stage_code);
      if (schedulerSource === null) return;
      await api.post(`/batch/${currentBatch.id}/transfer-stage`, {
        to_stage_code: stageTransition.next_stage.stage_code,
        remarks: 'Automatic stage transition trigger (AUTO_BY_DAY)',
        scheduler_source: schedulerSource,
      });
      setAutoTransitionModalOpen(false);
      setSaveSuccessMsg(
        `Batch successfully transferred to ${stageTransition.next_stage.stage_name} (${stageTransition.next_stage.stage_code}).`,
      );
      loadDataEntry();
    } catch (err: any) {
      setAutoTransitionError(
        err?.message || 'Failed to complete stage transition.',
      );
    } finally {
      setAutoTransitionSaving(false);
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

  if (batches.length === 0 || !currentBatch) {
    return (
      <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
        <div
          className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-12 text-center text-xs"
          style={S.sub}
        >
          <Inbox className="mx-auto mb-3 h-8 w-8" style={S.muted} />
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
            {t('deNoBatches')}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {t('deNoBatchesBody')}
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
        {/* Code and name are two columns (Rishi, 14 Oct). */}
        <TableHead className="h-auto px-3 py-2">Item No.</TableHead>
        <TableHead className="h-auto px-3 py-2">{t('blColItem')}</TableHead>
        <TableHead className="h-auto px-3 py-2">{t('blColUom')}</TableHead>
        <TableHead className="h-auto px-3 py-2">
          {t('blColOccurrence')}
        </TableHead>
        <TableHead className="h-auto px-3 py-2">{t('blColExpected')}</TableHead>
        <TableHead className="h-auto px-3 py-2">{t('blColActual')}</TableHead>
      </tr>
    </TableHeader>
  );

  // The name half of a "CODE — Name" label.
  const nameOf = (label?: string | null) => (label ? label.split(' — ').slice(1).join(' — ') || label : '—');

  const renderDataEntryRow = (
    line: Row,
    animalId?: string,
    rowLocked?: boolean,
    broadcast?: boolean,
  ) => {
    const key = entryKey(line.line_id, animalId);
    const allowEdit = line.allow_qty_edit !== false;
    const isOutput = line.line_type === 'OUTPUT';
    // Outputs are entered animal by animal (each is its own litter or collection), never for the whole stage at once.
    const outputForAll = isOutput && animalId === '__ALL__';
    const isRowDisabled = rowLocked || !allowEdit || outputForAll;
    // What an output for this one animal posts as (the API decides; the same rule posts it).
    // Once the entry is posted the row shows what it did (entry_note), not what a new entry would do.
    const outputEvent: Row | null =
      isOutput && !line.is_entry_posted && animalId && animalId !== '__ALL__'
        ? (selectedStage?.animals || []).find((a: Row) => a.animal_id === animalId)?.output_event ?? null
        : null;
    const chosenItemId = dataEntryOutputItems[key] ?? line.item_id ?? '';
    const itemChoices =
      line.item_id && !outputItemOptions.some((o) => o.value === line.item_id)
        ? [{ value: line.item_id, label: line.item_label || line.item_id, bio: false }, ...outputItemOptions]
        : outputItemOptions;
    const chosenItem = itemChoices.find((o) => o.value === chosenItemId);
    const actualNumericVal =
      line.is_serial_tracked && dataEntryValues[key] !== undefined
        ? dataEntryValues[key]
        : !allowEdit && line.expected_qty != null
        ? String(line.expected_qty)
        : (dataEntryValues[key] ??
          (line.expected_qty != null ? String(line.expected_qty) : ''));

    return (
      <TableRow key={key}>
        <TableCell className="px-3 py-2" style={S.primary}>
          {line.activity_name}
          {outputEvent && (
            <span className="block text-[10px] font-normal" style={S.muted}>
              {outputEventLabel(outputEvent, chosenItem?.bio)}
            </span>
          )}
          {outputEvent?.kind === 'SEMEN' && !rowLocked && (() => {
            // Other boars of this stage whose semen can be mixed into this lot. One with an entry of his own on this line
            // is left out — his doses would be counted twice.
            const picked = dataEntryPoolBoars[key] || [];
            const others = (selectedStage?.animals || []).filter(
              (a: Row) =>
                a.animal_id !== animalId &&
                a.output_event?.kind === 'SEMEN' &&
                !a.is_posted &&
                ((dataEntryValues[entryKey(line.line_id, a.animal_id)] ?? '') === '' || picked.includes(a.animal_id)),
            );
            if (!others.length) return null;
            return (
              <div className="mt-1.5 min-w-[200px]">
                <EntityLookupField
                  id={`pool-${key}`}
                  label="Boars to pool"
                  options={others.map((a: Row) => ({ animal_id: a.animal_id, code: a.animal_code, name: a.animal_code }))}
                  value={picked}
                  valueKey="animal_id"
                  labelKeys={['code']}
                  onChange={(next) =>
                    setDataEntryPoolBoars((v) => ({ ...v, [key]: Array.isArray(next) ? next : next ? [next] : [] }))
                  }
                  multiple
                  placeholder="Pool with other boars…"
                />
                {picked.length > 0 && (
                  <p className="mt-1 text-[10px] leading-snug" style={S.muted}>
                    One lot from {picked.length + 1} boars: the doses entered are the whole mix.
                  </p>
                )}
              </div>
            );
          })()}
          {outputForAll && (
            <span className="block text-[10px] font-normal" style={S.muted}>
              Enter outputs one animal at a time — pick the animal above.
            </span>
          )}
        </TableCell>
        <TableCell className="px-3 py-2 whitespace-nowrap" style={S.sub}>
          {(() => {
            const chosen = isOutput ? itemChoices.find((o) => o.value === (line.already_entered_item_id || chosenItemId)) : undefined;
            return (chosen ? chosen.label.split(' — ')[0] : line.item_code) || '—';
          })()}
        </TableCell>
        <TableCell className="px-3 py-2" style={S.sub}>
          {isOutput && !rowLocked && !line.is_entry_posted && !outputForAll ? (
            <div className="min-w-[180px]">
              <SearchableSelect
                ariaLabel="Output item"
                value={chosenItemId}
                onChange={(val) =>
                  setDataEntryOutputItems((v) => ({ ...v, [key]: val }))
                }
                options={itemChoices}
                placeholder="Choose the item taken out…"
                searchPlaceholder="Search items…"
              />
            </div>
          ) : isOutput && line.already_entered_item_id ? (
            nameOf(itemChoices.find((o) => o.value === line.already_entered_item_id)?.label || line.item_label)
          ) : (
            nameOf(line.item_label) || line.item_description || '—'
          )}
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
          <div className="flex flex-col">
            <span>
              {Number(line.expected_qty).toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })}
            </span>
            {line.qty_basis === 'PER_BATCH' && (
              <span className="text-[10px] text-[var(--text-muted)] font-normal">
                (Per Batch)
              </span>
            )}
          </div>
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
              className={`${inputCls} ${!allowEdit ? 'opacity-75 bg-[var(--surface-muted)] cursor-not-allowed' : ''}`}
              style={S.input}
              disabled={isRowDisabled}
              title={!allowEdit ? 'Quantity edit disabled in scheduler' : undefined}
            />
          ) : (
            <div className="relative flex items-center">
              <input
                type="number"
                min={isMortalityLine(line) ? 0 : undefined}
                max={isMortalityLine(line) && animalId && animalId !== '__ALL__' ? 1 : undefined}
                step={isMortalityLine(line) ? 1 : undefined}
                value={actualNumericVal}
                readOnly={line.is_serial_tracked}
                onChange={(e) =>
                  setDataEntryValues((v) => ({ ...v, [key]: e.target.value }))
                }
                className={`${inputCls} ${!allowEdit || line.is_serial_tracked ? 'opacity-90 bg-[var(--surface-muted)] cursor-not-allowed pr-6' : ''}`}
                style={S.input}
                disabled={isRowDisabled}
                title={
                  line.is_serial_tracked
                    ? 'Quantity is automatically set by the number of selected serial numbers'
                    : !allowEdit
                    ? 'Quantity edit disabled in scheduler'
                    : undefined
                }
              />
              {!allowEdit && (
                <Lock className="w-3 h-3 text-[var(--text-muted)] absolute right-2 pointer-events-none" />
              )}
            </div>
          )}
          {drawsFromLots(line) && (
            <div className="mt-1">
              {broadcast && line.is_serial_tracked ? (() => {
                const pendingStageAnimals = (selectedStage?.animals || []).filter((a: Row) => !a.is_posted);
                const totalPending = pendingStageAnimals.length;
                const assignedCount = totalPending > 0
                  ? pendingStageAnimals.filter(
                      (a: Row) => Boolean(dataEntryLotNos[entryKey(line.line_id, a.animal_id)])
                    ).length
                  : (selectedStage?.animals || []).filter(
                      (a: Row) => Boolean(dataEntryLotNos[entryKey(line.line_id, a.animal_id)])
                    ).length;
                const isAllAssigned = totalPending > 0 && assignedCount === totalPending;
                return (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSerialModalLine(line)}
                    className="h-8 text-xs gap-1.5 w-full justify-between"
                    disabled={rowLocked}
                  >
                    <span className={`truncate font-medium ${isAllAssigned ? 'text-emerald-600 dark:text-emerald-400' : assignedCount > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                      {totalPending === 0
                        ? `Serials Assigned (${assignedCount})`
                        : isAllAssigned
                        ? `✓ Serials Assigned (${assignedCount}/${totalPending})`
                        : assignedCount > 0
                        ? `Assign Serials (${assignedCount}/${totalPending})`
                        : `Assign Serials… (${totalPending})`}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-70 shrink-0" />
                  </Button>
                );
              })() : (
                <ConsumptionLotPicker
                  batchId={currentBatch?.id}
                  lineId={line.line_id}
                  refreshKey={stockVersion}
                  quantity={(Number(dataEntryValues[key]) || 0) * (animalId === '__ALL__' && !isTotalBatch(line) ? pendingStageAnimalCount : 1)}
                  itemId={line.item_id || ''}
                  warehouseId={(currentBatch as any)?.warehouse_id}
                  trackingType={line.is_serial_tracked ? 'SERIAL' : 'LOT'}
                  multiSelect
                  targetQuantity={line.expected_qty != null ? Number(line.expected_qty) : undefined}
                  value={dataEntryLotNos[key] ?? ''}
                  align="end"
                  onChange={(val) => {
                    setDataEntryLotNos((v) => ({ ...v, [key]: val }));
                    if (line.is_serial_tracked) {
                      const count = val ? val.split(',').map((s) => s.trim()).filter(Boolean).length : 0;
                      setDataEntryValues((v) => ({ ...v, [key]: count > 0 ? String(count) : '' }));
                    }
                  }}
                  disabled={rowLocked}
                  placeholder={line.is_serial_tracked ? 'Select Serial No.…' : (t('blPlaceholderLotNo') || 'Select Lot No.…')}
                />
              )}
            </div>
          )}
          {(() => {
            const need = mortalityNeed(line, animalId);
            if (!need || need.required <= 0) return null;
            if (need.kind === 'ANIMAL' && need.required > 1) {
              return (
                <p className="mt-1 text-xs font-medium text-red-600" data-testid="mortality-animal-wise-blocked">
                  {t('deMortOneAnimal')}
                </p>
              );
            }
            return (
              <MortalityAnimalsField
                animals={need.animals}
                deadAnimals={need.dead}
                fixedLabel={need.kind === 'ANIMAL' ? need.label || t('deMortThisAnimal') : undefined}
                required={need.required}
                picks={need.picks}
                onChange={(next) => setDataEntryMortality((v) => ({ ...v, [need.key]: next }))}
                disabled={rowLocked}
              />
            );
          })()}
          {line.line_type === 'TRANSFER' && (
            <div className="mt-1 min-w-[160px]">
              <SearchableSelect
                ariaLabel={t('blPlaceholderDestBatch')}
                value={dataEntryDestBatches[key] ?? ''}
                onChange={(val) =>
                  setDataEntryDestBatches((v) => ({
                    ...v,
                    [key]: val,
                  }))
                }
                options={batches
                  .filter((b) => b.id !== currentBatch?.id)
                  .map((b) => ({
                    value: b.id,
                    label: b.code,
                  }))}
                placeholder={t('blPlaceholderDestBatch')}
                searchPlaceholder="Search batches…"
                disabled={rowLocked}
              />
            </div>
          )}
          {outputEvent?.kind === 'WEANING' && outputEvent.piglet_batch_id && chosenItem?.bio && (
            <div className="mt-1 min-w-[160px]">
              <SearchableSelect
                ariaLabel="Move weaned piglets to"
                value={dataEntryDestBatches[key] ?? ''}
                onChange={(val) =>
                  setDataEntryDestBatches((v) => ({ ...v, [key]: val }))
                }
                onClear={() =>
                  setDataEntryDestBatches((v) => {
                    const next = { ...v };
                    delete next[key];
                    return next;
                  })
                }
                options={batches
                  .filter((b) => b.id !== currentBatch?.id && b.id !== outputEvent.piglet_batch_id)
                  .map((b) => ({ value: b.id, label: b.code }))}
                placeholder="Keep in their lot, or move to…"
                searchPlaceholder="Search batches…"
                disabled={rowLocked}
              />
            </div>
          )}
          {line.entry_note && (
            <p className="mt-1 text-[10px] leading-snug" style={S.muted}>
              {line.entry_note}
            </p>
          )}
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
          // In the "All animals" view a per-head value is each animal's own, so what is consumed is the
          // value times the animals still to post; a per-batch value is already the stage total.
          const allViewAnimals = animalId === '__ALL__'
            ? (selectedStage?.animals || []).filter((a: Row) => !a.is_posted).length || (selectedStage?.animals || []).length
            : 1;
          const total = canTotal
            ? box.lines.reduce((sum, l) => {
                const v = Number(
                  dataEntryValues[entryKey(l.line_id, animalId)],
                );
                return sum + (Number.isFinite(v) ? v * (isTotalBatch(l) || (animalId === '__ALL__' && isMortalityLine(l)) ? 1 : allViewAnimals) : 0);
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
                      <span style={S.muted}>
                        Total{allViewAnimals > 1 ? ` (${allViewAnimals} animals)` : ''}:
                      </span>
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
                <div className="w-80">
                  <SearchableSelect
                    ariaLabel={t('activeProductionBatch')}
                    value={selectedBatchId}
                    onChange={(val) => {
                      userPickedDateRef.current = false;
                      setSelectedStageId(null);
                      setSelectedBatchId(val);
                    }}
                    options={batches.map((b) => ({
                      value: b.id,
                      label: `${b.code}${b.parentBatchId ? ' ↳ split group' : ''} — ${b.name} (${b.breed})`,
                    }))}
                    placeholder={t('activeProductionBatch')}
                    searchPlaceholder="Search batches…"
                  />
                </div>
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
              {dataEntryProgress.length > 0 ? (
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
                        const isActive =
                          p.stage_code === currentBatch?.currentStageCode ||
                          p.stage_id === (stageTransition?.current_stage_id || selectedStageId);
                        const isNextEligible =
                          !isActive &&
                          stageTransition?.valid_next_stages?.some(
                            (s) => s.stage_id === p.stage_id,
                          );
                        return (
                          <div
                            key={p.stage_id}
                            className={`flex min-w-0 flex-col items-center group flex-1 ${
                              isActive
                                ? 'cursor-default'
                                : isNextEligible
                                  ? 'cursor-pointer opacity-85 hover:opacity-100'
                                  : 'cursor-not-allowed opacity-50'
                            }`}
                            onClick={() => {
                              if (isNextEligible) {
                                openChangeStage();
                              }
                            }}
                            title={
                              isActive
                                ? `${p.stage_name} (Active Stage for this batch)`
                                : isNextEligible
                                  ? `Click to transfer batch to ${p.stage_name}`
                                  : `${p.stage_name} (Inactive — Only one stage active at a time)`
                            }
                          >
                            <button
                              type="button"
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-200 ${
                                isActive
                                  ? 'bg-[var(--accent)] text-white ring-4 ring-[var(--accent-muted)] shadow-md scale-110'
                                  : isNextEligible
                                    ? 'bg-[var(--surface)] border-2 border-[var(--accent-muted)] text-[var(--accent)] group-hover:border-[var(--accent)] shadow-2xs'
                                    : 'bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text-muted)]'
                              }`}
                            >
                              {p.stage_sequence || '•'}
                            </button>
                            <div className="mt-2.5 text-center flex flex-col items-center w-full px-0.5">
                              <p
                                className={`text-xs tracking-tight truncate w-full ${
                                  isActive
                                    ? 'text-[var(--accent)] font-bold'
                                    : 'text-[var(--text-secondary)] font-medium'
                                }`}
                                title={p.stage_name}
                              >
                                {p.stage_name}
                              </p>
                              {isActive ? (
                                <span className="text-[10px] text-[var(--accent)] font-bold mt-0.5 inline-flex items-center gap-1">
                                  ● Active ({p.animal_count} head)
                                </span>
                              ) : (
                                <span className="text-[10px] text-[var(--text-muted)] mt-0.5">
                                  {p.animal_count} head
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Active Stage & Stage Transfer Controller Bar */}
                  <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[var(--text-secondary)]">
                        Single Active Stage:
                      </span>
                      <span className="font-bold text-[var(--accent)] px-2.5 py-0.5 rounded bg-[var(--accent-muted)]/20 border border-[var(--accent-muted)]">
                        {stageTransition?.current_stage_name || currentBatch?.currentStage || 'Current Stage'}
                      </span>
                      {stageTransition && (
                        <div className="flex items-center gap-2 text-[var(--text-secondary)] flex-wrap">
                          <span>• Day <strong>{stageTransition.days_in_stage}</strong></span>
                          <span>• Min Days Rule: <strong>{stageTransition.min_days_before_move}d</strong></span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              stageTransition.can_move_without_remarks
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {stageTransition.can_move_without_remarks
                              ? '✓ Minimum Days Satisfied'
                              : `Hold: ${Math.max(0, stageTransition.min_days_before_move - stageTransition.days_in_stage)}d remaining (remarks required)`}
                          </span>
                        </div>
                      )}
                    </div>

                    {(!noScheduler || dataEntryLines.length > 0 || dataEntryProgress.length > 0) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openChangeStage}
                        className="h-7 text-xs gap-1.5 font-semibold shrink-0"
                        title="Transfer whole batch to the next valid stage"
                      >
                        <ArrowRightCircle className="h-3.5 w-3.5" /> Transfer Stage
                      </Button>
                    )}
                  </div>
                </div>
              ) : lifecycle.stages.length > 0 ? (
                <div className="space-y-3">
                  <PiggeryLifecycleStepper
                    stages={lifecycle.stages}
                    currentStageId={lifecycle.currentStageId}
                  />
                  <div className="flex items-center justify-between text-xs p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
                    <span className="font-semibold text-[var(--text-secondary)]">
                      Current Stage: <strong>{currentBatch?.currentStage}</strong> (Single active stage)
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openChangeStage}
                      className="h-7 text-xs gap-1.5 font-semibold"
                    >
                      <ArrowRightCircle className="h-3.5 w-3.5" /> Transfer Stage
                    </Button>
                  </div>
                </div>
              ) : currentBatch?.currentStage ? (
                <div className="flex items-center justify-between text-xs p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
                  <span className="font-semibold text-[var(--text-secondary)]">
                    Current Stage: <strong>{currentBatch?.currentStage}</strong> (Single active stage)
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openChangeStage}
                    className="h-7 text-xs gap-1.5 font-semibold"
                  >
                    <ArrowRightCircle className="h-3.5 w-3.5" /> Transfer Stage
                  </Button>
                </div>
              ) : null}
            </>
          )}

          {/* ── Date & Weather Bar ── */}
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-wrap items-end justify-between gap-4 shadow-2xs">
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <label className="nf-text-label mb-1 block text-[var(--text-muted)] font-semibold">
                  Posting Date <span className="text-[10px] text-[var(--accent)] font-normal">(Next Pending Date)</span>
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  disabled
                  readOnly
                  className="h-8 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-xs font-bold text-[var(--text-primary)] focus:outline-none opacity-90 cursor-not-allowed select-none"
                  title="Daily data entry is mandatory. The posting date always shows the next pending date and cannot be skipped."
                />
              </div>

              {postedDates.length > 0 && (
                <div>
                  <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                    History
                  </label>
                  <div className="w-56 sm:w-64">
                    <SearchableSelect
                      ariaLabel="History posted dates"
                      value=""
                      disabled={posting}
                      columnHeaders={false}
                      onChange={(val) => {
                        if (!val) return;
                        userPickedDateRef.current = true;
                        setSelectedDate(val);
                      }}
                      options={postedDays.map((d) => ({
                        value: d.date,
                        label: `${d.date}${d.stages.length ? ` — ${d.stages.join(', ')}` : ''}${d.reopened ? ' (reopened)' : ''}`,
                      }))}
                      placeholder={`${postedDays.length} posted date${postedDays.length === 1 ? '' : 's'} — view…`}
                      searchPlaceholder="Search dates…"
                    />
                  </div>
                </div>
              )}

              {userPickedDateRef.current && nextPendingDate && selectedDate !== nextPendingDate && (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 px-3 py-1 rounded-[var(--radius-sm)] text-xs h-8">
                  <span>Viewing Past Date: <strong>{selectedDate}</strong> (Read-only)</span>
                  <button
                    type="button"
                    onClick={() => {
                      userPickedDateRef.current = false;
                      setSelectedDate(nextPendingDate);
                    }}
                    className="font-bold underline ml-1 hover:text-amber-900 dark:hover:text-amber-200 cursor-pointer"
                  >
                    Return to Next Pending Date ({nextPendingDate})
                  </button>
                </div>
              )}

              {dataEntryLoading && (
                <div className="flex h-8 items-center">
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    style={S.accent}
                  />
                </div>
              )}
            </div>

            {!isAnimalWise && (
              <div className="flex items-center gap-2">
                {!locked && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSaveAllToDraft}
                    disabled={
                      savingAllDraft ||
                      posting ||
                      isFutureDate ||
                      (!!nextPendingDate && selectedDate !== nextPendingDate)
                    }
                    title={
                      isFutureDate
                        ? `Cannot save draft for future date (${selectedDate})`
                        : undefined
                    }
                    className="text-xs h-8 gap-1.5 font-semibold rounded-[var(--radius-sm)] shadow-2xs"
                  >
                    {savingAllDraft ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    {savingAllDraft ? 'Saving…' : 'Save to Draft'}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handlePostEntry}
                  disabled={
                    posting ||
                    mortalityIncomplete ||
                    locked ||
                    isFutureDate ||
                    (!!nextPendingDate && selectedDate !== nextPendingDate)
                  }
                  title={
                    mortalityIncomplete
                      ? t('deMortPostBlocked')
                      : isFutureDate
                      ? `Cannot post data entry for future date (${selectedDate}). Today is ${todayStr}.`
                      : !!nextPendingDate && selectedDate !== nextPendingDate
                        ? `Only the next pending date (${nextPendingDate}) can be posted.`
                        : undefined
                  }
                  className="nf-btn-primary text-xs h-8 gap-1.5 font-semibold rounded-[var(--radius-sm)] shadow-2xs"
                >
                  {posting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Lock className="w-3.5 h-3.5" />
                  )}
                  {locked
                    ? 'Posted & Locked'
                    : isFutureDate
                      ? 'Future Date — Cannot Post'
                      : nextPendingDate && selectedDate !== nextPendingDate
                        ? 'History Date — Read Only'
                        : posting
                          ? 'Posting…'
                          : 'Post Entry'}
                </Button>
              </div>
            )}

            {isAnimalWise && selectedStage && (
              <div className="flex items-center gap-2 flex-wrap">
                {selectedStage.lock_status === 'LOCKED' ? (
                  <span
                    className="text-xs font-semibold inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border h-8"
                    style={{
                      color: 'var(--success, #16a34a)',
                      borderColor: 'var(--border)',
                      backgroundColor: 'var(--surface-raised)',
                    }}
                  >
                    <Lock className="h-3.5 w-3.5" /> Posted & Locked
                  </span>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveAllToDraft}
                      disabled={savingAllDraft || stageActionBusy || isFutureDate}
                      title={
                        isFutureDate
                          ? `Cannot save draft for future date (${selectedDate})`
                          : undefined
                      }
                      className="text-xs h-8 gap-1.5 font-semibold rounded-[var(--radius-sm)] shadow-2xs"
                    >
                      {savingAllDraft ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      {savingAllDraft ? 'Saving…' : 'Save to Draft'}
                    </Button>
                    {(() => {
                      const stageAnimals: Row[] = selectedStage?.animals || [];
                      const postedAnimalsCount = stageAnimals.filter((a) => a.is_posted).length;
                      const pendingAnimalsCount = stageAnimals.length - postedAnimalsCount;
                      const currentAnimal = stageAnimals.find((a) => a.animal_id === entryScope);
                      const isCurrentAnimalPosted = entryScope !== 'ALL' && Boolean(currentAnimal?.is_posted);
                      const areAllAnimalsPosted = stageAnimals.length > 0 && pendingAnimalsCount === 0;
                      // All animals posted but no stage lock: Post locks the stage day, so it stays enabled.
                      const needsStageLock = areAllAnimalsPosted && selectedStage?.lock_status !== 'LOCKED';

                      const isPostDisabled =
                        stageActionBusy ||
                        awMortalityIncomplete ||
                        isFutureDate ||
                        (entryScope !== 'ALL' ? isCurrentAnimalPosted : areAllAnimalsPosted && !needsStageLock);

                      let postButtonLabel = 'Post Stage Data';
                      if (isFutureDate) {
                        postButtonLabel = 'Future Date — Cannot Post';
                      } else if (entryScope !== 'ALL') {
                        postButtonLabel = isCurrentAnimalPosted
                          ? `Already Posted (${currentAnimal?.animal_code || 'Animal'})`
                          : `Post Data (${currentAnimal?.animal_code || 'Animal'})`;
                      } else if (needsStageLock) {
                        postButtonLabel = t('deLockStageDay');
                      } else if (areAllAnimalsPosted) {
                        postButtonLabel = 'All Animals Posted';
                      } else if (postedAnimalsCount > 0) {
                        postButtonLabel = `Post Remaining Animals (${pendingAnimalsCount})`;
                      }

                      return (
                        <Button
                          size="sm"
                          onClick={handlePostStageDay}
                          disabled={isPostDisabled}
                          title={
                            awMortalityIncomplete
                              ? t('deMortPostBlocked')
                              : isFutureDate
                              ? `Cannot post data entry for future date (${selectedDate}). Today is ${todayStr}.`
                              : isCurrentAnimalPosted
                                ? `Data entry for animal ${currentAnimal?.animal_code} is already posted on this date.`
                                : areAllAnimalsPosted
                                  ? `All animals in this stage are already posted on this date.`
                                  : undefined
                          }
                          className="nf-btn-primary text-xs h-8 gap-1.5 font-semibold rounded-[var(--radius-sm)] shadow-2xs"
                        >
                          {stageActionBusy ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : isCurrentAnimalPosted || areAllAnimalsPosted ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" />
                          )}
                          {stageActionBusy ? t('blSaving') : postButtonLabel}
                        </Button>
                      );
                    })()}
                  </>
                )}
                {(selectedStage.animals || []).length > 0 && (() => {
                  const stageAnimals: Row[] = selectedStage.animals || [];
                  const pendingCount = stageAnimals.filter((a) => !a.is_posted).length;
                  return (
                    <div className="w-80">
                      <SearchableSelect
                        ariaLabel="Animal Selection"
                        value={entryScope}
                        onChange={(val) => setEntryScope(val)}
                        options={[
                          {
                            value: 'ALL',
                            label: `All animals in this stage (${selectedStage.animal_count}) — ${pendingCount} pending`,
                          },
                          ...stageAnimals.map((a: Row) => ({
                            value: a.animal_id,
                            label: `${a.animal_code} ${a.is_posted ? '(✓ Posted)' : '(Pending)'}`,
                          })),
                        ]}
                        searchPlaceholder="Search animal code…"
                      />
                    </div>
                  );
                })()}
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

          {isFutureDate && (
            <div
              className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] flex items-center gap-2 animate-in fade-in"
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                color: 'var(--warning-text, #b45309)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
              }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: '#d97706' }} />
              <span>
                Cannot post data entry for future date ({selectedDate}). Today is {todayStr}.
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

              <Toast variant="danger" message={dataEntryError} onClose={() => setDataEntryError('')} />

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

                  <Toast variant="danger" message={stageActionError} onClose={() => setStageActionError('')} />

                  <Toast
                    variant={reopenNotice?.kept.length ? 'warning' : 'success'}
                    message={reopenNotice
                      ? `${reopenNotice.unposted} entr${reopenNotice.unposted === 1 ? 'y' : 'ies'} reversed and back to draft — stock returned, cost and journals reversed.`
                        + (reopenNotice.kept.length > 0
                          ? ` Left posted: ${reopenNotice.kept.map((k) => `${k.activity_name} (${k.reason})`).join('; ')}.`
                          : '')
                      : ''}
                    onClose={() => setReopenNotice(null)}
                  />

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
                            <p className="w-full text-[11px] sm:max-w-xs" style={S.muted}>
                              Reopening reverses what this day posted — stock is returned and cost and journals are reversed — and puts the entries back to drafts so you can correct and post again. Transfers and recorded deaths stay posted.
                            </p>
                            <div className="w-full sm:w-72">
                              <ReasonSelect
                                ariaLabel="Reason for reopening"
                                value={reopenReason}
                                onChange={(val) => setReopenReason(val)}
                                onClear={() => setReopenReason("")}
                                placeholder="Reason for reopening (required)"
                                triggerClassName="nf-input-sm"
                              />
                            </div>
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
                        if (!templateAnimal) {
                          return (
                            <div className="py-8 text-center text-xs" style={S.muted}>
                              No activities scheduled for this stage on {selectedDate}.
                            </div>
                          );
                        }
                        const stageAnimals: Row[] = selectedStage.animals || [];
                        const pendingAnimals = stageAnimals.filter((a) => !a.is_posted);
                        const allPosted = stageAnimals.length > 0 && pendingAnimals.length === 0;
                        return (
                          <div>
                            {pendingAnimals.length < stageAnimals.length && pendingAnimals.length > 0 && (
                              <div
                                className="mb-3 p-2.5 text-xs rounded-[var(--radius-sm)] border flex items-center justify-between gap-2"
                                style={{
                                  backgroundColor: 'var(--surface-raised)',
                                  borderColor: 'var(--border)',
                                }}
                              >
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                  <span style={S.primary}>
                                    <strong>{stageAnimals.length - pendingAnimals.length}</strong> of <strong>{stageAnimals.length}</strong> animals already posted.
                                    Entries saved or posted below will apply to the <strong>{pendingAnimals.length} remaining</strong> animal(s).
                                  </span>
                                </div>
                              </div>
                            )}
                            {allPosted && (
                              <div
                                className="mb-3 p-2.5 text-xs font-semibold rounded-[var(--radius-sm)] border flex items-center justify-between gap-2"
                                style={{
                                  backgroundColor: 'var(--surface-raised)',
                                  borderColor: 'var(--border)',
                                }}
                              >
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                  <span style={S.primary}>
                                    All {stageAnimals.length} animals in this stage are already posted for {selectedDate}. Data entry is locked.
                                  </span>
                                </div>
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                                  STAGE COMPLETED
                                </span>
                              </div>
                            )}
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
                              (templateAnimal.lines || []).map((l: Row) => asStageTotalLine(l, pendingAnimals.length || stageAnimals.length)),
                              '__ALL__',
                              selectedStage.lock_status === 'LOCKED' || isFutureDate || allPosted,
                              true,
                            )}
                          </div>
                        );
                      })()
                    : (() => {
                        const animal = (selectedStage.animals || []).find(
                          (a: Row) => a.animal_id === entryScope,
                        );
                        if (!animal) {
                          return (
                            <div className="py-8 text-center text-xs" style={S.muted}>
                              Selected animal not found in this stage on {selectedDate}.
                            </div>
                          );
                        }
                        const rosterAnimal = batchAnimalRoster.find(
                          (a) => a.animal_id === animal.animal_id,
                        );
                        const isCurrentAnimalPosted = Boolean(animal.is_posted);
                        return (
                          <div>
                            {isCurrentAnimalPosted && (
                              <div
                                className="mb-3 p-2.5 text-xs font-semibold rounded-[var(--radius-sm)] border flex items-center justify-between gap-2"
                                style={{
                                  backgroundColor: 'var(--surface-raised)',
                                  borderColor: 'var(--border)',
                                }}
                              >
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                  <span style={S.primary}>
                                    Data entry for <strong>{animal.animal_code}</strong> has already been posted on {selectedDate}. Fields are read-only.
                                  </span>
                                </div>
                                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                                  POSTED / LOCKED
                                </span>
                              </div>
                            )}
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p
                                className="font-mono text-[11px] font-semibold"
                                style={S.sub}
                              >
                                {animal.animal_code}
                              </p>
                              {rosterAnimal &&
                                selectedStage.lock_status !== 'LOCKED' &&
                                !isFutureDate && (
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
                              selectedStage.lock_status === 'LOCKED' || isFutureDate || isCurrentAnimalPosted,
                            )}
                          </div>
                        );
                      })()}
                </div>
              ) : (
                <InlineAlert variant="info">
                  {t('blNoParamsScheduled')}
                </InlineAlert>
              )}
            </div>
          ) : noScheduler ? (
            <InlineAlert variant="info">
              No scheduler is linked to this batch&apos;s current stage —
              activities will appear here once one is created in the Scheduler
              module.
            </InlineAlert>
          ) : dataEntryLoading ? null : (
            renderActivityBoxes(dataEntryLines, undefined, locked || isFutureDate)
          )}

          {/* ── Notes & Attachments — quick, non-scheduled captures,
          kept visually separate from the scheduled-activity table above. ── */}
          <div className="grid grid-cols-1 gap-5">
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
          maxWidth="lg"
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
                    <TableHead className="h-auto px-3 py-2">Gender</TableHead>
                    <TableHead className="h-auto px-3 py-2">Breed</TableHead>
                    <TableHead className="h-auto px-3 py-2">
                      Age (Weeks)
                    </TableHead>
                    <TableHead className="h-auto px-3 py-2">
                      Age (Days)
                    </TableHead>
                    <TableHead className="h-auto px-3 py-2">Location</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {animalListRows.map((a) => {
                    const age = getAnimalAgeBreakdown(a);
                    return (
                      <TableRow
                        key={a.animal_id}
                        className="cursor-pointer hover:bg-(--surface-raised) transition-colors"
                        onClick={() => setSelectedAnimalIdForDetails(a.animal_id)}
                        title="Click to view animal details"
                      >
                        <TableCell className="px-3 py-1.5 font-mono text-primary font-medium hover:underline">
                          {a.animal_code}
                        </TableCell>
                        <TableCell
                          className="px-3 py-1.5 font-mono"
                          style={S.sub}
                        >
                          {a.rfid_tag || '—'}
                        </TableCell>
                        <TableCell className="px-3 py-1.5" style={S.sub}>
                          {a.gender === 'F' || a.gender === 'Female'
                            ? 'Female'
                            : a.gender === 'M' || a.gender === 'Male'
                              ? 'Male'
                              : (a.gender || '—')}
                        </TableCell>
                        <TableCell className="px-3 py-1.5" style={S.sub}>
                          {a.breed_name || '—'}
                        </TableCell>
                        <TableCell className="px-3 py-1.5" style={S.sub}>
                          {age.weeks}
                        </TableCell>
                        <TableCell className="px-3 py-1.5" style={S.sub}>
                          {age.days}
                        </TableCell>
                        <TableCell className="px-3 py-1.5" style={S.sub}>
                          {locationLabel(a.current_location_id)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            </div>
          )}
        </Dialog>
      )}

      {/* ── MODAL: Animal Details Popup ── */}
      {selectedAnimalIdForDetails && (
        <AnimalDetailsModal
          animalId={selectedAnimalIdForDetails}
          onClose={() => setSelectedAnimalIdForDetails(null)}
        />
      )}

      {/* ── MODAL: Per-animal manual stage change (ANIMAL_WISE) ── */}
      <AnimalStageTransitionModal
        open={!!stageTransitionAnimal}
        onClose={() => setStageTransitionAnimal(null)}
        animal={stageTransitionAnimal}
        onSuccess={() => {
          loadDataEntry();
          loadBatchAnimalRoster();
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
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <Toast variant="danger" message={bulkStageTransitionError} onClose={() => setBulkStageTransitionError('')} />
            <div>
              <label className="font-semibold block mb-1">
                Destination Stage
              </label>
              <SearchableSelect
                ariaLabel="Destination Stage"
                value={bulkStageTransitionForm.to_stage_id}
                onChange={(val) =>
                  setBulkStageTransitionForm((f) => ({
                    ...f,
                    to_stage_id: val,
                  }))
                }
                options={stageMasterList.map((s: Row) => ({
                  value: s.stage_id,
                  label: `${s.stage_code} — ${s.stage_name}`, shortLabel: (s.stage_name) ?? "",
                }))}
                placeholder="Select a stage…"
                searchPlaceholder="Search stages…"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Destination Location (optional)
              </label>
              <SearchableSelect
                ariaLabel="Destination Location"
                value={bulkStageTransitionForm.to_location_id}
                onChange={(val) =>
                  setBulkStageTransitionForm((f) => ({
                    ...f,
                    to_location_id: val,
                  }))
                }
                options={locations.map((l: Row) => ({
                  value: l.location_id,
                  label: l.location_name,
                }))}
                placeholder="Keep current location"
                searchPlaceholder="Search locations…"
                onClear={bulkStageTransitionForm.to_location_id ? () => setBulkStageTransitionForm((f) => ({ ...f, to_location_id: '' })) : undefined}
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Reason (required to override a minimum-duration hold)
              </label>
              <ReasonSelect
                ariaLabel="Reason (required to override a minimum-duration hold)"
                value={bulkStageTransitionForm.reason}
                onChange={(val) =>
                  setBulkStageTransitionForm((f) => ({
                    ...f,
                    reason: val,
                  }))
                }
                onClear={() =>
                  setBulkStageTransitionForm((f) => ({
                    ...f,
                    reason: "",
                  }))
                }
                placeholder="Select reason from Reason Master…"
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
            <Button
              size="sm"
              onClick={handleChangeStage}
              disabled={Boolean(
                changeStageSaving ||
                  changeStageOptions.length === 0 ||
                  !changeStageForm.to_stage_code ||
                  (stageTransition &&
                    !stageTransition.can_move_without_remarks &&
                    !changeStageForm.remarks?.trim()),
              )}
              className="nf-btn-primary"
            >
              {changeStageSaving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                t('blTransferStage')
              )}
            </Button>
          }
        >
          <div className="space-y-3.5 text-xs pt-1">
            <Toast variant="danger" message={changeStageError} onClose={() => setChangeStageError('')} />

            {/* Current Stage & Rule Context Box */}
            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle,#f8fafc)] dark:bg-[var(--surface-subtle,#0f172a)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)] font-medium">
                  Current Stage
                </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {stageTransition?.current_stage_name ||
                    currentBatch?.currentStageCode}{' '}
                  (
                  {stageTransition?.current_stage_code ||
                    currentBatch?.currentStageCode}
                  )
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Days in Stage</span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {stageTransition
                    ? `${stageTransition.days_in_stage} days`
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">
                  Min Days Before Move Rule
                </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {stageTransition?.min_days_before_move
                    ? `${stageTransition.min_days_before_move} days`
                    : 'None required'}
                </span>
              </div>

              {stageTransition && (
                <div className="pt-1">
                  {stageTransition.can_move_without_remarks ? (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded p-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Minimum duration satisfied ({stageTransition.days_in_stage}{' '}
                        of {stageTransition.min_days_before_move} days).
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded p-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        Early move notice: Stage requires at least{' '}
                        {stageTransition.min_days_before_move} days before move
                        (currently day {stageTransition.days_in_stage}). Justification /
                        Remarks are mandatory to proceed.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="font-semibold block mb-1">
                Destination Stage *
              </label>
              {changeStageOptionsLoading ? (
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading stages…
                </div>
              ) : (
                <SearchableSelect
                  ariaLabel="Destination Stage"
                  ariaRequired
                  value={changeStageForm.to_stage_code}
                  onChange={(val) =>
                    setChangeStageForm((f) => ({
                      ...f,
                      to_stage_code: val,
                    }))
                  }
                  options={Array.from(new Set(changeStageOptions)).map((code) => {
                    const stageDetail = stageTransition?.valid_next_stages?.find(
                      (s) => s.stage_code === code,
                    );
                    const label = stageDetail
                      ? `${stageDetail.stage_name} (${code}) — Seq ${stageDetail.stage_sequence}${
                          stageDetail.typical_duration_days
                            ? `, ~${stageDetail.typical_duration_days}d`
                            : ''
                        }`
                      : code;
                    return {
                      value: code,
                      label,
                    };
                  })}
                  placeholder="Select destination stage…"
                  searchPlaceholder="Search destination stages…"
                />
              )}
            </div>
            <div>
              <label className="font-semibold block mb-1">
                Remarks{' '}
                {stageTransition && !stageTransition.can_move_without_remarks ? (
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
                type="text"
                placeholder={
                  stageTransition && !stageTransition.can_move_without_remarks
                    ? 'Enter reason/justification for early stage transition…'
                    : 'Notes or remarks for this stage transfer…'
                }
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

      {/* ── MODAL: Automatic Stage Transition Popup ── */}
      {autoTransitionModalOpen && stageTransition?.next_stage && (
        <Dialog
          open={autoTransitionModalOpen}
          onClose={() => {
            if (currentBatch) {
              setAutoTransitionDismissedBatchId(currentBatch.id);
            }
            setAutoTransitionModalOpen(false);
          }}
          title="Stage Transition Due: Time to Transfer Stage"
          maxWidth="md"
          footer={
            <div className="flex items-center justify-between w-full">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (currentBatch) {
                    setAutoTransitionDismissedBatchId(currentBatch.id);
                  }
                  setAutoTransitionModalOpen(false);
                }}
              >
                Review Later
              </Button>
              <Button
                size="sm"
                onClick={handleAutoTransitionNow}
                disabled={autoTransitionSaving}
                className="nf-btn-primary flex items-center gap-1.5"
              >
                {autoTransitionSaving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <span>
                      Transfer to {stageTransition.next_stage.stage_code} Now
                    </span>
                    <ArrowRightCircle className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs pt-1">
            <Toast variant="danger" message={autoTransitionError} onClose={() => setAutoTransitionError('')} />

            <div className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">
                  Stage Transition Rule Triggered (AUTO_BY_DAY)
                </p>
                <p className="mt-1 text-xs opacity-90 leading-relaxed">
                  Batch <strong>{currentBatch?.code}</strong> has spent{' '}
                  <strong>{stageTransition.days_in_stage} days</strong> in{' '}
                  <strong>{stageTransition.current_stage_name}</strong>. According to
                  the stage transition rules, the typical duration of{' '}
                  <strong>
                    {stageTransition.auto_move_on_day ||
                      stageTransition.typical_duration_days}{' '}
                    days
                  </strong>{' '}
                  has been reached. It is now time to transfer this batch to the next
                  stage.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Current Stage */}
              <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle,#f8fafc)] dark:bg-[var(--surface-subtle,#0f172a)] space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Current Stage
                </span>
                <p className="font-bold text-sm text-[var(--text-primary)]">
                  {stageTransition.current_stage_name}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Code:{' '}
                  <span className="font-semibold">
                    {stageTransition.current_stage_code}
                  </span>
                </p>
                <div className="pt-1 text-[11px] text-[var(--text-secondary)]">
                  Days in Stage:{' '}
                  <strong className="text-[var(--text-primary)]">
                    {stageTransition.days_in_stage}d
                  </strong>
                </div>
              </div>

              {/* Next Stage */}
              <div className="p-3 rounded-lg border-2 border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Next Destination Stage
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
                    Seq #{stageTransition.next_stage.stage_sequence}
                  </span>
                </div>
                <p className="font-bold text-sm text-emerald-950 dark:text-emerald-100">
                  {stageTransition.next_stage.stage_name}
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  Code:{' '}
                  <span className="font-semibold">
                    {stageTransition.next_stage.stage_code}
                  </span>
                </p>
                <div className="pt-1 text-[11px] text-emerald-800 dark:text-emerald-300">
                  Duration:{' '}
                  <strong>
                    {stageTransition.next_stage.typical_duration_days
                      ? `~${stageTransition.next_stage.typical_duration_days} days`
                      : 'Standard'}
                  </strong>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[var(--text-muted)] italic">
              Note: Clicking &quot;Transfer to {stageTransition.next_stage.stage_code} Now&quot; will advance the batch to the destination stage and initialize its logs immediately.
            </p>
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
            <Button
              size="sm"
              onClick={handleAddAttachment}
              disabled={!uploadingFile}
              className="nf-btn-primary"
            >
              {t('obAttachToDailyLog')}
            </Button>
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
              <SearchableSelect
                ariaLabel={t('obMediaType')}
                value={newAttachmentType}
                onChange={(val) => setNewAttachmentType(val)}
                options={[
                  { value: 'IMAGE', label: t('obMediaSiteImage') },
                  { value: 'PDF', label: t('obMediaVetReport') },
                ]}
                placeholder={t('obMediaType')}
                searchPlaceholder="Search type…"
              />
            </div>

            {uploadError && (
              <p className="text-rose-500 font-medium">{uploadError}</p>
            )}
          </div>
        </Dialog>
      )}

      {serialModalLine && (
        <AnimalSerialAssignmentModal
          open={Boolean(serialModalLine)}
          onClose={() => setSerialModalLine(null)}
          line={serialModalLine}
          animals={selectedStage?.animals || []}
          warehouseId={(currentBatch as any)?.warehouse_id}
          currentAssignments={(() => {
            const result: Record<string, string> = {};
            (selectedStage?.animals || []).forEach((a: Row) => {
              const k = entryKey(serialModalLine.line_id, a.animal_id);
              if (dataEntryLotNos[k]) result[a.animal_id] = dataEntryLotNos[k];
            });
            return result;
          })()}
          onSaveAssignments={(assignments) => {
            setDataEntryLotNos((prev) => {
              const next = { ...prev };
              Object.entries(assignments).forEach(([animalId, sNo]) => {
                next[entryKey(serialModalLine.line_id, animalId)] = sNo;
              });
              return next;
            });
            const broadcastKey = entryKey(serialModalLine.line_id, '__ALL__');
            if (!dataEntryValues[broadcastKey]) {
              const def = defaultEntryValue(serialModalLine) || '1';
              setDataEntryValues((prev) => ({ ...prev, [broadcastKey]: def }));
            }
            setSerialModalLine(null);
          }}
          stageName={selectedStage?.stage_name}
        />
      )}
      {schedulerPrompt.element}
    </div>
  );
}
