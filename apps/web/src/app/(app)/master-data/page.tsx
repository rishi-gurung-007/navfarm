"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";
import { getStoredUser, canAccessMasterDataConfig } from "@/hooks/useAuth";

export default function MasterDataIndexPage() {
  const router = useRouter();
  useEffect(() => {
    const user = getStoredUser();
    const accessible = MASTER_DATA_CONFIGS.filter(
      (c) => !user || canAccessMasterDataConfig(user, c.key, "can_view")
    );
    const first =
      accessible.find((c) => c.isPrimary) ??
      accessible[0] ??
      MASTER_DATA_CONFIGS.find((c) => c.isPrimary) ??
      MASTER_DATA_CONFIGS[0];
    router.replace(`/master-data/${first.key}`);
  }, [router]);
  return null;
}
