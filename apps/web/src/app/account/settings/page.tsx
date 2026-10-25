'use client';

import { NA } from '@/utils/na';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ThemeSelector } from '@/components/ui/theme-selector';
import { LanguageSelector } from '@/components/ui/language-selector';
import { api } from '@/lib/api-client';
import { useLanguage } from '@/hooks/useLanguage';

interface NotificationPref {
  category: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

interface Session {
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  APPROVALS: 'notifCategoryApprovals',
  MORTALITY_ALERTS: 'notifCategoryMortalityAlerts',
  KPI_ALERTS: 'notifCategoryKpiAlerts',
  INVENTORY_ALERTS: 'notifCategoryInventoryAlerts',
  SYSTEM: 'notifCategorySystem',
};

export default function SettingsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const close = () => router.back();
  const [prefs, setPrefs] = useState<NotificationPref[]>([]);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);

  const loadPrefs = () => {
    api
      .get<NotificationPref[]>('/auth/notification-preferences')
      .then(setPrefs)
      .catch(() => setPrefs([]));
  };
  const loadSessions = () => {
    api
      .get<Session[]>('/auth/sessions')
      .then(setSessions)
      .catch(() => setSessions([]));
  };

  useEffect(() => {
    loadPrefs();
    loadSessions();
  }, []);

  const togglePref = (
    category: string,
    field: 'emailEnabled' | 'inAppEnabled',
  ) => {
    setPrefs((prev) =>
      prev.map((p) =>
        p.category === category ? { ...p, [field]: !p[field] } : p,
      ),
    );
  };

  const savePrefs = async () => {
    setPrefsSaving(true);
    setPrefsMsg('');
    try {
      await api.patch('/auth/notification-preferences', {
        preferences: prefs.map((p) => ({
          category: p.category,
          email_enabled: p.emailEnabled,
          in_app_enabled: p.inAppEnabled,
        })),
      });
      setPrefsMsg(t('settingsSaved'));
      setTimeout(() => setPrefsMsg(''), 3000);
    } finally {
      setPrefsSaving(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    await api.delete(`/auth/sessions/${sessionId}`).catch(() => void 0);
    loadSessions();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={t('settingsPageTitle')}
      description={t('settingsPageDescription')}
      maxWidth="lg"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('settingsAppearance')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ThemeSelector />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settingsLanguage')}</CardTitle>
          </CardHeader>
          <CardContent>
            <LanguageSelector />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settingsNotifications')}</CardTitle>
            <CardDescription>{t('settingsNotificationsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {prefs.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {t('loadingEllipsis')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th
                        className="px-3 py-2 font-medium"
                        style={{ color: 'var(--text-muted)' }}
                      ></th>
                      <th
                        className="px-3 py-2 text-center font-medium"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {t('settingsEmail')}
                      </th>
                      <th
                        className="px-3 py-2 text-center font-medium"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {t('settingsInApp')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {prefs.map((p) => (
                      <tr
                        key={p.category}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                        }}
                      >
                        <td
                          className="px-3 py-2"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {t(CATEGORY_LABEL_KEYS[p.category] as any) ||
                            p.category}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={p.emailEnabled}
                            onChange={() =>
                              togglePref(p.category, 'emailEnabled')
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={p.inAppEnabled}
                            onChange={() =>
                              togglePref(p.category, 'inAppEnabled')
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={savePrefs}
                disabled={prefsSaving || prefs.length === 0}
                size="sm"
              >
                {prefsSaving ? '…' : t('profileSaveChanges')}
              </Button>
              {prefsMsg && (
                <span
                  className="text-[13px]"
                  style={{ color: 'var(--success)' }}
                >
                  {prefsMsg}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settingsSessions')}</CardTitle>
            <CardDescription>{t('settingsSessionsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sessions.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {NA}
              </p>
            ) : (
              sessions.map((s, idx) => (
                <div
                  key={s.sessionId}
                  className="flex items-center justify-between rounded-[var(--radius-sm)] px-3 py-2"
                  style={{ backgroundColor: 'var(--surface-raised)' }}
                >
                  <div
                    className="text-[13px]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {idx === 0
                      ? t('settingsCurrentSession')
                      : s.sessionId.slice(0, 8)}
                    <span
                      className="ml-2 text-[12px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {t('settingsSessionIssued')}{' '}
                      {new Date(s.issuedAt).toLocaleString()}
                    </span>
                  </div>
                  <button
                    onClick={() => revokeSession(s.sessionId)}
                    className="text-[12px] font-medium"
                    style={{ color: 'var(--danger)' }}
                  >
                    {t('settingsRevoke')}
                  </button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </Dialog>
  );
}
