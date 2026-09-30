import { redirect } from "next/navigation";

/** D24: feed alerts are shown on the one Alerts page; old links and bookmarks still land there. */
export default function FeedAlertsMoved() {
  redirect("/alerts");
}
