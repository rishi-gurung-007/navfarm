"use client";

import { CheckCircle2, IdCard, ShieldAlert, Sprout, Venus, Mars, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/useLanguage";
import { formatAmount, formatQuantity } from "@/lib/utils";
import { MIN_GILT_TEATS, type GiltBufferRow } from "./gilt-selection-rules";

/** What the screen knows about the litter the gilts come from: shown on every gilt's card, so she is picked knowing her parents. */
export interface GiltParents {
  dam_animal_id?: string | null;
  dam_code?: string | null;
  dam_tsi?: string | number | null;
  dam_parity?: number | null;
  sire_animal_id?: string | null;
  sire_code?: string | null;
  lot_no?: string | null;
  farrowing_date?: string | null;
  avg_birth_weight_kg?: string | null;
  avg_weaning_weight_kg?: string | null;
  /** What a gilt of this litter carries: the sow's cost per piglet. */
  cost_per_pig?: number | null;
}

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
};

/** A parent as a small tile: her code opens her animal card. */
function ParentTile({ role, code, id, detail, icon, onOpen }: { role: string; code?: string | null; id?: string | null; detail?: string; icon: React.ReactNode; onOpen?: (animalId: string) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2" style={S.raised}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "var(--accent-muted, var(--surface))", color: "var(--accent)" }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{role}</p>
        {code && id && onOpen ? (
          <button type="button" onClick={() => onOpen(id)} className="block max-w-full truncate text-left text-sm font-semibold underline decoration-dotted underline-offset-2" style={{ color: "var(--accent)" }}>{code}</button>
        ) : (
          <p className="truncate text-sm font-semibold" style={S.primary}>{code || "—"}</p>
        )}
        {detail && <p className="truncate text-[11px]" style={S.sub}>{detail}</p>}
      </div>
    </div>
  );
}

export function GiltParentsStrip({ parents, onOpenAnimal }: { parents: GiltParents; onOpenAnimal?: (animalId: string) => void }) {
  const { t } = useLanguage();
  const damDetail = [parents.dam_parity != null ? t("gsParityN", { n: parents.dam_parity }) : "", parents.dam_tsi != null && parents.dam_tsi !== "" ? `TSI ${Number(parents.dam_tsi)}` : ""].filter(Boolean).join(" · ");
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <ParentTile role={t("gsDam")} code={parents.dam_code} id={parents.dam_animal_id} detail={damDetail} icon={<Venus className="h-4 w-4" />} onOpen={onOpenAnimal} />
      <ParentTile role={t("gsSire")} code={parents.sire_code} id={parents.sire_animal_id} detail={parents.sire_code ? "" : t("gsSireUnknown")} icon={<Mars className="h-4 w-4" />} onOpen={onOpenAnimal} />
      <ParentTile
        role={t("gsLitter")}
        code={parents.lot_no}
        detail={[parents.farrowing_date ? String(parents.farrowing_date).slice(0, 10) : "", parents.avg_birth_weight_kg ? `${t("gsBirthWeightShort")} ${formatQuantity(parents.avg_birth_weight_kg)}` : "", parents.avg_weaning_weight_kg ? `${t("gsWeanWeightShort")} ${formatQuantity(parents.avg_weaning_weight_kg)}` : ""].filter(Boolean).join(" · ")}
        icon={<Layers className="h-4 w-4" />}
      />
    </div>
  );
}

/**
 * The gilts about to be registered, one card each: her parents on top (the dam and sire open their animal cards), the three things the operator types
 * (RFID, teats, birth date), the teat rule shown live (15 or more, BBP), and what she will be registered as. Used by the weaning form and the Gilt
 * Selection screen, so both ask for the same thing in the same way.
 */
