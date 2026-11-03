"use client";

import { useEffect, useMemo, useState } from "react";
import { Inbox, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatCard, StatRow } from "@/components/ui/stat-row";
import { TablePager } from "@/components/ui/table-pager";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { formatAmount } from "@/lib/utils";

export type Row = Record<string, any>;
export type CostingMethod = "AMORTIZATION" | "FAIR_VALUE";

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : formatAmount(v as number | string));
/** +45.00 / -354.67: a fair value result keeps its sign, because a gain and a loss are different things. */
const signed = (v: unknown) => (n(v) > 0 ? `+${formatAmount(n(v))}` : n(v) < 0 ? `-${formatAmount(Math.abs(n(v)))}` : formatAmount(0));
const gainTone = (v: unknown) => (n(v) > 0 ? { color: "var(--success)" } : n(v) < 0 ? { color: "var(--danger)" } : S.primary);

export const methodOf = (m?: string | null): CostingMethod => (m === "FAIR_VALUE" ? "FAIR_VALUE" : "AMORTIZATION");

/** What an animal's item costs her by. The API says so; an older answer is read from her ledger (fair value adjustments with nothing amortised). */
export function animalMethod(animal: Row): CostingMethod {
  if (animal.costing_method) return methodOf(animal.costing_method);
  return n(animal.bio_fair_value_adjusted) !== 0 && n(animal.total_amortised) === 0 ? "FAIR_VALUE" : "AMORTIZATION";
}

export function MethodBadge({ method }: { method: CostingMethod }) {
  const { t } = useLanguage();
  return <Badge variant={method === "FAIR_VALUE" ? "info" : "neutral"}>{method === "FAIR_VALUE" ? t("bcrMethodFairValue") : t("bcrMethodAmortisation")}</Badge>;
}

