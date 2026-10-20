"use client";

/**
 * Mill Production Output (Rishi, 20 Oct): the feed the mill produced into a loading BIN. The BIN Diet Assignments of
 * the production date are the choices — each names a BIN and the feed it takes that day — and the mill enters the KG.
 * Posting puts the KG into the BIN's stock at the feed's standard cost and journals it through the MILL_OUTPUT GL
 * mapping; the API refuses it, with nothing written, until finance has set that mapping up.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Factory } from "lucide-react";
import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { EmptyState } from "@/components/ui/states";
import { showToast } from "@/components/ui/toast";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { NA } from "@/utils/na";
import { formatDateShort, formatStampShort } from "@/utils/date-short";
import { unwrap } from "./feed-format";

type Row = Record<string, any>;

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-left text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-2 align-top text-sm";
const NUM = "whitespace-nowrap text-right tabular-nums";

const kg = (v: unknown) => (v === null || v === undefined || v === "" ? NA : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const money = (v: unknown) => (v === null || v === undefined || v === "" ? NA : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// A cost per KG keeps its digits (0.3809, not 0.38): the value is worked out from it.
const rate = (v: unknown) => (v === null || v === undefined || v === "" ? NA : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const today = () => new Date().toISOString().slice(0, 10);

export default function MillProductionPanel() {
  const { t } = useLanguage();
  const [date, setDate] = useState(today);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [assignmentId, setAssignmentId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [outputs, setOutputs] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  const query = useCallback((extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams(extra);
    const companyId = getActiveCompanyId();
    if (companyId) qs.set("companyId", companyId);
    return qs.toString();
  }, []);

  const loadOutputs = useCallback(() => {
    setLoading(true);
    api.get(`/mill-output?${query()}`)
      .then((r: any) => setOutputs(unwrap<Row[]>(r) || []))
      .catch(() => setOutputs([]))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(loadOutputs, [loadOutputs]);

  // A new date offers that day's BIN assignments and starts the choice over.
  useEffect(() => {
    setAssignmentId("");
    if (!date) { setAssignments([]); return; }
    api.get(`/mill-output/assignments?${query({ productionDate: date })}`)
      .then((r: any) => setAssignments(unwrap<Row[]>(r) || []))
      .catch(() => setAssignments([]));
  }, [date, query]);

  const chosen = useMemo(() => assignments.find((a) => a.assignment_id === assignmentId) ?? null, [assignments, assignmentId]);
  const qty = Number(quantity);
  const value = chosen && qty > 0 ? qty * Number(chosen.standard_cost ?? 0) : null;
  const needsLot = Boolean(chosen?.is_lot_tracked && !chosen?.tracking_series_id);
  const ready = Boolean(chosen && qty > 0 && (!needsLot || lotNo.trim()));

  const post = async () => {
    if (!chosen || !ready) return;
    const ok = await confirmAction({
      title: t("mpoConfirmTitle"),
      message: t("mpoConfirmMessage", { kg: kg(qty), item: chosen.item_name, bin: chosen.bin_code, value: money(value) }),
      confirmLabel: t("mpoPost"),
    });
    if (!ok) return;
    setPosting(true);
    try {
      const res: any = await api.post("/mill-output", {
        ...(getActiveCompanyId() ? { company_id: getActiveCompanyId() } : {}),
        production_date: date,
        assignment_id: chosen.assignment_id,
        quantity_kg: qty,
        ...(lotNo.trim() ? { lot_no: lotNo.trim() } : {}),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      showToast.success(t("mpoPosted", { no: unwrap<Row>(res)?.output_no ?? "" }));
      setQuantity("");
      setLotNo("");
      setRemarks("");
      loadOutputs();
      // The BIN's balance changed: read the assignments again.
      api.get(`/mill-output/assignments?${query({ productionDate: date })}`).then((r: any) => setAssignments(unwrap<Row[]>(r) || [])).catch(() => undefined);
    } catch (err: any) {
      showToast.error(err?.message || t("mpoPostFailed"));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-md)] border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("mpoProductionDate")} htmlFor="mpo-date" required>
            <input id="mpo-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="nf-input-sm w-full" />
          </Field>
          <Field label={t("mpoBinFeed")} required className="lg:col-span-2">
            <SearchableSelect
              ariaLabel={t("mpoBinFeed")}
              ariaRequired
              value={assignmentId}
              onChange={setAssignmentId}
              options={assignments.map((a) => ({
                value: a.assignment_id,
                label: `${a.bin_code} · ${a.item_name}${a.diet_no != null ? ` (${t("mpoDiet", { no: a.diet_no })})` : ""}`,
              }))}
              disabled={!assignments.length}
              placeholder={assignments.length ? t("mpoChooseBin") : t("mpoNoAssignments")}
              searchPlaceholder={t("mpoSearchBin")}
            />
          </Field>
          <Field label={t("mpoQuantityKg")} htmlFor="mpo-qty" required>
            <input id="mpo-qty" type="number" min="0" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="nf-input-sm w-full text-right tabular-nums" />
          </Field>
          {needsLot && (
            <Field label={t("mpoLotNo")} htmlFor="mpo-lot" required>
              <input id="mpo-lot" value={lotNo} onChange={(e) => setLotNo(e.target.value)} className="nf-input-sm w-full font-mono" />
            </Field>
          )}
          <Field label={t("mpoRemarks")} htmlFor="mpo-remarks" className={needsLot ? "lg:col-span-3" : "lg:col-span-4"}>
            <input id="mpo-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} className="nf-input-sm w-full" />
          </Field>
        </div>

        {!assignments.length && date && (
          <p className="mt-3 text-xs text-(--text-secondary)">{t("mpoNoAssignmentsHint")}</p>
        )}

        {chosen && (
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <div><dt className="text-(--text-muted)">{t("mpoMill")}</dt><dd className="text-(--text-primary)">{chosen.mill_name ?? NA}</dd></div>
            <div><dt className="text-(--text-muted)">{t("mpoBinNow")}</dt><dd className="tabular-nums text-(--text-primary)">{kg(chosen.bin_balance_kg)} KG</dd></div>
            <div><dt className="text-(--text-muted)">{t("mpoStandardCost")}</dt><dd className="tabular-nums text-(--text-primary)">{chosen.standard_cost != null ? `${rate(chosen.standard_cost)} / KG` : t("mpoNoStandardCost")}</dd></div>
            <div><dt className="text-(--text-muted)">{t("mpoValue")}</dt><dd className="tabular-nums text-(--text-primary)">{money(value)}</dd></div>
          </dl>
        )}

        <div className="mt-3 flex justify-end">
          <Button onClick={post} disabled={!ready || posting}>
            <Factory className="mr-1.5 h-4 w-4" />
            {posting ? t("mpoPosting") : t("mpoPost")}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border" style={{ borderColor: "var(--border)" }}>
        {!loading && outputs.length === 0 ? (
          <EmptyState icon={Factory} title={t("mpoNoneTitle")} description={t("mpoNoneDescription")} />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>{t("mpoOutputNo")}</th>
                <th className={TH}>{t("mpoProductionDate")}</th>
                <th className={TH}>{t("mpoMillBin")}</th>
                <th className={TH}>{t("mpoFeed")}</th>
                <th className={`${TH} text-right`}>{t("mpoQuantityKg")}</th>
                <th className={`${TH} text-right`}>{t("mpoValue")}</th>
                <th className={TH}>{t("mpoJournal")}</th>
                <th className={TH}>{t("mpoPostedBy")}</th>
              </tr>
            </thead>
            <tbody>
              {outputs.map((o) => (
                <tr key={o.output_id}>
                  <td className={`${TD} font-mono whitespace-nowrap`}>{o.output_no}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatDateShort(o.production_date)}</td>
                  <td className={TD}>{o.mill_name}<div className="text-xs text-(--text-muted)">{o.bin_code} · {o.bin_name}</div></td>
                  <td className={TD}>{o.item_name}{o.lot_no && <div className="font-mono text-xs text-(--text-muted)">{o.lot_no}</div>}</td>
                  <td className={`${TD} ${NUM}`}>{kg(o.quantity_kg)}</td>
                  <td className={`${TD} ${NUM}`}>{money(o.amount)}</td>
                  <td className={`${TD} font-mono whitespace-nowrap`}>{o.journal_no ?? NA}</td>
                  <td className={TD}>{o.created_by_name ?? NA}<div className="text-xs text-(--text-muted)">{formatStampShort(o.created_at)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
