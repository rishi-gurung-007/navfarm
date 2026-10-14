"use client";

import { useState } from "react";
import { LivestockPageShell } from "@/components/console/livestock/livestock-page-shell";
import HerdAnalyticsPanel from "@/components/console/piggery/herd-analytics-panel";
import PiggeryGmDashboard from "@/components/console/piggery/piggery-gm-dashboard";
import { BarChart3, LayoutDashboard } from "lucide-react";

export default function PiggeryHerdAnalyticsPage() {
  const [activeTab, setActiveTab] = useState<"gm" | "demographics">("gm");

  return (
    <LivestockPageShell activeKey="analytics">
      <div className="space-y-6">
        {/* Sub-tab Navigation */}
        <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setActiveTab("gm")}
            className={`nf-press inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "gm"
                ? "bg-[var(--accent)] text-white shadow-xs"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]"
            }`}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span>GM Executive Dashboard</span>
          </button>

          <button
            onClick={() => setActiveTab("demographics")}
            className={`nf-press inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === "demographics"
                ? "bg-[var(--accent)] text-white shadow-xs"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Herd Demographics & Valuation</span>
          </button>
        </div>

        {activeTab === "gm" ? <PiggeryGmDashboard /> : <HerdAnalyticsPanel />}
      </div>
    </LivestockPageShell>
  );
}
