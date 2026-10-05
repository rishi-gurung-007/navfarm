"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort } from "./feed-format";

export interface BalanceSeriesPoint {
  date: string;
  itemId: string;
  itemName: string;
  openingKg: number;
  confirmedReceiptKg: number;
  demandKg: number;
  closingKg: number;
}

export interface DemandSeriesPoint {
  date: string;
  currentDietKg: number;
  nextDietKg: number;
}

export type PreparedBalancePoint = BalanceSeriesPoint & { runDown: boolean };

export function prepareBalanceSeries(points: BalanceSeriesPoint[]): PreparedBalancePoint[] {
  let marked = false;
  return [...points]
    .sort((a, b) => a.date.localeCompare(b.date) || a.itemName.localeCompare(b.itemName) || a.itemId.localeCompare(b.itemId))
    .map((point) => {
      const runDown = !marked && point.closingKg <= 0;
      if (runDown) marked = true;
      return { ...point, runDown };
    });
}

const tooltipStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface-raised)",
  color: "var(--text-primary)",
  fontSize: 12,
};
const tick = { fontSize: 10, fill: "var(--text-secondary)" };

export function FeedSiloDashboardCharts({
  balanceSeries,
  demandSeries,
  belowFeedLevelKg,
  aboveThresholdKg,
  capacityKg,
}: {
  balanceSeries: BalanceSeriesPoint[];
  demandSeries: DemandSeriesPoint[];
  belowFeedLevelKg: number | null;
  aboveThresholdKg: number | null;
  capacityKg: number | null;
}) {
  const { t } = useLanguage();
  const balances = prepareBalanceSeries(balanceSeries);
  const demand = [...demandSeries].sort((a, b) => a.date.localeCompare(b.date));
  const runDown = balances.find((point) => point.runDown) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle>{t("fsdProjectedBalanceChart")}</CardTitle>
          <div className="flex flex-wrap gap-3 text-[11px] text-(--text-secondary)">
            {belowFeedLevelKg !== null && <LegendMark color="var(--warning)" label={t("fsdBelowFeedLevel")} />}
            {aboveThresholdKg !== null && <LegendMark color="var(--accent)" label={t("fsdAboveThreshold")} />}
            {capacityKg !== null && <LegendMark color="var(--text-muted)" label={t("fsdCapacity")} />}
            {runDown && <LegendMark color="var(--danger)" label={t("fsdRunDown")} />}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {balances.length ? (
            <div role="img" aria-label={t("fsdProjectedBalanceChart")} className="h-64 w-full" data-chart="projected-balance">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={balances} margin={{ top: 12, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={formatDateShort} tick={tick} />
                  <YAxis tick={tick} width={58} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => formatDateShort(String(value))} />
                  {belowFeedLevelKg !== null && <ReferenceLine y={belowFeedLevelKg} stroke="var(--warning)" strokeDasharray="4 4" />}
                  {aboveThresholdKg !== null && <ReferenceLine y={aboveThresholdKg} stroke="var(--accent)" strokeDasharray="4 4" />}
                  {capacityKg !== null && <ReferenceLine y={capacityKg} stroke="var(--text-muted)" strokeDasharray="2 4" />}
                  {runDown && <ReferenceDot x={runDown.date} y={0} r={5} fill="var(--danger)" stroke="var(--surface)" />}
                  <Line type="monotone" dataKey="closingKg" name={t("fsdProjectedClosingKg")} stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty label={t("fsdChartUnavailable")} />}
          <table className="sr-only" aria-label={t("fsdProjectedBalanceData")}>
            <thead><tr><th>{t("ffDate")}</th><th>{t("fsdProjectedClosingKg")}</th></tr></thead>
            <tbody>{balances.map((point) => <tr key={`${point.itemId}-${point.date}`}><td>{point.date}</td><td>{point.closingKg}</td></tr>)}</tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle>{t("fsdDietDemandChart")}</CardTitle>
          <div className="flex flex-wrap gap-3 text-[11px] text-(--text-secondary)">
            <LegendMark color="var(--accent)" label={t("fsdCurrentDietDemand")} />
            <LegendMark color="var(--warning)" label={t("fsdNextDietDemand")} />
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {demand.length ? (
            <div role="img" aria-label={t("fsdDietDemandChart")} className="h-64 w-full" data-chart="diet-demand">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={demand} margin={{ top: 12, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={formatDateShort} tick={tick} />
                  <YAxis tick={tick} width={58} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => formatDateShort(String(value))} />
                  <Bar dataKey="currentDietKg" stackId="diet" name={t("fsdCurrentDietDemand")} fill="var(--accent)" />
                  <Bar dataKey="nextDietKg" stackId="diet" name={t("fsdNextDietDemand")} fill="var(--warning)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <ChartEmpty label={t("fsdChartUnavailable")} />}
          <table className="sr-only" aria-label={t("fsdDietDemandData")}>
            <thead><tr><th>{t("ffDate")}</th><th>{t("fsdCurrentDietDemand")}</th><th>{t("fsdNextDietDemand")}</th></tr></thead>
            <tbody>{demand.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.currentDietKg}</td><td>{point.nextDietKg}</td></tr>)}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function LegendMark({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>;
}

function ChartEmpty({ label }: { label: string }) {
  return <div className="flex h-64 items-center justify-center text-sm text-(--text-muted)">{label}</div>;
}
