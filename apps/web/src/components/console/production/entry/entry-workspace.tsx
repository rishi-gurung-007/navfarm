"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2, CalendarDays, CheckCircle2, ChevronLeft } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { getStoredUser } from "@/hooks/useAuth";
import { HistoryRail } from "./history-rail";
import { StageOverview } from "./stage-overview";
import { ActivitySection } from "./activity-section";
import type { EntryFormResponse, HistoryDay } from "./types";

/**
 * The daily data entry workspace.
 *
 * Where it stands is in the URL — `?batch=&date=&stage=` — and nowhere else.
 * That is what makes Back work: choosing a stage pushes `stage`, so the browser
 * button that a worker on a phone reaches for first returns them to the stage
 * overview with the batch and the day they were already on, instead of throwing
 * away the whole screen's state as the previous version did.
 *
 * With no `date` the screen opens on the day the *farm* is having, which the
 * form answers with (`today`). It is deliberately not the oldest owed day
 * (Ruling 4). The screen this replaced opened on the backlog and put a banner
 * above it, so a worker recording this morning's feed had to dismiss two days
 * of someone else's arrears first. Owed days are now Missing rows in the
 * History rail, entered by choosing them.
 *
 * The browser's own date is never sent. A phone in one country running a farm
 * in another is the ordinary case here, not the edge one.
 */

interface BatchOption {
  batch_id: string;
  batch_no: string;
  animal_tracking?: string;
  farm_id?: string | null;
}

interface FarmRef {
  location_id: string;
  location_code: string;
  location_name: string;
}

