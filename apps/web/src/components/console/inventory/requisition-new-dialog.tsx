"use client";

/**
 * The New requisition dialog. From the Feed Forecast tab it offers Feed only
 * (the default `types`, Rishi 4 Oct, docs/decisions.md:2495-2501); from
 * Approvals -> Requisitions (Task 13) it is given every kind and also shows
 * the chooser. Item asks Store or Purchase; Fixed Asset and Service go
 * straight to Purchase (decisions 1 Oct) via `onCommon` — this dialog itself
 * only builds the feed document (D26; Requisition §1 row 7, type MANUAL).
 *
 * A manual feed line naming an item the lifecycle does not require at that
 * destination is refused by the API unless it carries an exception reason
 * (Req. row 13, `lineChangeProblems` in feed-requisition.rules.ts) — each
 * line below carries that reason, sent as `exception_reason` only when given.
 *
 * One line per silo or store and feed item; the API refuses the same pair
 * twice and anything that is not an active silo or store of the farm, and
 * its message is shown as it comes. Its two lists come from the feed
 * module's own GET /feed-requisition/options (F3, review I3), read only when
 * the dialog opens: the Master Data routes it used before answer with the
 * tenant templates in a tenant-wide workspace and refuse a farm login
 * outright, on a screen that lists the farm quite happily.
 */
import { showToast } from "@/components/ui/toast";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Building2, Package, Plus, Trash2, Wheat, Wrench } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ReasonSelect } from "@/components/ui/reason-select";
import { getStoredUser } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { useLanguage } from "@/hooks/useLanguage";
import { locationLabel, todayIso, unwrap } from "./feed-format";
import { FeedRequisitionHeaderFields, bulkTotalAndTrips, feedTypeOfDestination, type FeedType } from "./feed-requisition-header";
import { useFeedFarm } from "./use-feed-farm";
import { FeedFarmSelect } from "./feed-farm-select";
import { DOC_TYPE_LABEL, FEED_TYPE_LABEL, PURPOSE_LABEL, REQ_STATUS_LABEL, SOURCE_LABEL, SUPPLY_LABEL, labelOf, variantOf } from "./requisition-labels";
import type { RequisitionView } from "./requisitions-panel";

interface Destination { location_id: string; location_code: string; location_name?: string | null; location_type: string; feed_in_bags?: boolean | null }
interface FeedItem { item_id: string; item_code: string; item_name: string }
interface Options { destinations: Destination[]; items: FeedItem[] }
interface Draft { dest: string; item: string; kg: string; date: string; reasonId: string; reasonLabel: string }

const EMPTY: Draft = { dest: "", item: "", kg: "", date: "", reasonId: "", reasonLabel: "" };
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 align-middle text-xs text-[var(--text-primary)]";
/** Requisition §2 line numbers step by 10000; the number shown is a preview, the API assigns the real one. */
const LINE_STEP = 10000;
// The complete feed line contract. Only destination, item, requested quantity
// and proposed date are required inputs; forecast evidence is populated on
// save and is deliberately shown read-only here.
const COLUMNS = [
  "rqdColLineNo", "rqdColSilo", "rqdColItemNo", "rqdColItemDesc", "rqdColFeedType", "rqdColNextDiet",
  "rqdColDaysBefore", "rqdColLifecycle", "rqdColSystemBalance", "rqdColDaily", "rqdColDaysRemaining",
  "rqdColRecommended", "rqdColRequested", "rqdColBags", "rqdColDelivery", "rqnColException", "",
] as const;

/** The settings the header needs (GET /feed-settings, resolved for the farm). */
interface HeaderSettings { truckTargetKg: number; bulkMultipleKg: number; bagSizeKg: number }

/** The Feed Type of a line's destination — the server's own rule (feed-requisition-header.tsx); none until a destination is chosen. */
function feedTypeOfDraft(line: Draft, destinations: Destination[]): FeedType | null {
  const dest = destinations.find((d) => d.location_id === line.dest);
  return dest ? feedTypeOfDestination(dest) : null;
}

export type RequisitionKind = "FEED" | "ITEM" | "FA" | "SERVICE";

