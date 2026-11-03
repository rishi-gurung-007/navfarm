'use client';

import { NA } from '@/utils/na';
import {
  HeartCrack,
  Scale,
  UtensilsCrossed,
  Droplets,
  PiggyBank,
} from 'lucide-react';

type Row = Record<string, any>;

const card =
  'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs';
const heading =
  'font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] mb-2 flex items-center gap-1.5 border-b border-[var(--border)] pb-2';
const th = 'px-3 py-2';
const headRow =
  'border-b border-[var(--border)] text-[10px] uppercase font-bold text-[var(--text-muted)] bg-[var(--surface-raised)]';

const dash = (v: unknown) =>
  v === null || v === undefined || v === '' ? NA : String(v);
const kg = (v: unknown) =>
  v === null || v === undefined ? NA : `${Number(v).toFixed(1)} kg`;
const day = (v: unknown) => (v ? String(v).slice(0, 10) : NA);
const num = (v: unknown, digits = 0) =>
  v === null || v === undefined
    ? NA
    : Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
const money = (v: unknown) =>
  v === null || v === undefined
    ? NA
    : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Weights and condition scores recorded for this animal in daily data. Nothing here is estimated: no reading, no figure. */
export function WeightReadings({ activity }: { activity: Row | null }) {
  const weights: Row[] = activity?.weights ?? [];
  const scores: Row[] = activity?.condition_scores ?? [];
  const dates = [
    ...new Set([...weights.map((w) => w.date), ...scores.map((s) => s.date)]),
  ]
    .sort()
    .reverse();
  return (
    <div className={card}>
      <h4 className={heading}>
        <Scale className="h-3.5 w-3.5 text-[var(--accent)]" /> Recorded Weights
        & Condition Scores
      </h4>
      {dates.length === 0 ? (
        <p className="py-4 text-center text-[var(--text-muted)]">
          No weight or condition score has been recorded for this animal in
          daily data yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className={headRow}>
                <th className={th}>Date</th>
                <th className={th}>Weight</th>
                <th className={th}>Condition Score (1–5)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {dates.map((d) => (
                <tr key={d}>
                  <td className="px-3 py-2.5 font-mono text-[var(--text-primary)]">
                    {d}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-bold text-[var(--accent)]">
                    {kg(weights.find((w) => w.date === d)?.value)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[var(--text-secondary)]">
                    {dash(scores.find((s) => s.date === d)?.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What this animal has eaten and been dosed with, from the batch's consumption postings. */
export function ConsumptionSummary({ activity }: { activity: Row | null }) {
  const byItem: Row[] = activity?.consumption?.by_item ?? [];
  if (byItem.length === 0) return null;
  return (
    <div className={card}>
      <h4 className={heading}>
        <UtensilsCrossed className="h-3.5 w-3.5 text-[var(--accent)]" /> Feed &
        Medicine Consumed
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className={headRow}>
              <th className={th}>Item</th>
              <th className={th}>Type</th>
              <th className={`${th} text-right`}>Quantity</th>
              <th className={`${th} text-right`}>Cost</th>
              <th className={th}>Last</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {byItem.map((r) => (
              <tr key={`${r.item_id}|${r.uom}`}>
                <td className="px-3 py-2.5 font-semibold text-[var(--text-primary)]">
                  {r.item_name || r.item_code || NA}
                </td>
                <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                  {dash(r.item_type)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {num(r.quantity, 2)} {dash(r.uom)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {money(r.cost)}
                </td>
                <td className="px-3 py-2.5 font-mono text-[var(--text-muted)]">
                  {day(r.last_date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** How the animal died, as it was recorded: the reason code, the cause, the findings and the disposal. */
export function DeathRecord({ activity }: { activity: Row | null }) {
  const m: Row | null = activity?.mortality ?? null;
  if (!m) return null;
  const rows: [string, string][] = [
    ['Date', day(m.date)],
    [
      'Reason',
      m.reason_name
        ? `${m.reason_name}${m.reason_code ? ` (${m.reason_code})` : ''}`
        : NA,
    ],
    ['Cause of death', dash(m.cause_of_death)],
    ['Post-mortem findings', dash(m.post_mortem_notes)],
    ['Disposal method', dash(m.disposal_method)],
    ['Pen', dash(m.pen)],
    ['Remarks', dash(m.remarks)],
  ];
  return (
    <div className="rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/5 p-4">
      <h4 className="font-bold text-red-600 dark:text-red-400 uppercase tracking-wider text-[11px] mb-2 flex items-center gap-1.5 border-b border-red-500/20 pb-2">
        <HeartCrack className="h-3.5 w-3.5" /> Death Record
      </h4>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {rows
          .filter(([, v]) => v !== NA)
          .map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
                {label}
              </dt>
              <dd className="font-medium text-xs text-[var(--text-primary)] mt-0.5">
                {value}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

/** A boar's output: the semen lots collected from him and how many doses are used and sold. */
export function SemenLots({ activity }: { activity: Row | null }) {
  const lots: Row[] = activity?.semen_lots ?? [];
  return (
    <div className={card}>
      <h4 className={heading}>
        <Droplets className="h-3.5 w-3.5 text-[var(--accent)]" /> Semen
        Collected
      </h4>
      {lots.length === 0 ? (
        <p className="py-4 text-center text-[var(--text-muted)]">
          No semen collection recorded for this boar.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className={headRow}>
                <th className={th}>Collected</th>
                <th className={th}>Lot</th>
                <th className={`${th} text-right`}>Doses</th>
                <th className={`${th} text-right`}>Used</th>
                <th className={`${th} text-right`}>Sold</th>
                <th className={`${th} text-right`}>Cost / Dose</th>
                <th className={th}>Quality</th>
                <th className={th}>In Inventory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {lots.map((l) => (
                <tr key={l.semen_batch_id}>
                  <td className="px-3 py-2.5 font-mono text-[var(--text-primary)]">
                    {day(l.collection_date)}
                  </td>
                  <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                    {l.lot_no
                      ? `${l.lot_no}${l.expiry_date ? ` · exp ${day(l.expiry_date)}` : ''}`
                      : NA}
                    {l.pooled && (
                      <span className="block text-[10px] text-[var(--text-muted)]">
                        Pooled: {(l.pool_boars || []).join(' + ')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold">
                    {num(l.doses_collected)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {num(l.doses_used_internal)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {num(l.doses_sold)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {money(l.unit_cost_per_dose)}
                  </td>
                  <td className="px-3 py-2.5 font-mono whitespace-nowrap text-[var(--text-secondary)]">
                    {[
                      l.volume_ml != null ? `${num(l.volume_ml)} ml` : null,
                      l.motility_pct != null
                        ? `${num(l.motility_pct)}% motile`
                        : null,
                      l.concentration_m_per_ml != null
                        ? `${num(l.concentration_m_per_ml)} M/ml`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || NA}
                  </td>
                  <td className="px-3 py-2.5">
                    {l.inventory_posted ? (
                      'Posted'
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        Not posted
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A sow's cost, parity by parity. Each parity's window runs from its mating to its weaning (to today while the litter is not weaned); cost on the days
 * outside every window has its own row, so the rows always add up to the total. The window is ours, awaiting Rishi / Finance.
 */
export function ParityExpense({
  data,
  loading,
}: {
  data: Row | null;
  loading: boolean;
}) {
  const rows: Row[] = data?.rows ?? [];
  const total: Row | null = data?.total ?? null;
  const hasParity = rows.some((r) => r.row_type === 'PARITY');
  const cell = 'px-3 py-2.5 text-right font-mono whitespace-nowrap';
  return (
    <div className={card}>
      <h4 className={heading}>
        <PiggyBank className="h-3.5 w-3.5 text-[var(--accent)]" /> Cost by
        Parity
      </h4>
      {loading ? (
        <p className="py-4 text-center text-[var(--text-muted)]">Loading…</p>
      ) : !total || total.total === 0 ? (
        <p className="py-4 text-center text-[var(--text-muted)]">
          No feed, medicine, overhead or amortisation has been charged to this
          animal yet.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            A parity runs from its mating date to its weaning date (to today
            while the litter is not weaned).{' '}
            {data?.costing_start_date
              ? `Feed and overhead before ${day(data.costing_start_date)} (her costing start date) went into her book value; from it, and every amortisation charge, they are expensed.`
              : 'She has no costing start date, so her feed and overhead went into her book value.'}
            {!hasParity &&
              ' She has no confirmed service yet, so all of it falls outside a parity.'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className={headRow}>
                  <th className={th}>Parity</th>
                  <th className={th}>Window</th>
                  <th className={`${th} text-right`}>Days</th>
                  <th className={`${th} text-right`}>Feed</th>
                  <th className={`${th} text-right`}>Medicine, Semen & Other</th>
                  <th className={`${th} text-right`}>Overhead</th>
                  <th className={`${th} text-right`}>Amortisation</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>In Book Value</th>
                  <th className={`${th} text-right`}>Expensed</th>
                  <th className={`${th} text-right`}>Per Day</th>
                  <th className={`${th} text-right`}>Weaned</th>
                  <th className={`${th} text-right`}>Per Piglet Weaned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r, i) => (
                  <tr key={r.row_type === 'PARITY' ? `p${r.parity_number}-${i}` : 'outside'}>
                    <td className="px-3 py-2.5 font-bold text-[var(--text-primary)] whitespace-nowrap">
                      {r.row_type === 'PARITY' ? (
                        <>
                          Parity {r.parity_number}
                          {r.status === 'IN_PROGRESS' && (
                            <span className="ml-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                              In progress
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          Outside a parity
                          <span className="block text-[10px] font-normal text-[var(--text-muted)]">
                            Before her first service, and the days between a
                            weaning and the next service
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                      {r.window_start
                        ? `${day(r.window_start)} → ${day(r.window_end)}`
                        : NA}
                    </td>
                    <td className={cell}>{num(r.days)}</td>
                    <td className={cell}>{money(r.feed)}</td>
                    <td className={cell}>{money(r.other_consumption)}</td>
                    <td className={cell}>{money(r.overhead)}</td>
                    <td className={cell}>{money(r.amortisation)}</td>
                    <td className={`${cell} font-bold text-[var(--text-primary)]`}>
                      {money(r.total)}
                    </td>
                    <td className={cell}>{money(r.capitalised)}</td>
                    <td className={cell}>{money(r.expensed)}</td>
                    <td className={cell}>{money(r.per_day)}</td>
                    <td className={cell}>{num(r.piglets_weaned)}</td>
                    <td className={cell}>{money(r.cost_per_piglet_weaned)}</td>
                  </tr>
                ))}
              </tbody>
              {total && (
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] font-bold">
                    <td className="px-3 py-2.5" colSpan={3}>
                      Whole cost to {day(data?.as_of)}
                    </td>
                    <td className={cell}>{money(total.feed)}</td>
                    <td className={cell}>{money(total.other_consumption)}</td>
                    <td className={cell}>{money(total.overhead)}</td>
                    <td className={cell}>{money(total.amortisation)}</td>
                    <td className={`${cell} text-[var(--text-primary)]`}>
                      {money(total.total)}
                    </td>
                    <td className={cell}>{money(total.capitalised)}</td>
                    <td className={cell}>{money(total.expensed)}</td>
                    <td className={cell} colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}
