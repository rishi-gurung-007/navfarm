"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus, RefreshCw, Shield, Building2, Search, Users,
  Pencil,
} from "lucide-react";
import { api } from "../../../services/api-client";
import { getStoredUser, getStoredToken, getStoredTenantId, getActiveCompanyId, NavUser } from "../../../hooks/useAuth";
import { useLanguage } from "../../../hooks/useLanguage";
import { Dialog } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { Badge } from "../../../components/ui/badge";
import { LoadingState, ErrorState } from "../../../components/ui/states";
import { Toast } from "../../../components/ui/toast";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../../components/ui/table";
import { EditMemberModal, UserTypeBadge, Label } from "../../../components/console/edit-member-modal";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ConsolePage } from "../../../components/ui/console-page";

const S = {
  surface:  { backgroundColor: "var(--surface)",        borderColor: "var(--border)" },
  raised:   { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary:  { color: "var(--text-primary)" },
  sub:      { color: "var(--text-secondary)" },
  muted:    { color: "var(--text-muted)" },
  accent:   { color: "var(--accent)" },
  border:   { borderColor: "var(--border)" },
};

// GET /auth/users returns each user's assigned role as flat fields
// (role_id/role_code/role_name/assign_id) directly on the user object, but
// every place this page displays "assigned roles" (the summary stat, the
// table column, and the edit modal's Role Assignment section) reads a
// `roles: [...]` array — the shape GET /user/:id actually returns. Without
// this normalization, a user who already has a role assigned still shows
// "No roles assigned" everywhere until you open the edit modal and trigger
// its own re-fetch, which made a real assignment look like it had silently
// failed. Apply this to every raw /auth/users response before it hits state.
function normalizeUserRoles(u: any) {
  if (Array.isArray(u.roles)) return u;
  return {
    ...u,
    roles: u.role_id ? [{ role_id: u.role_id, role_code: u.role_code, role_name: u.role_name, assign_id: u.assign_id }] : [],
  };
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [user,          setUser]          = useState<NavUser | null>(null);
  const [tenantId,      setTenantId]      = useState("");
  const [users,         setUsers]         = useState<any[]>([]);
  const [companies,     setCompanies]     = useState<any[]>([]);
  const [activeCompany, setActiveCompany] = useState<any>(null);
  const [roles,         setRoles]         = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");
  const [success,       setSuccess]       = useState("");
  const [query,         setQuery]         = useState("");

  // Add user form
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [submitting,     setSubmitting]     = useState(false);
  const [selectedCompId, setSelectedCompId] = useState("");
  const [newUser, setNewUser] = useState({
    email: "", password_hash: "", full_name: "", phone: "", user_type: "STANDARD_USER",
  });

  // Edit modal
  const [editingMember, setEditingMember] = useState<any | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    const tid = getStoredTenantId();
    if (!token || !storedUser || !tid) { router.replace("/"); return; }
    setUser(storedUser); setTenantId(tid);
    if (storedUser.userType === "TENANT_ADMIN") {
      setNewUser((u) => ({ ...u, user_type: "COMPANY_ADMIN" }));
    }
    loadData(storedUser, tid);
  }, [router]);

  const loadData = async (storedUser: NavUser, tid: string) => {
    setLoading(true); setError("");
    try {
      const [usersListRaw, companiesList] = await Promise.all([
        api.get("/auth/users"),
        api.get(`/company/tenant/${tid}`),
      ]);
      const usersList = (Array.isArray(usersListRaw) ? usersListRaw : []).map(normalizeUserRoles);
      setCompanies(Array.isArray(companiesList) ? companiesList : []);

      const activeId = getActiveCompanyId() || storedUser.companyId || (storedUser as any).company_id;
      const myComp   = companiesList.find((c: any) => c.company_id === activeId) || companiesList[0] || null;

      if (storedUser.userType === "TENANT_ADMIN") {
        setUsers(Array.isArray(usersList) ? usersList : []);
        if (companiesList.length > 0) setSelectedCompId(companiesList[0].company_id);
      } else {
        // Merge home-company users + multi-company junction members
        // so users assigned to this company via user_company_assignments also appear
        const mergedUsers: any[] = Array.isArray(usersList) ? usersList : [];

        if (myComp?.company_id) {
          try {
            const junctionMembers: any[] = await api.get(`/user-company/company/${myComp.company_id}/members`);
            if (Array.isArray(junctionMembers) && junctionMembers.length > 0) {
              // Build a set of already-known user IDs
              const knownIds = new Set(mergedUsers.map((u: any) => u.user_id));
              // Add junction members not already in the list
              junctionMembers.forEach((m: any) => {
                if (!knownIds.has(m.user_id)) {
                  mergedUsers.push({
                    user_id:    m.user_id,
                    full_name:  m.full_name,
                    email:      m.email,
                    user_type:  m.user_type,
                    company_id: myComp.company_id, // treat as member of this company
                    is_active:  m.is_active,
                    roles:      [],
                    _via_assignment: true, // flag: added via multi-company
                  });
                }
              });
            }
          } catch { /* junction table may not exist yet — non-critical */ }

          // Filter to only this company's members (home users + junction members)
          const homeUsers = mergedUsers.filter(
            (u: any) => u.company_id === myComp.company_id && u.user_type !== "TENANT_ADMIN"
          );
          setUsers(homeUsers);
          setActiveCompany(myComp);

          try {
            const rolesList = await api.get(`/role/company/${myComp.company_id}`);
            setRoles(Array.isArray(rolesList) ? rolesList : []);
          } catch { /* non-critical */ }
        } else {
          setUsers(mergedUsers.filter((u: any) => u.user_type !== "TENANT_ADMIN"));
        }
      }
    } catch (e: any) {
      const msg = e?.message || "";
      if (!msg.toLowerCase().includes("cannot manage") && !msg.toLowerCase().includes("tenant admin")) {
        setError(msg || t("usrLoadFailedDefault"));
      }
    } finally { setLoading(false); }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetCompanyId = user?.userType === "TENANT_ADMIN" ? selectedCompId : activeCompany?.company_id;
    if (!targetCompanyId || !tenantId) { setError(t("usrSelectCompanyFirst")); return; }
    setSubmitting(true); setError(""); setSuccess("");
    try {
      const targetComp = companies.find((c) => c.company_id === targetCompanyId);
      await api.post("/auth/register-admin", {
        ...newUser,
        tenant_id: tenantId,
        company_id: targetCompanyId,
        timezone_pref_id: targetComp?.default_timezone_id || "Asia/Kolkata",
      });
      setSuccess(t("usrRegisteredSuccess"));
      setShowAddForm(false);
      setNewUser({ email: "", password_hash: "", full_name: "", phone: "", user_type: user?.userType === "TENANT_ADMIN" ? "COMPANY_ADMIN" : "STANDARD_USER" });
      const list = await api.get("/auth/users");
      setUsers((Array.isArray(list) ? list : []).map(normalizeUserRoles));
    } catch (err: any) { setError(err?.message || t("usrRegisterFailedDefault")); }
    finally { setSubmitting(false); }
  };

  const isTenantAdmin  = user?.userType === "TENANT_ADMIN";
  const isCompanyAdmin = user?.userType === "COMPANY_ADMIN";

  const companyMap: Record<string, string> = {};
  companies.forEach((c) => { companyMap[c.company_id] = c.company_name; });

  const activeCompanyId = getActiveCompanyId() || user?.companyId || (user as any)?.company_id || activeCompany?.company_id;

  // For COMPANY_ADMIN: only show users belonging to the active company, exclude TENANT_ADMIN
  // For TENANT_ADMIN: show all users
  const displayedUsers = isTenantAdmin
    ? users
    : users.filter((u) =>
        u.user_type !== "TENANT_ADMIN" &&
        u.company_id === activeCompanyId
      );

  // Access rule: a COMPANY_ADMIN cannot edit another COMPANY_ADMIN
  const canEdit = (targetUser: any): boolean => {
    if (targetUser.user_id === user?.userId) return true; // can always view/edit own profile (deactivation is blocked separately)
    if (isTenantAdmin) return true; // TENANT_ADMIN can edit anyone
    if (targetUser.user_type === "COMPANY_ADMIN" && isCompanyAdmin) return false; // blocked
    if (targetUser.user_type === "TENANT_ADMIN") return false; // always blocked
    return true;
  };

  const visibleUsers = displayedUsers.filter((member) => {
    const value = `${member.full_name ?? ""} ${member.email ?? ""} ${member.user_type ?? ""} ${companyMap[member.company_id] ?? ""}`.toLowerCase();
    return value.includes(query.trim().toLowerCase());
  });

  if (loading) return <LoadingState label={t("usrLoadingTeam")} />;

  return (
    <ConsolePage>
      {/* The uppercase "People & access" kicker that sat above this title is
          gone: the breadcrumb directly above now states the same location, and
          a second label stacked over the H1 is the marketing-page hierarchy
          this phase is meant to remove, not reproduce. */}
      <PageHeader
        title={t("teamManagement")}
        description={t("usrPageDesc")}
        actions={
          <Button onClick={() => setShowAddForm(!showAddForm)}>
            <UserPlus className="w-4 h-4" /> {t("usrInviteUser")}
          </Button>
        }
      />

      {/* Summary strip — one bordered surface with hairline dividers between
          segments, not three separate cards competing for attention. */}
      <div
        className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-md)] border sm:grid-cols-3"
        style={{ backgroundColor: "var(--border)", borderColor: "var(--border)" }}
      >
        {[
          { label: t("usrWorkspaceMembers"), value: displayedUsers.length, detail: t("usrAcrossOrganization") },
          { label: t("usrAdministrators"), value: displayedUsers.filter((member) => member.user_type?.includes("ADMIN")).length, detail: t("usrTenantCompanyAdmins") },
          { label: t("usrRolesAssigned"), value: displayedUsers.filter((member) => member.roles?.length).length, detail: t("usrAwaitingAssignment", { n: displayedUsers.filter((member) => !member.roles?.length).length }) },
        ].map((item) => (
          <div key={item.label} className="p-4" style={{ backgroundColor: "var(--surface)" }}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-medium" style={S.sub}>{item.label}</p><p className="mt-1 text-2xl font-semibold tracking-tight" style={S.primary}>{item.value}</p></div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: "var(--badge-bg)", color: "var(--text-secondary)" }}><Users size={17} /></span>
            </div>
            <p className="mt-2 text-[11px]" style={S.muted}>{item.detail}</p>
          </div>
        ))}
      </div>

      {error   && <ErrorState message={error} />}
      {success && <Toast variant="success" message={success} onClose={() => setSuccess("")} />}

      {/* ── Add User Form ── */}
      <Dialog
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        title={t("usrInviteDrawerTitle")}
        description={t("usrInviteDrawerDesc")}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="create-user-form" disabled={submitting}>
              {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {submitting ? t("usrRegistering") : t("usrRegisterUser")}
            </Button>
          </>
        }
      >
          <form id="create-user-form" onSubmit={handleAddUser} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <Label>{t("usrFullName")}</Label>
              <Input required value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                 />
            </div>
            <div>
              <Label>{t("usrEmailAddress")}</Label>
              <Input required type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                 />
            </div>
            <div>
              <Label>{t("usrTempPassword")}</Label>
              <Input required type="password" value={newUser.password_hash} onChange={(e) => setNewUser({ ...newUser, password_hash: e.target.value })}
                placeholder={t("usrMinChars")} />
            </div>
            <div>
              <Label>{t("usrPhone")}</Label>
              <Input value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                 />
            </div>

            {isTenantAdmin && (
              <div>
                <Label>{t("usrAssignToCompany")}</Label>
                <Select value={selectedCompId} onChange={(e) => setSelectedCompId(e.target.value)}>
                  {companies.map((c) => (
                    <option key={c.company_id} value={c.company_id}>{c.company_name}</option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <Label>{t("usrUserType")}</Label>
              <Select value={newUser.user_type} onChange={(e) => setNewUser({ ...newUser, user_type: e.target.value })}>
                {isTenantAdmin && <option value="COMPANY_ADMIN">{t("usrCompanyAdministrator")}</option>}
                <option value="OPERATIONAL_ADMIN">{t("usrOperationalAdministrator")}</option>
                <option value="STANDARD_USER">{t("usrStandardOperator")}</option>
              </Select>
            </div>

          </form>
      </Dialog>

      {/* ── Users Table ── */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-(--border) bg-(--surface)">
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={S.border}>
          <div>
            <h2 className="text-[15px] font-semibold" style={S.primary}>{t("usrWorkspaceDirectory")}</h2>
            <p className="mt-0.5 text-xs" style={S.muted}>{t("usrMemberCount", { n: displayedUsers.length })}</p>
          </div>
          <label className="flex h-10 w-full items-center gap-2 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-secondary) px-3 text-(--text-muted) transition-colors focus-within:border-(--input-border-focus) focus-within:bg-(--surface) sm:w-72">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("usrSearchMembers")} className="nf-embedded-input min-w-0 flex-1 border-0 bg-transparent text-xs text-(--text-primary) outline-none" />
          </label>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse text-sm">
          <TableHeader>
            <tr className="border-b border-(--row-border)">
              {["#", t("usrColName"), t("usrColEmail"), isTenantAdmin ? t("dashColCompany") : "", t("usrColType"), t("usrColAssignedRoles"), t("actionsColumn")]
                .filter(Boolean)
                .map((h) => (
                  <TableHead key={h} className="px-5 tracking-[0.12em]">{h}</TableHead>
                ))}
            </tr>
          </TableHeader>
          <TableBody>
            {visibleUsers.length === 0 && (
              <tr><TableCell colSpan={7} className="px-5 text-center py-12" style={S.muted}>{t("usrNoTeamMembers")}</TableCell></tr>
            )}
            {visibleUsers.map((u, idx) => (
              <TableRow key={u.user_id}>
                <TableCell className="px-5 py-4" style={S.muted}>{idx + 1}</TableCell>
                <TableCell className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: "var(--color-navy)" }}>
                      {u.full_name?.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase() || "?"}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold" style={S.primary}>{u.full_name}</span>
                        {u._via_assignment && (
                          <Badge variant="neutral" title={t("usrMultiCoTitle")}>{t("usrMultiCo")}</Badge>
                        )}
                      </div>
                      {(u.designation || u.department) && (
                        <p className="mt-0.5 text-[10px] text-(--text-muted)">
                          {[u.designation, u.department].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="px-5 py-4" style={S.sub}>{u.email}</TableCell>

                {isTenantAdmin && (
                  <TableCell className="px-5 py-4">
                    {u.company_id ? (
                      <div className="flex items-center gap-1 text-xs" style={S.sub}>
                        <Building2 className="w-3 h-3 shrink-0" style={S.muted} />
                        {companyMap[u.company_id] || u.company_id?.substring(0, 8) + "…"}
                      </div>
                    ) : (
                      <span className="text-xs" style={S.muted}>—</span>
                    )}
                  </TableCell>
                )}

                <TableCell className="px-5 py-4"><UserTypeBadge type={u.user_type} /></TableCell>

                {/* Assigned Roles */}
                <TableCell className="px-5 py-4">
                  {u.roles && u.roles.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r: any) => (
                        <Badge key={r.assign_id || r.role_id} variant="neutral">
                          <Shield className="w-3 h-3" /> {r.role_name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs" style={S.muted}>{t("usrNoRolesAssigned")}</span>
                  )}
                </TableCell>

                {/* Actions */}
                <TableCell className="px-5 py-4">
                  {canEdit(u) ? (
                    <Button
                      onClick={() => setEditingMember(u)}
                      variant="outline"
                      size="sm"
                      title={t("usrEditMemberTitle")}
                    >
                      <Pencil className="w-3.5 h-3.5" /> {t("edit")}
                    </Button>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg border"
                      style={{
                        backgroundColor: "var(--surface-raised)",
                        color: "var(--text-muted)",
                        borderColor: "var(--border)",
                        cursor: "not-allowed",
                      }}
                      title={u.user_type === "COMPANY_ADMIN" ? t("usrCannotEditCompanyAdmin") : t("usrInsufficientPermissions")}
                    >
                      <Shield className="w-3 h-3" /> {t("usrProtected")}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
        </div>
      </div>

      {/* ── Edit Member Modal ── */}
      {editingMember && (
        <EditMemberModal
          member={editingMember}
          roles={roles}
          isTenantAdmin={isTenantAdmin}
          allCompanies={companies}
          isSelf={!!user?.userId && editingMember.user_id === user.userId}
          onClose={() => setEditingMember(null)}
          onSaved={async () => {
            setEditingMember(null);
            setSuccess(t("usrMemberUpdatedSuccess"));
            const list = await api.get("/auth/users");
            setUsers((Array.isArray(list) ? list : []).map(normalizeUserRoles));
          }}
        />
      )}
    </ConsolePage>
  );
}
