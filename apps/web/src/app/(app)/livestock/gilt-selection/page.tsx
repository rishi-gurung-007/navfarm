"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Gilts are selected on Livestock > Breeding now (from a litter, before or after the weaning). The old address, kept for bookmarks, goes there. */
export default function GiltSelectionMovedPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/livestock/breeding");
  }, [router]);
  return null;
}
