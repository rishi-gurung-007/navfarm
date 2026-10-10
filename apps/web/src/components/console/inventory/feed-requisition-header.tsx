"use client";

/**
 * The feed requisition's §1 header fields, in the workbook's order, in ONE
 * place (Task 18b fix round 1). FeedRequisitionDocument (a saved requisition)
 * and RequisitionNewDialog (one not yet saved) both render this, so the order
 * of the header cannot drift between them. Presentational: every value is
 * handed in already formatted; a null value uses a human empty-state message.
 *
 * Req r26-r35 order: Farm Total -> Bulk Truck Target -> (Bagged Total, only
 * when given) -> Bulk Order Multiple -> Required Delivery Date -> Supplier ->
 * Purpose -> Status -> Priority -> Deadline; the approval/transfer/forecast
 * fields follow only on a saved requisition (`saved`).
 */
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { ReadField as BaseReadField } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";

const HALF = "sm:col-span-6 lg:col-span-4";

export interface FeedRequisitionHeaderValues {
  reqNo: ReactNode;
  reqDate: ReactNode;
  reqType: ReactNode;
  source: ReactNode;
  requesterLogin?: ReactNode;
  requesterName?: ReactNode;
  requesterDepartment?: ReactNode;
  farmCode: ReactNode;
  farmName: ReactNode;
  nextDiet: ReactNode;
  farmTotal: ReactNode;
  truckTarget: ReactNode;
  /** Omitted (null) when no line is bagged. */
  baggedTotal?: ReactNode | null;
  bulkMultiple: ReactNode;
  requiredDate: ReactNode;
  supply: ReactNode;
  purpose: ReactNode;
  status: ReactNode;
  priority: ReactNode;
  deadline: ReactNode;
  /** Approval, linked transfer and forecast run: only a saved requisition has them. */
  saved?: { approvedBy: ReactNode; approvedAt: ReactNode; linkedTransfer: ReactNode; forecastRun: ReactNode };
}

export function FeedRequisitionHeaderFields({ values: v }: { values: FeedRequisitionHeaderValues }) {
  const { t } = useLanguage();
  const ReadField = (props: ComponentProps<typeof BaseReadField>) => (
    <BaseReadField {...props} appearance="control" emptyText={props.emptyText ?? t("rqNotYetAvailable")} />
  );
  return (
    <>
      <ReadField className={HALF} label={t("rqdReqNo")} value={v.reqNo} mono />
      <ReadField className={HALF} label={t("rqdReqDate")} value={v.reqDate} />
      <ReadField className={HALF} label={t("rqdReqType")} value={v.reqType} />
      <ReadField className={HALF} label={t("rqdSource")} value={v.source} />
      <ReadField className={HALF} label={t("crqRequesterUserId")} value={v.requesterLogin} mono />
      <ReadField className={HALF} label={t("crqRequester")} value={v.requesterName} />
      <ReadField className={HALF} label={t("crqRequesterDept")} value={v.requesterDepartment} />
      <ReadField className={HALF} label={t("rqdFarmCode")} value={v.farmCode} mono />
      <ReadField className={HALF} label={t("rqdFarmName")} value={v.farmName} />
      <ReadField className={HALF} label={t("rqdNextDiet")} value={v.nextDiet} />
      <ReadField className={HALF} label={t("rqdFarmTotal")} value={v.farmTotal} />
      <ReadField className={HALF} label={t("rqdTruckTarget")} value={v.truckTarget} />
      {v.baggedTotal != null && <ReadField className={HALF} label={t("rqdBaggedTotal")} value={v.baggedTotal} />}
      <ReadField className={HALF} label={t("rqdBulkMultiple")} value={v.bulkMultiple} />
      <ReadField className={HALF} label={t("rqdRequiredDate")} value={v.requiredDate} />
      <ReadField className={HALF} label={t("rqdSupply")} value={v.supply} />
      <ReadField className={HALF} label={t("rqdPurpose")} value={v.purpose} />
      <ReadField className={HALF} label={t("rqdStatus")} value={v.status} />
      <ReadField className={HALF} label={t("rqdPriority")} value={v.priority} />
      <ReadField className={HALF} label={t("rqdDeadline")} value={v.deadline} />
      {v.saved && (
        <>
          <ReadField className={HALF} label={t("rqdApprovedBy")} value={v.saved.approvedBy} />
          <ReadField className={HALF} label={t("rqdApprovedAt")} value={v.saved.approvedAt} />
          <ReadField className={HALF} label={t("rqdLinkedTransfer")} value={v.saved.linkedTransfer} mono />
          <ReadField className={HALF} label={t("rqdForecastRun")} value={v.saved.forecastRun} mono />
        </>
      )}
    </>
  );
}

/**
 * W1 (10 Oct): routes for the records a requisition names. Locations (farm,
 * silo, store) and items open in their master-data record (MasterDataTable
 * reads `recordId`); a batch opens in Batch Data Entry (`batchId`).
 */
export const locationHref = (id: string) => `/master-data/location?recordId=${encodeURIComponent(id)}`;
export const itemHref = (id: string) => `/master-data/item?recordId=${encodeURIComponent(id)}`;
export const batchHref = (id: string) => `/batches/entry?batchId=${encodeURIComponent(id)}`;

/** A code shown as a link when its record id is known, else as plain text; null when there is no code. */
export function RecordLink({ code, href }: { code: string | null | undefined; href: string | null }): ReactElement | null {
  if (!code) return null;
  if (!href) return <>{code}</>;
  return <a className="text-(--accent) hover:underline" href={href}>{code}</a>;
}

export type FeedType = "BULK" | "BAGGED";

/**
 * Feed Type of a destination — the SAME rule as the server's feedTypeOf
 * (apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts):
 * location_master.feed_in_bags decides when it is set (true = BAGGED, false =
 * BULK); when null a STORE is BAGGED and anything else (a SILO) BULK. Keep the
 * two in step.
 */
export function feedTypeOfDestination(dest: { location_type: string; feed_in_bags?: boolean | null }): FeedType {
  if (dest.feed_in_bags === true) return "BAGGED";
  if (dest.feed_in_bags === false) return "BULK";
  return dest.location_type === "STORE" ? "BAGGED" : "BULK";
}

export interface HeaderLine {
  feedType: string | null;
  kg: number;
  /** Bags when no bag size is known (a saved line's stored count); ignored when bagSizeKg > 0. */
  fallbackBags?: number;
}

/**
 * Req r26 counts bulk only against the truck target (trips: a target, never a
 * block, cp. 17); a bagged line is totalled apart so it is neither folded into
 * the target nor invisible. Shared by the document and the New dialog.
 */
export function bulkTotalAndTrips(lines: HeaderLine[], truckTargetKg: number, bagSizeKg: number) {
  const bulkTotal = lines.filter((l) => l.feedType === "BULK").reduce((sum, l) => sum + l.kg, 0);
  const trips = truckTargetKg > 0 && bulkTotal > 0 ? Math.ceil(bulkTotal / truckTargetKg) : 0;
  const bagged = lines.filter((l) => l.feedType === "BAGGED");
  const baggedKg = bagged.reduce((sum, l) => sum + l.kg, 0);
  const baggedBags = bagged.reduce((sum, l) => sum + (bagSizeKg > 0 ? Math.ceil(l.kg / bagSizeKg) : (l.fallbackBags ?? 0)), 0);
  return { bulkTotal, trips, baggedCount: bagged.length, baggedKg, baggedBags };
}
