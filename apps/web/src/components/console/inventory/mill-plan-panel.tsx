'use client';

/**
 * Mill Planning (spec 2026-11-03) — replaces Feed Plan. The mill manager picks
 * the week, farms, feed types and mill, clicks Generate, and sees one week of
 * every selected farm's forecast added up for the mill: capacity used per day,
 * what to make per feed type and day (approved requisitions not yet produced +
 * the forecast's net need), the diet changes, and the farm × shed × day grid
 * with each farm's silos. The API does the arithmetic (mill-plan.rules.ts);
 * nothing is fetched until Generate, and changing a filter does not refetch.
 */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import { api } from '@/services/api-client';
import { showToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { HoverHint } from '@/components/ui/hover-hint';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { StatCard, StatRow } from '@/components/ui/stat-row';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { getStoredUser } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { formatDateShort } from '@/utils/date-short';
import { todayIso, unwrap } from './feed-format';
import { useFeedForecastContext } from './feed-forecast-context';
import { loadFeedFarms, type FeedFarm } from './use-feed-farm';
import {
  formatKg,
  millCapacityText,
  type MillCapacityState,
  type MillCapacityStatus,
} from './mill-capacity-view';
import { MultiPick, type MultiPickOption } from './multi-pick';

type DayStatus = 'OK' | 'WARN' | 'OVER' | 'NO_CAPACITY';

interface DietCapacity {
  state: MillCapacityState;
  status: MillCapacityStatus | null;
  availableKg: number | null;
}

interface MillPlan {
  dates: string[];
  mill: {
    millId: string;
    millCode: string;
    millName: string;
    dailyKg: number | null;
  } | null;
  mills: Array<{
    millId: string;
    millCode: string;
    millName: string;
    companyId: string;
  }>;
  capacity: Array<{
    date: string;
    productionKg: number;
    capacityKg: number | null;
    usedPct: number | null;
    status: DayStatus;
  }>;
  cards: {
    totalKg: number;
    farms: number;
    sheds: number;
    silos: number;
    feedTypes: number;
    dietChanges: number;
    daysNearOrOver: number;
    silosRunningOut: number;
  };
  production: Array<{
    itemId: string;
    itemCode: string;
    itemName: string;
    feedForm: 'BULK' | 'BAGGED' | null;
    days: Array<{
      date: string;
      approvedKg: number;
      forecastKg: number;
      totalKg: number;
      capacity: DietCapacity | null;
    }>;
    /** What the animals eat of this feed in the week (Rishi, 4 Nov). */
    consumption: {
      animals: number;
      byType: Array<{ animalType: string; heads: number }>;
      kgPerHeadDay: number | null;
      kg: number;
    };
    totalKg: number;
  }>;
  dietChanges: Array<{
    farmId: string;
    farmName: string;
    shedCode: string;
    batchNo: string;
    changeDate: string;
    fromItemName: string;
    toItemName: string;
    heads: number;
  }>;
  farms: Array<{
    farmId: string;
    code: string;
    name: string;
    totals: number[];
    sheds: Array<{
      key: string;
      /** Requisitions due into the silos this row draws from (Rishi, 4 Nov). */
      requisitions: Array<{
        date: string;
        requisitionId: string;
        reqNo: string;
        status: string;
        kg: number;
        sourceCode: string;
        itemName: string;
      }>;

      shedCode: string;
      batchNo: string;
      heads: number;
      items: Array<{ itemId: string; itemName: string }>;
      changeDate: string | null;
      kg: number[];
    }>;
    silos: Array<{
      /** Requisitions due into this silo for this feed (Rishi, 4 Nov). */
      requisitions: Array<{
        date: string;
        requisitionId: string;
        reqNo: string;
        status: string;
        kg: number;
        sourceCode: string;
        itemName: string;
      }>;
      sourceCode: string;
      sourceName: string | null;
      sourceType: 'SILO' | 'STORE';
      itemId: string;
      itemName: string;
      openingKg: number;
      closingKg: Array<number | null>;
      runOutDate: string | null;
    }>;
    /** Batches the forecast found no lifecycle feed row for (mill-plan.rules MillPlanNoFeedRow). */
    noFeedRows: Array<{
      batchNo: string;
      stageCode: string;
      fromDay: number;
      fromDate: string;
    }>;
  }>;
  siloCards: Array<{
    farmId: string;
    farmCode: string;
    farmName: string;
    sourceCode: string;
    sourceName: string | null;
    items: string[];
    stockKg: number;
    capacityKg: number | null;
    fillPct: number | null;
    runOutDate: string | null;
  }>;
  failedFarms: Array<{
    farmId: string;
    code: string;
    name: string;
    error: string;
  }>;
}

// Tonnes for reading at a glance (Rishi, 3 Nov); the exact KG is on each figure's hover.
const tonnes = (kg: number | null | undefined) => {
  if (kg === null || kg === undefined) return '—';
  if (kg === 0) return '0';
  if (Math.abs(kg) < 5) return '<0.01';
  return (kg / 1000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
const exactKg = (kg: number | null | undefined) =>
  kg === null || kg === undefined
    ? undefined
    : `${formatKg(Math.round(kg * 10) / 10)} KG`;

/** A figure with its exact weight in the app's hover card (as on the consolidation sheet), not the browser tooltip. */
function Figure({
  kg,
  hint,
  children,
}: {
  kg?: number | null;
  hint?: string;
  children: ReactNode;
}) {
  const text = hint ?? exactKg(kg);
  return text ? (
    <HoverHint hint={text} plain focusable={false}>
      {children}
    </HoverHint>
  ) : (
    <>{children}</>
  );
}

type Due = {
  date: string;
  requisitionId: string;
  reqNo: string;
  status: string;
  kg: number;
  sourceCode: string;
  itemName: string;
};

/**
 * A grid figure on a day a requisition is due (Rishi, 4 Nov): circled as on the Mill Consolidation sheet, the
 * requisitions on hover. Without one it is the plain figure with its exact KG.
 */
function DueFigure({
  kg,
  due,
  label,
  heading,
  children,
}: {
  kg: number | null;
  due: Due[];
  label: string;
  heading: string;
  children: ReactNode;
}) {
  if (!due.length) return <Figure kg={kg}>{children}</Figure>;
  const lines = [
    `${label}: ${exactKg(kg) ?? '0 KG'}`,
    ...due.map(
      (d) =>
        `${d.reqNo} · ${exactKg(d.kg)} ${d.itemName}${d.sourceCode ? ` → ${d.sourceCode}` : ''} · ${d.status.replace(/_/g, ' ').toLowerCase()}`,
    ),
  ];
  return (
    <HoverHint
      plain
      focusable={false}
      heading={heading}
      hint={lines.join('\n')}
      list={lines}
    >
      <span
        data-requisition-due
        className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 ring-2 ring-(--accent)"
      >
        {children}
      </span>
    </HoverHint>
  );
}

/** A day column's head: the date, and the weekday under it. */
function DayHead({ date }: { date: string }) {
  // Day and month only, so seven days fit beside the Farm / Shed column (Rishi, 4 Nov); the full date is on hover.
  return (
    <div
      data-day-head
      title={formatDateShort(date)}
      className="flex flex-col items-end leading-tight"
    >
      <span className="whitespace-nowrap">{`${date.slice(8, 10)}/${date.slice(5, 7)}`}</span>
      <span className="text-[10px] font-normal text-(--text-muted)">
        {weekday(date)}
      </span>
    </div>
  );
}

/** A section heading with an ⓘ that explains the section (and its unit) on hover. */
function SectionTitle({
  title,
  info,
  children,
}: {
  title: string;
  info: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-(--text-primary)">
        {title}
        {/* One bullet per point: the info strings separate their points with new lines. */}
        <HoverHint hint={info} heading={title} list={info.split('\n')} plain>
          <Info aria-label={info} className="h-3.5 w-3.5 text-(--text-muted)" />
        </HoverHint>
      </h2>
      {children}
    </div>
  );
}
/** An Animal Type code as people read it: COMMERCIAL_PIG → Commercial Pig. */
const animalTypeLabel = (code: string) =>
  code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
const DAY_MARK: Record<DayStatus, { Icon: typeof Check; cls: string }> = {
  OK: { Icon: Check, cls: 'text-(--success)' },
  WARN: { Icon: AlertTriangle, cls: 'text-(--warning)' },
  OVER: { Icon: X, cls: 'text-(--danger)' },
  NO_CAPACITY: { Icon: Info, cls: 'text-(--text-muted)' },
};
const BAR_FILL: Record<DayStatus, string> = {
  OK: 'bg-(--success)',
  WARN: 'bg-(--warning)',
  OVER: 'bg-(--danger)',
  NO_CAPACITY: 'bg-(--text-muted)',
};
const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  });
const CARD_TONE: Record<
  DayStatus,
  'success' | 'warning' | 'danger' | 'default'
> = { OK: 'default', WARN: 'warning', OVER: 'danger', NO_CAPACITY: 'default' };
const DOT: Record<MillCapacityStatus, string> = {
  GREEN: 'bg-(--success)',
  AMBER: 'bg-(--warning)',
  RED: 'bg-(--danger)',
};

const TH =
  'sticky top-0 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)';
const TH_DAY = `${TH} z-10`;
// A small table that never scrolls (Feed Type Changes): its header stays where it is.
const TH_PLAIN =
  'border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)';
// The first column stays put while the days scroll sideways: one z-index and one background per cell, so they never clash.
const TH_FIRST = `${TH} left-0 z-20 border-r text-left`;
const STICKY = 'sticky left-0 z-[1] border-r border-(--border)';
// Held at the top of the page's scroll area, under the day headers: Mill Total under the dates, and each farm's
// row under both until the next farm's row reaches the same place and covers it.
const MILL_TOTAL_FIRST =
  'sticky left-0 z-[9] border-r border-(--border) bg-(--surface)';
const MILL_TOTAL_DAY = 'sticky z-[8] bg-(--surface)';
const FARM_FIRST =
  'sticky left-0 z-[4] border-r border-(--border) bg-(--surface-raised)';
const FARM_DAY = 'sticky z-[3] bg-(--surface-raised)';
const TD = 'border-b border-(--border) px-3 py-2 align-middle text-xs';
const NUM = 'whitespace-nowrap text-right tabular-nums';
const HIGHLIGHT = 'bg-[color-mix(in_srgb,var(--warning)_18%,transparent)]';
const RUN_OUT = 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]';

