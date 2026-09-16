"use client";

import { Badge, type BadgeProps } from "../../ui/badge";
import { useLanguage } from "../../../hooks/useLanguage";

/**
 * A user type is a rung on the access ladder, not a status: SYSTEM_ADMIN is the
 * only one that is genuinely exceptional inside a tenant, so it is the only one
 * that takes colour. Everything else reads as neutral, the same way
 * `status-badge` treats ordinary lifecycle states.
 */
const TYPE_VARIANT: Record<string, BadgeProps["variant"]> = {
  SYSTEM_ADMIN: "danger",
  TENANT_ADMIN: "accent",
};

export function UserTypeBadge({ type }: { type?: string | null }) {
  if (!type) return <span className="text-xs text-(--text-muted)">—</span>;
  return <Badge variant={TYPE_VARIANT[type] || "neutral"}>{type.replace(/_/g, " ")}</Badge>;
}

export function AccountStatusBadge({ isActive }: { isActive?: boolean | null }) {
  const { t } = useLanguage();
  return (
    <Badge variant={isActive === false ? "danger" : "success"} dot>
      {isActive === false ? t("statusInactive") : t("statusActive")}
    </Badge>
  );
}
