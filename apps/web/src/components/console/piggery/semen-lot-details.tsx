'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/services/api-client';
import { useCompanyCurrency } from '@/hooks/useCompanyCurrency';
import type { Row } from './breeding-rules';
import { formatDate } from '@/utils/date-short';

const raised: CSSProperties = { backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' };
const muted: CSSProperties = { color: 'var(--text-muted)' };
const sub: CSSProperties = { color: 'var(--text-secondary)' };
const primary: CSSProperties = { color: 'var(--text-primary)' };

const unwrap = <T,>(res: any): T => (Array.isArray(res) ? res : (res?.data ?? res)) as T;
const day = (v: unknown) => (v ? formatDate(v as string) : null);
const num = (v: unknown, digits = 2) => (v == null || v === '' ? null : Number(v).toFixed(digits));
const named = (x?: { code?: string | null; name?: string | null } | null) =>
  x ? [x.code, x.name].filter(Boolean).join(' · ') : null;

/** A titled block of the details page. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-md)] border p-4 space-y-3" style={raised}>
      <h4 className="text-xs font-bold uppercase tracking-wide" style={sub}>
        {title}
      </h4>
      {children}
    </section>
  );
}

/** Label and value pairs; a value that is missing reads as a dash. */
function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-b border-dashed pb-1" style={{ borderColor: 'var(--border)' }}>
          <dt className="text-xs" style={muted}>
            {label}
          </dt>
          <dd className="text-right font-medium" style={primary}>
            {value == null || value === '' ? '—' : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The details of one collected semen lot (opened from the Boar Semen AI Station list): the lot and its inventory, the line's
 * label / colorant / destination, the boars and what each gave, the cost per dose and what it was made from, the QR, and the
 * AI services that drew doses from it.
 */
export function SemenLotDetails({
  lotId,
  onClose,
  onOpenAnimal,
}: {
  lotId: string | null;
  onClose: () => void;
  onOpenAnimal: (animalId: string) => void;
}) {
  const { formatMoney } = useCompanyCurrency();
  const [lot, setLot] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLot(null);
    setError(null);
    if (!lotId) return;
    let current = true;
    api
      .get(`/piggery/breeding/semen-collection/${lotId}`)
      .then((res) => current && setLot(unwrap<Row>(res)))
      .catch((e) => current && setError(e?.message || 'Could not load the lot.'));
    return () => {
      current = false;
    };
  }, [lotId]);

  const money = (v: unknown) => formatMoney(Number(v || 0));
  const boarLink = (id?: string | null, code?: string | null) =>
    id && code ? (
      <button type="button" onClick={() => onOpenAnimal(id)} className="font-mono font-bold text-[var(--accent)] hover:underline cursor-pointer">
        {code}
      </button>
    ) : (
      code
    );

  const costParts: Array<[string, unknown]> = lot
    ? [
        ['Amortisation', lot.amortisation_period],
        ['Feed', lot.feed_cost_period],
        ['Medicine', lot.drug_cost_period],
        ['Overheads', lot.overhead_cost_period],
        ['Colorant', lot.colorant_cost],
      ]
    : [];

  return (
    <Dialog open={!!lotId} onClose={onClose} title={lot?.lot_no ? `Semen lot ${lot.lot_no}` : 'Semen lot'} presentation="page" className="max-h-[92vh] overflow-y-auto">
      {error && (
        <p className="text-sm" style={{ color: 'var(--danger)' }} role="alert">
          {error}
        </p>
      )}
      {!lot && !error && (
        <p className="text-sm" style={muted}>
          Loading…
        </p>
      )}
      {lot && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Doses collected', num(lot.doses_collected)],
              ['Doses remaining', num(lot.doses_remaining)],
              ['Cost per dose', num(lot.unit_cost_per_dose, 4)],
              ['Lot cost', money(lot.running_cost_period)],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-[var(--radius-md)] border p-3" style={raised}>
                <p className="text-[11px] uppercase font-semibold" style={muted}>
                  {label}
                </p>
                <p className="text-lg font-bold" style={primary}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          <Section title="Lot">
            <Facts
              rows={[
                ['Lot number', lot.lot_no],
                ['Collection date', day(lot.collection_date)],
                ['Expiry', day(lot.expiry_date)],
                ['Breed (line)', named(lot.breed)],
                ['Semen item', named(lot.item)],
                ['Stored in', named(lot.warehouse)],
                ['Posted to inventory', lot.inventory_posted ? 'Yes' : 'No'],
                ['Boar batch', lot.boar_batch_no],
                ['Cost period', lot.period_from && lot.period_to ? `${day(lot.period_from)} → ${day(lot.period_to)}` : null],
                ['Recorded', day(lot.created_at)],
              ]}
            />
            {lot.notes && (
              <p className="text-xs" style={sub}>
                Notes: {lot.notes}
              </p>
            )}
          </Section>

          <Section title="Label, colorant and destination">
            <Facts
              rows={[
                ['Label', lot.label],
                ['Week', lot.week_no ? `${lot.week_no}${lot.week_year ? ` / ${lot.week_year}` : ''}` : null],
                ['Colorant', lot.colorant_name],
                ['Colorant stock item', named(lot.colorant_item)],
                ['Colorant quantity', num(lot.colorant_qty, 3)],
                ['For farm', named(lot.destination_farm)],
                ['Collection plan', lot.plan?.plan_no],
                ['Plan reference', lot.plan?.reference],
                ['Requested by', lot.plan?.requested_by],
              ]}
            />
          </Section>

          <Section title={lot.pooled ? `Boars in this pooled lot (${lot.boars.length})` : 'Boar'}>
            {lot.pooled ? (
              <p className="text-xs" style={sub}>
                Mixed into one lot; each boar carries the share of the lot's cost shown.
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead style={muted}>
                  <tr>
                    {['Boar', 'Collector', 'Volume ml', 'Doses', 'Morph %', 'Motility %', 'Conc. M/ml', 'Result', ...(lot.pooled ? ['Cost share'] : [])].map((h) => (
                      <th key={h} className="py-1.5 pr-3 font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(lot.results.length ? lot.results : [{ boar_id: lot.boar_id, boar_code: lot.boar_code, doses: lot.doses_collected, volume_ml: lot.volume_ml, motility_pct: lot.motility_pct, concentration_m_per_ml: lot.concentration_m_per_ml, accepted: true }]).map((r: Row) => (
                    <tr key={r.boar_id} className="border-t" style={{ borderColor: 'var(--border)', ...primary }}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{boarLink(r.boar_id, r.boar_code)}</td>
                      <td className="py-1.5 pr-3">{r.collector_code ?? '—'}</td>
                      <td className="py-1.5 pr-3">{num(r.volume_ml) ?? '—'}</td>
                      <td className="py-1.5 pr-3">{r.accepted === false ? '—' : (num(r.doses, 0) ?? '—')}</td>
                      <td className="py-1.5 pr-3">{num(r.morphology_pct) ?? '—'}</td>
                      <td className="py-1.5 pr-3">{num(r.motility_pct) ?? '—'}</td>
                      <td className="py-1.5 pr-3">{num(r.concentration_m_per_ml) ?? '—'}</td>
                      <td className="py-1.5 pr-3" style={{ color: r.accepted === false ? 'var(--danger)' : 'var(--success)' }}>
                        {r.accepted === false ? `Rejected${r.reject_reason ? ` — ${r.reject_reason}` : ''}` : 'Accepted'}
                      </td>
                      {lot.pooled && <td className="py-1.5 pr-3">{money(lot.boars.find((b: Row) => b.boar_id === r.boar_id)?.cost_share)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Cost per dose">
            <Facts rows={costParts.map(([label, v]) => [label, money(v)] as [string, ReactNode])} />
            <p className="text-xs" style={sub}>
              Lot cost {money(lot.running_cost_period)} ÷ {num(lot.doses_collected)} doses = {num(lot.unit_cost_per_dose, 4)} per dose.
            </p>
          </Section>

          <Section title="Use of the doses">
            <Facts
              rows={[
                ['Used inside the company', num(lot.doses_used_internal)],
                ['Sold', num(lot.doses_sold)],
                ['Remaining', num(lot.doses_remaining)],
              ]}
            />
            {lot.services.length ? (
              <table className="w-full text-left text-xs border-collapse">
                <thead style={muted}>
                  <tr>
                    {['Mating date', 'Sow', 'Doses', 'Result'].map((h) => (
                      <th key={h} className="py-1.5 pr-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lot.services.map((s: Row) => (
                    <tr key={s.breeding_id} className="border-t" style={{ borderColor: 'var(--border)', ...primary }}>
                      <td className="py-1.5 pr-3">{day(s.mating_date)}</td>
                      <td className="py-1.5 pr-3 font-mono">{s.sow_code}</td>
                      <td className="py-1.5 pr-3">{num(s.doses, 0)}</td>
                      <td className="py-1.5 pr-3">{s.conception_result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs" style={muted}>
                No AI service has drawn from this lot yet.
              </p>
            )}
          </Section>

          <Section title="QR code">
            {lot.qr ? (
              <>
                <Facts rows={[['Pack number', lot.qr.pack_no], ['Generated', day(lot.qr.generated_at)], ['Status', lot.qr.is_voided ? 'Voided' : 'Active']]} />
                <pre className="text-[11px] overflow-x-auto rounded border p-2" style={{ ...raised, ...sub }}>
                  {JSON.stringify(lot.qr.qr_data, null, 2)}
                </pre>
              </>
            ) : (
              <p className="text-xs" style={muted}>
                No QR was made for this lot.
              </p>
            )}
          </Section>
        </div>
      )}
    </Dialog>
  );
}
