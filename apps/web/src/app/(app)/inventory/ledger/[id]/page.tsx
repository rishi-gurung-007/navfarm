"use client";

import { useParams, useRouter } from "next/navigation";
import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import InventoryLedgerDetail from "@/components/console/inventory/inventory-ledger-detail";

export default function InventoryLedgerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  return (
    <InventoryPageShell activeKey="ledger">
      <div className="py-2">
        <InventoryLedgerDetail
          ledgerId={id}
          isStandalone
          onClose={() => router.push("/inventory/ledger")}
        />
      </div>
    </InventoryPageShell>
  );
}
