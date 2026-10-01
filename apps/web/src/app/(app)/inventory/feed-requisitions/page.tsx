import { redirect } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

/**
 * The old Feed Requisitions URL used to send feed orders to the common
 * Requisitions screen, which is a different document (Task 8). Feed
 * requisitions now live as a tab of Inventory → Feed Forecast, so the bookmark
 * follows them there and keeps whatever it was pointed at.
 */
export default async function FeedRequisitionsMoved({ searchParams }: { searchParams: Promise<Search> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  params.set("tab", "feed-requisition");
  redirect(`/inventory/feed-forecast?${params.toString()}`);
}
