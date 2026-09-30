"use client";

import { MasterDataTable } from "@/modules/master-data/MasterDataTable";
import { getConfig } from "@/modules/master-data/configs";

/**
 * Reporting periods are a company calendar used by Feed Forecast and period
 * close. They keep the shared master-data implementation, but live in
 * Settings instead of being presented as a Farm Master.
 */
export default function ReportingPeriodsSettingsPage() {
  const config = getConfig("reporting-period");
  if (!config) return null;
  return <MasterDataTable config={config} />;
}
