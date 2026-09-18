"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/services/api-client";
import { getStoredUser, getStoredToken, getStoredTenantId, NavUser } from "@/hooks/useAuth";

export function useCompaniesPageData() {
  const router = useRouter();
  const [user, setUser] = useState<NavUser | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [companies, setCompanies] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = async (storedUser: NavUser, tid: string) => {
    setLoading(true);
    setError("");
    try {
      const [companiesList, currList] = await Promise.all([
        api.get(`/company/tenant/${tid}`),
        api.get("/currency"),
      ]);
      const rawCurrencies = (currList as any)?.data ?? currList;
      setCurrencies(Array.isArray(rawCurrencies) ? rawCurrencies : []);
      const rawCompanies = (companiesList as any)?.data ?? companiesList;
      setCompanies(Array.isArray(rawCompanies) ? rawCompanies : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load companies.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    const tid = getStoredTenantId();
    if (!token || !storedUser || !tid) {
      router.replace("/");
      return;
    }
    setUser(storedUser);
    setTenantId(tid);
    loadData(storedUser, tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const reload = () => {
    if (user && tenantId) loadData(user, tenantId);
  };

  return { user, tenantId, companies, currencies, loading, error, reload };
}
