'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ConsolePage } from '@/components/ui/console-page';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStoredUser, hasPermission, type NavUser } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { TripsScreen } from '@/modules/logistics/trips-screen';

/** Logistics trips (Phase 2), guarded as its API is: module LOGISTICS, resource TRIP, view. */
export default function LogisticsTripsPage() {
  const { t } = useLanguage();
  const [user, setUser] = useState<NavUser | null>(() => getStoredUser());
  useEffect(() => setUser(getStoredUser()), []);

  if (!user) return null;
  if (!hasPermission(user, 'LOGISTICS', 'TRIP', 'can_view'))
    return (
      <ConsolePage size="narrow">
        <PageHeader title={t('trpTitle')} sticky={false} />
        <div
          className="flex items-center gap-3 rounded-[var(--radius-lg)] border p-5"
          style={{ borderColor: 'var(--warning)', backgroundColor: 'var(--warning-muted)', color: 'var(--warning)' }}
        >
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{t('trpAccessDenied')}</p>
        </div>
      </ConsolePage>
    );

  return (
    <ConsolePage>
      <PageHeader title={t('trpTitle')} />
      <TripsScreen />
    </ConsolePage>
  );
}
