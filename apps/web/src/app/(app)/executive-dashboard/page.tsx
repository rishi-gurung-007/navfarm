'use client';

import type { ReactNode } from 'react';
import { Building2, MapPin } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { ConsolePage } from '@/components/ui/console-page';
import { StatRow, StatCard } from '@/components/ui/stat-row';
import { Badge } from '@/components/ui/badge';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

/**
 * Static preview — every number here is sample data, not a live read.
 *
 * KPI labels in the "Herd & Breeding Performance" and "Grower Performance"
 * rows are taken from the project's own KPI Parameter Master (BBP-1 §1.4,
 * and the Standard Sow Management Report / Grower Report it defines), not
 * invented — so this reads the way the client's own spec already describes
 * a pig farm's performance.
 */

const tooltipStyle = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '12px',
  color: 'var(--text-primary)',
};
// Recharts colors the label/item lines itself by default (often plain black),
// ignoring contentStyle's color — set both explicitly so tooltip text stays
// readable in dark mode too.
const tooltipLabelStyle = {
  color: 'var(--text-primary)',
  fontWeight: 600,
  marginBottom: 2,
};
const tooltipItemStyle = { color: 'var(--text-secondary)' };

// ---------------------------------------------------------------- layout --

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function GroupHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-bold text-[var(--text-primary)]">
        {title}
      </h2>
      {description && (
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
          {description}
        </p>
      )}
    </div>
  );
}

function InfoGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {it.label}
          </dt>
          <dd className="mt-0.5 text-sm text-[var(--text-primary)]">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SimpleTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, ReactNode>[];
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <TableHeader>
          <tr>
            {columns.map((c) => (
              <TableHead
                key={c.key}
                className={c.align === 'right' ? 'text-right' : undefined}
              >
                {c.label}
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  className={
                    c.align === 'right' ? 'text-right tabular-nums' : undefined
                  }
                >
                  {row[c.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ data --

const COMPANY_INFO = [
  { label: 'Legal entity', value: 'Apex Swine Genetics & Breeding' },
  { label: 'Company code', value: 'APEXBREED' },
  { label: 'Tenant', value: 'NAVFarm Demo Tenant' },
  {
    label: 'Nature of business → line of business',
    value: 'Livestock → Piggery (LVS_PIGGERY)',
  },
  { label: 'Base currency', value: 'USD ($)' },
  { label: 'Fiscal year', value: 'April – March' },
  { label: 'Registered since', value: '2019' },
  { label: 'Head office', value: 'Nashik, Maharashtra, India' },
  { label: 'Company admin', value: 'Arjun Sharma' },
  { label: 'Operational areas under this company', value: '3' },
];

const AREA_INFO = [
  {
    label: 'Operational area',
    value: 'Apex Nucleus Breeding & Gestation Unit',
  },
  { label: 'Area code', value: 'APEX-NUC-01' },
  { label: 'Line of business', value: 'Piggery (LVS_PIGGERY)' },
  { label: 'Location', value: 'Nashik, Maharashtra' },
  { label: 'Land under operation', value: '18 acres' },
  {
    label: 'Sheds',
    value: '7 — quarantine, gestation, farrowing ×2, weaner ×2, boar AI',
  },
  { label: 'Total pen capacity', value: '2,100 head' },
  { label: 'Established', value: '2020' },
  { label: 'Area supervisor', value: 'Operational admin (field supervisor)' },
  {
    label: 'Registration',
    value: 'State Animal Husbandry Reg. — sample no. MH-NSK-PIG-0417',
  },
];

const ALERTS: {
  label: string;
  variant: 'danger' | 'warning' | 'accent' | 'success';
}[] = [
  {
    label: '2 batches failed close reconciliation — off by more than $0.01',
    variant: 'danger',
  },
  { label: '8 approvals waiting more than 48 hours', variant: 'warning' },
  { label: '5 animals under withdrawal restriction', variant: 'warning' },
  { label: '3 batches ready to move to their next stage', variant: 'accent' },
  { label: 'Books are balanced — debit = credit, $734.4K', variant: 'success' },
];

const TREND_DATA = [
  { month: 'Oct', revenue: 74.4, netIncome: 14.4 },
  { month: 'Nov', revenue: 78.0, netIncome: 15.6 },
  { month: 'Dec', revenue: 81.6, netIncome: 16.8 },
  { month: 'Jan', revenue: 79.2, netIncome: 15.6 },
  { month: 'Feb', revenue: 85.2, netIncome: 18.0 },
  { month: 'Mar', revenue: 88.8, netIncome: 19.2 },
  { month: 'Apr', revenue: 87.6, netIncome: 18.6 },
  { month: 'May', revenue: 92.4, netIncome: 20.4 },
  { month: 'Jun', revenue: 96.0, netIncome: 21.6 },
  { month: 'Jul', revenue: 98.4, netIncome: 22.2 },
  { month: 'Aug', revenue: 102.0, netIncome: 22.8 },
  { month: 'Sep', revenue: 101.5, netIncome: 23.0 },
];

const STAGE_DATA = [
  { stage: 'Quarantine', head: 64 },
  { stage: 'Gilt Grower', head: 152 },
  { stage: 'Flush / Service', head: 118 },
  { stage: 'Gestation', head: 410 },
  { stage: 'Farrowing', head: 96 },
  { stage: 'Lactation', head: 210 },
  { stage: 'Weaning', head: 340 },
  { stage: 'Boar AI', head: 22 },
  { stage: 'CB Grower', head: 380 },
  { stage: 'Slaughter', head: 40 },
  { stage: 'Disposed', head: 10 },
];
// Light -> dark blue ramp, ending on the app's own navy.
const STAGE_COLORS = [
  '#cdd6e4',
  '#b7c3d8',
  '#a1b0cb',
  '#8b9dbf',
  '#7996c2',
  '#4e6e9e',
  '#435f88',
  '#385072',
  '#2d415c',
  '#223245',
  '#2e313f',
];

const AREA_COMPARISON = [
  {
    area: 'Apex Nucleus Breeding & Gestation',
    herd: '1,842',
    batches: '27',
    revenue: '$101.5K',
    margin: '22.7%',
  },
  {
    area: 'Apex Grower-Finisher Unit',
    herd: '1,120',
    batches: '14',
    revenue: '$62.8K',
    margin: '18.4%',
  },
  {
    area: 'Apex Coastal Piggery',
    herd: '640',
    batches: '9',
    revenue: '$34.7K',
    margin: '15.1%',
  },
];

const EXPENSE_MIX = [
  { name: 'Feed', amount: 45.7 },
  { name: 'Labour', amount: 14.9 },
  { name: 'Overhead', amount: 9.7 },
  { name: 'Medicine', amount: 8.2 },
];

const WATERFALL_DATA = [
  {
    name: 'Opening',
    base: 0,
    value: 446.4,
    kind: 'total' as const,
    display: '$446.4K',
  },
  {
    name: 'Births / Acq.',
    base: 446.4,
    value: 49.4,
    kind: 'up' as const,
    display: '+$49.4K',
  },
  {
    name: 'Fair value adj.',
    base: 495.8,
    value: 10.3,
    kind: 'up' as const,
    display: '+$10.3K',
  },
  {
    name: 'Amortisation',
    base: 485.9,
    value: 20.2,
    kind: 'down' as const,
    display: '−$20.2K',
  },
  {
    name: 'Harvest / Disp.',
    base: 472.8,
    value: 13.1,
    kind: 'down' as const,
    display: '−$13.1K',
  },
  {
    name: 'Closing',
    base: 0,
    value: 472.8,
    kind: 'total' as const,
    display: '$472.8K',
  },
];
const WATERFALL_FILL: Record<string, string> = {
  total: 'var(--text-secondary)',
  up: 'var(--success)',
  down: 'var(--danger)',
};

const BATCH_VARIANCE = [
  {
    batch: 'PIG-BAT-2026-0142',
    price: '−$500',
    usage: '+$220',
    output: '+$60',
    overhead: '−$20',
    ok: true,
  },
  {
    batch: 'PIG-BAT-2026-0139',
    price: '+$250',
    usage: '−$110',
    output: '$0',
    overhead: '+$40',
    ok: true,
  },
  {
    batch: 'PIG-BAT-2026-0135',
    price: '−$820',
    usage: '+$730',
    output: '+$50',
    overhead: '+$10',
    ok: false,
    off: '$20',
  },
  {
    batch: 'PIG-BAT-2026-0131',
    price: '+$110',
    usage: '−$60',
    output: '−$40',
    overhead: '$0',
    ok: false,
    off: '$10',
  },
  {
    batch: 'PIG-BAT-2026-0128',
    price: '+$130',
    usage: '+$20',
    output: '−$10',
    overhead: '$0',
    ok: true,
  },
];

const INVENTORY_VALUATION = [
  { name: 'Finished Goods — Grower', amount: 27.4 },
  { name: 'Feed Store — Main', amount: 22.3 },
  { name: 'Medicine Store', amount: 5.0 },
  { name: 'Spares & Consumables', amount: 2.5 },
];

const CHART_SET = [
  'var(--info)',
  'var(--success)',
  'var(--warning)',
  'var(--text-disabled)',
];

const SHED_OCCUPANCY = [
  { name: 'Farrowing Shed A', pct: 92 },
  { name: 'Weaner Shed 1', pct: 85 },
  { name: 'Gestation Barn', pct: 78 },
  { name: 'Nursery Shed 2', pct: 64 },
  { name: 'Boar AI Centre', pct: 40 },
];

const MORTALITY_CAUSES = [
  { name: 'Enteric infection', pct: 38 },
  { name: 'Crushing (farrowing)', pct: 24 },
  { name: 'Respiratory', pct: 16 },
  { name: 'Congenital', pct: 12 },
  { name: 'Other', pct: 10 },
];

const APPROVALS_QUEUE = [
  {
    type: 'Batch close',
    item: 'PIG-BAT-2026-0135',
    by: 'S. Naik, Supervisor',
    age: '5d',
    overdue: true,
  },
  {
    type: 'Stage advance',
    item: 'PIG-BAT-2026-0151',
    by: 'S. Naik, Supervisor',
    age: '3d',
    overdue: true,
  },
  {
    type: 'Stock adjustment',
    item: 'Feed Store — Main',
    by: 'R. Verma',
    age: '2d',
    overdue: false,
  },
  {
    type: 'Goods issue',
    item: 'Medicine Store',
    by: 'A. Iyer',
    age: '1d',
    overdue: false,
  },
];

// -------------------------------------------------------------- page --

export default function ExecutiveDashboardPage() {
  return (
    <ConsolePage>
      {/* ---------------- Headline tiles ---------------- */}
      <StatRow columns={6}>
        <StatCard
          label="Biological Population"
          value="1,842"
          unit="Head Count"
          sub="Live herd, all stages"
        />
        <StatCard
          label="Active Batches"
          value="27"
          unit="Batches"
          sub="18 grow-finish · 9 breeding"
        />
        <StatCard
          label="Active Batch WIP"
          value="$51.3K"
          unit="WIP"
          sub="Work in progress across 27 batches"
        />
        <StatCard
          label="Revenue"
          value="$101.5K"
          unit="MTD"
          tone="success"
          sub="▲ 6.4% vs prior month"
        />
        <StatCard
          label="Net Income"
          value="$23.0K"
          unit="MTD"
          tone="success"
          sub="22.7% net margin"
        />
        <StatCard
          label="Bio-Asset Value"
          value="$472.8K"
          sub="IAS 41 breeding herd, closing"
        />
      </StatRow>

      <div className="flex flex-wrap gap-2">
        {ALERTS.map((a) => (
          <Badge key={a.label} variant={a.variant} dot>
            {a.label}
          </Badge>
        ))}
      </div>

      {/* ---------------- Company & operational area ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[var(--text-muted)]" /> Company
            </span>
          }
          subtitle="The legal entity this data belongs to"
        >
          <InfoGrid items={COMPANY_INFO} />
        </Panel>
        <Panel
          title={
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--text-muted)]" />{' '}
              Operational area
            </span>
          }
          subtitle="The physical farm this dashboard is reporting on"
        >
          <InfoGrid items={AREA_INFO} />
        </Panel>
      </div>

      {/* ---------------- Herd & breeding performance (BBP KPI Parameter Master) ---------------- */}
      <div>
        <GroupHeading
          title="Herd & Breeding Performance"
          description="Sow management KPIs, as defined in the project's own KPI Parameter Master."
        />
        <StatRow columns={6}>
          <StatCard
            label="Farrowing Rate"
            value="87.4%"
            tone="success"
            sub="Target ≥ 85%"
          />
          <StatCard
            label="Pre-Weaning Mortality"
            value="9.8%"
            tone="success"
            sub="Target ≤ 12%"
          />
          <StatCard
            label="Born Alive / Litter"
            value="13.2"
            sub="Target ≥ 12.5"
          />
          <StatCard
            label="Cycle Index"
            value="2.42"
            sub="Litters per sow per year"
          />
          <StatCard
            label="Days Wean to 1st Service"
            value="5.4"
            sub="Target ≤ 7 days"
          />
          <StatCard
            label="Weaner FCR"
            value="1.42"
            tone="success"
            sub="Feed used per kg gained"
          />
        </StatRow>
      </div>

      {/* ---------------- Grower performance (BBP Grower Report) ---------------- */}
      <div>
        <GroupHeading
          title="Grower Performance"
          description="From the project's Grower Report definition."
        />
        <StatRow columns={5}>
          <StatCard
            label="Grower FCR"
            value="2.68"
            tone="success"
            sub="Target ≤ 2.75"
          />
          <StatCard
            label="Grower ADG"
            value="850 g/day"
            tone="success"
            sub="Target ≥ 800 g/day"
          />
          <StatCard
            label="Slaughter %"
            value="96.4%"
            tone="success"
            sub="Reached target slaughter weight"
          />
          <StatCard
            label="Cost / KG Gain"
            value="$1.48/kg"
            sub="Feed + direct cost per kg"
          />
          <StatCard
            label="Margin over Feed"
            value="$0.62/kg"
            tone="success"
            sub="Sale price less feed cost"
          />
        </StatRow>
      </div>

      {/* ---------------- Production charts ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Herd by Lifecycle Stage"
          subtitle="1,842 head across 11 stages, lightest = earliest"
        >
          <ResponsiveContainer width="100%" height={340}>
            <BarChart
              data={STAGE_DATA}
              layout="vertical"
              margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <YAxis
                type="category"
                dataKey="stage"
                width={110}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
              />
              <Bar dataKey="head" name="Head" radius={[0, 4, 4, 0]}>
                {STAGE_DATA.map((d, i) => (
                  <Cell key={d.stage} fill={STAGE_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel
          title="Revenue & Net Income"
          subtitle="Last 12 months, in $ thousands"
        >
          <ResponsiveContainer width="100%" height={340}>
            <LineChart
              data={TREND_DATA}
              margin={{ top: 8, right: 16, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                tickFormatter={(v) => `$${v}K`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                formatter={((v: number) => [`$${v}K`]) as any}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="netIncome"
                name="Net income"
                stroke="var(--success)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel title="Operational Areas" subtitle="Every farm under this company">
        <SimpleTable
          columns={[
            { key: 'area', label: 'Area' },
            { key: 'herd', label: 'Herd', align: 'right' },
            { key: 'batches', label: 'Batches', align: 'right' },
            { key: 'revenue', label: 'Revenue', align: 'right' },
            { key: 'margin', label: 'Margin', align: 'right' },
          ]}
          rows={AREA_COMPARISON.map((row) => ({
            area: (
              <span className="font-medium text-[var(--text-primary)]">
                {row.area}
              </span>
            ),
            herd: row.herd,
            batches: row.batches,
            revenue: row.revenue,
            margin: row.margin,
          }))}
        />
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Total across the company: 3,602 head · 50 batches · $199.0K revenue ·
          20.6% margin.
        </p>
      </Panel>

      {/* ---------------- Finance & costing ---------------- */}
      <div>
        <GroupHeading
          title="Finance & Costing"
          description="Where the money went, what the herd is worth, and whether every batch closed clean."
        />

        <Panel title="Expense Mix" subtitle="$ thousands, this month">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={EXPENSE_MIX}
              layout="vertical"
              margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                tickFormatter={(v) => `$${v}K`}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                formatter={((v: number) => [`$${v}K`]) as any}
              />
              <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                {EXPENSE_MIX.map((d, i) => (
                  <Cell key={d.name} fill={CHART_SET[i % CHART_SET.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <div className="mt-4">
          <Panel
            title="Biological-Asset Roll-Forward"
            subtitle="IAS 41, $ thousands, this month — opening value to closing value"
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={WATERFALL_DATA}
                margin={{ top: 24, right: 16, left: -8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  domain={[440, 510]}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                  tickFormatter={(v) => `$${v}K`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={
                    ((
                      _v: number,
                      _n: string,
                      ctx: { payload?: { display?: string } },
                    ) => [ctx?.payload?.display ?? '', 'Change']) as any
                  }
                />
                <Bar dataKey="base" stackId="wf" fill="transparent" />
                <Bar dataKey="value" stackId="wf" radius={[3, 3, 3, 3]}>
                  {WATERFALL_DATA.map((d) => (
                    <Cell key={d.name} fill={WATERFALL_FILL[d.kind]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
              <span className="flex items-center gap-1.5">
                <i
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: 'var(--text-secondary)' }}
                />{' '}
                Opening / closing total
              </span>
              <span className="flex items-center gap-1.5">
                <i
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: 'var(--success)' }}
                />{' '}
                Value added
              </span>
              <span className="flex items-center gap-1.5">
                <i
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: 'var(--danger)' }}
                />{' '}
                Value reduced
              </span>
            </div>
          </Panel>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title="Batch Cost Check"
            subtitle="Did each closed batch's actual cost match what it should have cost?"
          >
            <SimpleTable
              columns={[
                { key: 'batch', label: 'Batch' },
                { key: 'price', label: 'Price', align: 'right' },
                { key: 'usage', label: 'Usage', align: 'right' },
                { key: 'output', label: 'Output', align: 'right' },
                { key: 'overhead', label: 'Overhead', align: 'right' },
                { key: 'status', label: 'Status' },
              ]}
              rows={BATCH_VARIANCE.map((row) => ({
                batch: (
                  <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                    {row.batch}
                  </span>
                ),
                price: row.price,
                usage: row.usage,
                output: row.output,
                overhead: row.overhead,
                status: row.ok ? (
                  <Badge variant="success" dot>
                    Reconciled
                  </Badge>
                ) : (
                  <Badge variant="danger" dot>
                    Off by {row.off}
                  </Badge>
                ),
              }))}
            />
          </Panel>

          <Panel
            title="Inventory Valuation"
            subtitle="$ thousands, FIFO cost, by warehouse"
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={INVENTORY_VALUATION}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                  tickFormatter={(v) => `$${v}K`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={((v: number) => [`$${v}K`]) as any}
                />
                <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                  {INVENTORY_VALUATION.map((d, i) => (
                    <Cell key={d.name} fill={CHART_SET[i % CHART_SET.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      </div>

      {/* ---------------- Livestock & health ---------------- */}
      <div>
        <GroupHeading
          title="Livestock & Health"
          description="Shed space, cause of loss, and jobs completed on schedule."
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title="Shed & Pen Space"
            subtitle="How full each shed is against its capacity"
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={SHED_OCCUPANCY}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={((v: number) => [`${v}%`, 'Occupied']) as any}
                />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                  {SHED_OCCUPANCY.map((d) => (
                    <Cell
                      key={d.name}
                      fill={d.pct >= 90 ? 'var(--warning)' : 'var(--info)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              Amber = shed is at or above 90% of its pen capacity.
            </p>
          </Panel>

          <Panel
            title="Cause of Loss, Last 30 Days"
            subtitle="What's driving mortality right now"
          >
            <ResponsiveContainer width="100%" height={180}>
              <BarChart
                data={MORTALITY_CAUSES}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  formatter={
                    ((v: number) => [`${v}%`, 'Share of losses']) as any
                  }
                />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                  {MORTALITY_CAUSES.map((d, i) => (
                    <Cell key={d.name} fill={CHART_SET[i % CHART_SET.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 flex flex-wrap gap-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
              <span>
                <b className="text-[var(--text-primary)]">14</b> animals under
                active treatment
              </span>
              <span>
                <b className="text-[var(--text-primary)]">5</b> animals under
                withdrawal hold
              </span>
            </div>
          </Panel>
        </div>

        <div className="mt-4">
          <StatRow columns={3}>
            <StatCard
              label="Scheduler On-Time Rate"
              value="91%"
              tone="success"
              sub="Feeding, health & other scheduled jobs"
            />
            <StatCard
              label="Active Treatment Cases"
              value="14"
              sub="Animals currently under care"
            />
            <StatCard
              label="Withdrawal Holds"
              value="5"
              tone="warning"
              sub="Blocking slaughter clearance"
            />
          </StatRow>
        </div>
      </div>

      {/* ---------------- Approvals ---------------- */}
      <Panel title="Approvals" subtitle="Showing 4 of 8 pending sign-offs">
        <SimpleTable
          columns={[
            { key: 'type', label: 'Type' },
            { key: 'item', label: 'Batch / item' },
            { key: 'by', label: 'Requested by' },
            { key: 'age', label: 'Waiting', align: 'right' },
          ]}
          rows={APPROVALS_QUEUE.map((row) => ({
            type: row.type,
            item: (
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                {row.item}
              </span>
            ),
            by: row.by,
            age: (
              <Badge variant={row.overdue ? 'warning' : 'neutral'}>
                {row.age}
              </Badge>
            ),
          }))}
        />
      </Panel>

      <p className="pb-2 text-center text-xs text-[var(--text-muted)]">
        NAVFarm · Livestock ERP — Piggery operations, APEXBREED · Static preview
        data for dashboard concept review
      </p>
    </ConsolePage>
  );
}
