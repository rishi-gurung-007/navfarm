"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, PiggyBank } from "lucide-react";
import { api } from "@/services/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { formatAmount } from "@/lib/utils";
import { GiltCreatedCard } from "./gilt-cards";

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
};

const STATUS_VARIANT: Record<string, "neutral" | "success" | "warning" | "danger"> = { DRAFT: "warning", POSTED: "success", CANCELLED: "neutral" };

/**
 * The gilt selections made so far, newest first, each opening to its gilts as cards with their parents and the cost per pig each carries. Shown on the Gilt
 * Selection screen's History tab and on the Breeding page's Gilt Selections tab, so both read the same.
 */
export default function GiltSelectionHistory({
  rows, onOpenAnimal, onContinue, onError,
}: {
  rows: Row[];
  onOpenAnimal: (animalId: string) => void;
  /** Continues registering the gilts of a draft; when left out, drafts are listed without the button. */
  onContinue?: (selectionId: string) => void;
  onError?: (message: string) => void;
}) {
  const { t } = useLanguage();
  const [openId, setOpenId] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);

  const toggle = async (id: string) => {
    if (openId === id) { setOpenId(""); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    try {
      const res: any = await api.get(`/piggery/gilt-selection/${id}`);
      setDetail(res?.data ?? res);
    } catch (e: any) {
      onError?.(e?.message || t("gsLoadFailed"));
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border py-10 text-center text-sm" style={{ ...S.surface, ...S.sub }}>
        <PiggyBank className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("gsNoHistory")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((h) => {
        const isOpen = openId === h.selection_id;
        return (
          <div key={h.selection_id} className="overflow-hidden rounded-[var(--radius-lg)] border" style={S.surface}>
            <button type="button" onClick={() => toggle(h.selection_id)} aria-expanded={isOpen} className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-left">
              <span style={S.muted}>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
              <span className="min-w-[8rem]">
                <span className="block text-sm font-bold" style={S.primary}>{h.selection_no}</span>
                <span className="block text-[11px]" style={S.muted}>{String(h.selection_date).slice(0, 10)}{h.production_week ? ` · ${t("gsWeekN", { n: h.production_week })}` : ""}</span>
              </span>
              <span className="min-w-[10rem] flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("gsSowsCol")}</span>
                <span className="block text-sm" style={S.primary}>{(h.lines || []).map((l: Row) => `${l.sow_code ?? "—"} × ${l.boar_code ?? "—"}`).join(", ") || "—"}</span>
              </span>
              <span>
                <span className="block text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("gsBatch")}</span>
                <span className="block text-sm" style={S.sub}>{h.batch_no}</span>
              </span>
              <span className="text-right">
                <span className="block text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("gsHeadReleased")}</span>
                <span className="block text-sm font-semibold" style={S.primary}>{h.head_released == null ? "—" : Number(h.head_released)}</span>
              </span>
              <span className="text-right">
                <span className="block text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("gsValueReleased")}</span>
                <span className="block text-sm font-semibold" style={S.primary}>{h.value_released == null ? "—" : formatAmount(h.value_released)}</span>
              </span>
              <Badge variant={STATUS_VARIANT[h.status] || "neutral"}>{t(`gsStatus_${h.status}` as TranslationKeys)}</Badge>
            </button>
            {h.status === "DRAFT" && onContinue && (
              <div className="flex justify-end border-t px-4 py-2" style={{ borderColor: "var(--row-border)" }}>
                <Button size="sm" variant="outline" onClick={() => onContinue(h.selection_id)}>{t("gsContinueDraft")}</Button>
              </div>
            )}
            {isOpen && (
              <div className="border-t p-4" style={{ borderColor: "var(--row-border)", backgroundColor: "var(--surface-raised)" }}>
                {!detail ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" style={S.muted} />
                ) : (detail.gilts || []).length === 0 ? (
                  <p className="text-center text-xs" style={S.sub}>{t("gsDraftNoGilts")}</p>
                ) : (
                  <div className="grid gap-3">
                    {(detail.gilts as Row[]).map((g) => <GiltCreatedCard key={g.gilt_id} gilt={g} onOpenAnimal={onOpenAnimal} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
