'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  ChevronDown,
  Download,
  ChevronRight,
  Inbox,
  Loader2,
  Undo2,
} from 'lucide-react';
import { api } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { TablePager } from '@/components/ui/table-pager';
import { Toast } from '@/components/ui/toast';
import { StatCard, StatRow } from '@/components/ui/stat-row';
import { confirmAction } from '@/components/ui/confirm-dialog';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getActiveCompanyId,
  getStoredUser,
  hasPermission,
} from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import type { TranslationKeys } from '@/utils/translations';
import { formatAmount } from '@/lib/utils';
import { downloadCsvFile } from '@/modules/master-data/utils/master-csv';
import { buildRunsCsv } from './bio-costing-run-export';
import {
  AnimalCostCard,
  MethodBadge,
  RunLinesTable,
  methodOf,
  type Row,
} from './bio-costing-run-views';

const unwrap = <T = any,>(res: any): T =>
  (Array.isArray(res) ? res : (res?.data ?? res)) as T;

const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  raised: {
    backgroundColor: 'var(--surface-raised)',
    borderColor: 'var(--border)',
  },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
};

const STATUS_VARIANT: Record<
  string,
  'neutral' | 'success' | 'warning' | 'danger'
> = {
  CALCULATED: 'warning',
  POSTED: 'success',
  REVERSED: 'neutral',
  FAILED: 'danger',
};
const pad = (n: number) => String(n).padStart(2, '0');