export default function EntryWorkspace() {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const batchParam = searchParams.get("batch") ?? "";
  const dateParam = searchParams.get("date") ?? "";
  const stageParam = searchParams.get("stage") ?? "";

  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [farms, setFarms] = useState<FarmRef[]>([]);
  const [form, setForm] = useState<EntryFormResponse | null>(null);
  const [history, setHistory] = useState<HistoryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const batchId = batchParam || batches[0]?.batch_id || "";

  /** Change the URL, which is the only place this screen keeps its state. */
  const navigate = useCallback(
    (patch: Record<string, string | null>, mode: "push" | "replace") => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      router[mode](`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  /* ── The batch list ──────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/batch?limit=200&status=ACTIVE");
        if (cancelled) return;
        setBatches(res?.data ?? []);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── The farm list, to resolve a batch's farm_id to a code/name ───────── */
  // Only fetched for non-standard users: a STANDARD_USER's farm is fixed and
  // is read straight off the stored session instead (see recordingFor below).
  useEffect(() => {
    if (getStoredUser()?.userType === "STANDARD_USER") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/location?locationType=FARM&rootOnly=true");
        if (cancelled) return;
        const rows = Array.isArray(res) ? res : res?.data;
        if (Array.isArray(rows)) setFarms(rows);
      } catch {
        // The badge simply stays hidden if this can't be loaded.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── Name the batch in the URL once one is known ──────────────────────── */
  // A `?stage=` pushed against an implied batch would point at a foreign stage
  // after a reload, because "the first active batch" is not a stable address.
  // The resolved id is the same one already in use, so this costs no re-fetch.
  useEffect(() => {
    if (!batchParam && batches.length) navigate({ batch: batches[0].batch_id }, "replace");
  }, [batchParam, batches, navigate]);

  /* ── The form for this batch, day and stage, and the day rail ────────── */
  const load = useCallback(async () => {
    if (!batchId) return;
    setError("");
    try {
      // No `date` is sent when the URL has none: which day it is on the farm is
      // the server's answer, and it answers with today.
      const query = [dateParam ? `date=${dateParam}` : "", stageParam ? `stageId=${stageParam}` : ""]
        .filter(Boolean).join("&");
      const [formRes, historyRes] = await Promise.all([
        api.get(`/batch/${batchId}/daily-data/form?${query}`),
        api.get(`/batch/${batchId}/daily-data/history?days=30`),
      ]);
      setForm(formRes.data);
      setHistory(historyRes?.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [batchId, dateParam, stageParam]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <LoadingState />;
  if (!batches.length) {
    return <EmptyState icon={CalendarDays} title={t("deNoBatches")} description={t("deNoBatchesBody")} />;
  }

  /* ── Which farm this entry is being recorded for ─────────────────────── */
  // The daily-data form response carries no farm fields (batchSummary() on
  // the API only returns batch_id/batch_no/animal_tracking/start_date), so
  // this is worked out on the client: for a STANDARD_USER it is always their
  // one fixed farm; for everyone else it is the selected batch's farm_id
  // (already on the /batch list row) resolved against the fetched farm list.
  const storedUser = getStoredUser();
  const selectedBatch = batches.find((b) => b.batch_id === batchId);
  const recordingForFarm = storedUser?.userType === "STANDARD_USER"
    ? storedUser.farm ?? null
    : farms.find((f) => f.location_id === selectedBatch?.farm_id) ?? null;
  const recordingForLabel = recordingForFarm
    ? t("deRecordingForFarm", { code: recordingForFarm.location_code, name: recordingForFarm.location_name })
    : null;

  const selectedDay = form?.date ?? dateParam;
  const currentStage = form?.stages.find((s) => s.stage_id === stageParam) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        {/* ── Which batch, and which day ─────────────────────────────── */}
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[180px] flex-1">
              <span className="mb-1 block text-xs font-medium text-(--text-secondary)">{t("deSelectBatch")}</span>
              <select
                value={batchId}
                // A different batch has different stages and a different first
                // owed day, so neither the stage nor the day survives the change.
                onChange={(e) => navigate({ batch: e.target.value, stage: null, date: null }, "replace")}
                className="h-12 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-(--text-primary)"
              >
                {batches.map((b) => (
                  <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
                ))}
              </select>
            </label>
            <div className="min-w-[170px]">
              <span className="mb-1 block text-xs font-medium text-(--text-secondary)">{t("deWorkingDay")}</span>
              <div className="flex h-12 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 text-sm font-semibold text-(--text-primary)">
                <CalendarDays size={15} className="text-(--accent)" />
                {selectedDay || "—"}
                {form && form.date === form.today && (
                  <span className="text-xs font-normal text-(--text-secondary)">· {t("deToday")}</span>
                )}
              </div>
            </div>
          </div>
          {recordingForLabel && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-(--text-secondary)">
              <Building2 size={13} className="shrink-0 text-(--accent)" /> {recordingForLabel}
            </p>
          )}
        </Card>

        {error && <p className="px-1 text-[13px] text-(--danger)">{error}</p>}

        {form && !form.hasScheduler && (
          <Card><EmptyState icon={CalendarDays} title={t("deNoScheduler")} description={t("deNoSchedulerBody")} /></Card>
        )}

        {/* ── No stage chosen: the overview is the screen ─────────────── */}
        {form?.hasScheduler && !stageParam && (
          form.stages.length
            ? <StageOverview stages={form.stages} onSelect={(id) => navigate({ stage: id }, "push")} />
            : <Card><EmptyState icon={CheckCircle2} title={t("deNothingDue")} /></Card>
        )}

        {/* ── A stage chosen: the day's work for it ──────────────────── */}
        {form?.hasScheduler && stageParam && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 gap-1"
                onClick={() => navigate({ stage: null }, "push")}
              >
                <ChevronLeft size={15} /> {t("deWAllStages")}
              </Button>
              <p className="text-sm font-semibold text-(--text-primary)">
                {currentStage?.stage_name ?? form.batch.batch_no}
              </p>
            </div>
            {form.lines.length === 0
              ? <Card><EmptyState icon={CheckCircle2} title={t("deNothingDue")} /></Card>
              : <ActivitySection form={form} batchId={batchId} onChanged={() => void load()} />}
          </div>
        )}
      </div>

      {/* ── The days, and what each of them still owes ─────────────────── */}
      {/* Above the work on a phone, beside it on a desktop — the grid places
          it, so there is one rail rather than one per breakpoint. */}
      <aside className="order-first lg:order-none lg:sticky lg:top-4 lg:self-start">
        <HistoryRail
          days={history}
          selected={selectedDay}
          today={form?.today}
          onSelect={(day) => navigate({ date: day }, "replace")}
        />
      </aside>
    </div>
  );
}