export default function MillPlanPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const { planningDate } = useFeedForecastContext();
  // The forecast's planning date once it has one; until then the browser's today.
  const [weekOf, setWeekOf] = useState(planningDate || todayIso());
  const [farms, setFarms] = useState<FeedFarm[]>([]);
  const [farmIds, setFarmIds] = useState<string[] | null>(null);
  const [items, setItems] = useState<MultiPickOption[]>([]);
  const [itemIds, setItemIds] = useState<string[] | null>(null);
  const [millId, setMillId] = useState('');
  const [plan, setPlan] = useState<MillPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  // The filters the plan on screen was made with: once they differ, the button says Regenerate.
  const [generatedWith, setGeneratedWith] = useState<string | null>(null);
  const filterKey = (mill: string) =>
    JSON.stringify({ weekOf, farmIds, itemIds, mill });
  // The grid's header heights, so Mill Total sits under the dates and each farm row under both.
  const gridRef = useRef<HTMLTableElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);
  const datesRowRef = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => {
    const table = gridRef.current;
    const head = headRef.current;
    const row = datesRowRef.current;
    if (!table || !head || !row) return;
    const measure = () => {
      // A pixel of overlap so no sliver of the rows scrolling behind shows between the held rows.
      table.style.setProperty(
        '--mpl-row1',
        `${Math.floor(row.getBoundingClientRect().height) - 1}px`,
      );
      table.style.setProperty(
        '--mpl-head',
        `${Math.floor(head.getBoundingClientRect().height) - 1}px`,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    return () => observer.disconnect();
  }, [plan]);

  // The filter lists only — the plan itself waits for Generate.
  useEffect(() => {
    let alive = true;
    loadFeedFarms(getStoredUser())
      .then(async (list) => {
        if (!alive) return;
        setFarms(list);
        if (!list[0]) return;
        const options = unwrap<{
          items?: Array<{
            item_id: string;
            item_code: string;
            item_name: string;
          }>;
        }>(
          await api.get(
            `/feed-requisition/options?${new URLSearchParams({ farmId: list[0].farmId }).toString()}`,
          ),
        );
        if (alive)
          setItems(
            (options?.items ?? []).map((item) => ({
              id: item.item_id,
              code: item.item_code,
              name: item.item_name,
            })),
          );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function generate() {
    if (!weekOf) return;
    const params = new URLSearchParams({ weekOf });
    if (farmIds) params.set('farmIds', farmIds.join(','));
    if (itemIds) params.set('itemIds', itemIds.join(','));
    if (millId) params.set('millId', millId);
    setLoading(true);
    try {
      const data = unwrap<MillPlan>(
        await api.get(`/feed-forecast/mill-plan?${params.toString()}`),
      );
      setPlan(data);
      if (!millId && data?.mill) setMillId(data.mill.millId);
      setGeneratedWith(filterKey(millId || data?.mill?.millId || ''));
    } catch (err: any) {
      showToast.error(err?.message || tRef.current('mplLoadFailed'));
    } finally {
      setLoading(false);
    }
  }

  // A mill belongs to a company, and so do its farms: once a mill is known, only its company's farms are offered.
  const millCompany =
    plan?.mills.find((mill) => mill.millId === millId)?.companyId ?? null;
  const farmOptions = millCompany
    ? farms.filter((farm) => farm.companyId === millCompany)
    : farms;
  function chooseMill(id: string) {
    setMillId(id);
    const company = plan?.mills.find((mill) => mill.millId === id)?.companyId;
    setFarmIds((ids) =>
      ids && company
        ? ids.filter(
            (farmId) =>
              farms.find((farm) => farm.farmId === farmId)?.companyId ===
              company,
          )
        : ids,
    );
  }

  const emptyPick =
    (farmIds !== null && farmIds.length === 0) ||
    (itemIds !== null && itemIds.length === 0);
  const toggleFarm = (id: string) =>
    setCollapsed((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );

  return (
    // The negative margin and matching padding run the scroll area to the content's right edge, so its scrollbar sits
    // on the window border instead of a gutter's width inside it (the page container pads by 1.75rem on desktop; the
    // width must grow by the same, as the tab layout pins nested fill bodies to 100%).
    <div
      data-fill-body
      className="min-h-0 overflow-y-auto lg:-mr-7 lg:w-[calc(100%+1.75rem)]! lg:pr-7"
    >
      <div className="flex shrink-0 flex-wrap items-end gap-3 [&_.nf-input-sm]:h-11 [&>button]:h-11">
        <Field label={t('mplWeekOf')} htmlFor="mill-plan-week">
          <input
            id="mill-plan-week"
            type="date"
            className="nf-input-sm"
            value={weekOf}
            onChange={(event) => setWeekOf(event.target.value)}
          />
        </Field>
        <Field label={t('mplFarms')}>
          <MultiPick
            label={t('mplFarms')}
            options={farmOptions.map((farm) => ({
              id: farm.farmId,
              code: farm.code,
              name: farm.name,
            }))}
            selected={farmIds}
            onChange={setFarmIds}
          />
        </Field>
        <Field label={t('mplFeedTypes')}>
          <MultiPick
            label={t('mplFeedTypes')}
            options={items}
            selected={itemIds}
            onChange={setItemIds}
          />
        </Field>
        {(plan?.mills.length ?? 0) > 1 && (
          <Field label={t('mplMill')} htmlFor="mill-plan-mill">
            <SearchableSelect
              id="mill-plan-mill"
              ariaLabel={t('mplMill')}
              value={millId}
              onChange={chooseMill}
              options={plan!.mills.map((mill) => ({
                value: mill.millId,
                code: mill.millCode,
                name: mill.millName,
                label: `${mill.millCode} — ${mill.millName}`,
              }))}
              columnHeaders={['Code', 'Mill Name']}
              columns={[
                { key: 'code', label: 'Code' },
                { key: 'name', label: 'Mill Name' },
              ]}
              placeholder="Select mill…"
              searchPlaceholder="Search mill…"
              triggerClassName="nf-input-sm min-w-[12rem] h-11"
            />
          </Field>
        )}
        <Button onClick={generate} disabled={!weekOf || loading || emptyPick}>
          {plan && generatedWith !== null && generatedWith !== filterKey(millId)
            ? t('mplRegenerate')
            : t('mplGenerate')}
        </Button>
      </div>

      {loading && <LoadingState />}
      {!loading && !plan && (
        <div className="mt-6">
          <EmptyState title={t('mplBeforeGenerate')} />
        </div>
      )}

      {!loading && plan && (
        <div className="mt-4 space-y-5">
          <section aria-label={t('mplCapacity')}>
            <SectionTitle title={t('mplCapacity')} info={t('mplCapacityInfo')}>
              <span className="text-xs text-(--text-secondary)">
                {plan.mill
                  ? `${plan.mill.millCode} · ${plan.mill.dailyKg ? t('mplCapacityPerDay', { t: tonnes(plan.mill.dailyKg) }) : t('mplCapacityNotSet')}`
                  : t('mplNoMill')}
              </span>
            </SectionTitle>
            {(() => {
              // Rishi, 4 Nov: one bar against the mill's production capacity, as in the mockup, with a chip per day.
              const daily = plan.mill?.dailyKg ?? null;
              const avgKg =
                plan.capacity.reduce((sum, d) => sum + d.productionKg, 0) /
                Math.max(1, plan.capacity.length);
              const pct = daily ? Math.min(100, (avgKg / daily) * 100) : 0;
              const worst: DayStatus = plan.capacity.some(
                (d) => d.status === 'OVER',
              )
                ? 'OVER'
                : plan.capacity.some((d) => d.status === 'WARN')
                  ? 'WARN'
                  : daily
                    ? 'OK'
                    : 'NO_CAPACITY';
              return (
                <div
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-(--border) bg-(--surface) px-4 py-3"
                  data-capacity-bar
                >
                  <div className="flex min-w-[14rem] flex-1 items-center gap-3">
                    <div
                      className="h-2 flex-1 overflow-hidden rounded-full bg-(--surface-secondary)"
                      role="meter"
                      aria-label={t('mplCapacity')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(pct)}
                    >
                      <div
                        className={`h-full rounded-full ${BAR_FILL[worst]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className="whitespace-nowrap font-mono text-xs tabular-nums text-(--text-primary)"
                      data-capacity-used
                    >
                      {daily
                        ? t('mplCapacityBarUsed', {
                            used: tonnes(avgKg),
                            cap: tonnes(daily),
                          })
                        : t('mplCapacityNotSet')}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.capacity.map((day) => {
                      const mark = DAY_MARK[day.status];
                      return (
                        <HoverHint
                          key={day.date}
                          plain
                          focusable={false}
                          hint={`${weekday(day.date)} ${formatDateShort(day.date)} · ${exactKg(day.productionKg) ?? '0 KG'}${day.usedPct !== null ? ` · ${t('mplCapacityUsed', { pct: day.usedPct })}` : ''}`}
                        >
                          <span
                            data-capacity-day={day.date}
                            data-status={day.status}
                            className="inline-flex items-center gap-1 rounded-md border border-(--border) px-2 py-1 font-mono text-[11px] tabular-nums text-(--text-primary)"
                          >
                            {weekday(day.date).toUpperCase()}:{' '}
                            {tonnes(day.productionKg)}t
                            <mark.Icon
                              aria-label={day.status}
                              className={`h-3 w-3 ${mark.cls}`}
                            />
                          </span>
                        </HoverHint>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </section>

          <StatRow columns={6}>
            <StatCard
              label={t('mplCardTotal')}
              value={
                <Figure kg={plan.cards.totalKg}>
                  {tonnes(plan.cards.totalKg)}
                </Figure>
              }
              unit="t"
            />
            <StatCard
              label={t('mplCardFarms')}
              value={plan.cards.farms}
              sub={t('mplCardFarmsSub', {
                sheds: plan.cards.sheds,
                silos: plan.cards.silos,
              })}
            />
            <StatCard
              label={t('mplCardFeedTypes')}
              value={plan.cards.feedTypes}
            />
            <StatCard
              label={t('mplCardDietChanges')}
              value={plan.cards.dietChanges}
              tone={plan.cards.dietChanges ? 'warning' : 'default'}
            />
            <StatCard
              label={t('mplCardDaysNear')}
              value={plan.cards.daysNearOrOver}
              tone={
                plan.capacity.some((d) => d.status === 'OVER')
                  ? CARD_TONE.OVER
                  : plan.cards.daysNearOrOver
                    ? CARD_TONE.WARN
                    : 'default'
              }
            />
            <StatCard
              label={t('mplCardSilosOut')}
              value={plan.cards.silosRunningOut}
              tone={plan.cards.silosRunningOut ? 'danger' : 'default'}
            />
          </StatRow>

          {plan.failedFarms.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-(--danger) px-3 py-2 text-xs text-(--danger)"
            >
              {plan.failedFarms.map((farm) => (
                <div key={farm.farmId}>
                  {t('mplFarmFailed', {
                    farm: `${farm.code} — ${farm.name}`,
                    error: farm.error,
                  })}
                </div>
              ))}
            </div>
          )}

          {plan.production.length > 0 && (
            <section aria-label={t('mplProduction')}>
              <SectionTitle
                title={t('mplProduction')}
                info={t('mplProductionInfo')}
              />
              {
                <div className="overflow-x-auto rounded-lg border border-(--border)">
                  <table className="w-full min-w-[64rem] table-fixed border-collapse">
                    <thead>
                      <tr>
                        <th className={`${TH_FIRST} w-56`}>{t('mplFeed')}</th>
                        <th className={`${TH_DAY} ${NUM} w-24`}>
                          {t('mplAnimals')}
                        </th>
                        <th className={`${TH_DAY} ${NUM} w-28`}>
                          {t('mplKgPerHeadDay')}
                        </th>
                        {plan.dates.map((date) => (
                          <th key={date} className={`${TH_DAY} ${NUM}`}>
                            <DayHead date={date} />
                          </th>
                        ))}
                        <th className={`${TH_DAY} ${NUM}`}>{t('mplTotal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.production.map((row) => (
                        <tr key={row.itemId}>
                          <td className={`${TD} ${STICKY} bg-(--surface)`}>
                            <div className="font-medium text-(--text-primary)">
                              {row.itemName}
                            </div>
                            <div className="text-[11px] text-(--text-secondary)">
                              {row.itemCode}
                              {row.feedForm ? ` · ${row.feedForm}` : ''}
                            </div>
                          </td>
                          <td className={`${TD} ${NUM}`} data-animals>
                            {row.consumption.animals > 0 ? (
                              <HoverHint
                                plain
                                focusable={false}
                                heading={t('mplAnimalsByType')}
                                hint={row.consumption.byType
                                  .map(
                                    (type) =>
                                      `${animalTypeLabel(type.animalType)}: ${type.heads.toLocaleString('en-US')}`,
                                  )
                                  .join('\n')}
                                list={row.consumption.byType.map(
                                  (type) =>
                                    `${animalTypeLabel(type.animalType)}: ${type.heads.toLocaleString('en-US')}`,
                                )}
                              >
                                <span className="underline decoration-dotted underline-offset-2">
                                  {row.consumption.animals.toLocaleString(
                                    'en-US',
                                  )}
                                </span>
                              </HoverHint>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={`${TD} ${NUM}`} data-kg-per-head>
                            {row.consumption.kgPerHeadDay !== null ? (
                              <Figure
                                hint={t('mplConsumedWeek', {
                                  kg: exactKg(row.consumption.kg) ?? '0 KG',
                                })}
                              >
                                {row.consumption.kgPerHeadDay.toLocaleString(
                                  'en-US',
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 3,
                                  },
                                )}
                              </Figure>
                            ) : (
                              '—'
                            )}
                          </td>
                          {row.days.map((day) => (
                            <td key={day.date} className={`${TD} ${NUM}`}>
                              {day.totalKg > 0 ? (
                                <Figure
                                  hint={t('mplProductionSplit', {
                                    approved: exactKg(day.approvedKg) ?? '0 KG',
                                    forecast: exactKg(day.forecastKg) ?? '0 KG',
                                  })}
                                >
                                  {tonnes(day.totalKg)}
                                </Figure>
                              ) : (
                                '—'
                              )}
                              {day.totalKg > 0 && day.capacity && (
                                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-(--text-secondary)">
                                  {day.capacity.status && (
                                    <span
                                      aria-hidden
                                      className={`h-1.5 w-1.5 rounded-full ${DOT[day.capacity.status]}`}
                                    />
                                  )}
                                  <HoverHint
                                    hint={t(
                                      day.capacity.state === 'NOT_SCHEDULED'
                                        ? 'mplNotScheduledHint'
                                        : day.capacity.state ===
                                            'NOT_CONFIGURED'
                                          ? 'mplNotConfiguredHint'
                                          : 'mplBinAvailableHint',
                                    )}
                                    focusable={false}
                                  >
                                    {millCapacityText(
                                      day.capacity.state,
                                      day.capacity.availableKg,
                                      t,
                                    )}
                                  </HoverHint>
                                </div>
                              )}
                            </td>
                          ))}
                          <td className={`${TD} ${NUM} font-semibold`}>
                            <Figure kg={row.totalKg}>
                              {tonnes(row.totalKg)}
                            </Figure>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            </section>
          )}

          {plan.dietChanges.length > 0 && (
            <section aria-label={t('mplDietChanges')}>
              <SectionTitle
                title={t('mplDietChanges')}
                info={t('mplDietChangesInfo')}
              />
              {
                <div className="overflow-x-auto rounded-lg border border-(--border)">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={`${TH_PLAIN} w-28 text-left`}>
                          {t('mplColDate')}
                        </th>
                        <th className={`${TH_PLAIN} text-left`}>
                          {t('mplColFarmShed')}
                        </th>
                        <th className={`${TH_PLAIN} text-left`}>
                          {t('mplColBatch')}
                        </th>
                        <th className={`${TH_PLAIN} text-left`}>
                          {t('mplColFeedChange')}
                        </th>
                        <th className={`${TH_PLAIN} w-24 text-right`}>
                          {t('mplColHead')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.dietChanges.map((change) => (
                        <tr
                          key={`${change.farmId}|${change.shedCode}|${change.batchNo}|${change.changeDate}`}
                        >
                          <td className={TD}>
                            <div className="flex flex-col leading-tight">
                              <span className="font-medium text-(--text-primary)">
                                {formatDateShort(change.changeDate)}
                              </span>
                              <span className="text-[10px] text-(--text-muted)">
                                {weekday(change.changeDate)}
                              </span>
                            </div>
                          </td>
                          <td className={`${TD} text-(--text-primary)`}>
                            {change.farmName} / {change.shedCode}
                          </td>
                          <td className={`${TD} text-(--text-secondary)`}>
                            {change.batchNo}
                          </td>
                          <td className={TD}>
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-(--surface-raised) px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--text-secondary)">
                                {change.fromItemName}
                              </span>
                              <span aria-hidden className="text-(--warning)">
                                →
                              </span>
                              <span className="rounded bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--text-primary)">
                                {change.toItemName}
                              </span>
                            </span>
                          </td>
                          <td className={`${TD} ${NUM}`}>
                            {change.heads.toLocaleString('en-US')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            </section>
          )}

          <section aria-label={t('mplGrid')}>
            <SectionTitle title={t('mplGrid')} info={t('mplGridInfo')}>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setCollapsed(plan.farms.map((farm) => farm.farmId))
                  }
                >
                  {t('mplCollapseAll')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCollapsed([])}
                >
                  {t('mplExpandAll')}
                </Button>
              </div>
            </SectionTitle>
            {/* No scroll area of its own: the header, Mill Total and farm rows stick to the page's scroll, so one wheel
                moves the whole page and nothing traps it. */}
            <div data-mill-grid className="rounded-lg border border-(--border)">
              <table
                ref={gridRef}
                className="w-full table-fixed border-separate border-spacing-0"
              >
                <thead ref={headRef}>
                  <tr ref={datesRowRef}>
                    <th className={`${TH_FIRST} w-56 rounded-tl-lg xl:w-80`}>
                      {t('mplFarmShed')}
                    </th>
                    {plan.dates.map((date) => (
                      <th key={date} className={`${TH_DAY} ${NUM}`}>
                        <DayHead date={date} />
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th
                      className={`${TD} ${MILL_TOTAL_FIRST} text-left font-semibold text-(--text-secondary)`}
                      style={{ top: 'var(--mpl-row1)' }}
                    >
                      {t('mplMillTotal')}
                    </th>
                    {plan.dates.map((date, i) => (
                      <th
                        key={date}
                        className={`${TD} ${MILL_TOTAL_DAY} ${NUM} font-semibold`}
                        style={{ top: 'var(--mpl-row1)' }}
                      >
                        <Figure
                          kg={plan.farms.reduce(
                            (sum, farm) => sum + farm.totals[i],
                            0,
                          )}
                        >
                          {tonnes(
                            plan.farms.reduce(
                              (sum, farm) => sum + farm.totals[i],
                              0,
                            ),
                          )}
                        </Figure>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.farms.map((farm) => {
                    const open = !collapsed.includes(farm.farmId);
                    return (
                      <Fragment key={farm.farmId}>
                        <tr data-farm-row className="bg-(--surface-raised)">
                          <td
                            className={`${TD} ${FARM_FIRST}`}
                            style={{ top: 'var(--mpl-head)' }}
                          >
                            <button
                              type="button"
                              className="flex w-full items-center gap-1.5 text-left font-semibold text-(--text-primary)"
                              aria-expanded={open}
                              onClick={() => toggleFarm(farm.farmId)}
                            >
                              <span
                                aria-hidden
                                className="w-3 shrink-0 text-(--text-muted)"
                              >
                                {open ? '▾' : '▸'}
                              </span>
                              <span className="truncate">
                                {farm.code} — {farm.name}
                              </span>
                            </button>
                            <div className="pl-[1.125rem] text-[11px] font-normal text-(--text-secondary)">
                              {t('mplFarmSub', {
                                sheds: farm.sheds.length,
                                silos: farm.silos.length,
                              })}
                            </div>
                            {farm.noFeedRows.length > 0 && (
                              <div className="pl-[1.125rem] text-[11px] font-normal text-(--warning)">
                                {(() => {
                                  const lines = farm.noFeedRows.map((gap) =>
                                    t('mplNoFeedRowLine', {
                                      batch: gap.batchNo.includes(gap.stageCode)
                                        ? gap.batchNo
                                        : `${gap.batchNo} · ${gap.stageCode}`,
                                      day: gap.fromDay,
                                      date: formatDateShort(gap.fromDate),
                                    }),
                                  );
                                  return (
                                    <HoverHint
                                      hint={lines.join(' · ')}
                                      heading={t('mplNoFeedRowsTitle')}
                                      list={lines}
                                      focusable={false}
                                    >
                                      <span data-no-feed-rows>
                                        {t('mplNoFeedRows', {
                                          count: farm.noFeedRows.length,
                                        })}
                                      </span>
                                    </HoverHint>
                                  );
                                })()}
                              </div>
                            )}
                          </td>
                          {farm.totals.map((kg, i) => (
                            <td
                              key={plan.dates[i]}
                              className={`${TD} ${FARM_DAY} ${NUM} font-semibold`}
                              style={{ top: 'var(--mpl-head)' }}
                            >
                              <Figure kg={kg}>{tonnes(kg)}</Figure>
                            </td>
                          ))}
                        </tr>
                        {open &&
                          farm.sheds.map((shed) => (
                            <tr key={shed.key}>
                              <td
                                className={`${TD} ${STICKY} bg-(--surface) pl-[1.875rem]`}
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="min-w-0 break-words text-(--text-primary)">
                                    {shed.shedCode}{' '}
                                    <span className="text-(--text-secondary)">
                                      · {shed.batchNo}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-[11px] text-(--text-secondary)">
                                    {t('mplHeads', { heads: shed.heads })}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {shed.items.map((item, i) => (
                                    <Fragment key={item.itemId}>
                                      {i > 0 && (
                                        <span
                                          aria-hidden
                                          className="text-[10px] text-(--text-secondary)"
                                        >
                                          →
                                        </span>
                                      )}
                                      <span className="rounded bg-(--surface-raised) px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--text-secondary)">
                                        {item.itemName}
                                      </span>
                                    </Fragment>
                                  ))}
                                  {shed.changeDate && (
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--warning)">
                                      {t('mplTypeChange')}
                                    </span>
                                  )}
                                </div>
                              </td>
                              {shed.kg.map((kg, i) => {
                                const date = plan.dates[i];
                                const change = shed.changeDate === date;
                                return (
                                  <td
                                    key={date}
                                    className={`${TD} ${NUM} ${change ? HIGHLIGHT : ''}`}
                                    {...(change
                                      ? {
                                          'data-diet-change': '',
                                          'data-date': date,
                                        }
                                      : {})}
                                  >
                                    <DueFigure
                                      kg={kg}
                                      due={shed.requisitions.filter(
                                        (d) => d.date === date,
                                      )}
                                      label={t('mplEaten')}
                                      heading={t('mplRequisitionsDue')}
                                    >
                                      {tonnes(kg)}
                                    </DueFigure>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        {open &&
                          farm.silos.map((silo) => (
                            <tr
                              key={`${farm.farmId}|${silo.sourceCode}|${silo.itemId}`}
                              data-silo-row
                            >
                              <td
                                className={`${TD} ${STICKY} bg-(--surface) pl-[1.875rem]`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span
                                    data-silo-code
                                    className="font-medium text-(--text-primary)"
                                  >
                                    {silo.sourceCode}
                                  </span>
                                  <span className="rounded bg-(--surface-raised) px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--text-secondary)">
                                    {silo.sourceType === 'SILO'
                                      ? t('mplSilo')
                                      : t('mplStore')}
                                  </span>
                                </div>
                                {silo.sourceName &&
                                  silo.sourceName !== silo.sourceCode && (
                                    <div
                                      data-silo-name
                                      className="mt-0.5 break-words text-[11px] text-(--text-secondary)"
                                    >
                                      {silo.sourceName}
                                    </div>
                                  )}
                                <div className="mt-0.5 text-[11px] text-(--text-muted)">
                                  {silo.itemName} ·{' '}
                                  {t('mplOpening', {
                                    t: tonnes(silo.openingKg),
                                  })}
                                </div>
                              </td>
                              {silo.closingKg.map((kg, i) => {
                                const date = plan.dates[i];
                                const out = silo.runOutDate === date;
                                return (
                                  <td
                                    key={date}
                                    className={`${TD} ${NUM} text-(--text-secondary) ${out ? RUN_OUT : ''}`}
                                    {...(out
                                      ? {
                                          'data-run-out': '',
                                          'data-date': date,
                                        }
                                      : {})}
                                  >
                                    <DueFigure
                                      kg={kg}
                                      due={silo.requisitions.filter(
                                        (d) => d.date === date,
                                      )}
                                      label={t('mplClosing')}
                                      heading={t('mplRequisitionsDue')}
                                    >
                                      {tonnes(kg)}
                                    </DueFigure>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {plan.siloCards.length > 0 && (
            <section aria-label={t('mplSiloLevels')}>
              <SectionTitle
                title={t('mplSiloLevels')}
                info={t('mplSiloLevelsInfo')}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {plan.siloCards.map((card) => {
                  const pct =
                    card.fillPct === null
                      ? null
                      : Math.max(0, Math.min(100, card.fillPct));
                  const tone =
                    pct === null
                      ? ''
                      : pct <= 15
                        ? 'bg-(--danger)'
                        : pct <= 35
                          ? 'bg-(--warning)'
                          : 'bg-(--success)';
                  return (
                    <div
                      key={`${card.farmId}|${card.sourceCode}`}
                      data-silo-card={`${card.farmId}|${card.sourceCode}`}
                      className="rounded-md border border-(--border) bg-(--surface) p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p
                            data-silo-code
                            className="text-sm font-semibold text-(--text-primary)"
                          >
                            {card.sourceCode}
                          </p>
                          {card.sourceName &&
                            card.sourceName !== card.sourceCode && (
                              <p
                                data-silo-name
                                className="text-xs text-(--text-secondary)"
                              >
                                {card.sourceName}
                              </p>
                            )}
                          <p className="mt-0.5 truncate text-[11px] text-(--text-muted)">
                            {card.farmCode} — {card.farmName}
                          </p>
                        </div>
                        {pct !== null && (
                          <span className="text-sm font-semibold tabular-nums text-(--text-primary)">
                            {card.fillPct}%
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-[11px] uppercase tracking-wider text-(--text-muted)">
                        {card.items.join(' · ')}
                      </p>
                      {pct !== null ? (
                        <div
                          role="progressbar"
                          aria-label={t('mplSiloFill', {
                            silo: card.sourceCode,
                          })}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={card.fillPct ?? 0}
                          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-(--surface-secondary)"
                        >
                          <div
                            className={`h-full rounded-full ${tone}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      ) : null}
                      <p className="mt-2 text-xs tabular-nums text-(--text-secondary)">
                        {card.capacityKg !== null
                          ? t('mplSiloStock', {
                              stock: tonnes(card.stockKg),
                              capacity: tonnes(card.capacityKg),
                            })
                          : `${t('mplSiloStockOnly', { stock: tonnes(card.stockKg) })} · ${t('mplCapacityNotSet')}`}
                      </p>
                      {card.runOutDate && (
                        <p className="mt-1 text-xs font-medium text-(--danger)">
                          {t('mplSiloRunsOut', {
                            date: `${weekday(card.runOutDate)} ${formatDateShort(card.runOutDate)}`,
                          })}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