/** The latest month a monthly item can run: last month (a period must have ended). "YYYY-MM". */
function previousMonth(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${last.getFullYear()}-${pad(last.getMonth() + 1)}`;
}
const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
/** The calendar month a period key (2026-09, 2026-Q3, 2026) ends in; null for a weekly key, which has no one month. */
function monthOfPeriodKey(key?: string | null): string | null {
  if (!key) return null;
  if (/^\d{4}-\d{2}$/.test(key)) return key;
  const q = /^(\d{4})-Q([1-4])$/.exec(key);
  if (q) return `${q[1]}-${pad(Number(q[2]) * 3)}`;
  if (/^\d{4}$/.test(key)) return `${key}-12`;
  return null;
}
const day = (v: unknown) => String(v ?? '').slice(0, 10);
const signed = (v: number) =>
  v > 0
    ? `+${formatAmount(v)}`
    : v < 0
      ? `-${formatAmount(Math.abs(v))}`
      : formatAmount(0);

type TabKey = 'calculate' | 'history';

/**
 * Finance > Bio-Asset Costing Runs, in two tabs. Calculate: pick a month (and a batch, and one animal if you want to look at her), press Calculate, read what each animal is charged,
 * then Post. Nothing is shown until you calculate. History: every run ever made, filtered, with Reverse. An amortised item and a fair value item are shown differently, because they are
 * worked out differently. The arithmetic and every control are the API's; this screen only shows what it answers.
 */
export default function BioCostingRunsPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const canRun = hasPermission(
    getStoredUser(),
    'FINANCE',
    'JOURNAL',
    'can_create',
  );

  const [tab, setTab] = useState<TabKey>('calculate');
  const [runs, setRuns] = useState<Row[]>([]);
  const [details, setDetails] = useState<Record<string, Row>>({});
  const [due, setDue] = useState<Row[]>([]);
  const [month, setMonth] = useState(previousMonth());
  const [batches, setBatches] = useState<Row[]>([]);
  const [batchId, setBatchId] = useState(''); // "" = every batch (the whole herd)
  const [itemId, setItemId] = useState(''); // "" = every item
  const [stages, setStages] = useState<Row[]>([]);
  const [animals, setAnimals] = useState<Row[]>([]);
  const [selectedAnimalId, setSelectedAnimalId] = useState('');
  const [selectedAnimal, setSelectedAnimal] = useState<Row | null>(null);
  const [animalLedger, setAnimalLedger] = useState<Row[]>([]);
  const [loadingAnimals, setLoadingAnimals] = useState(false);
  const [loadingAnimal, setLoadingAnimal] = useState(false);
  const [daysEnforced, setDaysEnforced] = useState('');
  const [description, setDescription] = useState('');
  /** What the Calculate tab shows: the month and batch last calculated. Null until you press Calculate (and again when you change either). */
  const [view, setView] = useState<{ month: string; batchId: string; itemId: string; runIds: string[] } | null>(
    null,
  );
  const [historyMonth, setHistoryMonth] = useState('');
  const [historyMethod, setHistoryMethod] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [exporting, setExporting] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<'' | 'calculate' | 'post' | 'reverse'>('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reversing, setReversing] = useState<Row | null>(null);
  const [reason, setReason] = useState('');

  const batchLabel = (id?: string | null) =>
    id
      ? (batches.find((b) => b.batch_id === id)?.batch_no ?? '')
      : t('bcrWholeHerd');
  const monthEnd = lastDayOf(month);

  const animalStageName = useMemo(() => {
    if (!selectedAnimal) return '';
    if (selectedAnimal.stage_name) return selectedAnimal.stage_name;
    const match = selectedAnimal.current_stage_id
      ? stages.find((s) => s.stage_id === selectedAnimal.current_stage_id)
      : null;
    return (
      match?.stage_name ||
      match?.stage_code ||
      selectedAnimal.current_stage ||
      selectedAnimal.stage_code ||
      ''
    );
  }, [selectedAnimal, stages]);

  const loadRuns = useCallback(async () => {
    if (!companyId) return;
    try {
      setRuns(
        unwrap<Row[]>(
          await api.get(`/bio-costing/runs?companyId=${companyId}`),
        ) || [],
      );
    } catch (e: any) {
      setError(e?.message || t('bcrLoadFailed'));
    }
  }, [companyId, t]);

  const loadDue = useCallback(async () => {
    if (!companyId) return;
    try {
      setDue(unwrap<Row[]>(await api.get('/bio-costing/runs/due')) || []);
    } catch {
      setDue([]); // the notice is a convenience; the screen works without it
    }
  }, [companyId]);

  const refresh = useCallback(
    async (...ids: string[]) => {
      setDetails((d) => {
        const next = { ...d };
        for (const id of ids) delete next[id];
        return next;
      });
      await Promise.all([loadRuns(), loadDue()]);
    },
    [loadRuns, loadDue],
  );

  useEffect(() => {
    if (!companyId) return;
    loadDue();
    api
      .get(`/batch?companyId=${companyId}&status=ACTIVE&limit=100`)
      .then((r) => setBatches(unwrap<Row[]>(r) || []))
      .catch(() => setBatches([])); // the batch picker is a filter; the screen still runs the whole herd without it
    api
      .get(`/stage?limit=200`)
      .then((r) => setStages(unwrap<Row[]>(r) || []))
      .catch(() => setStages([]));
    loadRuns();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!batchId) {
      setAnimals([]);
      setSelectedAnimalId('');
      return;
    }
    setLoadingAnimals(true);
    api
      .get(`/animal?currentBatchId=${batchId}&limit=100`)
      .then((r) => setAnimals(unwrap<Row[]>(r) || []))
      .catch(() => setAnimals([]))
      .finally(() => setLoadingAnimals(false));
  }, [batchId]);

  useEffect(() => {
    if (!selectedAnimalId) {
      setSelectedAnimal(null);
      setAnimalLedger([]);
      return;
    }
    setLoadingAnimal(true);
    Promise.all([
      api
        .get(`/animal/${selectedAnimalId}`)
        .then((r) => unwrap<Row>(r))
        .catch(() => null),
      api
        .get(`/animal/${selectedAnimalId}/breeding`)
        .then((r) => unwrap<Row>(r))
        .catch(() => null),
      api
        .get(`/animal/${selectedAnimalId}/bio-asset-ledger`)
        .then((r) => unwrap<Row[]>(r) || [])
        .catch(() => []),
    ])
      .then(([animalData, breedingData, ledgerData]) => {
        setSelectedAnimal(
          animalData
            ? {
                ...animalData,
                stage_name:
                  breedingData?.current_labels?.stage || animalData.stage_name,
                breed_name:
                  breedingData?.current_labels?.breed || animalData.breed_name,
              }
            : null,
        );
        setAnimalLedger(ledgerData || []);
      })
      .finally(() => setLoadingAnimal(false));
  }, [selectedAnimalId]);

  // Changing the month or the batch puts the page back to "nothing calculated": what is on screen would no longer be what the form says.
  useEffect(() => {
    setView(null);
  }, [month, batchId, itemId]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const run = unwrap<Row>(await api.get(`/bio-costing/runs/${id}`));
      if (run) setDetails((d) => ({ ...d, [id]: run }));
    } catch {
      /* the row stays on its spinner; the next refresh tries again */
    }
  }, []);

  // ---- Calculate tab: the runs of the month just calculated ----------------------------------------------------------
  const shown = useMemo(() => {
    if (!view) return [];
    const end = lastDayOf(view.month);
    return runs
      .filter(
        (r) =>
          view.runIds.includes(r.run_id) &&
          (r.status === 'CALCULATED' || r.status === 'POSTED') &&
          day(r.period_start) <= end &&
          day(r.period_end) >= end,
      )
      .sort(
        (a, b) =>
          String(a.method ?? '').localeCompare(String(b.method ?? '')) ||
          String(a.subject_code ?? '').localeCompare(
            String(b.subject_code ?? ''),
          ),
      );
  }, [runs, view]);
  const pending = useMemo(
    () => shown.filter((r) => r.status === 'CALCULATED'),
    [shown],
  );

  useEffect(() => {
    for (const r of shown) if (!details[r.run_id]) loadDetail(r.run_id);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    let charged = 0,
      skipped = 0,
      amortised = 0,
      fairValue = 0,
      hasAmort = false,
      hasFair = false;
    for (const r of shown) {
      charged += Number(r.charged_count ?? 0);
      skipped += Number(r.skipped_count ?? 0);
      if (methodOf(r.method) === 'FAIR_VALUE') {
        fairValue += Number(r.total_charge ?? 0);
        hasFair = true;
      } else {
        amortised += Number(r.total_charge ?? 0);
        hasAmort = true;
      }
    }
    return { charged, skipped, amortised, fairValue, hasAmort, hasFair };
  }, [shown]);

  const calculate = async () => {
    setBusy('calculate');
    setError('');
    setMessage('');
    try {
      const body: Row = { period_date: monthEnd };
      if (batchId) body.batch_id = batchId;
      if (itemId) body.item_id = itemId;
      if (daysEnforced) body.days_enforced = Number(daysEnforced);
      if (description.trim()) body.description = description.trim();
      const made = unwrap<{
        runs: Row[];
        failed: Array<{ item_code: string; error: string }>;
      }>(await api.post('/bio-costing/runs/calculate-batch', body));
      setDetails((d) => {
        const next = { ...d };
        for (const r of made.runs) next[r.run_id] = r;
        return next;
      });
      if (made.failed?.length)
        setError(
          made.failed.map((f) => `${f.item_code}: ${f.error}`).join('; '),
        );
      await Promise.all([loadRuns(), loadDue()]);
      setView({ month, batchId, itemId, runIds: made.runs.map((r) => r.run_id) });
    } catch (e: any) {
      setError(e?.message || t('bcrCalculateFailed'));
    } finally {
      setBusy('');
    }
  };

  const postOne = async (run: Row) => {
    const ok = await confirmAction({
      title: t('bcrPostConfirmTitle'),
      message: t('bcrPostConfirmMessage', {
        runNo: run.run_no,
        period: run.period_key,
      }),
      confirmLabel: t('bcrPost'),
      cancelLabel: t('bcrCancel'),
    });
    if (!ok) return;
    setBusy('post');
    setError('');
    try {
      await api.post(`/bio-costing/runs/${run.run_id}/post`, {});
      setMessage(t('bcrPosted', { runNo: run.run_no }));
      await refresh(run.run_id);
    } catch (e: any) {
      setError(e?.message || t('bcrPostFailed'));
    } finally {
      setBusy('');
    }
  };

  const postAll = async () => {
    const ok = await confirmAction({
      title: t('bcrPostAllConfirmTitle'),
      message: t('bcrPostAllConfirmMessage', { count: pending.length }),
      confirmLabel: t('bcrPost'),
      cancelLabel: t('bcrCancel'),
    });
    if (!ok) return;
    setBusy('post');
    setError('');
    const problems: string[] = [];
    for (const r of pending) {
      try {
        await api.post(`/bio-costing/runs/${r.run_id}/post`, {});
      } catch (e: any) {
        problems.push(
          `${r.subject_code ?? r.run_no}: ${e?.message || t('bcrPostFailed')}`,
        );
      }
    }
    if (problems.length) setError(problems.join('; '));
    else setMessage(t('bcrPostedAll', { count: pending.length }));
    await refresh(...pending.map((r) => r.run_id));
    setBusy('');
  };

  const post = () => (pending.length === 1 ? postOne(pending[0]) : postAll());

  const reverse = async () => {
    if (!reversing || !reason.trim()) return;
    setBusy('reverse');
    setError('');
    try {
      await api.post(`/bio-costing/runs/${reversing.run_id}/reverse`, {
        reason: reason.trim(),
      });
      setMessage(t('bcrReversed', { runNo: reversing.run_no }));
      const id = reversing.run_id;
      setReversing(null);
      setReason('');
      await refresh(id);
    } catch (e: any) {
      setError(e?.message || t('bcrReverseFailed'));
    } finally {
      setBusy('');
    }
  };

  const runDueNow = async () => {
    setBusy('calculate');
    setError('');
    try {
      const results =
        unwrap<Row[]>(await api.post('/bio-costing/runs/run-due', {})) || [];
      const done = results.filter(
        (r) => r.outcome === 'CALCULATED' || r.outcome === 'POSTED',
      ).length;
      const failed = results.filter((r) => r.outcome === 'FAILED');
      if (failed.length)
        setError(
          failed
            .map((f) => `${f.item_code} ${f.period_key}: ${f.error}`)
            .join('; '),
        );
      else setMessage(t('bcrRunDueDone', { count: done }));
      await refresh();
    } catch (e: any) {
      setError(e?.message || t('bcrCalculateFailed'));
    } finally {
      setBusy('');
    }
  };

  /** Other months that need a person: a run waiting to be posted, a period due, or one that keeps failing. Each says which month, and jumps to it. */
  const attention = useMemo(() => {
    const out: Array<{
      key: string;
      text: string;
      month: string | null;
      tone: 'warning' | 'danger';
    }> = [];
    for (const d of due) {
      if (d.blocked?.reason === 'WAITING_TO_POST') {
        const m = monthOfPeriodKey(d.blocked.period_key);
        if (m !== month)
          out.push({
            key: `w-${d.item_code}`,
            text: t('bcrWaitingChip', {
              item: d.item_code,
              period: d.blocked.period_key,
            }),
            month: m,
            tone: 'warning',
          });
      } else if (d.blocked?.reason === 'TOO_MANY_FAILURES') {
        out.push({
          key: `f-${d.item_code}`,
          text: t('bcrFailedRepeatedly', {
            item: d.item_code,
            period: d.blocked.period_key,
            count: d.blocked.attempts,
            error: d.blocked.error || '',
          }),
          month: monthOfPeriodKey(d.blocked.period_key),
          tone: 'danger',
        });
      } else if (!d.blocked && d.due_periods?.length) {
        const m = monthOfPeriodKey(d.due_periods[0]);
        if (m !== month)
          out.push({
            key: `d-${d.item_code}`,
            text: t('bcrDueChip', {
              item: d.item_code,
              periods: d.due_periods.join(', '),
            }),
            month: m,
            tone: 'warning',
          });
      }
    }
    return out;
  }, [due, month, t]);

  // ---- History tab ---------------------------------------------------------------------------------------------------
  const history = useMemo(() => {
    const end = historyMonth ? lastDayOf(historyMonth) : '';
    return runs
      .filter(
        (r) =>
          (!end || (day(r.period_start) <= end && day(r.period_end) >= end)) &&
          (!historyMethod || methodOf(r.method) === historyMethod) &&
          (!historyStatus || r.status === historyStatus),
      )
      .sort(
        (a, b) =>
          day(b.period_end).localeCompare(day(a.period_end)) ||
          String(b.run_no).localeCompare(String(a.run_no)),
      );
  }, [runs, historyMonth, historyMethod, historyStatus]);

  // A new filter starts again from the first page; a page past the end (after a Reverse changes the list) falls back to the last.
  useEffect(() => { setHistoryPage(1); }, [historyMonth, historyMethod, historyStatus, historyPageSize]);
  const historyPages = Math.max(1, Math.ceil(history.length / historyPageSize));
  const historyShown = history.slice((Math.min(historyPage, historyPages) - 1) * historyPageSize, Math.min(historyPage, historyPages) * historyPageSize);

  /** The runs' animals as a CSV for reconciliation. Every run's lines are read first (the ones on screen already are); a failure downloads nothing rather than a part. */
  const exportRuns = async (list: Row[], name: string) => {
    if (!list.length) return;
    setExporting(true);
    setError('');
    try {
      const have = { ...details };
      const missing = list.filter((r) => !have[r.run_id]);
      for (let i = 0; i < missing.length; i += 6) {
        const got = await Promise.all(missing.slice(i, i + 6).map((r) => api.get(`/bio-costing/runs/${r.run_id}`).then((x) => unwrap<Row>(x))));
        for (const run of got) if (run?.run_id) have[run.run_id] = run;
      }
      setDetails(have);
      downloadCsvFile(name, buildRunsCsv(list, have, batchLabel));
    } catch (e: any) {
      setError(e?.message || t('bcrExportFailed'));
    } finally {
      setExporting(false);
    }
  };
  const exportButton = (list: Row[], name: string) => (
    <Button variant="outline" className="h-10" onClick={() => exportRuns(list, name)} disabled={exporting || list.length === 0}>
      {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
      {t('bcrExportCsv')}
    </Button>
  );

  // The items that can be costed, for the item filter; the due list names each one that has costing terms.
  const costedItems = useMemo(
    () => [...new Map(due.filter((d) => d.item_id && d.item_code).map((d) => [d.item_id, d])).values()].sort((a, b) => String(a.item_code).localeCompare(String(b.item_code))),
    [due],
  );

  const toggleOpen = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  // An opened row reads its animals once; after a Reverse or Post drops them, they are read again.
  useEffect(() => {
    for (const id of Object.keys(open))
      if (open[id] && !details[id]) loadDetail(id);
  }, [open, details]); // eslint-disable-line react-hooks/exhaustive-deps

  const control = 'h-10 text-[13px]';
  const statusLabel = (s: string) => t(`bcrStatus_${s}` as TranslationKeys);

  const noticeAndToasts = (
    <>
      <Toast variant="danger" message={error} onClose={() => setError('')} />
      <Toast
        variant="success"
        message={message}
        onClose={() => setMessage('')}
      />
    </>
  );

  return (
    <div className="mx-auto w-full space-y-6">
      <Tabs
        items={[
          { value: 'calculate', label: t('bcrTabCalculate') },
          { value: 'history', label: t('bcrTabHistory') },
        ]}
        value={tab}
        onChange={(v) => setTab(v as TabKey)}
      />

      {tab === 'calculate' && (
        <div className="space-y-6" role="tabpanel">
          <p className="text-sm" style={S.sub}>
            {t('bcrPageIntro')}
          </p>

          <section
            className="space-y-4 rounded-[var(--radius-lg)] border p-5"
            style={S.surface}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  className="nf-text-label mb-1.5 block"
                  style={S.muted}
                  htmlFor="bcr-month"
                >
                  {t('bcrPeriodDate')}
                </label>
                <input
                  id="bcr-month"
                  type="month"
                  className={`nf-input w-full ${control}`}
                  value={month}
                  max={previousMonth()}
                  onChange={(e) => e.target.value && setMonth(e.target.value)}
                />
              </div>
              <div>
                <label
                  className="nf-text-label mb-1.5 block"
                  style={S.muted}
                  htmlFor="bcr-batch"
                >
                  {t('bcrBatch')}
                </label>
                <Select
                  id="bcr-batch"
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  className={control}
                >
                  <option key="all" value="">
                    {t('bcrAllBatches')}
                  </option>
                  {batches.map((b) => (
                    <option key={b.batch_id} value={b.batch_id}>
                      {b.batch_no}
                      {b.remarks ? ` · ${b.remarks}` : ''} · {b.tracking_mode}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label
                  className="nf-text-label mb-1.5 block"
                  style={S.muted}
                  htmlFor="bcr-item"
                >
                  {t('bcrItemFilter')}
                </label>
                <Select
                  id="bcr-item"
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  className={control}
                >
                  <option key="all" value="">
                    {t('bcrAllItems')}
                  </option>
                  {costedItems.map((i) => (
                    <option key={i.item_id} value={i.item_id}>
                      {i.item_code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label
                  className="nf-text-label mb-1.5 block"
                  style={S.muted}
                  htmlFor="bcr-animal-picker"
                >
                  {t('bcrAnimalPicker')}
                </label>
                <Select
                  id="bcr-animal-picker"
                  value={selectedAnimalId}
                  onChange={(e) => setSelectedAnimalId(e.target.value)}
                  className={control}
                  disabled={!batchId || loadingAnimals}
                >
                  <option key="none" value="">
                    {!batchId
                      ? t('bcrPickBatchFirst')
                      : loadingAnimals
                        ? '…'
                        : t('bcrAllAnimalsInBatch')}
                  </option>
                  {animals.map((a) => (
                    <option key={a.animal_id} value={a.animal_id}>
                      {a.animal_code}
                      {a.rfid_tag ? ` (${a.rfid_tag})` : ''} ·{' '}
                      {a.gender === 'F' ? t('bcrFemale') : t('bcrMale')} ·{' '}
                      {formatAmount(a.book_value)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label
                  className="nf-text-label mb-1.5 block"
                  style={S.muted}
                  htmlFor="bcr-days"
                >
                  {t('bcrDaysEnforced')}
                </label>
                <Input
                  id="bcr-days"
                  type="number"
                  min={1}
                  value={daysEnforced}
                  onChange={(e) => setDaysEnforced(e.target.value)}
                  className={control}
                  placeholder={t('bcrDaysEnforcedHint')}
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  className="nf-text-label mb-1.5 block"
                  style={S.muted}
                  htmlFor="bcr-desc"
                >
                  {t('bcrDescription')}
                </label>
                <Input
                  id="bcr-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={control}
                  maxLength={300}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 text-xs" style={S.muted}>
                {t('bcrBatchHint')}
              </p>
              <Button
                className="h-10"
                onClick={calculate}
                disabled={!month || busy !== '' || !canRun}
              >
                {busy === 'calculate' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Calculator className="mr-1.5 h-4 w-4" />
                )}
                {t('bcrCalculate')}
              </Button>
            </div>
          </section>

          {selectedAnimal && (
            <AnimalCostCard
              animal={selectedAnimal}
              stageName={animalStageName}
              loading={loadingAnimal}
              ledger={animalLedger}
            />
          )}

          {attention.length > 0 && (
            <section
              className="rounded-[var(--radius-lg)] border p-4"
              style={{ ...S.surface, borderColor: 'var(--warning)' }}
              role="status"
              aria-label={t('bcrOtherMonths')}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold" style={S.primary}>
                  {t('bcrOtherMonths')}
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runDueNow}
                  disabled={busy !== '' || !canRun}
                >
                  {t('bcrRunDue')}
                </Button>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {attention.map((a) => (
                  <li
                    key={a.key}
                    className="flex flex-wrap items-center gap-3 text-sm"
                    style={
                      a.tone === 'danger' ? { color: 'var(--danger)' } : S.sub
                    }
                  >
                    <span className="min-w-0 flex-1">{a.text}</span>
                    {a.month && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setMonth(a.month!)}
                      >
                        {t('bcrOpenMonth', { month: monthName(a.month) })}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {noticeAndToasts}

          {!view ? (
            <div
              className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-6 py-12 text-center"
              style={S.surface}
            >
              <Calculator className="h-6 w-6" style={S.muted} />
              <p className="text-sm" style={S.sub}>
                {t('bcrCalcEmpty')}
              </p>
            </div>
          ) : (
            <section
              className="space-y-4"
              aria-label={t('bcrReviewHeading', {
                month: monthName(view.month),
              })}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold" style={S.primary}>
                  {monthName(view.month)}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                {shown.length > 0 && exportButton(shown, `bio-costing-runs_${view.month}.csv`)}
                {pending.length > 0 && (
                  <Button
                    className="h-10"
                    onClick={post}
                    disabled={busy !== '' || !canRun}
                  >
                    {busy === 'post' ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    )}
                    {pending.length > 1
                      ? t('bcrPostAll', { count: pending.length })
                      : t('bcrPost')}
                  </Button>
                )}
                </div>
              </div>

              {shown.length === 0 ? (
                <div
                  className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-6 py-12 text-center"
                  style={S.surface}
                >
                  <Inbox className="h-6 w-6" style={S.muted} />
                  <p className="text-sm" style={S.sub}>
                    {t('bcrNothingYet', { month: monthName(view.month) })}
                  </p>
                </div>
              ) : (
                <>
                  {pending.length > 0 && (
                    <p
                      className="rounded-[var(--radius-md)] border px-3 py-2 text-sm"
                      style={{
                        ...S.raised,
                        borderColor: 'var(--warning)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {t('bcrPreviewNote')}
                    </p>
                  )}
                  <StatRow>
                    {totals.hasAmort && (
                      <StatCard
                        label={`${t('bcrMethodAmortisation')} · ${t('bcrTotalCharge')}`}
                        value={formatAmount(totals.amortised)}
                      />
                    )}
                    {totals.hasFair && (
                      <StatCard
                        label={`${t('bcrMethodFairValue')} · ${t('bcrNetGainLoss')}`}
                        value={signed(totals.fairValue)}
                        tone={
                          totals.fairValue < 0
                            ? 'danger'
                            : totals.fairValue > 0
                              ? 'success'
                              : 'default'
                        }
                      />
                    )}
                    <StatCard
                      label={t('bcrAnimalsCharged')}
                      value={String(totals.charged)}
                    />
                    <StatCard
                      label={t('bcrAnimalsSkipped')}
                      value={String(totals.skipped)}
                      tone={totals.skipped > 0 ? 'warning' : 'default'}
                    />
                  </StatRow>

                  {shown.map((r) => {
                    const method = methodOf(r.method);
                    return (
                      <article
                        key={r.run_id}
                        className="overflow-hidden rounded-[var(--radius-lg)] border"
                        style={S.surface}
                      >
                        <header
                          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          <div className="min-w-0 flex-1">
                            <h3
                              className="truncate text-sm font-semibold"
                              style={S.primary}
                            >
                              {r.subject_name || r.subject_code}
                            </h3>
                            <p className="truncate text-xs" style={S.muted}>
                              {[
                                r.subject_name ? r.subject_code : null,
                                batchLabel(r.batch_id),
                                r.run_no,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                          <MethodBadge method={method} />
                          <Badge
                            variant={STATUS_VARIANT[r.status] || 'neutral'}
                          >
                            {statusLabel(r.status)}
                          </Badge>
                          <div className="min-w-[6rem] text-right">
                            <p className="text-[11px]" style={S.muted}>
                              {method === 'FAIR_VALUE'
                                ? t('bcrNetGainLoss')
                                : t('bcrTotalCharge')}
                            </p>
                            <p
                              className="font-mono text-sm font-semibold"
                              style={S.primary}
                            >
                              {method === 'FAIR_VALUE'
                                ? signed(Number(r.total_charge))
                                : formatAmount(r.total_charge)}
                            </p>
                          </div>
                        </header>
                        <RunLinesTable
                          method={method}
                          lines={details[r.run_id]?.lines}
                        />
                      </article>
                    );
                  })}
                </>
              )}
            </section>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-5" role="tabpanel">
          <section
            className="grid items-end gap-4 rounded-[var(--radius-lg)] border p-5 sm:grid-cols-4"
            style={S.surface}
          >
            <div>
              <label
                className="nf-text-label mb-1.5 block"
                style={S.muted}
                htmlFor="bcr-h-month"
              >
                {t('bcrColMonth')}
              </label>
              <div className="flex gap-2">
                <input
                  id="bcr-h-month"
                  type="month"
                  className={`nf-input w-full ${control}`}
                  value={historyMonth}
                  onChange={(e) => setHistoryMonth(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label
                className="nf-text-label mb-1.5 block"
                style={S.muted}
                htmlFor="bcr-h-method"
              >
                {t('bcrFilterMethod')}
              </label>
              <Select
                id="bcr-h-method"
                value={historyMethod}
                onChange={(e) => setHistoryMethod(e.target.value)}
                className={control}
              >
                <option value="">{t('bcrAllFilter')}</option>
                <option value="AMORTIZATION">
                  {t('bcrMethodAmortisation')}
                </option>
                <option value="FAIR_VALUE">{t('bcrMethodFairValue')}</option>
              </Select>
            </div>
            <div>
              <label
                className="nf-text-label mb-1.5 block"
                style={S.muted}
                htmlFor="bcr-h-status"
              >
                {t('bcrFilterStatus')}
              </label>
              <Select
                id="bcr-h-status"
                value={historyStatus}
                onChange={(e) => setHistoryStatus(e.target.value)}
                className={control}
              >
                <option value="">{t('bcrAllFilter')}</option>
                {['POSTED', 'CALCULATED', 'REVERSED', 'FAILED'].map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => {
                setHistoryMonth('');
                setHistoryMethod('');
                setHistoryStatus('');
              }}
              disabled={!historyMonth && !historyMethod && !historyStatus}
            >
              {t('bcrClearFilters')}
            </Button>
          </section>

          {noticeAndToasts}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs" style={S.muted}>{t('bcrExportHint', { count: history.length })}</p>
            {exportButton(history, `bio-costing-runs_${historyMonth || 'all'}.csv`)}
          </div>

          <section
            className="overflow-hidden rounded-[var(--radius-lg)] border"
            style={S.surface}
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <TableHeader>
                  <tr
                    className="border-b"
                    style={{ borderColor: 'var(--row-border)' }}
                  >
                    <TableHead className="w-8" />
                    <TableHead className="whitespace-nowrap">
                      {t('bcrColRun')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t('bcrColMonth')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t('bcrColItem')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t('bcrColMethod')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap text-right">
                      {t('bcrColAnimals')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap text-right">
                      {t('bcrTotalCharge')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t('bcrLineStatus')}
                    </TableHead>
                    <TableHead className="w-28" />
                  </tr>
                </TableHeader>
                <TableBody>
                  {history.length === 0 ? (
                    <tr>
                      <TableCell
                        colSpan={9}
                        className="py-10 text-center"
                        style={S.sub}
                      >
                        <Inbox
                          className="mx-auto mb-1.5 h-5 w-5"
                          style={S.muted}
                        />
                        {t('bcrHistoryEmpty')}
                      </TableCell>
                    </tr>
                  ) : (
                    historyShown.map((r) => {
                      const method = methodOf(r.method);
                      const isOpen = !!open[r.run_id];
                      const m = monthOfPeriodKey(r.period_key);
                      return (
                        <Fragment key={r.run_id}>
                          <TableRow>
                            <TableCell>
                              <button
                                type="button"
                                className="rounded p-1"
                                aria-label={
                                  isOpen
                                    ? t('bcrHideAnimals')
                                    : t('bcrShowAnimals')
                                }
                                aria-expanded={isOpen}
                                onClick={() => toggleOpen(r.run_id)}
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell
                              className="whitespace-nowrap font-mono text-xs"
                              style={S.primary}
                            >
                              {r.run_no}
                            </TableCell>
                            <TableCell
                              className="whitespace-nowrap"
                              style={S.sub}
                            >
                              {m ? monthName(m) : r.period_key}
                            </TableCell>
                            <TableCell
                              className="whitespace-nowrap font-medium"
                              style={S.primary}
                            >
                              {r.subject_code}
                              <span
                                className="ml-2 text-xs font-normal"
                                style={S.muted}
                              >
                                {batchLabel(r.batch_id)}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <MethodBadge method={method} />
                            </TableCell>
                            <TableCell
                              className="whitespace-nowrap text-right"
                              style={S.sub}
                            >
                              {r.charged_count}/{r.animal_count}
                            </TableCell>
                            <TableCell
                              className="whitespace-nowrap text-right font-mono font-semibold"
                              style={
                                method === 'FAIR_VALUE' &&
                                Number(r.total_charge) < 0
                                  ? { color: 'var(--danger)' }
                                  : S.primary
                              }
                            >
                              {method === 'FAIR_VALUE'
                                ? signed(Number(r.total_charge))
                                : formatAmount(r.total_charge)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Badge
                                variant={STATUS_VARIANT[r.status] || 'neutral'}
                              >
                                {statusLabel(r.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              {r.status === 'POSTED' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setReason('');
                                    setReversing(r);
                                  }}
                                  disabled={busy !== '' || !canRun}
                                >
                                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />{' '}
                                  {t('bcrReverse')}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <tr>
                              <td
                                colSpan={9}
                                className="border-b p-0"
                                style={{
                                  backgroundColor: 'var(--surface-raised)',
                                  borderColor: 'var(--row-border)',
                                }}
                              >
                                {r.status === 'FAILED' && r.error_message && (
                                  <p
                                    className="px-4 py-3 text-sm"
                                    style={{ color: 'var(--danger)' }}
                                  >
                                    {r.error_message}
                                  </p>
                                )}
                                <RunLinesTable
                                  method={method}
                                  lines={details[r.run_id]?.lines}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </table>
            </div>
            <TablePager
              page={Math.min(historyPage, historyPages)}
              pageSize={historyPageSize}
              total={history.length}
              onPageChange={setHistoryPage}
              onPageSizeChange={setHistoryPageSize}
            />
          </section>
        </div>
      )}

      <Dialog
        open={!!reversing}
        onClose={() => busy !== 'reverse' && setReversing(null)}
        title={t('bcrReverseTitle', { runNo: reversing?.run_no || '' })}
        description={t('bcrReverseDescription')}
        maxWidth="sm"
        footer={
          <Button
            onClick={reverse}
            disabled={!reason.trim() || busy === 'reverse'}
          >
            {busy === 'reverse' ? t('bcrReversing') : t('bcrReverse')}
          </Button>
        }
      >
        <label
          className="nf-text-label mb-1 block"
          style={S.muted}
          htmlFor="bcr-reason"
        >
          {t('bcrReason')}
        </label>
        <Input
          id="bcr-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          autoFocus
        />
      </Dialog>
    </div>
  );
}
