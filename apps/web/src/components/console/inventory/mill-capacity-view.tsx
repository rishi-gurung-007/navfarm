"use client";

/**
 * How Mill Capacity Available KG and Plan vs Mill Capacity (workbook Engine
 * r42–r43) read on Feed Plan, Mill Consolidation and the Compare Report. The
 * API computes both; this file only words them, so the three pages cannot
 * disagree about what "Not configured" or AMBER means.
 */
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { TranslationKeys } from "@/utils/translations";

export type MillCapacityStatus = "GREEN" | "AMBER" | "RED";
export type MillCapacityState = "AVAILABLE" | "NOT_SCHEDULED" | "NOT_CONFIGURED";

export interface DietCapacity {
  state: MillCapacityState;
  demandKg: number;
  availableKg: number | null;
  status: MillCapacityStatus | null;
  binCode?: string | null;
  millCode?: string | null;
}

type T = (key: TranslationKeys, vars?: Record<string, string | number>) => string;

const VARIANT: Record<MillCapacityStatus, BadgeProps["variant"]> = { GREEN: "success", AMBER: "warning", RED: "danger" };
const LABEL: Record<MillCapacityStatus, TranslationKeys> = { GREEN: "millCapGreen", AMBER: "millCapAmber", RED: "millCapRed" };

export const formatKg = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Mill Capacity Available KG, or why there is none — never 0 for "unknown". */
export function millCapacityText(state: MillCapacityState | null | undefined, availableKg: number | string | null | undefined, t: T): string {
  if (state === "AVAILABLE" && availableKg !== null && availableKg !== undefined && Number.isFinite(Number(availableKg))) return formatKg(availableKg);
  return t(state === "NOT_SCHEDULED" ? "millCapNotScheduled" : "millCapNotConfigured");
}

export function MillCapacityBadge({ status, t, title }: { status: MillCapacityStatus | null | undefined; t: T; title?: string }) {
  if (!status) return <span className="text-[var(--text-secondary)]">{t("millCapNoStatus")}</span>;
  return <Badge variant={VARIANT[status]} dot title={title}>{t(LABEL[status])}</Badge>;
}
