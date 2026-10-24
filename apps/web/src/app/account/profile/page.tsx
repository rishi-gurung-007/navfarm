'use client';

import { NA } from '@/utils/na';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useLanguage } from '@/hooks/useLanguage';

interface Profile {
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  userType: string;
  companyId: string;
  tenantId: string;
  department: string | null;
  designation: string | null;
  createdAt: string;
}

export default function ProfilePage() {
  const { t } = useLanguage();
  const router = useRouter();
  const close = () => router.back();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    api
      .get<Profile>('/auth/me')
      .then((data) => {
        setProfile(data);
        setFullName(data.fullName || '');
        setPhone(data.phone || '');
        setDepartment(data.department || '');
        setDesignation(data.designation || '');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg('');
    try {
      await api.patch('/auth/profile', {
        full_name: fullName,
        phone,
        department,
        designation,
      });
      setSavedMsg(t('profileSaved'));
      setTimeout(() => setSavedMsg(''), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwError('');
    setPwMsg('');
    setPwSaving(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwMsg(t('profilePasswordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setPwMsg(''), 3000);
    } catch (err: any) {
      setPwError(err?.message || 'Failed to change password.');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      title={t('profilePageTitle')}
      description={t('profilePageDescription')}
      maxWidth="lg"
    >
      {loading || !profile ? (
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('loadingEllipsis')}
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('profilePersonalInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('profileFullName')} htmlFor="full-name">
                  <Input
                    id="full-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </Field>
                <Field label={t('profilePhone')} htmlFor="phone">
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <Field label={t('profileDepartment')} htmlFor="department">
                  <Input
                    id="department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  />
                </Field>
                <Field label={t('profileDesignation')} htmlFor="designation">
                  <Input
                    id="designation"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? '…' : t('profileSaveChanges')}
                </Button>
                {savedMsg && (
                  <span
                    className="text-[13px]"
                    style={{ color: 'var(--success)' }}
                  >
                    {savedMsg}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('profileAccountInfo')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt
                    className="text-[12px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {t('profileEmail')}
                  </dt>
                  <dd
                    className="text-[14px]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {profile.email}
                  </dd>
                </div>
                <div>
                  <dt
                    className="text-[12px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {t('profileRole')}
                  </dt>
                  <dd
                    className="text-[14px]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {profile.userType.replace(/_/g, ' ')}
                  </dd>
                </div>
                <div>
                  <dt
                    className="text-[12px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {t('profileMemberSince')}
                  </dt>
                  <dd
                    className="text-[14px]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {profile.createdAt
                      ? new Date(profile.createdAt).toLocaleDateString()
                      : NA}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('profileChangePassword')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={t('profileCurrentPassword')}
                  htmlFor="current-password"
                >
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </Field>
                <Field label={t('profileNewPassword')} htmlFor="new-password">
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </Field>
              </div>
              {pwError && (
                <p className="text-[13px]" style={{ color: 'var(--danger)' }}>
                  {pwError}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleChangePassword}
                  disabled={
                    pwSaving || !currentPassword || newPassword.length < 8
                  }
                >
                  {pwSaving ? '…' : t('profileChangePassword')}
                </Button>
                {pwMsg && (
                  <span
                    className="text-[13px]"
                    style={{ color: 'var(--success)' }}
                  >
                    {pwMsg}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </Dialog>
  );
}
