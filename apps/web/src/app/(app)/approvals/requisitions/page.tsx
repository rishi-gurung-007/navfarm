import { redirect } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

/**
 * Requisition is its own top-level page now (/requisitions; Rishi 5 Oct) — the
 * old Approvals / Inventory URL stays valid and keeps its query string.
 */
export default async function RequisitionsMoved({ searchParams }: { searchParams: Promise<Search> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  const query = params.size ? `?${params.toString()}` : "";
  redirect(`/requisitions${query}`);
}
