import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ShieldAlert, Plus, Save, RefreshCw, Edit3, Trash2, Users, X } from "lucide-react";
import { api } from "../../../services/api-client";
import { useLanguage } from "../../../hooks/useLanguage";
import type { TranslationKeys } from "../../../utils/translations";
import { Dialog } from "../../ui/dialog";
import { Badge } from "../../ui/badge";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../ui/table";
import { SearchableEntitySelect } from "../../../modules/master-data/SearchableEntitySelect";

interface RolesTabProps {
  roles: any[];
  companyId: string;
  onRefreshRoles: () => Promise<void>;
  actionError: string;
  actionSuccess: string;
  setActionError: (msg: string) => void;
  setActionSuccess: (msg: string) => void;
}

// Kept in sync with every @RequirePermission(moduleCode, resource, action) call
// across apps/api/src/modules — this list is what a role can actually be
// granted. A resource with no backend enforcement has no business appearing
// here: checking its box would look like it does something and wouldn't.
const DEFAULT_RESOURCES = [
  // AUDIT
  { module_code: "AUDIT", resource: "LOGS", name: "Audit Logs & Trails", nameKey: "rolAuditLogsTrails" },
  // COMPANY
  { module_code: "COMPANY", resource: "SETTINGS", name: "Company Profiles", nameKey: "rolCompanyProfiles" },
  // FINANCE (Phase 4)
  { module_code: "FINANCE", resource: "JOURNAL", name: "Journal Entries", nameKey: "jpJournalEntries" },
  { module_code: "FINANCE", resource: "REPORTS", name: "Financial Reports", nameKey: "rolFinancialReports" },
  // INVENTORY (Phase 3)
  { module_code: "INVENTORY", resource: "GOODS_RECEIPT", name: "Goods Receipt", nameKey: "grpTitle" },
  { module_code: "INVENTORY", resource: "GOODS_ISSUE", name: "Goods Issue", nameKey: "invGoodsIssue" },
  { module_code: "INVENTORY", resource: "STOCK_TRANSFER", name: "Stock Transfer", nameKey: "apDocType_STOCK_TRANSFER" },
  { module_code: "INVENTORY", resource: "STOCK_ADJUSTMENT", name: "Stock Adjustment", nameKey: "invStockAdjustment" },
  { module_code: "INVENTORY", resource: "LEDGER", name: "Inventory Ledger", nameKey: "invLedger" },
  { module_code: "INVENTORY", resource: "BIO_ASSET_LEDGER", name: "Bio-Asset Ledger", nameKey: "blBioAssetLedgerTitle" },
  // MASTER_DATA (Phase 2)
  { module_code: "MASTER_DATA", resource: "UOM", name: "Units of Measure", nameKey: "rolUnitsOfMeasure" },
  { module_code: "MASTER_DATA", resource: "SPECIES", name: "Species", nameKey: "rolSpecies" },
  { module_code: "MASTER_DATA", resource: "BREED", name: "Breeds", nameKey: "rolBreeds" },
  { module_code: "MASTER_DATA", resource: "FARM", name: "Farms", nameKey: "rolFarms" },
  { module_code: "MASTER_DATA", resource: "WAREHOUSE", name: "Warehouses", nameKey: "rolWarehouses" },
  { module_code: "MASTER_DATA", resource: "SHED", name: "Sheds", nameKey: "rolSheds" },
  { module_code: "MASTER_DATA", resource: "LOCATION", name: "Locations", nameKey: "rolLocations" },
  { module_code: "MASTER_DATA", resource: "ITEM_CATEGORY", name: "Item Categories", nameKey: "rolItemCategories" },
  { module_code: "MASTER_DATA", resource: "ITEM_TYPE", name: "Item Types", nameKey: "rolItemTypes" },
  { module_code: "MASTER_DATA", resource: "ITEM", name: "Items", nameKey: "rolItems" },
  { module_code: "MASTER_DATA", resource: "ITEM_ATTRIBUTE", name: "Item Attributes", nameKey: "rolItemAttributes" },
  { module_code: "MASTER_DATA", resource: "SUPPLIER", name: "Suppliers", nameKey: "gSuppliers" },
  { module_code: "MASTER_DATA", resource: "CUSTOMER", name: "Customers", nameKey: "rolCustomers" },
  { module_code: "MASTER_DATA", resource: "RESOURCE", name: "Resources (Labor/Equipment)", nameKey: "rolResourcesLabor" },
  { module_code: "MASTER_DATA", resource: "DISEASE", name: "Diseases", nameKey: "rolDiseases" },
  { module_code: "MASTER_DATA", resource: "REASON", name: "Reasons", nameKey: "rolReasons" },
  { module_code: "MASTER_DATA", resource: "FEED_FORMULA", name: "Feed Formulas", nameKey: "rolFeedFormulas" },
  { module_code: "MASTER_DATA", resource: "GL_ACCOUNT", name: "GL Accounts", nameKey: "rolGlAccounts" },
  { module_code: "MASTER_DATA", resource: "GL_MAPPING", name: "GL Mappings", nameKey: "rolGlMappings" },
  { module_code: "MASTER_DATA", resource: "COST_CENTER", name: "Cost Centers", nameKey: "rolCostCenters" },
  { module_code: "MASTER_DATA", resource: "CURRENCY", name: "Currencies", nameKey: "rolCurrencies" },
  // NOTIFICATION
  { module_code: "NOTIFICATION", resource: "SETTINGS", name: "Notification Gateway Settings", nameKey: "rolNotificationGateway" },
  { module_code: "MASTER_DATA", resource: "OPERATIONAL_AREA", name: "Operational Areas", nameKey: "operationalAreas" },
  { module_code: "MASTER_DATA", resource: "BREED_LIFECYCLE_STAGE", name: "Breed Lifecycle Standards", nameKey: "rolBreedLifecycleStandards" },
  { module_code: "MASTER_DATA", resource: "ACTIVITY", name: "Activities", nameKey: "rolActivities" },
  // PRODUCTION (Phase 5)
  { module_code: "PRODUCTION", resource: "BATCH", name: "Production Batches", nameKey: "dashProductionBatches" },
  // PRODUCTION (Phase 6)
  { module_code: "PRODUCTION", resource: "PARAMETER", name: "Production Parameters", nameKey: "rolProductionParameters" },
  { module_code: "PRODUCTION", resource: "BATCH_SCHEDULE", name: "Production Schedulers", nameKey: "rolProductionSchedulers" },
  { module_code: "PRODUCTION", resource: "BATCH_ENTRY", name: "Daily Data Entry", nameKey: "rolDailyDataEntry" },
  // PRODUCTION (QC/QR)
  { module_code: "PRODUCTION", resource: "QC_PARAMETER", name: "QC Parameters", nameKey: "navQcParameters" },
  { module_code: "PRODUCTION", resource: "QC", name: "QC Inspections", nameKey: "rolQcInspections" },
  { module_code: "PRODUCTION", resource: "QR_CODE", name: "Traceability Packs (QR)", nameKey: "rolTraceabilityPacks" },
  { module_code: "PRODUCTION", resource: "STAGE", name: "Lifecycle Stages", nameKey: "batchStages" },
  { module_code: "PRODUCTION", resource: "APPROVAL", name: "Approvals", nameKey: "approvals" },
  // PIGGERY
  { module_code: "PIGGERY", resource: "ANIMAL", name: "Animal Register", nameKey: "animalHerdRegister" },
  // SYSTEM
  { module_code: "SYSTEM", resource: "NUMBER_SERIES", name: "Number Series", nameKey: "rolNumberSeries" },
  // RBAC
  { module_code: "RBAC", resource: "ROLE", name: "User Roles & Team Management", nameKey: "rolUserRolesTeam" },
  { module_code: "RBAC", resource: "USER", name: "User Accounts", nameKey: "rolUserAccounts" },
];

