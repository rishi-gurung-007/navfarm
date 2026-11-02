import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The "KPI strip under the page title" pattern (apple.design.md §21's
 * "Summary strip") — before this, three unrelated implementations of the
 * same idea existed: bordered cards in a flat grid, the same cards nested one
 * level deeper inside a wrapping section card, and plain unboxed label/value
 * pairs split by a hairline. One shared pair replaces all three.
 *
 * `tone` colors the value text (and icon). `emphasis` additionally tints the
 * whole card (border + background) — reserve it for a card that IS a status
 * indicator (Biosecurity Alert, GL Reconciled/Variance), not a card that
 * merely contains a positive or negative number: a plain KPI that happens to
 * be bad news (a mortality total) should get `tone="danger"` alone, card
 * left neutral. Tinting every card that has an opinion is exactly the "color
 * every card differently" apple.design.md §6 rules out.
 */
export function StatRow({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const cols: Record<number, string> = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-5",
    6: "sm:grid-cols-2 lg:grid-cols-6",
  };
  return (
    <div className={cn("grid grid-cols-1 gap-4", cols[columns], className)}>
      {children}
    </div>
  );
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  icon?: ElementType;
  /** A control in the card's top-right corner, e.g. an info button that opens the detail behind the value. */
  action?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
  /** Also tint the card's border/background — reserve for a true status card. See file doc. */
  emphasis?: boolean;
  href?: string;
  onClick?: () => void;
}

const TONE_TEXT: Record<string, string> = {
  default: "text-(--text-primary)",
  success: "text-(--success)",
  warning: "text-(--warning)",
  danger: "text-(--danger)",
};

const TONE_EMPHASIS: Record<string, string> = {
  success: "border-(--success) bg-(--success-muted)",
  warning: "border-(--warning) bg-(--warning-muted)",
  danger: "border-(--danger) bg-(--danger-muted)",
};

export function StatCard({ label, value, unit, sub, icon: Icon, action, tone = "default", emphasis = false, href, onClick }: StatCardProps) {
  const emphasisClass = emphasis ? TONE_EMPHASIS[tone] : undefined;
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper
      href={href}
      onClick={onClick}
      className={cn(
        "rounded-md border p-4",
        emphasisClass || "border-(--border) bg-(--surface)",
        (href || onClick) && "nf-press cursor-pointer transition-colors hover:bg-(--surface-raised)"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-(--text-muted)">{label}</p>
        {action ?? (Icon && <Icon className={cn("h-4 w-4 shrink-0", tone === "default" ? "text-(--text-muted)" : TONE_TEXT[tone])} />)}
      </div>
      <p className={cn("mt-1.5 text-3xl font-bold leading-none tracking-tight tabular-nums", TONE_TEXT[tone])}>
        {value}
        {unit && <span className="ml-1.5 text-xs font-medium tracking-normal normal-case text-(--text-secondary)">{unit}</span>}
      </p>
      {sub && <div className="mt-1.5 text-xs text-(--text-secondary)">{sub}</div>}
    </Wrapper>
  );
}
