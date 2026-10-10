/**
 * W2T / W9 (cp 43, Req r136): where a transfer came from. The API returns the
 * source requisition (id, no., FEED or COMMON), the Mill Consolidation Sheet and
 * the loading sheet(s) through stock_transfer_line.requisition_line_id; this
 * turns them into the links the transfer list and document show. A hand-made
 * transfer has none.
 */
import type { TranslationKeys } from "@/utils/translations";

export interface TransferSourceFields {
  source_requisition_id?: string | null;
  source_requisition_no?: string | null;
  source_requisition_kind?: "FEED" | "COMMON" | null;
  source_consolidation_id?: string | null;
  source_consolidation_no?: string | null;
  source_loading_sheets?: Array<{ loading_sheet_id: string; loading_sheet_no: string }> | null;
  source_loading_sheet_id?: string | null;
  source_loading_sheet_no?: string | null;
}

export interface TransferSourceLink {
  labelKey: TranslationKeys;
  text: string;
  href: string;
}

const q = encodeURIComponent;

export function requisitionHref(kind: "FEED" | "COMMON" | null | undefined, id: string): string {
  return kind === "FEED" ? `/inventory/feed-forecast?tab=feed-requisition&id=${q(id)}` : `/requisitions?id=${q(id)}`;
}

export function transferSourceLinks(row: TransferSourceFields | null | undefined): TransferSourceLink[] {
  if (!row?.source_requisition_id) return [];
  const links: TransferSourceLink[] = [{
    labelKey: "w2tSourceRequisition",
    text: row.source_requisition_no ?? row.source_requisition_id,
    href: requisitionHref(row.source_requisition_kind, row.source_requisition_id),
  }];
  if (row.source_consolidation_id) {
    links.push({
      labelKey: "w2tSourceConsolidation",
      text: row.source_consolidation_no ?? row.source_consolidation_id,
      href: `/inventory/feed-forecast?tab=mill-consolidation&id=${q(row.source_consolidation_id)}`,
    });
  }
  const sheets = row.source_loading_sheets?.length
    ? row.source_loading_sheets
    : row.source_loading_sheet_id ? [{ loading_sheet_id: row.source_loading_sheet_id, loading_sheet_no: row.source_loading_sheet_no ?? row.source_loading_sheet_id }] : [];
  for (const sheet of sheets) {
    links.push({
      labelKey: "w2tSourceLoadingSheet",
      text: sheet.loading_sheet_no,
      href: `/inventory/feed-forecast?tab=loading-instructions&id=${q(sheet.loading_sheet_id)}`,
    });
  }
  return links;
}