const S = {
  textPrimary: { color: "var(--text-primary)" },
  textSecondary: { color: "var(--text-secondary)" },
  textMuted: { color: "var(--text-muted)" },
  border: { borderColor: "var(--border)" },
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  surfaceRaised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
  accent: { color: "var(--accent)" },
};

export default function RolesTab({
  roles,
  companyId,
  onRefreshRoles,
  setActionError,
  setActionSuccess
}: RolesTabProps) {
  const { t } = useLanguage();
  const [selectedRole, setSelectedRole] = useState<any>(null);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);

  // Create modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newRole, setNewRole] = useState({ roleCode: "", roleName: "", description: "" });
  const [creatingRole, setCreatingRole] = useState(false);

  // Edit modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete confirm
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [deletingRole, setDeletingRole] = useState(false);

  // Who holds the selected role. A permission matrix without this reads as a
  // policy document; with it, it says who a change is about to affect.
  const [panel, setPanel] = useState<"permissions" | "members">("permissions");
  const [members, setMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [companyUsers, setCompanyUsers] = useState<any[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [assigningMember, setAssigningMember] = useState(false);

  // The pool of people a role can be given to, as the API scopes it.
  useEffect(() => {
    api.get("/user?limit=500")
      .then((rows: any[]) => setCompanyUsers(Array.isArray(rows) ? rows : []))
      .catch(() => setCompanyUsers([]));
  }, []);

  const loadMembers = async (roleId: string) => {
    setMembersLoading(true);
    try {
      const rows = await api.get(`/role/members/${roleId}`);
      setMembers(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setMembers([]);
      setActionError(err?.message || t("rolMembersLoadFailed"));
    } finally {
      setMembersLoading(false);
    }
  };

  const handleAssignMember = async () => {
    if (!selectedRole || !addUserId) return;
    setAssigningMember(true);
    setActionError("");
    setActionSuccess("");
    try {
      await api.post("/role/assign", { userId: addUserId, roleId: selectedRole.role_id });
      setAddUserId("");
      setActionSuccess(t("rolMemberAdded"));
      await loadMembers(selectedRole.role_id);
      await onRefreshRoles();
    } catch (err: any) {
      // Shown, not hidden: whether this user is out of reach, out of company or
      // this role grants unrestricted access is the API's call to explain.
      setActionError(err?.message || t("rolMemberAssignFailed"));
    } finally {
      setAssigningMember(false);
    }
  };

  const handleRemoveMember = async (assignId: string) => {
    if (!selectedRole) return;
    setActionError("");
    setActionSuccess("");
    try {
      await api.delete(`/role/assign/${assignId}`);
      setActionSuccess(t("rolMemberRemoved"));
      await loadMembers(selectedRole.role_id);
      await onRefreshRoles();
    } catch (err: any) {
      setActionError(err?.message || t("rolMemberRemoveFailed"));
    }
  };

  const handleSelectRole = async (role: any) => {
    setSelectedRole(role);
    setAddUserId("");
    loadMembers(role.role_id);
    setLoadingPerms(true);
    setActionError("");
    try {
      const activeRules = await api.get(`/role/permissions/${role.role_id}`);
      const merged = DEFAULT_RESOURCES.map((def) => {
        const matchingRule = activeRules.find(
          (r: any) => r.module_code === def.module_code && r.resource === def.resource
        );
        return {
          module_code: def.module_code,
          resource: def.resource,
          name: def.name,
          nameKey: (def as { nameKey?: string }).nameKey,
          can_view: matchingRule ? !!matchingRule.can_view : false,
          can_create: matchingRule ? !!matchingRule.can_create : false,
          can_edit: matchingRule ? !!matchingRule.can_edit : false,
          can_delete: matchingRule ? !!matchingRule.can_delete : false,
          can_approve: matchingRule ? !!matchingRule.can_approve : false
        };
      });
      setPermissions(merged);
    } catch (e) {
      setPermissions(DEFAULT_RESOURCES.map(d => ({
        ...d, can_view: false, can_create: false, can_edit: false, can_delete: false, can_approve: false
      })));
    } finally {
      setLoadingPerms(false);
    }
  };

  const visibleRoles = roles.filter(
    (r) => r.role_code !== "SUPER_ADMIN" && r.role_code !== "SYSTEM_SUPER_ADMIN"
  );

  // Auto-select first role on load
  useEffect(() => {
    if (visibleRoles.length > 0 && !selectedRole) {
      handleSelectRole(visibleRoles[0]);
    }
  }, [visibleRoles]);

  const handleToggleCheckbox = (index: number, key: string) => {
    const updated = [...permissions];
    updated[index][key] = !updated[index][key];
    setPermissions(updated);
  };

  const handleSavePermissions = async () => {
    if (!selectedRole) return;
    setSavingPerms(true);
    setActionError("");
    setActionSuccess("");
    try {
      await api.post(`/role/permissions/${selectedRole.role_id}`, {
        permissions: permissions.map(p => ({
          module_code: p.module_code,
          resource: p.resource,
          can_view: p.can_view,
          can_create: p.can_create,
          can_edit: p.can_edit,
          can_delete: p.can_delete,
          can_approve: p.can_approve
        }))
      });
      setActionSuccess(t("roleSyncSuccess"));
    } catch (err: any) {
      setActionError(err?.message || t("roleUpdatePermFailedDefault"));
    } finally {
      setSavingPerms(false);
    }
  };

  // Create
  const handleCreateRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingRole(true);
    setActionError("");
    setActionSuccess("");
    try {
      const created = await api.post("/role/create", { ...newRole, companyId });
      setActionSuccess(t("roleCreatedSuccess"));
      setIsCreateModalOpen(false);
      setNewRole({ roleCode: "", roleName: "", description: "" });
      await onRefreshRoles();
      handleSelectRole(created);
    } catch (err: any) {
      setActionError(err?.message || t("roleCreateFailedDefault"));
    } finally {
      setCreatingRole(false);
    }
  };

  // Edit
  const openEditModal = (role: any) => {
    setEditingRole(role);
    setEditName(role.role_name);
    setEditDesc(role.role_description || "");
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;
    setSavingEdit(true);
    setActionError("");
    setActionSuccess("");
    try {
      await api.put(`/role/${editingRole.role_id}`, { roleName: editName, description: editDesc });
      setActionSuccess(t("roleUpdatedSuccess"));
      setIsEditModalOpen(false);
      setEditingRole(null);
      await onRefreshRoles();
    } catch (err: any) {
      setActionError(err?.message || t("roleUpdateFailedDefault"));
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete
  const handleDeleteRole = async (roleId: string) => {
    setDeletingRole(true);
    setActionError("");
    setActionSuccess("");
    try {
      await api.delete(`/role/${roleId}`);
      setActionSuccess(t("roleDeletedSuccess"));
      setDeletingRoleId(null);
      if (selectedRole?.role_id === roleId) {
        setSelectedRole(null);
      }
      await onRefreshRoles();
    } catch (err: any) {
      setActionError(err?.message || t("roleDeleteFailedDefault"));
    } finally {
      setDeletingRole(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start relative animate-fade-in">

      {/* Roles List (Left Sidebar) */}
      <div className="md:col-span-4 flex flex-col gap-4">
        <div className="flex justify-between items-center pb-3 border-b" style={S.border}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={S.textSecondary}>{t("roleAvailableScopes")}</span>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg cursor-pointer transition-transform hover:scale-[1.02]"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <Plus className="w-3.5 h-3.5" /> {t("roleCreateRole")}
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {visibleRoles.length === 0 ? (
            <div className="p-8 text-center text-xs border border-dashed rounded-[var(--radius-sm)]" style={{ ...S.surface, ...S.textMuted }}>
              {t("roleNoCustomRoles")}
            </div>
          ) : (
            visibleRoles.map((r) => {
              const isCurrent = selectedRole?.role_id === r.role_id;
              return (
                <div
                  key={r.role_id}
                  className={`p-4 transition-all border rounded-[var(--radius-sm)] relative overflow-hidden flex flex-col gap-3 cursor-pointer ${
                    isCurrent
                      ? "shadow-sm"
                      : "hover:border-[var(--accent)]"
                  }`}
                  style={{
                    backgroundColor: isCurrent ? "var(--surface-raised)" : "var(--surface)",
                    borderColor: isCurrent ? "var(--accent)" : "var(--border)",
                  }}
                  onClick={() => handleSelectRole(r)}
                >
                  {isCurrent && <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ backgroundColor: "var(--accent)" }} />}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-sm" style={S.textPrimary}>{r.role_name}</h4>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)] font-mono" style={{ backgroundColor: "var(--badge-bg)", color: "var(--text-secondary)" }}>
                        {r.role_code}
                      </span>
                    </div>
                    <p className="text-xs mt-1.5 line-clamp-2" style={S.textMuted}>{r.role_description || t("roleCustomOperatorScopes")}</p>
                    {/* How many live accounts hold it — `getCompanyRoles` counts
                        them, so the list says who a policy change affects. */}
                    <div className="mt-2">
                      <Badge variant="neutral"><Users className="w-3 h-3" /> {t("rolHoldersBadge", { n: r.user_count ?? 0 })}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 pt-2.5 border-t" style={S.border} onClick={e => e.stopPropagation()}>
                    {!r.is_system_role && (
                      <button
                        onClick={() => openEditModal(r)}
                        className="flex items-center gap-1 text-[11px] cursor-pointer transition-colors font-semibold"
                        style={S.textSecondary}
                        onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
                        onMouseLeave={e => e.currentTarget.style.color = "var(--text-secondary)"}
                      >
                        <Edit3 className="w-3 h-3" /> {t("roleEditName")}
                      </button>
                    )}
                    {r.is_system_role && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold" style={S.textMuted}>
                        <ShieldAlert className="w-3 h-3" /> {t("roleSystemLocked")}
                      </span>
                    )}
                    {!r.is_system_role && (
                      <button
                        onClick={() => setDeletingRoleId(r.role_id)}
                        className="flex items-center gap-1 text-[11px] cursor-pointer transition-colors font-semibold text-rose-500 hover:text-rose-600"
                      >
                        <Trash2 className="w-3 h-3" /> {t("roleDeleteAction")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Permissions matrix */}
      <div className="md:col-span-8">
        {selectedRole ? (
          <Card className="p-6 flex flex-col gap-6" style={S.surface}>
            <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b pb-4 gap-4" style={S.border}>
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2" style={S.textPrimary}>
                  <ShieldAlert className="w-4 h-4" style={S.accent} />
                  {t("roleAccessMatrix", { name: selectedRole.role_name })}
                </h3>
                <p className="text-[9px] mt-1 font-mono" style={S.textMuted}>{t("roleIdLabel", { id: selectedRole.role_id })}</p>
              </div>
              {panel === "permissions" && (selectedRole.is_system_role ? (
                <span className="flex items-center gap-1.5 self-start py-2 px-3 text-[11px] font-semibold rounded-[var(--radius-sm)]" style={{ color: "var(--text-muted)", backgroundColor: "var(--badge-bg)" }}>
                  <ShieldAlert className="w-3.5 h-3.5" /> {t("roleSystemPermissionsFixed")}
                </span>
              ) : (
                <Button
                  onClick={handleSavePermissions}
                  disabled={savingPerms || loadingPerms}
                  className="flex items-center gap-1.5 self-start py-2 px-4 font-semibold text-xs text-white"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingPerms ? t("saving") : t("roleSavePolicies")}
                </Button>
              ))}
            </div>

            {/* What a role is, and who holds it — the two questions this screen
                answers. They are separate panels because the permission matrix
                is long enough that a members list under it would never be seen. */}
            <div className="flex gap-2" role="tablist">
              {([
                { key: "permissions", label: t("rolTabPermissions") },
                { key: "members", label: t("rolTabMembers") },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={panel === key}
                  onClick={() => setPanel(key)}
                  className="rounded-[var(--radius-pill)] border px-3.5 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    backgroundColor: panel === key ? "var(--accent-muted)" : "var(--surface)",
                    borderColor: panel === key ? "var(--accent)" : "var(--border)",
                    color: panel === key ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {label}
                  {key === "members" && <span className="ml-1.5 font-mono">{selectedRole.user_count ?? members.length}</span>}
                </button>
              ))}
            </div>

            {panel === "members" ? (
              <div className="flex flex-col gap-4">
                <p className="text-xs font-semibold" style={S.textPrimary}>
                  {t("rolMembersTitle", { name: selectedRole.role_name })}
                </p>

                {/* Assigning is left enabled for everyone who can reach this
                    screen: the rules that could refuse it — rank, company,
                    unrestricted access — depend on the pair of records, and the
                    API's message is the only accurate account of which applied. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <SearchableEntitySelect
                      ariaLabel={t("rolMemberAdd")}
                      value={addUserId}
                      onChange={setAddUserId}
                      options={companyUsers}
                      valueKey="user_id"
                      getLabel={(row) => `${row.full_name ?? ""} — ${row.email ?? ""}`}
                      getLabelParts={(row) => [String(row.full_name ?? ""), String(row.email ?? "")]}
                      placeholder={t("rolMemberAdd")}
                      searchPlaceholder={t("searchPlaceholder")}
                      noMatchesLabel={t("mdNoMatches")}
                      onClear={addUserId ? () => setAddUserId("") : undefined}
                    />
                  </div>
                  <Button
                    onClick={handleAssignMember}
                    disabled={!addUserId || assigningMember}
                    className="self-start py-2 px-4 text-xs font-semibold text-white"
                    style={{ backgroundColor: "var(--accent)" }}
                  >
                    {assigningMember ? t("saving") : t("tmRoleAssign")}
                  </Button>
                </div>
                <p className="text-[11px]" style={S.textMuted}>{t("rolMemberSingleRoleNote")}</p>

                {membersLoading ? (
                  <div className="flex items-center justify-center gap-2.5 p-10" style={S.textMuted}>
                    <RefreshCw className="w-4 h-4 animate-spin" style={S.accent} />
                    <span className="text-xs font-medium">{t("loadingEllipsis")}</span>
                  </div>
                ) : members.length === 0 ? (
                  <p className="p-8 text-center text-xs border border-dashed rounded-[var(--radius-sm)]" style={{ ...S.surface, ...S.textMuted }}>
                    {t("rolMembersEmpty")}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y" style={{ borderColor: "var(--row-border)" }}>
                    {members.map((m) => (
                      <li key={m.assign_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold" style={S.textPrimary}>{m.full_name}</p>
                          <p className="truncate text-[11px]" style={S.textMuted}>{m.email} · {String(m.user_type || "").replace(/_/g, " ")}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {m.is_active === false && <Badge variant="danger" dot>{t("statusInactive")}</Badge>}
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.assign_id)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-rose-500 transition-colors hover:text-rose-600"
                          >
                            <X className="w-3 h-3" /> {t("rolMemberRemove")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : loadingPerms ? (
              <div className="p-16 text-center flex items-center justify-center gap-2.5" style={S.textMuted}>
                <RefreshCw className="w-4 h-4 animate-spin" style={S.accent} />
                <span className="text-xs font-medium">{t("roleReadingPermissions")}</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader className="bg-transparent">
                    <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                      <TableHead className="h-auto px-0 pb-3">{t("roleColModuleResource")}</TableHead>
                      {[
                        { k: "roleColView", label: "View" },
                        { k: "roleColCreate", label: "Create" },
                        { k: "roleColEdit", label: "Edit" },
                        { k: "roleColDelete", label: "Delete" },
                        { k: "roleColApprove", label: "Approve" },
                      ].map(({ k, label }) => (
                        <TableHead key={label} className="h-auto px-0 pb-3 text-center w-20">{t(k as any)}</TableHead>
                      ))}
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {permissions.map((p, idx) => (
                      <TableRow key={idx} style={S.textPrimary}>
                        <TableCell className="px-0 py-3.5 font-semibold">
                          <div style={S.textPrimary}>{p.nameKey ? t(p.nameKey as TranslationKeys) : p.name}</div>
                          <div className="text-[9px] font-mono mt-0.5" style={S.textMuted}>{p.module_code} • {p.resource}</div>
                        </TableCell>
                        {["can_view", "can_create", "can_edit", "can_delete", "can_approve"].map(key => (
                          <TableCell key={key} className="px-0 py-3.5 text-center">
                            <input
                              type="checkbox"
                              checked={p[key]}
                              disabled={selectedRole.is_system_role}
                              onChange={() => handleToggleCheckbox(idx, key)}
                              className="w-4 h-4 rounded-[var(--radius-xs)] border accent-[var(--accent)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus:ring-0 focus:ring-offset-0"
                              style={{
                                backgroundColor: "var(--input-bg)",
                                borderColor: "var(--input-border)",
                              }}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            )}
          </Card>
        ) : (
          <div className="text-center p-16 rounded-[var(--radius-sm)] border border-dashed flex flex-col items-center justify-center" style={{ ...S.surface, ...S.textMuted }}>
            <ShieldAlert className="w-10 h-10 mb-3 opacity-30 animate-pulse" style={S.accent} />
            <span className="text-xs font-semibold">{t("roleSelectOrCreatePrompt")}</span>
          </div>
        )}
      </div>

      <Dialog
        open={isCreateModalOpen}
        onClose={() => !creatingRole && setIsCreateModalOpen(false)}
        title={t("roleModalCreateTitle")}
        description={t("roleModalCreateDesc")}
        maxWidth="sm"
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsCreateModalOpen(false)}>{t("cancel")}</Button>
            <Button type="submit" form="create-role-form" disabled={creatingRole} size="sm" className="nf-btn-primary">{creatingRole ? t("saving") : t("create")}</Button>
          </>
        }
      >
        <form id="create-role-form" onSubmit={handleCreateRoleSubmit} className="flex flex-col gap-4 pt-1">
          <Field label={t("roleFieldRoleCode")} htmlFor="create-role-code" required>
            <Input id="create-role-code" placeholder={t("rolePhRoleCode")} value={newRole.roleCode} onChange={(e) => setNewRole({ ...newRole, roleCode: e.target.value.toUpperCase() })} required />
          </Field>
          <Field label={t("roleFieldRoleName")} htmlFor="create-role-name" required>
            <Input id="create-role-name" placeholder={t("rolePhRoleName")} value={newRole.roleName} onChange={(e) => setNewRole({ ...newRole, roleName: e.target.value })} required />
          </Field>
          <Field label={t("roleFieldDescription")} htmlFor="create-role-description">
            <Input id="create-role-description" placeholder={t("rolePhDescription")} value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} />
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={isEditModalOpen && Boolean(editingRole)}
        onClose={() => !savingEdit && setIsEditModalOpen(false)}
        title={t("roleModalEditTitle")}
        description={editingRole ? t("roleModalEditDesc", { code: editingRole.role_code }) : undefined}
        maxWidth="sm"
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsEditModalOpen(false)}>{t("cancel")}</Button>
            <Button type="submit" form="edit-role-form" disabled={savingEdit} size="sm" className="nf-btn-primary">{savingEdit ? t("saving") : t("saveChanges")}</Button>
          </>
        }
      >
        {editingRole && (
          <form id="edit-role-form" onSubmit={handleEditSubmit} className="flex flex-col gap-4 pt-1">
            <div className="text-[10px] font-mono" style={S.textMuted}>{t("roleCodeLabel", { code: editingRole.role_code })}</div>
            <Field label={t("roleFieldRoleName")} htmlFor="edit-role-name" required>
              <Input id="edit-role-name" placeholder={t("rolePhRoleName")} value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </Field>
            <Field label={t("roleFieldDescription")} htmlFor="edit-role-description">
              <Input id="edit-role-description" placeholder={t("rolePhDescriptionEdit")} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            </Field>
          </form>
        )}
      </Dialog>

      <Dialog
        open={Boolean(deletingRoleId)}
        onClose={() => !deletingRole && setDeletingRoleId(null)}
        title={t("roleModalDeleteTitle")}
        presentation="compact"
        description={t("roleModalDeleteDesc")}
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDeletingRoleId(null)}>{t("cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={() => deletingRoleId && handleDeleteRole(deletingRoleId)} disabled={deletingRole}>
              {deletingRole ? t("roleDeleting") : t("roleDeleteAction")}
            </Button>
          </>
        }
      >
        <div className="text-xs leading-relaxed pt-1" style={S.textSecondary}>
          {t("roleDeleteConfirmBody")}
        </div>
      </Dialog>
    </div>
  );
}
