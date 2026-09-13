"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyBatchSchedulersPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/schedulers");
  }, [router]);

  return null;
}
