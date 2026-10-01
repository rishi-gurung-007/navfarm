import { redirect } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

/** Old Inventory bookmarks remain valid after Requisitions moved into Approvals. */
export default async function InventoryRequisitionsMoved({ searchParams }: { searchParams: Promise<Search> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  const query = params.size ? `?${params.toString()}` : "";
  redirect(`/approvals/requisitions${query}`);
}
