"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared visual frame for requisition documents.
 *
 * Common and feed requisitions deliberately keep different field contracts,
 * line models, validation and APIs. This component owns only the document
 * presentation so create, edit and later workflow views keep the same rhythm
 * and responsive behaviour without coupling their business rules.
 */
export function RequisitionDocumentShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-6", className)} data-requisition-document>
      {children}
    </div>
  );
}

