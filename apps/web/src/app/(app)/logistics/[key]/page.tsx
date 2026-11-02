"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { MasterDataPageShell } from "@/components/console/master-data/master-data-page-shell";
import { LOGISTICS_CONFIGS } from "@/modules/master-data/logistics-configs";

// The Logistics masters (vehicles, drivers, zones, routes, rates, service plans, settings) under their own sidebar
// item, on the same config-driven table as every other master.
export default function LogisticsMasterPage() {
  const params = useParams<{ key: string }>();
  const router = useRouter();
  const known = LOGISTICS_CONFIGS.some((c) => c.key === params.key);
  useEffect(() => {
    if (!known) router.replace(`/master-data/${params.key}`);
  }, [known, params.key, router]);
  if (!known) return null;
  return <MasterDataPageShell activeKey={params.key} basePath="/logistics" />;
}
