import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';

export interface MatrixPermission {
  module_code: string;
  resource: string;
  name?: string;
  nameKey?: string;
  [flag: string]: any;
}

const FLAGS = ['can_view', 'can_create', 'can_edit', 'can_delete', 'can_approve'] as const;

/** The area a module's resources sit under on the matrix, in the order they are shown. */
const GROUPS: { key: string; title: string; hint: string; modules: string[] }[] = [
  { key: 'livestock', title: 'Livestock & AI Station', hint: 'Animals, breeding, boar selection, collection plans and semen collection', modules: ['PIGGERY'] },
  { key: 'production', title: 'Production', hint: 'Batches, daily entries, schedules and quality checks', modules: ['PRODUCTION'] },
  { key: 'inventory', title: 'Inventory & Stock', hint: 'Receipts, transfers, counts and ledgers', modules: ['INVENTORY'] },
  { key: 'procurement', title: 'Procurement', hint: 'Requisitions', modules: ['PROCUREMENT'] },
  { key: 'finance', title: 'Finance & Reports', hint: 'Journals, expenses and reports', modules: ['FINANCE', 'REPORTS'] },
  { key: 'master', title: 'Master Data', hint: 'Items, farms, breeds, breeding-line rules and other set-up', modules: ['MASTER_DATA'] },
  { key: 'alerts', title: 'Alerts & Notifications', hint: 'Notification settings and alert rules', modules: ['NOTIFICATION'] },
  { key: 'admin', title: 'Company & Administration', hint: 'Company profile, users, roles, number series and audit', modules: ['COMPANY', 'SYSTEM', 'AUDIT', 'RBAC'] },
];

const COLUMNS: { flag: (typeof FLAGS)[number]; k: string }[] = [
  { flag: 'can_view', k: 'roleColView' },
  { flag: 'can_create', k: 'roleColCreate' },
  { flag: 'can_edit', k: 'roleColEdit' },
  { flag: 'can_delete', k: 'roleColDelete' },
  { flag: 'can_approve', k: 'roleColApprove' },
];

/**
 * A role's permissions, by area: a heading per area with how much of it is granted, a search, and an "only what is
 * granted" switch. Rows keep their index in `permissions`, so the caller's toggle handler is unchanged.
 */
export function RolePermissionMatrix({
  permissions,
  disabled,
  onToggle,
  label,
  columnLabel,
}: {
  permissions: MatrixPermission[];
  disabled: boolean;
  onToggle: (index: number, flag: string) => void;
  label: (p: MatrixPermission) => string;
  columnLabel: (key: string) => string;
}) {
  const [search, setSearch] = useState('');
  const [grantedOnly, setGrantedOnly] = useState(false);
  // Every area starts folded; opening one is the user's choice, and a search opens whatever it finds.
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  const granted = (p: MatrixPermission) => FLAGS.some((f) => p[f]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const known = new Set(GROUPS.flatMap((g) => g.modules));
    const defs = [...GROUPS, { key: 'other', title: 'Other', hint: '', modules: [] as string[] }];
    return defs
      .map((g) => {
        const all = permissions
          .map((p, index) => ({ p, index }))
          .filter(({ p }) => (g.key === 'other' ? !known.has(p.module_code) : g.modules.includes(p.module_code)));
        const rows = all.filter(({ p }) => {
          if (grantedOnly && !granted(p)) return false;
          if (!q) return true;
          return `${label(p)} ${p.module_code} ${p.resource}`.toLowerCase().includes(q);
        });
        return { ...g, rows, total: all.length, grantedCount: all.filter(({ p }) => granted(p)).length };
      })
      .filter((g) => g.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, search, grantedOnly]);

  const grantedTotal = permissions.filter(granted).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-10 min-w-[12rem] flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-secondary) px-3 text-(--text-muted) focus-within:border-(--input-border-focus) focus-within:bg-(--surface) sm:max-w-sm">
          <Search size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a screen or permission"
            aria-label="Search permissions"
            className="nf-embedded-input min-w-0 flex-1 border-0 bg-transparent text-xs text-(--text-primary) outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={grantedOnly}
            onChange={(e) => setGrantedOnly(e.target.checked)}
            className="w-4 h-4 accent-[var(--accent)]"
          />
          Only what is granted
        </label>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {grantedTotal} of {permissions.length} resources granted
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="py-10 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Nothing matches.
        </p>
      ) : (
        groups.map((g) => {
          const open = search.trim() ? true : !!opened[g.key];
          return (
            <section
              key={g.key}
              className="rounded-[var(--radius-sm)] border overflow-hidden"
              style={{ borderColor: 'var(--row-border)' }}
            >
              <button
                type="button"
                onClick={() => setOpened({ ...opened, [g.key]: !open })}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                style={{ backgroundColor: 'var(--badge-bg)' }}
              >
                {open ? (
                  <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {g.title}
                  </span>
                  {g.hint && (
                    <span className="block text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {g.hint}
                    </span>
                  )}
                </span>
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    color: g.grantedCount ? 'var(--accent)' : 'var(--text-muted)',
                    border: '1px solid var(--row-border)',
                  }}
                >
                  {g.grantedCount} / {g.total}
                </span>
              </button>

              {open && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--row-border)' }}>
                        <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                          Screen
                        </th>
                        {COLUMNS.map(({ flag, k }) => (
                          <th
                            key={flag}
                            className="w-20 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {columnLabel(k)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(({ p, index }) => (
                        <tr
                          key={`${p.module_code}-${p.resource}`}
                          style={{
                            borderBottom: '1px solid var(--row-border)',
                            backgroundColor: granted(p) ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : undefined,
                          }}
                        >
                          <td className="px-4 py-2.5">
                            <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                              {label(p)}
                            </div>
                            <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                              {p.module_code} • {p.resource}
                            </div>
                          </td>
                          {COLUMNS.map(({ flag }) => (
                            <td key={flag} className="px-2 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={!!p[flag]}
                                disabled={disabled}
                                aria-label={`${label(p)} ${columnLabel(COLUMNS.find((c) => c.flag === flag)!.k)}`}
                                onChange={() => onToggle(index, flag)}
                                className="w-4 h-4 rounded-[var(--radius-xs)] accent-[var(--accent)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
