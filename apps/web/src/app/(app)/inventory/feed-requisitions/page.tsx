import { redirect } from "next/navigation";

/** D26: Inventory → Feed Requisitions became Inventory → Requisitions; old links and bookmarks still land. */
export default function FeedRequisitionsMoved() {
  redirect("/inventory/requisitions");
}