export default function GiltCards({
  rows, parents, valuePerHead, atWeaning, errors, onChange, onOpenAnimal, giltOf, registered, onOpenFull,
}: {
  rows: GiltBufferRow[];
  parents: GiltParents | ((row: GiltBufferRow) => GiltParents);
  valuePerHead?: number | null;
  /** In the weaning form the lot's value per head is not known yet: the sow's lactation cost moves into it when the weaning is saved. */
  atWeaning?: boolean;
  errors: Record<string, string>;
  onChange: (key: string, patch: Partial<GiltBufferRow>) => void;
  onOpenAnimal?: (animalId: string) => void;
  giltOf?: (row: GiltBufferRow) => number;
  /** Gilts already registered, by row key: their card shows the new animal instead of the fields. */
  registered?: Record<string, { animal_id: string; animal_code: string }>;
  /** Opens the full animal register form for this gilt, pre-filled. */
  onOpenFull?: (row: GiltBufferRow) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const code = errors[r.key];
        const teats = Number(r.no_of_teats);
        const filled = r.no_of_teats.trim() !== "" && Number.isFinite(teats);
        const ok = filled && teats >= MIN_GILT_TEATS;
        const blocked = filled && teats < MIN_GILT_TEATS;
        const p = typeof parents === "function" ? parents(r) : parents;
        const done = registered?.[r.key];
        if (done) {
          return (
            <div key={r.key} className="overflow-hidden rounded-[var(--radius-lg)] border" style={{ ...S.surface, borderColor: "var(--success)" }}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ backgroundColor: "var(--surface-raised)" }}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: "var(--success)", color: "#fff" }}><CheckCircle2 className="h-4 w-4" /></span>
                  <div>
                    <p className="text-sm font-semibold" style={S.primary}>{t("gsGiltN", { n: giltOf ? giltOf(r) : i + 1 })} · {t("gsRegisteredAs")}</p>
                    <p className="text-[11px]" style={S.muted}>RFID {r.rfid_tag}</p>
                  </div>
                </div>
                <button type="button" onClick={() => onOpenAnimal?.(done.animal_id)} className="text-sm font-bold underline decoration-dotted underline-offset-2" style={{ color: "var(--accent)" }}>{done.animal_code}</button>
              </div>
            </div>
          );
        }
        return (
          <div key={r.key} className="overflow-hidden rounded-[var(--radius-lg)] border" style={{ ...S.surface, borderColor: blocked ? "var(--danger)" : ok ? "var(--success)" : "var(--border)" }}>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--row-border)", backgroundColor: "var(--surface-raised)" }}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast, #fff)" }}>{giltOf ? giltOf(r) : i + 1}</span>
                <div>
                  <p className="text-sm font-semibold" style={S.primary}>{t("gsGiltN", { n: giltOf ? giltOf(r) : i + 1 })}</p>
                  <p className="text-[11px]" style={S.muted}>{t("gsCandidateSub")}</p>
                </div>
              </div>
              {onOpenFull && (
                <button type="button" onClick={() => onOpenFull(r)} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--surface)]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                  <IdCard className="h-3.5 w-3.5" /> {t("gsOpenFullCard")}
                </button>
              )}
              {ok && <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--success)" }}><CheckCircle2 className="h-3.5 w-3.5" /> {t("gsMeetsTeats", { min: MIN_GILT_TEATS })}</span>}
              {blocked && <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--danger)" }}><ShieldAlert className="h-3.5 w-3.5" /> {t("gsErr_MIN_TEATS", { min: MIN_GILT_TEATS })}</span>}
            </div>
            <div className="space-y-3 p-4">
              <GiltParentsStrip parents={p} onOpenAnimal={onOpenAnimal} />
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_9.5rem]">
                <div>
                  <label className="nf-text-label mb-1 block" style={S.muted} htmlFor={`gc-rfid-${r.key}`}>{t("gsRfid")}</label>
                  <Input id={`gc-rfid-${r.key}`} placeholder={t("gsRfid")} value={r.rfid_tag} onChange={(e) => onChange(r.key, { rfid_tag: e.target.value })} className="h-9 text-[13px]" maxLength={50} aria-invalid={code === "DUPLICATE" || code === "RFID"} />
                  {code === "DUPLICATE" && <p className="mt-1 text-[11px]" style={{ color: "var(--danger)" }}>{t("gsErr_DUPLICATE")}</p>}
                </div>
                <div>
                  <label className="nf-text-label mb-1 block" style={S.muted} htmlFor={`gc-teats-${r.key}`}>{t("gsTeats")}</label>
                  <Input id={`gc-teats-${r.key}`} type="number" min={1} placeholder="≥ 15" value={r.no_of_teats} onChange={(e) => onChange(r.key, { no_of_teats: e.target.value })} className="h-9 text-[13px]" aria-invalid={blocked} />
                </div>
                <div>
                  <label className="nf-text-label mb-1 block" style={S.muted} htmlFor={`gc-dob-${r.key}`}>{t("gsDob")}</label>
                  <input id={`gc-dob-${r.key}`} type="date" className="nf-input w-full text-xs" value={r.dob} onChange={(e) => onChange(r.key, { dob: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-md)] px-3 py-2 text-[11px]" style={{ backgroundColor: "var(--surface-raised)", color: "var(--text-secondary)" }}>
                <span className="inline-flex items-center gap-1 font-semibold" style={S.primary}><Sprout className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} /> {t("gsWillBe")}</span>
                <span>{t("gsAsGilt")}</span>
                {atWeaning ? <span>{t("gsCarriesAtWeaning")}</span> : p.cost_per_pig != null ? <span>{t("gsCarries", { value: formatAmount(p.cost_per_pig) })}</span> : valuePerHead != null && <span>{t("gsCarries", { value: formatAmount(valuePerHead) })}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A gilt already created: her card summary, with her parents. */
export function GiltCreatedCard({ gilt, onOpenAnimal }: { gilt: Record<string, any>; onOpenAnimal: (animalId: string) => void }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border p-4" style={S.surface}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast, #fff)" }}><Sprout className="h-4 w-4" /></span>
          <div>
            <button type="button" onClick={() => gilt.animal_id && onOpenAnimal(gilt.animal_id)} className="text-sm font-bold underline decoration-dotted underline-offset-2" style={{ color: "var(--accent)" }}>{gilt.animal_code}</button>
            <p className="text-[11px]" style={S.muted}>RFID {gilt.rfid_tag} · {t("gsTeatsN", { count: gilt.no_of_teats })}{gilt.dob ? ` · ${t("gsBornOn", { date: String(gilt.dob).slice(0, 10) })}` : ""}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("gsValueReleased")}</p>
          <p className="text-sm font-semibold" style={S.primary}>{formatAmount(gilt.acquisition_cost ?? 0)}</p>
        </div>
      </div>
      <GiltParentsStrip parents={gilt as GiltParents} onOpenAnimal={onOpenAnimal} />
    </div>
  );
}

