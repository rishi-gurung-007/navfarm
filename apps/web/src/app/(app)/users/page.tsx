"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Search, Shield, UserPlus } from "lucide-react";
import { api } from "../../../services/api-client";
import {
  getStoredUser, getStoredToken, getStoredTenantId, getActiveCompanyId, NavUser,
} from "../../../hooks/useAuth";
import { useLanguage } from "../../../hooks/useLanguage";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { Badge } from "../../../components/ui/badge";
import { LoadingState, ErrorState } from "../../../components/ui/states";
import { Toast } from "../../../components/ui/toast";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../../components/ui/table";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ConsolePage } from "../../../components/ui/console-page";
import { MemberDialog } from "../../../components/console/team/member-dialog";
import { UserTypeBadge, AccountStatusBadge } from "../../../components/console/team/user-badges";
import { assignableUserTypes, isTenantLevelUserType, outranks } from "../../../components/console/team/user-access";

type Row = Record<string, any>;

/** The directory itself. `GET /user` already scopes and enriches it. */
async function fetchTeam(): Promise<Row[]> {
  const list = await api.get("/user?limit=500");
  return Array.isArray(list) ? list : [];
}

/**
 * The team directory.
 *
 * Every row is a real `user_master` account as `GET /user` returns it — the
 * enriched shape carrying company code/name, farm code/name, operational areas
 * and roles. Nothing on this page is assembled from a second guess at those
 * joins, and nothing is invented when a field is empty: an account with no farm
 * shows no farm.
 *
 * The API scopes the list to what the caller may see (a tenant admin the whole
 * tenant, anyone below their active company), so this page neither re-filters
 * by company nor merges a second membership endpoint on top.
 */
