"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import RequisitionsHub from "@/components/console/requisitions/requisitions-hub";
import { Button } from "@/components/ui/button";
import { ConsolePage } from "@/components/ui/console-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/hooks/useLanguage";

export default function ApprovalsRequisitionsPage() {
  const router = useRouter();
  const { t } = useLanguage();

  return (
    <ConsolePage fill>
      <div className="flex shrink-0 items-start gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/approvals/pending")} aria-label={t("approvals")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader title={t("invRequisitionsTitle")} description={t("rhDesc")} sticky={false} />
      </div>
      <RequisitionsHub />
    </ConsolePage>
  );
}
