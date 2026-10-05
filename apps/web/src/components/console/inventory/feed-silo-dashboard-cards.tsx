"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollTable } from "@/components/ui/scroll-table";
import { StatCard, StatRow } from "@/components/ui/stat-row";
import type { TranslationKeys } from "@/utils/translations";
import { formatDateShort } from "./feed-format";

export interface MillLoadingBin {
  binId: string;
  binCode: string;
  productionDate: string;
  slotId: string;
  slotCode: string;
  slotName: string;
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
  dailyRequirementKg: number;
  daysRemaining: number | null;
  projectedNeedKg: number;
  currentProjectedNeedKg: number;
  nextProjectedNeedKg: number;
  currentDietDaysRemaining: number | null;
  nextDietItemName: string | null;
  nextDietDate: string | null;
  siloAvailableForNextDiet: boolean | null;
  projectedShortfallKg: number;
  recommendedOrderKg: number;
  requisitionId: string | null;
  requisitionStatus: string | null;
  submissionDeadline: string | null;
  millLoadingBin: MillLoadingBin | null;
}

type Translate = (key: TranslationKeys) => string;

const number = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const date = (value: string | null | undefined) => value ? formatDateShort(value) : "—";

export function FeedSiloDashboardCards({
  silo,
  farmTotalOrderKg,
  t,
}: {
  silo: SelectedSiloDashboard;
  farmTotalOrderKg: number;
  t: Translate;
}) {
  const bin = silo.millLoadingBin;
  const binValue = bin
    ? `${bin.binCode} · ${date(bin.productionDate)} · ${bin.slotName || bin.slotCode}`
    : t("fsdNotScheduled");
  const yesNo = silo.siloAvailableForNextDiet === null
    ? "—"
    : silo.siloAvailableForNextDiet ? t("fsdYes") : t("fsdNo");
  const nextDiet = silo.nextDietItemName
    ? `${silo.nextDietItemName}${silo.nextDietDate ? ` · ${date(silo.nextDietDate)}` : ""}`
    : "—";
  const projectedNeed = silo.nextProjectedNeedKg > 0
    ? `${number(silo.projectedNeedKg)} (${number(silo.currentProjectedNeedKg)} + ${number(silo.nextProjectedNeedKg)})`
    : number(silo.projectedNeedKg);
  const requisition = silo.requisitionId && silo.requisitionStatus
    ? <a className="text-(--accent) hover:underline" href={`/requisitions?id=${encodeURIComponent(silo.requisitionId)}`}>{silo.requisitionStatus}</a>
    : silo.requisitionStatus ?? "—";

  const details: Array<{ label: TranslationKeys; value: ReactNode }> = [
    { label: "fsdCurrentDietFeedItem", value: silo.currentDietItemName ?? "—" },
    { label: "fsdMillLoadingBin", value: binValue },
    { label: "fsdSiloCapacityKg", value: number(silo.capacityKg) },
    { label: "fsdSystemBalanceKg", value: number(silo.systemBalanceKg) },
    { label: "fsdDailyRequirementKg", value: number(silo.dailyRequirementKg) },
    { label: "fsdDaysFeedRemaining", value: number(silo.daysRemaining) },
    { label: "fsdProjectedNeedRangeKg", value: projectedNeed },
    { label: "fsdCurrentDietDaysRemaining", value: number(silo.currentDietDaysRemaining) },
    { label: "fsdNextDietFeedItem", value: nextDiet },
    { label: "fsdSiloAvailableNextDiet", value: yesNo },
    { label: "fsdProjectedShortfallKg", value: number(silo.projectedShortfallKg) },
    { label: "fsdRecommendedOrderKg", value: number(silo.recommendedOrderKg) },
    { label: "fsdFarmTotalOrderKg", value: number(farmTotalOrderKg) },
    { label: "fsdRequisitionStatus", value: requisition },
    { label: "fsdSubmissionDeadline", value: date(silo.submissionDeadline) },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <StatRow columns={6}>
        <StatCard label={t("fsdCurrentDietFeedItem")} value={silo.currentDietItemName ?? "—"} />
        <StatCard label={t("fsdSiloCapacityKg")} value={number(silo.capacityKg)} unit="kg" />
        <StatCard label={t("fsdSystemBalanceKg")} value={number(silo.systemBalanceKg)} unit="kg" />
        <StatCard label={t("fsdDailyRequirementKg")} value={number(silo.dailyRequirementKg)} unit="kg" />
        <StatCard label={t("fsdDaysFeedRemaining")} value={number(silo.daysRemaining)} unit={t("fsdDaysUnit")} />
        <StatCard label={t("fsdRecommendedOrderKg")} value={number(silo.recommendedOrderKg)} unit="kg" />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="p-4 pb-2"><CardTitle>{t("fsdForecastDetails")}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 p-4 pt-0 text-sm">
            <Summary label={t("fsdProjectedNeedRangeKg")} value={projectedNeed} />
            <Summary label={t("fsdCurrentDietDaysRemaining")} value={number(silo.currentDietDaysRemaining)} />
            <Summary label={t("fsdNextDietFeedItem")} value={nextDiet} />
            <Summary label={t("fsdSiloAvailableNextDiet")} value={yesNo} />
            <Summary label={t("fsdProjectedShortfallKg")} value={number(silo.projectedShortfallKg)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2"><CardTitle>{t("fsdFulfilmentDetails")}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 p-4 pt-0 text-sm">
            <Summary label={t("fsdMillLoadingBin")} value={binValue} />
            <Summary label={t("fsdRequisitionStatus")} value={requisition} />
            <Summary label={t("fsdSubmissionDeadline")} value={date(silo.submissionDeadline)} />
          </CardContent>
        </Card>
        <StatCard label={t("fsdFarmTotalOrderKg")} value={number(farmTotalOrderKg)} unit="kg" sub={t("fsdFarmWideTotal")} />
      </div>

      <ScrollTable label={t("fsdLabel")}>
        <thead><tr><th scope="col" className="px-3 py-2 text-left">{t("fsdField")}</th><th scope="col" className="px-3 py-2 text-left">{t("fsdValue")}</th></tr></thead>
        <tbody>
          <tr>
            <td className="px-3 py-2 font-medium">{t("fsdSilo")}</td>
            <td className="px-3 py-2"><a className="text-(--accent) hover:underline" href={`/master-data/location?recordId=${encodeURIComponent(silo.siloId)}`}>{silo.siloCode}</a>{silo.siloName ? ` — ${silo.siloName}` : ""}</td>
          </tr>
          {details.map((detail) => <tr key={detail.label}><td className="px-3 py-2 font-medium">{t(detail.label)}</td><td className="px-3 py-2">{detail.value}</td></tr>)}
        </tbody>
      </ScrollTable>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-(--text-secondary)">{label}</span><span className="text-right font-medium text-(--text-primary)">{value}</span></div>;
}
