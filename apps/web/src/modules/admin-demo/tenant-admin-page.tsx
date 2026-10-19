'use client';

import { NA } from "@/utils/na";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Building2, CheckCircle2, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AdminShell } from './admin-shell';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api-client';
import { fetchTenantCompanies } from '@/modules/company';
import { saveApiCompanies } from '@/modules/company/use-current-company';
import type { CompanyMeta } from '@/modules/company';
import { useLanguage } from "@/hooks/useLanguage";

interface TenantDetails {
  tenant_id: string;
  tenant_code: string;
  tenant_name: string;
  tenant_type: string;
  plan_id: string;
  max_companies: number;
  max_users: number;
  billing_email: string;
  subscription?: { plan_code?: string; support_tier?: string };
}

interface UserRow {
  userId?: string;
  user_id?: string;
  fullName?: string;
  full_name?: string;
  email: string;
  userType?: string;
  user_type?: string;
  is_active?: boolean;
}

export function TenantAdminPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [tenant, setTenant] = useState<TenantDetails | null>(null);
  const [companies, setCompanies] = useState<CompanyMeta[]>([]);
  const [members, setMembers] = useState<UserRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.tenantId) return;
    Promise.all([
      api.get<TenantDetails>(`/tenant/${user.tenantId}`),
      fetchTenantCompanies(user.tenantId),
      api.get<UserRow[]>('/auth/users'),
    ])
      .then(([tenantDetails, companyRows, userRows]) => {
        setTenant(tenantDetails);
        setCompanies(companyRows);
        saveApiCompanies(companyRows);
        setMembers(userRows);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load organization'));
  }, [user?.tenantId]);

  const metrics: Array<[string, string | number, LucideIcon, string]> = [
    ['Companies', companies.length, Building2, tenant ? `${companies.length} of ${tenant.max_companies} plan limit` : 'Loading plan'],
    ['Users', members.length, Users, tenant ? `${members.length} of ${tenant.max_users} plan limit` : 'Loading plan'],
    ['Setup ready', companies.filter((item) => item.setupProgress === 100).length, CheckCircle2, 'Operational companies'],
    ['Backend status', tenant ? 'Live' : 'Loading', BarChart3, 'Tenant-scoped API'],
  ];

  return (
    <AdminShell title={t("tapOrganization")} eyebrow={tenant?.tenant_name || 'Tenant workspace'}>
      <p className="mt-2 text-sm text-(--text-secondary)">{t("tapManageDesc")}</p>
      {error && <p className="mt-4 rounded-[var(--radius-sm)] bg-(--danger-muted) px-4 py-3 text-xs text-(--danger)">{error}</p>}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, Icon, detail]) => (
          <div key={label} className="rounded-[var(--radius-md)] border border-(--border) bg-(--surface) p-5"><div className="flex justify-between"><div><p className="text-xs text-(--text-secondary)">{label}</p><p className="mt-2 text-2xl font-semibold text-(--text-primary)">{value}</p></div><Icon size={19} className="text-(--accent)" /></div><p className="mt-3 text-xs text-(--text-secondary)">{detail}</p></div>
        ))}
      </div>
      <section className="mt-6 overflow-hidden rounded-[var(--radius-md)] border border-(--border) bg-(--surface)">
        <header className="border-b border-(--border) px-6 py-4"><h2 className="font-semibold text-(--text-primary)">{t("tapCompanyPortfolio")}</h2><p className="mt-1 text-xs text-(--text-secondary)">{t("tapCompanyPortfolioDesc")}</p></header>
        <div className="divide-y divide-(--border)">
          {companies.length === 0 && <p className="px-6 py-5 text-xs text-(--text-secondary)">{t("tapNoCompanies")}</p>}
          {companies.map((company) => (
            <div key={company.slug} className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_160px_140px_auto] sm:items-center"><div><p className="text-sm font-semibold text-(--text-primary)">{company.icon} {company.name}</p><p className="mt-1 text-xs text-(--text-secondary)">{company.location}</p></div><span className="text-xs text-(--text-secondary)">{company.nobName}</span><span className="text-xs text-(--text-secondary)">Setup {company.setupProgress}%</span><Link href={`/${company.slug}/dashboard`} className="text-xs font-semibold text-(--accent)">{t("tapOpenWorkspace")}</Link></div>
          ))}
        </div>
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-[var(--radius-md)] border border-(--border) bg-(--surface) p-6"><h2 className="font-semibold text-(--text-primary)">{t("tapOrgProfile")}</h2><p className="mt-1 text-xs text-(--text-secondary)">{t("tapOrgProfileDesc")}</p><div className="mt-5 grid grid-cols-2 gap-4 text-xs">{[['Legal name',tenant?.tenant_name || 'Loading…'],['Workspace code',tenant?.tenant_code || NA],['Tenant type',tenant?.tenant_type || NA],['Plan',tenant?.subscription?.plan_code || tenant?.plan_id || NA],['Billing email',tenant?.billing_email || NA],['Support tier',tenant?.subscription?.support_tier || NA]].map(([label,value])=><div key={label}><p className="text-[10px] uppercase tracking-wide text-(--text-muted)">{label}</p><p className="mt-1 font-semibold text-(--text-primary)">{value}</p></div>)}</div></section>
        <section className="rounded-[var(--radius-md)] border border-(--border) bg-(--surface) p-6"><h2 className="font-semibold text-(--text-primary)">{t("tapOrgMembers")}</h2><p className="mt-1 text-xs text-(--text-secondary)">{t("tapOrgMembersDesc")}</p><div className="mt-4 divide-y divide-(--border)">{members.map((member)=><div key={member.userId || member.user_id || member.email} className="flex items-center gap-3 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--accent-muted) text-[10px] font-semibold text-(--accent)">{(member.fullName || member.full_name || member.email).charAt(0)}</span><div className="flex-1"><p className="text-xs font-semibold text-(--text-primary)">{member.fullName || member.full_name || member.email}</p><p className="mt-0.5 text-[10px] text-(--text-muted)">{member.userType || member.user_type || 'User'} · {member.email}</p></div><span className={`text-[10px] font-semibold ${member.is_active === false ? 'text-slate-500' : 'text-(--success)'}`}>{member.is_active === false ? 'Inactive' : 'Active'}</span></div>)}</div></section>
      </div>
    </AdminShell>
  );
}
