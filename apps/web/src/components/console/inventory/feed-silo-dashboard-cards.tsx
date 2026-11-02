"use client";

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { StatCard, StatRow } from "@/components/ui/stat-row";
import { Skeleton } from "@/components/ui/states";
import type { TranslationKeys } from "@/utils/translations";
import { formatDateShort } from "./feed-format";
import { REQ_STATUS_LABEL, labelOf } from "./requisition-labels";
import { RecordLink, itemHref, locationHref } from "./feed-requisition-header";

export interface MillLoadingBin {
  binId: string;
  binCode: string;
  productionDate: string;
}

export interface SelectedSiloDashboard {
  siloId: string;
  siloCode: string;
  siloName: string;
  capacityKg: number | null;
  belowFeedLevelKg: number | null;
  aboveThresholdKg: number | null;
  systemBalanceKg: number;
  currentDietItemName: string | null;
  /** W2D A5: item ids and Item No. for the item links (Dashboard rows 50, 58). */
  currentDietItemId?: string | null;
  currentDietItemCode?: string | null;
  feedInSiloItemId?: string | null;
  feedInSiloItemCode?: string | null;
  dailyRequirementKg: number;
  daysRemaining: number | null;
  /** Dashboard row 55: Days of Feed Remaining is read with the first shortage date. */
  firstShortageDate?: string | null;
  projectedNeedKg: number;
  currentProjectedNeedKg: number;
  nextProjectedNeedKg: number;
  currentDietDaysRemaining: number | null;
  nextDietItemName: string | null;
  nextDietItemId?: string | null;
  nextDietItemCode?: string | null;
  nextDietDate: string | null;
  /** Why Next Diet Feed Item is blank (no feed item set for the next stage, last stage). */
  nextDietNote?: string | null;
  siloAvailableForNextDiet: boolean | null;
  /** Checkpoint 9: the ACTIVE silo at the house whose Feed Type matches the next diet. */
  nextDietSiloId?: string | null;
  nextDietSiloCode?: string | null;
  nextDietSiloName?: string | null;
  projectedShortfallKg: number;
  recommendedOrderKg: number;
  requisitionId: string | null;
  requisitionStatus: string | null;
  submissionDeadline: string | null;
  millLoadingBin: MillLoadingBin | null;
  /** Rishi, 2 Nov: the heads of the batches drawing on this silo on the planning date, and those batches. */
  animalsFed?: number;
  animalsFedBatches?: Array<{ batchNo: string; stage: string; heads: number }>;
}

type Translate = (key: TranslationKeys) => string;

const number = (value: number | null | undefined, unavailable: string) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? unavailable
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
/** A KG quantity where the label no longer carries the unit; "Not available" stays bare. */
const kg = (value: number | null | undefined, unavailable: string) => {
  const shown = number(value, unavailable);
  return shown === unavailable ? shown : `${shown} kg`;
};
/** Silo r9: Days of Feed Remaining is shown to one decimal. */
const oneDecimal = (value: number | null | undefined, unavailable: string) =>
  value === null || value === undefined || !Number.isFinite(value) ? unavailable : value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