const CHOICES = {
  FEED: { label: "rqNewPurposeFeed", hint: "rqNewPurposeFeedHint", icon: Wheat },
  ITEM: { label: "rqNewPurposeItem", hint: "rqNewPurposeItemHint", icon: Package },
  FA: { label: "rqNewPurposeFa", hint: "rqNewPurposeFaHint", icon: Building2 },
  SERVICE: { label: "rqNewPurposeService", hint: "rqNewPurposeServiceHint", icon: Wrench },
} as const;

function ChoiceCard({ label, hint, icon: Icon, onClick }: { label: string; hint: string; icon: typeof Wheat; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="nf-press flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:bg-[var(--surface-raised)]"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-amber-500/10 text-amber-700 dark:text-amber-400">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-[var(--text-primary)]">{label}</span>
        <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{hint}</span>
      </span>
    </button>
  );
}

export function RequisitionNewDialog({
  open,
  farmId,
  types = ["FEED"],
  onClose,
  onCreated,
  onCommon,
}: {
  open: boolean;
  farmId?: string;
  types?: RequisitionKind[];
  onClose: () => void;
  onCreated: (view: RequisitionView) => void;
  onCommon?: (choice: { docType: "ITEM" | "FA" | "SERVICE"; purpose: "STORE" | "PURCHASE" }) => void;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  // Called unconditionally regardless of whether the caller already has a
  // farmId (hooks rule) — it is cheap and its farm list is cached per A3.
  const farm = useFeedFarm();
  const effectiveFarmId = farmId ?? farm.farmId ?? "";
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [lines, setLines] = useState<Draft[]>([{ ...EMPTY }]);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<HeaderSettings | null>(null);
  const [step, setStep] = useState<"choose" | "item" | "FEED">("choose");
  const requester = getStoredUser();

  useEffect(() => {
    if (!open || step !== "FEED" || !effectiveFarmId) return;
    let alive = true;
    setLines([{ ...EMPTY }]);
    setRemarks("");
    api
      .get(`/feed-requisition/options?${new URLSearchParams({ farmId: effectiveFarmId }).toString()}`)
      .then((res: any) => {
        if (!alive) return;
        const options = unwrap<Options>(res);
        setDestinations(Array.isArray(options?.destinations) ? options.destinations : []);
        setItems(Array.isArray(options?.items) ? options.items : []);
      })
      .catch((err: any) => {
        if (alive) showToast.error(err?.message || tRef.current("rqLoadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [open, effectiveFarmId, step]);

  // Header: Bulk Truck Target and Bulk Order Multiple come from the feed
  // planning settings resolved for the farm (GET /feed-settings). A farm login
  // without the permission, or a failed read, leaves them blank — the API
  // applies them on save either way.
  const chosenFarm = farm.farms.find((f) => f.farmId === effectiveFarmId) ?? null;
  const companyId = chosenFarm?.companyId ?? "";
  useEffect(() => {
    setSettings(null);
    if (!open || step !== "FEED" || !effectiveFarmId || !companyId) return;
    let alive = true;
    api
      .get(`/feed-settings?${new URLSearchParams({ companyId, farmId: effectiveFarmId }).toString()}`)
      .then((res: any) => {
        const raw = unwrap<Partial<HeaderSettings>>(res);
        if (alive && typeof raw?.truckTargetKg === "number" && typeof raw?.bulkMultipleKg === "number") {
          setSettings({ truckTargetKg: raw.truckTargetKg, bulkMultipleKg: raw.bulkMultipleKg, bagSizeKg: typeof raw.bagSizeKg === "number" ? raw.bagSizeKg : 0 });
        }
      })
      .catch(() => {
        /* header settings are informational; the API applies them on save */
      });
    return () => {
      alive = false;
    };
  }, [open, effectiveFarmId, companyId, step]);

  // Task 19: the Feed Forecast tab's instance is given only `["FEED"]` (the
  // default) — the "what is this for?" choice is pointless when there is
  // only one answer, so it opens the feed form at once. Approvals ->
  // Requisitions passes every kind and is unaffected: the ladder below only
  // short-circuits when exactly one type is on offer.
  //
  // Fix round 1 (Important): `types` must NOT sit in this effect's
  // dependency array by reference. Neither caller gives it a stable
  // identity — requisitions-hub.tsx passes `types={[...TYPES]}`, a fresh
  // array literal every render, and requisitions-panel.tsx omits the prop
  // entirely, so the default parameter `types = ["FEED"]` above is a fresh
  // literal every render too (the "same shape" the default parameter was
  // left half-fixed in). Depending on `types` itself means ANY re-render of
  // the parent while this dialog is open and a kind already chosen re-runs
  // this effect and recomputes `step` from `types.length` — for the
  // four-type Approvals case that is always "choose", snapping back to the
  // picker and silently discarding whatever the farm had filled in, with no
  // error and no trace. `typesKey` is a primitive derived from the array's
  // CONTENT, not its identity, so the effect only reconsiders `step` when
  // the actual set of offered kinds changes — immune to how any caller
  // constructs the array (spread, default parameter, or otherwise).
  const typesKey = types.join(",");
  useEffect(() => {
    if (!open) return;
    setStep(types.length === 1 ? (types[0] === "FEED" ? "FEED" : "item") : "choose");
  }, [open, typesKey]);

  const setLine = (i: number, patch: Partial<Draft>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  // Req. r26 counts bulk only; r27 is a target, never a block (cp. 17). The same helper as the document's.
  const { bulkTotal, trips, baggedCount, baggedKg, baggedBags } = bulkTotalAndTrips(
    lines.map((l) => ({ feedType: feedTypeOfDraft(l, destinations), kg: Number(l.kg) > 0 ? Number(l.kg) : 0 })),
    settings?.truckTargetKg ?? 0,
    settings?.bagSizeKg ?? 0,
  );
  const earliest = lines.map((l) => l.date).filter(Boolean).sort()[0] ?? null;
  const complete = lines.every((l) => l.dest && l.item && Number(l.kg) > 0 && l.date);

  const create = async () => {
    setBusy(true);
    try {
      const body = {
        farmId: effectiveFarmId,
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        lines: lines.map((l) => ({
          destination_location_id: l.dest,
          item_id: l.item,
          quantity_kg: Number(l.kg),
          proposed_delivery_date: l.date,
          ...(l.reasonId ? { reason_id: l.reasonId } : {}),
        })),
      };
      const created = unwrap<RequisitionView>(await api.post("/feed-requisition", body));
      showToast.success(tRef.current("rqCreated"));
      onCreated(created);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const pick = (type: RequisitionKind) => {
    if (type === "FEED") return setStep("FEED");
    if (type === "ITEM") return setStep("item");
    onCommon?.({ docType: type, purpose: "PURCHASE" }); // decisions 1 Oct: FA and Service use Purchase
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(step === "choose" || step === "item" ? "rqNew" : "rqNewTitle")}
      maxWidth="lg"
      headerLeading={(step === "item" || (step === "FEED" && types.length > 1)) ? (
        <Button size="sm" variant="ghost" onClick={() => setStep("choose")}>
          <ArrowLeft className="h-3.5 w-3.5" /> {t("crqBack")}
        </Button>
      ) : undefined}
      footer={step === "FEED"
        ? <Button size="sm" onClick={create} disabled={busy || !complete}>{t("rqNewCreate")}</Button>
        : undefined}
    >
      {step === "choose" ? (
        <div className="flex flex-col gap-4 text-xs">
          <p className="text-sm text-[var(--text-secondary)]">{t("rqNewPurposePrompt")}</p>
          {types.map((type) => {
            const choice = CHOICES[type];
            return <ChoiceCard key={type} label={t(choice.label)} hint={t(choice.hint)} icon={choice.icon} onClick={() => pick(type)} />;
          })}
        </div>
      ) : step === "item" ? (
        <div className="flex flex-col gap-4 text-xs">
          <p className="text-sm text-[var(--text-secondary)]">{t("rqNewPurposePrompt")}</p>
          <ChoiceCard label={t("rqNewItemStore")} hint="" icon={Package} onClick={() => onCommon?.({ docType: "ITEM", purpose: "STORE" })} />
          <ChoiceCard label={t("rqNewItemPurchase")} hint="" icon={Package} onClick={() => onCommon?.({ docType: "ITEM", purpose: "PURCHASE" })} />
        </div>
      ) : (
      <div className="flex flex-col gap-4 text-xs">
        {/*
          * Task 18b (Rishi 4 Oct: "I can't see the header fields ... only
          * lines"): laid out like FeedRequisitionDocument — the workbook's
          * Requisition §1 header first, then the §2 lines as a table. What
          * the API assigns on save (number, priority, deadline) is said so;
          * nothing here is a field the farm can set except the farm itself
          * (hub only), the lines and the remarks. Required Delivery Date is
          * derived from the lines, read-only (Rishi 4 Oct).
          */}
        <FieldGroup>
          {farmId === undefined && (
            <div className="sm:col-span-12">
              <FeedFarmSelect id="rqn-farm" label={t("rqFarm")} farms={farm.farms} farmId={farm.farmId} onChange={farm.setFarmId} />
            </div>
          )}
          <FeedRequisitionHeaderFields values={{
            reqNo: t("rqnAssignedOnSave"),
            reqDate: formatDateShort(todayIso()),
            reqType: labelOf(DOC_TYPE_LABEL, "ITEM", t),
            source: labelOf(SOURCE_LABEL, "MANUAL_ENTRY", t),
            requesterLogin: requester?.email,
            requesterName: requester?.fullName,
            requesterDepartment: null,
            farmCode: chosenFarm?.code,
            farmName: chosenFarm?.name,
            nextDiet: t("rqNo"),
            farmTotal: t("rqdFarmTotalValue", { total: bulkTotal.toLocaleString("en-US") }),
            truckTarget: settings ? t("rqdTruckTargetValue", { target: settings.truckTargetKg.toLocaleString("en-US"), trips }) : null,
            baggedTotal: baggedCount === 0 ? null
              : settings && settings.bagSizeKg > 0
                ? t("rqdBaggedTotalValue", { kg: baggedKg.toLocaleString("en-US"), bags: baggedBags.toLocaleString("en-US"), size: settings.bagSizeKg.toLocaleString("en-US") })
                : t("rqdBaggedTotalNoSize", { kg: baggedKg.toLocaleString("en-US"), bags: baggedBags.toLocaleString("en-US") }),
            bulkMultiple: settings ? t("rqdKgValue", { kg: settings.bulkMultipleKg.toLocaleString("en-US") }) : null,
            requiredDate: earliest ? formatDateShort(earliest) : t("rqnFromLines"),
            supply: labelOf(SUPPLY_LABEL, "MILL", t),
            purpose: labelOf(PURPOSE_LABEL, "INTERNAL_TRANSFER", t),
            status: <Badge variant={variantOf(REQ_STATUS_LABEL, "DRAFT")}>{labelOf(REQ_STATUS_LABEL, "DRAFT", t)}</Badge>,
            priority: t("rqnDerivedOnSave"),
            deadline: t("rqnSetOnSave"),
          }} />
          <Field className="sm:col-span-12" label={t("rqRemarks")} htmlFor="rqn-remarks">
            <textarea id="rqn-remarks" className="nf-input w-full px-2 py-1" style={inputStyle} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </FieldGroup>

        <FieldGroup title={t("rqdLinesTitle")} action={<Button variant="outline" size="sm" onClick={() => setLines((cur) => [...cur, { ...EMPTY }])}><Plus className="h-3.5 w-3.5" /> {t("rqNewAddLine")}</Button>}>
          <div className="flex flex-col gap-2 sm:col-span-12">
            <ScrollTable label={t("rqLinesLabel")}>
              <thead>
                <tr>
                  {COLUMNS.map((c) => <th key={c} scope="col" className={cn(TH, c === "rqdColRequested" && "text-right")}>{c ? t(c) : ""}</th>)}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const item = items.find((it) => it.item_id === line.item);
                  const type = feedTypeOfDraft(line, destinations);
                  return (
                    <tr key={i}>
                      <td className={cn(TD, "text-right tabular-nums")}>{(i + 1) * LINE_STEP}</td>
                      <td className={TD}>
                        <SearchableSelect ariaLabel={t("rqNewDestination", { line: i + 1 })} value={line.dest}
                          options={destinations.map((d) => ({ value: d.location_id, code: d.location_code, name: d.location_name ?? "" }))}
                          valueKey="value" getLabel={(row) => locationLabel(String(row.code), String(row.name || ""))}
                          getLabelParts={(row) => [String(row.code), String(row.name || "")]} columnHeaders={[t("rqdColSilo"), t("rqdFarmName")]}
                          placeholder={t("rqNewChoose")} searchPlaceholder={t("crqSearch")} noMatchesLabel={t("crqNoMatches")}
                          triggerClassName="w-72" onChange={(dest) => setLine(i, { dest })} />
                      </td>
                      <td className={TD}>
                        <SearchableSelect ariaLabel={t("rqNewItem", { line: i + 1 })} value={line.item}
                          options={items.map((it) => ({ value: it.item_id, code: it.item_code, name: it.item_name }))}
                          valueKey="value" getLabel={(row) => `${row.code} — ${row.name}`} getLabelParts={(row) => [String(row.code), String(row.name)]}
                          columnHeaders={[t("rqdColItemNo"), t("rqdColItemDesc")]} placeholder={t("rqNewChoose")}
                          searchPlaceholder={t("crqSearch")} noMatchesLabel={t("crqNoMatches")} triggerClassName="w-52"
                          onChange={(item) => setLine(i, { item })} />
                      </td>
                      <td className={TD}>{item?.item_name ?? t("rqnFromSelection")}</td>
                      <td className={TD}>{type ? labelOf(FEED_TYPE_LABEL, type, t) : t("rqnFromSelection")}</td>
                      <td className={TD}>{t("rqnCalculatedOnSave")}</td>
                      <td className={cn(TD, "text-right")}>{t("rqnCalculatedOnSave")}</td>
                      <td className={TD}>{t("rqnCalculatedOnSave")}</td>
                      <td className={cn(TD, "text-right")}>{t("rqnCalculatedOnSave")}</td>
                      <td className={cn(TD, "text-right")}>{t("rqnCalculatedOnSave")}</td>
                      <td className={cn(TD, "text-right")}>{t("rqnCalculatedOnSave")}</td>
                      <td className={cn(TD, "text-right")}>{t("rqnCalculatedOnSave")}</td>
                      <td className={cn(TD, "text-right")}>
                        <input aria-label={t("rqNewKg", { line: i + 1 })} type="number" min={0} step="any" className="nf-input-sm w-28 text-right" style={inputStyle} value={line.kg} onChange={(e) => setLine(i, { kg: e.target.value })} />
                      </td>
                      <td className={cn(TD, "text-right")}>
                        {type === "BAGGED" && settings?.bagSizeKg ? Math.ceil(Number(line.kg || 0) / settings.bagSizeKg) || t("rqnCalculatedOnSave") : t("rqNotApplicable")}
                      </td>
                      <td className={TD}>
                        <input aria-label={t("rqNewDate", { line: i + 1 })} type="date" className="nf-input-sm" style={inputStyle} value={line.date} onChange={(e) => setLine(i, { date: e.target.value })} />
                      </td>
                      <td className={TD}>
                        <ReasonSelect ariaLabel={t("rqNewException", { line: i + 1 })} value={line.reasonId} valueFormat="id"
                          placeholder={t("rqNewChooseReason")} searchPlaceholder={t("rqNewSearchReason")}
                          onChange={(reasonId, reason) => setLine(i, { reasonId, reasonLabel: reason ? `${reason.reason_code} — ${reason.reason_name}` : "" })}
                          onClear={() => setLine(i, { reasonId: "", reasonLabel: "" })} triggerClassName="w-60" />
                      </td>
                      <td className={TD}>
                        <Button variant="ghost" size="sm" aria-label={t("rqNewRemoveLine", { line: i + 1 })} disabled={lines.length === 1}
                          onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </ScrollTable>
          </div>
        </FieldGroup>
      </div>
      )}
    </Dialog>
  );
}
