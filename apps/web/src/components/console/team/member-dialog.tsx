"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Search, Shield } from "lucide-react";
import { api } from "../../../services/api-client";
import { useLanguage } from "../../../hooks/useLanguage";
import type { NavUser } from "../../../hooks/useAuth";
import { Dialog } from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { PasswordInput } from "../../ui/password-input";
import { Select } from "../../ui/select";
import { Field, ReadField } from "../../ui/field";
import { Badge } from "../../ui/badge";
import { SearchableEntitySelect } from "../../../modules/master-data/SearchableEntitySelect";
import { assignableUserTypes, isTenantLevelUserType } from "./user-access";

type Row = Record<string, any>;

export interface MemberDialogProps {
  mode: "create" | "edit";
  /** The user being edited; ignored in create mode. */
  member?: Row | null;
  /** The signed-in user — decides which user types this form may offer at all. */
  me: NavUser;
  tenantId: string;
  /** Companies of the tenant. Only a tenant-level user may pick among them. */
  companies: Row[];
  /** The company a non-tenant-level user creates into. */
  activeCompanyId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/**
 * One dialog for creating a user and for editing one, because they set the same
 * things: the profile, the access (company, user type, farm, operational areas)
 * and the role.
 *
 * Every rule here is also enforced by the API, and the API's refusal message is
 * what this form shows. The two are not the same kind of check:
 *
 *  - A rule that is flat — you cannot hand out a user type above your own — is
 *    applied to the *options*, since offering a choice that can only ever be
 *    refused is not information.
 *  - A rule that depends on the record — a role that grants unrestricted access
 *    may only be assigned by a tenant admin, an area you do not hold yourself —
 *    leaves the control enabled and shows what came back. Hiding it would leave
 *    the user guessing why the thing they can see is not there.
 */
export function MemberDialog({
  mode,
  member,
  me,
  tenantId,
  companies,
  activeCompanyId,
  onClose,
  onSaved,
}: MemberDialogProps) {
  const { t } = useLanguage();
  const isEdit = mode === "edit";
  const isSelf = isEdit && member?.user_id === me.userId;
  const tenantLevel = isTenantLevelUserType(me.userType);

  const typeOptions = useMemo(() => {
    const allowed = assignableUserTypes(me.userType);
    // In edit mode the account's current type has to stay selectable, or
    // submitting an unrelated change would silently propose moving it.
    if (isEdit && member?.user_type && !allowed.includes(member.user_type)) {
      return [member.user_type, ...allowed];
    }
    return [...allowed];
  }, [me.userType, isEdit, member?.user_type]);

  const [companyId, setCompanyId] = useState<string>(
    (isEdit ? member?.company_id : tenantLevel ? "" : activeCompanyId) || "",
  );
  const [form, setForm] = useState({
    full_name: member?.full_name || "",
    email: member?.email || "",
    password: "",
    phone: member?.phone || "",
    employee_id: member?.employee_id || "",
    department: member?.department || "",
    designation: member?.designation || "",
    user_type: (isEdit ? member?.user_type : typeOptions[typeOptions.length - 1]) || "STANDARD_USER",
    farm_id: member?.farm_id || "",
  });
  const [areaIds, setAreaIds] = useState<string[]>(
    (member?.operational_areas || []).map((a: Row) => a.area_id),
  );
  const [roleId, setRoleId] = useState<string>(member?.roles?.[0]?.role_id || "");

  const [farms, setFarms] = useState<Row[]>([]);
  const [areas, setAreas] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(false);
  const [areaQuery, setAreaQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isStandard = form.user_type === "STANDARD_USER";

  // Farms, areas and roles all belong to the chosen company, and the first two
  // are narrowed by who is asking — an operational admin is only offered the
  // areas they hold themselves. The API decides all three; this only asks.
  useEffect(() => {
    if (!companyId) { setFarms([]); setAreas([]); setRoles([]); return; }
    let cancelled = false;
    setLookupsLoading(true);
    Promise.all([
      api.get(`/user/assignable-farms?companyId=${companyId}`).catch(() => []),
      api.get(`/user/assignable-areas?companyId=${companyId}`).catch(() => []),
      api.get(`/role/company/${companyId}`).catch(() => []),
    ])
      .then(([farmRows, areaRows, roleRows]) => {
        if (cancelled) return;
        setFarms(Array.isArray(farmRows) ? farmRows : []);
        setAreas(Array.isArray(areaRows) ? areaRows : []);
        // SUPER_ADMIN is not a role a console user is handed from this screen.
        setRoles((Array.isArray(roleRows) ? roleRows : []).filter((r: Row) => r.role_code !== "SUPER_ADMIN" && r.role_code !== "SYSTEM_SUPER_ADMIN"));
      })
      .finally(() => { if (!cancelled) setLookupsLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  const visibleAreas = useMemo(() => {
    const q = areaQuery.trim().toLowerCase();
    if (!q) return areas;
    return areas.filter((a) => `${a.area_code} ${a.area_name}`.toLowerCase().includes(q));
  }, [areas, areaQuery]);

  const toggleArea = (areaId: string) =>
    setAreaIds((prev) => (prev.includes(areaId) ? prev.filter((id) => id !== areaId) : [...prev, areaId]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!companyId) { setError(t("usrSelectCompanyFirst")); return; }
    if (isStandard && !form.farm_id) { setError(t("tmFarmRequired")); return; }
    setSaving(true);
    try {
      if (isEdit) {
        const payload: Row = {
          full_name: form.full_name,
          phone: form.phone,
          employee_id: form.employee_id,
          department: form.department,
          designation: form.designation,
          operational_area_ids: areaIds,
        };
        // Your own type, farm and areas are somebody else's to set; sending the
        // unchanged values keeps the API's "did this actually change?" check
        // quiet, and the form locks them anyway.
        if (!isSelf) payload.user_type = form.user_type;
        // An empty string is not a UUID and a non-standard user has no farm.
        if (isStandard && form.farm_id) payload.farm_id = form.farm_id;
        await api.put(`/user/${member?.user_id}`, payload);
        const held = member?.roles?.[0];
        if (roleId && roleId !== held?.role_id) {
          await api.post("/role/assign", { userId: member?.user_id, roleId });
        } else if (!roleId && held?.assign_id) {
          await api.delete(`/role/assign/${held.assign_id}`);
        }
        onSaved(t("tmUpdatedSuccess"));
      } else {
        const created = await api.post("/user", {
          company_id: companyId,
          tenant_id: tenantId,
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          phone: form.phone || undefined,
          user_type: form.user_type,
          employee_id: form.employee_id || undefined,
          department: form.department || undefined,
          designation: form.designation || undefined,
          farm_id: isStandard && form.farm_id ? form.farm_id : undefined,
          operational_area_ids: areaIds,
        });
        if (roleId && created?.user_id) {
          await api.post("/role/assign", { userId: created.user_id, roleId });
        }
        onSaved(t("tmCreatedSuccess"));
      }
    } catch (err: any) {
      // Verbatim: the API's refusal is the only accurate explanation of a
      // contextual rule, and rewording it here would only lose detail.
      setError(err?.message || (isEdit ? t("tmUpdateFailed") : t("tmCreateFailed")));
    } finally {
      setSaving(false);
    }
  };

  const currentRole = member?.roles?.[0];

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? t("tmEditTitle") : t("tmCreateTitle")}
      description={isEdit ? t("tmEditDesc") : t("tmCreateDesc")}
      maxWidth="lg"
      footer={
        <Button type="submit" form="team-member-form" size="sm" disabled={saving}>
          {saving ? (isEdit ? t("saving") : t("tmCreating")) : isEdit ? t("saveChanges") : t("tmCreateSubmit")}
        </Button>
      }
    >
      <form id="team-member-form" onSubmit={submit} className="flex flex-col gap-6 pt-1">
        {error && (
          <div
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-xs"
            style={{ backgroundColor: "var(--danger-muted)", borderColor: "var(--danger)", color: "var(--danger)" }}
            role="alert"
          >
            <AlertCircle className="mt-px h-4 w-4 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {isSelf && (
          <p className="rounded-[var(--radius-sm)] border px-3 py-2 text-[12px] text-(--text-secondary)"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }}>
            {t("tmSelfProfileNote")}
          </p>
        )}

        {/* ── Profile ── */}
        <section className="flex flex-col gap-4">
          <p className="nf-text-label text-(--text-muted)">{t("tmSectionProfile")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("usrFullName")} htmlFor="tm-full-name" required>
              <Input id="tm-full-name" required value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            {isEdit ? (
              <ReadField label={t("usrEmailAddress")} value={member?.email} mono />
            ) : (
              <Field label={t("usrEmailAddress")} htmlFor="tm-email" required>
                <Input id="tm-email" type="email" required value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
            )}
            {!isEdit && (
              <Field label={t("usrTempPassword")} htmlFor="tm-password" tooltip={t("tmPasswordHint")} required>
                <PasswordInput id="tm-password" required minLength={8} value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
            )}
            <Field label={t("usrPhone")} htmlFor="tm-phone">
              <Input id="tm-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label={t("edmEmployeeId")} htmlFor="tm-employee-id">
              <Input id="tm-employee-id" value={form.employee_id}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })} />
            </Field>
            <Field label={t("edmDepartment")} htmlFor="tm-department">
              <Input id="tm-department" value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </Field>
            <Field label={t("edmDesignation")} htmlFor="tm-designation">
              <Input id="tm-designation" value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })} />
            </Field>
          </div>
        </section>

        {/* ── Access ── */}
        <section className="flex flex-col gap-4 border-t pt-5" style={{ borderColor: "var(--border)" }}>
          <p className="nf-text-label text-(--text-muted)">{t("tmSectionAccess")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* A company is entity-backed, so it takes the searchable code/name
                lookup. Below tenant level it is not a choice at all. */}
            {tenantLevel && !isEdit ? (
              <Field label={t("tmFieldCompany")} htmlFor="tm-company" required>
                <SearchableEntitySelect
                  id="tm-company"
                  ariaLabel={t("tmFieldCompany")}
                  ariaRequired
                  value={companyId}
                  onChange={(next) => { setCompanyId(next); setForm((f) => ({ ...f, farm_id: "" })); setAreaIds([]); }}
                  options={companies}
                  valueKey="company_id"
                  getLabel={(row) => `${row.company_code ? `${row.company_code} — ` : ""}${row.company_name ?? ""}`}
                  getLabelParts={(row) => [row.company_code ?? "", row.company_name ?? ""]}
                  placeholder={t("tmSelectCompany")}
                  searchPlaceholder={t("tmSearchCompany")}
                  noMatchesLabel={t("tmNoMatches")}
                />
              </Field>
            ) : (
              <ReadField
                label={t("tmFieldCompany")}
                value={
                  isEdit
                    ? [member?.company_code, member?.company_name].filter(Boolean).join(" — ")
                    : companies.find((c) => c.company_id === companyId)?.company_name || t("tmCompanyFixed")
                }
              />
            )}

            {isSelf || typeOptions.length === 0 ? (
              <ReadField label={t("tmFieldUserType")} value={(form.user_type || "").replace(/_/g, " ")} />
            ) : (
              <Field label={t("tmFieldUserType")} htmlFor="tm-user-type" required>
                <Select id="tm-user-type" value={form.user_type}
                  onChange={(e) => setForm({ ...form, user_type: e.target.value })}>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
                  ))}
                </Select>
              </Field>
            )}

            {/* A farm is a standard user's boundary and nothing else's, so the
                field appears for exactly that type — the rule the API applies
                to `user_master.farm_id`. */}
            {isStandard && (
              isSelf ? (
                <ReadField
                  className="sm:col-span-2"
                  label={t("tmFieldFarm")}
                  value={[member?.farm_code, member?.farm_name].filter(Boolean).join(" — ")}
                />
              ) : (
                <Field label={t("tmFieldFarm")} htmlFor="tm-farm" tooltip={t("tmFarmHint")} required className="sm:col-span-2">
                  <SearchableEntitySelect
                    id="tm-farm"
                    ariaLabel={t("tmFieldFarm")}
                    ariaRequired
                    value={form.farm_id}
                    onChange={(next) => setForm({ ...form, farm_id: next })}
                    options={farms}
                    valueKey="location_id"
                    getLabel={(row) => `${row.location_code ? `${row.location_code} — ` : ""}${row.location_name ?? ""}`}
                    getLabelParts={(row) => [row.location_code ?? "", row.location_name ?? ""]}
                    disabled={!companyId}
                    loading={lookupsLoading}
                    placeholder={t("tmSelectFarm")}
                    searchPlaceholder={t("tmSearchFarm")}
                    noMatchesLabel={t("tmNoMatches")}
                  />
                </Field>
              )
            )}
          </div>

          {/* Operational areas — a separate access dimension from the farm. */}
          <div className="flex flex-col gap-2">
            <span className="nf-text-label text-(--text-secondary)">{t("tmFieldAreas")}</span>
            <p className="text-[12px] text-(--text-muted)">{t("tmAreasHint")}</p>
            {isSelf ? (
              <div className="flex flex-wrap gap-1.5">
                {(member?.operational_areas || []).length === 0
                  ? <span className="text-xs text-(--text-muted)">{t("tmAreasNone")}</span>
                  : (member?.operational_areas || []).map((a: Row) => (
                      <Badge key={a.area_id} variant="neutral">{a.area_code}</Badge>
                    ))}
              </div>
            ) : (
              <div className="rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border)" }}>
                <label className="flex items-center gap-2 border-b px-3 py-2 text-(--text-muted)" style={{ borderColor: "var(--border)" }}>
                  <Search size={14} />
                  <input
                    value={areaQuery}
                    onChange={(e) => setAreaQuery(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    aria-label={t("tmFieldAreas")}
                    className="nf-embedded-input min-w-0 flex-1 border-0 bg-transparent text-xs text-(--text-primary) outline-none"
                  />
                </label>
                <div className="max-h-44 overflow-y-auto">
                  {visibleAreas.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-(--text-muted)">{t("tmNoMatches")}</p>
                  ) : visibleAreas.map((area) => (
                    <label key={area.area_id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs hover:bg-(--row-hover)">
                      <input
                        type="checkbox"
                        checked={areaIds.includes(area.area_id)}
                        onChange={() => toggleArea(area.area_id)}
                        className="h-4 w-4 rounded-[var(--radius-xs)] accent-[var(--accent)]"
                      />
                      <span className="font-mono text-[11px] text-(--text-secondary)">{area.area_code}</span>
                      <span className="min-w-0 flex-1 truncate text-(--text-primary)">{area.area_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Role ── */}
        <section className="flex flex-col gap-3 border-t pt-5" style={{ borderColor: "var(--border)" }}>
          <p className="nf-text-label text-(--text-muted)">{t("tmSectionRole")}</p>
          {roles.length === 0 ? (
            <p className="text-xs text-(--text-muted)">{t("tmRoleNoneDefined")}</p>
          ) : (
            <>
              {currentRole && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="accent"><Shield className="h-3 w-3" /> {currentRole.role_name}</Badge>
                </div>
              )}
              <SearchableEntitySelect
                id="tm-role"
                ariaLabel={t("tmSectionRole")}
                value={roleId}
                onChange={setRoleId}
                options={roles}
                valueKey="role_id"
                getLabel={(row) => `${row.role_code ? `${row.role_code} — ` : ""}${row.role_name ?? ""}`}
                getLabelParts={(row) => [row.role_code ?? "", row.role_name ?? ""]}
                placeholder={t("tmSelectRole")}
                searchPlaceholder={t("tmSearchRole")}
                noMatchesLabel={t("tmNoMatches")}
                onClear={roleId ? () => setRoleId("") : undefined}
              />
              <p className="text-[12px] text-(--text-muted)">{t("rolMemberSingleRoleNote")}</p>
            </>
          )}
        </section>
      </form>
    </Dialog>
  );
}

export default MemberDialog;