/** One animal: who she is, how she is costed, and the figures that belong to that method. */
export function AnimalCostCard({ animal, stageName, loading, ledger }: { animal: Row; stageName: string; loading: boolean; ledger: Row[] }) {
  const { t } = useLanguage();
  const method = animalMethod(animal);
  const purchase = animal.bio_acquisition != null ? n(animal.bio_acquisition) : n(animal.acquisition_cost);
  const capitalised = n(animal.bio_capitalised);
  const exits = n(animal.bio_exits); // negative: cost handed to a litter, or written off
  const amortised = n(animal.total_amortised);
  const residual = n(animal.residual_effective);
  // What has been charged plus what is still to charge down to the residual, so a litter's hand-over (which lowers the base) cannot make the bar wrong.
  const base = Math.max(0, amortised + Math.max(0, n(animal.book_value) - residual));
  const pct = base > 0 ? Math.min(100, Math.max(0, (amortised / base) * 100)) : 0;
  const born = String(animal.dob || animal.date_of_birth || "").slice(0, 10);
  const start = String(animal.costing_start_date || "").slice(0, 10);

  // The balance runs over every posting, then the page is cut from it, so a later page keeps its true balance.
  const withBalance = useMemo(() => {
    let running = 0;
    return ledger.map((row) => { running += n(row.cost_amount); return { row, balance: running }; });
  }, [ledger]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPage(1); }, [animal.animal_id, pageSize]);
  const pages = Math.max(1, Math.ceil(withBalance.length / pageSize));
  const current = Math.min(page, pages);
  const shownRows = withBalance.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div className="space-y-4 rounded-[var(--radius-lg)] border p-5" style={S.surface}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="font-mono text-lg font-bold" style={S.accent}>{animal.animal_code}</h3>
            {animal.rfid_tag && <span className="font-mono text-xs" style={S.muted}>({animal.rfid_tag})</span>}
            <Badge variant={animal.status === "ACTIVE" ? "success" : "neutral"}>{animal.status}</Badge>
            <MethodBadge method={method} />
            {loading && <Loader2 className="h-4 w-4 animate-spin" style={S.accent} />}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            <div><dt style={S.muted}>{t("bcrBreed")}</dt><dd className="font-medium" style={S.primary}>{animal.breed_name || animal.breed_code || "—"}</dd></div>
            <div><dt style={S.muted}>{t("bcrGender")}</dt><dd className="font-medium" style={S.primary}>{animal.gender === "F" ? t("bcrFemale") : t("bcrMale")}</dd></div>
            <div><dt style={S.muted}>{t("bcrStage")}</dt><dd className="font-medium" style={S.primary}>{stageName || "—"}</dd></div>
            <div><dt style={S.muted}>{t("bcrBorn")}</dt><dd className="font-medium" style={S.primary}>{born || "—"}</dd></div>
            <div><dt style={S.muted}>{t("bcrCostingStart")}</dt><dd className="font-medium" style={S.primary}>{start || "—"}</dd></div>
            <div><dt style={S.muted}>{t("bcrCostedBy")}</dt><dd className="font-medium" style={S.primary}>{animal.costing_item_code || "—"}</dd></div>
            <div><dt style={S.muted}>{t("bcrLastRun")}</dt><dd className="font-medium" style={S.primary}>{String(animal.last_run_date || "").slice(0, 10) || "—"}</dd></div>
            <div><dt style={S.muted}>{t("bcrNextDue")}</dt><dd className="font-medium" style={S.primary}>{String(animal.next_due_date || "").slice(0, 10) || "—"}</dd></div>
          </dl>
        </div>
        <div className="text-right">
          <span className="text-xs" style={S.muted}>{t("bcrCurrentBookValue")}</span>
          <p className="font-mono text-xl font-bold" style={S.primary}>{formatAmount(animal.book_value ?? 0)}</p>
        </div>
      </div>

      {method === "AMORTIZATION" ? (
        <>
          <StatRow columns={exits !== 0 ? 6 : 5}>
            <StatCard label={t("bcrPurchasePrice")} value={formatAmount(purchase)} />
            <StatCard label={t("bcrCapitalisedBeforeStart")} value={formatAmount(capitalised)} />
            <StatCard label={t("bcrResidualFloor")} value={formatAmount(residual)} />
            <StatCard label={t("bcrTotalAmortised")} value={formatAmount(amortised)} tone="warning" />
            {exits !== 0 && <StatCard label={t("bcrExits")} value={signed(exits)} />}
            <StatCard label={t("bcrCurrentBookValue")} value={formatAmount(animal.book_value ?? 0)} />
          </StatRow>
          <div className="rounded-[var(--radius-md)] border p-3.5" style={S.raised}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium">
              <span style={S.primary}>{t("bcrAmortisationProgress")}</span>
              <span style={S.sub}>{formatAmount(amortised)} / {formatAmount(base)}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full border" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-[11px]" style={S.muted}>{t("bcrAmortisationHelp")}</p>
          </div>
        </>
      ) : (
        <>
          <StatRow columns={exits !== 0 ? 5 : 4}>
            <StatCard label={t("bcrPurchasePrice")} value={formatAmount(purchase)} />
            <StatCard label={t("bcrCapitalisedBeforeStart")} value={formatAmount(capitalised)} />
            {exits !== 0 && <StatCard label={t("bcrExits")} value={signed(exits)} />}
            <StatCard label={t("bcrFairValueAdjusted")} value={signed(animal.bio_fair_value_adjusted)} tone={n(animal.bio_fair_value_adjusted) < 0 ? "danger" : n(animal.bio_fair_value_adjusted) > 0 ? "success" : "default"} />
            <StatCard label={t("bcrCurrentBookValue")} value={formatAmount(animal.book_value ?? 0)} />
          </StatRow>
          <p className="rounded-[var(--radius-md)] border p-3.5 text-[12px]" style={{ ...S.raised, ...S.sub }}>{t("bcrFairValueHelp")}</p>
        </>
      )}

      <div>
        <h4 className="mb-2 text-xs font-semibold" style={S.primary}>{t("bcrInspectAnimalTitle")}</h4>
        <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                  <TableHead className="whitespace-nowrap">{t("bcrLedgerDate")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("bcrLedgerEvent")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("bcrLedgerDoc")}</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{t("bcrLedgerAmount")}</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{t("bcrLedgerBalance")}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {ledger.length === 0 ? (
                  <tr>
                    <TableCell colSpan={5} className="py-6 text-center" style={S.sub}>
                      <Inbox className="mx-auto mb-1.5 h-5 w-5" style={S.muted} />
                      {t("bcrNoLedger")}
                    </TableCell>
                  </tr>
                ) : shownRows.map(({ row, balance }) => {
                  const amt = n(row.cost_amount);
                  return (
                    <TableRow key={row.entry_id || row.entry_no}>
                      <TableCell className="whitespace-nowrap font-medium" style={S.primary}>{String(row.posting_date).slice(0, 10)}</TableCell>
                      <TableCell className="whitespace-nowrap"><Badge variant={amt < 0 ? "warning" : "success"}>{row.event || row.entry_type}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap font-mono" style={S.sub}>{row.document_no || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono font-medium" style={gainTone(amt)}>{signed(amt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono font-semibold" style={S.primary}>{formatAmount(balance)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
          <TablePager page={current} pageSize={pageSize} total={withBalance.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      </div>
    </div>
  );
}

/** A run's animals. Every column is on show: the two methods have different ones, because they work differently. */
export function RunLinesTable({ method, lines }: { method: CostingMethod; lines: Row[] | undefined }) {
  const { t } = useLanguage();
  const amort = method === "AMORTIZATION";
  const cols = amort ? 8 : 5;
  const skipLabel = (reason?: string | null) => (reason ? t(`bcrSkip_${reason}` as TranslationKeys) : "");
  const status = (l: Row) => (l.status === "CHARGED" ? <Badge variant="success">{t("bcrLineCharged")}</Badge> : <Badge variant="warning">{skipLabel(l.skip_reason)}</Badge>);

  if (lines && lines.length === 0) return <p className="px-4 py-5 text-sm" style={S.sub}>{t("bcrNoLines")}</p>;
  return (
    <div>
      <p className="border-b px-4 py-2 text-[12px]" style={{ ...S.muted, borderColor: "var(--border)" }}>{amort ? t("bcrHowAmortisation") : t("bcrHowFairValue")}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <TableHeader>
            <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
              <TableHead className="whitespace-nowrap">{t("bcrAnimal")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("bcrLineStatus")}</TableHead>
              {amort && <TableHead className="whitespace-nowrap text-right">{t("bcrDays")}</TableHead>}
              {amort && <TableHead className="whitespace-nowrap text-right">{t("bcrRemainingDays")}</TableHead>}
              <TableHead className="whitespace-nowrap text-right">{t("bcrBookValueBefore")}</TableHead>
              {amort && <TableHead className="whitespace-nowrap text-right">{t("bcrResidual")}</TableHead>}
              <TableHead className="whitespace-nowrap text-right">{amort ? t("bcrCharge") : t("bcrFairValueNew")}</TableHead>
              {amort ? <TableHead className="whitespace-nowrap text-right">{t("bcrBookValueAfter")}</TableHead> : <TableHead className="whitespace-nowrap text-right">{t("bcrGainLoss")}</TableHead>}
            </tr>
          </TableHeader>
          <TableBody>
            {!lines ? (
              <tr><TableCell colSpan={cols} className="py-6 text-center" style={S.sub}><Loader2 className="mx-auto h-4 w-4 animate-spin" /></TableCell></tr>
            ) : lines.map((l) => {
              const charged = l.status === "CHARGED";
              return amort ? (
                <TableRow key={l.line_id}>
                  <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{l.animal_code}</TableCell>
                  <TableCell className="whitespace-nowrap">{status(l)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={S.sub}>{l.days == null ? "" : Number(l.days).toFixed(2)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={S.sub}>{l.remaining_days ?? ""}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={S.primary}>{num(l.book_value_before)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={S.sub}>{num(l.residual)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold" style={S.primary}>{charged ? num(l.charge) : ""}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={S.primary}>{num(l.book_value_after)}</TableCell>
                </TableRow>
              ) : (
                <TableRow key={l.line_id}>
                  <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{l.animal_code}</TableCell>
                  <TableCell className="whitespace-nowrap">{status(l)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={S.primary}>{num(l.book_value_before)}</TableCell>
                  {/* The new fair value is shown for a charged line and for "no change" (it is the book value); a line with no rate has none. */}
                  <TableCell className="whitespace-nowrap text-right" style={S.primary}>{charged || l.skip_reason === "NO_CHANGE" ? num(l.book_value_after) : ""}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold" style={charged ? gainTone(l.charge) : S.muted}>{charged ? signed(l.charge) : ""}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
