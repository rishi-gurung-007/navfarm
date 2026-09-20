"use client";

import { AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

type AlertVariant = "danger" | "warning" | "success" | "info";

const VARIANT_STYLE: Record<AlertVariant, { icon: typeof AlertCircle; color: string; bg: string }> = {
  danger: { icon: AlertCircle, color: "var(--danger)", bg: "var(--danger-muted)" },
  warning: { icon: AlertTriangle, color: "var(--warning)", bg: "var(--warning-muted)" },
  success: { icon: CheckCircle2, color: "var(--success)", bg: "var(--success-muted)" },
  info: { icon: Info, color: "var(--info)", bg: "var(--accent-muted)" },
};

/** Theme-aware inline alert — replaces the old hardcoded `bg-(--danger-muted) text-(--danger)`
 * pattern that rendered as a jarring light-pink box in dark mode. */
export function InlineAlert({ variant = "danger", children }: { variant?: AlertVariant; children: ReactNode }) {
  const v = VARIANT_STYLE[variant];
  const Icon = v.icon;
  return (
    <div
      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-[var(--text-primary)]"
      style={{ backgroundColor: v.bg, borderColor: v.color }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: v.color }} />
      <span className="leading-normal">{children}</span>
    </div>
  );
}
