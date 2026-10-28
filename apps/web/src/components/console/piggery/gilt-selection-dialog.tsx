"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, Sprout } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useLanguage } from "@/hooks/useLanguage";
import { formatAmount } from "@/lib/utils";
import { MasterDataTable } from "@/modules/master-data/MasterDataTable";
import { getConfig } from "@/modules/master-data/configs";
import AnimalDetailsModal from "./animal-details-modal";
import GiltCards, { GiltCreatedCard, GiltParentsStrip, type GiltParents } from "./gilt-cards";
import { bufferErrors, bufferFor, MIN_GILT_TEATS, type GiltBufferRow } from "./gilt-selection-rules";

type Row = Record<string, any>;

const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;
const today = () => new Date().toISOString().slice(0, 10);

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
};

/**
 * Select gilts from one litter, on the Breeding page, before the weaning, at week 4 or after it (BBP: the gilt selection opens at week 4). Step 1 shows the litter (its sow and boar,
 * its age, the piglets still in the lot, the cost per pig a gilt will carry) and asks how many gilts; step 2 shows one card per gilt, each registered through the full
 * animal register form or all together from the RFID and teat count on the cards. Nothing is asked about a batch: the piglets are found from the litter.
 */
export default function GiltSelectionDialog({
  open, farrow, draftId, onClose, onChanged,
}: {
  open: boolean;
  /** The litter (a row of the Farrowing & Litters list) to select from. */
  farrow?: Row | null;
  /** Or a draft selection to continue registering. */
  draftId?: string | null;
  onClose: () => void;
  /** Called after anything is saved (a gilt registered, a draft cancelled), so the lists behind refresh. */
  onChanged?: () => void;
}) {
  const { t } = useLanguage();

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [batch, setBatch] = useState<{ batch_id: string; batch_no: string } | null>(null);
  const [litter, setLitter] = useState<Row | null>(null);
  const [animalBatches, setAnimalBatches] = useState<Row[]>([]);
  const [selectionDate, setSelectionDate] = useState(today());
  const [count, setCount] = useState("");
  const [colour, setColour] = useState("");
  const [animalBatchId, setAnimalBatchId] = useState("");
  const [step, setStep] = useState<"setup" | "cards" | "done">("setup");
  const [draft, setDraft] = useState<{ id: string; selection_no: string; lines: Row[] } | null>(null);
  const [buffer, setBuffer] = useState<GiltBufferRow[]>([]);
  const [registered, setRegistered] = useState<Record<string, { animal_id: string; animal_code: string }>>({});
  const [full, setFull] = useState<{ row: GiltBufferRow; lineId: string; values: Record<string, unknown> } | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [done, setDone] = useState<Row | null>(null);

  const minDate = farrow?.farrowing_date ? String(farrow.farrowing_date).slice(0, 10) : undefined;

  const loadLitter = async (batchId: string, farrowId: string, asOf: string) => {
    const d = unwrap<Row>(await api.get(`/piggery/gilt-selection/piglets?batch_id=${batchId}&as_of=${asOf}`));
    setLitter((d.litters || []).find((l: Row) => l.farrow_id === farrowId) ?? null);
    return d;
  };

  // Opened for a litter: find the batch that holds its piglets (the lot, or where they were weaned to) and read the litter from it.
  useEffect(() => {
    if (!open) return;
    setError(""); setStep("setup"); setDraft(null); setBuffer([]); setRegistered({}); setFull(null); setDone(null); setCount(""); setColour(""); setAnimalBatchId("");
    setBatch(null); setLitter(null);
    const when = today();
    setSelectionDate(when);
    api.get("/batch?status=ACTIVE&limit=500").then((r) => setAnimalBatches((unwrap<Row[]>(r) || []).filter((b) => b.tracking_mode === "ANIMAL_WISE"))).catch(() => setAnimalBatches([]));
    if (draftId) {
      setLoading(true);
      api.get(`/piggery/gilt-selection/${draftId}`)
        .then((r) => {
          const d = unwrap<Row>(r);
          const rows: GiltBufferRow[] = [];
          const doneMap: Record<string, { animal_id: string; animal_code: string }> = {};
          for (const l of d.lines as Row[]) {
            const mine = (d.gilts as Row[]).filter((g) => g.line_id === l.line_id);
            for (let i = 0; i < l.gilts_selected; i++) {
              const key = `${l.farrow_id}:${i}`;
              const g = mine[i];
              rows.push({ key, farrow_id: l.farrow_id, rfid_tag: g?.rfid_tag ?? "", no_of_teats: g ? String(g.no_of_teats) : "", dob: g?.dob ? String(g.dob).slice(0, 10) : String(l.farrowing_date ?? "").slice(0, 10) });
              if (g) doneMap[key] = { animal_id: g.animal_id, animal_code: g.animal_code };
            }
          }
          setDraft({ id: d.selection_id, selection_no: d.selection_no, lines: d.lines });
          setBuffer(rows);
          setRegistered(doneMap);
          setStep("cards");
        })
        .catch((e: any) => setError(e?.message || t("gsLoadFailed")))
        .finally(() => setLoading(false));
      return;
    }
    if (!farrow) return;
    setLoading(true);
    api.get(`/piggery/gilt-selection/litter/${farrow.farrow_id}`)
      .then(async (r) => {
        const found = unwrap<Row>(r)?.batch;
        if (!found) { setError(t("gsLitterNoBatch")); return; }
        setBatch(found);
        await loadLitter(found.batch_id, farrow.farrow_id, when);
      })
      .catch((e: any) => {
        setError(e?.message || t("gsLoadFailed"));
        // The litter is not there any more (the page was showing an old list): reload the list behind.
        onChanged?.();
      })
      .finally(() => setLoading(false));
  }, [open, farrow?.farrow_id, draftId]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeDate = (value: string) => {
    setSelectionDate(value);
    if (batch && farrow && value) loadLitter(batch.batch_id, farrow.farrow_id, value).catch(() => undefined);
  };

  const available = Math.max(0, Math.min(Number(litter?.available ?? 0), litter?.piglets_in_lot != null ? Number(litter.piglets_in_lot) : Infinity));
  const asked = Math.max(0, Math.floor(Number(count) || 0));
  const errors = useMemo(() => bufferErrors(buffer.filter((r) => !registered[r.key])), [buffer, registered]);
  const remaining = buffer.filter((r) => !registered[r.key]).length;
  const lineOf = (farrowId: string) => draft?.lines.find((l) => l.farrow_id === farrowId);

  const parents = (l?: Row): GiltParents => ({
    dam_animal_id: l?.sow_animal_id, dam_code: l?.sow_code, dam_parity: l?.parity_number, dam_tsi: l?.sow_tsi, sire_animal_id: l?.boar_animal_id, sire_code: l?.boar_code,
    lot_no: l?.lot_no, cost_per_pig: l?.cost_per_pig, farrowing_date: l?.farrowing_date, avg_birth_weight_kg: l?.avg_birth_weight_kg, avg_weaning_weight_kg: l?.avg_weaning_weight_kg,
  });

  /** Step 1 done: the selection is saved as a draft (a line for the litter) and the gilt cards open. */
  const start = async () => {
    if (!batch || !farrow || !asked) return;
    setBusy(true);
    setError("");
    try {
      const saved = unwrap<Row>(await api.post("/piggery/gilt-selection", {
        batch_id: batch.batch_id,
        selection_date: selectionDate,
        ...(animalBatchId ? { animal_batch_id: animalBatchId } : {}),
        lines: [{ farrow_id: farrow.farrow_id, gilts_selected: asked, ...(colour.trim() ? { colour_code: colour.trim() } : {}) }],
      }));
      setDraft({ id: saved.selection_id, selection_no: saved.selection_no, lines: saved.lines || [] });
      setRegistered({});
      setBuffer(bufferFor([{ farrow_id: farrow.farrow_id, available: asked, farrowing_date: String(farrow.farrowing_date).slice(0, 10) }], [{ farrow_id: farrow.farrow_id, gilts_selected: asked }]));
      setStep("cards");
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || t("gsCreateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const setRow = (key: string, patch: Partial<GiltBufferRow>) => setBuffer((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const finish = async (selectionId: string) => {
    try {
      setDone(unwrap<Row>(await api.get(`/piggery/gilt-selection/${selectionId}`)));
      setStep("done");
    } catch {
      onClose();
    }
    onChanged?.();
  };

  /** Closing with nothing registered cancels the draft; with some registered it stays, to be continued from the Gilt Selections tab. */
  const close = async () => {
    if (busy) return;
    if (draft && step === "cards" && Object.keys(registered).length === 0) await api.patch(`/piggery/gilt-selection/${draft.id}/cancel`, {}).catch(() => undefined);
    onChanged?.();
    onClose();
  };

  const openFull = async (row: GiltBufferRow) => {
    const line = lineOf(row.farrow_id);
    if (!draft || !line) return;
    setError("");
    try {
      const pre = unwrap<Row>(await api.get(`/piggery/gilt-selection/${draft.id}/lines/${line.line_id}/prefill`));
      setFull({
        row, lineId: line.line_id,
        values: { ...pre.values, ...(row.dob ? { dob: row.dob } : {}), ...(row.rfid_tag.trim() ? { rfid_tag: row.rfid_tag.trim() } : {}), ...(row.no_of_teats ? { no_of_teats: Number(row.no_of_teats) } : {}) },
      });
    } catch (e: any) {
      setError(e?.message || t("gsLoadFailed"));
    }
  };

  const giltFormConfig = useMemo(() => {
    const base = getConfig("animal");
    return base && draft && full ? { ...base, apiBase: `/piggery/gilt-selection/${draft.id}/lines/${full.lineId}/gilt` } : null;
  }, [draft, full]);

  const createRest = async () => {
    if (!draft) return;
    const rows = buffer.filter((r) => !registered[r.key]);
    if (!rows.length || Object.keys(errors).length) return;
    setBusy(true);
    setError("");
    try {
      const res = unwrap<Row>(await api.post(`/piggery/gilt-selection/${draft.id}/create-gilts`, {
        gilts: rows.map((r) => ({ line_id: lineOf(r.farrow_id)!.line_id, rfid_tag: r.rfid_tag.trim(), no_of_teats: Number(r.no_of_teats), ...(r.dob ? { dob: r.dob } : {}) })),
      }));
      setDone(res);
      setStep("done");
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || t("gsCreateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const title = step === "setup"
    ? t("gsDlgTitle", { sow: farrow?.sow_code ?? "", lot: farrow?.piglet_lot_no ?? "" })
    : draft ? `${t("gsDlgTitleCards")} · ${draft.selection_no}` : t("gsDlgTitleCards");
  const weekChip = litter
    ? litter.weaned ? t("gsWeanedTag") : litter.age_weeks >= 4 ? t("gsWeek4Reached") : t("gsWeek4On", { date: litter.week4_date })
    : "";

  return (
    <>
      <Dialog
        open={open}
        onClose={close}
        title={title}
        description={step === "setup" ? t("gsDlgDescription", { min: MIN_GILT_TEATS }) : step === "cards" ? t("gsBufferDescription", { min: MIN_GILT_TEATS }) : undefined}
        maxWidth="xl"
        footer={
          step === "setup" ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <p className="text-xs" style={S.muted}>{t("gsDlgOrWean")}</p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={close}>{t("gsDlgCancel")}</Button>
                <Button onClick={start} disabled={busy || loading || !batch || asked < 1 || asked > available || !selectionDate}>
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sprout className="mr-1.5 h-3.5 w-3.5" />}
                  {t("gsDlgContinue", { count: asked })}
                </Button>
              </div>
            </div>
          ) : step === "cards" ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <p className="text-xs" style={S.muted}>{t("gsRegisteredProgress", { done: Object.keys(registered).length, total: buffer.length })}</p>
              {remaining > 0 ? (
                <Button onClick={createRest} disabled={busy || Object.keys(errors).length > 0}>
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sprout className="mr-1.5 h-3.5 w-3.5" />}
                  {remaining === 1 ? t("gsConfirmCreateRestOne") : t("gsConfirmCreateRest", { count: remaining })}
                </Button>
              ) : (
                <Button onClick={() => draft && finish(draft.id)}>{t("gsDone")}</Button>
              )}
            </div>
          ) : (
            <div className="flex w-full justify-end"><Button onClick={close}>{t("gsDone")}</Button></div>
          )
        }
      >
        <div className="space-y-4">
          {error && <p className="rounded-[var(--radius-md)] border px-3 py-2 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} role="alert">{error}</p>}
          {loading && <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.muted} /></div>}

          {step === "setup" && !loading && litter && (
            <>
              <div className="space-y-3 rounded-[var(--radius-lg)] border p-4" style={S.raised}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold" style={S.primary}>{t("gsDlgLitterHeading")}</p>
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium" style={{ borderColor: litter.age_weeks >= 4 && !litter.weaned ? "var(--warning)" : "var(--border)", color: litter.age_weeks >= 4 && !litter.weaned ? "var(--warning)" : "var(--text-secondary)" }}>
                    <CalendarClock className="h-3.5 w-3.5" /> {t("gsWeeksN", { n: litter.age_weeks })} · {weekChip}
                  </span>
                </div>
                <GiltParentsStrip parents={parents(litter)} onOpenAnimal={setCardId} />
                <div className="grid gap-2 sm:grid-cols-4">
                  {[
                    [t("gsProduced"), String(litter.piglets_produced)],
                    [t("gsInLot"), String(litter.piglets_in_lot ?? "—")],
                    [t("gsAvailable"), String(available)],
                    [t("gsCostPerPig"), formatAmount(litter.cost_per_pig ?? 0)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[var(--radius-md)] border px-3 py-2" style={S.surface}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{label}</p>
                      <p className="text-lg font-bold" style={S.primary}>{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px]" style={S.sub}>{t("gsDlgCostNote")}</p>
                {Number(litter.cost_per_pig ?? 0) === 0 && (
                  <p className="text-[11px] font-semibold" style={{ color: "var(--warning, #b45309)" }}>
                    This litter carries no cost yet: the sow had no capitalised feed, drug or overhead between mating and farrowing. Gilts selected now take an acquisition cost of 0.00; the lactation cost is added at the weaning.
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-[10rem_9rem_1fr]">
                <div>
                  <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="gsd-date">{t("gsDate")}</label>
                  <input id="gsd-date" type="date" className="nf-input w-full text-xs" value={selectionDate} min={minDate} max={today()} onChange={(e) => changeDate(e.target.value)} />
                </div>
                <div>
                  <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="gsd-count">{t("brpWeanGiltsCount")}</label>
                  <Input id="gsd-count" type="number" min={1} max={available || undefined} value={count} onChange={(e) => setCount(e.target.value)} className="h-9 text-[13px] font-bold" placeholder="0" />
                  <p className="mt-1 text-[10px]" style={S.muted}>{t("gsDlgMax", { count: available })}</p>
                </div>
                <div>
                  <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="gsd-batch">{t("gsAnimalBatch")}</label>
                  <Select id="gsd-batch" value={animalBatchId} onChange={(e) => setAnimalBatchId(e.target.value)} className="h-9 text-[13px]">
                    <option value="">{t("gsNoAnimalBatch")}</option>
                    {animalBatches.map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_no}{b.remarks ? ` · ${b.remarks}` : ""}</option>)}
                  </Select>
                </div>
              </div>
              <div className="max-w-xs">
                <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="gsd-colour">{t("gsColour")}</label>
                <Input id="gsd-colour" value={colour} onChange={(e) => setColour(e.target.value)} className="h-9 text-[13px]" maxLength={30} />
              </div>
            </>
          )}

          {step === "cards" && (
            <GiltCards
              rows={buffer}
              parents={(r) => parents(lineOf(r.farrow_id) ?? litter ?? undefined)}
              valuePerHead={litter?.cost_per_pig ?? null}
              errors={errors}
              onChange={setRow}
              onOpenAnimal={setCardId}
              registered={registered}
              onOpenFull={openFull}
            />
          )}

          {step === "done" && done && (
            <div className="space-y-3">
              <div className="flex items-center gap-2" style={{ color: "var(--success)" }}>
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-sm font-semibold">{t("gsCreated", { count: (done.gilts || []).length, selectionNo: done.selection_no })}</p>
              </div>
              <div className="grid gap-3">
                {(done.gilts || []).map((g: Row) => <GiltCreatedCard key={g.gilt_id} gilt={g} onOpenAnimal={setCardId} />)}
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {full && giltFormConfig && (
        <MasterDataTable
          config={giltFormConfig}
          createOnly
          showHeader={false}
          initialValues={full.values}
          onCreateCancelled={() => setFull(null)}
          onCreated={(created: Row) => {
            setRegistered((r) => ({ ...r, [full.row.key]: { animal_id: created.animal_id, animal_code: created.animal_code } }));
            setRow(full.row.key, { rfid_tag: String(created.rfid_tag ?? full.row.rfid_tag), no_of_teats: String(created.no_of_teats ?? full.row.no_of_teats) });
            setFull(null);
            onChanged?.();
            if (created.selection_complete && draft) finish(draft.id);
          }}
        />
      )}

      <AnimalDetailsModal animalId={cardId} onClose={() => setCardId(null)} />
    </>
  );
}