export default function TeamPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const [me, setMe] = useState<NavUser | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [companies, setCompanies] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyUserId, setBusyUserId] = useState("");

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; member?: Row } | null>(null);

  const activeCompanyId = getActiveCompanyId() || me?.companyId || (me as any)?.company_id || "";

  // The effect below runs once for the session; `t` is only read inside it, so
  // it is held in a ref rather than made a dependency that would re-fetch the
  // directory every time the language provider re-renders.
  const tRef = useRef(t);
  tRef.current = t;

  const reload = async () => setUsers(await fetchTeam());

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    const tid = getStoredTenantId();
    if (!token || !storedUser || !tid) { router.replace("/"); return; }
    setMe(storedUser);
    setTenantId(tid);

    (async () => {
      setLoading(true); setError("");
      try {
        setUsers(await fetchTeam());
        // Only a tenant-level user is offered a company on create; for anyone
        // else the list is not theirs to read and a refusal is not an error.
        if (isTenantLevelUserType(storedUser.userType)) {
          try {
            const list = await api.get(`/company/tenant/${tid}`);
            setCompanies(Array.isArray(list) ? list : []);
          } catch { /* the create form falls back to the active company */ }
        }
      } catch (e: any) {
        setError(e?.message || tRef.current("tmLoadFailed"));
      } finally { setLoading(false); }
    })();
  }, [router]);

  // The role filter is built from the roles the listed users actually hold, so
  // it can never offer a filter that matches nothing.
  const roleOptions = useMemo(() => {
    const byId = new Map<string, Row>();
    users.forEach((u) => (u.roles || []).forEach((r: Row) => byId.set(r.role_id, r)));
    return [...byId.values()].sort((a, b) => String(a.role_name).localeCompare(String(b.role_name)));
  }, [users]);

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === "ACTIVE" && u.is_active === false) return false;
      if (statusFilter === "INACTIVE" && u.is_active !== false) return false;
      if (roleFilter === "NONE" && (u.roles || []).length > 0) return false;
      if (roleFilter !== "ALL" && roleFilter !== "NONE"
        && !(u.roles || []).some((r: Row) => r.role_id === roleFilter)) return false;
      if (!q) return true;
      const haystack = [
        u.full_name, u.email, u.employee_id, u.designation, u.department,
        u.user_type, u.company_code, u.company_name, u.farm_code, u.farm_name,
        ...(u.roles || []).map((r: Row) => `${r.role_code} ${r.role_name}`),
        ...(u.operational_areas || []).map((a: Row) => `${a.area_code} ${a.area_name}`),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [users, query, roleFilter, statusFilter]);

  // Flat rules, applied to the controls: you never manage a peer or a superior,
  // and the only account you may edit at your own level is your own.
  const canCreate = assignableUserTypes(me?.userType).length > 0;
  const canEdit = (row: Row) => row.user_id === me?.userId || outranks(me?.userType, row.user_type);
  const canToggleStatus = (row: Row) => row.user_id !== me?.userId && outranks(me?.userType, row.user_type);

  const toggleStatus = async (row: Row) => {
    setBusyUserId(row.user_id); setError(""); setSuccess("");
    try {
      if (row.is_active === false) {
        await api.put(`/user/${row.user_id}`, { is_active: true });
        setSuccess(t("tmActivatedSuccess"));
      } else {
        await api.put(`/user/${row.user_id}/deactivate`, {});
        setSuccess(t("tmDeactivatedSuccess"));
      }
      await reload();
    } catch (e: any) {
      // The API's own words: whether this refusal is about rank, company reach
      // or the last active admin is a distinction only it can draw.
      setError(e?.message || t("tmActivateFailed"));
    } finally { setBusyUserId(""); }
  };

  const formatLogin = (value?: string | null) => {
    if (!value) return t("tmNeverLoggedIn");
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  };

  const initials = (name?: string) =>
    (name || "?").split(" ").map((part) => part[0]).join("").substring(0, 2).toUpperCase();

  const RoleCell = ({ row }: { row: Row }) =>
    (row.roles || []).length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {row.roles.map((r: Row) => (
          <Badge key={r.assign_id || r.role_id} variant="neutral"><Shield className="h-3 w-3" /> {r.role_name}</Badge>
        ))}
      </div>
    ) : (
      <span className="text-xs text-(--text-muted)">{t("tmNoRole")}</span>
    );

  const AreaCell = ({ row }: { row: Row }) =>
    (row.operational_areas || []).length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {row.operational_areas.map((a: Row) => (
          <Badge key={a.area_id} variant={a.is_primary ? "accent" : "neutral"} title={a.area_name}>{a.area_code}</Badge>
        ))}
      </div>
    ) : (
      <span className="text-xs text-(--text-muted)">—</span>
    );

  const RowActions = ({ row }: { row: Row }) => (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit(row) ? (
        <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "edit", member: row })}>
          <Pencil className="h-3.5 w-3.5" /> {t("edit")}
        </Button>
      ) : (
        <Badge variant="neutral" title={t("tmProtectedWhy")}><Shield className="h-3 w-3" /> {t("tmProtected")}</Badge>
      )}
      {canToggleStatus(row) && (
        <Button
          variant={row.is_active === false ? "secondary" : "ghost"}
          size="sm"
          disabled={busyUserId === row.user_id}
          onClick={() => toggleStatus(row)}
        >
          {row.is_active === false ? t("tmActivate") : t("tmDeactivate")}
        </Button>
      )}
    </div>
  );

  if (loading) return <LoadingState label={t("tmLoading")} />;

  return (
    <ConsolePage>
      <PageHeader
        title={t("teamManagement")}
        description={t("tmSubtitle")}
        meta={<span className="text-xs text-(--text-muted)">{t("tmCountMembers", { n: visibleUsers.length, total: users.length })}</span>}
        actions={canCreate ? (
          <Button onClick={() => setDialog({ mode: "create" })}>
            <UserPlus className="h-4 w-4" /> {t("tmAddMember")}
          </Button>
        ) : undefined}
      />

      {error && <ErrorState message={error} />}
      {success && <Toast variant="success" message={success} onClose={() => setSuccess("")} />}

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-(--border) bg-(--surface)">
        {/* Toolbar — stacks at phone width, one row from `sm` up. */}
        <div className="flex flex-col gap-3 border-b border-(--border) px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <h2 className="text-[15px] font-semibold text-(--text-primary)">{t("tmDirectory")}</h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <label className="flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-secondary) px-3 text-(--text-muted) focus-within:border-(--input-border-focus) focus-within:bg-(--surface) sm:w-64">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("tmSearch")}
                aria-label={t("tmSearch")}
                className="nf-embedded-input min-w-0 flex-1 border-0 bg-transparent text-xs text-(--text-primary) outline-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <Select aria-label={t("tmFilterRole")} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="sm:w-44">
                <option value="ALL">{t("tmAllRoles")}</option>
                <option value="NONE">{t("tmNoRole")}</option>
                {roleOptions.map((r) => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
              </Select>
              <Select aria-label={t("tmFilterStatus")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-36">
                <option value="ALL">{t("tmAllStatuses")}</option>
                <option value="ACTIVE">{t("statusActive")}</option>
                <option value="INACTIVE">{t("statusInactive")}</option>
              </Select>
            </div>
          </div>
        </div>

        {visibleUsers.length === 0 ? (
          <p className="px-5 py-12 text-center text-xs text-(--text-muted)">{t("tmNoUsers")}</p>
        ) : (
          <>
            {/* Phone: one card per user. The same nine values, stacked, because
                a nine-column table at 390px is a horizontal scroll nobody makes. */}
            <ul className="divide-y divide-(--row-border) sm:hidden">
              {visibleUsers.map((row) => (
                <li key={row.user_id} className="flex flex-col gap-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-(--text-primary)">
                        {row.full_name}
                        {row.user_id === me?.userId && <span className="ml-2 text-[11px] font-normal text-(--text-muted)">({t("tmYou")})</span>}
                      </p>
                      <p className="truncate text-xs text-(--text-secondary)">{row.email}</p>
                    </div>
                    <AccountStatusBadge isActive={row.is_active} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <UserTypeBadge type={row.user_type} />
                    <RoleCell row={row} />
                  </div>
                  <dl className="grid grid-cols-1 gap-1.5 text-xs">
                    <div className="flex gap-2"><dt className="w-28 shrink-0 text-(--text-muted)">{t("tmColCompany")}</dt>
                      <dd className="min-w-0 text-(--text-primary)">{row.company_name || "—"}</dd></div>
                    <div className="flex gap-2"><dt className="w-28 shrink-0 text-(--text-muted)">{t("tmColFarm")}</dt>
                      <dd className="min-w-0 text-(--text-primary)">{row.farm_name || "—"}</dd></div>
                    <div className="flex gap-2"><dt className="w-28 shrink-0 text-(--text-muted)">{t("tmColAreas")}</dt>
                      <dd className="min-w-0"><AreaCell row={row} /></dd></div>
                    <div className="flex gap-2"><dt className="w-28 shrink-0 text-(--text-muted)">{t("tmColLastLogin")}</dt>
                      <dd className="min-w-0 text-(--text-primary)">{formatLogin(row.last_login_at)}</dd></div>
                  </dl>
                  <RowActions row={row} />
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    {[t("usrColName"), t("usrColEmail"), t("usrColType"), t("tmColRoles"), t("tmColCompany"),
                      t("tmColAreas"), t("tmColFarm"), t("tmColStatus"), t("tmColLastLogin"), t("actionsColumn")]
                      .map((head) => <TableHead key={head} className="px-4">{head}</TableHead>)}
                  </tr>
                </TableHeader>
                <TableBody>
                  {visibleUsers.map((row) => (
                    <TableRow key={row.user_id}>
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                            style={{ backgroundColor: "var(--color-navy)" }}>{initials(row.full_name)}</span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-(--text-primary)">
                              {row.full_name}
                              {row.user_id === me?.userId && <span className="ml-2 text-[11px] font-normal text-(--text-muted)">({t("tmYou")})</span>}
                            </span>
                            {(row.designation || row.department || row.employee_id) && (
                              <span className="block text-[10px] text-(--text-muted)">
                                {[row.designation, row.department, row.employee_id].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-(--text-secondary)">{row.email}</TableCell>
                      <TableCell className="px-4 py-3"><UserTypeBadge type={row.user_type} /></TableCell>
                      <TableCell className="px-4 py-3"><RoleCell row={row} /></TableCell>
                      <TableCell className="px-4 py-3">
                        {row.company_name ? (
                          <span className="block">
                            <span className="block text-(--text-primary)">{row.company_name}</span>
                            {row.company_code && <span className="block font-mono text-[10px] text-(--text-muted)">{row.company_code}</span>}
                          </span>
                        ) : <span className="text-(--text-muted)">—</span>}
                      </TableCell>
                      <TableCell className="px-4 py-3"><AreaCell row={row} /></TableCell>
                      <TableCell className="px-4 py-3">
                        {row.farm_name ? (
                          <span className="block">
                            <span className="block text-(--text-primary)">{row.farm_name}</span>
                            {row.farm_code && <span className="block font-mono text-[10px] text-(--text-muted)">{row.farm_code}</span>}
                          </span>
                        ) : <span className="text-(--text-muted)">—</span>}
                      </TableCell>
                      <TableCell className="px-4 py-3"><AccountStatusBadge isActive={row.is_active} /></TableCell>
                      <TableCell className="px-4 py-3 text-(--text-secondary)">{formatLogin(row.last_login_at)}</TableCell>
                      <TableCell className="px-4 py-3"><RowActions row={row} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </>
        )}
      </div>

      {dialog && me && (
        <MemberDialog
          mode={dialog.mode}
          member={dialog.member}
          me={me}
          tenantId={tenantId}
          companies={companies}
          activeCompanyId={activeCompanyId}
          onClose={() => setDialog(null)}
          onSaved={async (message) => {
            setDialog(null);
            setError("");
            setSuccess(message);
            try { await reload(); } catch (e: any) { setError(e?.message || t("tmLoadFailed")); }
          }}
        />
      )}
    </ConsolePage>
  );
}