type Tone = "danger" | "warning" | "success";
const DOT: Record<Tone, string> = { danger: "bg-(--danger)", warning: "bg-(--warning)", success: "bg-(--success)" };
function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)">
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[tone]}`} />
      {label}
    </span>
  );
}

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-2 align-top";

const date = (value: string | null | undefined, unavailable: string) => value ? formatDateShort(value) : unavailable;

/** The item's name (its code without one), linked to the item record (14 Oct: a field shows the thing). */
function ItemValue({ id, code, name, unavailable }: { id?: string | null; code?: string | null; name: string | null; unavailable: string }) {
  const text = name || code;
  if (!text) return <>{unavailable}</>;
  return <RecordLink code={text} href={id ? itemHref(id) : null} />;
}

export interface DashboardShed {
  id: string;
  code: string;
  name: string;
}

export function FeedSiloDashboardCards({
  silo,
  shed,
  farmTotalOrderKg,
  t,
}: {
  silo: SelectedSiloDashboard;
  /** Dashboard row 48: the selected House Shed, shown as a linked row. */
  shed?: DashboardShed | null;
  farmTotalOrderKg: number;
  t: Translate;
}) {
  const bin = silo.millLoadingBin;
  const unavailable = t("fsdNotAvailable");
  const binValue: ReactNode = bin
    ? <><RecordLink code={bin.binCode} href={locationHref(bin.binId)} />{` · ${date(bin.productionDate, unavailable)}`}</>
    : t("fsdNotScheduled");
  const yesNo: ReactNode = silo.siloAvailableForNextDiet === null
    ? unavailable
    : silo.siloAvailableForNextDiet
      ? t("fsdYes")
      : t("fsdNo");
  const nextDiet: ReactNode = silo.nextDietItemName || silo.nextDietItemCode
    ? <ItemValue id={silo.nextDietItemId} code={silo.nextDietItemCode} name={silo.nextDietItemName} unavailable={unavailable} />
    : silo.nextDietNote
      ? <>{unavailable}<span className="block text-xs font-normal text-(--text-muted)">{silo.nextDietNote}</span></>
      : unavailable;
  const nextDietStarts = date(silo.nextDietDate, unavailable);
  // Current diet: the item eaten today, else Feed in Silo — the same fallback the API uses for the name.
  const currentDiet: ReactNode = silo.currentDietItemCode
    ? <ItemValue id={silo.currentDietItemId} code={silo.currentDietItemCode} name={silo.currentDietItemName} unavailable={unavailable} />
    : <ItemValue id={silo.feedInSiloItemId} code={silo.feedInSiloItemCode} name={silo.currentDietItemName} unavailable={unavailable} />;
  const firstShortage = date(silo.firstShortageDate, t("fsdNoShortage"));
  // The date has its own First Shortage row below, so the count stands alone here.
  const daysRemaining = oneDecimal(silo.daysRemaining, unavailable);
  const projectedNeed = silo.nextProjectedNeedKg > 0
    ? `${kg(silo.projectedNeedKg, unavailable)} (${number(silo.currentProjectedNeedKg, unavailable)} + ${number(silo.nextProjectedNeedKg, unavailable)})`
    : kg(silo.projectedNeedKg, unavailable);
  const requisitionLabel = silo.requisitionStatus ? labelOf(REQ_STATUS_LABEL, silo.requisitionStatus, t as never) : null;
  const requisition = silo.requisitionId && requisitionLabel
    ? <a className="text-(--accent) hover:underline" href={`/requisitions?id=${encodeURIComponent(silo.requisitionId)}`}>{requisitionLabel}</a>
    : requisitionLabel ?? unavailable;

  // Days of Feed Remaining colour (master plan WP3): under 3 days critical, under 7 warning.
  const status: { tone: Tone; label: string } | null = silo.daysRemaining === null ? null
    : silo.daysRemaining < 3 ? { tone: "danger", label: t("fsdStatusShortfall") }
    : silo.daysRemaining < 7 ? { tone: "warning", label: t("fsdStatusLow") }
    : { tone: "success", label: t("fsdStatusOk") };

  const [batchesOpen, setBatchesOpen] = useState(false);
  const animalsFed = number(silo.animalsFed, unavailable);
  const animalsFedText = animalsFed === unavailable ? animalsFed : `${animalsFed} ${t("fsdHeadUnit")}`;
  const details: Array<{ label: TranslationKeys; value: ReactNode }> = [
    { label: "fsdCurrentDietFeedItem", value: currentDiet },
    { label: "fsdMillLoadingBin", value: binValue },
    { label: "fsdSiloCapacityKg", value: kg(silo.capacityKg, unavailable) },
    { label: "fsdSystemBalanceKg", value: kg(silo.systemBalanceKg, unavailable) },
    { label: "fsdDailyRequirementKg", value: kg(silo.dailyRequirementKg, unavailable) },
    { label: "fsdAnimalsFed", value: animalsFedText },
    { label: "fsdDaysFeedRemaining", value: daysRemaining },
    { label: "fsdFirstShortageDate", value: firstShortage },
    { label: "fsdProjectedNeedRangeKg", value: projectedNeed },
    { label: "fsdCurrentDietDaysRemaining", value: number(silo.currentDietDaysRemaining, unavailable) },
    { label: "fsdNextDietFeedItem", value: nextDiet },
    { label: "fsdNextDietStarts", value: nextDietStarts },
    { label: "fsdSiloAvailableNextDiet", value: yesNo },
    { label: "fsdProjectedShortfallKg", value: kg(silo.projectedShortfallKg, unavailable) },
    { label: "fsdRecommendedOrderKg", value: kg(silo.recommendedOrderKg, unavailable) },
    { label: "fsdFarmTotalOrderKg", value: kg(farmTotalOrderKg, unavailable) },
    { label: "fsdRequisitionStatus", value: requisition },
    { label: "fsdSubmissionDeadline", value: date(silo.submissionDeadline, unavailable) },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <StatRow columns={4}>
        <div className="min-w-0 rounded-md border border-(--border) bg-(--surface) p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-(--text-muted)">{t("fsdCurrentDietFeedItem")}</p>
          <p className="mt-1.5 break-words text-base font-semibold leading-snug text-(--text-primary)" title={silo.currentDietItemName ?? unavailable}>
            {silo.currentDietItemName ?? unavailable}
          </p>
        </div>
        <StatCard label={t("fsdSiloCapacityKg")} value={number(silo.capacityKg, unavailable)} unit="kg" />
        <StatCard label={t("fsdSystemBalanceKg")} value={number(silo.systemBalanceKg, unavailable)} unit="kg" />
        <StatCard label={t("fsdDailyRequirementKg")} value={number(silo.dailyRequirementKg, unavailable)} unit="kg" />
        <StatCard
          label={t("fsdAnimalsFed")}
          value={animalsFed}
          unit={t("fsdHeadUnit")}
          action={
            <button
              type="button"
              aria-label={t("fsdAnimalsFedBatches")}
              title={t("fsdAnimalsFedBatches")}
              onClick={() => setBatchesOpen(true)}
              className="nf-press -m-1 rounded-full p-1 text-(--text-muted) transition-colors hover:bg-(--surface-raised) hover:text-(--accent)"
            >
              <Info className="h-4 w-4" />
            </button>
          }
        />
        <StatCard label={t("fsdDaysFeedRemaining")} value={oneDecimal(silo.daysRemaining, unavailable)} unit={t("fsdDaysUnit")} sub={status || silo.firstShortageDate ? <span className="inline-flex flex-wrap items-center gap-2">{status && <StatusDot tone={status.tone} label={status.label} />}{silo.firstShortageDate && <span className="text-xs text-(--text-secondary)">{t("fsdFirstShortageDate")}: {formatDateShort(silo.firstShortageDate)}</span>}</span> : undefined} />
        <StatCard label={t("fsdRecommendedOrderKg")} value={number(silo.recommendedOrderKg, unavailable)} unit="kg" />
      </StatRow>
      <AnimalsFedDialog open={batchesOpen} onClose={() => setBatchesOpen(false)} silo={silo} shed={shed ?? null} t={t} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="p-4 pb-2"><CardTitle>{t("fsdForecastDetails")}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 p-4 pt-0 text-sm">
            <Summary label={t("fsdFirstShortageDate")} value={firstShortage} />
            <Summary label={t("fsdProjectedNeedRangeKg")} value={projectedNeed} />
            <Summary label={t("fsdCurrentDietDaysRemaining")} value={number(silo.currentDietDaysRemaining, unavailable)} />
            <Summary label={t("fsdNextDietFeedItem")} value={nextDiet} />
            <Summary label={t("fsdNextDietStarts")} value={nextDietStarts} />
            <Summary label={t("fsdSiloAvailableNextDiet")} value={yesNo} />
            <Summary label={t("fsdProjectedShortfallKg")} value={<span className="tabular-nums">{kg(silo.projectedShortfallKg, unavailable)}</span>} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2"><CardTitle>{t("fsdFulfilmentDetails")}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 p-4 pt-0 text-sm">
            <Summary label={t("fsdMillLoadingBin")} value={binValue} />
            <Summary label={t("fsdRequisitionStatus")} value={requisition} />
            <Summary label={t("fsdSubmissionDeadline")} value={date(silo.submissionDeadline, unavailable)} />
          </CardContent>
        </Card>
        <StatCard label={t("fsdFarmTotalOrderKg")} value={number(farmTotalOrderKg, unavailable)} unit="kg" sub={t("fsdFarmWideTotal")} />
      </div>

      <div className="max-h-[60vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)">
        <table aria-label={t("fsdLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead><tr><th scope="col" className={TH}>{t("fsdField")}</th><th scope="col" className={`${TH} text-right`}>{t("fsdValue")}</th></tr></thead>
          <tbody>
            <tr>
              <td className={`${TD} font-medium`}>{t("fsdSilo")}</td>
              <td className={`${TD} break-words text-right`}><a className="text-(--accent) hover:underline" href={`/master-data/location?recordId=${encodeURIComponent(silo.siloId)}`}>{silo.siloName || silo.siloCode}</a></td>
            </tr>
            {shed && (
              <tr>
                <td className={`${TD} font-medium`}>{t("fsdShed")}</td>
                <td className={`${TD} break-words text-right`}><RecordLink code={shed.name || shed.code} href={locationHref(shed.id)} /></td>
              </tr>
            )}
            {details.map((detail) => <tr key={detail.label}><td className={`${TD} font-medium`}>{t(detail.label)}</td><td className={`${TD} min-w-48 break-words text-right tabular-nums`}>{detail.value}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-(--text-secondary)">{label}</span><span className="min-w-0 break-words text-right font-medium tabular-nums text-(--text-primary)">{value}</span></div>;
}

/**
 * Rishi, 2 Nov: what stands in for the cards and charts while a silo's figures load — their shapes, not a spinner:
 * the seven stat cards, the two detail panels beside Farm Total Order, and the two charts.
 */
export function FeedSiloDashboardSkeleton({ label }: { label: string }) {
  const block = "rounded-md border border-(--border) bg-(--surface) p-4";
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex min-h-0 flex-col gap-4">
      <StatRow columns={4}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} data-skeleton-card className={block}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
          </div>
        ))}
      </StatRow>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={`${block} space-y-3`}>
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: i === 2 ? 1 : 4 }, (_, j) => (
              <div key={j} className="flex justify-between gap-4"><Skeleton className="h-3 w-28" /><Skeleton className="h-3 w-16" /></div>
            ))}
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} data-skeleton-chart className={`${block} space-y-3`}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-72 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Rishi, 2 Nov: the batches behind Animals Fed, from the card's info button — each batch, the stage it is in that day
 * (an animal-wise batch once per stage group), and its heads, with the total.
 */
function AnimalsFedDialog({ open, onClose, silo, shed, t }: { open: boolean; onClose: () => void; silo: SelectedSiloDashboard; shed: DashboardShed | null; t: Translate }) {
  const batches = silo.animalsFedBatches ?? [];
  // Rishi, 2 Nov: the selected shed's batches only, so the dialog names the shed beside the silo.
  const where = [shed ? shed.name || shed.code : null, silo.siloName || silo.siloCode].filter(Boolean).join(" — ");
  return (
    <Dialog open={open} onClose={onClose} title={t("fsdAnimalsFedBatches")} description={where} presentation="compact" maxWidth="md">
      {batches.length ? (
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-(--border)">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead><tr>
              <th scope="col" className={TH}>{t("fsdColBatch")}</th>
              <th scope="col" className={TH}>{t("fsdColStage")}</th>
              <th scope="col" className={`${TH} text-right`}>{t("fsdColHead")}</th>
            </tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={`${b.batchNo}|${b.stage}`}>
                  <td className={`${TD} font-medium`}>{b.batchNo}</td>
                  <td className={`${TD} text-(--text-secondary)`}>{b.stage}</td>
                  <td className={`${TD} text-right tabular-nums`}>{b.heads.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td className="px-3 py-2 font-semibold">{t("fsdTotal")}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{(silo.animalsFed ?? 0).toLocaleString("en-US")}</td>
            </tr></tfoot>
          </table>
        </div>
      ) : (
        <p className="text-sm text-(--text-secondary)">{t("fsdAnimalsFedNone")}</p>
      )}
    </Dialog>
  );
}
