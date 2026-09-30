import { redirect } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

/** The original Feed Requisitions URL follows the common Requisitions move. */
export default async function FeedRequisitionsMoved({ searchParams }: { searchParams: Promise<Search> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  const query = params.size ? `?${params.toString()}` : "";
  redirect(`/approvals/requisitions${query}`);
}
